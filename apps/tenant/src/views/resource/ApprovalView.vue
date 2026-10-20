<script setup lang="ts">
/**
 * 机构端 · 校本资源审批管理。
 *
 * ## 为什么从 ResourceView 里拆出来
 *
 * 它和「校本资源库」原先共用一个页面、靠顶部页签切换。审批是一件独立的事：进来的人是来
 * **处理待办**的，不该先看到「资源库」这个页签、也不该顺手滑过去。所以拆成独立页，
 * 两个菜单各自一页，页面里不再有页签。
 *
 * ## 列表口径
 *
 * 一张表铺开**全部**「加入校本 / 公开」的提审单（含题目、试卷、讲义课件教案学案、视频）。
 * 状态不再单独出筛选项：新表里就有一列「审批状态」，行内按钮再按状态收放，
 * 一眼能看出哪几条等着处理，比先切一个状态页签少一次点击。
 *
 * ## 详情与 AI 检测
 *
 * 查看详情按**资源类型**弹不同的正文（题目走题库质检正文那份组件），详情里可以直接跑 AI 检测，
 * 检测结论会被整理成一段可用的审批意见 —— 审批人点一下就能带进「通过 / 驳回」的输入框。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import {
  APPROVAL_STATUS_TEXT,
  AppFilterPanel,
  AppIcon,
  AppListToolbar,
  AppModal,
  AppPageHeader,
  RESOURCE_SCOPE_TEXT,
  TEACH_KIND_TEXT,
  paperQuestionCount,
  paperTotalScore,
  questionScopeOf,
  showToast,
  truncateRich,
} from '@aiteach/shared'
import type { FilterRowDef } from '@aiteach/shared'
import type {
  ApprovalKind,
  OrgPaper,
  OrgQuestion,
  ResourceApproval,
  ResourceScope,
  TeachDoc,
  TeachDocKind,
} from '@aiteach/shared'
import { PaperPreviewModal, QuestionPreviewBody, useBaseData } from '@aiteach/business-common'
import {
  fetchApprovals,
  fetchPapers,
  fetchQuestions,
  fetchTeachDocs,
  reviewApproval,
  submitApproval,
} from '@/api/org'
import { checkApproval } from '@/api/ai-approval'
import type { ApprovalCheckReport } from '@/api/ai-approval'

const { subjects, grades, ensure, pick } = useBaseData()
const errMsg = (e: unknown) => (e instanceof Error ? e.message : '操作失败')

/* ===== 列表 ===== */
const approvals = ref<ResourceApproval[]>([])
const loading = ref(false)
const keyword = ref('')

/** 资源类型筛选项（只留数据里真出现过的类型，避免点进去必然为空） */
const kindOptions = computed(() => [...new Set(approvals.value.map((row) => row.kind))])
const kindFilter = ref('')
const filterRows = computed<FilterRowDef[]>(() => [
  { key: 'kind', label: '资源类型', options: kindOptions.value, multiple: false },
])
const filterModel = computed<Record<string, string[]>>(() => ({ kind: kindFilter.value ? [kindFilter.value] : [] }))
function onFiltersChange(next: Record<string, string[]>) {
  kindFilter.value = next.kind?.[0] ?? ''
}

const rows = computed(() => {
  const kw = keyword.value.trim()
  return approvals.value.filter(
    (row) => (!kindFilter.value || row.kind === kindFilter.value) && (!kw || row.name.includes(kw)),
  )
})

const counts = computed(() => ({
  pending: approvals.value.filter((row) => row.status === 'pending').length,
  done: approvals.value.filter((row) => row.status !== 'pending').length,
}))

const statusTagClass = (status: ResourceApproval['status']) =>
  status === 'approved' ? 'tag-green' : status === 'rejected' ? 'tag-red' : 'tag-orange'

const kindTagClass = (kind: string) =>
  kind === '题目' || kind === '试卷' ? 'tag-gray' : kind === '视频' ? 'tag-green' : 'tag-blue'

async function load() {
  loading.value = true
  try {
    approvals.value = await fetchApprovals()
  } finally {
    loading.value = false
  }
}

/* ===== 资源正文（详情弹窗按类型取） ===== */
const questions = ref<OrgQuestion[]>([])
const papers = ref<OrgPaper[]>([])
const docs = ref<TeachDoc[]>([])

/** 提审单对应的资源正文：题目 / 试卷 / 备课文档；视频与历史提审单没有正文，返回 null */
function resourceOf(approval: ResourceApproval) {
  if (approval.resourceId == null) return null
  if (approval.kind === '题目') return questions.value.find((row) => row.id === approval.resourceId) ?? null
  if (approval.kind === '试卷') return papers.value.find((row) => row.id === approval.resourceId) ?? null
  if (approval.kind === '视频') return null
  return docs.value.find((row) => row.id === approval.resourceId) ?? null
}

/* 详情正文按类型收窄：模板里不再写 `as`，类型判定集中在这里 */
const detailResource = computed(() => (detail.value ? resourceOf(detail.value) : null))
const detailQuestion = computed<OrgQuestion | null>(() =>
  detail.value?.kind === '题目' ? ((detailResource.value as OrgQuestion | null) ?? null) : null,
)
const detailPaper = computed<OrgPaper | null>(() =>
  detail.value?.kind === '试卷' ? ((detailResource.value as OrgPaper | null) ?? null) : null,
)
const detailDoc = computed<TeachDoc | null>(() => {
  const kind = detail.value?.kind
  if (!kind || kind === '题目' || kind === '试卷' || kind === '视频') return null
  return (detailResource.value as TeachDoc | null) ?? null
})

/* 试卷正文的「全屏预览」：详情里嵌的是**画布**（够看清卷面），要换纸 / 看答题卡 / 逐题翻时
   再开这个整卷预览 —— 与试卷库「预览」是同一个组件、同一套版式，不另做一份简化版。 */
const paperFullOpen = ref(false)

/** 详情里展示的「内容规模」：试卷给题量 / 总分，文档给知识点数，题目给题型 / 难度 */
function scaleTextOf(approval: ResourceApproval): string {
  const resource = resourceOf(approval)
  if (!resource) return ''
  if (approval.kind === '试卷') {
    const paper = resource as OrgPaper
    return `${paper.sections.length} 个大题 · ${paperQuestionCount(paper)} 题 · 满分 ${paperTotalScore(paper)} 分`
  }
  if (approval.kind === '题目') {
    const question = resource as OrgQuestion
    return question.questionCategory === '材料组合题'
      ? `材料组合题 · ${question.subQuestions?.length ?? 0} 道子题`
      : `${question.type} · ${question.difficulty}`
  }
  const doc = resource as TeachDoc
  return `${TEACH_KIND_TEXT[doc.kind]} · ${doc.knowledge.length} 个知识点`
}

async function ensureResourceData() {
  if (!questions.value.length) questions.value = await fetchQuestions()
  if (!papers.value.length) papers.value = await fetchPapers()
  if (!docs.value.length) {
    const kinds: TeachDocKind[] = ['lecture', 'courseware', 'plan', 'guide']
    docs.value = (await Promise.all(kinds.map((kind) => fetchTeachDocs(kind)))).flat()
  }
}

/* ===== 查看详情 + AI 检测 ===== */
const detailOpen = ref(false)
const detail = ref<ResourceApproval | null>(null)
const detailTab = ref<'content' | 'ai'>('content')

const checking = ref(false)
const report = ref<ApprovalCheckReport | null>(null)

async function openDetail(approval: ResourceApproval) {
  detail.value = approval
  detailTab.value = 'content'
  report.value = null
  detailOpen.value = true
  try {
    await ensureResourceData()
  } catch (e) {
    showToast(errMsg(e), 'error')
  }
}

/** 跑一次 AI 检测；结论同时写进「审批意见」（供通过 / 驳回时直接带出） */
async function runAiCheck() {
  const approval = detail.value
  if (!approval || checking.value) return
  checking.value = true
  try {
    report.value = await checkApproval({
      kind: approval.kind,
      name: approval.name,
      subject: approval.subject,
      grade: approval.grade,
      note: approval.note,
      scaleText: scaleTextOf(approval),
      question: approval.kind === '题目' ? detailQuestion.value : null,
    })
    detailTab.value = 'ai'
  } catch (e) {
    showToast(errMsg(e), 'error')
  } finally {
    checking.value = false
  }
}

/* ===== 审批动作 ===== */
/** 审批意见（通过 / 驳回共用一份；AI 检测的建议会写进来，审批人可以改） */
const opinion = ref('')

const passOpen = ref(false)
const rejectOpen = ref(false)
const activeId = ref(0)
const active = computed(() => approvals.value.find((row) => row.id === activeId.value) ?? null)

function openPass(approval: ResourceApproval, fromDetail = false) {
  activeId.value = approval.id
  if (fromDetail && report.value) opinion.value = report.value.opinion
  if (fromDetail) detailOpen.value = false
  passOpen.value = true
}

function openReject(approval: ResourceApproval, fromDetail = false) {
  activeId.value = approval.id
  if (fromDetail && report.value) opinion.value = report.value.opinion
  if (fromDetail) detailOpen.value = false
  rejectOpen.value = true
}

/* 顶部行内按钮进入时，若已经从详情里拿到过 AI 意见就沿用它：
   这正是「AI 给出建议 → 人确认」的路径，没必要让审批人再抄一遍 */
function openPassRow(approval: ResourceApproval) {
  activeId.value = approval.id
  passOpen.value = true
}
function openRejectRow(approval: ResourceApproval) {
  activeId.value = approval.id
  rejectOpen.value = true
}

async function confirmPass() {
  try {
    await reviewApproval(activeId.value, true, opinion.value.trim() || '同意，予以通过')
    passOpen.value = false
    opinion.value = ''
    await load()
    showToast('已通过：资源进入校本库', 'success')
  } catch (e) {
    showToast(errMsg(e), 'error')
  }
}

async function confirmReject() {
  if (!opinion.value.trim()) {
    showToast('驳回必须填写审批意见', 'error')
    return
  }
  try {
    await reviewApproval(activeId.value, false, opinion.value.trim())
    rejectOpen.value = false
    opinion.value = ''
    await load()
    showToast('已驳回，意见已推送申请人', 'success')
  } catch (e) {
    showToast(errMsg(e), 'error')
  }
}

/** 详情里「填入审批意见」：把 AI 结论落进意见框，随后通过 / 驳回都会带上它 */
function adoptOpinion() {
  if (!report.value) return
  opinion.value = report.value.opinion
  showToast('AI 意见已填入，可通过 / 驳回时一并提交', 'success')
}

/* ===== 审批日志 ===== */
const logOpen = ref(false)
const logTarget = ref<ResourceApproval | null>(null)
function openLogs(approval: ResourceApproval) {
  logTarget.value = approval
  logOpen.value = true
}

/* ===== 提交审批（试卷 / 备课文档 / 视频走这里；题目一般从题库管理「提交校本」发起） ===== */
const submitOpen = ref(false)
const saving = ref(false)

const VIDEO_OPTIONS = [
  { id: 90001, name: '微课·函数的单调性（概念引入）', subject: '数学', grade: '高一' },
  { id: 90002, name: '微课·牛顿第一定律实验演示', subject: '物理', grade: '高一' },
  { id: 90003, name: '微课·细胞呼吸全过程', subject: '生物', grade: '高二' },
]
const APPROVAL_KINDS: ApprovalKind[] = ['题目', '试卷', '讲义', '课件', '教案', '学案', '视频']
const SCOPE_OPTIONS: ResourceScope[] = ['group', 'school', 'public']

const submitForm = reactive({
  kind: '试卷' as ApprovalKind,
  resourceId: 0,
  name: '',
  subject: '数学',
  grade: '高一',
  scope: 'school' as ResourceScope,
  note: '',
})

const resourceOptions = computed<Array<{ id: number; name: string; subject: string; grade: string }>>(() => {
  switch (submitForm.kind) {
    case '题目':
      /* 题目只剩「个人题」需要提审：校本题已经在校本库里，不需要再审一次 */
      return questions.value
        .filter((row) => questionScopeOf(row) === 'personal')
        .map((row) => ({ id: row.id, name: truncateRich(row.stem, 48), subject: row.subject, grade: row.grade }))
    case '试卷':
      return papers.value.map((row) => ({ id: row.id, name: row.name, subject: row.subject, grade: row.grade }))
    case '视频':
      return VIDEO_OPTIONS.map((row) => ({ id: row.id, name: row.name, subject: row.subject, grade: row.grade }))
    default: {
      const want =
        TEACH_KIND_TEXT[
          (submitForm.kind === '讲义'
            ? 'lecture'
            : submitForm.kind === '课件'
              ? 'courseware'
              : submitForm.kind === '教案'
                ? 'plan'
                : 'guide') as TeachDocKind
        ]
      return docs.value
        .filter((row) => TEACH_KIND_TEXT[row.kind] === want)
        .map((row) => ({ id: row.id, name: row.name, subject: row.subject, grade: row.grade }))
    }
  }
})

async function openSubmit() {
  try {
    await ensureResourceData()
  } catch (e) {
    showToast(errMsg(e), 'error')
  }
  submitForm.kind = '试卷'
  submitForm.resourceId = 0
  submitForm.name = ''
  submitForm.subject = pick(subjects.value, '数学')
  submitForm.grade = pick(grades.value, '高一')
  submitForm.scope = 'school'
  submitForm.note = ''
  submitOpen.value = true
}

function onResourceChange() {
  const option = resourceOptions.value.find((row) => row.id === submitForm.resourceId)
  if (!option) return
  submitForm.name = option.name
  submitForm.subject = option.subject
  submitForm.grade = option.grade
}

async function submitFormNow() {
  if (!submitForm.name.trim()) {
    showToast('请先选择要提审的具体资源', 'error')
    return
  }
  saving.value = true
  try {
    await submitApproval({
      kind: submitForm.kind,
      resourceId: submitForm.resourceId || undefined,
      name: submitForm.name.trim(),
      subject: submitForm.subject,
      grade: submitForm.grade,
      scope: submitForm.scope,
      note: submitForm.note.trim() || undefined,
    })
    submitOpen.value = false
    await load()
    showToast('审批单已提交', 'success')
  } catch (e) {
    showToast(errMsg(e), 'error')
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  await ensure().catch(() => {})
  try {
    await load()
  } catch (e) {
    showToast(errMsg(e), 'error')
  }
})
</script>

<template>
  <div class="page approval-page">
    <AppPageHeader desc="汇总全部「加入校本 / 公开」的提审单：查看资源正文、跑 AI 检测、给出审批意见并留痕。" />

    <div class="ap-topbar panel">
      <div class="ap-counts">
        <span class="ap-count"><b class="num warn">{{ counts.pending }}</b> 待审批</span>
        <span class="ap-divider" />
        <span class="ap-count"><b class="num ok">{{ counts.done }}</b> 已处理</span>
      </div>
      <AppListToolbar v-model="keyword" placeholder="资源名称" :search-width="240" />
      <button class="btn btn-primary btn-sm" type="button" @click="openSubmit">
        <AppIcon name="plus" :size="14" /> 提交审批
      </button>
    </div>

    <AppFilterPanel :rows="filterRows" :model-value="filterModel" @update:model-value="onFiltersChange" />

    <div class="panel table-panel">
      <div class="data-table-wrap">
        <table class="data-table ap-table">
          <thead>
            <tr>
              <th style="width: 84px">资源类型</th>
              <!-- 名称列是唯一不定宽列：窗口越宽它越舒展，其余列位置恒定 -->
              <th>名称</th>
              <th style="width: 120px">年级 / 学科</th>
              <th style="width: 88px">审批状态</th>
              <th style="width: 88px">申请人</th>
              <th style="width: 132px">提交时间</th>
              <th style="width: 88px">审核人</th>
              <th style="width: 132px">审核时间</th>
              <th style="width: 232px">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading && rows.length === 0">
              <td colspan="9" class="empty-row">加载中…</td>
            </tr>
            <tr v-else-if="rows.length === 0">
              <td colspan="9" class="empty-row">暂无提审单：个人题在题库管理里「提交校本」后会出现在这里</td>
            </tr>
            <template v-else>
              <tr v-for="row in rows" :key="row.id">
                <td><span class="tag" :class="kindTagClass(row.kind)">{{ row.kind }}</span></td>
                <td class="ap-name-cell">
                  <span class="ap-name" :title="row.name">{{ row.name }}</span>
                  <span class="ap-scope">{{ RESOURCE_SCOPE_TEXT[row.scope] }}</span>
                </td>
                <td class="ap-meta">{{ row.grade }} · {{ row.subject }}</td>
                <td>
                  <span class="tag" :class="statusTagClass(row.status)">{{ APPROVAL_STATUS_TEXT[row.status] }}</span>
                </td>
                <td class="ap-meta">{{ row.applicant }}</td>
                <td class="ap-meta ap-time">{{ row.submittedAt.slice(0, 16) }}</td>
                <td class="ap-meta">{{ row.reviewer ?? '—' }}</td>
                <td class="ap-meta ap-time">{{ row.reviewedAt?.slice(0, 16) ?? '—' }}</td>
                <td>
                  <div class="op-group">
                    <template v-if="row.status === 'pending'">
                      <button class="mini-btn" type="button" @click="openDetail(row)">查看</button>
                      <button class="mini-btn success" type="button" @click="openPassRow(row)">通过</button>
                      <button class="mini-btn danger" type="button" @click="openRejectRow(row)">驳回</button>
                    </template>
                    <button class="mini-btn" type="button" @click="openLogs(row)">审批日志</button>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ================= 查看详情（按资源类型铺正文 + AI 检测） ================= -->
    <AppModal v-if="detailOpen && detail" :title="`${detail.kind}详情`" :width="880" @close="detailOpen = false">
      <header class="dt-head">
        <span class="tag" :class="kindTagClass(detail.kind)">{{ detail.kind }}</span>
        <b class="dt-name">{{ detail.name }}</b>
        <span class="tag" :class="statusTagClass(detail.status)">{{ APPROVAL_STATUS_TEXT[detail.status] }}</span>
      </header>
      <div class="dt-meta">
        <span>{{ detail.grade }} · {{ detail.subject }}</span>
        <span>申请范围：{{ RESOURCE_SCOPE_TEXT[detail.scope] }}</span>
        <span>申请人：{{ detail.applicant }} · {{ detail.submittedAt.slice(0, 16) }}</span>
        <template v-if="detail.status !== 'pending'">
          <span>审核人：{{ detail.reviewer }} · {{ detail.reviewedAt?.slice(0, 16) }}</span>
        </template>
      </div>
      <p v-if="detail.note" class="dt-note">申请说明：{{ detail.note }}</p>
      <p v-if="detail.status !== 'pending' && detail.opinion" class="dt-opinion">
        审批意见：{{ detail.opinion }}
      </p>

      <div class="dt-tabs">
        <button class="dt-tab" :class="{ on: detailTab === 'content' }" type="button" @click="detailTab = 'content'">
          资源正文
        </button>
        <button class="dt-tab" :class="{ on: detailTab === 'ai' }" type="button" @click="detailTab = 'ai'">
          AI 检测{{ report ? `（${report.items.filter((item) => !item.pass).length} 项待关注）` : '' }}
        </button>
      </div>

      <!-- 资源正文：类型不同，铺的东西不同 -->
      <div v-if="detailTab === 'content'" class="dt-body" :class="{ 'dt-body-paper': detail.kind === '试卷' }">
        <!-- 题目：与题库管理预览、审核中心共用同一份正文组件 -->
        <template v-if="detail.kind === '题目'">
          <QuestionPreviewBody v-if="detailQuestion" :question="detailQuestion" />
          <p v-else class="f-hint dt-empty">该题已不在题库中（可能已被删除），无法展示正文。</p>
        </template>

        <!-- 试卷：与试卷库**同一个整卷预览**（纸面分版那一套）。
             审批人要看的就是「这份卷印出来长什么样」，摘要式的「大题构成」看不出排版与卷面问题。 -->
        <template v-else-if="detail.kind === '试卷'">
          <template v-if="detailPaper">
            <div class="dt-paper-bar">
              <span class="f-hint" style="margin: 0">{{ scaleTextOf(detail) }}</span>
              <button class="mini-btn" type="button" @click="paperFullOpen = true">全屏预览</button>
            </div>
            <div class="dt-canvas">
              <PaperPreviewModal canvas-only :paper="detailPaper" :questions="questions" />
            </div>
          </template>
          <p v-else class="f-hint dt-empty">未关联到试卷数据（历史提审单），仅能查看审批信息。</p>
        </template>

        <!-- 备课文档（讲义 / 课件 / 教案 / 学案） -->
        <template v-else-if="detail.kind !== '视频'">
          <template v-if="detailDoc">
            <div class="dt-grid">
              <div><div class="d-label">文档类型</div><div class="d-value">{{ TEACH_KIND_TEXT[detailDoc.kind] }}</div></div>
              <div><div class="d-label">学科 / 年级</div><div class="d-value">{{ detail.subject }} · {{ detail.grade }}</div></div>
              <div><div class="d-label">知识点</div><div class="d-value">{{ detailDoc.knowledge.join('、') || '—' }}</div></div>
              <div><div class="d-label">作者 / 更新</div><div class="d-value">
                {{ detailDoc.owner }} · {{ detailDoc.updatedAt.slice(0, 16) }}
              </div></div>
            </div>
            <p class="f-hint dt-empty">文档正文请在「备课中心」对应页面打开校对（审批页只做归属与合规检查）。</p>
          </template>
          <p v-else class="f-hint dt-empty">未关联到文档数据（历史提审单），仅能查看审批信息。</p>
        </template>

        <!-- 视频 -->
        <template v-else>
          <div class="dt-grid">
            <div><div class="d-label">资源类型</div><div class="d-value">视频 / 微课</div></div>
            <div><div class="d-label">学科 / 年级</div><div class="d-value">{{ detail.subject }} · {{ detail.grade }}</div></div>
          </div>
          <p class="f-hint dt-empty">视频正文请在「教辅管理 → 视频」中预览。</p>
        </template>
      </div>

      <!-- AI 检测：结论 + 逐项 + 可采纳的审批意见 -->
      <div v-else class="dt-body">
        <div class="ai-head">
          <button class="btn btn-primary btn-sm" type="button" :disabled="checking" @click="runAiCheck">
            <AppIcon name="sparkles" :size="14" /> {{ checking ? '检测中…' : report ? '重新检测' : '开始检测' }}
          </button>
          <span v-if="report" class="f-hint" style="margin: 0">
            结论来源：{{ report.engine === 'deepseek' ? 'AI 模型' : '本地预检' }}
          </span>
        </div>

        <template v-if="report">
          <div class="ai-checks">
            <div v-for="item in report.items" :key="item.name" class="ai-check" :class="{ bad: !item.pass }">
              <div class="ai-check-head">
                <AppIcon :name="item.pass ? 'check' : 'warning'" :size="14" :class="item.pass ? 'ok' : 'bad'" />
                <span class="ai-check-name">{{ item.name }}</span>
              </div>
              <p class="ai-check-note">{{ item.note }}</p>
            </div>
          </div>

          <h4 class="section-title">AI 审批意见</h4>
          <textarea v-model="report.opinion" class="f-textarea" rows="4" />
          <div class="ai-ops">
            <button class="btn btn-ghost btn-sm" type="button" @click="adoptOpinion">填入审批意见</button>
          </div>
        </template>
        <p v-else class="f-hint dt-empty">
          点「开始检测」：题目走题库质检引擎（逐项校验题干 / 答案 / 解析），其他资源做合规预检
          （信息完整性 · 内容规模 · 命名规范 · 来源与版权），并给出可直接采纳的审批意见。
        </p>
      </div>

      <template #footer>
        <button class="btn btn-ghost" type="button" @click="detailOpen = false">关闭</button>
        <template v-if="detail.status === 'pending'">
          <button class="btn btn-danger" type="button" @click="openReject(detail, true)">驳回</button>
          <button class="btn btn-primary" type="button" @click="openPass(detail, true)">通过</button>
        </template>
      </template>
    </AppModal>

    <!-- 试卷全屏预览：与试卷库「预览」同一个整卷预览（含排版样式 / 答题卡 / 换纸），
         详情弹窗里嵌的那块画布是它的画布部分。 -->
    <PaperPreviewModal
      v-if="paperFullOpen && detailPaper"
      :paper="detailPaper"
      :questions="questions"
      @close="paperFullOpen = false"
    />

    <!-- ================= 通过 ================= -->
    <AppModal v-if="passOpen" title="通过审批" :width="520" @close="passOpen = false">
      <p class="f-hint" style="margin-bottom: 10px">
        《{{ active?.name ?? '' }}》通过后进入{{ active ? RESOURCE_SCOPE_TEXT[active.scope] : '' }}库；
        题目类提审单会将题目的所属对象改为「校本」。
      </p>
      <div class="f-field">
        <label class="f-label">审批意见<span class="f-hint">（选填，默认「同意，予以通过」）</span></label>
        <textarea v-model="opinion" class="f-textarea" rows="4" placeholder="如：环节完整，建议补充分层作业" />
      </div>
      <template #footer>
        <button class="btn btn-ghost" type="button" @click="passOpen = false">取消</button>
        <button class="btn btn-primary" type="button" @click="confirmPass">确认通过</button>
      </template>
    </AppModal>

    <!-- ================= 驳回 ================= -->
    <AppModal v-if="rejectOpen" title="驳回审批" :width="520" @close="rejectOpen = false">
      <p class="f-hint" style="margin-bottom: 10px">
        《{{ active?.name ?? '' }}》驳回后资源保持原状态，意见会推送给申请人 {{ active?.applicant ?? '' }}。
      </p>
      <div class="f-field">
        <label class="f-label">审批意见<span class="req">*</span></label>
        <textarea v-model="opinion" class="f-textarea" rows="4" placeholder="请说明驳回原因（必填）" />
      </div>
      <template #footer>
        <button class="btn btn-ghost" type="button" @click="rejectOpen = false">取消</button>
        <button class="btn btn-danger" type="button" @click="confirmReject">确认驳回</button>
      </template>
    </AppModal>

    <!-- ================= 审批日志 ================= -->
    <AppModal v-if="logOpen && logTarget" title="审批日志" :width="560" @close="logOpen = false">
      <div class="log-head">
        <span class="tag" :class="kindTagClass(logTarget.kind)">{{ logTarget.kind }}</span>
        <b>{{ logTarget.name }}</b>
      </div>
      <div class="log-list">
        <p v-if="!logTarget.logs.length" class="f-hint">暂无日志</p>
        <div v-for="(log, index) in logTarget.logs" :key="index" class="log-row">
          <span class="log-dot" />
          <div>
            <p class="log-main"><b>{{ log.by }}</b> · {{ log.action }} <span class="f-hint">{{ log.at }}</span></p>
            <p v-if="log.note" class="f-hint">{{ log.note }}</p>
          </div>
        </div>
      </div>
      <template #footer>
        <button class="btn btn-ghost" type="button" @click="logOpen = false">关闭</button>
      </template>
    </AppModal>

    <!-- ================= 提交审批 ================= -->
    <AppModal v-if="submitOpen" title="提交资源审批" :width="600" @close="submitOpen = false">
      <div class="f-field row2">
        <div>
          <label class="f-label">资源类型</label>
          <select v-model="submitForm.kind" class="f-select" @change="submitForm.resourceId = 0">
            <option v-for="kind in APPROVAL_KINDS" :key="kind" :value="kind">{{ kind }}</option>
          </select>
        </div>
        <div>
          <label class="f-label">申请范围</label>
          <select v-model="submitForm.scope" class="f-select">
            <option v-for="scope in SCOPE_OPTIONS" :key="scope" :value="scope">{{ RESOURCE_SCOPE_TEXT[scope] }}</option>
          </select>
        </div>
      </div>
      <div class="f-field">
        <label class="f-label">具体资源<span class="req">*</span></label>
        <select v-model="submitForm.resourceId" class="f-select" @change="onResourceChange">
          <option :value="0">请选择{{ submitForm.kind }}</option>
          <option v-for="option in resourceOptions" :key="option.id" :value="option.id">
            {{ option.name }}（{{ option.subject }}·{{ option.grade }}）
          </option>
        </select>
        <p v-if="submitForm.kind === '题目'" class="f-hint" style="margin-top: 6px">
          题目也可以直接在「题库管理」里对个人题点「提交校本」，效果相同。
        </p>
      </div>
      <div class="f-field row2">
        <div>
          <label class="f-label">名称</label>
          <input v-model="submitForm.name" class="f-input" placeholder="随所选资源自动带入" />
        </div>
        <div>
          <label class="f-label">学科</label>
          <select v-model="submitForm.subject" class="f-select">
            <option v-for="subject in subjects" :key="subject" :value="subject">{{ subject }}</option>
          </select>
        </div>
      </div>
      <div class="f-field">
        <label class="f-label">年级</label>
        <select v-model="submitForm.grade" class="f-select">
          <option v-for="grade in grades" :key="grade" :value="grade">{{ grade }}</option>
        </select>
      </div>
      <div class="f-field">
        <label class="f-label">备注<span class="f-hint">（写清来源与用途，AI 预检会据此判断版权风险）</span></label>
        <textarea v-model="submitForm.note" class="f-textarea" placeholder="选填" />
      </div>
      <template #footer>
        <button class="btn btn-ghost" type="button" @click="submitOpen = false">取消</button>
        <button class="btn btn-primary" type="button" :disabled="saving" @click="submitFormNow">
          {{ saving ? '提交中…' : '提交审批' }}
        </button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.approval-page { display: flex; flex-direction: column; gap: 14px; }

/* 顶栏：统计 + 搜索 + 主操作，一行排开 */
.ap-topbar { display: flex; align-items: center; gap: 16px; padding: 10px 16px; }
.ap-counts { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
.ap-count { font-size: 12.5px; color: var(--sub); display: flex; align-items: baseline; gap: 5px; }
.ap-count .num { font-size: 20px; font-weight: 800; line-height: 1; }
.ap-count .num.warn { color: var(--warn); }
.ap-count .num.ok { color: var(--success); }
.ap-divider { width: 1px; height: 18px; background: var(--border); }
.ap-topbar :deep(.list-toolbar) { flex: 1; margin: 0; }

/* 表格：名称列不定宽，其余列固定 */
.table-panel { overflow: hidden; }
.data-table-wrap { overflow: auto; }
.ap-table { table-layout: fixed; min-width: 1140px; }
.ap-name-cell { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.ap-name { font-weight: 600; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ap-scope { font-size: 11.5px; color: var(--sub); }
.ap-meta { font-size: 12.5px; color: var(--ink-2); }
.ap-time { color: var(--sub); white-space: nowrap; font-variant-numeric: tabular-nums; }

/* ===== 详情弹窗 ===== */
.dt-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dt-name { font-size: 15px; font-weight: 700; color: var(--ink); }
.dt-meta {
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  margin-top: 10px; font-size: 12.5px; color: var(--sub);
}
.dt-note, .dt-opinion {
  margin-top: 8px; font-size: 12.5px; color: var(--ink-2); line-height: 1.7;
  background: var(--bg); border-radius: 8px; padding: 8px 12px;
}
.dt-opinion { background: var(--brand-soft); color: var(--brand-deep); }

.dt-tabs { display: flex; gap: 4px; margin: 14px 0 0; border-bottom: 1px solid var(--border); }
.dt-tab {
  border: none; background: none; font-family: inherit; font-size: 13px; font-weight: 600;
  color: var(--sub); padding: 8px 14px; cursor: pointer; border-bottom: 2px solid transparent;
}
.dt-tab.on { color: var(--brand-deep); border-bottom-color: var(--brand); }
.dt-body { padding: 14px 2px 0; max-height: 52vh; overflow-y: auto; }
/* 试卷正文是整卷纸面画布：它自己滚（一页一页），外层不再套一层滚动条 */
.dt-body-paper { max-height: none; overflow: visible; }
/* 试卷正文上方的一行：左侧卷面规模摘要，右侧「全屏预览」入口 */
.dt-paper-bar { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
.dt-canvas { height: min(68vh, 640px); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
.dt-empty { padding: 14px 2px; }
.dt-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 18px; }
.dt-grid .d-label { font-size: 12px; color: var(--sub); }
.dt-grid .d-value { font-size: 13px; color: var(--ink); margin-top: 3px; line-height: 1.6; }
.dt-sections { display: flex; flex-direction: column; gap: 6px; }
.dt-section {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  border: 1px solid var(--border); border-radius: 9px; padding: 8px 12px; font-size: 13px;
}
.dt-sec-title { color: var(--ink); }
.dt-sec-meta { font-size: 12px; color: var(--sub); }

/* ===== AI 检测 ===== */
.ai-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.ai-checks { display: flex; flex-direction: column; gap: 8px; }
.ai-check {
  border-radius: 9px; background: #f7f9fc; padding: 8px 12px;
  display: flex; flex-direction: column; gap: 3px;
}
.ai-check.bad { background: var(--warn-soft); }
.ai-check-head { display: flex; align-items: center; gap: 7px; }
.ai-check-head .ok { color: var(--success); }
.ai-check-head .bad { color: var(--warn); }
.ai-check-name { font-size: 12.5px; font-weight: 700; color: var(--ink); }
.ai-check-note { font-size: 12.5px; color: var(--sub); line-height: 1.65; }
.ai-ops { display: flex; justify-content: flex-end; margin-top: 8px; }

/* ===== 审批日志 ===== */
.log-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
.log-list { display: flex; flex-direction: column; gap: 10px; }
.log-row { display: flex; align-items: flex-start; gap: 10px; }
.log-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--brand); margin-top: 7px; flex-shrink: 0; }
.log-main { font-size: 13px; color: var(--ink); }

.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
</style>
