<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { AppIcon, AppModal, QUESTION_STATUS_TEXT, appConfirm, showToast, toPlainText, truncateRich } from '@aiteach/shared'
import type { AiCheckResult, OrgQuestion, StaffMember } from '@aiteach/shared'
import { fetchQuestions, fetchStaff, reviewQuestion } from '@/api/org'
import { checkQuestionByAi } from '@/api/ai-check'
import type { AiCheckItem } from '@/api/ai-check'
import QuestionPreviewBody from '@/components/question/QuestionPreviewBody.vue'

const all = ref<OrgQuestion[]>([])
const opinion = ref('')
const busy = ref(false)
const checking = ref(false)

/** 待人工终审队列（AI 校验完成 → pending；FR-AI-006 / FR-TM-021） */
const pending = computed(() => all.value.filter((row) => row.status === 'pending'))
/** 已审记录（历史审核记录弹窗用）：按审核时间倒序，最近审的排最前 */
const reviewed = computed(() =>
  all.value
    .filter((row) => row.status === 'approved' || row.status === 'rejected')
    .sort((a, b) => (b.reviewedAt ?? b.updatedAt).localeCompare(a.reviewedAt ?? a.updatedAt)),
)
/** 弹窗里只铺最近 50 条（全量铺开会渲染几百行 DOM） */
const reviewedRecent = computed(() => reviewed.value.slice(0, 50))

const activeId = ref(0)
const active = computed(() => pending.value.find((row) => row.id === activeId.value) ?? pending.value[0] ?? null)

const passedCount = computed(() => active.value?.aiChecks?.filter((row) => row.pass).length ?? 0)
/** 疑点清单 = 未通过的检测项（项目名 + 说明，与检测报告同一数据源） */
const issueChecks = computed(() => (active.value?.aiChecks ?? []).filter((row) => !row.pass))
/** 右栏三个区块都可点标题折叠：检测报告默认收起，疑点清单 / 终审意见默认展开 */
const checksOpen = ref(false)
const suspectsOpen = ref(true)
const opinionOpen = ref(true)

/** 转审：选择审核人后转交（员工管理里角色为「审核员」且启用的人） */
const transferOpen = ref(false)
const staff = ref<StaffMember[]>([])
const transferPick = ref<number | null>(null)
const reviewers = computed(() => staff.value.filter((row) => row.enabled && row.role === '审核员'))

/** 历史审核记录（题目列表 + 审核信息） */
const historyOpen = ref(false)

async function load() {
  all.value = await fetchQuestions()
}

function pick(row: OrgQuestion) {
  activeId.value = row.id
  opinion.value = ''
}

/** 终审通过 / 驳回（FR-TM-022：驳回意见必填 ≥5 字；提交前二次确认防误触） */
async function decide(pass: boolean) {
  if (!active.value) return
  if (!pass && opinion.value.trim().length < 5) {
    showToast('驳回意见不能少于 5 个字', 'error')
    return
  }
  const ok = await appConfirm(
    pass
      ? `确认通过《${truncateRich(active.value.stem, 18)}》？通过后题目将进入机构正式题库。`
      : `确认驳回《${truncateRich(active.value.stem, 18)}》？驳回意见将推送给作者（${active.value.owner}）。`,
    { title: pass ? '终审通过' : '终审驳回', type: pass ? 'info' : 'danger', confirmText: pass ? '通过' : '驳回' },
  )
  if (!ok) return
  busy.value = true
  try {
    const updated = await reviewQuestion(active.value.id, pass, opinion.value.trim())
    const pos = all.value.findIndex((row) => row.id === updated.id)
    if (pos >= 0) all.value[pos] = updated
    showToast(pass ? '已通过，题目入机构正式题库' : '已驳回，意见已推送作者', 'success')
    opinion.value = ''
    const next = pending.value[0]
    if (next) activeId.value = next.id
  } catch (error) {
    showToast(error instanceof Error ? error.message : '操作失败', 'error')
  } finally {
    busy.value = false
  }
}

async function openTransfer() {
  if (!active.value) return
  transferPick.value = null
  transferOpen.value = true
  if (!staff.value.length) staff.value = (await fetchStaff()).list
}

function confirmTransfer() {
  const target = reviewers.value.find((row) => row.id === transferPick.value)
  if (!target) return
  transferOpen.value = false
  transferPick.value = null
  showToast(`已转交给审核员「${target.name}」，消息已送达`, 'success')
}

/* 质检引擎维度 → 多智能体报告项（FR-AI-002，8 项框架两边同名）：
   「基本信息匹配」→「基础信息匹配」改名对齐；「选项」检查并入「题干」（题干项含选项完整性 / 歧义检查）。
   引擎覆盖不到的（知识点匹配 / 图形描述 / 难度匹配 / 查重）沿用上次结论并标注。 */
const ASPECT_TO_CHECK: Record<string, string> = {
  基本信息匹配: '基础信息匹配',
  题干: '题干',
  选项: '题干',
  答案: '答案',
  解析: '解析',
}
const KEEP_TAG = '（本次未复检，沿用上次）'

/** 未通过检测项拼成终审意见文案（检测后自动预填用；驳回意见 ≥5 字的要求天然满足）。
 *  结构化分行：首行结论 + 每个问题一行；去掉沿用标注与句尾标点，避免出现「。。」 */
function aiOpinionText(row: OrgQuestion): string {
  const issues = (row.aiChecks ?? []).filter((item) => !item.pass)
  if (!issues.length) return ''
  const lines = issues.map(
    (item, index) => `${index + 1}）${item.name}：${item.note.replace(KEEP_TAG, '').replace(/[。；;，,\s]+$/, '')}`,
  )
  return [`AI 检测发现 ${issues.length} 处待修改问题，请作者修改后重新提交：`, ...lines].join('\n')
}

/** 引擎结果合并进既有 8 项报告：按项目名原位更新（同项多次命中时全过才算过、说明拼接），
 *  框架外的新维度追加尾部；重复检测幂等，不会重复追加也不会叠加标注 */
function mergeChecks(row: OrgQuestion, items: AiCheckItem[]): AiCheckResult[] {
  const original = row.aiChecks ?? []
  const grouped = new Map<string, AiCheckItem[]>()
  for (const item of items) {
    const target = ASPECT_TO_CHECK[item.aspect] ?? item.aspect
    grouped.set(target, [...(grouped.get(target) ?? []), item])
  }
  const refreshed = new Map<string, AiCheckResult>()
  for (const [name, group] of grouped) {
    refreshed.set(name, {
      name,
      pass: group.every((item) => item.level === 'ok'),
      /* 每条消息先去句尾标点再拼接，避免「。；」连缀（题干 + 选项两项命中同一检测项时） */
      note: group.map((item) => item.message.replace(/[。；;，,\s]+$/, '')).join('；'),
    })
  }
  const known = new Set(original.map((check) => check.name))
  const appended = [...refreshed.entries()].filter(([name]) => !known.has(name)).map(([, check]) => check)
  return [
    ...original.map((check) =>
      refreshed.has(check.name)
        ? refreshed.get(check.name)!
        : { ...check, note: check.note.endsWith(KEEP_TAG) ? check.note : `${check.note}${KEEP_TAG}` },
    ),
    ...appended,
  ]
}

/** 对当前题目重新跑一次 AI 多智能体检测，报告就地刷新（真实引擎未配置时为本地演示口径）。
 *  检测发现待修改问题时，若终审意见还是空的，直接把 AI 意见预填进去（已有手写内容则不覆盖）。 */
async function recheck() {
  if (!active.value || checking.value) return
  checking.value = true
  try {
    const row = active.value
    const report = await checkQuestionByAi({
      subject: row.subject,
      grade: row.grade,
      type: row.type,
      difficulty: row.difficulty,
      knowledge: [...row.knowledge],
      stem: row.stem,
      options: row.options,
      answer: row.answer,
      analysis: row.analysis,
    })
    row.aiChecks = mergeChecks(row, report.items)
    const engineText = report.engine === 'deepseek' ? '真实引擎' : '本地演示引擎'
    if (row.aiChecks.some((item) => !item.pass)) {
      if (!opinion.value.trim()) {
        opinion.value = aiOpinionText(row)
        showToast(`AI 检测（${engineText}）发现待修改问题，意见已填入终审意见`, 'warning')
      } else {
        showToast(`AI 检测（${engineText}）发现待修改问题，详见疑点清单`, 'warning')
      }
    } else {
      showToast(`AI 检测完成（${engineText}），未发现问题`, 'success')
    }
  } catch (error) {
    showToast(error instanceof Error ? error.message : '检测失败', 'error')
  } finally {
    checking.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="review-layout">
    <!-- 左：待审队列 -->
    <div class="panel queue-panel">
      <div class="section-title">待终审队列（{{ pending.length }}）</div>
      <div class="queue-list">
        <p v-if="pending.length === 0" class="f-hint" style="padding: 12px">队列已清空 🎉</p>
        <button
          v-for="row in pending"
          :key="row.id"
          class="queue-item"
          :class="{ on: active?.id === row.id }"
          type="button"
          @click="pick(row)"
        >
          <span class="qi-top">
            <span class="tag tag-blue">#{{ row.id }}</span>
            <span class="tag tag-gray">{{ row.type }}</span>
            <span class="tag" :class="row.source === '拍照识别' ? 'tag-orange' : 'tag-gray'">{{ row.source }}</span>
          </span>
          <span class="qi-stem">{{ truncateRich(row.stem, 46) }}…</span>
          <span class="qi-meta">{{ row.owner }} · {{ row.subject }} {{ row.grade }}</span>
        </button>
      </div>
      <button class="btn btn-ghost btn-sm history-btn" type="button" style="margin-top: 14px" @click="historyOpen = true">
        <AppIcon name="clock" :size="14" /> 历史审核记录（{{ reviewed.length }}）
      </button>
    </div>

    <!-- 中：题目详情（与题库管理的「题目预览」抽屉共用同一份正文组件，两处 UI 一致） -->
    <div class="panel preview-panel">
      <template v-if="active">
        <header class="pv-head">
          <h3 class="pv-title">题目 #{{ active.id }}</h3>
          <span class="pv-sub">学生视角预览</span>
        </header>
        <QuestionPreviewBody :question="active" />
      </template>
      <p v-else class="f-hint" style="padding: 30px">暂无待审题目</p>
    </div>

    <!-- 右：AI 检测报告 + 终审操作（FR-AI-001 ~ 006） -->
    <div class="panel report-panel">
      <template v-if="active">
        <div class="section-title sec-toggle" @click="checksOpen = !checksOpen">
          AI 多智能体检测（{{ passedCount }}/{{ active.aiChecks?.length ?? 0 }} 通过）
          <AppIcon class="sec-arrow" :name="checksOpen ? 'chevron-up' : 'chevron-down'" :size="14" />
        </div>
        <div v-show="checksOpen" class="check-list">
          <div v-for="check in active.aiChecks ?? []" :key="check.name" class="check-row" :class="{ bad: !check.pass }">
            <div class="ck-head">
              <AppIcon :name="check.pass ? 'check' : 'warning'" :size="14" :class="check.pass ? 'ok' : 'bad'" />
              <span class="ck-name">{{ check.name }}</span>
            </div>
            <p class="ck-note">
              {{ check.note }}<template v-if="check.fixed">（已自动纠错 → {{ check.fixed }}）</template>
            </p>
          </div>
        </div>

        <div class="section-title sec-toggle" style="margin-top: 12px" @click="suspectsOpen = !suspectsOpen">
          疑点清单（{{ issueChecks.length }}）
          <AppIcon class="sec-arrow" :name="suspectsOpen ? 'chevron-up' : 'chevron-down'" :size="14" />
        </div>
        <template v-if="suspectsOpen">
          <div v-for="check in issueChecks" :key="check.name" class="suspect-row">
            <div class="sp-head">
              <AppIcon name="warning" :size="13" />
              <span class="sp-name">{{ check.name }}</span>
            </div>
            <p class="sp-desc">{{ check.note }}</p>
          </div>
          <p v-if="!issueChecks.length" class="f-hint" style="padding: 2px 0 6px">检测全部通过，暂无疑点</p>
        </template>

        <div class="section-title sec-toggle" style="margin-top: 14px" @click="opinionOpen = !opinionOpen">
          终审意见
          <AppIcon class="sec-arrow" :name="opinionOpen ? 'chevron-up' : 'chevron-down'" :size="14" />
        </div>
        <textarea
          v-show="opinionOpen"
          v-model="opinion"
          class="f-textarea"
          rows="3"
          :placeholder="active.status === 'rejected' ? active.reviewOpinion : '驳回时必填 ≥5 字；通过时选填'"
        />
        <div class="decide-ops">
          <button class="btn btn-primary btn-sm" :disabled="busy" @click="decide(true)">通过</button>
          <button class="btn btn-danger btn-sm" :disabled="busy" @click="decide(false)">驳回</button>
          <button class="btn btn-ghost btn-sm" :disabled="busy" @click="openTransfer">转审</button>
          <button class="btn btn-ghost btn-sm" :disabled="checking" @click="recheck">{{ checking ? '检测中…' : 'AI检测' }}</button>
        </div>
      </template>
      <p v-else class="f-hint" style="padding: 30px">选择左侧题目开始终审</p>
    </div>

    <!-- 转审：选择审核人 -->
    <AppModal v-if="transferOpen" title="转审 — 选择审核人" :width="420" @close="transferOpen = false">
      <p class="f-hint" style="margin-bottom: 10px">
        题目 #{{ active?.id }}《{{ truncateRich(active?.stem ?? '', 18) }}》将转入所选审核员的待审队列，并送达转交消息。
      </p>
      <div class="reviewer-list">
        <button
          v-for="row in reviewers"
          :key="row.id"
          class="reviewer-item"
          :class="{ on: transferPick === row.id }"
          type="button"
          @click="transferPick = row.id"
        >
          <span class="rvr-avatar">{{ row.name.charAt(0) }}</span>
          <span class="rvr-meta">
            <b>{{ row.name }}</b>
            <i>{{ row.campus }} · 待审 {{ row.pendingReviews }} 题</i>
          </span>
          <AppIcon v-if="transferPick === row.id" class="rvr-check" name="check" :size="16" />
        </button>
        <p v-if="!reviewers.length" class="f-hint">暂无可转交的审核员（员工管理中角色为「审核员」且启用）</p>
      </div>
      <template #footer>
        <button class="btn btn-ghost" type="button" @click="transferOpen = false">取消</button>
        <button class="btn btn-primary" type="button" :disabled="!transferPick" @click="confirmTransfer">确认转交</button>
      </template>
    </AppModal>

    <!-- 历史审核记录：题目列表 + 审核信息 -->
    <AppModal v-if="historyOpen" title="历史审核记录" :width="760" @close="historyOpen = false">
      <table v-if="reviewedRecent.length" class="history-table">
        <thead>
          <tr>
            <th>题目</th>
            <th>结果</th>
            <th>终审意见</th>
            <th>审核人 / 时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in reviewedRecent" :key="row.id">
            <td>
              <div class="ht-q">
                <span class="tag tag-blue">#{{ row.id }}</span>
                <span class="tag tag-gray">{{ row.type }}</span>
                <span class="ht-stem" :title="toPlainText(row.stem)">{{ truncateRich(row.stem, 22) }}</span>
              </div>
              <div class="ht-meta">{{ row.owner }} · {{ row.subject }} {{ row.grade }} · {{ row.source }}</div>
            </td>
            <td>
              <span class="tag" :class="row.status === 'approved' ? 'tag-green' : 'tag-red'">
                {{ QUESTION_STATUS_TEXT[row.status] }}
              </span>
            </td>
            <td class="ht-opinion">{{ row.reviewOpinion?.trim() || '—' }}</td>
            <td class="ht-reviewer">
              <div>{{ row.reviewer ?? '—' }}</div>
              <div class="ht-meta">{{ row.reviewedAt ?? row.updatedAt }}</div>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="reviewed.length > reviewedRecent.length" class="f-hint" style="padding: 10px 2px 0">
        共 {{ reviewed.length }} 条，仅展示最近 {{ reviewedRecent.length }} 条
      </p>
      <p v-else-if="!reviewedRecent.length" class="f-hint" style="padding: 20px 0">暂无审核记录</p>
      <template #footer>
        <button class="btn btn-ghost" type="button" @click="historyOpen = false">关闭</button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.review-layout { display: grid; grid-template-columns: 280px 1fr 360px; gap: 14px; align-items: start; }

.queue-panel { padding: 14px; max-height: calc(100vh - 150px); overflow: auto; }
.queue-list { display: flex; flex-direction: column; gap: 8px; }
.queue-item {
  display: flex; flex-direction: column; gap: 6px; text-align: left;
  border: 1.5px solid var(--border); border-radius: 10px; background: #fff;
  padding: 10px 12px; cursor: pointer; transition: all 0.15s;
}
.queue-item:hover { border-color: var(--brand); }
.queue-item.on { border-color: var(--brand); background: var(--brand-soft); }
.qi-top { display: flex; align-items: center; gap: 6px; }
.qi-stem { font-size: 13px; color: var(--ink); line-height: 1.5; }
.qi-meta { font-size: 11.5px; color: var(--sub); }
.history-btn { width: 100%; }

/* 转审：审核人选择列表 */
.reviewer-list { display: flex; flex-direction: column; gap: 8px; }
.reviewer-item {
  display: flex; align-items: center; gap: 10px; text-align: left;
  border: 1.5px solid var(--border); border-radius: 10px; background: #fff;
  padding: 10px 12px; cursor: pointer; transition: all 0.15s;
}
.reviewer-item:hover { border-color: var(--brand); }
.reviewer-item.on { border-color: var(--brand); background: var(--brand-soft); }
.rvr-avatar {
  width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: var(--brand-grad); color: #fff; font-size: 14px; font-weight: 600;
}
.rvr-meta { display: flex; flex-direction: column; gap: 2px; }
.rvr-meta b { font-size: 13.5px; color: var(--ink); }
.rvr-meta i { font-style: normal; font-size: 12px; color: var(--sub); }
.rvr-check { margin-left: auto; color: var(--brand); }

/* 历史审核记录表 */
.history-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.history-table th {
  text-align: left; font-size: 12.5px; color: var(--sub); font-weight: 600;
  padding: 6px 10px; border-bottom: 1px solid var(--border); white-space: nowrap;
}
.history-table td { padding: 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
.history-table tr:last-child td { border-bottom: none; }
.ht-q { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.ht-stem { color: var(--ink); line-height: 1.5; }
.ht-meta { font-size: 12px; color: var(--sub); margin-top: 4px; }
.ht-opinion { color: var(--ink-2); line-height: 1.6; max-width: 220px; }
.ht-reviewer { white-space: nowrap; color: var(--ink-2); }

/* 中栏详情：正文结构与样式都在 QuestionPreviewBody（与题库管理预览抽屉同一份），这里只有头部 */
.preview-panel { padding: 18px 20px; }
.pv-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 14px; }
.pv-title { font-size: 16px; font-weight: 700; }
.pv-sub { font-size: 12.5px; color: var(--sub); }

.report-panel { padding: 14px 16px; position: sticky; top: 0; }
/* 右栏区块标题可点折叠（检测报告默认收起，疑点清单 / 终审意见默认展开），箭头靠右 */
.sec-toggle { cursor: pointer; user-select: none; }
.sec-arrow { margin-left: auto; color: var(--sub); }
.check-list { display: flex; flex-direction: column; gap: 8px; }
/* 检测项上下结构：上「图标 + 项目名」，下「结论描述」 */
.check-row {
  display: flex; flex-direction: column; gap: 3px; font-size: 12.5px;
  padding: 8px 10px; border-radius: 8px; background: #f7f9fc;
}
.check-row.bad { background: var(--danger-soft); }
.check-row .ok { color: var(--success); }
.check-row .bad { color: var(--warn); }
.ck-head { display: flex; align-items: center; gap: 7px; }
.ck-name { font-weight: 600; color: var(--ink); }
.ck-note { color: var(--sub); line-height: 1.6; }
/* 疑点清单：与检测项同样的上下结构，仅列未通过项 */
.suspect-row {
  font-size: 12.5px; color: var(--warn);
  background: var(--warn-soft); border-radius: 8px; padding: 7px 10px; margin-bottom: 6px;
  display: flex; flex-direction: column; gap: 3px;
}
.sp-head { display: flex; align-items: center; gap: 6px; font-weight: 600; }
.sp-desc { color: var(--ink-2); line-height: 1.6; }
/* 终审操作：四枚等宽按钮（通过 / 驳回 / 转审 / AI检测），窄栏里不再溢出 */
.decide-ops { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 12px; }
.decide-ops .btn { width: 100%; padding: 0 6px; white-space: nowrap; }
</style>
