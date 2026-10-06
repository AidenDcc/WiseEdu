<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { AppIcon, RichTextViewer, appConfirm, showToast } from '@aiteach/shared'
import type { PhotoResultEdit, PhotoTask } from '@aiteach/shared'
import QuestionOptions from '@/components/question/QuestionOptions.vue'
import QuestionEditorModal from '@/components/question/QuestionEditorModal.vue'
import type { MetaRowKey } from '@/components/question/QuestionEditor.vue'
import { decidePhoto, fetchKnowledgeTree, fetchPhotoTasks, recognizePhoto, registerPhotoTask, uploadPhotos } from '@/api/org'
import { alignKnowledgeToPool, persistEmbeddedImages, photoEngine, photoModelName, recognizePhotoFile } from '@/api/ai-photo'
import { getCheckRounds, setCheckRounds, verifyQuestionsByAi, type VerifyIssue } from '@/api/ai-verify'
import { collectTags } from '@/composables/useKnowledgePool'
import { useBaseData } from '@/composables/useBaseData'
import { useScope } from '@/composables/useScope'
import { difficultyClass, needsFigure } from '@/utils/question-card'
import { answerTextOf, draftFromPhotoResult, emptyQuestionDraft, hasContent, mergeDraft } from '@/utils/question-draft'
import type { QuestionDraft } from '@/utils/question-draft'

const { subjects, grades, ensure, pick } = useBaseData()
/** 顶部栏的全局年级 / 学科：识别结果没判出学段时的兜底（空着会被「学科必填」拦下） */
const { grade: scopeGrade, subject: scopeSubject } = useScope()

const tasks = ref<PhotoTask[]>([])
/** 已选待上传的本地图片文件（≤20 张） */
const pending = ref<File[]>([])
const uploading = ref(false)
/** 上传区收起态：提交识别时自动收起，把纵向空间让给下面的任务表格；点标题整行可再次展开 */
const uploadCollapsed = ref(false)

/**
 * 页面阶段（FR-TM-019）：上传 → 识别任务表格 → 左右结构逐题校对。
 * 一开始只摆上传区：一张图都还没有的时候，空表格只是噪音；
 * 库里已有任务时 load 会直接落到表格，与加左右结构之前的打开态一致。
 */
type Stage = 'upload' | 'list' | 'confirm'
const stage = ref<Stage>('upload')

/** 识别引擎：已配置视觉模型走真实多模态识别，否则本地演示数据 */
const engine = ref<'vision' | 'mock'>(photoEngine())
const engineLabel = computed(() =>
  engine.value === 'vision' ? `多模态识别（${photoModelName()}）` : '本地演示数据（未配置视觉模型）',
)

/**
 * 任务 id → 本地文件（失败重试用）与缩略图 objectURL（左侧任务列表缩略图、右侧原图条用）。
 * 两个 Map 都不是响应式的：写入都发生在任务入列之前，tasks 一变列表就整体重渲染，
 * 取值必然读到写好的条目；而缩略图缓存正是模板里读的东西，
 * 做成 reactive 等于在渲染期写响应式数据，白白多一轮渲染。
 */
const fileByTaskId = new Map<string, File>()
const previewByTaskId = new Map<string, string>()

/* ===== AI 质检（可设置检查轮次；超轮仍有异常 → 确认时提醒人工介入） ===== */
/** 检查轮次（0=关闭，1~3；localStorage 持久化） */
const checkRounds = ref(getCheckRounds())
function onRoundsChange() {
  setCheckRounds(checkRounds.value)
}
/** 任务 id → 每题质检结论（resultId → 该题 issues 列表，仅最后一轮 warn/error） */
const verifyIssuesByTaskId = reactive(new Map<string, Map<string, VerifyIssue[]>>())
/** 任务 id → 质检汇总（任务列表打标用） */
const verifySummaryByTaskId = reactive(new Map<string, { error: number; warn: number; manual: boolean }>())

/**
 * 任务 id → 识别进度（阶段名 + 百分比）。
 *
 * 进度条不是「转圈占位」：识别接口只在整个任务跑完时一次性返回，没有中间回报，
 * 所以这里报的是**本地编排的步骤**（识别 → 归一 → 知识点 → 质检 → 回写），
 * 每推进一步更新一次，进度走到 100% 的那一刻任务正好落到 done / failed。
 */
const progressByTaskId = reactive(new Map<string, { label: string; percent: number }>())

function setProgress(id: string, label: string, step: number, total: number) {
  progressByTaskId.set(id, { label, percent: Math.round((step / total) * 100) })
}

const MAX_FILES = 20
const MAX_SIZE_MB = 10
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp']

const fileInput = ref<HTMLInputElement | null>(null)

const STATUS_TEXT: Record<PhotoTask['status'], string> = {
  pending: '等待识别',
  recognizing: '识别中',
  done: '识别完成',
  failed: '识别失败',
}
const STATUS_CLASS: Record<PhotoTask['status'], string> = {
  pending: 'tag-gray',
  recognizing: 'tag-blue',
  done: 'tag-green',
  failed: 'tag-red',
}

async function load() {
  await ensure()
  tasks.value = await fetchPhotoTasks()
  /* 默认选中第一条：右侧不留空面板。正在看的那条若已不在列表里（换了会话/被清掉）就退回第一条。
     activeTaskId 声明在下文，但 load 只在 onMounted 与失败兜底时调用，那时它早已初始化 */
  if (!activeTaskId.value || !tasks.value.some((task) => task.id === activeTaskId.value)) {
    activeTaskId.value = tasks.value[0]?.id ?? null
  }
  /* 库里已有任务就落到表格（与原来的打开态一致），一张都没有才停在上传区。
     只在「还没离开过上传区」时改阶段：load 也被失败兜底调用，
     那时候把已经进到校对区的人踢回表格会很突兀 */
  if (tasks.value.length && stage.value === 'upload') stage.value = 'list'
}

/** 按 id 就地替换任务：识别完成/决策入库都是整条换对象，集中在一处免得各处重复找下标 */
function replaceTask(task: PhotoTask) {
  const pos = tasks.value.findIndex((row) => row.id === task.id)
  if (pos >= 0) tasks.value[pos] = task
}

/* ===== 知识点关联：模型自判知识点 → 机构知识点池（按该题年级+学科） ===== */
const knowledgePools = new Map<string, string[]>()
async function poolFor(grade: string, subject: string): Promise<string[]> {
  const key = `${grade}|${subject}`
  if (!knowledgePools.has(key)) {
    try {
      knowledgePools.set(key, collectTags(await fetchKnowledgeTree(grade, subject, '')))
    } catch {
      knowledgePools.set(key, [])
    }
  }
  return knowledgePools.get(key) ?? []
}

/* ===== 选图：点击选择（可多选）/ 拖拽 / 粘贴（FR-TM-017） ===== */

function pickFiles() {
  fileInput.value?.click()
}

function addFiles(list: FileList | File[] | null) {
  if (!list) return
  const before = pending.value.length
  for (const file of Array.from(list)) {
    if (!ACCEPTED.includes(file.type)) {
      showToast(`仅支持 jpg / png / webp：${file.name}`, 'error')
      continue
    }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      showToast(`单张不能超过 ${MAX_SIZE_MB}MB：${file.name}`, 'error')
      continue
    }
    /* 只卡「本次待上传队列」的条数：任务是可累加的，把已经识别过的任务也算进来，
         连着传几批之后就传不动了，与「单次最多 20 张」的说法也对不上 */
    if (pending.value.length >= MAX_FILES) {
      showToast(`单次最多 ${MAX_FILES} 张`, 'error')
      break
    }
    pending.value.push(file)
  }
  /* 允许连续选择同一文件 */
  if (fileInput.value) fileInput.value.value = ''
  /* 粘贴是不看界面的操作，收起态下入列会毫无反馈（文件选择器则本来就要求面板展开），
     所以真收进队列时把上传区展开，让人看到缩略图 */
  if (pending.value.length > before) uploadCollapsed.value = false
}

const dragOver = ref(false)
function onDrop(event: DragEvent) {
  dragOver.value = false
  addFiles(event.dataTransfer?.files ?? null)
}

/**
 * 粘贴截图入列（web 端主流用法：QQ/微信/系统截图后直接在页面上 Ctrl+V）。
 * 剪贴板里的图片常常没有文件名，补一个带序号的名字，否则任务列表整列空白。
 */
function onPaste(event: ClipboardEvent) {
  /* 卡片编辑态的富文本编辑器就挂在这一页上，焦点在可编辑区时粘贴的是题干插图，
     不能抢进上传队列（否则下面的 preventDefault 会把编辑器自己的粘贴吃掉） */
  const target = event.target as HTMLElement | null
  if (target?.closest?.('[contenteditable="true"], input, textarea')) return
  const items = event.clipboardData?.items
  if (!items) return
  const files: File[] = []
  for (const item of Array.from(items)) {
    if (item.kind !== 'file') continue
    const file = item.getAsFile()
    if (!file) continue
    const named = file.name
      ? file
      : new File([file], `粘贴图片_${Date.now()}_${files.length + 1}.png`, { type: file.type || 'image/png' })
    files.push(named)
  }
  if (!files.length) return
  /* 剪贴板里同时有文本/图片时，阻止默认行为避免粘到别处 */
  event.preventDefault()
  addFiles(files)
}

function removePending(index: number) {
  const file = pending.value[index]
  /* 缓存条目也要一并删掉：只 revoke 不删的话，同一个文件再拖进来时
     previewUrl 会命中缓存里那个已经作废的 URL，缩略图直接裂开 */
  const key = pendingKey(file)
  const url = previewByTaskId.get(key)
  if (url) {
    URL.revokeObjectURL(url)
    previewByTaskId.delete(key)
  }
  pending.value.splice(index, 1)
}

function pendingKey(file: File): string {
  return `pending_${file.name}_${file.size}_${file.lastModified}`
}

function previewUrl(file: File): string {
  /* objectURL 按 file 对象缓存，避免每次渲染新建泄漏 */
  const key = pendingKey(file)
  const cached = previewByTaskId.get(key)
  if (cached) return cached
  const url = URL.createObjectURL(file)
  previewByTaskId.set(key, url)
  return url
}

/* ===== 图片放大：缩略图看排版/清晰度不够，点开看原尺寸（FR-TM-017） ===== */
/** 当前放大的图片（null = 未打开）。url 复用上面缓存的 objectURL，不额外创建 */
const lightbox = ref<{ url: string; name: string } | null>(null)

function openLightbox(url: string, name: string) {
  lightbox.value = { url, name }
}

/**
 * ESC 关闭放大图。用捕获阶段 + stopPropagation：放大图是当前最上层，
 * ESC 该由它独占——若在冒泡阶段处理，页面上其他挂在 document 上的 ESC 监听
 * （如全局搜索浮层）会跟着一起响应，一次 ESC 关掉两样东西。
 */
function onLightboxKey(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !lightbox.value) return
  event.stopPropagation()
  lightbox.value = null
}

/* ===== 上传识别（FR-TM-018） ===== */

let localSeq = 0

async function startUpload() {
  if (!pending.value.length || uploading.value) return
  uploading.value = true
  /* 图已经交出去了：上传区收起、页面从上传区推进到识别任务表格。
     再往队列里加图（选文件/拖拽/粘贴）会自动展开上传区，见 addFiles。
     只在还停在上传区时推进阶段 —— 在校对阶段补传图片要留在左右结构里，
     新任务出现在左栏并自动选中（见 startVisionUpload），不能被踢回表格 */
  uploadCollapsed.value = true
  if (stage.value === 'upload') stage.value = 'list'
  try {
    if (engine.value === 'mock') {
      await startMockUpload()
    } else {
      await startVisionUpload()
    }
  } finally {
    uploading.value = false
  }
}

/** 未配置视觉模型：走本地 mock 识别（文件名级模拟） */
async function startMockUpload() {
  const files = [...pending.value]
  const created = await uploadPhotos(files.map((file) => file.name))
  /* 入参与返回按下标一一对应：把本地文件与新任务的预览留下来 ——
     演示模式下左侧列表也有真实缩略图，识别失败还能拿原文件重试 */
  created.forEach((task, i) => {
    const file = files[i]
    if (!file) return
    fileByTaskId.set(task.id, file)
    previewByTaskId.set(task.id, URL.createObjectURL(file))
  })
  tasks.value = [...created, ...tasks.value]
  pending.value = []
  /* 新任务直接选中：右侧立刻开始显示它的进度，识别完原地变成结果，不必再点一下 */
  if (created[0]) selectTask(created[0])
  showToast('上传完成，已提交识别队列', 'success')
  for (const task of created) await recognize(task.id)
}

/**
 * 真实引擎：逐张本地压缩编码 → 多模态模型识别 → 回注册到任务库。
 * 先整批入列再逐张识别：一按「开始识别」左侧任务就齐了，排队中的显示「等待识别」、
 * 轮到谁谁才转「识别中」，而不是识别完一张才凭空冒出一条任务。
 */
async function startVisionUpload() {
  const files = [...pending.value]
  pending.value = []
  const created: PhotoTask[] = files.map((file) => {
    const task: PhotoTask = {
      id: `pl${++localSeq}`,
      name: file.name,
      sizeMb: Math.round((file.size / 1024 / 1024) * 10) / 10,
      status: 'pending',
      results: [],
    }
    fileByTaskId.set(task.id, file)
    previewByTaskId.set(task.id, URL.createObjectURL(file))
    return task
  })
  tasks.value = [...created, ...tasks.value]
  if (created[0]) selectTask(created[0])
  /* 串行识别：多模态识别是重请求，并发会把额度与超时一起打满 */
  for (const task of created) {
    replaceTask({ ...task, status: 'recognizing' })
    await runRecognize(task)
  }
}

/** 视觉引擎的识别步数（进度条分母）：识别 → 归一 → 知识点 → 质检 → 回写 */
const RECOGNIZE_STEPS = 5

/** 归一的中间态：模型原始行 + 已归一的字典项、已转存媒体库的富文本字段 */
interface DraftedResult {
  origin: PhotoTask['results'][number]
  subject: string
  grade: string
  stem: string
  options: string[]
  analysis: string
}

/** 单任务识别：成功回注册（后续确认/入库走统一 decide 链路），失败落原因供重试 */
async function runRecognize(task: PhotoTask) {
  const file = fileByTaskId.get(task.id)
  if (!file) return
  try {
    setProgress(task.id, '多模态识别（版面分析 · 公式还原）', 1, RECOGNIZE_STEPS)
    const results = await recognizePhotoFile(file, task.id)

    /* 学科/年级归一到机构字典（模型可能输出「高中数学」等自由文本） */
    setProgress(task.id, '结构归一与配图转存', 2, RECOGNIZE_STEPS)
    const drafted: DraftedResult[] = []
    for (const row of results) {
      const subject = pick(subjects.value, row.subject ?? '')
      const grade = pick(grades.value, row.grade ?? '')
      /* 内联 SVG 配图转存媒体库、正文改写为媒体 URL，否则校对编辑时会被编辑器剥掉 */
      const [stem, analysis] = await Promise.all([
        persistEmbeddedImages(row.stem, subject),
        persistEmbeddedImages(row.analysis, subject),
      ])
      const options = await Promise.all(row.options.map((opt) => persistEmbeddedImages(opt, subject)))
      drafted.push({ origin: row, subject, grade, stem, options, analysis })
    }

    /* 自判知识点对齐到该年级+学科的知识点池，保证入库后与筛选体系一致 */
    setProgress(task.id, '对齐机构知识点', 3, RECOGNIZE_STEPS)
    const normalized = []
    for (const item of drafted) {
      const pool = await poolFor(item.grade, item.subject)
      const knowledge = [...new Set(item.origin.knowledge.map((name) => alignKnowledgeToPool(name, pool)))]
        .filter(Boolean)
        .slice(0, 3)
      normalized.push({
        ...item.origin,
        stem: item.stem,
        options: item.options,
        analysis: item.analysis,
        subject: item.subject,
        grade: item.grade,
        knowledge,
      })
    }

    /* AI 质检：按设置轮次复核答案/解析（逐轮把轮次报给进度条），修正版回写后再回注册 */
    setProgress(task.id, 'AI 质检复核', 4, RECOGNIZE_STEPS)
    const verified = await verifyTaskResults({ ...task, status: 'done', results: normalized }, (round, rounds) =>
      setProgress(task.id, `AI 质检（第 ${round}/${rounds} 轮）`, 4, RECOGNIZE_STEPS),
    )

    setProgress(task.id, '回写任务库', 5, RECOGNIZE_STEPS)
    const done: PhotoTask = { ...verified, status: 'done' }
    /* 先落本地任务（右侧立刻可校对），回注册只是把结果同步进任务库 */
    replaceTask(done)
    /* 回注册到任务库：确认入库/存草稿/丢弃与 mock 识别同一条 decide 链路 */
    replaceTask(await registerPhotoTask(done))
  } catch (error) {
    replaceTask({
      ...task,
      status: 'failed',
      failReason: error instanceof Error ? error.message : '识别失败',
    })
  } finally {
    /* 进度只在识别期间存在：任务落到 done / failed 后进度条就该消失 */
    progressByTaskId.delete(task.id)
  }
}

/**
 * 识别结果的 AI 质检：按设置轮次逐轮复核（每轮修正版作为下一轮输入），
 * 修正字段回写结果，最后一轮的 warn/error 结论逐题留痕（结果卡片上打标提醒）；
 * 超轮仍有 error 级异常时标记 manual，提醒人工介入处理。
 *
 * 注意：本函数把结果行拆成 `GeneratedQuestion` 再拼回来，跑两趟（调入 + 写回），
 * `GeneratedQuestion` 里没有的字段（type / fillAnswers / optionColumns）**会被丢掉** ——
 * 目前编辑发生在质检之后，够用；若哪天要把校对提到质检之前，得先给这两处补上这些字段。
 */
async function verifyTaskResults(
  task: PhotoTask,
  /** 每轮开始前回调（轮次, 总轮次）：调用方拿它推进识别进度条 */
  onRound?: (round: number, rounds: number) => void,
): Promise<PhotoTask> {
  if (checkRounds.value <= 0 || !task.results.length) return task
  try {
    let current: import('@aiteach/shared').GeneratedQuestion[] = task.results.map((row) => ({
      id: row.id,
      stem: row.stem,
      options: [...row.options],
      answer: row.answer,
      analysis: row.analysis,
      knowledge: [...row.knowledge],
      difficulty: row.difficulty,
      subject: row.subject,
      grade: row.grade,
    }))
    let lastIssues: VerifyIssue[] = []
    let manual = false
    for (let r = 1; r <= checkRounds.value; r += 1) {
      onRound?.(r, checkRounds.value)
      const report = await verifyQuestionsByAi(current, { scene: '拍照识别' }, 1)
      lastIssues = report.rounds[report.rounds.length - 1]?.issues ?? []
      if (report.corrected.length === current.length) {
        current = await Promise.all(
          report.corrected.map(async (fixed, i) => {
            const origin = current[i]
            const subject = origin.subject ?? ''
            /* 修正版里的内联配图同样转存媒体库，避免 data URL 进存储 */
            const [stem, analysis] = await Promise.all([
              persistEmbeddedImages(fixed.stem, subject),
              persistEmbeddedImages(fixed.analysis, subject),
            ])
            const options = await Promise.all(fixed.options.map((opt) => persistEmbeddedImages(opt, subject)))
            return { ...origin, stem, options, analysis, answer: fixed.answer, knowledge: fixed.knowledge, difficulty: fixed.difficulty }
          }),
        )
      }
      /* 本轮无 error 级问题即通过；否则用修正版继续下一轮 */
      manual = lastIssues.some((issue) => issue.level === 'error')
      if (!manual) break
    }
    const byResult = new Map<string, VerifyIssue[]>()
    let errorCount = 0
    let warnCount = 0
    for (const issue of lastIssues) {
      const row = current[issue.index]
      if (!row) continue
      const bucket = byResult.get(row.id) ?? []
      bucket.push(issue)
      byResult.set(row.id, bucket)
      if (issue.level === 'error') errorCount += 1
      else warnCount += 1
    }
    verifyIssuesByTaskId.set(task.id, byResult)
    verifySummaryByTaskId.set(task.id, { error: errorCount, warn: warnCount, manual })
    /* 修正版回写为识别结果结构（decided 由后续确认链路维护） */
    return {
      ...task,
      results: current.map((row) => ({
        id: row.id,
        stem: row.stem,
        options: row.options,
        answer: row.answer,
        analysis: row.analysis,
        knowledge: row.knowledge,
        difficulty: row.difficulty,
        subject: row.subject,
        grade: row.grade,
        decided: null,
      })),
    }
  } catch {
    /* 质检失败不拖垮识别结果：不留痕，按未质检处理（与原行为一致） */
    return task
  }
}

/** 当前任务的某道结果的质检结论（结果卡片打标用） */
function issuesOfResult(taskId: string, resultId: string): VerifyIssue[] {
  return verifyIssuesByTaskId.get(taskId)?.get(resultId) ?? []
}

/** mock 引擎的识别步数：模拟识别 → 质检 → 回写（接口一次性返回，进度按本地步骤标注） */
const MOCK_STEPS = 3

async function recognize(id: string) {
  try {
    setProgress(id, '模拟识别（未配置视觉模型）', 1, MOCK_STEPS)
    const recognized = await recognizePhoto(id)
    /* 图片模糊等识别失败：原样落下状态与原因，不再往下走质检 */
    if (recognized.status === 'failed') {
      replaceTask(recognized)
      return
    }
    setProgress(id, 'AI 质检复核', 2, MOCK_STEPS)
    /* mock 识别结果同样过质检轮询，无 Key 环境也能演示完整交互 */
    const updated = await verifyTaskResults(recognized, (round, rounds) =>
      setProgress(id, `AI 质检（第 ${round}/${rounds} 轮）`, 2, MOCK_STEPS),
    )
    setProgress(id, '回写任务库', 3, MOCK_STEPS)
    replaceTask(updated)
  } catch (error) {
    showToast(error instanceof Error ? error.message : '识别失败', 'error')
    await load()
  } finally {
    progressByTaskId.delete(id)
  }
}

/** 失败重试：真实引擎用保留的本地文件重识别；mock 引擎直接重试 */
async function onRetry(task: PhotoTask) {
  if (engine.value === 'vision' && fileByTaskId.has(task.id)) {
    await runRecognize({ ...task, status: 'recognizing', failReason: undefined })
  } else {
    await recognize(task.id)
  }
}

/* ===== 结果确认（FR-TM-019）：左任务列表 / 右识别结果，结果按 AI 出题那样逐题只读展示 ===== */

/**
 * 当前查看的任务 **id**（不是对象引用）：识别完成时整条任务是换对象落库的
 * （runRecognize / recognize 里都走 replaceTask），抓引用的话右上结果区会停在旧对象上，
 * 识别完了也不刷新。存 id 让 activeTask 始终从 tasks 现算。
 */
const activeTaskId = ref<string | null>(null)
const activeTask = computed(() => tasks.value.find((task) => task.id === activeTaskId.value) ?? null)
/** 当前任务的原图（只有本地上传过的任务才有预览，重进页面后 mock 任务不带图） */
const activePreview = computed(() => (activeTask.value ? previewByTaskId.get(activeTask.value.id) : undefined))

/** 某张图已处理的结果数（左侧任务列表行内展示） */
function decidedCount(task: PhotoTask): number {
  return task.results.filter((row) => row.decided).length
}

/** 识别结果编得了的基本信息行：学期 / 考试类型 / 来源 / 教材版本识别结果里没有，也不落库 */
const PHOTO_ROWS: MetaRowKey[] = ['grade', 'subject', 'type', 'difficulty']

/** 正在编辑的结果 id；null = 弹窗没开（只是渲染态，不进提交数据） */
const editingId = ref<string | null>(null)
/** 弹窗里的草稿：开一次建一次，保存才写进 drafts —— 取消要能原样退回，没有中间态 */
const editDraft = reactive<QuestionDraft>(emptyQuestionDraft())
/** 结果 id → 已保存的校对改动。不走「当前选中项」那套：列表里每道题各自带着自己的改动 */
const drafts = reactive(new Map<string, QuestionDraft>())

/** 切换左侧任务：换任务就关掉弹窗 —— 编辑中的草稿属于上一道题，留着会串到新任务上 */
function selectTask(task: PhotoTask) {
  activeTaskId.value = task.id
  editingId.value = null
}

/** 表格里点「确认结果」：选中该任务并从表格推进到左右结构 */
function openConfirm(task: PhotoTask) {
  activeTaskId.value = task.id
  editingId.value = null
  stage.value = 'confirm'
}

/** 左栏标题上的「返回列表」：退回识别任务表格，弹窗一并关掉（同 selectTask 的理由） */
function backToList() {
  editingId.value = null
  stage.value = 'list'
}

/** 结果 id → 草稿（识别原值 + 已保存的改动）。选项去前缀、题型推导、答案分派都在
    `draftFromPhotoResult` 里（与录题中心、AI 出题同一份实现） */
const baseDrafts = computed(() => {
  const task = activeTask.value
  const map = new Map<string, QuestionDraft>()
  if (!task) return map
  for (const row of task.results) {
    map.set(
      row.id,
      draftFromPhotoResult(row, {
        /* 识别结果没判出学段时回落到顶部栏 —— 空着会直接被「学科必填」的校验拦下，
           那是「本来能存的东西变成存不了」 */
        subject: pick(subjects.value, scopeSubject.value),
        grade: pick(grades.value, scopeGrade.value),
      }),
    )
  }
  return map
})

/** 结果行当前生效的草稿：卡片渲染与决策提交共用同一份，看到的即提交的 */
function draftOf(row: PhotoTask['results'][number]): QuestionDraft {
  return mergeDraft(baseDrafts.value.get(row.id) ?? emptyQuestionDraft(), drafts.get(row.id))
}

/** 草稿 → `decidePhoto` 的 edit 入参。全量回传（没改的字段等于原值），入库结果与卡片一致 */
function editOf(draft: QuestionDraft): PhotoResultEdit {
  return {
    stem: draft.stem,
    /* 过滤空选项：教师删空后不该残留空选项 */
    options: draft.options.filter((opt) => hasContent(opt)),
    answer: answerTextOf(draft),
    analysis: draft.analysis,
    subject: draft.subject,
    grade: draft.grade,
    type: draft.type,
    difficulty: draft.difficulty,
    knowledge: [...draft.knowledge],
    optionColumns: draft.optionColumns,
    fillAnswers:
      draft.type === '填空'
        ? draft.fillAnswers.map((row) => ({ value: row.value, equivalents: row.equivalents }))
        : undefined,
  }
}

/**
 * 渲染用的卡片数据。题目 id 索引（不是下标）——丢弃中间一题时下标会整体错位，改动会挂到别的题上。
 */
const cards = computed(() => {
  const task = activeTask.value
  if (!task) return []
  return task.results.map((row, index) => ({
    row,
    index,
    draft: draftOf(row),
    issues: issuesOfResult(task.id, row.id),
  }))
})

/**
 * 「编辑」：开「题目编辑」弹窗（与录题中心同一张表单）。
 *
 * 旧实现是卡片内联展开，只能改 学科/年级/题干/选项/答案/解析 —— 而识别结果本身带着
 * difficulty 与 knowledge，改不了；`decidePhotoResult` 即使收到也根本不落库。
 */
function startEdit(row: PhotoTask['results'][number]) {
  Object.assign(editDraft, draftOf(row))
  editingId.value = row.id
}

/**
 * 保存：写进 drafts，退回只读态。改动随卡片上的「存草稿 / 提交审核 / 丢弃」一并提交。
 *
 * 存进 drafts 的必须是**深拷贝**：编辑器按 v-model 就地改 `editDraft.options[i]` 这类元素，
 * 浅拷会把「已保存」的那份一起改掉，取消也退不回去。
 */
function saveEdit() {
  if (!editingId.value) return
  drafts.set(editingId.value, {
    ...editDraft,
    knowledge: [...editDraft.knowledge],
    options: [...editDraft.options],
    answers: [...editDraft.answers],
    fillAnswers: editDraft.fillAnswers.map((row) => ({ ...row })),
  })
  editingId.value = null
}

/**
 * 取消：只关弹窗，不动 drafts —— 退回的是「上一次保存」的态。
 * （没保存过就退回识别原值；保存后又改了一轮再取消，不该把上一轮的成果也一起清掉）
 */
function cancelEdit() {
  editingId.value = null
}

/** 入库 / 存草稿 / 丢弃：带上这道题校对过的改动，否则会被静默丢弃 */
async function decide(row: PhotoTask['results'][number], decision: 'import' | 'draft' | 'drop') {
  if (!activeTask.value) return
  const updated = await decidePhoto(activeTask.value.id, row.id, decision, editOf(draftOf(row)))
  replaceTask(updated)
  /* 决策后这条的内容已定稿，暂存改动没必要再留着 */
  drafts.delete(row.id)
  if (editingId.value === row.id) editingId.value = null
  showToast(decision === 'import' ? '已提交审核（待人工终审）' : decision === 'draft' ? '已存入题库草稿' : '已丢弃', 'success')
}

/** 全部存草稿：一次收尾整张卷子（连同各自校对过的改动） */
async function draftAll() {
  if (!activeTask.value) return
  if (!(await appConfirm('未处理的结果将按「存草稿」处理，确认继续？', { type: 'warning' }))) return
  for (const row of activeTask.value.results.filter((item) => !item.decided)) {
    await decide(row, 'draft')
  }
  showToast('全部处理完成（未处理项已存草稿）', 'success')
}

/** 已处理结果的标签：识别结果列表里要能一眼看出这道题的去向 */
const DECIDED_TEXT: Record<'import' | 'draft' | 'drop', string> = {
  import: '已提交审核',
  draft: '已存草稿',
  drop: '已丢弃',
}
const DECIDED_CLASS: Record<'import' | 'draft' | 'drop', string> = {
  import: 'tag-green',
  draft: 'tag-orange',
  drop: 'tag-gray',
}

/* 题型不再就地推导：识别结果本身不带题型，统一由 `typeOfDraft`（@/utils/question-draft）按
   选项结构反推，教师在校对区改过的题型优先 —— 卡片上的徽标与入库时的 type 是同一个值，
   旧实现里徽标写「主观题」而入库写「解答」，同一道题两个名字。 */

const doneCount = computed(() => tasks.value.filter((task) => task.status === 'done').length)
/** 识别中的任务数：上传区标题上标一下，收起状态下也知道后台还有活儿在跑 */
const runningCount = computed(
  () => tasks.value.filter((task) => task.status === 'recognizing' || task.status === 'pending').length,
)

onMounted(() => {
  load()
  /* 粘贴监听挂在 window 上：截图后不必先点一下上传区就能 Ctrl+V 入列 */
  window.addEventListener('paste', onPaste)
  window.addEventListener('keydown', onLightboxKey, true)
})
onBeforeUnmount(() => {
  window.removeEventListener('paste', onPaste)
  window.removeEventListener('keydown', onLightboxKey, true)
  /* objectURL 是文档级资源，不主动回收会随每次进出这个页面累积 */
  for (const url of previewByTaskId.values()) URL.revokeObjectURL(url)
  previewByTaskId.clear()
  fileByTaskId.clear()
})
</script>

<template>
  <div class="photo-layout">
    <!-- 上传区（FR-TM-017：多选 / 拖拽 / 粘贴，≤20 张）· 提交识别后自动收起 -->
    <div class="panel upload-panel" :class="{ collapsed: uploadCollapsed }">
      <!-- 区块头（不是页面名：页面名由顶栏面包屑承担）。整行都是折叠开关：点标题、点说明、
           点右侧标签都收放，收起后仍要能一键展开继续传图。
           点击挂在行上，里面的 .up-toggle 只做可聚焦的语义开关（自己不接 handler，
           点击与回车都冒泡到这一行），键盘用户因此也能操作 -->
      <div
        class="blk-head"
        :title="uploadCollapsed ? '展开上传区' : '收起上传区'"
        @click="uploadCollapsed = !uploadCollapsed"
      >
        <button class="up-toggle" type="button" :aria-expanded="!uploadCollapsed" aria-controls="upload-body">
          <AppIcon :name="uploadCollapsed ? 'chevron-right' : 'chevron-down'" :size="14" />
          上传图片
        </button>
        <span class="f-hint">单次最多 20 张，支持 jpg / png / webp</span>
        <span class="blk-right">
          <!-- 收起后界面上只剩这一行，队列与后台识别的进度都得在这里看得见 -->
          <span v-if="pending.length" class="tag tag-blue">待上传 {{ pending.length }} 张</span>
          <span v-if="runningCount" class="tag tag-blue">识别中 {{ runningCount }} 张</span>
          <span v-if="tasks.length" class="tag">已识别 {{ doneCount }} / {{ tasks.length }}</span>
          <span class="tag" :class="engine === 'vision' ? 'tag-green' : 'tag-gray'">
            {{ engineLabel }}
          </span>
        </span>
      </div>
      <!-- 收起的是投放区与待识别队列（v-show 而非 v-if：File 对象与 objectURL 缓存都在
           pending / previewByTaskId 里，与 DOM 无关，不用为了收起去销毁重建） -->
      <div id="upload-body" v-show="!uploadCollapsed" class="up-body">
        <div
          class="drop-zone"
          :class="{ hover: dragOver }"
          @click="pickFiles"
          @dragover.prevent="dragOver = true"
          @dragleave.prevent="dragOver = false"
          @drop.prevent="onDrop"
        >
          <AppIcon name="upload" :size="28" />
          <p>点击选择（可多选）/ 拖拽图片到此处 / 直接粘贴截图，单张不超过 10MB</p>
          <p class="f-hint">识别引擎：版面分析 → 公式还原（LaTeX）→ 结构化入库</p>
        </div>
        <input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden @change="addFiles(fileInput?.files ?? null)" />

        <template v-if="pending.length">
          <div class="pending-list">
            <div v-for="(file, i) in pending" :key="`${file.name}_${file.lastModified}`" class="pending-card">
              <img
                class="pending-thumb"
                :src="previewUrl(file)"
                :alt="file.name"
                title="点击放大"
                @click.stop="openLightbox(previewUrl(file), file.name)"
              />
              <div class="pending-meta">
                <span class="pending-name" :title="file.name">{{ file.name }}</span>
                <span class="f-hint">{{ (file.size / 1024 / 1024).toFixed(1) }} MB</span>
              </div>
              <button class="chip-x" type="button" @click.stop="removePending(i)"><AppIcon name="close" :size="11" /></button>
            </div>
          </div>
          <div class="op-group pending-ops">
            <!-- 轮次选择紧贴「开始识别」：它是这次识别要用的参数（设置本身全局持久化，
                 不随清空丢失），放在动作旁边才看得出两者的从属关系 -->
            <label class="rounds-pick" title="识别后自动复核答案/解析的轮数；超轮仍有异常将提醒人工介入">
              AI 检查轮次
              <select v-model.number="checkRounds" class="f-select" @change="onRoundsChange">
                <option :value="0">关闭</option>
                <option :value="1">1 轮</option>
                <option :value="2">2 轮</option>
                <option :value="3">3 轮</option>
              </select>
            </label>
            <button class="btn btn-primary btn-sm" :disabled="uploading" @click="startUpload">
              {{ uploading ? '识别中…' : `开始识别（${pending.length} 张）` }}
            </button>
            <button class="btn btn-ghost btn-sm" @click="pending = []">清空</button>
          </div>
        </template>
      </div>
    </div>

    <!-- 识别任务表格（开始识别后到进校对之前这一段）：一行一个任务，识别中 / 失败 / 完成在这里
         就能看完，点「确认结果」才进到逐题校对的左右结构 -->
    <div v-if="stage === 'list'" class="panel list-panel">
      <div class="section-title">识别任务</div>
      <!-- 表格包在 .data-table-wrap 里：窄屏时表头与内容一起横向滚动 -->
      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>文件</th>
              <th>状态</th>
              <th>识别结果</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="tasks.length === 0">
              <td colspan="4" class="empty-row">暂无识别任务，先上传照片试试</td>
            </tr>
            <template v-else>
              <tr v-for="task in tasks" :key="task.id">
                <td class="cell-strong">{{ task.name }}</td>
                <td><span class="tag" :class="STATUS_CLASS[task.status]">{{ STATUS_TEXT[task.status] }}</span></td>
                <td>
                  <template v-if="task.status === 'done'">
                    {{ task.results.length }} 题 · 已处理 {{ decidedCount(task) }}
                    <!-- 质检结论打标：超轮异常红、有提醒橙、通过绿 -->
                    <span
                      v-if="verifySummaryByTaskId.get(task.id)"
                      class="tag"
                      :class="verifySummaryByTaskId.get(task.id)!.manual ? 'tag-red' : verifySummaryByTaskId.get(task.id)!.warn ? 'tag-orange' : 'tag-green'"
                    >
                      质检{{ verifySummaryByTaskId.get(task.id)!.manual ? '异常 · 需人工' : verifySummaryByTaskId.get(task.id)!.warn ? '有提醒' : '通过' }}
                    </span>
                  </template>
                  <!-- 识别进度也在表格里给出来：阶段与百分比来自本地编排步骤（见 setProgress） -->
                  <template v-else-if="progressByTaskId.get(task.id)">
                    <span class="cell-progress">
                      <span class="ti-bar"><i :style="{ width: `${progressByTaskId.get(task.id)!.percent}%` }" /></span>
                      <span class="ti-stage">{{ progressByTaskId.get(task.id)!.label }}</span>
                    </span>
                  </template>
                  <!-- 进度条目在识别收尾那一刻就删掉了，任务状态与它之间有个极短的错位窗口 -->
                  <span v-else-if="task.status === 'recognizing'" class="f-hint">正在识别…</span>
                  <span v-else-if="task.status === 'failed'" class="cell-fail">{{ task.failReason ?? '识别失败' }}</span>
                  <span v-else class="f-hint">—</span>
                </td>
                <td>
                  <div class="op-group">
                    <button
                      v-if="task.status === 'done'"
                      class="mini-btn"
                      type="button"
                      @click="openConfirm(task)"
                    >
                      确认结果
                    </button>
                    <button v-if="task.status === 'failed'" class="mini-btn" type="button" @click="onRetry(task)">
                      重新识别
                    </button>
                    <span v-if="task.status === 'pending'" class="f-hint">排队中</span>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 左右结构（FR-TM-019）：左=识别任务（全部任务，含识别进度），右=选中任务的识别结果 -->
    <div v-else-if="stage === 'confirm'" class="confirm-layout">
      <!-- 左：识别任务列表 -->
      <div class="panel task-pane">
        <div class="pane-title">
          识别任务
          <span class="f-hint">{{ tasks.length }} 张</span>
          <!-- 退回表格：这一栏本身就是任务清单，回到表格是「拉远一层」而不是离开页面 -->
          <button class="mini-btn" type="button" style="margin-left: auto" @click="backToList">返回列表</button>
        </div>
        <div class="task-list">
          <p v-if="!tasks.length" class="task-empty">暂无识别任务，先上传照片试试</p>
          <button
            v-for="task in tasks"
            :key="task.id"
            type="button"
            class="task-item"
            :class="{ active: task.id === activeTaskId }"
            :title="task.name"
            @click="selectTask(task)"
          >
            <span class="ti-thumb">
              <img v-if="previewByTaskId.get(task.id)" :src="previewByTaskId.get(task.id)" :alt="task.name" />
              <AppIcon v-else name="image" :size="17" />
            </span>
            <span class="ti-body">
              <span class="ti-name">{{ task.name }}</span>
              <span class="ti-meta">
                <span class="tag" :class="STATUS_CLASS[task.status]">{{ STATUS_TEXT[task.status] }}</span>
                <template v-if="task.status === 'done'">
                  <span class="ti-num">{{ task.results.length }} 题 · 已处理 {{ decidedCount(task) }}</span>
                  <!-- 质检结论打标：超轮异常红、有提醒橙、通过绿 -->
                  <span
                    v-if="verifySummaryByTaskId.get(task.id)"
                    class="tag"
                    :class="verifySummaryByTaskId.get(task.id)!.manual ? 'tag-red' : verifySummaryByTaskId.get(task.id)!.warn ? 'tag-orange' : 'tag-green'"
                  >
                    {{ verifySummaryByTaskId.get(task.id)!.manual ? '质检异常' : verifySummaryByTaskId.get(task.id)!.warn ? '质检提醒' : '质检通过' }}
                  </span>
                </template>
                <span v-else-if="task.status === 'failed'" class="ti-num ti-fail">{{ task.failReason ?? '识别失败' }}</span>
                <span v-else-if="task.status === 'pending'" class="ti-num">排队中</span>
              </span>
              <!-- 识别进度：接口没有中间回报，阶段与百分比来自本地编排步骤（见 setProgress） -->
              <span v-if="progressByTaskId.get(task.id)" class="ti-progress">
                <span class="ti-bar"><i :style="{ width: `${progressByTaskId.get(task.id)!.percent}%` }" /></span>
                <span class="ti-stage">{{ progressByTaskId.get(task.id)!.label }}</span>
              </span>
            </span>
          </button>
        </div>
      </div>

      <!-- 右：识别结果（逐题只读卡片；识别中 / 失败 / 未选中各有对应状态） -->
      <div class="panel result-pane">
        <div v-if="!activeTask" class="res-state">
          <AppIcon name="image" :size="30" />
          <p>从左侧选择一个识别任务，查看它的识别结果</p>
        </div>

        <template v-else>
          <div class="pane-title">
            识别结果
            <span v-if="activeTask.status === 'done'" class="pane-count">（{{ activeTask.results.length }} 题）</span>
            <span class="f-hint">{{ activeTask.name }}</span>
            <span v-if="activeTask.status === 'done' && activeTask.results.length" class="op-group" style="margin-left: auto">
              <button class="btn btn-ghost btn-sm" @click="draftAll">全部存草稿</button>
            </span>
          </div>

          <!-- 结果区滚动容器：原图条与结果卡片一起滚，标题行（含「全部存草稿」）固定在上方 -->
          <div class="res-body">
            <!-- 原图条：校对时对着原图看识别结果；点图放大。没有预览（上个会话留下的任务）就只留文件信息 -->
            <div class="origin-strip">
              <img
                v-if="activePreview"
                class="origin-img"
                :src="activePreview"
                :alt="activeTask.name"
                title="点击放大"
                @click="openLightbox(activePreview, activeTask.name)"
              />
              <span v-else class="ti-thumb lg"><AppIcon name="image" :size="24" /></span>
              <div class="origin-info">
                <p class="origin-name" :title="activeTask.name">{{ activeTask.name }}</p>
                <p class="f-hint">
                  {{ activeTask.sizeMb }} MB<template v-if="!activePreview"> · 原图只在本次上传里保留预览</template>
                </p>
                <span class="tag" :class="STATUS_CLASS[activeTask.status]">{{ STATUS_TEXT[activeTask.status] }}</span>
              </div>
            </div>

            <!-- 排队 / 识别中：阶段进度。识别完原地变成结果，不用再点一次 -->
            <div v-if="activeTask.status === 'recognizing' || activeTask.status === 'pending'" class="res-state">
              <span class="ti-bar big"><i :style="{ width: `${progressByTaskId.get(activeTask.id)?.percent ?? 6}%` }" /></span>
              <p>{{ progressByTaskId.get(activeTask.id)?.label ?? '排队等待识别…' }}</p>
              <p class="f-hint">识别完成后结果自动出现在这里，期间可以继续上传新的照片</p>
            </div>

            <!-- 识别失败：原因 + 原文件重试（失败原因在 320px 的行里放不下，放到这里来说） -->
            <div v-else-if="activeTask.status === 'failed'" class="res-state">
              <AppIcon name="warning" :size="28" />
              <p>{{ activeTask.failReason ?? '识别失败' }}</p>
              <button class="btn btn-primary btn-sm" @click="onRetry(activeTask)">重新识别</button>
            </div>

            <p v-else-if="!activeTask.results.length" class="res-state">这张图没有识别出题目</p>

            <div v-else class="result-list">
              <article
                v-for="card in cards"
                :key="card.row.id"
                class="q-card"
                :class="{ decided: card.row.decided }"
              >
                <div class="qc-meta">
                  <span class="qc-id">第 {{ card.index + 1 }} 题</span>
                  <span class="tag tag-blue">{{ card.draft.type }}</span>
                  <span class="tag" :class="difficultyClass(card.draft.difficulty)">{{ card.draft.difficulty }}</span>
                  <span v-if="card.draft.subject" class="tag tag-blue">{{ card.draft.subject }}</span>
                  <span v-if="card.draft.grade" class="tag tag-blue">{{ card.draft.grade }}</span>
                  <span class="qc-kp">{{ card.draft.knowledge.join('、') }}</span>
                  <!-- 质检结论：与 AI 出题同一套打标（红=需人工 / 橙=有提醒 / 绿=通过） -->
                  <span
                    v-if="card.issues.some((issue) => issue.level === 'error')"
                    class="tag tag-red"
                    :title="card.issues.filter((issue) => issue.level === 'error').map((issue) => issue.message).join('；')"
                  >
                    质检异常
                  </span>
                  <span
                    v-else-if="card.issues.length"
                    class="tag tag-orange"
                    :title="card.issues.map((issue) => issue.message).join('；')"
                  >
                    质检提醒
                  </span>
                  <span v-else-if="checkRounds" class="tag tag-green">质检通过</span>
                  <!-- 已处理的结果留在列表里标出去向，不再给操作按钮 -->
                  <span v-if="card.row.decided" class="tag" :class="DECIDED_CLASS[card.row.decided]">
                    {{ DECIDED_TEXT[card.row.decided] }}
                  </span>
                  <span v-else-if="drafts.has(card.row.id)" class="tag tag-blue">已修改</span>
                </div>

                <!-- 与 AI 出题的结果列表同一套读法（题干 / 配图位 / 答案解析）。
                     内容是唯一权威源，编辑走「题目编辑」弹窗，卡片本身不再有第二套表单 -->
                <RichTextViewer class="qc-stem" :content="card.draft.stem" />
                <div v-if="needsFigure(card.draft)" class="qc-figure">
                  <AppIcon name="image" :size="26" />
                  <span>题目配图（演示占位）</span>
                </div>
                <QuestionOptions class="qc-options" :options="card.draft.options" />
                <div class="qc-answer">
                  <p>
                    <b>答案：</b>
                    <!-- 客观题答案是字母用强调色纯文本；问答题答案是富文本（公式/插图） -->
                    <span v-if="card.draft.options.length" class="qc-answer-text">{{ answerTextOf(card.draft) || '—' }}</span>
                    <RichTextViewer v-else :content="answerTextOf(card.draft)" tag="span" empty="—" />
                  </p>
                  <p><b>解析：</b><RichTextViewer :content="card.draft.analysis" tag="span" empty="—" /></p>
                </div>
                <!-- 质检明细：超轮仍有异常 → 醒目提醒人工介入处理（打标之外还要能读到原因） -->
                <div v-if="card.issues.length" class="verify-issues">
                  <p v-for="(issue, ii) in card.issues" :key="ii" :class="issue.level">
                    <b>质检{{ issue.level === 'error' ? '异常' : '提醒' }} · {{ issue.aspect }}：</b>{{ issue.message }}
                    <template v-if="issue.level === 'error'">（已超过设定检查轮次，请人工核对后入库）</template>
                  </p>
                </div>

                <!-- 操作行：「编辑 / 存草稿 / 提交审核 / 丢弃」。编辑不再就地展开，开「题目编辑」弹窗 -->
                <div class="qc-ops">
                  <template v-if="card.row.decided">
                    <span class="f-hint">该结果已处理</span>
                  </template>
                  <template v-else>
                    <button class="mini-btn" type="button" @click="startEdit(card.row)">编辑</button>
                    <button class="mini-btn" type="button" @click="decide(card.row, 'draft')">存草稿</button>
                    <button class="mini-btn success" type="button" @click="decide(card.row, 'import')">提交审核</button>
                    <button class="mini-btn danger" type="button" @click="decide(card.row, 'drop')">丢弃</button>
                  </template>
                </div>
              </article>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- 校对改题：与录题中心同一张「题目编辑」表单（含题型 / 难度 / 知识点）。
         这里只是改，入库仍走卡片上的 存草稿 / 提交审核 / 丢弃 —— 保住「全部存草稿」这个批量收尾。
         rows 收掉 学期 / 考试类型 / 来源 / 教材版本：识别结果里没有这四项，`decidePhotoResult`
         也不落它们 —— 摆出来能填却不生效，正是这次要消灭的那种「改了没存」 -->
    <QuestionEditorModal
      v-if="editingId"
      :draft="editDraft"
      :rows="PHOTO_ROWS"
      title="编辑识别结果"
      @close="cancelEdit"
    >
      <template #footer>
        <button class="btn btn-ghost" type="button" @click="cancelEdit">取消</button>
        <button class="btn btn-primary" type="button" @click="saveEdit">保存修改</button>
      </template>
    </QuestionEditorModal>

    <!-- 放大预览：遮罩本身即关闭按钮（点任意位置都可关）。z-index 取 200，压在全局弹窗（120）之上 -->
    <Teleport to="body">
      <div v-if="lightbox" class="lb-mask" @click="lightbox = null">
        <img class="lb-img" :src="lightbox.url" :alt="lightbox.name" />
        <p class="lb-name">{{ lightbox.name }} · 点击任意位置关闭</p>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* 撑满内容区：校对阶段（左右结构）里识别任务与识别结果各自滚自己的，
   上传区与两栏标题留在原地，整页不动。上传 / 表格两个阶段的内容按自然高排，
   底下留白 —— 那时没有需要独立滚动的第二栏，长表格交给 .content 滚就行。
   高度用 100% 而不是 calc(100vh - 106px)（BankView 那套）：#app / .layout 都是 height:100%，
   .content 是定高 flex 列里的 flex:1 子项，它的内容盒高度确定，100% 精确等于「视口 - 顶栏 62 -
   内容区上下内边距 44」，且顶栏高度变了不用回来改这里。
   min-height 是兜底：万一百分比链断了退化成 auto，给个地板高度让 flex:1 仍有空间可分，
   两栏不至于塌成 0 高；短屏上宁可整页滚，也好过两栏挤成一条缝 */
.photo-layout { display: flex; flex-direction: column; gap: 14px; height: 100%; min-height: 460px; }

/* 上传区按内容自然高，不参与剩下高度的分配：它是操作区，两栏才是要撑满的工作区 */
.upload-panel { padding: 18px 20px; flex-shrink: 0; }
/* 识别任务表格面板：与上传区同为一级面板，内边距取同一套（表格直接贴 .panel 时表头会压住圆角）。
   flex-shrink:0 是必须的：页面定高，任务多的时候表格不能为了塞进视口被压扁，
   宁可让它顶出去交给 .content 滚 */
.list-panel { padding: 18px 20px; flex-shrink: 0; }
/* 表格里的识别进度：进度条 + 阶段名排一行（单元格是 13px 正文，这里走得紧凑些） */
.cell-progress { display: inline-flex; align-items: center; gap: 8px; width: 100%; max-width: 300px; }
.cell-progress .ti-bar { flex: 1; }
/* 失败原因在表格里要一眼看见，但不能借用 .tag-red —— 那个类只给底色，
   单独用在文字上会变成一块没有内边距的色块 */
.cell-fail { font-size: 12.5px; color: var(--danger); }
/* 左右两栏沿用与上传区一致的内边距：.panel 全局只给了背景/圆角/描边，
   不给内边距，标题与内容原本是贴着面板边框的。
   两栏都是「固定标题 + 滚动主体」的纵向 flex，min-height:0 是内部滚动容器能拿到高度的前提 */
.task-pane, .result-pane { padding: 18px 20px; display: flex; flex-direction: column; min-height: 0; }
/* 区块头是横向居中的行，.f-hint 自带的 5px 上边距会把说明文字顶歪
   （全局只修了 .filter-bar / .list-toolbar 两处上下文） */
.upload-panel .blk-head .f-hint { margin-top: 0; }
/* 区块头：原来借用全局 .page-head（那是页面级页头，正在从 main.css 里删除），
   这里换成面板内的局部类，几何沿用原来的 flex 两端对齐 */
.blk-head { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; cursor: pointer; user-select: none; }
/* 整行可点：悬停任意位置都把标题点亮，才看得出这一行整体是个开关 */
.blk-head:hover .up-toggle { background: var(--brand-soft); }
/* 收起态下区块头自己就是那一条，底部不再留空当 */
.upload-panel.collapsed .blk-head { margin-bottom: 0; }
/* 折叠开关的视觉与焦点落点：图标 + 文字，命中区补到 28px 高。
   hover 的高亮挂在 .blk-head 上（见上），这里不再重复一份 */
.up-toggle {
  display: inline-flex; align-items: center; gap: 6px;
  border: none; background: none; padding: 4px 6px; margin-left: -6px;
  border-radius: 7px; cursor: pointer;
  font-size: 13.5px; font-weight: 700; color: var(--ink);
  transition: background 0.15s;
}
.blk-right { display: inline-flex; align-items: center; gap: 8px; margin-left: auto; }
.drop-zone {
  border: 2px dashed var(--border);
  border-radius: 14px;
  padding: 26px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  color: var(--sub);
  cursor: pointer;
  transition: all 0.15s;
  background: #fbfdfd;
}
.drop-zone:hover, .drop-zone.hover { border-color: var(--brand); background: var(--brand-soft); }
.drop-zone p { font-size: 13.5px; color: var(--ink-2); }

/* 待上传队列自己带上限并滚动：整页现在是定高的（见 .photo-layout），
   20 张待上传图铺开有四五排，不封顶就会把下面两栏的工作区挤没 */
.pending-list {
  display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-top: 12px;
  max-height: 160px; overflow-y: auto;
}
.pending-card {
  display: flex; align-items: center; gap: 8px;
  background: #fff; border: 1px solid var(--border); border-radius: 10px;
  padding: 6px 10px 6px 6px; max-width: 240px;
}
.pending-thumb { width: 44px; height: 44px; border-radius: 7px; object-fit: cover; background: #f2f5f5; cursor: zoom-in; }
.pending-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.pending-name { font-size: 12.5px; color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 图标按钮：原先只有裸 display:flex（图标不居中、点击区只有图标大小，还带着原生 button 的
   UA 边框 / 灰底，见 KnowledgeFilter 里 .kp-caret 的同类注释）——补成 22×22 的居中命中区 */
.chip-x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  border: none;
  border-radius: 6px;
  background: none;
  padding: 0;
  color: var(--sub);
  transition: background 0.15s, color 0.15s;
}
.chip-x:hover { background: var(--brand-soft); color: var(--brand-deep); }

/* 左任务列表 / 右识别结果：两栏都是独立面板，各自内部滚动。
   flex:1 + min-height:0 让两栏吃掉上传区之外的全部高度（min-height 默认 min-content，
   不置 0 的话下面 .task-list / .res-body 的 overflow 拿不到可滚动的高度，滚动条就不会出现）；
   align-items:stretch（默认值）让两栏等高，短的那栏也到底，不会一栏到底一栏半截 */
.confirm-layout {
  display: grid; grid-template-columns: 320px minmax(0, 1fr);
  gap: 16px; align-items: stretch;
  flex: 1; min-height: 0;
}
/* 标题行是两栏的固定头，flex-shrink:0 保证滚动主体再长也不会把它压扁 */
.pane-title {
  font-size: 13px; font-weight: 600; color: var(--ink); margin-bottom: 10px;
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap; flex-shrink: 0;
}
.pane-count { font-weight: 600; color: var(--sub); }
/* 窄屏（笔记本分屏）堆成上下：320px 任务列表 + 结果卡片并排会把题干与选项挤成窄行。
   注意这里必须把 flex:1 还原掉：堆叠后父级高度是 auto，flex:1 的基准是 0，
   拿不到可分配的空间，两栏会直接塌成 0 高 */
@media (max-width: 1180px) {
  .photo-layout { height: auto; }
  .confirm-layout { flex: none; grid-template-columns: minmax(0, 1fr); }
  /* 各给一个上限并保留内部滚动：堆叠后仍各自滚，整页交给 .content 滚 */
  .task-pane, .result-pane { max-height: 460px; }
}

/* ===== 左栏：识别任务列表 ===== */
/* 任务多时列表自己滚（左栏独立的滚动条），右栏的滚动完全不受影响；
   左右各留 4px 负边距再补成内边距：让选中态的描边不被滚动容器裁掉，文字仍与标题对齐 */
.task-list {
  display: flex; flex-direction: column; gap: 6px;
  flex: 1; min-height: 0; overflow-y: auto;
  margin: 0 -4px; padding: 2px 4px;
}
.task-empty { font-size: 12.5px; color: var(--sub); padding: 10px 2px; }
/* 整条就是按钮：左侧缩略图 + 文件名 / 状态 / 进度，点一下切换右侧结果 */
.task-item {
  display: flex; align-items: flex-start; gap: 10px; width: 100%;
  border: 1px solid transparent; border-radius: 10px; background: none;
  padding: 8px; text-align: left; cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.task-item:hover { background: #f7fafa; }
.task-item.active { background: var(--brand-soft); border-color: var(--brand); }
.ti-thumb {
  flex-shrink: 0; width: 40px; height: 40px; border-radius: 8px;
  border: 1px solid var(--border); background: #fff; overflow: hidden;
  display: flex; align-items: center; justify-content: center; color: var(--sub);
}
.ti-thumb img { width: 100%; height: 100%; object-fit: cover; }
.ti-thumb.lg { width: 52px; height: 52px; border-radius: 10px; }
.ti-body { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1; }
.ti-name { font-size: 12.5px; font-weight: 600; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ti-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.ti-num { font-size: 12px; color: var(--sub); }
.ti-fail { color: var(--danger); max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ti-progress { display: flex; flex-direction: column; gap: 3px; margin-top: 2px; }
.ti-bar { display: block; height: 4px; border-radius: 999px; background: var(--border); overflow: hidden; }
.ti-bar > i { display: block; height: 100%; border-radius: 999px; background: var(--brand); transition: width 0.4s ease; }
.ti-stage { font-size: 11.5px; color: var(--sub); }

/* ===== 右栏：原图条与识别状态 ===== */
/* 结果区独立的滚动条：原图条 + 识别状态 + 结果卡片一起滚，标题行留在上面不动。
   卡片编辑态有 2px 外描边，左右各留 4px 负边距再补回来，免得被滚动容器裁成断口 */
.res-body {
  flex: 1; min-height: 0; overflow-y: auto;
  margin: 0 -4px; padding: 0 4px 4px;
}
/* 右栏没有可滚内容时（未选中任务的空态），把提示居中放在整栏里 */
.result-pane > .res-state { flex: 1; justify-content: center; }
/* 原图条：左图右信息。图片本身不大，看不清点开看原尺寸 */
.origin-strip { display: flex; align-items: flex-start; gap: 14px; margin-bottom: 12px; }
.origin-img {
  max-width: 260px; max-height: 180px; object-fit: contain;
  border-radius: 10px; border: 1px solid var(--border); background: #fff;
  cursor: zoom-in;
}
.origin-info { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; min-width: 0; }
.origin-name { font-size: 12.5px; font-weight: 600; color: var(--ink); word-break: break-all; }
/* 这两处都是自带行距的纵向列，.f-hint 的 5px 上边距会叠在 gap 上把文字顶歪 */
.origin-info .f-hint,
.res-state .f-hint { margin-top: 0; }
/* 排队 / 识别中 / 失败 / 未选中：右侧没有结果可摆时的那一格 */
.res-state {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: 44px 12px; text-align: center;
  font-size: 13px; color: var(--sub);
}
.res-state .ti-bar.big { width: min(420px, 100%); height: 6px; }

/* 放大预览遮罩。keyframes 必须自带：scoped 样式里 @keyframes 会被编译改名，
   别的组件里的同名 fade-in 借不过来 */
.lb-mask {
  position: fixed; inset: 0; z-index: 200;
  background: rgba(12, 16, 26, 0.82);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px; padding: 32px; cursor: zoom-out;
  animation: lb-fade 0.16s ease;
}
.lb-img {
  max-width: 100%; max-height: calc(100vh - 120px);
  object-fit: contain; border-radius: 10px;
  background: #fff; box-shadow: var(--shadow-lg);
}
.lb-name { font-size: 13px; color: #fff; opacity: 0.85; }
@keyframes lb-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
/* 操作行里混着按钮与说明文字（.op-group / .pane-title 都是 align-items:center 的横向行），
   .f-hint 的 5px 上边距会把文字顶歪 */
.op-group .f-hint,
.pane-title .f-hint { margin-top: 0; }
/* 轮次选择在「开始识别」左侧：.op-group 的 gap 只有 2px（操作列里的 mini-btn 用），
   标签与按钮要靠 margin-right 拉开，否则会贴在一起 */
.rounds-pick {
  margin-right: 10px;
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12.5px; color: var(--sub); white-space: nowrap;
}
.rounds-pick .f-select { width: 88px; height: 30px; font-size: 12.5px; }
.pending-ops { margin-top: 12px; }
/* 质检结论：error 红条（超轮异常，需人工介入）、warn 黄条 */
.verify-issues {
  display: flex; flex-direction: column; gap: 5px;
  margin-bottom: 10px; border-radius: 9px;
}
.verify-issues p { font-size: 12.5px; line-height: 1.6; border-radius: 8px; padding: 7px 11px; }
.verify-issues p.error { background: var(--danger-soft); color: var(--danger); }
.verify-issues p.warn { background: var(--warn-soft); color: var(--warn); }

/* ===== 结果确认的逐题卡片 =====
   `.q-card` / `.qc-*` 与 AI 出题的 QuestionResultList 是**同一套样式规则**（那边也是 scoped，
   同样在各页各写一份，见该组件头部注释：共用的是逻辑与样式规则，不是组件）。
   逻辑侧已经复用了 @/utils/question-card 的 difficultyClass / needsFigure，改一处两边都生效。 */
.result-list { display: flex; flex-direction: column; gap: 12px; }
.q-card { border: 1px solid var(--border); border-radius: 14px; background: #fff; padding: 14px 18px; }
.q-card.decided { background: #fafbfc; }
.qc-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.qc-id { font-size: 13px; font-weight: 700; color: var(--ink); }
.qc-kp { font-size: 12px; color: var(--sub); }
.qc-stem { font-size: 13.5px; color: var(--ink); line-height: 1.8; }
.qc-figure {
  margin-top: 10px;
  height: 110px;
  border: 1px dashed var(--border);
  border-radius: 10px;
  background: repeating-conic-gradient(#f4f7f7 0% 25%, #fff 0% 50%) 50% / 16px 16px;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  color: var(--sub); font-size: 12.5px;
}
/* 选项外观（描边块）由 QuestionOptions 负责，这里只管与题干、与答案区的间距 */
.qc-options { margin-top: 10px; }
.qc-answer {
  margin-top: 10px;
  border-left: 3px solid var(--brand);
  background: #f7fafa;
  border-radius: 0 10px 10px 0;
  padding: 10px 14px;
  display: flex; flex-direction: column; gap: 6px;
  font-size: 13px; color: var(--ink-2); line-height: 1.7;
}
.qc-answer b { color: var(--ink); }
.qc-answer-text { color: var(--success); font-weight: 600; }
.qc-ops {
  display: flex; align-items: center; justify-content: flex-end; gap: 8px;
  margin-top: 12px; border-top: 1px dashed var(--border); padding-top: 10px;
}
/* 质检明细在卡片里紧跟答案区，去掉原来弹窗时代的 margin-bottom */
.q-card .verify-issues { margin: 10px 0 0; }
</style>
