<script setup lang="ts">
/**
 * 协同组卷 · 任务列表（FR-PP-004 ~ 007 / 017 ~ 021）。
 *
 * 一个「协同组卷任务」= 一张试卷 + 一份分工 + 一条版本线：
 * - 试卷基本要求（题型结构 / 难点占比 / 考察知识点 / 年级学科分值 / 命题说明）由发起人定，
 *   所有处理人共享同一份约束，AI 抽题也读它；
 * - 分工是「谁负责哪个题型」，一个题型只能有一个人（`saveCollabTask` 里强校验）；
 * - 版本线记录每一次入卷与提交，可撤销或替换。
 *
 * 本页只做「建任务 / 看进度 / 进组卷」，具体组卷在 `PaperEditView.vue`（协同的卷面工作台与普通
 * 试卷编辑页是同一页，按有无任务切换协作能力 —— 早先那个独立的 CollabTaskView 已并入）。
 *
 * **状态的颜色语言**（本页与任务页共用，改一处必须改另一处）：蓝=球在别人手里（处理人还在
 * 组卷、试卷已交给审核中心）；橙=球在发起人手里（待验收、待送审）；绿=走完了；红=被退回。
 * 所以「收题中 / 已送审」同为蓝、「待验收 / 待送审」同为橙不是配色偷懒，是在说同一件事：该谁动。
 *
 * **谁能发起**：任何人都能发起（见 `openCreate` 处注释），没有「发起协同组卷」这个权限位。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AppFilterChips, AppFilterPanel, AppIcon, AppListToolbar, AppPageHeader, appConfirm, COLLAB_MEMBER_TEXT, COLLAB_STATUS_TEXT, showToast, AppModal, AppDrawer } from '@aiteach/shared'
import PaperFolderSelect from '@/components/paper/PaperFolderSelect.vue'
import KnowledgePickerModal from '@/components/compose/KnowledgePickerModal.vue'
import type { CollabMember, FilterRowDef, OrgCollabTask, OrgPaper, OrgQuestion, StaffMember } from '@aiteach/shared'
import AppPagination from '@/components/ui/AppPagination.vue'
import { deleteCollabTask, fetchCollabTasks, fetchPapers, fetchQuestions, fetchStaff, saveCollabTask } from '@/api/org'
import { useBaseData } from '@/composables/useBaseData'
import { useAuthStore } from '@/stores/auth'
import { openBlankTab, openPaperEdit, paperEditHref } from '@/utils/paper-edit'
import { COLLAB_MEMBER_CLASS, COLLAB_STATUS_CLASS } from './collab-status'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const { subjects, grades, questionTypesFor, difficulties, examTypes, examTypesFor, ensure, pick, withCurrent, optionsForGrade } =
  useBaseData()

/**
 * 当前演示身份的姓名 —— 判断「这条任务归不归我管」的唯一依据。
 *
 * 取 auth 里的会话用户，而不是组卷任务详情页那个 `activeName` 下拉：那个下拉是「我这次以谁
 * 的名义收题」，属于干活时的临时视角，跟权限无关。**审批 / 编辑 / 删除只认这里**。
 */
const myName = computed(() => auth.user?.name ?? '')

const tasks = ref<OrgCollabTask[]>([])
const papers = ref<OrgPaper[]>([])
const questions = ref<OrgQuestion[]>([])
const staff = ref<StaffMember[]>([])
const loading = ref(true)

/* ===== 页签：状态这一维度整体交给页签 =====
   原先「统计卡 + 状态筛选行」各管一半状态，同一维度两处能改、两处口径还不一样（卡片按状态计数、
   筛选行按状态过滤）。现在合成一条：**点页签 = 按该状态过滤**，角标就是计数。 */

type TabKey = 'mine' | 'all' | 'collecting' | 'reviewing' | 'ready'

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'mine', label: '待我处理' },
  { key: 'all', label: '全部任务' },
  { key: 'collecting', label: '收题中' },
  { key: 'reviewing', label: '待验收' },
  { key: 'ready', label: '待送审' },
]

/**
 * 默认落在「全部任务」，不是排第一的「待我处理」：默认演示身份（机构管理员）是发起人、不是处理人，
 * 落在「待我处理」会一进页面就是空列表。待办条数在页签角标上看得见（且会变亮），不会漏。
 */
const activeTab = ref<TabKey>('all')

/* ===== 搜索条件 ===== */

interface CollabFilterRow {
  key: 'grade' | 'subject' | 'difficulty' | 'examType'
  label: string
  options: () => string[]
}

/**
 * 四个维度都是 chip 多选。**取值来自任务还是来自关联试卷，是分开取的**：
 * - 年级 / 学科取自任务的 `requirement` —— 列表「适用」列展示的就是它们，筛选口径必须与
 *   用户看得见的那一列一致，否则会出现「列里写着高一，筛高一却筛不出来」；
 * - 难度 / 考试类型取自关联试卷 —— 任务的 `requirement.difficulty` 是各难度档的**占比要求**
 *   （易 30% / 中 50% / 难 20%），不是单值，拿它做多选筛选没有意义；这两个维度的单值只有
 *   试卷上有，也就与试卷库同口径（见 ListView 的 FIELD_OF）。
 */
const FILTER_ROWS: CollabFilterRow[] = [
  { key: 'grade', label: '年级', options: () => grades.value },
  { key: 'subject', label: '学科', options: () => subjects.value },
  { key: 'difficulty', label: '难度', options: () => difficulties.value },
  { key: 'examType', label: '考试类型', options: () => examTypes.value },
]

const FIELD_OF: Record<CollabFilterRow['key'], (task: OrgCollabTask) => string> = {
  grade: (task) => task.requirement.grade,
  subject: (task) => task.requirement.subject,
  difficulty: (task) => paperOf(task)?.difficulty ?? '',
  examType: (task) => paperOf(task)?.examType ?? '',
}

/** 行定义展开给共享 AppFilterPanel；选项来自字典，**异步到达**，所以这里必须是 computed */
const filterRowDefs = computed<FilterRowDef[]>(() =>
  FILTER_ROWS.map((row) => ({ key: row.key, label: row.label, options: row.options() })),
)

const filters = reactive<Record<CollabFilterRow['key'], string[]>>({
  grade: [],
  subject: [],
  difficulty: [],
  examType: [],
})
const keyword = ref('')
const page = ref(1)

/**
 * 覆盖式回写：逐 key 写进这份 reactive 对象本身，**不让 `v-model` 整体替换它**。
 * 换掉引用则脚本里这份 `filters` 再也读不到新值，筛选看着有选中态、列表却纹丝不动。
 */
function onFiltersChange(next: Record<string, string[]>) {
  FILTER_ROWS.forEach((row) => {
    filters[row.key] = next[row.key] ?? []
  })
}

/**
 * 只应用搜索条件、**不含页签**的任务集 —— 页签角标的计数口径。
 *
 * 计数必须跟着搜索条件走：角标写着「收题中 3」点进去只有 1 条，比不显示数字更糟
 * （组卷工作台的试卷类型树用的是同一口径，见 PapersTab 的 `pool`）。
 */
const scoped = computed(() =>
  tasks.value.filter((row) => {
    for (const def of FILTER_ROWS) {
      const selected = filters[def.key]
      if (selected.length > 0 && !selected.includes(FIELD_OF[def.key](row))) return false
    }
    return !keyword.value || row.name.includes(keyword.value)
  }),
)

function inTab(task: OrgCollabTask, key: TabKey): boolean {
  if (key === 'all') return true
  /* 「待我处理」= 我名下还没交出去的题型（invited / working）。已提交与已验收都算交出去了；
     被退回整改的成员会回到 working，自然重新出现在这里。 */
  if (key === 'mine') {
    return task.members.some((m) => m.name === myName.value && (m.status === 'invited' || m.status === 'working'))
  }
  return task.status === key
}

const tabCounts = computed(
  () =>
    Object.fromEntries(TABS.map((tab) => [tab.key, scoped.value.filter((row) => inTab(row, tab.key)).length])) as Record<
      TabKey,
      number
    >,
)

const filtered = computed(() => scoped.value.filter((row) => inTab(row, activeTab.value)))
const rows = computed(() => filtered.value.slice((page.value - 1) * 8, page.value * 8))

/* 换页签 / 改条件后停在原页码会看到空列表，回第一页 */
watch([activeTab, () => JSON.stringify(filters), keyword], () => {
  page.value = 1
})

/* 状态配色与组卷页共用一份（见 collab-status.ts 的「颜色语言」说明） */
const STATUS_CLASS = COLLAB_STATUS_CLASS
const MEMBER_CLASS = COLLAB_MEMBER_CLASS

/* ===== 收题完成度：按分工算，而不是让用户自己去数题 ===== */

function paperOf(task: OrgCollabTask): OrgPaper | undefined {
  return papers.value.find((row) => row.id === task.paperId)
}

function memberDone(task: OrgCollabTask, member: CollabMember): number {
  const paper = paperOf(task)
  if (!paper) return 0
  return member.questionTypes.reduce((sum, type) => {
    const want = task.requirement.structure.find((row) => row.type === type)?.count ?? 0
    const have = paper.sections.reduce(
      (count, section) =>
        count + section.questions.filter((entry) => questions.value.find((q) => q.id === entry.questionId)?.type === type).length,
      0,
    )
    return sum + Math.min(want, have)
  }, 0)
}

function memberQuota(task: OrgCollabTask, member: CollabMember): number {
  return (
    member.quota ||
    member.questionTypes.reduce((sum, type) => sum + (task.requirement.structure.find((row) => row.type === type)?.count ?? 0), 0)
  )
}

function progressOf(task: OrgCollabTask): { done: number; total: number; percent: number } {
  const total = task.members.reduce((sum, member) => sum + memberQuota(task, member), 0)
  const done = task.members.reduce((sum, member) => sum + memberDone(task, member), 0)
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0 }
}

function paperQuestionCountOf(task: OrgCollabTask): number {
  return paperOf(task)?.sections.reduce((sum, section) => sum + section.questions.length, 0) ?? 0
}

/** 是否是本任务的发起人。改要求 / 删任务只给发起人 —— 与 mock 侧「仅收题中可编辑」互为表里 */
function isOwner(task: OrgCollabTask): boolean {
  return task.owner === myName.value
}

/* ===== 新建 / 编辑任务 ===== */

const dialogOpen = ref(false)
const saving = ref(false)
const editingId = ref<number | null>(null)

/** 题型要求的一行：题型 → 题数 / 单题分值 / 这一题型交给谁（编辑者在「协同处理」段里选，见 `memberSummary`） */
interface StructRow {
  type: string
  count: number
  score: number
  /**
   * 该题型的**编辑者**（机构员工姓名）：一个题型只能有一位，一位老师可以负责多个题型。
   *
   * 字段名仍叫 `assignee`：落到 mock 侧它就是 `CollabMember`（谁参与组卷、负责哪些题型），
   * 改要求时的反查、收题进度、验收都是按成员算的；为了一个标签改名会把这条链路全部重写一遍，
   * 而链路本身没有任何变化。
   */
  assignee: string
}

const form = reactive({
  name: '',
  subject: '数学',
  grade: '高一',
  /* 考试类型（字典 examType）：卷头字段，落在这份任务的试卷上 —— 试卷库的考试类型列、
     组卷工作台的试卷类型树读的都是它，不在任务里另存一份 */
  examType: '',
  /**
   * 考试时长：**弹窗里不再问了**（它是卷面格式的一部分，在卷面设置里改），但提交时仍带着它 ——
   * 新建时取来源卷的值（没有来源卷就是 120），编辑时取任务原值。这不是多余的：mock 的
   * `saveCollabTask` 会把 duration 一起写回试卷，若这里丢掉，改一次要求就会把卷面设置里
   * 调好的时长冲回默认值。
   */
  duration: 120,
  structure: [] as StructRow[],
  difficulty: [] as Array<{ level: string; ratio: number }>,
  knowledge: [] as string[],
  remark: '',
  /**
   * 查看者：除编辑者之外，额外允许查看本任务与试卷内容的人（机构员工姓名）。
   *
   * **空数组 = 不限制**（机构内谁都能看）—— 与 mock 侧同一口径，见 `OrgCollabTask.viewers`。
   * 这一项默认留空：协同组卷本来就是个开放协作的动作，只有怕提前泄题的发起人才会来圈名单，
   * 给一个默认勾满或默认「谁都不可见」的初始值，都会让「不设限制」这件事变得难选。
   */
  viewers: [] as string[],
  /* 新建任务的试卷存「我的文件」所选文件夹（编辑任务时不出现） */
  folderId: null as number | null,
})

/** 可选编辑者 / 查看者：机构员工（真实场景来自组织架构，演示取员工表） */
const candidates = computed(() => staff.value.map((row) => row.name))

/**
 * 已被指定为编辑者的姓名：查看者那一栏据此提示「这些人本来就看得见」。
 * 不去禁用他们的勾选框 —— 禁用态下若已经被勾上，用户既取消不掉、又没法理解为什么，
 * 而「编辑者也在查看者名单里」本身无害（编辑者当然看得见）。
 */
const editorNames = computed(() => new Set(form.structure.map((row) => row.assignee).filter(Boolean)))

/* ===== 年级 / 学科 / 考试类型：chip 单选，逐级收窄 ===== */

const gradeOptions = computed(() => grades.value)
/** 学科候选取自教材矩阵里该年级开设的学科（缺该年级时 `optionsForGrade` 退回全量，不会空） */
const subjectOptions = computed(() => optionsForGrade(form.grade))

/**
 * 考试类型候选：字典里适配该学段、该学科的那些（见 `examTypesFor`）。
 * 「小升初真题 / 分班考试」不该出现在高一，「物理竞赛」不该出现在数学卷上 —— 字典里
 * 本来就是这么标的，组卷工作台的试卷类型树也照这份规则收窄，两处口径一致。
 */
const examTypeOptions = computed(() => examTypesFor(form.grade, form.subject))

/** 新建时的兜底默认：与试卷库新建卷的默认口径一致（mock 的 `seedPaperMeta` 同样取「单元测试」） */
const DEFAULT_EXAM_TYPE = '单元测试'

/**
 * 考试类型归一：年级 / 学科一换，原来选的类型可能已经不在候选里（如数学卷上的「数学竞赛」，
 * 切到物理就没这一档了），此时改派一个仍成立的。取值本来就成立时**一动不动** ——
 * 否则每换一次学科都会把用户选好的类型冲掉。
 */
function normalizeExamType() {
  const options = examTypeOptions.value
  if (!options.length || options.includes(form.examType)) return
  form.examType = options.includes(DEFAULT_EXAM_TYPE) ? DEFAULT_EXAM_TYPE : options[0]!
}

/**
 * 换年级：先落年级，再回头看看当前学科在这个年级还开不开。
 * 不开就改派该年级的第一个学科，并由 `onSubjectChange` 一并清掉已选知识点 ——
 * 知识点树是按学科取的，换了学科，原来选的标签在新树上一个都不成立。
 */
function onGradeChange(value: string[]) {
  const next = value[0] ?? form.grade
  if (next === form.grade) return
  form.grade = next
  const options = optionsForGrade(next)
  if (options.length && !options.includes(form.subject)) onSubjectChange([options[0]!])
  normalizeExamType()
}

/** 换学科：清掉已选知识点（新学科的树上没有它们，留着只会误导） */
function onSubjectChange(value: string[]) {
  const next = value[0] ?? form.subject
  if (next === form.subject) return
  form.subject = next
  form.knowledge = []
  normalizeExamType()
}

/**
 * 换考试类型。与年级 / 学科同一口径：chip 单选再次点击已选项会抛出空数组（表示「取消选择」），
 * 而一份试卷必须有考试类型，所以这里把空数组当作「没变」忽略掉，不留一个空档位。
 */
function onExamTypeChange(value: string[]) {
  const next = value[0]
  if (!next || next === form.examType) return
  form.examType = next
}

/* ===== 考察知识点：弹窗里的知识点树 ===== */

/** 知识点要求的个数上限：比题目的 5 个宽 —— 一份卷要覆盖的考点本来就不止三五条 */
const MAX_REQ_KNOWLEDGE = 10
const knowledgeOpen = ref(false)

/** 打开树之前先确认学科：树按「年级 / 学科」加载，没学科它就是一棵空树 */
function openKnowledge() {
  if (!form.subject) {
    showToast('请先选择学科，知识点树按学科加载', 'error')
    return
  }
  knowledgeOpen.value = true
}

function onKnowledgeConfirm(tags: string[]) {
  form.knowledge = tags.slice(0, MAX_REQ_KNOWLEDGE)
  knowledgeOpen.value = false
}

/** 卷面来源试卷 id：从「试卷编辑 → 协同组卷」带 `?paperId=` 进来时记下，创建时复制其卷面 */
const sourcePaperId = ref(0)
const sourcePaperName = computed(() => papers.value.find((row) => row.id === sourcePaperId.value)?.name ?? '')

const difficultyRatioSum = computed(() => form.difficulty.reduce((sum, row) => sum + (Number(row.ratio) || 0), 0))

/**
 * 结构行的题型候选项：通用题型 + 当前学科专属题型（英语的完形填空 / 七选五 / 短文改错），
 * 并**去掉已被别的行占用的题型** —— 一个题型只能有一行、一位负责人（mock 侧同样拦，
 * 见 `saveCollabTask` 的重复题型校验），不给用户到提交那一步才撞墙。
 * 仍并入行内现值，保证下拉永远有选中项，不会渲染成空白。
 */
function structureTypes(current: string, index: number): string[] {
  const used = new Set(form.structure.filter((_, i) => i !== index).map((row) => row.type))
  return withCurrent(questionTypesFor(form.subject).filter((type) => !used.has(type)), current)
}

/** 新行默认挑一个还没被占用的题型，免得刚点「添加题型」就先撞一次重复 */
function addStructRow() {
  const used = new Set(form.structure.map((row) => row.type))
  const free = questionTypesFor(form.subject).find((type) => !used.has(type)) ?? '单选'
  form.structure.push({ type: free, count: 4, score: 5, assignee: '' })
}

/**
 * 分工：**从题型要求反推**参与老师，而不是另开一块「成员 × 题型」的矩阵。
 *
 * 同一份分工两处可改，迟早出现「成员区勾了、题型行里没选」这种自相矛盾的状态；
 * 而「谁参与组卷」与「谁负责哪个题型」本来就是同一件事 —— 所以这里只留题型后的选人下拉，
 * 成员名单由它推出来。代价是「只参与、不负责具体题型」的老师没法加，实际也不成立
 * （没有题型的老师进不了选题池，见 PaperEditView 的 `myTypes`）。
 *
 * 这份名单现在是**只读**的：选人下拉搬去了「协同处理」段（那里同时管查看者），
 * 这里只把结果摊开给人核对 —— 名单要的是「一眼看全」，不该再长一遍可点的控件。
 */
const memberSummary = computed(() => {
  const map = new Map<string, { name: string; types: string[]; count: number }>()
  form.structure.forEach((row) => {
    if (!row.assignee) return
    const item = map.get(row.assignee) ?? { name: row.assignee, types: [], count: 0 }
    item.types.push(row.type)
    item.count += Number(row.count) || 0
    map.set(row.assignee, item)
  })
  return [...map.values()]
})

/** 同一题型出现在多行：提交必被 mock 拒（同一题型被分给多人的口径），提前拦住并说清楚 */
const duplicateTypes = computed(() => {
  const seen = new Set<string>()
  const dup: string[] = []
  form.structure.forEach((row) => {
    if (seen.has(row.type)) dup.push(row.type)
    else seen.add(row.type)
  })
  return [...new Set(dup)]
})

/** 还没指定编辑者的题型 */
const unassignedTypes = computed(() => form.structure.filter((row) => !row.assignee))

/**
 * 换学科后，原来的学科专属题型可能已不适用（英语的「完形填空」切到数学）——
 * 静默改派该学科下的可用题型，不弹确认：切学科本身就是用户主动做的动作。
 * 依次取未被占用的题型，避免多行一起退化成同一个。
 */
watch(
  () => form.subject,
  (subject) => {
    const options = questionTypesFor(subject)
    if (!options.length) return
    const used = new Set(form.structure.map((row) => row.type).filter((type) => options.includes(type)))
    form.structure.forEach((row) => {
      if (options.includes(row.type)) return
      row.type = options.find((type) => !used.has(type)) ?? options[0]
      used.add(row.type)
    })
  },
)

function resetForm() {
  editingId.value = null
  sourcePaperId.value = 0
  form.name = ''
  form.subject = pick(subjects.value, '数学')
  form.grade = pick(grades.value, '高一')
  /* 空串先占位：候选要等字典到位（`normalizeScope` 才会补上默认值），此处写死任一个
     都可能落在这个年级学科不成立的档位上 */
  form.examType = ''
  form.duration = 120
  form.structure = [
    { type: '单选', count: 8, score: 5, assignee: '' },
    { type: '填空', count: 4, score: 5, assignee: '' },
    { type: '解答', count: 3, score: 12, assignee: '' },
  ]
  form.difficulty = [
    { level: '容易', ratio: 30 },
    { level: '中等', ratio: 50 },
    { level: '困难', ratio: 20 },
  ]
  form.knowledge = []
  form.remark = ''
  /* 查看者默认留空 = 不限制查看（见 form.viewers 的注释） */
  form.viewers = []
  form.folderId = null
}

/** 从试卷编辑页带 `?paperId=` 进来：把该卷的卷头与本卷已有题目要求带过来，省一次重填 */
async function prefillFromPaper(paperId: number) {
  const paper = papers.value.find((row) => row.id === paperId)
  if (!paper) return
  sourcePaperId.value = paper.id
  form.name = paper.name
  form.subject = paper.subject
  form.grade = paper.grade
  form.duration = paper.duration
  /* 考试类型跟着来源卷走：这本来就是这张卷的卷头信息，发起协同只是换一种组卷方式 */
  if (paper.examType) form.examType = paper.examType
  normalizeExamType()
  /* 按试卷现有大题反推题型结构：大题名里带「单选/填空/解答」等关键词即可识别。
     顺序敏感 ——「多选」必须排在「选择」之前，否则「多项选择题」会被当成单选。 */
  const KEYWORDS: Array<[string, string]> = [
    ['多选', '多选'],
    ['选择', '单选'],
    ['单选', '单选'],
    ['判断', '判断'],
    ['填空', '填空'],
    ['问答', '解答'],
    ['解答', '解答'],
    ['计算', '计算'],
    ['证明', '证明'],
    ['连线', '连线'],
    ['作文', '作文'],
    ['作图', '作图'],
  ]
  const derived = paper.sections
    .map((section) => {
      const hit = KEYWORDS.find(([kw]) => section.title.includes(kw))
      if (!hit) return null
      const scores = section.questions.map((row) => Number(row.score) || 0)
      const score = scores.length && scores.every((row) => row === scores[0]) ? scores[0] : 5
      return { type: hit[1], count: Math.max(section.questions.length, 1), score, assignee: '' }
    })
    .filter((row): row is StructRow => row !== null)
  if (derived.length) form.structure = derived
}

/**
 * 字典（年级 / 学科 / 教材矩阵）是异步到达的：`resetForm` 跑在它前面时，
 * 默认值只能靠写死的兜底，可能落在一个不存在的年级或该年级不开的学科上 ——
 * chip 单选里这种值会显示成一颗选了也不成立的孤立 chip，故字典到位后再校正一次。
 */
function normalizeScope() {
  form.grade = pick(grades.value, form.grade)
  const options = optionsForGrade(form.grade)
  if (options.length && !options.includes(form.subject)) form.subject = options[0]!
  normalizeExamType()
}

async function openCreate(paperId?: number) {
  resetForm()
  dialogOpen.value = true
  await ensure()
  /* 顺序不能反：先按字典校正，再让来源试卷的卷头覆盖它（试卷上的年级学科本来就是真数据） */
  normalizeScope()
  if (paperId) void prefillFromPaper(paperId)
}

function openEdit(task: OrgCollabTask) {
  resetForm()
  editingId.value = task.id
  form.name = task.name
  form.subject = task.requirement.subject
  form.grade = task.requirement.grade
  form.duration = task.requirement.duration
  /* 考试类型存在试卷上（卷头字段），不在 requirement 里 —— 任务与试卷一对一，取的就是它那张 */
  form.examType = paperOf(task)?.examType ?? ''
  /* 分工反查：题型 → 负责人（一份任务里题型与负责人是一对一，故取到的就是那一行） */
  form.structure = task.requirement.structure.map((row) => ({
    ...row,
    assignee: task.members.find((member) => member.questionTypes.includes(row.type))?.name ?? '',
  }))
  form.difficulty = task.requirement.difficulty.map((row) => ({ ...row }))
  form.knowledge = [...task.requirement.knowledge]
  form.remark = task.requirement.remark
  form.viewers = [...task.viewers]
  dialogOpen.value = true
}

async function submit() {
  if (form.name.trim().length < 2 || form.name.trim().length > 50) {
    showToast('试卷名称须为 2-50 字', 'error')
    return
  }
  if (!editingId.value && form.folderId == null) {
    showToast('请选择试卷在「我的文件」中的存储位置', 'error')
    return
  }
  if (!form.examType) {
    showToast('请选择考试类型', 'error')
    return
  }
  if (!form.structure.length) {
    showToast('请至少设置 1 个题型', 'error')
    return
  }
  if (form.structure.some((row) => row.count < 1 || row.score <= 0)) {
    showToast('每个题型的题数 ≥ 1、单题分值 > 0', 'error')
    return
  }
  if (duplicateTypes.value.length) {
    showToast(`题型「${duplicateTypes.value.join('、')}」出现在多行，请合并为一行再指派负责人`, 'error')
    return
  }
  if (unassignedTypes.value.length) {
    showToast(`题型「${unassignedTypes.value.map((row) => row.type).join('、')}」还没指定编辑者`, 'error')
    return
  }
  /* 校验都在上面同步做完，此刻仍是点击那一刻的手势 —— 先把标签页占下来，
     建完任务直接落位到编辑卷面（协同的分工、进度、评价都在那个页面里）。
     await 之后再开窗会被当成弹窗拦掉，见 utils/paper-edit.ts */
  const tab = editingId.value ? null : openBlankTab()
  saving.value = true
  try {
    const members: Array<Pick<CollabMember, 'name' | 'questionTypes' | 'perms'>> = memberSummary.value.map((row) => ({
      name: row.name,
      questionTypes: row.types,
      perms: ['选题', '改分值'],
    }))
    const { task } = await saveCollabTask({
      id: editingId.value ?? undefined,
      name: form.name.trim(),
      requirement: {
        subject: form.subject,
        grade: form.grade,
        duration: form.duration,
        /* `assignee` 是这一层的编辑态字段，不进 requirement：要求里只有「题型 → 题数 / 分值」，
           负责人归 members —— 两者分开，改要求时才不会把分工一起写花 */
        structure: form.structure.map((row) => ({ type: row.type, count: row.count, score: row.score })),
        difficulty: form.difficulty.map((row) => ({ ...row })),
        knowledge: [...form.knowledge],
        remark: form.remark,
      },
      members,
      /* 查看者：空数组 = 不限制（机构内都可查看），覆盖式写入 —— 删空就是「改回不限制」 */
      viewers: [...form.viewers],
      /* 考试类型是卷头字段：落在这份任务的试卷上，与名称 / 学科 / 年级 / 时长一起写 */
      examType: form.examType,
      /* 仅新建且带来源试卷时传：把那张卷的卷面复制过来当起点，避免「发起协同后题全没了」 */
      sourcePaperId: editingId.value ? undefined : sourcePaperId.value || undefined,
      /* 新建任务的试卷存「我的文件」所选文件夹 */
      folderId: editingId.value ? undefined : form.folderId ?? undefined,
    })
    dialogOpen.value = false
    await load()
    showToast(
      editingId.value
        ? '任务已更新'
        : sourcePaperId.value
          ? '协同组卷任务已创建，已复制原卷面作为起点，试卷已存入「我的文件」'
          : '协同组卷任务已创建，已向处理人发送通知，试卷已存入「我的文件」',
      'success',
    )
    /* 落位到新任务的编辑卷面；那个空白页被拦或被用户关掉时退回同页签跳转（见 openPaperEdit） */
    if (tab && !openPaperEdit(task.paperId, tab)) router.push(paperEditHref(task.paperId))
  } catch (error) {
    tab?.close()
    showToast(error instanceof Error ? error.message : '保存失败', 'error')
  } finally {
    saving.value = false
  }
}

/* ===== 进度抽屉 ===== */

const detail = ref<OrgCollabTask | null>(null)

async function onDelete(task: OrgCollabTask) {
  if (!(await appConfirm(`删除协同组卷任务《${task.name}》？将进入回收站保留 30 天`, { type: 'danger' }))) return
  await deleteCollabTask(task.id)
  showToast('任务已移入回收站', 'success')
  await load()
}

/* ===== 数据 ===== */

async function load() {
  loading.value = true
  try {
    await ensure()
    const [taskRows, paperRows, questionRows, staffRows] = await Promise.all([
      fetchCollabTasks(),
      fetchPapers(),
      fetchQuestions(),
      fetchStaff(),
    ])
    tasks.value = taskRows
    papers.value = paperRows
    questions.value = questionRows
    staff.value = staffRows.list
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await load()
  const paperId = Number(route.query.paperId ?? 0)
  if (paperId) void openCreate(paperId)
})
</script>

<template>
  <div class="page">
    <AppPageHeader desc="一张试卷按题型拆给多位老师分头组卷，发起人定卷面要求，处理人只能选自己负责的题型，但可以看到整张试卷。">
      <template #actions>
        <!-- 协同组卷谁都能发起：一位老师临时要跟自己班的其他老师合出一张卷，也要能自己拉人组卷。
             发起人 = 创建人（mock 侧 owner 取 `CURRENT.name`），之后的验收 / 送审 / 退回只认发起人本人（见 PaperEditView） -->
        <button class="btn btn-primary" @click="openCreate()">
          <AppIcon name="plus" :size="15" /> 新建协同组卷任务
        </button>
      </template>
    </AppPageHeader>

    <AppFilterPanel :rows="filterRowDefs" :model-value="filters" @update:model-value="onFiltersChange" />

    <div class="panel">
      <!-- 状态页签贴着列表：它与下面的表格是「同一批任务换个角度看」，中间隔一层搜索条件会让人
           以为页签也是搜索条件之一。搜索面板留在面板外，两者的分量本来就不一样。
           状态维度只有这一处入口（原先的统计卡已并入页签）：点页签 = 按该状态过滤，角标 = 条数 -->
      <div class="tab-bar">
        <button
          v-for="tab in TABS"
          :key="tab.key"
          class="tab-btn"
          :class="{ on: tab.key === activeTab }"
          type="button"
          @click="activeTab = tab.key"
        >
          {{ tab.label }}
          <!-- 有活等着我干时把角标点亮：一眼就能看出「切到这个身份有事情做」 -->
          <span class="tab-count" :class="{ 'is-todo': tab.key === 'mine' && tabCounts.mine > 0 }">
            {{ tabCounts[tab.key] }}
          </span>
        </button>
      </div>

      <!-- 工具条自带 14/18 的内边距，与下方表格的满幅排布配合（表格要贴着面板边才能横向滚动） -->
      <div class="list-head">
        <AppListToolbar v-model="keyword" placeholder="试卷名称" />
      </div>

      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>试卷名称</th>
              <th>适用</th>
              <th>题型分工</th>
              <th>收题进度</th>
              <th>卷面</th>
              <th>状态</th>
              <th>发起人</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="rows.length === 0">
              <!-- 空列表分两种：整个机构一条任务都没有，还是只是当前页签/条件下没有 -->
              <td colspan="8" class="empty-row">
                {{ tasks.length === 0 ? '暂无协同组卷任务' : '当前页签与搜索条件下暂无任务' }}
              </td>
            </tr>
            <template v-else>
              <tr v-for="row in rows" :key="row.id">
                <td class="cell-strong">
                  {{ row.name }}
                  <span class="tag tag-gray" style="margin-left: 6px">v{{ row.versions.length }}</span>
                </td>
                <td>{{ row.requirement.grade }} · {{ row.requirement.subject }} · {{ row.requirement.duration }} 分钟</td>
                <td>
                  <div class="assign-cell">
                    <span
                      v-for="member in row.members"
                      :key="member.name"
                      class="tag"
                      :class="MEMBER_CLASS[member.status]"
                      :title="member.reviewNote ? `退回意见：${member.reviewNote}` : undefined"
                    >
                      {{ member.name }}：{{ member.questionTypes.join('、') || '未分配' }}
                    </span>
                  </div>
                </td>
                <td>
                  <div class="prog">
                    <div class="usage">
                      <div class="num">{{ progressOf(row).done }} / {{ progressOf(row).total }} 题</div>
                      <div class="bar"><i :style="{ width: `${progressOf(row).percent}%` }" /></div>
                    </div>
                  </div>
                </td>
                <td>{{ paperQuestionCountOf(row) }} 题</td>
                <td><span class="tag" :class="STATUS_CLASS[row.status]">{{ COLLAB_STATUS_TEXT[row.status] }}</span></td>
                <td>{{ row.owner }}</td>
                <td>
                  <div class="op-group">
                    <!-- 组卷入口与「编辑卷面」指向的是同一个页面 —— 协同的进度、组卷信息、
                         评价现在都在编辑卷面里，留两个按钮只会让人犹豫按哪个。
                         新标签页打开：改完卷面还要回这张列表接着处理下一份（见 utils/paper-edit.ts）。 -->
                    <a class="mini-btn" :href="paperEditHref(row.paperId)" target="_blank" rel="noopener">进入组卷</a>
                    <button class="mini-btn" @click="detail = row">进度</button>
                    <!-- 「要求 / 删除」只给发起人：改要求会重建成员分工（连带清掉验收痕迹），
                         删任务更是把别人的活一起删了，两者都不该让处理人点到。
                         「要求」还要卡在收题中 —— 任务一进验收流程，mock 侧也会拒绝（见 saveCollabTask）。 -->
                    <button v-if="isOwner(row) && row.status === 'collecting'" class="mini-btn" @click="openEdit(row)">要求</button>
                    <button v-if="isOwner(row)" class="mini-btn danger" @click="onDelete(row)">删除</button>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
      <AppPagination :total="filtered.length" v-model:page="page" :page-size="8" />
    </div>

    <!-- ===== 新建 / 编辑任务 ===== -->
    <AppModal v-if="dialogOpen" :title="editingId ? '修改协同组卷要求' : '新建协同组卷任务'" :width="820" @close="dialogOpen = false">
      <!-- 第一段「试卷信息」：只回答「这张卷叫什么、放在哪儿」两项。
           内容最轻，但它照样占一个序号 —— 序号是「按顺序往下填」的提示，
           从 1 断到 2 会让人以为是漏渲染了一段 -->
      <section class="f-panel">
        <h4 class="step-head"><span class="step-no">1</span>试卷信息</h4>

        <div class="f-field">
          <label class="f-label">试卷名称<span class="req">*</span></label>
          <input v-model="form.name" class="f-input" maxlength="50" placeholder="例如：高一数学第三次月考卷" />
          <p v-if="sourcePaperName" class="f-hint" style="margin-top: 5px">
            卷面来源：复制《{{ sourcePaperName }}》的现有卷面作为起点，编辑者在此基础上补齐各自题型。
          </p>
        </div>

        <!-- 存储位置只在新建时出现：协同产出的试卷也是个人试卷，同样存「我的文件」 -->
        <div v-if="!editingId" class="f-field">
          <label class="f-label">存储位置（我的文件）<span class="req">*</span></label>
          <PaperFolderSelect v-model="form.folderId" />
          <p class="f-hint" style="margin-top: 5px">任务试卷将保存到该文件夹，组卷完成后可随时打开继续编辑。</p>
        </div>
      </section>

      <!-- 第二段「组卷设置」：这一段回答「考什么」—— 年级学科定学段范围，考试类型定卷子的性质，
           知识点再往下圈考点。**考试时长不在这里**：它是卷面格式的一部分，在卷面设置里改，
           发起协同组卷时再问一遍，只会在两处各存一个值、谁也不知道该听谁的。
           序号 2 与智能组卷的第二步（同名的「组卷设置」）对齐，两处的「第几步填什么」是同一套 -->
      <section class="f-panel">
        <h4 class="step-head"><span class="step-no">2</span>组卷设置</h4>

        <!-- 年级 / 学科 / 考试类型是 chip 单选：候选项少、一次只选一个，下拉要多点一次才看得见全部选项。
             顺序即收窄顺序：年级 → 学科（教材矩阵里这个年级开哪些学科）→ 考试类型（字典里适配这个
             学段学科的那些）。顺序反过来就会出现「先选好的值被上一级改派掉」这种看起来像 bug 的现象。
             三者共用共享的 AppFilterChips（单选态），与筛选面板是同一套 chip 视觉与交互 -->
        <div class="f-field chip-fields">
          <AppFilterChips
            label="年级"
            :options="withCurrent(gradeOptions, form.grade)"
            :model-value="[form.grade]"
            :multiple="false"
            @update:model-value="onGradeChange"
          />
          <AppFilterChips
            label="学科"
            :options="withCurrent(subjectOptions, form.subject)"
            :model-value="[form.subject]"
            :multiple="false"
            @update:model-value="onSubjectChange"
          />
          <!-- 考试类型取的是**试卷上的**那一栏（字典 examType），落库时写进这份任务的试卷卷头，
               与试卷库的「考试类型」列、试卷类型树是同一个值 -->
          <AppFilterChips
            label="考试类型"
            :options="withCurrent(examTypeOptions, form.examType)"
            :model-value="form.examType ? [form.examType] : []"
            :multiple="false"
            @update:model-value="onExamTypeChange"
          />
        </div>

        <!-- 考察知识点：紧跟在考试类型后面（它本来就是「在这个年级这个学科里考什么」），
             点击弹窗里的知识点树选择 —— 手打知识点既容易与知识树上的标签对不上，
             编辑者与 AI 抽题也就匹配不到自己题库里的题 -->
        <div class="f-field">
          <label class="f-label">考察知识点要求</label>
          <button class="kp-open" type="button" @click="openKnowledge">
            <template v-if="form.knowledge.length">
              <span v-for="tag in form.knowledge" :key="tag" class="kp-tag">{{ tag }}</span>
            </template>
            <span v-else class="kp-open-empty">点击从知识点树中选择（最多 {{ MAX_REQ_KNOWLEDGE }} 个，可不选）</span>
            <AppIcon name="chevron-right" :size="14" class="kp-open-arrow" />
          </button>
          <p class="f-hint">按「{{ form.grade }} / {{ form.subject }}」的知识点树勾选，编辑者与 AI 抽题都会照着这份要求选题。</p>
        </div>
      </section>

      <!-- 第三段「试题设置」：这一段回答「出什么题」—— 题型 / 题数 / 单题分值定卷面骨架，
           难度占比与命题说明是整卷的口径。**谁来做不在这里**：编辑者与查看者都归下一段，
           一段只回答一个问题，改题量与换人才不会看着像同一类操作。
           序号 3 与智能组卷的第三步同名同号 -->
      <section class="f-panel">
        <h4 class="step-head"><span class="step-no">3</span>试题设置</h4>

        <!-- 题型要求：一行一个题型，只有题数与分值 —— 这两个数是「卷面长什么样」的一部分，
             而「这一行谁来做」是人的安排（下一段）。两件事混在一行里，改题量时视线要跨过
             一个与题无关的下拉框，改人时又得回到题目设置里翻 -->
        <div class="f-field">
          <label class="f-label">题型要求<span class="req">*</span>（题数 / 单题分值；编辑者在「协同处理」里指定）</label>
          <div v-for="(row, i) in form.structure" :key="i" class="struct-row">
            <!-- 题数与分值不另开列头，用行内的「题 ×」「分/题」自标（与 BlueprintTab 同一套写法），
                 再给输入框挂 title：行内文字是视觉提示，title 是给读屏的 -->
            <select v-model="row.type" class="f-select" style="width: 118px">
              <option v-for="t in structureTypes(row.type, i)" :key="t" :value="t">{{ t }}</option>
            </select>
            <input v-model.number="row.count" type="number" min="1" class="f-input" style="width: 66px" title="题数" />
            <span class="f-hint">题 ×</span>
            <input
              v-model.number="row.score"
              type="number"
              min="0.5"
              step="0.5"
              class="f-input"
              style="width: 66px"
              title="单题分值"
            />
            <span class="f-hint">分/题</span>
            <span class="f-hint" style="margin-left: auto">小计 {{ (row.count || 0) * (row.score || 0) }} 分</span>
            <button class="mini-btn danger" type="button" :disabled="form.structure.length <= 1" @click="form.structure.splice(i, 1)">删除</button>
          </div>
          <button class="btn btn-ghost btn-sm" type="button" :disabled="form.structure.length >= 8" @click="addStructRow()">
            <AppIcon name="plus" :size="14" /> 添加题型
          </button>
          <p class="f-hint">
            预计总分 {{ form.structure.reduce((s, r) => s + (r.count || 0) * (r.score || 0), 0) }} 分 · 共
            {{ form.structure.reduce((s, r) => s + (r.count || 0), 0) }} 题
          </p>
          <p v-if="duplicateTypes.length" class="f-hint is-warn">
            题型「{{ duplicateTypes.join('、') }}」出现在多行，请合并为一行 —— 同一题型只能有一位编辑者。
          </p>
        </div>

        <div class="f-field">
          <label class="f-label">难点要求（各难度占比，建议合计 100%）</label>
          <div v-for="(row, i) in form.difficulty" :key="i" class="struct-row">
            <select v-model="row.level" class="f-select" style="width: 128px">
              <option v-for="d in difficulties" :key="d" :value="d">{{ d }}</option>
            </select>
            <input v-model.number="row.ratio" type="number" min="0" max="100" class="f-input" style="width: 80px" />
            <span class="f-hint">%</span>
            <button class="mini-btn danger" type="button" :disabled="form.difficulty.length <= 1" @click="form.difficulty.splice(i, 1)">删除</button>
          </div>
          <button class="btn btn-ghost btn-sm" type="button" :disabled="form.difficulty.length >= 5" @click="form.difficulty.push({ level: '中等', ratio: 20 })">
            <AppIcon name="plus" :size="14" /> 添加难度档
          </button>
          <p class="f-hint" :class="{ 'is-warn': difficultyRatioSum !== 100 }">
            当前合计 {{ difficultyRatioSum }}%<template v-if="difficultyRatioSum !== 100">（不等于 100%，仍可保存，仅作编辑者参考）</template>
          </p>
        </div>

        <div class="f-field">
          <label class="f-label">命题说明</label>
          <textarea v-model="form.remark" class="f-textarea" rows="3" placeholder="命题范围、风格要求、注意事项等，编辑者与 AI 抽题都会读到" />
        </div>
      </section>

      <!-- 第四段「协同处理」：把「人」的安排收在一处 —— 谁编辑（按题型分工）、谁能看。
           参与老师名单是**推导出来的**（由编辑者反推，见 memberSummary），所以它只读摊开，
           不再长一遍可点击的控件：同一份分工两处能改，迟早出现两边对不上的中间状态 -->
      <section class="f-panel">
        <h4 class="step-head"><span class="step-no">4</span>协同处理</h4>

        <div class="f-field">
          <label class="f-label">编辑者<span class="req">*</span></label>
          <p class="f-hint">每个题型指定一位编辑者，编辑者只能挑选自己负责题型的题目（整卷可见、不可改）。</p>
          <div v-for="(row, i) in form.structure" :key="i" class="struct-row">
            <span class="edit-type">{{ row.type }}</span>
            <span class="f-hint">{{ row.count || 0 }} 题 · {{ (row.count || 0) * (row.score || 0) }} 分</span>
            <select v-model="row.assignee" class="f-select" style="width: 132px" :class="{ 'is-empty': !row.assignee }">
              <option value="">选择编辑者</option>
              <option v-for="name in candidates" :key="name" :value="name">{{ name }}</option>
            </select>
          </div>
        </div>

        <div class="f-field">
          <label class="f-label">参与老师</label>
          <p v-if="!candidates.length" class="f-hint">机构暂无可用员工，无法指定编辑者。</p>
          <div v-for="row in memberSummary" :key="row.name" class="assign-row">
            <span class="assign-name">{{ row.name }}</span>
            <span class="f-hint">负责：{{ row.types.join('、') }}</span>
            <span class="f-hint" style="margin-left: auto">共 {{ row.count }} 题</span>
          </div>
          <p v-if="unassignedTypes.length" class="f-hint is-warn">
            尚未指定编辑者的题型：{{ unassignedTypes.map((row) => row.type).join('、') }}
            （每个题型必须有且只有一位编辑者，一位老师可以负责多个题型）
          </p>
          <p v-else class="f-hint">名单由上方「编辑者」推出，创建后即向对方发送通知。</p>
        </div>

        <!-- 查看者：默认谁也不勾 = 不限制（见 form.viewers 的注释）。名单里明确标出谁是编辑者 ——
             他们本来就看得见，不用再勾一遍，否则名单会被编辑者的名字撑长，看不出真正多放了谁 -->
        <div class="f-field">
          <label class="f-label">查看者</label>
          <p class="f-hint">除编辑者外，还允许哪些人查看本任务的试卷与进度（防止题目提前泄露）。</p>
          <div class="viewer-checks">
            <label v-for="(name, i) in candidates" :key="i" class="viewer-check">
              <input v-model="form.viewers" type="checkbox" :value="name" />
              {{ name }}
              <em v-if="editorNames.has(name)">编辑者</em>
            </label>
          </div>
          <p class="f-hint">
            <template v-if="form.viewers.length">已选 {{ form.viewers.length }} 人，名单外的人看不到本任务。</template>
            <template v-else>未设置 = 不限制：机构内所有成员都能查看本任务与试卷内容。</template>
          </p>
        </div>
      </section>

      <template #footer>
        <button class="btn btn-ghost" @click="dialogOpen = false">取消</button>
        <button class="btn btn-primary" :disabled="saving" @click="submit">
          {{ saving ? '保存中…' : editingId ? '保存修改' : '创建任务并邀请' }}
        </button>
      </template>
    </AppModal>

    <!-- 知识点树弹窗：`v-if` 挂载 = 每次打开都从最新已选起算，取消（不 confirm）即丢弃。
         教材版本不传：协同组卷没有「教材版本」这一项，树本来就按学科（+学段）取，硬凑一个版本反而误导 -->
    <KnowledgePickerModal
      v-if="knowledgeOpen"
      title="选择考察知识点"
      :model-value="form.knowledge"
      :subject="form.subject"
      :grade="form.grade"
      :max="MAX_REQ_KNOWLEDGE"
      @close="knowledgeOpen = false"
      @confirm="onKnowledgeConfirm"
    />

    <!-- ===== 进度抽屉 ===== -->
    <AppDrawer v-if="detail" :title="detail.name" subtitle="各任务处理人的负责题型、进度与状态" :width="560" @close="detail = null">
      <div class="prog-head">
        <div class="usage">
          <div class="num">整体收题 {{ progressOf(detail).done }} / {{ progressOf(detail).total }} 题</div>
          <div class="bar"><i :style="{ width: `${progressOf(detail).percent}%` }" /></div>
        </div>
        <span class="tag" :class="STATUS_CLASS[detail.status]">{{ COLLAB_STATUS_TEXT[detail.status] }}</span>
      </div>

      <div v-for="member in detail.members" :key="member.name" class="prog-row">
        <div class="prog-top">
          <b>{{ member.name }}</b>
          <span class="tag" :class="MEMBER_CLASS[member.status]">
            {{ COLLAB_MEMBER_TEXT[member.status] }}
          </span>
          <i v-if="member.online" class="online-dot" title="在线" />
          <span class="f-hint" style="margin-left: auto">{{ memberDone(detail, member) }} / {{ memberQuota(detail, member) }} 题</span>
        </div>
        <div class="usage" style="margin-top: 6px">
          <div class="bar">
            <i :style="{ width: `${memberQuota(detail, member) ? Math.round((memberDone(detail, member) / memberQuota(detail, member)) * 100) : 0}%` }" />
          </div>
        </div>
        <p class="f-hint">负责题型：{{ member.questionTypes.join('、') }} · 权限：{{ member.perms.join('/') }}</p>
        <p class="f-hint">最近动作：{{ member.lastActiveAt }}</p>
        <p v-if="member.reviewNote" class="f-hint is-warn">退回意见：{{ member.reviewNote }}</p>
      </div>

      <div class="section-title" style="margin-top: 18px">版本记录</div>
      <div v-for="row in detail.versions.slice().reverse()" :key="row.id" class="ver-row">
        <div class="ver-head">
          <b>v{{ row.no }}</b>
          <span>{{ row.actor }}</span>
          <em>{{ row.time }}</em>
        </div>
        <p class="f-hint">{{ row.summary }} · {{ row.questionCount }} 题 / {{ row.totalScore }} 分</p>
      </div>
    </AppDrawer>
  </div>
</template>

<style scoped>
/* 页签栏用下划线式，且贴在被它过滤的列表顶上：页签是「换个角度看同一批任务」，
   搜索面板是「收窄这批任务」，两者的分量本来就不该长得一样。
   内边距与外层搜索面板 / 工具条同为 18px，页签文字才与下方表头对齐 */
.tab-bar {
  display: flex; align-items: center; gap: 2px;
  padding: 0 18px;
  border-bottom: 1.5px solid var(--border);
}
.tab-btn {
  display: inline-flex; align-items: center; gap: 6px;
  border: none; background: transparent;
  font-family: inherit; font-size: 13.5px; color: var(--ink-2);
  padding: 9px 14px 10px;
  border-bottom: 2px solid transparent;
  margin-bottom: -1.5px; /* 压住 .tab-bar 的下边框，选中态下划线才与它严丝合缝 */
  transition: color 0.15s, border-color 0.15s;
}
.tab-btn:hover { color: var(--brand-deep); }
.tab-btn.on { color: var(--brand-deep); font-weight: 700; border-bottom-color: var(--brand); }
.tab-count {
  min-width: 18px; height: 17px; padding: 0 5px;
  border-radius: 999px; background: var(--border); color: var(--ink-2);
  font-size: 11px; font-weight: 700; line-height: 17px; text-align: center;
}
.tab-btn.on .tab-count { background: var(--brand); color: #fff; }
/* 有活等着我干时把角标点亮：一眼就能看出「切到这个身份有事情做」。
   选中态由上面那条 `.tab-btn.on .tab-count` 覆盖成实心 —— 它的选择器权重更高（3 个 class vs 2 个），
   与书写顺序无关，所以不必再补一条 `.tab-btn.on .tab-count.is-todo` */
.tab-count.is-todo { background: var(--warn-soft); color: var(--warn); }

/* 列表工具条与面板同宽同边距：表格满幅贴边才能横向滚动，所以内边距给在工具条这一层 */
.list-head { padding: 14px 18px 0; }

.assign-cell { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; max-width: 260px; }
.prog { min-width: 120px; }

/* 年级 / 学科 / 考试类型三行 chip：每行自己撑满一行，靠列向排布竖着摞起来 */
.chip-fields { display: flex; flex-direction: column; gap: 8px; }

/* 弹窗分四段（试卷信息 / 组卷设置 / 试题设置 / 协同处理），段标题是带圆底序号的
   `.step-head` + `.step-no`（样式在 main.css，与智能组卷的三步同一套）。
   每段给一块浅底细边：段内是一组有归属关系的字段（这张卷是什么 / 考什么 / 出什么题 / 谁来做），
   有边界才看得出分组。底边不留内边距 —— 段内最后一项的 .f-field 自带 16px 下边距，正好收尾，
   再补一层 padding 就会比上边距厚一截 */
.f-panel { border: 1px solid var(--border); border-radius: 12px; background: #fbfcfe; padding: 14px 16px 0; }
.f-panel + .f-panel { margin-top: 16px; }
/* 弹窗比智能组卷那一整页窄得多：段标题跟着收一号，免得四个标题在弹窗里比字段还抢眼 */
.f-panel .step-head { font-size: 13.5px; }

.struct-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
/* 横向居中的行里，f-hint 自带的 5px 上边距会把文字顶歪 */
.struct-row .f-hint { margin-top: 0; }
/* 还没选编辑者的下拉用虚线框提示「这一格非空才允许提交」，与填好的实线框区分开 */
.struct-row .f-select.is-empty { border-style: dashed; color: var(--sub); }
.is-warn { color: var(--warn); }

/* 「协同处理」里的题型名：这一段改的是人，题型只是分组依据，所以它是标签不是输入框。
   宽度与上一段题型下拉一致，两段的行首才对得齐 */
.edit-type { width: 118px; flex-shrink: 0; font-size: 13px; font-weight: 600; color: var(--ink); }

/* 查看者：一个勾选框一行一个名字，名字多时自动折行 —— 机构员工有套餐上限（20 个），
   全摊开也放得下，不必收进下拉 */
.viewer-checks { display: flex; flex-wrap: wrap; gap: 8px 16px; }
.viewer-check { display: inline-flex; align-items: center; gap: 5px; font-size: 13px; color: var(--ink); }
.viewer-check em { font-style: normal; font-size: 11px; color: var(--sub); }

/* 参与老师名单（由题型要求推出，只读）：与题型行一样是「派活」语境，沿用虚线卡片 */
.assign-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 8px 12px;
  border: 1px dashed var(--border);
  border-radius: 10px;
  margin-bottom: 8px;
  background: #fbfdfd;
}
.assign-name { font-size: 13px; font-weight: 600; color: var(--ink); width: 64px; flex-shrink: 0; }

/* 知识点行：整行是按钮（点已选标签也是再打开树，重选 / 增删都在弹窗里做），
   chip 只读展示 —— 逐个删与树上取消勾选是同一件事，没必要两套 */
.kp-open {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  width: 100%; min-height: var(--ctrl-h, 36px);
  border: 1.5px solid var(--border); border-radius: 9px;
  background: #fff; padding: 6px 10px; text-align: left;
}
.kp-open:hover { border-color: var(--brand); }
.kp-open-empty { font-size: 12.5px; color: var(--sub); flex: 1; }
.kp-open-arrow { margin-left: auto; color: var(--sub); flex-shrink: 0; }
.kp-tag {
  display: inline-flex; align-items: center;
  border: 1px solid var(--brand); border-radius: 999px;
  background: var(--brand-soft); color: var(--brand-deep);
  font-size: 12px; font-weight: 600; padding: 2px 9px;
}

.prog-head { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
/* 横向居中的行里，f-hint 自带的 5px 上边距会把文字顶歪 */
.prog-head .f-hint,
.prog-top .f-hint,
.assign-row .f-hint { margin-top: 0; }
.prog-head .usage { flex: 1; }
.prog-row { border-bottom: 1px dashed var(--border); padding: 12px 0; }
.prog-top { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--ink); }
.online-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--success); }
.ver-row { border-left: 2px solid var(--border); padding: 0 0 12px 12px; }
.ver-head { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--ink-2); }
.ver-head b { color: var(--ink); }
.ver-head em { margin-left: auto; font-style: normal; font-size: 11px; color: var(--sub); }
</style>
