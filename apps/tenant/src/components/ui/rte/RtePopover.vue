<script setup lang="ts">
/**
 * 富文本工具栏的弹层外壳（触发按钮 + 浮层）。定位、点外部 / Esc 收起照抄 `AppDropdownMenu.vue`，
 * 它多做两件工具栏专属的事：
 *
 * 1. **Teleport 到 body 并 `@mousedown.prevent`**。工具栏靠 `.rte-toolbar` 上的 `@mousedown.prevent`
 *    保住正文的焦点与选区，而 Teleport 出去的面板不在那棵子树里 —— 不自己 prevent 就会
 *    「点一下面板 → 正文 blur → 工具栏收起 → 这一下点不实」。顺带绕开弹窗里
 *    `.modal-body { overflow-y: auto }` 对就地浮层的裁剪（录题弹窗正是这种容器）。
 * 2. 面板上打 `data-rte-popover` 标记：面板里的输入框需要正常获得焦点（列宽 / 行高的 px 输入），
 *    所以它上面的 mousedown 要 `stop` 而不是 `prevent`，这会让编辑器的 focusout 事件里
 *    `relatedTarget` 落在 body 下的面板里 —— RichTextEditor 靠这个标记认出「焦点还在自己身上」，
 *    否则一点输入框整条工具栏就收起来了。
 */
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 面板宽度（px） */
    width?: number
    /** 与触发按钮的对齐方式：left = 左缘对齐 */
    align?: 'left' | 'right'
  }>(),
  { width: 200, align: 'left' },
)

const emit = defineEmits<{
  /**
   * 面板收起。给「失焦即生效」的输入框做的兜底时机：面板上的 mousedown 是 prevent 的，
   * 点面板里的按钮 / 色块不会让输入框失焦，宿主收不到 blur，只能靠这里补一次提交。
   */
  close: []
}>()

const rootRef = ref<HTMLElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const open = ref(false)
const panelStyle = ref<Record<string, string>>({})

/** 收放都走这里：只有真的从「开着」变成「关掉」才抛事件，重复收起不抛 */
function setOpen(value: boolean) {
  if (open.value === value) return
  open.value = value
  if (!value) emit('close')
}

/** 浮层定位：默认贴触发按钮下沿；下方放不开则翻到上方，并夹在视口内 */
function place() {
  const el = rootRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const height = panelRef.value?.offsetHeight || 200
  const gap = 6
  const up = rect.bottom + gap + height > window.innerHeight && rect.top - gap - height > 0
  const maxTop = Math.max(8, window.innerHeight - height - 8)
  const top = Math.min(Math.max(8, up ? rect.top - gap - height : rect.bottom + gap), maxTop)
  const rawLeft = props.align === 'left' ? rect.left : rect.right - props.width
  const left = Math.min(Math.max(8, rawLeft), Math.max(8, window.innerWidth - props.width - 8))
  panelStyle.value = { top: `${top}px`, left: `${left}px`, width: `${props.width}px` }
}

function toggle() {
  setOpen(!open.value)
}

function close() {
  setOpen(false)
}

function onDocumentClick(event: MouseEvent) {
  const target = event.target as Node
  if (rootRef.value?.contains(target) || panelRef.value?.contains(target)) return
  setOpen(false)
}

function onEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') setOpen(false)
}

/* 滚动 / 缩放后原坐标就失效了，直接收起比留一个飘着的面板更不容易出错；
   但面板自己内部的滚动（候选多时 max-height 会出滚动条）不算 —— 否则滚一下选择就没了 */
function onViewportChange(event: Event) {
  const target = event.target as Node | null
  if (target && panelRef.value?.contains(target)) return
  setOpen(false)
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

defineExpose({ close, toggle })
</script>

<template>
  <span ref="rootRef" class="rte-pop" @mousedown.prevent>
    <slot name="trigger" :open="open" :toggle="toggle" />
    <Teleport to="body">
      <Transition name="rte-pop-fade">
        <div
          v-if="open"
          ref="panelRef"
          class="rte-pop-panel"
          :style="panelStyle"
          data-rte-popover
          @mousedown.prevent
        >
          <slot :close="close" />
        </div>
      </Transition>
    </Teleport>
  </span>
</template>

<style scoped>
.rte-pop { display: inline-flex; }

/* 面板本体在 body 下（Teleport），scoped 样式仍能命中 —— 编译后带的是同一份 data-v 属性 */
.rte-pop-panel {
  position: fixed;
  z-index: 320;
  padding: 6px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--shadow-lg);
  max-height: calc(100vh - 16px);
  overflow-y: auto;
  max-width: calc(100vw - 16px);
}

.rte-pop-fade-enter-active,
.rte-pop-fade-leave-active { transition: opacity 0.14s, transform 0.14s; }
.rte-pop-fade-enter-from,
.rte-pop-fade-leave-to { opacity: 0; transform: translateY(-6px); }
</style>
