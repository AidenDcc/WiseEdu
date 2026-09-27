<script setup lang="ts">
/**
 * 校本资源库 + 资源审批（同一页面两个 Tab）。
 *
 * - 审批管理：统计卡（待审/已通过/已驳回）+ 状态筛选 + 审批单列表（撤回 / 通过 / 驳回 / 审批日志）
 *   以及「提交审批」弹窗（按资源类型选具体资源、申请范围）。
 * - 校本资源库：把「已通过审批的资源 + 已发布的讲义课件教案学案 + 已共享广场的试卷」统一成卡片网格，
 *   支持类型 / 学科 / 年级 / 关键字筛选与分页，卡片可跳对应详情页。
 *
 * 当前身份（activeName）为演示用下拉：用于区分「撤回自己的待审单」与「审核他人的单」。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  AppFilterPanel,
  AppIcon,
  AppListToolbar,
  AppPageHeader,
  AppSegmented,
  APPROVAL_STATUS_TEXT,
  RESOURCE_SCOPE_TEXT,
  TEACH_KIND_TEXT,
  showToast,
  truncateRich,
} from '@aiteach/shared'
import type { FilterRowDef } from '@aiteach/shared'
import type {
  ApprovalKind,
  ApprovalStatus,
  OrgPaper,
  OrgQuestion,
  ResourceApproval,
  ResourceScope,
  StaffMember,
  TeachDoc,
  TeachDocKind,
} from '@aiteach/shared'
import AppModal from '@/components/ui/AppModal.vue'
import AppPagination from '@/components/ui/AppPagination.vue'
import {
  fetchApprovalSummary,
  fetchApprovals,
  fetchPapers,
  fetchQuestions,
  fetchStaff,
  fetchTeachDocs,
  reviewApproval,
  revokeApproval,
  submitApproval,
} from '@/api/org'
import { useBaseData } from '@/composables/useBaseData'

const router = useRouter()
const { subjects, grades, ensure, pick } = useBaseData()
const errMsg = (e: unknown) => (e instanceof Error ? e.message : '操作失败')

type Tab = 'approval' | 'library'
/* 路由以 props 指定初始 Tab：菜单里「校本资源库」与「审批管理」是两个入口，
   进哪个就该停在哪个 Tab 上，否则点「校本资源库」却看到审批列表会让人以为走错了。 */
const props = withDefaults(defineProps<{ tab?: Tab }>(), { tab: 'approval' })
/* 用 string 承载：AppSegmented 的 modelValue 是 string，v-model 回写才不会类型冲突 */
const tab = ref<string>(props.tab)

/** 顶部 Tab（互斥分段控件） */
const TAB_OPTIONS = [
  { value: 'approval', label: '审批管理', icon: 'clipboard' },
  { value: 'library', label: '校本资源库', icon: 'folder' },
]

/* ================= 审批管理 ================= */
const summary = ref({ pending: 0, approved: 0, rejected: 0 })
const approvals = ref<ResourceApproval[]>([])
const statusFilter = ref<'' | ApprovalStatus>('')
const staffList = ref<StaffMember[]>([])
const activeName = ref('')

/** 审批单状态筛选行（单选：点已选项即回到「全部」） */
const APPROVAL_FILTER_ROWS: FilterRowDef[] = [
  { key: 'status', label: '状态', options: Object.values(APPROVAL_STATUS_TEXT), multiple: false },
]

/** chip 上是文案，落回接口要的业务值 */
function statusKeyOf(text: string): '' | ApprovalStatus {
  return (Object.keys(APPROVAL_STATUS_TEXT) as ApprovalStatus[]).find((k) => APPROVAL_STATUS_TEXT[k] === text) ?? ''
}

const approvalFilters = computed<Record<string, string[]>>(() => ({
  status: statusFilter.value ? [APPROVAL_STATUS_TEXT[statusFilter.value]] : [],
}))

function onApprovalFiltersChange(next: Record<string, string[]>) {
  statusFilter.value = statusKeyOf(next.status?.[0] ?? '')
}

const scopeTagClass = (s: ApprovalStatus) =>
  s === 'approved' ? 'tag-green' : s === 'rejected' ? 'tag-red' : 'tag-orange'

const kindTagClass = (kind: string) =>
  kind === '题目' || kind === '试卷' ? 'tag-gray' : kind === '视频' ? 'tag-green' : 'tag-blue'

async function loadApprovalSummary() {
  summary.value = await fetchApprovalSummary()
}
async function loadApprovals() {
  approvals.value = await fetchApprovals(statusFilter.value || undefined)
}
async function reloadApprovalTab() {
  await Promise.all([loadApprovalSummary(), loadApprovals()])
}

const expandLogId = ref<number | null>(null)
function toggleLog(id: number) {
  expandLogId.value = expandLogId.value === id ? null : id
}

async function onRevoke(a: ResourceApproval) {
  if (!window.confirm(`撤回审批单《${a.name}》？`)) return
  try {
    await revokeApproval(a.id)
    await reloadApprovalTab()
    showToast('已撤回', 'success')
  } catch (e) {
    showToast(errMsg(e), 'error')
  }
}

/* 通过：意见选填，留一条「同意」也能让审批日志有据可查 */
const passOpen = ref(false)
const passId = ref(0)
const passOpinion = ref('')
function openPass(a: ResourceApproval) {
  passId.value = a.id
  passOpinion.value = ''
  passOpen.value = true
}
async function onPassConfirm() {
  try {
    await reviewApproval(passId.value, true, passOpinion.value.trim() || '同意，予以通过')
    passOpen.value = false
    await reloadApprovalTab()
    showToast('已通过', 'success')
  } catch (e) {
    showToast(errMsg(e), 'error')
  }
}

/* 驳回 */
const rejectOpen = ref(false)
const rejectId = ref(0)
const rejectOpinion = ref('')
function openReject(a: ResourceApproval) {
  rejectId.value = a.id
  rejectOpinion.value = ''
  rejectOpen.value = true
}
async function onRejectConfirm() {
  if (!rejectOpinion.value.trim()) {
    showToast('驳回必须填写审批意见', 'error')
    return
  }
  try {
    await reviewApproval(rejectId.value, false, rejectOpinion.value.trim())
    rejectOpen.value = false
    await reloadApprovalTab()
    showToast('已驳回', 'success')
  } catch (e) {
    showToast(errMsg(e), 'error')
  }
}

/* 提交审批 */
const submitOpen = ref(false)
const saving = ref(false)
const questions = ref<OrgQuestion[]>([])
const papers = ref<OrgPaper[]>([])
const docs = ref<TeachDoc[]>([])

const VIDEO_OPTIONS = [
  { id: 90001, name: '微课·函数的单调性（概念引入）', subject: '数学', grade: '高一' },
  { id: 90002, name: '微课·牛顿第一定律实验演示', subject: '物理', grade: '高一' },
  { id: 90003, name: '微课·细胞呼吸全过程', subject: '生物', grade: '高二' },
]
const APPROVAL_KINDS: ApprovalKind[] = ['题目', '试卷', '讲义', '课件', '教案', '学案', '视频']
const SCOPE_OPTIONS: ResourceScope[] = ['group', 'school', 'public']

const submitForm = reactive({
  kind: '题目' as ApprovalKind,
  resourceId: 0,
  name: '',
  subject: '数学',
  grade: '高一',
  scope: 'group' as ResourceScope,
  note: '',
})

const resourceOptions = computed<Array<{ id: number; name: string; subject: string; grade: string }>>(() => {
  switch (submitForm.kind) {
    case '题目':
      return questions.value.map((q) => ({ id: q.id, name: truncateRich(q.stem, 48), subject: q.subject, grade: q.grade }))
    case '试卷':
      return papers.value.map((p) => ({ id: p.id, name: p.name, subject: p.subject, grade: p.grade }))
    case '视频':
      return VIDEO_OPTIONS.map((v) => ({ id: v.id, name: v.name, subject: v.subject, grade: v.grade }))
    default: {
      const want = TEACH_KIND_TEXT[(submitForm.kind === '讲义' ? 'lecture' : submitForm.kind === '课件' ? 'courseware' : submitForm.kind === '教案' ? 'plan' : 'guide') as TeachDocKind]
      return docs.value
        .filter((d) => TEACH_KIND_TEXT[d.kind] === want)
        .map((d) => ({ id: d.id, name: d.name, subject: d.subject, grade: d.grade }))
    }
  }
})

async function openSubmit() {
  if (!questions.value.length) questions.value = await fetchQuestions()
  if (!papers.value.length) papers.value = await fetchPapers()
  if (!docs.value.length) {
    const kinds: TeachDocKind[] = ['lecture', 'courseware', 'plan', 'guide']
    docs.value = (await Promise.all(kinds.map((k) => fetchTeachDocs(k)))).flat()
  }
  submitForm.kind = '题目'
  submitForm.resourceId = 0
  submitForm.name = ''
  submitForm.subject = pick(subjects.value, '数学')
  submitForm.grade = pick(grades.value, '高一')
  submitForm.scope = 'group'
  submitForm.note = ''
  submitOpen.value = true
}
function onResourceChange() {
  const opt = resourceOptions.value.find((o) => o.id === submitForm.resourceId)
  if (opt) {
    submitForm.name = opt.name
    submitForm.subject = opt.subject
    submitForm.grade = opt.grade
  }
}
async function submitApprovalForm() {
  if (!submitForm.name.trim()) {
    showToast('请先选择要提审的具体资源', 'error')
    return
  }
  if (!submitForm.subject || !submitForm.grade) {
    showToast('资源缺少学科 / 年级信息', 'error')
    return
  }
  saving.value = true
  try {
    await submitApproval({
      kind: submitForm.kind,
      name: submitForm.name.trim(),
      subject: submitForm.subject,
      grade: submitForm.grade,
      scope: submitForm.scope,
      note: submitForm.note.trim() || undefined,
    })
    submitOpen.value = false
    await reloadApprovalTab()
    showToast('审批单已提交', 'success')
  } catch (e) {
    showToast(errMsg(e), 'error')
  } finally {
    saving.value = false
  }
}

/* ================= 校本资源库 ================= */
interface LibItem {
  kind: string
  name: string
  subject: string
  grade: string
  scope: ResourceScope
  uploader: string
  time: string
  id: number
  docKind?: TeachDocKind
  paper?: boolean
}
const libFilter = reactive({ type: '', subject: '', grade: '', keyword: '' })
const libPage = ref(1)

/** 校本资源库筛选行（学科 / 年级是字典，需等基础数据就绪，故用 computed） */
const libFilterRows = computed<FilterRowDef[]>(() => [
  { key: 'type', label: '类型', options: [...APPROVAL_KINDS], multiple: false },
  { key: 'subject', label: '学科', options: subjects.value, multiple: false },
  { key: 'grade', label: '年级', options: grades.value, multiple: false },
])

const libFilters = computed<Record<string, string[]>>(() => ({
  type: libFilter.type ? [libFilter.type] : [],
  subject: libFilter.subject ? [libFilter.subject] : [],
  grade: libFilter.grade ? [libFilter.grade] : [],
}))

function onLibFiltersChange(next: Record<string, string[]>) {
  libFilter.type = next.type?.[0] ?? ''
  libFilter.subject = next.subject?.[0] ?? ''
  libFilter.grade = next.grade?.[0] ?? ''
}

const library = computed<LibItem[]>(() => {
  const items: LibItem[] = []
  for (const a of approvals.value) {
    if (a.status !== 'approved') continue
    items.push({
      kind: a.kind,
      name: a.name,
      subject: a.subject,
      grade: a.grade,
      scope: a.scope,
      uploader: a.applicant,
      time: a.reviewedAt ?? a.submittedAt,
      id: a.id,
    })
  }
  for (const d of docs.value) {
    if (d.status !== 'published') continue
    items.push({
      kind: TEACH_KIND_TEXT[d.kind],
      name: d.name,
      subject: d.subject,
      grade: d.grade,
      scope: 'school',
      uploader: d.owner,
      time: d.updatedAt,
      id: d.id,
      docKind: d.kind,
    })
  }
  for (const p of papers.value) {
    if (!p.sharedSquare) continue
    items.push({
      kind: '试卷',
      name: p.name,
      subject: p.subject,
      grade: p.grade,
      scope: 'public',
      uploader: p.owner,
      time: p.updatedAt,
      id: p.id,
      paper: true,
    })
  }
  return items
})

const libFiltered = computed(() =>
  library.value.filter(
    (row) =>
      (!libFilter.type || row.kind === libFilter.type) &&
      (!libFilter.subject || row.subject === libFilter.subject) &&
      (!libFilter.grade || row.grade === libFilter.grade) &&
      (!libFilter.keyword || row.name.includes(libFilter.keyword)),
  ),
)
const libRows = computed(() => libFiltered.value.slice((libPage.value - 1) * 12, libPage.value * 12))

function viewResource(item: LibItem) {
  if (item.paper) return router.push('/paper/list')
  if (item.docKind) return router.push(`/teach/${item.docKind}?id=${item.id}`)
  if (item.kind === '题目') return router.push('/question/bank')
  return router.push('/square')
}

/* ================= 数据 ================= */
async function loadLibraryData() {
  if (!docs.value.length) {
    const kinds: TeachDocKind[] = ['lecture', 'courseware', 'plan', 'guide']
    docs.value = (await Promise.all(kinds.map((k) => fetchTeachDocs(k)))).flat()
  }
  if (!papers.value.length) papers.value = await fetchPapers()
}

onMounted(async () => {
  try {
    await ensure()
    if (!staffList.value.length) staffList.value = (await fetchStaff()).list
    activeName.value = staffList.value[0]?.name ?? ''
    await Promise.all([reloadApprovalTab(), loadLibraryData()])
  } catch (e) {
    showToast(errMsg(e), 'error')
  }
})

watch(tab, (t) => {
  if (t === 'approval') void reloadApprovalTab()
})
watch(statusFilter, () => void loadApprovals())
</script>

<template>
  <div class="page">
    <AppPageHeader desc="资源从个人逐级提审至校本 / 公开；通过审批的资源与已发布备课文档统一沉淀为校本资源库。" />

    <AppSegmented v-model="tab" :options="TAB_OPTIONS" />

    <!-- ================= 审批管理 ================= -->
    <template v-if="tab === 'approval'">
      <AppFilterPanel
        :model-value="approvalFilters"
        :rows="APPROVAL_FILTER_ROWS"
        @update:model-value="onApprovalFiltersChange"
      />
      <div class="panel">
        <div class="rv-stats">
          <div class="rv-stat">
            <span class="rv-stat-num" style="color: var(--warn)">{{ summary.pending }}</span>
            <span class="rv-stat-label">待审批</span>
          </div>
          <div class="rv-stat">
            <span class="rv-stat-num" style="color: var(--success)">{{ summary.approved }}</span>
            <span class="rv-stat-label">已通过</span>
          </div>
          <div class="rv-stat">
            <span class="rv-stat-num" style="color: var(--danger)">{{ summary.rejected }}</span>
            <span class="rv-stat-label">已驳回</span>
          </div>
          <div class="rv-stats-ops">
            <span class="f-hint">当前身份</span>
            <select v-model="activeName" class="f-select">
              <option v-for="s in staffList" :key="s.id" :value="s.name">{{ s.name }}</option>
            </select>
            <button class="btn btn-primary btn-sm" @click="openSubmit"><AppIcon name="plus" :size="14" /> 提交审批</button>
          </div>
        </div>

        <div class="rv-approval-list">
          <p v-if="!approvals.length" class="empty-row">暂无审批单</p>
          <div v-for="a in approvals" :key="a.id" class="rv-ap">
            <div class="rv-ap-main">
              <div class="rv-ap-top">
                <span class="tag" :class="kindTagClass(a.kind)">{{ a.kind }}</span>
                <b class="rv-ap-name">{{ a.name }}</b>
                <span class="tag" :class="scopeTagClass(a.status)">{{ APPROVAL_STATUS_TEXT[a.status] }}</span>
              </div>
              <p class="f-hint">
                {{ a.grade }} · {{ a.subject }} · 申请人 {{ a.applicant }} · 提交 {{ a.submittedAt }}
                <template v-if="a.status !== 'pending'"> · 审核人 {{ a.reviewer }} · {{ a.reviewedAt }}</template>
              </p>
              <p v-if="a.status !== 'pending' && a.opinion" class="rv-ap-opinion">审批意见：{{ a.opinion }}</p>
            </div>
            <div class="rv-ap-ops">
              <button
                v-if="a.status === 'pending' && a.applicant === activeName"
                class="mini-btn"
                @click="onRevoke(a)"
              >
                撤回
              </button>
              <button
                v-if="a.status === 'pending'"
                class="mini-btn success"
                @click="openPass(a)"
              >
                通过
              </button>
              <button
                v-if="a.status === 'pending'"
                class="mini-btn danger"
                @click="openReject(a)"
              >
                驳回
              </button>
              <button class="mini-btn" @click="toggleLog(a.id)">
                {{ expandLogId === a.id ? '收起日志' : '审批日志' }}
              </button>
            </div>

            <div v-if="expandLogId === a.id" class="rv-log">
              <p v-if="!a.logs.length" class="f-hint">暂无日志</p>
              <div v-for="(log, i) in a.logs" :key="i" class="rv-log-row">
                <span class="rv-log-dot" />
                <div>
                  <p><b>{{ log.by }}</b> · {{ log.action }} <span class="f-hint">{{ log.at }}</span></p>
                  <p v-if="log.note" class="f-hint">{{ log.note }}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- ================= 校本资源库 ================= -->
    <template v-else>
      <AppFilterPanel
        :model-value="libFilters"
        :rows="libFilterRows"
        @update:model-value="onLibFiltersChange"
      />

      <div class="panel">
        <AppListToolbar v-model="libFilter.keyword" placeholder="资源名称" class="rv-toolbar" />

        <div class="rv-grid">
          <p v-if="!libRows.length" class="empty-row" style="grid-column: 1 / -1">
            暂无校本资源，通过审批的资源与已发布备课文档会在此沉淀
          </p>
          <div v-for="item in libRows" :key="`${item.kind}-${item.id}`" class="rv-card">
            <div class="rv-card-top">
              <span class="tag" :class="kindTagClass(item.kind)">{{ item.kind }}</span>
              <span class="tag" :class="item.scope === 'public' ? 'tag-green' : 'tag-blue'">
                {{ RESOURCE_SCOPE_TEXT[item.scope] }}
              </span>
            </div>
            <h3 class="rv-card-name">{{ item.name }}</h3>
            <p class="rv-card-meta">{{ item.grade }} · {{ item.subject }}</p>
            <p class="rv-card-foot">{{ item.uploader }} · {{ item.time }}</p>
            <div class="op-group">
              <button class="mini-btn" @click="viewResource(item)">查看</button>
            </div>
          </div>
        </div>
        <AppPagination :total="libFiltered.length" v-model:page="libPage" :page-size="12" />
      </div>
    </template>

    <!-- 通过确认（意见选填） -->
    <AppModal v-if="passOpen" title="通过审批单" :width="460" @close="passOpen = false">
      <div class="f-field">
        <label class="f-label">审批意见<span class="f-hint">（选填，默认「同意，予以通过」）</span></label>
        <textarea v-model="passOpinion" class="f-textarea" placeholder="如：环节完整，建议补充分层作业" />
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="passOpen = false">取消</button>
        <button class="btn btn-primary" @click="onPassConfirm">确认通过</button>
      </template>
    </AppModal>

    <!-- 驳回确认 -->
    <AppModal v-if="rejectOpen" title="驳回审批单" :width="460" @close="rejectOpen = false">
      <div class="f-field">
        <label class="f-label">审批意见<span class="req">*</span></label>
        <textarea v-model="rejectOpinion" class="f-textarea" placeholder="请说明驳回原因（必填）" />
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="rejectOpen = false">取消</button>
        <button class="btn btn-danger" @click="onRejectConfirm">确认驳回</button>
      </template>
    </AppModal>

    <!-- 提交审批 -->
    <AppModal v-if="submitOpen" title="提交资源审批" :width="600" @close="submitOpen = false">
      <div class="f-field row2">
        <div>
          <label class="f-label">资源类型</label>
          <select v-model="submitForm.kind" class="f-select">
            <option v-for="k in APPROVAL_KINDS" :key="k" :value="k">{{ k }}</option>
          </select>
        </div>
        <div>
          <label class="f-label">申请范围</label>
          <select v-model="submitForm.scope" class="f-select">
            <option v-for="s in SCOPE_OPTIONS" :key="s" :value="s">{{ RESOURCE_SCOPE_TEXT[s] }}</option>
          </select>
        </div>
      </div>
      <div class="f-field">
        <label class="f-label">具体资源<span class="req">*</span></label>
        <select v-model="submitForm.resourceId" class="f-select" @change="onResourceChange">
          <option :value="0">请选择{{ submitForm.kind }}</option>
          <option v-for="o in resourceOptions" :key="o.id" :value="o.id">{{ o.name }}（{{ o.subject }}·{{ o.grade }}）</option>
        </select>
      </div>
      <div class="f-field row2">
        <div>
          <label class="f-label">名称</label>
          <input v-model="submitForm.name" class="f-input" placeholder="随所选资源自动带入" />
        </div>
        <div>
          <label class="f-label">学科</label>
          <select v-model="submitForm.subject" class="f-select">
            <option v-for="s in subjects" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
      </div>
      <div class="f-field">
        <label class="f-label">年级</label>
        <select v-model="submitForm.grade" class="f-select">
          <option v-for="g in grades" :key="g" :value="g">{{ g }}</option>
        </select>
      </div>
      <div class="f-field">
        <label class="f-label">备注</label>
        <textarea v-model="submitForm.note" class="f-textarea" placeholder="选填" />
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="submitOpen = false">取消</button>
        <button class="btn btn-primary" :disabled="saving" @click="submitApprovalForm">{{ saving ? '提交中…' : '提交审批' }}</button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.rv-stats { display: flex; align-items: center; gap: 14px; padding: 16px 18px; border-bottom: 1px solid var(--border); }
.rv-stat { display: flex; flex-direction: column; align-items: center; min-width: 84px; }
.rv-stat-num { font-size: 26px; font-weight: 800; line-height: 1.1; }
.rv-stat-label { font-size: 12px; color: var(--sub); margin-top: 2px; }
.rv-stats-ops { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.rv-stats-ops .f-select { width: auto; min-width: 118px; flex-shrink: 0; height: var(--ctrl-h); }

.rv-approval-list { display: flex; flex-direction: column; }
.rv-ap {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 14px 18px; border-bottom: 1px solid #f1f3f8;
}
.rv-ap:last-child { border-bottom: none; }
.rv-ap-main { flex: 1; min-width: 0; }
.rv-ap-top { display: flex; align-items: center; gap: 8px; }
.rv-ap-name { font-size: 14px; font-weight: 700; }
.rv-ap-opinion { font-size: 12.5px; color: var(--ink-2); margin-top: 5px; }
.rv-ap-ops { display: flex; align-items: center; gap: 4px; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; }

.rv-log { margin-top: 10px; padding: 10px 12px; background: #f8fafd; border-radius: 10px; }
.rv-log-row { display: flex; align-items: flex-start; gap: 10px; padding: 4px 0; }
.rv-log-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--brand); margin-top: 6px; flex-shrink: 0; }

/* 面板自身不留白：工具条 / 网格各自带内边距，分页组件自带内边距 */
.rv-toolbar { padding: 14px 16px 0; margin-bottom: 0; }
.rv-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; padding: 14px 16px 4px; }
.rv-card {
  border: 1.5px solid var(--border); border-radius: 12px;
  padding: 14px; display: flex; flex-direction: column; gap: 8px;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.rv-card:hover { border-color: var(--brand); box-shadow: var(--shadow); }
.rv-card-top { display: flex; align-items: center; gap: 6px; }
.rv-card-name { font-size: 14px; font-weight: 700; line-height: 1.5; }
.rv-card-meta { font-size: 12px; color: var(--sub); }
.rv-card-foot { font-size: 11.5px; color: var(--sub); }

.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
</style>
