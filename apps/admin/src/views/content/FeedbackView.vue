<script setup lang="ts">
/**
 * 内容问题反馈工单（P-03-28）。
 *
 * 租户侧教师反馈内容问题 → 平台受理 → 处理并回复 / 驳回。
 * 内容错误与版权争议优先级最高，处理结果回写通知模板。
 */
import { computed, onMounted, ref } from 'vue'
import { AppIcon, AppPageHeader, showToast } from '@aiteach/shared'
import type { ContentFeedbackTicket } from '@aiteach/shared'
import AppDrawer from '@/components/ui/AppDrawer.vue'
import AppModal from '@/components/ui/AppModal.vue'
import { fetchFeedbackTickets, handleTicket } from '@/api/content'

const tab = ref<'all' | 'open' | 'processing' | 'resolved'>('all')
const tickets = ref<ContentFeedbackTicket[]>([])
const loading = ref(true)

async function load() {
  loading.value = true
  tickets.value = await fetchFeedbackTickets(tab.value === 'all' ? '' : tab.value)
  loading.value = false
}

const openCount = computed(() => tickets.value.filter((row) => row.status === 'open').length)
const processingCount = computed(() => tickets.value.filter((row) => row.status === 'processing').length)

const STATUS_TEXT: Record<ContentFeedbackTicket['status'], string> = {
  open: '待受理',
  processing: '处理中',
  resolved: '已解决',
  rejected: '已驳回',
}

function statusTag(status: ContentFeedbackTicket['status']) {
  return status === 'resolved' ? 'tag-green' : status === 'open' ? 'tag-orange' : status === 'processing' ? 'tag-blue' : 'tag-gray'
}

function priorityTag(priority: ContentFeedbackTicket['priority']) {
  return priority === 'high' ? 'tag-red' : priority === 'normal' ? 'tag-orange' : 'tag-gray'
}

const detail = ref<ContentFeedbackTicket | null>(null)

/* ===== 受理 ===== */
async function onAccept(row: ContentFeedbackTicket) {
  try {
    await handleTicket(row.id, 'accept', '')
    showToast('已受理，工单进入处理中', 'success')
    detail.value = null
    load()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '操作失败', 'error')
  }
}

/* ===== 回复 / 驳回 ===== */
const handling = ref<null | { row: ContentFeedbackTicket; action: 'resolve' | 'reject'; reply: string }>(null)

function openHandle(row: ContentFeedbackTicket, action: 'resolve' | 'reject') {
  handling.value = { row, action, reply: action === 'resolve' ? '已核实并修正该内容，感谢反馈。' : '' }
}

async function submitHandle() {
  if (!handling.value) return
  try {
    await handleTicket(handling.value.row.id, handling.value.action, handling.value.reply)
    showToast(handling.value.action === 'resolve' ? '已回复并办结' : '已驳回', 'success')
    handling.value = null
    detail.value = null
    load()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '操作失败', 'error')
  }
}

onMounted(load)
</script>

<template>
  <div class="page">
    <AppPageHeader desc="内容问题反馈工单：租户反馈 → 平台受理 → 处理回复 / 驳回；处理结果通过站内信通知反馈人。" />

    <div class="tabs">
      <button class="tab" :class="{ on: tab === 'all' }" @click="tab = 'all'; load()">全部</button>
      <button class="tab" :class="{ on: tab === 'open' }" @click="tab = 'open'; load()">
        待受理 <span v-if="tab === 'open' && openCount" class="badge">{{ openCount }}</span>
      </button>
      <button class="tab" :class="{ on: tab === 'processing' }" @click="tab = 'processing'; load()">
        处理中 <span v-if="tab === 'processing' && processingCount" class="badge">{{ processingCount }}</span>
      </button>
      <button class="tab" :class="{ on: tab === 'resolved' }" @click="tab = 'resolved'; load()">已办结</button>
    </div>

    <div class="panel">
      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>工单标题</th>
              <th>内容类型</th>
              <th>关联内容</th>
              <th>反馈来源</th>
              <th>问题类型</th>
              <th>优先级</th>
              <th>状态</th>
              <th>提交时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="9" class="empty-row">加载中…</td>
            </tr>
            <tr v-else-if="tickets.length === 0">
              <td colspan="9" class="empty-row">暂无工单</td>
            </tr>
            <template v-else>
              <tr v-for="row in tickets" :key="row.id">
                <td class="cell-strong link" @click="detail = row">{{ row.title }}</td>
                <td><span class="tag tag-blue">{{ row.contentType }}</span></td>
                <td class="ellipsis">{{ row.contentName }}</td>
                <td>{{ row.tenantName }} · {{ row.reporter }}</td>
                <td>{{ row.kind }}</td>
                <td><span class="tag" :class="priorityTag(row.priority)">{{ row.priority === 'high' ? '高' : row.priority === 'normal' ? '中' : '低' }}</span></td>
                <td><span class="tag" :class="statusTag(row.status)">{{ STATUS_TEXT[row.status] }}</span></td>
                <td class="mono">{{ row.createdAt }}</td>
                <td>
                  <div class="op-group">
                    <button class="mini-btn" @click="detail = row">详情</button>
                    <button v-if="row.status === 'open'" class="mini-btn" @click="onAccept(row)">受理</button>
                    <button v-if="row.status === 'processing'" class="mini-btn" @click="openHandle(row, 'resolve')">回复办结</button>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <AppDrawer v-if="detail" title="工单详情" :subtitle="`${detail.tenantName} · ${detail.reporter}`" :width="520" @close="detail = null">
      <h4 class="ticket-title">{{ detail.title }}</h4>
      <div class="ticket-meta">
        <span><i>内容类型</i>{{ detail.contentType }}</span>
        <span><i>关联内容</i>{{ detail.contentName }}</span>
        <span><i>问题类型</i>{{ detail.kind }}</span>
        <span><i>优先级</i>{{ detail.priority === 'high' ? '高' : detail.priority === 'normal' ? '中' : '低' }}</span>
        <span><i>状态</i>{{ STATUS_TEXT[detail.status] }}</span>
        <span><i>提交时间</i>{{ detail.createdAt }}</span>
      </div>
      <div v-if="detail.reply" class="reply-box">
        <h5>处理回复</h5>
        <p>{{ detail.reply }}</p>
        <span class="reply-time">{{ detail.resolvedAt }}</span>
      </div>
      <div v-if="detail.status !== 'resolved' && detail.status !== 'rejected'" class="drawer-actions">
        <button v-if="detail.status === 'open'" class="btn btn-primary" @click="onAccept(detail)">受理工单</button>
        <template v-else>
          <button class="btn btn-ghost" @click="openHandle(detail, 'reject')">驳回</button>
          <button class="btn btn-primary" @click="openHandle(detail, 'resolve')">回复并办结</button>
        </template>
      </div>
    </AppDrawer>

    <AppModal
      v-if="handling"
      :title="handling.action === 'resolve' ? '回复并办结' : '驳回工单'"
      :width="460"
      @close="handling = null"
    >
      <p class="confirm-text">{{ handling.row.title }}</p>
      <div class="f-field">
        <label class="f-label">
          {{ handling.action === 'resolve' ? '处理说明' : '驳回理由' }}<span class="req">*</span>
        </label>
        <textarea v-model="handling.reply" class="f-textarea" rows="3" placeholder="将同步通知反馈人" />
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="handling = null">取消</button>
        <button class="btn" :class="handling.action === 'resolve' ? 'btn-primary' : 'btn-danger'" @click="submitHandle">
          {{ handling.action === 'resolve' ? '确认办结' : '确认驳回' }}
        </button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.tabs { display: flex; gap: 6px; margin-bottom: 14px; }
.tab {
  border: 1.5px solid var(--border); background: #fff; border-radius: 8px;
  padding: 7px 14px; font-size: 13px; color: var(--sub); cursor: pointer; font-family: inherit;
  display: inline-flex; align-items: center; gap: 6px;
}
.tab.on { border-color: var(--brand); color: var(--brand-deep); background: var(--brand-soft); font-weight: 600; }
.badge { background: var(--brand); color: #fff; border-radius: 9px; font-size: 11px; padding: 0 6px; line-height: 16px; }
.mono { font-family: 'SF Mono', Menlo, monospace; font-size: 12px; }
.ellipsis { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.link { cursor: pointer; color: var(--brand-deep); }
.link:hover { text-decoration: underline; }
.ticket-title { font-size: 15px; margin: 0 0 14px; }
.ticket-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 16px; }
.ticket-meta span { display: flex; flex-direction: column; gap: 3px; font-size: 13px; color: var(--text); }
.ticket-meta i { font-style: normal; font-size: 12px; color: var(--sub); }
.reply-box { margin-top: 18px; padding: 12px 14px; background: #f7f9fb; border-radius: 10px; }
.reply-box h5 { margin: 0 0 6px; font-size: 13px; }
.reply-box p { margin: 0; font-size: 13px; line-height: 1.8; color: var(--text); }
.reply-time { font-size: 12px; color: var(--sub); }
.drawer-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
.confirm-text { font-size: 13.5px; font-weight: 600; color: var(--text); margin: 0 0 12px; }
</style>
