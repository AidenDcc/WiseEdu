<script setup lang="ts">
/**
 * 机构端 · 试卷审核中心。
 *
 * ## 一条待审队列，两个来源
 *
 * 1. **校本提审单**（个人卷在试卷库「提交校本」）：与「校本资源 → 审批管理」是同一张单，
 *    任一处审完另一处即为已处理；
 * 2. **协同送审**（协同组卷 `collabSubmitReview`）：题状态落到 `pending` 的卷。
 *
 * 两类的判定条件不同（一个看审批单、一个看卷状态），通过 / 驳回也走两条接口，
 * 所以队列项带 `ticket` 字段区分，列表里用标签标出「校本提审 / 协同送审」。
 *
 * ## 三栏
 *
 * - 左：待审列表（试卷 ID / 名称 / 年级学科 / 题数分值 / 提交人 / 提交时间），
 *   底部是「已审核试卷」入口（通过 + 驳回都在里面）；
 * - 中：**只放整卷预览的画布**（PaperPreviewModal 的 `canvasOnly`）——不带顶栏工具条、
 *   不带左侧「试卷分析 / 排版样式」。审核员看的是「这卷印出来什么样」，
 *   排版参数不是他要改的东西；
 * - 右：两个页签（AI 检测 / 试卷信息）+ 底部固定操作条（通过 / 驳回 / 转审 / AI 检测）。
 */
import { computed, onMounted, ref } from 'vue'
import { AppIcon, AppModal, appConfirm, paperQuestionCount, paperTotalScore, showToast } from '@aiteach/shared'
import type { AiCheckResult, OrgPaper, OrgQuestion, ResourceApproval, StaffMember } from '@aiteach/shared'
import { PAPER_SIZES, PaperPreviewModal, distributionOf } from '@aiteach/business-common'
import { fetchApprovals, fetchPapers, fetchQuestions, fetchStaff, reviewApproval, reviewPaper } from '@/api/org'
import { opinionFromPaperChecks, paperAiChecks } from '@/api/ai-paper'

const papers = ref<OrgPaper[]>([])
const questions = ref<OrgQuestion[]>([])
const approvals = ref<ResourceApproval[]>([])
const opinion = ref('')
const busy = ref(false)
const checking = ref(false)
const tab = ref<'ai' | 'info'>('ai')

/** 队列项：一张卷 + （校本提审时）那张审批单 */
interface ReviewTask {
  key: string
  paper: OrgPaper
  ticket: ResourceApproval | null
}

/** 待处理的校本提审单（kind = 试卷） */
const schoolTickets = computed(() =>
  approvals.value.filter((row) => row.kind === '试卷' && row.status === 'pending' && row.resourceId != null),
)

const tasks = computed<ReviewTask[]>(() => {
  const byId = new Map(papers.value.map((row) => [row.id, row] as const))
  const list: ReviewTask[] = []
  for (const ticket of schoolTickets.value) {
    const paper = byId.get(ticket.resourceId as number)
    if (!paper) continue
    list.push({ key: `ticket-${ticket.id}`, paper, ticket })
  }
  for (const paper of papers.value) {
    if (paper.status !== 'pending') continue
    if (list.some((item) => item.paper.id === paper.id)) continue
    list.push({ key: `paper-${paper.id}`, paper, ticket: null })
  }
  /* 校本提审在前（那是有人在等我处理），再看协同送审；组内按提交时间倒序 */
  return list.sort((a, b) => submittedAtOf(b).localeCompare(submittedAtOf(a)))
})

const activeKey = ref('')
const activeTask = computed(() => tasks.value.find((row) => row.key === activeKey.value) ?? tasks.value[0] ?? null)
const active = computed(() => activeTask.value?.paper ?? null)

/* ===== 两栏开合 =====
 * 审核员看卷面时会想把画布放到最大：左右两条侧栏都做成可收起，
 * 收起后退化成一条 34px 的竖向导轨（点它就回来），而不是整块消失 ——
 * 消失掉的话「怎么找回来」就没答案了。
 * 宽度走 grid 的轨道而不是面板自身的 width：中间那栏是 1fr，由轨道决定它吃多少，
 * 面板自己收窄只会留下空白。 */
const queueOpen = ref(true)
const reportOpen = ref(true)
const layoutStyle = computed(() => ({
  gridTemplateColumns: `${queueOpen.value ? '290px' : '34px'} minmax(0, 1fr) ${reportOpen.value ? '320px' : '34px'}`,
}))

/* ===== 列表里要展示的六项信息 ===== */
function submittedAtOf(task: ReviewTask): string {
  return task.ticket?.submittedAt ?? task.paper.updatedAt
}
function submitterOf(task: ReviewTask): string {
  return task.ticket?.applicant ?? task.paper.owner
}
function countOf(paper: OrgPaper): number {
  return paperQuestionCount(paper)
}
function scoreOf(paper: OrgPaper): number {
  return paperTotalScore(paper)
}

/* ===== 已审核（通过 / 驳回） ===== */
interface HistoryRow {
  id: number
  paper: OrgPaper
  result: string
  ok: boolean
  opinion: string
  reviewer: string
  at: string
}

const historyRows = computed<HistoryRow[]>(() => {
  const byId = new Map(papers.value.map((row) => [row.id, row] as const))
  const rows: HistoryRow[] = []
  const seen = new Set<number>()

  /* 提审单优先：驳回时卷本身仍是 available 的个人卷，只看卷状态会把「驳回」显示成「已入库」 */
  for (const ticket of approvals.value) {
    if (ticket.kind !== '试卷' || ticket.status === 'pending' || ticket.resourceId == null) continue
    const paper = byId.get(ticket.resourceId)
    if (!paper) continue
    const ok = ticket.status === 'approved'
    rows.push({
      id: paper.id,
      paper,
      result: ok ? '已入校本' : '已驳回',
      ok,
      opinion: ticket.opinion ?? '',
      reviewer: ticket.reviewer ?? '',
      at: ticket.reviewedAt ?? ticket.submittedAt,
    })
    seen.add(paper.id)
  }

  for (const paper of papers.value) {
    if (seen.has(paper.id)) continue
    if (paper.status !== 'approved' && paper.status !== 'rejected') continue
    if (!paper.reviewer) continue
    const ok = paper.status === 'approved'
    rows.push({
      id: paper.id,
      paper,
      result: ok ? '已通过' : '已驳回',
      ok,
      opinion: paper.reviewOpinion ?? '',
      reviewer: paper.reviewer,
      at: paper.reviewedAt ?? paper.updatedAt,
    })
  }

  return rows.sort((a, b) => b.at.localeCompare(a.at))
})

const historyOpen = ref(false)

/* ===== AI 九项检测 ===== */
/**
 * 当前卷的检测结论。
 *
 * 卷上已有结论（提交审核时 `savePaper` / 协同送审写过）就直接用；没有就按同一套纯函数
 * 当场算一份 —— 审核员点开一份卷，第一眼就该看到这卷哪儿有问题，而不是先按一次「开始检测」。
 * `paperAiChecks` 是确定性的（同一份卷永远同一份结论），所以不必缓存，也不会每次切卷都变。
 */
const checks = computed<AiCheckResult[]>(() => {
  const paper = active.value
  if (!paper) return []
  return paper.aiChecks?.length ? paper.aiChecks : paperAiChecks(paper, questions.value)
})
const passedCount = computed(() => checks.value.filter((row) => row.pass).length)
const suspects = computed(() => checks.value.filter((row) => !row.pass))

async function runCheck() {
  const paper = active.value
  if (!paper || checking.value) return
  checking.value = true
  try {
    /* 小延时：与题库质检同一体感，避免按钮点下去没有任何「在算」的反馈 */
    await new Promise((resolve) => window.setTimeout(resolve, 420))
    paper.aiChecks = paperAiChecks(paper, questions.value)
    paper.aiSuspects = paper.aiChecks.filter((row) => !row.pass).map((row) => `${row.name}：${row.note}`)
    const bad = paper.aiChecks.filter((row) => !row.pass).length
    if (bad && !opinion.value.trim()) {
      opinion.value = opinionFromPaperChecks(paper.aiChecks)
      showToast(`AI 检测发现 ${bad} 处待处理问题，意见已填入审核意见`, 'warning')
    } else {
      showToast(bad ? `AI 检测发现 ${bad} 处待处理问题，详见疑点清单` : 'AI 检测完成，九项全部通过', bad ? 'warning' : 'success')
    }
  } catch (error) {
    showToast(error instanceof Error ? error.message : '检测失败', 'error')
  } finally {
    checking.value = false
  }
}

/* ===== 试卷信息页签 ===== */
const infoRows = computed(() => {
  const task = activeTask.value
  if (!task) return []
  const paper = task.paper
  return [
    { label: '年级 / 学科', value: `${paper.grade} / ${paper.subject}` },
    { label: '难度', value: paper.difficulty ?? '—' },
    { label: '考试类型', value: paper.examType ?? '—' },
    { label: '地区', value: [paper.region, paper.competition].filter(Boolean).join(' / ') || '—' },
    { label: '来源', value: paper.source ?? '—' },
    { label: '提交人', value: submitterOf(task) },
    { label: '提交时间', value: submittedAtOf(task).slice(0, 16) },
  ]
})

/** 试题分析：卷内题目的题型分布（与预览左栏「试题统计」同一份算法） */
const typeStats = computed(() => {
  const paper = active.value
  if (!paper) return []
  const byId = new Map(questions.value.map((row) => [row.id, row] as const))
  const rows = paper.sections.flatMap((section) =>
    section.questions.map((entry) => byId.get(entry.questionId)).filter((row): row is OrgQuestion => Boolean(row)),
  )
  return distributionOf(rows, (row) => row.type)
})

/** 试卷纸张信息：中栏画布用的就是这套默认版式（与 PaperPreviewModal 的默认值同一份） */
const paperSize = PAPER_SIZES.find((row) => row.key === 'A4') ?? PAPER_SIZES[0]

/* ===== 通过 / 驳回 ===== */
async function decide(pass: boolean) {
  const task = activeTask.value
  if (!task) return
  if (!pass && opinion.value.trim().length < 5) {
    showToast('驳回意见不能少于 5 个字', 'error')
    return
  }
  const ok = await appConfirm(
    pass
      ? `确认通过《${task.paper.name}》？通过后该卷进入校本资源库，全机构可见。`
      : `确认驳回《${task.paper.name}》？驳回意见将推送给${task.ticket ? '申请人' : '创建人'}（${submitterOf(task)}）。`,
    { title: pass ? '审核通过' : '审核驳回', type: pass ? 'info' : 'danger', confirmText: pass ? '通过' : '驳回' },
  )
  if (!ok) return
  busy.value = true
  try {
    if (task.ticket) {
      await reviewApproval(task.ticket.id, pass, opinion.value.trim())
      /* 通过后卷的 scope 已被后端翻成 school，本地那份是旧值，必须重拉 */
      await load()
    } else {
      const updated = await reviewPaper(task.paper.id, pass, opinion.value.trim())
      const pos = papers.value.findIndex((row) => row.id === updated.id)
      if (pos >= 0) papers.value[pos] = updated
    }
    showToast(pass ? '已通过，试卷已进入校本资源库' : '已驳回，意见已推送', 'success')
    opinion.value = ''
    activeKey.value = tasks.value[0]?.key ?? ''
  } catch (error) {
    showToast(error instanceof Error ? error.message : '操作失败', 'error')
  } finally {
    busy.value = false
  }
}

/* ===== 转审 ===== */
const transferOpen = ref(false)
const staff = ref<StaffMember[]>([])
const transferPick = ref<number | null>(null)
const reviewers = computed(() => staff.value.filter((row) => row.enabled && row.role === '审核员'))

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

async function load() {
  const [paperRows, questionRows, tickets] = await Promise.all([fetchPapers(), fetchQuestions(), fetchApprovals()])
  papers.value = paperRows
  questions.value = questionRows
  approvals.value = tickets
}

onMounted(load)
</script>

<template>
  <div class="review-layout" :style="layoutStyle">
    <!-- 左：待审列表（底部是已审核入口） -->
    <aside v-if="queueOpen" class="panel queue-panel">
      <div class="qp-head">
        <span class="section-title" style="margin: 0">待审核试卷（{{ tasks.length }}）</span>
        <button class="fold-btn" type="button" title="隐藏待审列表" @click="queueOpen = false">
          <AppIcon name="chevron-left" :size="15" />
        </button>
      </div>
      <div class="queue-list">
        <p v-if="tasks.length === 0" class="f-hint" style="padding: 12px">队列已清空 🎉</p>
        <button
          v-for="task in tasks"
          :key="task.key"
          class="queue-item"
          :class="{ on: activeTask?.key === task.key }"
          type="button"
          @click="activeKey = task.key; opinion = ''"
        >
          <span class="qi-top">
            <span class="tag tag-blue">#{{ task.paper.id }}</span>
            <span class="tag" :class="task.ticket ? 'tag-orange' : 'tag-gray'">
              {{ task.ticket ? '校本提审' : '协同送审' }}
            </span>
          </span>
          <span class="qi-name">{{ task.paper.name }}</span>
          <span class="qi-meta">{{ task.paper.grade }} / {{ task.paper.subject }}</span>
          <span class="qi-meta">{{ countOf(task.paper) }} 题 / {{ scoreOf(task.paper) }} 分</span>
          <span class="qi-meta">{{ submitterOf(task) }} · {{ submittedAtOf(task).slice(0, 16) }}</span>
        </button>
      </div>
      <button class="btn btn-ghost btn-sm history-btn" type="button" @click="historyOpen = true">
        <AppIcon name="clock" :size="14" /> 已审核试卷（{{ historyRows.length }}）
      </button>
    </aside>

    <!-- 左栏收起后的竖向导轨：点一下把待审列表叫回来 -->
    <button v-else class="panel rail" type="button" title="展开待审列表" @click="queueOpen = true">
      <AppIcon name="chevron-right" :size="15" />
      <span class="rail-text">待审核试卷（{{ tasks.length }}）</span>
    </button>

    <!-- 中：整卷预览画布（只有纸面，没有顶栏工具条与左栏分析） -->
    <div class="panel canvas-panel">
      <PaperPreviewModal v-if="active" canvas-only :paper="active" :questions="questions" />
      <p v-else class="f-hint" style="padding: 30px">选择左侧试卷开始审核</p>
    </div>

    <!-- 右：两个页签 + 底部操作条 -->
    <aside v-if="reportOpen" class="panel report-panel">
      <template v-if="active">
        <div class="rp-tabs">
          <button class="rp-tab" :class="{ on: tab === 'ai' }" type="button" @click="tab = 'ai'">
            AI 检测
            <i v-if="checks.length" class="rp-badge" :class="{ bad: suspects.length }">
              {{ passedCount }}/{{ checks.length }}
            </i>
          </button>
          <button class="rp-tab" :class="{ on: tab === 'info' }" type="button" @click="tab = 'info'">试卷信息</button>
          <button class="rp-fold" type="button" title="隐藏审核面板" @click="reportOpen = false">
            <AppIcon name="chevron-right" :size="15" />
          </button>
        </div>

        <div class="rp-body">
          <!-- ===== AI 检测 ===== -->
          <template v-if="tab === 'ai'">
            <!-- 这里不再放「重新检测」：底部操作条那枚「AI 检测」是同一个动作，
                 同一屏两个入口只会让人犹豫点哪个 -->
            <div class="ai-head">
              <span class="ai-title">AI 九项检测</span>
              <span v-if="checks.length" class="ai-sum" :class="{ bad: suspects.length }">
                {{ suspects.length ? `${suspects.length} 项待关注` : '全部通过' }}
              </span>
            </div>

            <div v-if="!checks.length" class="check-list">
              <p class="f-hint" style="padding: 10px 2px">这份卷还没有可检测的内容。</p>
            </div>
            <div v-else class="check-list">
              <div v-for="check in checks" :key="check.name" class="check-row" :class="{ bad: !check.pass }">
                <div class="ck-head">
                  <AppIcon :name="check.pass ? 'check' : 'warning'" :size="14" :class="check.pass ? 'ok' : 'warn'" />
                  <span class="ck-name">{{ check.name }}</span>
                </div>
                <p class="ck-note">{{ check.note }}</p>
              </div>
            </div>

            <template v-if="suspects.length">
              <div class="rp-sub-title">疑点清单（{{ suspects.length }}）</div>
              <div v-for="item in suspects" :key="item.name" class="suspect-row">
                <AppIcon name="warning" :size="13" />
                <span><b>{{ item.name }}</b>：{{ item.note }}</span>
              </div>
            </template>
          </template>

          <!-- ===== 试卷信息 ===== -->
          <template v-else>
            <dl class="info-grid">
              <template v-for="row in infoRows" :key="row.label">
                <dt>{{ row.label }}</dt>
                <dd :title="row.value">{{ row.value }}</dd>
              </template>
            </dl>

            <div class="rp-sub-title">试题分析</div>
            <div class="sub-panel">
              <div class="sub-facts">
                <span>题量 <b>{{ countOf(active) }}</b> 题</span>
                <span>总分 <b>{{ scoreOf(active) }}</b> 分</span>
                <span>大题 <b>{{ active.sections.length }}</b> 个</span>
              </div>
              <div v-for="row in typeStats" :key="row.label" class="stat-row">
                <span class="stat-label">{{ row.label }}</span>
                <span class="stat-bar"><i :style="{ width: `${Math.round(row.ratio * 100)}%` }" /></span>
                <span class="stat-num">{{ row.count }} 题</span>
              </div>
              <p v-if="!typeStats.length" class="f-hint" style="margin: 0">卷内暂无题目</p>
            </div>

            <div class="rp-sub-title">试卷纸张信息</div>
            <div class="sub-panel">
              <div class="sub-facts">
                <span>纸张 <b>{{ paperSize.name }}</b></span>
                <span>尺寸 <b>{{ paperSize.mm }} mm</b></span>
                <span>方向 <b>纵向</b></span>
                <span>版面 <b>一面 {{ paperSize.panels }} 版</b></span>
                <span>版本 <b>学生版</b></span>
              </div>
              <p class="f-hint" style="margin: 6px 0 0">
                中栏按上面这套默认纸张自动分版；需要换纸或看答题卡，可到试卷库「预览」里调。
              </p>
            </div>
          </template>
        </div>

        <!-- 底部审核操作：通过 / 驳回 / 转审 / AI 检测 -->
        <div class="rp-foot">
          <textarea v-model="opinion" class="f-textarea" rows="2" placeholder="审核意见：驳回时必填 ≥5 字，通过时选填" />
          <div class="decide-ops">
            <button class="btn btn-primary btn-sm" :disabled="busy" @click="decide(true)">通过</button>
            <button class="btn btn-danger btn-sm" :disabled="busy" @click="decide(false)">驳回</button>
            <button class="btn btn-ghost btn-sm" :disabled="busy" @click="openTransfer">转审</button>
            <button class="btn btn-ghost btn-sm" :disabled="checking" @click="runCheck">
              {{ checking ? '检测中…' : 'AI 检测' }}
            </button>
          </div>
        </div>
      </template>
      <p v-else class="f-hint" style="padding: 30px">选择左侧试卷开始审核</p>
    </aside>

    <!-- 右栏收起后的竖向导轨 -->
    <button v-else class="panel rail" type="button" title="展开审核面板" @click="reportOpen = true">
      <AppIcon name="chevron-left" :size="15" />
      <span class="rail-text">AI 检测 · 试卷信息</span>
    </button>

    <!-- 已审核试卷：通过 + 驳回 -->
    <AppModal v-if="historyOpen" title="已审核试卷" :width="820" @close="historyOpen = false">
      <table v-if="historyRows.length" class="history-table">
        <thead>
          <tr>
            <th>试卷</th>
            <th>年级 / 学科</th>
            <th>题数 / 分值</th>
            <th>提交人</th>
            <th>结果</th>
            <th>审核人 / 时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in historyRows" :key="row.id">
            <td>
              <div class="ht-q">
                <span class="tag tag-blue">#{{ row.id }}</span>
                <span class="ht-name" :title="row.paper.name">{{ row.paper.name }}</span>
              </div>
              <div v-if="row.opinion" class="ht-meta">意见：{{ row.opinion }}</div>
            </td>
            <td>{{ row.paper.grade }} / {{ row.paper.subject }}</td>
            <td>{{ countOf(row.paper) }} 题 / {{ scoreOf(row.paper) }} 分</td>
            <td>{{ row.paper.owner }}</td>
            <td><span class="tag" :class="row.ok ? 'tag-green' : 'tag-red'">{{ row.result }}</span></td>
            <td class="ht-reviewer">
              <div>{{ row.reviewer || '—' }}</div>
              <div class="ht-meta">{{ row.at.slice(0, 16) }}</div>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="f-hint" style="padding: 20px 0">暂无审核记录</p>
      <template #footer>
        <button class="btn btn-ghost" type="button" @click="historyOpen = false">关闭</button>
      </template>
    </AppModal>

    <!-- 转审：选择审核员 -->
    <AppModal v-if="transferOpen" title="转审 — 选择审核人" :width="420" @close="transferOpen = false">
      <p class="f-hint" style="margin-bottom: 10px">
        试卷 #{{ active?.id }}《{{ active?.name }}》将转入所选审核员的待审队列，并送达转交消息。
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
  </div>
</template>

<style scoped>
/* 三栏撑满内容区（顶栏 62 + 内容区上下内边距 44），三块各自内部滚动。
   轨道宽度由 `layoutStyle` 给（左右两栏要能收成 34px 竖条），这里只定布局与间距 */
.review-layout {
  --content-h: calc(100vh - 106px);
  display: grid;
  gap: 14px;
  height: var(--content-h);
  min-height: 520px;
  align-items: stretch;
}

/* ===== 左：待审列表 ===== */
.queue-panel { padding: 14px; display: flex; flex-direction: column; min-height: 0; }
.qp-head {
  flex-shrink: 0;
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

/* 收起按钮（左右两栏各一枚）：小尺寸、无底色，只在悬浮时显形 —— 它是辅助动作，
   不该和「通过 / 驳回」抢注意力 */
.fold-btn,
.rp-fold {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--sub);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.fold-btn:hover,
.rp-fold:hover { background: #f2f4fa; color: var(--brand); }
.rp-fold { height: auto; border-bottom: 2px solid transparent; border-radius: 0; }

/* 收起后的竖向导轨：整条都能点，文字竖排。
   背景与边框沿用 `.panel`，这里不重设 —— 两条同权重规则谁在后面谁赢，交给打包顺序太不稳。 */
.rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 12px 0;
  color: var(--sub);
  font-family: inherit;
  cursor: pointer;
  overflow: hidden;
  transition: color 0.15s, border-color 0.15s;
}
.rail:hover { color: var(--brand); border-color: var(--brand); }
.rail-text {
  writing-mode: vertical-rl;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 1.5px;
  white-space: nowrap;
}
.queue-list { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
.queue-item {
  display: flex; flex-direction: column; gap: 4px; text-align: left;
  border: 1.5px solid var(--border); border-radius: 10px; background: #fff;
  padding: 10px 12px; cursor: pointer; transition: all 0.15s;
}
.queue-item:hover { border-color: var(--brand); }
.queue-item.on { border-color: var(--brand); background: var(--brand-soft); }
.qi-top { display: flex; align-items: center; gap: 6px; }
.qi-name {
  font-size: 13px; font-weight: 600; color: var(--ink); line-height: 1.45;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.qi-meta { font-size: 11.5px; color: var(--sub); }
.history-btn { width: 100%; margin-top: 12px; flex-shrink: 0; }

/* ===== 中：画布 ===== */
.canvas-panel { padding: 0; overflow: hidden; display: flex; flex-direction: column; }
/* 内嵌画布（PaperPreviewModal 的 canvasOnly）在 flex 列里要能被压住，否则它按内容高度
   把面板撑开、整页出现第二根滚动条 —— `min-height: 0` 才是让它自己滚的那一句。 */
.canvas-panel :deep(.pp-mask) { flex: 1; min-height: 0; }

/* ===== 右：页签 + 操作条 ===== */
.report-panel { padding: 0; display: flex; flex-direction: column; min-height: 0; }
.rp-tabs { display: flex; border-bottom: 1px solid var(--border); flex-shrink: 0; }.rp-tab {
  flex: 1; border: none; background: none; padding: 12px 6px; cursor: pointer;
  font-family: inherit; font-size: 13px; font-weight: 600; color: var(--sub);
  border-bottom: 2px solid transparent; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
}
.rp-tab:hover { color: var(--brand-deep); }
.rp-tab.on { color: var(--brand-deep); border-bottom-color: var(--brand); }
.rp-badge {
  font-style: normal; font-size: 11px; font-weight: 700; border-radius: 999px;
  background: var(--success-soft); color: var(--success); padding: 1px 7px;
}
.rp-badge.bad { background: var(--warn-soft); color: var(--warn); }
.rp-body { flex: 1; min-height: 0; overflow-y: auto; padding: 14px 16px; }
.rp-sub-title { font-size: 12.5px; font-weight: 700; color: var(--ink); margin: 16px 0 8px; }
.rp-foot {
  flex-shrink: 0; border-top: 1px solid var(--border); padding: 10px 14px 12px;
  background: #fff;
}
.rp-foot .f-textarea { margin-bottom: 8px; }

/* AI 检测 */
.ai-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.ai-title { font-size: 13px; font-weight: 700; color: var(--ink); }
.ai-sum { font-size: 11.5px; color: var(--success); margin-left: auto; }
.ai-sum.bad { color: var(--warn); }
.check-list { display: flex; flex-direction: column; gap: 8px; }
.check-row { display: flex; flex-direction: column; gap: 3px; font-size: 12.5px; padding: 8px 10px; border-radius: 8px; background: #f7f9fc; }
.check-row.bad { background: var(--warn-soft); }
.check-row .ok { color: var(--success); }
.check-row .warn { color: var(--warn); }
.ck-head { display: flex; align-items: center; gap: 7px; }
.ck-name { font-weight: 600; color: var(--ink); }
.ck-note { color: var(--sub); line-height: 1.6; }
.suspect-row {
  display: flex; align-items: flex-start; gap: 7px; font-size: 12.5px; color: var(--warn);
  background: var(--warn-soft); border-radius: 8px; padding: 7px 10px; margin-bottom: 6px;
}
.suspect-row b { font-weight: 600; }

/* 试卷信息 */
.info-grid {
  display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 8px 10px;
  margin: 0; font-size: 12.5px;
}
.info-grid dt { color: var(--sub); }
.info-grid dd { margin: 0; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sub-panel { border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; }
.sub-facts { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12.5px; color: var(--sub); }
.sub-facts b { color: var(--ink); }
.stat-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; font-size: 12px; color: var(--sub); }
.stat-label { width: 64px; flex-shrink: 0; }
.stat-bar { flex: 1; height: 6px; border-radius: 999px; background: var(--bg); overflow: hidden; }
.stat-bar i { display: block; height: 100%; background: var(--brand); border-radius: 999px; }
.stat-num { width: 42px; text-align: right; flex-shrink: 0; }

/* 底部操作：四枚等宽按钮 */
.decide-ops { display: flex; gap: 8px; }
.decide-ops .btn { flex: 1 1 0; min-width: 0; padding: 0 6px; white-space: nowrap; }

/* 已审核表格 */
.history-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.history-table th {
  text-align: left; font-size: 12.5px; color: var(--sub); font-weight: 600;
  padding: 6px 10px; border-bottom: 1px solid var(--border); white-space: nowrap;
}
.history-table td { padding: 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
/* 除第一列（试卷名 + 意见，本来就该折行）外都不折：「高一 / 数学」被压成两行、
   「沈丽华」被拆成「沈丽 / 华」这种断法没有可读性，宁可让卷名多折一行 */
.history-table td + td { white-space: nowrap; }
.history-table tr:last-child td { border-bottom: none; }
.ht-q { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.ht-name { color: var(--ink); line-height: 1.5; }
.ht-meta { font-size: 12px; color: var(--sub); margin-top: 4px; }
.ht-reviewer { white-space: nowrap; color: var(--ink-2); }

/* 转审列表 */
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
</style>
