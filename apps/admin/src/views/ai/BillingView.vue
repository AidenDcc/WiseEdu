<script setup lang="ts">
/**
 * AI 计费与租户能力开关（P-05-13 / 14）。
 *
 * 计费采用「全局默认 + 租户覆盖」两级口径：
 * - 全局默认：一张完整价目表，所有租户默认按它计费；
 * - 租户覆盖：只给签约时单独议价的场景留一条专属价，其余场景继续继承全局。
 *
 * 这样新增计费场景时只补一条全局规则，不必给每个租户各补一条（漏一个就按 0 计费）。
 *
 * 另一个区块是租户 AI 能力开关：逐租户逐能力开关，并展示本月用量与剩余额度
 * （对应租户端「AI 用量与余额」的同一份数据）。
 */
import { computed, onMounted, ref } from 'vue'
import { AppIcon, AppPageHeader, AppSegmented, AppSwitch, showToast, AppModal, appConfirm } from '@aiteach/shared'

import type { AiBillingRule, AiTenantBillingRow, TenantAiSwitch } from '@aiteach/shared'
import {
  fetchBillingRules,
  fetchTenantAiSwitches,
  fetchTenantBillingRules,
  resetTenantBillingRule,
  saveBillingRule,
  saveTenantBillingRule,
  toggleTenantAiCapability,
} from '@/api/content'

type Scope = 'global' | 'tenant'

const SCOPE_OPTIONS = [
  { value: 'global', label: '全局默认' },
  { value: 'tenant', label: '按租户设置' },
]

const UNIT_TEXT: Record<AiBillingRule['unit'], string> = { call: '元 / 次', '1k-token': '元 / 千 token' }

const rules = ref<AiBillingRule[]>([])
const tenantRows = ref<AiTenantBillingRow[]>([])
const tenants = ref<TenantAiSwitch[]>([])
const loading = ref(true)

const scope = ref<Scope>('global')
const activeTenantId = ref<number | null>(null)

const activeTenant = computed(() => tenants.value.find((row) => row.tenantId === activeTenantId.value) ?? null)
const overrideCount = computed(() => tenantRows.value.filter((row) => row.overridden).length)

async function loadTenantRows() {
  if (activeTenantId.value == null) {
    tenantRows.value = []
    return
  }
  tenantRows.value = await fetchTenantBillingRules(activeTenantId.value)
}

async function load() {
  loading.value = true
  try {
    const [ruleList, tenantList] = await Promise.all([fetchBillingRules(), fetchTenantAiSwitches()])
    rules.value = ruleList
    tenants.value = tenantList
    if (activeTenantId.value == null && tenantList.length) activeTenantId.value = tenantList[0].tenantId
    await loadTenantRows()
  } finally {
    loading.value = false
  }
}

/** 切到「按租户设置」时才拉取该租户的价目表，避免首屏多打一次接口 */
async function onScopeChange(next: string) {
  if (next === 'tenant') await loadTenantRows()
}

function priceText(price: number, unit: AiBillingRule['unit']) {
  return `¥${price} / ${unit === 'call' ? '次' : '千 token'}`
}

const totalMonthCost = computed(() => Math.round(tenants.value.reduce((sum, row) => sum + row.monthCost, 0) * 100) / 100)

/* ===== 计费规则编辑（全局 / 租户共用一个弹窗） ===== */
const editing = ref<null | {
  mode: Scope
  /** 全局规则 id（仅 mode=global 用） */
  id?: number
  scene: string
  model: string
  unit: AiBillingRule['unit']
  price: number
  /** 租户模式下展示全局默认价，方便对比改价幅度 */
  globalPrice?: number
  globalUnit?: AiBillingRule['unit']
}>(null)

function openGlobalEdit(row: AiBillingRule) {
  editing.value = { mode: 'global', id: row.id, scene: row.scene, model: row.model, unit: row.unit, price: row.price }
}

function openTenantEdit(row: AiTenantBillingRow) {
  editing.value = {
    mode: 'tenant',
    scene: row.scene,
    model: row.model,
    unit: row.unit,
    price: row.price,
    globalPrice: row.globalPrice,
    globalUnit: row.globalUnit,
  }
}

async function submitRule() {
  const draft = editing.value
  if (!draft) return
  if (!(draft.price > 0)) {
    showToast('单价必须大于 0', 'error')
    return
  }
  try {
    if (draft.mode === 'global' && draft.id != null) {
      await saveBillingRule(draft.id, { unit: draft.unit, price: draft.price })
      showToast('全局默认价已更新，未单独议价的租户同步生效', 'success')
    } else if (activeTenantId.value != null) {
      tenantRows.value = await saveTenantBillingRule(activeTenantId.value, draft.scene, {
        unit: draft.unit,
        price: draft.price,
      })
      showToast(`${activeTenant.value?.tenantName ?? '该租户'} · ${draft.scene} 专属价已保存`, 'success')
    }
    editing.value = null
    await load()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '保存失败', 'error')
  }
}

async function toggleRule(row: AiBillingRule) {
  await saveBillingRule(row.id, { enabled: !row.enabled })
  await load()
  showToast(row.enabled ? '已停用该计费规则' : '已启用', 'success')
}

async function resetTenant(row: AiTenantBillingRow) {
  if (activeTenantId.value == null) return
  if (!(await appConfirm(`「${row.scene}」恢复按全局默认价计费？`, { type: 'warning' }))) return
  tenantRows.value = await resetTenantBillingRule(activeTenantId.value, row.scene)
  showToast('已恢复继承全局默认价', 'success')
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

onMounted(load)
</script>

<template>
  <div class="page">
    <AppPageHeader desc="计费按「全局默认 + 租户专属」两级执行；租户端「AI 用量与余额」按此口径计量。开启能力需同时具备套餐权益与剩余额度。">
      <template #actions>
        <div class="cost-chip">本月全平台 AI 消耗 <b>¥{{ totalMonthCost }}</b></div>
      </template>
    </AppPageHeader>

    <!-- 计费规则 -->
    <div class="panel">
      <div class="panel-head">
        <div class="head-text">
          <h3 class="panel-title">AI 计费规则</h3>
          <p class="panel-hint">
            全局默认价对所有租户生效；需要单独议价的租户可设置专属价，只覆盖对应场景，其余场景继续继承全局。
          </p>
        </div>
        <AppSegmented v-model="scope" :options="SCOPE_OPTIONS" @update:model-value="onScopeChange" />
      </div>

      <!-- 租户范围：选谁看谁，并说明「没配的走全局」 -->
      <div v-if="scope === 'tenant'" class="scope-bar">
        <span class="scope-label">租户</span>
        <select v-model.number="activeTenantId" class="f-select scope-select" @change="loadTenantRows">
          <option v-for="tenant in tenants" :key="tenant.tenantId" :value="tenant.tenantId">{{ tenant.tenantName }}</option>
        </select>
        <span class="scope-note">
          已设专属价 <b>{{ overrideCount }}</b> / {{ tenantRows.length }} 个场景；其余按全局默认计费
        </span>
      </div>

      <div v-if="scope === 'global'" class="data-table-wrap">
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
                    <button class="mini-btn" @click="openGlobalEdit(row)">调价</button>
                    <button class="mini-btn" @click="toggleRule(row)">{{ row.enabled ? '停用' : '启用' }}</button>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <div v-else class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>场景</th>
              <th>模型</th>
              <th>计价单位</th>
              <th>生效单价</th>
              <th>生效来源</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading"><td colspan="7" class="empty-row">加载中…</td></tr>
            <tr v-else-if="tenantRows.length === 0"><td colspan="7" class="empty-row">暂无可计费场景</td></tr>
            <template v-else>
              <tr v-for="row in tenantRows" :key="row.scene">
                <td class="cell-strong">{{ row.scene }}</td>
                <td class="mono">{{ row.model }}</td>
                <td>{{ UNIT_TEXT[row.unit] }}</td>
                <td>
                  <span class="price" :class="{ inherited: !row.overridden }">¥ {{ row.price }}</span>
                  <span v-if="row.overridden" class="price-base">全局 {{ priceText(row.globalPrice, row.globalUnit) }}</span>
                </td>
                <td>
                  <span class="tag" :class="row.overridden ? 'tag-blue' : 'tag-gray'">
                    {{ row.overridden ? '租户专属' : '继承全局' }}
                  </span>
                </td>
                <td><span class="tag" :class="row.enabled ? 'tag-green' : 'tag-gray'">{{ row.enabled ? '启用' : '停用' }}</span></td>
                <td>
                  <div class="op-group">
                    <button class="mini-btn" @click="openTenantEdit(row)">{{ row.overridden ? '修改专属价' : '设置专属价' }}</button>
                    <button v-if="row.overridden" class="mini-btn danger" @click="resetTenant(row)">恢复继承</button>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <p class="table-foot">
        {{ scope === 'global'
          ? '全局默认价改动后，对所有未设置专属价的租户即时生效；已设置专属价的场景不受影响。'
          : '专属价只影响该租户的结算单价；计费启停仍在「全局默认」中统一配置。' }}
      </p>
    </div>

    <!-- 租户 AI 能力开关 -->
    <div class="panel">
      <div class="panel-head">
        <div class="head-text">
          <h3 class="panel-title">租户 AI 能力开关</h3>
          <p class="panel-hint">
            治理要求：学生 AI 问答默认开启引导式解题（不直接给答案），可按租户关闭；关闭后该租户相关入口置灰。
          </p>
        </div>
        <span class="panel-count">{{ tenants.length }} 个租户</span>
      </div>
      <div class="panel-body">
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
    </div>

    <AppModal
      v-if="editing"
      :title="`${editing.mode === 'tenant' ? '设置租户专属价' : '调整计费单价'} · ${editing.scene}`"
      :width="440"
      @close="editing = null"
    >
      <p class="modal-sub">
        <template v-if="editing.mode === 'tenant'">
          {{ activeTenant?.tenantName }} · 仅覆盖该场景的结算单价；全局默认 {{ priceText(editing.globalPrice ?? 0, editing.globalUnit ?? 'call') }}
        </template>
        <template v-else>
          全局默认 · {{ editing.model }}，改动后对未设专属价的租户即时生效
        </template>
      </p>
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

/* panel 头部统一内边距：标题 / 说明 / 右侧控件都离边框 18px，不再贴着圆角边线 */
.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 15px 18px 13px;
}
.head-text { min-width: 0; }
.panel-title { font-size: 14.5px; font-weight: 700; margin: 0; }
.panel-hint { font-size: 12.5px; color: var(--sub); margin: 6px 0 0; line-height: 1.7; }
.panel-count { font-size: 12.5px; color: var(--sub); flex-shrink: 0; line-height: 22px; }

/* 表格上下不要贴死头部：表格自身有单元格内边距，这里只补头部与表格之间的呼吸 */
.panel > .data-table-wrap { border-top: 1px solid var(--border); }
.panel-body { padding: 14px 18px 18px; }

.scope-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 10px 18px;
  background: #f8fafd;
  border-top: 1px dashed var(--border);
}
.scope-label { font-size: 12.5px; font-weight: 600; color: var(--sub); }
.scope-select { height: 32px; width: 168px; }
.scope-note { font-size: 12.5px; color: var(--sub); }
.scope-note b { color: var(--brand-deep); }

.table-foot {
  margin: 0;
  padding: 11px 18px 14px;
  font-size: 12px;
  color: var(--sub);
  border-top: 1px dashed var(--border);
}

.mono { font-family: 'SF Mono', Menlo, monospace; font-size: 12px; }
.price { font-variant-numeric: tabular-nums; font-weight: 600; }
.price.inherited { color: var(--ink-2); font-weight: 500; }
.price-base { display: block; font-size: 11.5px; color: var(--sub); font-weight: 400; margin-top: 2px; }

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
.modal-sub { font-size: 12.5px; color: var(--sub); margin: 0 0 12px; line-height: 1.7; }
</style>
