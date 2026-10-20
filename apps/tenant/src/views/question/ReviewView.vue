<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { AppIcon, AppModal, appConfirm, showToast, toPlainText, truncateRich } from '@aiteach/shared'
import type { AiCheckResult, OrgQuestion, ResourceApproval, StaffMember } from '@aiteach/shared'
import { fetchApprovals, fetchQuestions, fetchStaff, reviewApproval, reviewQuestion } from '@/api/org'
import { checkInputOfQuestion, checkQuestionByAi } from '@/api/ai-check'
import type { AiCheckItem } from '@/api/ai-check'
import { QuestionPreviewBody } from '@aiteach/business-common'

const all = ref<OrgQuestion[]>([])
const approvals = ref<ResourceApproval[]>([])
const opinion = ref('')
const busy = ref(false)
const checking = ref(false)

/**
 * 待审队列 = 两路任务的合并（同一道题只出现一次）：
 *
 * 1. **校本提审单**：个人题在题库管理里「提交校本」后生成的 `kind='题目'` 审批单，
 *    与「校本资源 → 审批管理」看的是同一张单 —— 在两个入口审都算数（这里审完那边即已处理）。
 * 2. **题目终审**：AI 校验完成、状态落到 `pending` 的题（教辅 / 文档导入仍走这条老路）。
 *
 * 为什么合并：审核员的习惯入口就是「题目审核中心」，校本提审若只在审批管理里能审，
 * 同一个人要为了同一件事在两个页面之间来回切。两类的判定条件不同（一个看审批单、
 * 一个看题目状态），所以队列里带 `ticket` 字段区分，通过 / 驳回分别走两条接口。
 */
interface ReviewTask {
  /** 队列内唯一键：同一道题可能既有终审状态、又有提审单，id 不足以区分 */
  key: string
  question: OrgQuestion
  /** 校本提审单；null 表示这道题自身在等终审 */
  ticket: ResourceApproval | null
  /** 提交时间（提审单取 submittedAt，终审取题目 updatedAt） */
  at: string
  /** 申请人 / 作者：队列里显示谁该为这道题负责 */
  applicant: string
}

/** 待处理的校本提审单（个人题 → 校本） */
const schoolTickets = computed(() =>
  approvals.value.filter((row) => row.kind === '题目' && row.status === 'pending' && row.resourceId != null),
)

/** 待人工终审队列（AI 校验完成 → pending；FR-AI-006 / FR-TM-021） */
const pendingQuestions = computed(() => all.value.filter((row) => row.status === 'pending'))

const tasks = computed<ReviewTask[]>(() => {
  const byId = new Map(all.value.map((row) => [row.id, row] as const))
  const list: ReviewTask[] = []
  for (const ticket of schoolTickets.value) {
    const question = byId.get(ticket.resourceId as number)
    /* 题被删了就不该再占队列（审批单里点开会是空正文），直接跳过 */
    if (!question) continue
    list.push({
      key: `ticket-${ticket.id}`,
      question,
      ticket,
      at: ticket.submittedAt,
      applicant: ticket.applicant,
    })
  }
  for (const question of pendingQuestions.value) {
    if (list.some((item) => item.question.id === question.id)) continue
    list.push({ key: `question-${question.id}`, question, ticket: null, at: question.updatedAt, applicant: question.owner })
  }
  return list
})

/** 队列里校本提审的条数（左侧小字用；不给审批单总数，是因为题被删的提审单不入队列） */
const ticketCount = computed(() => tasks.value.filter((row) => row.ticket).length)

/** 已审记录（历史审核记录弹窗用）：两类审核合并后按审核时间倒序。
 *
 *  - 校本提审：结果看**审批单**（通过 = 已入校本；驳回时题仍留在个人题库、status 一直是
 *    approved，只看题目状态会把「驳回」显示成「已入库」）；
 *  - 题目终审：结果看题目自身状态。
 *
 *  同一个 id 只留一条，优先取审批单那条（它带申请人、审批日志，信息更全）。
 *  个人题现在免审直接是 approved，所以必须按「有审核人」过滤，
 *  否则历史记录里会堆满老师自己存进个人题库的题。 */
interface HistoryRow {
  id: number
  question: OrgQuestion
  result: string
  ok: boolean
  opinion: string
  reviewer: string
  at: string
}

const historyRows = computed<HistoryRow[]>(() => {
  const byId = new Map(all.value.map((row) => [row.id, row] as const))
  const rows: HistoryRow[] = []
  const seen = new Set<number>()

  for (const ticket of approvals.value) {
    if (ticket.kind !== '题目' || ticket.status === 'pending' || ticket.resourceId == null) continue
    const question = byId.get(ticket.resourceId)
    if (!question) continue
    const ok = ticket.status === 'approved'
    rows.push({
      id: question.id,
      question,
      result: ok ? '已入校本' : '已驳回',
      ok,
      opinion: ticket.opinion ?? '',
      reviewer: ticket.reviewer ?? '',
      at: ticket.reviewedAt ?? ticket.submittedAt,
    })
    seen.add(question.id)
  }

  for (const question of all.value) {
    if (seen.has(question.id)) continue
    if (!question.reviewer) continue
    if (question.status !== 'approved' && question.status !== 'rejected') continue
    const ok = question.status === 'approved'
    rows.push({
      id: question.id,
      question,
      result: ok ? '已入库' : '已驳回',
      ok,
      opinion: question.reviewOpinion ?? '',
      reviewer: question.reviewer,
      at: question.reviewedAt ?? question.updatedAt,
    })
  }

  return rows.sort((a, b) => b.at.localeCompare(a.at))
})
/** 弹窗里只铺最近 50 条（全量铺开会渲染几百行 DOM） */
const historyRecent = computed(() => historyRows.value.slice(0, 50))

const activeKey = ref('')
const activeTask = computed(() => tasks.value.find((row) => row.key === activeKey.value) ?? tasks.value[0] ?? null)
const active = computed(() => activeTask.value?.question ?? null)

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
  /* 题目与提审单一起拉：队列是两者的并集，分两次 awaited 会先闪一帧「只剩终审」的队列 */
  const [questions, tickets] = await Promise.all([fetchQuestions(), fetchApprovals()])
  all.value = questions
  approvals.value = tickets
}

function pick(task: ReviewTask) {
  activeKey.value = task.key
  opinion.value = ''
  /* 校本提审的题没进过 AI 终审队列，报告是空的 —— 选中时先跑一次，
     否则右栏只有一个「0/0 通过」的空壳，审核员还得自己记得点「AI检测」 */
  if (task.ticket && !task.question.aiChecks?.length) void recheck()
}

/** 终审意见输入框的提示语：两类任务的「驳回意味着什么」不一样 */
const opinionPlaceholder = computed(() => {
  const task = activeTask.value
  if (!task) return ''
  if (task.ticket) return '驳回时必填 ≥5 字；通过后该题进入校本题库，意见同步到审批管理'
  return active.value?.status === 'rejected' ? (active.value.reviewOpinion ?? '') : '驳回时必填 ≥5 字；通过时选填'
})

/** 终审通过 / 驳回（FR-TM-022：驳回意见必填 ≥5 字；提交前二次确认防误触）。
 *
 *  两类任务走两条接口：
 *  - 校本提审 → `reviewApproval`：审批单落审核人 / 时间 / 意见，通过时把题的 `scope` 翻成校本；
 *  - 题目终审 → `reviewQuestion`：题本身状态 approved / rejected。
 *  两者都把意见落在题上，所以「历史审核记录」与题库管理看到的结论是一致的。 */
async function decide(pass: boolean) {
  const task = activeTask.value
  if (!task) return
  if (!pass && opinion.value.trim().length < 5) {
    showToast('驳回意见不能少于 5 个字', 'error')
    return
  }
  const title = truncateRich(task.question.stem, 18)
  const ok = await appConfirm(
    pass
      ? task.ticket
        ? `确认通过《${title}》的校本申请？通过后该题进入校本题库，全机构可见。`
        : `确认通过《${title}》？通过后题目将进入机构正式题库。`
      : task.ticket
        ? `确认驳回《${title}》的校本申请？驳回意见将推送给申请人（${task.applicant}），该题仍留在其个人题库。`
        : `确认驳回《${title}》？驳回意见将推送给作者（${task.applicant}）。`,
    { title: pass ? '审核通过' : '审核驳回', type: pass ? 'info' : 'danger', confirmText: pass ? '通过' : '驳回' },
  )
  if (!ok) return
  busy.value = true
  try {
    if (task.ticket) {
      await reviewApproval(task.ticket.id, pass, opinion.value.trim())
      /* 通过后题的 scope / library 已被后端改写，本地那份是旧值，必须重拉 */
      await load()
      showToast(pass ? '已通过，题目已进入校本题库' : '已驳回，意见已推送申请人', 'success')
    } else {
      const updated = await reviewQuestion(task.question.id, pass, opinion.value.trim())
      const pos = all.value.findIndex((row) => row.id === updated.id)
      if (pos >= 0) all.value[pos] = updated
      showToast(pass ? '已通过，题目入机构正式题库' : '已驳回，意见已推送作者', 'success')
    }
    opinion.value = ''
    /* 处理完的这一条已离开队列，自动跳到下一条，省掉一次点击 */
    activeKey.value = tasks.value[0]?.key ?? ''
    const next = tasks.value[0]
    if (next?.ticket && !next.question.aiChecks?.length) void recheck()
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

/**
 * 检测项 → 报告项名。
 *
 * 材料组合题的检测项带 `scope`（`共用材料` / `第 N 题`），报告项名因此是「单元 · 维度」两级 ——
 * 一道组合题有四五道子题、每道都有题干/选项/答案/解析，只用「答案」当名字会出现四五条同名项，
 * 疑点清单里根本分不清是哪一道子题的问题。独立单题没有 scope，名字与改造前完全一致。
 */
function checkNameOf(item: AiCheckItem): string {
  const aspect = ASPECT_TO_CHECK[item.aspect] ?? item.aspect
  return item.scope ? `${item.scope} · ${aspect}` : aspect
}

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

/** 引擎结果合并进既有报告：按项目名原位更新（同项多次命中时全过才算过、说明拼接），
 *  框架外的新维度追加尾部；重复检测幂等，不会重复追加也不会叠加标注 */
function mergeChecks(row: OrgQuestion, items: AiCheckItem[]): AiCheckResult[] {
  const original = row.aiChecks ?? []
  const grouped = new Map<string, AiCheckItem[]>()
  for (const item of items) {
    const target = checkNameOf(item)
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
 *  入参走 checkInputOfQuestion：材料组合题会带上共用材料与全部子题，逐题审查、逐题出报告项。
 *  检测发现待修改问题时，若终审意见还是空的，直接把 AI 意见预填进去（已有手写内容则不覆盖）。 */
async function recheck() {
  if (!active.value || checking.value) return
  checking.value = true
  try {
    const row = active.value
    const report = await checkQuestionByAi(checkInputOfQuestion(row))
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

onMounted(async () => {
  await load()
  /* 首条是校本提审单时，进页面就把 AI 报告跑出来（与手动点选同一口径） */
  const first = tasks.value[0]
  if (first?.ticket && !first.question.aiChecks?.length) void recheck()
})
</script>

<template>
  <div class="review-layout">
    <!-- 左：待审队列（校本提审单 + 题目终审，合并成一条队列） -->
    <div class="panel queue-panel">
      <div class="section-title">待审队列（{{ tasks.length }}）</div>
      <p class="queue-sub">
        校本提审 {{ ticketCount }} · 终审 {{ tasks.length - ticketCount }}
      </p>
      <div class="queue-list">
        <p v-if="tasks.length === 0" class="f-hint" style="padding: 12px">队列已清空 🎉</p>
        <button
          v-for="task in tasks"
          :key="task.key"
          class="queue-item"
          :class="{ on: activeTask?.key === task.key }"
          type="button"
          @click="pick(task)"
        >
          <span class="qi-top">
            <span class="tag tag-blue">#{{ task.question.id }}</span>
            <span class="tag" :class="task.ticket ? 'tag-orange' : 'tag-gray'">
              {{ task.ticket ? '校本提审' : '终审' }}
            </span>
            <span class="tag tag-gray">{{ task.question.type }}</span>
          </span>
          <span class="qi-stem">{{ truncateRich(task.question.stem, 46) }}…</span>
          <span class="qi-meta">{{ task.applicant }} · {{ task.question.subject }} {{ task.question.grade }}</span>
        </button>
      </div>
      <button class="btn btn-ghost btn-sm history-btn" type="button" style="margin-top: 14px" @click="historyOpen = true">
        <AppIcon name="clock" :size="14" /> 历史审核记录（{{ historyRows.length }}）
      </button>
    </div>

    <!-- 中：题目详情（与题库管理的「题目预览」抽屉共用同一份正文组件，两处 UI 一致） -->
    <div class="panel preview-panel">
      <template v-if="active">
        <header class="pv-head">
          <h3 class="pv-title">题目 #{{ active.id }}</h3>
          <span v-if="activeTask?.ticket" class="tag tag-orange">校本提审</span>
          <span class="pv-sub">学生视角预览</span>
        </header>
        <!-- 提审单的上下文：谁提交、什么时候、为什么申请。
             审核员判的是「这道题该不该进校本」，不是「这道题对不对」，三样都得看到 -->
        <p v-if="activeTask?.ticket" class="pv-note">
          申请人 {{ activeTask.applicant }} · 提交于 {{ activeTask.at.slice(0, 16) }}
          <template v-if="activeTask.ticket.note"> · 说明：{{ activeTask.ticket.note }}</template>
        </p>
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
          :placeholder="opinionPlaceholder"
        />
        <div class="decide-ops">
          <button class="btn btn-primary btn-sm" :disabled="busy" @click="decide(true)">通过</button>
          <button class="btn btn-danger btn-sm" :disabled="busy" @click="decide(false)">驳回</button>
          <!-- 转审只对「题目终审」有意义：校本提审是申请人指名提交给机构的单子，转给别人审没有落点 -->
          <button v-if="!activeTask?.ticket" class="btn btn-ghost btn-sm" :disabled="busy" @click="openTransfer">转审</button>
          <button class="btn btn-ghost btn-sm" :disabled="checking" @click="recheck">{{ checking ? '检测中…' : 'AI检测' }}</button>
        </div>
      </template>
      <p v-else class="f-hint" style="padding: 30px">选择左侧题目开始审核</p>
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
      <table v-if="historyRecent.length" class="history-table">
        <thead>
          <tr>
            <th>题目</th>
            <th>结果</th>
            <th>终审意见</th>
            <th>审核人 / 时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in historyRecent" :key="row.id">
            <td>
              <div class="ht-q">
                <span class="tag tag-blue">#{{ row.id }}</span>
                <span class="tag tag-gray">{{ row.question.type }}</span>
                <span class="ht-stem" :title="toPlainText(row.question.stem)">{{ truncateRich(row.question.stem, 22) }}</span>
              </div>
              <div class="ht-meta">
                {{ row.question.owner }} · {{ row.question.subject }} {{ row.question.grade }} · {{ row.question.source }}
              </div>
            </td>
            <td>
              <span class="tag" :class="row.ok ? 'tag-green' : 'tag-red'">{{ row.result }}</span>
            </td>
            <td class="ht-opinion">{{ row.opinion.trim() || '—' }}</td>
            <td class="ht-reviewer">
              <div>{{ row.reviewer || '—' }}</div>
              <div class="ht-meta">{{ row.at }}</div>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="historyRows.length > historyRecent.length" class="f-hint" style="padding: 10px 2px 0">
        共 {{ historyRows.length }} 条，仅展示最近 {{ historyRecent.length }} 条
      </p>
      <p v-else-if="!historyRecent.length" class="f-hint" style="padding: 20px 0">暂无审核记录</p>
      <template #footer>
        <button class="btn btn-ghost" type="button" @click="historyOpen = false">关闭</button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.review-layout { display: grid; grid-template-columns: 280px 1fr 360px; gap: 14px; align-items: start; }

.queue-panel { padding: 14px; max-height: calc(100vh - 150px); overflow: auto; }
/* 队列构成说明：校本提审几条、题终审几条 —— 审核员一眼知道自己在审什么 */
.queue-sub { font-size: 11.5px; color: var(--sub); padding: 0 2px 10px; }
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
/* 校本提审的上下文条：申请人 / 提交时间 / 申请说明 */
.pv-note {
  font-size: 12.5px; color: var(--sub); line-height: 1.6;
  background: #f7f9fc; border-radius: 8px; padding: 7px 10px; margin: -4px 0 14px;
}

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
/* 终审操作：等宽按钮（通过 / 驳回 / 转审 / AI检测）。
   用 flex 而不是 grid：校本提审没有「转审」，三个按钮也要均分整行，grid 定列数会留空档 */
.decide-ops { display: flex; gap: 8px; margin-top: 12px; }
.decide-ops .btn { flex: 1 1 0; min-width: 0; padding: 0 6px; white-space: nowrap; }
</style>
