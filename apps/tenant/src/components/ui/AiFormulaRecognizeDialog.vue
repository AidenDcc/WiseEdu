<script setup lang="ts">
/**
 * AI 识图（公式拍照识别）。
 *
 * 三条取图通路，收口到同一个 accept()：
 * - 点选本地图片（文件选择框）；
 * - 把图片拖进虚线框；
 * - 直接 Ctrl/Cmd + V 粘贴（截图后最顺手的一条，故监听挂在 document 上，
 *   而不是等用户先点一下虚线框 —— 焦点此刻可能还在它下面的公式输入框里）。
 *
 * 取到图就立刻开始识别（不再让用户多点一次「开始识别」）；识别完把 LaTeX 放进一个
 * **可编辑的源码框** + KaTeX 预览，用户可以就地改错字再确认 —— OCR 出来的公式十有八九
 * 有一两个符号要修，只给只读结果会逼着人重来一遍。
 *
 * 本组件被两处复用：内联公式输入框的下拉、公式编辑器弹窗 LaTeX 框后的按钮，
 * 两处都只关心「确认后拿到一段 LaTeX」，所以对外只 emit confirm(latex)。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { AppIcon, AppModal, katex, showToast } from '@aiteach/shared'
import 'katex/dist/katex.min.css'
import { formulaOcrEngine, recognizeFormulaImage, type FormulaOcrEngine } from '@/api/ai-formula'

const props = withDefaults(
  defineProps<{
    /**
     * 遮罩层级。默认 120；从公式编辑器弹窗（也是 120）里打开时要抬到 130，
     * 否则同层按 DOM 顺序叠，弹窗之间的盖压关系会变得不可预期。见 AppModal 的 zIndex 注释。
     */
    zIndex?: number
  }>(),
  { zIndex: 120 },
)

const emit = defineEmits<{
  close: []
  /** 确认写入公式输入框 / LaTeX 源码框 */
  confirm: [latex: string]
}>()

/** 当前引擎：vision = 真实多模态模型，mock = 本地演示数据 */
const engine = ref<FormulaOcrEngine>(formulaOcrEngine())

const fileInput = ref<HTMLInputElement | null>(null)
/** 已选中的本地图片（Object URL 预览，替换 / 卸载时释放） */
const thumb = ref('')
const fileName = ref('')
const busy = ref(false)
const dragOver = ref(false)
/** 识别结果（可编辑） */
const latex = ref('')
const note = ref('')

const ready = computed(() => Boolean(latex.value.trim()) && !busy.value)

/** 结果预览：语法非法不抛错，回退展示提示而不是空白 */
const previewHtml = computed(() => {
  const value = latex.value.trim()
  if (!value) return ''
  try {
    return katex.renderToString(value, { throwOnError: false })
  } catch {
    return '<span class="ari-bad">LaTeX 语法有误</span>'
  }
})

function revokeThumb() {
  if (thumb.value) URL.revokeObjectURL(thumb.value)
  thumb.value = ''
}

/** 取到图片就识别：三条取图通路唯一的落点 */
async function accept(file: File) {
  if (!file.type.startsWith('image/')) {
    showToast('请选择图片文件', 'error')
    return
  }
  revokeThumb()
  thumb.value = URL.createObjectURL(file)
  fileName.value = file.name || '粘贴的图片'
  latex.value = ''
  note.value = ''
  busy.value = true
  try {
    const result = await recognizeFormulaImage(file)
    latex.value = result.latex
    engine.value = result.engine
    note.value = result.note ?? ''
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'AI 识别失败，请重试', 'error')
  } finally {
    busy.value = false
  }
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) void accept(file)
  /* 清空以便连续选择同一张图也能触发 change */
  input.value = ''
}

function imageOf(dt: DataTransfer | null): File | null {
  if (!dt) return null
  for (const item of Array.from(dt.files)) {
    if (item.type.startsWith('image/')) return item
  }
  return null
}

function onDrop(event: DragEvent) {
  dragOver.value = false
  const file = imageOf(event.dataTransfer)
  if (file) void accept(file)
}

/** 粘贴：图片可能在 items（截图）或 files（复制的文件）里，两处都找一遍 */
function onPaste(event: ClipboardEvent) {
  const file = imageOf(event.clipboardData)
  if (!file) return
  event.preventDefault()
  void accept(file)
}

function confirm() {
  const value = latex.value.trim()
  if (!value) {
    showToast('请先识别出公式', 'error')
    return
  }
  emit('confirm', value)
}

onMounted(() => document.addEventListener('paste', onPaste))
onBeforeUnmount(() => {
  revokeThumb()
  document.removeEventListener('paste', onPaste)
})
</script>

<template>
  <AppModal title="AI 识图" :width="620" :z-index="props.zIndex" @close="emit('close')">
    <p class="ari-lead">
      上传或粘贴一张公式图片，AI 自动转成 LaTeX 源码；识别结果可以就地修改后再确认。
    </p>

    <!-- 未取图：虚线框同时是三件事的入口（点选 / 拖入 / 粘贴） -->
    <div v-if="!thumb" class="ari-drop" :class="{ over: dragOver }" @click="fileInput?.click()" @dragover.prevent="dragOver = true" @dragleave="dragOver = false" @drop.prevent="onDrop">
      <AppIcon name="image" :size="30" />
      <p class="ari-drop-title">点击选择图片，或拖到这里</p>
      <p class="f-hint">也支持直接粘贴（Ctrl / ⌘ + V）截图；图片只用于本次识别，不会存入媒体库</p>
    </div>

    <div v-else class="ari-body">
      <div class="ari-thumb">
        <img :src="thumb" :alt="fileName" />
        <span class="ari-thumb-name">{{ fileName }}</span>
        <button class="mini-btn" type="button" @click="fileInput?.click()">换一张</button>
      </div>

      <p v-if="busy" class="ari-status">
        <AppIcon name="sparkles" :size="15" />
        正在识别公式…
      </p>

      <template v-else>
        <div class="f-field">
          <label class="f-label">
            LaTeX 源码<span class="req">*</span>
            <span class="ari-engine" :class="engine">{{ engine === 'vision' ? 'AI 识别' : '本地演示' }}</span>
          </label>
          <textarea v-model="latex" class="f-textarea" rows="2" placeholder="识别结果会填在这里，可直接修改" />
          <p v-if="note" class="f-hint">
            识别通道不可用（{{ note }}），已填入演示公式；配好视觉模型后即为真实识别结果。
          </p>
        </div>

        <div class="f-field">
          <label class="f-label">预览</label>
          <div class="ari-preview">
            <span v-if="!previewHtml" class="f-hint">暂无预览</span>
            <span v-else v-html="previewHtml" />
          </div>
        </div>
      </template>
    </div>

    <input ref="fileInput" type="file" accept="image/*" class="ari-file" @change="onFileChange" />

    <template #footer>
      <button class="btn btn-ghost" type="button" @click="emit('close')">取消</button>
      <button class="btn btn-primary" type="button" :disabled="!ready" @click="confirm">确认</button>
    </template>
  </AppModal>
</template>

<style scoped>
.ari-lead { margin: 0 0 12px; font-size: 13px; color: var(--sub); line-height: 1.7; }

.ari-drop {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 220px;
  border: 1.5px dashed var(--border);
  border-radius: 12px;
  color: var(--brand);
  cursor: pointer;
  transition: all 0.15s;
}
.ari-drop:hover,
.ari-drop.over { border-color: var(--brand); background: var(--brand-soft); }
.ari-drop-title { font-size: 13.5px; font-weight: 600; color: var(--ink-2); }
.ari-drop .f-hint { margin-top: 0; }
.ari-file { display: none; }

.ari-body { display: flex; flex-direction: column; gap: 12px; }
.ari-thumb {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px;
  border: 1.5px solid var(--border);
  border-radius: 10px;
}
.ari-thumb img {
  width: 96px;
  height: 72px;
  object-fit: contain;
  background: #fff;
  border-radius: 7px;
}
.ari-thumb-name {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  color: var(--ink-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ari-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 22px;
  font-size: 13px;
  color: var(--brand-deep);
}

/* 引擎标识：真实识别与本地演示必须一眼分得开，不能让人误以为演示数据是真结果 */
.ari-engine {
  margin-left: 8px;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
}
.ari-engine.vision { background: var(--brand-soft); color: var(--brand-deep); }
.ari-engine.mock { background: #f2f4fa; color: var(--sub); }

.ari-preview {
  min-height: 46px;
  display: flex;
  align-items: center;
  padding: 8px 12px;
  background: #f7fafa;
  border-radius: 10px;
  overflow-x: auto;
  font-size: 15px;
  color: var(--ink);
}
.ari-preview :deep(.ari-bad) { color: var(--danger); font-size: 13px; }
</style>
