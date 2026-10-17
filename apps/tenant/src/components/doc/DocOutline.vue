<script setup lang="ts">
/**
 * 文档左侧的**目录**（大纲 / 导航窗格）。
 *
 * 目录不是另存一份数据，而是**从正文里的标题节点现推导**出来的：`editor.state.doc` 上扫一遍
 * heading 就是全部条目。这样「改标题 → 目录跟着变」是免费的，也不会出现
 * 「目录里有这一节、正文里找不到」这种两套数据分头维护必然产生的偏差。
 *
 * 跳转用 `view.nodeDOM(pos).scrollIntoView()` 而不是把滚动位置算出来：正文在
 * contenteditable 里，位置与像素的换算牵着行高、分页与缩放，交给浏览器做同义且不会算错。
 *
 * ## 层级与折叠
 *
 * 目录按标题级别做成**树**（与 Word 的导航窗格同义）：父级左侧有一个箭头，点它收起 / 展开
 * 这一段；头部给一颗**全部展开 / 全部折叠的开关**（默认展开），长文档里一眼看清有哪几节。
 * 折叠状态按**条目下标**记（标题的 ProseMirror `pos` 会随编辑漂移，拿它当键会在改一个字之后
 * 整体错位）；条目增删时下标越界的那几个键会被丢掉，代价是「删标题后可能多展开一级」，
 * 比「折叠错到别的章节上」可接受。
 *
 * 没有子条目的条目左侧**只留空白、不画圆点**：一个点在一列标题前面既没有信息量，
 * 又会被误读成「这里可以点开」。空白保留着是为了与同级里带箭头的条目的文字左对齐。
 *
 * ## 两种外观
 *
 * - 默认（`fill` 关）：一张卡片，自己钉在画布左栏里 —— 供内嵌画布（DocCanvas）使用；
 * - `fill` 开：铺满父容器、自带滚动 —— 供全屏编辑页左侧那一栏使用（边框与底色由父级给，
 *   与试卷编辑的左侧目录同一套外观）。
 */
import { computed, ref, watch } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import { AppIcon } from '@aiteach/shared'

const props = withDefaults(
  defineProps<{
    editor: Editor
    /** 文档名（目录的第一行，不可跳转） */
    title: string
    /** 铺满父容器（全屏编辑页的左栏）；关着时是一张卡片（内嵌画布） */
    fill?: boolean
    /** 是否显示标题右侧的「收起目录」按钮（收起动作由父级执行） */
    closable?: boolean
  }>(),
  { fill: false, closable: false },
)

const emit = defineEmits<{ close: [] }>()

interface OutlineItem {
  pos: number
  level: number
  text: string
}

const items = computed<OutlineItem[]>(() => {
  const out: OutlineItem[] = []
  props.editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return true
    const text = node.textContent.trim()
    out.push({ pos, level: Number(node.attrs.level ?? 1), text: text || '（未命名标题）' })
    return true
  })
  return out
})

/** 每个标题的层级关系：深度、父条目下标、是否有子条目 */
const flat = computed(() => {
  const rows: Array<{ item: OutlineItem; index: number; depth: number; parent: number | null; hasChildren: boolean }> = []
  const stack: number[] = []
  items.value.forEach((item, index) => {
    /* 用「级别不小于自己」的祖先出栈：标题 2 跟在标题 1 后面时，标题 1 就是它的父 */
    while (stack.length && items.value[stack[stack.length - 1]].level >= item.level) stack.pop()
    rows.push({ item, index, depth: stack.length, parent: stack.length ? stack[stack.length - 1] : null, hasChildren: false })
    stack.push(index)
  })
  /* pre-order 序里「我的下一个条目以我为父」等价于「我有子条目」 */
  rows.forEach((row, i) => {
    row.hasChildren = i + 1 < rows.length && rows[i + 1].parent === row.index
  })
  return rows
})

const collapsed = ref<number[]>([])

/** 标题变了就把越界（正文里已不存在）的折叠标记丢掉 */
watch(items, (list) => {
  if (collapsed.value.some((index) => index >= list.length)) {
    collapsed.value = collapsed.value.filter((index) => index < list.length)
  }
})

/**
 * 实际渲染的行。
 *
 * 折叠一个节点后，**级别比它更深**的后继条目全部隐藏，直到遇到级别不深于它的标题为止 ——
 * 中文文档里标题级别只会连着加深再跳回浅层，这个「一条直线扫过去」的判据足够准，
 * 也不必递归遍历树。
 */
const rows = computed(() => {
  const out: typeof flat.value = []
  let hideBelow: number | null = null
  for (const row of flat.value) {
    if (hideBelow !== null) {
      if (row.item.level > hideBelow) continue
      hideBelow = null
    }
    out.push(row)
    if (row.hasChildren && collapsed.value.includes(row.index)) hideBelow = row.item.level
  }
  return out
})

const parentIndexes = computed(() => flat.value.filter((row) => row.hasChildren).map((row) => row.index))
/** 是否处于「收起了至少一节」的状态 —— 决定那颗开关按钮的方向与文案 */
const anyCollapsed = computed(() => collapsed.value.length > 0)

/** 一颗开关：全展开时点它全折叠，反之全展开。默认全展开（`collapsed` 初始为空） */
function toggleAll() {
  if (!parentIndexes.value.length) return
  collapsed.value = collapsed.value.length ? [] : [...parentIndexes.value]
}
function toggle(index: number) {
  collapsed.value = collapsed.value.includes(index)
    ? collapsed.value.filter((row) => row !== index)
    : [...collapsed.value, index]
}

/**
 * 当前高亮项：光标之前**最后一个**标题。
 * 不看光标之后是因为「刚进入某一节的开头」时，人认为自己还在这一节里 —— 与 Word 的
 * 「导航窗格」高亮逻辑一致。
 */
const activePos = computed(() => {
  const cursor = props.editor.state.selection.from
  let hit: number | null = null
  for (const item of items.value) {
    if (item.pos <= cursor) hit = item.pos
    else break
  }
  return hit ?? items.value[0]?.pos ?? null
})

function jump(pos: number) {
  const dom = props.editor.view.nodeDOM(pos)
  if (dom instanceof HTMLElement) dom.scrollIntoView({ block: 'start', behavior: 'smooth' })
}
</script>

<template>
  <aside class="do panel" :class="{ 'is-fill': fill }">
    <div class="do-head">
      <AppIcon name="outline" :size="15" />
      <span>目录</span>
      <span class="do-count">{{ items.length }} 节</span>
      <div class="do-ops">
        <!-- 一颗开关就够了：全展开时它变成「全部折叠」，全收起时变回「全部展开」。
             两颗按钮并排放着，永远有一颗是灰的，读起来像「有一个功能坏了」。 -->
        <button
          class="do-icon-btn"
          type="button"
          :title="anyCollapsed ? '全部展开' : '全部折叠'"
          :disabled="!parentIndexes.length"
          @click="toggleAll"
        >
          <AppIcon :name="anyCollapsed ? 'chevron-down' : 'chevron-up'" :size="14" />
        </button>
        <button v-if="closable" class="do-icon-btn" type="button" title="收起目录" @click="emit('close')">
          <AppIcon name="close" :size="13" />
        </button>
      </div>
    </div>

    <!-- 文档名：与下面的条目同排，但不可跳转（它就落在正文最开头，跳过去没有意义） -->
    <div class="do-title" :title="title">
      <AppIcon name="file" :size="13" class="do-title-ico" />
      <span>{{ title || '（未命名文档）' }}</span>
    </div>

    <div class="do-list">
      <div
        v-for="row in rows"
        :key="row.item.pos"
        class="do-row"
        :class="[`lv-${row.item.level}`, { on: row.item.pos === activePos }]"
        :style="{ paddingLeft: `${8 + row.depth * 14}px` }"
      >
        <button
          v-if="row.hasChildren"
          class="do-caret"
          type="button"
          :title="collapsed.includes(row.index) ? '展开这一节' : '收起这一节'"
          @click.stop="toggle(row.index)"
        >
          <AppIcon :name="collapsed.includes(row.index) ? 'chevron-right' : 'chevron-down'" :size="13" />
        </button>
        <!-- 叶子条目：只留与箭头等宽的空位，不画圆点 —— 圆点在这列标题前面没有信息量，
             还会被误读成「这里可以点开」；空位则让同级的文字仍然左对齐成一条线 -->
        <span v-else class="do-spacer" />
        <button class="do-text" type="button" :title="row.item.text" @click="jump(row.item.pos)">
          {{ row.item.text }}
        </button>
      </div>
      <p v-if="!items.length" class="do-empty">
        正文里还没有标题。<br />
        用工具栏「段落样式」把某一行的样式设成<b>标题 1~5</b>，它就会出现在这里。
      </p>
    </div>
  </aside>
</template>

<style scoped>
.do {
  padding: 12px;
  position: sticky;
  top: 0;
  max-height: calc(100vh - 168px);
  display: flex;
  flex-direction: column;
}
/* 铺满版（全屏编辑页左栏）：卡片外壳由父级给，这里只负责「钉住 + 自己滚」 */
.do.is-fill {
  position: static;
  height: 100%;
  max-height: none;
  padding: 12px 10px;
  border: none;
  border-radius: 0;
  box-shadow: none;
  background: #fff;
}

.do-head { display: flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 700; color: var(--ink); padding: 2px 2px 0; }
.do-count { font-size: 11.5px; font-weight: 500; color: var(--sub); }
.do-ops { margin-left: auto; display: flex; align-items: center; gap: 2px; }
.do-icon-btn {
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--sub);
  display: flex;
  align-items: center;
  justify-content: center;
}
.do-icon-btn:hover:not(:disabled) { background: #f2f5fa; color: var(--brand-deep); }
/* 已全部展开 / 没有任何可折叠项时置灰：留着能点但点了没反应，会让人以为是坏了 */
.do-icon-btn:disabled { color: #c8cfdb; cursor: not-allowed; }

.do-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 10px 0 6px;
  padding: 7px 8px;
  border-radius: 8px;
  background: #f7f9fc;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.do-title-ico { flex-shrink: 0; color: var(--sub); }
.do-title span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.do-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 1px; padding-right: 2px; }

/* 条目：与试卷编辑的左侧目录同一套尺寸（13px / 7px 上下内边距 / 8px 圆角），
   早先的 5px 内边距 + 12.5px 字号挤成一团，长文档里几乎点不准 */
.do-row {
  display: flex;
  align-items: center;
  gap: 4px;
  border-radius: 8px;
  padding: 7px 8px;
  transition: background 0.15s, color 0.15s;
}
.do-row:hover { background: #f2f5fa; }
.do-row.on { background: var(--brand-soft); }
.do-row.on .do-text { color: var(--brand-deep); font-weight: 600; }

.do-caret {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--sub);
  display: flex;
  align-items: center;
  justify-content: center;
}
.do-caret:hover { background: #e8edf6; color: var(--brand-deep); }

/* 叶子节点的空位：占掉和箭头一样的位置，标题文字才会左对齐成一条线（不画任何记号） */
.do-spacer { width: 18px; flex-shrink: 0; }

.do-text {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  text-align: left;
  font-size: 13px;
  line-height: 1.5;
  color: var(--ink-2);
  padding: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.do-row.lv-1 .do-text { font-weight: 700; color: var(--ink); }
.do-row.lv-4 .do-text,
.do-row.lv-5 .do-text { color: var(--sub); }

.do-empty { margin-top: 6px; padding: 8px; border-radius: 8px; background: #f7fafa; color: var(--sub); font-size: 11.5px; line-height: 1.7; }
.do-empty b { color: var(--ink-2); }
</style>
