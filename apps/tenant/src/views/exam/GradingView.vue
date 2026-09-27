<script setup lang="ts">
/**
 * 在线阅卷与成绩录入（考后链路第一环）。
 *
 * 列表与阅卷工作台合在同一路由（`?id=` 切换）：教师的心智是「打开这次考试」，
 * 而不是先到阅卷列表再选一份答卷。工作台的分工：
 * - 左：按大题的阅卷分工（谁阅哪几题、单评/双评、进度），这是「分工」视角；
 * - 中：按学生展开的答卷列表（可按班/状态/待阅/姓名筛选），这是「逐人」视角；
 * - 右（抽屉）：单份答卷的逐题给分，回车跳下一题实现连续快录。
 *
 * 关于总分与进度的真相来源：saveAnswerScore / markAnswer 都会返回最新的 ExamAnswer，
 * 直接拿它替换列表里的对象即可，不必整卷重拉，既准又快。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ANSWER_STATUS_TEXT,
  AppIcon,
  AppPageHeader,
  CLASS_NAMES,
  type AnswerItem,
  type AnswerStatus,
  type ExamAnswer,
  type ExamSession,
  type GradingDuty,
  type OrgPaper,
  type OrgQuestion,
  RichTextViewer,
  showToast,
  truncateRich,
} from '@aiteach/shared'
import AppModal from '@/components/ui/AppModal.vue'
import AppDrawer from '@/components/ui/AppDrawer.vue'
import AppPagination from '@/components/ui/AppPagination.vue'
import {
  assignDuty,
  deleteExamSession,
  fetchExamSession,
  fetchExamSessions,
  fetchPapers,
  fetchQuestions,
  fetchStaff,
  finishExamSession,
  markAnswer,
  saveAnswerScore,
  saveExamSession,
} from '@/api/org'
import { useBaseData } from '@/composables/useBaseData'

const route = useRoute()
const router = useRouter()
const { ensure } = useBaseData()

/* ================= 列表 ================= */

const sessions = ref<ExamSession[]>([])
const papers = ref<OrgPaper[]>([])
const loading = ref(true)

const editingId = computed(() => Number(route.query.id ?? 0))

/** 阅卷进度：已阅份数 / 总份数。done 用「非待阅」来算，缺考/违纪也算阅完 */
function sessionProgress(s: ExamSession) {
  // session 列表不带 answers，进度直接读 duties 的汇总；duties 为空时退化为 0
  const total = s.duties.reduce((sum, row) => sum + row.total, 0)
  const done = s.duties.reduce((sum, row) => sum + row.done, 0)
  const percent = total ? Math.round((done / total) * 100) : 0
  return { done, total, percent }
}

async function loadList() {
  ;[sessions.value, papers.value] = await Promise.all([fetchExamSessions(), fetchPapers()])
}

/* ================= 新建考试 ================= */

const createOpen = ref(false)
const saving = ref(false)
const createForm = reactive({ name: '', paperId: 0, classes: [] as string[], examAt: '' })

function paperQuestionCount(p: OrgPaper) {
  return p.sections.reduce((sum, row) => sum + row.questions.length, 0)
}

function openCreate() {
  createForm.name = ''
  createForm.paperId = papers.value[0]?.id ?? 0
  createForm.classes = []
  createForm.examAt = new Date().toISOString().slice(0, 10)
  createOpen.value = true
}

async function submitCreate() {
  if (createForm.name.trim().length < 2) {
    showToast('考试名称须为 2-50 字', 'error')
    return
  }
  if (!createForm.paperId) {
    showToast('请选择一份试卷', 'error')
    return
  }
  if (!createForm.classes.length) {
    showToast('请至少选择一个参考班级', 'error')
    return
  }
  saving.value = true
  try {
    // 保存后由数据层按班级 × 试卷题目自动生成答卷，无需前端逐人建
    const created = await saveExamSession({
      name: createForm.name.trim(),
      paperId: createForm.paperId,
      classes: createForm.classes,
      examAt: createForm.examAt,
    })
    createOpen.value = false
    await loadList()
    showToast('考试已创建，答卷已生成', 'success')
    router.push(`/exam/grading?id=${created.id}`)
  } catch (error) {
    showToast(error instanceof Error ? error.message : '创建失败', 'error')
  } finally {
    saving.value = false
  }
}

async function onDelete(row: ExamSession) {
  if (!window.confirm(`删除考试《${row.name}》？相关答卷将一并清除`)) return
  await deleteExamSession(row.id)
  await loadList()
  showToast('已删除', 'success')
}

/* ================= 阅卷工作台 ================= */

const session = ref<ExamSession | null>(null)
const paper = ref<OrgPaper | null>(null)
const answers = ref<ExamAnswer[]>([])
const questionMap = ref<Record<number, OrgQuestion>>({})
const busy = ref(false)

const gradedCount = computed(() => answers.value.filter((row) => row.status !== 'pending').length)
const pendingCount = computed(() => answers.value.filter((row) => row.status === 'pending').length)
const gradingPercent = computed(() =>
  answers.value.length ? Math.round((gradedCount.value / answers.value.length) * 100) : 0,
)
const unfinished = computed(() => pendingCount.value > 0)

/** 题号全局序号：按卷面大题→小题顺序，1 起。用于分工的题号范围展示 */
const qIndexMap = computed(() => {
  const map: Record<number, number> = {}
  let i = 0
  paper.value?.sections.forEach((section) =>
    section.questions.forEach((entry) => {
      i += 1
      map[entry.questionId] = i
    }),
  )
  return map
})

function dutyRange(duty: GradingDuty) {
  const idx = duty.questionIds.map((id) => qIndexMap.value[id]).filter(Boolean)
  if (!idx.length) return '—'
  const min = Math.min(...idx)
  const max = Math.max(...idx)
  return min === max ? `第 ${min} 题` : `第 ${min}–${max} 题`
}

/** 分工进度：以本地已成功给分的题目为真相，避免整卷重拉 */
const scoredKeys = ref<Set<string>>(new Set())
function keyOf(answerId: number, questionId: number) {
  return `${answerId}:${questionId}`
}
function dutyDone(duty: GradingDuty) {
  const done = answers.value.filter((answer) => {
    if (answer.status !== 'pending') return true
    const items = answer.items.filter((it) => duty.questionIds.includes(it.questionId))
    return items.length > 0 && items.every((it) => scoredKeys.value.has(keyOf(answer.id, it.questionId)))
  }).length
  return { done, total: answers.value.length }
}

const activeDutyId = ref<number>(0)
const activeDuty = computed(() => session.value?.duties.find((row) => row.id === activeDutyId.value) ?? null)

async function openSession(id: number) {
  const [data, questions] = await Promise.all([
    fetchExamSession(id),
    fetchQuestions(),
  ])
  session.value = data.session
  paper.value = data.paper
  answers.value = data.answers
  questionMap.value = Object.fromEntries(questions.map((q) => [q.id, q]))
  scoredKeys.value = new Set()
  activeDutyId.value = data.session.duties[0]?.id ?? 0
}

watch(editingId, (id) => {
  if (id) void openSession(id)
})

function backToList() {
  session.value = null
  paper.value = null
  answers.value = []
  router.push('/exam/grading')
}

/* ================= 答卷列表（中栏） ================= */

const answerFilter = reactive({ className: '', status: '', pendingOnly: false, keyword: '' })
const answerPage = ref(1)
const answerPageSize = 8

const filteredAnswers = computed(() =>
  answers.value.filter(
    (row) =>
      (!answerFilter.className || row.className === answerFilter.className) &&
      (!answerFilter.status || row.status === answerFilter.status) &&
      (!answerFilter.pendingOnly || row.status === 'pending') &&
      (!answerFilter.keyword || row.student.includes(answerFilter.keyword)),
  ),
)
const pagedAnswers = computed(() =>
  filteredAnswers.value.slice((answerPage.value - 1) * answerPageSize, answerPage.value * answerPageSize),
)
const classOptions = computed(() => Array.from(new Set(answers.value.map((row) => row.className))))

function statusClass(status: AnswerStatus) {
  return status === 'graded'
    ? 'tag-green'
    : status === 'pending'
      ? 'tag-orange'
      : status === 'absent'
        ? 'tag-gray'
        : 'tag-red'
}

/* ================= 答卷详情（抽屉 + 逐题给分） ================= */

const detailOpen = ref(false)
const editingAnswer = ref<ExamAnswer | null>(null)
/** 本地草稿分：key 为 questionId，便于回车跳题时逐题保存 */
const draftScores = ref<Record<number, number>>({})
const scoreEls = ref<Record<number, HTMLInputElement | null>>({})

function openDetail(answer: ExamAnswer) {
  editingAnswer.value = answer
  // 用服务端已存分初始化草稿；0 视为未录入（与 saveAnswerScore 的「分值超限抛错」无关）
  draftScores.value = Object.fromEntries(answer.items.map((it) => [it.questionId, it.score]))
  detailOpen.value = true
}

function correctAnswerOf(item: AnswerItem) {
  return questionMap.value[item.questionId]?.answer ?? '—'
}

/** 保存单题分值：回车连续录入的关键一步。成功后把该 key 记入已给分集合，更新进度 */
async function saveItemScore(item: AnswerItem) {
  if (!session.value || !editingAnswer.value) return
  const score = Number(draftScores.value[item.questionId])
  if (Number.isNaN(score) || score < 0) {
    showToast('分值须为非负数', 'error')
    return
  }
  busy.value = true
  try {
    const updated = await saveAnswerScore(session.value.id, editingAnswer.value.id, item.questionId, score)
    // 用返回的最新答卷替换列表对象，总分/状态即时刷新
    const i = answers.value.findIndex((row) => row.id === updated.id)
    if (i >= 0) answers.value[i] = updated
    editingAnswer.value = updated
    scoredKeys.value.add(keyOf(updated.id, item.questionId))
  } catch (error) {
    // saveAnswerScore 在超分时抛错，这里拦住不让回车继续跳题
    showToast(error instanceof Error ? error.message : '保存失败', 'error')
  } finally {
    busy.value = false
  }
}

/** 回车：先保存当前题，再聚焦下一题输入框（快录体验） */
function onScoreEnter(item: AnswerItem) {
  void saveItemScore(item).then(() => {
    const list = editingAnswer.value?.items ?? []
    const next = list[list.findIndex((it) => it.questionId === item.questionId) + 1]
    if (next) scoreEls.value[next.questionId]?.focus()
  })
}

const remarkDraft = ref('')
async function markStatus(status: AnswerStatus) {
  if (!session.value || !editingAnswer.value) return
  busy.value = true
  try {
    const updated = await markAnswer(session.value.id, editingAnswer.value.id, status, remarkDraft.value.trim() || undefined)
    const i = answers.value.findIndex((row) => row.id === updated.id)
    if (i >= 0) answers.value[i] = updated
    editingAnswer.value = updated
    showToast(status === 'absent' ? '已标记缺考' : status === 'cheat' ? '已标记违纪' : '已恢复待阅', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '操作失败', 'error')
  } finally {
    busy.value = false
  }
}

/* ================= 分配阅卷任务 ================= */

const staffNames = ref<string[]>([])
const assignOpen = ref(false)
const assignForm = reactive({ dutyId: 0, graders: [] as string[], mode: 'single' as GradingDuty['mode'] })

function openAssign(dutyId?: number) {
  assignForm.dutyId = dutyId ?? activeDutyId.value ?? session.value?.duties[0]?.id ?? 0
  const duty = session.value?.duties.find((row) => row.id === assignForm.dutyId)
  assignForm.graders = duty?.graders ? [...duty.graders] : []
  assignForm.mode = duty?.mode ?? 'single'
  assignOpen.value = true
}

async function submitAssign() {
  if (!session.value) return
  if (!assignForm.graders.length) {
    showToast('请至少选择一名阅卷人', 'error')
    return
  }
  busy.value = true
  try {
    const updated = await assignDuty(session.value.id, assignForm.dutyId, assignForm.graders, assignForm.mode)
    session.value = updated
    assignOpen.value = false
    showToast('阅卷任务已分配', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '分配失败', 'error')
  } finally {
    busy.value = false
  }
}

async function finishSession() {
  if (!session.value) return
  busy.value = true
  try {
    // 还有未阅卷的答卷时后端会抛「还有 N 份答卷未批阅」，这里原样透出
    const updated = await finishExamSession(session.value.id)
    session.value = updated
    showToast('阅卷已结束，成绩已封存', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '结束失败', 'error')
  } finally {
    busy.value = false
  }
}

/* ================= 数据 ================= */

onMounted(async () => {
  loading.value = true
  try {
    await ensure()
    await loadList()
    if (editingId.value) await openSession(editingId.value)
  } catch (error) {
    showToast(error instanceof Error ? error.message : '载入失败', 'error')
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <!-- ================= 阅卷工作台 ================= -->
  <div v-if="session && paper" class="page">
    <div v-if="unfinished" class="gr-tip">
      <AppIcon name="warning" :size="15" />
      <span>本次考试还有 <b>{{ pendingCount }}</b> 份答卷未批阅，结束阅卷前请先完成全部给分。</span>
    </div>

    <div class="gr-head panel">
      <button class="gr-back" type="button" @click="backToList"><AppIcon name="chevron-left" :size="15" /></button>
      <div class="gr-head-main">
        <h2>{{ session.name }}</h2>
        <p class="f-hint">
          {{ paper.name }} · {{ paper.subject }} {{ paper.grade }} · 满分 {{ session.fullScore }} 分 ·
          {{ session.classes.join('、') }} · {{ session.studentCount }} 人 · {{ session.examAt }}
        </p>
      </div>
      <div class="gr-head-ops">
        <span class="tag" :class="session.status === 'finished' ? 'tag-green' : session.status === 'grading' ? 'tag-orange' : 'tag-blue'">
          {{ session.status === 'finished' ? '已结束' : session.status === 'grading' ? '阅卷中' : '待开始' }}
        </span>
        <div class="usage" style="min-width: 160px">
          <div class="num">已阅 {{ gradedCount }} / {{ answers.length }} 份</div>
          <div class="bar"><i :style="{ width: `${gradingPercent}%` }" /></div>
        </div>
        <button class="btn btn-ghost btn-sm" :disabled="busy" @click="openAssign()"><AppIcon name="users" :size="14" /> 分配阅卷任务</button>
        <button class="btn btn-ghost btn-sm" :disabled="busy || session.status === 'finished'" @click="finishSession"><AppIcon name="check" :size="14" /> 结束阅卷</button>
        <button class="btn btn-ghost btn-sm" @click="backToList"><AppIcon name="close" :size="14" /> 返回列表</button>
      </div>
    </div>

    <div class="gr-body">
      <!-- 左：阅卷分工 -->
      <aside class="panel gr-duties">
        <div class="section-title" style="margin-bottom: 10px">阅卷分工（按大题）</div>
        <p v-if="!session.duties.length" class="f-hint">尚未分配阅卷任务，点上方「分配阅卷任务」按大题指派阅卷人。</p>
        <div
          v-for="duty in session.duties"
          :key="duty.id"
          class="gr-duty"
          :class="{ on: activeDutyId === duty.id }"
          @click="activeDutyId = duty.id"
        >
          <div class="gr-duty-top">
            <b>{{ duty.sectionTitle }}</b>
            <span class="tag" :class="duty.mode === 'double' ? 'tag-orange' : 'tag-gray'">
              {{ duty.mode === 'double' ? '双评' : '单评' }}
            </span>
          </div>
          <div class="gr-duty-range">{{ dutyRange(duty) }} · 阅卷人：{{ duty.graders.join('、') || '未分配' }}</div>
          <div class="usage" style="margin: 6px 0">
            <div class="num">{{ dutyDone(duty).done }} / {{ dutyDone(duty).total }} 份</div>
            <div class="bar"><i :style="{ width: `${dutyDone(duty).total ? Math.round((dutyDone(duty).done / dutyDone(duty).total) * 100) : 0}%` }" /></div>
          </div>
          <button class="mini-btn" style="align-self: flex-start" @click.stop="openAssign(duty.id)"><AppIcon name="users" :size="12" /> 分配</button>
        </div>
      </aside>

      <!-- 中：答卷列表 -->
      <main class="panel gr-answers">
        <div class="gr-ans-head">
          <div class="section-title">答卷（{{ filteredAnswers.length }} 份）</div>
          <div class="gr-ans-filters">
            <select v-model="answerFilter.className" class="f-select">
              <option value="">全部班级</option>
              <option v-for="c in classOptions" :key="c" :value="c">{{ c }}</option>
            </select>
            <select v-model="answerFilter.status" class="f-select">
              <option value="">全部状态</option>
              <option v-for="(text, s) in ANSWER_STATUS_TEXT" :key="s" :value="s">{{ text }}</option>
            </select>
            <label class="gr-check"><input v-model="answerFilter.pendingOnly" type="checkbox" /> 仅待阅</label>
            <input v-model="answerFilter.keyword" class="f-input" placeholder="搜索学生" />
          </div>
        </div>

        <div class="gr-ans-list">
          <p v-if="!pagedAnswers.length" class="empty-row">
            {{ loading ? '正在载入…' : '没有符合条件的答卷' }}
          </p>
          <div
            v-for="answer in pagedAnswers"
            :key="answer.id"
            class="gr-ans-card"
            :class="{ on: editingAnswer?.id === answer.id }"
            @click="openDetail(answer)"
          >
            <div class="gr-ans-top">
              <b>{{ answer.student }}</b>
              <span class="tag" :class="statusClass(answer.status)">{{ ANSWER_STATUS_TEXT[answer.status] }}</span>
            </div>
            <p class="gr-ans-meta">{{ answer.className }} · 当前 {{ answer.total }} 分</p>
            <div class="usage" style="margin-top: 4px">
              <div class="num">已给 {{ answer.items.filter((it) => it.score > 0).length }} / {{ answer.items.length }} 题</div>
              <div class="bar"><i :style="{ width: `${answer.items.length ? Math.round((answer.items.filter((it) => it.score > 0).length / answer.items.length) * 100) : 0}%` }" /></div>
            </div>
          </div>
        </div>
        <AppPagination :total="filteredAnswers.length" v-model:page="answerPage" :page-size="answerPageSize" />
      </main>
    </div>

    <!-- 答卷详情抽屉：逐题给分 + 异常标记 -->
    <AppDrawer
      v-if="editingAnswer"
      :title="`${editingAnswer.student} 的答卷`"
      :subtitle="`${editingAnswer.className} · 总分 ${editingAnswer.total} / ${session.fullScore}`"
      :width="620"
      @close="detailOpen = false"
    >
      <div class="gr-detail">
        <div class="gr-detail-status">
          <span class="tag" :class="statusClass(editingAnswer.status)">{{ ANSWER_STATUS_TEXT[editingAnswer.status] }}</span>
          <div class="op-group">
            <button class="mini-btn danger" :disabled="busy" @click="markStatus('absent')">标记缺考</button>
            <button class="mini-btn danger" :disabled="busy" @click="markStatus('cheat')">标记违纪</button>
            <button class="mini-btn" :disabled="busy" @click="markStatus('pending')">恢复待阅</button>
          </div>
        </div>

        <div v-for="item in editingAnswer.items" :key="item.questionId" class="gr-q">
          <div class="gr-q-head">
            <span class="gr-q-no">{{ item.qIndex }}</span>
            <div class="gr-q-meta">
              <span class="tag tag-gray">{{ item.type }}</span>
              <span v-for="k in item.knowledge" :key="k" class="tag tag-gray">{{ k }}</span>
              <span class="f-hint">满分 {{ item.full }}</span>
            </div>
          </div>
          <div class="gr-q-body">
            <p class="gr-q-line"><b>本题作答：</b><RichTextViewer :content="item.answer" tag="span" /></p>
            <p class="gr-q-line ok"><b>参考答案：</b><RichTextViewer :content="correctAnswerOf(item)" tag="span" /></p>
            <div class="gr-q-score">
              <label class="f-label">给分</label>
              <input
                :ref="(el) => (scoreEls[item.questionId] = (el as HTMLInputElement) || null)"
                v-model.number="draftScores[item.questionId]"
                class="f-input"
                type="number"
                :min="0"
                :max="item.full"
                :disabled="busy"
                @keyup.enter="onScoreEnter(item)"
              />
              <span class="f-hint">/ {{ item.full }} 分，回车保存并跳下一题</span>
              <button class="mini-btn" :disabled="busy" @click="saveItemScore(item)">保存本题</button>
            </div>
          </div>
        </div>

        <div class="gr-remark">
          <label class="f-label">异常备注（缺考/违纪时必填）</label>
          <input v-model="remarkDraft" class="f-input" placeholder="如：迟到 20 分钟、夹带纸条" />
        </div>
      </div>
    </AppDrawer>
  </div>

  <!-- ================= 列表 ================= -->
  <div v-else-if="!loading || sessions.length" class="page">
    <AppPageHeader desc="把一份试卷下发到班级、分配阅卷人、逐题录入成绩，结束阅卷后成绩进入试卷分析。">
      <template #actions>
        <button class="btn btn-primary" @click="openCreate"><AppIcon name="plus" :size="15" /> 新建考试</button>
      </template>
    </AppPageHeader>

    <div class="panel">
      <div class="gr-grid">
        <p v-if="!sessions.length" class="empty-row" style="grid-column: 1 / -1">
          {{ loading ? '正在载入…' : '暂无考试，点击右上角新建' }}
        </p>
        <div v-for="row in sessions" :key="row.id" class="gr-card">
          <div class="gr-card-top">
            <h3>{{ row.name }}</h3>
            <span class="tag" :class="row.status === 'finished' ? 'tag-green' : row.status === 'grading' ? 'tag-orange' : 'tag-blue'">
              {{ row.status === 'finished' ? '已结束' : row.status === 'grading' ? '阅卷中' : '待开始' }}
            </span>
          </div>
          <p class="gr-card-meta">{{ row.subject }} {{ row.grade }} · {{ row.paperName }}</p>
          <p class="gr-card-meta">{{ row.classes.join('、') }} · {{ row.studentCount }} 人 · {{ row.examAt }}</p>
          <div class="usage" style="margin: 8px 0">
            <div class="num">已阅 {{ sessionProgress(row).done }} / {{ sessionProgress(row).total }}</div>
            <div class="bar"><i :style="{ width: `${sessionProgress(row).percent}%` }" /></div>
          </div>
          <div class="op-group">
            <button class="mini-btn" @click="router.push(`/exam/grading?id=${row.id}`)">进入阅卷</button>
            <button class="mini-btn" @click="router.push(`/exam/grading?id=${row.id}`)">分配任务</button>
            <button class="mini-btn danger" @click="onDelete(row)">删除</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 新建考试 -->
    <AppModal v-if="createOpen" title="新建考试" :width="600" @close="createOpen = false">
      <div class="f-field">
        <label class="f-label">考试名称<span class="req">*</span></label>
        <input v-model="createForm.name" class="f-input" maxlength="50" placeholder="如：高一数学 10 月月考" />
      </div>
      <div class="f-field">
        <label class="f-label">试卷<span class="req">*</span></label>
        <select v-model.number="createForm.paperId" class="f-select">
          <option v-for="p in papers" :key="p.id" :value="p.id">{{ p.name }}（{{ paperQuestionCount(p) }} 题）</option>
        </select>
      </div>
      <div class="f-field">
        <label class="f-label">参考班级<span class="req">*</span></label>
        <div class="gr-classes">
          <label v-for="c in CLASS_NAMES" :key="c" class="gr-class">
            <input v-model="createForm.classes" type="checkbox" :value="c" /> {{ c }}
          </label>
        </div>
      </div>
      <div class="f-field">
        <label class="f-label">考试日期</label>
        <input v-model="createForm.examAt" class="f-input" type="date" />
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="createOpen = false">取消</button>
        <button class="btn btn-primary" :disabled="saving" @click="submitCreate">{{ saving ? '创建中…' : '创建并生成答卷' }}</button>
      </template>
    </AppModal>
  </div>

  <!-- 分配阅卷任务 -->
  <AppModal v-if="assignOpen && session" title="分配阅卷任务" :width="520" @close="assignOpen = false">
    <p class="f-hint" style="margin-bottom: 12px">
      为「{{ session.duties.find((row) => row.id === assignForm.dutyId)?.sectionTitle ?? '—' }}」选择阅卷人，双评需两人独立给分、分差超限进仲裁。
    </p>
    <div class="f-field">
      <label class="f-label">阅卷方式</label>
      <select v-model="assignForm.mode" class="f-select">
        <option value="single">单评（一人定分）</option>
        <option value="double">双评（两人独立给分）</option>
      </select>
    </div>
    <div class="f-field">
      <label class="f-label">阅卷人（{{ assignForm.graders.length }} 人）</label>
      <div class="gr-classes">
        <label v-for="name in staffNames" :key="name" class="gr-class">
          <input v-model="assignForm.graders" type="checkbox" :value="name" /> {{ name }}
        </label>
      </div>
      <p v-if="!staffNames.length" class="f-hint">员工表为空，请先在「员工管理」添加阅卷人。</p>
    </div>
    <template #footer>
      <button class="btn btn-ghost" @click="assignOpen = false">取消</button>
      <button class="btn btn-primary" :disabled="busy" @click="submitAssign">确认分配</button>
    </template>
  </AppModal>
</template>

<style scoped>
.gr-tip {
  display: flex; align-items: center; gap: 8px;
  background: var(--warn-soft); color: var(--warn);
  border: 1px solid var(--warn-soft); border-radius: 10px;
  padding: 9px 14px; font-size: 13px;
}
.gr-tip b { color: var(--warn); }

.gr-head { display: flex; align-items: center; gap: 12px; padding: 14px 16px; }
.gr-back {
  width: 34px; height: 34px; flex-shrink: 0;
  border: 1px solid var(--border); border-radius: 9px; background: #fff; color: var(--ink-2);
  display: flex; align-items: center; justify-content: center;
}
.gr-back:hover { border-color: var(--brand); color: var(--brand-deep); }
.gr-head-main { flex: 1; min-width: 0; }
.gr-head-main h2 { font-size: 16.5px; font-weight: 700; }
.gr-head-ops { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; flex-shrink: 0; }

.gr-body { display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 12px; align-items: start; }

/* 左：分工 */
.gr-duties { padding: 14px; position: sticky; top: 0; max-height: calc(100vh - 150px); overflow-y: auto; }
.gr-duty {
  border: 1.5px solid var(--border); border-radius: 11px; padding: 10px 12px; margin-bottom: 8px;
  display: flex; flex-direction: column; gap: 4px; cursor: pointer; background: #fff;
}
.gr-duty:hover { border-color: var(--brand); }
.gr-duty.on { border-color: var(--brand); background: var(--brand-soft); }
.gr-duty-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.gr-duty-top b { font-size: 13px; }
.gr-duty-range { font-size: 12px; color: var(--ink-2); }

/* 中：答卷 */
.gr-answers { padding: 14px; display: flex; flex-direction: column; }
.gr-ans-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
.gr-ans-filters { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
/* 自写横向工具条：下拉 / 输入框不能吃满整行，高度与行内其它控件一致 */
.gr-ans-filters .f-select { width: auto; min-width: 118px; flex-shrink: 0; height: var(--ctrl-h); }
.gr-ans-filters .f-input { width: 150px; flex-shrink: 0; height: var(--ctrl-h); }
.gr-check { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--ink-2); }
.gr-check input { accent-color: var(--brand); }
.gr-ans-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.gr-ans-card {
  border: 1.5px solid var(--border); border-radius: 11px; padding: 10px 12px; cursor: pointer; background: #fff;
}
.gr-ans-card:hover { border-color: var(--brand); }
.gr-ans-card.on { border-color: var(--brand); background: var(--brand-soft); }
.gr-ans-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.gr-ans-top b { font-size: 13.5px; }
.gr-ans-meta { font-size: 12px; color: var(--sub); margin-top: 4px; }

/* 详情抽屉 */
.gr-detail { display: flex; flex-direction: column; gap: 12px; }
.gr-detail-status { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.gr-q { border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; background: #fbfdfd; }
.gr-q-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.gr-q-no {
  width: 22px; height: 22px; flex-shrink: 0; border-radius: 7px;
  background: var(--brand-soft); color: var(--brand-deep);
  font-size: 12px; font-weight: 700; display: flex; align-items: center; justify-content: center;
}
.gr-q-meta { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.gr-q-line { font-size: 12.5px; color: var(--ink-2); line-height: 1.6; margin-top: 4px; }
.gr-q-line.ok { color: var(--success); }
.gr-q-score { display: flex; align-items: center; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
.gr-q-score .f-input { width: 90px; flex-shrink: 0; height: var(--ctrl-h); }
.gr-q-score .f-hint { margin-top: 0; }
.gr-remark { border-top: 1px dashed var(--border); padding-top: 12px; }

/* 列表 */
.gr-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; padding: 16px; }
.gr-card {
  border: 1.5px solid var(--border); border-radius: 12px; padding: 14px;
  display: flex; flex-direction: column; gap: 8px;
}
.gr-card:hover { border-color: var(--brand); box-shadow: var(--shadow); }
.gr-card-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.gr-card-top h3 { font-size: 14px; font-weight: 700; line-height: 1.5; }
.gr-card-meta { font-size: 12px; color: var(--sub); }
.gr-classes { display: flex; flex-wrap: wrap; gap: 6px 14px; }
.gr-class { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; color: var(--ink-2); }
.gr-class input { accent-color: var(--brand); }
</style>
