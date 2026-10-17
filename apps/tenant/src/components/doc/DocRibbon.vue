<script setup lang="ts">
/**
 * 备课文档编辑器的**功能渲染层**：把 `doc-plugins.ts` 里声明的功能表渲染成界面。
 *
 * 顶部横向功能区（Word 式）与右侧贴边竖排工具栏都是它，只差一个 `layout` ——
 * 两套 UI 因此天然一致：同一份注册表、同一批弹层、同一套观感，不可能出现
 * 「顶部有、右侧没有」或「两边的表格面板长得不一样」。
 *
 * 与试卷编辑工具栏同源：一样是「按钮 + 弹出面板」的组织方式、同一套 `.rte-pop` 弹层与
 * `.rte-swatch` 色板（跨组件复用同一批样式类名，两处手感才不会一半像 A 一半像 B）。
 *
 * 边界划分：**只碰编辑器内容的动作在注册表里**（加粗、改行距、插表格、格式刷……），
 * 需要媒体库 / 弹窗的动作（图片、公式、理科配图、段落对话框）emit 回 DocCanvas ——
 * 那些状态的宿主是画布。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import { AppIcon, showToast } from '@aiteach/shared'

import RtePopover from '@/components/ui/rte/RtePopover.vue'
import {
  DOC_COLLAPSE_META,
  DOC_PLUGIN_GROUPS,
  DOC_PLUGIN_PALETTES,
  pluginsOf,
  type DocEmitEvent,
  type DocPlugin,
  type DocPluginButton,
  type DocPluginEmit,
  type DocPluginPopover,
  type DocPluginSelect,
  type DocPluginToggle,
} from './doc-plugins'

const props = withDefaults(
  defineProps<{
    editor: Editor
    /** `top` = 顶部横向功能区；`rail` = 右侧贴边竖排 */
    layout?: 'top' | 'rail'
    /** 正文默认字号（页面设置里的「正文字号」），用于「默认字号」那一档的展示 */
    baseSize?: string
  }>(),
  { layout: 'top', baseSize: '' },
)

const emit = defineEmits<{
  image: []
  formula: []
  draw: []
  paragraph: []
}>()

/**
 * 分组后的功能表。
 *
 * 收起态下，折叠组的成员在这里就被**裁掉**（只留组头那一个），渲染层因此不必再写
 * 「跳过非组头成员」的判决 —— 但菜单要列出整组的成员，所以另带一份 `members`
 * （裁剪前的原始清单）。
 */
const groups = computed(() =>
  DOC_PLUGIN_GROUPS.map((group) => {
    const list = pluginsOf(group.key)
    const collapsed = props.layout === 'top' && compact.value
    return {
      key: group.key,
      label: group.label,
      plugins: collapsed ? list.filter((row, index) => !collapseKeyOf(row) || isCollapseHead(list, index)) : list,
      /** 折叠组 → 成员（下拉菜单里逐项列出） */
      members: (key: string) => list.filter((row) => collapseKeyOf(row) === key),
    }
  }),
)

function asButton(row: DocPlugin): DocPluginButton {
  return row as DocPluginButton
}
function asToggle(row: DocPlugin): DocPluginToggle {
  return row as DocPluginToggle
}
function asSelect(row: DocPlugin): DocPluginSelect {
  return row as DocPluginSelect
}
function asPopover(row: DocPlugin): DocPluginPopover {
  return row as DocPluginPopover
}
function asEmit(row: DocPlugin): DocPluginEmit {
  return row as DocPluginEmit
}

/* 注册表里的函数一律吃 editor，模板里逐个传太吵，这里统一收口 */
function runButton(row: DocPlugin) {
  asButton(row).run(props.editor)
}
function runToggle(row: DocPlugin) {
  asToggle(row).toggle(props.editor)
}
function isOn(row: DocPlugin): boolean {
  const plugin = row as DocPluginButton | DocPluginToggle | DocPluginPopover
  return plugin.isActive ? plugin.isActive(props.editor) : false
}
function isDisabled(row: DocPlugin): boolean {
  const plugin = row as DocPluginButton
  return plugin.disabled ? plugin.disabled(props.editor) : false
}

/* ===== 下拉的当前值 =====
   显示优先级：注册表给的 `display`（字号 / 行距这种要截短）→ 当前档位的 label → 空 */
function selectLabel(row: DocPlugin): string {
  const plugin = asSelect(row)
  const current = plugin.current(props.editor)
  const hit = plugin.options.find((item) => item.value === current || (item.value === null && current === null))
  const custom = plugin.display?.(props.editor)
  if (custom) return custom
  return hit?.label ?? plugin.title ?? ''
}
function selectActive(row: DocPlugin, value: string | null): boolean {
  return asSelect(row).current(props.editor) === value
}
function applySelect(row: DocPlugin, value: string | null, close: () => void) {
  asSelect(row).apply(props.editor, value)
  close()
}

/** 「链接」弹层收起时补一次提交：面板上的 mousedown 是 prevent 的，输入框不会自然失焦 */
function onPopoverClose(row: DocPlugin) {
  if (asPopover(row).popover === 'link') applyLink()
}

/* ================= 文字字形的观感 =================
   B / I / U / S 与上下标用字面量，避免为每个字母画一套路径 */
const TEXT_STYLE_IDS = ['bold', 'italic', 'underline', 'strike', 'superscript', 'subscript']

/* ================= 表格 ================= */
const inTable = computed(() => props.editor.isActive('table'))
const gridHover = ref<{ row: number; col: number } | null>(null)
function insertTable(row: number, col: number, close: () => void) {
  props.editor.chain().focus().insertTable({ rows: row, cols: col, withHeaderRow: true }).run()
  gridHover.value = null
  close()
}

/* ================= 链接 ================= */
const linkText = ref('')
function openLink() {
  linkText.value = (props.editor.getAttributes('link') as { href?: string }).href ?? ''
}
function applyLink() {
  const href = linkText.value.trim()
  const chain = props.editor.chain().focus()
  if (!href) chain.unsetLink().run()
  else if (chain.setLink({ href }).run() === false) {
    showToast('链接地址不合法，请检查后重试', 'error')
    return
  }
  linkText.value = ''
}

/* ================= 格式刷 =================
   一次性的「取格式 → 刷格式」：点按钮时记下当前选区的行内 mark 与段落属性，接着拖选一段文字，
   松手（选区变化）即把记下的格式刷上去，然后自动失效（与 Word 单击格式刷同义 —— 双击连刷
   在文档编辑器里容易误伤，不做）。

   实现上不复用 Tiptap 的命令：命令层的 setMark 是「按类型逐个设」，而格式刷要的是
   「先清干净、再整套盖上」，只能自己拼一次事务。 */
interface PainterPayload {
  marks: Array<{ type: string; attrs: Record<string, unknown> }>
  textAlign: string | null
  lineHeight: string | null
}
const painter = ref<PainterPayload | null>(null)

function blockAttrOf(name: string): string | null {
  const fromParagraph = (props.editor.getAttributes('paragraph') as Record<string, unknown>)[name]
  const fromHeading = (props.editor.getAttributes('heading') as Record<string, unknown>)[name]
  return ((fromParagraph ?? fromHeading ?? null) as string | null) ?? null
}

function capturePainter() {
  const { editor } = props
  const { from, $from } = editor.state.selection
  const marks: PainterPayload['marks'] = []
  $from.parent.descendants((child) => {
    if (!child.isText) return true
    child.marks.forEach((mark) => {
      if (mark.type.name === 'link') return
      marks.push({ type: mark.type.name, attrs: { ...mark.attrs } })
    })
    return false
  })
  void from
  painter.value = {
    /* 去重：同一类型的 mark 只需一份（选区里可能有多个 span 带同样的字体） */
    marks: marks.filter((row, index) => marks.findIndex((other) => other.type === row.type) === index),
    textAlign: blockAttrOf('textAlign'),
    lineHeight: blockAttrOf('lineHeight'),
  }
  showToast('格式已复制，选中要套用的文字即可', 'success')
}

function applyPainter() {
  const payload = painter.value
  const { editor } = props
  if (!payload) return
  const { from, to } = editor.state.selection
  if (from === to) return
  /* 先清空状态再落事务：dispatch 会触发 selectionUpdate，不清就递归了 */
  painter.value = null
  const { tr } = editor.state
  Object.values(editor.schema.marks).forEach((type) => tr.removeMark(from, to, type))
  Object.entries(editor.schema.marks).forEach(([name, type]) => {
    const hit = payload.marks.find((row) => row.type === name)
    if (hit) tr.addMark(from, to, type.create(hit.attrs))
  })
  editor.state.doc.nodesBetween(from, to, (child, pos) => {
    if (child.type.name !== 'paragraph' && child.type.name !== 'heading') return
    tr.setNodeMarkup(pos, undefined, { ...child.attrs, textAlign: payload.textAlign, lineHeight: payload.lineHeight })
  })
  editor.view.dispatch(tr)
}

function onSelectionUpdate() {
  if (painter.value) applyPainter()
}
watch(
  () => props.editor,
  (instance, _old, onCleanup) => {
    instance.on('selectionUpdate', onSelectionUpdate)
    onCleanup(() => instance.off('selectionUpdate', onSelectionUpdate))
  },
  { immediate: true },
)
onBeforeUnmount(() => props.editor.off('selectionUpdate', onSelectionUpdate))

const colorValue = computed(() => (props.editor.getAttributes('textStyle') as { color?: string | null }).color || '#000000')
const highlightValue = computed(() => (props.editor.getAttributes('textStyle') as { backgroundColor?: string | null }).backgroundColor ?? null)
const listMarkerValue = computed(() => {
  const attrs = props.editor.getAttributes('orderedList') as { type?: string | null; listStyle?: string | null }
  return attrs.listStyle ?? attrs.type ?? '1'
})

function setColor(value: string | null, close: () => void) {
  const chain = props.editor.chain().focus()
  if (value) chain.setColor(value).run()
  else chain.unsetColor().run()
  close()
}
function setHighlight(value: string | null, close: () => void) {
  const chain = props.editor.chain().focus()
  if (value) chain.setBackgroundColor(value).run()
  else chain.unsetBackgroundColor().run()
  close()
}
function onEmit(event: DocEmitEvent) {
  if (event === 'image') emit('image')
  else if (event === 'formula') emit('formula')
  else if (event === 'draw') emit('draw')
  else emit('paragraph')
}

/* ================= 一行放不下时：分两级收缩 =================
 *
 * 顶栏的功能带按「一行」设计：折行会让功能带的高度随窗口变来变去，把纸往下挤。
 * 所以放不下时按「损失从小到大」收缩，而不是直接折行：
 *
 * - **第 1 级**：把对齐四档与缩进两档收成两个下拉。这两组最该被收起来 —— 图标本身就能
 *   自解释（左 / 中 / 右 / 两端、增 / 减缩进），收起来不影响判读（对齐那个按钮还会显示
 *   **当前**的对齐图标）。
 * - **第 2 级**：再把密度压一档 —— 三个「带当前值」的下拉去掉前导图标、收窄最小宽度，
 *   间距与内边距各减一档。文字仍然保留（「标题 1」「默认字体」「默认字号」正是要看的信息）。
 *
 * 两级都不够（窗口真的很窄）时才折行：折行不好看，但**比把按钮裁掉好得多** ——
 * 裁掉的按钮点不到，等于功能消失。
 *
 * 阈值上带一点**滞回**：收缩之后省出来的宽度若刚好等于溢出量，展开 / 收缩就会一帧一抖
 * （收 → 放得下 → 展开 → 又放不下 → 收…）。所以展开的条件是「连省下来的那份也富余 8px」，
 * 而省了多少是在收缩的那一瞬间实测出来的（`savedByLevel`），不是估的。 */
const rootRef = ref<HTMLElement | null>(null)
/** 收缩档位：0 = 全展开，1 = 收起对齐 / 缩进，2 = 连密度一起压 */
const MAX_LEVEL = 2
const level = ref(0)
const compact = computed(() => props.layout === 'top' && level.value >= 1)
const tight = computed(() => props.layout === 'top' && level.value >= 2)
/** `savedByLevel[n]` = 从第 n 档降到第 n+1 档实际省下的宽度（px） */
const savedByLevel = new Map<number, number>()
/** 展回去要留的富余：比它小就宁可继续收着，避免边界上反复横跳 */
const RELAX_SLACK = 8

/**
 * 功能带的**单行**内容宽度。
 *
 * 不用 `scrollWidth`：父级允许折行，一旦折了 `scrollWidth` 就等于容器宽度，溢出量再也量不出来。
 * 而每个分组都是 `flex-shrink: 0`（不会被压窄），把各自宽度相加即「如果摆成一行会有多宽」。
 */
function singleLineWidth(el: HTMLElement): number {
  let sum = 0
  for (const child of Array.from(el.children)) sum += (child as HTMLElement).getBoundingClientRect().width
  return sum
}

function measureOverflow() {
  /* 竖排（右侧贴边栏）不参与：它没有「一行」这回事，宽度本来就是固定的窄栏 */
  if (props.layout !== 'top') return
  const el = rootRef.value
  if (!el) return
  const box = el.clientWidth
  if (box <= 0) return
  const content = singleLineWidth(el)

  if (content > box + 1) {
    /* 放不下：再压一档。已经压到底就认了（此时靠折行兜住，不会有按钮被裁掉） */
    if (level.value >= MAX_LEVEL) return
    const from = level.value
    const overflow = content - box
    /* 先记一个下界（溢出量），再在 DOM 更新后按真实差值修正 */
    savedByLevel.set(from, Math.max(overflow, savedByLevel.get(from) ?? 0))
    level.value = from + 1
    void nextTick(() => {
      const after = rootRef.value ? singleLineWidth(rootRef.value) : content
      savedByLevel.set(from, Math.max(content - after, overflow))
      measureOverflow()
    })
    return
  }

  if (level.value > 0) {
    /* 展开一档的判据：**上一档**放得下（= 当前宽度 + 那一档省下的宽度 + 一点富余）。
       少了这个判据就会在临界线上来回抖：展开 → 又放不下 → 收 → 放得下 → 展开… */
    const cost = savedByLevel.get(level.value - 1) ?? Number.POSITIVE_INFINITY
    if (content + cost + RELAX_SLACK <= box) {
      level.value -= 1
      void nextTick(measureOverflow)
    }
  }
}

let observer: ResizeObserver | null = null
onMounted(() => {
  measureOverflow()
  const el = rootRef.value
  if (el && typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => measureOverflow())
    observer.observe(el)
  }
})
onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
})

function collapseKeyOf(row: DocPlugin): string {
  return (row as { collapse?: string }).collapse ?? ''
}

/** 同一个折叠组只在第一个成员处渲染一次下拉（裁剪 plugins 时用它筛出组头） */
function isCollapseHead(list: DocPlugin[], index: number): boolean {
  const key = collapseKeyOf(list[index])
  if (!key) return false
  return list.findIndex((row) => collapseKeyOf(row) === key) === index
}

function collapseMeta(key: string) {
  return DOC_COLLAPSE_META[key]
}
function collapseIcon(key: string): string {
  const meta = DOC_COLLAPSE_META[key]
  if (!meta) return 'align-left'
  return meta.iconOf ? meta.iconOf(props.editor) : meta.icon
}
/** 菜单项的文案：把 title 里的快捷键括注去掉（菜单里不需要「（Tab）」，按钮上才有用） */
function memberLabel(row: DocPlugin): string {
  return (row.title ?? '').replace(/（[^）]*）/g, '').trim() || row.id
}
function runMember(row: DocPlugin, close: () => void) {
  if (row.kind === 'toggle') runToggle(row)
  else if (row.kind === 'button') runButton(row)
  close()
}
</script>

<template>
  <div ref="rootRef" class="dr" :class="[`layout-${layout}`, { 'is-compact': compact, 'is-tight': tight }]" @mousedown.prevent>
    <template v-for="(group, gi) in groups" :key="group.key">
      <span v-if="layout === 'top' && gi > 0" class="dr-divider" />
      <div class="dr-group">
        <div v-if="layout === 'rail'" class="dr-glabel">{{ group.label }}</div>

        <div class="dr-items">
          <template v-for="row in group.plugins" :key="row.id">
            <!-- 折叠组：一行放不下时收成一个下拉（对齐 / 缩进） -->
            <RtePopover
              v-if="collapseKeyOf(row)"
              :width="collapseMeta(collapseKeyOf(row))?.width ?? 180"
            >
              <template #trigger="{ open, toggle }">
                <button
                  class="dr-btn"
                  :class="{ on: open }"
                  type="button"
                  :title="collapseMeta(collapseKeyOf(row))?.title"
                  @click="toggle"
                >
                  <AppIcon :name="collapseIcon(collapseKeyOf(row))" :size="16" />
                  <AppIcon class="caret" name="chevron-down" :size="12" />
                </button>
              </template>
              <template #default="{ close }">
                <button
                  v-for="item in group.members(collapseKeyOf(row))"
                  :key="item.id"
                  class="rte-menu-item"
                  :class="{ on: isOn(item) }"
                  type="button"
                  :disabled="isDisabled(item)"
                  @click="runMember(item, close)"
                >
                  <AppIcon v-if="item.icon" :name="item.icon" :size="15" />
                  <span class="dr-optlabel">{{ memberLabel(item) }}</span>
                </button>
              </template>
            </RtePopover>

            <!-- 按钮 -->
            <button
              v-else-if="row.kind === 'button'"
              class="dr-btn"
              :class="{ on: isOn(row), 'is-text': TEXT_STYLE_IDS.includes(row.id), bold: row.id === 'bold', italic: row.id === 'italic', underline: row.id === 'underline', strike: row.id === 'strike' }"
              type="button"
              :disabled="isDisabled(row)"
              :title="row.title"
              @click="runButton(row)"
            >
              <AppIcon v-if="row.icon" :name="row.icon" :size="16" />
              <span v-if="row.text" v-html="row.text" />
            </button>

            <!-- 开关 -->
            <button
              v-else-if="row.kind === 'toggle'"
              class="dr-btn"
              :class="{ on: isOn(row), 'is-text': TEXT_STYLE_IDS.includes(row.id), bold: row.id === 'bold', italic: row.id === 'italic', underline: row.id === 'underline', strike: row.id === 'strike' }"
              type="button"
              :title="row.title"
              @click="runToggle(row)"
            >
              <AppIcon v-if="row.icon" :name="row.icon" :size="16" />
              <span v-if="row.text" v-html="row.text" />
            </button>

            <!-- 下拉 -->
            <RtePopover v-else-if="row.kind === 'select'" :width="asSelect(row).width">
              <template #trigger="{ open, toggle }">
                <button
                  class="dr-btn wide"
                  :class="{ on: open }"
                  type="button"
                  :title="row.title"
                  @click="toggle"
                >
                  <!-- 第 2 档收缩时去掉前导图标：省下 3 × 21px，而「标题 1 / 默认字体 / 默认字号」
                       这几行文字本身就是要看的信息，不能省 -->
                  <AppIcon v-if="row.icon && !tight" :name="row.icon" :size="16" />
                  <span class="dr-seltext">{{ selectLabel(row) }}</span>
                  <AppIcon class="caret" name="chevron-down" :size="12" />
                </button>
              </template>
              <template #default="{ close }">
                <button
                  v-for="item in asSelect(row).options"
                  :key="item.key"
                  class="rte-menu-item"
                  :class="{ on: selectActive(row, item.value) }"
                  type="button"
                  :style="item.preview ? { fontFamily: item.preview } : undefined"
                  @click="applySelect(row, item.value, close)"
                >
                  <span class="dr-optlabel">{{ item.label }}</span>
                </button>
              </template>
            </RtePopover>

            <!-- 弹层 -->
            <RtePopover
              v-else-if="row.kind === 'popover'"
              :width="asPopover(row).width"
              :class="`dr-pop-${asPopover(row).popover}`"
              @close="onPopoverClose(row)"
            >
              <template #trigger="{ open, toggle }">
                <button
                  class="dr-btn"
                  :class="{
                    on: open || isOn(row),
                    wide: row.wide,
                    'caret-only': asPopover(row).popover === 'listMarker',
                  }"
                  type="button"
                  :title="row.title"
                  @click="asPopover(row).popover === 'link' ? (openLink(), toggle()) : toggle()"
                >
                  <!-- 字色 / 高亮画成「字形 + 当前色带」，其余用图标 + 文字 -->
                  <template v-if="asPopover(row).popover === 'color'">
                    <span class="dr-color-glyph">A<i :style="{ background: colorValue }" /></span>
                  </template>
                  <template v-else-if="asPopover(row).popover === 'highlight'">
                    <span class="dr-color-glyph"><AppIcon name="highlight" :size="15" /><i :style="{ background: highlightValue ?? '#fff3b0' }" /></span>
                  </template>
                  <template v-else>
                    <AppIcon v-if="row.icon" :name="row.icon" :size="16" />
                    <span v-if="row.text">{{ row.text }}</span>
                  </template>
                  <AppIcon v-if="row.wide || asPopover(row).popover === 'table'" class="caret" name="chevron-down" :size="12" />
                </button>
              </template>

              <template #default="{ close }">
                <!-- 色板 -->
                <div v-if="asPopover(row).popover === 'color' || asPopover(row).popover === 'highlight'" class="rte-swatches">
                  <button
                    v-for="item in asPopover(row).popover === 'color' ? DOC_PLUGIN_PALETTES.colors : DOC_PLUGIN_PALETTES.highlights"
                    :key="item.key"
                    class="rte-swatch"
                    :class="{
                      on: (asPopover(row).popover === 'color' ? colorValue : highlightValue) === item.value,
                      'is-default': !item.value,
                    }"
                    type="button"
                    :title="item.label"
                    :style="item.value ? { background: item.value } : undefined"
                    @click="asPopover(row).popover === 'color' ? setColor(item.value, close) : setHighlight(item.value, close)"
                  />
                </div>

                <!-- 序号样式：候选各自是一段真的 <ol>，看到 ① 就是插进去 ①（与正文同源） -->
                <div v-else-if="asPopover(row).popover === 'listMarker'" class="rte-markers">
                  <button
                    v-for="item in DOC_PLUGIN_PALETTES.listMarkers"
                    :key="item.key"
                    class="rte-marker-option"
                    :class="{ on: (item.style ?? item.type) === listMarkerValue }"
                    type="button"
                    :title="`序号样式：${item.label}`"
                    @click="editor.chain().focus().setListMarker(item.key).run(); close()"
                  >
                    <ol v-for="n in 3" :key="n" class="rte-marker-preview" :style="{ listStyleType: item.css }" :start="n" aria-hidden="true">
                      <li>&nbsp;</li>
                    </ol>
                  </button>
                </div>

                <!-- 表格：不在表里是网格选择器，在表里是行列与合并的操作面板 -->
                <template v-else-if="asPopover(row).popover === 'table'">
                  <template v-if="!inTable">
                    <div class="rte-grid" @mouseleave="gridHover = null">
                      <div v-for="r in 6" :key="r" class="rte-grid-row">
                        <span
                          v-for="c in 8"
                          :key="c"
                          class="rte-grid-cell"
                          :class="{ on: !!gridHover && r <= gridHover.row && c <= gridHover.col }"
                          @mouseenter="gridHover = { row: r, col: c }"
                          @click="insertTable(r, c, close)"
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
                    <div class="rte-panel-row" style="margin-top: 6px">
                      <button class="rte-mini danger" type="button" @click="editor.chain().focus().deleteTable().run(); close()">删除表格</button>
                    </div>
                  </template>
                </template>

                <!-- 链接：面板里给一个输入框，空值即取消链接 -->
                <div v-else-if="asPopover(row).popover === 'link'" class="dr-link">
                  <input
                    v-model="linkText"
                    class="dr-input"
                    placeholder="https://…  （留空则取消链接）"
                    @mousedown.stop
                    @keydown.enter="applyLink(); close()"
                  />
                  <div class="rte-panel-row">
                    <button class="rte-mini" type="button" @click="applyLink(); close()">确定</button>
                    <button class="rte-mini" type="button" @click="editor.chain().focus().unsetLink().run(); linkText = ''; close()">取消链接</button>
                  </div>
                  <p class="dr-tip">外链一律以新窗口打开，并带 noopener。</p>
                </div>

                <!-- 格式刷（一次性）：点一下复制格式，再拖选目标 -->
                <div v-else-if="asPopover(row).popover === 'painter'" class="dr-painter">
                  <p class="dr-tip">
                    先在源文字上点一下「复制格式」，再选中目标文字即可套用（会连同对齐与行距一起复制）。
                  </p>
                  <div class="rte-panel-row">
                    <button class="rte-mini" type="button" @click="capturePainter(); close()">复制格式</button>
                    <button class="rte-mini" type="button" :class="{ on: !!painter }" @click="painter = null; close()">取消（{{ painter ? '已复制' : '未复制' }}）</button>
                  </div>
                </div>
              </template>
            </RtePopover>

            <!-- 对外事件 -->
            <button v-else-if="row.kind === 'emit'" class="dr-btn" type="button" :title="row.title" @click="onEmit(asEmit(row).event)">
              <AppIcon v-if="row.icon" :name="row.icon" :size="16" />
              <span v-if="row.text">{{ row.text }}</span>
            </button>
          </template>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* ===== 两种排版共用一套原子样式，只差排列方向与分组标题 ===== */
.dr { display: flex; min-width: 0; }
.dr.layout-rail { flex-direction: column; }
/* 顶栏：常态是一行；两级收缩之后仍放不下才折行（见脚本里的 level）。
   `flex-wrap: wrap` 是最后一道兜底 —— 折行难看，但比把按钮裁掉好：裁掉的按钮点不到。 */
.dr.layout-top { align-items: stretch; flex-wrap: wrap; }

.dr-group { display: flex; flex-direction: column; }
.dr.layout-top .dr-group { flex-shrink: 0; padding: 4px 10px; }
.dr.layout-rail .dr-group { padding: 10px 12px; border-bottom: 1px dashed var(--border); }
.dr.layout-rail .dr-group:last-child { border-bottom: none; }

.dr-glabel { font-size: 11px; font-weight: 700; color: var(--sub); letter-spacing: 0.4px; margin-bottom: 6px; }

.dr-items { display: flex; align-items: center; gap: 4px; }
/* 竖排仍可换行（窄栏里一行放不下两个按钮是常态）；顶栏一律一行 */
.dr.layout-rail .dr-items { flex-wrap: wrap; }
.dr.layout-top .dr-items { flex-wrap: nowrap; }

.dr-divider { width: 1px; align-self: stretch; background: var(--border); margin: 6px 0; flex-shrink: 0; }

/* ---------- 顶栏的第 1 档收缩：带当前值的下拉固定宽度，别让它们跟着文字长短跳 ---------- */
.dr.layout-top.is-compact .dr-btn.wide { min-width: 104px; }
/* ---------- 第 2 档：把密度再压一档（间距、内边距、最小宽度各降一级） ---------- */
.dr.layout-top.is-tight .dr-group { padding: 4px 7px; }
.dr.layout-top.is-tight .dr-items { gap: 3px; }
.dr.layout-top.is-tight .dr-btn { padding: 0 6px; }
.dr.layout-top.is-tight .dr-btn.wide { min-width: 84px; }
.dr.layout-top.is-tight .dr-btn.is-text { min-width: 26px; }
/* 收起态下的下拉按钮：图标 + 箭头，比四个对齐按钮省下一半以上的宽度 */
.dr.layout-top .dr-btn .caret { margin-left: 2px; }

.dr-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--ink-2);
  font-size: 12.5px;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.dr-btn:hover:not(:disabled) { background: var(--brand-soft); color: var(--brand-deep); }
.dr-btn.on { background: var(--brand-soft); color: var(--brand-deep); border-color: var(--brand); }
.dr-btn:disabled { color: #c3cad8; cursor: not-allowed; }
/* 带下拉箭头的按钮占满整行，一眼看出「这里可以展开」 */
.dr-btn.wide { min-width: 128px; justify-content: flex-start; border-color: var(--border); background: #fff; }
.dr.layout-rail .dr-btn.wide { flex: 1; }
.dr-btn.caret-only { min-width: 24px; padding: 0 4px; justify-content: center; border-color: var(--border); background: #fff; }
.caret { margin-left: auto; opacity: 0.6; }
.dr-seltext { flex: 1; overflow: hidden; text-overflow: ellipsis; text-align: left; }
.dr-optlabel { flex: 1; text-align: left; }

/* B / I / U / S 与上下标用字面量，避免为每个字母画一套路径 */
.dr-btn.is-text { font-size: 14px; font-weight: 700; min-width: 30px; justify-content: center; }
.dr-btn.is-text sup,
.dr-btn.is-text sub { font-size: 9.5px; }
.dr-btn.italic { font-style: italic; font-family: Georgia, serif; }
.dr-btn.underline { text-decoration: underline; }
.dr-btn.strike { text-decoration: line-through; }

/* 「A + 当前色横杠」的颜色按钮（与录题工具栏同形） */
.dr-color-glyph { display: inline-flex; flex-direction: column; align-items: center; gap: 1px; font-size: 15px; font-weight: 700; line-height: 1; }
.dr-color-glyph i { display: block; width: 15px; height: 3px; border-radius: 2px; }

.dr-link { display: flex; flex-direction: column; gap: 6px; padding: 2px; }
.dr-input {
  width: 100%;
  height: 30px;
  padding: 0 9px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: #fff;
  color: var(--ink);
  font-family: inherit;
  font-size: 13px;
}
.dr-input:focus { outline: none; border-color: var(--brand); box-shadow: 0 0 0 3px var(--brand-soft); }
.dr-tip { font-size: 11.5px; color: var(--sub); line-height: 1.6; }
.dr-painter { display: flex; flex-direction: column; gap: 8px; }

/* 弹层内部的原子件（.rte-menu-item / .rte-swatch / .rte-grid / .rte-mini ……）在
   styles/rte-popover.css 里 —— 与录题工具栏共用同一批，不在这里重复定义 */
</style>
