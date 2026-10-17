<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { Mathematics } from '@tiptap/extension-mathematics'
import { FontFamily, FontSize, TextStyle } from '@tiptap/extension-text-style'
import { TableKit } from '@tiptap/extension-table'
import {
  isRichContent,
  normalizeRichHtml,
  toPlainText,
} from '@aiteach/shared'
import RteToolbar from './rte/RteToolbar.vue'
import RichMediaDialogs from './rte/RichMediaDialogs.vue'
import { useRichMediaPlumbing } from './rte/useRichMediaPlumbing'
import { ResizableImage } from './rte/resizableImage'
import { DrawSvgImage } from '@/tiptap-extensions/drawSvgImage'
import { TextDecoration } from '@/tiptap-extensions/textDecoration'
import { HexColor } from '@/tiptap-extensions/color'
import { PlainUnderline } from '@/tiptap-extensions/underline'
import { ListMarker } from '@/tiptap-extensions/listMarker'
import { Indent } from '@/tiptap-extensions/indent'
import { PaperTable, RowHeight } from '@/tiptap-extensions/tableSizing'
import { PaperTableCell, PaperTableHeader } from '@/tiptap-extensions/tableCellStyle'

/**
 * 题目富文本编辑器（FR-TM-008）。
 *
 * 针对 K12 录题的取舍：
 * - 公式走 Tiptap 官方 Mathematics 扩展（KaTeX），节点内只存 data-latex，可反复回改；
 * - 图片走 Mock 媒体库，正文里只落 URL，不内联 base64；
 * - 标题、代码块、分割线与题干无关，关掉以精简工具栏与内容模型。
 *
 * 可拖拽改尺寸的图片节点（ResizableImage）已抽到 ./rte/resizableImage.ts；
 * 公式 / 图片 / 配图三条媒体通路抽到 ./rte/useRichMediaPlumbing.ts，弹窗宿主抽到
 * ./rte/RichMediaDialogs.vue —— 备课文档编辑器（doc/DocEditor.vue）用同一份，
 * 两处的行为必须一致。
 */
const props = withDefaults(
  defineProps<{
    modelValue: string
    placeholder?: string
    minHeight?: number
    /** 当前学科，用于公式库默认筛选 */
    subject?: string
    /**
     * 简化工具栏：按钮只留图标，收起「字体 / 字号 / 表格 / 填空线…」这些文字标签。
     *
     * 录题页的正文框（题干 / 参考答案 / 解析 / 共用材料 / 选项 / 填空答案）一律带上。
     * 21 个按钮带上文案要 1100px 以上，题干框在 1000px 宽的版面里当场换行成两排，
     * 真正的正文反而被挤下去；只留图标后排数减半，按钮含义交给各自的 title 悬浮提示。
     *
     * 只影响工具栏外观，**不动正文高度** —— 高度由 `minHeight` 单独给（两者是正交的）。
     */
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

/* 填空下横线 / 括号两个按钮跟着工具栏走了（纯编辑器命令，不需要父级状态）：
   见 components/ui/rte/RteToolbar.vue。 */

/* ===== 工具栏：默认收起，聚焦后展开 ===== */
const root = ref<HTMLElement | null>(null)
const focused = ref(false)

/**
 * 用冒泡版的 focusin / focusout，而不是 Tiptap 的 onFocus / onBlur：
 * 非冒泡版在「点工具栏按钮」时先是正文 blur —— 工具栏当场收起，按钮也就点不着了。
 *
 * 第二种「还在自己身上」的情况：焦点进了工具栏弹层里的输入框（表格面板的列宽 / 行高）。
 * 弹层是 Teleport 到 body 的，`root.contains()` 认不出来，靠面板上的 data-rte-popover 标记兜住 ——
 * 少了这一条，点一下列宽输入框整条工具栏就收起来了（见 rte/RtePopover.vue）。
 */
function onFocusOut(event: FocusEvent) {
  const next = event.relatedTarget as HTMLElement | null
  if (next) {
    if (root.value?.contains(next)) return
    if (typeof next.closest === 'function' && next.closest('[data-rte-popover]')) return
  }
  focused.value = false
}

/* ===== 公式 / 图片 / 理科配图：与备课文档编辑器共用一份实现 =====
   三条通路的全部状态与处理都在 rte/useRichMediaPlumbing.ts（公式的两级输入、图片落库、
   配图画布），要开的五个弹窗由 rte/RichMediaDialogs.vue 渲染。这里只做两件本编辑器特有的事：

   - `isFocused` 把根容器的聚焦态带过去：点工具栏按钮时 ProseMirror 已经失焦，只看
     `editor.isFocused` 会把公式插到文档末尾而不是光标处；
   - 图片兜底名带「题目」二字，多媒体资源列表里一眼能认出是录题时传的。

   本组件在 `useEditor` 之前创建它：扩展的 `Mathematics.configure` 要引用 `openMathEdit`，
   而扩展的 options 必须先于实例传入 —— 这正是 composable 收 getter 而不是 Ref 的原因。 */
const media = useRichMediaPlumbing({
  getEditor: () => editor.value,
  getSubject: () => props.subject,
  isFocused: () => focused.value,
  imageName: '题目插图.png',
})

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
      /* 有序列表换成扩展版（多一个序号样式属性），同名扩展不能注册两次，故这里必须关掉 */
      orderedList: false,
      /* 下划线也换成扩展版：原版会把 `text-decoration: underline wavy` 一起解析成单下划线，
         波浪线/双下划线因此会多出一条实线（见 tiptap-extensions/underline.ts） */
      underline: false,
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
      inlineOptions: { onClick: (node, pos) => media.openMathEdit(node, pos, false) },
      blockOptions: { onClick: (node, pos) => media.openMathEdit(node, pos, true) },
    }),
    /* ===== 试卷排版：字体 / 字号 / 颜色 / 下划线样式 / 序号 / 缩进 / 表格 =====
       字体、字号、颜色、波浪线都落在**同一个** textStyle span 上（Tiptap 的 setMark 会合并 attrs），
       最终是 `<span style="font-family: …; font-size: 12pt; color: …; text-decoration: underline wavy">`。 */
    TextStyle,
    FontFamily,
    FontSize,
    /* 字色换成扩展版：官方 Color 读回来的是浏览器归一化后的 rgb(...)，
       与工具栏色板的 #hex 对不上，也会让 Word 导出认不出（见 tiptap-extensions/color.ts） */
    HexColor,
    TextDecoration,
    PlainUnderline,
    ListMarker,
    Indent,
    /* 表格：四件套全部换成本仓库的扩展版 —— table 多出整表宽度（并接管 TableView 以挂住宽度 / 行高
       的拖拽手柄）、tableRow 多出行高、tableCell 与 tableHeader 多出底纹。
       同名扩展不能注册两次 —— 换掉哪个就得在 kit 里关掉哪个。
       resizable 开列宽拖拽；最后一列不给拖（拖它只改变整表宽度，与整表手柄撞车，容易误操作） */
    TableKit.configure({ table: false, tableRow: false, tableCell: false, tableHeader: false }),
    PaperTable.configure({ resizable: true, lastColumnResizable: false }),
    RowHeight,
    PaperTableCell,
    PaperTableHeader,
  ],
  editorProps: {
    attributes: { class: 'rte-content' },
    handlePaste: (_view, event) => {
      const file = media.imageFromDataTransfer(event.clipboardData)
      if (!file) return false
      event.preventDefault()
      void media.uploadImage(file)
      return true
    },
    handleDrop: (_view, event) => {
      const file = media.imageFromDataTransfer((event as DragEvent).dataTransfer)
      if (!file) return false
      event.preventDefault()
      void media.uploadImage(file)
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
  (instance) => media.attachEditor(instance),
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
    <!-- 工具栏自身在 rte/RteToolbar.vue 里（按钮样式、弹层都与它同处一个组件）；
         公式 / 图片 / 配图三个按钮要开的弹窗由 rte/RichMediaDialogs.vue 渲染，所以由它 emit 回来 -->
    <RteToolbar
      v-if="editor"
      :editor="editor"
      :compact="compact"
      @math="media.openMathInsert"
      @image="media.pickImage"
      @draw="media.openDrawSelect"
    />

    <div class="rte-body-wrap" :style="{ minHeight: `${minHeight}px` }">
      <EditorContent v-if="editor" :editor="editor" class="rte-body" />
      <!-- 获得焦点（点进来 / Tab 进来）即隐去占位文案：占位语挺长，光标已经落在这里了还挡着视线，
           而它的作用（「这块是干什么的」）只在没进来之前才需要。所有用到本组件的地方共用这一条 -->
      <span v-if="isEmpty && !focused" class="rte-placeholder">{{ placeholder }}</span>
    </div>

    <!-- 公式（两级输入）/ 图片 / 理科配图的五个弹窗统一由它渲染 ——
         与备课文档编辑器用同一个宿主，两处的弹窗行为不会各长一套 -->
    <RichMediaDialogs v-if="editor" :media="media" :editor="editor" :subject="subject" />
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

/* 工具栏的展开态样式（flex / 按钮 / 弹层）都在 RteToolbar.vue 里；
   这里只留「收起」—— 它依赖本组件自己的 .focused，且作用在子组件的根元素上（它带本组件的
   scope 属性，所以这条选择器仍然命中）。
   默认收起、拿到焦点才展开：题干 + 4 个选项 + 解答 + 解析共 7 处编辑器，工具栏常显会糊成一片。
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

.rte-body-wrap { position: relative; }
.rte-placeholder {
  position: absolute;
  top: 11px;
  left: 13px;
  font-size: 13.5px;
  color: var(--sub);
  pointer-events: none;
}

/* 正文的**观感**（段落间距、列表、链接、图片、引用块、表格、公式节点）统一在
   styles/richtext-content.css 里 —— 备课文档编辑器与只读渲染端用的是同一份，避免两处各长一套。
   这里只留录题编辑器特有的「外壳」：内边距、正文字号与行高。 */
.rte-body :deep(.rte-content) {
  min-height: inherit;
  padding: 11px 13px;
  font-size: 13.5px;
  line-height: 1.8;
  color: var(--ink);
  outline: none;
}

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
