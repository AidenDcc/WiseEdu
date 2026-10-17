<script setup lang="ts">
/**
 * 内联公式输入框（「插入公式」的轻量通路）。
 *
 * 与公式编辑器弹窗（FormulaPickerModal）的分工：
 * - 本组件**贴光标就地输入**：敲一行 LaTeX、右侧实时悬浮预览、失焦即转成正文里的公式节点；
 * - 需要符号面板 / 标准公式库 / 我的公式库时，下拉里的「公式编辑器」把活交给弹窗。
 *
 * 四个关键取舍：
 * 1. **不往文档里塞占位节点**。输入框是浮层、按光标坐标定位，文档在输入期间始终合法 ——
 *    把「正在输入」的框做成文档节点的话，每敲一个字符都要写一次 HTML（落库、撤销栈、
 *    净化白名单全要跟着改），失焦再把它换掉，代价完全不成比例。
 * 2. **浮层 Teleport 到 body**。`position: fixed` 的参照物会退化成最近的
 *    「有 transform / filter / backdrop-filter 的祖先」—— 本仓库的 AppModal 遮罩正好带
 *    `backdrop-filter`，就地渲染的话，录题弹窗里的公式输入框坐标会整体偏掉。
 *    Teleport 出去同时避开弹窗内容的 `overflow-y: auto` 裁剪（与 RtePopover 同一套做法）。
 * 3. **失焦即提交**（`focusout`）：点正文别处、点工具栏其它按钮都算「写完了」。
 *    但开子弹窗（AI 识图 / 收藏 / 公式编辑器）时会先失焦一次，那是**内部**的焦点转移，
 *    用 `suspended` 挡掉，否则弹窗还没出来公式就先落进正文了。
 * 4. **命令候选取代不了面板**：它只做「边敲边补」（中文名 / 命令名 / 分类名三路匹配），
 *    所以保留公式编辑器入口 —— 别指望用户记住 `\begin{cases}` 这种写法。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import { AppIcon, katex, showToast } from '@aiteach/shared'
import 'katex/dist/katex.min.css'
import { PLACEHOLDER } from '../formula-symbols'
import { matchLatexSuggestions, type LatexSuggestion } from './formula-suggestions'
import AiFormulaRecognizeDialog from '../AiFormulaRecognizeDialog.vue'
import FormulaFavoriteDialog from '../FormulaFavoriteDialog.vue'

const props = withDefaults(
  defineProps<{
    editor: Editor
    /** 插入锚点（文档位置）：确认时公式就落在这里 */
    pos: number
    /** 回填的初始源码（编辑已有公式时用） */
    initialLatex?: string
    /** 初始插入方式：true = 独立公式 */
    initialBlock?: boolean
    /** 当前学科：收藏弹窗的默认学科 */
    subject?: string
  }>(),
  { initialLatex: '', initialBlock: false, subject: '' },
)

const emit = defineEmits<{
  /** 确认：父级在这个位置落一个公式节点 */
  insert: [latex: string, block: boolean]
  /** 什么都没输入就离开了：什么都不插 */
  cancel: []
  /** 交给公式编辑器弹窗（符号面板 / 公式库） */
  'open-editor': [latex: string, block: boolean]
}>()

const root = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLInputElement | null>(null)
/** 命令候选面板：量预览列真实宽度用（见 markPreviewOverflow） */
const suggestPanel = ref<HTMLElement | null>(null)
const anchorStyle = ref<Record<string, string>>({})

const latex = ref(props.initialLatex)
/** 插入方式：行内 / 独立（下拉里可随时切换） */
const isBlock = ref(props.initialBlock)
const menuOpen = ref(false)
/** 内部焦点转移（开子弹窗）期间抑制「失焦即提交」 */
const suspended = ref(false)
const aiOpen = ref(false)
const favOpen = ref(false)
const dialogOpen = ref(false)

/* ===== 命令候选（敲 `\` 或 `/` 触发） ===== */
const suggest = ref<{ open: boolean; items: LatexSuggestion[]; index: number }>({ open: false, items: [], index: 0 })

/* ===== 实时预览（悬浮在输入框右侧） ===== */
function renderPreview(source: string, display = false): string {
  try {
    /* 走共享层的 katex：它注册过 mhchem，\ce{} 化学式才能在这里也渲染出来 */
    return katex.renderToString(source, { throwOnError: false, displayMode: display })
  } catch {
    return ''
  }
}

const previewHtml = ref('')
function refreshPreview() {
  const value = latex.value.trim()
  previewHtml.value = value ? renderPreview(value, isBlock.value) : ''
}

/** 输入框宽度随内容增长（否则长公式要横向滚动才看得全）
    46 = 左内边距 8 + 输入框与下拉按钮的间隙 4 + 下拉按钮 24 + 右内边距 4 + 少许余量 */
const boxWidth = () => `${Math.min(460, Math.max(150, latex.value.length * 8.2 + 46))}px`

/* ===== 定位 =====
   coordsAtPos 给的是视口坐标，浮层是 position: fixed，两者对得上。
   滚动 / 缩放后原坐标即失效，故在 scroll（捕获，覆盖弹窗内的滚动容器）与 resize 上重算。 */
function place() {
  const view = props.editor.view
  if (!view) return
  const size = props.editor.state.doc.content.size
  const at = Math.max(1, Math.min(props.pos, size))
  const coords = view.coordsAtPos(at)
  const width = root.value?.offsetWidth ?? 240
  const height = root.value?.offsetHeight ?? 34
  const left = Math.min(Math.max(8, coords.left), Math.max(8, window.innerWidth - width - 8))
  const top = Math.min(Math.max(8, coords.top - 4), Math.max(8, window.innerHeight - height - 8))
  anchorStyle.value = { top: `${top}px`, left: `${left}px` }
}

/**
 * 候选面板比输入框宽得多（386 vs 170~460），贴着右边缘的光标再往右展开就会顶出视口。
 * 没有空间时翻转成右对齐；anchorStyle 一变就重算，滚动/resize 后跟着更新。
 */
const panelFlip = computed(() => {
  const left = Number.parseFloat(anchorStyle.value.left ?? '0') || 0
  return left + 438 > window.innerWidth - 8
})

function onViewportChange() {
  place()
}

/* ===== 提交 ===== */
/**
 * 提交前的粗校验：只拦「一定渲染不出来」的花括号不配对。
 * 更细的语法错误交给 KaTeX 的 throwOnError:false（正文里以红字呈现，点一下还能改回来），
 * 在这里穷举 LaTeX 语法只会把合法写法一起拦掉。
 */
function latexProblem(source: string): string | null {
  let depth = 0
  for (const ch of source) {
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth < 0) return '花括号不配对：多了一个「}」'
    }
  }
  return depth > 0 ? `花括号不配对：还缺 ${depth} 个「}」` : null
}

function commit() {
  if (suspended.value) return
  const value = latex.value.trim()
  if (!value) {
    emit('cancel')
    return
  }
  const problem = latexProblem(value)
  if (problem) {
    showToast(problem, 'error')
    /* 拦下来就得把焦点塞回去，否则用户只有再点一次输入框才能接着改 */
    nextTick(() => inputRef.value?.focus())
    return
  }
  emit('insert', value, isBlock.value)
}

function onFocusOut(event: FocusEvent) {
  const next = event.relatedTarget as HTMLElement | null
  /* 焦点还在本浮层内部（点下拉按钮、候选项）不算离开 */
  if (next && root.value?.contains(next)) return
  commit()
}

/* ===== 输入 / 候选 =====
   一律以 DOM 里的 value 为准（而不是 latex.value）：v-model 与 @input 的先后顺序
   不在本组件的控制范围内，读 DOM 才不会被更新时序绊住。 */

/**
 * 找「命令入口」：光标前最后一个 `\` 或 `/`，返回它的下标（没有则 -1）。
 *
 * 两个字符都当入口：
 * - `\` 是 LaTeX 的原生前缀 —— 用户脑子里想的就是 `\frac`，不该逼他先翻译成 `/frac`；
 * - `/` 留给斜杠命令的习惯（Notion / 飞书那套），已在用的输入手感不废掉。
 *
 * 唯一要绕开的是 `\\`：那是 LaTeX 的换行命令，本身已经是完整指令，
 * 敲完不该再弹候选，所以遇到连续两个反斜杠就跳过这一对，继续往前找。
 */
function commandEntry(before: string): number {
  for (let i = before.length - 1; i >= 0; i -= 1) {
    const ch = before[i]
    if (ch !== '\\' && ch !== '/') continue
    if (ch === '\\' && before[i - 1] === '\\') {
      /* 跳过这一对：这里再减一次，加上循环自身的自减，恰好越过两个反斜杠 */
      i -= 1
      continue
    }
    return i
  }
  return -1
}

function refreshSuggest(value: string, caret: number) {
  const before = value.slice(0, caret)
  const entry = commandEntry(before)
  if (entry < 0) {
    suggest.value = { open: false, items: [], index: 0 }
    return
  }
  const query = before.slice(entry + 1)
  /* 出现空白或花括号说明这条命令已经写完（如 \frac{a}{b}），不该继续弹候选 */
  if (/[\s{}]/.test(query)) {
    suggest.value = { open: false, items: [], index: 0 }
    return
  }
  const items = matchLatexSuggestions(query)
  /* index 归零 = 默认选中第一个，回车直接落它 */
  suggest.value = { open: items.length > 0, items, index: 0 }
}

/**
 * 给「放不下的预览」打上渐隐标记 —— 判据是「内容自然宽度是否超过 max-width」，
 * 不看源码字符数，也不看 `scrollWidth > clientWidth`。
 *
 * 两个坑都踩过：
 * 1. **字符数**：`\frac{1}{\sqrt{\square}}` 有 22 个字符，渲染出来只有 35px 宽 ——
 *    按字符数判会把它误当成「长」，挂上按百分比算的渐隐（`100% - 16px`），
 *    挂到 35px 宽的元素上等于从 19px 处开始变淡，把符号自己抹掉。
 * 2. **`scrollWidth > clientWidth`**：KaTeX 会把公式渲染两份（可见的 HTML 版 + 一个
 *    `position: absolute` 的 MathML 副本，靠 `clip` 裁成 1px 点藏起来）。那个副本是个
 *    完整的大盒子，会把 scrollWidth 撑出几个像素的**假溢出** —— 于是 `\sqrt{\square}`
 *    这种 23px 宽的正常符号也被判成超宽，渐隐把根号横线的右端抹淡，看起来就像「没显示全」。
 *
 * 所以直接跟 max-width 比：只有内容真想画得比它还宽（差值几十像素量级）才挂渐隐，
 * 那几像素的副本溢出落在阈值之下，自然被忽略。
 */
function markPreviewOverflow() {
  const panel = suggestPanel.value
  if (!panel) return
  for (const el of panel.querySelectorAll<HTMLElement>('.fm-sug-preview')) {
    const limit = Number.parseFloat(getComputedStyle(el).maxWidth)
    el.classList.toggle('is-long', Number.isFinite(limit) && el.scrollWidth > limit)
  }
}

watch(() => suggest.value.items, () => void nextTick(markPreviewOverflow), { flush: 'post' })

function onInput() {
  const el = inputRef.value
  if (!el) return
  refreshSuggest(el.value, el.selectionStart ?? el.value.length)
  refreshPreview()
}

/**
 * 光标挪动后要按新位置重算候选（入口字符之前那截变了），但**上下键必须排除**：
 * 那两个键是候选列表的导航，重算会把选中项重置回第一个 —— 表现就是「按下键没反应」。
 */
const CARET_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End'])

function onKeyup(event: KeyboardEvent) {
  if (!CARET_KEYS.has(event.key)) return
  onInput()
}

/** 写入源码并指定光标：模板里的 `\square` 占位符插入后自动选中，接着敲字就是把它换掉 */
function setLatex(next: string, caretFrom: number, caretTo = caretFrom) {
  latex.value = next
  suggest.value = { open: false, items: [], index: 0 }
  refreshPreview()
  nextTick(() => {
    const el = inputRef.value
    if (!el) return
    el.focus()
    el.setSelectionRange(caretFrom, caretTo)
  })
}

/** 选中候选：把入口那段（`\查询词` 或 `/查询词`）整体替换成候选源码 */
function applySuggestion(row: LatexSuggestion) {
  const el = inputRef.value
  const value = el?.value ?? latex.value
  const caret = el?.selectionStart ?? value.length
  const entry = commandEntry(value.slice(0, caret))
  const start = entry >= 0 ? entry : caret
  const next = value.slice(0, start) + row.latex + value.slice(caret)
  const ph = row.latex.indexOf(PLACEHOLDER)
  if (ph >= 0) setLatex(next, start + ph, start + ph + PLACEHOLDER.length)
  else setLatex(next, start + row.latex.length)
}

function onKeydown(event: KeyboardEvent) {
  /* 按键只在本浮层内处理：AppModal / RtePopover 都在 document 上听 Escape，
     不截断冒泡的话，在录题弹窗里按一下 Esc 会连整个弹窗一起关掉 */
  event.stopPropagation()

  const list = suggest.value.items
  if (suggest.value.open && list.length) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      suggest.value.index = (suggest.value.index + 1) % list.length
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      suggest.value.index = (suggest.value.index - 1 + list.length) % list.length
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      applySuggestion(list[suggest.value.index])
      return
    }
  }

  if (event.key === 'Enter') {
    /* 候选没开时回车 = 确认插入，省掉「再点一下空白处」这一步 */
    event.preventDefault()
    commit()
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    if (suggest.value.open) {
      suggest.value = { open: false, items: [], index: 0 }
      return
    }
    if (menuOpen.value) {
      menuOpen.value = false
      return
    }
    emit('cancel')
  }
}

/* ===== 下拉操作 ===== */
function toggleMenu() {
  menuOpen.value = !menuOpen.value
  if (menuOpen.value) suggest.value = { open: false, items: [], index: 0 }
}

function closeMenu() {
  menuOpen.value = false
}

/**
 * 点浮层之外的任何地方都要收起下拉面板。
 * root 身上有 `@mousedown.stop`，所以能冒泡到 document 的点击必然来自浮层之外；
 * 子弹窗（AI 识图 / 收藏）是 Teleport 到 body 的、点击同样会到这里 —— 但那时候面板早关了，无副作用。
 */
function onDocumentMouseDown() {
  closeMenu()
}

function setBlock(value: boolean) {
  isBlock.value = value
  menuOpen.value = false
  refreshPreview()
  nextTick(() => inputRef.value?.focus())
}

/** 开子弹窗前先挂起提交抑制，并把自己的层级压到弹窗（120）之下，免得浮在弹窗上面 */
function openDialog(kind: 'ai' | 'fav') {
  menuOpen.value = false
  suspended.value = true
  dialogOpen.value = true
  if (kind === 'ai') aiOpen.value = true
  else favOpen.value = true
}

function closeDialog() {
  aiOpen.value = false
  favOpen.value = false
  dialogOpen.value = false
  suspended.value = false
  nextTick(() => inputRef.value?.focus())
}

function onAiConfirm(result: string) {
  closeDialog()
  setLatex(result, result.length)
  showToast('已填入识别结果，可继续编辑', 'success')
}

function openFavorite() {
  if (!latex.value.trim()) {
    showToast('请先输入公式，再收藏', 'error')
    return
  }
  openDialog('fav')
}

function openEditor() {
  menuOpen.value = false
  suspended.value = true
  emit('open-editor', latex.value.trim(), isBlock.value)
}

onMounted(() => {
  refreshPreview()
  nextTick(() => {
    place()
    const el = inputRef.value
    el?.focus()
    /* 有回填源码时把光标放到末尾：直接接着改，而不是全选（全选后误敲一个键就删光了） */
    if (latex.value) el?.setSelectionRange(latex.value.length, latex.value.length)
  })
  window.addEventListener('scroll', onViewportChange, true)
  window.addEventListener('resize', onViewportChange)
  document.addEventListener('mousedown', onDocumentMouseDown)
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onViewportChange, true)
  window.removeEventListener('resize', onViewportChange)
  document.removeEventListener('mousedown', onDocumentMouseDown)
})
</script>

<template>
  <Teleport to="body">
    <!-- data-rte-popover：告诉 RichTextEditor「焦点还在自己身上」，工具栏不会因为点进输入框就收起来 -->
    <!-- mouseleave 挂在 root 上（而不是面板上）：鼠标从输入框直接移开、从没进过面板的情况也要收 -->
    <div
      ref="root"
      class="fm-root"
      data-rte-popover
      :style="{ ...anchorStyle, zIndex: dialogOpen ? 110 : 330 }"
      @mousedown.stop
      @focusout="onFocusOut"
      @mouseleave="closeMenu"
    >
      <div class="fm-row">
        <!-- 模式不再用徽标占位：全靠边框色 + 占位文案 + 悬停提示来区分（右侧下拉里能直接切） -->
        <span
          class="fm-box"
          :class="{ block: isBlock }"
          :style="{ width: boxWidth() }"
          :title="isBlock ? '独立公式：独占一行并居中；可在右侧下拉里切成行内' : '行内公式：与文字同一行；可在右侧下拉里切成独立'"
        >
          <input
            ref="inputRef"
            v-model="latex"
            class="fm-input"
            type="text"
            spellcheck="false"
            autocomplete="off"
            :placeholder="isBlock ? '独立公式 LaTeX' : '输入 LaTeX，敲 \\ 或 / 选符号'"
            @input="onInput"
            @keydown="onKeydown"
            @click="onInput"
            @keyup="onKeyup"
          />
          <button
            class="fm-caret"
            :class="{ on: menuOpen }"
            type="button"
            title="插入方式 / AI 识图 / 收藏 / 公式编辑器"
            @mousedown.prevent
            @click="toggleMenu"
          >
            <AppIcon name="chevron-down" :size="13" />
          </button>
        </span>

        <!-- 实时预览：浮在输入框右侧，不参与布局（否则每敲一个字符整行都在重排） -->
        <span v-if="previewHtml" class="fm-preview" :class="{ block: isBlock }" v-html="previewHtml" />
        <span v-else class="fm-preview is-empty">实时预览</span>
      </div>

      <!-- 命令候选：贴输入框下沿 -->
      <div v-if="suggest.open" ref="suggestPanel" class="fm-panel fm-suggest" :class="{ flip: panelFlip }">
        <button
          v-for="(row, i) in suggest.items"
          :key="row.latex + i"
          class="fm-sug"
          :class="{ on: i === suggest.index }"
          type="button"
          :title="`${row.label} · ${row.category}`"
          @mousedown.prevent
          @mouseenter="suggest.index = i"
          @click="applySuggestion(row)"
        >
          <code class="fm-sug-latex">{{ row.latex }}</code>
          <span class="fm-sug-preview" v-html="renderPreview(row.preview)" />
        </button>
        <p class="fm-sug-hint">↑↓ 切换，回车选中</p>
      </div>

      <!-- 下拉操作 -->
      <div v-if="menuOpen" class="fm-panel fm-menu">
        <p class="fm-menu-title">插入方式</p>
        <button class="fm-menu-item" type="button" @mousedown.prevent @click="setBlock(false)">
          <span class="fm-tick"><AppIcon v-if="!isBlock" name="check" :size="14" /></span>
          行内公式
        </button>
        <button class="fm-menu-item" type="button" @mousedown.prevent @click="setBlock(true)">
          <span class="fm-tick"><AppIcon v-if="isBlock" name="check" :size="14" /></span>
          独立公式
        </button>

        <div class="fm-menu-sep" />

        <button class="fm-menu-item" type="button" @mousedown.prevent @click="openDialog('ai')">
          <span class="fm-tick"><AppIcon name="sparkles" :size="14" /></span>
          AI 识图
          <span class="fm-menu-hint">图片转公式</span>
        </button>
        <button class="fm-menu-item" type="button" @mousedown.prevent @click="openFavorite">
          <span class="fm-tick"><AppIcon name="star" :size="14" /></span>
          收藏
          <span class="fm-menu-hint">存入公式库</span>
        </button>
        <button class="fm-menu-item" type="button" @mousedown.prevent @click="openEditor">
          <span class="fm-tick"><AppIcon name="edit" :size="14" /></span>
          公式编辑器
          <span class="fm-menu-hint">面板 / 公式库</span>
        </button>
      </div>

      <AiFormulaRecognizeDialog v-if="aiOpen" @close="closeDialog" @confirm="onAiConfirm" />
      <FormulaFavoriteDialog v-if="favOpen" :latex="latex.trim()" :subject="subject" @close="closeDialog" @saved="closeDialog" />
    </div>
  </Teleport>
</template>

<style scoped>
/* 浮层在 body 下（Teleport），scoped 样式仍随本组件走 —— 编译后带的是同一份 data-v 属性 */
.fm-root {
  position: fixed;
  z-index: 330;
  font-size: 13px;
}

.fm-row { display: flex; align-items: stretch; gap: 8px; }

.fm-box {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 34px;
  padding: 0 4px 0 8px;
  background: #fff;
  border: 1.5px solid var(--brand);
  border-radius: 9px;
  box-shadow: 0 6px 18px rgb(20 26 40 / 14%);
  transition: width 0.1s;
}
/* 独立公式：换个边框色提示「插进去会独占一行」（模式名在悬停提示里） */
.fm-box.block { border-color: #f07a3c; }

.fm-input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: none;
  outline: none;
  background: transparent;
  color: var(--ink);
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 13px;
}

.fm-caret {
  flex-shrink: 0;
  width: 24px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--sub);
  transition: background 0.15s, color 0.15s;
}
.fm-caret:hover,
.fm-caret.on { background: var(--brand-soft); color: var(--brand-deep); }

/* 悬浮预览：绝对定位，不占布局 */
.fm-preview {
  position: absolute;
  top: 0;
  left: calc(100% + 8px);
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  max-width: 320px;
  padding: 0 12px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 9px;
  box-shadow: 0 6px 18px rgb(20 26 40 / 12%);
  color: var(--ink);
  font-size: 15px;
  white-space: nowrap;
  overflow-x: auto;
  pointer-events: none;
}
.fm-preview.is-empty { color: #c3cad8; font-size: 12px; }
.fm-preview.block { font-size: 16px; }

/* 两个下拉面板共用的壳 */
.fm-panel {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 1;
  min-width: 100%;
  padding: 6px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--shadow-lg);
}
/* 补上「输入框下沿 → 面板上沿」那 6px 的悬停区域。
   否则鼠标从按钮往下移、经过这段空隙时，root 的 mouseleave 会先触发，面板还没够到就收了。 */
.fm-panel::before {
  content: '';
  position: absolute;
  top: -6px;
  left: 0;
  right: 0;
  height: 6px;
}
/* 候选项是「拿源码当模板填」，源码必须看全：面板放得比一般下拉宽，源码列允许折行（长示例公式也不截断） */
.fm-suggest { width: 420px; max-height: 280px; overflow-y: auto; }
.fm-suggest.flip { left: auto; right: 0; }

.fm-sug {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  /* 右侧留够：预览的符号（\oplus、\boxplus 之类）本身就贴边，再压 8px 就成了「显示不全」 */
  padding: 6px 14px 6px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  text-align: left;
  transition: background 0.12s;
}
.fm-sug.on { background: var(--brand-soft); }
.fm-sug-latex {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 250px;
  /* 折行而不是省略号：模板的骨架（花括号、占位符）就是用户要照着填的东西，截掉等于白列 */
  white-space: normal;
  overflow-wrap: anywhere;
  line-height: 1.45;
  color: var(--brand-deep);
  font-family: 'SFMono-Regular', Consolas, Menlo, monospace;
  font-size: 12px;
}
.fm-sug-preview {
  flex: 0 0 auto;
  margin-left: auto;
  /* 右侧也留一点：KaTeX 的根号横线会往右压线，紧贴边界容易被 overflow:hidden 削掉一像素 */
  padding: 0 4px 0 14px;
  max-width: 150px;
  overflow: hidden;
  color: var(--ink);
  font-size: 14px;
  white-space: nowrap;
}
/* 渐隐只在「内容自然宽度超过 max-width」时才挂上（判据见 markPreviewOverflow）。
   它按百分比算（100% - 16px），挂到窄元素上会把符号自己抹淡 —— 所以宁可少挂、不可误挂。 */
.fm-sug-preview.is-long {
  mask-image: linear-gradient(to right, #000 calc(100% - 16px), transparent);
  -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 16px), transparent);
}
.fm-sug-hint {
  padding: 4px 14px 2px 10px;
  color: var(--sub);
  font-size: 11.5px;
}

.fm-menu { width: 218px; left: auto; right: 0; }
.fm-menu-title { padding: 4px 8px 2px; color: var(--sub); font-size: 11.5px; }
.fm-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 32px;
  padding: 0 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--ink-2);
  font-family: inherit;
  font-size: 13px;
  text-align: left;
  transition: background 0.12s;
}
.fm-menu-item:hover { background: #f2f4fa; }
.fm-tick {
  flex-shrink: 0;
  width: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--brand);
}
.fm-menu-hint { margin-left: auto; color: var(--sub); font-size: 11.5px; }
.fm-menu-sep { height: 1px; margin: 4px 6px; background: var(--border); }
</style>
