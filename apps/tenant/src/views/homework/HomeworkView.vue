<script setup lang="ts">
/**
 * 作业系统（日常练习）。
 *
 * 列表与批阅合在一个路由：列表态展示作业卡片；`?id=` 进入该作业的批阅视图（提交明细 + 逐人批阅）。
 * 布置 / 编辑走弹窗，批阅走抽屉。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AppFilterChips, AppFilterPanel, AppIcon, AppListToolbar, AppPageHeader, AppSegmented, appConfirm, CLASS_NAMES, HOMEWORK_STATUS_TEXT, RichTextViewer, showToast, truncateRich, AppModal, AppDrawer } from '@aiteach/shared'
import type { FilterRowDef } from '@aiteach/shared'
import type { Homework, HomeworkSubmission, OrgPaper, OrgQuestion } from '@aiteach/shared'
import {
  closeHomework,
  deleteHomework,
  fetchHomeworks,
  fetchPapers,
  fetchQuestions,
  fetchSubmissions,
  gradeSubmission,
  saveHomework,
} from '@/api/org'
import { useBaseData } from '@/composables/useBaseData'

const route = useRoute()
const router = useRouter()
const { subjects, grades, questionTypesFor, difficulties, ensure, pick, withCurrent } = useBaseData()

const homeworks = ref<Homework[]>([])
const papers = ref<OrgPaper[]>([])
const questions = ref<OrgQuestion[]>([])
const loading = ref(true)

const editingId = computed(() => Number(route.query.id ?? 0))
const grading = ref<Homework | null>(null)
const submissions = ref<HomeworkSubmission[]>([])

/* ================= 列表 ================= */
const hwKeyword = ref('')

const filteredHomeworks = computed(() => {
  const kw = hwKeyword.value.trim()
  return homeworks.value.filter((row) => !kw || row.name.includes(kw) || row.subject.includes(kw))
})

function sourceText(hw: Homework): string {
  if (hw.paperId && hw.paperName) {
    const p = papers.value.find((row) => row.id === hw.paperId)
    const n = p ? p.sections.reduce((sum, s) => sum + s.questions.length, 0) : hw.questionIds.length
    return `整卷 · ${hw.paperName}（${n} 题）`
  }
  return `${hw.questionIds.length} 道题`
}

const STATUS_TAG: Record<Homework['status'], string> = {
  assigned: 'tag-blue',
  ongoing: 'tag-green',
  closed: 'tag-gray',
}

/* ================= 布置 / 编辑弹窗 ================= */
const hwOpen = ref(false)
const hwEditingId = ref<number | null>(null)
/** 选题方式：AppSegmented 的 modelValue 是 string，故这里不放宽成联合类型 */
const pickMode = ref<string>('bank')
const PICK_MODE_OPTIONS = [
  { value: 'bank', label: '从题库选题' },
  { value: 'paper', label: '选用整卷' },
]
const hwForm = reactive({
  name: '',
  subject: '数学',
  grade: '高一',
  paperId: undefined as number | undefined,
  questionIds: [] as number[],
  classes: [] as string[],
  deadlineInput: '',
  require: '独立完成，写出关键步骤',
})

function toInput(dt: string): string {
  return dt.replace(' ', 'T').slice(0, 16)
}
function fromInput(v: string): string {
  return v.replace('T', ' ')
}

function openNewHw() {
  hwEditingId.value = null
  hwForm.name = ''
  hwForm.subject = pick(subjects.value, hwForm.subject)
  hwForm.grade = pick(grades.value, hwForm.grade)
  hwForm.paperId = undefined
  hwForm.questionIds = []
  hwForm.classes = []
  hwForm.deadlineInput = ''
  hwForm.require = '独立完成，写出关键步骤'
  pickMode.value = 'bank'
  hwOpen.value = true
}

function openEditHw(hw: Homework) {
  hwEditingId.value = hw.id
  hwForm.name = hw.name
  hwForm.subject = hw.subject
  hwForm.grade = hw.grade
  hwForm.paperId = hw.paperId
  hwForm.questionIds = [...hw.questionIds]
  hwForm.classes = [...hw.classes]
  hwForm.deadlineInput = toInput(hw.deadline)
  hwForm.require = hw.require
  pickMode.value = hw.paperId ? 'paper' : 'bank'
  hwOpen.value = true
}

const paperQuestionCount = computed(() => {
  if (!hwForm.paperId) return 0
  const p = papers.value.find((row) => row.id === hwForm.paperId)
  return p ? p.sections.reduce((sum, s) => sum + s.questions.length, 0) : 0
})

function onPickPaper() {
  const p = papers.value.find((row) => row.id === hwForm.paperId)
  hwForm.questionIds = p ? p.sections.flatMap((s) => s.questions.map((q) => q.questionId)) : []
}
function switchMode(mode: string) {
  pickMode.value = mode
  if (mode === 'paper') {
    hwForm.questionIds = []
  } else {
    hwForm.paperId = undefined
    hwForm.questionIds = []
  }
}
function toggleBank(id: number) {
  const i = hwForm.questionIds.indexOf(id)
  if (i >= 0) hwForm.questionIds.splice(i, 1)
  else hwForm.questionIds.push(id)
}

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
const itemOf = (id: number) => questions.value.find((row) => row.id === id)

async function submitHw() {
  if (hwForm.name.trim().length < 2) {
    showToast('作业名称须为 2-50 字', 'error')
    return
  }
  if (!hwForm.questionIds.length) {
    showToast('请至少选择一道题目', 'error')
    return
  }
  if (!hwForm.classes.length) {
    showToast('请至少选择一个班级', 'error')
    return
  }
  if (!hwForm.deadlineInput) {
    showToast('请选择截止时间', 'error')
    return
  }
  try {
    const saved = await saveHomework({
      id: hwEditingId.value ?? undefined,
      name: hwForm.name.trim(),
      subject: hwForm.subject,
      grade: hwForm.grade,
      paperId: pickMode.value === 'paper' ? hwForm.paperId : undefined,
      questionIds: hwForm.questionIds,
      classes: hwForm.classes,
      deadline: fromInput(hwForm.deadlineInput),
      require: hwForm.require.trim(),
    })
    hwOpen.value = false
    await loadList()
    showToast(hwEditingId.value != null ? '作业已更新' : '作业已布置', 'success')
    if (hwEditingId.value != null && grading.value?.id === saved.id) {
      grading.value = saved
      await loadSubmissions(saved.id)
    }
  } catch (error) {
    showToast(error instanceof Error ? error.message : '保存失败', 'error')
  }
}

async function onCloseHw(hw: Homework) {
  if (!(await appConfirm(`截止《${hw.name}》？截止后学生不可再提交`, { type: 'warning' }))) return
  try {
    await closeHomework(hw.id)
    await loadList()
    if (grading.value?.id === hw.id) grading.value = homeworks.value.find((row) => row.id === hw.id) ?? grading.value
    showToast('作业已截止', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '操作失败', 'error')
  }
}

async function onDeleteHw(hw: Homework) {
  if (!(await appConfirm(`删除《${hw.name}》？相关提交记录将一并清除`, { type: 'danger' }))) return
  try {
    await deleteHomework(hw.id)
    await loadList()
    showToast('作业已删除', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '删除失败', 'error')
  }
}

/* ================= 批阅视图 ================= */
const subFilter = reactive({ className: '', status: '', keyword: '' })
const gradedRows = computed(() => {
  const kw = subFilter.keyword.trim()
  return submissions.value.filter(
    (row) =>
      (!subFilter.className || row.className === subFilter.className) &&
      (!subFilter.status || row.status === subFilter.status) &&
      (!kw || row.student.includes(kw)),
  )
})

const stats = computed(() => {
  const all = submissions.value
  const total = all.length
  const missing = all.filter((row) => row.status === 'missing').length
  const late = all.filter((row) => row.status === 'late').length
  const turned = total - missing
  const rated = all.filter((row) => row.status !== 'missing' && row.correctRate != null)
  const avg = rated.length ? Math.round(rated.reduce((sum, row) => sum + (row.correctRate ?? 0), 0) / rated.length) : 0
  return { total, missing, late, turned, avg }
})

const SUB_TAG: Record<HomeworkSubmission['status'], string> = {
  submitted: 'tag-green',
  late: 'tag-orange',
  missing: 'tag-red',
}
const SUB_TEXT: Record<HomeworkSubmission['status'], string> = {
  submitted: '已交',
  late: '迟交',
  missing: '未交',
}

/** 批阅视图筛选行：班级候选来自提交记录，故用 computed */
const subFilterRows = computed<FilterRowDef[]>(() => [
  { key: 'className', label: '班级', options: [...new Set(submissions.value.map((s) => s.className))], multiple: false },
  { key: 'status', label: '状态', options: Object.values(SUB_TEXT), multiple: false },
])

/** chip 上是文案，subFilter 里存业务值 */
function subStatusKeyOf(text: string): '' | HomeworkSubmission['status'] {
  return (Object.keys(SUB_TEXT) as HomeworkSubmission['status'][]).find((k) => SUB_TEXT[k] === text) ?? ''
}

const subFilterModel = computed<Record<string, string[]>>(() => ({
  className: subFilter.className ? [subFilter.className] : [],
  status: subFilter.status ? [SUB_TEXT[subFilter.status as HomeworkSubmission['status']]] : [],
}))

function onSubFilterChange(next: Record<string, string[]>) {
  subFilter.className = next.className?.[0] ?? ''
  subFilter.status = subStatusKeyOf(next.status?.[0] ?? '')
}

async function openGrading(id: number) {
  const hw = homeworks.value.find((row) => row.id === id)
  if (!hw) {
    showToast('作业不存在或已删除', 'error')
    router.replace('/homework')
    return
  }
  grading.value = hw
  await loadSubmissions(id)
}
watch(editingId, (id) => {
  if (id) void openGrading(id)
})

function backToList() {
  grading.value = null
  router.push('/homework')
}

async function loadSubmissions(id: number) {
  submissions.value = await fetchSubmissions(id)
}

/* ================= 批阅抽屉 ================= */
const gradeOpen = ref(false)
const gradeTarget = ref<HomeworkSubmission | null>(null)
const gradeScore = ref(0)
const gradeComment = ref('')
const gradeExpand = ref<number | null>(null)

function openGrade(sub: HomeworkSubmission) {
  if (sub.status === 'missing') {
    showToast('该生未提交，无法批阅', 'error')
    return
  }
  gradeTarget.value = sub
  gradeScore.value = sub.score ?? 0
  gradeComment.value = sub.comment ?? ''
  gradeExpand.value = null
  gradeOpen.value = true
}
async function saveGrade() {
  if (!gradeTarget.value) return
  if (gradeScore.value < 0 || gradeScore.value > 100) {
    showToast('分数须在 0 ~ 100 之间', 'error')
    return
  }
  try {
    await gradeSubmission(gradeTarget.value.id, gradeScore.value, gradeComment.value.trim())
    gradeOpen.value = false
    await loadSubmissions(gradeTarget.value.homeworkId)
    const g = grading.value
    if (g) {
      const idx = homeworks.value.findIndex((row) => row.id === g.id)
      if (idx >= 0) homeworks.value[idx] = { ...homeworks.value[idx], updatedAt: new Date().toISOString().slice(0, 16).replace('T', ' ') }
    }
    showToast('已批阅，错题已同步至错题本', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '批阅失败', 'error')
  }
}

/* ================= 数据 ================= */
async function loadList() {
  homeworks.value = await fetchHomeworks()
}

onMounted(async () => {
  loading.value = true
  try {
    await Promise.all([ensure(), fetchPapers().then((rows) => (papers.value = rows)), fetchQuestions().then((rows) => (questions.value = rows))])
    await loadList()
    if (editingId.value) await openGrading(editingId.value)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="page">
    <!-- ================= 批阅视图 ================= -->
    <div v-if="grading" class="page">
      <div class="detail-head">
        <div class="dh-left">
          <button class="te-back" type="button" @click="backToList"><AppIcon name="chevron-left" :size="15" /></button>
          <div>
            <h2>{{ grading.name }}</h2>
            <p class="f-hint">
              {{ grading.subject }} · {{ grading.grade }} · 来源：{{ sourceText(grading) }} · 布置 {{ grading.assignAt }} · 截止 {{ grading.deadline }}
            </p>
          </div>
        </div>
        <div class="op-group">
          <button class="btn btn-ghost" @click="router.push('/exam/mistake')"><AppIcon name="target" :size="15" /> 查看班级错题本</button>
          <button class="btn btn-ghost" @click="onCloseHw(grading)"><AppIcon name="flag" :size="15" /> 截止作业</button>
          <button class="btn btn-primary" @click="backToList"><AppIcon name="grid" :size="15" /> 返回列表</button>
        </div>
      </div>

      <div class="panel hw-stats">
        <div class="stat"><span class="stat-n">{{ stats.turned }}/{{ stats.total }}</span><span class="stat-l">已交 / 总数</span></div>
        <div class="stat"><span class="stat-n" style="color: var(--danger)">{{ stats.missing }}</span><span class="stat-l">未交</span></div>
        <div class="stat"><span class="stat-n" style="color: var(--warn)">{{ stats.late }}</span><span class="stat-l">迟交</span></div>
        <div class="stat"><span class="stat-n" style="color: var(--brand-deep)">{{ stats.avg }}%</span><span class="stat-l">平均正确率</span></div>
      </div>

      <AppFilterPanel
        :model-value="subFilterModel"
        :rows="subFilterRows"
        @update:model-value="onSubFilterChange"
      />

      <div class="panel">
        <AppListToolbar v-model="subFilter.keyword" placeholder="搜索学生姓名" class="hw-toolbar" />

        <div class="data-table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>学生</th>
                <th>班级</th>
                <th>提交时间</th>
                <th>状态</th>
                <th>正确率</th>
                <th>得分（百分制）</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="sub in gradedRows" :key="sub.id">
                <td class="cell-strong">{{ sub.student }}</td>
                <td>{{ sub.className }}</td>
                <td>{{ sub.submittedAt }}</td>
                <td><span class="tag" :class="SUB_TAG[sub.status]">{{ SUB_TEXT[sub.status] }}</span></td>
                <td>
                  <div v-if="sub.status !== 'missing'" class="bar-cell">
                    <div class="bar"><i :style="{ width: `${sub.correctRate ?? 0}%` }" /></div>
                    <span class="bar-n">{{ sub.correctRate }}%</span>
                  </div>
                  <span v-else class="f-hint">—</span>
                </td>
                <td>{{ sub.status !== 'missing' ? `${sub.score ?? '—'} 分` : '—' }}</td>
                <td>
                  <button class="mini-btn" :disabled="sub.status === 'missing'" @click="openGrade(sub)">批阅</button>
                </td>
              </tr>
              <tr v-if="!gradedRows.length">
                <td colspan="7" class="empty-row">
                  {{ loading ? '正在载入…' : '暂无提交记录' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ================= 列表视图 ================= -->
    <div v-else>
      <AppPageHeader desc="布置日常练习，跟踪提交与正确率，批阅后错题自动沉淀进班级错题本。">
        <template #actions>
          <button class="btn btn-ghost" @click="router.push('/exam/mistake')"><AppIcon name="target" :size="15" /> 班级错题本</button>
          <button class="btn btn-primary" @click="openNewHw"><AppIcon name="plus" :size="15" /> 布置作业</button>
        </template>
      </AppPageHeader>

      <div class="panel">
        <AppListToolbar v-model="hwKeyword" placeholder="搜索作业名 / 学科" class="hw-toolbar" />

        <div class="hw-grid">
          <p v-if="!filteredHomeworks.length" class="empty-row" style="grid-column: 1 / -1">
            {{ loading ? '正在载入…' : '暂无作业，点击右上角布置' }}
          </p>
          <div v-for="hw in filteredHomeworks" :key="hw.id" class="hw-card">
            <div class="hw-card-top">
              <h3>{{ hw.name }}</h3>
              <span class="tag" :class="STATUS_TAG[hw.status]">{{ HOMEWORK_STATUS_TEXT[hw.status] }}</span>
            </div>
            <p class="hw-meta">{{ hw.subject }} · {{ hw.grade }} · {{ sourceText(hw) }}</p>
            <p class="hw-meta">班级：{{ hw.classes.join('、') }}</p>
            <p class="hw-meta">布置 {{ hw.assignAt }} · 截止 {{ hw.deadline }}</p>
            <div class="hw-progress">
              <div class="bar"><i :style="{ width: `${hw.total ? (hw.submitted / hw.total) * 100 : 0}%` }" /></div>
              <span class="f-hint">提交 {{ hw.submitted }}/{{ hw.total }}</span>
            </div>
            <div class="op-group">
              <button class="mini-btn" @click="router.push(`/homework?id=${hw.id}`)">查看批阅</button>
              <button class="mini-btn" @click="openEditHw(hw)">编辑</button>
              <button class="mini-btn" @click="onCloseHw(hw)">截止</button>
              <button class="mini-btn danger" @click="onDeleteHw(hw)">删除</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 布置 / 编辑弹窗 -->
    <AppModal v-if="hwOpen" :title="hwEditingId != null ? '编辑作业' : '布置作业'" :width="760" @close="hwOpen = false">
      <div class="f-field row3">
        <div>
          <label class="f-label">作业名称<span class="req">*</span></label>
          <input v-model="hwForm.name" class="f-input" maxlength="50" placeholder="如：函数单调性 · 课后作业" />
        </div>
        <div>
          <label class="f-label">学科</label>
          <select v-model="hwForm.subject" class="f-select">
            <option v-for="s in subjects" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
        <div>
          <label class="f-label">年级</label>
          <select v-model="hwForm.grade" class="f-select">
            <option v-for="g in grades" :key="g" :value="g">{{ g }}</option>
          </select>
        </div>
      </div>

      <div class="f-field">
        <label class="f-label">选题方式</label>
        <AppSegmented :model-value="pickMode" :options="PICK_MODE_OPTIONS" @update:model-value="switchMode" />
      </div>

      <div v-if="pickMode === 'paper'" class="f-field">
        <label class="f-label">选择试卷<span class="req">*</span></label>
        <select v-model="hwForm.paperId" class="f-select" style="max-width: 360px" @change="onPickPaper">
          <option :value="undefined">请选择整卷…</option>
          <option v-for="p in papers" :key="p.id" :value="p.id">
            {{ p.name }}（{{ p.sections.reduce((sum, s) => sum + s.questions.length, 0) }} 题）
          </option>
        </select>
        <p v-if="hwForm.paperId" class="f-hint" style="margin-top: 6px">
          已选整卷《{{ papers.find((r) => r.id === hwForm.paperId)?.name }}》，共 {{ paperQuestionCount }} 题
        </p>
      </div>

      <div v-else class="hw-bank">
        <AppListToolbar v-model="bankFilter.keyword" placeholder="搜索题干" class="hw-bank-toolbar">
          <template #left>
            <select v-model="bankFilter.type" class="f-select">
              <option value="">全部题型</option>
              <!-- 题型随作业学科收窄（英语才有完形填空 / 七选五 / 短文改错）；已选值并入，换学科不会渲染成空白 -->
              <option v-for="t in withCurrent(questionTypesFor(hwForm.subject), bankFilter.type)" :key="t" :value="t">{{ t }}</option>
            </select>
            <select v-model="bankFilter.difficulty" class="f-select">
              <option value="">全部难度</option>
              <option v-for="d in difficulties" :key="d" :value="d">{{ d }}</option>
            </select>
          </template>
        </AppListToolbar>
        <p class="f-hint" style="margin-bottom: 8px">已选 {{ hwForm.questionIds.length }} 题</p>
        <div class="hw-bank-list">
          <div
            v-for="row in bankPool"
            :key="row.id"
            class="hw-bank-card"
            :class="{ on: hwForm.questionIds.includes(row.id) }"
            @click="toggleBank(row.id)"
          >
            <span class="tag tag-gray">{{ row.type }}</span>
            <span class="hw-bank-stem">{{ truncateRich(row.stem, 50) }}</span>
            <AppIcon v-if="hwForm.questionIds.includes(row.id)" name="check" :size="14" />
          </div>
          <p v-if="!bankPool.length" class="empty-row">题库暂无匹配题目</p>
        </div>
      </div>

      <div class="f-field">
        <label class="f-label">布置班级<span class="req">*</span></label>
        <div class="chip-plain">
          <AppFilterChips v-model="hwForm.classes" label="" label-width="0" :options="CLASS_NAMES" />
        </div>
      </div>

      <div class="f-field row2">
        <div>
          <label class="f-label">截止时间<span class="req">*</span></label>
          <input v-model="hwForm.deadlineInput" type="datetime-local" class="f-input" />
        </div>
        <div>
          <label class="f-label">作答要求</label>
          <textarea v-model="hwForm.require" class="f-textarea" style="min-height: 60px" />
        </div>
      </div>

      <template #footer>
        <button class="btn btn-ghost" @click="hwOpen = false">取消</button>
        <button class="btn btn-primary" @click="submitHw">保存作业</button>
      </template>
    </AppModal>

    <!-- 批阅抽屉 -->
    <AppDrawer v-if="gradeOpen && gradeTarget" :title="`批阅 · ${gradeTarget.student}`" :subtitle="`${gradeTarget.className} · 提交于 ${gradeTarget.submittedAt}`" :width="620" @close="gradeOpen = false">
      <div v-if="gradeTarget.wrongQuestionIds.length" class="grade-wrong">
        <div class="section-title" style="margin-bottom: 10px">错题（{{ gradeTarget.wrongQuestionIds.length }}）</div>
        <div v-for="qid in gradeTarget.wrongQuestionIds" :key="qid" class="gw-row">
          <div class="gw-head" @click="gradeExpand = gradeExpand === qid ? null : qid">
            <span class="tag tag-red">错题</span>
            <span class="gw-stem">{{ itemOf(qid) ? truncateRich(itemOf(qid)!.stem, 56) : `题目 #${qid}` }}</span>
            <AppIcon :name="gradeExpand === qid ? 'minus' : 'plus'" :size="14" />
          </div>
          <div v-if="gradeExpand === qid && itemOf(qid)" class="gw-detail">
            <p class="f-label" style="margin-bottom: 4px">答案</p>
            <RichTextViewer :content="itemOf(qid)!.answer" />
            <p class="f-label" style="margin: 10px 0 4px">解析</p>
            <RichTextViewer :content="itemOf(qid)!.analysis" />
          </div>
        </div>
      </div>
      <p v-else class="f-hint" style="padding: 10px 0">本次作业全部正确，无错题 🎉</p>

      <div class="f-field" style="margin-top: 14px">
        <label class="f-label">得分（0-100）</label>
        <input v-model.number="gradeScore" type="number" min="0" max="100" class="f-input" style="max-width: 160px" />
      </div>
      <div class="f-field">
        <label class="f-label">评语</label>
        <textarea v-model="gradeComment" class="f-textarea" placeholder="如：步骤完整，注意第 3 题符号" style="min-height: 64px" />
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="gradeOpen = false">取消</button>
        <button class="btn btn-primary" @click="saveGrade">保存批阅</button>
      </template>
    </AppDrawer>
  </div>
</template>

<style scoped>
.te-back {
  width: 34px; height: 34px; flex-shrink: 0;
  border: 1px solid var(--border); border-radius: 9px;
  background: #fff; color: var(--ink-2);
  display: flex; align-items: center; justify-content: center;
}
.te-back:hover { border-color: var(--brand); color: var(--brand-deep); }

/* 批阅视图：作业名 + 元信息 + 操作，是「详情工具条」而不是页面名 */
.detail-head { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
.detail-head .dh-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
.detail-head h2 { font-size: 16.5px; font-weight: 700; }
.hw-stats { display: flex; gap: 12px; padding: 14px 18px; }
.stat { display: flex; flex-direction: column; gap: 3px; padding: 0 18px; border-right: 1px solid var(--border); }
.stat:last-child { border-right: none; }
.stat-n { font-size: 20px; font-weight: 700; color: var(--ink); }
.stat-l { font-size: 12px; color: var(--sub); }

.bar-cell { display: flex; align-items: center; gap: 8px; }
.bar { flex: 1; max-width: 120px; height: 8px; border-radius: 999px; background: #eef2f8; overflow: hidden; }
.bar i { display: block; height: 100%; background: var(--brand); border-radius: 999px; }
.bar-n { font-size: 12px; color: var(--ink-2); min-width: 38px; }

/* 列表 */
.hw-toolbar { padding: 14px 16px 0; margin-bottom: 0; }
.hw-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; padding: 14px 16px 16px; }
.hw-card {
  border: 1.5px solid var(--border); border-radius: 12px;
  padding: 14px; display: flex; flex-direction: column; gap: 8px;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.hw-card:hover { border-color: var(--brand); box-shadow: var(--shadow); }
.hw-card-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.hw-card-top h3 { font-size: 14px; font-weight: 700; line-height: 1.5; }
.hw-meta { font-size: 12px; color: var(--sub); }
.hw-progress { display: flex; align-items: center; gap: 8px; margin-top: 2px; }
.hw-progress .bar { flex: 1; }

/* 布置弹窗 */
.hw-bank-list { max-height: 220px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; border: 1px solid var(--border); border-radius: 10px; padding: 8px; }
.hw-bank-card {
  display: flex; align-items: center; gap: 8px;
  border: 1.5px solid var(--border); border-radius: 9px; padding: 8px 10px; cursor: pointer;
}
.hw-bank-card:hover { border-color: var(--brand); }
.hw-bank-card.on { border-color: var(--brand); background: var(--brand-soft); }
.hw-bank-stem { flex: 1; min-width: 0; font-size: 12.5px; color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hw-bank-card .on + .hw-bank-stem, .hw-bank-card.on svg { color: var(--brand-deep); }

/* AppFilterChips 在表单里当「多选组」用时靠 f-label 标名，去掉组件自带的标签列 */
.chip-plain .chip-row { gap: 0; }
.hw-bank-toolbar { margin-bottom: 8px; }

.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.row3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }

/* 批阅抽屉 */
.grade-wrong { display: flex; flex-direction: column; gap: 8px; }
.gw-row { border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
.gw-head { display: flex; align-items: center; gap: 8px; padding: 9px 11px; cursor: pointer; }
.gw-stem { flex: 1; min-width: 0; font-size: 12.5px; color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gw-detail { padding: 4px 14px 14px; border-top: 1px dashed var(--border); }
.gw-detail :deep(.rte-content) { font-size: 13px; line-height: 1.7; }
</style>
