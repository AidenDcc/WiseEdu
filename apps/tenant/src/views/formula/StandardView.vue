<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { AppIcon, showToast } from '@aiteach/shared'
import type { StandardFormula } from '@aiteach/shared'
import { collectStandardFormula, fetchStandardFormulas } from '@/api/org'

const formulas = ref<StandardFormula[]>([])
const branch = ref('')
const keyword = ref('')
const onlyCollected = ref(false)

async function load() {
  formulas.value = await fetchStandardFormulas()
}

const branches = computed(() => [...new Set(formulas.value.map((row) => row.branch))])

const filtered = computed(() =>
  formulas.value.filter(
    (row) =>
      (!branch.value || row.branch === branch.value) &&
      (!keyword.value || row.name.includes(keyword.value) || row.chapter.includes(keyword.value)) &&
      (!onlyCollected.value || row.collected),
  ),
)

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

onMounted(load)
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h2>标准公式库</h2>
      <span class="f-hint">平台权威维护 · 覆盖 K12 全学科，支持一键复制 LaTeX 与收藏</span>
    </div>

    <div class="panel">
      <div class="filter-bar">
        <span class="filter-label">学科</span>
        <select v-model="branch" class="f-select">
          <option value="">全部</option>
          <option v-for="b in branches" :key="b">{{ b }}</option>
        </select>
        <span class="filter-label">关键词</span>
        <input v-model="keyword" class="f-input" placeholder="公式名 / 章节" style="width: 180px" />
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
          <code class="fc-latex">{{ row.latex }}</code>
          <div class="fc-ops">
            <button class="mini-btn" @click="onCopy(row)">复制 LaTeX</button>
          </div>
        </div>
        <p v-if="filtered.length === 0" class="f-hint" style="grid-column: 1 / -1; text-align: center; padding: 30px">无匹配公式</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.collect-toggle { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; color: var(--ink-2); margin-left: 10px; }

.formula-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; padding: 4px 2px 8px; }
.formula-card { border: 1.5px solid var(--border); border-radius: 12px; padding: 13px 15px; background: #fff; transition: border-color 0.15s; }
.formula-card:hover { border-color: var(--brand); }
.fc-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.fc-name { font-size: 14px; font-weight: 600; color: var(--ink); }
.star-btn { border: none; background: transparent; color: #c6cfd8; display: flex; padding: 2px; }
.star-btn.on { color: #f0a23c; }
.fc-chapter { font-size: 11.5px; color: var(--sub); margin: 4px 0 8px; }
.fc-latex {
  display: block; font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12.5px; color: var(--brand-deep);
  background: var(--brand-soft); border-radius: 8px;
  padding: 8px 10px; margin-bottom: 10px; word-break: break-all;
  line-height: 1.6;
}
.fc-ops { display: flex; gap: 8px; }
</style>
