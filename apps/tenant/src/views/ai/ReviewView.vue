<script setup lang="ts">
/**
 * AI 生成内容标识与复核（T-10-08）。
 *
 * 治理红线：AI 生成内容须经教师复核后方可发布给学生。
 * 每条产物带：AI 显著标识（默认开启，合规要求）、AI 自动质检结论（pass/warn/error）、
 * 复核状态与复核人。error 级必须人工复核才能放行；驳回即打回重生成。
 */
import { computed, onMounted, ref } from 'vue'
import { ARTIFACT_REVIEW_STATUS_TEXT, AppIcon, AppPageHeader, showToast } from '@aiteach/shared'
import type { AiArtifactReview } from '@aiteach/shared'
import AppModal from '@/components/ui/AppModal.vue'
import { fetchAiArtifacts, reviewAiArtifact } from '@/api/student'

const statusFilter = ref('')
const artifacts = ref<AiArtifactReview[]>([])
const loading = ref(true)

async function load() {
  loading.value = true
  artifacts.value = await fetchAiArtifacts(statusFilter.value)
  loading.value = false
}

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

onMounted(load)
</script>

<template>
  <div class="page">
    <AppPageHeader desc="AI 生成内容复核：所有 AI 产物（题目 / 试卷 / 讲义 / 课件 / 批改 / 画像）须教师复核后方可发布给学生；产物默认携带 AI 生成标识。">
      <template #actions>
        <select v-model="statusFilter" class="f-select" @change="load">
          <option value="">全部状态</option>
          <option value="pending">待复核</option>
          <option value="approved">已通过</option>
          <option value="rejected">已驳回</option>
        </select>
      </template>
    </AppPageHeader>

    <div class="notice-bar">
      <AppIcon name="warning" :size="15" />
      待复核 <b>{{ pendingCount }}</b> 条 · 质检异常（error 级）条目必须人工复核后才能放行，驳回即打回重生成。
    </div>

    <div class="panel">
      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>产物</th>
              <th>类型</th>
              <th>场景</th>
              <th>生成模型</th>
              <th>AI 标识</th>
              <th>自动质检</th>
              <th>复核状态</th>
              <th>复核人 / 时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="9" class="empty-row">加载中…</td>
            </tr>
            <tr v-else-if="artifacts.length === 0">
              <td colspan="9" class="empty-row">暂无复核条目</td>
            </tr>
            <template v-else>
              <tr v-for="row in artifacts" :key="row.id">
                <td class="cell-strong">
                  {{ row.title }}
                  <span v-if="row.autoCheck === 'error' && row.status === 'pending'" class="tag tag-red must">必须人工复核</span>
                </td>
                <td><span class="tag tag-blue">{{ row.kind }}</span></td>
                <td>{{ row.scene }}</td>
                <td class="mono">{{ row.model }}</td>
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
  display: flex; align-items: center; gap: 8px; margin-bottom: 14px; padding: 10px 14px;
  background: #fff7ed; border: 1px solid #fed7aa; border-radius: 10px;
  font-size: 13px; color: #92600a;
}
.notice-bar b { font-size: 15px; }
.mono { font-family: 'SF Mono', Menlo, monospace; font-size: 12px; }
.muted { color: var(--sub); font-size: 12px; }
.must { margin-left: 6px; }
.check-note { margin: 4px 0 0; font-size: 11.5px; color: var(--sub); max-width: 240px; }
.review-note { font-size: 13px; line-height: 1.8; color: var(--text); }
.check-box { display: flex; align-items: flex-start; gap: 8px; margin-top: 12px; }
.check-text { font-size: 12.5px; color: var(--sub); line-height: 1.7; }
</style>
