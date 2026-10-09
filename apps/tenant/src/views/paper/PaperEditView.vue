<script setup lang="ts">
/**
 * 试卷编辑（全屏工作台，从「生成试卷」或试卷库「编辑」进入）。
 *
 * 为什么做成**独立全屏页**（与 `/paper/compose` 同一思路，不进 AppLayout）：
 * 教材、试卷这类「纸面型」编辑任务要的是尽可能宽的画布 + 常驻的右侧工具条，
 * 套在带侧边栏与顶栏的壳里，画布会被压到不足 1000px，A4 卷面根本展不开。
 *
 * 两条贯穿全页的约束：
 * 1. **所见即所得**：纸面用与「整卷预览」同一套几何（mm→px）、同一套版式令牌（--pp-*）
 *    与同一个渲染组件（PaperBlock），并在隐藏测量层里实测块高后自动分版 ——
 *    编辑时看到的换页位置，就是打印出来的换页位置。
 * 2. **改动都可回溯**：每次结构性改动（加题、删题、换序、改分、改标题、改版式）
 *    都打一份 sections 快照进本地历史，撤销/重做与右侧「历史记录」共用同一份栈。
 *
 * 右侧工具条对标教研云的竖向图标栏：全文设置 / 试题库 / 媒体库 / 资源篮 / 导入文档 / 历史记录。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AppAvatar, AppIcon, appConfirm, showToast, toPlainText, truncateRich, AppModal, AppDrawer, COLLAB_MEMBER_TEXT, COLLAB_STATUS_TEXT } from '@aiteach/shared'
import type {
  CollabMember,
  MediaKind,
  OrgCollabTask,
  OrgMedia,
  OrgPaper,
  OrgQuestion,
  PaperAttachment,
  PaperComment,
  PaperExtra,
  PaperExtraKind,
  PaperSection,
  QuestionCorrection,
} from '@aiteach/shared'
import PaperBlock from '@/components/paper/PaperBlock.vue'
import PaperPreviewModal from '@/components/paper/PaperPreviewModal.vue'
import QuestionActionBarHost from '@/components/paper/QuestionActionBarHost.vue'
import QuestionPreviewDrawer from '@/components/question/QuestionPreviewDrawer.vue'
import QuestionCorrectionDialog from '@/components/question/QuestionCorrectionDialog.vue'
import SimilarQuestionsModal from '@/components/compose/SimilarQuestionsModal.vue'
import AiAssistant from '@/components/ai/AiAssistant.vue'
import AppDropdownMenu from '@/components/ui/AppDropdownMenu.vue'
import {
  DEFAULT_PAPER_NOTICES,
  PAPER_EXTRAS,
  PAPER_LAYOUTS,
  PAPER_SIZES,
  isObjective,
  makePaperExtra,
  paperGeometry,
  presetOf,
  presetVars,
  type PaperBlock as PaperBlockModel,
  type PaperLayoutPreset,
  type PaperOrientation,
  type PaperSizeKey,
} from '@/components/paper/paper-layouts'
import { paginateBlocks, type PaperPage } from '@/components/paper/paginate'
import {
  addPaperComment,
  collabAcceptMember,
  collabAddQuestions,
  collabAiCompose,
  collabRejectMember,
  collabRemoveQuestion,
  collabReopenAfterReject,
  collabReopenMember,
  collabSubmitMember,
  collabSubmitReview,
  collabUpdateSection,
  collabWithdrawReview,
  deletePaperComment,
  fetchCollabTasks,
  fetchMedia,
  fetchPaperComments,
  fetchPapers,
  fetchPaperVersions,
  fetchQuestionCorrections,
  fetchQuestions,
  replacePaperVersion,
  restorePaperVersion,
  savePaper,
  saveQuestion,
  swapPaperQuestion,
} from '@/api/org'
import { checkQuestionByAi, type AiCheckReport } from '@/api/ai-check'
import {
  checkCollabPaperByAi,
  checkCollabRequirement,
  overallOf,
  type CollabCheckItem,
  type CollabCheckQuestion,
  type CollabCheckReport,
  type CollabPaperCheckInput,
} from '@/api/ai-collab-check'
import { useBaseData } from '@/composables/useBaseData'
import { useComposeBasket } from '@/composables/useComposeBasket'
import { useAuthStore } from '@/stores/auth'
import { useDemoRole } from '@/composables/useDemoRole'
import {
  defaultScore,
  findSectionIndex,
  makeSectionTitle,
  memberQuotaOf,
  sectionKeywordsOf,
  sectionLabelOf,
  typeOfSectionTitle,
  MAX_SECTIONS,
} from './paper-sections'
import { COLLAB_MEMBER_CLASS, COLLAB_STATUS_CLASS } from './collab-status'

const route = useRoute()
const router = useRouter()
const { subjects, grades, questionTypesFor, difficulties, ensure, pick, withCurrent } = useBaseData()
const basket = useComposeBasket()

/* ================= 卷面数据 ================= */

const form = reactive({ id: 0, name: '', subject: '', grade: '', duration: 120 })
const sections = ref<PaperSection[]>([])
/**
 * 随卷参考资料（图片 / 视频 / 小程序），来自组卷车或本卷既有数据。
 *
 * 刻意**不进 `snapshots` 撤销栈**：那套栈快照的是 `sections`（卷面），把附件一起塞进去要连带改
 * 历史面板的每一处；而且「撤销卷面改动」本就不该顺手把附上的素材丢掉 —— 附件是加法操作，
 * 移错了直接在面板里移出即可。
 */
const attachments = ref<PaperAttachment[]>([])
/**
 * 卷面附加区块（表格 / 四线格 / 横线）。
 *
 * 与 `attachments` 一样**不进撤销栈**：撤销栈快照的是 `sections`（答题区），
 * 把格子块一起塞进去要连带改历史面板的每一处；而且插错一个格子，
 * 在块工具条里选中删掉就行，比先撤销卷面再重来轻得多。
 *
 * 顺序即卷面顺序，且一律排在各答题区之后（见 paperBlocks）—— 格子是给最后那道题写字用的。
 */
const extras = ref<PaperExtra[]>([])
/** 新增区块的 id 自增源：同一张卷里要区分两个「表格」，见 load() 的重建 */
let extraSeq = 1
/**
 * 卷首「注意事项」的编辑稿：一整段文本，**一行一条**。
 *
 * 存文本而不是数组，是因为面板里就是个 textarea —— 边打字边按行拆再写回输入框，
 * 光标会在刚敲下的空行上乱跳。真正的数组由下面的 `notices` 在保存/排版时现拆。
 */
const noticesDraft = ref('')
/** 卷首注意事项条目：拆行、去空行。空数组 = 卷面不印这一块（见 paper-layouts 的默认稿说明） */
const notices = computed(() => noticesDraft.value.split('\n').map((row) => row.trim()).filter(Boolean))
const meta = reactive({ owner: '', sharedSquare: false, status: 'draft' as OrgPaper['status'] })
const questions = ref<OrgQuestion[]>([])
const ownPaperIds = ref<number[]>([])
const collabTasks = ref<OrgCollabTask[]>([])
const loading = ref(true)
const saving = ref(false)
let sectionSeq = 1

function nowText(): string {
  return new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-')
}

/** 渲染 / 导出 / 预览共用的试卷对象（编辑期是内存态，保存时才落库） */
const paper = computed<OrgPaper>(() => ({
  id: form.id,
  name: form.name.trim() || '未命名试卷',
  subject: form.subject,
  grade: form.grade,
  duration: form.duration,
  status: meta.status,
  sections: sections.value,
  attachments: attachments.value,
  extras: extras.value,
  notices: notices.value,
  owner: meta.owner || '当前用户',
  updatedAt: nowText(),
  sharedSquare: meta.sharedSquare,
}))

function itemOf(questionId: number): OrgQuestion | undefined {
  return questions.value.find((row) => row.id === questionId)
}

const totalCount = computed(() => sections.value.reduce((sum, row) => sum + row.questions.length, 0))
const totalScore = computed(() =>
  sections.value.reduce((sum, row) => sum + row.questions.reduce((t, q) => t + (Number(q.score) || 0), 0), 0),
)
const objectiveScore = computed(() =>
  sections.value.reduce(
    (sum, row) =>
      sum +
      row.questions.reduce((t, q) => {
        const item = itemOf(q.questionId)
        return t + (item && ['单选', '多选', '判断'].includes(item.type) ? Number(q.score) || 0 : 0)
      }, 0),
    0,
  ),
)
const inPaperIds = computed(() => new Set(sections.value.flatMap((row) => row.questions.map((q) => q.questionId))))

/**
 * 打开这一页时卷面上**本来就有**的题目 id（服务端那一版），两处会刷新它：`load()` 与 `adoptPaper()`。
 *
 * 只给协同处理人的保存用：成员写卷面只能走「增 / 删 / 改」三个增量口子，其中「删」必须知道
 * 「哪些题是我删的」。拿本地 `sections` 与服务端现卷做差集是不行的 —— 同事在我浏览期间往同一段
 * 加的题，在我这份快照里也没有，一保存就会被当成「我删的」而真删掉。
 * 记一份开页基线，判据就变成「基线上有、我本地没有」= 我删的，与别人的改动无关。
 */
const baselineIds = ref<Set<number>>(new Set())

/** 本卷对应的协同组卷任务（有则「协同组卷」按钮直接展开右栏的组卷信息，而不是又建一个） */
const currentTask = computed(() => collabTasks.value.find((row) => row.paperId === form.id) ?? null)

/* ================= 协同组卷：身份 / 权限 / 进度 =================
 *
 * 这一页上有**两个互不相干的「我」**，混用就是事故：
 *
 * | 身份 | 取自 | 决定 |
 * | --- | --- | --- |
 * | 登录人 `myName` | 会话用户 `auth.user`（演示身份，由顶栏切换） | **审批**：谁能验收 / 退回 / 送审 |
 * | 组卷身份 `activeName` | 本页「以此身份编辑」下拉 | **能编辑哪个大题**、能否改全局设置 |
 *
 * 所以审批类按钮的 `v-if` 只认 `myName`，权限类判断只认 `activeName`；
 * 两者不做双向同步 —— 否则任何一位老师把自己选进下拉就能替发起人验收自己的卷子。
 */
const auth = useAuthStore()
const { identity, apply: applyIdentity } = useDemoRole()

const myName = computed(() => auth.user?.name ?? '')
/** 是不是本卷协同任务的发起人。**没有协同任务时也算**（普通试卷不该被约束） */
const isOwner = computed(() => !currentTask.value || currentTask.value.owner === myName.value)

/**
 * 组卷身份：默认站到登录人本人，他不是处理人时退到第一位处理人。
 * 只影响编辑权限，不回写登录身份。
 */
const activeName = ref('')
const me = computed(() => currentTask.value?.members.find((row) => row.name === activeName.value) ?? null)
const myTypes = computed(() => me.value?.questionTypes ?? [])
/** 只读处理人：`perms` 恰好是 `['只读']`（与 mock 的判定同一口径） */
const readOnlyMember = computed(() => !!me.value && me.value.perms.length === 1 && me.value.perms.includes('只读'))
/** 受分工约束：在协同任务里、且不是发起人。发起人是分工的人，不是被分工的人 */
const collabLimited = computed(() => !!currentTask.value && !isOwner.value)
/** 全局设置 / 卷名 / 插入大题 / 导入文档：只有发起人（或无任务时）能动 */
const canEditPaper = computed(() => !collabLimited.value)

/**
 * 各大题归属的题型：取自題目**自带的** `type` 而不是标题文本 —— 标题是老师随手改的自由文本，
 * 靠它认题型会认错。空大题没有题目可依据，退回按标题认（否则成员那个还没起步的大题
 * 会显示成「不可编辑」，连第一道题都进不去）。
 */
function sectionTypes(si: number): string[] {
  const set = new Set<string>()
  for (const row of sections.value[si]?.questions ?? []) {
    const item = itemOf(row.questionId)
    if (item) set.add(item.type)
  }
  if (!set.size) {
    const byTitle = typeOfSectionTitle(sections.value[si]?.title ?? '')
    if (byTitle) set.add(byTitle)
  }
  return [...set]
}

/** 选中的这个大题我能不能改（发起人一律可以；只读处理人一律不可以） */
function editableSection(si: number): boolean {
  if (!collabLimited.value) return true
  if (readOnlyMember.value) return false
  const types = sectionTypes(si)
  if (!types.length) return false
  return types.every((type) => myTypes.value.includes(type))
}

/** 某道题我能不能改：取决于它所在的大题 */
function editableQuestion(si: number): boolean {
  return editableSection(si) && !readOnlyMember.value
}

/**
 * 卷面此刻还能不能写：没有协同任务（普通试卷）随时可写；协同任务只在**收题中 / 待验收**可写。
 *
 * 与 mock 的 `assertPaperEditable` 同一口径。少了这一条，任务送审之后页面上还能拖题、还能抽题，
 * 一路做到点保存才被打回 —— 力气白花，还让人以为功能坏了。
 */
const paperEditable = computed(
  () => !currentTask.value || currentTask.value.status === 'collecting' || currentTask.value.status === 'reviewing',
)

/** 该大题为什么不能改 —— 禁用按钮上的 title，别让老师以为功能坏了 */
function lockReason(si: number): string {
  if (!collabLimited.value) return ''
  if (readOnlyMember.value) return '你在本任务中是只读权限'
  const owner = currentTask.value?.members.find((row) =>
    sectionTypes(si).some((type) => row.questionTypes.includes(type)),
  )
  return owner ? `「${sections.value[si]?.title ?? '该大题'}」由 ${owner.name} 负责，只能查看` : '该大题未分配给你'
}

/* ---- 目录行的协同进度：姓名 · 已加入/总题数 · 状态 ---- */

const outlineCollabRows = computed(() => {
  const task = currentTask.value
  if (!task) return new Map<number, { memberName: string; memberStatus: string; want: number; have: number; mine: boolean }>()
  const rows = new Map<number, { memberName: string; memberStatus: string; want: number; have: number; mine: boolean }>()
  sections.value.forEach((section, si) => {
    const types = sectionTypes(si)
    const member = task.members.find((row) => types.some((type) => row.questionTypes.includes(type)))
    const want = task.requirement.structure
      .filter((row) => member?.questionTypes.includes(row.type))
      .reduce((sum, row) => sum + row.count, 0)
    rows.set(si, {
      memberName: member?.name ?? '未分配',
      memberStatus: member ? COLLAB_MEMBER_TEXT[member.status] : '—',
      want,
      have: section.questions.length,
      mine: !!member && member.name === activeName.value,
    })
  })
  return rows
})

/* ---- 流程动作：处理人提交 / 发起人验收与送审 ---- */

const taskBusy = ref(false)

/** 能提交「我的部分」：还没交出去（待接受 / 组卷中），且任务还在收题 / 待验收阶段 */
const canSubmitMine = computed(
  () =>
    !!me.value &&
    !isOwner.value &&
    (currentTask.value?.status === 'collecting' || currentTask.value?.status === 'reviewing') &&
    (me.value.status === 'invited' || me.value.status === 'working'),
)
/** 能撤销提交：只有「已提交」可撤回。已验收是终态，撤销按钮不能再冒出来把验收抹掉 */
const canReopenMine = computed(() => !!me.value && !isOwner.value && me.value.status === 'submitted')
/** 待我验收的成员：已提交、发起人还没过目的 */
const pendingAccept = computed(() => currentTask.value?.members.filter((row) => row.status === 'submitted') ?? [])

async function runTaskAction(fn: () => Promise<OrgCollabTask | void>, success: string) {
  if (taskBusy.value) return
  taskBusy.value = true
  try {
    const next = await fn()
    if (next) collabTasks.value = collabTasks.value.map((row) => (row.id === next.id ? next : row))
    showToast(success, 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '操作失败', 'error')
  } finally {
    taskBusy.value = false
  }
}

const submitMine = () =>
  runTaskAction(() => collabSubmitMember({ taskId: currentTask.value!.id, memberName: activeName.value }), '已提交你负责的题型，发起人可开始审校')

const reopenMine = () =>
  runTaskAction(() => collabReopenMember({ taskId: currentTask.value!.id, memberName: activeName.value }), '已撤销提交，可继续修订')

const acceptMember = (member: CollabMember) =>
  runTaskAction(() => collabAcceptMember({ taskId: currentTask.value!.id, memberName: member.name }), `已验收 ${member.name} 负责的题型`)

/* 退回整改要写清楚原因（mock 侧要求 ≥5 字），所以走弹窗而不是点一下就走 */
const rejectTarget = ref<CollabMember | null>(null)
const rejectOpinion = ref('')

function openReject(member: CollabMember) {
  rejectTarget.value = member
  rejectOpinion.value = ''
}

async function submitReject() {
  const target = rejectTarget.value
  if (!target) return
  if (rejectOpinion.value.trim().length < 5) {
    showToast('请填写至少 5 个字的退回意见，说明哪里需要整改', 'error')
    return
  }
  await runTaskAction(
    () => collabRejectMember({ taskId: currentTask.value!.id, memberName: target.name, opinion: rejectOpinion.value.trim() }),
    `已退回给 ${target.name} 整改，任务回到收题中`,
  )
  rejectTarget.value = null
  rejectOpinion.value = ''
}

/** 送审 / 撤回送审 / 驳回后重新开工：都会连卷面一起还回来，得把 sections 换掉重排 */
async function runReviewAction(fn: () => Promise<{ task: OrgCollabTask; paper: OrgPaper }>, success: string) {
  if (taskBusy.value) return
  taskBusy.value = true
  try {
    const { task: next, paper: nextPaper } = await fn()
    collabTasks.value = collabTasks.value.map((row) => (row.id === next.id ? next : row))
    adoptPaper(nextPaper)
    showToast(success, 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '操作失败', 'error')
  } finally {
    taskBusy.value = false
  }
}

const submitForReview = () =>
  runReviewAction(
    () => collabSubmitReview({ taskId: currentTask.value!.id }),
    '已提交审核，可在「试卷审核中心」跟进结果',
  )

const withdrawReview = () =>
  runReviewAction(() => collabWithdrawReview({ taskId: currentTask.value!.id }), '已撤回送审，任务回到待送审')

const reopenAfterReject = () =>
  runReviewAction(
    () => collabReopenAfterReject({ taskId: currentTask.value!.id }),
    '已退回修改，全员回到组卷中，改完请重新提交',
  )

/** 把服务端回来的权威卷面换进编辑区：换完必须重新量宽，否则分版还按旧内容算 */
function adoptPaper(next: OrgPaper) {
  /* 换进来的这一份**不是用户的改动**，别让它触发自动保存：保存的回执会换掉 `sections`
     （每次都是新数组），deep watcher 一响就又保存一次 —— 保存 → 回执 → 保存，
     一个 1.5 秒一圈的死循环。置位到本帧的 watcher 跑完为止即可。 */
  adopting = true
  sections.value = JSON.parse(JSON.stringify(next.sections)) as PaperSection[]
  sectionSeq = Math.max(...sections.value.map((row) => row.id), sectionSeq - 1, 0) + 1
  baselineIds.value = new Set(sections.value.flatMap((row) => row.questions.map((q) => q.questionId)))
  meta.status = next.status
  /* 服务端卷面是新的基准：本地撤销栈指向的是换进来之前的内容，留着会把别人的改动撤回来 */
  snapshots.value = []
  pointer.value = -1
  commit('同步协同进度')
  void nextTick(scheduleMeasure)
  void nextTick(() => {
    adopting = false
  })
}

/**
 * 正在把服务端回执换进卷面（`adoptPaper` 置位、下一帧清掉）。
 *
 * 它是自动保存的**死循环闸门**：没有它，「保存 → 服务端还回整卷 → sections 变了 → 再保存」
 * 会以 1.5 秒一圈永远转下去，版本记录跟着刷屏。
 */
let adopting = false

/* ================= 版式（全文设置） ================= */

const layoutKey = ref(PAPER_LAYOUTS[0].key)
const sizeKey = ref<PaperSizeKey>('A4')
const orientation = ref<PaperOrientation>('portrait')
const panelPick = ref(0)
/** 卷首 / 分值位置 / 答题留白 / 页码可单独覆盖版式预设，不必为了改一项换整套样式 */
const headOverride = ref<PaperLayoutPreset['headStyle'] | ''>('')
const scoreOverride = ref<PaperLayoutPreset['scoreStyle'] | ''>('')
const spaceOverride = ref<boolean | null>(null)
const panelRail = ref<'' | 'settings' | 'collab' | 'bank' | 'media' | 'basket' | 'import' | 'history'>('settings')
const outlineOpen = ref(true)
const zoom = ref(1)
const autoFit = ref(true)

const preset = computed<PaperLayoutPreset>(() => {
  const base = presetOf(layoutKey.value)
  return {
    ...base,
    headStyle: headOverride.value || base.headStyle,
    scoreStyle: scoreOverride.value || base.scoreStyle,
    answerSpace: spaceOverride.value === null ? base.answerSpace : spaceOverride.value,
  }
})
const size = computed(() => PAPER_SIZES.find((row) => row.key === sizeKey.value) ?? PAPER_SIZES[0])
const geo = computed(() => paperGeometry(size.value, orientation.value, preset.value, panelPick.value))
const vars = computed(() => presetVars(preset.value))

/* ================= 纸面块 ================= */

/**
 * 排版块 + 归属信息。用交叉类型而不是 interface extends：`PaperBlock` 是联合类型，
 * interface 不能继承联合；交叉类型会自动分配到每个成员（A|B & C = (A&C)|(B&C)）。
 */
type EditBlock = PaperBlockModel & {
  /** 归属：大题下标 / 小题下标（卷头为空） */
  si?: number
  qi?: number
}
const NUMBERS = '一二三四五六七八九十'
const NUMBERED_TITLE = /^([一二三四五六七八九十]+[、.．]|（[一二三四五六七八九十]+）|第[一二三四五六七八九十百]+[部分章节]|\d+[、.．])/

/**
 * 大题的**卷面标题**：原文自己带了「一、」这类序号就用原文，没带就按位置补一个。
 *
 * 抽成函数是因为它有两个使用方：卷面块（下面 `paperBlocks` 印在纸上）与评论抽屉标题
 * （「评论 · 一、选择题 · 第 3 题」）。抽屉只写「选择题」的话，跟卷面上印的对不上号。
 */
function sectionTitleOf(si: number): string {
  const raw = sections.value[si]?.title.trim() ?? ''
  return NUMBERED_TITLE.test(raw) ? raw : `${NUMBERS[si] ?? si + 1}、${raw}`
}

const paperBlocks = computed<EditBlock[]>(() => {
  const list: EditBlock[] = [{ key: 'p-head', kind: 'head', span: 2 }]
  let no = 0
  sections.value.forEach((section, si) => {
    const rows = section.questions.map((entry, qi) => {
      no += 1
      return { no, qi, questionId: entry.questionId, score: Number(entry.score) || 0 }
    })
    const score = rows.reduce((sum, row) => sum + row.score, 0)
    const first = rows[0]?.score ?? 0
    const perScore = rows.length > 0 && rows.every((row) => row.score === first) ? first : null
    list.push({
      key: `p-s-${si}`,
      kind: 'section',
      span: 2,
      si,
      title: sectionTitleOf(si),
      count: rows.length,
      score,
      perScore,
    })
    const material = section.material?.trim() ?? ''
    const hint = section.materialHint?.trim() ?? ''
    if (material || hint) list.push({ key: `p-m-${si}`, kind: 'material', span: 2, si, hint, text: material })
    rows.forEach((row) => {
      list.push({
        key: `p-q-${si}-${row.qi}`,
        kind: 'question',
        span: geo.value.subCols === 2 && isObjective(itemOf(row.questionId)) ? 1 : 2,
        si,
        qi: row.qi,
        no: row.no,
        questionId: row.questionId,
        score: row.score,
      })
    })
  })
  /* 附加区块（表格 / 四线格 / 横线）排在全部答题区之后。
     顺序必须与 PaperPreviewModal 一致（那里也是 append 在最后），否则预览里的换页位置
     与本页对不上 —— 而本页的卖点就是「所见即所得」。 */
  extras.value.forEach((extra) => list.push({ key: `p-extra-${extra.id}`, kind: 'extra', span: 2, extra }))
  return list
})

/* ================= 测量 + 分版（与整卷预览同一套算法） ================= */

const measureHost = ref<HTMLElement | null>(null)
const heights = ref<Record<string, number>>({})
const measured = ref(false)
let frame = 0

function measureNow() {
  const host = measureHost.value
  if (!host) return
  const next: Record<string, number> = {}
  host.querySelectorAll<HTMLElement>('[data-block-key]').forEach((el) => {
    const key = el.dataset.blockKey
    if (key) next[key] = el.getBoundingClientRect().height
  })
  heights.value = next
  measured.value = true
}

function scheduleMeasure() {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    measureNow()
  })
}

function measureWidth(block: EditBlock): string {
  return `${block.span === 1 ? geo.value.colW : geo.value.panelW}px`
}

function heightOf(block: EditBlock): number {
  return (heights.value[block.key] ?? 0) + preset.value.gap
}

const pages = computed<PaperPage[]>(() =>
  paperBlocks.value.length ? paginateBlocks({ blocks: paperBlocks.value, heightOf, pageHeight: geo.value.contentH }) : [],
)
const sheets = computed(() => {
  const perSheet = geo.value.panels
  const out: Array<{ key: string; index: number; total: number; pages: PaperPage[] }> = []
  const total = Math.ceil(pages.value.length / perSheet)
  for (let i = 0; i < pages.value.length; i += perSheet) {
    out.push({ key: `sheet-${i}`, index: i / perSheet + 1, total, pages: pages.value.slice(i, i + perSheet) })
  }
  return out
})

const overflowBlocks = computed(() =>
  paperBlocks.value.filter((block) => (heights.value[block.key] ?? 0) + preset.value.gap > geo.value.contentH),
)

/* ================= 缩放 ================= */

const canvas = ref<HTMLElement | null>(null)
const canvasW = ref(1000)

function fitZoom() {
  const usable = Math.max(280, canvasW.value - 72)
  return Math.min(1.2, Math.max(0.25, usable / geo.value.sheetW))
}

function nudgeZoom(delta: number) {
  /* 手调过缩放就不再是「适应宽度」—— 留着选中会让下一次窗口变化把用户的缩放悄悄冲掉 */
  autoFit.value = false
  zoom.value = Math.min(1.6, Math.max(0.25, Number((zoom.value + delta).toFixed(2))))
}

/** 输入框里的纯数字（`%` 由旁边的 span 画，两者才好在同一行里上下居中） */
const zoomText = computed(() => String(Math.round(zoom.value * 100)))

/**
 * 手输缩放百分比。非法输入（空、非数字、0 或负数）不改 `zoom`，
 * 但**必须把输入框写回显示值** —— `:value` 绑的是 `zoom`，值没变 Vue 就不会重渲染这一格，
 * 浏览器里会一直留着用户敲进去的那串乱码。
 */
function onZoomInput(event: Event) {
  const input = event.target as HTMLInputElement
  const value = Number(input.value.replace(/[^\d.]/g, ''))
  if (Number.isFinite(value) && value > 0) {
    autoFit.value = false
    zoom.value = Math.min(1.6, Math.max(0.25, Number((value / 100).toFixed(2))))
  }
  input.value = zoomText.value
}

const sheetStyle = computed(() => ({
  width: `${geo.value.sheetW}px`,
  height: `${geo.value.sheetH}px`,
  paddingTop: `${geo.value.padTop}px`,
  paddingRight: `${geo.value.padRight}px`,
  paddingBottom: `${geo.value.padBottom}px`,
  paddingLeft: `${geo.value.padLeft}px`,
  transform: `scale(${zoom.value})`,
  '--pp-col-gap': `${geo.value.panelW - geo.value.colW * 2}px`,
  '--pp-panel-gap': `${geo.value.panelGap}px`,
  '--pp-panel-w': `${geo.value.panelW}px`,
  ...vars.value,
}))
const sheetWrapStyle = computed(() => ({
  width: `${geo.value.sheetW * zoom.value}px`,
  height: `${geo.value.sheetH * zoom.value}px`,
}))
const bodyStyle = computed(() => ({ height: `${geo.value.contentH}px` }))
const colGap = computed(() => geo.value.panelW - geo.value.colW * 2)

/* ================= 选中与块操作 ================= */

type Selection =
  | { kind: 'head' }
  | { kind: 'section'; si: number }
  | { kind: 'material'; si: number }
  | { kind: 'question'; si: number; qi: number }
  /** 附加区块（表格 / 四线格 / 横线）：按 id 选中，不归任何大题 */
  | { kind: 'extra'; id: number }

const selected = ref<Selection | null>({ kind: 'head' })

/**
 * 选中的块能不能改。卷头 / 附加区块是**卷级内容**，看发起人身份（`canEditPaper`）；
 * 大题 / 材料 / 题目看这一段的归属（`editableSection`）。
 */
const selectedEditable = computed(() => {
  const sel = selected.value
  if (!sel) return true
  if (sel.kind === 'head' || sel.kind === 'extra') return canEditPaper.value
  return editableSection(sel.si)
})

const selectedLockReason = computed(() => {
  const sel = selected.value
  if (!sel) return ''
  if (sel.kind === 'head') return '卷头由发起人维护'
  if (sel.kind === 'extra') return '卷面附加区块由发起人维护'
  return lockReason(sel.si)
})

/**
 * 画面上这一块是不是「只能看」。
 *
 * 只做视觉标记，**不阻断点击** —— 老师还得能点开它看题、看评论；
 * 真正拦住改动的是一条条编辑动作上的判断（工具条、加题、移动）。
 */
function blockLocked(block: EditBlock): boolean {
  if (block.kind === 'head' || block.kind === 'extra') return !canEditPaper.value
  return block.si != null && !editableSection(block.si)
}

/** 块 key → 编辑块（带归属）：分版后的块是基础类型，靠 key 反查回带归属的那一份 */
const blockMap = computed(() => new Map(paperBlocks.value.map((row) => [row.key, row])))

function selectKey(key: string) {
  const block = blockMap.value.get(key)
  if (block) selectBlock(block)
}

function isSelectedKey(key: string): boolean {
  const block = blockMap.value.get(key)
  return block ? isSelected(block) : false
}

function selectBlock(block: EditBlock) {
  if (block.kind === 'head') selected.value = { kind: 'head' }
  else if (block.kind === 'section' && block.si != null) selected.value = { kind: 'section', si: block.si }
  else if (block.kind === 'material' && block.si != null) selected.value = { kind: 'material', si: block.si }
  else if (block.kind === 'question' && block.si != null && block.qi != null) {
    selected.value = { kind: 'question', si: block.si, qi: block.qi }
  } else if (block.kind === 'extra') selected.value = { kind: 'extra', id: block.extra.id }
  scrollToKey(block.key)
}

function isSelected(block: EditBlock): boolean {
  const sel = selected.value
  if (!sel) return false
  if (sel.kind === 'head') return block.kind === 'head'
  if (sel.kind === 'extra') return block.kind === 'extra' && block.extra.id === sel.id
  if (block.si !== sel.si) return false
  if (sel.kind === 'section') return block.kind === 'section'
  if (sel.kind === 'material') return block.kind === 'material'
  return block.kind === 'question' && block.qi === sel.qi
}

const selectedQuestion = computed(() => {
  const sel = selected.value
  if (sel?.kind !== 'question') return null
  const entry = sections.value[sel.si]?.questions[sel.qi]
  return entry ? { ...entry, item: itemOf(entry.questionId) } : null
})
const selectedSection = computed(() => {
  const sel = selected.value
  if (sel?.kind !== 'section' && sel?.kind !== 'material') return null
  return sections.value[sel.si] ?? null
})

/* ================= 附加区块（表格 / 四线格 / 横线） ================= */

/** 「插入」下拉的菜单项：与 paper-layouts 的 PAPER_EXTRAS 同一份，加第四种格型只改那一处 */
const extraItems = PAPER_EXTRAS.map((row) => ({ key: row.kind, label: row.text, icon: row.icon }))

const selectedExtra = computed(() => {
  const sel = selected.value
  return sel?.kind === 'extra' ? extras.value.find((row) => row.id === sel.id) ?? null : null
})
/** 块工具条上的块名（取菜单里那份文案，不另写一份中文） */
const selectedExtraText = computed(() => extraTextOf(selectedExtra.value?.kind))

/** 附加区块的显示名：菜单里那份文案是唯一一份，各处都从这里取 */
function extraTextOf(kind: PaperExtraKind | undefined): string {
  return PAPER_EXTRAS.find((row) => row.kind === kind)?.text ?? '附加区块'
}

/** 附加区块的图标：与菜单同一份配置，目录行与菜单里长得一样 */
function extraIconOf(kind: PaperExtraKind | undefined): string {
  return PAPER_EXTRAS.find((row) => row.kind === kind)?.icon ?? 'grid'
}

/**
 * 插入一个附加区块：**追加到卷末**并立刻选中它（选中才会出现块工具条，行列数在那里调）。
 *
 * 为什么不做「插到当前选中块之后」：卷面顺序由大题、小题决定，插在中间就得把 `extras`
 * 与 `sections` 的次序交织起来存，保存格式、分版、预览三处都得跟着改；而实际用法就是
 * 「给最后那道作文题配一张作文纸」，追加到卷末已经够用。
 *
 * 不 commit 进撤销栈 —— 与 `attachments` 同一口径（见 `extras` 的声明）。插错了，
 * 在块工具条上删掉即可，比「先撤销卷面改动、再重来一遍」轻得多。
 */
function insertExtra(kind: string) {
  const extra = makePaperExtra(kind as PaperExtraKind, extraSeq++)
  extras.value = [...extras.value, extra]
  selected.value = { kind: 'extra', id: extra.id }
  scrollToKey(`p-extra-${extra.id}`)
  /* 只有表格有列数可调，四线格与横线都是通栏 —— 提示里别报一个调不了的量 */
  const sizeText = extra.kind === 'table' ? '行列数' : '行数'
  showToast(`${extraTextOf(extra.kind)}已加在卷末，可在块工具条里调${sizeText}`, 'success')
}

/** 把某个块滚进视野（`nearest`：已经在视野里就不动，别把老师正在看的地方推走） */
function scrollToKey(key: string) {
  nextTick(() => {
    document.querySelector(`[data-block="${key}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  })
}

/** 改**当前选中**附加区块的行 / 列数：夹在 1~40，防止手滑输入 0 或 999 把分版算爆 */
function setExtraSize(key: 'rows' | 'cols', value: number) {
  const target = selectedExtra.value
  if (!target) return
  const size = Math.min(40, Math.max(1, Math.round(Number(value) || 0)))
  extras.value = extras.value.map((row) => (row.id === target.id ? { ...row, [key]: size } : row))
}

function removeExtra() {
  const target = selectedExtra.value
  if (!target) return
  extras.value = extras.value.filter((row) => row.id !== target.id)
  /* 块没了就把选中退回卷头，否则块工具条会停在卷面上已经不存在的那个块上 */
  selected.value = { kind: 'head' }
}

/* ================= 本地历史（撤销 / 重做 / 历史记录面板） ================= */

interface Snapshot {
  label: string
  time: string
  data: PaperSection[]
}

const snapshots = ref<Snapshot[]>([])
const pointer = ref(-1)

function commit(label: string) {
  snapshots.value = snapshots.value.slice(0, pointer.value + 1)
  snapshots.value.push({ label, time: nowText(), data: JSON.parse(JSON.stringify(sections.value)) as PaperSection[] })
  if (snapshots.value.length > 60) snapshots.value.shift()
  pointer.value = snapshots.value.length - 1
}

function applySnapshot(index: number) {
  const row = snapshots.value[index]
  if (!row) return
  pointer.value = index
  sections.value = JSON.parse(JSON.stringify(row.data)) as PaperSection[]
  selected.value = { kind: 'head' }
  nextTick(scheduleMeasure)
}

const canUndo = computed(() => pointer.value > 0)
const canRedo = computed(() => pointer.value < snapshots.value.length - 1)

function undo() {
  if (!canUndo.value) return
  applySnapshot(pointer.value - 1)
  showToast(`已撤销：${snapshots.value[pointer.value + 1]?.label ?? ''}`)
}
function redo() {
  if (!canRedo.value) return
  applySnapshot(pointer.value + 1)
}

/* ================= 卷面编辑操作 ================= */

function ensureSectionFor(type: string): number {
  const hit = findSectionIndex(sections.value, sectionLabelOf(type), sectionKeywordsOf(type))
  if (hit >= 0) return hit
  if (sections.value.length >= MAX_SECTIONS) {
    showToast(`大题已达 ${MAX_SECTIONS} 个上限，题目已加入最后一个大题`, 'error')
    return sections.value.length - 1
  }
  sections.value.push({
    id: sectionSeq++,
    title: makeSectionTitle(sectionLabelOf(type), sections.value.length),
    questions: [],
  })
  return sections.value.length - 1
}

function addQuestion(row: OrgQuestion, silent = false): boolean {
  /* 第二道闸（与 mock 的 collabAddQuestions 同一口径）：题库面板会按题型过滤，但
     组卷车、导入文档、AI 抽题都汇到这一个函数上 —— 只在面板上挡住等于没挡。 */
  if (collabLimited.value && !myTypes.value.includes(row.type)) {
    if (!silent) {
      showToast(`你只负责「${myTypes.value.join('、') || '未分配题型'}」，不能把「${row.type}」加入试卷`, 'error')
    }
    return false
  }
  if (inPaperIds.value.has(row.id)) {
    if (!silent) showToast('该题已在卷中', 'error')
    return false
  }
  const si = ensureSectionFor(row.type)
  sections.value[si].questions.push({ questionId: row.id, score: defaultScore(row.type) })
  if (!silent) commit(`加入「${truncateRich(row.stem, 14)}…」到${sections.value[si].title}`)
  nextTick(scheduleMeasure)
  return true
}

function removeQuestion(si: number, qi: number) {
  const [removed] = sections.value[si].questions.splice(qi, 1)
  if (!removed) return
  selected.value = { kind: 'head' }
  commit(`移除第 ${qi + 1} 题`)
  nextTick(scheduleMeasure)
}

function moveQuestion(si: number, qi: number, delta: number) {
  const target = qi + delta
  const list = sections.value[si].questions
  if (target < 0 || target >= list.length) {
    showToast(delta < 0 ? '已经是本大题第一题' : '已经是本大题最后一题')
    return
  }
  const [row] = list.splice(qi, 1)
  list.splice(target, 0, row)
  selected.value = { kind: 'question', si, qi: target }
  commit('调整题目顺序')
  nextTick(scheduleMeasure)
}

/** 跨大题移动：把题移到相邻大题的末尾/开头（题型与大题不一致时由教师自行负责） */
function moveQuestionAcross(si: number, qi: number, delta: number) {
  const target = si + delta
  if (target < 0 || target >= sections.value.length) {
    showToast('已经是第一个/最后一个大题')
    return
  }
  /* 处理人不能把题挪进别人的大题：那等于往别人负责的段落里塞题 */
  if (!editableSection(target)) {
    showToast(`「${sections.value[target].title}」不由你负责，不能并入`, 'error')
    return
  }
  const [row] = sections.value[si].questions.splice(qi, 1)
  const list = sections.value[target].questions
  if (delta < 0) list.push(row)
  else list.unshift(row)
  selected.value = { kind: 'question', si: target, qi: delta < 0 ? list.length - 1 : 0 }
  commit(`移到${sections.value[target].title}`)
  nextTick(scheduleMeasure)
}

/* ================= 拖拽排序（只在本大题内） =================
 *
 * 用原生 HTML5 拖拽，不引 vuedraggable / sortablejs：仓库两个都没装，而这里要的只是
 * 「同一条大题里换次序」这一件事。写法照 `compose/ComposeBasketPanel.vue` 那一份
 * （包括 Firefox 不 `setData` 就不派发 drop 的坑）。
 *
 * 「不许跨大题」由**不调 `preventDefault()`** 表达：浏览器据此显示禁止光标、并且不派发 drop，
 * 比在 drop 里拒绝更早也更清楚。工具条上的「并入上一大题」按钮仍然保留 ——
 * 那是显式的跨段动作，与手滑拖过去是两件事。
 */

/** 正在搬的那一道题（null = 没在拖）。`key` 用来给块加 `.is-dragging` */
const dragFrom = ref<{ si: number; qi: number; key: string } | null>(null)
/** 指针当前指示的插入位：`after` 表示插在该块之后 */
const dropAt = ref<{ key: string; after: boolean } | null>(null)

/**
 * 能拖动排序：这道题归我、卷面处于可写阶段、且**本大题里不止一道题**
 * （只有一题时没有可排的顺序，露一个把手等于骗人）。
 */
function draggableBlock(block: EditBlock): boolean {
  if (block.kind !== 'question' || block.si == null || block.qi == null) return false
  if (!paperEditable.value || !editableQuestion(block.si)) return false
  return (sections.value[block.si]?.questions.length ?? 0) > 1
}

/** 块上的拖拽相关类名：正在拖的那一块、以及插入指示线画在哪一侧 */
function dragClass(block: EditBlock) {
  const hit = dropAt.value && dropAt.value.key === block.key ? dropAt.value : null
  return {
    'is-dragging': dragFrom.value?.key === block.key,
    'is-drop-before': !!hit && !hit.after,
    'is-drop-after': !!hit && hit.after,
  }
}

function onDragStart(block: EditBlock, event: DragEvent) {
  if (!draggableBlock(block) || block.si == null || block.qi == null) {
    event.preventDefault()
    return
  }
  dragFrom.value = { si: block.si, qi: block.qi, key: block.key }
  dropAt.value = null
  /* Firefox 不写 dataTransfer 就整个不启动拖拽；effectAllowed 让光标知道这是「搬动」不是「复制」 */
  event.dataTransfer?.setData('text/plain', block.key)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function onDragOver(block: EditBlock, event: DragEvent) {
  const from = dragFrom.value
  if (!from || block.kind !== 'question' || block.si == null || block.qi == null) return
  if (block.si !== from.si || !editableQuestion(block.si)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  dropAt.value = { key: block.key, after: event.clientY > rect.top + rect.height / 2 }
}

function onDrop(block: EditBlock, event: DragEvent) {
  const from = dragFrom.value
  if (!from || block.si == null || block.qi == null || block.si !== from.si) return
  event.preventDefault()
  const after = dropAt.value?.key === block.key ? dropAt.value.after : false
  /* 落点折算成「把被拖那题拿掉之后」的下标：先按当前下标算目标位，再减掉被拖题在它前面占的一格 */
  let to = block.qi + (after ? 1 : 0)
  if (from.qi < to) to -= 1
  const { si, qi } = from
  endDrag()
  if (to !== qi) reorderQuestion(si, qi, to)
}

/** 拖拽收尾：成功、被拒、拖到窗口外松手，都走这里把状态清干净（否则指示线会留在页面上） */
function endDrag() {
  dragFrom.value = null
  dropAt.value = null
}

/** 拖拽落位：把 `fromQi` 挪到 `toQi`（`toQi` 是**移除之后**的目标下标） */
function reorderQuestion(si: number, fromQi: number, toQi: number) {
  const list = sections.value[si]?.questions
  if (!list || fromQi === toQi || fromQi < 0 || fromQi >= list.length) return
  const [row] = list.splice(fromQi, 1)
  const at = Math.min(Math.max(toQi, 0), list.length)
  list.splice(at, 0, row)
  selected.value = { kind: 'question', si, qi: Math.min(at, list.length - 1) }
  commit('拖动调整题目顺序')
  nextTick(scheduleMeasure)
}

function setScore(si: number, qi: number, value: number) {
  const score = Number(value)
  if (!(score >= 0.5 && score <= 100)) {
    showToast('单题分值须在 0.5 ~ 100 之间', 'error')
    return
  }
  sections.value[si].questions[qi].score = score
  commit(`调整第 ${qi + 1} 题分值为 ${score} 分`)
  nextTick(scheduleMeasure)
}

/** 整题分值批量套用：同题型统一改分是命题时的高频动作 */
function applySectionScore(si: number, value: number) {
  const score = Number(value)
  if (!(score >= 0.5 && score <= 100)) {
    showToast('单题分值须在 0.5 ~ 100 之间', 'error')
    return
  }
  sections.value[si].questions.forEach((row) => (row.score = score))
  commit(`「${sections.value[si].title}」每题统一 ${score} 分`)
  nextTick(scheduleMeasure)
}

function addSection() {
  /* 卷面结构由发起人定：处理人插大题会直接打乱「谁负责哪一段」的分工 */
  if (!canEditPaper.value) {
    showToast('大题结构由发起人维护，你可以在自己负责的题型里选题入卷', 'error')
    return
  }
  if (sections.value.length >= MAX_SECTIONS) {
    showToast(`大题最多 ${MAX_SECTIONS} 个`, 'error')
    return
  }
  sections.value.push({ id: sectionSeq++, title: makeSectionTitle('新大题', sections.value.length), questions: [] })
  selected.value = { kind: 'section', si: sections.value.length - 1 }
  commit('新增大题')
  nextTick(scheduleMeasure)
}

async function removeSection(si: number) {
  if (!canEditPaper.value) {
    showToast('大题结构由发起人维护，你只能修改自己负责的题型', 'error')
    return
  }
  if (sections.value.length <= 1) {
    showToast('至少保留 1 个大题', 'error')
    return
  }
  if (!(await appConfirm(`删除《${sections.value[si].title}》及其 ${sections.value[si].questions.length} 道题？`, { type: 'danger' }))) return
  sections.value.splice(si, 1)
  selected.value = { kind: 'head' }
  commit('删除大题')
  nextTick(scheduleMeasure)
}

function moveSection(si: number, delta: number) {
  const target = si + delta
  if (target < 0 || target >= sections.value.length) return
  const [row] = sections.value.splice(si, 1)
  sections.value.splice(target, 0, row)
  selected.value = { kind: 'section', si: target }
  commit('调整大题顺序')
  nextTick(scheduleMeasure)
}

function renameSection(si: number, title: string) {
  sections.value[si].title = title
  commit(`大题改名为「${title}」`)
}

function setMaterial(si: number, text: string) {
  sections.value[si].material = text
  commit('编辑大题材料')
  nextTick(scheduleMeasure)
}

/** 右侧材料框：写入当前选中的大题（材料块与大题块都指向同一个 si） */
function updateMaterial(text: string) {
  const sel = selected.value
  if (sel?.kind !== 'section' && sel?.kind !== 'material') return
  setMaterial(sel.si, text)
}

async function onSwap() {
  const sel = selected.value
  if (sel?.kind !== 'question' || !form.id) {
    showToast('请先保存草稿后再使用「换一题」', 'error')
    return
  }
  const entry = sections.value[sel.si].questions[sel.qi]
  try {
    const { newId } = await swapPaperQuestion(form.id, entry.questionId)
    entry.questionId = newId
    await refreshQuestions()
    commit(`第 ${sel.qi + 1} 题换为同构题 #${newId}`)
    showToast(`已替换为同构题 #${newId}（消耗 1 次额度）`, 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '替换失败', 'error')
  }
}

/* ================= 右侧面板：试题库 ================= */

const bankFilter = reactive({ type: '', difficulty: '', keyword: '' })
const bankPool = computed(() =>
  questions.value.filter(
    (row) =>
      row.status === 'approved' &&
      /* 协同处理人只看得到自己负责的题型：列出来再让他点一下弹「不能加」，
         等于把别人的题白给他看一遍 —— 分工的约束应该体现在**看得到什么**上 */
      (!collabLimited.value || myTypes.value.includes(row.type)) &&
      (!bankFilter.type || row.type === bankFilter.type) &&
      (!bankFilter.difficulty || row.difficulty === bankFilter.difficulty) &&
      (!bankFilter.keyword || toPlainText(row.stem).includes(bankFilter.keyword)),
  ),
)

/** 试题库的题型下拉：协同处理人只列自己那几个题型，别让他选到注定加不进去的 */
const bankTypes = computed(() =>
  collabLimited.value ? myTypes.value : withCurrent(questionTypesFor(form.subject), bankFilter.type),
)

/* ================= 智能选题 =================
 *
 * 「按当前协同组卷的基本要求 + 我负责的范围，从题库抽题插入试卷」这件事，
 * mock 侧的 `collabAiCompose` 已经完整实现了（只抽我负责的题型、按结构要求算题数缺口、
 * 按「同年级同科 + 命中考纲知识点」排序、题库不足时可允许 AI 新生成），此前**全仓没有一个入口**。
 * 这里补的就是那个入口，外加一层「什么时候不该给用」的判断。
 */

const smartOpen = ref(false)
const smartRunning = ref(false)
const smartForm = reactive({ type: '', count: 0, difficulty: '', allowGenerate: false })

/** 某个题型范围下的「要求 / 已有」。口径来自 `paper-sections` 的 `memberQuotaOf`，与提交校验同一份 */
function quotaFor(types: string[]) {
  return currentTask.value
    ? memberQuotaOf(sections.value, (id) => itemOf(id)?.type, currentTask.value.requirement, types)
    : []
}

/** 我负责的题型逐项的缺口（智能选题弹窗里标「已有 5 / 要求 8」用的就是它） */
const myProgress = computed(() => quotaFor(myTypes.value))

/** 当前选中题型的缺口题数，也是「题数」输入框的上限与默认值 */
const smartGap = computed(() => {
  const row = myProgress.value.find((item) => item.type === smartForm.type)
  return row ? Math.max(0, row.want - row.have) : 0
})

/**
 * 什么时候不给用。逐条说明**为什么**，按钮的 `title` 直接用它 —— 判据与 `saveAsMember`
 * 是同一套（同一件事不该有两份口径），只是这里要在点之前就说清楚。
 */
const smartBlockReason = computed(() => {
  if (!currentTask.value) return '本卷没有协同组卷任务，智能选题只在协同组卷里可用'
  if (!me.value) return '你在本任务中没有组卷分工，智能选题按分工范围抽题'
  if (readOnlyMember.value) return '你在本任务中是只读权限'
  if (!paperEditable.value) return `任务已「${COLLAB_STATUS_TEXT[currentTask.value.status]}」，请让发起人先退回修改`
  if (!myTypes.value.length) return '本任务没有分配题型给你'
  return ''
})
const canSmartPick = computed(() => !smartBlockReason.value)

function openSmartPick() {
  if (!canSmartPick.value) {
    showToast(smartBlockReason.value, 'error')
    return
  }
  /* 默认落在「还有缺口」的第一个题型上：打开这个弹窗多半就是为了补齐某一段，
     已经收满的题型默认值没有意义 */
  const row = myProgress.value.find((item) => item.have < item.want) ?? myProgress.value[0]
  smartForm.type = row?.type ?? ''
  smartForm.count = row ? Math.max(1, row.want - row.have) : 1
  smartForm.difficulty = ''
  smartForm.allowGenerate = false
  smartOpen.value = true
}

/* 换题型就把题数跟着换成该题型的缺口 —— 否则会带着上一个题型填的数字去抽题 */
watch(
  () => smartForm.type,
  (type) => {
    const row = myProgress.value.find((item) => item.type === type)
    smartForm.count = row ? Math.max(1, row.want - row.have) : 1
  },
)

/** 顶栏「插入题目」下拉的两条路：人工翻题库 / 按组卷要求智能抽题 */
const insertQuestionItems = computed(() => [
  { key: 'bank', label: '从试题库选题', icon: 'plus' },
  {
    key: 'smart',
    label: canSmartPick.value ? '智能选题（按组卷要求抽题）' : '智能选题（当前不可用）',
    icon: 'sparkles',
    disabled: !canSmartPick.value,
  },
])

function onInsertQuestion(key: string) {
  if (key === 'bank') {
    panelRail.value = panelRail.value === 'bank' ? '' : 'bank'
    return
  }
  openSmartPick()
}

async function runSmartPick() {
  const task = currentTask.value
  if (!task || !canSmartPick.value || smartRunning.value) return
  if (!smartForm.type) {
    showToast('请选择要抽取的题型', 'error')
    return
  }
  smartRunning.value = true
  try {
    const res = await collabAiCompose({
      taskId: task.id,
      memberName: activeName.value,
      type: smartForm.type,
      count: smartForm.count || undefined,
      difficulty: smartForm.difficulty || undefined,
      allowGenerate: smartForm.allowGenerate,
    })
    adoptPaper(res.paper)
    /* `allowGenerate` 新造的题是刚写进题库的：不重拉，卷面上这几道就查不到题源（题干位置空白） */
    await refreshQuestions()
    await refreshTask()
    smartOpen.value = false
    const extra = res.generated ? `，并新生成 ${res.generated} 道待审题` : ''
    showToast(`已为「${smartForm.type}」抽取 ${res.picked.length} 道题${extra}`, 'success')
  } catch (error) {
    /* mock 的报错本身就是写给用户看的（「你只负责『单选』，不能为『填空』抽题」
       「『单选』已按题型要求收满 8 题」「题库中可选题不足，请补充题库或允许 AI 新生成」），原样透出 */
    showToast(error instanceof Error ? error.message : '智能选题失败', 'error')
  } finally {
    smartRunning.value = false
  }
}

/* ================= 右侧面板：媒体库 ================= */

const media = ref<OrgMedia[]>([])
const mediaOpen = ref<OrgMedia | null>(null)

/* ================= 右侧面板：导入文档 ================= */

const importText = ref('')
const importGrade = ref('')
const importDifficulty = ref('')
const importRunning = ref(false)

interface ParsedItem {
  stem: string
  type: string
  options: string[]
}

/**
 * 粘贴文本 → 题目。
 *
 * 只做**确定性**的切分与题型判定，不调用 AI：教师从 Word 复制来的题目大多已带题号，
 * 能靠规则切准；猜不出的（无题号又无空行）宁可整段作为一道题交给人工改，也不擅自拆散。
 */
function parseImportText(text: string): ParsedItem[] {
  const raw = text.replace(/\r\n?/g, '\n').trim()
  if (!raw) return []
  const numbered = /^(?:\d{1,2}[、.．)）]|第\s*\d{1,2}\s*题)/m.test(raw)
  const chunks = numbered
    ? raw.split(/\n(?=\s*(?:\d{1,2}[、.．)）]|第\s*\d{1,2}\s*题))/)
    : raw.split(/\n{2,}/)
  return chunks
    .map((chunk) => {
      const lines = chunk
        .split('\n')
        .map((row) => row.trim())
        .filter(Boolean)
      const options: string[] = []
      const stemLines: string[] = []
      lines.forEach((line) => {
        /* 选项行：A．/ A./ A、/ A) 开头 */
        const opt = line.match(/^([A-F])[、.．)）]\s*(.+)$/)
        if (opt) options.push(opt[2].trim())
        else stemLines.push(line.replace(/^\s*(?:\d{1,2}[、.．)）]|第\s*\d{1,2}\s*题)\s*/, ''))
      })
      const stem = stemLines.join(' ').trim()
      if (!stem) return null
      const type = options.length
        ? /[（(]\s*[）)]/.test(stem) || options.length >= 4
          ? '单选'
          : '多选'
        : /_{2,}|＿{2,}|（\s*）/.test(stem)
          ? '填空'
          : '解答'
      return { stem, type, options }
    })
    .filter((row): row is ParsedItem => row !== null)
}

const parsed = computed(() => parseImportText(importText.value))

async function runImport() {
  if (!parsed.value.length) {
    showToast('没有解析出题目，请检查文本格式', 'error')
    return
  }
  importRunning.value = true
  let added = 0
  try {
    for (const row of parsed.value) {
      const created = await saveQuestion({
        stem: row.stem,
        type: row.type,
        options: row.options,
        answer: '',
        analysis: '',
        knowledge: [],
        difficulty: importDifficulty.value || pick(difficulties.value, '中等'),
        subject: form.subject,
        grade: importGrade.value || form.grade,
        submit: false,
      })
      questions.value.unshift(created)
      if (addQuestion(created, true)) added += 1
    }
    commit(`从文档导入 ${added} 道题`)
    showToast(`已解析 ${parsed.value.length} 道，成功入卷 ${added} 道（其余已在卷中）`, 'success')
    importText.value = ''
    panelRail.value = ''
  } catch (error) {
    showToast(error instanceof Error ? error.message : '导入失败', 'error')
  } finally {
    importRunning.value = false
    nextTick(scheduleMeasure)
  }
}

/* ================= 右侧面板：资源篮（组卷车） ================= */

function basketAddAll() {
  let added = 0
  basket.entries.value.forEach((entry) => {
    const row = itemOf(entry.questionId)
    if (row && addQuestion(row, true)) added += 1
  })
  if (!added) {
    showToast('组卷车里的题目都已在卷中', 'error')
    return
  }
  commit(`从资源篮批量加入 ${added} 道题`)
  showToast(`已加入 ${added} 道题`, 'success')
}

function basketAddOne(questionId: number) {
  const row = itemOf(questionId)
  if (row) addQuestion(row)
}

/* ===== 参考资料（组卷车里的图片 / 视频 / 小程序）=====
   组卷车的「清空」是全清（步骤、抽题池一类的场景靠它），但这里的资源篮只列题目 ——
   若在这里调 `clear()`，用户看不见的资源会被一起清掉，属于静默丢东西。故只清题目。 */

const ATTACHMENT_KIND_TEXT: Record<MediaKind, string> = { image: '图片', animation: '小程序', video: '视频' }

/** 组卷车里尚未并入本卷的资源（按 类型+id 去重，重复点「并入」不会攒出重复项） */
const pendingAttachments = computed(() => {
  const have = new Set(attachments.value.map((row) => `${row.kind}-${row.mediaId}`))
  return basket.resources.value.filter((row) => !have.has(`${row.kind}-${row.id}`))
})

function mergeBasketAttachments() {
  const added = pendingAttachments.value.map((row) => ({
    mediaId: row.id,
    kind: row.kind,
    name: row.name,
    sizeMb: row.sizeMb,
  }))
  if (!added.length) {
    showToast('组卷车里的参考资料都已在卷中', 'error')
    return
  }
  attachments.value = [...attachments.value, ...added]
  showToast(`已并入 ${added.length} 个参考资料，保存试卷后生效`, 'success')
}

function removeAttachment(row: PaperAttachment) {
  attachments.value = attachments.value.filter((item) => !(item.kind === row.kind && item.mediaId === row.mediaId))
}

/* ================= 版本记录（协同组卷才有） ================= */

const versions = ref<Awaited<ReturnType<typeof fetchPaperVersions>>>([])
const versionOpen = ref(false)
const replaceNote = ref('')
const replaceTarget = ref<number | null>(null)

async function loadVersions() {
  if (!form.id) return
  try {
    versions.value = await fetchPaperVersions(form.id)
  } catch {
    versions.value = []
  }
}

async function onRestore(versionId: number) {
  try {
    const { paper: next, versions: list } = await restorePaperVersion({ paperId: form.id, versionId })
    sections.value = JSON.parse(JSON.stringify(next.sections)) as PaperSection[]
    versions.value = list
    commit('撤销到历史版本')
    showToast('已撤销到所选版本（撤销动作本身也记为一版）', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '撤销失败', 'error')
  }
}

async function onReplace() {
  if (replaceTarget.value == null) return
  try {
    const { paper: next, versions: list } = await replacePaperVersion({
      paperId: form.id,
      versionId: replaceTarget.value,
      note: replaceNote.value,
    })
    sections.value = JSON.parse(JSON.stringify(next.sections)) as PaperSection[]
    versions.value = list
    commit('以历史版本替换当前卷面')
    replaceTarget.value = null
    replaceNote.value = ''
    showToast('已用所选版本替换当前卷面', 'success')
    nextTick(scheduleMeasure)
  } catch (error) {
    showToast(error instanceof Error ? error.message : '替换失败', 'error')
  }
}

/* ================= 保存 / 预览 ================= */

const previewOpen = ref(false)
const previewInitial = reactive({ opened: false })

function validate(): boolean {
  if (form.name.trim().length < 2 || form.name.trim().length > 50) {
    showToast('试卷名称须为 2-50 字', 'error')
    return false
  }
  if (totalCount.value === 0) {
    showToast('试卷至少需要 1 道题目', 'error')
    return false
  }
  return true
}

/**
 * 协同处理人的保存：**按题型增量提交**，一次只写自己负责的那几段。
 *
 * 为什么不能复用 `savePaper` 整卷覆盖：处理人手里这一份 `sections` 是打开页面那一刻的快照，
 * 一覆盖就把别人这段时间加的题抹掉（版本记录里还不留痕 —— 它记的正是覆盖后的结果）。
 *
 * 所以协同侧只有三个增量口子，本函数按顺序把它们串起来：
 *
 * | 步 | 口子 | 管什么 |
 * | --- | --- | --- |
 * | 1 | `collabAddQuestions` | 我新加的题 |
 * | 2 | `collabRemoveQuestion` | 我删掉的题 |
 * | 3 | `collabUpdateSection` | 顺序与分值 |
 *
 * 三步缺一不可：`collabUpdateSection` 只认「该大题原有题目的一个排列」，把新加的题塞给它会被判成
 * 越权增删并报「本接口只能调整已有题目的顺序与分值」—— 这正是「从试题库勾了题、点保存却存不上」
 * 的由来。反过来只走前两步也不够：顺序和分值它们都不管。
 *
 * 增量以**题型**为单位而不是以本地大题为单位：服务端一张卷里一个题型对应一个大题
 * （`sectionIndexForType` 按标题命中来找），而本地可能刚建了一个同题型的新大题（那个 id 服务端
 * 根本不存在）。按题型归并之后，增删改三项说的是同一件事，两边才对得上。
 *
 * @param silent 静默保存（自动保存 / 提交前落盘）时不弹「已保存」的 toast。
 *   失败原因照常弹 —— 那是有用的信息，静默掉只会让后面那句「还差 N 题」显得莫名其妙。
 */
async function saveAsMember(silent = false): Promise<void> {
  const task = currentTask.value
  if (!task || !activeName.value) return
  if (readOnlyMember.value) {
    showToast('你在本任务中是只读权限，不能修改卷面', 'error')
    return
  }
  if (task.status !== 'collecting' && task.status !== 'reviewing') {
    showToast(`任务已「${COLLAB_STATUS_TEXT[task.status]}」，如需调整请让发起人退回修改`, 'error')
    return
  }
  if (!myTypes.value.length) {
    showToast('本任务没有分配题型给你，无法保存卷面', 'error')
    return
  }
  /* 我想让卷面变成的样子，按题型归并：只取我负责的大题里的题（别人的段落一个字都不碰） */
  const plan = myTypes.value.map((type) => ({
    type,
    rows: sections.value
      .filter((_, si) => editableSection(si))
      .flatMap((section) => section.questions)
      .filter((row) => itemOf(row.questionId)?.type === type)
      .map((row) => ({ questionId: row.questionId, score: Number(row.score) || 0 })),
  }))
  saving.value = true
  try {
    /* 服务端此刻的卷面：增删的差集要拿它当基准（本地这份是开页快照，同事可能已经改过） */
    const server = (await fetchPapers()).find((row) => row.id === task.paperId)
    /** 该题型在服务端**按标题命中**的大题里的题 —— 与配额统计、与 mock 的 `sectionIndexForType` 同一口径 */
    const idsOfType = (source: OrgPaper, type: string) => {
      const label = sectionLabelOf(type).replace(/题$/, '')
      return source.sections
        .filter((section) => section.title.includes(label))
        .flatMap((section) => section.questions.map((row) => row.questionId))
    }
    /* 「已在卷上」按**整卷**判，而不是按上面那个题型命中集：一道题被人工挪进了别的大题
       （标题认不出它的题型），按题型找会漏掉它，于是又被当成新题去 add ——
       后端一句「所选题目均已在卷中」把整次保存打回。 */
    const serverIds = new Set(
      (server?.sections ?? []).flatMap((section) => section.questions.map((row) => row.questionId)),
    )

    let latest: OrgPaper | null = null
    for (const { type, rows } of plan) {
      const wantIds = new Set(rows.map((row) => row.questionId))
      const add = rows.filter((row) => !serverIds.has(row.questionId))
      if (add.length) {
        latest = (
          await collabAddQuestions({ taskId: task.id, memberName: activeName.value, questions: add })
        ).paper
        add.forEach((row) => serverIds.add(row.questionId))
      }
      /* 移除的判据全部建立在「服务端本来有这道题」之上（`server` 是本次调用开始前的服务端卷面），
         拿不到它就是一个都不删 —— 宁可不删，不能凭一份猜出来的名单去删题。 */
      if (!server) continue
      /* 只删「开页时就在卷面上、现在本地没了」的题。同事在我浏览期间加的题不在基线上，
         绝不会被我顺手删掉 —— 这是这套增量保存里最容易出人命的一处。 */
      const drop = idsOfType(server, type).filter(
        (id) => baselineIds.value.has(id) && !wantIds.has(id),
      )
      for (const questionId of drop) {
        latest = await collabRemoveQuestion({ taskId: task.id, memberName: activeName.value, questionId })
      }
    }

    /* 顺序与分值：先按上面的回执找服务端那个大题。标题命中**且**含有我这批题 ——
       只有标题命中时，两个同题型的大题会互相顶替，后一次把前一次写的顺序冲掉。 */
    const base = latest ?? server
    if (base) {
      for (const { type, rows } of plan) {
        /* 空题型跳过：那种大题此时已经被删空，而 `collabUpdateSection` 对空大题直接报
           「还没有题目，请先加入题目」，白报一次错 */
        if (!rows.length) continue
        const label = sectionLabelOf(type).replace(/题$/, '')
        const wanted = new Set(rows.map((row) => row.questionId))
        const target = base.sections.find(
          (section) =>
            section.title.includes(label) && [...wanted].every((id) => section.questions.some((row) => row.questionId === id)),
        )
        if (!target) continue
        latest = (
          await collabUpdateSection({
            taskId: task.id,
            memberName: activeName.value,
            sectionId: target.id,
            questions: rows,
          })
        ).paper
      }
    }

    if (latest) adoptPaper(latest)
    await refreshTask()
    markSaved()
    if (!silent) showToast('已保存你负责的题型', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '保存失败', 'error')
  } finally {
    saving.value = false
  }
}

/** 保存载荷：手动保存与自动保存必须逐字一致，抽出来只维护一份 */
function paperPayload() {
  return {
    sections: JSON.parse(JSON.stringify(sections.value)) as PaperSection[],
    /* 随卷参考资料：显式传数组（空数组 = 清空），不传的话 savePaper 会保留原值 */
    attachments: JSON.parse(JSON.stringify(attachments.value)) as PaperAttachment[],
    /* 卷面附加区块（表格 / 四线格 / 横线）同上：`[]` = 这次把它们全删了 */
    extras: JSON.parse(JSON.stringify(extras.value)) as PaperExtra[],
    /* 注意事项：空数组是「老师把这一块删了」，不能省成 undefined —— 那会被当成「没配过」印回默认稿 */
    notices: notices.value,
  }
}

async function save(submit = false) {
  if (collabLimited.value) {
    await saveAsMember()
    return
  }
  if (!validate()) return
  saving.value = true
  try {
    const saved = await savePaper({
      id: form.id || undefined,
      name: form.name.trim(),
      subject: form.subject,
      grade: form.grade,
      duration: form.duration,
      ...paperPayload(),
      submit,
    })
    form.id = saved.id
    meta.status = saved.status
    ownPaperIds.value = [...ownPaperIds.value, saved.id]
    markSaved()
    showToast(submit ? '已提交：AI 九项检测通过后推送人工审核' : '试卷已保存', 'success')
    await loadVersions()
    commit('保存到试卷库')
    if (submit) router.push('/paper/list')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '保存失败', 'error')
  } finally {
    saving.value = false
  }
}

/* ================= 自动保存 =================
 *
 * 开关落 localStorage（默认开）。触发源是卷面结构的三样东西：`sections`（题目）、`extras`
 * （附加区块）、`attachments`（随卷参考资料）—— 卷头信息、版式与纸张**不覆盖**：
 * 那些是卷级设置，且协同处理人本来就无权改（与 `canEditPaper` 同一口径）。
 *
 * `runAutoSave` **刻意不走 `save()`**：那条路会 `commit()` 进撤销栈、还会弹一遍 toast。
 * 几十秒一次的静默保存不该在「历史记录」里刷屏，更不该打断正在改卷的人。
 */

const AUTOSAVE_KEY = 'aiteach.pe-autosave'
/** 停手多久才写：太短会在连续改分值时写个不停，太长又不像「自动」 */
const AUTOSAVE_DELAY = 1500

const autoSaveEnabled = ref(localStorage.getItem(AUTOSAVE_KEY) !== '0')
const autoSaving = ref(false)
/** 上一次自动保存失败的原因。toast 一闪就没了，底栏要留得住 */
const autoSaveFailed = ref('')
const lastSavedAt = ref('')

let autoSaveTimer = 0

function clockText(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })
}

/** 记下「刚刚存过」：手动与自动两条路共用，顺便撤掉还没触发的定时器，免得刚存完又写一遍 */
function markSaved() {
  lastSavedAt.value = clockText()
  autoSaveFailed.value = ''
  cancelAutoSave()
}

function cancelAutoSave() {
  if (autoSaveTimer) window.clearTimeout(autoSaveTimer)
  autoSaveTimer = 0
}

function toggleAutoSave() {
  autoSaveEnabled.value = !autoSaveEnabled.value
  localStorage.setItem(AUTOSAVE_KEY, autoSaveEnabled.value ? '1' : '0')
  if (autoSaveEnabled.value) {
    showToast(`已开启自动保存，改动停手 ${AUTOSAVE_DELAY / 1000} 秒后写入`, 'success')
  } else {
    cancelAutoSave()
    showToast('已关闭自动保存，记得手动点「保存」')
  }
}

/**
 * 自动保存**不可用**的原因（空串 = 可用）。
 *
 * 协同任务的**发起人**是唯一被挡在外面的角色：他保存走的是 `savePaper` 整卷覆盖
 * （协同侧那几个增量口子都要求「我是处理人」，发起人不是）。手动保存时这是他自己按下的一下，
 * 后果他认；而自动保存是**每 1.5 秒静默整卷覆盖一次**，同事这段时间加的题会被无声地抹掉 ——
 * 这个风险不该由「开了个开关」来承担。处理人走的是按题型增量，安全，照常可用。
 */
const autoSaveBlockReason = computed(() => {
  if (currentTask.value && !collabLimited.value) {
    return '本卷是协同组卷任务：发起人的保存会整卷覆盖，可能盖掉同事刚加的题，请手动点「保存」'
  }
  if (readOnlyMember.value) return '你在本任务中是只读权限，没有可保存的改动'
  return ''
})

/**
 * 这一趟能不能写。任何一条不满足就**静默跳过** —— 自动保存宁可不写，
 * 也不能把半份坏数据（卷名被清空、题目删光了）落进库，或者盖掉用户正在弹窗里做的决定。
 */
function autoSaveReady(): boolean {
  if (!autoSaveEnabled.value || !form.id || autoSaveBlockReason.value) return false
  if (loading.value || saving.value || autoSaving.value || adopting) return false
  /* 浮层开着时不写：用户正在那个弹窗里做决定，此刻落盘会把「还没确认的中间态」存下来 */
  if (previewOpen.value || commentTarget.value || smartOpen.value || checkOpen.value) return false
  if (mediaOpen.value || replaceTarget.value || rejectTarget.value) return false
  if (peekTarget.value || correctTarget.value || similarTarget.value) return false
  if (totalCount.value === 0) return false
  if (form.name.trim().length < 2 || form.name.trim().length > 50) return false
  if (collabLimited.value) {
    /* 协同处理人：只在可写阶段、且至少有一个「有题目且归我」的大题时写（同 saveAsMember 的判据） */
    if (!paperEditable.value) return false
    return sections.value.some((section, si) => section.questions.length > 0 && editableSection(si))
  }
  return true
}

function scheduleAutoSave() {
  cancelAutoSave()
  /* `adopting`：服务端回执换卷面（不是用户改的，见 adoptPaper）；
     `saving` / `autoSaving`：正在写的这一趟自己也会换一次卷面，不必再排一趟 */
  if (!autoSaveEnabled.value || loading.value || saving.value || autoSaving.value || adopting) return
  autoSaveTimer = window.setTimeout(() => {
    autoSaveTimer = 0
    void runAutoSave()
  }, AUTOSAVE_DELAY)
}

async function runAutoSave() {
  if (!autoSaveReady()) return
  autoSaving.value = true
  try {
    if (collabLimited.value) {
      /* 静默落盘：不 commit、不 adoptPaper —— `adoptPaper` 会清空撤销栈，
         静默保存把用户的撤销历史吃掉是不可接受的。失败原因由 `saveAsMember` 自己弹 toast。 */
      await saveAsMember(true)
    } else {
      const saved = await savePaper({
        id: form.id,
        name: form.name.trim(),
        subject: form.subject,
        grade: form.grade,
        duration: form.duration,
        ...paperPayload(),
      })
      meta.status = saved.status
    }
    lastSavedAt.value = clockText()
    autoSaveFailed.value = ''
  } catch (error) {
    /* 失败不弹 toast（静默保存不该刷屏），只在底栏把状态标红并留一句可悬停查看的原因 */
    autoSaveFailed.value = error instanceof Error ? error.message : '自动保存失败'
  } finally {
    autoSaving.value = false
  }
}

/* ================= 提交（顶栏） =================
 *
 * 同一颗按钮在不同角色下是四件不同的事，沿用右栏「组卷信息」面板已有的分支（不新增状态，
 * 也不把面板里的按钮撤掉 —— 那边是「流程走到哪一步」的说明，这里是就手能按到的入口）。
 */

interface SubmitAction {
  text: string
  icon: string
  /** 流程还没走到能提交的那一步（或还差人）时置灰 */
  disabled: boolean
  /** 置灰的原因，也是按钮的 `title` */
  hint: string
  run: () => void
}

const submitAction = computed<SubmitAction | null>(() => {
  const task = currentTask.value
  if (!task) {
    /* 普通试卷：走 `savePaper` 的 submit 分支（保存并推送人工审核），与顶栏「保存」同一个函数 */
    return { text: '提交审核', icon: 'upload', disabled: false, hint: '保存当前卷面并推送人工审核', run: () => void save(true) }
  }
  if (isOwner.value) {
    if (task.status === 'ready') {
      return { text: '提交审核', icon: 'upload', disabled: false, hint: '全员已验收，可以送审', run: () => void submitForReview() }
    }
    if (task.status === 'submitted') {
      return { text: '撤回送审', icon: 'undo', disabled: false, hint: '撤回后任务回到待送审，可继续改卷面', run: () => void withdrawReview() }
    }
    if (task.status === 'rejected') {
      return { text: '退回修改', icon: 'edit', disabled: false, hint: '审核被驳回，退回全员重新组卷', run: () => void reopenAfterReject() }
    }
    if (task.status === 'collecting') {
      const missing = task.members.filter((row) => row.status !== 'submitted' && row.status !== 'accepted').length
      return {
        text: '提交审核',
        icon: 'upload',
        disabled: true,
        hint: missing ? `还有 ${missing} 位老师未提交，等他们交齐后可送审` : '请先在名单里验收各位老师的成果',
        run: () => {},
      }
    }
    if (task.status === 'reviewing') {
      return {
        text: '提交审核',
        icon: 'upload',
        disabled: true,
        hint: pendingAccept.value.length
          ? `有 ${pendingAccept.value.length} 位老师的成果待你验收，验收完即可送审`
          : '请先在名单里验收各位老师的成果',
        run: () => {},
      }
    }
    return null
  }
  if (canSubmitMine.value) {
    return { text: '提交我的部分', icon: 'check', disabled: false, hint: '提交你负责的题型，发起人可开始审校', run: () => void submitMine() }
  }
  if (canReopenMine.value) {
    return { text: '撤回提交', icon: 'undo', disabled: false, hint: '撤回后可以继续修订', run: () => void reopenMine() }
  }
  return null
})

/**
 * 顶栏「提交」的入口。协同任务先开检测弹窗（提交前该看清自己这一段交齐没有），
 * 普通试卷没有协同要求可核，直接走 `save(true)`，不摆一套用不上的检查。
 */
function onSubmitClick() {
  const action = submitAction.value
  if (!action || action.disabled || submitBusy.value) return
  if (!currentTask.value) {
    action.run()
    return
  }
  openCheck()
}

/* ================= 提交前检测 ================= */

const checkOpen = ref(false)
const checkBusy = ref(false)
/** 本地即时核对（纯计算，打开就有，不等网络） */
const checkItems = ref<CollabCheckItem[]>([])
const checkReport = ref<CollabCheckReport | null>(null)
const submitBusy = ref(false)

const CHECK_LEVEL_ICON: Record<CollabCheckItem['level'], string> = { ok: 'check', warn: 'warning', error: 'close' }

/** 提交前核对用的进度：发起人看整卷（空题型范围 = 全量要求），处理人只看自己那几个题型 */
const checkProgress = computed(() => quotaFor(isOwner.value ? [] : myTypes.value))

/**
 * 把页面状态折成检测层的入参。
 *
 * 每题只给**精简画像**（题型 / 难度 / 知识点 / 有无答案解析 / 是否入库 / 题干前 40 字）：
 * 这一轮判的是「这份卷子符不符合组卷要求」，不是逐题质检 —— 整段题干喂进去既贵又跑偏。
 */
function buildCheckInput(): CollabPaperCheckInput | null {
  const task = currentTask.value
  if (!task) return null
  let no = 0
  const rows: CollabCheckQuestion[] = []
  const sectionRows = sections.value.map((section) => {
    const types = new Set<string>()
    section.questions.forEach((entry) => {
      const item = itemOf(entry.questionId)
      if (item) types.add(item.type)
      no += 1
      rows.push({
        no,
        type: item?.type ?? '',
        difficulty: item?.difficulty ?? '',
        knowledge: item?.knowledge ?? [],
        stem: truncateRich(item?.stem ?? '', 40),
        hasAnswer: !!toPlainText(item?.answer ?? '').trim(),
        hasAnalysis: !!toPlainText(item?.analysis ?? '').trim(),
        approved: item?.status === 'approved',
      })
    })
    return {
      title: section.title,
      count: section.questions.length,
      score: section.questions.reduce((sum, row) => sum + (Number(row.score) || 0), 0),
      types: [...types],
    }
  })
  return {
    requirement: task.requirement,
    memberName: activeName.value,
    myTypes: isOwner.value ? [] : myTypes.value,
    progress: checkProgress.value,
    totalCount: totalCount.value,
    totalScore: totalScore.value,
    sections: sectionRows,
    questions: rows,
  }
}

function openCheck() {
  const input = buildCheckInput()
  if (!input) return
  checkItems.value = checkCollabRequirement(input)
  checkReport.value = null
  checkOpen.value = true
}

async function runCheckByAi() {
  const input = buildCheckInput()
  if (!input || checkBusy.value) return
  checkBusy.value = true
  try {
    checkReport.value = await checkCollabPaperByAi(input)
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'AI 检测失败，请稍后重试', 'error')
  } finally {
    checkBusy.value = false
  }
}

/** 检测结果的总判定：AI 那一轮出了结果就以它为准，否则看本地核对 */
const checkOverall = computed(() => (checkReport.value ? checkReport.value.overall : overallOf(checkItems.value)))
const CHECK_OVERALL_LABEL = { pass: '核对通过', warn: '建议关注', fail: '需修正' } as const

/**
 * 「仍然提交」：检测**一律只提示**，不拦。
 *
 * 但提交前必须先落盘 —— `collabSubmitMember` 数的是服务端**已保存**的卷面，
 * 交了还没保存的题会被漏算，用户看到的会是「明明加够了却报还差 N 道」。
 * 真正的硬门槛仍在后端的 quota 校验上：题确实没交够，它的中文报错原样弹出来。
 */
async function confirmSubmit() {
  const action = submitAction.value
  if (!action || submitBusy.value) return
  const wasMineSubmit = canSubmitMine.value
  submitBusy.value = true
  try {
    /* 只有协同处理人需要「先落盘」：他的改动走增量口子，而 `collabSubmitMember` 数的是
       服务端**已保存**的卷面 —— 不先存，刚加的题会被算漏。
       发起人的送审/撤回/退回是**流程动作**，卷面由服务端当前版本决定（那几步本来就会把
       权威卷面还回来），而且他这一路整卷覆盖，替他自动写一次未必是他要的。 */
    if (collabLimited.value) await saveAsMember(true)
    await action.run()
    /* 提交成功与否只看状态：`runTaskAction` 把错误吃成了 toast，这里再判一次 ——
       **失败时把弹窗留着**，用户正要照着上面的清单去补题。 */
    if (!wasMineSubmit || !canSubmitMine.value) checkOpen.value = false
  } finally {
    submitBusy.value = false
  }
}

/* 顶栏原先的「导出 / 打印 / 卷面版本」三个控件已移除 —— 它们是**重复入口**：
   导出 Word / PDF 与「学生版 / 教师版 / 纯答案」这套参数，预览弹窗（PaperPreviewModal）
   里本来就有一整套，而预览正是从本页顶栏进的。
   页面底部的 `@media print` 与 `body.pe-print-open` 仍然保留：那是给浏览器自带的
   Ctrl/⌘+P 用的（类只在编辑页挂载，其它页面打印不受影响），与顶栏有没有按钮无关。 */

/** 全文设置 → 预览的初始值：点预览时不该把刚设好的版式重置掉 */
const previewSize = computed(() => sizeKey.value)
const previewLayout = computed(() => layoutKey.value)

function openCollab() {
  if (!form.id) {
    showToast('请先保存试卷，再发起协同组卷', 'error')
    return
  }
  /* 已在本卷的协同任务里：就地展开右栏的「组卷信息」，不再跳去别处 ——
     分工、进度、评论都在这个面板上，跳走反而要用户找回来。 */
  if (currentTask.value) {
    panelRail.value = 'collab'
    return
  }
  router.push(`/paper/collab?paperId=${form.id}`)
}

async function refreshQuestions() {
  questions.value = await fetchQuestions()
}

/** 重拉协同任务：成员状态、版本线在提交/保存之后会变，面板要跟着刷新 */
async function refreshTask() {
  if (!currentTask.value) return
  collabTasks.value = await fetchCollabTasks()
}

/* ================= 生命周期 ================= */

async function load() {
  loading.value = true
  const id = Number(route.query.id ?? 0)
  try {
    await ensure()
    const [questionRows, paperRows, tasks] = await Promise.all([fetchQuestions(), fetchPapers(), fetchCollabTasks()])
    questions.value = questionRows
    ownPaperIds.value = paperRows.map((row) => row.id)
    collabTasks.value = tasks
    const source = paperRows.find((row) => row.id === id)
    if (!source) {
      showToast('试卷不存在或已删除', 'error')
      router.replace('/paper/list')
      return
    }
    form.id = source.id
    form.name = source.name
    form.subject = pick(subjects.value, source.subject)
    form.grade = pick(grades.value, source.grade)
    form.duration = source.duration
    meta.owner = source.owner
    meta.sharedSquare = source.sharedSquare
    meta.status = source.status
    sections.value = JSON.parse(JSON.stringify(source.sections)) as PaperSection[]
    attachments.value = JSON.parse(JSON.stringify(source.attachments ?? [])) as PaperAttachment[]
    extras.value = JSON.parse(JSON.stringify(source.extras ?? [])) as PaperExtra[]
    /* 开页基线：处理人的增量保存靠它区分「我删的题」与「同事后来加的题」（见 baselineIds） */
    baselineIds.value = new Set(sections.value.flatMap((row) => row.questions.map((q) => q.questionId)))
    /* 自增源从既有区块的最大 id 之后接着发号：否则新插入的块会和已有的撞 id，
       blockMap 里同 key 的块互相顶替，选中与高度就全乱了 */
    extraSeq = Math.max(0, ...extras.value.map((row) => row.id)) + 1
    /* 没配过注意事项的卷子（`undefined`）用默认稿**回填输入框**：卷面上印着默认稿、
       面板里却是空的，老师会以为设置没生效。存过的（含空数组）原样带出。 */
    noticesDraft.value = (source.notices ?? DEFAULT_PAPER_NOTICES).join('\n')
    sectionSeq = Math.max(...sections.value.map((row) => row.id), 0) + 1
    /* 组卷身份：默认站到登录人本人，他不是处理人时退到第一位处理人 */
    if (currentTask.value && !currentTask.value.members.some((row) => row.name === activeName.value)) {
      activeName.value =
        currentTask.value.members.find((row) => row.name === myName.value)?.name ??
        currentTask.value.members[0]?.name ??
        ''
    }
    /* 撤销栈需要一个起点：把「刚打开时」的卷面记为第一版，否则第一次撤销是空的 */
    snapshots.value = []
    pointer.value = -1
    commit('打开试卷')
    await loadVersions()
    await refreshComments()
    /* 纠错记录拉不到不该让整页白屏：没它只是「纠错」按钮少了「已提交」这个态 */
    await fetchQuestionCorrections()
      .then((records) => {
        corrections.value = records
      })
      .catch(() => {})
    await nextTick()
    scheduleMeasure()
  } finally {
    loading.value = false
  }
}

function onKeydown(event: KeyboardEvent) {
  const meta2 = event.metaKey || event.ctrlKey
  if (meta2 && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    if (event.shiftKey) redo()
    else undo()
  }
  if (meta2 && event.key.toLowerCase() === 's') {
    event.preventDefault()
    void save(false)
  }
}

let resizeObserver: ResizeObserver | null = null
let bodyOverflow = ''

onMounted(async () => {
  /* 本页在 AppLayout 之外，而「演示身份」只在 AppLayout 挂载时贴回 mock 一次。
     新标签页直接打开本页时（协同组卷的入口就是这么开的），mock 的 CURRENT 会停在种子的
     默认身份上 —— 评论作者、`pushMessage` 的 actor 会全签成陈明远。这里按缓存补贴一次。 */
  applyIdentity(identity.value.role)
  document.addEventListener('keydown', onKeydown)
  bodyOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  document.body.classList.add('pe-print-open')
  await load()
  /* 自动保存的监听**必须在 `load()` 之后才建**：`load()` 自己会把 sections 整个换一遍，
     提前挂上等于「打开一张卷子」就先自动保存一次，白白写库。 */
  watch([sections, extras, attachments], scheduleAutoSave, { deep: true })
  if (panelRail.value === 'media') void loadMedia()
  if (canvas.value) {
    canvasW.value = canvas.value.clientWidth
    resizeObserver = new ResizeObserver(() => {
      canvasW.value = canvas.value?.clientWidth ?? canvasW.value
      if (autoFit.value) zoom.value = fitZoom()
    })
    resizeObserver.observe(canvas.value)
  }
  zoom.value = fitZoom()
  document.fonts?.ready.then(scheduleMeasure).catch(() => {})
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = bodyOverflow
  document.body.classList.remove('pe-print-open')
  resizeObserver?.disconnect()
  cancelAutoSave()
  if (frame) cancelAnimationFrame(frame)
})

async function loadMedia() {
  if (media.value.length) return
  media.value = await fetchMedia()
}

/* 卷面（或纸张 / 版式 / 页眉样式）一变就要重新量块高 —— 块高决定分页。
   **但这里绝不能把 `measured` 打回 false**：那会让下面的 `v-for="sheet in measured ? sheets : []"`
   在一帧之内把整叠纸页卸载掉，画布里只剩「正在按…纸面排版」那一行，滚动容器的内容高度瞬间塌掉，
   浏览器的 scrollTop 被钳回 0 —— 用户看到的就是「在工具条里改个分值，画布自己弹回顶部」。
   宁可让旧高度多撑一帧（分页下一帧 rAF 量完就自正），也不要把滚动位置弄丢。 */
watch([paperBlocks, () => `${geo.value.panelW}|${preset.value.key}|${preset.value.headStyle}`], () => {
  nextTick(scheduleMeasure)
})
watch([geo, canvasW, autoFit], () => {
  if (autoFit.value) zoom.value = fitZoom()
})
watch(panelRail, (value) => {
  if (value === 'media') void loadMedia()
})

/**
 * 竖栏按钮。「组卷信息」只在**本卷有协同任务时**才出现 —— 普通试卷的编辑页上
 * 没有「谁负责哪个题型」这回事，摆一个空面板只会让人点开又关掉。
 * 「导入文档」对协同处理人不出现：那是发起人整理卷面的动作。
 */
const RAIL = computed(() =>
  [
    { key: 'settings', label: '全文设置', icon: 'sliders' },
    ...(currentTask.value ? [{ key: 'collab', label: '组卷信息', icon: 'users' }] : []),
    { key: 'bank', label: '试题库', icon: 'edit' },
    { key: 'media', label: '媒体库', icon: 'image' },
    { key: 'basket', label: '资源篮', icon: 'cart' },
    ...(canEditPaper.value ? [{ key: 'import', label: '导入文档', icon: 'upload' }] : []),
    { key: 'history', label: '历史记录', icon: 'clock' },
  ] as Array<{ key: '' | 'settings' | 'collab' | 'bank' | 'media' | 'basket' | 'import' | 'history'; label: string; icon: string }>,
)

const outlineRows = computed(() =>
  sections.value.map((section, si) => {
    const collab = outlineCollabRows.value.get(si)
    return {
      si,
      title: section.title,
      count: section.questions.length,
      score: section.questions.reduce((sum, row) => sum + (Number(row.score) || 0), 0),
      collab,
      /* 我负责的大题：目录行上给一个品牌色标记，一眼看出该动哪几段 */
      mine: collab?.mine ?? false,
      locked: !editableSection(si),
      lockWhy: lockReason(si),
      /* 题型上的评论条数：目录行里那个小气泡上的角标 */
      comments: countOf({ kind: 'section', si }),
    }
  }),
)

/* ================= 卷面评论 =================
 *
 * 评论挂**三个粒度**：卷头（版头信息本身的问题，如「密封线位置不对」）、题型（整段的教学要求，
 * 如「难度再拉一档」）与题目（这一题的具体问题）。题型与卷头都没有题目可依附，所以数据里
 * 额外记了 `sectionId` 来定位段落（卷头连大题都没有，那是空）—— 见 PaperComment 的注释。
 *
 * 界面上，说「这道题」的话就挂在**这道题自己身上**：题目操作条里的「评论」按钮，加上题块
 * 右栏距里那个常显的角标（有评论才出现），点开都是同一个抽屉；说「这一整段」「这块版头」的话从
 * **目录里对应的那一行**进，卷面上同样有角标。曾经有过一条把三个粒度混在一处的卷级评论栏，
 * 离题又远，已撤掉。
 *
 * 抽屉有**两个视图**：某一处的评论（可写），与全卷评论索引（按试题分组，点一条跳到那一处）——
 * 后者是「这一题有人说了什么，别处还有谁提过意见」这条动线的落点，见 `commentView`。
 *
 * 评论与编辑权限**无关**：只读处理人也能评，只读是他的分工，不是他的嘴。
 */

/** 评论的三个粒度。用联合而不是 `(kind, si, qi)` 三元组：加一个粒度时不必到处补分支 */
type CommentTarget =
  | { kind: 'head' }
  | { kind: 'section'; si: number }
  | { kind: 'question'; si: number; qi: number }

const comments = ref<PaperComment[]>([])

/** 三个粒度共用一套过滤：卷头只有一条目标，题型按 `sectionId` 找段，题目按 `questionId` 找题 */
function rowsOf(target: CommentTarget): PaperComment[] {
  if (target.kind === 'head') return comments.value.filter((row) => row.target === 'head')
  const section = sections.value[target.si]
  if (!section) return []
  if (target.kind === 'section') {
    return comments.value.filter((row) => row.target === 'section' && row.sectionId === section.id)
  }
  const questionId = section.questions[target.qi]?.questionId
  if (questionId == null) return []
  return comments.value.filter((row) => row.target === 'question' && row.questionId === questionId)
}

/** 某个目标上的评论条数：入口按钮、目录行与画布右缘的角标 */
function countOf(target: CommentTarget): number {
  return rowsOf(target).length
}

/** 卷头的评论条数：目录里那一行与卷面角标都用它 */
const headCommentCount = computed(() => countOf({ kind: 'head' }))

/** 题目块的评论目标：拿题目 id 反查不了 `si/qi` 的地方（角标、操作条）都走这里 */
function questionTargetOf(questionId: number): CommentTarget | null {
  for (let si = 0; si < sections.value.length; si += 1) {
    const qi = sections.value[si].questions.findIndex((row) => row.questionId === questionId)
    if (qi >= 0) return { kind: 'question', si, qi }
  }
  return null
}

/** 卷面块 → 评论目标。只有卷头 / 题型 / 题目三种块有评论，材料与附加区块没有。
    入参是 `EditBlock` 而不是 `PaperBlock`：`si / qi` 是排版时补上的归属信息（见 `EditBlock`），
    只有它才认得出这一块是哪一段的。 */
function commentTargetOfBlock(block: EditBlock): CommentTarget | null {
  if (block.kind === 'head') return { kind: 'head' }
  if (block.kind === 'section' && block.si != null) return { kind: 'section', si: block.si }
  if (block.kind === 'question') {
    if (block.si == null || block.qi == null) return null
    return { kind: 'question', si: block.si, qi: block.qi }
  }
  return null
}

/** 每道题的评论条数，喂给题目操作条上的「评论 N」（`questionId → 条数`） */
const commentCounts = computed<Record<number, number>>(() => {
  const map: Record<number, number> = {}
  for (const row of comments.value) {
    if (row.target !== 'question' || row.questionId == null) continue
    map[row.questionId] = (map[row.questionId] ?? 0) + 1
  }
  return map
})

/** 当前选中的块对应的评论目标：卷头 / 题型 / 题目三种块都算，别的块（材料、附加区块）没有 */
const selectedCommentTarget = computed<CommentTarget | null>(() => {
  const sel = selected.value
  if (!sel) return null
  if (sel.kind === 'head') return { kind: 'head' }
  if (sel.kind === 'section') return { kind: 'section', si: sel.si }
  if (sel.kind === 'question') return { kind: 'question', si: sel.si, qi: sel.qi }
  return null
})
const selectedCommentCount = computed(() => {
  const target = selectedCommentTarget.value
  return target ? countOf(target) : 0
})

/** 选中的那道题的 id：题目操作条据此在鼠标移开后仍停在这道题上（「点一下题目就出按钮」） */
const selectedQuestionId = computed<number | null>(() => {
  const sel = selected.value
  if (sel?.kind !== 'question') return null
  return sections.value[sel.si]?.questions[sel.qi]?.questionId ?? null
})

async function refreshComments() {
  if (!form.id) return
  comments.value = await fetchPaperComments(form.id)
}

/* ---- 查看与撰写：一个抽屉（`commentTarget` 非空即打开） ---- */

const commentTarget = ref<CommentTarget | null>(null)
const commentTab = ref<'manual' | 'ai'>('manual')
const commentDraft = ref('')
const aiRunning = ref(false)
/** 题型级是逐题各跑一次，慢的时候得看得出进度；也用来描述「跑到第几道了」 */
const aiProgress = ref({ done: 0, total: 0 })
/** 检测的常驻状态（结论条数 / 失败原因）。toast 一闪就没了，这里要留得住 */
const aiNote = ref('')
const aiFailed = ref(false)

/** 抽屉里列出的评论：当前目标上的全部，顺序即发表顺序 */
const commentRows = computed<PaperComment[]>(() => {
  const target = commentTarget.value
  return target ? rowsOf(target) : []
})

/**
 * 抽屉的两个视图。
 *
 * `one` = 当前这一处（可写）；`all` = **全卷评论索引**，按试题分组，点一条就落到那一处。
 * 两者共用一个抽屉、不做成两个入口：审卷的人是「从某道题的评论进去，想知道别处还有谁说了什么，
 * 点一条就跳过去」—— 来回切换要像翻页一样顺手，关掉再另找入口就把这条动线打断了。
 */
const commentView = ref<'one' | 'all'>('one')

/** 索引里的一组：一处目标（卷头 / 某大题 / 某道题）上的全部评论 */
interface CommentGroup {
  key: string
  /** 点这一组跳到哪儿；`null` = 目标已经不在卷面上（题被移除），只能看不能跳 */
  target: CommentTarget | null
  title: string
  /** 副标题：题目那几组要带大题名与题型 —— 全卷有好几个「第 1 题」，光看序号认不出是哪道 */
  note: string
  rows: PaperComment[]
}

/**
 * 题目那一组的副标题：大题名 + 题型 + 分值。
 *
 * 题型**只在大题名没说清时才补**：一个「二、填空题」里的题，再写一遍题型就成了
 * 「二、填空题 · 填空 · 5 分」—— 多出来的那个词不带任何信息，只让人以为大题名和题型是两回事。
 * 判据用 `sectionKeywordsOf`（认出「选择题」这类别名），所以**真正值得说的不一致仍会露出来**：
 * 一道完形填空落进了「二、填空题」，大题名里没有「完形填空」，这里就照写不误。
 */
function questionNoteOf(sectionTitle: string, item: OrgQuestion | undefined, score: number): string {
  const named = item ? sectionKeywordsOf(item.type).some((kw) => sectionTitle.includes(kw)) : false
  return `${sectionTitle}${item && !named ? ` · ${item.type}` : ''} · ${score} 分`
}

/**
 * 全卷评论按**试题维度**分组：卷头 → 每个大题 → 大题里的每道题，顺序与目录、与卷面一致。
 *
 * 只列有评论的目标（这是索引，不是卷面清单），组内逐条摊开 ——
 * 组长只说「有 3 条」的话，想问的还是「谁对第 3 题说了什么」，还得再点一次。
 */
const commentGroups = computed<CommentGroup[]>(() => {
  const groups: CommentGroup[] = []
  const placed = new Set<number>()
  const push = (group: CommentGroup) => {
    groups.push(group)
    group.rows.forEach((row) => placed.add(row.id))
  }

  const head = comments.value.filter((row) => row.target === 'head')
  if (head.length) push({ key: 'head', target: { kind: 'head' }, title: '卷头与注意事项', note: '卷面版头', rows: head })

  sections.value.forEach((section, si) => {
    const own = comments.value.filter((row) => row.target === 'section' && row.sectionId === section.id)
    if (own.length) {
      push({
        key: `s-${si}`,
        target: { kind: 'section', si },
        title: section.title,
        note: `${section.questions.length} 题`,
        rows: own,
      })
    }
    section.questions.forEach((entry, qi) => {
      const rows = comments.value.filter((row) => row.target === 'question' && row.questionId === entry.questionId)
      if (!rows.length) return
      const item = itemOf(entry.questionId)
      push({
        key: `q-${si}-${qi}`,
        target: { kind: 'question', si, qi },
        title: `第 ${qi + 1} 题`,
        note: questionNoteOf(section.title, item, entry.score),
        rows,
      })
    })
  })

  /* 评论挂在一道**已被移除**的题上（同事把题删了或换掉了）。这个视图自称「全卷的评论」，
     少列几条比多列几条糟得多 —— 提意见的人会以为自己的话没人看见。归到最后一组并说明
     为什么点不进去（数据仍在，只是没了可跳的目标）。 */
  const gone = comments.value.filter((row) => !placed.has(row.id))
  if (gone.length) {
    push({ key: 'gone', target: null, title: '已不在卷面上的题目', note: '原题已被移除或替换，评论仍保留', rows: gone })
  }

  return groups
})

/**
 * 当前目标的短名。索引页的返回按钮与标题共用它 —— 题目级必须带上**大题名**再跟小题序号：
 * 卷面上有四个「第 1 题」，只说「第 1 题」等于没说（段内序号与卷面流水号也不一样，
 * 这里与目录行保持一致）。
 */
const commentTargetLabel = computed(() => {
  const target = commentTarget.value
  if (!target) return ''
  if (target.kind === 'head') return '卷头与注意事项'
  if (target.kind === 'section') return sectionTitleOf(target.si)
  return `${sectionTitleOf(target.si)} · 第 ${target.qi + 1} 题`
})

const commentTitle = computed(() =>
  commentView.value === 'all' ? '评论 · 全卷' : commentTargetLabel.value ? `评论 · ${commentTargetLabel.value}` : '评论',
)

const commentSubtitle = computed(() => {
  if (commentView.value === 'all') {
    const n = comments.value.length
    return n ? `共 ${n} 条评论 · 分在 ${commentGroups.value.length} 处` : '这份卷子还没有评论'
  }
  const n = commentRows.value.length
  return n ? `共 ${n} 条评论` : '还没有人评论，说点什么给同事看'
})

/** 关抽屉：视图一并复位，否则下次从角标打开会落在上一次的索引页上 */
function closeComment() {
  commentTarget.value = null
  commentView.value = 'one'
}

/**
 * 换视图，并把抽屉正文滚回顶部。
 *
 * 两个视图共用同一个滚动容器（`AppDrawer` 的正文），不滚一下就会停在上一个视图的位置上：
 * 在一条长评论流里滚到底再切到索引，看到的会是索引的**中段**。
 * 滚动目标挂在各视图自己的第一颗元素上（换完视图才存在，所以等一帧）。
 */
const cmtTop = ref<HTMLElement | null>(null)

function switchCommentView(view: 'one' | 'all') {
  commentView.value = view
  void nextTick(() => cmtTop.value?.scrollIntoView({ block: 'start' }))
}

function openComment(target: CommentTarget) {
  commentTarget.value = target
  switchCommentView('one')
  commentTab.value = 'manual'
  commentDraft.value = ''
  aiNote.value = ''
  aiFailed.value = false
  /* 打开时重拉一次：同事在别的页签里评过的话，这里要看得见（mock 在内存里，代价就是一次查询） */
  void refreshComments()
}

/**
 * 按题目 id 打开评论抽屉（角标与题目操作条都只知道 id）。
 * 卷面上同一道题只出现一次，扫一遍大题拿到它所在的 `si / qi` 就够了 ——
 * 比让每个调用方自己维护一份「题 → 位置」的映射省事，也不会随分版变化而失效。
 */
function openCommentForQuestion(questionId: number) {
  const target = questionTargetOf(questionId)
  if (target) openComment(target)
}

/** 卷面角标：目标由块自己算，非评论目标（材料 / 附加区块）点了也没处去 */
function openCommentForBlock(block: EditBlock) {
  const target = commentTargetOfBlock(block)
  if (target) openComment(target)
}

/**
 * 块上的评论条数：0 表示这一块没有评论目标（材料 / 附加区块），或还没有人评 —— 模板据此不渲染角标。
 *
 * 角标挂在**块自己身上、但落在块外的右栏距里**（见 `.pe-q-cmt`）。位置交给纸面的排版算，
 * 这里一个坐标都不量：量坐标的那一版（另起一层挂在纸面外、贴画布右缘）在缩放后对不上题 ——
 * `offsetTop` 是**未缩放**的排版坐标，而纸面是用 `transform: scale(zoom)` 画出来的，
 * 只有 zoom 恰好等于 1 时两者才重合。挂在块上就与缩放 / 分版天然同步，也少一套 rAF 重量。
 */
function commentBadgeOf(block: EditBlock): number {
  const target = commentTargetOfBlock(block)
  return target ? countOf(target) : 0
}

/** 操作条的锚点：只有题目块挂 `data-qbar`（返回 null 时 Vue 会把整个属性去掉） */
function barAnchorOf(block: PaperBlockModel): number | null {
  return block.kind === 'question' ? block.questionId : null
}

const CHECK_OVERALL_TEXT = { pass: '检测通过', warn: '建议关注', fail: '需修正' } as const

/** 喂给 AI 检测的单题上下文：直接用卷面里那一题的原始字段（与录题页的检测入口同一套入参） */
function checkInputOf(si: number, qi: number) {
  const item = itemOf(sections.value[si]?.questions[qi]?.questionId ?? 0)
  if (!item) return null
  return {
    subject: item.subject,
    grade: item.grade,
    type: item.type,
    difficulty: item.difficulty,
    knowledge: [...item.knowledge],
    stem: item.stem,
    options: item.options,
    answer: item.answer,
    analysis: item.analysis,
  }
}

/**
 * 把检测结论拼成草稿。
 *
 * 草稿框是 `<textarea>`，加粗与字号一概落不进去，**「加重」在这条路上只能用【】** ——
 * 每段的维度名（答案 / 解析 / 题干…）都框在【】里，与正文一眼分得开。
 *
 * 题号只写一处：单题目标的题号在抽屉标题里已经写过了，正文的第一行不再重复一遍
 * （原先两处都写，看起来就是「第 1 题」说了两遍）。
 *
 * **首行不写引擎名**（`report.engine`）。曾经标过「Deepseek / 本地演示」，是为了公示这次的结论
 * 出自真机还是本地启发式；但这条评论是写给同事看的卷面意见，不是运行报告，模型名属于噪音。
 * 结论的来路在评论列表里已经由「AI」标记交代了 —— 别再往首行加回去。
 */
function buildCheckDraft(target: CommentTarget, ok: Array<{ qi: number; report: AiCheckReport }>): string {
  if (target.kind === 'head') return ''
  /* 题型级是在替整段说话，标题上要给出**最坏**的那一条：8 题里有一题需修正，
     整段就不能标成「检测通过」 */
  const overall = ok.some((row) => row.report.overall === 'fail')
    ? 'fail'
    : ok.some((row) => row.report.overall === 'warn')
      ? 'warn'
      : 'pass'
  const scope =
    target.kind === 'question'
      ? `${sectionTitleOf(target.si)} · 第 ${target.qi + 1} 题`
      : `${sectionTitleOf(target.si)} · 覆盖 ${ok.length} 题`
  const lines = [`【AI 检测】${scope} · ${CHECK_OVERALL_TEXT[overall]}`]
  ok.forEach(({ qi, report }) => {
    /* 覆盖多题时每题得有个小节标题；单题时标题里已经点明是哪一道，不必再来一层 */
    if (ok.length > 1) lines.push('', `【第 ${qi + 1} 题 · ${CHECK_OVERALL_TEXT[report.overall]}】`)
    for (const row of report.items) lines.push(`【${row.aspect}】${toPlainText(row.message)}`)
  })
  return lines.join('\n')
}

/**
 * 跑一次 AI 检测并把结论填进草稿。
 *
 * 题型级没有单题的上下文可喂，只能对该题型**逐题各跑一次**再把结论聚成一条 ——
 * 这正是题型级评论该有的样子：它说的是这一整段的问题，不是某一道题的问题。
 * 检测结果先落草稿而不是直接入库：老师得能看一眼、改两个字再发，否则 AI 的话就成了「系统说的」。
 *
 * 用的是 `allSettled` 而不是顺序 await：这是真机请求（配了 Key 就是逐题一次 Deepseek 调用），
 * 顺序跑小题多时要等很久，而且**一道失败不该让整段结论全丢** —— 成功的照样成文，
 * 失败的单独说明。跑的过程在按钮上给出 `3/8` 的进度，否则那个等待看起来就是卡死。
 */
async function runAiCheck() {
  const target = commentTarget.value
  if (!target || aiRunning.value || target.kind === 'head') return
  const section = sections.value[target.si]
  if (!section) return
  const picks = target.kind === 'question' ? [target.qi] : section.questions.map((_, qi) => qi)
  if (!picks.length) {
    showToast('这个大题下还没有题目，AI 没有可检测的内容', 'error')
    return
  }
  aiRunning.value = true
  aiFailed.value = false
  aiNote.value = ''
  aiProgress.value = { done: 0, total: picks.length }
  try {
    const settled = await Promise.allSettled(
      picks.map(async (qi) => {
        try {
          const input = checkInputOf(target.si, qi)
          if (!input) throw new Error('在题库里找不到这道题的原始信息')
          return await checkQuestionByAi(input)
        } finally {
          aiProgress.value = { done: aiProgress.value.done + 1, total: picks.length }
        }
      }),
    )
    const ok: Array<{ qi: number; report: AiCheckReport }> = []
    const failed: string[] = []
    settled.forEach((row, index) => {
      const qi = picks[index]
      if (row.status === 'fulfilled') ok.push({ qi, report: row.value })
      else failed.push(`第 ${qi + 1} 题：${row.reason instanceof Error ? row.reason.message : '检测失败'}`)
    })
    if (!ok.length) {
      aiFailed.value = true
      aiNote.value = `AI 检测没有拿到任何结论 —— ${failed.join('；')}`
      showToast('AI 检测没有拿到任何结论', 'error')
      return
    }
    commentDraft.value = buildCheckDraft(target, ok)
    const note = `已完成 ${ok.length}/${picks.length} 题`
    aiFailed.value = failed.length > 0
    aiNote.value = failed.length ? `${note}；未完成的 —— ${failed.join('；')}` : note
    showToast('AI 检测完成，确认内容后点「发表评论」', 'success')
  } catch (error) {
    aiFailed.value = true
    aiNote.value = error instanceof Error ? error.message : 'AI 检测失败，请稍后重试'
    showToast(aiNote.value, 'error')
  } finally {
    aiRunning.value = false
    aiProgress.value = { done: 0, total: 0 }
  }
}

/** 评论目标的口语称呼，用在 toast 里（「该题」/「该大题」/「卷头」） */
function commentTargetNoun(target: CommentTarget): string {
  if (target.kind === 'question') return '该题'
  return target.kind === 'section' ? '该大题' : '卷头'
}

/** 落库：手写与 AI 检测共用一条路径，只有 `source` 不同 */
async function submitComment() {
  const target = commentTarget.value
  if (!target) return
  const body = commentDraft.value.trim()
  if (!body) {
    showToast('请先写下评论内容', 'error')
    return
  }
  const section = target.kind === 'head' ? null : sections.value[target.si]
  if (target.kind !== 'head' && !section) return
  try {
    await addPaperComment({
      paperId: form.id,
      target: target.kind,
      sectionId: section?.id,
      questionId: target.kind === 'question' ? section?.questions[target.qi]?.questionId : undefined,
      body,
      source: commentTab.value === 'ai' ? 'ai' : 'manual',
    })
    await refreshComments()
    /* 抽屉不关：刚发的那条立刻出现在上面，老师能看着它落地（关掉反而像没存上） */
    commentDraft.value = ''
    showToast(
      commentTab.value === 'ai' ? `已把 AI 检测结论记为${commentTargetNoun(target)}的评论` : '评论已发表',
      'success',
    )
  } catch (error) {
    showToast(error instanceof Error ? error.message : '评论保存失败', 'error')
  }
}

async function removeComment(row: PaperComment) {
  const ok = await appConfirm(`删除 ${row.author} 的这条评论？`, { title: '删除评论', type: 'danger' })
  if (!ok) return
  try {
    await deletePaperComment(row.id)
    await refreshComments()
    showToast('评论已删除', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '删除失败', 'error')
  }
}

/* ================= 卷面上的逐题动作 =================
 *
 * 题目操作条（`QuestionActionBarHost`）负责画与定位，这里只接住它抛上来的三个动作 ——
 * 收藏与组卷车在壳里自己处理掉了。预览页接的是同一组事件、开的是同一套弹窗，
 * 所以「预览 / 纠错 / 相似」在编辑页与预览页说的是同一个东西。
 */

/** 从操作条打开的子弹窗：非空即打开（与试卷预览同一套开关方式） */
const peekTarget = ref<OrgQuestion | null>(null)
const correctTarget = ref<OrgQuestion | null>(null)
const similarTarget = ref<OrgQuestion | null>(null)

/**
 * 子弹窗的遮罩层级：操作条定位壳是 130（`QuestionActionBarHost` 的默认值），
 * 子弹窗必须压在它上面，否则点开「预览」后操作条还浮在抽屉上。
 * 与预览页「遮罩 +1 给操作条、再 +10 给子弹窗」是同一口径，只是这里没有遮罩要躲。
 */
const ACTION_Z = 140

/**
 * 页面上任何一个浮层打开时，都关掉题目操作条（`enabled` 传 false）。
 *
 * 不只是「别挡着」：操作条 Teleport 在 body 上、层级 130，而评论抽屉是 110 ——
 * 抽屉一开，那条还停在被选中的题上的操作条就会被画成**浮在抽屉之上**的一条，遮罩盖不住它。
 * 关 `enabled` 比逐个 watch 目标 ref 更彻底：`QuestionActionBarHost` 里「离开题块回落到
 * 选中题」那条路径（`onMouseOut`）也会一起被封住，否则鼠标一挪它自己又回来了。
 */
const actionBarBlocked = computed(
  () =>
    !!(
      commentTarget.value ||
      peekTarget.value ||
      correctTarget.value ||
      similarTarget.value ||
      mediaOpen.value ||
      replaceTarget.value ||
      rejectTarget.value ||
      previewOpen.value ||
      smartOpen.value ||
      checkOpen.value
    ),
)

/**
 * 纠错记录：拉一份全量、按题判定。
 * 既是「已提交纠错」按钮态的依据（口径同「试题」页签：谁提的都算，说明这题有问题），
 * 也喂给题目预览抽屉的 `corrections`。拉不到就退化成「按钮一律显示纠错」，不白屏。
 */
const corrections = ref<QuestionCorrection[]>([])
const correctedSet = computed(() => new Set(corrections.value.map((row) => row.questionId)))
function correctionsOf(questionId: number): QuestionCorrection[] {
  return corrections.value.filter((row) => row.questionId === questionId)
}
/**
 * 提交纠错之后：翻按钮态 + **把这条反馈记进该题的评论**。
 *
 * 纠错记录只在「试题」页签里看得到，而组卷的人是在这张卷子上干活的 —— 不落一条评论的话，
 * 处理人提了问题，同卷的其他人在这张卷子上看不到任何痕迹。这条评论不是谁敲进去的话
 * （`source: 'correct'`，列表里标出来），正文由纠错内容拼成，作者就是提交人。
 */
async function onCorrectionSubmitted(payload: { questionId: number; types: string[]; description: string }) {
  const { questionId } = payload
  if (!correctedSet.value.has(questionId)) {
    /* 只补一个 id：列表里其它字段（类型 / 描述）是预览抽屉才要的，提交后没必要重拉全量 */
    corrections.value = [
      ...corrections.value,
      { id: 0, questionId, types: [], description: '', reporter: '', createdAt: '' },
    ]
  }
  const target = questionTargetOf(questionId)
  const section = target && target.kind === 'question' ? sections.value[target.si] : null
  if (!section) return
  const detail = toPlainText(payload.description).trim()
  const body = [`已提交纠错 · ${payload.types.join('、')}`, detail].filter(Boolean).join('\n')
  try {
    await addPaperComment({
      paperId: form.id,
      target: 'question',
      sectionId: section.id,
      questionId,
      body,
      source: 'correct',
    })
    await refreshComments()
    showToast('纠错内容已同步为该题的评论', 'success')
  } catch (error) {
    /* 纠错本身已经落库了，评论没写上不该让整件事看起来失败 */
    showToast(error instanceof Error ? error.message : '纠错已提交，但评论没能同步', 'error')
  }
}

/** 编辑页没有筛选面板可切：说清去哪儿切，好过按钮点了没反应（与预览页同一句话） */
function onSimilarFilter() {
  showToast('按知识点筛选在「试题」页签可用')
  similarTarget.value = null
}

const barHost = ref<InstanceType<typeof QuestionActionBarHost> | null>(null)

/**
 * 缩放变化 / 重新分版时收掉操作条 —— 与试卷预览同一条兜底。
 *
 * 这两种变化都会让操作条**站在原地不动**：它记的是上一次量到的屏幕坐标，而纸面
 * 已经换了一副样子（缩放改了 scale、分版把整块 DOM 换掉，锚点甚至已经脱离文档）。
 * 与其在一个错的位置上重新算，不如收掉：下一次悬停或选中变化时它会出现在对的地方。
 * 分版只在结构性编辑后发生，而那时指针几乎总在工具条 / 目录上，人看不到这一下收起。
 */
watch([zoom, sheets], () => barHost.value?.hide())

function scrollToBlock(key: string) {
  document.querySelector(`[data-block="${key}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

function mmOf(px: number): number {
  return Math.round(px / (96 / 25.4))
}
</script>

<template>
  <div class="pe-shell">
    <!-- ===== 顶部：品牌 + 卷名 + 主操作 + 登录人 =====
         本页不在 AppLayout 里（全屏工作台），所以品牌与登录人得自带一套 ——
         新标签页打开时顶部一片空白的话，用户不知道自己站在哪个系统里。 -->
    <header class="pe-head">
      <!-- logo 兼作「回首页」：本页是独立新标签页，没有侧边栏可点，顶栏这块是最顺手的出口 -->
      <button class="pe-brand" type="button" title="返回工作台首页" @click="router.push('/dashboard')">
        <img src="/logo.png" alt="AI教学云平台" />
        <span>AI教学云平台</span>
      </button>
      <span class="pe-head-sep" />

      <div class="pe-title-wrap">
        <!-- 卷名是**卷头字段**，属于全局设置的一部分：处理人改不了 -->
        <input
          v-model="form.name"
          class="pe-title"
          maxlength="50"
          placeholder="试卷名称（2-50 字）"
          :readonly="!canEditPaper"
          :title="canEditPaper ? undefined : '试卷名称由发起人维护'"
        />
        <div class="pe-title-meta">
          <span>{{ form.subject }} · {{ form.grade }} · {{ totalCount }} 题 · {{ totalScore }} 分 · {{ form.duration }} 分钟</span>
          <span class="pe-owner">出卷人 {{ meta.owner }}</span>
          <span v-if="currentTask" class="tag tag-blue">协同组卷 · {{ currentTask.members.length }} 人</span>
          <span v-if="currentTask" class="tag" :class="COLLAB_STATUS_CLASS[currentTask.status]">
            {{ COLLAB_STATUS_TEXT[currentTask.status] }}
          </span>
          <span v-if="collabLimited" class="tag tag-orange" title="你只能修改自己负责的题型，其余部分只读">
            以 {{ activeName || '—' }} 的身份编辑
          </span>
        </div>
      </div>

      <!-- 顶栏只留「这一页独有、别处进不去」的动作：
           撤销/重做下面工具条里有，导出/打印/卷面版本在预览弹窗里有（那里本来就是导出的发起点），
           返回也没必要 —— 本页是别人的新标签页，关掉即可。 -->
      <div class="pe-head-ops">
        <button
          v-if="currentTask && !canEditPaper"
          class="btn btn-ghost btn-sm"
          type="button"
          title="查看本卷的组卷设置与各题型进度"
          @click="panelRail = panelRail === 'collab' ? '' : 'collab'"
        >
          <AppIcon name="users" :size="14" /> 组卷信息
        </button>
        <button v-else class="btn btn-ghost btn-sm" type="button" @click="openCollab">
          <AppIcon name="users" :size="14" /> {{ currentTask ? '组卷信息' : '协同组卷' }}
        </button>
        <button class="btn btn-ghost btn-sm" type="button" @click="previewOpen = true">
          <AppIcon name="eye" :size="14" /> 预览
        </button>
        <button v-if="!readOnlyMember" class="btn btn-ghost btn-sm" type="button" :disabled="saving" @click="save(false)">
          {{ saving ? '保存中…' : '保存' }}
        </button>
        <!-- 提交紧跟保存之后：保存与提交流程本就是一步接一步的两个动作，
             原来一个在顶栏、一个在底栏，会让人以为「提交」是另一处的事。
             谁是「提交」随角色变（处理人交自己那段 / 发起人送审），文案与禁用原因由 submitAction 给。
             两颗并排只留一颗 primary（提交）—— 保存降为 ghost，否则顶上两颗实心按钮抢同一份强调。 -->
        <button
          v-if="submitAction"
          class="btn btn-primary btn-sm"
          type="button"
          :disabled="submitAction.disabled || submitBusy"
          :title="submitAction.hint"
          @click="onSubmitClick"
        >
          <AppIcon :name="submitAction.icon" :size="14" />
          {{ submitBusy ? '提交中…' : submitAction.text }}
        </button>

        <!-- 登录人：与「以谁的身份编辑」是两件事，所以并排放而不是合并 ——
             上面那个 tag 说的是这次以谁的名义收题，这里说的是「你是谁」。
             样式的每个数值都对着 AppLayout 的 `.user-chip` 抄（那边 CSS 有注释），
             两处并排看要一样高矮；不带下拉菜单，所以省掉箭头与它的右内边距。 -->
        <span class="v-divider" />
        <div class="pe-user">
          <AppAvatar
            :name="auth.user?.name"
            :hue="auth.user?.avatarHue ?? 172"
            :avatar="auth.user?.avatar"
          />
          <span class="pe-user-meta">
            <span class="pe-user-name">{{ auth.user?.name ?? '未登录' }}</span>
            <span class="pe-user-role">{{ auth.user?.roleName ?? '' }}</span>
          </span>
        </div>
      </div>
    </header>

    <!-- ===== 工具栏（对标 Word 式功能条：插入 / 视图） =====
         刻意不再摆「版式 / 纸张 / 方向」：那三项是**卷级**设置，全文设置面板与底部版式条里
         都已经有了，工具栏再放一份，改完不知道以哪一处为准。这里只留随手要用的动作。
         「目录」开关也不在这里 —— 它挪到了左边框上（见 .pe-outline-tab）。 -->
    <div class="pe-toolbar">
      <div class="pe-tool-group">
        <button class="pe-tool" type="button" :disabled="!canUndo" @click="undo"><AppIcon name="undo" :size="14" /> 撤销</button>
        <button class="pe-tool" type="button" :disabled="!canRedo" @click="redo"><AppIcon name="redo" :size="14" /> 重做</button>
      </div>
      <span class="pe-tool-sep" />
      <div class="pe-tool-group">
        <!-- 表格 / 四线格 / 横线：格型会越加越多，用下拉而不是平铺三个按钮。
             这些是**卷级版式**，与「插入大题 / 导入文档」同属发起人的活。 -->
        <AppDropdownMenu :items="extraItems" align="left" :width="186" @select="insertExtra">
          <button class="pe-tool" type="button" :disabled="!canEditPaper" :title="canEditPaper ? undefined : '卷面版式由发起人维护'">
            <AppIcon name="grid" :size="14" /> 插入格子 <AppIcon name="chevron-down" :size="12" />
          </button>
        </AppDropdownMenu>
        <!-- 插入题目：两条路（人工翻题库 / 按组卷要求智能抽题）合成一个下拉。
             智能选题不可用时**置灰并在 title 里说明原因**，不做成「点了才报错」。 -->
        <AppDropdownMenu :items="insertQuestionItems" align="left" :width="238" @select="onInsertQuestion">
          <button class="pe-tool" type="button" :title="canSmartPick ? '按来源插入题目' : smartBlockReason">
            <AppIcon name="plus" :size="14" /> 插入题目 <AppIcon name="chevron-down" :size="12" />
          </button>
        </AppDropdownMenu>
        <button
          class="pe-tool"
          type="button"
          :disabled="!canEditPaper"
          :title="canEditPaper ? undefined : `大题结构由发起人维护（你负责：${myTypes.join('、') || '未分配'}）`"
          @click="addSection"
        >
          <AppIcon name="list-ol" :size="14" /> 插入大题
        </button>
        <button
          class="pe-tool"
          type="button"
          :disabled="!canEditPaper || !sections.length"
          :title="canEditPaper ? undefined : '导入文档由发起人操作'"
          @click="panelRail = 'import'"
        >
          <AppIcon name="upload" :size="14" /> 导入文档
        </button>
      </div>
      <span class="pe-tool-sep" />
      <div class="pe-tool-group">
        <span class="pe-tool-label">缩放</span>
        <div class="pe-seg pe-zoom-seg">
          <button type="button" title="缩小" @click="nudgeZoom(-0.1)"><AppIcon name="minus" :size="13" /></button>
          <!-- 数字可手输：`%` 单独一个 span，才能和数字在同一行里上下居中对齐 -->
          <label class="pe-zoom-cell" title="可直接输入百分比">
            <input :value="zoomText" inputmode="numeric" aria-label="缩放百分比" @change="onZoomInput" />
            <span>%</span>
          </label>
          <button type="button" title="放大" @click="nudgeZoom(0.1)"><AppIcon name="plus" :size="13" /></button>
        </div>
        <button class="pe-tool" type="button" :class="{ on: autoFit }" @click="autoFit = true">适应</button>
      </div>
      <div class="pe-tool-group pe-tool-right">
        <span class="pe-tool-hint">共 {{ sheets.length }} 页 · 一面 {{ geo.panels }} 版</span>
      </div>
    </div>

    <div class="pe-body">
      <!-- ===== 左：目录（大纲） ===== -->
      <aside v-if="outlineOpen" class="pe-outline">
        <div class="pe-outline-head">
          <span>目录</span>
          <button class="pe-icon-btn" type="button" title="收起" @click="outlineOpen = false">
            <AppIcon name="close" :size="13" />
          </button>
        </div>
        <!-- 卷头那一行与题型行同构：都带一个评论入口（卷头也能被说一句，比如「密封线位置不对」） -->
        <div class="pe-ol-line">
          <button class="pe-ol-row" type="button" @click="scrollToBlock('p-head')">
            <AppIcon name="file" :size="13" /> 卷头与注意事项
          </button>
          <button
            class="pe-ol-cmt"
            :class="{ hot: headCommentCount > 0 }"
            type="button"
            :title="headCommentCount ? `卷头有 ${headCommentCount} 条评论` : '评论卷头'"
            @click.stop="openComment({ kind: 'head' })"
          >
            <AppIcon name="message" :size="12" />
            <span v-if="headCommentCount">{{ headCommentCount }}</span>
          </button>
        </div>
        <div v-for="row in outlineRows" :key="row.si" class="pe-ol-group">
          <!-- 协同任务里目录行后面跟的不再是「几题几分」，而是**谁负责、收了多少、什么状态**：
               分值点开题目就看得到，而「还差几道、该谁动」是这张卷子当天的真问题。 -->
          <div class="pe-ol-line">
            <button
              class="pe-ol-row strong"
              :class="{ mine: row.mine, locked: row.locked }"
              type="button"
              :title="row.locked ? row.lockWhy : undefined"
              @click="scrollToBlock(`p-s-${row.si}`)"
            >
              {{ row.title }}
              <em v-if="row.collab">
                <span class="pe-ol-who">{{ row.collab.memberName }}</span>
                <span class="pe-ol-have" :class="{ full: row.collab.have >= row.collab.want }">
                  {{ row.collab.have }}/{{ row.collab.want || '—' }}
                </span>
                {{ row.collab.memberStatus }}
              </em>
              <em v-else>{{ row.count }} 题 / {{ row.score }} 分</em>
            </button>
            <!-- 图标集里没有锁，用「眼睛」表达只读：这行只能看、不能改（原因在 title 上） -->
            <AppIcon v-if="row.locked" name="eye" :size="12" class="pe-ol-lock" />
            <!-- 题型级评论的入口：目录是纵向扫一遍整卷的地方，
                 在这里能直接看得出「哪几个大题有人提了意见」 -->
            <button
              class="pe-ol-cmt"
              :class="{ hot: row.comments > 0 }"
              type="button"
              :title="row.comments ? `「${row.title}」有 ${row.comments} 条评论` : `评论「${row.title}」`"
              @click.stop="openComment({ kind: 'section', si: row.si })"
            >
              <AppIcon name="message" :size="12" />
              <span v-if="row.comments">{{ row.comments }}</span>
            </button>
          </div>
          <button
            v-for="(entry, qi) in sections[row.si].questions"
            :key="qi"
            class="pe-ol-sub"
            type="button"
            @click="scrollToBlock(`p-q-${row.si}-${qi}`)"
          >
            第 {{ qi + 1 }} 题 · {{ itemOf(entry.questionId)?.type ?? '未知' }} · {{ entry.score }} 分
          </button>
        </div>
        <!-- 附加区块列在最后：卷面上它们也排在各答题区之后，目录顺序跟卷面一致 -->
        <button
          v-for="row in extras"
          :key="row.id"
          class="pe-ol-row"
          type="button"
          @click="scrollToBlock(`p-extra-${row.id}`)"
        >
          <AppIcon :name="extraIconOf(row.kind)" :size="13" /> {{ extraTextOf(row.kind) }}
          <em v-if="row.kind === 'table'">{{ row.rows }} × {{ row.cols }}</em>
          <em v-else>{{ row.rows }} 行</em>
        </button>
        <p class="pe-outline-tip">点击目录可定位到卷面对应位置</p>
      </aside>

      <!-- ===== 中：纸面画布 =====
           块工具条是**钉死的**（不随纸面滚动），它下面的 .pe-stage-main 里只有画布：
           滚动只发生在 .pe-canvas 里。
           原先工具条在画布内部用 `position: sticky`，于是它既被纸页滚动拖着走、又参与内容重排 ——
           在工具条里改个分值，卷面重新分版、整叠纸页卸载重建，滚动位置就被一起带走了。
           拆成上下两层后，工具条的高度变化再也影响不到画布的滚动几何。 -->
      <div class="pe-stage">
        <!-- 块工具条：选中块的即时操作 -->
        <div v-if="selected" class="pe-blockbar">
          <!-- 选中的是**别人负责的大题**（或卷头 / 附加区块这类卷级内容）：工具条换成一句说明，
               而不是把按钮画出来再置灰 —— 十来个灰按钮占满一条，反而看不清哪句话说的是「为什么不能动」 -->
          <template v-if="!selectedEditable">
            <span class="pe-bb-label">
              <AppIcon name="eye" :size="13" /> {{ selectedLockReason }}
            </span>
          </template>

          <template v-else-if="selected.kind === 'head'">
            <span class="pe-bb-label">卷头</span>
            <input v-model="form.subject" class="f-input pe-bb-input" style="width: 96px" placeholder="学科" list="pe-subjects" />
            <datalist id="pe-subjects">
              <option v-for="s in subjects" :key="s" :value="s" />
            </datalist>
            <input v-model="form.grade" class="f-input pe-bb-input" style="width: 90px" placeholder="年级" list="pe-grades" />
            <datalist id="pe-grades">
              <option v-for="g in grades" :key="g" :value="g" />
            </datalist>
            <input v-model.number="form.duration" type="number" min="10" max="300" class="f-input pe-bb-input" style="width: 76px" />
            <span class="pe-bb-hint">分钟</span>
          </template>

          <!-- 附加区块：行列数就地改。只有表格有列数，四线格与横线都是通栏 -->
          <template v-else-if="selectedExtra">
            <span class="pe-bb-label">{{ selectedExtraText }}</span>
            <input
              type="number"
              min="1"
              max="40"
              class="f-input pe-bb-input"
              style="width: 70px"
              :value="selectedExtra.rows"
              @change="setExtraSize('rows', Number(($event.target as HTMLInputElement).value))"
            />
            <span class="pe-bb-hint">行</span>
            <template v-if="selectedExtra.kind === 'table'">
              <input
                type="number"
                min="1"
                max="40"
                class="f-input pe-bb-input"
                style="width: 70px"
                :value="selectedExtra.cols"
                @change="setExtraSize('cols', Number(($event.target as HTMLInputElement).value))"
              />
              <span class="pe-bb-hint">列</span>
            </template>
            <button class="mini-btn danger" type="button" @click="removeExtra">删除此块</button>
          </template>

          <template v-else-if="selected.kind === 'section' && selectedSection">
            <span class="pe-bb-label">大题标题</span>
            <input
              class="f-input pe-bb-input"
              style="width: 220px"
              :value="selectedSection.title"
              @change="renameSection(selected.si, ($event.target as HTMLInputElement).value)"
            />
            <span class="pe-bb-hint">{{ selectedSection.questions.length }} 题</span>
            <input
              type="number"
              min="0.5"
              max="100"
              step="0.5"
              class="f-input pe-bb-input"
              style="width: 74px"
              placeholder="每题分"
              @change="applySectionScore(selected.si, Number(($event.target as HTMLInputElement).value))"
            />
            <span class="pe-bb-hint">统一分值</span>
            <button class="pe-bb-btn" type="button" @click="moveSection(selected.si, -1)">上移</button>
            <button class="pe-bb-btn" type="button" @click="moveSection(selected.si, 1)">下移</button>
            <button class="pe-bb-btn danger" type="button" @click="removeSection(selected.si)">删除大题</button>
          </template>

          <template v-else-if="selected.kind === 'material' && selectedSection">
            <span class="pe-bb-label">大题材料</span>
            <input
              class="f-input pe-bb-input"
              style="width: 180px"
              placeholder="作答提示，如「阅读下面的文字，完成 1～3 题。」"
              :value="selectedSection.materialHint ?? ''"
              @change="selectedSection.materialHint = ($event.target as HTMLInputElement).value"
            />
            <button class="pe-bb-btn" type="button" @click="panelRail = panelRail === '' ? 'settings' : panelRail">在右侧编辑正文</button>
          </template>

          <template v-else-if="selected.kind === 'question' && selectedQuestion">
            <span class="pe-bb-label">第 {{ selected.qi + 1 }} 题</span>
            <span class="tag tag-gray">{{ selectedQuestion.item?.type ?? '未知' }}</span>
            <span class="tag tag-gray">{{ selectedQuestion.item?.difficulty ?? '—' }}</span>
            <input
              type="number"
              min="0.5"
              max="100"
              step="0.5"
              class="f-input pe-bb-input"
              style="width: 74px"
              :value="selectedQuestion.score"
              @change="setScore(selected.si, selected.qi, Number(($event.target as HTMLInputElement).value))"
            />
            <span class="pe-bb-hint">分</span>
            <button class="pe-bb-btn" type="button" @click="moveQuestion(selected.si, selected.qi, -1)">上移</button>
            <button class="pe-bb-btn" type="button" @click="moveQuestion(selected.si, selected.qi, 1)">下移</button>
            <button class="pe-bb-btn" type="button" @click="moveQuestionAcross(selected.si, selected.qi, -1)">并入上一大题</button>
            <button class="pe-bb-btn" type="button" title="同知识点 / 题型 / 难度替换" @click="onSwap">换一题</button>
            <button class="pe-bb-btn danger" type="button" @click="removeQuestion(selected.si, selected.qi)">移除</button>
          </template>

          <!-- 评论入口在两条分支之外单独挂：它是**只读处理人也该有的动作**，
               所以不能被上面那条「不是你的大题 → 整条工具条换成说明」的分支吞掉。 -->
          <button
            v-if="selectedCommentTarget"
            class="pe-bb-btn pe-bb-comment"
            type="button"
            :title="`评论${commentTargetNoun(selectedCommentTarget)}`"
            @click="openComment(selectedCommentTarget)"
          >
            <AppIcon name="message" :size="13" /> 评论
            <em v-if="selectedCommentCount">{{ selectedCommentCount }}</em>
          </button>
        </div>

        <!-- 画布：中栏的内容区，只有 .pe-canvas 滚动（块工具条钉在它上面） -->
        <div class="pe-stage-main">
          <!-- 目录开关：贴在左边界上的竖把手，只在目录**收起**时露出来。
               展开后由目录自带的「收起」按钮接管 —— 同一时刻只有一个开关，
               不会出现「两个都能点、点了还不知道会怎样」的重复入口。
               它是 .pe-stage-main 的第一个盒子（绝对定位，不占版面宽度），所以 `top: 10px`
               永远是「块工具条下面一点」—— 挂在 .pe-body 上时这个 10px 正好压住工具条，
               而工具条会随窗口变窄折行、写死的偏移躲不过去。 -->
          <button v-if="!outlineOpen" class="pe-outline-tab" type="button" title="展开目录" @click="outlineOpen = true">
            <AppIcon name="list-ul" :size="14" />
            <span>目录</span>
          </button>

          <div ref="canvas" class="pe-canvas">
            <div v-if="loading" class="pe-empty">正在载入试卷…</div>
            <div v-else-if="totalCount === 0 && !sections.length" class="pe-empty">该试卷还没有大题</div>
            <div v-else-if="!measured" class="pe-empty">正在按 {{ size.name }} 纸面排版…</div>

            <div v-for="sheet in measured ? sheets : []" :key="sheet.key" class="pe-page">
              <div class="pe-page-tag">第 {{ sheet.index }} 页 / 共 {{ sheet.total }} 页</div>
              <div class="pe-sheet-wrap" :style="sheetWrapStyle">
                <div class="pe-sheet" :style="sheetStyle">
                  <div v-if="preset.headStyle === 'seal'" class="pe-seal">
                    <span>姓名＿＿＿＿＿ 班级＿＿＿＿＿ 考号＿＿＿＿＿ 密封线内不要答题</span>
                  </div>
                  <div class="pe-body-inner" :style="bodyStyle">
                    <div class="pe-panels" :class="{ 'is-multi': geo.panels > 1 }">
                      <div v-for="(panel, pi) in sheet.pages" :key="pi" class="pe-panel">
                        <template v-for="(row, ri) in panel.rows" :key="ri">
                          <div
                            v-if="row.kind === 'full'"
                            class="pe-row"
                            :class="[{ 'is-sel': isSelectedKey(row.block.key), 'is-locked': blockLocked(row.block) }, dragClass(row.block)]"
                            :data-block="row.block.key"
                            :data-qbar="barAnchorOf(row.block)"
                            @click="selectKey(row.block.key)"
                            @dragover="onDragOver(row.block, $event)"
                            @drop="onDrop(row.block, $event)"
                          >
                            <PaperBlock :block="row.block" :paper="paper" :questions="questions" :preset="preset" :teacher="false" />
                            <!-- 拖动排序的把手：挂在行的左缘、垂直居中，**绝对定位** ——
                                 它不能占版面高度。块高是隐藏测量层量出来的，一旦把它算进去，
                                 分版（哪道题落在哪一页）就会跟着变。`left: -18px` 落在纸面左边距里
                                 （各版式 14~24mm ≈ 53~91px），不会被 `.pe-sheet` 的 overflow 裁掉。
                                 只在悬停时显形，与题目操作条同一套语言。 -->
                            <button
                              v-if="draggableBlock(row.block)"
                              class="pe-drag"
                              type="button"
                              title="按住拖动，在本大题内调整题目顺序"
                              draggable="true"
                              @dragstart="onDragStart(row.block, $event)"
                              @dragend="endDrag"
                            >
                              <AppIcon name="move" :size="12" />
                            </button>
                            <!-- 评论角标：有评论才出现，挂在块**外面**的右栏距里（理由见 `.pe-q-cmt`）。
                                 `.stop` 是必须的 —— 不拦的话这一下会顺带把块选中，抽屉开着的同时
                                 块工具条也跟着跳，看起来像误触了别的东西。 -->
                            <button
                              v-if="commentBadgeOf(row.block)"
                              class="pe-q-cmt"
                              type="button"
                              :title="`这里有一条评论（共 ${commentBadgeOf(row.block)} 条），点击查看`"
                              @click.stop="openCommentForBlock(row.block)"
                            >
                              <AppIcon name="message" :size="11" /><span>{{ commentBadgeOf(row.block) }}</span>
                            </button>
                          </div>
                          <div v-else class="pe-row pe-cols" :style="{ gap: `${colGap}px` }">
                            <div v-for="(col, ci) in [row.left, row.right]" :key="ci" class="pe-col">
                              <div
                                v-for="block in col"
                                :key="block.key"
                                class="pe-col-block"
                                :class="[{ 'is-sel': isSelectedKey(block.key), 'is-locked': blockLocked(block) }, dragClass(block)]"
                                :data-block="block.key"
                                :data-qbar="barAnchorOf(block)"
                                @click="selectKey(block.key)"
                                @dragover="onDragOver(block, $event)"
                                @drop="onDrop(block, $event)"
                              >
                                <PaperBlock :block="block" :paper="paper" :questions="questions" :preset="preset" :teacher="false" />
                                <!-- 双栏版式里右栏那一列的 `left: -18px` 落在两栏之间的栏距里
                                     （栏距 = panelW - colW*2，A4 双栏约 30px），同样不会压住正文 -->
                                <button
                                  v-if="draggableBlock(block)"
                                  class="pe-drag"
                                  type="button"
                                  title="按住拖动，在本大题内调整题目顺序"
                                  draggable="true"
                                  @dragstart="onDragStart(block, $event)"
                                  @dragend="endDrag"
                                >
                                  <AppIcon name="move" :size="12" />
                                </button>
                                <!-- 双栏版式下每一栏的块都有自己的角标（挂在该栏块的右栏距里），
                                     与整宽版式同一个组件、同一套样式 -->
                                <button
                                  v-if="commentBadgeOf(block)"
                                  class="pe-q-cmt"
                                  type="button"
                                  :title="`这里有一条评论（共 ${commentBadgeOf(block)} 条），点击查看`"
                                  @click.stop="openCommentForBlock(block)"
                                >
                                  <AppIcon name="message" :size="11" /><span>{{ commentBadgeOf(block) }}</span>
                                </button>
                              </div>
                            </div>
                          </div>
                        </template>
                      </div>
                    </div>
                  </div>
                  <div v-if="preset.pageNumber" class="pe-foot">第 {{ sheet.index }} 页 · 共 {{ sheet.total }} 页</div>
                </div>
              </div>
            </div>

            <!-- 隐藏测量层：与纸面同组件同变量同宽度 -->
            <div ref="measureHost" class="pe-measure" :style="vars">
              <div
                v-for="block in paperBlocks"
                :key="block.key"
                class="pe-measure-item"
                :data-block-key="block.key"
                :style="{ width: measureWidth(block) }"
              >
                <PaperBlock :block="block" :paper="paper" :questions="questions" :preset="preset" :teacher="false" />
              </div>
            </div>
          </div>

        </div>

      </div>

      <!-- ===== 右：面板 + 图标竖栏 ===== -->
      <aside v-if="panelRail" class="pe-side">
        <template v-if="panelRail === 'settings'">
          <div class="pe-side-head">
            <h3>全文设置</h3>
            <button class="pe-icon-btn" type="button" @click="panelRail = ''"><AppIcon name="close" :size="13" /></button>
          </div>
          <!-- 版式 / 纸张 / 注意事项是**全局设置**：协同处理人改不了。整块用 `inert` 关掉，
               而不是逐个控件加 `:disabled` —— 这个面板里有几十个控件，漏一个就是一个越权口子。
               提示放在 inert 之外，否则连这行字都选不中。 -->
          <p v-if="!canEditPaper" class="pe-side-notice">
            <AppIcon name="info" :size="13" />
            全局设置由发起人维护，你负责的是「{{ myTypes.join('、') || '未分配题型' }}」。
          </p>
          <div class="pe-side-body" :inert="!canEditPaper ? true : undefined">
            <div class="pe-field">
              <label>排版样式</label>
              <div class="pe-style-list">
                <button
                  v-for="row in PAPER_LAYOUTS"
                  :key="row.key"
                  class="pe-style"
                  :class="{ on: layoutKey === row.key }"
                  type="button"
                  @click="layoutKey = row.key"
                >
                  <span class="pe-style-name">
                    {{ row.name }}
                    <AppIcon v-if="layoutKey === row.key" name="check" :size="12" />
                  </span>
                  <span class="pe-style-desc">{{ row.desc }}</span>
                  <span class="pe-style-tags">
                    <i>{{ row.fontSize }}px</i>
                    <i>{{ row.optionColumns === 2 ? '选项双列' : '选项单列' }}</i>
                    <i v-if="row.twoColumn && geo.panels === 1">双栏</i>
                  </span>
                </button>
              </div>
            </div>

            <div class="pe-field">
              <label>纸张</label>
              <select v-model="sizeKey" class="f-select">
                <option v-for="row in PAPER_SIZES" :key="row.key" :value="row.key">{{ row.name }}（{{ row.mm }}）· {{ row.note }}</option>
              </select>
            </div>

            <div class="pe-field row2">
              <div>
                <label>方向</label>
                <div class="pe-seg full">
                  <button type="button" :class="{ on: orientation === 'portrait' }" @click="orientation = 'portrait'">纵向</button>
                  <button type="button" :class="{ on: orientation === 'landscape' }" @click="orientation = 'landscape'">横向</button>
                </div>
              </div>
              <div>
                <label>一面版数</label>
                <select v-model.number="panelPick" class="f-select">
                  <option :value="0">自动（{{ size.panels }} 版）</option>
                  <option :value="1">1 版</option>
                  <option :value="2">2 版</option>
                  <option :value="3">3 版</option>
                </select>
              </div>
            </div>

            <div class="pe-field row2">
              <div>
                <label>卷首样式</label>
                <select v-model="headOverride" class="f-select">
                  <option value="">跟随版式（{{ presetOf(layoutKey).headStyle === 'seal' ? '密封线' : presetOf(layoutKey).headStyle === 'form' ? '表格式' : '简洁' }}）</option>
                  <option value="simple">简洁</option>
                  <option value="form">表格式</option>
                  <option value="seal">密封线</option>
                </select>
              </div>
              <div>
                <label>分值位置</label>
                <select v-model="scoreOverride" class="f-select">
                  <option value="">跟随版式</option>
                  <option value="inline">紧跟题号</option>
                  <option value="trail">题干末尾</option>
                </select>
              </div>
            </div>

            <!-- 卷首注意事项：卷面上印在卷头正下方的那一块，一行一条。空着就不印 -->
            <div class="pe-field">
              <label>卷首注意事项</label>
              <textarea
                v-model="noticesDraft"
                class="f-textarea"
                rows="4"
                placeholder="一行一条，卷面按 1．2．3． 顺序印在卷头下方；全部清空则卷面不再印这一块"
              />
              <p class="f-hint">一行一条，同一条内不要换行。清空后卷面不再印这一块。</p>
              <button class="mini-btn" type="button" @click="noticesDraft = DEFAULT_PAPER_NOTICES.join('\n')">
                恢复默认说明
              </button>
            </div>

            <label class="pe-check">
              <input
                type="checkbox"
                :checked="spaceOverride === null ? preset.answerSpace : spaceOverride"
                @change="spaceOverride = ($event.target as HTMLInputElement).checked"
              />
              解答题留作答空白
            </label>

            <div class="pe-facts">
              <p><span>版心</span>每版 {{ mmOf(geo.panelW) }} mm 宽 · 版心高 {{ mmOf(geo.contentH) }} mm</p>
              <p><span>页边距</span>上 {{ preset.margin.top }} / 右 {{ preset.margin.right }} / 下 {{ preset.margin.bottom }} / 左 {{ preset.margin.left }} mm</p>
              <p><span>页数</span>共 {{ sheets.length }} 页（自动分版）</p>
              <p><span>分值</span>总分 {{ totalScore }} 分 · 客观题 {{ objectiveScore }} 分</p>
            </div>

            <p v-if="overflowBlocks.length" class="pe-warn">
              <AppIcon name="warning" :size="13" />
              有 {{ overflowBlocks.length }} 处内容高于整版（如解答题过长），会被纸面裁切；建议换更大纸张或选「紧凑省纸」样式。
            </p>

            <div v-if="selectedSection" class="pe-field">
              <label>「{{ selectedSection.title }}」材料正文</label>
              <textarea
                class="f-textarea"
                rows="6"
                placeholder="阅读材料 / 文言文 / 英语短文（本大题各小题共用，空行分段）"
                :value="selectedSection.material ?? ''"
                @change="updateMaterial(($event.target as HTMLTextAreaElement).value)"
              />
              <p class="f-hint">先在卷面点选大题或材料块，再在这里编辑正文。</p>
            </div>
          </div>
        </template>

        <!-- ===== 组卷信息：这一卷的协同任务（谁负责什么、收了多少、走到哪一步） =====
             原先是独立的任务页，现已并入本页 —— 分工与卷面是同一件事的两面，
             分两个页面看只会让老师来回切。 -->
        <template v-else-if="panelRail === 'collab' && currentTask">
          <div class="pe-side-head">
            <h3>组卷信息</h3>
            <button class="pe-icon-btn" type="button" @click="panelRail = ''"><AppIcon name="close" :size="13" /></button>
          </div>
          <div class="pe-side-body">
            <!-- 流程：谁该动，就出现谁的按钮 -->
            <div class="pe-collab-flow">
              <span class="tag" :class="COLLAB_STATUS_CLASS[currentTask.status]">
                {{ COLLAB_STATUS_TEXT[currentTask.status] }}
              </span>
              <span class="f-hint">发起人 {{ currentTask.owner }}</span>
            </div>

            <!-- 审批动作只认**登录人**（`isOwner` 用的是 myName），与上面「以此身份编辑」无关 -->
            <div v-if="isOwner" class="pe-collab-ops">
              <button v-if="currentTask.status === 'ready'" class="btn btn-primary btn-sm" :disabled="taskBusy" @click="submitForReview">
                <AppIcon name="upload" :size="14" /> 提交审核
              </button>
              <button v-else-if="currentTask.status === 'submitted'" class="btn btn-ghost btn-sm" :disabled="taskBusy" @click="withdrawReview">
                撤回送审
              </button>
              <button v-else-if="currentTask.status === 'rejected'" class="btn btn-primary btn-sm" :disabled="taskBusy" @click="reopenAfterReject">
                <AppIcon name="edit" :size="14" /> 退回修改
              </button>
              <p v-else-if="pendingAccept.length" class="f-hint">
                有 {{ pendingAccept.length }} 位老师的成果待你验收，在下方名单里点「验收通过」或「退回整改」。
              </p>
            </div>

            <!-- 处理人视角：提交 / 撤销各自的题型。已验收是终态，两个按钮都不出现 -->
            <div v-if="!isOwner" class="pe-collab-ops">
              <button v-if="canSubmitMine" class="btn btn-primary btn-sm" :disabled="taskBusy" @click="submitMine">
                <AppIcon name="check" :size="14" /> 提交我的部分
              </button>
              <button v-else-if="canReopenMine" class="btn btn-ghost btn-sm" :disabled="taskBusy" @click="reopenMine">
                撤销提交
              </button>
            </div>

            <!-- 审核驳回意见：整卷的问题，挂在流程下面而不是某位成员名下 -->
            <p v-if="currentTask.status === 'rejected' && paper.reviewOpinion" class="pe-collab-reject">
              <b>审核未通过：</b>{{ paper.reviewOpinion }}
            </p>

            <div class="pe-side-sub">组卷设置</div>
            <dl class="pe-collab-req">
              <dt>学科 / 年级</dt>
              <dd>{{ currentTask.requirement.subject }} · {{ currentTask.requirement.grade }}</dd>
              <dt>考试时长</dt>
              <dd>{{ currentTask.requirement.duration }} 分钟</dd>
              <dt>题型要求</dt>
              <dd>
                <span v-for="row in currentTask.requirement.structure" :key="row.type" class="pe-collab-chip" :class="{ mine: myTypes.includes(row.type) }">
                  {{ row.type }} {{ row.count }} 题 / {{ row.score }} 分
                </span>
              </dd>
              <dt>难度配比</dt>
              <dd>
                <span v-for="row in currentTask.requirement.difficulty" :key="row.level" class="pe-collab-chip plain">
                  {{ row.level }} {{ row.ratio }}%
                </span>
              </dd>
              <dt>考察知识点</dt>
              <dd>
                <span v-if="!currentTask.requirement.knowledge.length" class="f-hint">未指定</span>
                <span v-for="row in currentTask.requirement.knowledge" :key="row" class="pe-collab-chip plain">{{ row }}</span>
              </dd>
              <dt>查看范围</dt>
              <dd>
                <!-- 空数组 = 不限制（不是「谁都不能看」），措辞必须说清，否则用户会以为没人能打开 -->
                <template v-if="!currentTask.viewers.length">本机构所有成员都能查看</template>
                <template v-else>
                  <span class="tag tag-orange">已限制</span>
                  {{ currentTask.viewers.join('、') }}
                </template>
              </dd>
              <dt v-if="currentTask.requirement.remark">命题说明</dt>
              <dd v-if="currentTask.requirement.remark">{{ currentTask.requirement.remark }}</dd>
            </dl>

            <div class="pe-side-sub">以谁的身份编辑</div>
            <!-- 「组卷身份」只决定能编辑哪些题型，与上面的审批按钮无关。
                 放在成员名单里而不是顶栏：顶栏那个人头是**登录人**，两者并排会让人以为是一回事。 -->
            <select
              v-if="currentTask.members.length > 1 && isOwner"
              v-model="activeName"
              class="f-select"
              title="切到某位老师的视角，检查他能不能只动自己负责的题型"
            >
              <option v-for="member in currentTask.members" :key="member.name" :value="member.name">
                {{ member.name }}（{{ member.questionTypes.join('、') }}）
              </option>
            </select>
            <p v-else class="f-hint">
              你在本任务中的角色是<b>{{ isOwner ? '发起人' : `处理人 · ${myTypes.join('、') || '未分配题型'}` }}</b>。
            </p>

            <div class="pe-side-sub">参与老师（{{ currentTask.members.length }}）</div>
            <div v-for="member in currentTask.members" :key="member.name" class="pe-collab-member">
              <div class="pe-collab-member-head">
                <b>{{ member.name }}</b>
                <span v-if="member.name === activeName" class="tag tag-blue">当前身份</span>
                <span class="tag" :class="COLLAB_MEMBER_CLASS[member.status]">{{ COLLAB_MEMBER_TEXT[member.status] }}</span>
              </div>
              <p class="f-hint">{{ member.questionTypes.join('、') }} · 配额 {{ member.quota }} 题</p>
              <div v-if="member.reviewNote" class="pe-collab-note">退回意见：{{ member.reviewNote }}</div>
              <!-- 验收只认登录人是发起人，与「当前身份」无关 -->
              <div v-if="isOwner && member.status === 'submitted'" class="pe-collab-accept">
                <button class="mini-btn success" :disabled="taskBusy" @click="acceptMember(member)">验收通过</button>
                <button class="mini-btn danger" :disabled="taskBusy" @click="openReject(member)">退回整改</button>
              </div>
            </div>
          </div>
        </template>

        <template v-else-if="panelRail === 'bank'">
          <div class="pe-side-head">
            <h3>试题库</h3>
            <div class="pe-side-head-ops">
              <!-- 智能选题的第二个入口：翻了一半题库、发现自己这一段还差几道时，就手补齐 -->
              <button
                class="mini-btn"
                type="button"
                :disabled="!canSmartPick"
                :title="canSmartPick ? '按协同组卷的基本要求与你的分工自动抽题入卷' : smartBlockReason"
                @click="openSmartPick"
              >
                <AppIcon name="sparkles" :size="13" /> 智能选题
              </button>
              <button class="pe-icon-btn" type="button" @click="panelRail = ''"><AppIcon name="close" :size="13" /></button>
            </div>
          </div>
          <div class="pe-side-body">
            <div class="pe-filters">
              <select v-model="bankFilter.type" class="f-select">
                <option value="">全部题型</option>
                <!-- 题型随试卷学科收窄（英语才有完形填空 / 七选五 / 短文改错）；已选值并入，换学科不会渲染成空白。
                     协同处理人则收窄到他自己负责的题型（见 bankTypes）。 -->
                <option v-for="t in bankTypes" :key="t" :value="t">{{ t }}</option>
              </select>
              <select v-model="bankFilter.difficulty" class="f-select">
                <option value="">全部难度</option>
                <option v-for="d in difficulties" :key="d" :value="d">{{ d }}</option>
              </select>
            </div>
            <input v-model="bankFilter.keyword" class="f-input" placeholder="搜索题干关键词" style="margin-bottom: 10px" />
            <p class="f-hint" style="margin-bottom: 8px">
              仅显示已入库题目 · 共 {{ bankPool.length }} 道
              <template v-if="collabLimited">（已按你负责的「{{ myTypes.join('、') }}」筛选）</template>
            </p>
            <div class="pe-bank-list">
              <div v-for="row in bankPool" :key="row.id" class="pe-bank-card">
                <div class="pe-bank-meta">
                  <span class="tag tag-gray">{{ row.type }}</span>
                  <span class="tag tag-gray">{{ row.difficulty }}</span>
                  <span v-if="row.grade" class="tag tag-gray">{{ row.grade }}</span>
                </div>
                <p class="pe-bank-stem">{{ truncateRich(row.stem, 70) }}</p>
                <div class="pe-bank-foot">
                  <span class="f-hint">{{ row.knowledge[0] ?? '' }}</span>
                  <button class="mini-btn" :disabled="inPaperIds.has(row.id)" @click="addQuestion(row)">
                    {{ inPaperIds.has(row.id) ? '已在卷中' : '+ 加入试卷' }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </template>

        <template v-else-if="panelRail === 'media'">
          <div class="pe-side-head">
            <h3>媒体库</h3>
            <button class="pe-icon-btn" type="button" @click="panelRail = ''"><AppIcon name="close" :size="13" /></button>
          </div>
          <div class="pe-side-body">
            <p class="f-hint" style="margin-bottom: 10px">
              机构媒体库资源。题干配图请在录题中心编辑题目正文时插入（题目正文支持公式与插图）。
            </p>
            <div class="pe-media-grid">
              <button v-for="row in media" :key="row.id" class="pe-media" type="button" @click="mediaOpen = row">
                <div class="pe-media-thumb">
                  <img v-if="row.kind === 'image' && row.url" :src="row.url" :alt="row.name" />
                  <AppIcon v-else :name="row.kind === 'video' ? 'image' : 'smartphone'" :size="18" />
                </div>
                <span class="pe-media-name">{{ truncateRich(row.name, 12) }}</span>
                <span class="pe-media-kind">{{ row.kind === 'image' ? '图片' : row.kind === 'video' ? '视频' : '动画' }}</span>
              </button>
            </div>
            <p v-if="!media.length" class="f-hint">媒体库暂无资源</p>
          </div>
        </template>

        <template v-else-if="panelRail === 'basket'">
          <div class="pe-side-head">
            <h3>资源篮（组卷车）</h3>
            <button class="pe-icon-btn" type="button" @click="panelRail = ''"><AppIcon name="close" :size="13" /></button>
          </div>
          <div class="pe-side-body">
            <div class="pe-basket-bar">
              <span>{{ basket.count.value }} 题 · {{ basket.scoreTotal.value }} 分</span>
              <div class="op-group">
                <!-- 智能选题的第三个入口：人工从篮子里挑剩的缺口，一键按组卷要求补齐 -->
                <button
                  class="mini-btn"
                  type="button"
                  :disabled="!canSmartPick"
                  :title="canSmartPick ? '按协同组卷的基本要求与你的分工自动抽题入卷' : smartBlockReason"
                  @click="openSmartPick"
                >
                  <AppIcon name="sparkles" :size="13" /> 智能选题
                </button>
                <button class="mini-btn" :disabled="!basket.count.value" @click="basketAddAll">全部加入试卷</button>
                <!-- 只清题目：这个面板看不见资源，全清会把用户没看到的东西一起丢掉 -->
                <button class="mini-btn danger" :disabled="!basket.count.value" @click="basket.clear('questions')">清空题目</button>
              </div>
            </div>
            <p v-if="!basket.count.value" class="f-hint">
              组卷车是空的。可先在「题库组卷」工作台把题目加入组卷车，再回到这里一次性并入本卷。
            </p>
            <div v-for="entry in basket.entries.value" :key="entry.questionId" class="pe-basket-row">
              <div>
                <p class="pe-bank-stem">{{ truncateRich(itemOf(entry.questionId)?.stem ?? `题目 #${entry.questionId}`, 54) }}</p>
                <span class="f-hint">{{ itemOf(entry.questionId)?.type ?? '' }} · {{ entry.score }} 分</span>
              </div>
              <div class="op-group">
                <button class="mini-btn" :disabled="inPaperIds.has(entry.questionId)" @click="basketAddOne(entry.questionId)">加入</button>
                <button class="mini-btn danger" @click="basket.remove(entry.questionId)">移除</button>
              </div>
            </div>

            <!-- 参考资料：图片 / 视频 / 小程序，随卷保存（不参与卷面排版） -->
            <div class="pe-basket-bar pe-att-bar">
              <span>参考资料 {{ attachments.length }} 个</span>
              <div class="op-group">
                <button class="mini-btn" :disabled="!pendingAttachments.length" @click="mergeBasketAttachments">
                  并入本卷{{ pendingAttachments.length ? ` (${pendingAttachments.length})` : '' }}
                </button>
              </div>
            </div>
            <p v-if="!attachments.length" class="f-hint">
              还没有参考资料。在「题库组卷」工作台的图片 / 视频 / 小程序页签里加入组卷车，再回这里并入。
            </p>
            <div v-for="row in attachments" :key="`${row.kind}-${row.mediaId}`" class="pe-basket-row">
              <div>
                <p class="pe-bank-stem">{{ row.name }}</p>
                <span class="f-hint">{{ ATTACHMENT_KIND_TEXT[row.kind] }} · {{ row.sizeMb.toFixed(1) }} MB</span>
              </div>
              <div class="op-group">
                <button class="mini-btn danger" @click="removeAttachment(row)">移出</button>
              </div>
            </div>
          </div>
        </template>

        <template v-else-if="panelRail === 'import'">
          <div class="pe-side-head">
            <h3>导入文档</h3>
            <button class="pe-icon-btn" type="button" @click="panelRail = ''"><AppIcon name="close" :size="13" /></button>
          </div>
          <div class="pe-side-body">
            <p class="f-hint" style="margin-bottom: 10px">
              从 Word / 网页复制题目文本粘贴到下面，按题号（或空行）自动切题并入卷。原题型、选项会一并识别。
            </p>
            <textarea v-model="importText" class="f-textarea" rows="8" placeholder="1．已知函数 f(x)=x²-2x，则……&#10;A．0  B．1  C．2  D．3&#10;&#10;2．求……" />
            <div class="pe-filters" style="margin-top: 10px">
              <select v-model="importGrade" class="f-select">
                <option value="">年级跟随试卷（{{ form.grade }}）</option>
                <option v-for="g in grades" :key="g" :value="g">{{ g }}</option>
              </select>
              <select v-model="importDifficulty" class="f-select">
                <option value="">难度：中等</option>
                <option v-for="d in difficulties" :key="d" :value="d">{{ d }}</option>
              </select>
            </div>
            <div v-if="parsed.length" class="pe-parsed">
              <p class="pe-parsed-head">解析出 {{ parsed.length }} 道题：</p>
              <div v-for="(row, i) in parsed.slice(0, 5)" :key="i" class="pe-parsed-row">
                <span class="tag tag-gray">{{ row.type }}</span>
                <span>{{ truncateRich(row.stem, 40) }}</span>
              </div>
              <p v-if="parsed.length > 5" class="f-hint">…等共 {{ parsed.length }} 道</p>
            </div>
            <button class="btn btn-primary" style="width: 100%; margin-top: 12px" type="button" :disabled="importRunning || !parsed.length" @click="runImport">
              {{ importRunning ? '导入中…' : `入库并加入试卷（${parsed.length} 道）` }}
            </button>
          </div>
        </template>

        <template v-else-if="panelRail === 'history'">
          <div class="pe-side-head">
            <h3>历史记录</h3>
            <button class="pe-icon-btn" type="button" @click="panelRail = ''"><AppIcon name="close" :size="13" /></button>
          </div>
          <div class="pe-side-body">
            <template v-if="versions.length">
              <div class="pe-side-sub">协同版本（可撤销 / 替换）</div>
              <div class="pe-timeline">
                <div v-for="row in versions.slice().reverse()" :key="row.id" class="pe-tl-row" :class="{ replaced: row.replaced }">
                  <div class="pe-tl-head">
                    <b>v{{ row.no }}</b>
                    <span>{{ row.actor }}</span>
                    <em>{{ row.time }}</em>
                  </div>
                  <p class="pe-tl-sum">{{ row.summary }}</p>
                  <p class="f-hint">{{ row.questionCount }} 题 · {{ row.totalScore }} 分<template v-if="row.note"> · 备注：{{ row.note }}</template></p>
                  <div class="op-group">
                    <button class="mini-btn" @click="onRestore(row.id)">撤销到此版</button>
                    <button class="mini-btn" @click="replaceTarget = row.id">替换当前</button>
                  </div>
                </div>
              </div>
            </template>

            <div class="pe-side-sub">本次编辑（点击回退）</div>
            <div class="pe-timeline">
              <button
                v-for="(row, i) in snapshots.slice().reverse()"
                :key="`${row.time}-${i}`"
                class="pe-tl-row as-button"
                :class="{ on: pointer === snapshots.length - 1 - i }"
                type="button"
                @click="applySnapshot(snapshots.length - 1 - i)"
              >
                <div class="pe-tl-head">
                  <b>{{ row.label }}</b>
                  <em>{{ row.time }}</em>
                </div>
              </button>
            </div>
          </div>
        </template>
      </aside>

      <nav class="pe-rail">
        <button
          v-for="item in RAIL"
          :key="item.key"
          class="pe-rail-btn"
          :class="{ on: panelRail === item.key }"
          type="button"
          :title="item.label"
          @click="panelRail = panelRail === item.key ? '' : item.key"
        >
          <AppIcon :name="item.icon" :size="17" />
          <span>{{ item.label }}</span>
        </button>
      </nav>
    </div>

    <!-- 底部样式快捷条（对标文档编辑器的段落样式条）+ 右侧动作区 -->
    <footer class="pe-footbar">
      <span class="pe-footbar-label">版式</span>
      <button
        v-for="row in PAPER_LAYOUTS"
        :key="row.key"
        class="pe-footstyle"
        :class="{ on: layoutKey === row.key }"
        type="button"
        @click="layoutKey = row.key"
      >
        {{ row.name }}
      </button>

      <!-- 动作区只留自动保存的状态与开关：保存 / 提交都挪到了顶栏（挨着预览那颗），
           底栏再放一份就是同一件事两个入口，还得跟着角色同步文案与禁用态。
           留在这里的是「卷面正在发生什么」——它跟右边的题数/页数统计是一类信息，
           都不是「按一下做什么」。 -->
      <div class="pe-foot-ops">
        <span v-if="autoSaving" class="pe-save-note">自动保存中…</span>
        <span v-else-if="autoSaveFailed" class="pe-save-note bad" :title="autoSaveFailed">自动保存失败</span>
        <span v-else-if="lastSavedAt && !autoSaveBlockReason" class="pe-save-note">已保存 {{ lastSavedAt }}</span>
        <!-- 不可用时**置灰并说明原因**：一个能点却什么都不做的开关，比没有这个开关更糟 -->
        <button
          class="pe-autosave"
          :class="{ on: autoSaveEnabled && !autoSaveBlockReason }"
          type="button"
          :disabled="!!autoSaveBlockReason"
          :title="
            autoSaveBlockReason ||
            (autoSaveEnabled ? '已开启：改动停手 1.5 秒后自动写入（点一下关闭）' : '已关闭：点一下开启自动保存')
          "
          @click="toggleAutoSave"
        >
          <AppIcon name="clock" :size="13" /> 自动保存
          <span class="pe-dot" />
        </button>
        <span class="pe-footbar-right">{{ totalCount }} 题 · {{ totalScore }} 分 · 共 {{ sheets.length }} 页</span>
      </div>
    </footer>

    <!-- 整卷预览：带编辑页已选定的纸张 / 版式 -->
    <PaperPreviewModal
      v-if="previewOpen"
      :paper="paper"
      :questions="questions"
      :initial-size="previewSize"
      :initial-layout="previewLayout"
      :initial-orientation="orientation"
      :initial-panels="panelPick"
      initial-mode="both"
      @close="previewOpen = false"
    />

    <!-- ===== 智能选题：按协同要求 + 我的分工自动抽题 =====
         面板里同时摊开这个任务的基本要求，让用户知道「按什么抽」——
         只给一个题型下拉的话，抽出来的东西合不合要求只能靠猜。 -->
    <AppModal v-if="smartOpen" title="智能选题" :width="560" @close="smartOpen = false">
      <p class="f-hint" style="margin-bottom: 12px">
        按本卷协同组卷的基本要求，在你负责的题型范围内从题库抽题并插入试卷。
        抽题优先同年级同科、且命中考纲知识点的题目。
      </p>

      <div v-if="currentTask" class="pe-req-brief">
        <div class="pe-req-row">
          <span class="pe-req-key">学科 / 年级</span>
          <span>{{ currentTask.requirement.subject }} · {{ currentTask.requirement.grade }} · {{ currentTask.requirement.duration }} 分钟</span>
        </div>
        <div class="pe-req-row">
          <span class="pe-req-key">题型要求</span>
          <span>
            <span
              v-for="row in currentTask.requirement.structure"
              :key="row.type"
              class="pe-collab-chip"
              :class="{ mine: myTypes.includes(row.type) }"
            >
              {{ row.type }} {{ row.count }} 题 / {{ row.score }} 分
            </span>
          </span>
        </div>
        <div class="pe-req-row">
          <span class="pe-req-key">难度配比</span>
          <span>
            <span v-if="!currentTask.requirement.difficulty.length" class="f-hint">未指定</span>
            <span v-for="row in currentTask.requirement.difficulty" :key="row.level" class="pe-collab-chip plain">
              {{ row.level }} {{ row.ratio }}%
            </span>
          </span>
        </div>
        <div class="pe-req-row">
          <span class="pe-req-key">考查知识点</span>
          <span>
            <span v-if="!currentTask.requirement.knowledge.length" class="f-hint">未指定</span>
            <span v-for="row in currentTask.requirement.knowledge" :key="row" class="pe-collab-chip plain">{{ row }}</span>
          </span>
        </div>
        <p v-if="currentTask.requirement.remark" class="f-hint">命题说明：{{ currentTask.requirement.remark }}</p>
      </div>

      <div class="f-field" style="margin-top: 14px">
        <label class="f-label">题型 <span class="req">*</span></label>
        <select v-model="smartForm.type" class="f-select">
          <option v-for="row in myProgress" :key="row.type" :value="row.type">
            {{ row.type }}（已有 {{ row.have }} / 要求 {{ row.want }}）
          </option>
        </select>
        <p class="f-hint">只列本任务分配给你的题型 —— 分工之外的题抽进来也会被后端拦下。</p>
      </div>

      <div class="pe-smart-row">
        <div class="f-field">
          <label class="f-label">题数</label>
          <input v-model.number="smartForm.count" class="f-input" type="number" min="1" :max="Math.max(1, smartGap)" />
          <p class="f-hint">
            <template v-if="smartGap > 0">「{{ smartForm.type }}」还差 {{ smartGap }} 道，默认按缺口补齐。</template>
            <template v-else>「{{ smartForm.type }}」已满足要求，再抽会超出题数要求。</template>
          </p>
        </div>
        <div class="f-field">
          <label class="f-label">难度偏好</label>
          <select v-model="smartForm.difficulty" class="f-select">
            <option value="">不限</option>
            <option v-for="d in difficulties" :key="d" :value="d">{{ d }}</option>
          </select>
          <p class="f-hint">命中不足时会自动放宽，不会因为难度把可选题压到 0。</p>
        </div>
      </div>

      <label class="pe-smart-check">
        <input v-model="smartForm.allowGenerate" type="checkbox" />
        <span>
          题库可选题不足时，允许 AI 新生成题目补足
          <em>新生成的题以「待审」状态入卷，提交前核对会点名要求复核</em>
        </span>
      </label>

      <template #footer>
        <button class="btn btn-ghost" :disabled="smartRunning" @click="smartOpen = false">取消</button>
        <button class="btn btn-primary" :disabled="smartRunning" @click="runSmartPick">
          <AppIcon name="sparkles" :size="14" />
          {{ smartRunning ? '抽取中…' : '开始抽取' }}
        </button>
      </template>
    </AppModal>

    <!-- ===== 提交前的核对与 AI 检测 =====
         上半是本地即时核对（纯计算，打开就有，不等网络），下半的 AI 检测要点一下才发请求。
         「仍然提交」恒可点：这里**只提示、不拦** —— 真正的硬门槛是后端的配额校验，
         前端拦一道只会让人以为没救。 -->
    <AppModal v-if="checkOpen" title="提交前的核对" :width="600" @close="checkOpen = false">
      <div class="pe-check-head">
        <span class="tag" :class="checkOverall === 'pass' ? 'tag-green' : checkOverall === 'warn' ? 'tag-orange' : 'tag-red'">
          {{ CHECK_OVERALL_LABEL[checkOverall] }}
        </span>
        <span class="f-hint">
          <template v-if="currentTask">
            以 <b>{{ isOwner ? currentTask.owner : activeName }}</b> 的身份
            {{ isOwner ? '送审整卷' : `提交「${myTypes.join('、')}」` }}
          </template>
        </span>
      </div>

      <div class="pe-check-list">
        <div v-for="(row, i) in checkItems" :key="i" class="pe-check-item" :class="row.level">
          <AppIcon :name="CHECK_LEVEL_ICON[row.level]" :size="14" />
          <div>
            <b>{{ row.aspect }}</b>
            <p>{{ row.message }}</p>
          </div>
        </div>
      </div>

      <div class="pe-check-ai">
        <div class="pe-check-ai-head">
          <span>AI 合规检测</span>
          <span v-if="checkReport" class="tag tag-blue">{{ checkReport.engine === 'deepseek' ? 'DeepSeek' : '本地演示' }}</span>
        </div>
        <p class="f-hint" style="margin-bottom: 8px">
          把组卷要求与卷面结构交给模型，判「题干是否跑题、是否超纲、难度与知识点配比是否合理」这类
          本地规则算不准的事。逐题的答案对错不在这一轮的范围内。
        </p>
        <div v-if="checkReport" class="pe-check-list">
          <div v-for="(row, i) in checkReport.items" :key="i" class="pe-check-item" :class="row.level">
            <AppIcon :name="CHECK_LEVEL_ICON[row.level]" :size="14" />
            <div>
              <b>{{ row.aspect }}</b>
              <p>{{ row.message }}</p>
            </div>
          </div>
          <p v-if="checkReport.tokens" class="f-hint">本次检测消耗 {{ checkReport.tokens }} tokens</p>
        </div>
        <button v-else class="btn btn-ghost btn-sm" type="button" :disabled="checkBusy" @click="runCheckByAi">
          <AppIcon name="sparkles" :size="13" /> {{ checkBusy ? '检测中…' : 'AI 检测' }}
        </button>
      </div>

      <template #footer>
        <p class="f-hint" style="margin-right: auto">以上仅为提示，不影响提交。</p>
        <button class="btn btn-ghost" :disabled="submitBusy" @click="checkOpen = false">取消</button>
        <button class="btn btn-primary" :disabled="submitBusy" @click="confirmSubmit">
          {{ submitBusy ? '提交中…' : '仍然提交' }}
        </button>
      </template>
    </AppModal>

    <!-- 媒体预览 -->
    <AppModal v-if="mediaOpen" :title="mediaOpen.name" :width="620" @close="mediaOpen = null">
      <img v-if="mediaOpen.kind === 'image' && mediaOpen.url" :src="mediaOpen.url" :alt="mediaOpen.name" style="max-width: 100%; border-radius: 10px" />
      <p v-else class="f-hint">该{{ mediaOpen.kind === 'video' ? '视频' : '动画' }}资源为演示数据，暂无可播放地址。</p>
      <p class="f-hint" style="margin-top: 10px">
        {{ mediaOpen.subject }} · {{ mediaOpen.knowledge.join('、') }} · {{ mediaOpen.sizeMb }} MB · 被引用 {{ mediaOpen.linkedCount }} 次
      </p>
      <template #footer>
        <button class="btn btn-ghost" @click="mediaOpen = null">关闭</button>
      </template>
    </AppModal>

    <!-- 替换版本：说明为什么替换，留痕给协作者看 -->
    <AppModal v-if="replaceTarget != null" title="以所选版本替换当前卷面" :width="460" @close="replaceTarget = null">
      <p class="f-hint" style="margin-bottom: 12px">
        替换后当前卷面会被该版本内容覆盖，原卷面仍保留在版本记录里（标记为「已被替换」），可再次撤销回来。
      </p>
      <div class="f-field">
        <label class="f-label">替换说明（可选）</label>
        <input v-model="replaceNote" class="f-input" placeholder="如：改用 v3 的分值方案" />
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="replaceTarget = null">取消</button>
        <button class="btn btn-primary" @click="onReplace">确认替换</button>
      </template>
    </AppModal>

    <!-- 退回整改：意见必填（mock 侧要求 ≥5 字）。退回不写清原因，对方只能猜到哪一步不合格 -->
    <AppModal v-if="rejectTarget" title="退回整改" :width="460" @close="rejectTarget = null">
      <p class="f-hint" style="margin-bottom: 12px">
        退回给 <b>{{ rejectTarget.name }}</b> 负责的「{{ rejectTarget.questionTypes.join('、') }}」，
        任务会回到收题中，他改完可重新提交。
      </p>
      <div class="f-field">
        <label class="f-label">退回意见 <span class="req">*</span></label>
        <textarea
          v-model="rejectOpinion"
          class="f-textarea"
          rows="4"
          placeholder="如：解答题缺少评分点说明，且第 3 题与第 7 题难度重复，请调整后重新提交"
        />
        <p class="f-hint">至少 5 个字。这条意见会显示在对方的任务里，也会写进版本记录。</p>
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="rejectTarget = null">取消</button>
        <button class="btn btn-primary" :disabled="taskBusy" @click="submitReject">确认退回</button>
      </template>
    </AppModal>

    <!-- 评论：看与写同一个抽屉。评论已经在这个目标上，所以先列出来再写 ——
         「点开就是为了看这条」比「点开是一个空白输入框」更常发生。
         手写与 AI 检测走同一个草稿框：AI 的结论也要老师过一眼、能改两个字再发，
         所以不是「点一下自动生成」，而是「填进草稿等你确认」。
         卷头没有题目上下文可喂，那一档只有手写一条路（不出现 AI 页签）。 -->
    <AppDrawer
      v-if="commentTarget"
      :title="commentTitle"
      :subtitle="commentSubtitle"
      :width="520"
      @close="closeComment"
    >
      <!-- 全卷评论索引：按试题分组摊开，点一条落到那一处的面板上（写评论在那一处做）。
           只读、不给删除 —— 在索引里删别人的话太容易误点，那是「跳过去确认一眼」的活。 -->
      <section v-if="commentView === 'all'">
        <button ref="cmtTop" class="cmt-back" type="button" @click="switchCommentView('one')">
          <AppIcon name="chevron-left" :size="13" /> 返回「{{ commentTargetLabel }}」
        </button>
        <p v-if="!commentGroups.length" class="f-hint">这份卷子还没有评论。</p>
        <div v-for="group in commentGroups" :key="group.key" class="cmt-group">
          <div class="cmt-group-head">
            <b>{{ group.title }}</b>
            <span>{{ group.note }}</span>
            <span class="tag tag-gray">{{ group.rows.length }}</span>
          </div>
          <button
            v-for="row in group.rows"
            :key="row.id"
            class="cmt-item cmt-jump"
            type="button"
            :disabled="!group.target"
            :title="group.target ? '跳到这一处，看全文并回复' : '原题已不在卷面上，只能在这里看'"
            @click="group.target && openComment(group.target)"
          >
            <span class="cmt-meta">
              <b>{{ row.author }}</b>
              <span class="cmt-at">{{ row.at }}</span>
              <span v-if="row.source === 'ai'" class="tag tag-blue">AI</span>
              <span v-else-if="row.source === 'correct'" class="tag tag-orange">纠错</span>
            </span>
            <span class="cmt-text">{{ row.body }}</span>
          </button>
        </div>
      </section>

      <template v-else>
        <!-- 进索引的入口：摆在评论流**之上**、与它分开 —— 这是「换个地方看」，
             不是又一条筛选条件，混在评论列表里会被当成页签。全卷一条评论都没有时不出现，
             点进去只会是一页空。 -->
        <button v-if="comments.length" ref="cmtTop" class="cmt-all" type="button" @click="switchCommentView('all')">
          <AppIcon name="layers" :size="14" />
          <span>查看全卷评论</span>
          <em>{{ comments.length }} 条</em>
          <AppIcon name="chevron-right" :size="13" />
        </button>

        <section v-if="commentRows.length" class="cmt-list">
          <article v-for="row in commentRows" :key="row.id" class="cmt-item">
            <!-- 上行：谁、什么时候（AI 生成与纠错自动生成的额外标一下，别让读者以为是人写的） -->
            <div class="cmt-meta">
              <b>{{ row.author }}</b>
              <span class="cmt-at">{{ row.at }}</span>
              <span v-if="row.source === 'ai'" class="tag tag-blue">AI</span>
              <span v-else-if="row.source === 'correct'" class="tag tag-orange">纠错</span>
              <button
                v-if="row.author === myName"
                class="cmt-del"
                type="button"
                title="删除这条评论"
                @click="removeComment(row)"
              >
                <AppIcon name="trash" :size="14" />
              </button>
            </div>
            <p class="cmt-text">{{ row.body }}</p>
          </article>
        </section>

        <div v-if="commentTarget.kind !== 'head'" class="cmt-tabs">
          <button
            class="cmt-tab"
            :class="{ on: commentTab === 'manual' }"
            type="button"
            :disabled="aiRunning"
            @click="commentTab = 'manual'"
          >
            <AppIcon name="edit" :size="13" /> 手动输入
          </button>
          <button
            class="cmt-tab"
            :class="{ on: commentTab === 'ai' }"
            type="button"
            :disabled="aiRunning"
            @click="commentTab = 'ai'"
          >
            <AppIcon name="sparkles" :size="13" /> AI 检测
          </button>
        </div>

        <p v-if="commentTab === 'ai'" class="f-hint cmt-hint">
          <template v-if="commentTarget.kind === 'section'">
            会对该题型下的每一道题各跑一次检测，再把结论汇成一条评论（题型本身没有单题上下文可喂）。
          </template>
          <template v-else>对该题跑一次 AI 检测，结论填进下面的输入框。</template>
          检测结果只填进草稿，不会自动发布 —— 确认或修改后再点「发表评论」。
        </p>

        <!-- 检测的状态常驻在这里：跑到第几题、用的哪个引擎、哪几题没成 ——
             toast 一闪就没了，而这个动作慢起来要按分钟算 -->
        <p v-if="aiNote" class="cmt-ai-note" :class="{ bad: aiFailed }">{{ aiNote }}</p>

        <div class="f-field">
          <label class="f-label">评论内容 <span class="req">*</span></label>
          <textarea
            v-model="commentDraft"
            class="f-textarea"
            rows="6"
            placeholder="如：这一题与第 3 题难度重复，建议换成含参数的题型"
          />
        </div>

      </template>

      <template #footer>
        <button class="btn btn-ghost" :disabled="aiRunning" @click="closeComment">关闭</button>
        <!-- 索引是只读的一览：那一页没有「当前这一处」，发表与检测都得先跳过去再说 -->
        <template v-if="commentView === 'one'">
          <button
            v-if="commentTab === 'ai'"
            class="btn btn-ghost"
            type="button"
            :disabled="aiRunning"
            @click="runAiCheck"
          >
            <AppIcon name="sparkles" :size="13" />
            {{ aiRunning ? `检测中 ${aiProgress.done}/${aiProgress.total}…` : aiNote ? '重新检测' : '开始检测' }}
          </button>
          <button class="btn btn-primary" :disabled="aiRunning" @click="submitComment">发表评论</button>
        </template>
      </template>
    </AppDrawer>

    <!-- ===== 卷面逐题动作 =====
         与试卷预览同一个定位壳（`QuestionActionBarHost`）：鼠标悬到题目上、或选中某道题，
         都在题目右下角浮出那条操作条。题块自己带 `data-qbar`，壳在 document 上做委托 ——
         所以这里只写一行组件标签，不必随分版变化重新绑定题块事件。
         `comment-counts` 传了才有「评论」按钮：预览页是读一份卷，评论长在这里。 -->
    <QuestionActionBarHost
      ref="barHost"
      :questions="questions"
      :enabled="!actionBarBlocked"
      :pinned-id="selectedQuestionId"
      :comment-counts="commentCounts"
      :corrected="correctedSet"
      :scroll-host="canvas"
      @preview="peekTarget = $event"
      @correct="correctTarget = $event"
      @similar="similarTarget = $event"
      @comment="openCommentForQuestion($event.id)"
    />

    <!-- 操作条上的三个动作：与预览页同一套弹窗（层级要压在操作条之上，见 ACTION_Z） -->
    <QuestionPreviewDrawer
      v-if="peekTarget"
      :question="peekTarget"
      :corrections="correctionsOf(peekTarget.id)"
      :z-index="ACTION_Z"
      @close="peekTarget = null"
    />
    <QuestionCorrectionDialog
      v-if="correctTarget"
      :question="correctTarget"
      :z-index="ACTION_Z"
      @close="correctTarget = null"
      @submitted="onCorrectionSubmitted"
    />
    <SimilarQuestionsModal
      v-if="similarTarget"
      :row="similarTarget"
      :z-index="ACTION_Z"
      @close="similarTarget = null"
      @find-similar="onSimilarFilter"
    />

    <!-- AI 问答悬浮球：本页是自绘顶栏的全屏工作台（不在 AppLayout 里），
         所以全局那颗球挂不到这儿，得自己挂（组卷工作台 ComposeView 同样是自己挂的）。
         它 Teleport 到 body、只监听自己的指针事件，不与本页的键盘快捷键冲突；
         打印时被 body.pe-print-open > *:not(#app) 一并藏掉。 -->
    <AiAssistant />
  </div>
</template>

<style scoped>
.pe-shell {
  /* 左右两块面板的宽度只此一处定：目录展开后要与右侧「全文设置」等宽，写成两个字面量迟早走偏 */
  --pe-side-w: 312px;
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg);
}

/* ===== 顶部标题栏 ===== */
.pe-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 18px;
  background: #fff;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  z-index: 30;
}
/* 品牌与登录人：本页不进 AppLayout，这一套得自带（口径与 AppLayout 的 .brand / .user-chip 一致，
   不抽共享组件 —— 全仓只有这一处用得到，抽出去反而多一层）。
   品牌这块的尺寸**刻意保持比侧边栏小**：那是竖着排的导航，这是密集工具栏。 */
.pe-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  padding: 4px 6px;
  margin-left: -6px;
  border: none;
  border-radius: 9px;
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  font-size: 14px;
  font-weight: 700;
  color: var(--ink);
  white-space: nowrap;
  transition: background 0.15s;
}
.pe-brand:hover { background: #f2f4fa; }
.pe-brand img { width: 26px; height: 26px; border-radius: 7px; object-fit: contain; }
.pe-head-sep { width: 1px; height: 22px; background: var(--border); flex-shrink: 0; }
.v-divider { width: 1px; height: 22px; background: var(--border); flex-shrink: 0; }
/* 登录人：逐值对齐 AppLayout 的 .user-chip（那边的头像 34px / 圆角 10 / 间距 9 / 姓名 13.5px）。
   不带下拉菜单，所以左右内边距都取 6px —— 主页那个 10px 的右内边距是给箭头留的。 */
.pe-user {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-shrink: 0;
  padding: 5px 6px;
  border-radius: 12px;
}
/* 头像样式交给共享的 AppAvatar（34px / 圆角 10 / 字号 15），这里只管排布 */
.pe-user-meta { display: flex; flex-direction: column; line-height: 1.25; }
.pe-user-name { font-size: 13.5px; font-weight: 600; color: var(--ink); }
.pe-user-role { font-size: 11px; color: var(--sub); }

.pe-title-wrap { flex: 1; min-width: 0; }
.pe-title {
  width: 100%;
  border: none;
  background: transparent;
  font-size: 16px;
  font-weight: 700;
  color: var(--ink);
  padding: 2px 4px;
  border-radius: 7px;
}
.pe-title:hover { background: #f4f7fb; }
.pe-title:focus { outline: none; background: #fff; box-shadow: 0 0 0 2px var(--brand-soft); }
.pe-title-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--sub);
  padding: 0 4px;
  margin-top: 2px;
}
.pe-owner { color: var(--sub); }
.pe-head-ops { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }

/* ===== 工具栏 ===== */
.pe-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 18px;
  background: #fff;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  flex-wrap: wrap;
  z-index: 29;
}
.pe-tool-group { display: flex; align-items: center; gap: 6px; }
.pe-tool-group.pe-tool-right { margin-left: auto; }
.pe-tool-sep { width: 1px; height: 20px; background: var(--border); }
.pe-tool-label { font-size: 12px; color: var(--sub); }
.pe-tool-hint { font-size: 12px; color: var(--sub); }
.pe-tool {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  font-size: 12.5px;
  color: var(--ink-2);
}
.pe-tool:hover:not(:disabled) { background: #f2f5fa; }
.pe-tool:disabled { color: #c3cad8; cursor: not-allowed; }
.pe-tool.on { background: var(--brand-soft); color: var(--brand-deep); border-color: var(--brand); }
.pe-seg { display: inline-flex; border: 1.5px solid var(--border); border-radius: 9px; overflow: hidden; background: #fff; }
.pe-seg.full { width: 100%; }
.pe-seg button {
  border: none;
  background: transparent;
  padding: 5px 11px;
  font-size: 12.5px;
  color: var(--ink-2);
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
}
.pe-seg button + button { border-left: 1px solid var(--border); }
.pe-seg button:hover { background: #f2f5fa; }
.pe-seg button.on { background: var(--brand-soft); color: var(--brand-deep); font-weight: 600; }

/* 缩放输入格：数字可手输，`%` 单独一个 span。
   两者都在 flex 行里 `align-items: center` 对齐 —— 早先把「100%」当一整块文本居中，
   数字与百分号各按自己的基线落位，看着是歪的。输入框去掉了行高与内边距，
   免得它自带的 line-height 把整格顶高。 */
.pe-zoom-seg { align-items: stretch; }
.pe-zoom-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1px;
  padding: 0 6px;
  border-left: 1px solid var(--border);
  border-right: 1px solid var(--border);
  background: #fff;
  font-size: 12.5px;
  color: var(--ink-2);
}
.pe-zoom-cell input {
  width: 30px;
  border: none;
  background: transparent;
  padding: 0;
  font: inherit;
  line-height: 1;
  color: inherit;
  text-align: right;
}
.pe-zoom-cell input:focus { outline: none; color: var(--brand-deep); font-weight: 600; }

/* ===== 主体三区 ===== */
.pe-body { flex: 1; display: flex; min-height: 0; }

/* 目录开关：贴在左边界上的竖把手。
   绝对定位浮在画布之上，**不占版面宽度** —— 目录收起时画布是满宽的，
   为一条开关留 30px 的白边反而更碍眼。只在目录收起时出现（v-if），
   展开后由目录自带的「收起」按钮接管，同一时刻只有一个出口。

   定位基准是 `.pe-stage-main`（不是 `.pe-body`）：`top: 10px` 要落在**块工具条之下**。
   工具条在 `.pe-stage` 里钉死、`flex-wrap: wrap`，窗口一窄就折成两行 —— 之前按 `.pe-body`
   定位时 10px 正好压在工具条左端（工具条左内边距只有 18px，把手约 24px 宽，压住的就是它的内容），
   而写死一个更大的 top 又会在折行后失效。挂进 `.pe-stage-main` 之后把手是工具条下面的第一个盒子，
   `top: 10px` 永远是「工具条下面一点」，与工具条多高无关。
   横向不变：目录收起时 `.pe-stage` 就是 `.pe-body` 的第一个子元素，两者左缘重合。 */
.pe-outline-tab {
  position: absolute;
  left: 0;
  top: 10px;
  z-index: 25;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 5px;
  border: 1px solid var(--border);
  border-left: none;
  border-radius: 0 10px 10px 0;
  background: #fff;
  color: var(--ink-2);
  font-size: 12px;
  /* 竖排：把手窄，横排的「目录」两字会把条撑得很宽 */
  writing-mode: vertical-rl;
  letter-spacing: 2px;
  box-shadow: 2px 0 8px rgba(20, 30, 60, 0.07);
}
.pe-outline-tab:hover { color: var(--brand-deep); border-color: var(--brand); }

/* 左：目录。宽度与右侧「全文设置」面板共用一个变量（见 `.pe-shell` 上的 `--pe-side-w`） */
.pe-outline {
  width: var(--pe-side-w);
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  background: #fff;
  padding: 10px;
  overflow-y: auto;
}
.pe-outline-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ink);
  padding: 4px 6px 8px;
}
.pe-icon-btn {
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--sub);
  display: flex;
  align-items: center;
  justify-content: center;
}
.pe-icon-btn:hover { background: #f2f5fa; color: var(--ink); }
.pe-ol-group { margin-top: 8px; }
.pe-ol-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  border: none;
  background: transparent;
  text-align: left;
  font-size: 13px;
  color: var(--ink-2);
  padding: 7px 8px;
  border-radius: 8px;
}
.pe-ol-row:hover { background: #f2f5fa; }
.pe-ol-row.strong { font-weight: 700; color: var(--ink); }
/* 行尾的附注（大题的「N 题 / M 分」、附加区块的「3 × 4」）：靠到最右边，不吃斜体 */
.pe-ol-row em { margin-left: auto; font-style: normal; font-size: 11px; color: var(--sub); font-weight: 400; }
/* ===== 目录行的协同进度 =====
   「谁负责 · 已加入/总题数 · 状态」三项。已加入题数按是否达标上色：
   达标品牌色（这段可以收了）、未达标告警色（还差几道）。 */
.pe-ol-line { display: flex; align-items: center; gap: 2px; }
.pe-ol-line .pe-ol-row { flex: 1; min-width: 0; }
.pe-ol-who { color: var(--ink-2); font-weight: 600; }
.pe-ol-have { color: var(--warn); font-weight: 700; }
.pe-ol-have.full { color: var(--brand); }
/* 自己负责的大题：左侧一条品牌色竖线，一眼看出该动哪几段 */
.pe-ol-row.mine { box-shadow: inset 2px 0 0 var(--brand); }
.pe-ol-row.locked { color: var(--sub); cursor: default; }
.pe-ol-row.locked:hover { background: transparent; }
.pe-ol-lock { color: var(--sub); flex-shrink: 0; margin-right: 6px; }
/* 目录行上的评论入口：平时很淡，鼠标扫过这一行才亮起来 —— 目录是拿来定位的，
   不该被一排小按钮抢掉注意力；但带评论的那几个要一直是亮的（`hot`）。 */
.pe-ol-cmt {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
  height: 20px;
  padding: 0 5px;
  margin-right: 6px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  font-size: 11px;
  color: #b9c1d2;
  opacity: 0;
  transition: opacity 0.12s;
}
.pe-ol-line:hover .pe-ol-cmt { opacity: 1; }
.pe-ol-cmt:hover { border-color: var(--brand); color: var(--brand-deep); background: #fff; }
.pe-ol-cmt.hot { opacity: 1; color: var(--brand-deep); background: var(--brand-soft); }
.pe-ol-sub {
  display: block;
  width: 100%;
  border: none;
  background: transparent;
  text-align: left;
  font-size: 12px;
  color: var(--sub);
  padding: 4px 8px 4px 22px;
  border-radius: 7px;
}
.pe-ol-sub:hover { background: #f2f5fa; color: var(--brand-deep); }
.pe-outline-tip { font-size: 11.5px; color: var(--sub); padding: 12px 8px 0; line-height: 1.6; }

/* 中：画布。
   两级：.pe-stage 是「块工具条 + 内容区」这一列，块工具条是钉死的；内容区 .pe-stage-main
   现在只剩画布一列（早先右边还有一条卷级评论栏，已撤掉），保留这层是为了不动 .pe-canvas 的
   滚动几何。背景色与 flex: 1 归 .pe-stage —— 工具条要铺满整个中栏宽度。 */
.pe-stage {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #eef1f6;
}
/* `position: relative` 给收起目录时那颗把手当基准（绝对定位，是这里的第一个盒子）——
   这一层**不滚动**，所以 `top: 10px` 永远是「块工具条下面一点」。 */
.pe-stage-main {
  position: relative;
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
}
.pe-canvas {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 18px 32px 60px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 22px;
}
.pe-empty { margin: auto; font-size: 13px; color: var(--sub); }

/* ===== 评论角标：挂在块**外面**的右栏距里 =====
   块（`.pe-row` / `.pe-col-block`）都是定位元素，角标是它的绝对定位子元素，位置仍由纸面的排版算 ——
   缩放、重新分版、切双栏版式都自动跟着走。

   曾经把角标做成纸面之外、贴画布右缘的一条轨道，靠脚本量 `offsetTop` 定位。那版在缩放后对不上题：
   `offsetTop` 是**未缩放**的排版坐标，而纸面是 `transform: scale(zoom)` 画出来的，只有 zoom 恰为 1
   时两者才重合（默认的「适应宽度」几乎从来不等于 1）。挂在块上就没有这个换算。

   **落在块外**：早先贴在块内右上角（`right: 0 / top: 0`），题干排到那一行就被压住一块 ——
   角标是常显的，于是题干永远缺一角。挪进右栏距后与正文互不干涉，也不必再把「压在正文上也要看得清」
   当成白底描边的理由。

   为什么是 14px 宽 + `right: -18px`：栏距最窄的两处是版内分栏的 `COL_GAP`（18px）与两版之间的
   `PANEL_GAP`（22px）—— 外移 18px 正好落在栏距里，宽 14px 则让角标与**邻栏的正文**之间
   在分栏那一档还留得住 4px（版间那一档是 8px）；纸面右边距 14~18mm（53~68px）更宽，
   最右那一栏也放得下。为此角标做成**竖排**（图标在上、条数在下）：
   14px 里要同时留住「这是评论」和「有几条」，横排是排不下的。

   绝对定位而不是行内：行内会改块高，而块高是分版量出来的（测量层量的是 PaperBlock 本身），
   两者一旦不等，最后一块就会溢出纸面被 `overflow: hidden` 裁掉。绝对定位不进流，量多少印多少。 */
.pe-q-cmt {
  position: absolute;
  right: -18px;
  top: 0;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  width: 14px;
  padding: 3px 0;
  border: 1px solid var(--brand);
  border-radius: 8px;
  background: #fff;
  color: var(--brand-deep);
  font-size: 9.5px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
  z-index: 3;
}
.pe-q-cmt:hover { background: var(--brand-soft); }

/* ===== 拖动排序的把手与插入指示线 =====
 *
 * 把手**绝对定位**，理由同上面的角标：块高是隐藏测量层量出来的，而块高决定分版 ——
 * 把它排进行内（占版面）会让「本来在第 1 页的一道题」跳到第 2 页。
 * `left: -18px` 落在纸面左边距里：各版式的 `margin.left` 是 14~24mm（≈53~91px），
 * 所以探出块外这一截不会被 `.pe-sheet` 的 `overflow: hidden` 裁掉。 */
.pe-drag {
  position: absolute;
  left: -18px;
  top: 50%;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 26px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: #fff;
  color: var(--sub);
  cursor: grab;
  opacity: 0;
  transition: opacity 0.12s;
  z-index: 3;
}
.pe-row:hover .pe-drag,
.pe-col-block:hover .pe-drag,
.pe-drag:focus-visible { opacity: 1; }
.pe-drag:active { cursor: grabbing; opacity: 1; }

/* 正在搬的那一块压暗一点：「哪一题在手上了」要看得见，否则拖起来像整页都在动 */
.pe-row.is-dragging,
.pe-col-block.is-dragging { opacity: 0.45; }

/* 插入指示线用伪元素，不占高度（占高度就会引动分版）。
   上面那条贴块的上沿、下面那条贴下沿，实测落点在上半还是下半由 onDragOver 决定 */
.pe-row.is-drop-before::before,
.pe-col-block.is-drop-before::before,
.pe-row.is-drop-after::after,
.pe-col-block.is-drop-after::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  border-radius: 2px;
  background: var(--brand);
  z-index: 4;
}
.pe-row.is-drop-before::before,
.pe-col-block.is-drop-before::before { top: -1px; }
.pe-row.is-drop-after::after,
.pe-col-block.is-drop-after::after { bottom: -1px; }

/* 块工具条：钉在中栏顶部，**不在画布的滚动区里**（画布是下面那个 .pe-canvas）。
   早先它是画布内容里的 `position: sticky` —— 既要跟着纸页滚，又要在内容重排时跟着重排；
   结果「在工具条里改个数值 → 卷面重新分版」这一下连滚动位置一起带走了。
   现在它是 flex 列的一项、`flex-shrink: 0`，高度变化只挤压下面的画布，碰不到滚动几何。
   左右不留内边距、底边留一条描边：它是钉住的条，不是浮在纸面上的卡片。 */
.pe-blockbar {
  flex-shrink: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  background: #fff;
  border-bottom: 1px solid var(--border);
  padding: 8px 18px;
}
.pe-bb-label { font-size: 12.5px; font-weight: 700; color: var(--ink); }
.pe-bb-hint { font-size: 11.5px; color: var(--sub); }
.pe-bb-input { height: 30px !important; font-size: 12.5px !important; }
.pe-bb-btn {
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  font-size: 12px;
  color: var(--ink-2);
}
.pe-bb-btn:hover { border-color: var(--brand); color: var(--brand-deep); }
.pe-bb-btn.danger { color: var(--danger); }
.pe-bb-btn.danger:hover { border-color: var(--danger); background: var(--danger-soft); }
/* 工具条上的评论入口：`margin-left: auto` 把它推到最右，与左边那串编辑按钮分开 ——
   它是只读处理人唯一能点的动作，别混在「改卷子」的按钮堆里。 */
.pe-bb-comment { display: inline-flex; align-items: center; gap: 4px; margin-left: auto; }
.pe-bb-comment em {
  font-style: normal;
  min-width: 15px;
  padding: 0 4px;
  border-radius: 7px;
  background: var(--brand-soft);
  color: var(--brand-deep);
  font-size: 10.5px;
  font-weight: 700;
  line-height: 15px;
  text-align: center;
}

/* ===== 评论抽屉：上半是已有评论，下半是撰写区 ===== */
.cmt-list { margin-bottom: 14px; }
.cmt-item { padding: 8px 9px; margin-bottom: 6px; border-radius: 8px; background: #f7f9fc; }
.cmt-item:last-child { margin-bottom: 0; }
/* 上行「谁 · 什么时候」，下行正文 —— 多人评同一题时，这两行是分清谁说了什么的唯一依据 */
.cmt-meta { display: flex; align-items: center; gap: 6px; font-size: 11.5px; }
.cmt-meta b { color: var(--ink); }
.cmt-at { color: var(--sub); }
.cmt-text { margin: 4px 0 0; font-size: 12px; line-height: 1.65; color: var(--ink-2); white-space: pre-wrap; }
/* 删除按钮：常显，但压着调子 —— 一屏可能有好几条评论，满格的红垃圾桶太吵。
   悬停整条评论时它才提上来，悬停自己时整颗变红（删除是破坏性动作，指到它就该看得明白）。
   命中区按 24×24 给：图标本身就小，又挤在卡片右上角，命中区不给够就是「看着有、点不中」。 */
.cmt-del {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #fff;
  color: var(--sub);
  transition: color 0.12s, background 0.12s, border-color 0.12s;
}
.cmt-item:hover .cmt-del { color: var(--danger); border-color: var(--danger); background: var(--danger-soft); }
.cmt-del:hover { color: #fff; border-color: var(--danger); background: var(--danger); }

.cmt-tabs { display: flex; gap: 6px; margin-bottom: 12px; }
.cmt-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  font-size: 12.5px;
  color: var(--ink-2);
}
.cmt-tab.on { border-color: var(--brand); background: var(--brand-soft); color: var(--brand-deep); font-weight: 600; }
.cmt-tab:disabled { color: #c3cad8; cursor: not-allowed; }
.cmt-hint { display: block; margin-bottom: 12px; line-height: 1.7; }
/* 检测状态：跑完 / 部分失败 / 全失败都留在这儿。toast 一闪就没了，而这个动作可能按分钟算 */
.cmt-ai-note {
  padding: 7px 10px;
  margin-bottom: 12px;
  border-radius: 8px;
  border-left: 3px solid var(--brand);
  background: var(--brand-soft);
  font-size: 12px;
  color: var(--ink-2);
  line-height: 1.65;
  word-break: break-all;
}
.cmt-ai-note.bad { border-left-color: #e2564a; background: #fdf1f0; color: #b23c31; }

/* 进「全卷评论」的入口。做成一条**通栏的导航行**而不是页签：它换的是整个视图
   （从「这一处」到「全卷」），与 `手动输入 / AI 检测` 那两个「下面那个框是干嘛的」不是一回事，
   混在同一排里会被当成第三种输入方式。 */
.cmt-all {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  margin-bottom: 14px;
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: #fbfcfe;
  font-family: inherit;
  font-size: 12.5px;
  color: var(--ink-2);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.12s, background 0.12s, color 0.12s;
}
.cmt-all:hover { border-color: var(--brand); background: #fff; color: var(--brand-deep); }
.cmt-all em { margin-left: auto; font-style: normal; font-size: 11.5px; color: var(--sub); }
.cmt-all:hover em { color: var(--brand-deep); }

/* 全卷索引：一组 = 一处评论目标（卷头 / 某大题 / 某道题） */
.cmt-back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 12px;
  padding: 0;
  border: none;
  background: transparent;
  font-family: inherit;
  font-size: 12.5px;
  color: var(--brand-deep);
  cursor: pointer;
}
.cmt-back:hover { text-decoration: underline; }
.cmt-group { margin-bottom: 14px; }
.cmt-group:last-child { margin-bottom: 0; }
.cmt-group-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  font-size: 11.5px;
  color: var(--sub);
}
.cmt-group-head b { font-size: 12.5px; color: var(--ink); }
/* 条数贴右：一屏好几组，右边对齐才扫得出「哪几组话最多」 */
.cmt-group-head .tag { margin-left: auto; }
/* 索引里的一条评论**本身就是按钮**（点它跳到那一处）：整条可点才好在密排的列表里命中。
   长相必须与「某一处的评论」里的 `.cmt-item` 一模一样 —— 同一个东西多了一个点击动作，
   不同的只该是「可点」这件事，不是它长什么样。所以：
   1. 清掉按钮自带的 UA 描边与按钮底色。`.cmt-item` 是无边框的 #f7f9fc 卡片，但浏览器给
      `<button>` 的 2px outset 描边不会因为作者设了底色就消失，于是同一个 `.cmt-item` 在索引里
      凭空多出一圈灰边 —— 这正是「两种面板」的来源。
   2. 悬停只换底色，不再描边：密排的列表里描边会随鼠标上下扫动显得在抖，而且那圈边又会长回
      上面刚去掉的那种「另一种面板」的样子。 */
.cmt-jump {
  display: block;
  width: 100%;
  border: none;
  appearance: none;
  -webkit-appearance: none;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s;
}
.cmt-jump:hover { background: #f2f5fa; }
/* 上面把描边清成了 none，浏览器默认的焦点环也一并没了：键盘 Tab 过来必须还看得见落点 */
.cmt-jump:focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; }
/* 目标已不在卷面上（题被移除）：留得住评论，但没什么可跳的 */
.cmt-jump:disabled { cursor: default; }
.cmt-jump:disabled:hover { background: #f7f9fc; }
/* 正文在按钮里是 `<span>`（button 只能装短语内容），补上块级才有那 4px 段间距 */
.cmt-jump .cmt-text { display: block; }

.pe-page { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.pe-page-tag { font-size: 11.5px; color: var(--sub); }
.pe-sheet-wrap { position: relative; }
.pe-sheet {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: top left;
  background: #fff;
  box-shadow: 0 6px 22px rgba(28, 36, 52, 0.16);
  box-sizing: border-box;
  overflow: hidden;
  font-family: var(--pp-font);
  color: var(--pp-accent);
  print-color-adjust: exact;
  -webkit-print-color-adjust: exact;
}
.pe-body-inner { position: relative; }
.pe-panels { display: flex; align-items: flex-start; gap: var(--pp-panel-gap); }
.pe-panel { flex: 0 0 auto; position: relative; width: var(--pp-panel-w); }
.pe-panels.is-multi .pe-panel + .pe-panel::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: calc(var(--pp-panel-gap) / -2);
  border-left: 1px dashed #d3d9e6;
}
/* `position: relative` 不带任何偏移，只为让块内的绝对定位后代（题号列、右下角的评论角标）有个基准 */
.pe-row { position: relative; margin-bottom: var(--pp-gap); cursor: pointer; border-radius: 4px; transition: box-shadow 0.12s; }
.pe-row:hover { box-shadow: 0 0 0 2px var(--brand-soft); }
/* 选中态用 box-shadow 而非 border：边框会改变块高，量到的高度就不再等于画出来的高度 */
.pe-row.is-sel { box-shadow: 0 0 0 2px var(--brand); }
.pe-row.pe-cols { display: flex; align-items: flex-start; margin-bottom: 0; cursor: default; box-shadow: none !important; }
.pe-col { flex: 1 1 0; min-width: 0; }
.pe-col-block { position: relative; margin-bottom: var(--pp-gap); border-radius: 4px; cursor: pointer; }
.pe-col-block:hover { box-shadow: 0 0 0 2px var(--brand-soft); }
.pe-col-block.is-sel { box-shadow: 0 0 0 2px var(--brand); }
/* 别人负责的块 / 卷级内容：一整片加重的底色，提示「这块不是你的」。
   刻意不降透明度、更不拦点击 —— 老师得能点开它看题和评论，只是改不动。

   底色取代了早先那条 `inset 3px 0 0` 左缘竖线：3px 太窄，扫一眼看不出边界从哪儿起、
   到哪儿止，而且它和选中态/悬停态的描边挤在同一条边上，看着像状态而不是归属。
   只靠底色说事，选中与悬停的环形描边照旧走 `.is-sel` / `:hover`（所以这里不再写
   `box-shadow`，那两条规则谁先谁后都不必再绕开这一条）。 */
.pe-row.is-locked,
.pe-col-block.is-locked {
  /* 比画布底色（.pe-stage 的 #eef1f6）再深一档 —— 不然它和纸面外那圈工作区同色，
     看着像纸面漏了个洞，而不是「这一块有主了」 */
  background: #e3e7f0;
}

.pe-seal {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 22px;
  width: 20px;
  border-right: 1px dashed #9aa4b8;
  padding-top: 40px;
  display: flex;
  justify-content: center;
  overflow: hidden;
}
.pe-seal span {
  writing-mode: vertical-rl;
  font-size: 11px;
  letter-spacing: 2px;
  color: #6b7280;
  font-family: var(--pp-head-font);
  white-space: nowrap;
}
.pe-foot {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 6px;
  text-align: center;
  font-size: 11px;
  color: #6b7280;
}

/* 隐藏测量层 */
.pe-measure {
  position: fixed;
  top: 0;
  left: -20000px;
  visibility: hidden;
  pointer-events: none;
  font-family: var(--pp-font);
  color: var(--pp-accent);
}
.pe-measure-item { margin: 0 0 var(--pp-gap); }

/* 右：侧边面板（.pe-side）+ 竖栏。宽度与左侧目录共用一个变量（见 `.pe-shell`） */
.pe-side {
  width: var(--pe-side-w);
  flex-shrink: 0;
  border-left: 1px solid var(--border);
  background: #fff;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.pe-side-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.pe-side-head h3 { font-size: 13.5px; font-weight: 700; }
/* 面板标题右侧的动作组：`space-between` 只分两份（标题 / 这一组），
   否则三个子元素会被摊成「左中右」，那颗按钮悬在标题与关闭之间很怪 */
.pe-side-head-ops { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.pe-side-body { flex: 1; overflow-y: auto; padding: 14px; }
.pe-side-sub { font-size: 12.5px; font-weight: 700; color: var(--ink); margin: 14px 0 8px; }
.pe-side-sub:first-child { margin-top: 0; }
/* 协同处理人看全文设置：整块 inert（点不动、Tab 也进不去），只留上面这条说明 */
.pe-side-notice {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 0;
  padding: 9px 14px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--warn);
  background: var(--warn-soft);
  border-bottom: 1px solid var(--border);
}
.pe-side-notice svg { flex-shrink: 0; margin-top: 2px; }
/* 只读的卷名输入框：还能按 Tab 选中看到文字，但不能改 */
.pe-title[readonly] { cursor: default; }
.pe-title[readonly]:hover { background: transparent; }

/* ===== 组卷信息面板 ===== */
.pe-collab-flow { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
/* 间距挂在子元素上而不是容器：容器在「这一刻没有轮到你的动作」时是空的，
   挂在容器上就会白留一段空隙 */
.pe-collab-ops { display: flex; gap: 8px; flex-wrap: wrap; }
.pe-collab-ops > * { margin-top: 10px; }
.pe-collab-reject {
  margin: 10px 0 0;
  padding: 9px 10px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--danger);
  background: var(--danger-soft);
  border-radius: 8px;
}
/* 组卷设置：定义列表两列，左列是字段名，右列可换行的值 */
.pe-collab-req { display: grid; grid-template-columns: 76px 1fr; gap: 7px 10px; margin: 0; font-size: 12.5px; }
.pe-collab-req dt { color: var(--sub); }
.pe-collab-req dd { margin: 0; color: var(--ink); line-height: 1.6; word-break: break-word; }
.pe-collab-chip {
  display: inline-block;
  margin: 0 4px 4px 0;
  padding: 2px 7px;
  font-size: 11.5px;
  border-radius: 6px;
  background: var(--bg-2, #f4f6fb);
  color: var(--ink-2);
}
/* 归我负责的题型：换个色，和下面成员名单里的「当前身份」对得上 */
.pe-collab-chip.mine { background: var(--brand-soft); color: var(--brand-deep); font-weight: 600; }
.pe-collab-chip.plain { background: #f4f6fb; }
.pe-collab-member {
  padding: 9px 0;
  border-top: 1px solid var(--border);
}
.pe-collab-member-head { display: flex; align-items: center; gap: 6px; font-size: 12.5px; }
.pe-collab-member-head b { font-weight: 700; color: var(--ink); }
.pe-collab-member .f-hint { margin: 4px 0 0; }
.pe-collab-note {
  margin-top: 5px;
  padding: 6px 8px;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--danger);
  background: var(--danger-soft);
  border-radius: 7px;
}
.pe-collab-accept { display: flex; gap: 6px; margin-top: 7px; }
.pe-field { margin-bottom: 14px; }
.pe-field > label { display: block; font-size: 12.5px; font-weight: 600; color: var(--ink-2); margin-bottom: 6px; }
.pe-field.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.pe-field.row2 label { display: block; font-size: 12.5px; font-weight: 600; color: var(--ink-2); margin-bottom: 6px; }
.pe-check { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--ink-2); margin-bottom: 14px; }
.pe-check input { accent-color: var(--brand); }
.pe-style-list { display: flex; flex-direction: column; gap: 8px; }
.pe-style {
  text-align: left;
  border: 1.5px solid var(--border);
  border-radius: 11px;
  background: #fff;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.pe-style:hover { border-color: var(--brand); }
.pe-style.on { border-color: var(--brand); background: var(--brand-soft); }
.pe-style-name { display: flex; align-items: center; gap: 5px; font-size: 12.5px; font-weight: 600; color: var(--ink); }
.pe-style.on .pe-style-name { color: var(--brand-deep); }
.pe-style-desc { font-size: 11.5px; color: var(--sub); line-height: 1.5; }
.pe-style-tags { display: flex; gap: 5px; flex-wrap: wrap; }
.pe-style-tags i {
  font-style: normal;
  font-size: 10.5px;
  color: var(--sub);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 0 5px;
}
.pe-facts { display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: var(--ink-2); margin-top: 6px; }
.pe-facts p { display: flex; gap: 8px; }
.pe-facts span { color: var(--sub); width: 42px; flex-shrink: 0; }
.pe-warn {
  display: flex;
  gap: 6px;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--warn);
  background: var(--warn-soft);
  border-radius: 8px;
  padding: 7px 9px;
  margin-bottom: 14px;
}
.pe-filters { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px; }
.pe-bank-list { display: flex; flex-direction: column; gap: 9px; }
.pe-bank-card { border: 1.5px solid var(--border); border-radius: 10px; padding: 9px 11px; background: #fff; }
.pe-bank-meta { display: flex; gap: 5px; margin-bottom: 5px; flex-wrap: wrap; }
.pe-bank-stem { font-size: 12.5px; color: var(--ink-2); line-height: 1.6; }
.pe-bank-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 6px; }
.pe-media-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.pe-media {
  border: 1.5px solid var(--border);
  border-radius: 10px;
  background: #fff;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: center;
}
.pe-media:hover { border-color: var(--brand); }
.pe-media-thumb {
  width: 100%;
  height: 68px;
  border-radius: 7px;
  background: #f4f7fb;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  color: var(--sub);
}
.pe-media-thumb img { width: 100%; height: 100%; object-fit: cover; }
.pe-media-name { font-size: 11.5px; color: var(--ink-2); }
.pe-media-kind { font-size: 10.5px; color: var(--sub); }
.pe-basket-bar { display: flex; align-items: center; justify-content: space-between; font-size: 12.5px; color: var(--ink-2); margin-bottom: 10px; }
/* 参考资料一栏与上面的题目列表隔开：两类东西各自的「加入 / 移出」互不相干 */
.pe-att-bar { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--border); }
.pe-basket-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  border-bottom: 1px dashed var(--border);
  padding: 9px 0;
}
.pe-parsed { margin-top: 10px; border: 1px dashed var(--border); border-radius: 10px; padding: 9px 11px; }
.pe-parsed-head { font-size: 12px; font-weight: 600; color: var(--ink-2); margin-bottom: 6px; }
.pe-parsed-row { display: flex; gap: 6px; font-size: 12px; color: var(--sub); line-height: 1.7; }
.pe-timeline { display: flex; flex-direction: column; gap: 8px; }
.pe-tl-row {
  border: 1.5px solid var(--border);
  border-radius: 10px;
  padding: 8px 10px;
  background: #fff;
  text-align: left;
  width: 100%;
}
.pe-tl-row.as-button:hover { border-color: var(--brand); }
.pe-tl-row.on { border-color: var(--brand); background: var(--brand-soft); }
.pe-tl-row.replaced { opacity: 0.62; }
.pe-tl-head { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--ink-2); }
.pe-tl-head b { color: var(--ink); }
.pe-tl-head em { margin-left: auto; font-style: normal; font-size: 11px; color: var(--sub); }
.pe-tl-sum { font-size: 12px; color: var(--sub); line-height: 1.6; margin: 3px 0; }

.pe-rail {
  width: 76px;
  flex-shrink: 0;
  border-left: 1px solid var(--border);
  background: #fff;
  padding: 10px 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
}
.pe-rail-btn {
  border: none;
  background: transparent;
  border-radius: 10px;
  padding: 9px 4px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--ink-2);
}
.pe-rail-btn:hover { background: #f2f5fa; }
.pe-rail-btn.on { background: var(--brand-soft); color: var(--brand-deep); font-weight: 600; }

/* 底部样式条 */
.pe-footbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 18px;
  background: #fff;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}
.pe-footbar-label { font-size: 12px; color: var(--sub); margin-right: 4px; }
.pe-footstyle {
  border: 1px solid var(--border);
  border-radius: 999px;
  background: #fff;
  font-size: 12px;
  color: var(--ink-2);
  padding: 4px 12px;
}
.pe-footstyle:hover { border-color: var(--brand); color: var(--brand-deep); }
.pe-footstyle.on { border-color: var(--brand); background: var(--brand-soft); color: var(--brand-deep); font-weight: 600; }

/* 底栏右侧区：自动保存状态与开关 + 卷面统计。
   `margin-left: auto` 把整组推到最右边（保存 / 提交已挪去顶栏，这里不再有按钮） */
.pe-foot-ops { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.pe-save-note { font-size: 12px; color: var(--sub); white-space: nowrap; }
.pe-save-note.bad { color: var(--danger); cursor: help; }
.pe-autosave {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 11px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: #fff;
  font-size: 12px;
  color: var(--ink-2);
}
.pe-autosave:hover:not(:disabled) { border-color: var(--brand); }
.pe-autosave:disabled { color: #c3cad8; border-color: #e6eaf2; cursor: not-allowed; }
.pe-autosave.on { border-color: var(--brand); background: var(--brand-soft); color: var(--brand-deep); font-weight: 600; }
/* 开关的指示点：开=品牌色实心，关=灰底空心 */
.pe-dot { width: 6px; height: 6px; border-radius: 50%; background: #cfd6e4; }
.pe-autosave.on .pe-dot { background: var(--brand); }

/* ===== 智能选题与提交核对弹窗 ===== */
.pe-req-brief { border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; background: #fafbfe; }
.pe-req-row { display: flex; gap: 10px; font-size: 12.5px; color: var(--ink-2); padding: 3px 0; }
.pe-req-key { flex-shrink: 0; width: 74px; color: var(--sub); }
.pe-smart-row { display: flex; gap: 12px; }
.pe-smart-row .f-field { flex: 1; }
.pe-smart-check {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  margin-top: 4px;
  font-size: 12.5px;
  color: var(--ink-2);
  cursor: pointer;
}
.pe-smart-check em { display: block; font-style: normal; font-size: 11.5px; color: var(--sub); margin-top: 2px; }

.pe-check-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.pe-check-list { display: flex; flex-direction: column; gap: 6px; }
.pe-check-item {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 7px 10px;
  border-radius: 8px;
  background: #f7f9fc;
  font-size: 12.5px;
  color: var(--ink-2);
}
.pe-check-item b { font-size: 12.5px; color: var(--ink); }
.pe-check-item p { margin-top: 2px; line-height: 1.5; }
.pe-check-item.ok { color: #2f7d54; }
.pe-check-item.ok b { color: #2f7d54; }
.pe-check-item.warn { background: var(--warn-soft); }
.pe-check-item.warn b { color: var(--warn); }
.pe-check-item.error { background: var(--danger-soft); }
.pe-check-item.error b { color: var(--danger); }
.pe-check-ai { margin-top: 16px; padding-top: 12px; border-top: 1px dashed var(--border); }
.pe-check-ai-head { display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 700; color: var(--ink); margin-bottom: 6px; }
.pe-footbar-right { margin-left: auto; font-size: 12px; color: var(--sub); }
</style>

<!--
  打印：只留纸面，剥掉工具条、目录、面板、测量层与缩放变换。
  用 body.pe-print-open 兜住 —— 该类只在编辑页挂载，其它页面 Ctrl+P 不受影响。
-->
<style>
@media print {
  body.pe-print-open { overflow: visible !important; background: #fff !important; }
  body.pe-print-open > *:not(#app) { display: none !important; }

  .pe-head,
  .pe-toolbar,
  .pe-outline,
  .pe-outline-tab,
  .pe-side,
  .pe-rail,
  .pe-footbar,
  .pe-blockbar,
  .pe-page-tag,
  .pe-measure { display: none !important; }
  /* 操作条 Teleport 到 body（是本页 DOM 之外的另一棵子树，上面的选择器够不着），
     评论角标长在题块里 —— 两者都不是卷面内容，打印时都得藏掉。 */
  .qbar-host,
  .pe-q-cmt { display: none !important; }

  /* 收起目录时那颗把手：打印要的是整张卷面，不是工作台 */
  .pe-outline-tab { display: none !important; }

  .pe-shell { height: auto !important; overflow: visible !important; }
  .pe-body { display: block !important; }
  .pe-stage,
  .pe-stage-main { display: block !important; background: none !important; }
  .pe-canvas {
    display: block !important;
    overflow: visible !important;
    padding: 0 !important;
  }
  .pe-page { display: block !important; }
  .pe-sheet-wrap { width: auto !important; height: auto !important; }
  /* 「这块不是你的」底色是**工作台的事**，不是卷面内容：纸面上印一片灰底，
     等于把分工关系印给考生看。`.pe-sheet` 带 `print-color-adjust: exact`，
     不显式清掉这条就会连底色一起打出来。 */
  .pe-row.is-locked,
  .pe-col-block.is-locked { background: transparent !important; }

  /* 这两条曾是用来绕开 .pe-panel 同名冲突的补丁：隐藏右侧栏的规则把纸面分栏
     也一起藏了，于是这里再强行显示回来。侧栏已改名 .pe-side，冲突消失，补丁删除。 */
  .pe-sheet {
    position: relative !important;
    transform: none !important;
    box-shadow: none !important;
    break-inside: avoid;
    page-break-inside: avoid;
    break-after: page;
    page-break-after: always;
  }
  .pe-page:last-child .pe-sheet { break-after: auto; page-break-after: auto; }
  .pe-row, .pe-col-block { box-shadow: none !important; }

  @page { margin: 0; }
}
</style>
