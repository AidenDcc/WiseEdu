<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { AppIcon, showToast } from '@aiteach/shared'
import type { OrgFormula } from '@aiteach/shared'
import { fetchFormulas, offshelfFormula, reviewFormula } from '@/api/org'

const formulas = ref<OrgFormula[]>([])
const keyword = ref('')

async function load() {
  formulas.value = await fetchFormulas()
}

const shared = computed(() =>
  formulas.value.filter(
    (row) => row.scope === 'shared' && (!keyword.value || row.name.includes(keyword.value) || row.owner.includes(keyword.value)),
  ),
)
/** 已上架（全机构可用） */
const onshelf = computed(() => shared.value.filter((row) => row.status === 'approved'))
/** 待审核（机构管理员审） */
const pendingReview = computed(() => shared.value.filter((row) => row.status === 'pending'))
/** 历史：驳回 / 已下架 */
const archived = computed(() => shared.value.filter((row) => row.status === 'rejected' || row.status === 'off'))

const STATUS_TEXT: Record<string, string> = { approved: '已上架', pending: '待审核', rejected: '已驳回', off: '已下架' }
const STATUS_CLASS: Record<string, string> = { approved: 'tag-green', pending: 'tag-orange', rejected: 'tag-red', off: 'tag-gray' }

async function onReview(row: OrgFormula, pass: boolean) {
  if (!pass && !window.confirm(`驳回「${row.name}」的共享申请？`)) return
  await reviewFormula(row.id, pass)
  await load()
  showToast(pass ? '已通过并上架，全机构可用' : '已驳回，作者会收到通知', 'success')
}

async function onOffshelf(row: OrgFormula) {
  if (!window.confirm(`下架「${row.name}」？已引用该公式的题目不受影响，但不可再新增引用`)) return
  await offshelfFormula(row.id)
  await load()
  showToast('已下架', 'success')
}

function onCopy(row: OrgFormula) {
  navigator.clipboard?.writeText(row.latex).catch(() => undefined)
  showToast('LaTeX 源码已复制', 'success')
}

onMounted(load)
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h2>机构共享公式</h2>
      <span class="f-hint">员工提交 → 机构管理员审核上架 → 全机构录题 / 组卷可用</span>
      <input v-model="keyword" class="f-input" placeholder="搜索公式 / 作者" style="width: 200px; margin-left: auto" />
    </div>

    <!-- 待审核 -->
    <div class="panel">
      <div class="section-title">
        待审核（{{ pendingReview.length }}）
        <span class="f-hint">机构管理员审核后上架</span>
      </div>
      <p v-if="pendingReview.length === 0" class="f-hint" style="padding: 6px 2px 10px">暂无待审核公式</p>
      <div v-for="row in pendingReview" :key="row.id" class="formula-row pending">
        <div class="fr-main">
          <span class="fr-name">{{ row.name }}</span>
          <span class="tag tag-gray">{{ row.category }}</span>
          <span class="f-hint">提交人 {{ row.owner }} · {{ row.updatedAt }}</span>
        </div>
        <code class="fr-latex">{{ row.latex }}</code>
        <div class="op-group">
          <button class="mini-btn" @click="onCopy(row)">复制</button>
          <button class="mini-btn success" @click="onReview(row, true)"><AppIcon name="check" :size="13" /> 通过上架</button>
          <button class="mini-btn danger" @click="onReview(row, false)">驳回</button>
        </div>
      </div>
    </div>

    <!-- 已上架 -->
    <div class="panel">
      <div class="section-title">已上架（{{ onshelf.length }}）<span class="f-hint">全机构可用</span></div>
      <p v-if="onshelf.length === 0" class="f-hint" style="padding: 6px 2px 10px">暂无已上架公式</p>
      <div v-for="row in onshelf" :key="row.id" class="formula-row">
        <div class="fr-main">
          <span class="fr-name">{{ row.name }}</span>
          <span class="tag tag-gray">{{ row.category }}</span>
          <span class="f-hint">贡献者 {{ row.owner }} · {{ row.updatedAt }}</span>
        </div>
        <code class="fr-latex">{{ row.latex }}</code>
        <div class="op-group">
          <button class="mini-btn" @click="onCopy(row)">复制 LaTeX</button>
          <button class="mini-btn danger" @click="onOffshelf(row)">下架</button>
        </div>
      </div>
    </div>

    <!-- 历史 -->
    <div class="panel" v-if="archived.length">
      <div class="section-title">驳回 / 下架记录（{{ archived.length }}）</div>
      <div v-for="row in archived" :key="row.id" class="formula-row dim">
        <div class="fr-main">
          <span class="fr-name">{{ row.name }}</span>
          <span class="tag" :class="STATUS_CLASS[row.status]">{{ STATUS_TEXT[row.status] }}</span>
          <span class="f-hint">{{ row.owner }}</span>
        </div>
        <code class="fr-latex">{{ row.latex }}</code>
      </div>
    </div>
  </div>
</template>

<style scoped>
.formula-row {
  display: flex; align-items: center; gap: 14px;
  border: 1.5px solid var(--border); border-radius: 10px;
  padding: 10px 14px; margin: 0 2px 8px; background: #fff;
}
.formula-row.pending { border-color: var(--warn); background: var(--warn-soft); }
.formula-row.dim { opacity: 0.62; }
.fr-main { display: flex; align-items: center; gap: 10px; width: 330px; flex-shrink: 0; }
.fr-name { font-size: 13.5px; font-weight: 600; color: var(--ink); }
.fr-latex {
  flex: 1; font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px; color: var(--brand-deep);
  background: var(--brand-soft); border-radius: 7px; padding: 6px 10px;
  word-break: break-all;
}
.formula-row .op-group { flex-shrink: 0; }
</style>
