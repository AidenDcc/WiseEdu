<script setup lang="ts">
/**
 * 工作台顶部搜索栏：文本 / 粘贴图片 / AI 三种检索方式写进**同一个 ComposeFilter**。
 *
 * 三种方式不是三个模式开关，而是三个显式动作——输入即文本检索、粘贴/拖入/选图即图片检索、
 * 点「AI 解读」即智能检索。教师不必先想「我现在在哪个模式」，误操作成本也低。
 *
 * 图片检索**原样复用** `api/ai-search.ts`（题库管理/全局搜索同一通道），识别出的关键词回填
 * 输入框后再走文本路径——这样用户看得见系统到底拿什么去搜，比直接出结果更可解释。
 *
 * AI 解读的学科/年级**要过一遍字典校验**：模型可能给出「高中数学」这类字典里没有的值，
 * 直接写进筛选会让下拉框显示空白、结果恒为空。宁可不填，也不能填一个假值。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { AppIcon, showToast } from '@aiteach/shared'
import type { ComposeSearchIntent } from '@aiteach/shared'
import { searchImageEngine, searchKeywordFromImage } from '@/api/ai-search'
import {
  COMPOSE_DIFFICULTY_OPTIONS,
  COMPOSE_TYPE_OPTIONS,
  aiComposeSearch,
  composeSearchEngine,
} from '@/api/ai-compose-search'
import { useBaseData } from '@/composables/useBaseData'
import type { ComposeFilter } from '@/views/paper/compose/types'

const props = defineProps<{ filter: ComposeFilter }>()
const emit = defineEmits<{ patch: [patch: Partial<ComposeFilter>] }>()

const { grades, subjects } = useBaseData()

const keyword = ref(props.filter.keyword)
const imageBusy = ref(false)
const aiBusy = ref(false)
const dragging = ref(false)
const imageNote = ref('')
/** 最近一次 AI 解读结果，仅用于渲染可删 chip 与解读理由 */
const intent = ref<ComposeSearchIntent | null>(null)
const engineLabel = computed(() => (composeSearchEngine() === 'deepseek' ? '真实 AI 解读' : '本地演示解读'))

const fileInput = ref<HTMLInputElement | null>(null)

/* ===== 文本检索：输入即筛选（防抖），与全局搜索浮层同一节奏 ===== */
let debounceTimer: number | undefined
watch(keyword, (value) => {
  window.clearTimeout(debounceTimer)
  const next = value.trim()
  if (next === props.filter.keyword) return
  debounceTimer = window.setTimeout(() => emit('patch', { keyword: next }), 260)
})

/* 外部改了关键词（AI 解读、图片识别、清空筛选）时回填输入框；带尾随空格时不动，免得光标跳 */
watch(
  () => props.filter.keyword,
  (value) => {
    if (value !== keyword.value.trim()) keyword.value = value
  },
)

onBeforeUnmount(() => window.clearTimeout(debounceTimer))

/**
 * 回车 = 立刻按文本检索（跳过防抖）。
 * 刻意**不**把回车绑成 AI 解读：回车是打字后最顺手的一下，绑成 AI 会让每次回车都触发一次
 * 真实模型调用（耗时且计费），而用户多半只是想「马上筛一下」。AI 有自己的按钮，见 runAiSearch。
 */
function flushKeyword() {
  window.clearTimeout(debounceTimer)
  emit('patch', { keyword: keyword.value.trim() })
}

function clearKeyword() {
  keyword.value = ''
  intent.value = null
  imageNote.value = ''
  emit('patch', { keyword: '' })
}

/* ===== 图片检索 ===== */
async function runImageSearch(file: File) {
  if (!file.type.startsWith('image/')) {
    showToast('请选择图片文件（支持截图、拍照或本地图片）', 'error')
    return
  }
  imageBusy.value = true
  imageNote.value = ''
  intent.value = null
  try {
    const word = await searchKeywordFromImage(file)
    if (!word) {
      imageNote.value = `未能从「${file.name}」识别出可检索的内容，请换一张更清晰的图片或改用文本搜索`
      return
    }
    imageNote.value = `已按图片识别结果检索：${word}（${searchImageEngine() === 'vision' ? '真实 AI 识图' : '本地演示识图'}）`
    keyword.value = word
    /* 图片识别出的关键词立刻生效，不等防抖——用户已经等了一次识别 */
    emit('patch', { keyword: word })
  } catch (error) {
    imageNote.value = ''
    showToast((error as Error).message || '图片识别失败，请稍后重试', 'error')
  } finally {
    imageBusy.value = false
  }
}

function onPickFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  /* 复位 value：连续选同一张图片也要触发 change */
  input.value = ''
  if (file) void runImageSearch(file)
}

/* 拖拽计数：dragleave 会在子元素上冒泡触发，用深度计数避免高亮闪烁 */
let dragDepth = 0
function onDragEnter() {
  dragDepth += 1
  dragging.value = true
}
function onDragLeave() {
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) dragging.value = false
}
function onDrop(event: DragEvent) {
  dragDepth = 0
  dragging.value = false
  const file = event.dataTransfer?.files?.[0]
  if (file) void runImageSearch(file)
}

/** 粘贴截图即搜；纯文本粘贴不拦截，交给输入框自身处理 */
function onPaste(event: ClipboardEvent) {
  const file = [...(event.clipboardData?.items ?? [])]
    .find((item) => item.kind === 'file' && item.type.startsWith('image/'))
    ?.getAsFile()
  if (!file) return
  event.preventDefault()
  void runImageSearch(file)
}

/* ===== AI 检索 ===== */
const AI_HINTS = ['找几道高一数学三角函数的中等单选题', '初二物理浮力的实验探究题', '带图的化学方程式配平填空']

const inList = (list: readonly string[], value: string) => (value && list.includes(value) ? value : '')

async function runAiSearch() {
  const text = keyword.value.trim()
  if (!text) {
    showToast('请先输入一句话描述你要找的题，或粘贴一张图片', 'error')
    return
  }
  aiBusy.value = true
  imageNote.value = ''
  try {
    const { intent: raw, engine } = await aiComposeSearch({ text })
    const safe: ComposeSearchIntent = {
      ...raw,
      /* 字典校验：不在候选项里的年级/学科宁可不填（见文件头注释） */
      grade: inList(grades.value, raw.grade),
      subject: inList(subjects.value, raw.subject),
      questionTypes: raw.questionTypes.filter((type) => COMPOSE_TYPE_OPTIONS.includes(type)),
      difficulty: inList(COMPOSE_DIFFICULTY_OPTIONS, raw.difficulty),
    }
    intent.value = safe
    emit('patch', {
      /* 没抽出关键词时保留原句：否则输入框会被清空，用户以为刚才白输了 */
      keyword: safe.keywords.length ? safe.keywords.join(' ') : text,
      grade: safe.grade,
      subject: safe.subject,
      difficulty: safe.difficulty,
      types: safe.questionTypes,
      knowledge: safe.knowledge,
    })
    if (engine === 'mock') showToast('未配置 AI Key，已用本地演示口径解读')
  } catch (error) {
    showToast((error as Error).message || 'AI 解读失败，请稍后重试', 'error')
  } finally {
    aiBusy.value = false
  }
}

function useHint(hint: string) {
  keyword.value = hint
  void runAiSearch()
}

/* ===== AI 解读结果：可逐项删除的 chip ===== */
interface IntentChip {
  key: string
  label: string
  clear: () => void
}

const chips = computed<IntentChip[]>(() => {
  const current = intent.value
  if (!current) return []
  const list: IntentChip[] = []
  if (current.grade) list.push({ key: 'grade', label: `年级 ${current.grade}`, clear: () => emit('patch', { grade: '' }) })
  if (current.subject) list.push({ key: 'subject', label: `学科 ${current.subject}`, clear: () => emit('patch', { subject: '' }) })
  current.questionTypes.forEach((type) =>
    list.push({
      key: `type-${type}`,
      label: `题型 ${type}`,
      clear: () => emit('patch', { types: current.questionTypes.filter((row) => row !== type) }),
    }),
  )
  if (current.difficulty) list.push({ key: 'difficulty', label: `难度 ${current.difficulty}`, clear: () => emit('patch', { difficulty: '' }) })
  current.knowledge.forEach((tag) =>
    list.push({
      key: `kp-${tag}`,
      label: `知识点 ${tag}`,
      clear: () => emit('patch', { knowledge: current.knowledge.filter((row) => row !== tag) }),
    }),
  )
  current.keywords.forEach((word) =>
    list.push({
      key: `kw-${word}`,
      label: `关键词 ${word}`,
      clear: () => emit('patch', { keyword: current.keywords.filter((row) => row !== word).join(' ') }),
    }),
  )
  return list
})

function clearIntent() {
  intent.value = null
  emit('patch', { keyword: '', grade: '', subject: '', difficulty: '', types: [], knowledge: [] })
}
</script>

<template>
  <div class="csb" :class="{ dragging }" @dragenter.prevent="onDragEnter" @dragover.prevent @dragleave.prevent="onDragLeave" @drop.prevent="onDrop">
    <div class="csb-box">
      <AppIcon name="search" :size="17" class="csb-icon" />

      <input
        v-model="keyword"
        class="csb-input"
        placeholder="搜索试题、试卷、教辅、视频、图片，或直接粘贴一张截图"
        @paste="onPaste"
        @keydown.enter="flushKeyword"
      />

      <span v-if="imageBusy" class="csb-busy">识别中…</span>

      <button class="csb-btn" type="button" title="选择图片搜索（也可直接拖入或粘贴截图）" @click="fileInput?.click()">
        <AppIcon name="image" :size="15" />
        图片
      </button>
      <button class="csb-btn csb-ai" type="button" :disabled="aiBusy" title="用一句话描述你要找的题，由 AI 解读为检索条件" @click="runAiSearch">
        <AppIcon name="sparkles" :size="15" />
        {{ aiBusy ? '解读中…' : 'AI 解读' }}
      </button>
      <button v-if="keyword || filter.keyword" class="csb-clear" type="button" title="清空搜索" @click="clearKeyword">
        <AppIcon name="close" :size="14" />
      </button>
    </div>

    <input ref="fileInput" type="file" accept="image/*" class="csb-file" @change="onPickFile" />

    <!-- 图片识别回执 -->
    <p v-if="imageNote" class="csb-note">{{ imageNote }}</p>

    <!-- AI 解读结果：可逐项删除 -->
    <div v-if="intent" class="csb-intent">
      <span class="csb-engine" :class="{ mock: composeSearchEngine() === 'mock' }">{{ engineLabel }}</span>
      <span v-if="intent.reason" class="csb-reason">{{ intent.reason }}</span>
      <button v-for="chip in chips" :key="chip.key" class="csb-chip" type="button" :title="`移除「${chip.label}」条件`" @click="chip.clear">
        {{ chip.label }}
        <AppIcon name="close" :size="11" />
      </button>
      <button class="csb-intent-clear" type="button" @click="clearIntent">清除全部解读条件</button>
    </div>

    <!-- 没搜过之前给几个例句，否则「AI 解读」这个按钮太抽象 -->
    <div v-else-if="!keyword && !filter.keyword" class="csb-hints">
      <span>试试：</span>
      <button v-for="hint in AI_HINTS" :key="hint" class="csb-hint" type="button" @click="useHint(hint)">{{ hint }}</button>
    </div>

    <div v-if="dragging" class="csb-drop">
      <AppIcon name="image" :size="22" />
      松开即按这张图检索
    </div>
  </div>
</template>

<style scoped>
.csb { position: relative; width: 100%; max-width: 720px; }

.csb-box {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 46px;
  padding: 0 8px 0 14px;
  border: 1.5px solid var(--border);
  border-radius: 999px;
  background: #fff;
  box-shadow: 0 2px 10px rgba(28, 36, 52, 0.05);
  transition: border-color 0.15s, box-shadow 0.15s;
}
.csb-box:focus-within { border-color: var(--brand); box-shadow: 0 0 0 4px var(--brand-soft); }
.csb-icon { color: var(--sub); flex-shrink: 0; }
.csb-input { flex: 1; min-width: 0; border: none; outline: none; font-size: 13.5px; background: transparent; }
.csb-busy { font-size: 12px; color: var(--brand-deep); flex-shrink: 0; }

.csb-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 32px;
  padding: 0 11px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: #fff;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink-2);
  flex-shrink: 0;
  transition: all 0.14s;
}
.csb-btn:hover:not(:disabled) { border-color: var(--brand); color: var(--brand-deep); }
.csb-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.csb-ai { border-color: transparent; background: var(--brand-grad); color: #fff; }
.csb-ai:hover:not(:disabled) { color: #fff; filter: brightness(1.06); }
.csb-clear { display: flex; color: var(--sub); padding: 4px; flex-shrink: 0; }
.csb-clear:hover { color: var(--danger); }

.csb-file { display: none; }

.csb-note { margin-top: 7px; font-size: 12px; color: var(--brand-deep); text-align: center; }

.csb-intent {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 9px;
  padding: 0 4px;
  justify-content: center;
}
.csb-engine {
  font-size: 11px;
  font-weight: 600;
  color: #fff;
  background: var(--brand-grad);
  border-radius: 5px;
  padding: 2px 7px;
  flex-shrink: 0;
}
.csb-engine.mock { background: #9aa6b8; }
.csb-reason { font-size: 12px; color: var(--sub); }
.csb-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--brand);
  border-radius: 999px;
  background: var(--brand-soft);
  color: var(--brand-deep);
  font-size: 12px;
  font-weight: 600;
  padding: 2px 9px;
}
.csb-chip:hover { background: #fff; }
.csb-intent-clear {
  border: none;
  background: none;
  color: var(--sub);
  font-size: 11.5px;
  text-decoration: underline;
  padding: 0 2px;
}
.csb-intent-clear:hover { color: var(--danger); }

.csb-hints {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
  justify-content: center;
  margin-top: 8px;
  font-size: 12px;
  color: var(--sub);
}
.csb-hint {
  border: 1px dashed var(--border);
  border-radius: 999px;
  background: #fff;
  color: var(--ink-2);
  font-size: 12px;
  padding: 3px 10px;
}
.csb-hint:hover { border-color: var(--brand); border-style: solid; color: var(--brand-deep); }

.csb-drop {
  position: absolute;
  inset: -6px;
  border: 2px dashed var(--brand);
  border-radius: 16px;
  background: rgba(0, 180, 166, 0.06);
  color: var(--brand-deep);
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  pointer-events: none;
}
</style>
