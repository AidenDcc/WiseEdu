<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { AppIcon, showToast } from '@aiteach/shared'
import type { StandardFormula } from '@aiteach/shared'
import KnowledgeFilter from '@/components/ui/KnowledgeFilter.vue'
import { collectStandardFormula, fetchStandardFormulas, fetchTenantDict } from '@/api/org'

const formulas = ref<StandardFormula[]>([])
const subjects = ref<string[]>([])
const subject = ref('')
const keyword = ref('')
const onlyCollected = ref(false)
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
        <div class="subject-tabs">
          <button class="subj-tab" :class="{ on: subject === '' }" type="button" @click="subject = ''">
            全部
          </button>
          <button
            v-for="name in subjects"
            :key="name"
            class="subj-tab"
            :class="{ on: subject === name }"
            type="button"
            @click="subject = name"
          >
            {{ name }}
          </button>
        </div>

        <div class="filter-bar">
          <span class="filter-label">关键词</span>
          <input v-model="keyword" class="f-input" placeholder="公式名 / 章节 / LaTeX 片段" style="width: 200px" />
          <label class="collect-toggle">
            <input v-model="onlyCollected" type="checkbox" />
            仅看已收藏
          </label>
          <span class="f-hint" style="margin-left: auto">{{ filtered.length }} 个公式</span>
        </div>

        <div class="formula-grid">
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
          <p v-if="filtered.length === 0" class="f-hint" style="grid-column: 1 / -1; text-align: center; padding: 30px">
            {{ subject ? `「${subject}」暂无匹配公式` : '无匹配公式' }}
          </p>
        </div>
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
.lib-panel { height: 100%; display: flex; flex-direction: column; overflow-y: auto; }

/* 学科学页签 */
.subject-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; flex-shrink: 0; }
.subj-tab {
  border: 1.5px solid var(--border);
  border-radius: 9px;
  background: #fff;
  color: var(--ink-2);
  font-size: 13px;
  font-weight: 600;
  padding: 6px 14px;
  transition: all 0.15s;
}
.subj-tab:hover { border-color: var(--brand); color: var(--brand-deep); }
.subj-tab.on { border-color: var(--brand); background: var(--brand-soft); color: var(--brand-deep); }

.collect-toggle { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; color: var(--ink-2); margin-left: 10px; }
.filter-bar { flex-shrink: 0; }

.formula-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; padding: 12px 2px 8px; }
.formula-card { border: 1.5px solid var(--border); border-radius: 12px; padding: 13px 15px; background: #fff; transition: border-color 0.15s; }
.formula-card:hover { border-color: var(--brand); }
.fc-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.fc-name { font-size: 14px; font-weight: 600; color: var(--ink); }
.star-btn { border: none; background: transparent; color: #c6cfd8; display: flex; padding: 2px; }
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
