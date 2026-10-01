<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AppFilterChips,
  AppIcon,
  RichTextViewer,
  showToast,
  ApiError,
  toPlainText,
  truncateRich,
} from '@aiteach/shared'
import type { GeneratedQuestion, OrgCategory, OrgQuestion } from '@aiteach/shared'
import AppModal from '@/components/ui/AppModal.vue'
import QuestionEditor from '@/components/question/QuestionEditor.vue'
import QuestionEditorModal from '@/components/question/QuestionEditorModal.vue'
import QuestionPreviewDrawer from '@/components/question/QuestionPreviewDrawer.vue'
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
import {
  answerTextOf,
  draftFromGenerated,
  draftFromQuestion,
  emptyQuestionDraft,
  hasContent,
  isChoiceDraft,
  questionPayloadOf,
  setDraftGrade,
} from '@/utils/question-draft'
import type { QuestionDraft } from '@/utils/question-draft'

const route = useRoute()
const router = useRouter()

const { subjects, grades, questionTypesFor, difficulties, examTypes, optionsForGrade, ensure, pick } = useBaseData()
/** 顶部栏的全局年级 / 学科：表单初值与出题参数的默认值 */
const { grade: scopeGrade, subject: scopeSubject, ensureScope } = useScope()

/** 有选项、答案存字母的题型。判定口径与编辑组件同源（`isChoiceDraft`），页面这边只用来收口
    预览 / 检测 / 保存的 options —— 表单本身的选项区已搬进 QuestionEditor。 */
const isChoice = computed(() => isChoiceDraft(form))

/** 答案的三形态折叠成一条字符串（存库口径）—— 预览、AI 检测入参、修正比对都读它 */
const answerText = computed(() => answerTextOf(form))

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

/* ===== 表单（FR-TM-008 ~ 012） =====
   字段集由 `QuestionDraft` 定义、界面由 QuestionEditor 渲染，页面这边只持有这一份草稿，
   并读它做预览 / AI 检测 / 保存 —— 所以草稿必须「就地改」而不是换引用（见 QuestionEditor 的说明）。 */
const form = reactive<QuestionDraft>({
  ...emptyQuestionDraft(),
  subject: scopeSubject.value,
  grade: scopeGrade.value,
})

/* 所属库 / 分类是「这题放哪」的归属信息，与编辑题目本身无关（录题时先想「放哪」是多余的一道题），
   故不进 QuestionDraft，留在页面这一层：新建一律落到个人题库的默认分类，保存时由 save() 兜底补
   categoryId；编辑存量题按原值回写。 */
const library = ref<'personal' | 'org' | 'wrong'>('personal')
const categoryId = ref<number | null>(null)

const saving = ref(false)
const dirty = ref(false)

/** 手动标签页里那张编辑表单。校验、红字、面板展开都由它自理，页面只问一句「能不能存」 */
const editorRef = ref<{ validate: (full: boolean) => boolean } | null>(null)

const categories = ref<OrgCategory[]>([])

/* 知识点池按当前「年级 / 学科 / 教材版本」实时取，替代原先写死的数学知识点。
   AI 出题不看教材版本（那一行在 AI 态是隐藏的），故 AI 态传空串 —— 否则会被一个
   用户看不见的值收窄知识点选项。 */
const { pool: knowledgePool } = useKnowledgePool(() => ({
  grade: form.grade,
  subject: form.subject,
  version: mode.value === 'ai' ? '' : form.textbook,
}))

/** 顶部栏切换年级 / 学科时同步表单：手动态仅限未动过的新建表单，AI 出题则总是跟随
    （出题参数就是取自这里，不跟随会用错学段）；变式模式以母题为准，不打扰。 */
watch([scopeGrade, scopeSubject], () => {
  if (variantOfId.value) return
  if (mode.value === 'manual' && (editId.value || dirty.value)) return
  /* 走 setDraftGrade 而不是各写各的：学科必须按**归一后的年级**校验，此前直接 pick(全量 subjects)
     会把「三年级 + 物理」这种该年级不开的组合写进表单。它与编辑器里的年级 chip 共用同一份规则 */
  setDraftGrade(form, pick(grades.value, scopeGrade.value), pick(subjects.value, scopeSubject.value), optionsForGrade)
})

async function load() {
  await ensure()
  await ensureScope()
  ;[categories.value] = await Promise.all([fetchCategories()])
  const id = editId.value
  if (!id) {
    /* 新建：默认取顶部栏的全局年级 / 学科，并归一为当前启用字典内的值。
       走 setDraftGrade 让学科同样受年级收窄 —— 顶部栏那两个值是各自独立的，可能凑成无效组合。 */
    setDraftGrade(form, pick(grades.value, scopeGrade.value), pick(subjects.value, scopeSubject.value), optionsForGrade)
    form.type = pick(questionTypesFor(form.subject), form.type)
    form.difficulty = pick(difficulties.value, form.difficulty)
    form.examType = pick(examTypes.value, form.examType)
  }
  if (variantOfId.value) {
    /* 变式的出题参数以母题为准（题型不照搬「多选题」：变式题通常改问法，按单选出更稳） */
    const all = await fetchQuestions()
    variantSource.value = all.find((row) => row.id === variantOfId.value) ?? null
    if (variantSource.value) {
      /* 只借学段与知识点，题型要改写，故**不整体套 draftFromQuestion**；也**不走 setDraftGrade**
         —— 这是「载入已存数据」而非「用户切年级」，按新规则校验会在打开变式的瞬间静默抹掉母题的
         学科（存量题完全可能带已停用学科）。 */
      Object.assign(form, {
        subject: variantSource.value.subject,
        grade: variantSource.value.grade,
        type: variantSource.value.type === '多选' ? '单选' : variantSource.value.type,
        knowledge: [...variantSource.value.knowledge],
      })
      ai.strategies = ['数值替换']
    }
  }
  if (id) {
    const all = await fetchQuestions()
    const source = all.find((row) => row.id === id)
    if (source) {
      /* 存量题 → 草稿的映射统一走 draftFromQuestion（题型反推、答案按题型分派、每空答案的
         「｜」回退都在那一份里，三个入口共用）。它同样有意**不走 setDraftGrade**：否则打开一道
         学科已停用的存量题，学科会被静默清空，用户没动任何东西却存不回原值。 */
      Object.assign(form, draftFromQuestion(source))
      library.value = source.library
      categoryId.value = source.categoryId
    }
  }
  quota.value = await fetchQuota()
}

async function save(submit: boolean) {
  /* 校验口径与红字都在编辑组件里（含「解析为空」的那次确认）；失败时它已把基本信息面板展开，
     这里只补一句提示。full 由 submit 决定：存草稿只看必填属性，提交审核全量校验（FR-TM-012） */
  if (!editorRef.value?.validate(submit)) {
    showToast('请按红字提示修正后重试', 'error')
    return
  }
  saving.value = true
  try {
    /* 入参拼装也统一走 questionPayloadOf：三个入口存进去的字段形状必须一模一样 */
    await saveQuestion(
      questionPayloadOf(form, {
        id: editId.value || undefined,
        library: library.value,
        categoryId: categoryId.value ?? categories.value.find((row) => row.parentId != null)?.id,
        submit,
      }),
    )
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
    } else if (form.type === '填空') {
      /* AI 回写的是纯文本（各空以 ｜ 分隔），按空拆进富文本编辑器；等价答案需人工补 */
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
  /* 年级与学科一起回写：先前先写学科再写年级，学科是按**旧年级**校验的，
     若两者同时被纠正，落地的可能是新年级不开的组合。统一交给 setDraftGrade 一次算完。 */
  const nextGrade = c.grade && grades.value.includes(c.grade) ? c.grade : form.grade
  /* 学科仍按「启用字典」先归一道，再交给 setDraftGrade 按年级收窄（同一套口径只此一份） */
  const nextSubject = c.subject && subjects.value.includes(c.subject) ? c.subject : ''
  if (nextGrade !== form.grade) setDraftGrade(form, nextGrade, nextSubject || undefined, optionsForGrade)
  else if (nextSubject && optionsForGrade(nextGrade).includes(nextSubject)) form.subject = nextSubject
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

/** 检查轮次（0=关闭，1~3）。注意这是**全局键**：与拍照识题共用同一份设置（我的文件不做复核） */
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
/** 已采纳 / 已编辑入库：都按题目 id 记 —— 丢弃中间一题不会让标记错位 */
const adoptedIds = ref<Set<string>>(new Set())
const savedIds = ref<Set<string>>(new Set())
/** 已入库的题，按生成结果 id 索引：卡片正文改用它渲染，「重新编辑」也用它重建草稿 */
const savedById = ref<Record<string, OrgQuestion>>({})
/** 最后一轮质检结论（按题目 id 索引），与 results 同步重建 */
const issueById = ref<Record<string, VerifyIssue>>({})
/** 最近一次质检报告（告警条 / 通过条 / 逐题质检标用） */
const verifyReport = ref<AiVerifyReport | null>(null)
/** 运行阶段的质检进度文案 */
const verifyStage = ref('')

/** 待处理题数：既没采纳也没编辑入库（重新生成会丢的正是这些） */
const pendingCount = computed(
  () => results.value.filter((row) => !adoptedIds.value.has(row.id) && !savedIds.value.has(row.id)).length,
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
    savedIds.value = new Set()
    savedById.value = {}
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
  /* 已编辑入库的不能再采纳：题已经在题库里了，再采纳一次会多出一条重复题 */
  if (adoptedIds.value.has(item.id) || savedIds.value.has(item.id)) return
  await adoptGenerated({
    stem: item.stem,
    options: item.options,
    answer: item.answer,
    analysis: item.analysis,
    knowledge: item.knowledge,
    difficulty: item.difficulty,
    subject: form.subject,
    grade: form.grade,
    type: item.options.length > 0 ? (item.answer.length > 1 ? '多选' : '单选') : form.type === '多选' ? '单选' : form.type,
  })
  adoptedIds.value.add(item.id)
  showToast('已入题库（待人工终审），可在题库中查看', 'success')
}

async function adoptAll() {
  for (const item of [...results.value]) {
    if (adoptedIds.value.has(item.id) || savedIds.value.has(item.id)) continue
    await adopt(item)
  }
  showToast('全部采纳完成', 'success')
}

function discard(id: string) {
  results.value = results.value.filter((row) => row.id !== id)
  adoptedIds.value.delete(id)
  savedIds.value.delete(id)
  delete savedById.value[id]
}

/* ===== 编辑入库（弹窗） =====
 * 结果卡片的「编辑入库」开的是与录题中心同一张「题目编辑」表单，只是装在弹窗里。
 *
 * 旧实现是「把生成题回填进上面的手动录入表单 + 切到手动标签」——那不算编辑，用户还得再点一次
 * 保存；且跳转前的旧版把整个结果列表销毁了，合并成一页后列表还在，不标记的话同一道题能既采纳
 * 又手动保存，题库里出现两条。现在卡片进入「已保存到题库」态：不再提供「采纳」，只能「重新编辑」。
 */
const editOpen = ref(false)
/** 正在编辑的那条生成结果（弹窗开着期间不换） */
const editingGen = ref<GeneratedQuestion | null>(null)
/** 弹窗草稿：开一次建一次，取消即丢弃。对象复用，编辑器按约定始终持有同一个引用 */
const editDraft = reactive<QuestionDraft>(emptyQuestionDraft())
/** 编辑的是已入库的题（>0）—— 保存要带上它走 saveQuestion 的原地更新分支 */
const editQuestionId = ref(0)
const editSaving = ref(false)

function editResult(item: GeneratedQuestion) {
  editingGen.value = item
  const saved = savedById.value[item.id]
  /* 已入库的用**库里那一条**重建草稿并带 id 保存：拿原生成对象再存一次会多出一条重复题。
     （draftFromQuestion / draftFromGenerated 都返回完整草稿，Object.assign 不会残留上一次的字段） */
  editQuestionId.value = saved?.id ?? 0
  Object.assign(
    editDraft,
    saved ? draftFromQuestion(saved) : draftFromGenerated(item, { subject: form.subject, grade: form.grade }),
  )
  editOpen.value = true
}

/**
 * 保存弹窗里的编辑。
 *
 * 走 `saveQuestion` 而不是 `adoptGenerated`：后者写死 categoryId: 2，且丢掉
 * term / examType / textbook / fillAnswers / optionColumns / sourceRemark —— 用户在弹窗里
 * 明明填了学期与教材版本，存完却没了。
 */
async function saveEdit(submit: boolean, validate: (full: boolean) => boolean) {
  if (!editingGen.value) return
  if (!validate(submit)) {
    showToast('请按红字提示修正后重试', 'error')
    return
  }
  editSaving.value = true
  try {
    const saved = await saveQuestion(
      questionPayloadOf(editDraft, {
        id: editQuestionId.value || undefined,
        library: library.value,
        categoryId: categoryId.value ?? categories.value.find((row) => row.parentId != null)?.id,
        submit,
      }),
    )
    savedIds.value.add(editingGen.value.id)
    savedById.value[editingGen.value.id] = saved
    editOpen.value = false
    showToast(submit ? '已提交：多智能体校验中，完成后推送终审待办' : '已保存到题库', 'success')
  } catch (error) {
    /* ApiError 之外还有 mock 层直接抛的 Error（题干为空 / 未设答案），别把消息吞成「保存失败」 */
    showToast(error instanceof Error ? error.message : '保存失败', 'error')
  } finally {
    editSaving.value = false
  }
}

/** 丢弃未处理题目的确认：取消返回 false */
function confirmDiscardPending(): boolean {
  return pendingCount.value === 0 || window.confirm(`还有 ${pendingCount.value} 题未处理，重新生成将丢弃，确认？`)
}

function clearResults() {
  results.value = []
  adoptedIds.value = new Set()
  savedIds.value = new Set()
  savedById.value = {}
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

/* ===== 预览 =====
   与题库管理的「题目预览」共用一个抽屉组件（QuestionPreviewDrawer），样式与分节由它统一，
   这里只把草稿拼成它要的字段集。 */
const previewOpen = ref(false)

const previewQuestion = computed(() => ({
  id: editId.value || undefined,
  subject: form.subject,
  grade: form.grade,
  type: form.type,
  difficulty: form.difficulty,
  knowledge: form.knowledge,
  source: form.source,
  library: library.value,
  term: form.term,
  examType: form.examType,
  /* useCount 不传 → 抽屉显示「—」：草稿还没入库，写「0 次」是假数据 */
  stem: form.stem,
  /* 填空 / 解答题的 form.options 是占位的 ['','','','']，必须按 isChoice 收口，
     否则预览里会凭空出现四个空选项 */
  options: isChoice.value ? form.options : [],
  answer: answerText.value,
  analysis: form.analysis,
  optionColumns: form.optionColumns,
}))

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

    <!-- 题目编辑：三个入口共用同一张表单（手动录入 / AI 出题参数 / AI 结果与拍照识别的编辑弹窗）。
         AI 标签页只摆四个必填项当出题参数，且切题型时不动选项结构、不弹那句清空确认 —— 故 mode="params"。
         两种模式渲染的是同一个组件实例（位置没变，Vue 直接复用），校验只在手动态的底部操作栏用到。 -->
    <QuestionEditor
      ref="editorRef"
      :draft="form"
      :mode="mode === 'ai' ? 'params' : 'edit'"
      @change="dirty = true"
    />

    <template v-if="mode === 'manual'">
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
              title="生成后自动复核答案 / 解析的轮数；此项为全局设置，与拍照识题共用；超轮仍有异常将提醒人工介入"
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
            <AppFilterChips
              label="变式策略（可多选）"
              label-width="auto"
              :options="STRATEGIES"
              :model-value="ai.strategies"
              @update:model-value="ai.strategies = $event"
            />
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
          :saved="savedIds"
          :saved-by-id="savedById"
          :issues="issueById"
          :verify-rounds="verifyReport?.rounds.length ?? 0"
          :requested-type="form.type"
          @adopt="adopt"
          @edit="editResult"
          @discard="discard"
        />
      </template>
    </template>

    <!-- 编辑入库：AI 出题结果卡片的「编辑入库 / 重新编辑」共用这一个弹窗 -->
    <QuestionEditorModal
      v-if="editOpen && editingGen"
      :draft="editDraft"
      :title="editQuestionId ? '编辑已入库题目' : '编辑题目'"
      @close="editOpen = false"
    >
      <template #footer="{ validate }">
        <button class="btn btn-ghost" type="button" @click="editOpen = false">取消</button>
        <button class="btn btn-ghost" type="button" :disabled="editSaving" @click="saveEdit(false, validate)">存草稿</button>
        <button class="btn btn-primary" type="button" :disabled="editSaving" @click="saveEdit(true, validate)">
          {{ editSaving ? '保存中…' : '提交审核' }}
        </button>
      </template>
    </QuestionEditorModal>

    <!-- 学生视角预览：与题库管理同一个抽屉组件，样式不再各写一份 -->
    <QuestionPreviewDrawer v-if="previewOpen" :question="previewQuestion" @close="previewOpen = false" />

    <!-- 知识点树弹窗由 QuestionEditor 自带（它就挂在编辑表单里），页面不再持有它 -->
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

/* 题目编辑表单（基本信息面板 + 题干 / 选项 / 答案 / 解析）整块由 QuestionEditor 渲染，
   它自带那一套样式（含面板末尾的小字、知识点行、选项区、判断题按钮、填空多空）。
   本文件只剩：录题方式切换、底部操作栏，以及 AI 出题那一屏。 */

/* ===== 录题方式切换（手动录入 / AI 出题） ===== */
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

/* 变式条里那行小字（组件搬走后这条只剩这一个用处，故留在本文件） */
.prop-hint { font-size: 12px; color: var(--sub); }

.action-bar {
  display: flex;
  align-items: center;
  padding: 12px 18px;
  position: sticky;
  bottom: 0;
  z-index: 5;
}

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
.run-steps { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: center; }
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
</style>
