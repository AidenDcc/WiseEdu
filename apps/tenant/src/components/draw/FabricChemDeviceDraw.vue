<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { fabric } from 'fabric'
import { AppIcon } from '@aiteach/shared'
import { useFabricCanvas } from '@/composables/useFabricCanvas'
import { CHEM_ELEMENTS } from './chemElements'

/**
 * Fabric 化学实验装置图编辑器（规格模块 4）。
 *
 * 左侧预制元件库（白名单见 chemElements.ts，与 Schema 校验同源），拖拽 / 点击
 *  onto 画布后可缩放、旋转、移动；支持导管连线、文本标注、撤销重做、网格吸附。
 * 纯静态：不使用任何 fabric 动画 API。AI 草稿的未知元件在载入前已被校验层过滤。
 */
const props = defineProps<{ initialProjectJson?: string }>()

const hostEl = ref<HTMLCanvasElement | null>(null)
const {
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
} = useFabricCanvas(() => hostEl.value)

const TOOL_HEIGHT = 90

/** 从元件库拖到画布 */
function onDrop(event: DragEvent) {
  event.preventDefault()
  const elementId = event.dataTransfer?.getData('text/chem-element')
  if (!elementId) return
  const rect = hostEl.value?.getBoundingClientRect()
  const x = event.clientX - (rect?.left ?? 0)
  const y = event.clientY - (rect?.top ?? 0)
  void addElement(elementId, x, y, 0)
}

/** 点击元件 = 添加到画布中心附近（mock 演示更省事，拖拽路径同样可用） */
function onPaletteClick(elementId: string) {
  const c = canvas.value
  if (!c) return
  void addElement(elementId, c.width! / 2 + (Math.random() * 60 - 30), c.height! / 2 + (Math.random() * 40 - 20), 0)
}

async function addElement(elementId: string, x: number, y: number, angle: number) {
  const def = CHEM_ELEMENTS.find((el) => el.id === elementId)
  const c = canvas.value
  if (!def || !c) return
  const group = await new Promise<fabric.Group | null>((resolve) => {
    fabric.loadSVGFromString(def.svg, (objects, options) => {
      resolve(objects.length ? new fabric.Group(objects, options) : null)
    })
  })
  if (!group) return
  const scale = TOOL_HEIGHT / (group.height || TOOL_HEIGHT)
  group.set({
    left: x,
    top: y,
    scaleX: scale,
    scaleY: scale,
    angle,
    /* data.elementId：装置图工程的白名单校验依据 */
    data: { elementId: def.id },
  })
  c.add(group)
  c.setActiveObject(group)
  c.renderAll()
  pushHistory()
  dirty.value = true
}

/* ===== 连线（导管）与文本 ===== */
function addLine() {
  const c = canvas.value
  if (!c) return
  const line = new fabric.Line([80, 340, 260, 340], {
    stroke: '#7f9bb3',
    strokeWidth: 4,
    strokeLineCap: 'round',
  })
  c.add(line)
  c.setActiveObject(line)
  c.renderAll()
  pushHistory()
  dirty.value = true
}

function addText() {
  const c = canvas.value
  if (!c) return
  const text = new fabric.IText('标注文本', {
    left: c.width! / 2 - 40,
    top: 40,
    fontSize: 18,
    fill: '#3a4a63',
    fontFamily: 'sans-serif',
  })
  c.add(text)
  c.setActiveObject(text)
  text.enterEditing()
  c.renderAll()
  pushHistory()
  dirty.value = true
}

onMounted(async () => {
  const instance = init()
  if (props.initialProjectJson) {
    try {
      /* 两种工程格式：AI 网关的元件草稿（elements[].elementId）或 fabric canvas JSON */
      const parsed = JSON.parse(props.initialProjectJson) as {
        elements?: Array<{ elementId?: string; x?: number; y?: number; angle?: number }>
        texts?: Array<{ text?: string; x?: number; y?: number }>
      }
      if (Array.isArray(parsed.elements) && parsed.elements.some((el) => el.elementId)) {
        for (const el of parsed.elements) {
          if (el.elementId) await addElement(el.elementId, el.x ?? 100, el.y ?? 100, el.angle ?? 0)
        }
        for (const t of parsed.texts ?? []) {
          const text = new fabric.IText(t.text ?? '标注', {
            left: t.x ?? 40,
            top: t.y ?? 40,
            fontSize: 18,
            fill: '#3a4a63',
          })
          instance.add(text)
        }
        instance.renderAll()
        pushHistory()
        dirty.value = false
      } else {
        loadProjectJson(props.initialProjectJson)
      }
    } catch {
      /* 工程损坏时从空白画布开始 */
    }
  }
})

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
  deleteSelected,
})
</script>

<template>
  <div class="chem-editor">
    <div class="chem-main">
      <aside class="chem-palette">
        <p class="chem-palette-title">元件库</p>
        <button
          v-for="el in CHEM_ELEMENTS"
          :key="el.id"
          class="chem-item"
          type="button"
          draggable="true"
          @click="onPaletteClick(el.id)"
          @dragstart="$event.dataTransfer?.setData('text/chem-element', el.id)"
        >
          <span class="chem-item-thumb" v-html="el.svg" />
          <span class="chem-item-name">{{ el.name }}</span>
        </button>
      </aside>

      <div class="chem-canvas-wrap">
        <div class="chem-toolbar">
          <button class="chem-btn" type="button" @click="addLine"><AppIcon name="trend-up" :size="14" /> 导管连线</button>
          <button class="chem-btn" type="button" @click="addText"><AppIcon name="edit" :size="14" /> 文本标注</button>
          <span class="chem-sep" />
          <button class="chem-btn" type="button" :disabled="!canUndo" @click="undo">撤销</button>
          <button class="chem-btn" type="button" :disabled="!canRedo" @click="redo">重做</button>
          <button class="chem-btn danger" type="button" @click="deleteSelected">删除选中</button>
          <label class="chem-check"><input v-model="snapOn" type="checkbox" /> 网格吸附</label>
        </div>
        <canvas ref="hostEl" class="chem-canvas" @drop="onDrop" @dragover.prevent />
      </div>
    </div>
  </div>
</template>

<style scoped>
.chem-editor { display: flex; flex-direction: column; gap: 10px; }
.chem-main { display: flex; gap: 12px; }
.chem-palette {
  width: 118px; flex: none;
  border: 1px solid var(--border); border-radius: 10px; padding: 8px;
  display: flex; flex-direction: column; gap: 6px;
  max-height: 470px; overflow-y: auto;
}
.chem-palette-title { font-size: 12px; font-weight: 700; color: var(--ink-2); margin: 0 0 2px; }
.chem-item {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  border: 1.5px solid var(--border); border-radius: 8px; background: #fff;
  padding: 6px 4px; cursor: grab; transition: all 0.15s;
}
.chem-item:hover { border-color: var(--brand); background: var(--brand-soft); }
.chem-item-thumb { width: 40px; height: 48px; display: flex; align-items: center; justify-content: center; }
.chem-item-thumb :deep(svg) { width: 100%; height: 100%; }
.chem-item-name { font-size: 11.5px; color: var(--ink-2); }

.chem-canvas-wrap { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.chem-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.chem-btn {
  display: inline-flex; align-items: center; gap: 5px;
  border: 1.5px solid var(--border); border-radius: 8px; background: #fff;
  color: var(--ink-2); font-size: 12.5px; font-weight: 600; padding: 5px 11px; transition: all 0.15s;
}
.chem-btn:hover:not(:disabled) { border-color: var(--brand); color: var(--brand-deep); }
.chem-btn.danger:hover:not(:disabled) { border-color: #d64545; color: #d64545; }
.chem-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.chem-sep { width: 1px; height: 18px; background: var(--border); margin: 0 3px; }
.chem-check { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; color: var(--ink-2); cursor: pointer; }
.chem-canvas {
  width: 100%; height: 430px;
  border: 1px solid var(--border); border-radius: 10px;
}
</style>
