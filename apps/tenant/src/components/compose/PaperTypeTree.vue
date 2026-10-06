<script lang="ts">
/* `<script setup>` 里不能写 `export`，而父组件要用这两个类型标注传给树的分组数据，
   所以单开一个普通 script 块放类型 —— 与 setup 块共用同一个模块作用域。 */
export interface PaperTypeLeaf {
  name: string
  count: number
}

export interface PaperTypeGroup {
  name: string
  /** 该分类下当前年级 / 学科可见的考试类型（已过滤，空分类由本组件不渲染） */
  items: PaperTypeLeaf[]
  /** 分类计数 = 叶子计数之和（父组件算，保证与列表条数一致） */
  count: number
}
</script>

<script setup lang="ts">
/**
 * 组卷工作台「试卷」页签左侧的试卷类型树：分类（同步教学 / 阶段测试 / 小升初 / 竞赛）→ 考试类型。
 *
 * 两级都是**扁平渲染**（一行一个按钮）而不是嵌套 `<ul>`：折叠只是控制叶子行要不要生成，
 * 缩进靠 `depth` 算 padding，这样滚动、hover、键盘焦点都只有一类元素要管。
 *
 * 本组件不查字典也不筛数据：分类怎么来、每项多少个卷由父组件算好传进来（见 PapersTab 的计数池），
 * 此处只负责「点谁 → 抛出一组考试类型名」。抛出的名字写进共享 `ComposeFilter.examTypes`，
 * 因此切到「试题」页签时同一个条件依然成立。
 */
import { computed, ref, watch } from 'vue'
import { AppIcon } from '@aiteach/shared'

const props = defineProps<{
  groups: PaperTypeGroup[]
  /** 已选中的考试类型名；空数组 = 全部试卷 */
  selected: string[]
}>()

const emit = defineEmits<{ change: [names: string[]] }>()

/** 折叠态记「收起的分类」而不是「展开的」：作用域切换后新出现的分类默认就是展开的 */
const collapsed = ref<Set<string>>(new Set())

/** 换了年级 / 学科后，收缩记录里可能留着已经不存在的分类名，顺手清掉，避免越积越多 */
watch(
  () => props.groups,
  (groups) => {
    if (!collapsed.value.size) return
    const alive = new Set(groups.map((group) => group.name))
    const next = new Set([...collapsed.value].filter((name) => alive.has(name)))
    if (next.size !== collapsed.value.size) collapsed.value = next
  },
)

/** 过滤后一条叶子都不剩的分类直接不渲染 —— 空分类点进去必然一片空白 */
const visibleGroups = computed(() => props.groups.filter((group) => group.items.length > 0))

function isLeafActive(name: string): boolean {
  return props.selected.includes(name)
}

/**
 * 分类高亮用「包含」而不是「集合恰好相等」：作用域切换会让分类下的可选叶子增减，
 * 恰好相等的判定会在用户没动过的瞬间凭空熄灭。
 */
function isGroupActive(group: PaperTypeGroup): boolean {
  return props.selected.length > 0 && group.items.every((item) => props.selected.includes(item.name))
}

/**
 * 分类行是否**显示**选中态 = 整组选中，且该分类下确实有多个可选类型。
 *
 * 单叶分类（「竞赛」下只有「数学竞赛」）不算：那一下点中的就是那一片叶子，
 * 高亮跑到父级上等于把用户点的那一行藏起来。
 */
function isGroupHighlighted(group: PaperTypeGroup): boolean {
  return group.items.length > 1 && isGroupActive(group)
}

function groupOfLeaf(name: string): PaperTypeGroup | undefined {
  return visibleGroups.value.find((group) => group.items.some((item) => item.name === name))
}

/**
 * 叶子行是否**显示**选中态：自己选中，且不是「整组一起选中」里的一员 ——
 * 点父级选中整个分类时，子级不跟着逐个点亮（否则一行「阶段测试」下面亮着五个子项，
 * 看上去像选了五个东西而不是一个分类），只由父级那一行代表。
 */
function isLeafHighlighted(name: string): boolean {
  if (!isLeafActive(name)) return false
  const group = groupOfLeaf(name)
  return !group || !isGroupHighlighted(group)
}

type Row =
  | { kind: 'group'; group: PaperTypeGroup; open: boolean; active: boolean }
  | { kind: 'leaf'; name: string; count: number; active: boolean }

const rows = computed<Row[]>(() => {
  const list: Row[] = []
  visibleGroups.value.forEach((group) => {
    const open = !collapsed.value.has(group.name)
    list.push({ kind: 'group', group, open, active: isGroupHighlighted(group) })
    if (open) {
      group.items.forEach((item) =>
        list.push({ kind: 'leaf', name: item.name, count: item.count, active: isLeafHighlighted(item.name) }),
      )
    }
  })
  return list
})

function toggleGroup(name: string) {
  const next = new Set(collapsed.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  collapsed.value = next
}

/**
 * 点分类 / 叶子；再点一次已选中的那一项 = 取消选中，即「不筛试卷类型」= 显示全部试卷。
 *
 * 树里**没有「全部试卷」这一行**：知识点树就是这么做的（默认无高亮、点已选项取消），
 * 两棵树并排时才不会一棵有“全部”行、另一棵没有。默认态靠 `selected` 为空表达。
 *
 * 点分类 = 整组选中，此时高亮的只有父级那一行（见 `isLeafHighlighted`）。
 */
function selectGroup(group: PaperTypeGroup) {
  emit('change', isGroupActive(group) ? [] : group.items.map((item) => item.name))
}

function selectLeaf(name: string) {
  emit('change', isLeafActive(name) ? [] : [name])
}
</script>

<template>
  <aside class="panel type-panel">
    <div class="pt-head">试卷类型</div>

    <div class="pt-tree">
      <template
        v-for="row in rows"
        :key="row.kind === 'group' ? `group:${row.group.name}` : `leaf:${row.name}`"
      >
        <!-- 分类（可折叠；点行体 = 选中该分类下全部考试类型，点箭头 = 只折叠） -->
        <div
          v-if="row.kind === 'group'"
          class="pt-item pt-group"
          :class="{ active: row.active }"
          :style="{ paddingLeft: '8px' }"
          @click="selectGroup(row.group)"
        >
          <button
            class="pt-caret"
            :class="{ open: row.open }"
            type="button"
            @click.stop="toggleGroup(row.group.name)"
          >
            <AppIcon name="chevron-down" :size="12" />
          </button>
          <span class="pt-name">{{ row.group.name }}</span>
          <span class="pt-count">{{ row.group.count }}</span>
        </div>

        <!-- 叶子：考试类型 -->
        <div
          v-else
          class="pt-item pt-leaf"
          :class="{ active: row.active }"
          :style="{ paddingLeft: '26px' }"
          @click="selectLeaf(row.name)"
        >
          <span class="pt-dot" />
          <span class="pt-name">{{ row.name }}</span>
          <span class="pt-count">{{ row.count }}</span>
        </div>
      </template>

      <p v-if="visibleGroups.length === 0" class="pt-empty">当前年级 / 学科下暂无可选的试卷类型</p>
    </div>
  </aside>
</template>

<style scoped>
/* 面板尺寸与 KnowledgeFilter 的 .tree-panel 逐项对齐（272px / 12px 内边距 / 同款行高），
   两棵树在工作台里是并排切换的，差一像素都会看出来。
   ⚠️ 类名不要取成 `pt-panel` 这类会与使用方局部类名重名（父组件的 scoped 样式同样会落到
   子组件根节点上，`flex: 1` 会盖掉这里的 `flex-shrink: 0`，树被撑满整行）。 */
.type-panel {
  width: 272px;
  flex-shrink: 0;
  height: 100%;
  padding: 12px;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.pt-head { font-size: 13px; font-weight: 700; color: var(--ink); padding: 2px 4px 10px; flex-shrink: 0; }

/* 树占满剩余高度，仅自身滚动 */
.pt-tree {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
  overflow-y: auto;
}
.pt-item {
  display: flex;
  align-items: center;
  gap: 6px;
  border-radius: 8px;
  padding: 7px 8px;
  font-size: 13px;
  color: var(--ink);
  cursor: pointer;
  transition: background 0.12s;
  user-select: none;
}
.pt-item:hover { background: #f2f6f6; }
/* 选中态与知识点树逐项一致：品牌淡底 + 深色字 + 加粗（层级只靠缩进与箭头区分，不加粗分类行，
   否则「当前选中项」会被分类行的常态加粗盖过去） */
.pt-item.active { background: var(--brand-soft); color: var(--brand-deep); font-weight: 600; }

/* 原生 button 带 UA 边框 / 灰底，这里清掉；展开时箭头转 180° */
.pt-caret {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  appearance: none;
  border: none;
  background: none;
  padding: 0;
  color: var(--sub);
}
.pt-caret svg { transition: transform 0.18s; }
.pt-caret.open svg { transform: rotate(180deg); }
/* 叶子行没有折叠箭头，用一个点占住同样的宽度，两级文字才对得齐 */
.pt-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--border);
  flex-shrink: 0;
  margin: 0 6px;
}
.pt-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pt-count { font-size: 11.5px; color: var(--sub); flex-shrink: 0; }
.pt-item.active .pt-count { color: var(--brand-deep); }
.pt-empty { font-size: 12.5px; color: var(--sub); text-align: center; padding: 20px 0; }
</style>
