<script setup lang="ts">
/**
 * AI 生成内容标识与复核（T-10-08）。
 *
 * 治理红线：AI 生成内容须经教师复核后方可发布给学生。
 * 每条产物带：AI 显著标识（默认开启，合规要求）、AI 自动质检结论（pass/warn/error）、
 * 复核状态与复核人。error 级必须人工复核才能放行；驳回即打回重生成。
 *
 * 筛选按「复核时真正会问的问题」给：这是什么类型（题目还是试卷）、哪个环节产的、
 * 复核到哪一步了、质检有没有异常 —— 四组条件 + 标题搜索，够把一个待办队列切到能一口气看完。
 */
import { computed, onMounted, ref } from 'vue'
import {
  ARTIFACT_REVIEW_STATUS_TEXT,
  AppFilterPanel,
  AppIcon,
  AppListToolbar,
  AppModal,
  AppPageHeader,
  AppPagination,
  showToast,
} from '@aiteach/shared'
import type { AiArtifactQuery, AiArtifactReview, FilterRowDef } from '@aiteach/shared'
import { fetchAiArtifacts, reviewAiArtifact } from '@/api/student'

const artifacts = ref<AiArtifactReview[]>([])
const loading = ref(true)
const keyword = ref('')
const filter = ref<Record<string, string[]>>({ kind: [], scene: [], status: [], autoCheck: [] })
const page = ref(1)
const PAGE_SIZE = 10

/** 候选值先全量取一次：筛完再取候选会只剩命中项，选不回去 */
const kindOptions = ref<string[]>([])
const sceneOptions = ref<string[]>([])

const STATUS_OPTIONS = ['pending', 'approved', 'rejected']
const AUTO_CHECK_OPTIONS = ['pass', 'warn', 'error']

const AUTO_CHECK_TEXT: Record<string, string> = { pass: '质检通过', warn: '质检提醒', error: '质检异常' }

const filterRows = computed<FilterRowDef[]>(() => [
  { key: 'kind', label: '类型', options: kindOptions.value, multiple: false },
  { key: 'scene', label: '场景', options: sceneOptions.value, multiple: false },
  {
    key: 'status',
    label: '复核状态',
    options: STATUS_OPTIONS,
    optionLabels: ARTIFACT_REVIEW_STATUS_TEXT as Record<string, string>,
    multiple: false,
  },
  {
    key: 'autoCheck',
    label: '自动质检',
    options: AUTO_CHECK_OPTIONS,
    optionLabels: AUTO_CHECK_TEXT,
    multiple: false,
  },
])

function currentQuery(): AiArtifactQuery {
  return {
    keyword: keyword.value.trim(),
    kind: filter.value.kind[0] ?? '',
    scene: filter.value.scene[0] ?? '',
    status: filter.value.status[0] ?? '',
    autoCheck: filter.value.autoCheck[0] ?? '',
  }
}

async function load() {
  loading.value = true
  try {
    artifacts.value = await fetchAiArtifacts(currentQuery())
  } catch (error) {
    showToast(error instanceof Error ? error.message : '复核列表加载失败', 'error')
  } finally {
    loading.value = false
  }
}

async function bootstrap() {
  try {
    const all = await fetchAiArtifacts({})
    kindOptions.value = [...new Set(all.map((row) => row.kind))]
    sceneOptions.value = [...new Set(all.map((row) => row.scene))]
    artifacts.value = all
  } catch (error) {
    showToast(error instanceof Error ? error.message : '复核列表加载失败', 'error')
  } finally {
    loading.value = false
  }
}

onMounted(bootstrap)

function onFilterChange(next: Record<string, string[]>) {
  filter.value = next
  page.value = 1
  load()
}

function onKeywordChange(value: string) {
  keyword.value = value
  page.value = 1
  load()
}

const paged = computed(() => artifacts.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE))
const pendingCount = computed(() => artifacts.value.filter((row) => row.status === 'pending').length)

const autoCheckMeta = {
  pass: { text: '自动质检通过', tag: 'tag-green' },
  warn: { text: '质检提醒', tag: 'tag-orange' },
  error: { text: '质检异常', tag: 'tag-red' },
} as const

function statusTag(status: AiArtifactReview['status']) {
  return status === 'approved' ? 'tag-green' : status === 'pending' ? 'tag-orange' : 'tag-red'
}

/* ===== 复核确认弹窗 ===== */
const reviewing = ref<null | { row: AiArtifactReview; pass: boolean }>(null)

function openReview(row: AiArtifactReview, pass: boolean) {
  reviewing.value = { row, pass }
}

async function submitReview() {
  if (!reviewing.value) return
  try {
    await reviewAiArtifact(reviewing.value.row.id, reviewing.value.pass)
    showToast(reviewing.value.pass ? '已通过复核，产物可正常使用' : '已驳回，产物不会发布给学生', 'success')
    reviewing.value = null
    load()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '操作失败', 'error')
  }
}
</script>

<template>
  <div class="page">
    <AppPageHeader desc="AI 生成内容须教师复核后方可发布给学生；产物默认携带 AI 生成标识，质检异常（error 级）必须人工复核。" />

    <div class="notice-bar">
      <AppIcon name="warning" :size="15" />
      待复核 <b>{{ pendingCount }}</b> 条 · 质检异常（error 级）条目必须人工复核后才能放行，驳回即打回重生成。
    </div>

    <AppFilterPanel :rows="filterRows" :model-value="filter" @update:model-value="onFilterChange" />

    <div class="panel">
      <div class="list-head">
        <AppListToolbar
          :model-value="keyword"
          placeholder="搜索产物名称"
          :search-width="240"
          @update:model-value="onKeywordChange"
        >
          <template #right>
            <span class="head-stat">当前筛选 <b>{{ artifacts.length }}</b> 条</span>
          </template>
        </AppListToolbar>
      </div>

      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>产物</th>
              <th>类型</th>
              <th>场景</th>
              <th>AI 标识</th>
              <th>自动质检</th>
              <th>复核状态</th>
              <th>复核人 / 时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="8" class="empty-row">加载中…</td>
            </tr>
            <tr v-else-if="artifacts.length === 0">
              <td colspan="8" class="empty-row">没有符合条件的复核条目</td>
            </tr>
            <template v-else>
              <tr v-for="row in paged" :key="row.id">
                <td class="cell-strong">
                  {{ row.title }}
                  <span v-if="row.autoCheck === 'error' && row.status === 'pending'" class="tag tag-red must">必须人工复核</span>
                </td>
                <td><span class="tag tag-blue">{{ row.kind }}</span></td>
                <td>{{ row.scene }}</td>
                <td>
                  <span class="tag" :class="row.aiLabeled ? 'tag-blue' : 'tag-red'">{{ row.aiLabeled ? '已标识' : '缺失' }}</span>
                </td>
                <td>
                  <span class="tag" :class="autoCheckMeta[row.autoCheck].tag">{{ autoCheckMeta[row.autoCheck].text }}</span>
                  <p class="check-note">{{ row.autoCheckNote }}</p>
                </td>
                <td><span class="tag" :class="statusTag(row.status)">{{ ARTIFACT_REVIEW_STATUS_TEXT[row.status] }}</span></td>
                <td class="mono">{{ row.reviewer ? `${row.reviewer} · ${row.reviewedAt}` : '—' }}</td>
                <td>
                  <div class="op-group">
                    <template v-if="row.status === 'pending'">
                      <button class="mini-btn" @click="openReview(row, true)">通过</button>
                      <button class="mini-btn danger" @click="openReview(row, false)">驳回</button>
                    </template>
                    <span v-else class="muted">—</span>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <AppPagination v-model:page="page" :total="artifacts.length" :page-size="PAGE_SIZE" />
    </div>

    <AppModal
      v-if="reviewing"
      :title="reviewing.pass ? `通过复核 · ${reviewing.row.title}` : `驳回 · ${reviewing.row.title}`"
      :width="440"
      @close="reviewing = null"
    >
      <p class="review-note">
        <template v-if="reviewing.pass">
          通过后该产物可正常发布给学生（保留 AI 生成标识）。
        </template>
        <template v-else>
          驳回后产物不会发布给学生，可回到对应模块重新生成。
        </template>
      </p>
      <div class="check-box">
        <span class="tag" :class="autoCheckMeta[reviewing.row.autoCheck].tag">{{ autoCheckMeta[reviewing.row.autoCheck].text }}</span>
        <span class="check-text">{{ reviewing.row.autoCheckNote }}</span>
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="reviewing = null">取消</button>
        <button class="btn" :class="reviewing.pass ? 'btn-primary' : 'btn-danger'" @click="submitReview">
          {{ reviewing.pass ? '确认通过' : '确认驳回' }}
        </button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.notice-bar {
  display: flex; align-items: center; gap: 8px; padding: 10px 14px;
  background: #fff7ed; border: 1px solid #fed7aa; border-radius: 10px;
  font-size: 13px; color: #92600a;
}
.notice-bar b { font-size: 15px; }
/* 工具条嵌在面板顶部（与其它列表页同一写法：间距由 AppListToolbar 自带） */
.list-head { padding: 14px 18px 0; }
.head-stat { font-size: 12.5px; color: var(--sub); white-space: nowrap; }
.head-stat b { color: var(--ink); font-variant-numeric: tabular-nums; }
.mono { font-family: 'SF Mono', Menlo, monospace; font-size: 12px; }
.muted { color: var(--sub); font-size: 12px; }
.must { margin-left: 6px; }
.check-note { margin: 4px 0 0; font-size: 11.5px; color: var(--sub); max-width: 240px; }
.review-note { font-size: 13px; line-height: 1.8; color: var(--text); }
.check-box { display: flex; align-items: flex-start; gap: 8px; margin-top: 12px; }
.check-text { font-size: 12.5px; color: var(--sub); line-height: 1.7; }
.data-table :deep(td),
.data-table :deep(th) { white-space: nowrap; }
</style>
