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
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AppIcon, COLLAB_MEMBER_TEXT, COLLAB_STATUS_TEXT, showToast } from '@aiteach/shared'
import type { CollabMember, OrgCollabTask, OrgPaper, OrgQuestion, StaffMember } from '@aiteach/shared'
import AppModal from '@/components/ui/AppModal.vue'
import AppDrawer from '@/components/ui/AppDrawer.vue'
import AppPagination from '@/components/ui/AppPagination.vue'
import { deleteCollabTask, fetchCollabTasks, fetchPapers, fetchQuestions, fetchStaff, saveCollabTask } from '@/api/org'
import { useBaseData } from '@/composables/useBaseData'

const route = useRoute()
const router = useRouter()
const { subjects, grades, questionTypes, difficulties, ensure, pick } = useBaseData()

const tasks = ref<OrgCollabTask[]>([])
const papers = ref<OrgPaper[]>([])
const questions = ref<OrgQuestion[]>([])
const staff = ref<StaffMember[]>([])
const loading = ref(true)

const filter = reactive({ status: '', keyword: '' })
const page = ref(1)
const filtered = computed(() =>
  tasks.value.filter(
    (row) =>
      (!filter.status || row.status === filter.status) &&
      (!filter.keyword || row.name.includes(filter.keyword)),
  ),
)
const rows = computed(() => filtered.value.slice((page.value - 1) * 8, page.value * 8))

const STATUS_CLASS: Record<string, string> = {
  collecting: 'tag-blue',
  reviewing: 'tag-orange',
  done: 'tag-green',
}

/* ===== 任务统计：按分工算完成度，而不是让用户自己去数题 ===== */

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

const stats = computed(() => ({
  total: tasks.value.length,
  collecting: tasks.value.filter((row) => row.status === 'collecting').length,
  reviewing: tasks.value.filter((row) => row.status === 'reviewing').length,
  mine: tasks.value.filter((row) => row.members.some((m) => m.name === '陈明远' && m.status !== 'submitted')).length,
}))

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

function resetForm() {
  editingId.value = null
  sourcePaperId.value = 0
  form.name = ''
  form.subject = pick(subjects.value, '数学')
  form.grade = pick(grades.value, '高一')
  form.duration = 120
  form.structure = [
    { type: '单选题', count: 8, score: 5 },
    { type: '填空题', count: 4, score: 5 },
    { type: '解答题', count: 3, score: 12 },
  ]
  form.difficulty = [
    { level: '容易', ratio: 30 },
    { level: '中等', ratio: 50 },
    { level: '困难', ratio: 20 },
  ]
  form.knowledgeText = ''
  form.remark = ''
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
  /* 按试卷现有大题反推题型结构：大题名里带「单选/填空/解答」等关键词即可识别 */
  const KEYWORDS: Array<[string, string]> = [
    ['单选', '单选题'],
    ['多选', '多选题'],
    ['判断', '判断题'],
    ['填空', '填空题'],
    ['解答', '解答题'],
    ['问答', '解答题'],
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
    })
    dialogOpen.value = false
    await load()
    showToast(
      editingId.value
        ? '任务已更新'
        : sourcePaperId.value
          ? '协同组卷任务已创建，已复制原卷面作为起点'
          : '协同组卷任务已创建，已向处理人发送通知',
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
  if (!window.confirm(`删除协同组卷任务《${task.name}》？将进入回收站保留 30 天`)) return
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
    <div class="page-head">
      <div>
        <h2 style="font-size: 18px; font-weight: 700">协同组卷</h2>
        <p class="f-hint" style="margin-top: 4px">
          一张试卷按题型拆给多位老师分头组卷，发起人定卷面要求，处理人只能选自己负责的题型，但可以看到整张试卷。
        </p>
      </div>
      <div class="op-group">
        <button class="btn btn-ghost" @click="router.push('/paper/compose')">
          <AppIcon name="grid" :size="15" /> 题库组卷
        </button>
        <button class="btn btn-primary" @click="openCreate()">
          <AppIcon name="plus" :size="15" /> 新建协同组卷任务
        </button>
      </div>
    </div>

    <div class="stat-row">
      <div class="stat-card panel">
        <span class="stat-label">任务总数</span>
        <b>{{ stats.total }}</b>
        <em>含已完成</em>
      </div>
      <div class="stat-card panel">
        <span class="stat-label">收题中</span>
        <b>{{ stats.collecting }}</b>
        <em>处理人仍在组卷</em>
      </div>
      <div class="stat-card panel">
        <span class="stat-label">待审校</span>
        <b>{{ stats.reviewing }}</b>
        <em>各题型均已提交</em>
      </div>
      <div class="stat-card panel">
        <span class="stat-label">待我处理</span>
        <b>{{ stats.mine }}</b>
        <em>我负责的题型尚未提交</em>
      </div>
    </div>

    <div class="panel">
      <div class="filter-bar">
        <span class="filter-label">状态</span>
        <select v-model="filter.status" class="f-select" style="width: 140px">
          <option value="">全部</option>
          <option v-for="(text, key) in COLLAB_STATUS_TEXT" :key="key" :value="key">{{ text }}</option>
        </select>
        <span class="filter-label">关键词</span>
        <input v-model="filter.keyword" class="f-input" placeholder="试卷名称" style="width: 200px" />
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
              <td colspan="8" class="empty-row">暂无协同组卷任务</td>
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
                    <span v-for="member in row.members" :key="member.name" class="tag" :class="member.status === 'submitted' ? 'tag-green' : member.status === 'working' ? 'tag-blue' : 'tag-gray'">
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
                    <button class="mini-btn" @click="openEdit(row)">要求</button>
                    <button class="mini-btn" @click="router.push(`/paper/edit?id=${row.paperId}`)">编辑卷面</button>
                    <button class="mini-btn danger" @click="onDelete(row)">删除</button>
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

      <div class="f-field">
        <label class="f-label">题型要求<span class="req">*</span>（题数 / 单题分值，处理人只能按此结构收题）</label>
        <div v-for="(row, i) in form.structure" :key="i" class="struct-row">
          <select v-model="row.type" class="f-select" style="width: 128px">
            <option v-for="t in questionTypes" :key="t" :value="t">{{ t }}</option>
          </select>
          <input v-model.number="row.count" type="number" min="1" class="f-input" style="width: 80px" />
          <span class="f-hint">题 ×</span>
          <input v-model.number="row.score" type="number" min="0.5" step="0.5" class="f-input" style="width: 80px" />
          <span class="f-hint">分/题</span>
          <span class="f-hint" style="margin-left: auto">小计 {{ (row.count || 0) * (row.score || 0) }} 分</span>
          <button class="mini-btn danger" type="button" :disabled="form.structure.length <= 1" @click="form.structure.splice(i, 1)">删除</button>
        </div>
        <button class="btn btn-ghost btn-sm" type="button" :disabled="form.structure.length >= 8" @click="form.structure.push({ type: '单选题', count: 4, score: 5 })">
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
              class="k-chip"
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
          <span class="tag" :class="member.status === 'submitted' ? 'tag-green' : member.status === 'working' ? 'tag-blue' : 'tag-gray'">
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
.stat-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 16px; }
.stat-card { padding: 14px 16px; display: flex; flex-direction: column; gap: 4px; }
.stat-label { font-size: 12.5px; color: var(--sub); }
.stat-card b { font-size: 24px; color: var(--brand-deep); line-height: 1.2; }
.stat-card em { font-size: 11.5px; color: var(--sub); font-style: normal; }

.assign-cell { display: flex; flex-wrap: wrap; gap: 4px; max-width: 260px; }
.prog { min-width: 120px; }

.row3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.struct-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.is-warn { color: var(--warn); }

.member-grid { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
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
.chips { display: flex; flex-wrap: wrap; gap: 6px; flex: 1; min-width: 0; }
.k-chip {
  border: 1.5px solid var(--border);
  border-radius: 999px;
  background: #fff;
  color: var(--ink-2);
  font-size: 12px;
  padding: 4px 11px;
}
.k-chip.on { border-color: var(--brand); background: var(--brand-soft); color: var(--brand-deep); font-weight: 600; }

.prog-head { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.prog-head .usage { flex: 1; }
.prog-row { border-bottom: 1px dashed var(--border); padding: 12px 0; }
.prog-top { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--ink); }
.online-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--success); }
.ver-row { border-left: 2px solid var(--border); padding: 0 0 12px 12px; }
.ver-head { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--ink-2); }
.ver-head b { color: var(--ink); }
.ver-head em { margin-left: auto; font-style: normal; font-size: 11px; color: var(--sub); }
</style>
