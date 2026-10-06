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
 * 本页只做「建任务 / 看进度 / 进组卷」，具体组卷在 `CollabTaskView.vue`。
 *
 * **状态的颜色语言**（本页与任务页共用，改一处必须改另一处）：蓝=球在别人手里（处理人还在
 * 组卷、试卷已交给审核中心）；橙=球在组长手里（待验收、待送审）；绿=走完了；红=被退回。
 * 所以「收题中 / 已送审」同为蓝、「待验收 / 待送审」同为橙不是配色偷懒，是在说同一件事：该谁动。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AppFilterPanel, AppIcon, AppListToolbar, AppPageHeader, appConfirm, COLLAB_MEMBER_TEXT, COLLAB_STATUS_TEXT, showToast, AppModal, AppDrawer } from '@aiteach/shared'
import PaperFolderSelect from '@/components/paper/PaperFolderSelect.vue'
import type { CollabMember, FilterRowDef, OrgCollabTask, OrgPaper, OrgQuestion, StaffMember } from '@aiteach/shared'
import AppPagination from '@/components/ui/AppPagination.vue'
import { deleteCollabTask, fetchCollabTasks, fetchPapers, fetchQuestions, fetchStaff, saveCollabTask } from '@/api/org'
import { useBaseData } from '@/composables/useBaseData'
import { usePermission } from '@/composables/usePermission'
import { useAuthStore } from '@/stores/auth'
import { paperEditHref } from '@/utils/paper-edit'
import { COLLAB_MEMBER_CLASS, COLLAB_STATUS_CLASS } from './collab-status'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const { subjects, grades, questionTypesFor, difficulties, examTypes, ensure, pick, withCurrent } = useBaseData()
const { can } = usePermission()

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

const form = reactive({
  name: '',
  subject: '数学',
  grade: '高一',
  duration: 120,
  structure: [] as Array<{ type: string; count: number; score: number }>,
  difficulty: [] as Array<{ level: string; ratio: number }>,
  knowledgeText: '',
  remark: '',
  /* 新建任务的试卷存「我的文件」所选文件夹（编辑任务时不出现） */
  folderId: null as number | null,
  /* 分工：姓名 → 负责题型 */
  assignment: {} as Record<string, string[]>,
  picked: [] as string[],
})

/** 可选处理人：机构员工（真实场景来自组织架构，演示取员工表） */
const candidates = computed(() => staff.value.map((row) => row.name))

/** 卷面来源试卷 id：从「试卷编辑 → 协同组卷」带 `?paperId=` 进来时记下，创建时复制其卷面 */
const sourcePaperId = ref(0)
const sourcePaperName = computed(() => papers.value.find((row) => row.id === sourcePaperId.value)?.name ?? '')

const difficultyRatioSum = computed(() => form.difficulty.reduce((sum, row) => sum + (Number(row.ratio) || 0), 0))

const unassignedTypes = computed(() =>
  form.structure.filter((row) => !form.picked.some((name) => (form.assignment[name] ?? []).includes(row.type))),
)

/**
 * 结构行的题型候选项：通用题型 + 当前学科专属题型（英语的完形填空 / 七选五 / 短文改错）。
 * 仍并入行内现值，保证下拉永远有选中项，不会渲染成空白。
 */
function structureTypes(current: string): string[] {
  return withCurrent(questionTypesFor(form.subject), current)
}

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
  form.duration = 120
  form.structure = [
    { type: '单选', count: 8, score: 5 },
    { type: '填空', count: 4, score: 5 },
    { type: '解答', count: 3, score: 12 },
  ]
  form.difficulty = [
    { level: '容易', ratio: 30 },
    { level: '中等', ratio: 50 },
    { level: '困难', ratio: 20 },
  ]
  form.knowledgeText = ''
  form.remark = ''
  form.folderId = null
  form.assignment = {}
  form.picked = []
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
      return { type: hit[1], count: Math.max(section.questions.length, 1), score }
    })
    .filter((row): row is { type: string; count: number; score: number } => row !== null)
  if (derived.length) form.structure = derived
}

async function openCreate(paperId?: number) {
  resetForm()
  dialogOpen.value = true
  await ensure()
  if (paperId) void prefillFromPaper(paperId)
}

function openEdit(task: OrgCollabTask) {
  resetForm()
  editingId.value = task.id
  form.name = task.name
  form.subject = task.requirement.subject
  form.grade = task.requirement.grade
  form.duration = task.requirement.duration
  form.structure = task.requirement.structure.map((row) => ({ ...row }))
  form.difficulty = task.requirement.difficulty.map((row) => ({ ...row }))
  form.knowledgeText = task.requirement.knowledge.join('、')
  form.remark = task.requirement.remark
  form.assignment = {}
  form.picked = task.members.map((row) => row.name)
  task.members.forEach((row) => (form.assignment[row.name] = [...row.questionTypes]))
  dialogOpen.value = true
}

/** 题型分配：点选式（一个成员可负责多个题型，但一个题型只能归一个人） */
function toggleType(name: string, type: string) {
  const owner = form.picked.find((row) => row !== name && (form.assignment[row] ?? []).includes(type))
  if (owner) {
    showToast(`「${type}」已分配给 ${owner}，请先从对方名下移除`, 'error')
    return
  }
  const list = form.assignment[name] ?? []
  form.assignment[name] = list.includes(type) ? list.filter((row) => row !== type) : [...list, type]
}

function toggleMember(name: string) {
  if (form.picked.includes(name)) {
    form.picked = form.picked.filter((row) => row !== name)
    delete form.assignment[name]
  } else {
    form.picked = [...form.picked, name]
    form.assignment[name] = []
  }
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
  if (!form.structure.length) {
    showToast('请至少设置 1 个题型', 'error')
    return
  }
  if (form.structure.some((row) => row.count < 1 || row.score <= 0)) {
    showToast('每个题型的题数 ≥ 1、单题分值 > 0', 'error')
    return
  }
  if (form.picked.length === 0) {
    showToast('请至少邀请 1 位任务处理人', 'error')
    return
  }
  if (unassignedTypes.value.length) {
    showToast(`题型「${unassignedTypes.value.map((row) => row.type).join('、')}」还没分配处理人`, 'error')
    return
  }
  saving.value = true
  try {
    const members: Array<Pick<CollabMember, 'name' | 'questionTypes' | 'perms'>> = form.picked.map((name) => ({
      name,
      questionTypes: form.assignment[name] ?? [],
      perms: ['选题', '改分值'],
    }))
    const { task } = await saveCollabTask({
      id: editingId.value ?? undefined,
      name: form.name.trim(),
      requirement: {
        subject: form.subject,
        grade: form.grade,
        duration: form.duration,
        structure: form.structure.map((row) => ({ ...row })),
        difficulty: form.difficulty.map((row) => ({ ...row })),
        knowledge: form.knowledgeText
          .split(/[、,，\s]+/)
          .map((row) => row.trim())
          .filter(Boolean),
        remark: form.remark,
      },
      members,
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
    if (!editingId.value) router.push(`/paper/collab/task?id=${task.id}`)
  } catch (error) {
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
        <!-- 发起协同组卷是组长专属动作：老师也能组卷，但组卷工作台自己有菜单入口，
             在本页再挂一个「题库组卷」只会让人分不清「我现在在哪张卷子里」 -->
        <button v-if="can('paper', '发起协同组卷')" class="btn btn-primary" @click="openCreate()">
          <AppIcon name="plus" :size="15" /> 新建协同组卷任务
        </button>
      </template>
    </AppPageHeader>

    <!-- 状态维度只有这一处入口（原先的统计卡已并入页签）：点页签 = 按该状态过滤，角标 = 条数 -->
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

    <AppFilterPanel :rows="filterRowDefs" :model-value="filters" @update:model-value="onFiltersChange" />

    <div class="panel">
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
                    <button class="mini-btn" @click="router.push(`/paper/collab/task?id=${row.id}`)">进入组卷</button>
                    <button class="mini-btn" @click="detail = row">进度</button>
                    <!-- 「要求 / 删除」只给发起人：改要求会重建成员分工（连带清掉验收痕迹），
                         删任务更是把别人的活一起删了，两者都不该让处理人点到。
                         「要求」还要卡在收题中 —— 任务一进验收流程，mock 侧也会拒绝（见 saveCollabTask）。 -->
                    <button v-if="isOwner(row) && row.status === 'collecting'" class="mini-btn" @click="openEdit(row)">要求</button>
                    <!-- 新标签页打开：改完卷面还要回这张列表接着处理下一份（见 utils/paper-edit.ts） -->
                    <a class="mini-btn" :href="paperEditHref(row.paperId)" target="_blank" rel="noopener">编辑卷面</a>
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
      <div class="f-field">
        <label class="f-label">试卷名称<span class="req">*</span></label>
        <input v-model="form.name" class="f-input" maxlength="50" placeholder="例如：高一数学第三次月考卷" />
        <p v-if="sourcePaperName" class="f-hint" style="margin-top: 5px">
          卷面来源：复制《{{ sourcePaperName }}》的现有卷面作为起点，处理人在此基础上补齐各自题型。
        </p>
      </div>

      <div class="f-field row3">
        <div>
          <label class="f-label">学科</label>
          <select v-model="form.subject" class="f-select">
            <option v-for="s in subjects" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
        <div>
          <label class="f-label">年级</label>
          <select v-model="form.grade" class="f-select">
            <option v-for="g in grades" :key="g" :value="g">{{ g }}</option>
          </select>
        </div>
        <div>
          <label class="f-label">考试时长（分钟）</label>
          <input v-model.number="form.duration" type="number" min="10" max="300" step="10" class="f-input" />
        </div>
      </div>

      <!-- 存储位置只在新建时出现：协同产出的试卷也是个人试卷，同样存「我的文件」 -->
      <div v-if="!editingId" class="f-field">
        <label class="f-label">存储位置（我的文件）<span class="req">*</span></label>
        <PaperFolderSelect v-model="form.folderId" />
        <p class="f-hint" style="margin-top: 5px">任务试卷将保存到该文件夹，组卷完成后可随时打开继续编辑。</p>
      </div>

      <div class="f-field">
        <label class="f-label">题型要求<span class="req">*</span>（题数 / 单题分值，处理人只能按此结构收题）</label>
        <div v-for="(row, i) in form.structure" :key="i" class="struct-row">
          <select v-model="row.type" class="f-select" style="width: 128px">
            <option v-for="t in structureTypes(row.type)" :key="t" :value="t">{{ t }}</option>
          </select>
          <input v-model.number="row.count" type="number" min="1" class="f-input" style="width: 80px" />
          <span class="f-hint">题 ×</span>
          <input v-model.number="row.score" type="number" min="0.5" step="0.5" class="f-input" style="width: 80px" />
          <span class="f-hint">分/题</span>
          <span class="f-hint" style="margin-left: auto">小计 {{ (row.count || 0) * (row.score || 0) }} 分</span>
          <button class="mini-btn danger" type="button" :disabled="form.structure.length <= 1" @click="form.structure.splice(i, 1)">删除</button>
        </div>
        <button class="btn btn-ghost btn-sm" type="button" :disabled="form.structure.length >= 8" @click="form.structure.push({ type: '单选', count: 4, score: 5 })">
          <AppIcon name="plus" :size="14" /> 添加题型
        </button>
        <p class="f-hint">
          预计总分 {{ form.structure.reduce((s, r) => s + (r.count || 0) * (r.score || 0), 0) }} 分 · 共
          {{ form.structure.reduce((s, r) => s + (r.count || 0), 0) }} 题
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
          当前合计 {{ difficultyRatioSum }}%<template v-if="difficultyRatioSum !== 100">（不等于 100%，仍可保存，仅作处理人参考）</template>
        </p>
      </div>

      <div class="f-field">
        <label class="f-label">考察知识点要求</label>
        <input v-model="form.knowledgeText" class="f-input" placeholder="用顿号分隔，如：函数与导数、二次函数、集合" />
      </div>

      <div class="f-field">
        <label class="f-label">命题说明</label>
        <textarea v-model="form.remark" class="f-textarea" rows="3" placeholder="命题范围、风格要求、注意事项等，处理人与 AI 抽题都会读到" />
      </div>

      <div class="f-field">
        <label class="f-label">任务处理人与题型分工<span class="req">*</span></label>
        <div class="member-grid">
          <button
            v-for="name in candidates"
            :key="name"
            class="member-chip"
            :class="{ on: form.picked.includes(name) }"
            type="button"
            @click="toggleMember(name)"
          >
            <AppIcon :name="form.picked.includes(name) ? 'check' : 'users'" :size="13" />
            {{ name }}
          </button>
        </div>
        <p v-if="!candidates.length" class="f-hint">机构暂无可用员工</p>

        <div v-for="name in form.picked" :key="name" class="assign-row">
          <span class="assign-name">{{ name }}</span>
          <div class="chips">
            <button
              v-for="row in form.structure"
              :key="row.type"
              class="assign-chip"
              :class="{ on: (form.assignment[name] ?? []).includes(row.type) }"
              type="button"
              @click="toggleType(name, row.type)"
            >
              {{ row.type }} · {{ row.count }} 题
            </button>
          </div>
          <span class="f-hint">共 {{ (form.assignment[name] ?? []).reduce((s, t) => s + (form.structure.find((r) => r.type === t)?.count ?? 0), 0) }} 题</span>
        </div>

        <p v-if="unassignedTypes.length" class="f-hint is-warn">
          尚未分配处理人的题型：{{ unassignedTypes.map((row) => row.type).join('、') }}（每个题型必须有且只有一位负责人）
        </p>
      </div>

      <template #footer>
        <button class="btn btn-ghost" @click="dialogOpen = false">取消</button>
        <button class="btn btn-primary" :disabled="saving" @click="submit">
          {{ saving ? '保存中…' : editingId ? '保存修改' : '创建任务并邀请' }}
        </button>
      </template>
    </AppModal>

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
/* 页签栏用下划线式，与下面卡片式的搜索面板分开 —— 页签是「换个角度看同一批任务」，
   搜索面板是「收窄这批任务」，两者的分量本来就不该长得一样 */
.tab-bar {
  display: flex; align-items: center; gap: 2px;
  border-bottom: 1.5px solid var(--border);
  margin-bottom: 14px;
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

.row3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.struct-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
/* 横向居中的行里，f-hint 自带的 5px 上边距会把文字顶歪 */
.struct-row .f-hint { margin-top: 0; }
.is-warn { color: var(--warn); }

.member-grid { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 12px; }
.member-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1.5px solid var(--border);
  border-radius: 999px;
  background: #fff;
  color: var(--ink-2);
  font-size: 12.5px;
  padding: 5px 13px;
}
.member-chip.on { border-color: var(--brand); background: var(--brand-soft); color: var(--brand-deep); font-weight: 600; }

.assign-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 10px 12px;
  border: 1px dashed var(--border);
  border-radius: 10px;
  margin-bottom: 8px;
  background: #fbfdfd;
}
.assign-name { font-size: 13px; font-weight: 600; color: var(--ink); width: 64px; flex-shrink: 0; }
.chips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; flex: 1; min-width: 0; }
/* 题型分工不是筛选条件，而是「谁负责哪个题型 · 几道题」的派活板：选项文案带题数、
   同一题型跨成员互斥（见 toggleType）。共享的 AppFilterChips 只有「单值 option + 实心选中」
   一种造型，套过来会丢掉题数并换掉这块的视觉语言，故保留 pill（与 .member-chip 同族）。
   共享组件里没有 pill 变体，且 packages/shared 不在本次改动范围内，故样式就地保留。 */
.assign-chip {
  border: 1.5px solid var(--border);
  border-radius: 999px;
  background: #fff;
  color: var(--ink-2);
  font-size: 12px;
  padding: 4px 11px;
  white-space: nowrap;
  flex-shrink: 0;
}
.assign-chip:hover { border-color: var(--brand); color: var(--brand-deep); }
.assign-chip.on { border-color: var(--brand); background: var(--brand-soft); color: var(--brand-deep); font-weight: 600; }

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
