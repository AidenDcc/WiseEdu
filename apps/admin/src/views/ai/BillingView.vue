<script setup lang="ts">
/**
 * AI 计费与租户能力开关（P-05-13 / 14）。
 *
 * 两个区块：
 * - 计费规则：按场景 / 模型配置计价单位（次 / 千 token）与单价，支持启停；
 * - 租户 AI 能力开关：逐租户逐能力开关，并展示本月用量与剩余额度
 *   （对应租户端「AI 用量与余额」的同一份数据）。
 */
import { computed, onMounted, ref } from 'vue'
import { AppIcon, AppPageHeader, showToast, AppModal } from '@aiteach/shared'
import AppSwitch from '@/components/ui/AppSwitch.vue'
import type { AiBillingRule, TenantAiSwitch } from '@aiteach/shared'
import { fetchBillingRules, fetchTenantAiSwitches, saveBillingRule, toggleTenantAiCapability } from '@/api/content'

const rules = ref<AiBillingRule[]>([])
const tenants = ref<TenantAiSwitch[]>([])
const loading = ref(true)

async function load() {
  loading.value = true
  const [ruleList, tenantList] = await Promise.all([fetchBillingRules(), fetchTenantAiSwitches()])
  rules.value = ruleList
  tenants.value = tenantList
  loading.value = false
}

const totalMonthCost = computed(() => Math.round(tenants.value.reduce((sum, row) => sum + row.monthCost, 0) * 100) / 100)

/* ===== 计费规则编辑 ===== */
const editing = ref<null | { id: number; scene: string; model: string; unit: AiBillingRule['unit']; price: number }>(null)

function openEdit(row: AiBillingRule) {
  editing.value = { id: row.id, scene: row.scene, model: row.model, unit: row.unit, price: row.price }
}

async function submitRule() {
  if (!editing.value) return
  if (editing.value.price <= 0) {
    showToast('单价必须大于 0', 'error')
    return
  }
  try {
    await saveBillingRule(editing.value.id, { unit: editing.value.unit, price: editing.value.price })
    showToast('已保存', 'success')
    editing.value = null
    load()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '保存失败', 'error')
  }
}

async function toggleRule(row: AiBillingRule) {
  await saveBillingRule(row.id, { enabled: !row.enabled })
  await load()
  showToast(row.enabled ? '已停用该计费规则' : '已启用', 'success')
}

/* ===== 租户能力开关 ===== */
const expandedTenant = ref<number | null>(null)

async function onToggleCapability(tenantId: number, capKey: string, label: string) {
  const tenant = tenants.value.find((row) => row.tenantId === tenantId)
  const cap = tenant?.capabilities.find((row) => row.key === capKey)
  const willEnable = !cap?.enabled
  try {
    await toggleTenantAiCapability(tenantId, capKey)
    await load()
    showToast(`${tenant?.tenantName} · ${label} 已${willEnable ? '开启' : '关闭'}`, 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '操作失败', 'error')
  }
}

const UNIT_TEXT: Record<AiBillingRule['unit'], string> = { call: '元 / 次', '1k-token': '元 / 千 token' }

onMounted(load)
</script>

<template>
  <div class="page">
    <AppPageHeader desc="AI 计费规则与租户能力开关；租户端「AI 用量与余额」按此口径计量。开启能力需同时具备套餐权益与剩余额度。">
      <template #actions>
        <div class="cost-chip">本月全平台 AI 消耗 <b>¥{{ totalMonthCost }}</b></div>
      </template>
    </AppPageHeader>

    <!-- 计费规则 -->
    <div class="panel">
      <h3 class="panel-title">AI 计费规则（P-05-13）</h3>
      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>场景</th>
              <th>模型</th>
              <th>计价单位</th>
              <th>单价</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading"><td colspan="6" class="empty-row">加载中…</td></tr>
            <tr v-else-if="rules.length === 0"><td colspan="6" class="empty-row">暂无规则</td></tr>
            <template v-else>
              <tr v-for="row in rules" :key="row.id">
                <td class="cell-strong">{{ row.scene }}</td>
                <td class="mono">{{ row.model }}</td>
                <td>{{ UNIT_TEXT[row.unit] }}</td>
                <td class="price">¥ {{ row.price }}</td>
                <td><span class="tag" :class="row.enabled ? 'tag-green' : 'tag-gray'">{{ row.enabled ? '启用' : '停用' }}</span></td>
                <td>
                  <div class="op-group">
                    <button class="mini-btn" @click="openEdit(row)">调价</button>
                    <button class="mini-btn" @click="toggleRule(row)">{{ row.enabled ? '停用' : '启用' }}</button>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 租户 AI 能力开关 -->
    <div class="panel">
      <h3 class="panel-title">租户 AI 能力开关（P-05-14）</h3>
      <p class="panel-hint">治理要求：学生 AI 问答默认开启引导式解题（不直接给答案），可按租户关闭；关闭后该租户相关入口置灰。</p>
      <div class="tenant-grid">
        <div v-for="tenant in tenants" :key="tenant.tenantId" class="tenant-card">
          <div class="tenant-head">
            <div class="tenant-name">
              <AppIcon name="building" :size="15" /> {{ tenant.tenantName }}
            </div>
            <button class="mini-btn" @click="expandedTenant = expandedTenant === tenant.tenantId ? null : tenant.tenantId">
              {{ expandedTenant === tenant.tenantId ? '收起能力' : '配置能力' }}
            </button>
          </div>
          <div class="tenant-usage">
            <div class="usage-item">
              <span>本月用量</span>
              <b>¥{{ tenant.monthCost }}</b>
            </div>
            <div class="usage-item">
              <span>剩余额度</span>
              <b :class="{ low: tenant.quotaLeft < 150 }">¥{{ tenant.quotaLeft }}</b>
            </div>
          </div>
          <div v-if="expandedTenant === tenant.tenantId" class="cap-list">
            <div v-for="cap in tenant.capabilities" :key="cap.key" class="cap-row">
              <span class="cap-label">{{ cap.label }}</span>
              <AppSwitch
                :model-value="cap.enabled"
                @update:model-value="onToggleCapability(tenant.tenantId, cap.key, cap.label)"
              />
            </div>
          </div>
        </div>
      </div>
    </div>

    <AppModal v-if="editing" :title="`调整计费单价 · ${editing.scene}`" :width="420" @close="editing = null">
      <p class="modal-sub">{{ editing.model }}</p>
      <div class="f-field">
        <label class="f-label">计价单位</label>
        <select v-model="editing.unit" class="f-select">
          <option value="call">元 / 次</option>
          <option value="1k-token">元 / 千 token</option>
        </select>
      </div>
      <div class="f-field">
        <label class="f-label">单价（元）<span class="req">*</span></label>
        <input v-model.number="editing.price" class="f-input" type="number" step="0.001" min="0.001" />
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="editing = null">取消</button>
        <button class="btn btn-primary" @click="submitRule">保存</button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.cost-chip {
  background: var(--brand-soft); color: var(--brand-deep); border-radius: 9px;
  padding: 8px 14px; font-size: 13px;
}
.cost-chip b { font-size: 16px; }
.panel-title { font-size: 14px; margin: 0 0 14px; }
.panel-hint { font-size: 12.5px; color: var(--sub); margin: -6px 0 14px; line-height: 1.7; }
.mono { font-family: 'SF Mono', Menlo, monospace; font-size: 12px; }
.price { font-variant-numeric: tabular-nums; font-weight: 600; }
.tenant-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.tenant-card { border: 1.5px solid var(--border); border-radius: 12px; padding: 14px 16px; }
.tenant-head { display: flex; align-items: center; justify-content: space-between; }
.tenant-name { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; }
.tenant-usage { display: flex; gap: 28px; margin-top: 12px; }
.usage-item { display: flex; flex-direction: column; gap: 3px; }
.usage-item span { font-size: 12px; color: var(--sub); }
.usage-item b { font-size: 18px; font-variant-numeric: tabular-nums; }
.usage-item b.low { color: #d94f43; }
.cap-list { margin-top: 14px; padding-top: 12px; border-top: 1px dashed var(--border); display: flex; flex-direction: column; gap: 10px; }
.cap-row { display: flex; align-items: center; justify-content: space-between; }
.cap-label { font-size: 13px; }
.modal-sub { font-size: 12.5px; color: var(--sub); margin: 0 0 12px; }
</style>
