<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { showToast } from '@aiteach/shared'
import type { OrgFormula, StandardFormula } from '@aiteach/shared'
import AppModal from './AppModal.vue'
import { FORMULA_CATEGORIES, PLACEHOLDER } from './formula-symbols'
import { fetchFormulas, fetchStandardFormulas } from '@/api/org'

/**
 * 公式编辑器（WPS 公式助手风格，FR-FX 复用）。
 *
 * 「编辑 LaTeX」页签 = 分类符号/模板面板 + 源码编辑 + KaTeX 实时预览：
 * 模板里的 \square 占位符插入后自动选中，键入即替换。
 * 「标准公式库 / 我的公式库」页签按当前学科拉取，点选后插入到光标处（非整体替换）。
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

/* ===== 编辑页：分类面板 ===== */
const activeCategory = ref(FORMULA_CATEGORIES[0].key)
const category = computed(
  () => FORMULA_CATEGORIES.find((row) => row.key === activeCategory.value) ?? FORMULA_CATEGORIES[0],
)

const SOURCE = ref<HTMLTextAreaElement | null>(null)
/** 源码框失焦后记住的光标位置，供「公式库点选插入」落到原位置 */
const caret = ref(latex.value.length)

function syncCaret() {
  const el = SOURCE.value
  if (el && typeof el.selectionStart === 'number') caret.value = el.selectionStart
}

/** 点选符号 / 公式库行：插入到光标处；模板的首个占位符自动选中，键入即替换 */
function insertAtCursor(snippet: string) {
  const el = SOURCE.value
  const fromSource = el && document.activeElement === el && typeof el.selectionStart === 'number'
  const start = fromSource ? (el!.selectionStart as number) : caret.value
  const end = fromSource ? (el!.selectionEnd ?? start) : start
  latex.value = latex.value.slice(0, start) + snippet + latex.value.slice(end)
  const ph = snippet.indexOf(PLACEHOLDER)
  const pos = ph >= 0 ? start + ph : start + snippet.length
  caret.value = ph >= 0 ? pos + PLACEHOLDER.length : pos
  requestAnimationFrame(() => {
    if (tab.value !== 'input') return
    el?.focus()
    if (ph >= 0) el?.setSelectionRange(pos, pos + PLACEHOLDER.length)
    else el?.setSelectionRange(pos, pos)
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

/** 面板按钮的 KaTeX 预览 */
function renderPreview(source: string): string {
  try {
    return katex.renderToString(source, { throwOnError: false })
  } catch {
    return ''
  }
}

async function loadTab(target: Tab) {
  tab.value = target
  if (target === 'input' || loaded.value[target]) return
  loaded.value[target] = true
  try {
    if (target === 'standard') {
      standard.value = await fetchStandardFormulas(props.subject ? { subject: props.subject } : {})
    } else {
      mine.value = await fetchFormulas(props.subject ? { subject: props.subject } : {})
    }
  } catch {
    showToast('公式库加载失败', 'error')
  }
}

const kw = computed(() => keyword.value.trim())
const standardList = computed(() => {
  if (!kw.value) return standard.value
  return standard.value.filter((row) => row.name.includes(kw.value) || row.chapter.includes(kw.value) || row.latex.includes(kw.value))
})
const mineList = computed(() => {
  if (!kw.value) return mine.value
  return mine.value.filter((row) => row.name.includes(kw.value) || row.category.includes(kw.value) || row.latex.includes(kw.value))
})

/** 公式库点选：插入光标处并切回编辑页查看结果 */
function pick(source: string) {
  insertAtCursor(source)
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
  void fetchStandardFormulas(props.subject ? { subject: props.subject } : {})
    .then((rows) => {
      standard.value = rows
      loaded.value.standard = true
    })
    .catch(() => undefined)
})
</script>

<template>
  <AppModal :title="editing ? '编辑公式' : '插入公式'" :width="920" @close="emit('close')">
    <div class="fp-tabs">
      <button class="fp-tab" :class="{ on: tab === 'input' }" type="button" @click="loadTab('input')">
        编辑 LaTeX
      </button>
      <button class="fp-tab" :class="{ on: tab === 'standard' }" type="button" @click="loadTab('standard')">
        平台标准公式库
      </button>
      <button class="fp-tab" :class="{ on: tab === 'mine' }" type="button" @click="loadTab('mine')">
        我的公式库
      </button>
    </div>

    <template v-if="tab === 'input'">
      <div class="fp-editor">
        <div class="fp-rail">
          <button
            v-for="cat in FORMULA_CATEGORIES"
            :key="cat.key"
            class="fp-cat"
            :class="{ on: cat.key === activeCategory }"
            type="button"
            @click="activeCategory = cat.key"
          >
            {{ cat.title }}
          </button>
        </div>
        <div class="fp-panel">
          <div class="fp-grid">
            <button
              v-for="item in category.items"
              :key="item.latex + item.label"
              class="fp-cell"
              type="button"
              :title="item.label"
              @click="insertAtCursor(item.latex)"
            >
              <span v-if="renderPreview(item.latex)" class="fp-cell-math" v-html="renderPreview(item.latex)" />
              <span v-else class="fp-cell-label">{{ item.label }}</span>
            </button>
          </div>
          <p class="f-hint" style="margin: 6px 2px 0">
            {{ category.title }} · 点击插入到光标处，<code>\square</code> 占位符自动选中、键入即替换
          </p>
        </div>
      </div>

      <div class="f-field">
        <label class="f-label">LaTeX 源码<span class="req">*</span></label>
        <textarea
          ref="SOURCE"
          v-model="latex"
          class="f-textarea"
          rows="3"
          placeholder="如：x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}（也可从上方面板点选插入）"
          @click="syncCaret"
          @keyup="syncCaret"
          @select="syncCaret"
        />
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
          {{ props.subject ? `「${props.subject}」暂无公式，可切到「编辑 LaTeX」直接输入` : '没有匹配的公式，可切到「编辑 LaTeX」直接输入' }}
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
.fp-tabs { display: flex; gap: 6px; margin-bottom: 14px; }
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

/* 编辑页：左分类栏 + 右符号宫格 */
.fp-editor { display: flex; gap: 12px; margin-bottom: 14px; }
.fp-rail {
  width: 118px;
  flex-shrink: 0;
  max-height: 300px;
  overflow-y: auto;
  border: 1.5px solid var(--border);
  border-radius: 10px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.fp-cat {
  text-align: left;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--ink-2);
  font-size: 12.5px;
  font-weight: 600;
  padding: 7px 10px;
  transition: all 0.15s;
  white-space: nowrap;
}
.fp-cat:hover { background: var(--brand-soft); color: var(--brand-deep); }
.fp-cat.on { background: var(--brand); color: #fff; }

.fp-panel { flex: 1; min-width: 0; }
.fp-grid {
  max-height: 264px;
  overflow-y: auto;
  border: 1.5px solid var(--border);
  border-radius: 10px;
  padding: 8px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
  gap: 6px;
  align-content: start;
}
.fp-cell {
  min-height: 40px;
  border: 1.5px solid var(--border);
  border-radius: 8px;
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px 6px;
  overflow: hidden;
  transition: all 0.15s;
}
.fp-cell:hover { border-color: var(--brand); background: var(--brand-soft); }
.fp-cell-math {
  font-size: 15px;
  color: var(--ink);
  max-width: 100%;
  overflow-x: auto;
  scrollbar-width: none;
}
.fp-cell-label { font-size: 12px; color: var(--ink-2); }

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
