<script setup lang="ts">
/**
 * 内容合规抽检（P-03-23）。
 *
 * 平台按范围对内容做批量抽检：AI 先标出疑似问题（超纲 / 敏感 / 版权 / 解析残缺），
 * 人工确认后处置。命中样例展示抽检依据，便于复核与追溯。
 */
import { computed, onMounted, ref } from 'vue'
import { AppIcon, AppPageHeader, showToast } from '@aiteach/shared'
import type { ComplianceSpotCheck } from '@aiteach/shared'
import AppModal from '@/components/ui/AppModal.vue'
import { closeSpotCheck, createSpotCheck, fetchSpotChecks } from '@/api/content'

const list = ref<ComplianceSpotCheck[]>([])
const loading = ref(true)
const expanded = ref<number | null>(null)

async function load() {
  loading.value = true
  list.value = await fetchSpotChecks()
  loading.value = false
}

const runningCount = computed(() => list.value.filter((row) => row.status === 'running').length)

function statusMeta(status: ComplianceSpotCheck['status']) {
  if (status === 'done') return { text: '已完成', tag: 'tag-green' }
  if (status === 'running') return { text: '抽检中', tag: 'tag-blue' }
  return { text: '已关闭', tag: 'tag-gray' }
}

const LEVEL_TAG = { high: 'tag-red', mid: 'tag-orange', low: 'tag-gray' } as const

/* ===== 新建抽检 ===== */
const creating = ref<null | { scope: string; sampleCount: number }>(null)

function openCreate() {
  creating.value = { scope: '公共题库 · 全学科', sampleCount: 500 }
}

async function submitCreate() {
  if (!creating.value) return
  try {
    await createSpotCheck(creating.value.scope, creating.value.sampleCount)
    showToast('抽检任务已创建，AI 正在扫描', 'success')
    creating.value = null
    load()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '创建失败', 'error')
  }
}

async function onClose(row: ComplianceSpotCheck) {
  try {
    await closeSpotCheck(row.id)
    showToast('抽检任务已关闭', 'success')
    load()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '操作失败', 'error')
  }
}

onMounted(load)
</script>

<template>
  <div class="page">
    <AppPageHeader desc="内容合规抽检：AI 批量扫描疑似问题（超纲 / 敏感 / 版权争议 / 解析残缺），人工确认后处置；命中样例可追溯。">
      <template #actions>
        <button class="btn btn-primary" @click="openCreate">
          <AppIcon name="shield" :size="15" /> 新建抽检
        </button>
      </template>
    </AppPageHeader>

    <div v-if="runningCount" class="notice-bar">
      <AppIcon name="refresh" :size="15" /> {{ runningCount }} 个抽检任务进行中。
    </div>

    <div class="panel">
      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>抽检任务</th>
              <th>抽检范围</th>
              <th>抽检量</th>
              <th>AI 疑似命中</th>
              <th>人工确认违规</th>
              <th>状态</th>
              <th>创建时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="8" class="empty-row">加载中…</td>
            </tr>
            <tr v-else-if="list.length === 0">
              <td colspan="8" class="empty-row">暂无抽检任务</td>
            </tr>
            <template v-else>
              <template v-for="row in list" :key="row.id">
                <tr>
                  <td class="cell-strong">{{ row.title }}</td>
                  <td>{{ row.scope }}</td>
                  <td>{{ row.sampleCount }}</td>
                  <td><span class="num flagged">{{ row.flagged }}</span></td>
                  <td><span class="num confirmed">{{ row.confirmed }}</span></td>
                  <td><span class="tag" :class="statusMeta(row.status).tag">{{ statusMeta(row.status).text }}</span></td>
                  <td class="mono">{{ row.createdAt }}</td>
                  <td>
                    <div class="op-group">
                      <button class="mini-btn" @click="expanded = expanded === row.id ? null : row.id">
                        {{ expanded === row.id ? '收起样例' : `样例(${row.samples.length})` }}
                      </button>
                      <button v-if="row.status !== 'closed'" class="mini-btn" @click="onClose(row)">关闭</button>
                    </div>
                  </td>
                </tr>
                <tr v-if="expanded === row.id" class="samples-row">
                  <td colspan="8">
                    <div v-if="row.samples.length === 0" class="muted">暂无命中样例</div>
                    <div v-for="sample in row.samples" :key="sample.contentName" class="sample-item">
                      <span class="tag" :class="LEVEL_TAG[sample.level]">
                        {{ sample.level === 'high' ? '高风险' : sample.level === 'mid' ? '中风险' : '低风险' }}
                      </span>
                      <b>{{ sample.contentName }}</b>
                      <span class="sample-reason">{{ sample.reason }}</span>
                    </div>
                  </td>
                </tr>
              </template>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <AppModal v-if="creating" title="新建内容合规抽检" :width="460" @close="creating = null">
      <div class="f-field">
        <label class="f-label">抽检范围<span class="req">*</span></label>
        <input v-model="creating.scope" class="f-input" placeholder="如 公共题库 · 全学科" />
      </div>
      <div class="f-field">
        <label class="f-label">抽检量</label>
        <select v-model.number="creating.sampleCount" class="f-select">
          <option :value="200">200 条</option>
          <option :value="500">500 条</option>
          <option :value="1000">1000 条</option>
        </select>
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="creating = null">取消</button>
        <button class="btn btn-primary" @click="submitCreate">开始抽检</button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.notice-bar {
  display: flex; align-items: center; gap: 8px; margin-bottom: 14px; padding: 10px 14px;
  background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px; font-size: 13px; color: #1e40af;
}
.mono { font-family: 'SF Mono', Menlo, monospace; font-size: 12px; }
.muted { color: var(--sub); font-size: 12.5px; padding: 6px 0; }
.num { font-variant-numeric: tabular-nums; font-weight: 600; }
.num.flagged { color: #d9822b; }
.num.confirmed { color: #d94f43; }
.samples-row td { background: #fafbfc; }
.sample-item { display: flex; align-items: center; gap: 10px; padding: 6px 0; font-size: 12.5px; }
.sample-item b { color: var(--text); }
.sample-reason { color: var(--sub); }
</style>
