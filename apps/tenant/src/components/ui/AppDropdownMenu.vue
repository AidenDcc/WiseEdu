<script lang="ts">
/** 下拉项：key 回传给 `select` 事件，其余只影响展示 */
export interface DropdownItem {
  key: string
  label: string
  icon?: string
  danger?: boolean
  disabled?: boolean
}
</script>

<script setup lang="ts">
/**
 * 通用下拉菜单（点触发器展开，菜单浮在触发元素下方）。
 *
 * 仓库此前没有任何下拉组件 —— 行内操作只能平铺一排 `.mini-btn`
 * （现见 `views/file/FileView`、`views/recycle/RecycleView`），菜单样式则各处手写。
 * 这里移植 `layouts/AppLayout.vue` 用户菜单的交互（点外部 / Esc 收起），并补两点它没有的：
 * 1) 触发器由调用方自带（默认插槽），所以既能当行尾「⋯」用，也能当「新建 ▾」这类带文案的按钮用；
 * 2) 菜单用 Teleport 挂到 body 并 fixed 定位 —— 表格外壳 `.data-table-wrap` 是
 *    `overflow-x: auto`，就地绝对定位的菜单会被横向滚动容器裁掉。
 * 3) 菜单内容默认是 `items` 那一列按钮；给 `panel` 插槽就换成自定义内容（见 `views/file/FileView`
 *    的类型筛选浮层）—— 定位、点外部 / Esc 收起这些容易写错的活还是共用一份。
 *    两个插槽都拿得到 `open`，`panel` 还拿得到 `close`（自定义内容里的「确认」这类按钮要主动收起）。
 */
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { AppIcon } from '@aiteach/shared'

const props = withDefaults(
  defineProps<{
    items?: DropdownItem[]
    /** 菜单与触发元素的横向对齐：right = 右缘对齐（行尾「⋯」用），left = 左缘对齐 */
    align?: 'left' | 'right'
    /** 菜单宽度，默认 168（约 4 个汉字 + 图标） */
    width?: number
  }>(),
  { items: () => [], align: 'right', width: 168 },
)

const emit = defineEmits<{ select: [key: string] }>()

const rootRef = ref<HTMLElement | null>(null)
const menuRef = ref<HTMLElement | null>(null)
const open = ref(false)
const menuStyle = ref<Record<string, string>>({})

const ITEM_H = 36
const MENU_PAD = 12

/** 浮层定位：默认贴触发元素下沿；下方放不开则翻到上方，并夹在视口内 */
function place() {
  const el = rootRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  /* 首选实测高度（place 在 nextTick 里跑，菜单已经在 DOM 上）；
     长菜单按估算值会算多，翻转到上方或夹取时都会偏 */
  const height = menuRef.value?.offsetHeight || props.items.length * ITEM_H + MENU_PAD
  const gap = 6
  const up = rect.bottom + gap + height > window.innerHeight && rect.top - gap - height > 0
  /* 上下都放不开时（长菜单 + 视口矮）夹在视口内，宁可盖住触发元素也别被切掉 */
  const maxTop = Math.max(8, window.innerHeight - height - 8)
  const top = Math.min(Math.max(8, up ? rect.top - gap - height : rect.bottom + gap), maxTop)
  const rawLeft = props.align === 'left' ? rect.left : rect.right - props.width
  const left = Math.min(Math.max(8, rawLeft), Math.max(8, window.innerWidth - props.width - 8))
  menuStyle.value = { top: `${top}px`, left: `${left}px`, width: `${props.width}px` }
}

function toggle() {
  open.value = !open.value
}

function close() {
  open.value = false
}

function pick(item: DropdownItem) {
  if (item.disabled) return
  open.value = false
  emit('select', item.key)
}

function onDocumentClick(event: MouseEvent) {
  const target = event.target as Node
  if (rootRef.value?.contains(target) || menuRef.value?.contains(target)) return
  open.value = false
}

function onEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') open.value = false
}

/* 表格滚动/窗口缩放后原坐标就失效了，直接收起比留一个飘着的菜单更不容易出错 */
function onViewportChange() {
  open.value = false
}

watch(open, (value) => {
  if (value) {
    nextTick(place)
    document.addEventListener('click', onDocumentClick)
    document.addEventListener('keydown', onEscape)
    window.addEventListener('scroll', onViewportChange, true)
    window.addEventListener('resize', onViewportChange)
    return
  }
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onEscape)
  window.removeEventListener('scroll', onViewportChange, true)
  window.removeEventListener('resize', onViewportChange)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onEscape)
  window.removeEventListener('scroll', onViewportChange, true)
  window.removeEventListener('resize', onViewportChange)
})
</script>

<template>
  <span ref="rootRef" class="dd" @click="toggle">
    <slot :open="open" />
    <Teleport to="body">
      <Transition name="dd-fade">
        <div v-if="open" ref="menuRef" class="dd-menu" :style="menuStyle">
          <slot v-if="$slots.panel" name="panel" :open="open" :close="close" />
          <template v-else>
            <button
              v-for="item in items"
              :key="item.key"
              class="dd-item"
              :class="{ danger: item.danger }"
              type="button"
              :disabled="item.disabled"
              @click="pick(item)"
            >
              <AppIcon v-if="item.icon" :name="item.icon" :size="15" />
              <span class="dd-label">{{ item.label }}</span>
            </button>
          </template>
        </div>
      </Transition>
    </Teleport>
  </span>
</template>

<style scoped>
.dd { display: inline-flex; }

.dd-menu {
  position: fixed;
  z-index: 300;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--shadow-lg);
  padding: 6px;
  /* 我的文件的行内「更多」有 14 项，视口矮时改为菜单内部滚动，避免底部被切掉 */
  max-height: calc(100vh - 16px);
  overflow-y: auto;
  /* 窄屏（视口比 width 还窄）下定位会夹到左边距 8px，此时靠这条收住，别溢出屏幕 */
  max-width: calc(100vw - 16px);
}
.dd-item {
  display: flex;
  align-items: center;
  gap: 9px;
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
.dd-item:hover { background: #f2f4fa; }
.dd-item.danger { color: var(--danger); }
.dd-item.danger:hover { background: var(--danger-soft); }
.dd-item:disabled { color: #c3cad8; cursor: not-allowed; background: transparent; }
.dd-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.dd-fade-enter-active, .dd-fade-leave-active { transition: opacity 0.15s, transform 0.15s; }
.dd-fade-enter-from, .dd-fade-leave-to { opacity: 0; transform: translateY(-6px); }
</style>
