<script setup lang="ts">
/**
 * 教案（教学设计）— 列表 + 编辑器。
 *
 * 教案与讲义的本质区别：讲义写「讲什么」，教案写「怎么教、为什么这么教」。
 * 所以教案的结构不是段落流，而是**教学设计的固定骨架**：三维目标 → 重难点 →
 * 方法与教具 → 教学过程（按环节，每环节要写清教师活动 / 学生活动 / 设计意图 / 时间分配）
 * → 板书设计 → 教学反思。左栏大纲按这个骨架导航，中栏编辑选中项，右栏取题库题目挂到环节上。
 *
 * 与讲义一样，列表与编辑合在一个路由（`?id=` 切换）：教师的心智是「打开这份教案」，
 * 而不是「先到教案编辑页再选一份」。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AppFilterChips, AppFilterPanel, AppIcon, AppListToolbar, AppPageHeader, PLAN_STEP_TEXT, RichTextViewer, TEACH_DOC_STATUS_TEXT, appConfirm, showToast, truncateRich, AppModal } from '@aiteach/shared'
import type { FilterRowDef, OrgQuestion, PlanStep, PlanStepKind, TeachDoc } from '@aiteach/shared'
import AppPagination from '@/components/ui/AppPagination.vue'
import RichTextEditor from '@/components/ui/RichTextEditor.vue'
import {
  deleteTeachDoc,
  duplicateTeachDoc,
  fetchQuestions,
  fetchTeachDocs,
  saveTeachDoc,
  toggleTeachDocPublish,
} from '@/api/org'
import { useBaseData } from '@/composables/useBaseData'
import { PLAN_TEMPLATES, makePlan } from './teach-templates'

const route = useRoute()
const router = useRouter()
const { subjects, grades, difficulties, ensure, pick, withCurrent } = useBaseData()

const docs = ref<TeachDoc[]>([])
const questions = ref<OrgQuestion[]>([])
const loading = ref(true)
const saving = ref(false)

const editingId = computed(() => Number(route.query.id ?? 0))
const doc = ref<TeachDoc | null>(null)

/* ================= 列表 ================= */

const FILTER_ROWS = computed<FilterRowDef[]>(() => [
  { key: 'subject', label: '学科', options: subjects.value, multiple: false },
  { key: 'grade', label: '年级', options: grades.value, multiple: false },
  { key: 'status', label: '状态', options: Object.values(TEACH_DOC_STATUS_TEXT), multiple: false },
])
const filters = reactive<Record<string, string[]>>({ subject: [], grade: [], status: [] })

/* AppFilterPanel 回传整份筛选值（覆盖式回写），逐 key 写回这份 reactive 对象本身。
   不能交给 `v-model`：它会替换掉整个对象，而替换引用不是一次响应式写入 —— 点了 chip
   页面不会有任何反应（连选中态都不亮），详见 CollabView 里同款函数的说明。 */
function onFiltersChange(next: Record<string, string[]>) {
  filters.subject = next.subject ?? []
  filters.grade = next.grade ?? []
  filters.status = next.status ?? []
}

const keyword = ref('')
const page = ref(1)
const filtered = computed(() =>
  docs.value.filter(
    (row) =>
      (filters.subject.length === 0 || filters.subject.includes(row.subject)) &&
      (filters.grade.length === 0 || filters.grade.includes(row.grade)) &&
      (filters.status.length === 0 || filters.status.includes(TEACH_DOC_STATUS_TEXT[row.status])) &&
      (!keyword.value || row.name.includes(keyword.value) || row.knowledge.some((k) => k.includes(keyword.value))),
  ),
)
const rows = computed(() => filtered.value.slice((page.value - 1) * 9, page.value * 9))

/* ================= 新建 ================= */

const createOpen = ref(false)
const createForm = reactive({
  name: '',
  subject: '数学',
  grade: '高一',
  textbook: '',
  knowledgeText: '',
  template: 'new',
})

function openCreate() {
  createForm.name = ''
  createForm.subject = pick(subjects.value, '数学')
  createForm.grade = pick(grades.value, '高一')
  createForm.textbook = ''
  createForm.knowledgeText = ''
  createForm.template = 'new'
  createOpen.value = true
}

async function submitCreate() {
  if (createForm.name.trim().length < 2) {
    showToast('教案名称须为 2-50 字', 'error')
    return
  }
  const template = PLAN_TEMPLATES.find((row) => row.key === createForm.template) ?? PLAN_TEMPLATES[0]
  saving.value = true
  try {
    const created = await saveTeachDoc({
      kind: 'plan',
      name: createForm.name.trim(),
      subject: createForm.subject,
      grade: createForm.grade,
      textbook: createForm.textbook,
      knowledge: createForm.knowledgeText.split(/[、,，\s]+/).map((row) => row.trim()).filter(Boolean),
      blocks: [],
      slides: [],
      plan: makePlan(template),
      status: 'draft',
    })
    createOpen.value = false
    await loadList()
    showToast('教案已创建，可开始撰写', 'success')
    router.push(`/teach/plan?id=${created.id}`)
  } catch (error) {
    showToast(error instanceof Error ? error.message : '创建失败', 'error')
  } finally {
    saving.value = false
  }
}

/* ================= 编辑器：选中项 ================= */

/** 大纲选中项：固定骨架项用 key，教学环节用 step:<id> */
const activeKey = ref('objectives')
const activeStepId = computed(() => (activeKey.value.startsWith('step:') ? Number(activeKey.value.slice(5)) : 0))
const activeStep = computed<PlanStep | null>(
  () => doc.value?.plan?.steps.find((row) => row.id === activeStepId.value) ?? null,
)

async function openDoc(id: number) {
  const found = docs.value.find((row) => row.id === id)
  if (!found) {
    showToast('教案不存在或已删除', 'error')
    router.replace('/teach/plan')
    return
  }
  /* 深拷贝进编辑态：直接改列表里的对象会让「取消」无从实现，也污染列表展示 */
  doc.value = JSON.parse(JSON.stringify(found)) as TeachDoc
  activeKey.value = 'objectives'
}

watch(editingId, (id) => {
  if (id) void openDoc(id)
})

function backToList() {
  doc.value = null
  router.push('/teach/plan')
}

/* ================= 教学环节 ================= */

function addStep(kind: PlanStepKind) {
  const plan = doc.value?.plan
  if (!plan) return
  const step: PlanStep = {
    id: Date.now(),
    kind,
    title: PLAN_STEP_TEXT[kind],
    teacher: '',
    student: '',
    intent: '',
    minutes: 5,
    questionIds: [],
  }
  plan.steps.push(step)
  activeKey.value = `step:${step.id}`
}

function removeStep(id: number) {
  const plan = doc.value?.plan
  if (!plan) return
  const index = plan.steps.findIndex((row) => row.id === id)
  if (index < 0) return
  plan.steps.splice(index, 1)
  activeKey.value = 'objectives'
}

function moveStep(id: number, delta: number) {
  const plan = doc.value?.plan
  if (!plan) return
  const index = plan.steps.findIndex((row) => row.id === id)
  const target = index + delta
  if (index < 0 || target < 0 || target >= plan.steps.length) return
  const [row] = plan.steps.splice(index, 1)
  plan.steps.splice(target, 0, row)
}

/** 环节时间合计：超过一节课 45 分钟时给出提示，老师好据此调整 */
const totalMinutes = computed(() => doc.value?.plan?.steps.reduce((sum, row) => sum + row.minutes, 0) ?? 0)
const overTime = computed(() => {
  const periods = doc.value?.plan?.periods ?? 1
  return totalMinutes.value > periods * 45
})

/* ================= 方法与教具 ================= */

const METHOD_POOL = ['讲授法', '探究式学习', '合作交流', '讲练结合', '归纳法', '演示实验', '错因分析', '分层教学']
const AID_POOL = ['多媒体课件', '几何画板', '实物教具', '实验器材', '导学案', '微课视频']

function setMethods(next: string[]) {
  if (doc.value?.plan) doc.value.plan.methods = next
}

function setAids(next: string[]) {
  if (doc.value?.plan) doc.value.plan.aids = next
}

const customMethod = ref('')
const customAid = ref('')

function addCustom(list: string[], value: string, reset: () => void) {
  const text = value.trim()
  if (!text) return
  if (!list.includes(text)) list.push(text)
  reset()
}

/* ================= 关联题目 ================= */

const bankFilter = reactive({ type: '', difficulty: '', keyword: '' })
const bankPool = computed(() =>
  questions.value.filter(
    (row) =>
      row.status === 'approved' &&
      (!bankFilter.type || row.type === bankFilter.type) &&
      (!bankFilter.difficulty || row.difficulty === bankFilter.difficulty) &&
      (!bankFilter.keyword || row.stem.includes(bankFilter.keyword)),
  ),
)

function linkQuestion(questionId: number) {
  const step = activeStep.value
  if (!step) {
    showToast('请先选中一个教学环节，再关联题目', 'error')
    return
  }
  if (step.questionIds.includes(questionId)) {
    showToast('该题已在当前环节中', 'error')
    return
  }
  step.questionIds.push(questionId)
}

function unlinkQuestion(questionId: number) {
  const step = activeStep.value
  if (!step) return
  step.questionIds = step.questionIds.filter((row) => row !== questionId)
}

const itemOf = (id: number) => questions.value.find((row) => row.id === id)
/** 教案用到的题目总数（列表卡片上展示） */
function questionCountOf(row: TeachDoc): number {
  return row.plan?.steps.reduce((sum, step) => sum + step.questionIds.length, 0) ?? 0
}

/* ================= 保存 / 发布 / 预览 / 打印 ================= */

async function save() {
  if (!doc.value) return
  if (doc.value.name.trim().length < 2) {
    showToast('教案名称须为 2-50 字', 'error')
    return
  }
  saving.value = true
  try {
    const saved = await saveTeachDoc({
      id: doc.value.id,
      kind: 'plan',
      name: doc.value.name.trim(),
      subject: doc.value.subject,
      grade: doc.value.grade,
      textbook: doc.value.textbook,
      knowledge: doc.value.knowledge,
      blocks: doc.value.blocks,
      slides: [],
      plan: doc.value.plan,
      status: doc.value.status,
    })
    doc.value.id = saved.id
    await loadList()
    showToast('教案已保存', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '保存失败', 'error')
  } finally {
    saving.value = false
  }
}

async function publish() {
  if (!doc.value) return
  if (!doc.value.id) {
    await save()
    if (!doc.value.id) return
  }
  try {
    const next = await toggleTeachDocPublish(doc.value.id)
    doc.value.status = next.status
    await loadList()
    showToast(next.status === 'published' ? '已发布，校内教师可直接取用' : '已下架', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '操作失败', 'error')
  }
}

const previewOpen = ref(false)
function onPrint() {
  window.print()
}

/* ================= 列表行操作 ================= */

async function onDuplicate(row: TeachDoc) {
  await duplicateTeachDoc(row.id)
  await loadList()
  showToast('已复制一份副本（草稿）', 'success')
}

async function onDelete(row: TeachDoc) {
  if (!(await appConfirm(`删除《${row.name}》？将进入回收站保留 30 天`, { type: 'danger' }))) return
  await deleteTeachDoc(row.id)
  await loadList()
  showToast('已移入回收站', 'success')
}

async function loadList() {
  docs.value = await fetchTeachDocs('plan')
}

onMounted(async () => {
  loading.value = true
  try {
    await Promise.all([ensure(), loadList(), fetchQuestions().then((rows) => (questions.value = rows))])
    if (editingId.value) await openDoc(editingId.value)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <!-- ================= 编辑器 ================= -->
  <div v-if="doc" class="pl-shell">
    <div class="te-head panel">
      <button class="te-back" type="button" @click="backToList"><AppIcon name="chevron-left" :size="15" /></button>
      <div class="te-head-main">
        <input v-model="doc.name" class="te-title" maxlength="50" placeholder="教案名称" />
        <div class="te-head-meta">
          <select v-model="doc.subject" class="f-select">
            <option v-for="s in withCurrent(subjects, doc.subject)" :key="s" :value="s">{{ s }}</option>
          </select>
          <select v-model="doc.grade" class="f-select">
            <option v-for="g in withCurrent(grades, doc.grade)" :key="g" :value="g">{{ g }}</option>
          </select>
          <span class="pl-period">
            课时
            <input v-model.number="doc.plan!.periods" class="pl-period-input" type="number" min="1" max="6" />
          </span>
          <span class="tag" :class="doc.status === 'published' ? 'tag-green' : 'tag-gray'">
            {{ TEACH_DOC_STATUS_TEXT[doc.status] }}
          </span>
          <span class="f-hint" :class="{ 'pl-warn': overTime }">
            {{ doc.plan?.steps.length ?? 0 }} 个环节 · 合计 {{ totalMinutes }} 分钟<template v-if="overTime">
              （超出 {{ (doc.plan?.periods ?? 1) * 45 }} 分钟，建议压缩）</template
            >
          </span>
        </div>
      </div>
      <div class="op-group">
        <button class="btn btn-ghost btn-sm" @click="previewOpen = true"><AppIcon name="eye" :size="14" /> 预览</button>
        <button class="btn btn-ghost btn-sm" @click="onPrint"><AppIcon name="print" :size="14" /> 打印</button>
        <button class="btn btn-ghost btn-sm" @click="publish">
          <AppIcon name="upload" :size="14" /> {{ doc.status === 'published' ? '下架' : '发布' }}
        </button>
        <button class="btn btn-primary btn-sm" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存' }}</button>
      </div>
    </div>

    <div class="te-body">
      <!-- 左：教学设计大纲 -->
      <aside class="panel te-outline">
        <div class="section-title" style="margin-bottom: 10px">教学设计</div>

        <div class="te-ol-row" :class="{ on: activeKey === 'objectives' }" @click="activeKey = 'objectives'">
          <span class="te-ol-no">目</span>
          <div class="te-ol-main"><b>教学目标</b><em>三维目标</em></div>
        </div>
        <div class="te-ol-row" :class="{ on: activeKey === 'points' }" @click="activeKey = 'points'">
          <span class="te-ol-no">重</span>
          <div class="te-ol-main"><b>重点难点</b><em>教学重点 / 教学难点</em></div>
        </div>
        <div class="te-ol-row" :class="{ on: activeKey === 'method' }" @click="activeKey = 'method'">
          <span class="te-ol-no">法</span>
          <div class="te-ol-main"><b>方法与教具</b><em>{{ doc.plan?.methods.length ?? 0 }} 项</em></div>
        </div>

        <div class="pl-ol-title">教学过程</div>
        <div
          v-for="(step, i) in doc.plan?.steps ?? []"
          :key="step.id"
          class="te-ol-row"
          :class="{ on: activeKey === `step:${step.id}` }"
          @click="activeKey = `step:${step.id}`"
        >
          <span class="te-ol-no">{{ i + 1 }}</span>
          <div class="te-ol-main">
            <b>{{ step.title || PLAN_STEP_TEXT[step.kind] }}</b>
            <em>{{ PLAN_STEP_TEXT[step.kind] }} · {{ step.minutes }} 分钟<template v-if="step.questionIds.length">
                · {{ step.questionIds.length }} 题</template
              ></em
            >
          </div>
          <div class="te-ol-ops" @click.stop>
            <button class="te-icon" type="button" title="上移" @click="moveStep(step.id, -1)">↑</button>
            <button class="te-icon" type="button" title="下移" @click="moveStep(step.id, 1)">↓</button>
            <button class="te-icon danger" type="button" title="删除" @click="removeStep(step.id)">×</button>
          </div>
        </div>

        <div class="te-ol-row" :class="{ on: activeKey === 'blackboard' }" @click="activeKey = 'blackboard'">
          <span class="te-ol-no">板</span>
          <div class="te-ol-main"><b>板书设计</b><em>课堂板书布局</em></div>
        </div>
        <div class="te-ol-row" :class="{ on: activeKey === 'reflection' }" @click="activeKey = 'reflection'">
          <span class="te-ol-no">思</span>
          <div class="te-ol-main"><b>教学反思</b><em>课后填写</em></div>
        </div>

        <div class="te-add">
          <span class="f-hint">新增教学环节</span>
          <div class="chips">
            <button
              v-for="(text, kind) in PLAN_STEP_TEXT"
              :key="kind"
              class="k-chip"
              type="button"
              @click="addStep(kind as PlanStepKind)"
            >
              + {{ text }}
            </button>
          </div>
        </div>
      </aside>

      <!-- 中：编辑区 -->
      <main class="te-main">
        <!-- 三维目标 -->
        <div v-if="activeKey === 'objectives' && doc.plan" class="panel te-edit">
          <div class="te-edit-head"><span class="tag tag-blue">教学目标</span><b>三维教学目标</b></div>
          <div class="f-field">
            <label class="f-label">知识与技能</label>
            <textarea v-model="doc.plan.objectives.knowledge" class="f-textarea" rows="3" placeholder="学生能理解 / 掌握 / 运用什么" />
          </div>
          <div class="f-field">
            <label class="f-label">过程与方法</label>
            <textarea v-model="doc.plan.objectives.process" class="f-textarea" rows="3" placeholder="通过什么活动、经历什么过程获得" />
          </div>
          <div class="f-field" style="margin-bottom: 0">
            <label class="f-label">情感态度与价值观</label>
            <textarea v-model="doc.plan.objectives.emotion" class="f-textarea" rows="3" placeholder="体会什么思想、形成什么态度" />
          </div>
        </div>

        <!-- 重难点 -->
        <div v-else-if="activeKey === 'points' && doc.plan" class="panel te-edit">
          <div class="te-edit-head"><span class="tag tag-blue">重点难点</span><b>教学重点与教学难点</b></div>
          <div class="f-field">
            <label class="f-label">教学重点</label>
            <textarea v-model="doc.plan.keyPoints" class="f-textarea" rows="4" placeholder="本节课必须落实的核心知识与能力" />
          </div>
          <div class="f-field" style="margin-bottom: 0">
            <label class="f-label">教学难点</label>
            <textarea v-model="doc.plan.hardPoints" class="f-textarea" rows="4" placeholder="学生易错、难以理解的环节，并说明突破办法" />
            <p class="f-hint">难点要写「难在哪 + 怎么突破」，只写知识点等于没写。</p>
          </div>
        </div>

        <!-- 方法与教具 -->
        <div v-else-if="activeKey === 'method' && doc.plan" class="panel te-edit">
          <div class="te-edit-head"><span class="tag tag-blue">方法与教具</span><b>教学方法与教具媒体</b></div>
          <div class="f-field">
            <AppFilterChips
              label="教学方法"
              label-width="72px"
              :options="METHOD_POOL"
              :model-value="doc.plan.methods"
              @update:model-value="setMethods"
            />
            <div class="pl-custom">
              <input v-model="customMethod" class="f-input" placeholder="自定义方法" @keyup.enter="addCustom(doc.plan.methods, customMethod, () => (customMethod = ''))" />
              <button class="mini-btn" @click="addCustom(doc.plan.methods, customMethod, () => (customMethod = ''))">添加</button>
            </div>
          </div>
          <div class="f-field" style="margin-bottom: 0">
            <AppFilterChips
              label="教具与媒体"
              label-width="72px"
              :options="AID_POOL"
              :model-value="doc.plan.aids"
              @update:model-value="setAids"
            />
            <div class="pl-custom">
              <input v-model="customAid" class="f-input" placeholder="自定义教具" @keyup.enter="addCustom(doc.plan.aids, customAid, () => (customAid = ''))" />
              <button class="mini-btn" @click="addCustom(doc.plan.aids, customAid, () => (customAid = ''))">添加</button>
            </div>
          </div>
        </div>

        <!-- 教学环节 -->
        <div v-else-if="activeStep" class="panel te-edit">
          <div class="te-edit-head">
            <span class="tag tag-blue">{{ PLAN_STEP_TEXT[activeStep.kind] }}</span>
            <input v-model="activeStep.title" class="f-input" style="max-width: 260px" placeholder="环节名称" />
            <span class="pl-min">
              时长
              <input v-model.number="activeStep.minutes" class="pl-period-input" type="number" min="1" max="90" />
              分钟
            </span>
          </div>

          <div class="f-field">
            <label class="f-label">教师活动</label>
            <RichTextEditor
              v-model="activeStep.teacher"
              :subject="doc.subject"
              :min-height="130"
              placeholder="教师在这一环节做什么：提问、演示、点拨、板书…"
            />
          </div>
          <div class="f-field">
            <label class="f-label">学生活动</label>
            <RichTextEditor
              v-model="activeStep.student"
              :subject="doc.subject"
              :min-height="130"
              placeholder="学生做什么：思考、讨论、板演、练习…"
            />
          </div>
          <div class="f-field">
            <label class="f-label">设计意图</label>
            <textarea v-model="activeStep.intent" class="f-textarea" rows="3" placeholder="为什么这样设计：解决什么问题、达成什么目标" />
          </div>

          <div class="te-linked">
            <div class="te-linked-head">
              <b>本环节题目</b>
              <span class="f-hint">例题与练习可从右侧题库加入</span>
            </div>
            <p v-if="!activeStep.questionIds.length" class="f-hint">本环节尚未关联题目</p>
            <div v-for="(qid, qi) in activeStep.questionIds" :key="qid" class="te-linked-row">
              <span class="tag tag-gray">{{ itemOf(qid)?.type ?? '题目' }}</span>
              <span class="te-linked-stem">{{ qi + 1 }}. {{ truncateRich(itemOf(qid)?.stem ?? `题目 #${qid}`, 56) }}</span>
              <button class="mini-btn danger" @click="unlinkQuestion(qid)">移除</button>
            </div>
          </div>
        </div>

        <!-- 板书 -->
        <div v-else-if="activeKey === 'blackboard' && doc.plan" class="panel te-edit">
          <div class="te-edit-head"><span class="tag tag-blue">板书设计</span><b>课堂板书布局</b></div>
          <RichTextEditor
            v-model="doc.plan.blackboard"
            :subject="doc.subject"
            :min-height="280"
            placeholder="按左右分栏描述板书：左侧主板书（知识结构），右侧副板书（例题演算）"
          />
          <p class="f-hint">板书要留得下、看得清，建议先画结构再填细节。</p>
        </div>

        <!-- 反思 -->
        <div v-else-if="activeKey === 'reflection' && doc.plan" class="panel te-edit">
          <div class="te-edit-head"><span class="tag tag-blue">教学反思</span><b>课后填写</b></div>
          <RichTextEditor
            v-model="doc.plan.reflection"
            :subject="doc.subject"
            :min-height="280"
            placeholder="目标达成情况、环节时间是否合理、学生的意外生成、下次改进点…"
          />
          <p class="f-hint">反思建议结合考试/作业数据写，别写成流水账。</p>
        </div>

        <div v-else class="panel te-empty">左侧选择要编辑的部分</div>
      </main>

      <!-- 右：题库 -->
      <aside class="panel te-bank">
        <div class="section-title" style="margin-bottom: 10px">题库选题</div>
        <select v-model="bankFilter.type" class="f-select" style="margin-bottom: 8px">
          <option value="">全部题型</option>
          <option v-for="t in ['单选', '多选', '判断', '填空', '解答']" :key="t" :value="t">{{ t }}</option>
        </select>
        <select v-model="bankFilter.difficulty" class="f-select" style="margin-bottom: 8px">
          <option value="">全部难度</option>
          <option v-for="d in difficulties" :key="d" :value="d">{{ d }}</option>
        </select>
        <input v-model="bankFilter.keyword" class="f-input" placeholder="搜索题干" style="margin-bottom: 10px" />
        <p class="f-hint" style="margin-bottom: 8px">
          {{ activeStep ? `题目将加入「${activeStep.title || PLAN_STEP_TEXT[activeStep.kind]}」` : '先选中一个教学环节' }}
        </p>
        <div class="te-bank-list">
          <div v-for="row in bankPool" :key="row.id" class="te-bank-card">
            <p class="te-bank-stem">{{ truncateRich(row.stem, 54) }}</p>
            <div class="te-bank-foot">
              <span class="f-hint">{{ row.type }} · {{ row.difficulty }}</span>
              <button class="mini-btn" :disabled="activeStep?.questionIds.includes(row.id)" @click="linkQuestion(row.id)">
                {{ activeStep?.questionIds.includes(row.id) ? '已加入' : '+ 加入环节' }}
              </button>
            </div>
          </div>
        </div>
      </aside>
    </div>

    <!-- 预览（同时作为打印稿） -->
    <AppModal v-if="previewOpen" :title="doc.name" :width="900" @close="previewOpen = false">
      <div class="te-doc">
        <div class="te-doc-head">
          <h1>{{ doc.name }}</h1>
          <p>
            {{ doc.subject }} · {{ doc.grade }} · {{ doc.plan?.periods ?? 1 }} 课时<template v-if="doc.textbook">
              · {{ doc.textbook }}</template
            >
          </p>
        </div>

        <section class="te-doc-block">
          <h2>一、教学目标</h2>
          <p><b>知识与技能：</b>{{ doc.plan?.objectives.knowledge }}</p>
          <p><b>过程与方法：</b>{{ doc.plan?.objectives.process }}</p>
          <p><b>情感态度与价值观：</b>{{ doc.plan?.objectives.emotion }}</p>
        </section>

        <section class="te-doc-block">
          <h2>二、重点难点</h2>
          <p><b>教学重点：</b>{{ doc.plan?.keyPoints || '（未填写）' }}</p>
          <p><b>教学难点：</b>{{ doc.plan?.hardPoints || '（未填写）' }}</p>
          <p><b>教学方法：</b>{{ doc.plan?.methods.join('、') || '（未填写）' }}</p>
          <p><b>教具媒体：</b>{{ doc.plan?.aids.join('、') || '（未填写）' }}</p>
        </section>

        <section class="te-doc-block">
          <h2>三、教学过程</h2>
          <table class="pl-table">
            <thead>
              <tr>
                <th style="width: 90px">环节</th>
                <th>教师活动</th>
                <th>学生活动</th>
                <th style="width: 76px">时间</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(step, i) in doc.plan?.steps ?? []" :key="step.id">
                <td>
                  <b>{{ i + 1 }}. {{ step.title || PLAN_STEP_TEXT[step.kind] }}</b>
                  <div class="pl-intent">设计意图：{{ step.intent || '—' }}</div>
                  <div v-if="step.questionIds.length" class="pl-intent">
                    题目：{{ step.questionIds.length }} 道
                    <span v-for="(qid, qi) in step.questionIds" :key="qid" class="pl-inline-q">
                      <RichTextViewer v-if="itemOf(qid)" :content="itemOf(qid)!.stem" tag="span" /><template
                        v-if="qi < step.questionIds.length - 1"
                      >；</template>
                    </span>
                  </div>
                </td>
                <td><RichTextViewer :content="step.teacher || '<p>—</p>'" /></td>
                <td><RichTextViewer :content="step.student || '<p>—</p>'" /></td>
                <td>{{ step.minutes }}′</td>
              </tr>
              <tr v-if="!doc.plan?.steps.length">
                <td colspan="4" class="empty-row">尚未设计教学环节</td>
              </tr>
            </tbody>
          </table>
          <p class="pl-total">合计 {{ totalMinutes }} 分钟</p>
        </section>

        <section class="te-doc-block">
          <h2>四、板书设计</h2>
          <RichTextViewer :content="doc.plan?.blackboard || '<p>（未填写）</p>'" />
        </section>

        <section class="te-doc-block">
          <h2>五、教学反思</h2>
          <RichTextViewer :content="doc.plan?.reflection || '<p>（课后填写）</p>'" />
        </section>
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="previewOpen = false">关闭</button>
        <button class="btn btn-primary" @click="onPrint"><AppIcon name="print" :size="14" /> 打印教案</button>
      </template>
    </AppModal>
  </div>

  <!-- ================= 列表 ================= -->
  <div v-else class="page">
    <AppPageHeader desc="按「三维目标 → 重难点 → 教学过程 → 板书 → 反思」撰写教学设计，过程按环节写清教师活动、学生活动与设计意图，可直接关联题库题目并打印。">
      <template #actions>
        <button class="btn btn-ghost" @click="router.push('/teach/guide')"><AppIcon name="clipboard" :size="15" /> 切换学案</button>
        <button class="btn btn-primary" @click="openCreate"><AppIcon name="plus" :size="15" /> 新建教案</button>
      </template>
    </AppPageHeader>

    <AppFilterPanel :rows="FILTER_ROWS" :model-value="filters" @update:model-value="onFiltersChange" />

    <div class="panel">
      <!-- 工具条自带 14/18 的内边距，与下方栅格 / 分页的边距对齐 -->
      <div class="list-head">
        <AppListToolbar v-model="keyword" placeholder="名称 / 知识点" />
      </div>

      <div class="te-grid">
        <div v-for="row in rows" :key="row.id" class="te-card">
          <div class="te-card-top">
            <h3>{{ row.name }}</h3>
            <span class="tag" :class="row.status === 'published' ? 'tag-green' : 'tag-gray'">
              {{ TEACH_DOC_STATUS_TEXT[row.status] }}
            </span>
          </div>
          <p class="te-card-meta">
            {{ row.grade }} · {{ row.subject }} · {{ row.plan?.periods ?? 1 }} 课时<template v-if="row.textbook">
              · {{ row.textbook }}</template
            >
          </p>
          <div class="te-card-tags">
            <span v-for="k in row.knowledge.slice(0, 3)" :key="k" class="tag tag-gray">{{ k }}</span>
            <span v-if="row.sharedSquare" class="tag tag-blue">已共享广场</span>
          </div>
          <p class="te-card-foot">
            {{ row.plan?.steps.length ?? 0 }} 个环节 · {{ questionCountOf(row) }} 题 · {{ row.views }} 次浏览 ·
            {{ row.owner }} · {{ row.updatedAt }}
          </p>
          <div class="op-group">
            <button class="mini-btn" @click="router.push(`/teach/plan?id=${row.id}`)">编辑</button>
            <button class="mini-btn" @click="onDuplicate(row)">复制</button>
            <button class="mini-btn danger" @click="onDelete(row)">删除</button>
          </div>
        </div>
      </div>
      <p v-if="!rows.length" class="empty-row">{{ loading ? '正在载入…' : '暂无教案，点击右上角新建' }}</p>
      <AppPagination :total="filtered.length" v-model:page="page" :page-size="9" />
    </div>

    <!-- 新建教案 -->
    <AppModal v-if="createOpen" title="新建教案" :width="640" @close="createOpen = false">
      <div class="f-field">
        <label class="f-label">教案名称<span class="req">*</span></label>
        <input v-model="createForm.name" class="f-input" maxlength="50" placeholder="例如：函数的单调性 · 教学设计" />
      </div>
      <div class="f-field row3">
        <div>
          <label class="f-label">学科</label>
          <select v-model="createForm.subject" class="f-select">
            <option v-for="s in subjects" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
        <div>
          <label class="f-label">年级</label>
          <select v-model="createForm.grade" class="f-select">
            <option v-for="g in grades" :key="g" :value="g">{{ g }}</option>
          </select>
        </div>
        <div>
          <label class="f-label">教材版本</label>
          <input v-model="createForm.textbook" class="f-input" placeholder="如：人教 A 版 必修一" />
        </div>
      </div>
      <div class="f-field">
        <label class="f-label">知识点（顿号分隔）</label>
        <input v-model="createForm.knowledgeText" class="f-input" placeholder="如：单调性、函数性质" />
      </div>
      <div class="f-field" style="margin-bottom: 0">
        <label class="f-label">选用模板</label>
        <div class="te-tpl-list">
          <button
            v-for="row in PLAN_TEMPLATES"
            :key="row.key"
            class="te-tpl"
            :class="{ on: createForm.template === row.key }"
            type="button"
            @click="createForm.template = row.key"
          >
            <b>{{ row.name }}<AppIcon v-if="createForm.template === row.key" name="check" :size="13" /></b>
            <span>{{ row.desc }} · {{ row.periods }} 课时</span>
          </button>
        </div>
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="createOpen = false">取消</button>
        <button class="btn btn-primary" :disabled="saving" @click="submitCreate">创建并开始撰写</button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.pl-shell { display: flex; flex-direction: column; gap: 12px; }
.te-head { display: flex; align-items: center; gap: 12px; padding: 12px 16px; }
.te-back {
  width: 34px; height: 34px; flex-shrink: 0;
  border: 1px solid var(--border); border-radius: 9px;
  background: #fff; color: var(--ink-2);
  display: flex; align-items: center; justify-content: center;
}
.te-back:hover { border-color: var(--brand); color: var(--brand-deep); }
.te-head-main { flex: 1; min-width: 0; }
.te-title {
  width: 100%; border: none; background: transparent;
  font-size: 16px; font-weight: 700; color: var(--ink);
  padding: 2px 4px; border-radius: 7px;
}
.te-title:hover { background: #f4f7fb; }
.te-title:focus { outline: none; box-shadow: 0 0 0 2px var(--brand-soft); }
.te-head-meta { display: flex; align-items: center; gap: 8px; margin-top: 4px; flex-wrap: wrap; }
/* 横向居中的行里，f-hint 自带的 5px 上边距会把文字顶歪 */
.te-head-meta .f-hint,
.te-linked-head .f-hint,
.te-bank-foot .f-hint { margin-top: 0; }
.pl-period { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--sub); }
.pl-period-input {
  width: 52px; height: 26px; border: 1px solid var(--border); border-radius: 7px;
  padding: 0 6px; font-size: 12.5px; color: var(--ink);
}
.pl-period-input:focus { outline: none; border-color: var(--brand); }
.pl-warn { color: var(--warn); }
.pl-min { display: inline-flex; align-items: center; gap: 4px; font-size: 12.5px; color: var(--sub); }

.te-body { display: grid; grid-template-columns: 258px minmax(0, 1fr) 300px; gap: 12px; align-items: start; }

.te-outline { padding: 14px; position: sticky; top: 0; max-height: calc(100vh - 150px); overflow-y: auto; }
.pl-ol-title {
  font-size: 11.5px; font-weight: 700; color: var(--sub);
  margin: 12px 0 6px; padding-left: 8px;
}
.te-ol-row {
  display: flex; align-items: center; gap: 8px;
  border: 1.5px solid transparent; border-radius: 10px;
  padding: 7px 8px; margin-bottom: 4px; cursor: pointer;
}
.te-ol-row:hover { background: #f6f9fc; }
.te-ol-row.on { border-color: var(--brand); background: var(--brand-soft); }
.te-ol-no {
  width: 20px; height: 20px; flex-shrink: 0; border-radius: 6px;
  background: #eef1f7; color: var(--ink-2);
  font-size: 11.5px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
}
.te-ol-row.on .te-ol-no { background: var(--brand); color: #fff; }
.te-ol-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.te-ol-main b { font-size: 12.5px; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.te-ol-main em { font-size: 11px; color: var(--sub); font-style: normal; }
.te-ol-ops { display: flex; align-items: center; gap: 2px; opacity: 0; transition: opacity 0.15s; }
.te-ol-row:hover .te-ol-ops { opacity: 1; }
.te-icon {
  width: 22px; height: 22px; border: none; border-radius: 5px;
  background: #f0f3f8; color: var(--ink-2); font-size: 12px;
  display: inline-flex; align-items: center; justify-content: center;
}
.te-icon:hover { background: var(--brand-soft); color: var(--brand-deep); }
.te-icon.danger:hover { background: var(--danger-soft); color: var(--danger); }
.te-add { margin-top: 14px; padding-top: 12px; border-top: 1px dashed var(--border); }
.chips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 8px; }
/* 「新增教学环节」是动作按钮（无选中态），不是选择器，因此不能换成 AppFilterChips；
   但外形与筛选 chip 保持同一套尺寸（与共享组件 AppFilterChips 的 .opt-chip 同形，
   包括同样不设 line-height）。 */
.k-chip {
  border: 1.5px solid var(--border); border-radius: 8px;
  background: var(--card); color: var(--ink-2); font-size: 12.5px; padding: 3px 12px;
  white-space: nowrap; flex-shrink: 0;
  transition: border-color 0.12s, color 0.12s;
}
.k-chip:hover { border-color: var(--brand); color: var(--brand-deep); }
/* 自定义方法 / 教具的输入行：同一行的输入框与按钮必须同高，否则上下错位 */
.pl-custom { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
.pl-custom .f-input { flex: 1; height: var(--ctrl-h); font-size: 12.5px; }
.pl-custom .mini-btn { height: var(--ctrl-h); }

.te-main { min-width: 0; }
.te-edit { padding: 16px; }
.te-edit-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; font-size: 14px; }
.te-empty { padding: 40px; text-align: center; color: var(--sub); font-size: 13px; }
.te-linked { margin-top: 16px; padding-top: 14px; border-top: 1px dashed var(--border); }
.te-linked-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; font-size: 13px; }
.te-linked-row {
  display: flex; align-items: center; gap: 8px;
  border: 1px solid var(--border); border-radius: 9px;
  padding: 8px 10px; margin-bottom: 6px; background: #fbfdfd;
}
.te-linked-stem { flex: 1; min-width: 0; font-size: 12.5px; color: var(--ink-2); }

.te-bank { padding: 14px; position: sticky; top: 0; max-height: calc(100vh - 150px); display: flex; flex-direction: column; }
.te-bank-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
.te-bank-card { border: 1.5px solid var(--border); border-radius: 10px; padding: 9px 11px; }
.te-bank-stem { font-size: 12.5px; color: var(--ink-2); line-height: 1.6; }
.te-bank-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 5px; }

/* 预览稿 */
.te-doc { background: #fff; padding: 8px 6px; }
.te-doc-head { text-align: center; border-bottom: 2px solid var(--ink); padding-bottom: 10px; margin-bottom: 16px; }
.te-doc-head h1 { font-size: 20px; font-weight: 700; }
.te-doc-head p { font-size: 12.5px; color: var(--sub); margin-top: 5px; }
.te-doc-block { margin-bottom: 18px; }
.te-doc-block h2 { font-size: 15px; font-weight: 700; margin-bottom: 8px; }
.te-doc-block p { font-size: 13.5px; line-height: 1.8; color: var(--ink-2); }
.pl-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.pl-table th,
.pl-table td { border: 1px solid var(--border); padding: 8px 10px; text-align: left; vertical-align: top; }
.pl-table th { background: #f6f9fc; font-weight: 700; color: var(--ink); }
.pl-intent { margin-top: 6px; font-size: 11.5px; color: var(--sub); line-height: 1.6; }
.pl-inline-q { color: var(--ink-2); }
.pl-total { text-align: right; font-size: 12px; color: var(--sub); margin-top: 6px; }

/* 列表工具条与面板左右同边距（表格 / 栅格满幅，内边距给在工具条这一层） */
.list-head { padding: 14px 18px 0; }

/* 列表 */
.te-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; padding: 0 18px 4px; }
.te-card {
  border: 1.5px solid var(--border); border-radius: 12px;
  padding: 14px; display: flex; flex-direction: column; gap: 8px;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.te-card:hover { border-color: var(--brand); box-shadow: var(--shadow); }
.te-card-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.te-card-top h3 { font-size: 14px; font-weight: 700; line-height: 1.5; }
.te-card-meta { font-size: 12px; color: var(--sub); }
.te-card-tags { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; }
.te-card-foot { font-size: 11.5px; color: var(--sub); }
.row3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.te-tpl-list { display: flex; flex-direction: column; gap: 8px; }
.te-tpl {
  text-align: left; border: 1.5px solid var(--border); border-radius: 11px;
  background: #fff; padding: 9px 12px; display: flex; flex-direction: column; gap: 4px;
}
.te-tpl.on { border-color: var(--brand); background: var(--brand-soft); }
.te-tpl b { display: flex; align-items: center; gap: 5px; font-size: 13px; color: var(--ink); }
.te-tpl.on b { color: var(--brand-deep); }
.te-tpl span { font-size: 11.5px; color: var(--sub); }
</style>
