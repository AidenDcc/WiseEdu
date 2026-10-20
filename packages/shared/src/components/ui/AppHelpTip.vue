<script setup lang="ts">
/**
 * 行内提示：标题 / 标签旁的小问号，hover 或点击弹出说明浮层。
 *
 * 为什么用 Teleport + fixed 定位，而不是在父元素里 relative + absolute：
 * 需要提示的地方大多是表头、表格单元格、卡片标题，它们往往落在 `.data-table-wrap`
 * （`overflow-x: auto`）这类会裁切溢出内容的容器里 —— 绝对定位的浮层会被直接剪掉。
 * 用 fixed + 触发元素的 rect 计算坐标，表格里外行为一致；同时把左侧/上侧夹在视口内，
 * 靠右的表头（如「操作」列）不会把浮层顶出屏幕。
 *
 * 交互约定：
 * - 悬停临时显示，移开即收；
 * - 点击可「钉住」（需求里的「点击可查看」），再点一次或点空白处收起；
 * - `stop` 默认开：宿主常在可点击的行 / 卡片里放它，避免顺带触发外层跳转。
 */
import { nextTick, onBeforeUnmount, ref } from 'vue'
import AppIcon from '../AppIcon.vue'

const props = withDefaults(
  defineProps<{
    /** 浮层标题（可选） */
    title?: string
    /** 正文；支持 \n 分段（一条一行），避免在模板里拼长串 */
    text: string
    /** 图标尺寸 */
    size?: number
    /** 浮层宽度 */
    width?: number
    /** 点击时阻止冒泡（表格行 / 卡片整体可点击时必须开） */
    stop?: boolean
  }>(),
  { size: 14, width: 288, stop: true },
)

const visible = ref(false)
/** 点击钉住：钉住后鼠标移开不收起 */
const pinned = ref(false)
const trigger = ref<HTMLElement | null>(null)
const pop = ref<HTMLElement | null>(null)
const popStyle = ref<Record<string, string>>({})

/** 浮层与触发图标之间的间距；离视口边缘至少留 8px */
const GAP = 8
const EDGE = 8

function place() {
  const el = trigger.value
  const box = pop.value
  if (!el || !box) return
  const rect = el.getBoundingClientRect()
  const height = box.offsetHeight
  /* 上方放得下就朝上，否则朝下：靠近表格首行时朝上会盖住表头本身 */
  const above = rect.top >= height + GAP + EDGE
  const top = above ? rect.top - height - GAP : rect.bottom + GAP
  /* 水平居中于图标，再夹进视口 —— 否则靠右列的提示会露出一半在屏幕外 */
  const centered = rect.left + rect.width / 2 - props.width / 2
  const maxLeft = window.innerWidth - props.width - EDGE
  const left = Math.max(EDGE, Math.min(centered, Math.max(EDGE, maxLeft)))
  popStyle.value = { top: `${Math.round(top)}px`, left: `${Math.round(left)}px`, width: `${props.width}px` }
}

async function show() {
  visible.value = true
  await nextTick()
  place()
}

function hide() {
  visible.value = false
  pinned.value = false
}

function onEnter() {
  if (!visible.value) void show()
}

function onLeave() {
  if (!pinned.value) visible.value = false
}

function onClick(event: MouseEvent) {
  if (props.stop) event.stopPropagation()
  if (pinned.value) {
    hide()
    return
  }
  pinned.value = true
  void show()
}

/** 点到浮层与图标以外的地方（含表格其它区域）收起钉住态 */
function onDocDown(event: MouseEvent) {
  if (!visible.value) return
  const target = event.target as Node | null
  if (trigger.value?.contains(target) || pop.value?.contains(target)) return
  hide()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') hide()
}

/** 滚动时收起：fixed 坐标不会跟着页面走，浮层留在原地会「飘」 */
function onScroll() {
  hide()
}

if (typeof document !== 'undefined') {
  document.addEventListener('mousedown', onDocDown, true)
  document.addEventListener('keydown', onKeydown)
  window.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', onScroll)
}

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocDown, true)
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('scroll', onScroll, true)
  window.removeEventListener('resize', onScroll)
})
</script>

<template>
  <button
    ref="trigger"
    type="button"
    class="help-tip"
    aria-label="查看说明"
    :aria-expanded="visible"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
    @click="onClick"
    @focus="onEnter"
    @blur="onLeave"
  >
    <AppIcon name="help" :size="size" />
  </button>

  <Teleport to="body">
    <div v-if="visible" ref="pop" class="help-tip-pop" :style="popStyle" role="tooltip">
      <p v-if="title" class="ht-title">{{ title }}</p>
      <p class="ht-text">{{ text }}</p>
    </div>
  </Teleport>
</template>

<style scoped>
.help-tip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--sub, #8a94a6);
  cursor: help;
  border-radius: 50%;
  vertical-align: middle;
  transition: color 0.15s;
}
.help-tip:hover,
.help-tip:focus-visible {
  color: var(--brand, #1f8a70);
  outline: none;
}

.help-tip-pop {
  position: fixed;
  z-index: 4000;
  background: var(--card, #fff);
  border: 1px solid var(--border, #e4e9ef);
  border-radius: 10px;
  box-shadow: 0 12px 30px rgba(20, 32, 48, 0.16);
  padding: 12px 14px;
  text-align: left;
  pointer-events: auto;
  /* 说明可能好几段：超过 60vh 内部滚动，别让浮层高到把触发点挤出屏幕 */
  max-height: 60vh;
  overflow-y: auto;
}
.ht-title {
  margin: 0 0 6px;
  font-size: 13px;
  font-weight: 700;
  color: var(--ink, #1c2430);
}
.ht-text {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.75;
  color: var(--ink-2, #4a5568);
  /* 用 \n 分段：一条一句，比在模板里拼一堆 <p> 好维护 */
  white-space: pre-line;
  word-break: break-word;
}
</style>
