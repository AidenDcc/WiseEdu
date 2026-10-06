<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { AppFilterPanel, AppIcon, AppListToolbar, AppPageHeader, showToast, AppDrawer } from '@aiteach/shared'
import type { FilterRowDef, SquareResource } from '@aiteach/shared'
import { collectSquare, downloadSquare, fetchSquare } from '@/api/org'
import { useBaseData } from '@/composables/useBaseData'

const { subjects, ensure } = useBaseData()

const resources = ref<SquareResource[]>([])

const KINDS = ['题目', '试卷', '教辅', '动画', '视频']
const KIND_CLASS: Record<string, string> = {
  题目: 'tag-blue',
  试卷: 'tag-green',
  教辅: 'tag-orange',
  动画: 'tag-blue',
  视频: 'tag-green',
}

/* 筛选条件行：类型 / 学科均互斥（原本是两个单选 <select>，「全部」由空值表示） */
const FILTER_ROWS = computed<FilterRowDef[]>(() => [
  { key: 'kind', label: '类型', options: KINDS, multiple: false },
  { key: 'subject', label: '学科', options: subjects.value, multiple: false },
])

const filters = reactive<Record<string, string[]>>({ kind: [], subject: [] })
const keyword = ref('')

/**
 * 覆盖式回写：逐 key 写进这份 reactive 对象本身，**不能让 `v-model` 整体替换它**。
 * `v-model` 在这里是两个坏结果二选一：dev 产物写的是 `$setup.filters` 属性，脚本里这份引用
 * 一动不动；生产产物把整份对象换成普通对象，不再有响应性可追踪。两种情况都是
 * **点了 chip 页面毫无反应**，故显式回写（与 ListView / BankView 同一写法）。
 */
function onFiltersChange(next: Record<string, string[]>) {
  filters.kind = next.kind ?? []
  filters.subject = next.subject ?? []
}

/** 「为你推荐」批次（换一批） */
const batch = ref(0)

async function load() {
  await ensure()
  resources.value = await fetchSquare()
}

const filtered = computed(() => {
  const kind = filters.kind[0] ?? ''
  const subject = filters.subject[0] ?? ''
  let list = resources.value.filter(
    (row) =>
      (!kind || row.kind === kind) &&
      (!subject || row.subject === subject) &&
      (!keyword.value || row.title.includes(keyword.value) || row.knowledge.includes(keyword.value)),
  )
  if (!kind && !subject && !keyword.value) {
    // 推荐流：按批次轮换起始位，模拟「换一批」
    const rotate = batch.value % Math.max(list.length, 1)
    list = [...list.slice(rotate), ...list.slice(0, rotate)]
  }
  return list
})

const detail = ref<SquareResource | null>(null)

function openDetail(row: SquareResource) {
  detail.value = row
}

async function onCollect(row: SquareResource) {
  const updated = await collectSquare(row.id)
  const pos = resources.value.findIndex((item) => item.id === updated.id)
  if (pos >= 0) resources.value[pos] = updated
  showToast(updated.collected ? '已收藏，可在「我的收藏」中查看' : '已取消收藏', 'success')
}

async function onDownload(row: SquareResource) {
  const updated = await downloadSquare(row.id)
  const pos = resources.value.findIndex((item) => item.id === updated.id)
  if (pos >= 0) resources.value[pos] = updated
  showToast(`《${row.title}》已下载引用（自动标注来源：${row.org} ${row.sharer}）`, 'success')
}

function onRefresh() {
  batch.value += 1
  showToast('已换一批推荐', 'success')
}

onMounted(load)
</script>

<template>
  <div class="page">
    <AppPageHeader desc="跨机构共享的优质资源 · 下载引用自动标注来源，尊重原创">
      <template #actions>
        <button class="btn btn-ghost" @click="onRefresh">
          <AppIcon name="sparkles" :size="15" /> 换一批
        </button>
      </template>
    </AppPageHeader>

    <AppFilterPanel :rows="FILTER_ROWS" :model-value="filters" @update:model-value="onFiltersChange" />

    <div class="panel">
      <div class="list-head">
        <AppListToolbar v-model="keyword" placeholder="搜索标题 / 知识点" :search-width="220" />
      </div>

      <div v-if="filtered.length" class="square-grid">
        <div v-for="row in filtered" :key="row.id" class="square-card" @click="openDetail(row)">
          <div class="sc-top">
            <span class="tag" :class="KIND_CLASS[row.kind]">{{ row.kind }}</span>
            <span class="tag tag-gray">{{ row.subject }}</span>
            <button
              class="star-btn"
              :class="{ on: row.collected }"
              type="button"
              @click.stop="onCollect(row)"
            >
              <AppIcon name="star" :size="15" />
            </button>
          </div>
          <h4 class="sc-title">{{ row.title }}</h4>
          <p class="sc-desc">{{ row.desc }}</p>
          <div class="sc-foot">
            <span class="sc-org">{{ row.org }} · {{ row.sharer }}</span>
            <span class="sc-stats">
              <span><AppIcon name="star" :size="12" /> {{ row.collects }}</span>
              <span><AppIcon name="download" :size="12" /> {{ row.downloads }}</span>
            </span>
          </div>
        </div>
      </div>
      <p v-else class="empty-row">无匹配资源</p>
    </div>

    <!-- 详情 -->
    <AppDrawer v-if="detail" :title="detail.title" :subtitle="`${detail.org} · ${detail.sharer} 分享`" :width="480" @close="detail = null">
      <div class="detail-grid">
        <div class="detail-item">
          <div class="d-label">类型</div>
          <div class="d-value"><span class="tag" :class="KIND_CLASS[detail.kind]">{{ detail.kind }}</span></div>
        </div>
        <div class="detail-item">
          <div class="d-label">学科 / 知识点</div>
          <div class="d-value">{{ detail.subject }} · {{ detail.knowledge }}</div>
        </div>
        <div class="detail-item">
          <div class="d-label">收藏 / 下载</div>
          <div class="d-value">{{ detail.collects }} 次 / {{ detail.downloads }} 次</div>
        </div>
      </div>
      <p class="detail-desc">{{ detail.desc }}</p>
      <div class="drawer-ops">
        <button class="btn btn-primary" @click="onDownload(detail); detail = null">
          <AppIcon name="download" :size="15" /> 下载引用
        </button>
        <button class="btn btn-ghost" @click="onCollect(detail)">
          {{ detail.collected ? '取消收藏' : '收藏' }}
        </button>
      </div>
      <p class="f-hint" style="margin-top: 12px">下载引用后自动进入本机构资源库，并携带来源标注（机构 + 作者）</p>
    </AppDrawer>
  </div>
</template>

<style scoped>
/* 工具条嵌在面板顶部，卡片网格保持满幅内边距 */
.list-head { padding: 14px 18px 0; }
.square-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; padding: 14px 18px 16px; }
.square-card {
  border: 1.5px solid var(--border); border-radius: 12px; padding: 13px 15px;
  background: #fff; cursor: pointer; transition: border-color 0.15s, transform 0.15s;
}
.square-card:hover { border-color: var(--brand); transform: translateY(-2px); }
.sc-top { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
/* 纯图标按钮：撑成不小于 22×22 的命中区，图标在其中居中 */
.star-btn {
  display: flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; flex-shrink: 0; margin-left: auto;
  border: none; border-radius: 6px; background: transparent; color: #c6cfd8; padding: 0;
}
.star-btn.on { color: #f0a23c; }
.sc-title { font-size: 14.5px; font-weight: 600; color: var(--ink); margin-bottom: 6px; }
.sc-desc { font-size: 12.5px; color: var(--sub); line-height: 1.6; margin-bottom: 10px; min-height: 40px; }
.sc-foot { display: flex; align-items: center; justify-content: space-between; }
.sc-org { font-size: 11.5px; color: var(--sub); }
.sc-stats { display: flex; gap: 10px; font-size: 11.5px; color: var(--sub); }
.sc-stats span { display: inline-flex; align-items: center; gap: 3px; }

.detail-desc { font-size: 13px; color: var(--ink-2); line-height: 1.7; margin: 14px 0; }
.drawer-ops { display: flex; gap: 10px; }
</style>
