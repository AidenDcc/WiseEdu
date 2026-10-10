<script setup lang="ts">
/**
 * 题目编辑器的工具栏。从 RichTextEditor.vue 里整段搬出来（那里只剩「收起 / 展开」这一条样式，
 * 因为它依赖父级的 `.rte:not(.focused)`），并按需求补上六组新控件：
 * 字体 / 字号 / 颜色 / 下划线样式 / 有序列表序号 / 缩进 / 表格。
 *
 * 边界划在哪里：**只碰编辑器内容的动作留在本组件**（加粗、插填空线、插表格、改列宽……），
 * 需要弹窗或媒体库的动作（公式选择器、图片库、绘图宿主）通过 emits 交回 RichTextEditor ——
 * 那些状态的宿主是父组件，搬进来就得连弹窗一起搬。
 *
 * 所有按钮都在 `.rte-toolbar` 的 `@mousedown.prevent` 之下：点按钮不抢正文焦点与选区，
 * 弹层里的面板另有一份（见 RtePopover.vue）。
 */
import { computed, ref } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import { ANSWER_PAREN, AppIcon, FILL_BLANK, showToast } from '@aiteach/shared'
import {
  COL_WIDTH_MAX,
  COL_WIDTH_MIN,
  ROW_HEIGHT_MAX,
  ROW_HEIGHT_MIN,
  TABLE_WIDTH_MAX,
  TABLE_WIDTH_MIN,
  findTableAt,
} from '@/tiptap-extensions/tableSizing'
import type { UnderlineStyle } from '@/tiptap-extensions/textDecoration'
import RtePopover from './RtePopover.vue'
import {
  RTE_BORDER_COLORS,
  RTE_CELL_BACKGROUNDS,
  RTE_COLORS,
  RTE_FONT_FAMILIES,
  RTE_FONT_SIZES,
  RTE_LIST_MARKERS,
  RTE_TABLE_GRID_COLS,
  RTE_TABLE_GRID_ROWS,
  RTE_UNDERLINE_STYLES,
  type RteValueOption,
} from './rte-options'

const props = defineProps<{
  editor: Editor
  /** 选项行等紧凑场景：按钮文案收起，只留图标（与父级 .rte.compact 同源） */
  compact?: boolean
}>()

const emit = defineEmits<{
  math: []
  image: []
  draw: []
}>()

/* ===== 当前值 =====
   都读 editor 的实时状态：Tiptap 的 `editor.state` 在本仓库是响应式的（@tiptap/vue-3 的
   customRef），所以模板里读到的值会随光标移动更新，不需要额外的 revision 计数。 */
const textStyle = computed(
  () =>
    props.editor.getAttributes('textStyle') as {
      fontFamily?: string | null
      fontSize?: string | null
      color?: string | null
      /** 波浪线 / 双重下划线（'wavy' | 'double'），单下划线走的是 underline mark 而不是它 */
      textDecoration?: string | null
    },
)
const currentFont = computed(() =>
  RTE_FONT_FAMILIES.find((item) => item.value && item.value === textStyle.value.fontFamily),
)
const currentSize = computed(() =>
  RTE_FONT_SIZES.find((item) => item.value && item.value === textStyle.value.fontSize),
)
/** 颜色按钮下面那道横杠的颜色：没设过色就是纯黑 */
const currentColor = computed(() => textStyle.value.color || '#000000')

function isFontActive(item: RteValueOption): boolean {
  return item.value ? textStyle.value.fontFamily === item.value : !textStyle.value.fontFamily
}
function isSizeActive(item: RteValueOption): boolean {
  return item.value ? textStyle.value.fontSize === item.value : !textStyle.value.fontSize
}

function setFontFamily(value: string | null) {
  const chain = props.editor.chain().focus()
  if (value) chain.setFontFamily(value).run()
  else chain.unsetFontFamily().run()
}

function setFontSize(value: string | null) {
  const chain = props.editor.chain().focus()
  if (value) chain.setFontSize(value).run()
  else chain.unsetFontSize().run()
}

function setColor(value: string | null) {
  const chain = props.editor.chain().focus()
  if (value) chain.setColor(value).run()
  else chain.unsetColor().run()
}

/** 与字体 / 字号同一套写法：值为 null 的「默认」档看的是「有没有设过」，不是「等于某个颜色」 */
function isColorActive(item: RteValueOption): boolean {
  return item.value ? textStyle.value.color === item.value : !textStyle.value.color
}

function setUnderline(style: UnderlineStyle) {
  props.editor.chain().focus().setUnderlineStyle(style).run()
}

/**
 * U 按钮 = 单下划线的唯一入口（下拉菜单里不再放「单下划线」那一档）。
 *
 * 判断「当前有没有下划线」要看**两处**：单下划线是 underline mark，波浪线 / 双重下划线是
 * textStyle 上的 text-decoration。只看 mark 的话，光标停在波浪线上时按 U 会被判成「没下划线」，
 * 于是又加一层 `<u>` —— 实线与波浪线叠在一起，看着像下划线没去掉（这个 bug 真出现过）。
 * 两个方向都指向「清掉」（setUnderlineStyle('none') 会一并撤掉 mark 与 text-decoration）。
 */
function toggleUnderline() {
  const hasUnderline = props.editor.isActive('underline') || !!textStyle.value.textDecoration
  setUnderline(hasUnderline ? 'none' : 'single')
}

/* ===== 有序列表序号 =====
   值有三种来源：自定义 counter-style（listStyle）/ 原生 type（1 A a I i）/ 都没设（默认 1.）。 */
const listMarker = computed(() => {
  const attrs = props.editor.getAttributes('orderedList') as { type?: string | null; listStyle?: string | null }
  return attrs.listStyle ?? attrs.type ?? '1'
})
function isMarkerActive(item: { type?: string; style?: string }): boolean {
  return (item.style ?? item.type) === listMarker.value
}

/* ===== 缩进 =====
   在列表里缩进的承载者是 `li`（序号跟着它一起右移，见 tiptap-extensions/indent.ts），
   段落上那份始终是 0 —— 只问段落的话，列表里按了「增加缩进」菜单上的数字不动、
   「减少缩进」还会被判成「已经在 0 级」而置灰。所以先看列表项。 */
const indentLevel = computed(() => {
  if (props.editor.isActive('listItem')) {
    return Number((props.editor.getAttributes('listItem') as { indentLevel?: number }).indentLevel ?? 0)
  }
  return Number((props.editor.getAttributes('paragraph') as { indentLevel?: number }).indentLevel ?? 0)
})
const firstLineIndent = computed(
  () => Boolean((props.editor.getAttributes('paragraph') as { firstLineIndent?: boolean }).firstLineIndent),
)

/* ===== 表格 ===== */
const inTable = computed(() => props.editor.isActive('table'))
/** 插入表格的网格选择器：当前悬停到第几行第几列 */
const gridHover = ref<{ row: number; col: number } | null>(null)
/** 面板里的整表宽度 / 列宽 / 行高输入框（px），打开面板时回填 */
const tableWidth = ref('')
const colWidth = ref('')
const rowHeight = ref('')

function insertTable(row: number, col: number, close: () => void) {
  props.editor.chain().focus().insertTable({ rows: row, cols: col, withHeaderRow: true }).run()
  gridHover.value = null
  close()
}

/* 编辑器里三个尺寸的当前值（px，null = 没设）。回填输入框、以及「用户到底改没改」的比对共用这一份口径：
   两边各写一遍的话，colwidth 这种「数组取本列第一格」的细节迟早会漂移。
   单元格的 colwidth 是数组（合并单元格占多列），取本列那一格。 */
function currentTableWidth(): number | null {
  return (props.editor.getAttributes('table') as { tableWidth?: number | null }).tableWidth ?? null
}
function currentColWidth(): number | null {
  const cell = {
    ...(props.editor.getAttributes('tableCell') as { colwidth?: number[] | null }),
    ...(props.editor.getAttributes('tableHeader') as { colwidth?: number[] | null }),
  }
  return cell.colwidth?.[0] ?? null
}
function currentRowHeight(): number | null {
  return (props.editor.getAttributes('tableRow') as { rowHeight?: number | null }).rowHeight ?? null
}

/** 打开表格面板前回填尺寸。空串而不是 '0'：没设过的宽度输入框留空、placeholder 提示「铺满整行」 */
function syncTableInputs() {
  tableWidth.value = currentTableWidth()?.toString() ?? ''
  colWidth.value = currentColWidth()?.toString() ?? ''
  rowHeight.value = currentRowHeight()?.toString() ?? ''
}

/**
 * 打开表格面板那一刻的选区位置（表内某个文本位置）。
 *
 * 面板里的输入框会把正文的焦点抢走，等到提交时，「当前选区」已经不可信 —— 有三处会动它：
 * 输入框获得 DOM 焦点、命令串自己的 `.focus()`（编辑器已失焦时它走 delayedFocus，下一帧把焦点
 * 抢回正文、浏览器顺手恢复 DOM 选区）、以及面板里删行删列改过的文档。所以尺寸与边框按**位置**
 * 提交：命令都收一个可选的 `pos`（见 tableSizing.ts 的 resolveTarget），传进这里的锚点，
 * 命令就落在用户打开面板时看着的那张表上。与 RichTextEditor 里公式弹窗记 `mathEditingPos` 同理 ——
 * 依赖选中态太脆。
 *
 * 底纹不走锚点：它的语义是「按选区的形状铺」（框选一片就是一片），而锚点只是一个文本位置，
 * 拿它提交会把框选压成一格。
 */
const tableAnchor = ref<number | null>(null)

function captureTableAnchor() {
  tableAnchor.value = props.editor.state.selection.from
}

/** 锚点用前验一次：面板里能删行删列，位置可能已经不在表里了；那就退回当前选区（undefined） */
function anchorPosition(): number | undefined {
  const pos = tableAnchor.value
  if (pos === null) return undefined
  const { doc } = props.editor.state
  if (pos > doc.content.size) return undefined
  return findTableAt(doc.resolve(pos)) ? pos : undefined
}

/* 上下限都要在这里拦一道：`<input type="number">` 的 max 只挡表单提交，手输照样进得来；
   而超范围的尺寸（比如 3000px 的列宽）会被富文本净化的白名单整条剥掉 —— 不拦就等于
   「输进去的值看着生效了，存完再打开就没了」。命令内部也夹了一道，这里是为了当场给反馈。 */
function readSize(input: string, label: string, min: number, max: number): number | null {
  const value = Number(input)
  if (!Number.isFinite(value) || value < min) {
    showToast(`请输入不小于 ${min}px 的${label}`, 'error')
    return null
  }
  if (value > max) {
    showToast(`${label}最大 ${max}px`, 'error')
    return null
  }
  return value
}

/**
 * 尺寸输入框**失焦即生效**（面板上不再有「应用」按钮）。
 *
 * 两个收口，缺一不可：
 * - `@blur`：在几个输入框之间跳（宽度 → 列宽 → 行高）时生效；
 * - 面板关闭时的兜底提交（见 RtePopover 的 `@close`）：面板上的 mousedown 是 `prevent` 的
 *   （为的是保住正文的选区与焦点），点面板里的色块、或点「表格」按钮收面板，**焦点根本没动**，
 *   blur 永远不来 —— 只挂 blur 就会出现「输完宽度顺手点个色块，宽度没了」。
 *
 * 两个口都会调到这里，所以入口先比一次「输入框里的文本与编辑器现值是否一致」：一致就直接返回。
 * 光靠底下命令自己的「值没变就 return false」不够 —— 它们前面的 `.focus()` 是立即生效的，
 * 收面板时会把焦点从用户刚点到的地方抢回正文。
 */
function commitSize(input: string, current: number | null, label: string, min: number, max: number, apply: (value: number) => boolean) {
  if (input.trim() === (current?.toString() ?? '')) return
  /* 空输入 = 用户清空了但没打算改：回填现值，既不弹错也不动文档。
     清空宽度确实有「铺满整行」的意思，但那有专门的按钮，不能让「清空输入框」这种
     半途动作把表格宽度悄悄改掉 */
  if (!input.trim()) {
    syncTableInputs()
    return
  }
  const value = readSize(input, label, min, max)
  if (value === null) {
    /* 值不合法就当场回填：输入框不会留着一个「看着生效了其实没进去」的数 */
    syncTableInputs()
    return
  }
  /* 改完按**真实值**回填：命令内部还夹了一道上下限（比如列宽最小 25px），输进去的数被夹过的
     话，输入框得当场显示夹完的结果，不能留着一个没进去的数 */
  if (apply(value)) {
    syncTableInputs()
    return
  }
  /* 走到这儿只剩一种可能：找不到目标表 —— 打开面板时记下的锚点已经不在表里（面板里删过行列），
     当前选区也不在表里。这时必须说一声，否则又是「输进去没反应」，用户只能干瞪眼 */
  if (anchorPosition() === undefined && !inTable.value) {
    showToast('请先把光标放回表格里，再改尺寸', 'error')
  }
}

function commitTableWidth() {
  commitSize(tableWidth.value, currentTableWidth(), '表格宽度', TABLE_WIDTH_MIN, TABLE_WIDTH_MAX, (width) =>
    props.editor.chain().focus().setTableWidth(width, anchorPosition()).run(),
  )
}

/** 铺满整行 = 清掉整表宽度，回到编辑器 / 只读端 / 导出端的 `width: 100%` 那一条 */
function fillTableWidth() {
  tableWidth.value = ''
  if (props.editor.chain().focus().setTableWidth(null, anchorPosition()).run()) syncTableInputs()
}

function commitColumnWidth() {
  commitSize(colWidth.value, currentColWidth(), '列宽', COL_WIDTH_MIN, COL_WIDTH_MAX, (width) =>
    props.editor.chain().focus().setColumnWidth(width, anchorPosition()).run(),
  )
}

function commitRowHeight() {
  commitSize(rowHeight.value, currentRowHeight(), '行高', ROW_HEIGHT_MIN, ROW_HEIGHT_MAX, (height) =>
    props.editor.chain().focus().setRowHeight(height, anchorPosition()).run(),
  )
}

/** 面板收起时把三个输入框都提交一遍：没改过的当场返回，改过的补上 */
function commitTableSizes() {
  commitTableWidth()
  commitColumnWidth()
  commitRowHeight()
}

/**
 * 点「表格」按钮：打开时记下位置并回填尺寸，收起时由 popover 的 `@close` 兜底提交尺寸。
 *
 * 顺序是给那次兜底提交让路的 —— 先 `toggle()`（收起会触发提交，得让它拿到用户刚输入的值），
 * 再回填；反过来的话回填先把输入抹掉，那次提交就成了空提交。
 * 锚点只在**打开**那一下记：收起时记，记到的是提交之后（被 `.focus()` 动过）的选区。
 */
function onTableTrigger(open: boolean, toggle: () => void) {
  const opening = !open
  toggle()
  if (opening) captureTableAnchor()
  syncTableInputs()
}

/* ===== 单元格底纹 / 表格边框颜色 =====
   两个属性都直接读编辑器当前值（computed 随光标移动更新），不必像尺寸那样在打开面板时回填。
   td 与 th 要各问一次：表头行是 tableHeader 节点，Tiptap 不会把两者的属性互相映射。 */
function currentCellAttr(name: 'background' | 'borderColor'): string | null {
  const attrs = {
    ...(props.editor.getAttributes('tableCell') as Record<string, string | null>),
    ...(props.editor.getAttributes('tableHeader') as Record<string, string | null>),
  }
  return attrs[name] ?? null
}
const cellBackground = computed(() => currentCellAttr('background'))
const tableBorderColor = computed(() => currentCellAttr('borderColor'))

/** 色块的选中态：值为 null 的那一档看的是「有没有设过」，不是「等于某个颜色」 */
function isSwatchActive(current: string | null, item: RteValueOption): boolean {
  return item.value ? current === item.value : !current
}

function applyCellBackground(item: RteValueOption) {
  /* 底纹按选区的形状铺（框选一片就是一片），所以不带锚点 —— 见 tableAnchor 的注释 */
  props.editor.chain().focus().setCellBackground(item.value).run()
}

/* 边框整表铺，与尺寸同一套锚点提交 */
function applyBorderColor(item: RteValueOption) {
  props.editor.chain().focus().setTableBorderColor(item.value, anchorPosition()).run()
}

/* ===== 填空下横线 / 括号 =====
   与录题页共用一个口径（常量在共享层）：插的是**纯文本字符**，不带 class ——
   sanitizeRichHtml 会剥掉 class，预览与导出端都会变样。 */
function insertFillBlank() {
  props.editor.chain().focus().insertContent(FILL_BLANK).run()
}

function insertParen() {
  const instance = props.editor
  /* 先记插入点：插入后选区会落到括号右侧，光标得手工挪回两个全角空格之间,
     否则点一下「括号」再打字会跑到括号外面去 */
  const from = instance.state.selection.from
  instance.chain().focus().insertContent(ANSWER_PAREN).run()
  instance.commands.setTextSelection(from + 2)
}
</script>

<template>
  <div class="rte-toolbar" :class="{ compact }" @mousedown.prevent>
    <button class="rte-btn is-text bold" :class="{ on: editor.isActive('bold') }" type="button" title="加粗" @click="editor.chain().focus().toggleBold().run()">B</button>
    <button class="rte-btn is-text italic" :class="{ on: editor.isActive('italic') }" type="button" title="斜体" @click="editor.chain().focus().toggleItalic().run()">I</button>
    <button
      class="rte-btn is-text underline"
      :class="{ on: editor.isActive('underline') || !!textStyle.textDecoration }"
      type="button"
      :title="editor.isActive('underline') || textStyle.textDecoration ? '取消下划线' : '下划线'"
      @click="toggleUnderline"
    >U</button>
    <button class="rte-btn is-text strike" :class="{ on: editor.isActive('strike') }" type="button" title="删除线" @click="editor.chain().focus().toggleStrike().run()">S</button>

    <!-- 下划线样式的入口：U 按钮是单下划线（有下划线时再点一下取消），这个小箭头只开波浪线 / 双重下划线 -->
    <RtePopover :width="148">
      <template #trigger="{ open, toggle }">
        <button class="rte-btn caret" :class="{ on: open }" type="button" title="下划线样式（波浪线 / 双重下划线）" @click="toggle">
          <AppIcon name="chevron-down" :size="13" />
        </button>
      </template>
      <template #default="{ close }">
        <button
          v-for="item in RTE_UNDERLINE_STYLES"
          :key="item.key"
          class="rte-menu-item"
          type="button"
          @click="setUnderline(item.key); close()"
        >
          <span class="rte-underline-preview" :class="`u-${item.key}`">{{ item.label }}</span>
        </button>
      </template>
    </RtePopover>

    <span class="rte-sep" />

    <!-- 字体 -->
    <RtePopover :width="168">
      <template #trigger="{ toggle }">
        <button class="rte-btn" type="button" :title="`字体：${currentFont?.label ?? '默认'}`" @click="toggle">
          <AppIcon name="font" :size="16" />
          <span class="rte-btn-text">{{ currentFont?.label ?? '字体' }}</span>
        </button>
      </template>
      <template #default="{ close }">
        <button
          v-for="item in RTE_FONT_FAMILIES"
          :key="item.key"
          class="rte-menu-item"
          :class="{ on: isFontActive(item) }"
          type="button"
          :style="item.value ? { fontFamily: item.value } : undefined"
          @click="setFontFamily(item.value); close()"
        >{{ item.label }}</button>
      </template>
    </RtePopover>

    <!-- 字号 -->
    <RtePopover :width="160">
      <template #trigger="{ toggle }">
        <button class="rte-btn" type="button" :title="`字号：${currentSize?.label ?? '默认'}`" @click="toggle">
          <AppIcon name="font-size" :size="16" />
          <span class="rte-btn-text">{{ currentSize?.label.split(' ')[0] ?? '字号' }}</span>
        </button>
      </template>
      <template #default="{ close }">
        <button
          v-for="item in RTE_FONT_SIZES"
          :key="item.key"
          class="rte-menu-item"
          :class="{ on: isSizeActive(item) }"
          type="button"
          @click="setFontSize(item.value); close()"
        >{{ item.label }}</button>
      </template>
    </RtePopover>

    <!-- 颜色：固定色板，不做任意取色器 -->
    <RtePopover :width="132">
      <template #trigger="{ toggle }">
        <button class="rte-btn" type="button" :title="`字体颜色：${currentColor}`" @click="toggle">
          <span class="rte-color-glyph">A<i :style="{ background: currentColor }" /></span>
        </button>
      </template>
      <template #default="{ close }">
        <div class="rte-swatches">
          <button
            v-for="item in RTE_COLORS"
            :key="item.key"
            class="rte-swatch"
            :class="{ on: isColorActive(item), 'is-default': !item.value }"
            type="button"
            :title="item.label"
            :style="item.value ? { background: item.value } : undefined"
            @click="setColor(item.value); close()"
          />
        </div>
      </template>
    </RtePopover>

    <span class="rte-sep" />

    <button class="rte-btn" :class="{ on: editor.isActive('bulletList') }" type="button" title="无序列表" @click="editor.chain().focus().toggleBulletList().run()">
      <AppIcon name="list-ul" :size="16" />
    </button>
    <button class="rte-btn" :class="{ on: editor.isActive('orderedList') }" type="button" title="有序列表" @click="editor.chain().focus().toggleOrderedList().run()">
      <AppIcon name="list-ol" :size="16" />
    </button>

    <!-- 有序列表序号：不在列表里点选会先建一个列表。
         每个选项都是**真的 `<ol>`**（list-style-type 取自共享层 RICH_LIST_MARKERS.css），
         与正文同源 —— 看到 ①②③ 就是插进去 ①②③，不必去猜标签上的「①」到底长什么样。
         预览是**横向**的三格（`start=1/2/3` 各一格），也就是这种序号的 1→3 连排：竖着排三行时
         八种要滚一屏、还看不出「连排」这件事。注意**不能**把承载序号的 `<ol>` 改成 flex —
         列表标记只画在 display: list-item 的元素上，一 flex 标记就整个消失（预览会变成三个空块）。 -->
    <RtePopover :width="180">
      <template #trigger="{ open, toggle }">
        <button class="rte-btn caret" :class="{ on: open || editor.isActive('orderedList') }" type="button" title="有序列表序号样式" @click="toggle">
          <AppIcon name="chevron-down" :size="13" />
        </button>
      </template>
      <template #default="{ close }">
        <div class="rte-markers">
          <button
            v-for="item in RTE_LIST_MARKERS"
            :key="item.key"
            class="rte-marker-option"
            :class="{ on: isMarkerActive(item) }"
            type="button"
            :title="`序号样式：${item.label}`"
            :aria-label="`序号样式：${item.label}`"
            @click="editor.chain().focus().setListMarker(item.key).run(); close()"
          >
            <ol
              v-for="n in 3"
              :key="n"
              class="rte-marker-preview"
              :style="{ listStyleType: item.css }"
              :start="n"
              aria-hidden="true"
            >
              <li>&nbsp;</li>
            </ol>
          </button>
        </div>
      </template>
    </RtePopover>

    <!-- 缩进：面板不随点击收起，连点几下加缩进比每级都重开一次省事 -->
    <RtePopover :width="168">
      <template #trigger="{ toggle }">
        <button class="rte-btn" :class="{ on: indentLevel > 0 || firstLineIndent }" type="button" :title="`缩进（当前 ${indentLevel} 级${firstLineIndent ? '，首行缩进' : ''}）`" @click="toggle">
          <AppIcon name="indent" :size="16" />
          <span class="rte-btn-text">缩进</span>
        </button>
      </template>
      <template #default>
        <button class="rte-menu-item" type="button" @click="editor.chain().focus().indent().run()">
          <AppIcon name="indent" :size="15" />
          <span>增加缩进</span>
          <span class="rte-menu-hint">{{ indentLevel }}</span>
        </button>
        <button class="rte-menu-item" type="button" :disabled="indentLevel === 0" @click="editor.chain().focus().outdent().run()">
          <AppIcon name="outdent" :size="15" />
          <span>减少缩进</span>
        </button>
        <button class="rte-menu-item" type="button" :class="{ on: firstLineIndent }" @click="editor.chain().focus().toggleFirstLineIndent().run()">
          <AppIcon name="first-line" :size="15" />
          <span>首行缩进两格</span>
        </button>
      </template>
    </RtePopover>

    <!-- 表格：不在表格里是「插入」的网格选择器，在表格里是行列与尺寸的面板。
         `@close` 是尺寸输入的兜底提交：面板上的 mousedown 是 prevent 的，点面板里的色块或点这个
         按钮收面板都不会让输入框失焦（见 commitSize 与 onTableTrigger 的注释）。 -->
    <RtePopover :width="inTable ? 252 : 196" @close="commitTableSizes">
      <template #trigger="{ open, toggle }">
        <button class="rte-btn" :class="{ on: inTable || open }" type="button" :title="inTable ? '表格操作' : '插入表格'" @click="onTableTrigger(open, toggle)">
          <AppIcon name="table" :size="16" />
          <span class="rte-btn-text">表格</span>
        </button>
      </template>
      <template #default="{ close }">
        <!-- 面板里任何一处按下（色块、插行删列…）都先把没提交的尺寸落下去：那个 mousedown 是
             prevent 的，输入框的 blur 永远不来，不补这一下就会「输完宽度顺手点个色块，宽度没了」。
             输入框自己 @mousedown.stop，所以正在编辑的字段不会被这里截胡。 -->
        <div @mousedown="commitTableSizes()">
          <template v-if="!inTable">
            <div class="rte-grid" @mouseleave="gridHover = null">
              <div v-for="row in RTE_TABLE_GRID_ROWS" :key="row" class="rte-grid-row">
                <span
                  v-for="col in RTE_TABLE_GRID_COLS"
                  :key="col"
                  class="rte-grid-cell"
                  :class="{ on: !!gridHover && row <= gridHover.row && col <= gridHover.col }"
                  @mouseenter="gridHover = { row, col }"
                  @click="insertTable(row, col, close)"
                />
              </div>
            </div>
            <div class="rte-grid-hint">{{ gridHover ? `${gridHover.row} 行 × ${gridHover.col} 列` : '点选行列数' }}</div>
            </template>

          <template v-else>
            <div class="rte-panel-title">行</div>
            <div class="rte-panel-row">
              <button class="rte-mini" type="button" @click="editor.chain().focus().addRowBefore().run()">上方插行</button>
              <button class="rte-mini" type="button" @click="editor.chain().focus().addRowAfter().run()">下方插行</button>
              <button class="rte-mini" type="button" @click="editor.chain().focus().deleteRow().run()">删除行</button>
            </div>

            <div class="rte-panel-title">列</div>
            <div class="rte-panel-row">
              <button class="rte-mini" type="button" @click="editor.chain().focus().addColumnBefore().run()">左侧插列</button>
              <button class="rte-mini" type="button" @click="editor.chain().focus().addColumnAfter().run()">右侧插列</button>
              <button class="rte-mini" type="button" @click="editor.chain().focus().deleteColumn().run()">删除列</button>
            </div>

            <div class="rte-panel-title">单元格</div>
            <div class="rte-panel-row">
              <button class="rte-mini" type="button" @click="editor.chain().focus().mergeCells().run()">合并</button>
              <button class="rte-mini" type="button" @click="editor.chain().focus().splitCell().run()">拆分</button>
              <button class="rte-mini" type="button" :class="{ on: editor.isActive('tableHeader') }" @click="editor.chain().focus().toggleHeaderRow().run()">表头行</button>
            </div>

            <div class="rte-panel-title">单元格底纹</div>
            <!-- 与字色色板同一套 .rte-swatch：一排横向铺开，不点不收（连点几格比每格重开一次省事）。
                 整表上色用鼠标从一角拖到对角框选全部单元格，再点色块 —— 与 Word 里拖选整表同一种手法，
                 不再单给一个「全选表格」按钮：那是为「整表背景」这个属性打的补丁，而底纹本来就属于单元格。
                 白色与「无底纹」并存：前者把表头格也压成纯白，后者让它掉回 CSS 里的浅灰 -->
            <div class="rte-swatch-row">
              <button
                v-for="item in RTE_CELL_BACKGROUNDS"
                :key="item.key"
                class="rte-swatch"
                :class="{ on: isSwatchActive(cellBackground, item), 'is-default': !item.value }"
                type="button"
                :title="`单元格底纹：${item.label}`"
                :style="item.value ? { background: item.value } : undefined"
                @click="applyCellBackground(item)"
              />
            </div>

            <div class="rte-panel-title">表格边框</div>
            <!-- 整表一起换（命令逐格写 border-color，见 tableCellStyle.ts）。
                 色块画成「白底 + 粗彩边」，一眼看出这一档改的是边线而不是底纹 -->
            <div class="rte-swatch-row">
              <button
                v-for="item in RTE_BORDER_COLORS"
                :key="item.key"
                class="rte-swatch is-border"
                :class="{ on: isSwatchActive(tableBorderColor, item), 'is-default': !item.value }"
                type="button"
                :title="`表格边框：${item.label}`"
                :style="item.value ? { borderColor: item.value } : undefined"
                @click="applyBorderColor(item)"
              />
            </div>

            <div class="rte-panel-title">表格宽度</div>
            <!-- 输入框要能正常获得焦点：mousedown 必须 stop（不能 prevent），否则点不进去。
                 工具栏靠 data-rte-popover 认出焦点仍在自己身上，不会收起。
                 失焦即生效，面板上不再有「应用」按钮；「铺满整行」紧挨输入框，一填一清是同一件事的两面 -->
            <div class="rte-size-row">
              <span class="rte-size-label">宽度</span>
              <input v-model="tableWidth" class="rte-num" type="number" :min="TABLE_WIDTH_MIN" :max="TABLE_WIDTH_MAX" step="10" placeholder="铺满整行" @mousedown.stop @blur="commitTableWidth" @keydown.enter="commitTableWidth" />
              <button class="rte-mini" type="button" :class="{ on: !tableWidth }" title="取消整表宽度，回到铺满整行" @click="fillTableWidth">铺满整行</button>
            </div>

            <div class="rte-panel-title">单元格尺寸</div>
            <div class="rte-size-row">
              <span class="rte-size-label">列宽</span>
              <input v-model="colWidth" class="rte-num" type="number" :min="COL_WIDTH_MIN" :max="COL_WIDTH_MAX" step="5" placeholder="px" @mousedown.stop @blur="commitColumnWidth" @keydown.enter="commitColumnWidth" />
            </div>
            <div class="rte-size-row">
              <span class="rte-size-label">行高</span>
              <input v-model="rowHeight" class="rte-num" type="number" :min="ROW_HEIGHT_MIN" :max="ROW_HEIGHT_MAX" step="5" placeholder="px" @mousedown.stop @blur="commitRowHeight" @keydown.enter="commitRowHeight" />
            </div>

            <div class="rte-panel-row">
              <button class="rte-mini danger" type="button" @click="editor.chain().focus().deleteTable().run(); close()">删除表格</button>
            </div>
          </template>
        </div>
      </template>
    </RtePopover>

    <span class="rte-sep" />

    <button class="rte-btn" type="button" title="插入填空下横线（______）" @click="insertFillBlank">
      <AppIcon name="minus" :size="16" />
      <span class="rte-btn-text">填空线</span>
    </button>
    <button class="rte-btn" type="button" title="插入作答括号（　　），光标停在括号中间" @click="insertParen">
      <AppIcon name="parentheses" :size="16" />
      <span class="rte-btn-text">括号</span>
    </button>

    <span class="rte-sep" />

    <button class="rte-btn" type="button" title="插入 / 编辑公式" @click="emit('math')">
      <AppIcon name="formula" :size="16" />
      <span class="rte-btn-text">公式</span>
    </button>
    <button class="rte-btn" type="button" title="插入图片（可从系统图片库选择，也可上传本地；也支持粘贴 / 拖入）" @click="emit('image')">
      <AppIcon name="image" :size="16" />
      <span class="rte-btn-text">图片</span>
    </button>
    <button class="rte-btn" type="button" title="插入理科配图（几何图 / 化学装置图 / 分子结构式 / 简易示意图，可 AI 生成草稿；双击已插入配图可二次编辑）" @click="emit('draw')">
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
</template>

<style scoped>
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
.rte-toolbar.compact { padding: 4px 6px; }
.rte-toolbar.compact .rte-btn-text { display: none; }
/* 展开 / 收起的状态由父级 .rte:not(.focused) 决定（那条规则依赖父级自己的 focused 类），
   这里只负责展开时的样子 */

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
/* 只带一个小箭头的按钮（下划线样式 / 序号样式） */
.rte-btn.caret { min-width: 18px; padding: 0 2px; }

.rte-sep { width: 1px; height: 18px; background: var(--border); margin: 0 5px; }

/* 「A + 当前色横杠」的颜色按钮 */
.rte-color-glyph { display: inline-flex; flex-direction: column; align-items: center; gap: 1px; font-size: 15px; font-weight: 700; line-height: 1; }
.rte-color-glyph i { display: block; width: 15px; height: 3px; border-radius: 2px; }

/* ===== 弹层内的通用件 ===== */
.rte-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--ink-2);
  font-family: inherit;
  font-size: 13px;
  text-align: left;
  transition: background 0.15s;
}
.rte-menu-item:hover:not(:disabled) { background: #f2f4fa; }
.rte-menu-item.on { background: var(--brand-soft); color: var(--brand-deep); }
.rte-menu-item:disabled { color: #c3cad8; cursor: not-allowed; }
.rte-menu-hint { margin-left: auto; color: var(--sub); font-size: 12px; }

/* 下划线三档的预览：菜单里直接把样式画出来，省得去猜「双重下划线」长什么样。
   基准类带一条实线，下面两档各自覆盖；「取消下划线」则把线去掉，并转灰表示「不设」 */
.rte-underline-preview { text-decoration: underline; text-underline-offset: 0.2em; }
.rte-underline-preview.u-wavy { text-decoration: underline wavy; }
.rte-underline-preview.u-double { text-decoration: underline double; }
.rte-underline-preview.u-none { text-decoration: none; color: var(--sub); }

.rte-swatches { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; padding: 4px; }
/* 表格面板里的色板（单元格底纹 / 表格边框）：一排横向铺开、放不下就换行，
   与上面弹层里的取色网格同一个 .rte-swatch */
.rte-swatch-row { display: flex; flex-wrap: wrap; gap: 6px; padding: 3px 2px 0; }
.rte-swatch {
  width: 24px;
  height: 24px;
  border: 1px solid rgb(0 0 0 / 10%);
  border-radius: 7px;
  cursor: pointer;
  transition: transform 0.12s, box-shadow 0.12s;
}
.rte-swatch:hover { transform: scale(1.08); }
.rte-swatch.on { box-shadow: 0 0 0 2px #fff, 0 0 0 4px var(--brand); }
/* 边框色板：白底 + 粗彩边，与底纹色板（纯色块）一眼区分开 —— 这一档改的是边线不是填充 */
.rte-swatch.is-border { background: #fff; border-width: 3px; }
/* 「默认颜色」那一格没有色值可填，画一道斜杠表示「清掉颜色」，不然看起来像个白格子 */
.rte-swatch.is-default { background: #fff; position: relative; overflow: hidden; }
.rte-swatch.is-default::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(to top right, transparent 44%, var(--danger) 44%, var(--danger) 56%, transparent 56%);
}

/* ===== 有序列表序号的候选项 =====
   每项是一段真的 `<ol>`，画 1-2-3：与正文同源（list-style-type 的取值就在 RICH_LIST_MARKERS.css 里），
   所以 ① / (1) / 一、 这些自定义序号在这里也能如实显示 —— 换成一串文字标签就还原不出来了。
   八项各三行、竖排要滚一屏，故两列。 */
/* 每行一种序号，一屏看全八种 */
.rte-markers { display: flex; flex-direction: column; gap: 2px; padding: 4px; }
.rte-marker-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--ink-2);
  text-align: left;
  transition: background 0.15s, border-color 0.15s;
}
.rte-marker-option:hover { background: #f2f4fa; }
.rte-marker-option.on { background: var(--brand-soft); border-color: var(--brand); color: var(--brand-deep); }
/* 一格里只放一个空 `<li>`，序号由 list-style-type + start 画出来；内边距给序号让位
   （UA 默认的 40px 太宽，横排三格摆不下），行高收紧让三格对齐得更整齐。
   **不能**在这里写 width / flex —— 见模板上的注释。 */
.rte-marker-preview {
  margin: 0;
  padding-left: 26px;
  font-size: 12px;
  line-height: 1.5;
}

/* ===== 插入表格的网格选择器 ===== */
.rte-grid { display: flex; flex-direction: column; gap: 3px; padding: 4px; }
.rte-grid-row { display: flex; gap: 3px; }
.rte-grid-cell {
  width: 18px;
  height: 18px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: #fff;
  cursor: pointer;
}
.rte-grid-cell.on { border-color: var(--brand); background: var(--brand-soft); }
.rte-grid-hint { padding: 2px 4px 0; color: var(--sub); font-size: 12px; text-align: center; }

/* ===== 表格操作面板 ===== */
.rte-panel-title { padding: 6px 4px 2px; color: var(--sub); font-size: 12px; }
.rte-panel-row { display: flex; flex-wrap: wrap; gap: 4px; padding: 0 2px; }
.rte-mini {
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: #fff;
  color: var(--ink-2);
  font-family: inherit;
  font-size: 12.5px;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.rte-mini:hover { background: var(--brand-soft); border-color: var(--brand); color: var(--brand-deep); }
.rte-mini.on { background: var(--brand-soft); border-color: var(--brand); color: var(--brand-deep); }
.rte-mini.danger { color: var(--danger); border-color: var(--danger-soft); }
.rte-mini.danger:hover { background: var(--danger-soft); border-color: var(--danger); color: var(--danger); }

.rte-size-row { display: flex; align-items: center; gap: 6px; padding: 4px 2px 0; }
.rte-size-label { width: 28px; color: var(--sub); font-size: 12.5px; }
.rte-num {
  width: 74px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: #fff;
  color: var(--ink);
  font-family: inherit;
  font-size: 13px;
}
.rte-num:focus { outline: none; border-color: var(--brand); box-shadow: 0 0 0 3px var(--brand-soft); }
</style>
