<script setup lang="ts">
/**
 * 教案 / 学案 / 讲义「文档编辑器」（Word 式）。三个类型共用这一个组件，只有模板候选与文案按类型不同。
 *
 * 本组件是**薄壳**：真正的编辑体验（A4 纸张画布、左侧目录、右侧贴边工具栏、公式 / 图片 / 配图弹窗）
 * 全在 `DocCanvas.vue` 里 —— 模板编辑器用的是同一个画布。这里只负责文档层的东西：
 * 顶栏、全局设置（引用模板 / 基本信息 / 页面设置 / AI 生成）、预览、打印。
 *
 * 与结构化编辑器的关系：教案的「教学过程环节」、学案的段落流在旧编辑器里仍是按块编辑的
 * （见 PlanView / GuideView / LectureView）。本编辑器编辑的是**整篇文档流** `TeachDoc.content`；
 * 打开一份只有旧结构的文档时，`doc-content.ts` 会现场把它转成文档流展示，老师一旦改过并保存，
 * `content` 就落库，此后不再走转换。
 *
 * 数据契约：`doc` 是**父级持有的编辑态对象**（父级已经从列表里深拷贝了一份），本组件直接在上面
 * 写正文与设置，保存动作仍由父级执行 —— 与三个备课页面既有的写法保持一致，不另造一层状态。
 */
import { computed, ref } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import { AppIcon, AppModal, RichTextViewer, TEACH_DOC_SOURCE_TEXT, TEACH_DOC_STATUS_TEXT, TEACH_TEMPLATE_KIND_TEXT, appConfirm, showToast, toPlainText } from '@aiteach/shared'
import type { TeachDoc, TeachTemplateKind } from '@aiteach/shared'

import DocCanvas from './DocCanvas.vue'
import DocSettingsDialog from './DocSettingsDialog.vue'
import DocAiDraftPanel from './DocAiDraftPanel.vue'
import { printHtmlDoc } from './doc-print'
import { useDocPage } from './useDocPage'
import { docToHtml } from '@/views/teach/doc-content'
import { downloadBlob, exportDocx, exportWordHtml, importDocx, safeFileName } from '@/utils/doc-io'
import { uploadMedia } from '@/api/org'
import type { RichMediaPlumbing } from '@/components/ui/rte/useRichMediaPlumbing'

const props = withDefaults(
  defineProps<{
    /** 编辑态文档对象（父级持有；本组件直接写 content 与 page 等字段） */
    doc: TeachDoc
    /** 文档类型：决定模板候选与文案（课件不进本编辑器） */
    kind: TeachTemplateKind
    saving?: boolean
    publishing?: boolean
    /**
     * 是否显示顶栏的「返回列表」。
     *
     * 备课三页的顶栏里已经有一个返回按钮（那里还要放「文档 / 结构化」的模式切换），
     * 两个返回按钮并排会让用户以为它们去不同的地方。所以从页面进入时传 false。
     */
    showBack?: boolean
    /**
     * 不渲染自带顶栏（基本信息那一整条）。
     *
     * 全屏编辑页（PlanEditView）要自己摆一条与试卷编辑同款的顶栏（品牌 + 卷名 + 操作 + 登录人），
     * 而文档名、操作按钮、字数页数都在这一条里 —— 于是顶栏搬出本组件，由页面渲染，
     * 本组件只留下「文档层」的职责（正文读写、导入导出、打印、全局设置）。
     * 关掉后请通过下方 `defineExpose` 暴露的方法驱动这些动作。
     */
    headless?: boolean
    /** 是否渲染画布自带的目录 / 缩放条 / 功能区 / 右侧贴边工具栏（见 DocCanvas 的 chrome） */
    chrome?: boolean
    /**
     * 编辑方式。`doc` = 整篇文档流，`struct` = 按块编辑（教案的教学环节 / 学案的段落）。
     *
     * 传了才会在「全局设置 → 基本信息」里出现「编辑方式」一项 —— 三个备课编辑页
     * （教案 / 学案 / 讲义，都是全屏工作台）都把模式切换收在那里，页面上不再另摆切换器，
     * 免得同一个开关在两个位置各有一份状态。
     */
    mode?: 'doc' | 'struct'
  }>(),
  { saving: false, publishing: false, showBack: true, headless: false, chrome: true },
)

const emit = defineEmits<{
  /** 请求保存（正文已写回 doc） */
  save: []
  /** 请求发布 / 下架 */
  publish: []
  /** 返回列表 */
  back: []
  /** 正文或设置被改过（父级可用来提示「有未保存的改动」） */
  change: []
  /** 编辑方式切换（全局设置里的「编辑方式」页签） */
  'update:mode': [value: 'doc' | 'struct']
}>()

const kindText = computed(() => TEACH_TEMPLATE_KIND_TEXT[props.kind])
const statusText = computed(() => TEACH_DOC_STATUS_TEXT[props.doc.status])

/**
 * 来源与只读。
 *
 * 校本 / 平台稿是学校与平台的定版，**只读**：能看、能打印、能导出、能复制一份副本，
 * 但不能就地改（见 shared/models.ts 的 `TeachDocSource`）。老数据没有 `source` 字段，
 * 一律按「个人」处理 —— 它们全是教师自己建、自己改的稿子。
 */
const source = computed(() => props.doc.source ?? 'personal')
const sourceText = computed(() => TEACH_DOC_SOURCE_TEXT[source.value])
const readonly = computed(() => source.value !== 'personal')

/* 打印样式与画布取自同一份页面设置解析（见 useDocPage.ts）：纸张参数只有一处口径，
   不会出现「屏幕上 A4、打印出来是默认纸张」 */
const { paper, marginMm, header, footer, printCss } = useDocPage(() => props.doc.page)

/* ================= 正文的双向绑定 ================= */

/**
 * 画布拿到的正文。
 *
 * 读的时候走 `docToHtml`：库里有一批**只有旧结构**（`blocks` / `plan`）的老文档，它们没有 `content`，
 * 直接用 `doc.content ?? ''` 会让编辑器打开一片空白。写的时候只写 `content` —— 落库一律用新字段。
 */
const html = computed({
  get: () => docToHtml(props.doc),
  set: (value: string) => {
    props.doc.content = value
  },
})

/* ================= 画布 ================= */

/** 画布对外暴露的极简 API（见 DocCanvas 的 defineExpose） */
interface DocCanvasApi {
  editor: Editor | undefined
  media: RichMediaPlumbing | undefined
  baseSize: string
  setHtml: (html: string) => void
  insertHtml: (html: string) => void
  insertAtCursor: (html: string) => void
  getHtml: () => string
  charCount: number
  headCount: number
  /** 分页引擎算出的页数（顶栏的「共 n 页」读它） */
  pageCount: number
  zoom: number
  setZoom: (value: number) => void
  stepZoom: (delta: number) => void
  fitWidth: () => void
  paginated: boolean
  setPaginated: (value: boolean) => void
  openParagraph: () => void
}
const canvas = ref<DocCanvasApi | null>(null)

/**
 * 「全局设置」的开合与落点。
 *
 * 只服务**非 headless** 的用法（学案 / 讲义与内嵌画布）：弹窗外壳套在这里而不是
 * DocSettingsDialog 自己身上 —— 全屏教案编辑页要把同一份设置放进右侧抽屉（见 PlanEditView），
 * 外壳写在组件内部的话，「同一份设置」就会长成两套界面。
 *
 * 落点缺省是「基本信息」：那是老师点「全局设置」时最常要改的一页（名称、年级学科、章节知识点）。
 * 编辑方式收在基本信息里之后，设置面板已没有独立的模式页签。
 */
const settingsOpen = ref(false)
const settingsTab = ref<'basic' | 'template' | 'page'>('basic')
/** 预览弹窗：只读地整篇看一遍（正文太长的文档在画布里翻页翻得手酸） */
const previewOpen = ref(false)

/**
 * AI 生成草稿的弹窗。
 *
 * 「AI 生成」原来挂在全局设置的页签里，本轮把它提出来单独一个入口：它生成的是**整篇正文**，
 * 与「引用模板 / 页面设置」这类设置项不是一件事（设置改的是元数据与版面，它改的是内容）。
 * 教案的全屏编辑页把同一个面板放进了右侧抽屉（见 PlanEditView），学案 / 讲义仍用弹窗。
 */
const aiOpen = ref(false)

function openSettings() {
  settingsTab.value = 'basic'
  settingsOpen.value = true
}

/* ================= 导入 / 导出 Word ================= */

const fileInput = ref<HTMLInputElement | null>(null)
const importing = ref(false)
const exporting = ref(false)

function pickDocx() {
  fileInput.value?.click()
}

/** Blob → data URL：媒体库的上传接口收的是 dataUrl（题目配图走的是同一条） */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(blob)
  })
}

async function onDocxPicked(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  /* 先清空 value：同一个文件连选两次也要能触发 change */
  input.value = ''
  if (!file) return
  if (!/\.docx$/i.test(file.name)) {
    showToast('目前只支持导入 .docx（.doc / .wps 请先用 Word 另存为 .docx）', 'error')
    return
  }
  const hasContent = toPlainText(canvas.value?.getHtml() ?? html.value).length > 0
  if (hasContent && !(await appConfirm('导入会替换当前正文（页面设置与基本信息保留）。继续？', { type: 'warning' }))) return

  importing.value = true
  try {
    const result = await importDocx(file, {
      /* 图片必须抽出来入库再换成 URL：正文只存 URL（见 doc-extensions 的 allowBase64: false），
         不换的话保存时会被净化掉，表现成「导入成功但图片全没了」 */
      uploadImage: async (blob, name) => {
        const media = await uploadMedia({
          name,
          kind: 'image',
          subject: props.doc.subject,
          knowledge: props.doc.knowledge ?? [],
          dataUrl: await blobToDataUrl(blob),
          mime: blob.type,
          sizeMb: Number((blob.size / 1024 / 1024).toFixed(2)),
        })
        if (!media.url) throw new Error('图片入库失败')
        return media.url
      },
    })
    canvas.value?.setHtml(result.html)
    emit('change')
    const notes = [`已导入《${file.name.replace(/\.docx$/i, '')}》`]
    if (result.droppedImages) notes.push(`${result.droppedImages} 张图片未能入库已跳过`)
    if (result.warnings.length) notes.push(`Word 中部分样式未保留：${result.warnings[0]}`)
    showToast(notes.join('；'), result.droppedImages ? 'error' : 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '导入失败', 'error')
  } finally {
    importing.value = false
  }
}

/**
 * 导出 Word。
 *
 * 优先导**真正的 .docx**；`docx` 依赖没装或转换抛错时退回 `.doc`（Word 能打开，
 * 另存为即得 .docx）—— 不能让导出按钮点了没反应。退回时如实说明是哪种格式。
 */
async function onExport() {
  const body = canvas.value?.getHtml() ?? html.value
  if (!toPlainText(body)) {
    showToast('正文还是空的，没有可导出的内容', 'error')
    return
  }
  exporting.value = true
  const meta = {
    title: props.doc.name,
    paper: { width: paper.value.width, height: paper.value.height },
    margin: marginMm.value,
    header: header.value || undefined,
    footer: footer.value || undefined,
  }
  try {
    const blob = await exportDocx(body, meta)
    downloadBlob(blob, safeFileName(props.doc.name, 'docx'))
    showToast('已导出 .docx，可用 Word / WPS 打开', 'success')
  } catch {
    downloadBlob(exportWordHtml(body, meta), safeFileName(props.doc.name, 'doc'))
    showToast('已导出为 .doc（Word 可打开，另存为即可得 .docx）', 'success')
  } finally {
    exporting.value = false
  }
}

/* ================= 全局设置 / 模板 / AI 的回填 ================= */

/**
 * 全局设置弹窗改的是「文档元数据与页面设置」，直接写回 doc 即可（父级负责保存）。
 * 名称留空时不写：`saveTeachDoc` 会以「名称须为 2-50 字」拒掉，而编辑器里当场清空名称
 * 只该是「正在改」的中间态，不该立刻在界面上报错。
 */
function onPatch(value: Partial<TeachDoc>) {
  Object.assign(props.doc, value)
  emit('change')
}

/** 应用正文（引用模板 / AI 草稿）。替换与追加的分寸由画布决定（追加一律落到文档末尾） */
function onApplyContent(payload: { content: string; mode: 'replace' | 'append'; label: string }) {
  if (payload.mode === 'replace') canvas.value?.setHtml(payload.content)
  else canvas.value?.insertHtml(payload.content)
  showToast(`${payload.label}已应用，记得保存`, 'success')
}

/** AI 草稿一律**整篇覆盖**（骨架与课题都换了）—— 面板里已经二次确认过，这里直接落进画布 */
function onApplyAiDraft(payload: { content: string; label: string }) {
  onApplyContent({ ...payload, mode: 'replace' })
}

/* ================= 预览 / 打印 ================= */

const charCount = computed(() => toPlainText(html.value).length)

/**
 * 打印正文。
 *
 * 实现收在 `doc-print.ts` 里 —— 工作台的预览弹窗、教案的版式预览都要打「一张独立的纸」，
 * 三处各写一份 iframe 拼装代码，迟早有一处忘了转义标题或忘了摘 iframe。
 */
function onPrint() {
  const body = canvas.value?.getHtml() ?? html.value
  if (!toPlainText(body)) {
    showToast('正文还是空的，没有可打印的内容', 'error')
    return
  }
  printHtmlDoc({ title: props.doc.name, css: printCss(), body: `<article class="rte-content">${body}</article>` })
}

/* ================= 对外 API（页面自绘顶栏时要用） ================= */

/**
 * `headless` 模式下本组件不画顶栏，页面上的按钮要驱动这里的动作，于是把
 * 「页面上真实存在的每个按钮」逐个交出去。刻意不暴露 `doc` / `canvas` 这类内部状态：
 * 页面拿得到的是**动作与读数**，写回文档仍然只走 `v-model` 与 `patch`，
 * 免得同一份文档对象在三个组件里各改一处、说不清是谁置的脏。
 */
defineExpose({
  /* 编辑器与媒体（顶部功能区、题库 / 媒体库面板都要用） */
  editor: computed(() => canvas.value?.editor),
  media: computed(() => canvas.value?.media),
  baseSize: computed(() => canvas.value?.baseSize ?? ''),
  /* 读数 */
  charCount: computed(() => canvas.value?.charCount ?? charCount.value),
  headCount: computed(() => canvas.value?.headCount ?? 0),
  pageCount: computed(() => canvas.value?.pageCount ?? 1),
  zoom: computed(() => canvas.value?.zoom ?? 100),
  paginated: computed(() => canvas.value?.paginated ?? true),
  setZoom: (value: number) => canvas.value?.setZoom(value),
  stepZoom: (delta: number) => canvas.value?.stepZoom(delta),
  fitWidth: () => canvas.value?.fitWidth(),
  setPaginated: (value: boolean) => canvas.value?.setPaginated(value),
  /* 正文 */
  insertAtCursor: (fragment: string) => canvas.value?.insertAtCursor(fragment),
  /** 追加到末尾：模板骨架与 AI 草稿都是「一整篇」，插在段落中间会把原文劈成两半 */
  insertHtml: (fragment: string) => canvas.value?.insertHtml(fragment),
  setHtml: (value: string) => canvas.value?.setHtml(value),
  getHtml: () => canvas.value?.getHtml() ?? html.value,
  /* 动作 */
  importing,
  exporting,
  openSettings,
  openPreview: () => (previewOpen.value = true),
  openParagraph: () => canvas.value?.openParagraph(),
  pickDocx,
  onExport,
  onPrint,
})
</script>

<template>
  <div class="de" :class="{ 'is-headless': headless }">
    <!-- ================= 顶栏（headless 时由页面自绘） ================= -->
    <header v-if="!headless" class="de-bar panel">
      <button v-if="showBack" class="btn btn-ghost btn-sm" type="button" @click="emit('back')">
        <AppIcon name="undo" :size="15" /> 返回列表
      </button>

      <div class="de-title">
        <input v-if="!readonly" v-model="doc.name" class="de-name" maxlength="50" :placeholder="`${kindText}名称（2-50 字）`" />
        <p v-else class="de-name de-name-ro">{{ doc.name }}</p>
        <div class="de-meta">
          <span class="tag tag-blue">{{ doc.subject }}</span>
          <span class="tag tag-gray">{{ doc.grade }}</span>
          <span v-if="doc.textbook" class="tag tag-gray">{{ doc.textbook }}</span>
          <span
            class="tag"
            :class="source === 'personal' ? 'tag-gray' : source === 'school' ? 'tag-orange' : 'tag-blue'"
            :title="readonly ? `${sourceText}稿：只读，可复制一份副本再改` : '个人稿：可自由编辑'"
          >
            {{ sourceText }}
          </span>
          <span class="tag" :class="doc.status === 'published' ? 'tag-green' : 'tag-orange'">{{ statusText }}</span>
          <span v-for="k in doc.knowledge" :key="k" class="tag tag-gray">{{ k }}</span>
          <!-- 节数 / 字数 / 页数从画布取（它才知道编辑器里的实时状态）；画布未就绪时退回到正文本身 -->
          <span class="de-count">
            {{ canvas?.headCount ?? 0 }} 节 · {{ canvas?.charCount ?? charCount }} 字 · 共 {{ canvas?.pageCount ?? 1 }} 页
          </span>
        </div>
      </div>

      <div class="de-actions">
        <template v-if="!readonly">
          <button
            class="btn btn-ghost btn-sm"
            type="button"
            title="全局设置：引用模板 / 基本信息 / 页面设置（含页眉页脚与页码）"
            @click="openSettings"
          >
            <AppIcon name="sliders" :size="15" /> 全局设置
          </button>
          <button class="btn btn-ghost btn-sm" type="button" title="按母版骨架 + 课题生成一份完整草稿" @click="aiOpen = true">
            <AppIcon name="sparkles" :size="15" /> AI {{ kindText }}
          </button>
          <button class="btn btn-ghost btn-sm" type="button" :disabled="importing" title="导入 .docx：语义化重建为可在线编辑的文档（版面不保留）" @click="pickDocx">
            <AppIcon name="upload" :size="15" /> {{ importing ? '导入中…' : '导入 Word' }}
          </button>
        </template>
        <button class="btn btn-ghost btn-sm" type="button" :disabled="exporting" title="导出 Word：优先 .docx，依赖未装时退回 .doc" @click="onExport">
          <AppIcon name="word" :size="15" /> {{ exporting ? '导出中…' : '导出 Word' }}
        </button>
        <button class="btn btn-ghost btn-sm" type="button" @click="previewOpen = true">
          <AppIcon name="eye" :size="15" /> 预览
        </button>
        <button class="btn btn-ghost btn-sm" type="button" @click="onPrint">
          <AppIcon name="print" :size="15" /> 打印
        </button>
        <template v-if="!readonly">
          <button class="btn btn-ghost btn-sm" type="button" :disabled="publishing" @click="emit('publish')">
            <AppIcon :name="doc.status === 'published' ? 'download' : 'share'" :size="15" />
            {{ doc.status === 'published' ? '下架' : '发布' }}
          </button>
          <button class="btn btn-primary btn-sm" type="button" :disabled="saving" @click="emit('save')">
            <AppIcon name="save" :size="15" /> {{ saving ? '保存中…' : '保存' }}
          </button>
        </template>
      </div>
    </header>

    <!-- 导入用的隐藏文件选择器：只有一个按钮，没必要为它开一块界面。
         放在顶栏**外面**：headless 时顶栏不渲染，它得跟着活下来（否则页面的「导入 Word」点了没反应） -->
    <input ref="fileInput" class="de-file" type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" @change="onDocxPicked" />

    <p v-if="readonly" class="de-ro-note">
      这是{{ sourceText }}稿，只读。需要按自己的思路改，请在列表里「复制」一份副本 —— 副本归你个人所有，可自由编辑。
    </p>

    <!-- ================= 纸张画布（左目录 + 中纸张 + 右贴边工具栏；headless 时这三处由页面摆） ================= -->
    <DocCanvas
      ref="canvas"
      v-model="html"
      :page="doc.page"
      :subject="doc.subject"
      :title="doc.name"
      :readonly="readonly"
      :chrome="chrome"
      @change="emit('change')"
    />

    <!-- ================= 弹窗 ================= -->
    <!-- 全局设置：外壳（AppModal）套在这里而不是 DocSettingsDialog 内部 ——
         同一份设置还要被教案全屏编辑页放进右侧抽屉（`embedded`），外壳写在组件里就会长出两套界面。
         headless 时这里整个不渲染：那种用法下设置由页面自己摆（见 PlanEditView 的右侧栏）。 -->
    <AppModal v-if="settingsOpen && !headless" :title="`全局设置 · ${doc.name}`" :width="900" @close="settingsOpen = false">
      <DocSettingsDialog
        :doc="doc"
        :kind="kind"
        :initial-tab="settingsTab"
        :mode="mode"
        @close="settingsOpen = false"
        @patch="onPatch"
        @apply-content="onApplyContent"
        @update:mode="emit('update:mode', $event)"
      />
    </AppModal>

    <!-- AI 生成草稿：与全局设置分开一个入口 —— 它生成整篇正文，不是「设置」 -->
    <AppModal v-if="aiOpen && !headless" :title="`AI 生成${kindText}`" :width="760" @close="aiOpen = false">
      <DocAiDraftPanel :doc="doc" :kind="kind" @apply="onApplyAiDraft" />
    </AppModal>

    <AppModal v-if="previewOpen" :title="doc.name" :width="900" @close="previewOpen = false">
      <article class="de-preview rte-content">
        <h1 class="de-preview-title">{{ doc.name }}</h1>
        <p class="de-preview-sub">
          {{ doc.subject }} · {{ doc.grade }}<template v-if="doc.textbook"> · {{ doc.textbook }}</template>
        </p>
        <RichTextViewer :content="html" empty="正文还是空的，先写点内容或套用一份模板。" />
      </article>
    </AppModal>
  </div>
</template>

<style scoped>
.de { display: flex; flex-direction: column; gap: 12px; }
/* headless：本组件被当成「画布那一栏」塞进页面骨架，高度由父级给，不能再按自己的内容撑开 */
.de.is-headless { height: 100%; min-height: 0; gap: 0; }
/* 只读提示条会占掉一行高度，画布必须跟着「剩下的那点高度」缩，否则整叠纸会被顶出可视区。
   选择器写到 `.dc.is-bare` 这一级（比画布自己的 `.dc.is-bare` 更具体），免得靠样式先后顺序取胜 */
.de.is-headless > .dc.is-bare { flex: 1 1 auto; min-height: 0; height: auto; }

/* ===== 顶栏 ===== */
.de-bar { display: flex; align-items: center; gap: 14px; padding: 10px 14px; }
.de-title { flex: 1; min-width: 0; }
.de-name {
  width: 100%;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 3px 8px;
  background: transparent;
  color: var(--ink);
  font-family: inherit;
  font-size: 16px;
  font-weight: 700;
  transition: border-color 0.15s, background 0.15s;
}
.de-name:hover { border-color: var(--border); }
.de-name:focus { outline: none; border-color: var(--brand); background: #fff; box-shadow: 0 0 0 3px var(--brand-soft); }
.de-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 3px 8px 0; }
.de-count { font-size: 11.5px; color: var(--sub); margin-left: 2px; }
.de-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; }

/* 只读时标题是一段文字而不是输入框：给一个「点不动」的输入框比直接给文字更让人困惑 */
.de-name-ro { font-size: 16px; font-weight: 700; color: var(--ink); padding: 3px 8px; }

/* 隐藏的文件选择器：只由「导入 Word」按钮间接唤起 */
.de-file { display: none; }

/* 只读提示条：说明为什么改不了、以及怎么才能改 */
.de-ro-note {
  font-size: 12.5px;
  color: var(--warn);
  background: #fff8ea;
  border: 1px solid #f4dcae;
  border-radius: 10px;
  padding: 9px 13px;
  line-height: 1.7;
}

/* ===== 预览 ===== */
.de-preview { font-size: 13.5px; line-height: 1.9; color: var(--ink); }
.de-preview-title { font-size: 20px; font-weight: 700; text-align: center; margin-bottom: 6px; }
.de-preview-sub { text-align: center; color: var(--sub); font-size: 12.5px; margin-bottom: 18px; }
.de-preview :deep(.rte-content h1) { font-size: 19px; margin: 18px 0 8px; }
.de-preview :deep(.rte-content h2) { font-size: 16px; margin: 16px 0 7px; }
.de-preview :deep(.rte-content h3) { font-size: 14.5px; margin: 12px 0 6px; }
</style>
