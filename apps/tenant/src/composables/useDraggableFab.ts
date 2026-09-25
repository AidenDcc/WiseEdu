/**
 * 悬浮按钮的拖拽定位（右下角 AI 问答入口）。
 *
 * 仓库里没有现成的拖拽工具（既有 drag 都是 HTML5 拖放，或画布库自带的对象拖拽），
 * 这里按悬浮球的需要自建，三点考量：
 *
 * 1. 用 pointer 事件 + setPointerCapture，而不是 mousedown/mousemove/mouseup：
 *    触摸与触控笔同样可用，且指针移出窗口 / 划过其它元素后不丢轨迹 —— capture 把后续
 *    事件锁定在按钮自己身上。**组件侧必须给按钮加 `touch-action: none`**，否则移动端
 *    拖动会先触发页面滚动。
 * 2. 位移超过阈值才算拖拽：用户「想点一下」时手难免抖几像素，若不加阈值，按钮被挪了位
 *    却没打开面板，用起来会觉得「点不动」。
 * 3. 位置在拖动结束与窗口尺寸变化时都重新钳制到视口内，避免窗口缩小后按钮留在视口外
 *    再也点不到；位置写入 localStorage 记忆，键名沿用 `aiteach:<appName>:<thing>` 规范。
 *
 * 首帧位置在 setup 阶段就算好（元素尺寸由 CSS 固定，作为参数传入），
 * 否则刷新时会先闪一下默认位置再跳到记忆位置。
 */
import { computed, onBeforeUnmount, ref, type ComputedRef, type Ref } from 'vue'
import { getAppConfig } from '@aiteach/shared'

const POS_KEY = `aiteach:${getAppConfig().appName}:ai-fab-pos`
/** 按钮与视口边缘的最小间距 */
const MARGIN = 12
/** 判定为「拖拽」而非「点击」的位移阈值（px） */
const DRAG_THRESHOLD = 4

interface StoredPosition {
  left: number
  top: number
}

export interface DraggableFabOptions {
  /** 按钮边长（CSS 固定值），用于首帧定位与钳制 */
  size?: number
  /** 无记忆位置时的默认右下角边距 */
  defaultRight?: number
  defaultBottom?: number
}

export interface DraggableFab {
  /** 绑定到按钮的 :style（按钮自身样式里是 position: fixed） */
  style: ComputedRef<{ left: string; top: string }>
  /** 拖动中：组件据此关掉过渡动画、把光标切成抓取态 */
  dragging: Ref<boolean>
  /**
   * 取「本次点按是否来自拖拽」并复位 —— 组件的 click 处理器里先问它，是拖拽就什么都不做。
   * 自带复位（而非在 pointerup 里延时复位）是为了照顾键盘触发：Enter/Space 只派发 click
   * 而没有 pointerdown，若标记不复位，拖过一次之后键盘就再也打不开面板了。
   */
  consumeDrag: () => boolean
  onPointerDown: (event: PointerEvent) => void
  onPointerMove: (event: PointerEvent) => void
  onPointerUp: (event: PointerEvent) => void
}

export function useDraggableFab(
  el: Ref<HTMLElement | null>,
  options: DraggableFabOptions = {},
): DraggableFab {
  const size = options.size ?? 56
  const defaultRight = options.defaultRight ?? 24
  const defaultBottom = options.defaultBottom ?? 88

  const dragging = ref(false)
  /** 拖动过程中的位置（不写 localStorage，松手才落盘） */
  const position = ref<StoredPosition>(readStoredPosition() ?? defaultPosition())
  /** 指针按下时的起点，用来算位移 */
  let origin = { x: 0, y: 0, left: 0, top: 0 }
  let moved = false
  /** 正在拖拽的指针 id：多指触摸时只认第一根手指，别被第二根带跑 */
  let activePointer = -1

  /**
   * 实际按钮尺寸：能测到就以实测为准，测不到（未挂载、或面板打开时被 v-show 隐藏成
   * display:none —— 此时 offsetWidth 为 0）时退回 CSS 约定值。不能拿 0 去钳制，
   * 否则窗口 resize 会把按钮算到视口最右边去。
   */
  function currentSize(): { width: number; height: number } {
    const node = el.value
    return {
      width: node?.offsetWidth || size,
      height: node?.offsetHeight || size,
    }
  }

  /** 钳制到视口内（视口比按钮还小时贴左上角，至少保证能点到） */
  function clamp(target: StoredPosition): StoredPosition {
    const { width, height } = currentSize()
    return {
      left: Math.min(Math.max(target.left, MARGIN), Math.max(window.innerWidth - width - MARGIN, MARGIN)),
      top: Math.min(Math.max(target.top, MARGIN), Math.max(window.innerHeight - height - MARGIN, MARGIN)),
    }
  }

  function defaultPosition(): StoredPosition {
    return clamp({
      left: window.innerWidth - defaultRight - size,
      top: window.innerHeight - defaultBottom - size,
    })
  }

  /** 读取记忆位置；结构非法（改坏 / 旧版本）时当作没有记忆，退回默认位置 */
  function readStoredPosition(): StoredPosition | null {
    try {
      const raw = localStorage.getItem(POS_KEY)
      if (!raw) return null
      const parsed: unknown = JSON.parse(raw)
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        typeof (parsed as StoredPosition).left !== 'number' ||
        typeof (parsed as StoredPosition).top !== 'number'
      ) {
        return null
      }
      const { left, top } = parsed as StoredPosition
      return Number.isFinite(left) && Number.isFinite(top) ? clamp({ left, top }) : null
    } catch {
      return null
    }
  }

  function persist(): void {
    try {
      localStorage.setItem(POS_KEY, JSON.stringify(position.value))
    } catch {
      /* 存不下就算了：位置记忆是便利功能，不该影响按钮可用 */
    }
  }

  /** 窗口尺寸变化后按钮可能落到视口外，重新钳制一次 */
  function onResize(): void {
    position.value = clamp(position.value)
  }

  function onPointerDown(event: PointerEvent): void {
    /* 只响应主键（右键 / 中键不拖），触摸与笔的 button 也是 0；已在拖拽中则忽略后来者 */
    if (event.button !== 0 || dragging.value) return
    activePointer = event.pointerId
    origin = { x: event.clientX, y: event.clientY, left: position.value.left, top: position.value.top }
    moved = false
    dragging.value = true
    try {
      el.value?.setPointerCapture(event.pointerId)
    } catch {
      /* 指针已失效时 capture 会抛错：放弃 capture，退化成普通拖拽即可 */
    }
  }

  function onPointerMove(event: PointerEvent): void {
    if (!dragging.value || event.pointerId !== activePointer) return
    const dx = event.clientX - origin.x
    const dy = event.clientY - origin.y
    if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
    moved = true
    position.value = clamp({ left: origin.left + dx, top: origin.top + dy })
  }

  function onPointerUp(event: PointerEvent): void {
    if (!dragging.value || event.pointerId !== activePointer) return
    dragging.value = false
    try {
      el.value?.releasePointerCapture(event.pointerId)
    } catch {
      /* 未持有 capture（pointercancel 之后）时释放会抛错 */
    }
    activePointer = -1
    /* 只在真的拖过之后落盘，避免每次点击都写一次 localStorage */
    if (moved) persist()
    /* moved 不复位：紧跟其后的 click 要靠它认出「这次是拖拽」，由 consumeDrag() 复位 */
  }

  window.addEventListener('resize', onResize)
  onBeforeUnmount(() => window.removeEventListener('resize', onResize))

  return {
    style: computed(() => ({ left: `${position.value.left}px`, top: `${position.value.top}px` })),
    dragging,
    consumeDrag: () => {
      const dragged = moved
      moved = false
      return dragged
    },
    onPointerDown,
    onPointerMove,
    onPointerUp,
  }
}
