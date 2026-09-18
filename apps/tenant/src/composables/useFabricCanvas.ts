/**
 * Fabric 画布公共逻辑（化学装置 / 通用简易画布两个编辑器共用）。
 *
 * 负责：canvas 生命周期、撤销 / 重做快照栈、删除选中、网格吸附、
 * 工程 JSON 读写（含自定义 data 属性）与纯净 SVG 导出。
 * 只处理静态图元：不注册任何动画相关 fabric API。
 */
import { onBeforeUnmount, ref, shallowRef } from 'vue'
import { fabric } from 'fabric'
import { cleanSvg } from '@/utils/svgClean'

const GRID = 10
const HISTORY_LIMIT = 60

interface FabricJsonObject {
  type?: string
  styles?: unknown
  objects?: FabricJsonObject[]
}

/**
 * fabric 从 JSON 还原文本对象时，JSON 里没有 styles 会得到 undefined，
 * 之后 toObject() 里 util.stylesToArray 直接读 styles[0] 就抛
 * "Cannot read properties of undefined"（保存 / 导出即失败）。
 * AI 草稿与外部导入的 JSON 都可能缺这个字段，这里统一补成空对象。
 */
function normalizeTextStyles(json: string): string {
  const patch = (objects?: FabricJsonObject[]) => {
    if (!Array.isArray(objects)) return
    for (const obj of objects) {
      if (!obj) continue
      if (obj.styles == null && (obj.type === 'text' || obj.type === 'iText' || obj.type === 'textbox')) obj.styles = {}
      patch(obj.objects)
    }
  }
  try {
    const parsed = JSON.parse(json) as FabricJsonObject
    patch(parsed.objects)
    return JSON.stringify(parsed)
  } catch {
    /* 非法 JSON 原样交给 fabric，由其自身报错 */
    return json
  }
}

export function useFabricCanvas(hostRef: () => HTMLCanvasElement | null) {
  /* shallowRef：fabric.Canvas 是第三方 SDK 实例，深层响应式代理会干扰其内部状态与事件 */
  const canvas = shallowRef<fabric.Canvas | null>(null)
  const snapOn = ref(true)
  const undoStack = ref<string[]>([])
  const redoStack = ref<string[]>([])
  const dirty = ref(false)

  function init(): fabric.Canvas {
    const host = hostRef()
    if (!host) throw new Error('画布容器不存在')
    const instance = new fabric.Canvas(host, {
      width: host.clientWidth || 720,
      height: host.clientHeight || 460,
      backgroundColor: '#ffffff',
      preserveObjectStacking: true,
      selection: true,
    })
    canvas.value = instance

    /* 网格吸附：拖动中按 10px 网格取整（缩放 / 旋转不吸附，避免位置跳动） */
    instance.on('object:moving', (event) => {
      if (!snapOn.value || !event.target) return
      event.target.set({
        left: Math.round(event.target.left! / GRID) * GRID,
        top: Math.round(event.target.top! / GRID) * GRID,
      })
    })
    /* 拖拽 / 旋转 / 缩放结束入历史栈；新增 / 删除由编辑器显式调用 pushHistory
       （loadFromJSON 也会触发 object:added，不能在那里自动入栈） */
    instance.on('object:modified', () => {
      markDirty()
      pushHistory()
    })

    return instance
  }

  function markDirty() {
    dirty.value = true
  }

  function snapshot(): string {
    return JSON.stringify(canvas.value?.toJSON(['data']) ?? {})
  }

  /** 每次结构性变化后压栈（新增 / 删除 / 变换结束） */
  function pushHistory() {
    if (!canvas.value) return
    undoStack.value.push(snapshot())
    if (undoStack.value.length > HISTORY_LIMIT) undoStack.value.shift()
    redoStack.value = []
  }

  const canUndo = ref(false)
  const canRedo = ref(false)
  function refreshFlags() {
    canUndo.value = undoStack.value.length > 0
    canRedo.value = redoStack.value.length > 0
  }

  function undo() {
    const prev = undoStack.value.pop()
    if (prev == null || !canvas.value) return
    redoStack.value.push(snapshot())
    restore(prev)
  }

  function redo() {
    const next = redoStack.value.pop()
    if (next == null || !canvas.value) return
    undoStack.value.push(snapshot())
    restore(next)
  }

  function restore(json: string) {
    canvas.value!.loadFromJSON(json, () => {
      canvas.value!.renderAll()
      refreshFlags()
    })
  }

  function deleteSelected() {
    const active = canvas.value?.getActiveObject()
    if (!active || !canvas.value) return
    pushHistory()
    if ((active as fabric.ActiveSelection).type === 'activeSelection') {
      for (const obj of (active as fabric.ActiveSelection).getObjects()) canvas.value.remove(obj)
    } else {
      canvas.value.remove(active)
    }
    canvas.value.discardActiveObject()
    canvas.value.renderAll()
    markDirty()
  }

  /** 工程 JSON（二次编辑 / 保存草稿用；data 里的 elementId 供装置图校验） */
  function getProjectJson(): string {
    return snapshot()
  }

  function loadProjectJson(json: string) {
    if (!canvas.value) return
    restore(normalizeTextStyles(json))
    dirty.value = false
  }

  /** 纯净 SVG 导出：fabric 私有属性由 cleanSvg 统一剥掉 */
  function getSvg(): string {
    const raw = canvas.value?.toSVG() ?? ''
    return cleanSvg(raw)
  }

  onBeforeUnmount(() => {
    canvas.value?.dispose()
    canvas.value = null
  })

  return {
    canvas,
    snapOn,
    dirty,
    canUndo,
    canRedo,
    init,
    pushHistory,
    undo,
    redo,
    deleteSelected,
    getProjectJson,
    loadProjectJson,
    getSvg,
    refreshFlags,
  }
}
