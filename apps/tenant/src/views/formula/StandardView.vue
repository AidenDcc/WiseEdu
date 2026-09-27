<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { AppIcon, AppListToolbar, AppSegmented, showToast } from '@aiteach/shared'
import type { StandardFormula } from '@aiteach/shared'
import KnowledgeFilter from '@/components/ui/KnowledgeFilter.vue'
import { collectStandardFormula, fetchStandardFormulas, fetchTenantDict } from '@/api/org'

const formulas = ref<StandardFormula[]>([])
const subjects = ref<string[]>([])
const subject = ref('')
const keyword = ref('')
const onlyCollected = ref(false)

/** 学科学页签：互斥分段控件（「全部」由空值表示） */
const SUBJECT_OPTIONS = computed(() => [
  { value: '', label: '全部' },
  ...subjects.value.map((name) => ({ value: name, label: name })),
])
/** 知识点过滤（KnowledgeFilter 选中节点的子树叶子 tag；null = 全部） */
const activeTags = ref<string[] | null>(null)

function onKnowledgeChange(tags: string[] | null) {
  activeTags.value = tags
}

onMounted(async () => {
  const [rows, dict] = await Promise.all([fetchStandardFormulas(), fetchTenantDict('subject')])
  formulas.value = rows
  subjects.value = dict.map((item) => item.name)
})

const filtered = computed(() => {
  const kw = keyword.value.trim()
  return formulas.value.filter((row) => {
    if (subject.value && row.branch !== subject.value) return false
    if (activeTags.value && !row.knowledge.some((tag) => activeTags.value!.includes(tag))) return false
    if (kw && !row.name.includes(kw) && !row.chapter.includes(kw) && !row.latex.includes(kw)) return false
    if (onlyCollected.value && !row.collected) return false
    return true
  })
})

/** 卡片公式预览：KaTeX 渲染，教师靠长相认公式，不靠读 LaTeX */
function renderPreview(source: string): string {
  try {
    return katex.renderToString(source, { throwOnError: false })
  } catch {
    return source
  }
}

function onCopy(row: StandardFormula) {
  navigator.clipboard?.writeText(row.latex).catch(() => undefined)
  showToast('LaTeX 源码已复制到剪贴板', 'success')
}

async function onCollect(row: StandardFormula) {
  const updated = await collectStandardFormula(row.id)
  const pos = formulas.value.findIndex((item) => item.id === updated.id)
  if (pos >= 0) formulas.value[pos] = updated
  showToast(updated.collected ? '已收藏（可在录题时快速插入）' : '已取消收藏', 'success')
}
</script>

<template>
  <div class="bank-layout">
    <KnowledgeFilter :rows="formulas" @change="onKnowledgeChange" />

    <!-- 右侧：学科学页签 + 公式卡片 -->
    <div class="right-col">
      <div class="panel lib-panel">
        <div class="subject-switch">
          <AppSegmented v-model="subject" :options="SUBJECT_OPTIONS" />
        </div>

        <AppListToolbar v-model="keyword" placeholder="公式名 / 章节 / LaTeX 片段" :search-width="200">
          <label class="collect-toggle">
            <input v-model="onlyCollected" type="checkbox" />
            仅看已收藏
          </label>
          <template #right>
            <span class="f-hint">{{ filtered.length }} 个公式</span>
          </template>
        </AppListToolbar>

        <div v-if="filtered.length" class="formula-grid">
          <div v-for="row in filtered" :key="row.id" class="formula-card">
            <div class="fc-top">
              <span class="fc-name">{{ row.name }}</span>
              <button
                class="star-btn"
                :class="{ on: row.collected }"
                type="button"
                :title="row.collected ? '取消收藏' : '收藏'"
                @click="onCollect(row)"
              >
                <AppIcon name="star" :size="16" />
              </button>
            </div>
            <p class="fc-chapter">{{ row.branch }} · {{ row.chapter }}</p>
            <div class="fc-preview" v-html="renderPreview(row.latex)" />
            <code class="fc-latex">{{ row.latex }}</code>
            <div class="fc-ops">
              <button class="mini-btn" @click="onCopy(row)">复制 LaTeX</button>
            </div>
          </div>
        </div>
        <p v-else class="empty-row">
          {{ subject ? `「${subject}」暂无匹配公式` : '无匹配公式' }}
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 与题库同构：左右两栏，左侧面板内部滚动 */
.bank-layout {
  --content-h: calc(100vh - 106px);
  display: flex;
  gap: 14px;
  align-items: stretch;
  height: var(--content-h);
  min-height: 460px;
}
.right-col { flex: 1; min-width: 0; min-height: 0; height: 100%; }
.lib-panel { height: 100%; display: flex; flex-direction: column; overflow-y: auto; padding: 14px 18px; }

/* 学科学页签：分段控件按内容宽度收窄，不撑满整行 */
.subject-switch { align-self: flex-start; margin-bottom: 12px; flex-shrink: 0; }

.collect-toggle { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; color: var(--ink-2); }

.formula-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
.formula-card { border: 1.5px solid var(--border); border-radius: 12px; padding: 13px 15px; background: #fff; transition: border-color 0.15s; }
.formula-card:hover { border-color: var(--brand); }
.fc-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.fc-name { font-size: 14px; font-weight: 600; color: var(--ink); }
/* 纯图标按钮：撑成不小于 22×22 的命中区，图标在其中居中 */
.star-btn {
  display: flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; flex-shrink: 0;
  border: none; border-radius: 6px; background: transparent; color: #c6cfd8; padding: 0;
}
.star-btn.on { color: #f0a23c; }
.fc-chapter { font-size: 11.5px; color: var(--sub); margin: 4px 0 8px; }
.fc-preview {
  min-height: 42px;
  display: flex;
  align-items: center;
  overflow-x: auto;
  background: #f7fafa;
  border-radius: 8px;
  padding: 8px 10px;
  margin-bottom: 10px;
  font-size: 15px;
  color: var(--ink);
}
.fc-latex {
  display: block; font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12.5px; color: var(--brand-deep);
  background: var(--brand-soft); border-radius: 8px;
  padding: 8px 10px; margin-bottom: 10px; word-break: break-all;
  line-height: 1.6;
}
.fc-ops { display: flex; gap: 8px; }
</style>
