<script setup lang="ts">
/**
 * 备课文档编辑器的**全局设置**（教案 / 学案 / 讲义共用）。
 *
 * 三个页签，按「老师改这份稿子的顺序」排：
 * 1. **基本信息**：这份稿子是什么（名称 / 年级学科 / 教材 / 章节知识点 / 编辑方式）；
 * 2. **引用模板**：骨架从哪儿来（一次性动作，会替换正文）；
 * 3. **页面设置**：印出来长什么样（纸张 / 页边距 / 正文基线 / 页眉页脚页码）。
 *
 * 「编辑方式」曾经是独立页签，现在收进基本信息：它是这份文档**怎么被写**的属性，
 * 与年级学科同级，单开一页反而让「基本信息」显得缺一块。切换不再关窗 ——
 * 面板开在右侧抽屉里，换的是左侧画布，关掉抽屉反而要多点一次。
 *
 * 数据流向：基本信息 / 页面设置走 `emit('patch')`，由 DocEditor（或页面）写回文档对象；
 * 引用模板要换**正文**，而正文的宿主是编辑器 —— 所以走 `emit('applyContent')`。
 * 不直接改 `props.doc`：文档对象是父级持有的，谁都能改它的时候，「这处改动是谁做的」就说不清了。
 *
 * ## 两种外壳
 *
 * - 默认（`embedded` 关）：居中弹窗，左侧竖排页签 —— 学案 / 讲义用；
 * - `embedded` 开：**只渲染内容本身**（页签横排），由外层抽屉负责标题栏、关闭按钮与滚动。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { AppIcon, TEACH_TEMPLATE_KIND_TEXT, appConfirm, showToast } from '@aiteach/shared'
import type { TeachDoc, TeachTemplate, TeachTemplateKind } from '@aiteach/shared'
import { fetchTeachTemplates } from '@/api/org'
import { useBaseData } from '@aiteach/business-common'
import TeachChapterPicker from './TeachChapterPicker.vue'
import TeachKnowledgeField from './TeachKnowledgeField.vue'
import DocTemplatePreview from './DocTemplatePreview.vue'
import { knowledgeOfChapter } from './knowledge-tree'
import {
  DOC_BODY_FONTS,
  DOC_BODY_LINE_HEIGHTS,
  DOC_BODY_SIZES,
  DOC_HEADER_POS,
  DOC_MARGINS,
  DOC_PAGE_NO_FORMATS,
  DOC_PAGE_NO_POS,
  DOC_PAPERS,
} from '@/components/doc/doc-options'

const props = withDefaults(
  defineProps<{
    doc: TeachDoc
    /** 当前文档类型：决定「引用模板」列出哪一批模板 */
    kind: TeachTemplateKind
    /** 打开时落在哪个页签（缺省落在基本信息） */
    initialTab?: TabKey
    /** 当前编辑方式；传了才出现「编辑方式」字段（教案全屏页把切换收在这里） */
    mode?: 'doc' | 'struct'
    /** 只渲染内容、不套弹窗外壳：供全屏编辑页的右侧抽屉使用 */
    embedded?: boolean
  }>(),
  { initialTab: 'basic', embedded: false },
)

const emit = defineEmits<{
  close: []
  /** 基本信息 / 页面设置的改动（DocEditor 写回文档并置脏） */
  patch: [value: Partial<TeachDoc>]
  /** 应用正文（引用模板）：mode 决定替换还是追加 */
  applyContent: [value: { content: string; mode: 'replace' | 'append'; label: string }]
  /** 编辑方式切换 */
  'update:mode': [value: 'doc' | 'struct']
}>()

type TabKey = 'basic' | 'template' | 'page'

const TABS: Array<{ key: TabKey; label: string; desc: string; icon: string }> = [
  { key: 'basic', label: '基本信息', desc: '名称 / 年级学科 / 教材 / 章节知识点', icon: 'file' },
  { key: 'template', label: '引用模板', desc: '套用一套现成的文档骨架', icon: 'template' },
  { key: 'page', label: '页面设置', desc: '纸张 / 页边距 / 正文样式 / 页眉页码', icon: 'sliders' },
]

const tab = ref<TabKey>(props.initialTab)
const kindText = computed(() => TEACH_TEMPLATE_KIND_TEXT[props.kind])

const { grades, optionsForGrade, versionsFor, ensure } = useBaseData()
onMounted(() => {
  void ensure()
  void restoreBaseline()
})

/* ================= 基本信息 ================= */

/** 表单在打开时初始化一次：本组件是「打开 → 改 → 关闭」的短生命周期，期间 doc 不会被换掉 */
const form = reactive({
  name: props.doc.name,
  grade: props.doc.grade,
  subject: props.doc.subject,
  textbook: props.doc.textbook ?? '',
  chapter: props.doc.chapter ?? '',
  periods: props.doc.plan?.periods ?? 1,
})

/** 当前生效的知识点 */
const knowledge = ref<string[]>([...props.doc.knowledge])

/**
 * 章节带出的**默认**知识点。
 *
 * 只存"选章节那一刻教材给了什么"，不存"当前有什么" —— 两者一混，「哪几个是我自己加的」
 * 就再也算不出来了（见 TeachKnowledgeField 的差异高亮）。
 *
 * 打开已有文档时先用 `restoreBaseline()` 按章节名回树上找一遍：找得到就恢复成真预设，
 * 找不到（章节是手打的）才留空、界面退回「全部自定义」。
 */
const baseline = ref<string[]>([])

/** 正在按章节名回树上找预设（查的时候先不显示「没找到」的提示，免得闪一下红字） */
const restoring = ref(false)

/**
 * 打开时把「这一节的预设知识点」补回来。
 *
 * baseline 原本只活在内存里，刷新一次就丢，重新打开一份选过章节的稿子会把**一条没改**的
 * 知识点全标成「自定义」—— 差异高亮等于白做。这里按章节名回树上取一次。
 *
 * 只在不打扰用户的前提下写：取回来时用户可能已经自己选过章节或改过文字了
 * （`form.chapter` 变了 / baseline 已经有值），那就以用户为准，直接丢弃这次结果。
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

/** 年级下的学科候选（教材矩阵缺该年级时退回全量学科） */
const subjectOptions = computed(() => optionsForGrade(form.grade))

/** 「年级 + 学科」下的教材版本 */
const matrixVersions = computed(() => versionsFor(form.grade, form.subject))

/** 教材候选：矩阵版本 + 当前值（存量文档里存的是细粒度名字，可能不在矩阵里） */
const textbookChoices = computed(() =>
  form.textbook && !matrixVersions.value.includes(form.textbook)
    ? [form.textbook, ...matrixVersions.value]
    : matrixVersions.value,
)

/**
 * 级联失效：换了年级 / 学科 / 教材，原来的章节与它的预设就不属于这套书了。
 *
 * 知识点**保留**：那是老师自己敲进去的内容，换个教材不该被抹掉。它只是从「有章节预设」
 * 变成「全部自定义」，差异高亮会如实反映这一点。
 */
function resetChapter() {
  if (!form.chapter && !baseline.value.length) return
  form.chapter = ''
  baseline.value = []
}

/**
 * 手动改章节文字（不走章节树）。
 *
 * 只动 baseline，**章节本身要留着** —— 老写法把这个方法直接挂在 `<input @change>` 上，
 * 于是「手打章节 → 失焦 → 章节自己消失」，保存下来的 `chapter` 永远是空串。
 *
 * 旧的预设先丢（它属于改之前那一节，拿来高亮就是撒谎），紧接着按新文字回树上再找一次：
 * 手打的章节名只要与教材目录对得上，差异高亮照样成立，不必逼老师一定要走弹框选。
 * 知识点一条不动 —— 那是老师自己敲的内容。
 */
function onChapterTyped() {
  baseline.value = []
  void restoreBaseline()
}

function syncSubject() {
  if (subjectOptions.value.length && !subjectOptions.value.includes(form.subject)) {
    form.subject = subjectOptions.value[0]
  }
}
function syncTextbook() {
  if (form.textbook && matrixVersions.value.length && !matrixVersions.value.includes(form.textbook)) {
    form.textbook = matrixVersions.value[0]
  }
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

/* ---- 章节选择弹框 ---- */

const chapterOpen = ref(false)

/**
 * 选中章节：把该节的预设知识点灌进知识点框。
 *
 * 已有知识点且与预设不同时先问一句 —— 选章节是主动行为，但「顺手覆盖掉我敲的五个知识点」
 * 不是老师点那一下时预期的事。
 */
async function onChapterPick(payload: { chapter: string; knowledge: string[] }) {
  if (!payload.chapter) {
    form.chapter = ''
    baseline.value = []
    return
  }
  const same = knowledge.value.length === payload.knowledge.length && knowledge.value.every((row) => payload.knowledge.includes(row))
  if (knowledge.value.length && !same) {
    const ok = await appConfirm(
      `选章节会把「${payload.chapter}」的预设知识点（${payload.knowledge.length} 项）替换当前知识点列表。继续？`,
      { type: 'warning' },
    )
    if (!ok) return
  }
  form.chapter = payload.chapter
  baseline.value = [...payload.knowledge]
  knowledge.value = [...payload.knowledge]
}

/* ---- 编辑方式 ---- */

const MODE_OPTIONS: Array<{ key: 'doc' | 'struct'; label: string; icon: string }> = [
  { key: 'doc', label: '文案编辑', icon: 'file' },
  { key: 'struct', label: '结构化编辑', icon: 'layers' },
]

/** 悬浮提示：两种写法各自是什么，一次说清 */
const MODE_TIP = [
  '文案编辑：像 Word 一样写一整篇。左侧目录按标题层级自动生成，右侧排版功能齐全，可直接打印、导出 Word。',
  '',
  '结构化编辑：按「三维目标 → 重难点 → 教学过程（逐环节）→ 板书 → 反思」逐块写。每个环节能单独关联题库题目、单独算时长。',
  '',
  '两者各写各的字段，来回切不会丢稿。',
].join('\n')

const activeMode = computed(() => props.mode ?? 'doc')

function onPickMode(value: 'doc' | 'struct') {
  if (value === activeMode.value) return
  emit('update:mode', value)
}

/* ---- 写回 ---- */

watch(
  [form, knowledge],
  () => {
    const periods = Math.max(1, Math.min(6, Number(form.periods) || 1))
    emit('patch', {
      name: form.name.trim(),
      subject: form.subject,
      grade: form.grade,
      textbook: form.textbook.trim(),
      chapter: form.chapter.trim(),
      knowledge: [...knowledge.value],
      /* 课时只对教案有意义（`periods` 挂在教案专属结构上）；其余类型不写，免得造出一个没人读的字段 */
      ...(props.doc.plan ? { plan: { ...props.doc.plan, periods } } : {}),
    })
  },
  { deep: true },
)

/* ================= 引用模板 ================= */

const templates = ref<TeachTemplate[]>([])
const loadingTemplates = ref(false)
const previewing = ref<TeachTemplate | null>(null)

/**
 * 正文是否已有内容：套用会整篇替换，空了就不必多问一句。
 *
 * **不能只看 `doc.content`**：库里有一批只有旧结构（`blocks` / `plan`）的老稿子，它们打开时
 * 正文由 `docToHtml` 现场转出来，`content` 是空的 —— 只判 content 就会把「眼前明明有一整篇稿子」
 * 当成空文档，一声不响地覆盖掉（与 DocAiDraftPanel 同一套判断口径）。
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
 * 模板卡片的缩略内容：h1 当标题，h2 当章节清单。
 *
 * 不做「把整篇 HTML 等比缩小塞进卡片」：那样每张卡都要渲染一份真实排版，
 * 一屏十几个模板时开销不小，而缩到 130px 宽之后字全都糊成灰块 ——
 * 老师真正要认的是「这份模板有哪些章节」，不是「缩小后的观感」。
 */
function outlineOf(content: string): { title: string; sections: string[] } {
  try {
    const parsed = new DOMParser().parseFromString(content, 'text/html')
    const title = parsed.querySelector('h1')?.textContent?.trim() ?? ''
    const sections = Array.from(parsed.querySelectorAll('h2'))
      .map((el) => el.textContent?.trim() ?? '')
      .filter(Boolean)
    return { title, sections }
  } catch {
    return { title: '', sections: [] }
  }
}

interface TemplateCard {
  row: TeachTemplate
  title: string
  sections: string[]
  /** 卡片里放不下、被折掉的章节数 */
  more: number
}

const MAX_SECTIONS = 6

const cards = computed<TemplateCard[]>(() =>
  templates.value.map((row) => {
    const { title, sections } = outlineOf(row.content)
    return {
      row,
      title: title || row.name,
      sections: sections.slice(0, MAX_SECTIONS),
      more: Math.max(0, sections.length - MAX_SECTIONS),
    }
  }),
)

async function loadTemplates() {
  loadingTemplates.value = true
  try {
    templates.value = await fetchTeachTemplates(props.kind)
  } catch {
    showToast('模板列表加载失败', 'error')
  } finally {
    loadingTemplates.value = false
  }
}
onMounted(loadTemplates)

/**
 * 套用：**整篇替换**。
 *
 * 取消「替换 / 追加」那个单选是刻意的：模板是骨架，追加到一篇已有正文的后面得到的
 * 是一份两套骨架拼接的稿子，几乎没人要。真要保留旧内容，复制一份再套用更稳。
 */
async function applyTemplate(row: TeachTemplate) {
  if (!row.enabled) return
  if (hasBody.value) {
    const ok = await appConfirm(`套用「${row.name}」会替换整篇正文，已写的内容将被清空。继续？`, { type: 'warning' })
    if (!ok) return
  }
  emit('applyContent', { content: row.content, mode: 'replace', label: `模板「${row.name}」` })
  showToast(`已套用模板「${row.name}」`, 'success')
}

/* ================= 页面设置 ================= */

/**
 * 纸张固定 A4。
 *
 * 「只支持 A4」是产品边界，不是没做完：整套版面（页心高度、分页引擎的 stride、
 * 缩略图的 A4 比例）都按 A4 标定，放开第二档就等于把每一处都要跟着参数化。
 * 存量文档里存过 b5 的，打开即归位到 a4 —— 下拉照样渲染成 A4，不会显示成空白。
 */
const page = reactive({
  paper: DOC_PAPERS[0].key,
  margin: props.doc.page?.margin ?? DOC_MARGINS[1].key,
  font: props.doc.page?.font ?? DOC_BODY_FONTS[0].key,
  size: props.doc.page?.size ?? DOC_BODY_SIZES[2].key,
  lineHeight: props.doc.page?.lineHeight ?? DOC_BODY_LINE_HEIGHTS[2].key,
  /* 页眉 / 页脚 / 页码：缺省与 Word 一致 —— 无页眉页脚文字、显示页码、页眉带分隔线 */
  header: props.doc.page?.header ?? '',
  footer: props.doc.page?.footer ?? '',
  headerPos: props.doc.page?.headerPos ?? DOC_HEADER_POS[1].key,
  pageNo: props.doc.page?.pageNo ?? true,
  pageNoFormat: props.doc.page?.pageNoFormat ?? DOC_PAGE_NO_FORMATS[0].key,
  pageNoPos: props.doc.page?.pageNoPos ?? DOC_PAGE_NO_POS[2].key,
  headerRule: props.doc.page?.headerRule ?? true,
})

watch(
  page,
  () => {
    emit('patch', { page: { ...page } })
  },
  { deep: true },
)

/** 正文基线三项的悬浮提示：它们作用的是**整篇**，与工具栏上的逐段设置不是一回事 */
const BODY_TIP = '整篇生效：正文里没有单独设过字体 / 字号 / 行距的段落，一律按这三项排版。\n需要某一节不一样时，用工具栏对选中的段落单独设，单设的值优先。'

/** 页码格式的示例：拿真样本给老师看，比「格式 A / B / C」好读 */
const pageNoSample = computed(() => {
  const total = 2
  switch (page.pageNoFormat) {
    case 'zh-simple':
      return `第 1 页`
    case 'num-total':
      return `1 / ${total}`
    case 'dash':
      return `- 1 -`
    case 'num':
      return `1`
    default:
      return `第 1 页 / 共 ${total} 页`
  }
})

/**
 * 页脚文字落在哪一格（与画布 DocCanvas 的 `footerSlot` 同一口径）：
 * 页码占左侧时文字让到右边，其余情况文字在左。
 */
const footerOnLeft = computed(() => !(page.pageNo && page.pageNoPos === 'left'))

const previewLeft = computed(() => {
  if (footerOnLeft.value) return page.footer
  return page.pageNo && page.pageNoPos === 'left' ? pageNoSample.value : ''
})
const previewCenter = computed(() => (page.pageNo && page.pageNoPos === 'center' ? pageNoSample.value : ''))
const previewRight = computed(() => {
  if (footerOnLeft.value) return page.pageNo && page.pageNoPos === 'right' ? pageNoSample.value : ''
  return page.footer
})
</script>

<template>
  <!-- 本组件**只渲染设置本体**（页签 + 内容），外壳由调用方决定：
       弹窗（学案 / 讲义）走 DocEditor 的 AppModal，抽屉（教案全屏页）走右侧栏。 -->
  <div class="ds" :class="{ 'is-embedded': embedded }">
    <nav class="ds-tabs">
      <button
        v-for="row in TABS"
        :key="row.key"
        class="ds-tab"
        :class="{ on: tab === row.key }"
        type="button"
        @click="tab = row.key"
      >
        <AppIcon :name="row.icon" :size="16" />
        <span class="ds-tab-label">{{ row.label }}</span>
        <span class="ds-tab-desc">{{ row.desc }}</span>
      </button>
    </nav>

    <div class="ds-body">
      <!-- ===== 基本信息 ===== -->
      <template v-if="tab === 'basic'">
        <div class="ds-field">
          <label class="f-label">{{ kindText }}名称</label>
          <input v-model="form.name" class="f-input" maxlength="50" :placeholder="`2-50 字，如「函数的单调性」`" />
        </div>

        <!-- 年级 / 学科一行：这两项总是一起决定「教哪个学段、哪门课」 -->
        <div class="ds-grid-2">
          <div class="ds-field">
            <label class="f-label">年级</label>
            <select v-model="form.grade" class="f-select" @change="onGradeChange">
              <option v-for="row in grades" :key="row" :value="row">{{ row }}</option>
            </select>
          </div>
          <div class="ds-field">
            <label class="f-label">学科</label>
            <select v-model="form.subject" class="f-select" @change="onSubjectChange">
              <option v-for="row in subjectOptions" :key="row" :value="row">{{ row }}</option>
            </select>
          </div>
        </div>

        <!-- 教材 / 课时一行：教材由「年级 + 学科」带出来，课时紧跟其后 -->
        <div class="ds-grid-2">
          <!-- 学案 / 讲义没有课时，教材独占整行（否则右半边永远空着一条） -->
          <div class="ds-field" :class="{ 'is-span-2': !doc.plan }">
            <label class="f-label">教材</label>
            <select v-if="textbookChoices.length" v-model="form.textbook" class="f-select" @change="onTextbookChange">
              <option value="">不指定版本</option>
              <option v-for="row in textbookChoices" :key="row" :value="row">{{ row }}</option>
            </select>
            <!-- 矩阵里没有这个年级学科时退回手填：校本讲义 / 自编教材本来就不在矩阵里 -->
            <input v-else v-model="form.textbook" class="f-input" placeholder="如：人教 A 版 必修一" @change="onTextbookChange" />
          </div>
          <div v-if="doc.plan" class="ds-field">
            <label class="f-label">课时</label>
            <input v-model.number="form.periods" class="f-input" type="number" min="1" max="6" />
          </div>
        </div>

        <!-- 章节：带弹出框选树，也可以直接手填 -->
        <div class="ds-field">
          <label class="f-label">章节</label>
          <div class="ds-pick">
            <input v-model="form.chapter" class="f-input" placeholder="选章节，或直接填写" @change="onChapterTyped" />
            <button class="btn btn-ghost btn-sm ds-pick-btn" type="button" title="按教材目录选章节" @click="chapterOpen = true">
              <AppIcon name="branch" :size="14" /> 选择
            </button>
          </div>
          <p class="f-hint">章节决定这份{{ kindText }}教到哪儿；选完会把这一节的预设知识点带进下面一栏。</p>
        </div>

        <div class="ds-field">
          <label class="f-label">知识点</label>
          <TeachKnowledgeField v-model="knowledge" :baseline="baseline" :chapter="form.chapter" :checking="restoring" />
          <p class="f-hint">知识点用于列表检索、归档，也决定 AI 生成的内容范围。</p>
        </div>

        <!-- 编辑方式：label + 问号（悬浮说明两种写法的差别）+ 两个 chip -->
        <div v-if="mode !== undefined" class="ds-field">
          <label class="f-label">
            编辑方式
            <span class="ds-tip" :title="MODE_TIP">
              <AppIcon name="help" :size="13" />
            </span>
          </label>
          <div class="ds-chips">
            <button
              v-for="opt in MODE_OPTIONS"
              :key="opt.key"
              class="ds-chip"
              :class="{ on: activeMode === opt.key }"
              type="button"
              @click="onPickMode(opt.key)"
            >
              <AppIcon :name="opt.icon" :size="13" /> {{ opt.label }}
            </button>
          </div>
        </div>
      </template>

      <!-- ===== 引用模板 ===== -->
      <template v-else-if="tab === 'template'">
        <p class="ds-lead">
          模板决定这份{{ kindText }}的【骨架】：有哪些章节、每节该写什么。套用后正文可随意增删改，模板本身不受影响。
        </p>

        <p v-if="loadingTemplates" class="ds-empty">模板加载中…</p>
        <p v-else-if="!cards.length" class="ds-empty">
          该类型还没有可用模板。可在「模板维护」里新建，或直接写正文。
        </p>

        <div v-else class="ds-tpl-grid">
          <div v-for="card in cards" :key="card.row.id" class="ds-tpl-card" :class="{ off: !card.row.enabled }">
            <!-- 卡片按 A4 比例：一眼看出这是「一整篇纸上的骨架」而不是一个选项 -->
            <div class="ds-tpl-paper">
              <p class="ds-tpl-paper-title">{{ card.title }}</p>
              <ul class="ds-tpl-paper-list">
                <li v-for="row in card.sections" :key="row">{{ row }}</li>
              </ul>
              <p v-if="card.more" class="ds-tpl-paper-more">…还有 {{ card.more }} 节</p>

              <!-- hover 才浮出的两个动作：常态让位给「看清骨架」，鼠标移上去才谈「要不要用」 -->
              <div class="ds-tpl-ops">
                <button class="ds-tpl-op is-primary" type="button" :disabled="!card.row.enabled" @click="applyTemplate(card.row)">
                  套用
                </button>
                <button class="ds-tpl-op" type="button" @click="previewing = card.row">预览</button>
              </div>
            </div>

            <div class="ds-tpl-meta">
              <span class="ds-tpl-name" :title="card.row.desc || card.row.name">{{ card.row.name }}</span>
              <span v-if="card.row.isDefault" class="tag tag-blue">默认</span>
              <span v-if="!card.row.enabled" class="tag tag-orange">已停用</span>
            </div>
          </div>
        </div>

        <p class="f-hint" style="margin-top: 10px">
          套用会<b>整篇替换</b>当前正文。想留着现在的内容，先在列表里复制一份副本。
        </p>
      </template>

      <!-- ===== 页面设置 ===== -->
      <template v-else-if="tab === 'page'">
        <div class="ds-sub">纸张与页边距</div>
        <div class="ds-grid">
          <div class="ds-field">
            <label class="f-label">纸张</label>
            <!-- 固定 A4：整套版面（页心高度、分页步长、缩略图比例）都按 A4 标定 -->
            <select class="f-select" disabled>
              <option>{{ DOC_PAPERS[0].label }}</option>
            </select>
            <p class="f-hint">当前版本仅支持 A4。</p>
          </div>
          <div class="ds-field">
            <label class="f-label">页边距</label>
            <select v-model="page.margin" class="f-select">
              <option v-for="row in DOC_MARGINS" :key="row.key" :value="row.key">{{ row.label }}</option>
            </select>
          </div>
        </div>

        <div class="ds-sub">
          正文基线
          <span class="ds-tip" :title="BODY_TIP">
            <AppIcon name="help" :size="13" />
          </span>
        </div>
        <div class="ds-grid">
          <div class="ds-field">
            <label class="f-label">正文字体</label>
            <select v-model="page.font" class="f-select">
              <option v-for="row in DOC_BODY_FONTS" :key="row.key" :value="row.key">{{ row.label }}</option>
            </select>
          </div>
          <div class="ds-field">
            <label class="f-label">正文字号</label>
            <select v-model="page.size" class="f-select">
              <option v-for="row in DOC_BODY_SIZES" :key="row.key" :value="row.key">{{ row.label }}</option>
            </select>
          </div>
          <div class="ds-field">
            <label class="f-label">正文行距</label>
            <select v-model="page.lineHeight" class="f-select">
              <option v-for="row in DOC_BODY_LINE_HEIGHTS" :key="row.key" :value="row.key">{{ row.label }}</option>
            </select>
          </div>
        </div>

        <div class="ds-sub">页眉</div>
        <div class="ds-grid">
          <div class="ds-field">
            <label class="f-label">页眉文字</label>
            <input v-model="page.header" class="f-input" maxlength="60" placeholder="如：函数的单调性 · 教学设计（留空即不印）" />
          </div>
          <div class="ds-field">
            <label class="f-label">页眉位置</label>
            <select v-model="page.headerPos" class="f-select" :disabled="!page.header">
              <option v-for="row in DOC_HEADER_POS" :key="row.key" :value="row.key">{{ row.label }}</option>
            </select>
          </div>
        </div>
        <div class="ds-checks">
          <label class="ds-check"><input v-model="page.headerRule" type="checkbox" /> 页眉下加分隔线</label>
        </div>

        <div class="ds-sub">页脚与页码</div>
        <div class="ds-grid">
          <div class="ds-field">
            <label class="f-label">页脚文字</label>
            <input v-model="page.footer" class="f-input" maxlength="60" placeholder="如：数学教研组 编制（留空即不印）" />
          </div>
          <div class="ds-field">
            <label class="f-label">页码格式</label>
            <select v-model="page.pageNoFormat" class="f-select" :disabled="!page.pageNo">
              <option v-for="row in DOC_PAGE_NO_FORMATS" :key="row.key" :value="row.key">{{ row.label }}</option>
            </select>
          </div>
          <div class="ds-field">
            <label class="f-label">页码位置</label>
            <select v-model="page.pageNoPos" class="f-select" :disabled="!page.pageNo">
              <option v-for="row in DOC_PAGE_NO_POS" :key="row.key" :value="row.key">{{ row.label }}</option>
            </select>
          </div>
        </div>
        <div class="ds-checks">
          <label class="ds-check"><input v-model="page.pageNo" type="checkbox" /> 显示页码</label>
        </div>

        <!-- 页脚效果预览：三格与纸上的页脚同一套布局，选完立刻看到它长什么样、落在哪一格 -->
        <div class="ds-pageno" :class="{ 'is-off': !page.pageNo }">
          <span class="ds-pageno-slot">{{ previewLeft }}</span>
          <span class="ds-pageno-slot is-center">{{ previewCenter }}</span>
          <span class="ds-pageno-slot is-end">{{ previewRight }}</span>
        </div>
        <p class="f-hint" style="margin-top: 6px">
          页眉页脚每页相同，不做「首页不同」；页码按屏幕上的分页视图计算。打印时由浏览器按纸张重新分页。
        </p>
      </template>
    </div>

    <!-- 章节树弹框：按当前「年级 + 学科 + 教材」拉树 -->
    <TeachChapterPicker
      v-if="chapterOpen"
      :grade="form.grade"
      :subject="form.subject"
      :textbook="form.textbook"
      :chapter="form.chapter"
      @close="chapterOpen = false"
      @pick="onChapterPick"
    />

    <!-- 模板整篇预览：与 AI 草稿的预览是同一个组件 -->
    <DocTemplatePreview
      v-if="previewing"
      :title="previewing.name"
      :subtitle="[form.grade, form.subject, form.textbook].filter(Boolean).join(' · ')"
      :content="previewing.content"
      @close="previewing = null"
    />
  </div>
</template>

<style scoped>
.ds { display: flex; gap: 18px; align-items: flex-start; }

/* 页签列 */
.ds-tabs { width: 176px; flex-shrink: 0; display: flex; flex-direction: column; gap: 3px; }
.ds-tab {
  display: grid;
  grid-template-columns: 18px 1fr;
  grid-template-rows: auto auto;
  gap: 1px 8px;
  padding: 9px 10px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: var(--ink-2);
  text-align: left;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.ds-tab svg { grid-row: span 2; align-self: start; margin-top: 2px; }
.ds-tab-label { font-size: 13.5px; font-weight: 600; }
.ds-tab-desc { font-size: 11.5px; color: var(--sub); line-height: 1.4; }
.ds-tab:hover { background: #f4f7fb; }
.ds-tab.on { background: var(--brand-soft); border-color: var(--brand); color: var(--brand-deep); }
.ds-tab.on .ds-tab-desc { color: var(--brand-deep); opacity: 0.75; }

.ds-body { flex: 1; min-width: 0; }
.ds-lead { font-size: 12.5px; color: var(--sub); line-height: 1.75; margin-bottom: 14px; }
.ds-lead b { color: var(--ink-2); }

/* 字段 */
.ds-field { margin-bottom: 14px; }
.ds-field .f-label {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-2);
  margin-bottom: 7px;
}
.ds-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 16px; }
/* 基本信息的两行（年级/学科、教材/课时）：**任何外壳下都保持两列** ——
   这几项本来就成对出现，收成一列会让抽屉里的表单长出一倍高 */
.ds-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 10px; }
.ds-field.is-span-2 { grid-column: span 2; }

/* 问号提示：原生 title 悬浮，不引入额外的气泡层 */
.ds-tip {
  display: inline-flex;
  align-items: center;
  color: var(--sub);
  cursor: help;
  border-radius: 50%;
}
.ds-tip:hover { color: var(--brand); }

/* 章节：输入框 + 「选择」按钮同一行 */
.ds-pick { display: flex; align-items: center; gap: 6px; }
.ds-pick .f-input { flex: 1; min-width: 0; }
.ds-pick-btn { flex-shrink: 0; white-space: nowrap; }

/* 编辑方式的两个 chip */
.ds-chips { display: flex; gap: 8px; flex-wrap: wrap; }
.ds-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 13px;
  border: 1.5px solid var(--border);
  border-radius: 999px;
  background: #fff;
  color: var(--ink-2);
  font-family: inherit;
  font-size: 12.5px;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}
.ds-chip:hover { border-color: #b9d8d6; }
.ds-chip.on { border-color: var(--brand); background: var(--brand-soft); color: var(--brand-deep); font-weight: 600; }

/* 复选框行（页眉分隔线、显示页码） */
.ds-checks { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; margin-top: 2px; margin-bottom: 4px; }
.ds-check { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--ink-2); cursor: pointer; }
.ds-check input { width: 14px; height: 14px; accent-color: var(--brand); }

/* ===== 模板卡片 ===== */
.ds-tpl-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.ds-tpl-card { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.ds-tpl-card.off { opacity: 0.5; }

/* A4 比例：高 = 宽 × 297/210。内容区用 overflow: hidden 裁掉放不下的章节，
   卡片高度因此整齐，网格不会变成一条参差的瀑布 */
.ds-tpl-paper {
  position: relative;
  aspect-ratio: 210 / 297;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 11px 11px 9px;
  border: 1.5px solid var(--border);
  border-radius: 6px;
  background: #fff;
  box-shadow: 0 1px 3px rgba(28, 36, 52, 0.06);
  overflow: hidden;
  transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
}
.ds-tpl-card:hover .ds-tpl-paper { border-color: var(--brand); box-shadow: 0 6px 18px rgba(28, 36, 52, 0.12); transform: translateY(-1px); }

.ds-tpl-paper-title {
  font-size: 9.5px;
  font-weight: 700;
  color: var(--ink);
  text-align: center;
  line-height: 1.4;
  padding-bottom: 5px;
  border-bottom: 1px solid #eef1f6;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.ds-tpl-paper-list { display: flex; flex-direction: column; gap: 3px; margin: 0; padding: 0; list-style: none; overflow: hidden; }
.ds-tpl-paper-list li {
  font-size: 8.5px;
  line-height: 1.5;
  color: #6b7280;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding-left: 6px;
  position: relative;
}
.ds-tpl-paper-list li::before {
  content: '';
  position: absolute;
  left: 0;
  top: 5px;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: #c7cedb;
}
.ds-tpl-paper-more { font-size: 8.5px; color: var(--sub); }

/* hover 浮出的动作条：盖在卡片下半部分，常态透明 —— 卡片太小，两颗常驻按钮会吃掉正文 */
.ds-tpl-ops {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  gap: 5px;
  padding: 6px;
  background: linear-gradient(to top, rgba(255, 255, 255, 0.98) 60%, rgba(255, 255, 255, 0));
  opacity: 0;
  transition: opacity 0.15s;
}
.ds-tpl-card:hover .ds-tpl-ops { opacity: 1; }
.ds-tpl-op {
  flex: 1;
  padding: 3px 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #fff;
  color: var(--ink-2);
  font-family: inherit;
  font-size: 10.5px;
  line-height: 1.5;
}
.ds-tpl-op:hover:not(:disabled) { border-color: var(--brand); color: var(--brand-deep); }
.ds-tpl-op.is-primary { background: var(--brand); border-color: var(--brand); color: #fff; font-weight: 600; }
.ds-tpl-op.is-primary:hover:not(:disabled) { filter: brightness(1.06); }
.ds-tpl-op:disabled { cursor: not-allowed; opacity: 0.5; }

.ds-tpl-meta { display: flex; align-items: center; gap: 5px; min-width: 0; }
.ds-tpl-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ds-empty { padding: 14px; border-radius: 10px; background: #f7f9fc; color: var(--sub); font-size: 12.5px; line-height: 1.7; }

/* ===== 抽屉形态（教案全屏页右侧栏）===== */
.ds.is-embedded { flex-direction: column; gap: 10px; }
.ds.is-embedded .ds-tabs {
  width: 100%;
  flex-direction: row;
  gap: 2px;
  padding-bottom: 0;
  overflow-x: auto;
  border-bottom: 1px solid var(--border);
}
.ds.is-embedded .ds-tab {
  grid-template-columns: auto;
  grid-template-rows: auto;
  gap: 0;
  padding: 7px 8px;
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 8px 8px 0 0;
  white-space: nowrap;
}
/* 抽屉里页签图标让位给文字：三个页签要挤进三百来像素宽的一行 */
.ds.is-embedded .ds-tab svg { display: none; }
.ds.is-embedded .ds-tab-label { font-size: 12px; }
.ds.is-embedded .ds-tab-desc { display: none; }
.ds.is-embedded .ds-tab:hover { background: #f4f7fb; }
.ds.is-embedded .ds-tab.on { background: transparent; border-bottom-color: var(--brand); }
/* 页面设置的两列在抽屉里放不下（每列只剩一百来像素），收成一列 */
.ds.is-embedded .ds-grid { grid-template-columns: 1fr; }
/* 模板卡片：抽屉里一行两个（需求要求一行 2-3 个，弹窗 3 个、抽屉 2 个） */
.ds.is-embedded .ds-tpl-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }

/* 小标题：页面设置里每一段的抬头 */
.ds-sub {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 16px 0 10px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.5px;
  color: var(--sub);
}
.ds-body > .ds-sub:first-child { margin-top: 0; padding-top: 0; border-top: none; }

/* 页码效果预览：三格等宽，与纸上的页脚（DocCanvas 的 .dc-sheet-foot）同一套布局 */
.ds-pageno {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  padding: 9px 12px;
  min-height: 38px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #fbfcfe;
  font-size: 12px;
  color: var(--ink-2);
}
.ds-pageno.is-off { opacity: 0.5; }
.ds-pageno-slot { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ds-pageno-slot.is-center { text-align: center; }
.ds-pageno-slot.is-end { text-align: right; }

/* 抽屉太窄，三格并排时每格只剩七十来像素 —— 改成三行，位置关系反而更清楚 */
.ds.is-embedded .ds-pageno { grid-template-columns: 1fr; gap: 2px; }
.ds.is-embedded .ds-pageno-slot { min-height: 18px; line-height: 18px; }

/* 窄屏（小窗口的弹窗形态）：竖排页签转横排、两列栅格并一列 */
@media (max-width: 720px) {
  .ds { flex-direction: column; }
  .ds-tabs { width: 100%; flex-direction: row; overflow-x: auto; }
  .ds-grid { grid-template-columns: 1fr; }
  .ds-tpl-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
