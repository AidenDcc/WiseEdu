<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { AppIcon, showToast } from '@aiteach/shared'
import type { SquareResource } from '@aiteach/shared'
import AppDrawer from '@/components/ui/AppDrawer.vue'
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

const filter = reactive({ kind: '', subject: '', keyword: '' })
/** 「为你推荐」批次（换一批） */
const batch = ref(0)

async function load() {
  await ensure()
  resources.value = await fetchSquare()
}

const filtered = computed(() => {
  let list = resources.value.filter(
    (row) =>
      (!filter.kind || row.kind === filter.kind) &&
      (!filter.subject || row.subject === filter.subject) &&
      (!filter.keyword || row.title.includes(filter.keyword) || row.knowledge.includes(filter.keyword)),
  )
  if (!filter.kind && !filter.subject && !filter.keyword) {
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
    <div class="page-head">
      <h2>知识广场</h2>
      <span class="f-hint">跨机构共享的优质资源 · 下载引用自动标注来源，尊重原创</span>
      <button class="btn btn-ghost" style="margin-left: auto" @click="onRefresh">
        <AppIcon name="sparkles" :size="15" /> 换一批
      </button>
    </div>

    <div class="panel">
      <div class="filter-bar">
        <span class="filter-label">类型</span>
        <select v-model="filter.kind" class="f-select">
          <option value="">全部</option>
          <option v-for="k in KINDS" :key="k">{{ k }}</option>
        </select>
        <span class="filter-label">学科</span>
        <select v-model="filter.subject" class="f-select">
          <option value="">全部</option>
          <option v-for="s in subjects" :key="s" :value="s">{{ s }}</option>
        </select>
        <input v-model="filter.keyword" class="f-input" placeholder="搜索标题 / 知识点" style="width: 220px" />
      </div>

      <div class="square-grid">
        <p v-if="filtered.length === 0" class="f-hint" style="grid-column: 1 / -1; text-align: center; padding: 30px">无匹配资源</p>
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
    </div>

    <!-- 详情 -->
    <AppDrawer v-if="detail" :title="detail.title" :subtitle="`${detail.org} · ${detail.sharer} 分享`" :width="480" @close="detail = null">
      <div class="detail-grid">
        <div class="detail-item">
          <span class="d-label">类型</span>
          <span class="d-value"><span class="tag" :class="KIND_CLASS[detail.kind]">{{ detail.kind }}</span></span>
        </div>
        <div class="detail-item">
          <span class="d-label">学科 / 知识点</span>
          <span class="d-value">{{ detail.subject }} · {{ detail.knowledge }}</span>
        </div>
        <div class="detail-item">
          <span class="d-label">收藏 / 下载</span>
          <span class="d-value">{{ detail.collects }} 次 / {{ detail.downloads }} 次</span>
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
.square-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; padding: 4px 2px 8px; }
.square-card {
  border: 1.5px solid var(--border); border-radius: 12px; padding: 13px 15px;
  background: #fff; cursor: pointer; transition: border-color 0.15s, transform 0.15s;
}
.square-card:hover { border-color: var(--brand); transform: translateY(-2px); }
.sc-top { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.star-btn { border: none; background: transparent; color: #c6cfd8; display: flex; margin-left: auto; padding: 2px; }
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
