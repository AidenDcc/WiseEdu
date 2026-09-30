<script setup lang="ts">
/**
 * 公共题库管理（P-03-01/02/03/06/07/08）。
 *
 * 平台侧的题目运营：检索浏览 → 详情查看（含解析）→ 待审核队列审批 → 上架 / 下架。
 * 平台铁律（BR-001）：本端只做内容资产的审核与配置，不把题目下发给具体机构
 * （那是「内容分发」模块的职责）。
 */
import { computed, onMounted, ref } from 'vue'
import { AppIcon, AppPageHeader, PLATFORM_CONTENT_STATUS_TEXT, showToast } from '@aiteach/shared'
import type { PlatformContentStatus, PlatformQuestion } from '@aiteach/shared'
import AppDrawer from '@/components/ui/AppDrawer.vue'
import AppModal from '@/components/ui/AppModal.vue'
import { fetchPlatformQuestions, reviewPlatformQuestion, togglePlatformQuestion } from '@/api/content'

const questions = ref<PlatformQuestion[]>([])
const keyword = ref('')
const subjectFilter = ref('')
const statusFilter = ref('')
const loading = ref(true)

async function load() {
  loading.value = true
  questions.value = await fetchPlatformQuestions(keyword.value, subjectFilter.value, statusFilter.value)
  loading.value = false
}

const pendingCount = computed(() => questions.value.filter((row) => row.status === 'pending').length)

function statusTag(status: PlatformContentStatus) {
  if (status === 'published') return 'tag-green'
  if (status === 'pending') return 'tag-orange'
  if (status === 'rejected') return 'tag-red'
  return 'tag-gray'
}

function qualityTag(quality: PlatformQuestion['quality']) {
  return quality === 'A' ? 'tag-green' : quality === 'B' ? 'tag-blue' : 'tag-orange'
}

/* ===== 详情 ===== */
const detail = ref<PlatformQuestion | null>(null)

/* ===== 审核 / 上下架 ===== */
const reviewing = ref<null | { id: number; stem: string; pass: boolean }>(null)

async function submitReview() {
  if (!reviewing.value) return
  try {
    await reviewPlatformQuestion(reviewing.value.id, reviewing.value.pass)
    showToast(reviewing.value.pass ? '已通过并上架' : '已驳回', 'success')
    reviewing.value = null
    detail.value = null
    load()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '操作失败', 'error')
  }
}

async function onToggle(row: PlatformQuestion) {
  try {
    await togglePlatformQuestion(row.id)
    showToast(row.status === 'published' ? '已下架' : '已上架', 'success')
    load()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '操作失败', 'error')
  }
}

onMounted(load)
</script>

<template>
  <div class="page">
    <AppPageHeader desc="公共题库的检索、审核与上下架；题目通过审核后进入公共库，再由「内容分发」授权给租户使用。">
      <template #actions>
        <div class="head-actions">
          <select v-model="subjectFilter" class="f-select" @change="load">
            <option value="">全部学科</option>
            <option v-for="subject in ['数学', '语文', '英语', '物理']" :key="subject" :value="subject">{{ subject }}</option>
          </select>
          <select v-model="statusFilter" class="f-select" @change="load">
            <option value="">全部状态</option>
            <option value="pending">待审核</option>
            <option value="published">已上架</option>
            <option value="rejected">已驳回</option>
            <option value="offline">已下架</option>
          </select>
          <input v-model="keyword" class="f-input search" placeholder="题干 / 来源关键词" @keyup.enter="load" />
          <button class="btn btn-primary" @click="load">检索</button>
        </div>
      </template>
    </AppPageHeader>

    <div v-if="pendingCount" class="notice-bar">
      <AppIcon name="warning" :size="15" /> 当前有 <b>{{ pendingCount }}</b> 道题待审核，通过后进入公共库。
    </div>

    <div class="panel">
      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>题干</th>
              <th>题型</th>
              <th>学科 / 年级</th>
              <th>难度</th>
              <th>知识点</th>
              <th>质量</th>
              <th>来源</th>
              <th>引用</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="10" class="empty-row">加载中…</td>
            </tr>
            <tr v-else-if="questions.length === 0">
              <td colspan="10" class="empty-row">暂无题目</td>
            </tr>
            <template v-else>
              <tr v-for="row in questions" :key="row.id">
                <td class="stem-cell" @click="detail = row">{{ row.stem }}</td>
                <td>{{ row.type }}</td>
                <td>{{ row.subject }} · {{ row.grade }}</td>
                <td>{{ row.difficulty }}</td>
                <td>
                  <div class="tag-row">
                    <span v-for="tag in row.knowledge" :key="tag" class="tag tag-blue">{{ tag }}</span>
                  </div>
                </td>
                <td><span class="tag" :class="qualityTag(row.quality)">{{ row.quality }} 级</span></td>
                <td>{{ row.source }}</td>
                <td>{{ row.refs }}</td>
                <td><span class="tag" :class="statusTag(row.status)">{{ PLATFORM_CONTENT_STATUS_TEXT[row.status] }}</span></td>
                <td>
                  <div class="op-group">
                    <button class="mini-btn" @click="detail = row">详情</button>
                    <button v-if="row.status === 'pending'" class="mini-btn" @click="reviewing = { id: row.id, stem: row.stem, pass: true }">审核</button>
                    <button
                      v-if="row.status === 'published' || row.status === 'offline'"
                      class="mini-btn"
                      @click="onToggle(row)"
                    >
                      {{ row.status === 'published' ? '下架' : '上架' }}
                    </button>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 题目详情 -->
    <AppDrawer v-if="detail" title="题目详情" :subtitle="`${detail.subject} · ${detail.grade} · ${detail.type}`" :width="560" @close="detail = null">
      <div class="detail-block">
        <h4>题干</h4>
        <p class="stem-text">{{ detail.stem }}</p>
      </div>
      <div class="detail-block">
        <h4>答案</h4>
        <p class="stem-text">{{ detail.answer }}</p>
      </div>
      <div class="detail-block">
        <h4>解析</h4>
        <p class="analysis-text">{{ detail.analysis }}</p>
      </div>
      <div class="detail-meta">
        <span>难度：{{ detail.difficulty }}</span>
        <span>质量分级：{{ detail.quality }} 级</span>
        <span>来源：{{ detail.source }}</span>
        <span>引用：{{ detail.refs }} 次</span>
        <span>状态：{{ PLATFORM_CONTENT_STATUS_TEXT[detail.status] }}</span>
        <span>更新时间：{{ detail.updatedAt }}</span>
      </div>
      <div v-if="detail.status === 'pending'" class="drawer-actions">
        <button class="btn btn-ghost" @click="reviewing = { id: detail.id, stem: detail.stem, pass: false }">驳回</button>
        <button class="btn btn-primary" @click="reviewing = { id: detail.id, stem: detail.stem, pass: true }">通过并上架</button>
      </div>
    </AppDrawer>

    <!-- 审核确认 -->
    <AppModal
      v-if="reviewing"
      :title="reviewing.pass ? '通过审核' : '驳回题目'"
      :width="440"
      @close="reviewing = null"
    >
      <p class="confirm-text">{{ reviewing.stem.slice(0, 60) }}{{ reviewing.stem.length > 60 ? '…' : '' }}</p>
      <p class="confirm-note">
        {{ reviewing.pass ? '通过后题目进入公共题库（已上架），可由内容分发授权给租户。' : '驳回后题目状态置为已驳回，可修改后重新提审。' }}
      </p>
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
.head-actions { display: flex; align-items: center; gap: 10px; }
.search { width: 220px; }
.notice-bar {
  display: flex; align-items: center; gap: 8px; margin-bottom: 14px; padding: 10px 14px;
  background: #fff7ed; border: 1px solid #fed7aa; border-radius: 10px; font-size: 13px; color: #92600a;
}
.notice-bar b { font-size: 15px; }
.stem-cell {
  max-width: 320px; cursor: pointer; color: var(--brand-deep);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.stem-cell:hover { text-decoration: underline; }
.tag-row { display: flex; flex-wrap: wrap; gap: 4px; }
.detail-block { margin-bottom: 16px; }
.detail-block h4 { font-size: 13px; margin: 0 0 6px; color: var(--sub); }
.stem-text { font-size: 14px; line-height: 1.8; color: var(--text); margin: 0; }
.analysis-text { font-size: 13px; line-height: 1.9; color: var(--text); margin: 0; white-space: pre-wrap; }
.detail-meta {
  display: flex; flex-wrap: wrap; gap: 8px 18px; padding-top: 14px;
  border-top: 1px solid var(--border); font-size: 12.5px; color: var(--sub);
}
.drawer-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
.confirm-text { font-size: 13px; color: var(--text); line-height: 1.7; margin: 0 0 8px; }
.confirm-note { font-size: 12.5px; color: var(--sub); line-height: 1.7; margin: 0; }
</style>
