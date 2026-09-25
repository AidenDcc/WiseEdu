<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AppIcon, RichTextViewer, showToast, ApiError, hasImage, toPlainText, truncateRich } from '@aiteach/shared'
import type { GeneratedQuestion, OrgCategory, OrgQuestion } from '@aiteach/shared'
import AppModal from '@/components/ui/AppModal.vue'
import RichTextEditor from '@/components/ui/RichTextEditor.vue'
import QuestionResultList from '@/components/question/QuestionResultList.vue'
import { adoptGenerated, fetchCategories, fetchQuestions, fetchQuota, saveQuestion, variantOf } from '@/api/org'
import { checkQuestionByAi } from '@/api/ai-check'
import type { AiCheckReport } from '@/api/ai-check'
import { alignKnowledgeToPool } from '@/api/ai-photo'
import { aiEngine, generateByAi } from '@/api/ai-generate'
import { getCheckRounds, setCheckRounds, verifyQuestionsByAi, type AiVerifyReport, type VerifyIssue } from '@/api/ai-verify'
import { useBaseData } from '@/composables/useBaseData'
import { useKnowledgePool } from '@/composables/useKnowledgePool'
import { useScope } from '@/composables/useScope'

const route = useRoute()
const router = useRouter()

const { subjects, grades, questionTypes, difficulties, examTypes, versionsFor, optionsForGrade, ensure, pick, withCurrent, optionLabel } = useBaseData()
/** 顶部栏的全局年级 / 学科：表单初值与出题参数的默认值 */
const { grade: scopeGrade, subject: scopeSubject, ensureScope } = useScope()

/** 学期保留短名，与题目 question.term 的存储形式一致（字典里的 term 是「2025-2026 上学期」全名） */
const TERMS = ['上学期', '下学期']

/** 判断题固定两项 */
const isChoice = computed(() => form.type === '单选题' || form.type === '多选题' || form.type === '判断题')

/* ===== 录题方式：手动录入 / AI 出题 =====
   两种方式共用上面同一套「题目基本信息」，下面切标签换录入方式，故合在一页里。

   模式写进 URL（`?mode=ai`）—— 这是本仓第一个入 URL 的视图态（题库的表格/详细切换是本地 ref）。
   破例的理由：旧地址 /question/ai 靠函数式 redirect 注入模式进来（否则重定向后落在手动态），
   且出题参数面板应当可分享、刷新后不丢。 */
const editId = computed(() => Number(route.query.id ?? 0))
/** 变式模式（FR-TM-016）：从题库「AI 变式」进入，出题参数以母题为准 */
const variantOfId = computed(() => Number(route.query.variantOf ?? 0))

function initialMode(): 'manual' | 'ai' {
  /* 编辑既有题目时只能是手动录入（AI 出题针对的是新题）；变式模式与 ?mode=ai 直接进 AI */
  if (editId.value) return 'manual'
  return variantOfId.value || route.query.mode === 'ai' ? 'ai' : 'manual'
}

const mode = ref<'manual' | 'ai'>(initialMode())

function switchMode(next: 'manual' | 'ai'): void {
  if (next === mode.value) return
  /* 编辑既有题目时不提供 AI 出题（按钮也是禁用态，这里再兜一层直接改 URL 的情况） */
  if (next === 'ai' && editId.value) return
  mode.value = next
  /* replace 而非 push：切标签不该在浏览器历史里堆记录，返回键仍应是「离开本页」 */
  const query = { ...route.query }
  if (next === 'ai') query.mode = 'ai'
  else delete query.mode
  void router.replace({ query })
}

/* ===== 表单（FR-TM-008 ~ 012） ===== */
const form = reactive({
  subject: scopeSubject.value,
  grade: scopeGrade.value,
  type: '单选题',
  difficulty: '中等',
  knowledge: [] as string[],
  textbook: '',
  term: '上学期',
  examType: '',
  sourceRemark: '',
  stem: '',
  options: ['', '', '', ''],
  answers: [] as number[],
  fillAnswers: [{ value: '', equivalents: '' }],
  essayAnswer: '',
  analysis: '',
  /* 所属库 / 分类不再出现在表单里（录题时先想「放哪」是多余的一道题），新建一律落到个人题库的
     默认分类；保存时由 save() 兜底补 categoryId。编辑存量题仍按原值回写，故字段保留。 */
  library: 'personal' as 'personal' | 'org' | 'wrong',
  categoryId: null as number | null,
})
const errors = reactive<Record<string, string>>({})
const saving = ref(false)
const dirty = ref(false)

const categories = ref<OrgCategory[]>([])

/* 知识点池按当前「年级 / 学科 / 教材版本」实时取，替代原先写死的数学知识点。
   AI 出题不看教材版本（那一行在 AI 态是隐藏的），故 AI 态传空串 —— 否则会被一个
   用户看不见的值收窄知识点选项。 */
const { pool: knowledgePool } = useKnowledgePool(() => ({
  grade: form.grade,
  subject: form.subject,
  version: mode.value === 'ai' ? '' : form.textbook,
}))
/** 已选但不在当前池中的知识点（如切换学科前选的）保留可选，避免被静默清空 */
const orphanKnowledge = computed(() => form.knowledge.filter((k) => !knowledgePool.value.includes(k)))
const knowledgeOptions = computed(() => [...knowledgePool.value, ...orphanKnowledge.value])
/** 教材版本随年级 + 学科联动；已绑定但不在新列表中的旧值仍保留 */
const versionOptions = computed(() => withCurrent(versionsFor(form.grade, form.subject), form.textbook))

/** 学科选项随年级收窄（多数年级开不齐全量学科），规则与顶部栏同一份：
    教材矩阵缺该年级则退回全量学科；当前学科不在其中时仍并入，供存量题保留原值。 */
const subjectOptions = computed(() => withCurrent(optionsForGrade(form.grade), form.subject))

/** 选年级：学科随之收窄 —— 新年级没有当前学科时落到该年级首个学科，避免存出无效组合 */
function pickGrade(value: string) {
  if (value === form.grade) return
  form.grade = value
  const options = optionsForGrade(value)
  if (options.length > 0 && !options.includes(form.subject)) form.subject = options[0] ?? form.subject
}

/** 题目基本信息折叠态：默认展开，收起后参数面板只留标题条（长表单滚动更省） */
const metaOpen = ref(true)

/** 年级或学科变化后，原教材版本可能已不适用 —— 清空，避免存出无效组合。
    AI 态跳过：教材版本那一行在 AI 态是隐藏的，清掉用户看不见，切回手动态才发现绑定没了。 */
watch([() => form.grade, () => form.subject], () => {
  if (mode.value === 'ai') return
  if (form.textbook && !versionsFor(form.grade, form.subject).includes(form.textbook)) form.textbook = ''
})

/** 顶部栏切换年级 / 学科时同步表单：手动态仅限未动过的新建表单，AI 出题则总是跟随
    （出题参数就是取自这里，不跟随会用错学段）；变式模式以母题为准，不打扰。 */
watch([scopeGrade, scopeSubject], () => {
  if (variantOfId.value) return
  if (mode.value === 'manual' && (editId.value || dirty.value)) return
  form.grade = pick(grades.value, scopeGrade.value)
  form.subject = pick(subjects.value, scopeSubject.value)
})

async function load() {
  await ensure()
  await ensureScope()
  ;[categories.value] = await Promise.all([fetchCategories()])
  const id = editId.value
  if (!id) {
    /* 新建：默认取顶部栏的全局年级 / 学科，并归一为当前启用字典内的值 */
    form.subject = pick(subjects.value, scopeSubject.value)
    form.grade = pick(grades.value, scopeGrade.value)
    form.type = pick(questionTypes.value, form.type)
    form.difficulty = pick(difficulties.value, form.difficulty)
    form.examType = pick(examTypes.value, form.examType)
  }
  if (variantOfId.value) {
    /* 变式的出题参数以母题为准（题型不照搬「多选题」：变式题通常改问法，按单选出更稳） */
    const all = await fetchQuestions()
    variantSource.value = all.find((row) => row.id === variantOfId.value) ?? null
    if (variantSource.value) {
      Object.assign(form, {
        subject: variantSource.value.subject,
        grade: variantSource.value.grade,
        type: variantSource.value.type === '多选题' ? '单选题' : variantSource.value.type,
        knowledge: [...variantSource.value.knowledge],
      })
      ai.strategies = ['数值替换']
    }
  }
  if (id) {
    const all = await fetchQuestions()
    const source = all.find((row) => row.id === id)
    if (source) {
      Object.assign(form, {
        subject: source.subject,
        grade: source.grade,
        type: source.type,
        difficulty: source.difficulty,
        knowledge: [...source.knowledge],
        textbook: source.textbook ?? '',
        term: source.term ?? '上学期',
        examType: source.examType ?? '',
        sourceRemark: source.sourceRemark ?? '',
        stem: source.stem,
        library: source.library,
        categoryId: source.categoryId,
        analysis: source.analysis,
      })
      lastType = source.type
      if (source.options.length > 0) {
        form.options = [...source.options]
        form.answers = source.answer.split('').map((ch) => 'ABCDEF'.indexOf(ch)).filter((i) => i >= 0)
      } else if (source.type === '填空题') {
        form.fillAnswers = [{ value: source.answer, equivalents: '' }]
      } else {
        form.essayAnswer = source.answer
      }
    }
  }
  quota.value = await fetchQuota()
}

/** 富文本下 `<p></p>` 的 trim() 非空，判空必须看纯文本；只含图片的内容也算有值 */
function hasContent(value: string): boolean {
  return Boolean(toPlainText(value).trim()) || hasImage(value)
}

let lastType = '单选题'
function onTypeChange() {
  if (hasContent(form.stem) || form.options.some((opt) => hasContent(opt))) {
    if (!window.confirm('切换题型将清空选项结构，确认切换？')) {
      form.type = lastType
      return
    }
  }
  lastType = form.type
  form.answers = []
  form.options = form.type === '判断题' ? ['正确', '错误'] : ['', '', '', '']
  form.fillAnswers = [{ value: '', equivalents: '' }]
}

/** chip 版题型切换：先落值再走上面那套确认逻辑。
    点当前已选中的题型直接返回 —— 下拉的 change 只在真的换值时触发，而 chip 的 click 每次都会触发。
    **AI 态只改出题参数、不动选项结构**：手动态已填的题干/选项不该因为换个生成题型被清掉。 */
function pickType(type: string) {
  if (type === form.type) return
  if (mode.value === 'ai') {
    form.type = type
    return
  }
  form.type = type
  onTypeChange()
}

function addOption() {
  if (form.options.length >= 6) {
    showToast('选项最多 6 个', 'error')
    return
  }
  form.options.push('')
}

function removeOption(index: number) {
  if (form.options.length <= 2) {
    showToast('选项至少 2 个', 'error')
    return
  }
  form.options.splice(index, 1)
  form.answers = form.answers.filter((i) => i !== index).map((i) => (i > index ? i - 1 : i))
}

function toggleAnswer(index: number) {
  if (form.type === '单选题' || form.type === '判断题') {
    form.answers = [index]
  } else {
    const pos = form.answers.indexOf(index)
    if (pos >= 0) form.answers.splice(pos, 1)
    else form.answers.push(index)
  }
}

function toggleKnowledge(item: string) {
  const pos = form.knowledge.indexOf(item)
  if (pos >= 0) form.knowledge.splice(pos, 1)
  else {
    if (form.knowledge.length >= 5) {
      showToast('知识点最多 5 个', 'error')
      return
    }
    form.knowledge.push(item)
  }
}

const answerText = computed(() => {
  if (isChoice.value) {
    if (form.answers.length === 0) return ''
    return [...form.answers].sort().map((i) => 'ABCDEF'[i]).join('')
  }
  if (form.type === '填空题') return form.fillAnswers.map((row) => row.value).join('｜')
  return form.essayAnswer
})

/** 校验：draft=true 仅校验必填属性；draft=false 全量校验（FR-TM-012） */
function validate(full: boolean): boolean {
  Object.keys(errors).forEach((key) => delete errors[key])
  if (!form.knowledge.length) errors.knowledge = '请选择知识点（最多 5 个）'
  if (full) {
    if (!hasContent(form.stem)) errors.stem = '题干不能为空'
    if (isChoice.value) {
      if (form.options.some((opt) => !hasContent(opt))) errors.options = '每项选项必填'
      if (form.answers.length === 0 || (form.type === '多选题' && form.answers.length < 2)) {
        errors.options = errors.options || (form.type === '多选题' ? '多选题须标记 ≥2 个正确答案' : '请设置正确答案')
      }
    }
    if (form.type === '填空题' && form.fillAnswers.some((row) => !row.value.trim())) errors.answer = '每空答案必填'
    if (form.type === '解答题' && !hasContent(form.essayAnswer)) errors.answer = '解答题答案必填'
    if (!hasContent(form.analysis) && !window.confirm('解析为空（选填），提交审核时建议补充解析，确认继续提交？')) return false
  }
  if (form.sourceRemark.length > 100) errors.sourceRemark = '来源备注 ≤100 字'
  return Object.keys(errors).length === 0
}

async function save(submit: boolean) {
  if (!validate(submit)) {
    /* 基本信息的红字在收起态是看不见的，校验失败时展开，否则用户只看到一句「按红字提示修正」 */
    if (errors.knowledge) metaOpen.value = true
    showToast('请按红字提示修正后重试', 'error')
    return
  }
  saving.value = true
  try {
    await saveQuestion({
      id: editId.value || undefined,
      stem: form.stem,
      subject: form.subject,
      grade: form.grade,
      type: form.type,
      difficulty: form.difficulty,
      knowledge: form.knowledge,
      textbook: form.textbook || undefined,
      term: form.term,
      examType: form.examType || undefined,
      sourceRemark: form.sourceRemark || undefined,
      options: isChoice.value ? form.options.filter((opt) => hasContent(opt)) : [],
      answer: answerText.value,
      analysis: form.analysis,
      library: form.library,
      categoryId: form.categoryId ?? categories.value.find((row) => row.parentId != null)?.id,
      submit,
    })
    showToast(
      submit ? '已提交：多智能体校验中，完成后推送终审待办' : '草稿已保存',
      'success',
    )
    router.push('/question/bank')
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : '保存失败', 'error')
  } finally {
    saving.value = false
  }
}

/* ===== AI 检测（质检 + 缺失答案/解析补充，结论可回写表单） ===== */
const checkOpen = ref(false)
const checkPhase = ref<'running' | 'done' | 'failed'>('running')
const checkProgress = ref(0)
const checkFailReason = ref('')
const checkReport = ref<AiCheckReport | null>(null)
let checkTimer = 0

const OVERALL_TEXT = { pass: '检测通过', warn: '建议关注', fail: '需修正' } as const
const LEVEL_TEXT = { ok: '正常', warn: '提示', error: '错误' } as const

function checkInput() {
  return {
    subject: form.subject,
    grade: form.grade,
    type: form.type,
    difficulty: form.difficulty,
    knowledge: [...form.knowledge],
    stem: form.stem,
    options: isChoice.value ? form.options.filter((opt) => hasContent(opt)) : [],
    answer: answerText.value,
    analysis: form.analysis,
  }
}

async function runCheck() {
  checkOpen.value = true
  checkPhase.value = 'running'
  checkProgress.value = 0
  checkReport.value = null
  checkFailReason.value = ''
  /* 与 AI 出题同一套假进度：接口未返回前先走到 97%，完成后补满 */
  window.clearInterval(checkTimer)
  checkTimer = window.setInterval(() => {
    checkProgress.value = Math.min(97, checkProgress.value + 5 + Math.random() * 6)
  }, 260)
  try {
    checkReport.value = await checkQuestionByAi(checkInput())
    checkPhase.value = 'done'
  } catch (error) {
    checkFailReason.value = error instanceof Error ? error.message : '检测失败'
    checkPhase.value = 'failed'
  } finally {
    window.clearInterval(checkTimer)
    checkProgress.value = 100
  }
}

function closeCheck() {
  window.clearInterval(checkTimer)
  checkOpen.value = false
}

/** AI 建议与当前表单是否有实质差异（纯文本比较，忽略 HTML 标签差异） */
function fieldDiffers(current: string, next: string): boolean {
  return toPlainText(current).trim() !== toPlainText(next).trim()
}

const corrected = computed(() => checkReport.value?.corrected)

/** 逐字段修正建议（与当前值有差异才列出）；answer 仅当非选项结构差异时单列 */
const corrections = computed(() => {
  const c = corrected.value
  if (!c) return [] as Array<{ field: string; label: string; value: string }>
  const rows: Array<{ field: string; label: string; value: string }> = []
  if (fieldDiffers(form.stem, c.stem)) rows.push({ field: 'stem', label: '题干', value: c.stem })
  if (isChoice.value && c.options.length) {
    const cur = form.options.map((opt) => toPlainText(opt).trim()).join('｜')
    const next = c.options.map((opt) => toPlainText(opt).trim()).join('｜')
    if (cur !== next) rows.push({ field: 'options', label: '选项与正确项', value: c.options.join('<br>') })
  }
  if (fieldDiffers(answerText.value, c.answer)) rows.push({ field: 'answer', label: '答案', value: c.answer })
  if (fieldDiffers(form.analysis, c.analysis)) rows.push({ field: 'analysis', label: '解析', value: c.analysis })
  return rows
})

/** 基本信息修正建议（学科/年级/难度/知识点与表单不一致时） */
const metaCorrection = computed(() => {
  const c = corrected.value
  if (!c) return null
  const parts: string[] = []
  if (c.subject && c.subject !== form.subject && subjects.value.includes(c.subject)) parts.push(`学科 ${form.subject} → ${c.subject}`)
  if (c.grade && c.grade !== form.grade && grades.value.includes(c.grade)) parts.push(`年级 ${form.grade} → ${c.grade}`)
  if (c.difficulty && c.difficulty !== form.difficulty && difficulties.value.includes(c.difficulty)) {
    parts.push(`难度 ${form.difficulty} → ${c.difficulty}`)
  }
  const aligned = (c.knowledge ?? [])
    .map((name) => alignKnowledgeToPool(name, knowledgePool.value))
    .filter((name) => name && !form.knowledge.includes(name))
  if (aligned.length) parts.push(`知识点建议：${aligned.join('、')}`)
  return parts.length ? { text: parts.join('；'), knowledge: aligned } : null
})

function applyCorrection(field: string) {
  const c = corrected.value
  if (!c) return
  if (field === 'stem') form.stem = c.stem
  else if (field === 'options') {
    form.options = [...c.options]
    form.answers = c.answer
      .toUpperCase()
      .replace(/[^A-F]/g, '')
      .split('')
      .map((ch) => 'ABCDEF'.indexOf(ch))
      .filter((i) => i >= 0)
  } else if (field === 'answer') {
    if (isChoice.value) {
      form.answers = c.answer
        .toUpperCase()
        .replace(/[^A-F]/g, '')
        .split('')
        .map((ch) => 'ABCDEF'.indexOf(ch))
        .filter((i) => i >= 0)
    } else if (form.type === '填空题') {
      form.fillAnswers = c.answer.split('｜').map((value) => ({ value: value.trim(), equivalents: '' }))
    } else {
      form.essayAnswer = c.answer
    }
  } else if (field === 'analysis') {
    form.analysis = c.analysis
  }
  dirty.value = true
  showToast('已回写到表单', 'success')
}

function applyMetaCorrection() {
  const c = corrected.value
  const meta = metaCorrection.value
  if (!c || !meta) return
  if (c.subject && subjects.value.includes(c.subject)) form.subject = c.subject
  if (c.grade && grades.value.includes(c.grade)) form.grade = c.grade
  if (c.difficulty && difficulties.value.includes(c.difficulty)) form.difficulty = c.difficulty
  if (meta.knowledge.length) {
    form.knowledge = [...new Set([...form.knowledge, ...meta.knowledge])].slice(0, 5)
  }
  dirty.value = true
  showToast('基本信息已回写', 'success')
}

function applyAllCorrections() {
  corrections.value.forEach((row) => applyCorrection(row.field))
  applyMetaCorrection()
}

/* ===== AI 出题（FR-TM-013 ~ 016） ===== */

/** 变式策略（可多选） */
const STRATEGIES = ['数值替换', '情境改编', '条件反转', '问法变换']

/** AI 出题专用参数：学科 / 年级 / 题型 / 难度 / 知识点一律取自上面的共用表单 */
const ai = reactive({
  count: 5,
  strategies: [] as string[],
})

/** 生成引擎：已配置 Deepseek Key 走真实模型，否则本地演示数据 */
const engine = ref<'deepseek' | 'mock'>(aiEngine())
/** 最近一次真实生成的 token 消耗（结果阶段展示） */
const lastTokens = ref(0)

const quota = ref({ used: 0, quota: 1000 })
/** 本次生成预计消耗（FR-TM-015） */
const estimate = computed(() => ai.count)
const remain = computed(() => quota.value.quota - quota.value.used)
const insufficient = computed(() => estimate.value > remain.value)

/** 检查轮次（0=关闭，1~3）。注意这是**全局键**：与拍照识题、文档识别共用同一份设置 */
const checkRounds = ref(getCheckRounds())
function onRoundsChange() {
  setCheckRounds(checkRounds.value)
}

/** 变式母题（?variantOf=） */
const variantSource = ref<OrgQuestion | null>(null)

const phase = ref<'idle' | 'running' | 'result'>('idle')
const busy = computed(() => phase.value === 'running')
const progress = ref(0)
const results = ref<GeneratedQuestion[]>([])
/** 已采纳 / 已转入手动编辑：都按题目 id 记 —— 丢弃中间一题不会让标记错位 */
const adoptedIds = ref<Set<string>>(new Set())
const handedOff = ref<Set<string>>(new Set())
/** 最后一轮质检结论（按题目 id 索引），与 results 同步重建 */
const issueById = ref<Record<string, VerifyIssue>>({})
/** 最近一次质检报告（告警条 / 通过条 / 逐题质检标用） */
const verifyReport = ref<AiVerifyReport | null>(null)
/** 运行阶段的质检进度文案 */
const verifyStage = ref('')

/** 待处理题数：既没采纳也没转手动编辑（重新生成会丢的正是这些） */
const pendingCount = computed(
  () => results.value.filter((row) => !adoptedIds.value.has(row.id) && !handedOff.value.has(row.id)).length,
)

/** 把逐轮调用（每轮 rounds=1）的报告合并成一份：轮次连续编号、token 累加 */
function mergeRoundReport(prev: AiVerifyReport | null, next: AiVerifyReport): AiVerifyReport {
  if (!prev) return next
  const base = prev.rounds.length
  return {
    ...next,
    rounds: [...prev.rounds, ...next.rounds.map((r) => ({ ...r, round: base + r.round }))],
    tokens: prev.tokens + next.tokens,
  }
}

/**
 * 质检结论按题目 id 建索引（取最后一轮）。必须在质检结束时一次性建好：
 * 质检报告里的 index 是**当时那一轮的题目下标**，用户之后丢弃中间一题，下标就全错位了 ——
 * 直接拿 index 渲染会让标签挂到别的题上。修正版（corrected）会替换 results，所以要在替换之后再建。
 */
function buildIssueMap(list: GeneratedQuestion[], report: AiVerifyReport | null): Record<string, VerifyIssue> {
  const last = report?.rounds[report.rounds.length - 1]
  const map: Record<string, VerifyIssue> = {}
  if (!last) return map
  for (const issue of last.issues) {
    const item = list[issue.index]
    if (item) map[item.id] = issue
  }
  return map
}

/**
 * variantOf() 会真的在题库里建一条变式草稿（自增编号 + unshift，见 org-store 的 variantOf），
 * 所以一个母题只能建一次：旧页面在生成中会把整块表单卸载、物理上点不到第二次，合并后参数面板
 * 常驻，不守卫则每点一次「开始生成」就在题库里多留一条孤儿变式草稿。
 */
let variantPrepared = false

/** 生成（FR-TM-013：额度校验 → 多智能体流水线 → 结果卡片） */
async function run() {
  if (busy.value) return
  if (!form.knowledge.length) {
    showToast('请先选择知识点', 'error')
    return
  }
  if (ai.count < 1 || ai.count > 10) {
    showToast('生成数量须为 1 ~ 10 题', 'error')
    return
  }
  if (insufficient.value) {
    showToast(`本月额度不足：剩余 ${remain.value}，本次预计 ${estimate.value}`, 'error')
    return
  }
  phase.value = 'running'
  progress.value = 0
  verifyReport.value = null
  verifyStage.value = ''
  const timer = window.setInterval(() => {
    progress.value = Math.min(97, progress.value + 7 + Math.floor(Math.random() * 9))
  }, 260)
  try {
    if (variantOfId.value && !variantPrepared) {
      await variantOf(variantOfId.value)
      variantPrepared = true
    }
    /* 真实 AI：固定提示词 + 变量渲染 → Deepseek；未配置 Key 时自动回退 mock */
    const result = await generateByAi({
      subject: form.subject,
      grade: form.grade,
      type: form.type,
      difficulty: form.difficulty,
      knowledge: [...form.knowledge],
      count: ai.count,
      variant:
        variantOfId.value && variantSource.value
          ? { stem: variantSource.value.stem, strategies: [...ai.strategies] }
          : undefined,
    })
    results.value = result.list
    adoptedIds.value = new Set()
    handedOff.value = new Set()
    engine.value = result.engine
    lastTokens.value = result.tokens
    /* AI 质检：按设置轮次复核答案/解析（超轮仍有 error → 结果页提醒人工介入）。
       质检失败不拖垮本次生成：给出提示，结果仍可人工核对后采纳 */
    if (checkRounds.value > 0 && results.value.length) {
      try {
        for (let r = 1; r <= checkRounds.value; r += 1) {
          verifyStage.value = `AI 质检：第 ${r} / ${checkRounds.value} 轮复核答案与解析…`
          const report = await verifyQuestionsByAi(
            results.value,
            { scene: variantOfId.value ? 'AI 变式' : 'AI 出题', subject: form.subject, grade: form.grade },
            /* 传剩余轮次：verifyQuestionsByAi 内部从第 1 轮数，这里逐轮调用以便刷新进度 */
            1,
          )
          verifyReport.value = mergeRoundReport(verifyReport.value, report)
          /* 应用本轮修正版（有错才修正，修正版进入下一轮输入） */
          if (report.corrected.length === results.value.length) results.value = report.corrected
          const last = verifyReport.value.rounds[verifyReport.value.rounds.length - 1]
          if (!last?.issues.some((issue) => issue.level === 'error')) break
        }
      } catch (error) {
        showToast(error instanceof Error ? `AI 质检未执行：${error.message}` : 'AI 质检未执行', 'error')
      } finally {
        verifyStage.value = ''
      }
    }
    if (verifyReport.value) lastTokens.value += verifyReport.value.tokens
    issueById.value = buildIssueMap(results.value, verifyReport.value)
    progress.value = 100
    /* 本页「已用额度」靠这一行本地推进：/tenant/quota 返回的是模块加载时的冻结快照，
       生成接口内部扣掉的额度不会反映到那个对象上。也**不要**在这里 fetchQuota() 刷新 ——
       那会把已用打回旧值，看起来像额度被退回。 */
    quota.value.used += estimate.value
    window.setTimeout(() => {
      phase.value = 'result'
    }, 320)
  } catch (error) {
    phase.value = 'idle'
    showToast(error instanceof Error ? error.message : '生成失败，请稍后重试', 'error')
  } finally {
    window.clearInterval(timer)
  }
}

/** 采纳入题库（进入待终审，FR-TM-014） */
async function adopt(item: GeneratedQuestion) {
  /* 已转手动编辑的不能再采纳：否则同一条题会被保存两次 */
  if (adoptedIds.value.has(item.id) || handedOff.value.has(item.id)) return
  await adoptGenerated({
    stem: item.stem,
    options: item.options,
    answer: item.answer,
    analysis: item.analysis,
    knowledge: item.knowledge,
    difficulty: item.difficulty,
    subject: form.subject,
    grade: form.grade,
    type: item.options.length > 0 ? (item.answer.length > 1 ? '多选题' : '单选题') : form.type === '多选题' ? '单选题' : form.type,
  })
  adoptedIds.value.add(item.id)
  showToast('已入题库（待人工终审），可在题库中查看', 'success')
}

async function adoptAll() {
  for (const item of [...results.value]) {
    if (adoptedIds.value.has(item.id) || handedOff.value.has(item.id)) continue
    await adopt(item)
  }
  showToast('全部采纳完成', 'success')
}

function discard(id: string) {
  results.value = results.value.filter((row) => row.id !== id)
  adoptedIds.value.delete(id)
  handedOff.value.delete(id)
}

/**
 * 编辑后采纳：把生成题填进上面的手动录入表单并切到手动标签。
 *
 * 旧实现是「暂存 sessionStorage + 跳转录题页」，跳转会把整个 AI 结果列表销毁，所以不存在
 * 「既采纳又手动保存」的问题；合并成一页后结果列表还在，若不标记，用户回到 AI 标签还能再点
 * 一次「采纳」，同一条题就进了题库两次 —— 故标记为第三态 handedOff：不再提供「采纳」，
 * 改为「回到编辑」（幂等，可反复把表单重新填成这一题）。
 */
function handOff(item: GeneratedQuestion) {
  applyDraft(item)
  handedOff.value.add(item.id)
  switchMode('manual')
  showToast('已填入表单，可继续编辑后保存', 'success')
}

/** 生成题 → 手动录入表单（等价于旧 ?from=ai 草稿分支的映射） */
function applyDraft(item: GeneratedQuestion) {
  form.difficulty = difficulties.value.includes(item.difficulty) ? item.difficulty : form.difficulty
  form.knowledge = [...item.knowledge].slice(0, 5)
  form.stem = item.stem
  form.analysis = item.analysis
  /* 来源备注沿用旧草稿的标注，便于入库后追溯 */
  form.sourceRemark = 'AI 智能出题'
  if (item.options.length > 0) {
    form.type = item.options.length === 2 && item.options[0] === '正确' ? '判断题' : item.answer.length > 1 ? '多选题' : '单选题'
    form.options = [...item.options]
    form.answers = item.answer
      .toUpperCase()
      .replace(/[^A-F]/g, '')
      .split('')
      .map((ch) => 'ABCDEF'.indexOf(ch))
      .filter((i) => i >= 0)
  } else if (form.type === '填空题') {
    /* 填空答案是普通 input（不吃富文本），取纯文本，避免把 <p> 标签填进去 */
    form.fillAnswers = [{ value: toPlainText(item.answer).trim(), equivalents: '' }]
  } else {
    /* 无选项的生成题落进解答题：题干之外只有一段富文本答案。
       （旧 ?from=ai 分支在这里是「沿用请求时的题型」，于是选了单选题又拿到无选项的题时，
       表单会停在「单选题 + 四个空选项框」上，而 AI 给的答案存在 essayAnswer 里根本看不见。
       mock 生成器的题恒为 options: []，这条路径是常态，故这里改为落到解答题。） */
    form.type = '解答题'
    form.essayAnswer = item.answer
  }
  /* lastType 必须跟着改：否则之后在手动标签点题型 chip、取消确认时会把结构写回旧题型 */
  lastType = form.type
  /* 程序化填入也是未保存改动：置脏，顶部栏切年级/学科不会覆盖它，「取消」也会如实提示 */
  dirty.value = true
}

function toggleStrategy(item: string) {
  const pos = ai.strategies.indexOf(item)
  if (pos >= 0) ai.strategies.splice(pos, 1)
  else ai.strategies.push(item)
}

/** 丢弃未处理题目的确认：取消返回 false */
function confirmDiscardPending(): boolean {
  return pendingCount.value === 0 || window.confirm(`还有 ${pendingCount.value} 题未处理，重新生成将丢弃，确认？`)
}

function clearResults() {
  results.value = []
  adoptedIds.value = new Set()
  handedOff.value = new Set()
  issueById.value = {}
  verifyReport.value = null
}

function onRerun() {
  if (!confirmDiscardPending()) return
  clearResults()
  phase.value = 'idle'
}

/**
 * 参数面板的「开始生成」。
 * 结果阶段参数面板仍然可见，此时再点一次等于「重新生成」—— 必须走同一份丢弃确认：
 * 旧页面在结果阶段把参数表单卸载了，这条静默清空结果的捷径以前不存在。
 */
function startGenerate() {
  if (busy.value) return
  if (phase.value === 'result') {
    if (!confirmDiscardPending()) return
    clearResults()
  }
  void run()
}

/* ===== 预览 ===== */
const previewOpen = ref(false)

function onCancel() {
  if (dirty.value && !window.confirm('有未保存的改动，确认放弃？')) return
  router.push('/question/bank')
}

onMounted(load)
</script>

<template>
  <div class="edit-layout">
    <!-- 录题方式：两种方式的入口（手动录入 / AI 出题）。放最上面 —— 先定「怎么录」，
         再填下面这套两种方式共用的基本信息，读起来从上到下就是用户的操作顺序。 -->
    <div class="mode-tabs">
      <button
        class="mode-tab"
        :class="{ on: mode === 'manual' }"
        type="button"
        @click="switchMode('manual')"
      >
        <AppIcon name="edit" :size="16" />
        <span class="mt-title">手动录入</span>
      </button>
      <button
        class="mode-tab"
        :class="{ on: mode === 'ai' }"
        type="button"
        :disabled="!!editId"
        :title="editId ? '正在编辑既有题目，AI 出题仅用于新增' : ''"
        @click="switchMode('ai')"
      >
        <AppIcon name="sparkles" :size="16" />
        <span class="mt-title">AI 出题</span>
      </button>
    </div>

    <!-- 题目基本信息：两种录题方式共用，全页唯一一处参数界面（FR-TM-008） -->
    <div class="panel prop-bar">
      <!-- 整条可点：与题库管理「搜索条件」同一套交互（点击行任意处切换，右侧文案 + 旋转箭头） -->
      <div class="prop-head" @click="metaOpen = !metaOpen">
        <span class="ph-title">
          题目基本信息
          <!-- 收起时把关键取值摘要出来：AI 出题的参数取自这里，收起来也得看得出用的是哪一套 -->
          <span v-if="!metaOpen" class="ph-sum">
            {{ form.grade }} · {{ form.subject }} · {{ form.type }} · {{ form.difficulty }}
          </span>
        </span>
        <span class="ph-toggle">
          {{ metaOpen ? '收起' : '展开' }}
          <AppIcon name="chevron-down" :size="15" class="ph-caret" :class="{ up: metaOpen }" />
        </span>
      </div>

      <!-- 每个属性一行：标签左、选项右平铺。候选项都不多（最多 12 个），下拉是多余的一次点击，
           且看不到还有什么可选。顺序一律取数据源现成顺序（字典 sort / 教材矩阵 / TERMS），不重排；
           唯一例外是年级排到学科前面 —— 学科选项由年级收窄，先选年级才不用回头改学科。 -->
      <div v-if="metaOpen" class="prop-body">
        <div class="prop-row">
          <span class="prop-label">年级<span class="req">*</span></span>
          <div class="prop-opts">
            <button
              v-for="g in withCurrent(grades, form.grade)"
              :key="g"
              class="p-chip"
              :class="{ on: form.grade === g }"
              type="button"
              @click="pickGrade(g)"
            >
              {{ optionLabel(grades, g) }}
            </button>
          </div>
        </div>

        <div class="prop-row">
          <span class="prop-label">学科<span class="req">*</span></span>
          <div class="prop-opts">
            <button
              v-for="s in subjectOptions"
              :key="s"
              class="p-chip"
              :class="{ on: form.subject === s }"
              type="button"
              @click="form.subject = s"
            >
              {{ optionLabel(subjects, s) }}
            </button>
          </div>
        </div>

        <div class="prop-row">
          <span class="prop-label">题型<span class="req">*</span></span>
          <div class="prop-opts">
            <button
              v-for="t in withCurrent(questionTypes, form.type)"
              :key="t"
              class="p-chip"
              :class="{ on: form.type === t }"
              type="button"
              @click="pickType(t)"
            >
              {{ optionLabel(questionTypes, t) }}
            </button>
          </div>
        </div>

        <div class="prop-row">
          <span class="prop-label">难度<span class="req">*</span></span>
          <div class="prop-opts">
            <button
              v-for="d in withCurrent(difficulties, form.difficulty)"
              :key="d"
              class="p-chip"
              :class="{ on: form.difficulty === d }"
              type="button"
              @click="form.difficulty = d"
            >
              {{ optionLabel(difficulties, d) }}
            </button>
          </div>
        </div>

        <!-- 以下三行只有手动录入用得到：AI 出题不读它们，采纳时也进不了这些字段，
             在 AI 态显示出来等于「能设置但无效」，故隐藏。 -->
        <template v-if="mode === 'manual'">
          <div class="prop-row">
            <span class="prop-label">学期</span>
            <div class="prop-opts">
              <button
                v-for="t in TERMS"
                :key="t"
                class="p-chip"
                :class="{ on: form.term === t }"
                type="button"
                @click="form.term = t"
              >
                {{ t }}
              </button>
            </div>
          </div>

          <div class="prop-row">
            <span class="prop-label">考试类型</span>
            <div class="prop-opts">
              <button class="p-chip" :class="{ on: form.examType === '' }" type="button" @click="form.examType = ''">
                不指定
              </button>
              <button
                v-for="e in examTypes"
                :key="e"
                class="p-chip"
                :class="{ on: form.examType === e }"
                type="button"
                @click="form.examType = e"
              >
                {{ e }}
              </button>
            </div>
          </div>

          <div class="prop-row">
            <span class="prop-label">教材版本</span>
            <div class="prop-opts">
              <button class="p-chip" :class="{ on: form.textbook === '' }" type="button" @click="form.textbook = ''">
                不绑定
              </button>
              <button
                v-for="v in versionOptions"
                :key="v"
                class="p-chip"
                :class="{ on: form.textbook === v }"
                type="button"
                @click="form.textbook = v"
              >
                {{ v }}
              </button>
            </div>
          </div>
        </template>

        <div class="prop-row">
          <span class="prop-label">知识点<span class="req">*</span></span>
          <div class="prop-opts">
            <button
              v-for="k in knowledgeOptions"
              :key="k"
              class="p-chip"
              :class="{ on: form.knowledge.includes(k), off: orphanKnowledge.includes(k) }"
              type="button"
              @click="toggleKnowledge(k)"
            >
              {{ k }}
            </button>
            <span class="prop-hint">随学科 / 年级 / 教材版本加载，最多 5 个</span>
          </div>
          <p v-if="errors.knowledge" class="f-err">{{ errors.knowledge }}</p>
        </div>
      </div>
    </div>

    <!-- ===== 手动录入 ===== -->
    <template v-if="mode === 'manual'">
      <div class="panel editor-panel">
        <div class="f-field">
          <label class="f-label">题干<span class="req">*</span></label>
          <RichTextEditor
            v-model="form.stem"
            :subject="form.subject"
            :min-height="150"
            placeholder="如：已知二次函数 f(x)=x²-2x-3…（工具栏可插入公式、图片，也支持粘贴 / 拖入图片）"
            @change="dirty = true"
          />
          <p v-if="errors.stem" class="f-err">{{ errors.stem }}</p>
        </div>

        <!-- 选项区（FR-TM-010） -->
        <template v-if="isChoice">
          <div class="f-field">
            <label class="f-label">
              选项（{{ form.options.length }}/{{ form.type === '判断题' ? 2 : 6 }}）
              <span class="f-hint" style="display: inline; margin-left: 8px">点击左侧圆点标记正确答案</span>
            </label>
            <div v-for="(opt, i) in form.options" :key="i" class="opt-row">
              <button
                class="answer-dot"
                :class="{ on: form.answers.includes(i), multi: form.type === '多选题' }"
                type="button"
                :title="form.type === '多选题' ? '正确答案（≥2 个）' : '正确答案'"
                @click="toggleAnswer(i)"
              >
                {{ 'ABCDEF'[i] }}
              </button>
              <RichTextEditor
                v-model="form.options[i]"
                class="opt-editor"
                compact
                :subject="form.subject"
                :min-height="40"
                :placeholder="`选项 ${'ABCDEF'[i]} 内容`"
                @change="dirty = true"
              />
              <button
                v-if="form.type !== '判断题'"
                class="mini-btn danger"
                type="button"
                @click="removeOption(i)"
              >
                删除
              </button>
            </div>
            <button v-if="form.type !== '判断题'" class="btn btn-ghost btn-sm" type="button" @click="addOption">
              <AppIcon name="plus" :size="14" /> 添加选项
            </button>
            <p v-if="errors.options" class="f-err">{{ errors.options }}</p>
          </div>
        </template>

        <!-- 填空答案区 -->
        <template v-else-if="form.type === '填空题'">
          <div class="f-field">
            <label class="f-label">填空答案（每空独立，支持等价写法）<span class="req">*</span></label>
            <div v-for="(blank, bi) in form.fillAnswers" :key="bi" class="blank-row">
              <span class="blank-no">第 {{ bi + 1 }} 空</span>
              <input v-model="blank.value" class="f-input" placeholder="答案" />
              <input v-model="blank.equivalents" class="f-input" placeholder="等价答案（逗号分隔，选填）" />
              <button
                v-if="form.fillAnswers.length > 1"
                class="mini-btn danger"
                type="button"
                @click="form.fillAnswers.splice(bi, 1)"
              >
                删除
              </button>
            </div>
            <button class="btn btn-ghost btn-sm" type="button" @click="form.fillAnswers.push({ value: '', equivalents: '' })">
              <AppIcon name="plus" :size="14" /> 添加一空
            </button>
            <p v-if="errors.answer" class="f-err">{{ errors.answer }}</p>
          </div>
        </template>

        <!-- 解答题答案 -->
        <template v-else>
          <div class="f-field">
            <label class="f-label">参考答案<span class="req">*</span></label>
            <RichTextEditor
              v-model="form.essayAnswer"
              :subject="form.subject"
              :min-height="110"
              placeholder="输入解答过程…（可插入公式与图片）"
              @change="dirty = true"
            />
            <p v-if="errors.answer" class="f-err">{{ errors.answer }}</p>
          </div>
        </template>

        <div class="f-field">
          <label class="f-label">解析</label>
          <RichTextEditor
            v-model="form.analysis"
            :subject="form.subject"
            :min-height="110"
            placeholder="输入解析…（可插入公式与图片）"
            @change="dirty = true"
          />
        </div>

        <div class="f-field">
          <label class="f-label">来源备注（选填 ≤100 字）</label>
          <input v-model="form.sourceRemark" class="f-input" placeholder="如：改编自 2025 期中第 12 题" />
          <p v-if="errors.sourceRemark" class="f-err">{{ errors.sourceRemark }}</p>
        </div>
      </div>

      <!-- 底部操作栏 -->
      <div class="panel action-bar">
        <button class="btn btn-ghost" @click="onCancel">取消</button>
        <div style="display: flex; gap: 10px; margin-left: auto">
          <button class="btn btn-ghost" :disabled="saving" @click="runCheck">
            <AppIcon name="sparkles" :size="15" /> AI 检测
          </button>
          <button class="btn btn-ghost" @click="previewOpen = true">
            <AppIcon name="search" :size="15" /> 预览
          </button>
          <button class="btn btn-ghost" :disabled="saving" @click="save(false)">
            {{ saving ? '保存中…' : '保存草稿' }}
          </button>
          <button class="btn btn-primary" :disabled="saving" @click="save(true)">
            保存并提交审核
          </button>
        </div>
      </div>
    </template>

    <!-- ===== AI 出题 ===== -->
    <template v-else>
      <div class="panel ai-panel">
        <div class="ai-head">
          <span class="ai-title">AI 智能出题</span>
          <span class="f-hint" style="margin: 0">多智能体协作：出题 → 查重 → 纠错 → 校标，产出即达「待人工终审」</span>
          <span class="tag" :class="engine === 'deepseek' ? 'tag-green' : 'tag-gray'" style="margin-left: auto">
            {{ engine === 'deepseek' ? 'Deepseek 真实生成' : '本地演示数据（未配置 Key）' }}
          </span>
        </div>

        <!-- 出题参数：学科 / 年级 / 题型 / 难度 / 知识点都用上面「题目基本信息」里的值 -->
        <div class="ai-params">
          <div class="ai-field">
            <label class="f-label">出题数量（1 ~ 10）</label>
            <input v-model.number="ai.count" type="number" min="1" max="10" class="f-input" />
          </div>
          <div class="ai-field">
            <label
              class="f-label"
              title="生成后自动复核答案 / 解析的轮数；此项为全局设置，与拍照识题、文档识别共用；超轮仍有异常将提醒人工介入"
            >
              AI 检查轮次
            </label>
            <select v-model.number="checkRounds" class="f-select" @change="onRoundsChange">
              <option :value="0">关闭</option>
              <option :value="1">1 轮</option>
              <option :value="2">2 轮</option>
              <option :value="3">3 轮</option>
            </select>
          </div>
          <span class="f-hint" style="margin: 0">学科 / 年级 / 题型 / 难度 / 知识点取自上方的题目基本信息</span>
        </div>

        <!-- 变式模式：母题来源与策略（FR-TM-016） -->
        <template v-if="variantSource">
          <div class="variant-bar">
            <span class="tag tag-blue">AI 变式</span>
            <span class="vs-label">母题 #{{ variantSource.id }}</span>
            <span class="vs-stem">{{ truncateRich(variantSource.stem, 60) }}…</span>
            <span class="prop-hint">变式题自动挂接「变式关联」，策略可多选</span>
          </div>
          <div class="f-field" style="margin: 0 0 14px">
            <label class="f-label">变式策略（可多选）</label>
            <div class="prop-opts">
              <button
                v-for="sgy in STRATEGIES"
                :key="sgy"
                class="p-chip"
                :class="{ on: ai.strategies.includes(sgy) }"
                type="button"
                @click="toggleStrategy(sgy)"
              >
                {{ sgy }}
              </button>
            </div>
          </div>
        </template>

        <!-- 额度预估（FR-TM-015） -->
        <div class="quota-bar">
          <AppIcon name="sparkles" :size="15" />
          <span>
            本月额度已用 <b>{{ quota.used }}</b> / {{ quota.quota }}；
            本次生成预计消耗 <b :class="{ danger: insufficient }">{{ estimate }}</b>
          </span>
          <button class="btn btn-primary" style="margin-left: auto" :disabled="busy" @click="startGenerate">
            <AppIcon name="sparkles" :size="15" /> {{ busy ? '生成中…' : '开始生成' }}
          </button>
        </div>
        <p v-if="insufficient" class="f-err">额度不足，可联系机构管理员升级套餐或下月再试</p>
      </div>

      <!-- 生成进度：参数面板保持可见（便于确认本次用的学段与数量），进度只占一条 -->
      <div v-if="busy" class="panel gen-running">
        <div class="pipeline">
          <span class="pl-step done">理解需求</span>
          <span class="pl-arrow">→</span>
          <span class="pl-step" :class="{ done: progress > 30 }">生成候选</span>
          <span class="pl-arrow">→</span>
          <span class="pl-step" :class="{ done: progress > 60 }">查重比对</span>
          <span class="pl-arrow">→</span>
          <span class="pl-step" :class="{ done: progress > 85 }">纠错校标</span>
        </div>
        <div class="progress-track"><div class="progress-fill" :style="{ width: `${progress}%` }" /></div>
        <p class="f-hint" style="margin: 0">{{ verifyStage || `${Math.round(progress)}% · 通常 5 ~ 15 秒完成` }}</p>
      </div>

      <!-- 结果阶段 -->
      <template v-else-if="phase === 'result'">
        <!-- 质检超轮告警：超过设定检查轮次仍有异常 → 提醒人工介入处理 -->
        <div v-if="verifyReport?.needsManual" class="verify-alert">
          <AppIcon name="warning" :size="16" />
          <span>
            AI 质检已完成 {{ verifyReport.rounds.length }} 轮，仍有 {{ verifyReport.remaining.length }} 处异常（如答案存疑），
            <b>请人工介入处理</b>：核对/编辑后再采纳，或丢弃重出。
          </span>
        </div>
        <div v-else-if="verifyReport && verifyReport.rounds.length" class="verify-pass">
          <AppIcon name="check" :size="15" />
          <span>
            AI 质检 {{ verifyReport.rounds.length }} 轮通过{{ verifyReport.rounds.some((r) => r.issues.length) ? '（已按质检意见自动修正，请抽查）' : '，答案与解析复核无误' }}
          </span>
        </div>

        <div class="result-head">
          <h3>
            生成完成（{{ results.length }} 题）· 已采纳 {{ adoptedIds.size }} 题
            <span v-if="engine === 'deepseek' && lastTokens" class="f-hint" style="font-weight: 400">
              · Deepseek 消耗 {{ lastTokens }} tokens
            </span>
          </h3>
          <div class="op-group">
            <button class="btn btn-ghost btn-sm" @click="onRerun">重新生成</button>
            <button class="btn btn-primary btn-sm" :disabled="pendingCount === 0" @click="adoptAll">全部采纳</button>
          </div>
        </div>

        <QuestionResultList
          :list="results"
          :adopted="adoptedIds"
          :handed-off="handedOff"
          :issues="issueById"
          :verify-rounds="verifyReport?.rounds.length ?? 0"
          :requested-type="form.type"
          @adopt="adopt"
          @edit="handOff"
          @discard="discard"
        />
      </template>
    </template>

    <!-- 学生视角预览 -->
    <AppModal v-if="previewOpen" title="学生视角预览" :width="620" @close="previewOpen = false">
      <div class="preview-card">
        <div class="pv-meta">
          <span class="tag tag-blue">{{ form.subject }} · {{ form.grade }}</span>
          <span class="tag tag-gray">{{ form.type }}</span>
          <span class="tag tag-gray">{{ form.difficulty }}</span>
        </div>
        <RichTextViewer class="pv-stem" :content="form.stem" empty="（题干预览）" />
        <ul v-if="isChoice" class="option-list">
          <li v-for="(opt, i) in form.options" :key="i" :class="{ right: form.answers.includes(i) }">
            {{ 'ABCDEF'[i] }}. <RichTextViewer :content="opt" tag="span" />
          </li>
        </ul>
        <div v-if="answerText" class="pv-answer">
          <span class="tag tag-green">答案</span>{{ answerText }}
        </div>
        <p v-if="hasContent(form.analysis)" class="pv-analysis"><b>解析：</b><RichTextViewer :content="form.analysis" tag="span" /></p>
      </div>
    </AppModal>
    <!-- AI 检测：进度 + 审查结论 + 修正回写 -->
    <AppModal v-if="checkOpen" title="AI 检测" :width="660" @close="closeCheck">
      <!-- 进度 -->
      <div v-if="checkPhase === 'running'" class="check-running">
        <div class="run-ring"><AppIcon name="sparkles" :size="30" /></div>
        <p class="run-title">AI 正在检测这道题…</p>
        <div class="run-steps">
          <span>匹配基本信息</span>
          <span>审查题干与选项</span>
          <span>验算答案与解析</span>
        </div>
        <div class="check-track"><div class="check-fill" :style="{ width: `${checkProgress}%` }" /></div>
        <p class="f-hint">{{ checkProgress < 100 ? '正在调用大模型…' : '整理检测结论…' }}</p>
      </div>

      <!-- 失败 -->
      <div v-else-if="checkPhase === 'failed'" class="check-failed">
        <AppIcon name="warning" :size="30" />
        <p>{{ checkFailReason }}</p>
        <button class="btn btn-ghost btn-sm" @click="runCheck">重试</button>
      </div>

      <!-- 结论 + 修正回写 -->
      <template v-else-if="checkReport">
        <div class="check-head">
          <span class="tag" :class="checkReport.overall === 'pass' ? 'tag-green' : checkReport.overall === 'warn' ? 'tag-blue' : 'tag-red'">
            {{ OVERALL_TEXT[checkReport.overall] }}
          </span>
          <span class="tag" :class="checkReport.engine === 'deepseek' ? 'tag-green' : 'tag-gray'">
            {{ checkReport.engine === 'deepseek' ? '真实 AI' : '本地演示' }}
          </span>
          <span v-if="checkReport.tokens" class="f-hint" style="margin-left: auto">{{ checkReport.tokens }} tokens</span>
        </div>
        <ul class="check-items">
          <li v-for="(item, i) in checkReport.items" :key="i" :class="`lv-${item.level}`">
            <div class="ci-bar">
              <b>{{ item.aspect }}</b>
              <span class="lv-tag">{{ LEVEL_TEXT[item.level] }}</span>
            </div>
            <p>{{ item.message }}</p>
          </li>
        </ul>

        <template v-if="corrections.length || metaCorrection">
          <div class="corr-title">AI 修正建议（点击「采纳」回写到表单）</div>
          <div v-if="metaCorrection" class="corr-row">
            <div class="corr-label">基本信息</div>
            <div class="corr-value">{{ metaCorrection.text }}</div>
            <button class="mini-btn" type="button" @click="applyMetaCorrection">采纳</button>
          </div>
          <div v-for="row in corrections" :key="row.field" class="corr-row">
            <div class="corr-label">{{ row.label }}</div>
            <div class="corr-value"><RichTextViewer :content="row.value" tag="span" /></div>
            <button class="mini-btn" type="button" @click="applyCorrection(row.field)">采纳</button>
          </div>
          <button class="btn btn-primary btn-sm" style="margin-top: 12px" @click="applyAllCorrections">
            全部采纳并回写
          </button>
        </template>
        <p v-else-if="!checkReport.corrected" class="f-hint" style="margin-top: 10px">AI 未返回可回写的修正版</p>
        <p v-else class="f-hint" style="margin-top: 10px">未发现需要修正的问题</p>
      </template>
      <template #footer>
        <button class="btn btn-ghost" @click="closeCheck">关闭</button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.edit-layout { display: flex; flex-direction: column; gap: 14px; }

/* 全局 .panel 只给了底色 / 边框 / 圆角，没有 padding；属性条此前因此贴着边框。
   补在这一处而不是改 .panel，免得波及全站其它面板。下留 4px：每个 .prop-row 自带 12px 下边距。
   上边距交给 .prop-head —— 收起时只剩标题条，上下间距才一样。 */
.prop-bar { padding: 0 20px 4px; }

/* 标题条：既是「题目基本信息」的标识，也是折叠开关 —— 整条可点（.prop-head 的 click），
   故 cursor: pointer。样式照搬题库管理的「搜索条件」头（.fp-head / .fp-title / .fp-toggle / .fp-caret），
   两处的折叠交互看起来才是同一套东西。min-height 让收起态的高度与「搜索条件」条一致。 */
.prop-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 0;
  cursor: pointer;
  min-height: 46px;
}
.ph-title {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--ink);
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  min-width: 0;
}
.ph-sum { font-weight: 400; font-size: 12.5px; color: var(--sub); }
.ph-toggle { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--sub); flex-shrink: 0; }
.ph-caret { transition: transform 0.18s; }
.ph-caret.up { transform: rotate(180deg); }
/* 正文与标题条之间用虚线分隔（同 .fp-body）：收起时只剩标题条，展开时内容有个起点 */
.prop-body { border-top: 1px dashed var(--border); padding-top: 12px; }

.prop-row { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 12px; }
/* 校验红字占满一行，落到 chip 下方而不是被挤在行内。
   全局的 .f-err 选择器是 `.f-field .f-err`，这里不在 .f-field 内，故字号与颜色要自己给。 */
.prop-row > .f-err { flex-basis: 100%; margin: 0; font-size: 12px; color: var(--danger); }
.prop-label {
  width: 82px;
  flex-shrink: 0;
  padding-top: 5px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-2);
}
.prop-opts { display: flex; flex-wrap: wrap; gap: 8px; flex: 1; min-width: 0; }
.prop-hint { align-self: center; font-size: 12px; color: var(--sub); }

/* 取值枚举统一用 chip：点一下就选中，且不必先展开才知道有什么可选。
   与其它页的 .k-chip 同造型（那是各页各自 scoped 复制的）。 */
.p-chip {
  border: 1.5px solid var(--border);
  border-radius: 999px;
  background: #fff;
  color: var(--ink-2);
  font-size: 12.5px;
  padding: 4px 12px;
  transition: all 0.15s;
}
.p-chip:hover { border-color: var(--brand); color: var(--brand-deep); }
.p-chip.on { border-color: var(--brand); background: var(--brand-soft); color: var(--brand-deep); font-weight: 600; }
/* 已选但已不属于当前知识点池的项：虚线提示，仍可点击取消 */
.p-chip.off { border-style: dashed; opacity: 0.7; }

/* ===== 录题方式切换 =====
   两种方式平级，故用带说明文字的标签卡而不是小号分段控件：说明文字直接回答「我该用哪种」。
   不撑满整行（flex: 1 会各占一半，两个短标签之间留下大片空白）：按内容宽，
   上限 300px 防止窄屏把说明文字挤成细长条。 */
.mode-tabs { display: flex; flex-wrap: wrap; gap: 10px; }
.mode-tab {
  flex: 0 1 auto;
  max-width: 300px;
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
  padding: 12px 16px;
  border: 1.5px solid var(--border);
  border-radius: 12px;
  background: #fff;
  color: var(--sub);
  transition: all 0.15s;
}
.mode-tab:hover:not(:disabled) { border-color: var(--brand); color: var(--brand-deep); }
.mode-tab.on { border-color: var(--brand); background: var(--brand-soft); color: var(--brand-deep); }
.mode-tab:disabled { opacity: 0.55; cursor: not-allowed; }
.mt-title { font-size: 14px; font-weight: 700; color: var(--ink); }
.mode-tab.on .mt-title { color: var(--brand-deep); }
.mt-desc { font-size: 12px; color: var(--sub); }

.editor-panel { padding: 18px 20px; }

.opt-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
/* 选项编辑器占满剩余宽度（删除按钮与答案圆点保持原尺寸） */
.opt-editor { flex: 1; min-width: 0; }
.answer-dot {
  width: 30px;
  height: 34px;
  border-radius: 9px;
  border: 1.5px solid var(--border);
  background: #fff;
  color: var(--sub);
  font-weight: 700;
  flex-shrink: 0;
  transition: all 0.15s;
}
.answer-dot.on { border-color: var(--success); background: var(--success-soft); color: var(--success); }
.answer-dot.multi { border-radius: 999px; }

.blank-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.blank-no { font-size: 12.5px; color: var(--sub); width: 52px; flex-shrink: 0; }

.action-bar {
  display: flex;
  align-items: center;
  padding: 12px 18px;
  position: sticky;
  bottom: 0;
  z-index: 5;
}

.preview-card { background: #f7fafa; border-radius: 12px; padding: 16px 18px; }

/* ===== AI 出题 ===== */
.ai-panel { padding: 16px 20px; }
.ai-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
.ai-title { font-size: 15px; font-weight: 700; color: var(--ink); }
/* 参数一排两项：数量与轮次是本次生成的唯一两个旋钮 */
.ai-params { display: flex; align-items: flex-end; gap: 22px; flex-wrap: wrap; margin-bottom: 14px; }
.ai-field { display: flex; flex-direction: column; gap: 6px; }
/* 全局的 .f-label 选择器是 `.f-field .f-label`，参数排里的容器是 .ai-field，样式要自己补一份 */
.ai-field .f-label { margin: 0; font-size: 13px; font-weight: 600; color: var(--ink-2); }
.ai-field .f-input, .ai-field .f-select { width: 150px; }

.variant-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  margin-bottom: 14px;
  background: #f7fafa;
  border-radius: 10px;
}
.vs-label { font-size: 12.5px; color: var(--sub); }
.vs-stem {
  font-size: 13px;
  color: var(--ink-2);
  max-width: 420px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quota-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--brand-soft);
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 13px;
  color: var(--ink-2);
}
.quota-bar b.danger { color: var(--danger); }
/* 额度不足的红字：全局 .f-err 是 `.f-field .f-err`，这条在 .ai-panel 下，得自己给样式
   （原 AI 出题页同样是裸 .f-err，所以那行提示一直是黑色正文样式） */
.ai-panel > .f-err { font-size: 12px; color: var(--danger); margin-top: 5px; }

/* 生成进度：只占一条（结果出现时页面不跳屏），流水线步骤沿用旧出题页的展示 */
.gen-running { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding: 14px 20px; }
.pipeline { display: flex; align-items: center; gap: 8px; }
.pl-step {
  font-size: 12.5px; color: var(--sub);
  border: 1.5px solid var(--border); border-radius: 999px; padding: 4px 12px;
}
.pl-step.done { border-color: var(--brand); color: var(--brand-deep); background: var(--brand-soft); }
.pl-arrow { color: var(--sub); }
.progress-track { flex: 1; min-width: 180px; height: 8px; border-radius: 999px; background: var(--border); overflow: hidden; }
.progress-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--brand), var(--brand-deep)); transition: width 0.25s; }

.result-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.result-head h3 { font-size: 15.5px; color: var(--ink); }

/* ===== 质检结论条 ===== */
.verify-alert {
  display: flex; align-items: center; gap: 8px;
  background: var(--danger-soft); color: var(--danger);
  border: 1px solid rgba(214, 69, 69, 0.35);
  border-radius: 10px; padding: 10px 14px;
  font-size: 13px; line-height: 1.6;
}
.verify-pass {
  display: flex; align-items: center; gap: 8px;
  background: var(--success-soft); color: var(--success);
  border: 1px solid rgba(16, 142, 90, 0.3);
  border-radius: 10px; padding: 9px 14px;
  font-size: 13px;
}

/* ===== AI 检测弹窗 =====
   进度条这里叫 .check-* 而不是 .progress-*：同一个文件里还有 AI 出题的 .progress-track/.progress-fill，
   scoped 样式同文件内同名会互相覆盖（后者会把检测弹窗的进度条缩成 180px）。 */
.check-running { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 18px 0 8px; }
.run-ring {
  width: 64px; height: 64px; border-radius: 50%;
  background: var(--brand-soft); color: var(--brand-deep);
  display: flex; align-items: center; justify-content: center;
  animation: ring-pulse 1.6s ease-in-out infinite;
}
@keyframes ring-pulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(0.92); opacity: 0.75; } }
.run-title { font-size: 14.5px; font-weight: 600; color: var(--ink); }
.run-steps { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
.run-steps span {
  font-size: 12px; color: var(--sub); background: #f5f8f8;
  border-radius: 999px; padding: 3px 10px;
}
.check-track { width: 100%; height: 7px; border-radius: 999px; background: var(--border); overflow: hidden; }
.check-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--brand), var(--brand-deep)); transition: width 0.25s; }
.check-failed { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 16px 0; color: var(--ink-2); }

.check-head { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.check-items { list-style: none; margin: 0 0 4px; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.check-items li { border: 1px solid var(--border); border-left-width: 3px; border-radius: 8px; padding: 8px 12px; background: #fbfdfd; }
.check-items li.lv-ok { border-left-color: var(--success); }
.check-items li.lv-warn { border-left-color: #d97706; }
.check-items li.lv-error { border-left-color: var(--danger, #dc2626); }
.ci-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 3px; }
.ci-bar b { font-size: 13px; color: var(--ink); }
.lv-tag { font-size: 11px; border-radius: 999px; padding: 1px 8px; background: #f5f8f8; color: var(--sub); }
.lv-ok .lv-tag { color: var(--success); }
.lv-warn .lv-tag { color: #d97706; }
.lv-error .lv-tag { color: #dc2626; }
.check-items p { margin: 0; font-size: 12.5px; color: var(--ink-2); line-height: 1.6; }

.corr-title { font-size: 13px; font-weight: 700; color: var(--ink); margin: 14px 0 8px; }
.corr-row {
  display: flex; align-items: flex-start; gap: 10px;
  border: 1px dashed var(--border); border-radius: 8px;
  padding: 8px 10px; margin-bottom: 8px; background: #fff;
}
.corr-label { font-size: 12px; font-weight: 600; color: var(--brand-deep); width: 64px; flex-shrink: 0; padding-top: 2px; }
.corr-value { flex: 1; min-width: 0; font-size: 12.5px; color: var(--ink-2); line-height: 1.6; max-height: 110px; overflow-y: auto; }
.pv-meta { display: flex; gap: 8px; margin-bottom: 12px; }
.pv-stem { font-size: 14.5px; color: var(--ink); line-height: 1.8; margin-bottom: 12px; }
.option-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
.option-list li {
  background: #fff;
  border-radius: 8px;
  padding: 9px 12px;
  font-size: 13.5px;
  color: var(--ink-2);
}
.option-list li.right { border-left: 3px solid var(--success); color: var(--success); font-weight: 600; }
.pv-answer { display: flex; align-items: center; gap: 8px; font-size: 13.5px; font-weight: 600; color: var(--success); margin-bottom: 10px; }
.pv-analysis { font-size: 13px; color: var(--ink-2); line-height: 1.7; }
</style>
