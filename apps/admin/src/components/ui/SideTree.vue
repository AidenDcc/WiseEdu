<script setup lang="ts">
/**
 * 左侧导航树（通用、可多级嵌套，自递归渲染）。
 * 用于平台端「公共题库 / 公共试卷库」对齐机构端列表页的左树布局：
 * 选中节点回传 id，由宿主把 id 翻译成筛选条件。
 */
import { reactive } from 'vue'

export interface SideTreeNode {
  id: string
  label: string
  count?: number
  children?: SideTreeNode[]
}

const props = defineProps<{
  nodes: SideTreeNode[]
  selected: string
  /** 默认展开带子节点的节点 */
  defaultExpand?: boolean
}>()

const emit = defineEmits<{ select: [id: string] }>()

const openMap = reactive<Record<string, boolean>>(
  Object.fromEntries(props.nodes.map((node) => [node.id, !!props.defaultExpand])),
)

function toggle(id: string) {
  openMap[id] = !openMap[id]
}

function isOpen(node: SideTreeNode) {
  return openMap[node.id] ?? !!props.defaultExpand
}
</script>

<template>
  <nav class="side-tree">
    <template v-for="node in nodes" :key="node.id">
      <!-- 分组（有子节点）：标题可展开 / 收起，点击标题即选中该分组 -->
      <div v-if="node.children?.length" class="st-group">
        <button type="button" class="st-head" :class="{ on: selected === node.id }" @click="emit('select', node.id)">
          <span class="st-caret" @click.stop="toggle(node.id)">{{ isOpen(node) ? '▾' : '▸' }}</span>
          <span class="st-label">{{ node.label }}</span>
          <span v-if="node.count !== undefined" class="st-count">{{ node.count }}</span>
        </button>
        <div v-if="isOpen(node)" class="st-children">
          <SideTree :nodes="node.children" :selected="selected" :default-expand="defaultExpand" @select="(id) => emit('select', id)" />
        </div>
      </div>

      <!-- 叶子：直接选中 -->
      <button
        v-else
        type="button"
        class="st-leaf"
        :class="{ on: selected === node.id }"
        @click="emit('select', node.id)"
      >
        <span class="st-label">{{ node.label }}</span>
        <span v-if="node.count !== undefined" class="st-count">{{ node.count }}</span>
      </button>
    </template>
  </nav>
</template>

<style scoped>
.side-tree { display: flex; flex-direction: column; gap: 2px; }
.st-group { display: flex; flex-direction: column; }
.st-head,
.st-leaf {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  border: none;
  background: transparent;
  font-family: inherit;
  font-size: 13px;
  color: var(--ink-2);
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s, color 0.15s;
}
.st-head:hover,
.st-leaf:hover { background: #f2f5f8; }
.st-head.on,
.st-leaf.on {
  background: var(--brand-soft);
  color: var(--brand-deep);
  font-weight: 700;
}
.st-caret {
  width: 14px;
  font-size: 10px;
  color: var(--sub);
  flex-shrink: 0;
}
.st-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.st-count {
  font-size: 11px;
  color: var(--sub);
  background: #eef1f5;
  border-radius: 999px;
  padding: 1px 7px;
  flex-shrink: 0;
}
.st-head.on .st-count,
.st-leaf.on .st-count { background: #fff; }
.st-children {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-left: 16px;
  border-left: 1px solid var(--border);
  margin-left: 16px;
}
</style>
