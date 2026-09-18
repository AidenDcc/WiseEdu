<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { Mathematics } from '@tiptap/extension-mathematics'
import { Image } from '@tiptap/extension-image'
import { ResizableNodeView } from '@tiptap/core'
import { AppIcon, isRichContent, normalizeRichHtml, resolveMediaSrc, showToast, toPlainText } from '@aiteach/shared'
import type { DrawEditorType, OrgMedia } from '@aiteach/shared'
import FormulaPickerModal from './FormulaPickerModal.vue'
import MediaPickerModal from './MediaPickerModal.vue'
import MediaDrawSelectDialog from '@/components/draw/MediaDrawSelectDialog.vue'
import AiDrawGenerateDialog from '@/components/draw/AiDrawGenerateDialog.vue'
import DrawEditorHost from '@/components/draw/DrawEditorHost.vue'
import { DrawSvgImage } from '@/tiptap-extensions/drawSvgImage'
import { fetchMediaDetail, uploadMedia } from '@/api/org'

/** 拖拽的最小边长：再小控制点就糊成一个点，也失去了「缩回去」的手感 */
const MIN_IMAGE_PX = 40

/**
 * 图片节点：正文里存的是 `/api/tenant/media/12/raw` 这类规范地址，浏览器直接请求拿不到字节
 * （mock 阶段没有托管服务），编辑器内因此渲染成破图。
 *
 * 用 NodeView 做显示层的地址还原，而不是改 renderHTML —— `getHTML()` 走的就是 renderHTML，
 * 在那里换地址会把 data URL 写进存储，正文就不再是「只存 URL」了。
 *
 * 缩放也挂在这个 NodeView 上：四角 + 四边共八个控制点，松手写回节点的 width / height 属性，
 * 存下来是 `<img src="…" width="320" height="180">` —— 只读渲染端（RichTextViewer）靠属性就能
 * 还原尺寸，不需要知道编辑器里发生过什么。缩放本身复用 @tiptap/core 的 ResizableNodeView，
 * 不自己写拖拽数学；这里只负责给它一个「地址已还原、尺寸已回填」的 img。
 *
 * 方向语义：四角拖 = 等比缩放（几何图、照片不被拉变形）；四边中点拖 = 单向拉伸 —
 * 水平边只改宽、垂直边只改高（裁掉 AI 配图多余的留白）。等比锁不是全局开关，
 * 而是每次拖拽开始时按把手方向切换（见下方对 handleResizeStart 的实例级遮蔽）。
 */
const ResizableImage = Image.extend({
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const el = document.createElement('img')

      /** DOM 与节点属性对齐：初始渲染与每次 update 都走这里，撤销 / 重做才带得回旧尺寸 */
      const paint = (attrs: Record<string, unknown>) => {
        const src = String(attrs.src ?? '')
        if (src) el.src = resolveMediaSrc(src)
        if (attrs.alt) el.alt = String(attrs.alt)
        if (attrs.title) el.title = String(attrs.title)
        /* 没有 width 就清掉内联尺寸，退回 CSS 的 max-width: 100% 自适应 */
        el.style.width = attrs.width ? `${attrs.width}px` : ''
        el.style.height = attrs.height ? `${attrs.height}px` : ''
      }
      paint(node.attrs)

      const view = new ResizableNodeView({
        element: el,
        editor,
        node,
        getPos,
        /* 拖拽过程只动 DOM，松手才写节点：逐帧 updateAttributes 会把撤销栈切成几百步 */
        onResize: (width, height) => {
          el.style.width = `${width}px`
          el.style.height = `${height}px`
        },
        onCommit: (width, height) => {
          const pos = getPos()
          if (pos === undefined) return
          /* 先选中再写属性：松手后控制点不消失，可以接着微调 */
          editor.chain().setNodeSelection(pos).updateAttributes(node.type.name, { width, height }).run()
        },
        onUpdate: (updated) => {
          if (updated.type !== node.type) return false
          paint(updated.attrs)
          return true
        },
        options: {
          directions: [
            'top-left', 'top', 'top-right',
            'left', 'right',
            'bottom-left', 'bottom', 'bottom-right',
          ],
          min: { width: MIN_IMAGE_PX, height: MIN_IMAGE_PX },
          /* 全局等比锁关闭（否则边中点也变成等比，单向拉伸就失效了）；按下面对
             handleResizeStart 的遮蔽，在每次拖拽开始时按把手方向重新设定 */
          preserveAspectRatio: false,
        },
      })

      /* preserveAspectRatio 是拖拽期间实时读取的实例属性，而方向只有拖拽开始那一刻可知，
         库又没有提供按方向配置的口子 —— 实例级遮蔽私有方法（运行时即普通原型方法，
         赋值成自有属性后库的监听闭包读到的就是这里设定的值）。d.ts 标了 private，
         故做一次类型断言。 */
      const protoStart = (
        view as unknown as {
          handleResizeStart: (event: MouseEvent | TouchEvent, direction: string) => void
        }
      ).handleResizeStart
      ;(
        view as unknown as {
          handleResizeStart: (event: MouseEvent | TouchEvent, direction: string) => void
        }
      ).handleResizeStart = (event, direction) => {
        view.preserveAspectRatio = direction.includes('-')
        protoStart.call(view, event, direction)
      }

      return view
    }
  },
})

/**
 * 题目富文本编辑器（FR-TM-008）。
 *
 * 针对 K12 录题的取舍：
 * - 公式走 Tiptap 官方 Mathematics 扩展（KaTeX），节点内只存 data-latex，可反复回改；
 * - 图片走 Mock 媒体库，正文里只落 URL，不内联 base64；
 * - 标题、代码块、分割线与题干无关，关掉以精简工具栏与内容模型。
 */
const props = withDefaults(
  defineProps<{
    modelValue: string
    placeholder?: string
    minHeight?: number
    /** 当前学科，用于公式库默认筛选 */
    subject?: string
    /** 选项行等紧凑场景：隐藏按钮文案、降低最小高度 */
    compact?: boolean
  }>(),
  { placeholder: '请输入内容…', minHeight: 120, subject: '', compact: false },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  /** 内容变化（供父级置 dirty，替代原 textarea 的 @input） */
  change: []
}>()

/** 最近一次由编辑器发出的值：用于区分「外部传入」与「自己回传」，避免光标被重置 */
let lastEmitted = ''

/** 历史纯文本（可能含孤立的 < 等字符）必须先转义再交给编辑器，否则会被当成标签解析而丢失 */
function toEditorHtml(input: string): string {
  if (!input) return ''
  if (isRichContent(input)) return input
  const escaped = input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<p>${escaped.replace(/\n/g, '<br>')}</p>`
}

/* ===== 公式弹窗 ===== */
const mathOpen = ref(false)
/** 非空表示在编辑已有公式节点（值为节点位置），空表示新插入 */
const mathEditingPos = ref<number | null>(null)
/** 正在编辑的公式原本是块级还是行内 —— 决定弹窗开关初始态与确认时走哪个 update 命令 */
const mathEditingBlock = ref(false)
const mathInitialLatex = ref('')

function openMathInsert() {
  mathEditingPos.value = null
  mathEditingBlock.value = false
  mathInitialLatex.value = ''
  mathOpen.value = true
}

function openMathEdit(node: { attrs: { latex?: string } }, pos: number, block: boolean) {
  mathEditingPos.value = pos
  mathEditingBlock.value = block
  mathInitialLatex.value = node.attrs.latex ?? ''
  mathOpen.value = true
}

function onMathConfirm(latex: string, block: boolean) {
  const instance = editor.value
  if (!instance) return
  if (mathEditingPos.value !== null) {
    /* 显式带 pos：扩展在没给 pos 时回退到 selection.$from.pos，依赖选中态太脆 */
    const pos = mathEditingPos.value
    const ok = block
      ? instance.chain().focus().updateBlockMath({ latex, pos }).run()
      : instance.chain().focus().updateInlineMath({ latex, pos }).run()
    if (!ok) showToast('公式更新失败，请删除后重新插入', 'error')
  } else if (block) {
    instance.chain().focus().insertBlockMath({ latex }).run()
  } else {
    instance.chain().focus().insertInlineMath({ latex }).run()
  }
  mathOpen.value = false
}

/* ===== 图片：选库 / 传本地 / 粘贴 / 拖拽四条入口，统一走 uploadImage ===== */
const imageOpen = ref(false)
const MAX_IMAGE_MB = 2

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
}

async function uploadImage(file: File) {
  const instance = editor.value
  if (!instance) return
  if (!file.type.startsWith('image/')) {
    showToast('仅支持插入图片文件', 'error')
    return
  }
  if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
    showToast(`图片需小于 ${MAX_IMAGE_MB}MB，请压缩后重试`, 'error')
    return
  }
  try {
    const dataUrl = await readAsDataUrl(file)
    /* 落到 Mock 媒体库：正文里只引用返回的 URL，「多媒体资源」同时多出一条 image 记录 */
    const media = await uploadMedia({
      name: file.name || '题目插图.png',
      kind: 'image',
      subject: props.subject || '通用',
      knowledge: [],
      dataUrl,
      mime: file.type,
      sizeMb: Math.round((file.size / 1024 / 1024) * 100) / 100,
    })
    if (!media.url) {
      showToast('图片已上传但未取得地址，请重试', 'error')
      return
    }
    instance.chain().focus().setImage({ src: media.url, alt: media.name, title: media.name }).run()
    showToast('图片已插入，并存入图片资源', 'success')
  } catch {
    showToast('图片上传失败', 'error')
  }
}

function pickImage() {
  imageOpen.value = true
}

/** 从系统图片库选中一张：地址已由媒体库给出，直接落节点 */
function onPickMedia(media: OrgMedia) {
  imageOpen.value = false
  const instance = editor.value
  if (!instance || !media.url) return
  instance.chain().focus().setImage({ src: media.url, alt: media.name, title: media.name }).run()
  showToast('已插入图片', 'success')
}

/** 弹窗里选了本地文件：上传仍由这里独家负责，避免第二份大小 / 类型校验 */
function onPickFile(file: File) {
  imageOpen.value = false
  void uploadImage(file)
}

/* ===== 理科配图：选择类型 → 编辑器；AI 草稿先校验再进画布；双击节点二次编辑 ===== */
const drawSelectOpen = ref(false)
const aiDrawOpen = ref<DrawEditorType | null>(null)
interface DrawHostState {
  editorType: DrawEditorType
  mediaId?: number
  projectJson?: string
  molfileText?: string
  /** 非空表示在二次编辑既有节点（值为节点位置），保存后更新节点而不是新插 */
  editPos?: number
}
const drawHost = ref<DrawHostState | null>(null)

function openDrawSelect() {
  drawSelectOpen.value = true
}

function onDrawManual(type: DrawEditorType) {
  drawSelectOpen.value = false
  drawHost.value = { editorType: type }
}

function onDrawAi(type: DrawEditorType) {
  drawSelectOpen.value = false
  aiDrawOpen.value = type
}

function onDrawDraft(payload: { editorType: DrawEditorType; projectJson?: string; molfileText?: string }) {
  aiDrawOpen.value = null
  drawHost.value = { ...payload }
}

/** 宿主确认导出后：新图插入光标处；二次编辑则原位更新节点的 SVG */
function onDrawSaved(media: OrgMedia) {
  const instance = editor.value
  const host = drawHost.value
  drawHost.value = null
  if (!instance || !media.url) return
  if (host?.editPos != null) {
    instance
      .chain()
      .setNodeSelection(host.editPos)
      .updateAttributes('drawSvgImage', { svgUrl: media.url, alt: media.name })
      .run()
    showToast('配图已更新', 'success')
  } else {
    instance
      .chain()
      .focus()
      .insertContent({
        type: 'drawSvgImage',
        attrs: { mediaId: media.id, svgUrl: media.url, alt: media.name },
      })
      .run()
    showToast('理科配图已插入', 'success')
  }
}

/** draw-svg-image 节点双击：读 media 记录唤起对应编辑器（工程数据重开，不从 SVG 反解析） */
async function onDrawNodeEdit(mediaId: number, pos: number) {
  try {
    const media = await fetchMediaDetail(mediaId)
    drawHost.value = {
      editorType: media.editorType ?? 'fabric-general',
      mediaId: media.id,
      editPos: pos,
    }
  } catch {
    showToast('配图工程读取失败，无法二次编辑', 'error')
  }
}

/** 从剪贴板 / 拖拽事件里取图片文件 */
function imageFromDataTransfer(dt: DataTransfer | null): File | null {
  if (!dt) return null
  for (const file of Array.from(dt.files)) {
    if (file.type.startsWith('image/')) return file
  }
  return null
}

/* ===== 工具栏：默认收起，聚焦后展开 ===== */
const root = ref<HTMLElement | null>(null)
const focused = ref(false)

/**
 * 用冒泡版的 focusin / focusout，而不是 Tiptap 的 onFocus / onBlur：
 * 非冒泡版在「点工具栏按钮」时先是正文 blur —— 工具栏当场收起，按钮也就点不着了。
 */
function onFocusOut(event: FocusEvent) {
  const next = event.relatedTarget as Node | null
  /* 焦点仍落在组件内（比如工具栏按钮上）就保持展开 */
  if (!next || !root.value?.contains(next)) focused.value = false
}

/* ===== 编辑器实例 ===== */
/**
 * editor.isEmpty 是普通 getter、不是响应式的，直接放进 computed 只会求值一次，
 * 打完字占位文案也不会消失。这里用一次事务计数把它接进响应式系统。
 */
const revision = ref(0)

const editor = useEditor({
  content: toEditorHtml(props.modelValue),
  extensions: [
    StarterKit.configure({
      heading: false,
      codeBlock: false,
      horizontalRule: false,
      link: {
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
      },
    }),
    /* allowBase64: false —— 在写入侧就堵死内联 base64，保证正文只存 URL */
    ResizableImage.configure({ inline: false, allowBase64: false }),
    /* 理科静态配图节点：双击按 media_id 重开绘图编辑器二次编辑 */
    DrawSvgImage,
    Mathematics.configure({
      katexOptions: { throwOnError: false },
      inlineOptions: { onClick: (node, pos) => openMathEdit(node, pos, false) },
      blockOptions: { onClick: (node, pos) => openMathEdit(node, pos, true) },
    }),
  ],
  editorProps: {
    attributes: { class: 'rte-content' },
    handlePaste: (_view, event) => {
      const file = imageFromDataTransfer(event.clipboardData)
      if (!file) return false
      event.preventDefault()
      void uploadImage(file)
      return true
    },
    handleDrop: (_view, event) => {
      const file = imageFromDataTransfer((event as DragEvent).dataTransfer)
      if (!file) return false
      event.preventDefault()
      void uploadImage(file)
      return true
    },
  },
  /* 任何一次状态变化都要自增：外部 setContent({ emitUpdate: false }) 不触发 onUpdate，但会走事务 */
  onTransaction: () => {
    revision.value += 1
  },
  onUpdate: ({ editor: instance }) => {
    /* Tiptap 把空文档序列化为 <p></p>，归一到空串，使父级校验与存储口径一致 */
    const html = normalizeRichHtml(instance.getHTML())
    lastEmitted = html
    emit('update:modelValue', html)
    emit('change')
  },
})

/* 外部改值（切换题目、AI 草稿回填）时同步进编辑器；lastEmitted 比对避免自己回传导致光标重置 */
watch(
  () => props.modelValue,
  (value) => {
    const instance = editor.value
    if (!instance || value === lastEmitted) return
    instance.commands.setContent(toEditorHtml(value), { emitUpdate: false })
    lastEmitted = value
  },
)

onBeforeUnmount(() => {
  editor.value?.destroy()
})

/* 编辑器就绪后挂上 draw-svg-image 节点的双击回调（节点 NodeView 经 editor.storage 取） */
watch(
  () => editor.value,
  (instance) => {
    if (instance) {
      ;(instance.storage as unknown as Record<string, unknown>).drawSvgImageOnEdit = (mediaId: number, pos: number) => {
        void onDrawNodeEdit(mediaId, pos)
      }
    }
  },
  { immediate: true },
)

const isEmpty = computed(() => {
  void revision.value /* 显式依赖：见 revision 的注释 */
  return editor.value ? editor.value.isEmpty : !toPlainText(props.modelValue)
})

defineExpose({ isEmpty })
</script>

<template>
  <div
    ref="root"
    class="rte"
    :class="{ compact, focused }"
    @focusin="focused = true"
    @focusout="onFocusOut"
  >
    <!-- mousedown.prevent：工具栏按钮不该抢走正文的焦点与选区。少了它，Safari 上点按钮会先失焦
         → 工具栏当场收起 → 按钮还没收到 click 就没了。 -->
    <div v-if="editor" class="rte-toolbar" @mousedown.prevent>
      <button class="rte-btn is-text bold" :class="{ on: editor.isActive('bold') }" type="button" title="加粗" @click="editor.chain().focus().toggleBold().run()">B</button>
      <button class="rte-btn is-text italic" :class="{ on: editor.isActive('italic') }" type="button" title="斜体" @click="editor.chain().focus().toggleItalic().run()">I</button>
      <button class="rte-btn is-text underline" :class="{ on: editor.isActive('underline') }" type="button" title="下划线" @click="editor.chain().focus().toggleUnderline().run()">U</button>
      <button class="rte-btn is-text strike" :class="{ on: editor.isActive('strike') }" type="button" title="删除线" @click="editor.chain().focus().toggleStrike().run()">S</button>

      <span class="rte-sep" />

      <button class="rte-btn" :class="{ on: editor.isActive('bulletList') }" type="button" title="无序列表" @click="editor.chain().focus().toggleBulletList().run()">
        <AppIcon name="list-ul" :size="16" />
      </button>
      <button class="rte-btn" :class="{ on: editor.isActive('orderedList') }" type="button" title="有序列表" @click="editor.chain().focus().toggleOrderedList().run()">
        <AppIcon name="list-ol" :size="16" />
      </button>

      <span class="rte-sep" />

      <button class="rte-btn" type="button" title="插入 / 编辑公式" @click="openMathInsert">
        <AppIcon name="formula" :size="16" />
        <span class="rte-btn-text">公式</span>
      </button>
      <button class="rte-btn" type="button" title="插入图片（可从系统图片库选择，也可上传本地；也支持粘贴 / 拖入）" @click="pickImage">
        <AppIcon name="image" :size="16" />
        <span class="rte-btn-text">图片</span>
      </button>
      <button class="rte-btn" type="button" title="插入理科配图（几何图 / 化学装置图 / 分子结构式 / 简易示意图，可 AI 生成草稿；双击已插入配图可二次编辑）" @click="openDrawSelect">
        <AppIcon name="shapes" :size="16" />
        <span class="rte-btn-text">配图</span>
      </button>

      <span class="rte-sep" />

      <button class="rte-btn" type="button" title="清除格式" @click="editor.chain().focus().unsetAllMarks().run()">
        <AppIcon name="eraser" :size="16" />
      </button>
      <button class="rte-btn" type="button" title="撤销" :disabled="!editor.can().undo()" @click="editor.chain().focus().undo().run()">
        <AppIcon name="undo" :size="16" />
      </button>
      <button class="rte-btn" type="button" title="重做" :disabled="!editor.can().redo()" @click="editor.chain().focus().redo().run()">
        <AppIcon name="redo" :size="16" />
      </button>
    </div>

    <div class="rte-body-wrap" :style="{ minHeight: `${minHeight}px` }">
      <EditorContent v-if="editor" :editor="editor" class="rte-body" />
      <span v-if="isEmpty" class="rte-placeholder">{{ placeholder }}</span>
    </div>

    <FormulaPickerModal
      v-if="mathOpen"
      :subject="subject"
      :initial-latex="mathInitialLatex"
      :editing="mathEditingPos !== null"
      :initial-block="mathEditingBlock"
      @close="mathOpen = false"
      @confirm="onMathConfirm"
    />

    <MediaPickerModal
      v-if="imageOpen"
      :subject="subject"
      @close="imageOpen = false"
      @pick="onPickMedia"
      @pick-file="onPickFile"
    />

    <MediaDrawSelectDialog
      v-if="drawSelectOpen"
      @close="drawSelectOpen = false"
      @manual="onDrawManual"
      @ai="onDrawAi"
    />

    <AiDrawGenerateDialog
      v-if="aiDrawOpen"
      :initial-type="aiDrawOpen"
      @close="aiDrawOpen = null"
      @draft="onDrawDraft"
    />

    <DrawEditorHost
      v-if="drawHost"
      purpose="insert"
      :editor-type="drawHost.editorType"
      :media-id="drawHost.mediaId"
      :initial-project-json="drawHost.projectJson"
      :initial-molfile="drawHost.molfileText"
      :subject="subject"
      @close="drawHost = null"
      @saved="onDrawSaved"
    />
  </div>
</template>

<style scoped>
.rte {
  border: 1.5px solid var(--border);
  border-radius: 10px;
  background: #fff;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.rte:focus-within { border-color: var(--brand); box-shadow: 0 0 0 3px var(--brand-soft); }

.rte-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
  background: #fbfcfe;
  border-radius: 9px 9px 0 0;
  max-height: 120px;
  transition: max-height 0.16s ease, opacity 0.16s ease;
}
.compact .rte-toolbar { padding: 4px 6px; }
.compact .rte-btn-text { display: none; }
/* 默认收起，拿到焦点才展开：题干 + 4 个选项 + 解答 + 解析共 7 处编辑器，工具栏常显会糊成一片。
   用 max-height 过渡而不是 display:none，避免聚焦瞬间正文往下跳一下。 */
.rte:not(.focused) .rte-toolbar {
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
  border-bottom: none;
  opacity: 0;
  /* 只透明不够：收起时按钮不能被 Tab 键聚焦，故用 visibility 一并移出焦点顺序 */
  visibility: hidden;
  overflow: hidden;
}

.rte-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 8px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--ink-2);
  font-size: 13px;
  transition: background 0.15s, color 0.15s;
}
.rte-btn:hover:not(:disabled) { background: var(--brand-soft); color: var(--brand-deep); }
.rte-btn.on { background: var(--brand-soft); color: var(--brand-deep); }
.rte-btn:disabled { color: #c3cad8; cursor: not-allowed; }
/* B / I / U / S 用字面量而非图标，避免为每个字母画一套路径 */
.rte-btn.is-text { font-size: 14px; font-weight: 700; min-width: 30px; justify-content: center; }
.rte-btn.italic { font-style: italic; font-family: Georgia, serif; }
.rte-btn.underline { text-decoration: underline; }
.rte-btn.strike { text-decoration: line-through; }

.rte-sep { width: 1px; height: 18px; background: var(--border); margin: 0 5px; }

.rte-body-wrap { position: relative; }
.rte-placeholder {
  position: absolute;
  top: 11px;
  left: 13px;
  font-size: 13.5px;
  color: var(--sub);
  pointer-events: none;
}

.rte-body :deep(.rte-content) {
  min-height: inherit;
  padding: 11px 13px;
  font-size: 13.5px;
  line-height: 1.8;
  color: var(--ink);
  outline: none;
}
.rte-body :deep(.rte-content p) { margin: 0 0 6px; }
.rte-body :deep(.rte-content p:last-child) { margin-bottom: 0; }
.rte-body :deep(.rte-content ul),
.rte-body :deep(.rte-content ol) { padding-left: 22px; margin: 0 0 6px; }
.rte-body :deep(.rte-content ul) { list-style: disc; }
.rte-body :deep(.rte-content ol) { list-style: decimal; }
.rte-body :deep(.rte-content a) { color: var(--brand-deep); text-decoration: underline; }
/* 尺寸改由四角控制点表达；圆角保留，与只读渲染端 RichTextViewer 的外观保持一致 */
.rte-body :deep(.rte-content img) { max-width: 100%; height: auto; border-radius: 8px; }
.rte-body :deep(.rte-content blockquote) {
  border-left: 3px solid var(--border);
  padding-left: 10px;
  color: var(--sub);
  margin: 0 0 6px;
}

/* 公式节点：与正文基线对齐，并给出「可点击编辑」的暗示 */
.rte-body :deep([data-type='inline-math']) {
  display: inline-block;
  vertical-align: baseline;
  cursor: pointer;
  padding: 0 2px;
  border-radius: 4px;
}
.rte-body :deep([data-type='block-math']) {
  display: block;
  text-align: center;
  margin: 8px 0;
  padding: 6px 0;
  border-radius: 6px;
  cursor: pointer;
  background: #f7fafa;
}
.rte-body :deep([data-type='inline-math']:hover),
.rte-body :deep([data-type='block-math']:hover) { background: var(--brand-soft); }
/* LaTeX 非法时 KaTeX 的 errorColor 已足够显眼，这里只保证源码可见 */
.rte-body :deep(.inline-math-error),
.rte-body :deep(.block-math-error) { color: var(--danger); }

/* ===== 图片拖拽改尺寸 =====
   容器 / 包裹层 / 控制点都由 ResizableNodeView 现造，只有元素本身、不带任何样式，
   下面这组规则是这套拖拽「看得见、抓得住」的全部来源。 */
/* fit-content：容器默认 display:flex 是整行宽，图片右侧那片空白也会算进节点的可点区 ——
   点上去会选中图片而不是把光标放到旁边。收成图片自身的宽度就没这个问题。 */
.rte-body :deep([data-resize-container]) { width: fit-content; max-width: 100%; }
/* 包裹层是 flex item，默认 min-width:auto 会以图片原始宽度为下限 —— 超宽图会撑破正文。
   显式允许收缩，图片那侧的 max-width:100% 才能真的生效。 */
.rte-body :deep([data-resize-wrapper]) { min-width: 0; max-width: 100%; }

.rte-body :deep([data-resize-handle]) {
  width: 12px;
  height: 12px;
  /* 控制点默认贴在四角内侧，负边距把它挪成「压住角」，拖起来才符合直觉 */
  margin: -6px;
  border: 2px solid var(--brand);
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgb(0 0 0 / 18%);
  /* 一张图挂四个圆点太吵：选中或悬停时才显形（悬停时留着，是为了让人发现有这个功能） */
  opacity: 0;
  transition: opacity 0.12s;
}
.rte-body :deep([data-resize-container]:hover [data-resize-handle]),
.rte-body :deep([data-resize-container].ProseMirror-selectednode [data-resize-handle]) { opacity: 1; }

.rte-body :deep([data-resize-handle='top-left']),
.rte-body :deep([data-resize-handle='bottom-right']) { cursor: nwse-resize; }
.rte-body :deep([data-resize-handle='top-right']),
.rte-body :deep([data-resize-handle='bottom-left']) { cursor: nesw-resize; }
/* 边中点：水平边只改宽、垂直边只改高。库会把边把手内联成贯穿整条边的定位
   （left:0;right:0），用 auto margin 把 12px 圆点收回边的中点，而不是拉成一条药丸 */
.rte-body :deep([data-resize-handle='top']),
.rte-body :deep([data-resize-handle='bottom']) { margin: -6px auto; cursor: ns-resize; }
.rte-body :deep([data-resize-handle='left']),
.rte-body :deep([data-resize-handle='right']) { margin: auto -6px; cursor: ew-resize; }

/* 拖拽中锁住文本选择，否则快速划动会顺手把正文刷蓝 */
.rte-body :deep([data-resize-container][data-resize-state='true']) { user-select: none; }

/* 图片选中时不再画整圈描边：一是「插入的图片不要有边框」，二是四角控制点已是更明确的选中提示。
   比下面那条通用规则多一个属性选择器，特异性更高，不依赖书写顺序。 */
.rte-body :deep([data-resize-container].ProseMirror-selectednode) { outline: none; }

.rte-body :deep(.ProseMirror-selectednode) { outline: 2px solid var(--brand); border-radius: 4px; }
</style>
