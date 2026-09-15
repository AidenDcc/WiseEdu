<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import katex from 'katex'
import { showToast } from '@aiteach/shared'
import type { OrgFormula, StandardFormula } from '@aiteach/shared'
import AppModal from './AppModal.vue'
import { fetchFormulas, fetchStandardFormulas } from '@/api/org'

/**
 * 公式插入 / 编辑弹窗（FR-FX 复用）。
 *
 * 「从公式库插入」直接复用现成的平台标准公式库与我的公式库接口，教师不必手写 LaTeX ——
 * 这是「插入公式」这条需求的主要落点，手写 LaTeX 只作为兜底。
 */
const props = withDefaults(
  defineProps<{
    /** 当前学科，用于默认筛选公式库 */
    subject?: string
    /** 编辑已有公式时传入，回填输入框 */
    initialLatex?: string
    /** 编辑态：标题与确认按钮文案不同 */
    editing?: boolean
    /**
     * 编辑已有公式时它原本是行内还是块级。
     * 必须传：否则编辑块级公式时开关停在「行内」，确认会走到 updateInlineMath 而匹配不上节点。
     */
    initialBlock?: boolean
  }>(),
  { subject: '', initialLatex: '', editing: false, initialBlock: false },
)

const emit = defineEmits<{ close: []; confirm: [latex: string, block: boolean] }>()

type Tab = 'input' | 'standard' | 'mine'
const tab = ref<Tab>('input')
const latex = ref(props.initialLatex)
const block = ref(props.initialBlock)
const keyword = ref('')

const standard = ref<StandardFormula[]>([])
const mine = ref<OrgFormula[]>([])
const loaded = ref<Record<string, boolean>>({})

/** 常用符号 / 结构：点一下即追加到源码，覆盖 K12 高频写法 */
const SYMBOLS: Array<{ label: string; insert: string; tip: string }> = [
  { label: 'a/b', insert: '\\frac{}{}', tip: '分数' },
  { label: '√', insert: '\\sqrt{}', tip: '根号' },
  { label: 'xⁿ', insert: '^{}', tip: '上标' },
  { label: 'xₙ', insert: '_{}', tip: '下标' },
  { label: 'Σ', insert: '\\sum_{i=1}^{n}', tip: '求和' },
  { label: '∫', insert: '\\int_{a}^{b}', tip: '积分' },
  { label: 'lim', insert: '\\lim_{x \\to 0}', tip: '极限' },
  { label: 'α', insert: '\\alpha', tip: '阿尔法' },
  { label: 'β', insert: '\\beta', tip: '贝塔' },
  { label: 'θ', insert: '\\theta', tip: '西塔' },
  { label: 'π', insert: '\\pi', tip: '派' },
  { label: '≤', insert: '\\leq', tip: '小于等于' },
  { label: '≥', insert: '\\geq', tip: '大于等于' },
  { label: '≠', insert: '\\neq', tip: '不等于' },
  { label: '±', insert: '\\pm', tip: '正负' },
  { label: '∞', insert: '\\infty', tip: '无穷' },
  { label: '→', insert: '\\to', tip: '趋于' },
  { label: '∵', insert: '\\because', tip: '因为' },
  { label: '∴', insert: '\\therefore', tip: '所以' },
]

const SOURCE = ref<HTMLTextAreaElement | null>(null)

function appendSymbol(snippet: string) {
  const el = SOURCE.value
  if (!el) {
    latex.value += snippet
    return
  }
  const start = el.selectionStart ?? latex.value.length
  const end = el.selectionEnd ?? start
  latex.value = latex.value.slice(0, start) + snippet + latex.value.slice(end)
  /* 光标落在花括号内，符合「先写结构再填空」的手感 */
  const caret = start + snippet.length - (snippet.endsWith('}') ? 1 : 0)
  requestAnimationFrame(() => {
    el.focus()
    el.setSelectionRange(caret, caret)
  })
}

/** 实时预览：语法非法不抛错，回退展示错误提示而非空白 */
const previewHtml = computed(() => {
  if (!latex.value.trim()) return ''
  try {
    return katex.renderToString(latex.value, {
      throwOnError: false,
      displayMode: block.value,
    })
  } catch {
    return '<span class="fp-bad">LaTeX 语法有误</span>'
  }
})

async function loadTab(target: Tab) {
  tab.value = target
  if (target === 'input' || loaded.value[target]) return
  loaded.value[target] = true
  try {
    if (target === 'standard') standard.value = await fetchStandardFormulas()
    else mine.value = await fetchFormulas()
  } catch {
    showToast('公式库加载失败', 'error')
  }
}

const standardList = computed(() => {
  const kw = keyword.value.trim()
  /* 搜索命中为空就是为空，要能落到「没有匹配的公式」空态，不能退回全量 */
  if (kw) {
    return standard.value.filter((row) => row.name.includes(kw) || row.chapter.includes(kw) || row.latex.includes(kw))
  }
  if (!props.subject) return standard.value
  /* 学科筛选后为空时才退回全量，避免教师以为公式库没数据 */
  const bySubject = standard.value.filter((row) => row.branch === props.subject)
  return bySubject.length ? bySubject : standard.value
})

const mineList = computed(() => {
  const kw = keyword.value.trim()
  if (!kw) return mine.value
  return mine.value.filter((row) => row.name.includes(kw) || row.category.includes(kw) || row.latex.includes(kw))
})

/** 列表里的公式也做 KaTeX 预览 —— 教师靠长相认公式，不靠读 LaTeX */
function renderPreview(source: string): string {
  try {
    return katex.renderToString(source, { throwOnError: false })
  } catch {
    return source
  }
}

function pick(source: string) {
  latex.value = source
  tab.value = 'input'
}

function confirm() {
  const value = latex.value.trim()
  if (!value) {
    showToast('请先输入或选择公式', 'error')
    return
  }
  emit('confirm', value, block.value)
}

onMounted(() => {
  loadTab('input')
  /* 预取公式库，切页签时无等待 */
  void fetchStandardFormulas().then((rows) => {
    standard.value = rows
    loaded.value.standard = true
  }).catch(() => undefined)
})
</script>

<template>
  <AppModal :title="editing ? '编辑公式' : '插入公式'" :width="760" @close="emit('close')">
    <div class="fp-tabs">
      <button class="fp-tab" :class="{ on: tab === 'input' }" type="button" @click="loadTab('input')">
        手输 LaTeX
      </button>
      <button class="fp-tab" :class="{ on: tab === 'standard' }" type="button" @click="loadTab('standard')">
        平台标准公式库
      </button>
      <button class="fp-tab" :class="{ on: tab === 'mine' }" type="button" @click="loadTab('mine')">
        我的公式库
      </button>
    </div>

    <template v-if="tab === 'input'">
      <div class="f-field">
        <label class="f-label">LaTeX 源码<span class="req">*</span></label>
        <textarea
          ref="SOURCE"
          v-model="latex"
          class="f-textarea"
          rows="3"
          placeholder="如：x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}"
        />
      </div>

      <div class="f-field">
        <label class="f-label">常用符号 / 结构</label>
        <div class="fp-symbols">
          <button
            v-for="s in SYMBOLS"
            :key="s.insert"
            class="fp-sym"
            type="button"
            :title="s.tip"
            @click="appendSymbol(s.insert)"
          >
            {{ s.label }}
          </button>
        </div>
      </div>

      <div class="f-field">
        <label class="f-label">插入方式</label>
        <div class="fp-kinds">
          <button class="fp-kind" :class="{ on: !block }" type="button" @click="block = false">
            行内公式<span class="fp-kind-hint">与文字同一行，如 x²+y²=1</span>
          </button>
          <button class="fp-kind" :class="{ on: block }" type="button" @click="block = true">
            独立公式<span class="fp-kind-hint">独占一行并居中</span>
          </button>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="f-field">
        <input v-model="keyword" class="f-input" placeholder="搜索公式名称 / 章节 / LaTeX 片段" />
      </div>
      <div class="fp-list">
        <button
          v-for="row in tab === 'standard' ? standardList : mineList"
          :key="row.id"
          class="fp-item"
          type="button"
          @click="pick(row.latex)"
        >
          <span class="fp-item-name">{{ row.name }}</span>
          <span class="fp-item-tag tag tag-gray">{{ 'branch' in row ? row.chapter : row.category }}</span>
          <span class="fp-item-preview" v-html="renderPreview(row.latex)" />
          <code class="fp-item-latex">{{ row.latex }}</code>
        </button>
        <p v-if="(tab === 'standard' ? standardList : mineList).length === 0" class="fp-empty">
          没有匹配的公式，可切到「手输 LaTeX」直接输入
        </p>
      </div>
    </template>

    <div class="f-field" style="margin-top: 14px">
      <label class="f-label">预览</label>
      <div class="fp-preview" :class="{ block }">
        <span v-if="!previewHtml" class="f-hint">输入 LaTeX 后在此实时预览</span>
        <span v-else v-html="previewHtml" />
      </div>
    </div>

    <template #footer>
      <button class="btn btn-ghost" type="button" @click="emit('close')">取消</button>
      <button class="btn btn-primary" type="button" @click="confirm">
        {{ editing ? '保存修改' : '插入公式' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.fp-tabs { display: flex; gap: 6px; margin-bottom: 16px; }
.fp-tab {
  border: 1.5px solid var(--border);
  background: #fff;
  color: var(--ink-2);
  font-size: 13px;
  font-weight: 600;
  padding: 7px 14px;
  border-radius: 9px;
  transition: all 0.15s;
}
.fp-tab:hover { border-color: var(--brand); color: var(--brand-deep); }
.fp-tab.on { border-color: var(--brand); background: var(--brand-soft); color: var(--brand-deep); }

.fp-symbols { display: flex; flex-wrap: wrap; gap: 6px; }
.fp-sym {
  min-width: 38px;
  height: 32px;
  padding: 0 9px;
  border: 1.5px solid var(--border);
  border-radius: 8px;
  background: #fff;
  color: var(--ink-2);
  font-size: 13.5px;
  transition: all 0.15s;
}
.fp-sym:hover { border-color: var(--brand); color: var(--brand-deep); background: var(--brand-soft); }

.fp-kinds { display: flex; gap: 10px; }
.fp-kind {
  flex: 1;
  text-align: left;
  border: 1.5px solid var(--border);
  border-radius: 10px;
  background: #fff;
  padding: 9px 12px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-2);
  transition: all 0.15s;
}
.fp-kind.on { border-color: var(--brand); background: var(--brand-soft); color: var(--brand-deep); }
.fp-kind-hint { display: block; font-size: 11.5px; font-weight: 400; color: var(--sub); margin-top: 3px; }

.fp-list {
  max-height: 280px;
  overflow-y: auto;
  border: 1.5px solid var(--border);
  border-radius: 10px;
}
.fp-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 12px;
  border: none;
  border-bottom: 1px solid var(--border);
  background: #fff;
  text-align: left;
  transition: background 0.15s;
}
.fp-item:last-child { border-bottom: none; }
.fp-item:hover { background: var(--brand-soft); }
.fp-item-name { font-size: 13px; font-weight: 600; color: var(--ink); flex-shrink: 0; }
.fp-item-preview { flex: 1; overflow: hidden; color: var(--ink-2); }
.fp-item-latex {
  font-size: 11.5px;
  color: var(--sub);
  max-width: 190px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;
}
.fp-empty { padding: 18px; text-align: center; font-size: 13px; color: var(--sub); }

.fp-preview {
  min-height: 54px;
  display: flex;
  align-items: center;
  padding: 10px 14px;
  background: #f7fafa;
  border-radius: 10px;
  overflow-x: auto;
}
.fp-preview.block { justify-content: center; }
.fp-preview :deep(.fp-bad) { color: var(--danger); font-size: 13px; }
</style>
