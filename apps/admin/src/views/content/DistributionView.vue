<script setup lang="ts">
/**
 * 内容分发与租户授权（P-03-25 ~ 27）。
 *
 * 平台把公共内容（题目 / 试卷 / 教辅 / 素材）按「全部租户 / 指定套餐 / 指定租户」
 * 三种范围授权下发；灰度发布通过「暂停 / 恢复同步」控制。
 */
import { onMounted, ref } from 'vue'
import { AppIcon, AppPageHeader, showToast, AppModal } from '@aiteach/shared'
import type { ContentDistribution } from '@aiteach/shared'
import { createDistribution, fetchDistributions, toggleDistribution } from '@/api/content'

const list = ref<ContentDistribution[]>([])
const loading = ref(true)

async function load() {
  loading.value = true
  list.value = await fetchDistributions()
  loading.value = false
}

const SCOPE_TEXT: Record<ContentDistribution['scopeType'], string> = {
  all: '全部租户',
  package: '指定套餐',
  tenant: '指定租户',
}

function statusMeta(status: ContentDistribution['status']) {
  if (status === 'synced') return { text: '已同步', tag: 'tag-green' }
  if (status === 'syncing') return { text: '同步中', tag: 'tag-blue' }
  return { text: '已暂停', tag: 'tag-gray' }
}

/* ===== 新建分发 ===== */
const creating = ref<null | { contentType: ContentDistribution['contentType']; contentName: string; scopeType: ContentDistribution['scopeType']; scopeText: string }>(null)

function openCreate() {
  creating.value = { contentType: '题目', contentName: '', scopeType: 'package', scopeText: '标准版及以上套餐' }
}

async function submitCreate() {
  if (!creating.value) return
  try {
    await createDistribution({ ...creating.value })
    showToast('分发任务已创建（同步中）', 'success')
    creating.value = null
    load()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '创建失败', 'error')
  }
}

async function onToggle(row: ContentDistribution) {
  try {
    await toggleDistribution(row.id)
    showToast(row.status === 'synced' ? '已暂停同步' : '已恢复同步', 'success')
    load()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '操作失败', 'error')
  }
}

onMounted(load)
</script>

<template>
  <div class="page">
    <AppPageHeader desc="公共内容按范围授权给租户；「暂停 / 恢复」用于灰度发布控制（P-03-27）。">
      <template #actions>
        <button class="btn btn-primary" @click="openCreate">
          <AppIcon name="plus" :size="15" /> 新建分发
        </button>
      </template>
    </AppPageHeader>

    <div class="panel">
      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>内容</th>
              <th>类型</th>
              <th>分发范围</th>
              <th>授权租户</th>
              <th>状态</th>
              <th>同步时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="7" class="empty-row">加载中…</td>
            </tr>
            <tr v-else-if="list.length === 0">
              <td colspan="7" class="empty-row">暂无分发记录</td>
            </tr>
            <template v-else>
              <tr v-for="row in list" :key="row.id">
                <td class="cell-strong">{{ row.contentName }}</td>
                <td><span class="tag tag-blue">{{ row.contentType }}</span></td>
                <td>{{ SCOPE_TEXT[row.scopeType] }} · {{ row.scopeText }}</td>
                <td>{{ row.tenantCount }} 家</td>
                <td><span class="tag" :class="statusMeta(row.status).tag">{{ statusMeta(row.status).text }}</span></td>
                <td class="mono">{{ row.syncedAt }}</td>
                <td>
                  <div class="op-group">
                    <button v-if="row.status !== 'syncing'" class="mini-btn" @click="onToggle(row)">
                      {{ row.status === 'synced' ? '暂停' : '恢复' }}
                    </button>
                    <span v-else class="muted">同步中…</span>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <AppModal v-if="creating" title="新建内容分发" :width="480" @close="creating = null">
      <div class="f-field">
        <label class="f-label">内容类型</label>
        <select v-model="creating.contentType" class="f-select">
          <option value="题目">题目</option>
          <option value="试卷">试卷</option>
          <option value="教辅">教辅</option>
          <option value="素材">素材</option>
        </select>
      </div>
      <div class="f-field">
        <label class="f-label">内容名称 / 题包<span class="req">*</span></label>
        <input v-model="creating.contentName" class="f-input" placeholder="如 2026 届高一数学期中题包" />
      </div>
      <div class="f-field">
        <label class="f-label">分发范围</label>
        <select v-model="creating.scopeType" class="f-select">
          <option value="all">全部租户</option>
          <option value="package">指定套餐</option>
          <option value="tenant">指定租户</option>
        </select>
      </div>
      <div class="f-field">
        <label class="f-label">范围说明</label>
        <input v-model="creating.scopeText" class="f-input" placeholder="如 标准版及以上套餐 / 指定 6 家租户" />
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="creating = null">取消</button>
        <button class="btn btn-primary" @click="submitCreate">创建分发</button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.mono { font-family: 'SF Mono', Menlo, monospace; font-size: 12px; }
.muted { color: var(--sub); font-size: 12px; }
</style>
