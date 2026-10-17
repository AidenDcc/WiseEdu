<script setup lang="ts">
/**
 * AI 生成备课草稿（教案 / 学案 / 讲义共用）。
 *
 * ## 条件与「全局设置 → 基本信息」一一对应
 *
 * 年级 / 学科 / 教材 / 章节 / 知识点 —— 与基本信息里那几项**同名同序**，因为它们进的是同一个
 * prompt：基本信息描述的是「这份稿子教什么」，AI 面板描述的是「这次按什么生成」。
 * 两处字段名不一样（比如这里叫「科目」、那里叫「学科」），老师就得在脑子里做一次翻译。
 *
 * ## 教材是必填
 *
 * 同样一个「函数的单调性」，人教 A 版与北师大版的编排位置、例题体系都不同。
 * 不给教材，模型只能按通用套路写，出来的稿子「看着像教案，但哪一版都对不上」。
 * 所以这里不像上一版那样允许留空 —— 宁可让老师多点一次下拉，也不要一份用不了的稿子。
 *
 * ## 结果不直接落进正文
 *
 * 生成结果先渲染在下半屏，老师看过（还能整篇预览）、觉得能用再点「覆盖到正文」。
 * 生成是**整篇覆盖**，所以那一步会二次确认。
 *
 * 落到正文的动作不放这里做：正文的宿主是编辑器（只有它知道光标与撤销栈），
 * 所以这里只 `emit('apply')`，由父级交给编辑器。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { AppIcon, RichTextViewer, TEACH_TEMPLATE_KIND_TEXT, appConfirm, showToast } from '@aiteach/shared'
import type { TeachDoc, TeachTemplate, TeachTemplateKind } from '@aiteach/shared'
import { fetchTeachTemplates, generateTeachDraft } from '@/api/org'
import { useBaseData } from '@aiteach/business-common'
import TeachChapterPicker from './TeachChapterPicker.vue'
import TeachKnowledgeField from './TeachKnowledgeField.vue'
import DocTemplatePreview from './DocTemplatePreview.vue'
import { knowledgeOfChapter } from './knowledge-tree'

const props = defineProps<{
  /** 编辑态文档对象：用来取默认年级 / 学科 / 教材与章节，也用来判断「是否已经有正文」 */
  doc: TeachDoc
  /** 文档类型：决定模板候选与生成口径 */
  kind: TeachTemplateKind
}>()

const emit = defineEmits<{
  /** 生成结果落进正文（整篇覆盖）。正文由编辑器写，本组件不碰 */
  apply: [{ content: string; label: string }]
}>()

const kindText = computed(() => TEACH_TEMPLATE_KIND_TEXT[props.kind])

const { grades, optionsForGrade, versionsFor, defaultTextbook, ensure } = useBaseData()

/* ================= 表单 ================= */

const fallback = defaultTextbook()

const form = reactive({
  grade: props.doc.grade || fallback.grade,
  subject: props.doc.subject || fallback.subject,
  /* 教材必填：文档里没填过就落到矩阵的默认版本，而不是留空等老师踩一次校验 */
  textbook: props.doc.textbook || fallback.version || '',
  chapter: props.doc.chapter ?? '',
  templateId: null as number | null,
  requirement: '',
})

/** 当前生效的知识点（选章节会整批替换，之后可自由增删） */
const knowledge = ref<string[]>([...props.doc.knowledge])
/** 章节带出的默认知识点（差异高亮用） */
const baseline = ref<string[]>([])

/** 正在按章节名回树上找预设（查的时候先不显示「没找到」的提示） */
const restoring = ref(false)

/**
 * 打开时把「这一节的预设知识点」补回来（与全局设置同一套逻辑）。
 *
 * 自动填进来的章节（从文档带过来的）在树上找得到，就恢复成真预设 —— 否则老师打开面板
 * 会看到自己一条没改的知识点全被标成「自定义」。手打的章节找不到，保持为空。
 */
async function restoreBaseline() {
  if (!form.chapter.trim() || baseline.value.length) return
  const wanted = form.chapter.trim()
  restoring.value = true
  try {
    const found = await knowledgeOfChapter({
      grade: form.grade,
      subject: form.subject,
      textbook: form.textbook,
      chapter: wanted,
    })
    if (!found.length) return
    if (form.chapter.trim() !== wanted || baseline.value.length) return
    baseline.value = found
  } finally {
    restoring.value = false
  }
}

const subjectOptions = computed(() => optionsForGrade(form.grade))
const matrixVersions = computed(() => versionsFor(form.grade, form.subject))
const textbookOptions = computed(() =>
  form.textbook && !matrixVersions.value.includes(form.textbook)
    ? [form.textbook, ...matrixVersions.value]
    : matrixVersions.value,
)

/**
 * 换年级 / 学科后校正级联项。
 *
 * 旧学科可能不在新年级的学科表里（高一有「信息技术」、三年级没有），旧教材也可能不在
 * 新的「年级 + 学科」矩阵里 —— 不校正的话下拉会空着，生成时却仍拿旧值去查，表现成
 * 「明明选了学科，稿子却不是这个学科」。
 */
function syncSubject() {
  if (subjectOptions.value.length && !subjectOptions.value.includes(form.subject)) {
    form.subject = subjectOptions.value[0]
  }
}
function syncTextbook() {
  if (!matrixVersions.value.length) return
  if (!form.textbook || !matrixVersions.value.includes(form.textbook)) {
    form.textbook = matrixVersions.value[0]
  }
}
/** 换了教材，原章节不属于这套书了 —— 清章节与预设，知识点保留（老师敲的不能丢） */
function resetChapter() {
  form.chapter = ''
  baseline.value = []
}

/**
 * 手动改章节文字（不走章节树）：先丢旧 baseline，再按新文字回树上找一次。
 *
 * 老写法把这个方法挂在 `<input @change>` 上直接清 `form.chapter`，导致手打的章节一失焦
 * 就被清空，生成时 `chapter` 永远是空串 —— 生成器拿不到这一节，内容只能退回「按知识点泛泛而谈」。
 */
function onChapterTyped() {
  baseline.value = []
  void restoreBaseline()
}

function onGradeChange() {
  syncSubject()
  syncTextbook()
  resetChapter()
}
function onSubjectChange() {
  syncTextbook()
  resetChapter()
}
function onTextbookChange() {
  resetChapter()
}

/* ---- 章节 ---- */

const chapterOpen = ref(false)

function onChapterPick(payload: { chapter: string; knowledge: string[] }) {
  if (!payload.chapter) {
    form.chapter = ''
    baseline.value = []
    return
  }
  form.chapter = payload.chapter
  baseline.value = [...payload.knowledge]
  knowledge.value = [...payload.knowledge]
}

/* ================= 教案母版 ================= */

const templates = ref<TeachTemplate[]>([])
const loadingTemplates = ref(false)

const pickedTemplate = computed(() => templates.value.find((row) => row.id === form.templateId) ?? null)

async function loadTemplates() {
  loadingTemplates.value = true
  try {
    templates.value = await fetchTeachTemplates(props.kind)
    form.templateId = templates.value.find((row) => row.isDefault && row.enabled)?.id ?? templates.value.find((row) => row.enabled)?.id ?? null
  } catch {
    showToast('模板列表加载失败，将按默认骨架生成', 'error')
  } finally {
    loadingTemplates.value = false
  }
}

onMounted(() => {
  void ensure()
  void loadTemplates()
  void restoreBaseline()
})

/* ================= 生成 ================= */

interface DraftResult {
  content: string
  promptName: string
  tokens: number
  costMs: number
}

const generating = ref(false)
const result = ref<DraftResult | null>(null)
const previewOpen = ref(false)
/** 已经跑过几次：第一次叫「生成」，之后叫「重新生成」 */
const rounds = ref(0)

/** 生成用的课题：章节 → 知识点 → 文档名，依次退让 */
const topic = computed(() => form.chapter.trim() || knowledge.value.join('、') || props.doc.name.trim())

async function run() {
  if (generating.value) return
  if (!form.grade || !form.subject) {
    showToast('请先选择年级与学科', 'error')
    return
  }
  if (!form.textbook.trim()) {
    showToast('请选择教材版本 —— 不同版本同一节课的编排与例题完全不同', 'error')
    return
  }
  generating.value = true
  try {
    const data = await generateTeachDraft({
      kind: props.kind,
      subject: form.subject,
      grade: form.grade,
      textbook: form.textbook.trim(),
      chapter: form.chapter.trim(),
      knowledge: [...knowledge.value],
      topic: topic.value,
      templateId: form.templateId ?? undefined,
      /* 课时取模板的设定（教案母版里已经写了几课时）；描述原样进 prompt */
      periods: pickedTemplate.value?.periods,
      requirement: form.requirement.trim(),
    })
    result.value = data
    rounds.value += 1
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'AI 生成失败，请稍后重试', 'error')
  } finally {
    generating.value = false
  }
}

/**
 * 正文里是否已经有内容。
 *
 * **不能只看 `doc.content`**：库里还有一批只有旧结构（`plan` / `blocks`）的老稿子，
 * 它们打开时正文由 `docToHtml` 现场转出来，`content` 是空的 —— 只判 `content`
 * 就会把「眼前明明有一整篇稿子」当成空文档，一声不响地覆盖掉。
 */
const hasBody = computed(() => {
  const current = props.doc
  if (current.content?.trim()) return true
  if (current.blocks.some((row) => row.body?.trim())) return true
  const plan = current.plan
  if (!plan) return false
  return Boolean(
    plan.steps.length ||
      plan.blackboard?.trim() ||
      plan.reflection?.trim() ||
      plan.keyPoints?.trim() ||
      plan.hardPoints?.trim() ||
      plan.objectives?.knowledge?.trim() ||
      plan.objectives?.process?.trim() ||
      plan.objectives?.emotion?.trim(),
  )
})

/**
 * 覆盖到正文。
 *
 * 二次确认是必要的：生成是**整篇**的（骨架 + 课题一起换），点下去已写的内容就没了。
 * 没有正文时不问 —— 空文档没什么可丢的，多一次弹窗只是碍事。
 */
async function applyToDoc() {
  const data = result.value
  if (!data) return
  if (hasBody.value && !(await appConfirm('AI 草稿会整篇覆盖当前正文（页面设置与基本信息保留），继续？', { type: 'warning' }))) return
  emit('apply', { content: data.content, label: 'AI 草稿' })
}

/** 预览里点「用这一版」：关掉预览，接着走同一个覆盖流程（该确认的照样确认） */
function useFromPreview() {
  previewOpen.value = false
  void applyToDoc()
}
</script>

<template>
  <div class="da">
    <p class="da-lead">
      按下面的条件生成一份<b>有具体内容</b>的{{ kindText }}（教学目标、重难点、逐环节的师生活动、板书、
      作业都是按所选章节与知识点写出来的，不是空白骨架）。生成后可先预览，再决定要不要覆盖到正文。
    </p>

    <!-- ===== 条件 ===== -->
    <div class="da-grid">
      <div class="da-field">
        <label class="f-label">年级</label>
        <select v-model="form.grade" class="f-select" @change="onGradeChange">
          <option v-for="row in grades" :key="row" :value="row">{{ row }}</option>
        </select>
      </div>
      <div class="da-field">
        <label class="f-label">学科</label>
        <select v-model="form.subject" class="f-select" @change="onSubjectChange">
          <option v-for="row in subjectOptions" :key="row" :value="row">{{ row }}</option>
        </select>
      </div>
    </div>

    <div class="da-field">
      <label class="f-label">教材<span class="da-req">必填</span></label>
      <select v-if="textbookOptions.length" v-model="form.textbook" class="f-select" @change="onTextbookChange">
        <option value="" disabled>请选择教材版本</option>
        <option v-for="row in textbookOptions" :key="row" :value="row">{{ row }}</option>
      </select>
      <input v-else v-model="form.textbook" class="f-input" placeholder="如：人教 A 版 必修一" @change="onTextbookChange" />
      <p class="f-hint">不同版本同一节课的编排位置与例题体系不同，这一项决定稿子对不对得上你的教材。</p>
    </div>

    <div class="da-field">
      <label class="f-label">章节</label>
      <div class="da-pick">
        <input v-model="form.chapter" class="f-input" placeholder="选择教材章节，或直接填写" @change="onChapterTyped" />
        <button class="btn btn-ghost btn-sm da-pick-btn" type="button" title="按教材目录选章节" @click="chapterOpen = true">
          <AppIcon name="branch" :size="14" /> 选择
        </button>
      </div>
    </div>

    <div class="da-field">
      <label class="f-label">知识点</label>
      <TeachKnowledgeField v-model="knowledge" :baseline="baseline" :chapter="form.chapter" :checking="restoring" />
      <p class="f-hint">生成器会按这里的每一条展开讲解、例题与易错点；留空则按章节整体写。</p>
    </div>

    <div class="da-field">
      <label class="f-label">{{ kindText }}模板</label>
      <select v-model="form.templateId" class="f-select" :disabled="loadingTemplates">
        <option :value="null">{{ loadingTemplates ? '模板加载中…' : '按默认骨架生成' }}</option>
        <option v-for="row in templates.filter((r) => r.enabled)" :key="row.id" :value="row.id">
          {{ row.name }}<template v-if="row.isDefault">（默认）</template>
        </option>
      </select>
      <p class="f-hint">模板决定章节骨架与课时数；内容由 AI 按上面的条件填写。</p>
    </div>

    <div class="da-field">
      <label class="f-label">描述</label>
      <textarea
        v-model="form.requirement"
        class="da-textarea"
        rows="3"
        maxlength="200"
        placeholder="这堂课的特点与要求，如：学生基础较弱，需要多铺垫；重点讲单调性的判定步骤。"
      />
    </div>

    <button class="btn btn-primary da-run" type="button" :disabled="generating" @click="run">
      <AppIcon :name="generating ? 'refresh' : 'sparkles'" :size="15" />
      {{ generating ? '正在生成…' : rounds ? '重新生成' : 'AI 生成' }}
    </button>

    <!-- ===== 结果 ===== -->
    <section v-if="generating || result" class="da-result">
      <div class="da-result-head">
        <AppIcon name="template" :size="14" />
        <span>{{ result?.promptName ?? '正在生成…' }}</span>
        <span v-if="result" class="da-result-meta">
          第 {{ rounds }} 版 · {{ result.tokens }} tokens · {{ (result.costMs / 1000).toFixed(1) }}s
        </span>
        <!-- 整篇预览：与「引用模板」的预览是同一个弹窗，看着是同一份东西 -->
        <button v-if="result" class="da-result-eye" type="button" title="整篇预览" @click="previewOpen = true">
          <AppIcon name="eye" :size="13" />
        </button>
      </div>

      <div v-if="generating" class="da-result-busy">
        <AppIcon name="refresh" :size="16" class="da-spin" />
        <span>AI 正在按模板骨架逐节填写内容…</span>
      </div>
      <div v-else-if="result" class="da-result-body">
        <RichTextViewer :content="result.content" />
      </div>

      <div v-if="result" class="da-result-foot">
        <button class="btn btn-ghost btn-sm" type="button" :disabled="generating" @click="run">
          <AppIcon name="refresh" :size="14" /> 换一版
        </button>
        <button class="btn btn-primary btn-sm" type="button" @click="applyToDoc">
          <AppIcon name="check" :size="14" /> 覆盖到正文
        </button>
      </div>
    </section>

    <p v-else class="f-hint">填好条件后点「AI 生成」，生成的内容会显示在这里。</p>

    <TeachChapterPicker
      v-if="chapterOpen"
      :grade="form.grade"
      :subject="form.subject"
      :textbook="form.textbook"
      :chapter="form.chapter"
      @close="chapterOpen = false"
      @pick="onChapterPick"
    />

    <DocTemplatePreview
      v-if="previewOpen && result"
      :title="form.chapter || topic || doc.name"
      :subtitle="[form.grade, form.subject, form.textbook].filter(Boolean).join(' · ')"
      :content="result.content"
      use-label="用这一版"
      @close="previewOpen = false"
      @use="useFromPreview"
    />
  </div>
</template>

<style scoped>
.da { display: flex; flex-direction: column; gap: 4px; }
.da-lead { font-size: 12.5px; color: var(--sub); line-height: 1.75; margin-bottom: 14px; }

/* 两列栅格：抽屉只有三百来像素，两列刚好放下「年级 / 学科」这种短下拉 */
.da-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
@media (max-width: 720px) {
  .da-grid { grid-template-columns: 1fr; }
}

.da-field { margin-bottom: 14px; }
.da-field .f-label { display: flex; align-items: center; gap: 5px; font-size: 13px; font-weight: 600; color: var(--ink-2); margin-bottom: 7px; }
.da-req {
  padding: 1px 5px;
  border-radius: 5px;
  background: #fdeaea;
  color: var(--danger);
  font-size: 10.5px;
  font-weight: 600;
}

/* 章节：输入框 + 「选择」按钮同一行 */
.da-pick { display: flex; align-items: center; gap: 6px; }
.da-pick .f-input { flex: 1; min-width: 0; }
.da-pick-btn { flex-shrink: 0; white-space: nowrap; }

.da-textarea {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 8px 10px;
  font-family: inherit;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--ink);
  background: #fff;
  resize: vertical;
}
.da-textarea:focus { outline: none; border-color: var(--brand); box-shadow: 0 0 0 3px var(--brand-soft); }

.da-run { width: 100%; justify-content: center; margin-top: 4px; }

/* 生成结果：与 DocSettingsDialog 的卡片同一套观感 */
.da-result { margin-top: 16px; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
.da-result-head {
  display: flex;
  align-items: center;
  gap: 6px;
  /* 抽屉里宽度只够放下标题，「第 n 版 · token · 耗时」允许折到第二行 */
  flex-wrap: wrap;
  padding: 8px 11px;
  background: #f7f9fc;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-2);
}
.da-result-head > span:not(.da-result-meta) { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.da-result-meta { margin-left: auto; flex-shrink: 0; font-weight: 400; font-size: 11px; color: var(--sub); }
.da-result-eye {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: #fff;
  color: var(--ink-2);
  display: flex;
  align-items: center;
  justify-content: center;
}
.da-result-eye:hover { border-color: var(--brand); color: var(--brand-deep); }
.da-result-busy {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 18px 14px;
  font-size: 12.5px;
  color: var(--sub);
}
.da-spin { animation: da-rotate 1s linear infinite; }
@keyframes da-rotate { to { transform: rotate(360deg); } }
.da-result-body { padding: 12px 14px; max-height: 320px; overflow-y: auto; font-size: 13px; line-height: 1.8; color: var(--ink); }
.da-result-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 11px;
  border-top: 1px solid var(--border);
  background: #fbfcfe;
}
.da-result-foot .btn { flex: 1; justify-content: center; }
</style>
