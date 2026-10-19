<script setup lang="ts">
/**
 * 机构端 · 试卷管理 → 试卷导入（FR-PP 扩展）。
 *
 * 一条链路把「别人的卷子」变成「我的卷子 + 我的题」：
 * 上传（图片 / PDF / Word，多选 / 拖拽 / 粘贴）→ AI 识别（卷面 + 试题 + 可配置检查轮次）
 * → 试卷预览里逐题二次编辑 → 整卷确认入库（试卷进试卷库、题目进题目库）。
 *
 * 几个刻意的设计：
 * 1. **一次导入 = 一份试卷**：多张图片 / 多页 PDF 当作同一份卷子的各页，按页序识别再合并；
 *    这与「我的文件 → 文档识别」不同（那边是逐个文件各自成集）。
 * 2. **识别完必须落到纸面**：结果不摆成表单，而是按 A4 卷面渲染（`ImportPaperSheet`），
 *    老师对着卷面校对比对着字段列表更接近真实工作方式；题目块点选 → 右侧清单/编辑联动。
 * 3. **入库是一个原子动作**：校对期间所有改动都只在内存里，确认时整卷一次提交，
 *    不存在「卷已入库、题还没进」的中间态。
 * 4. **AI 只说结论，不替老师决定**：质检异常只打标并提醒人工核对，是否入库由老师点确认。
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { AppIcon, AppModal, appConfirm, showToast } from '@aiteach/shared'
import type { ImportRecognizedPaperPayload, OrgPaper, OrgQuestion } from '@aiteach/shared'
import { PaperPreviewModal, useBaseData, useScope } from '@aiteach/business-common'
import ImportPaperSheet from '@/components/paper/ImportPaperSheet.vue'
import QuestionEditorModal from '@/components/question/QuestionEditorModal.vue'
import type { MetaRowKey } from '@/components/question/QuestionEditor.vue'
import { getCheckRounds, setCheckRounds } from '@/api/ai-verify'
import {
  engineLabel,
  paperImportEngine,
  recheckPaper,
  recognizePaperImport,
  type PaperImportEngine,
  type RecognizedPaper,
  type RecognizedQuestion,
} from '@/api/ai-paper-import'
import { importRecognizedPaper } from '@/api/org'
import {
  MAX_SOURCE_FILES,
  MAX_SOURCE_MB,
  PAPER_SOURCE_ACCEPT,
  kindOfFile,
  readPaperSource,
  sizeMbOf,
  sourceKindText,
  type PaperSourceFile,
  type PaperSourceKind,
} from '@/utils/paper-source'
import { answerTextOf, draftFromPhotoResult, emptyQuestionDraft, hasContent } from '@/utils/question-draft'
import type { QuestionDraft } from '@/utils/question-draft'

const router = useRouter()
const { subjects, grades, ensure, pick } = useBaseData()
/** 顶部栏 scope：识别不出学段学科时的兜底（空着会被「学科必填」拦下） */
const { grade: scopeGrade, subject: scopeSubject } = useScope()

/* ==================== 阶段机 ==================== */

type Stage = 'upload' | 'running' | 'result' | 'done'
const stage = ref<Stage>('upload')

const STEPS = [
  { title: '上传文件', desc: '图片 / PDF / Word' },
  { title: 'AI 识别', desc: '卷面 + 试题 + 质检' },
  { title: '校对确认', desc: '试卷预览逐题核对' },
  { title: '入库完成', desc: '试卷库 + 题目库' },
]

const stepIndex = computed(() =>
  stage.value === 'upload' ? 0 : stage.value === 'running' ? 1 : stage.value === 'result' ? 2 : 3,
)
const steps = computed(() =>
  STEPS.map((item, index) => ({
    ...item,
    state: index < stepIndex.value ? 'done' : index === stepIndex.value ? 'now' : 'todo',
  })),
)

/* ==================== 源文件（上传 / 解析） ==================== */

type EntryStatus = 'reading' | 'ready' | 'failed'

/** 上传队列的一项：原始 File 留在 files map 里（失败重试用），解析结果放 source */
interface SourceEntry {
  key: string
  name: string
  sizeMb: number
  kind: PaperSourceKind
  status: EntryStatus
  reason?: string
  source?: PaperSourceFile
  /** 图片的压缩预览 */
  preview?: string
}

const entries = ref<SourceEntry[]>([])
const files = new Map<string, File>()
const fileInput = ref<HTMLInputElement | null>(null)
const dragOver = ref(false)
let seq = 0

const FILE_ICON: Record<PaperSourceKind, string> = { image: 'image', pdf: 'pdf', word: 'word' }

const readySources = computed(() =>
  entries.value.filter((row) => row.status === 'ready' && row.source).map((row) => row.source as PaperSourceFile),
)
const readingCount = computed(() => entries.value.filter((row) => row.status === 'reading').length)
const failedCount = computed(() => entries.value.filter((row) => row.status === 'failed').length)

function pickFiles() {
  fileInput.value?.click()
}

/** 入队 → 立即本地解析（PDF 扫描件、老 .doc 这类读不出来的当场就说，不必等点「开始识别」） */
function addFiles(list: FileList | File[] | null) {
  if (!list) return
  const accepted: File[] = []
  for (const file of Array.from(list)) {
    if (!kindOfFile(file)) {
      showToast(`不支持的格式：${file.name}（仅图片 / PDF / Word）`, 'error')
      continue
    }
    if (file.size > MAX_SOURCE_MB * 1024 * 1024) {
      showToast(`${file.name} 超过 ${MAX_SOURCE_MB}MB，请压缩后再上传`, 'error')
      continue
    }
    if (entries.value.length + accepted.length >= MAX_SOURCE_FILES) {
      showToast(`单次最多 ${MAX_SOURCE_FILES} 个文件（页）`, 'error')
      break
    }
    accepted.push(file)
  }
  for (const file of accepted) {
    const key = `src_${++seq}`
    files.set(key, file)
    /* 必须 `reactive` 包装后再入列：入列后由 loadEntry 异步改 status / preview，
       若持有的是原始对象，改动不会触发视图更新（列表会永远停在「解析中」） */
    const entry = reactive<SourceEntry>({
      key,
      name: file.name || `粘贴图片_${seq}.png`,
      sizeMb: sizeMbOf(file),
      kind: kindOfFile(file) ?? 'image',
      status: 'reading',
    })
    entries.value.push(entry)
    void loadEntry(entry)
  }
  /* 允许连续选择同一文件 */
  if (fileInput.value) fileInput.value.value = ''
}

async function loadEntry(entry: SourceEntry) {
  const file = files.get(entry.key)
  if (!file) return
  entry.status = 'reading'
  entry.reason = undefined
  try {
    const source = await readPaperSource(file, seq)
    entry.source = source
    entry.kind = source.kind
    entry.preview = source.dataUrl
    entry.status = 'ready'
  } catch (error) {
    entry.source = undefined
    entry.preview = undefined
    entry.reason = error instanceof Error ? error.message : '文件解析失败'
    entry.status = 'failed'
  }
}

function retryEntry(entry: SourceEntry) {
  void loadEntry(entry)
}

/** 文件大小文案：小于 0.1MB 时按 KB 显示（截图 / 单页 PDF 常只有几十 KB，写「0MB」等于没写） */
function sizeText(mb: number): string {
  return mb < 0.1 ? `${Math.max(1, Math.round(mb * 1024))}KB` : `${mb}MB`
}

function removeEntry(index: number) {
  const entry = entries.value[index]
  if (entry) files.delete(entry.key)
  entries.value.splice(index, 1)
}

function onDrop(event: DragEvent) {
  dragOver.value = false
  addFiles(event.dataTransfer?.files ?? null)
}

/**
 * 粘贴：截图 / 从文件管理器复制的 PDF、Word 都能直接进队列。
 * 焦点在输入框或富文本编辑器里时不接管 —— 那时用户要粘的是文字 / 插图。
 */
function onPaste(event: ClipboardEvent) {
  const target = event.target as HTMLElement | null
  if (target?.closest?.('[contenteditable="true"], input, textarea, select')) return
  const items = event.clipboardData?.items
  if (!items) return
  const list: File[] = []
  for (const item of Array.from(items)) {
    if (item.kind !== 'file') continue
    const file = item.getAsFile()
    if (!file) continue
    /* 剪贴板图片常常没有文件名，补一个带序号的，否则列表整列空白 */
    list.push(
      file.name
        ? file
        : new File([file], `粘贴图片_${Date.now()}_${list.length + 1}.png`, { type: file.type || 'image/png' }),
    )
  }
  if (!list.length) return
  event.preventDefault()
  addFiles(list)
}

/* ==================== 识别设置 ==================== */

const settings = reactive({
  /** 卷面识别（卷头 / 大题结构 / 分值 / 版式） */
  layout: true,
  /** 试题识别（题干 / 选项 / 答案 / 解析） */
  questions: true,
  /** AI 检查轮次（0 = 关闭，1~3） */
  rounds: getCheckRounds(),
  /** 兜底学科 / 年级 */
  subject: '',
  grade: '',
})

function onRoundsChange() {
  setCheckRounds(settings.rounds)
}

/** 引擎随「文件形态 + 已配置通道」变化，上传前后都要能看出来走的是真实 AI 还是演示数据 */
const engine = computed<PaperImportEngine>(() => paperImportEngine(readySources.value))
const engineText = computed(() => engineLabel(engine.value))
const engineTagClass = computed(() => (engine.value === 'mock' ? 'tag-gray' : 'tag-green'))

const canStart = computed(
  () => readySources.value.length > 0 && readingCount.value === 0 && settings.questions && !!settings.subject && !!settings.grade,
)
const startHint = computed(() => {
  if (!entries.value.length) return '先选择或拖入文件'
  if (readingCount.value) return `正在解析 ${readingCount.value} 个文件…`
  if (!readySources.value.length) return failedCount.value ? '所选文件都无法解析，请按提示处理' : '请添加可识别的文件'
  if (!settings.questions) return '请至少开启「试题识别」'
  if (!settings.subject || !settings.grade) return '请选择兜底学科与年级'
  return `${readySources.value.length} 个文件将被识别为同一份试卷`
})

/* ==================== 识别过程 ==================== */

const progress = reactive({ label: '准备中', percent: 0 })
const paper = ref<RecognizedPaper | null>(null)
const importing = ref(false)
const checking = ref(false)
const result = ref<{ paperId: number; paperName: string; questionCount: number } | null>(null)

/** 识别步骤（进度条下方）：阈值与 ai-paper-import 上报的百分比对齐 */
const runSteps = computed(() => {
  const list: Array<{ label: string; at: number }> = [{ label: '读取文件（本地解析 / 压缩）', at: 0 }]
  if (settings.layout) list.push({ label: '卷面识别（卷头 · 大题结构 · 分值 · 注意事项）', at: 8 })
  if (settings.questions) list.push({ label: '试题识别（题干 · 选项 · 答案 · 解析）', at: 36 })
  if (settings.rounds > 0) list.push({ label: `AI 检查复核（${settings.rounds} 轮）`, at: 76 })
  list.push({ label: '生成试卷预览', at: 99 })
  return list.map((item, index) => {
    const next = list[index + 1]?.at ?? 101
    return {
      label: item.label,
      state: progress.percent >= next ? 'done' : progress.percent >= item.at ? 'now' : 'todo',
    }
  })
})

async function startRecognize() {
  if (!canStart.value) return
  onRoundsChange()
  stage.value = 'running'
  progress.label = '读取文件'
  progress.percent = 3
  try {
    const recognized = await recognizePaperImport(
      readySources.value,
      {
        layout: settings.layout,
        questions: settings.questions,
        rounds: settings.rounds,
        subject: pick(subjects.value, settings.subject),
        grade: pick(grades.value, settings.grade),
      },
      (next) => {
        progress.label = next.label
        progress.percent = next.percent
      },
    )
    paper.value = recognized
    selectedId.value = recognized.questions[0]?.id ?? null
    stage.value = 'result'
    showToast(`识别完成：${recognized.questions.length} 题，请逐题核对`, 'success')
  } catch (error) {
    stage.value = 'upload'
    showToast(error instanceof Error ? error.message : '识别失败，请重试', 'error')
  }
}

/** 返回上传页重新识别：校对成果会丢，必须问一句 */
async function backToUpload() {
  if (!(await appConfirm('重新识别会丢弃当前的所有校对改动，确认返回上传页？', { type: 'warning' }))) return
  paper.value = null
  result.value = null
  stage.value = 'upload'
}

/* ==================== 校对：选中 / 编辑 / 调序 / 纳入 ==================== */

const selectedId = ref<string | null>(null)
const selected = computed(() => paper.value?.questions.find((row) => row.id === selectedId.value) ?? null)

/** 题目块的 DOM（点右侧清单要滚到对应题目）：纸面由子组件渲染，按 data-qid 在滚动容器里找 */
const sheetScroll = ref<HTMLElement | null>(null)

function selectAndScroll(id: string) {
  selectedId.value = id
  const el = sheetScroll.value?.querySelector<HTMLElement>(`[data-qid="${id}"]`)
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

const showAnswer = ref(true)

const included = computed(() => (paper.value?.questions ?? []).filter((row) => row.include))
const totalScore = computed(() =>
  included.value.reduce((sum, row) => sum + (Number(row.score) || 0), 0),
)
const totalCount = computed(() => included.value.length)
const scoreGap = computed(() => {
  const printed = paper.value?.layout.totalScore ?? 0
  return printed > 0 ? Math.round((printed - totalScore.value) * 100) / 100 : 0
})

const layoutNote = computed(() => {
  const info = paper.value?.layout
  if (!info) return ''
  return [
    `卷面识别：共 ${info.pageCount} 页`,
    `${info.columns} 栏`,
    info.hasAnswerSheet ? '含答题卡' : '',
    info.hasSealLine ? '含密封线' : '',
  ]
    .filter(Boolean)
    .join(' · ')
})

function toggleInclude(id: string) {
  const row = paper.value?.questions.find((item) => item.id === id)
  if (row) row.include = !row.include
}

function setAllInclude(value: boolean) {
  paper.value?.questions.forEach((row) => (row.include = value))
}

/** 题目在大题内上移 / 下移；跨大题不换组（换组等于改卷面结构，应走编辑而非拖拽） */
function moveQuestion(id: string, step: number) {
  const rows = paper.value?.questions
  if (!rows) return
  const row = rows.find((item) => item.id === id)
  if (!row) return
  const siblings = rows.filter((item) => item.sectionId === row.sectionId)
  const target = siblings[siblings.indexOf(row) + step]
  if (!target) return
  const a = rows.indexOf(row)
  const b = rows.indexOf(target)
  rows[a] = target
  rows[b] = row
  renumber()
}

/** 题号按卷面顺序重排：跨页合并后原编号可能重复 / 断档 */
function renumber() {
  paper.value?.questions.forEach((row, index) => (row.number = index + 1))
}

/* ==================== 题目二次编辑（复用录题中心的表单） ==================== */

/** 识别结果里没有、也不落库的字段不摆出来（与图片识题同一口径） */
const EDIT_ROWS: MetaRowKey[] = ['grade', 'subject', 'type', 'difficulty']
const editingId = ref<string | null>(null)
const editDraft = reactive<QuestionDraft>(emptyQuestionDraft())

function startEdit(id: string) {
  const row = paper.value?.questions.find((item) => item.id === id)
  if (!row) return
  Object.assign(
    editDraft,
    draftFromPhotoResult(row, {
      subject: paper.value?.subject ?? settings.subject,
      grade: paper.value?.grade ?? settings.grade,
    }),
  )
  editingId.value = id
}

/**
 * 保存：直接写回识别结果行 —— 入库提交读的就是这一份，不存在「改了但没生效」的中间态。
 * 选项过滤空值：老师删空的选项不该在卷面上留下一个孤零零的字母。
 */
function saveEdit() {
  const row = paper.value?.questions.find((item) => item.id === editingId.value)
  if (!row) return
  row.stem = editDraft.stem
  row.options = editDraft.type === '解答' || editDraft.type === '填空' ? [] : editDraft.options.filter((opt) => hasContent(opt))
  row.answer = answerTextOf(editDraft)
  row.analysis = editDraft.analysis
  row.subject = editDraft.subject
  row.grade = editDraft.grade
  row.type = editDraft.type
  row.difficulty = editDraft.difficulty
  row.knowledge = [...editDraft.knowledge].slice(0, 3)
  row.edited = true
  editingId.value = null
}

function cancelEdit() {
  editingId.value = null
}

/* ==================== AI 检查（结果页可重跑） ==================== */

const verifyTagClass = computed(() => {
  const info = paper.value?.verify
  if (!info?.ran) return 'tag-gray'
  if (info.manual) return 'tag-red'
  if (info.warn) return 'tag-orange'
  return 'tag-green'
})
const verifyText = computed(() => {
  const info = paper.value?.verify
  if (!info?.ran) return '未检查'
  if (info.manual) return '仍有异常，需人工核对'
  if (info.warn) return `通过（${info.warn} 处提醒）`
  return '全部通过'
})

/** 逐题问题清单（点一条跳到那道题） */
const issueRows = computed(() =>
  (paper.value?.questions ?? []).flatMap((row) =>
    row.issues.map((issue) => ({
      id: row.id,
      number: row.number,
      level: issue.level,
      aspect: issue.aspect,
      message: issue.message,
    })),
  ),
)
const errorCount = computed(() => issueRows.value.filter((row) => row.level === 'error').length)

async function runRecheck() {
  if (!paper.value || settings.rounds <= 0) return
  checking.value = true
  const rounds = settings.rounds
  try {
    const summary = await recheckPaper(paper.value.questions, rounds, (next) => {
      progress.label = next.label
    })
    paper.value.verify = summary
    showToast(
      summary.manual ? `检查完成：仍有 ${summary.error} 处异常，需人工核对` : '检查完成，未发现阻断性问题',
      summary.manual ? 'warning' : 'success',
    )
  } catch (error) {
    showToast(error instanceof Error ? error.message : '质检失败', 'error')
  } finally {
    checking.value = false
  }
}

/* ==================== 原文件查看（校对时对着原卷看） ==================== */

const originOpen = ref(false)

/* ==================== 真实排版预览（复用试卷预览弹窗） ==================== */

const layoutPreview = ref(false)

/** 识别结果 → 预览弹窗要的题目结构（id 用行号稳定映射，弹窗内部按 id 关联） */
function previewQuestion(row: RecognizedQuestion, index: number): OrgQuestion {
  return {
    id: index + 1,
    stem: row.stem,
    subject: row.subject || paper.value?.subject || '数学',
    grade: row.grade || paper.value?.grade || '高一',
    type: row.type,
    difficulty: row.difficulty,
    knowledge: row.knowledge,
    source: '文档导入',
    status: 'approved',
    library: 'org',
    categoryId: 2,
    ownerId: 101,
    owner: '我',
    options: row.options,
    answer: row.answer,
    analysis: row.analysis,
    useCount: 0,
    updatedAt: '',
  }
}

const previewQuestions = computed<OrgQuestion[]>(() =>
  included.value.map((row, index) => previewQuestion(row, index)),
)

const previewPaper = computed<OrgPaper | null>(() => {
  const source = paper.value
  if (!source) return null
  const idOf = new Map(included.value.map((row, index) => [row.id, index + 1]))
  let sectionId = 0
  const sections = source.sections
    .map((section) => {
      const rows = source.questions.filter((row) => row.sectionId === section.id && row.include)
      return {
        id: ++sectionId,
        title: section.title,
        material: section.material || undefined,
        materialHint: section.hint || undefined,
        questions: rows.map((row) => ({ questionId: idOf.get(row.id) ?? 0, score: row.score })),
      }
    })
    .filter((section) => section.questions.length > 0)
  return {
    id: 0,
    name: source.name || '试卷预览',
    subject: source.subject,
    grade: source.grade,
    duration: source.duration,
    status: 'draft',
    sections,
    owner: '我',
    updatedAt: '',
    notices: source.notices,
    sharedSquare: false,
  }
})

/* ==================== 确认入库 ==================== */

async function confirmImport() {
  const source = paper.value
  if (!source) return
  if (source.name.trim().length < 2) {
    showToast('试卷名称至少 2 个字', 'error')
    return
  }
  if (!included.value.length) {
    showToast('请至少纳入 1 道题目', 'error')
    return
  }
  if (!source.subject || !source.grade) {
    showToast('请补全试卷的学科与年级', 'error')
    return
  }
  const ok = await appConfirm(
    `确认将《${source.name.trim()}》整卷入库？试卷进入试卷库，${included.value.length} 道题进入机构题库。`,
    { type: 'info' },
  )
  if (!ok) return

  const payload: ImportRecognizedPaperPayload = {
    name: source.name.trim(),
    subject: source.subject,
    grade: source.grade,
    duration: source.duration,
    notices: source.notices,
    sections: source.sections.map((section) => ({
      title: section.title,
      hint: section.hint,
      material: section.material,
      questions: source.questions
        .filter((row) => row.sectionId === section.id && row.include)
        .map((row) => ({
          stem: row.stem,
          options: row.options,
          answer: row.answer,
          analysis: row.analysis,
          subject: row.subject,
          grade: row.grade,
          type: row.type,
          difficulty: row.difficulty,
          knowledge: row.knowledge,
          score: row.score,
        })),
    })),
  }

  importing.value = true
  try {
    const saved = await importRecognizedPaper(payload)
    result.value = saved
    stage.value = 'done'
    showToast(`入库完成：试卷已进试卷库，${saved.questionCount} 题已进题目库`, 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '入库失败，请重试', 'error')
  } finally {
    importing.value = false
  }
}

/** 继续导入：清空本轮状态，回上传页 */
function restart() {
  stage.value = 'upload'
  entries.value = []
  files.clear()
  paper.value = null
  result.value = null
  selectedId.value = null
  progress.percent = 0
  settings.layout = true
  settings.questions = true
  settings.rounds = getCheckRounds()
}

onMounted(async () => {
  window.addEventListener('paste', onPaste)
  await ensure()
  settings.subject = pick(subjects.value, scopeSubject.value)
  settings.grade = pick(grades.value, scopeGrade.value)
})
onBeforeUnmount(() => {
  window.removeEventListener('paste', onPaste)
})
</script>

<template>
  <div class="import-page">
    <!-- 步骤条：四个阶段一眼看完，当前步高亮（不做可点击跳转 —— 回退会丢校对成果） -->
    <div class="steps">
      <div v-for="(step, index) in steps" :key="step.title" class="step" :class="step.state">
        <span class="step-no">
          <AppIcon v-if="step.state === 'done'" name="check" :size="13" />
          <template v-else>{{ index + 1 }}</template>
        </span>
        <span class="step-text">
          <b>{{ step.title }}</b>
          <small>{{ step.desc }}</small>
        </span>
        <span v-if="index < steps.length - 1" class="step-line" />
      </div>
    </div>

    <!-- ===== 1. 上传 + 识别设置 ===== -->
    <div v-if="stage === 'upload'" class="upload-stage">
      <div class="panel up-panel">
        <div class="blk-head">
          <span class="blk-title">选择试卷文件</span>
          <span class="f-hint">支持 jpg / png / webp 图片、PDF、Word(.docx)</span>
          <span class="blk-right">
            <span class="tag" :class="engineTagClass">{{ engineText }}</span>
          </span>
        </div>

        <div
          class="drop-zone"
          :class="{ hover: dragOver, compact: entries.length > 0 }"
          @click="pickFiles"
          @dragover.prevent="dragOver = true"
          @dragleave="dragOver = false"
          @drop.prevent="onDrop"
        >
          <AppIcon name="upload" :size="24" />
          <p class="dz-title">把试卷拖到这里，或点击选择文件</p>
          <p class="dz-hint">
            可一次选多张图片 / 多页 PDF，它们会按顺序作为<b>同一份试卷</b>识别；也可以直接 Ctrl+V 粘贴截图
          </p>
          <input
            ref="fileInput"
            type="file"
            multiple
            hidden
            :accept="PAPER_SOURCE_ACCEPT"
            @change="addFiles(($event.target as HTMLInputElement).files)"
          />
        </div>

        <div v-if="entries.length" class="src-list">
          <div v-for="(entry, index) in entries" :key="entry.key" class="src-item" :class="entry.status">
            <span class="src-thumb">
              <img v-if="entry.preview" :src="entry.preview" :alt="entry.name" />
              <AppIcon v-else :name="FILE_ICON[entry.kind]" :size="18" />
            </span>
            <span class="src-body">
              <span class="src-name" :title="entry.name">{{ entry.name }}</span>
              <span class="src-meta">
                <span>{{ sourceKindText(entry.kind) }} · {{ sizeText(entry.sizeMb) }}</span>
                <span v-if="entry.kind === 'pdf' && entry.source?.pages"> · 共 {{ entry.source.pages }} 页</span>
                <span v-if="entry.status === 'reading'" class="tag tag-blue">解析中</span>
                <span v-else-if="entry.status === 'failed'" class="tag tag-red">无法识别</span>
                <span v-else class="tag tag-green">已就绪</span>
              </span>
              <span v-if="entry.status === 'failed'" class="src-err">{{ entry.reason }}</span>
            </span>
            <span class="src-ops">
              <button v-if="entry.status === 'failed'" class="mini-btn" type="button" @click="retryEntry(entry)">重新解析</button>
              <button class="mini-btn danger" type="button" @click="removeEntry(index)">移除</button>
            </span>
          </div>
        </div>

        <p v-if="!entries.length" class="up-tip">
          <AppIcon name="info" :size="13" />
          图片和 PDF 走视觉识别、Word 走文本识别；未配置 AI 通道时用本地演示数据跑通全流程
        </p>
      </div>

      <div class="panel cfg-panel">
        <div class="blk-head">
          <span class="blk-title">识别设置</span>
        </div>

        <div class="cfg-body">
          <label class="cfg-switch">
            <input v-model="settings.layout" type="checkbox" />
            <span>
              <b>卷面识别</b>
              <small>卷头信息、大题结构、分值、注意事项、版式特征</small>
            </span>
          </label>
          <label class="cfg-switch">
            <input v-model="settings.questions" type="checkbox" />
            <span>
              <b>试题识别</b>
              <small>逐题转写题干、选项、答案、解析，并标注知识点</small>
            </span>
          </label>

          <div class="f-field">
            <label class="f-label">AI 检查轮次</label>
            <select v-model.number="settings.rounds" class="f-select" @change="onRoundsChange">
              <option :value="0">关闭自动检查</option>
              <option v-for="n in 3" :key="n" :value="n">{{ n }} 轮</option>
            </select>
            <p class="f-hint">每轮独立复核答案与解析，有错则带修正继续下一轮；超出轮次仍有异常会提醒人工核对</p>
          </div>

          <div class="cfg-row">
            <div class="f-field">
              <label class="f-label">兜底学科</label>
              <select v-model="settings.subject" class="f-select">
                <option v-for="item in subjects" :key="item" :value="item">{{ item }}</option>
              </select>
            </div>
            <div class="f-field">
              <label class="f-label">兜底年级</label>
              <select v-model="settings.grade" class="f-select">
                <option v-for="item in grades" :key="item" :value="item">{{ item }}</option>
              </select>
            </div>
          </div>
          <p class="f-hint">卷面能读出学段学科时以卷面为准，这里只做兜底，可在校对时逐题修改</p>
        </div>

        <div class="cfg-foot">
          <button class="btn btn-primary" type="button" :disabled="!canStart" @click="startRecognize">
            <AppIcon name="sparkles" :size="15" /> 开始 AI 识别
          </button>
          <span class="f-hint">{{ startHint }}</span>
        </div>
      </div>
    </div>

    <!-- ===== 2. 识别中 ===== -->
    <div v-else-if="stage === 'running'" class="panel running-panel">
      <div class="run-head">
        <AppIcon name="sparkles" :size="20" />
        <b>正在识别试卷</b>
        <span class="tag" :class="engineTagClass">{{ engineText }}</span>
        <span class="f-hint">{{ readySources.length }} 个文件 · {{ settings.layout ? '含卷面识别' : '仅试题识别' }}</span>
      </div>
      <div class="run-bar"><i :style="{ width: `${progress.percent}%` }" /></div>
      <p class="run-label">{{ progress.label }} · {{ progress.percent }}%</p>
      <ul class="run-steps">
        <li v-for="item in runSteps" :key="item.label" :class="item.state">
          <AppIcon :name="item.state === 'done' ? 'check' : item.state === 'now' ? 'sparkles' : 'clock'" :size="14" />
          {{ item.label }}
        </li>
      </ul>
      <p class="f-hint run-tip">识别期间不要关闭页面；多页试卷按页顺序识别，题量越多耗时越长</p>
    </div>

    <!-- ===== 3. 校对确认（左试卷预览 / 右核对面板） ===== -->
    <div v-else-if="stage === 'result' && paper" class="result-stage">
      <div class="panel preview-pane">
        <div class="pane-head">
          <span class="blk-title">试卷预览</span>
          <span class="f-hint">{{ totalCount }} 题 · {{ totalScore }} 分</span>
          <span class="pane-ops">
            <button class="btn btn-ghost btn-sm" type="button" @click="originOpen = true">
              <AppIcon name="file" :size="13" /> 原文件
            </button>
            <label class="ans-toggle">
              <input v-model="showAnswer" type="checkbox" />
              显示答案
            </label>
            <button class="btn btn-ghost btn-sm" type="button" :disabled="!included.length" @click="layoutPreview = true">
              <AppIcon name="eye" :size="13" /> 排版预览
            </button>
            <button class="btn btn-ghost btn-sm" type="button" @click="backToUpload">
              <AppIcon name="refresh" :size="13" /> 重新识别
            </button>
          </span>
        </div>
        <div ref="sheetScroll" class="sheet-scroll">
          <ImportPaperSheet
            :name="paper.name"
            :subject="paper.subject"
            :grade="paper.grade"
            :duration="paper.duration"
            :notices="paper.notices"
            :sections="paper.sections"
            :questions="paper.questions"
            :selected-id="selectedId"
            :show-answer="showAnswer"
            :layout-note="layoutNote"
            @select="selectAndScroll"
            @edit="startEdit"
            @toggle="toggleInclude"
            @move="moveQuestion"
          />
        </div>
      </div>

      <div class="panel side-pane">
        <!-- 卷面信息（可直接改，改完入库就是改后的值） -->
        <div class="side-card">
          <div class="card-head">
            <span class="blk-title">卷面信息</span>
            <span class="tag" :class="engineTagClass">{{ engineText }}</span>
          </div>
          <div class="f-field">
            <label class="f-label">试卷名称<span class="req">*</span></label>
            <input v-model="paper.name" class="f-input" maxlength="50" placeholder="如 2026 学年高一数学期中试卷" />
          </div>
          <div class="cfg-row">
            <div class="f-field">
              <label class="f-label">学科<span class="req">*</span></label>
              <select v-model="paper.subject" class="f-select">
                <option v-for="item in subjects" :key="item" :value="item">{{ item }}</option>
              </select>
            </div>
            <div class="f-field">
              <label class="f-label">年级<span class="req">*</span></label>
              <select v-model="paper.grade" class="f-select">
                <option v-for="item in grades" :key="item" :value="item">{{ item }}</option>
              </select>
            </div>
          </div>
          <div class="cfg-row">
            <div class="f-field">
              <label class="f-label">考试时长（分钟）</label>
              <input v-model.number="paper.duration" class="f-input" type="number" min="10" max="300" step="5" />
            </div>
            <div class="f-field">
              <label class="f-label">满分（题目合计）</label>
              <input class="f-input" :value="totalScore" disabled />
            </div>
          </div>
          <p v-if="scoreGap !== 0" class="score-warn">
            <AppIcon name="warning" :size="13" />
            卷面标注满分 {{ paper.layout.totalScore }} 分，与当前题目合计相差 {{ Math.abs(scoreGap) }} 分
          </p>
          <div class="meta-row">
            <span class="tag tag-gray">共 {{ paper.layout.pageCount }} 页</span>
            <span class="tag tag-gray">{{ paper.layout.columns }} 栏</span>
            <span v-if="paper.layout.hasAnswerSheet" class="tag tag-gray">有答题卡</span>
            <span v-if="paper.layout.hasSealLine" class="tag tag-gray">有密封线</span>
            <span class="tag tag-gray">来源：真题导入</span>
          </div>
          <ul v-if="paper.layout.notes.length" class="layout-notes">
            <li v-for="(note, index) in paper.layout.notes" :key="index">{{ note }}</li>
          </ul>
        </div>

        <!-- AI 检查（轮次可改、可重跑，只看结论不替老师决定） -->
        <div class="side-card">
          <div class="card-head">
            <span class="blk-title">AI 检查</span>
            <span class="tag" :class="verifyTagClass">{{ verifyText }}</span>
          </div>
          <div class="check-row">
            <select v-model.number="settings.rounds" class="f-select" style="width: 104px" @change="onRoundsChange">
              <option :value="0">关闭</option>
              <option v-for="n in 3" :key="n" :value="n">{{ n }} 轮</option>
            </select>
            <button class="btn btn-ghost btn-sm" type="button" :disabled="checking || settings.rounds === 0" @click="runRecheck">
              <AppIcon name="refresh" :size="13" /> {{ checking ? '检查中…' : '重新质检' }}
            </button>
            <span class="f-hint">{{ paper.verify.ran ? `已执行 ${paper.verify.rounds} 轮` : '未执行' }}</span>
          </div>
          <p v-if="paper.verify.manual" class="manual-warn">
            <AppIcon name="warning" :size="13" />
            超过 {{ paper.verify.rounds }} 轮仍有 {{ errorCount }} 处异常，请逐题人工核对后再入库
          </p>
          <div v-if="issueRows.length" class="issue-list">
            <button
              v-for="(issue, index) in issueRows.slice(0, 12)"
              :key="index"
              class="issue-item"
              type="button"
              @click="selectAndScroll(issue.id)"
            >
              <span class="tag" :class="issue.level === 'error' ? 'tag-red' : 'tag-orange'">
                {{ issue.level === 'error' ? '异常' : '提醒' }}
              </span>
              <span class="issue-text">第 {{ issue.number }} 题 · {{ issue.aspect }}：{{ issue.message }}</span>
            </button>
            <p v-if="issueRows.length > 12" class="f-hint">另有 {{ issueRows.length - 12 }} 条，点题目逐题查看</p>
          </div>
          <p v-else-if="paper.verify.ran" class="f-hint">未发现答案 / 解析问题</p>
        </div>

        <!-- 题目清单：选中行的分值 / 编辑 / 纳入都在这里，避免卷面上塞表单 -->
        <div class="side-card list-card">
          <div class="card-head">
            <span class="blk-title">题目清单</span>
            <span class="f-hint">{{ included.length }}/{{ paper.questions.length }} 题纳入</span>
            <span class="pane-ops">
              <button class="mini-btn" type="button" @click="setAllInclude(true)">全部纳入</button>
              <button class="mini-btn" type="button" @click="setAllInclude(false)">全部移出</button>
            </span>
          </div>

          <div v-if="selected" class="q-inspector">
            <span class="qi-title">第 {{ selected.number }} 题 · {{ selected.type }}</span>
            <label class="qi-score">
              分值
              <input v-model.number="selected.score" class="f-input" type="number" min="0.5" max="100" step="0.5" />
            </label>
            <button class="mini-btn" type="button" @click="startEdit(selected.id)">编辑</button>
            <button class="mini-btn" type="button" @click="toggleInclude(selected.id)">{{ selected.include ? '移出' : '纳入' }}</button>
          </div>

          <div class="q-list">
            <button
              v-for="row in paper.questions"
              :key="row.id"
              class="q-row"
              :class="{ on: row.id === selectedId, off: !row.include }"
              type="button"
              @click="selectAndScroll(row.id)"
            >
              <span class="qr-no">{{ row.number }}</span>
              <span class="qr-main">
                <b>{{ row.type }}</b>
                <small>{{ row.knowledge.join('、') || '知识点待补' }}</small>
              </span>
              <span class="qr-score">{{ row.score }} 分</span>
              <span
                class="qr-dot"
                :class="
                  !row.include
                    ? 'off'
                    : row.issues.some((item) => item.level === 'error')
                      ? 'error'
                      : row.issues.length
                        ? 'warn'
                        : 'ok'
                "
              />
            </button>
          </div>
        </div>

        <div class="side-foot">
          <div class="sum">
            合计 <b>{{ totalCount }}</b> 题 · <b>{{ totalScore }}</b> 分
          </div>
          <button class="btn btn-primary" type="button" :disabled="importing || !included.length" @click="confirmImport">
            <AppIcon name="check" :size="15" /> {{ importing ? '入库中…' : '确认整卷入库' }}
          </button>
          <p class="f-hint">确认后：试卷入试卷库可直接使用，题目入机构题库可检索组卷</p>
        </div>
      </div>
    </div>

    <!-- ===== 4. 入库完成 ===== -->
    <div v-else-if="stage === 'done' && result" class="panel done-panel">
      <span class="done-icon"><AppIcon name="check" :size="26" /></span>
      <h3>《{{ result.paperName }}》已入库</h3>
      <p class="done-sub">
        {{ result.questionCount }} 道题已进入机构题库，试卷已进入试卷库（来源：真题导入）
      </p>
      <div class="done-stats">
        <div class="done-stat">
          <b>{{ result.questionCount }}</b>
          <span>题目入题目库</span>
        </div>
        <div class="done-stat">
          <b>1</b>
          <span>试卷入试卷库</span>
        </div>
        <div class="done-stat">
          <b>{{ totalScore }}</b>
          <span>试卷总分</span>
        </div>
      </div>
      <div class="done-ops">
        <button class="btn btn-primary" type="button" @click="router.push('/paper/list')">去试卷库查看</button>
        <button class="btn btn-ghost" type="button" @click="router.push('/question/bank')">去题库查看</button>
        <button class="btn btn-ghost" type="button" @click="restart">继续导入</button>
      </div>
    </div>

    <!-- 原文件查看：校对时对着原卷看（图片给图，PDF / Word 给抽取文本） -->
    <AppModal v-if="originOpen" title="原始文件" :width="760" @close="originOpen = false">
      <div class="origin-list">
        <div v-for="entry in entries" :key="entry.key" class="origin-item">
          <div class="origin-head">
            <AppIcon :name="FILE_ICON[entry.kind]" :size="15" />
            <b>{{ entry.name }}</b>
            <span class="f-hint">
              {{ sourceKindText(entry.kind) }} · {{ sizeText(entry.sizeMb) }}
              <template v-if="entry.kind === 'pdf' && entry.source?.pages"> · 共 {{ entry.source.pages }} 页</template>
            </span>
          </div>
          <img v-if="entry.preview" class="origin-img" :src="entry.preview" :alt="entry.name" />
          <pre v-else-if="entry.source?.text" class="origin-text">{{ entry.source.text.slice(0, 4000) }}</pre>
          <p v-else class="f-hint">{{ entry.reason ?? '没有可预览的内容' }}</p>
        </div>
      </div>
    </AppModal>

    <!-- 真实排版预览：看分页 / 分栏 / 答题卡效果（与试卷库「预览」同一个弹窗） -->
    <PaperPreviewModal
      v-if="layoutPreview && previewPaper"
      :paper="previewPaper"
      :questions="previewQuestions"
      @close="layoutPreview = false"
    />

    <!-- 二次编辑：与录题中心同一张表单（题型 / 难度 / 知识点 / 选项 / 答案解析） -->
    <QuestionEditorModal v-if="editingId" :draft="editDraft" :rows="EDIT_ROWS" title="编辑识别结果" @close="cancelEdit">
      <template #footer>
        <button class="btn btn-ghost" type="button" @click="cancelEdit">取消</button>
        <button class="btn btn-primary" type="button" @click="saveEdit">保存修改</button>
      </template>
    </QuestionEditorModal>
  </div>
</template>

<style scoped>
/* ===== 页面骨架 =====
   顶部栏 62 + 内容区上下内边距 44（与试卷库 .paper-layout 同一口径）；
   四个阶段都在这块定高区域里跑，长内容由各 pane 内部滚动，整页不跟着跳。 */
.import-page {
  --content-h: calc(100vh - 106px);
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: var(--content-h);
  min-height: 560px;
}

/* ===== 步骤条 ===== */
.steps {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 10px 16px;
  flex-shrink: 0;
}
.step {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}
.step-no {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  border-radius: 50%;
  background: #eef1f8;
  color: var(--sub);
  font-size: 12px;
  font-weight: 700;
}
.step.done .step-no {
  background: var(--success-soft);
  color: var(--success);
}
.step.now .step-no {
  background: var(--brand-grad);
  color: #fff;
  box-shadow: 0 4px 10px rgba(0, 180, 166, 0.3);
}
.step-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.35;
}
.step-text b {
  font-size: 13px;
  color: var(--sub);
  font-weight: 600;
}
.step.now .step-text b {
  color: var(--ink);
}
.step.done .step-text b {
  color: var(--ink-2);
}
.step-text small {
  font-size: 11px;
  color: var(--sub);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 步骤之间的连线：贴在文字右侧，最后一步不画 */
.step-line {
  flex: 1;
  height: 1px;
  min-width: 12px;
  background: var(--border);
  margin: 0 4px;
}

/* ===== 1. 上传 ===== */
.upload-stage {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 380px;
  gap: 14px;
  flex: 1;
  min-height: 0;
  overflow: auto;
  align-items: stretch;
}
.up-panel,
.cfg-panel {
  padding: 16px 18px 18px;
  min-height: 0;
}
/* 左栏文件多了自己滚，右栏的「开始 AI 识别」始终留在视野里 */
.up-panel {
  overflow: auto;
}
.blk-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.blk-title {
  font-size: 14.5px;
  font-weight: 700;
  color: var(--ink);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.blk-title::before {
  content: '';
  width: 4px;
  height: 15px;
  border-radius: 2px;
  background: var(--brand-grad);
}
.blk-right {
  margin-left: auto;
  display: flex;
  gap: 8px;
  align-items: center;
}
.blk-head .f-hint {
  margin-top: 0;
}

.drop-zone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  text-align: center;
  border: 1.5px dashed #cfd8e6;
  border-radius: 12px;
  background: #fafcff;
  padding: 34px 20px;
  cursor: pointer;
  color: var(--brand-deep);
  transition: border-color 0.15s, background 0.15s;
}
.drop-zone.compact {
  padding: 20px;
}
.drop-zone:hover,
.drop-zone.hover {
  border-color: var(--brand);
  background: var(--brand-soft);
}
.dz-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
}
.dz-hint {
  font-size: 12px;
  color: var(--sub);
  line-height: 1.6;
  max-width: 460px;
}
.dz-hint b {
  color: var(--ink-2);
}

.src-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}
.src-item {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 8px 10px;
  background: #fff;
}
.src-item.failed {
  border-color: rgba(214, 69, 69, 0.35);
  background: rgba(214, 69, 69, 0.03);
}
.src-thumb {
  width: 46px;
  height: 46px;
  flex-shrink: 0;
  border-radius: 8px;
  background: #f3f5fa;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  color: var(--sub);
}
.src-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.src-body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
}
.src-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.src-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  color: var(--sub);
}
.src-err {
  font-size: 11.5px;
  color: var(--danger);
  line-height: 1.5;
}
.src-ops {
  display: inline-flex;
  gap: 2px;
  flex-shrink: 0;
}
.up-tip {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--sub);
  margin-top: 12px;
}

/* 识别设置 */
.cfg-panel {
  display: flex;
  flex-direction: column;
}
.cfg-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.cfg-switch {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 12px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.cfg-switch:hover {
  border-color: var(--brand);
}
.cfg-switch input {
  margin-top: 2px;
  accent-color: var(--brand);
}
.cfg-switch span {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.cfg-switch b {
  font-size: 13px;
  color: var(--ink);
}
.cfg-switch small {
  font-size: 11.5px;
  color: var(--sub);
  line-height: 1.5;
}
.cfg-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.cfg-row .f-field {
  margin-bottom: 0;
}
.cfg-body .f-field {
  margin-bottom: 0;
}
.cfg-foot {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px dashed var(--border);
}
.cfg-foot .f-hint {
  text-align: center;
}

/* ===== 2. 识别中 ===== */
.running-panel {
  flex: 1;
  padding: 40px 48px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  justify-content: center;
  max-width: 720px;
  margin: 0 auto;
  width: 100%;
}
.run-head {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--brand-deep);
}
.run-head b {
  font-size: 16px;
  color: var(--ink);
}
.run-head .f-hint {
  margin-top: 0;
}
.run-bar {
  height: 8px;
  border-radius: 999px;
  background: #eef1f7;
  overflow: hidden;
}
.run-bar i {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--brand-grad);
  transition: width 0.4s ease;
}
.run-label {
  font-size: 12.5px;
  color: var(--ink-2);
  text-align: right;
}
.run-steps {
  display: flex;
  flex-direction: column;
  gap: 9px;
  margin-top: 6px;
}
.run-steps li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--sub);
}
.run-steps li.done {
  color: var(--success);
}
.run-steps li.now {
  color: var(--ink);
  font-weight: 600;
}
.run-tip {
  text-align: center;
  margin-top: 8px;
}

/* ===== 3. 校对（左预览 / 右核对） ===== */
.result-stage {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 372px;
  gap: 14px;
  flex: 1;
  min-height: 0;
}
.preview-pane,
.side-pane {
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.preview-pane {
  overflow: hidden;
}
.pane-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.pane-head .f-hint {
  margin-top: 0;
}
.pane-ops {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.ans-toggle {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12.5px;
  color: var(--ink-2);
  cursor: pointer;
  user-select: none;
}
.ans-toggle input {
  accent-color: var(--brand);
}
/* 卷面区：纸面比容器高，内部滚动（滚的是纸，不是整页） */
.sheet-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 16px;
  background: #f2f5fa;
}

/* 右侧核对面板：整块可滚（卷面信息 + 质检 + 清单三张卡高度不定，屏幕矮时靠外滚动兜住），
   确认条 sticky 在底部 —— 滚到哪儿都点得到「确认整卷入库」 */
.side-pane {
  border-radius: var(--radius);
  overflow: auto;
}
.side-card {
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.side-card .f-field {
  margin-bottom: 10px;
}
.side-card .f-field:last-child {
  margin-bottom: 0;
}
.card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
.card-head .f-hint {
  margin-top: 0;
}
.meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.score-warn {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--warn);
  background: var(--warn-soft);
  border-radius: 8px;
  padding: 6px 9px;
  margin-bottom: 8px;
  line-height: 1.5;
}
.layout-notes {
  margin-top: 8px;
  padding-left: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.layout-notes li {
  font-size: 11px;
  color: var(--sub);
  line-height: 1.5;
}
.layout-notes li::before {
  content: '· ';
}

.check-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.check-row .f-hint {
  margin-top: 0;
}
.manual-warn {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 11.5px;
  color: var(--danger);
  background: var(--danger-soft);
  border-radius: 8px;
  padding: 7px 9px;
  margin-top: 8px;
  line-height: 1.5;
}
.issue-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 8px;
  max-height: 132px;
  overflow: auto;
}
.issue-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  text-align: left;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  padding: 6px 8px;
}
.issue-item:hover {
  border-color: var(--brand);
}
.issue-text {
  font-size: 11.5px;
  color: var(--ink-2);
  line-height: 1.5;
}

/* 题目清单：整页可滚，清单自身限高再滚一层 —— 题量大时不用一路滑到页底找第 30 题 */
.list-card {
  display: flex;
  flex-direction: column;
  border-bottom: none;
}
.list-card .q-list {
  max-height: 34vh;
  overflow: auto;
  margin: 0 -6px;
  padding: 0 6px;
}
.q-inspector {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  background: var(--brand-soft);
  border-radius: 8px;
  padding: 7px 9px;
  margin-bottom: 8px;
}
.qi-title {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--brand-deep);
}
.qi-score {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  color: var(--ink-2);
}
.qi-score .f-input {
  width: 62px;
  height: 28px;
  font-size: 12px;
  padding: 0 6px;
}
.q-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 6px 8px;
  background: transparent;
  transition: background 0.15s, border-color 0.15s;
}
.q-row:hover {
  background: #f7fafc;
}
.q-row.on {
  background: var(--brand-soft);
  border-color: rgba(0, 180, 166, 0.4);
}
.q-row.off {
  opacity: 0.5;
}
.qr-no {
  width: 22px;
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 700;
  color: var(--sub);
  text-align: right;
}
.qr-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: 1.35;
}
.qr-main b {
  font-size: 12.5px;
  color: var(--ink);
}
.qr-main small {
  font-size: 11px;
  color: var(--sub);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.qr-score {
  font-size: 11.5px;
  color: var(--sub);
  flex-shrink: 0;
}
.qr-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--success);
}
.qr-dot.warn {
  background: var(--warn);
}
.qr-dot.error {
  background: var(--danger);
}
.qr-dot.off {
  background: #cfd8e6;
}

.side-foot {
  position: sticky;
  bottom: 0;
  z-index: 2;
  padding: 12px 16px 14px;
  border-top: 1px solid var(--border);
  background: #fbfcfe;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.side-foot .sum {
  font-size: 12.5px;
  color: var(--ink-2);
}
.side-foot .sum b {
  color: var(--ink);
  font-size: 14px;
}
.side-foot .f-hint {
  margin-top: 0;
  text-align: center;
}

/* ===== 4. 入库完成 ===== */
.done-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px;
  text-align: center;
}
.done-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: var(--success-soft);
  color: var(--success);
}
.done-panel h3 {
  font-size: 18px;
  color: var(--ink);
}
.done-sub {
  font-size: 13px;
  color: var(--sub);
}
.done-stats {
  display: flex;
  gap: 12px;
  margin: 8px 0 4px;
}
.done-stat {
  min-width: 128px;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.done-stat b {
  font-size: 20px;
  color: var(--brand-deep);
}
.done-stat span {
  font-size: 11.5px;
  color: var(--sub);
}
.done-ops {
  display: flex;
  gap: 10px;
  margin-top: 12px;
}

/* ===== 原文件弹窗 ===== */
.origin-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.origin-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.origin-head b {
  font-size: 13px;
  color: var(--ink);
}
.origin-head .f-hint {
  margin-top: 0;
}
.origin-img {
  width: 100%;
  border-radius: 8px;
  border: 1px solid var(--border);
}
.origin-text {
  max-height: 300px;
  overflow: auto;
  font-size: 12px;
  line-height: 1.7;
  color: var(--ink-2);
  background: #f7fafc;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--font);
}
</style>
