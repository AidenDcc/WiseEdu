<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { fabric } from 'fabric'
import { AppIcon } from '@aiteach/shared'
import { useFabricCanvas } from '@/composables/useFabricCanvas'
import { readAsDataUrl } from '@/utils/file'

/**
 * 通用 Fabric 简易画布（规格模块 6）。
 * 简单示意图：自由线条、矩形、箭头、文本、本地图片，导出静态 SVG。
 */
const props = defineProps<{ initialProjectJson?: string }>()

const hostEl = ref<HTMLCanvasElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
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

function addRect() {
  const c = canvas.value
  if (!c) return
  const rect = new fabric.Rect({
    left: c.width! / 2 - 70,
    top: c.height! / 2 - 45,
    width: 140,
    height: 90,
    fill: 'transparent',
    stroke: '#3a4a63',
    strokeWidth: 2,
  })
  c.add(rect)
  c.setActiveObject(rect)
  c.renderAll()
  pushHistory()
  dirty.value = true
}

function addLine() {
  const c = canvas.value
  if (!c) return
  const line = new fabric.Line([60, 320, 260, 320], { stroke: '#3a4a63', strokeWidth: 2.5, strokeLineCap: 'round' })
  c.add(line)
  c.setActiveObject(line)
  c.renderAll()
  pushHistory()
  dirty.value = true
}

function addArrow() {
  const c = canvas.value
  if (!c) return
  const line = new fabric.Line([60, 320, 250, 320], { stroke: '#3a4a63', strokeWidth: 2.5, strokeLineCap: 'round' })
  const head = new fabric.Triangle({
    left: 250,
    top: 320,
    width: 12,
    height: 12,
    fill: '#3a4a63',
    angle: 90,
    originX: 'center',
    originY: 'center',
  })
  const group = new fabric.Group([line, head])
  c.add(group)
  c.setActiveObject(group)
  c.renderAll()
  pushHistory()
  dirty.value = true
}

function addText() {
  const c = canvas.value
  if (!c) return
  const text = new fabric.IText('文本', {
    left: c.width! / 2 - 30,
    top: 40,
    fontSize: 18,
    fill: '#3a4a63',
  })
  c.add(text)
  c.setActiveObject(text)
  text.enterEditing()
  c.renderAll()
  pushHistory()
  dirty.value = true
}

async function onImageChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  const c = canvas.value
  if (!file || !c) return
  if (!file.type.startsWith('image/')) return
  const dataUrl = await readAsDataUrl(file)
  fabric.Image.fromURL(dataUrl, (img) => {
    img.set({ left: 80, top: 60 })
    img.scaleToWidth(180)
    c.add(img)
    c.setActiveObject(img)
    c.renderAll()
    pushHistory()
    dirty.value = true
  })
}

onMounted(() => {
  init()
  if (props.initialProjectJson) {
    try {
      loadProjectJson(props.initialProjectJson)
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
  <div class="gen-editor">
    <div class="gen-toolbar">
      <button class="gen-btn" type="button" @click="addLine"><AppIcon name="trend-up" :size="14" /> 线条</button>
      <button class="gen-btn" type="button" @click="addArrow"><AppIcon name="arrow-right" :size="14" /> 箭头</button>
      <button class="gen-btn" type="button" @click="addRect"><AppIcon name="grid" :size="14" /> 矩形</button>
      <button class="gen-btn" type="button" @click="addText"><AppIcon name="edit" :size="14" /> 文本</button>
      <button class="gen-btn" type="button" @click="fileInput?.click()"><AppIcon name="image" :size="14" /> 图片</button>
      <span class="gen-sep" />
      <button class="gen-btn" type="button" :disabled="!canUndo" @click="undo">撤销</button>
      <button class="gen-btn" type="button" :disabled="!canRedo" @click="redo">重做</button>
      <button class="gen-btn danger" type="button" @click="deleteSelected">删除选中</button>
      <label class="gen-check"><input v-model="snapOn" type="checkbox" /> 网格吸附</label>
    </div>
    <canvas ref="hostEl" class="gen-canvas" />
    <input ref="fileInput" type="file" accept="image/*" style="display: none" @change="onImageChange" />
  </div>
</template>

<style scoped>
.gen-editor { display: flex; flex-direction: column; gap: 8px; }
.gen-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.gen-btn {
  display: inline-flex; align-items: center; gap: 5px;
  border: 1.5px solid var(--border); border-radius: 8px; background: #fff;
  color: var(--ink-2); font-size: 12.5px; font-weight: 600; padding: 5px 11px; transition: all 0.15s;
}
.gen-btn:hover:not(:disabled) { border-color: var(--brand); color: var(--brand-deep); }
.gen-btn.danger:hover:not(:disabled) { border-color: #d64545; color: #d64545; }
.gen-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.gen-sep { width: 1px; height: 18px; background: var(--border); margin: 0 3px; }
.gen-check { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; color: var(--ink-2); cursor: pointer; }
.gen-canvas {
  width: 100%; height: 430px;
  border: 1px solid var(--border); border-radius: 10px;
}
</style>
