<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import JXG from 'jsxgraph'
import katex from 'katex'
import { cleanSvg } from '@/utils/svgClean'
import 'jsxgraph-css'

/**
 * JSXGraph 数学几何绘图（规格模块 3）。
 *
 * 适用：几何题图、受力图、光路图、坐标系、函数图像。硬性约束：只出静态图，
 * 代码层面不调用任何 slider / animation / button API，AI 草稿的交互字段
 * 已在 Schema 校验层（drawSchemaValidator）被过滤，这里只做静态图元。
 *
 * 交互模型：project 是唯一数据源；结构性变化（增删 / 撤销重做）整板重建，
 * 拖拽（图形微调）在原地写回坐标，不动结构。工具栏含撤销 / 重做 / 删除选中 /
 * 网格吸附 / 文本（支持 LaTeX）等。
 */

/* KaTeX 以全局形式供 JSXGraph 的 useKatex 文本渲染（其 renderer 直接引用全局 katex） */
;(window as unknown as { katex: typeof katex }).katex = katex

/* ===== 工程模型（与 mock 网关 AI 草稿同一套 Schema） ===== */
type PointTuple = [number, number]
type JxgElement =
  | { id: string; type: 'point'; x: number; y: number; label?: string }
  | { id: string; type: 'segment'; p1: PointTuple; p2: PointTuple; dash?: boolean }
  | { id: string; type: 'line'; p1: PointTuple; p2: PointTuple; dash?: boolean }
  | { id: string; type: 'circle'; center: PointTuple; through: PointTuple }
  | { id: string; type: 'polygon'; vertices: PointTuple[] }
  | { id: string; type: 'angleMark'; p1: PointTuple; vertex: PointTuple; p2: PointTuple }
  | { id: string; type: 'rightAngleMark'; p1: PointTuple; vertex: PointTuple; p2: PointTuple }
  | { id: string; type: 'text'; x: number; y: number; text: string; latex?: boolean }

interface JxgProject {
  version: 1
  elements: JxgElement[]
}

const props = defineProps<{ initialProjectJson?: string }>()

const project = reactive<JxgProject>({ version: 1, elements: [] })
const selectedId = ref<string | null>(null)
const snapOn = ref(true)
const tool = ref<'select' | 'point' | 'segment' | 'line' | 'circle' | 'polygon' | 'angle' | 'rightangle' | 'text'>('select')
const dirty = ref(false)

const BOARD_ID = `jxg-${Math.random().toString(36).slice(2)}`
let board: JXG.Board | null = null
let seq = 0
const newId = () => `el-${Date.now().toString(36)}-${seq++}`

/* 文本工具的内容输入 */
const textDraft = ref('')
const textLatex = ref(false)

/* ===== 历史栈 ===== */
const undoStack: string[] = []
const redoStack: string[] = []
const canUndo = ref(false)
const canRedo = ref(false)
function refreshFlags() {
  canUndo.value = undoStack.length > 0
  canRedo.value = redoStack.length > 0
}
function pushHistory() {
  undoStack.push(JSON.stringify(project.elements))
  if (undoStack.length > 60) undoStack.shift()
  redoStack.length = 0
  refreshFlags()
}
function undo() {
  const prev = undoStack.pop()
  if (prev == null) return
  redoStack.push(JSON.stringify(project.elements))
  project.elements = JSON.parse(prev)
  selectedId.value = null
  dirty.value = true
  refreshFlags()
  render()
}
function redo() {
  const next = redoStack.pop()
  if (next == null) return
  undoStack.push(JSON.stringify(project.elements))
  project.elements = JSON.parse(next)
  selectedId.value = null
  dirty.value = true
  refreshFlags()
  render()
}

/* ===== 坐标换算与网格吸附 ===== */
function toCoords(event: unknown): [number, number] | null {
  if (!board) return null
  const e = event as { absX?: number; absY?: number }
  if (e.absX == null || e.absY == null) return null
  const rect = board.containerObj.getBoundingClientRect()
  return board.getUsrCoordsOfMouse({ X: e.absX - rect.left, Y: e.absY - rect.top })
}

function snap(pair: [number, number]): [number, number] {
  if (!snapOn.value) return pair
  const step = 0.5
  return [Math.round(pair[0] / step) * step, Math.round(pair[1] / step) * step]
}

/* ===== 渲染：整板重建（结构性变化），拖拽写回（非结构性微调） ===== */
function boardOptions() {
  return {
    boundingBox: [-8, 6, 8, -6],
    axis: true,
    grid: snapOn.value,
    showNavigation: false,
    showCopyright: false,
    pan: { enabled: false },
    zoom: { enabled: false },
    defaultAxes: {
      x: { ticks: { visible: false }, withLabel: false },
      y: { ticks: { visible: false }, withLabel: false },
    },
  } as never
}

const STROKE = '#3a4a63'
const STROKE_SELECTED = '#0a8f9c'

function render() {
  if (!board) return
  const selected = selectedId.value
  JXG.JSXGraph.freeBoard(board)
  board = JXG.JSXGraph.initBoard(BOARD_ID, boardOptions())

  for (const el of project.elements) {
    const color = el.id === selected ? STROKE_SELECTED : STROKE
    switch (el.type) {
      case 'point': {
        const p = board.create('point', [el.x, el.y], {
          name: el.label ?? '',
          size: 3,
          strokeColor: color,
          fillColor: color,
          snapToGrid: snapOn.value,
          snapSizeX: 0.5,
          snapSizeY: 0.5,
        })
        p.on('down', (e: { cancelBubble: boolean }) => {
          e.cancelBubble = true
          selectedId.value = el.id
          render()
        })
        p.on('drag', () => {
          el.x = p.X()
          el.y = p.Y()
          dirty.value = true
        })
        p.on('up', () => pushHistory())
        break
      }
      case 'segment':
      case 'line': {
        const a = board.create('point', [...el.p1], { visible: false, fixed: false })
        const b = board.create('point', [...el.p2], { visible: false, fixed: false })
        const obj = board.create(el.type, [a, b], {
          strokeColor: color,
          strokeWidth: 2,
          dash: el.dash ? 3 : 0,
          fixed: el.type === 'line',
          highlight: true,
        }) as JXG.GeometryElement
        obj.on('down', (e: { cancelBubble: boolean }) => {
          e.cancelBubble = true
          selectedId.value = el.id
          render()
        })
        const writeBack = () => {
          el.p1 = [a.X(), a.Y()]
          el.p2 = [b.X(), b.Y()]
          dirty.value = true
        }
        a.on('drag', writeBack)
        b.on('drag', writeBack)
        obj.on('up', () => pushHistory())
        break
      }
      case 'circle': {
        const c = board.create('point', [...el.center], { visible: false, fixed: false })
        const t = board.create('point', [...el.through], { visible: false, fixed: false })
        const obj = board.create('circle', [c, t], { strokeColor: color, strokeWidth: 2 }) as JXG.GeometryElement
        obj.on('down', (e: { cancelBubble: boolean }) => {
          e.cancelBubble = true
          selectedId.value = el.id
          render()
        })
        const writeBack = () => {
          el.center = [c.X(), c.Y()]
          el.through = [t.X(), t.Y()]
          dirty.value = true
        }
        c.on('drag', writeBack)
        t.on('drag', writeBack)
        obj.on('up', () => pushHistory())
        break
      }
      case 'polygon': {
        const pts = el.vertices.map((v) => board!.create('point', [...v], { visible: false, fixed: false }))
        const obj = board.create('polygon', pts, {
          borders: { strokeColor: color, strokeWidth: 2 },
          fillColor: color,
          fillOpacity: 0.06,
          vertices: { visible: false, fixed: false },
          hasInnerPoints: false,
        }) as JXG.GeometryElement
        obj.on('down', (e: { cancelBubble: boolean }) => {
          e.cancelBubble = true
          selectedId.value = el.id
          render()
        })
        pts.forEach((p, index) => {
          p.on('drag', () => {
            el.vertices[index] = [p.X(), p.Y()]
            dirty.value = true
          })
        })
        obj.on('up', () => pushHistory())
        break
      }
      case 'angleMark':
      case 'rightAngleMark': {
        const a = board.create('point', [...el.p1], { visible: false, fixed: false })
        const v = board.create('point', [...el.vertex], { visible: false, fixed: false })
        const b = board.create('point', [...el.p2], { visible: false, fixed: false })
        const obj = board.create('angle', [a, v, b], {
          type: el.type === 'rightAngleMark' ? 'square' : 'sector',
          radius: 1,
          fillColor: 'none',
          highlightFillColor: 'none',
          strokeColor: color,
          strokeWidth: 1.5,
          fixed: false,
        }) as JXG.GeometryElement
        obj.on('down', (e: { cancelBubble: boolean }) => {
          e.cancelBubble = true
          selectedId.value = el.id
          render()
        })
        const writeBack = () => {
          el.p1 = [a.X(), a.Y()]
          el.vertex = [v.X(), v.Y()]
          el.p2 = [b.X(), b.Y()]
          dirty.value = true
        }
        a.on('drag', writeBack)
        v.on('drag', writeBack)
        b.on('drag', writeBack)
        obj.on('up', () => pushHistory())
        break
      }
      case 'text': {
        const obj = board.create('text', [el.x, el.y, el.text], {
          fontSize: 15,
          color,
          fixed: false,
          useKatex: Boolean(el.latex),
          highlight: false,
        }) as JXG.GeometryElement
        obj.on('down', (e: { cancelBubble: boolean }) => {
          e.cancelBubble = true
          selectedId.value = el.id
          render()
        })
        obj.on('drag', () => {
          const text = obj as unknown as { X: () => number; Y: () => number }
          el.x = text.X()
          el.y = text.Y()
          dirty.value = true
        })
        obj.on('up', () => pushHistory())
        break
      }
    }
  }

  board.on('down', onBoardDown)
}

/* ===== 点击创建（按当前工具） ===== */
let pending: [number, number][] = []

function commitElement(el: JxgElement) {
  pushHistory()
  project.elements.push(el)
  dirty.value = true
  render()
}

function onBoardDown(event: unknown) {
  const raw = toCoords(event)
  if (!raw) return
  const coords = snap(raw)

  switch (tool.value) {
    case 'point':
      commitElement({ id: newId(), type: 'point', x: coords[0], y: coords[1] })
      break
    case 'segment':
    case 'line':
      pending.push(coords)
      if (pending.length === 2) {
        const [p1, p2] = pending
        pending = []
        commitElement({ id: newId(), type: tool.value, p1, p2 })
      } else {
        renderPending()
      }
      break
    case 'circle':
      pending.push(coords)
      if (pending.length === 2) {
        const [center, through] = pending
        pending = []
        commitElement({ id: newId(), type: 'circle', center, through })
      } else {
        renderPending()
      }
      break
    case 'polygon':
      pending.push(coords)
      renderPending(true)
      break
    case 'angle':
    case 'rightangle':
      pending.push(coords)
      if (pending.length === 3) {
        const [p1, vertex, p2] = pending
        pending = []
        commitElement({
          id: newId(),
          type: tool.value === 'angle' ? 'angleMark' : 'rightAngleMark',
          p1,
          vertex,
          p2,
        })
      } else {
        renderPending()
      }
      break
    case 'text': {
      const text = textDraft.value.trim()
      if (!text) return
      commitElement({ id: newId(), type: 'text', x: coords[0], y: coords[1], text, latex: textLatex.value })
      break
    }
    case 'select':
      selectedId.value = null
      render()
      break
  }
}

/** 画未完成的点击轨迹（虚线小点提示下一点该点哪里） */
function renderPending(polygon = false) {
  if (!board || !pending.length) return
  const pts = pending.map((p) => board!.create('point', [...p], { visible: false, fixed: true }))
  if (polygon && pts.length > 1) board.create('polygon', pts, { fillColor: 'none', borders: { dash: 3, strokeColor: '#9aa7bd' }, vertices: { visible: false } })
  for (const p of pending) board.create('point', [...p], { size: 2, face: 'o', fillColor: '#9aa7bd', strokeColor: '#9aa7bd', fixed: true })
}

function finishPolygon() {
  if (tool.value !== 'polygon' || pending.length < 3) return
  const vertices = pending.map((p) => [...p] as PointTuple)
  pending = []
  commitElement({ id: newId(), type: 'polygon', vertices })
}

function deleteSelected() {
  if (!selectedId.value) return
  const index = project.elements.findIndex((el) => el.id === selectedId.value)
  if (index === -1) return
  pushHistory()
  project.elements.splice(index, 1)
  selectedId.value = null
  dirty.value = true
  render()
}

function setTool(next: typeof tool.value) {
  tool.value = next
  pending = []
  if (board) render()
}

/* ===== 导出 / 工程读写（供宿主调用） ===== */
function getProjectJson(): string {
  return JSON.stringify({ version: 1, elements: project.elements })
}

function getSvg(): string {
  if (!board) return ''
  const svg = board.containerObj.querySelector('svg')
  if (!svg) return ''
  /* 导出副本：把 KaTeX 的 foreignObject 也带出去；只读端无外嵌字体时按衬线回退显示 */
  return cleanSvg(svg.outerHTML)
}

defineExpose({
  getProjectJson,
  getSvg,
  isDirty: () => dirty.value,
  markClean: () => {
    dirty.value = false
  },
  undo,
  redo,
  canUndo,
  canRedo,
})

onMounted(() => {
  board = JXG.JSXGraph.initBoard(BOARD_ID, boardOptions())
  if (props.initialProjectJson) {
    try {
      const parsed = JSON.parse(props.initialProjectJson) as JxgProject
      if (Array.isArray(parsed.elements)) project.elements = parsed.elements
    } catch {
      /* 工程损坏时从空白画布开始，不阻塞老师手动绘图 */
    }
  }
  render()
})

onBeforeUnmount(() => {
  if (board) JXG.JSXGraph.freeBoard(board)
  board = null
})
</script>

<template>
  <div class="jxg-editor">
    <div class="jxg-tools">
      <button
        v-for="t in [
          { key: 'select', label: '选择', icon: 'cursor' },
          { key: 'point', label: '点', icon: 'plus' },
          { key: 'segment', label: '线段', icon: 'minus' },
          { key: 'line', label: '直线', icon: 'trend-up' },
          { key: 'circle', label: '圆', icon: 'circle' },
          { key: 'polygon', label: '多边形', icon: 'grid' },
          { key: 'angle', label: '角度标记', icon: 'angle' },
          { key: 'rightangle', label: '直角标记', icon: 'square' },
          { key: 'text', label: '文本 / LaTeX', icon: 'formula' },
        ]"
        :key="t.key"
        class="jxg-tool"
        :class="{ on: tool === t.key }"
        type="button"
        @click="setTool(t.key as never)"
      >
        {{ t.label }}
      </button>
      <span class="jxg-sep" />
      <button class="jxg-tool" type="button" :disabled="!canUndo" @click="undo">撤销</button>
      <button class="jxg-tool" type="button" :disabled="!canRedo" @click="redo">重做</button>
      <button class="jxg-tool danger" type="button" :disabled="!selectedId" @click="deleteSelected">删除选中</button>
      <span class="jxg-sep" />
      <label class="jxg-check">
        <input v-model="snapOn" type="checkbox" @change="render()" /> 网格吸附
      </label>
      <button v-if="tool === 'polygon'" class="jxg-tool accent" type="button" @click="finishPolygon">
        完成多边形（{{ pending.length }} 点）
      </button>
    </div>

    <div v-if="tool === 'text'" class="jxg-text-bar">
      <input v-model="textDraft" class="f-input" placeholder="标注文本，LaTeX 如 \\frac{a}{b}" style="flex: 1" />
      <label class="jxg-check"><input v-model="textLatex" type="checkbox" /> LaTeX</label>
      <span class="jxg-hint">点画布放置文本</span>
    </div>
    <p v-else-if="tool !== 'select'" class="jxg-hint" style="padding: 4px 2px 0">
      <template v-if="tool === 'segment' || tool === 'line'">点击两个端点</template>
      <template v-else-if="tool === 'circle'">先点圆心，再点圆上一点</template>
      <template v-else-if="tool === 'polygon'">逐点点击顶点，最后点「完成多边形」</template>
      <template v-else-if="tool === 'angle' || tool === 'rightangle'">依次点击角的始边点、顶点、终边点</template>
      <template v-else>点击画布放置点</template>
    </p>

    <div :id="BOARD_ID" class="jxg-board" />
  </div>
</template>

<style scoped>
.jxg-editor { display: flex; flex-direction: column; gap: 8px; }
.jxg-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.jxg-tool {
  border: 1.5px solid var(--border); border-radius: 8px; background: #fff;
  color: var(--ink-2); font-size: 12.5px; font-weight: 600; padding: 5px 11px;
  transition: all 0.15s;
}
.jxg-tool:hover:not(:disabled) { border-color: var(--brand); color: var(--brand-deep); }
.jxg-tool.on { border-color: var(--brand); background: var(--brand-soft); color: var(--brand-deep); }
.jxg-tool.danger:hover:not(:disabled) { border-color: #d64545; color: #d64545; }
.jxg-tool.accent { border-color: var(--brand); color: var(--brand-deep); }
.jxg-tool:disabled { opacity: 0.45; cursor: not-allowed; }
.jxg-sep { width: 1px; height: 18px; background: var(--border); margin: 0 3px; }
.jxg-check { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; color: var(--ink-2); cursor: pointer; }
.jxg-text-bar { display: flex; align-items: center; gap: 10px; }
.jxg-hint { font-size: 12px; color: var(--sub); }
.jxg-board {
  width: 100%; height: 440px;
  border: 1px solid var(--border); border-radius: 10px; overflow: hidden;
}
</style>
