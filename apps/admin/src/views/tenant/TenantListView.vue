<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  AppFilterPanel,
  AppIcon,
  AppListToolbar,
  CERT_CATEGORIES,
  CERT_CATEGORY_TEXT,
  hueColor,
  showToast,
  ApiError,
  AppModal,
  appConfirm,
} from '@aiteach/shared'
import type { CertCategory, CertFile, FilterRowDef, PackageRecord, TenantRecord } from '@aiteach/shared'
import AppPagination from '@/components/ui/AppPagination.vue'
import {
  activateTenant,
  createApply,
  disableTenant,
  enableTenant,
  extendTrial,
  fetchPackages,
  fetchTenants,
  renewTenant,
} from '@/api/tenant'
import { REGION_OPTIONS, regionText } from '@/utils/region'

const router = useRouter()

/* ===== 列表与筛选 ===== */
const ORG_TYPES = ['公立学校', '民办学校', '培训机构', '其他']
const STAGES = ['小学', '初中', '高中']
const DURATIONS = [
  { key: 'month', label: '1 个月', months: 1, discount: 1 },
  { key: 'quarter', label: '3 个月', months: 3, discount: 1 },
  { key: 'year', label: '12 个月（9 折）', months: 12, discount: 0.9 },
]

const FILTERS = reactive<Record<string, string[]>>({ status: [], package: [], orgType: [] })

/* 到期时间是本页唯一一个「不是 chip」的条件：控件是 el-date-picker，由 #extra 插槽画。
   行定义里仍然登记它（`custom: true`），面板据此把它算进折叠摘要、也据此清空它 ——
   否则折叠起来就看不见这个条件，也永远清不掉。 */
const EXPIRE_KEY = 'expire'
const EXPIRE_LABEL = '到期时间'

/* AppFilterPanel 回传整份筛选值（覆盖式回写），逐 key 写回这份 reactive 对象本身。
   不能交给 `v-model`：它会替换掉整个对象，而替换引用不是一次响应式写入 —— 点了 chip
   既不亮选中态也不重新筛选。机构端 CollabView 里有同款说明。 */
function onFiltersChange(next: Record<string, string[]>) {
  FILTERS.status = next.status ?? []
  FILTERS.package = next.package ?? []
  FILTERS.orgType = next.orgType ?? []
  /* expire 这一行没有 chip，面板只可能在「清空」时给出空数组；区间本身由 expireRange 承载 */
  if (!next[EXPIRE_KEY]?.length) expireRange.value = null
}
const keyword = ref('')
/* 到期区间：[起始, 结束]，YYYY-MM-DD。el-date-picker 的 daterange 用 value-format
   直接吐字符串，省掉一层 dayjs 来回转换，接口拿到的就是它要的格式。 */
const expireRange = ref<[string, string] | null>(null)

/* 交给面板的筛选值：在 FILTERS 之上补一个只读的 expire 项，值就是折叠时要显示的那行字。
   单向派生（不是第二份状态）—— 区间仍只存在 expireRange 里，这里只是把它的展示文案
   翻译成面板认识的样子。 */
const panelValue = computed<Record<string, string[]>>(() => ({
  ...FILTERS,
  [EXPIRE_KEY]: expireRange.value ? [`${expireRange.value[0]} ~ ${expireRange.value[1]}`] : [],
}))
const page = ref(1)
const pageSize = 10
const total = ref(0)
const list = ref<TenantRecord[]>([])
const loading = ref(false)
const packages = ref<PackageRecord[]>([])

const STATUS_META: Record<number, { text: string; tag: string }> = {
  1: { text: '试用中', tag: 'tag-blue' },
  2: { text: '正式', tag: 'tag-green' },
  3: { text: '已到期', tag: 'tag-orange' },
  4: { text: '已禁用', tag: 'tag-red' },
}

/* 套餐候选项来自接口数据，故用 computed 而不是模块级常量 */
const FILTER_ROWS = computed<FilterRowDef[]>(() => [
  { key: 'status', label: '状态', options: Object.values(STATUS_META).map((meta) => meta.text), multiple: false },
  { key: 'package', label: '套餐', options: packages.value.map((pkg) => pkg.name), multiple: false },
  { key: 'orgType', label: '类型', options: ORG_TYPES, multiple: false },
  { key: EXPIRE_KEY, label: EXPIRE_LABEL, options: [], custom: true },
])

/** chip 文案 → 接口参数（status 为 1~4 的数字串） */
function statusParam() {
  const label = FILTERS.status[0]
  if (!label) return ''
  return Object.entries(STATUS_META).find(([, meta]) => meta.text === label)?.[0] ?? ''
}

function packageParam() {
  const name = FILTERS.package[0]
  if (!name) return ''
  return String(packages.value.find((pkg) => pkg.name === name)?.id ?? '')
}

async function load() {
  loading.value = true
  try {
    const result = await fetchTenants({
      status: statusParam(),
      packageId: packageParam(),
      orgType: FILTERS.orgType[0] ?? '',
      keyword: keyword.value.trim(),
      expireFrom: expireRange.value?.[0] ?? '',
      expireTo: expireRange.value?.[1] ?? '',
      page: page.value,
      pageSize,
    })
    list.value = result.list
    total.value = result.total
  } finally {
    loading.value = false
  }
}

function search() {
  page.value = 1
  load()
}

/* 筛选条件 / 关键词 / 到期区间变化即重新查询（原来是点「查询」按钮）。
   三个源合成一个 watcher：面板的「清空」会同时改 FILTERS 和 expireRange，
   拆成两个 watcher 就是两次内容相同的请求。 */
watch([FILTERS, keyword, expireRange], search, { deep: true })

function pkgName(id: number) {
  return packages.value.find((pkg) => pkg.id === id)?.name ?? `套餐 ${id}`
}

function daysLeft(tenant: TenantRecord) {
  return Math.ceil((new Date(tenant.expireTime).getTime() - Date.now()) / 86400_000)
}

function usageClass(tenant: TenantRecord) {
  const ratio = tenant.quotas.aiQuota ? tenant.aiUsed / tenant.quotas.aiQuota : 0
  if (ratio >= 1) return 'danger'
  if (ratio >= 0.8) return 'warn'
  return ''
}

function fmtDate(time: string) {
  return time.slice(0, 10)
}

/* ===== 禁用 / 启用（FR-PT-010） ===== */
const disableTarget = ref<TenantRecord | null>(null)
const disableReason = ref('')
const disableError = ref('')
const disabling = ref(false)

function openDisable(tenant: TenantRecord) {
  disableTarget.value = tenant
  disableReason.value = ''
  disableError.value = ''
}

async function confirmDisable() {
  if (!disableTarget.value) return
  if (disableReason.value.trim().length < 5) {
    disableError.value = '请填写至少 5 个字的禁用原因'
    return
  }
  disabling.value = true
  try {
    await disableTenant(disableTarget.value.id, disableReason.value.trim())
    showToast('已禁用该机构，其机构端账号将立即下线', 'success')
    disableTarget.value = null
    load()
  } catch (error) {
    disableError.value = error instanceof ApiError ? error.message : '操作失败，请重试'
  } finally {
    disabling.value = false
  }
}

async function onEnable(tenant: TenantRecord) {
  if (!(await appConfirm(`确认启用「${tenant.name}」？启用后机构可正常登录使用。`, { type: 'info' }))) return
  try {
    await enableTenant(tenant.id)
    showToast('已启用该机构', 'success')
    load()
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : '操作失败，请重试', 'error')
  }
}

/* ===== 续费（FR-PT-009） ===== */
const renewTarget = ref<TenantRecord | null>(null)
const renewForm = reactive({ packageId: 0, duration: 'month' })
const renewing = ref(false)

function openRenew(tenant: TenantRecord) {
  renewTarget.value = tenant
  renewForm.packageId = tenant.packageId
  renewForm.duration = 'year'
}

const renewAmount = computed(() => {
  if (!renewTarget.value) return 0
  const pkg = packages.value.find((item) => item.id === renewForm.packageId)
  const duration = DURATIONS.find((item) => item.key === renewForm.duration) ?? DURATIONS[0]
  if (!pkg) return 0
  return Math.round(pkg.monthlyPrice * duration.months * duration.discount)
})

const renewExpire = computed(() => {
  if (!renewTarget.value) return ''
  const duration = DURATIONS.find((item) => item.key === renewForm.duration) ?? DURATIONS[0]
  const base = Math.max(new Date(renewTarget.value.expireTime).getTime(), Date.now())
  return new Date(base + duration.months * 86400_000).toISOString().slice(0, 10)
})

async function confirmRenew() {
  if (!renewTarget.value) return
  renewing.value = true
  try {
    const result = await renewTenant(renewTarget.value.id, renewForm.packageId, renewForm.duration)
    showToast(`续费成功（¥${result.amount.toLocaleString('zh-CN')}），新到期日 ${result.expireTime.slice(0, 10)}`, 'success')
    renewTarget.value = null
    load()
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : '操作失败，请重试', 'error')
  } finally {
    renewing.value = false
  }
}

/* ===== 试用配置（FR-PT-011） ===== */
const trialTarget = ref<TenantRecord | null>(null)
const trialDays = ref(7)
const trialPackageId = ref(0)
const trialError = ref('')
const trialBusy = ref(false)

function openTrial(tenant: TenantRecord) {
  trialTarget.value = tenant
  trialDays.value = 7
  trialPackageId.value = tenant.packageId
  trialError.value = ''
}

async function confirmExtendTrial() {
  if (!trialTarget.value) return
  if (!Number.isInteger(trialDays.value) || trialDays.value < 1 || trialDays.value > 90) {
    trialError.value = '延长天数须为 1-90 的整数'
    return
  }
  trialBusy.value = true
  try {
    const result = await extendTrial(trialTarget.value.id, trialDays.value)
    showToast(`已延长试用，新到期日 ${result.expireTime.slice(0, 10)}`, 'success')
    trialTarget.value = null
    load()
  } catch (error) {
    trialError.value = error instanceof ApiError ? error.message : '操作失败，请重试'
  } finally {
    trialBusy.value = false
  }
}

async function confirmActivate() {
  if (!trialTarget.value) return
  trialBusy.value = true
  try {
    const result = await activateTenant(trialTarget.value.id, trialPackageId.value)
    showToast(`已转正式（一年期），到期日 ${result.expireTime.slice(0, 10)}`, 'success')
    trialTarget.value = null
    load()
  } catch (error) {
    trialError.value = error instanceof ApiError ? error.message : '操作失败，请重试'
  } finally {
    trialBusy.value = false
  }
}

onMounted(async () => {
  load()
  packages.value = await fetchPackages()
})

/* ===== 新增机构（提交入驻审核） ===== */
const createOpen = ref(false)
const createForm = reactive({
  orgName: '',
  orgType: '',
  stages: [] as string[],
  contact: '',
  phone: '',
  email: '',
  /* 机构地址拆两段：`region` 是省市区（级联选择器给的路径数组），`address` 是门牌级详细地址。
     提交时前者拼成一行字进 city，后者原样进 address —— 两个字段后端是分开存的。 */
  region: [] as string[],
  address: '',
  intro: '',
})

/** 资质材料按三类分开收集，提交时拍平成一个数组（接口只认一个 certFiles） */
const createCerts = reactive<Record<CertCategory, CertFile[]>>({ license: [], permit: [], legal: [] })

/** 每个分类的补充说明，写在标题下方 */
const CERT_HINTS: Record<CertCategory, string> = {
  license: '营业执照副本彩色扫描件',
  permit: '办学许可证 / 培训资质许可',
  legal: '法人身份证正反面、授权委托书',
}
const CERT_ACCEPT = '.pdf,.jpg,.jpeg,.png'

/* 三个分组共用一个隐藏 input：点哪一组的上传按钮就把该组记在 pickTarget 上，
   input 的 change 回调据此知道往哪个桶里放。每组建一个 input 也行，但那样要么写三个
   ref、要么在 v-for 里收 ref 数组，都不如一个变量直接。 */
const pickTarget = ref<CertCategory | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const createError = ref('')
const creating = ref(false)

const allCerts = computed(() => CERT_CATEGORIES.flatMap((category) => createCerts[category]))

function openCreate() {
  createOpen.value = true
  Object.assign(createForm, {
    orgName: '',
    orgType: '',
    stages: [],
    contact: '',
    phone: '',
    email: '',
    region: [],
    address: '',
    intro: '',
  })
  for (const category of CERT_CATEGORIES) createCerts[category] = []
  pickTarget.value = null
  createError.value = ''
}

function pickFiles(category: CertCategory) {
  pickTarget.value = category
  fileInput.value?.click()
}

function onPickFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const category = pickTarget.value
  if (category) {
    const bucket = createCerts[category]
    for (const file of Array.from(input.files ?? [])) {
      if (bucket.some((item) => item.name === file.name)) continue
      bucket.push({
        name: file.name,
        type: file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'img',
        category,
      })
    }
  }
  input.value = ''
  pickTarget.value = null
}

function removeCert(category: CertCategory, index: number) {
  createCerts[category].splice(index, 1)
}

function toggleCreateStage(stage: string) {
  const index = createForm.stages.indexOf(stage)
  if (index >= 0) createForm.stages.splice(index, 1)
  else createForm.stages.push(stage)
}

async function submitCreate() {
  if (!createForm.orgName.trim()) {
    createError.value = '机构名称不能为空'
    return
  }
  if (!createForm.orgType) {
    createError.value = '请选择机构类型'
    return
  }
  if (!createForm.contact.trim()) {
    createError.value = '联系人不能为空'
    return
  }
  if (!/^1\d{10}$/.test(createForm.phone.trim())) {
    createError.value = '请输入 11 位联系电话'
    return
  }
  if (allCerts.value.length === 0) {
    createError.value = '请至少上传一份资质材料'
    return
  }
  creating.value = true
  try {
    const apply = await createApply({
      orgName: createForm.orgName.trim(),
      orgType: createForm.orgType,
      stages: [...createForm.stages],
      contact: createForm.contact.trim(),
      phone: createForm.phone.trim(),
      email: createForm.email.trim() || undefined,
      city: regionText(createForm.region) || undefined,
      address: createForm.address.trim() || undefined,
      intro: createForm.intro.trim() || undefined,
      certFiles: allCerts.value,
    })
    createOpen.value = false
    showToast(`已提交入驻审核（申请编号 ${apply.applyNo}），请在「入驻审核」中处理`, 'success')
  } catch (error) {
    createError.value = error instanceof ApiError ? error.message : '提交失败，请重试'
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <div class="page">
    <!-- 搜索条件：独立面板，与下方列表分开（对齐机构端列表页布局） -->
    <AppFilterPanel :rows="FILTER_ROWS" :model-value="panelValue" @update:model-value="onFiltersChange">
      <template #extra>
        <div class="range-row">
          <span class="range-label">{{ EXPIRE_LABEL }}</span>
          <div class="range-picker">
            <el-date-picker
              v-model="expireRange"
              type="daterange"
              value-format="YYYY-MM-DD"
              range-separator="至"
              start-placeholder="开始日期"
              end-placeholder="结束日期"
            />
          </div>
        </div>
      </template>
    </AppFilterPanel>

    <div class="panel">
      <AppListToolbar v-model="keyword" placeholder="机构名称 / 编号" :search-width="220">
        <template #right>
          <button class="btn btn-primary btn-sm" @click="openCreate">
            <AppIcon name="plus" :size="15" /> 新增机构
          </button>
        </template>
      </AppListToolbar>

      <!-- 表格 -->
      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>机构</th>
              <th>类型</th>
              <th>当前套餐</th>
              <th>状态</th>
              <th>到期时间</th>
              <th>本月 AI 用量</th>
              <th>创建时间</th>
              <th style="width: 210px">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading && list.length === 0">
              <td colspan="8" class="empty-row">加载中…</td>
            </tr>
            <tr v-else-if="list.length === 0">
              <td colspan="8" class="empty-row">暂无符合条件的机构</td>
            </tr>
            <template v-else>
              <tr v-for="tenant in list" :key="tenant.id">
                <td>
                  <div class="org-cell">
                    <span class="org-logo" :style="{ background: hueColor(tenant.logoHue) }">
                      {{ tenant.name.charAt(0) }}
                    </span>
                    <span class="org-meta">
                      <button class="org-name" type="button" @click="router.push(`/tenant/list/${tenant.id}`)">
                        {{ tenant.name }}
                      </button>
                      <span class="org-code">{{ tenant.code }}</span>
                    </span>
                  </div>
                </td>
                <td>{{ tenant.orgType }}</td>
                <td>{{ pkgName(tenant.packageId) }}</td>
                <td>
                  <span class="tag" :class="STATUS_META[tenant.status].tag">
                    {{ STATUS_META[tenant.status].text }}
                  </span>
                </td>
                <td>
                  <div class="expire-cell">
                    <span :class="{ 'expire-warn': daysLeft(tenant) <= 30 && daysLeft(tenant) >= 0, 'expire-over': daysLeft(tenant) < 0 }">
                      {{ fmtDate(tenant.expireTime) }}
                    </span>
                    <span v-if="tenant.status !== 4" class="days-left">
                      {{ daysLeft(tenant) < 0 ? '已过期' : `剩 ${daysLeft(tenant)} 天` }}
                    </span>
                  </div>
                </td>
                <td>
                  <div class="usage" :class="usageClass(tenant)">
                    <div class="num">
                      {{ tenant.aiUsed.toLocaleString('zh-CN') }} /
                      {{ tenant.quotas.aiQuota.toLocaleString('zh-CN') }} 次
                    </div>
                    <div class="bar">
                      <i
                        :style="{
                          width: `${Math.min(100, (tenant.aiUsed / tenant.quotas.aiQuota) * 100)}%`,
                        }"
                      />
                    </div>
                  </div>
                </td>
                <td>{{ fmtDate(tenant.createdAt) }}</td>
                <td>
                  <div class="op-group">
                    <button
                      class="mini-btn"
                      type="button"
                      @click="router.push(`/tenant/list/${tenant.id}`)"
                    >
                      详情
                    </button>
                    <button
                      v-if="tenant.status === 1"
                      class="mini-btn"
                      type="button"
                      @click="openTrial(tenant)"
                    >
                      试用配置
                    </button>
                    <button
                      v-if="tenant.status !== 4"
                      class="mini-btn"
                      type="button"
                      @click="openRenew(tenant)"
                    >
                      续费
                    </button>
                    <button
                      v-if="tenant.status === 4"
                      class="mini-btn success"
                      type="button"
                      @click="onEnable(tenant)"
                    >
                      启用
                    </button>
                    <button
                      v-else
                      class="mini-btn danger"
                      type="button"
                      @click="openDisable(tenant)"
                    >
                      禁用
                    </button>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <AppPagination :total="total" :page="page" :page-size="pageSize" @update:page="page = $event; load()" />
    </div>

    <!-- 禁用弹窗 -->
    <AppModal v-if="disableTarget" title="禁用机构" :close-on-mask="false" @close="disableTarget = null">
      <div class="warn-banner">
        <AppIcon name="warning" :size="17" />
        <p>禁用后「{{ disableTarget.name }}」全部账号将立即下线、无法登录，直至重新启用。</p>
      </div>
      <div class="f-field">
        <label class="f-label">禁用原因<span class="req">*</span></label>
        <textarea
          v-model="disableReason"
          class="f-textarea"
          maxlength="200"
          placeholder="将通知机构管理员，请如实填写（至少 5 个字）"
        />
      </div>
      <p v-if="disableError" class="err">{{ disableError }}</p>
      <template #footer>
        <button class="btn btn-ghost btn-sm" @click="disableTarget = null">取消</button>
        <button class="btn btn-danger btn-sm" :disabled="disabling" @click="confirmDisable">
          {{ disabling ? '处理中…' : '确认禁用' }}
        </button>
      </template>
    </AppModal>

    <!-- 续费弹窗 -->
    <AppModal v-if="renewTarget" title="机构续费" @close="renewTarget = null">
      <div class="f-field">
        <label class="f-label">续费套餐</label>
        <select v-model="renewForm.packageId" class="f-select">
          <option v-for="pkg in packages" :key="pkg.id" :value="pkg.id">
            {{ pkg.name }}（¥{{ pkg.monthlyPrice }}/月 · AI {{ pkg.aiQuota.toLocaleString('zh-CN') }} 次/月）
          </option>
        </select>
      </div>
      <div class="f-field">
        <label class="f-label">续费时长</label>
        <div class="duration-row">
          <button
            v-for="duration in DURATIONS"
            :key="duration.key"
            class="duration-btn"
            :class="{ active: renewForm.duration === duration.key }"
            type="button"
            @click="renewForm.duration = duration.key"
          >
            {{ duration.label }}
          </button>
        </div>
      </div>
      <div class="summary-bar">
        <div>
          <span class="s-label">应付金额</span>
          <b class="s-amount">¥{{ renewAmount.toLocaleString('zh-CN') }}</b>
        </div>
        <div style="text-align: right">
          <span class="s-label">付款后新到期日</span>
          <b class="s-date">{{ renewExpire }}</b>
        </div>
      </div>
      <p class="f-hint">到期时间从当前到期日（或今天，取较晚者）顺延。</p>
      <template #footer>
        <button class="btn btn-ghost btn-sm" @click="renewTarget = null">取消</button>
        <button class="btn btn-primary btn-sm" :disabled="renewing" @click="confirmRenew">
          {{ renewing ? '提交中…' : '确认续费' }}
        </button>
      </template>
    </AppModal>

    <!-- 试用配置弹窗 -->
    <AppModal v-if="trialTarget" title="试用配置" :width="480" @close="trialTarget = null">
      <p class="modal-tip">
        「{{ trialTarget.name }}」当前试用至 {{ fmtDate(trialTarget.expireTime) }}，
        可延长试用或直接转为正式套餐。
      </p>
      <div class="trial-block">
        <h4 class="section-title">延长试用</h4>
        <div class="trial-row">
          <input v-model.number="trialDays" class="f-input" type="number" min="1" max="90" style="width: 130px" />
          <span class="trial-unit">天（1-90）</span>
          <button class="btn btn-primary btn-sm" :disabled="trialBusy" @click="confirmExtendTrial">延长</button>
        </div>
      </div>
      <div class="trial-block">
        <h4 class="section-title">转为正式</h4>
        <div class="trial-row">
          <select v-model="trialPackageId" class="f-select" style="flex: 1">
            <option v-for="pkg in packages" :key="pkg.id" :value="pkg.id">
              {{ pkg.name }}（¥{{ pkg.monthlyPrice }}/月）
            </option>
          </select>
          <button class="btn btn-ghost btn-sm" :disabled="trialBusy" @click="confirmActivate">转正式（一年）</button>
        </div>
      </div>
      <p v-if="trialError" class="err">{{ trialError }}</p>
    </AppModal>

    <!-- 新增机构弹窗（提交入驻审核） -->
    <AppModal
      v-if="createOpen"
      title="新增机构"
      :width="780"
      :close-on-mask="false"
      @close="createOpen = false"
    >
      <p class="modal-tip">
        新增机构将生成一条入驻申请并进入「入驻审核」，审核通过后自动开通租户并通知联系人。
      </p>
      <div class="create-grid">
        <div class="f-field span-2">
          <label class="f-label">机构名称<span class="req">*</span></label>
          <input v-model="createForm.orgName" class="f-input" placeholder="机构全称" />
        </div>
        <div class="f-field">
          <label class="f-label">机构类型<span class="req">*</span></label>
          <select v-model="createForm.orgType" class="f-select">
            <option value="" disabled>请选择</option>
            <option v-for="type in ORG_TYPES" :key="type" :value="type">{{ type }}</option>
          </select>
        </div>
        <div class="f-field">
          <label class="f-label">联系电话<span class="req">*</span></label>
          <input v-model="createForm.phone" class="f-input" maxlength="11" placeholder="11 位手机号" />
        </div>
        <div class="f-field">
          <label class="f-label">联系人<span class="req">*</span></label>
          <input v-model="createForm.contact" class="f-input" />
        </div>
        <div class="f-field">
          <label class="f-label">电子邮箱</label>
          <input v-model="createForm.email" class="f-input" placeholder="选填" />
        </div>
        <!-- 机构地址拆两段：左边省市区级联，右边门牌级详细地址 -->
        <div class="f-field">
          <label class="f-label">所在地区</label>
          <div class="region-picker">
            <el-cascader
              v-model="createForm.region"
              :options="REGION_OPTIONS"
              :props="{ expandTrigger: 'hover' }"
              placeholder="省 / 市 / 区"
              clearable
              filterable
            />
          </div>
        </div>
        <div class="f-field">
          <label class="f-label">详细地址</label>
          <input v-model="createForm.address" class="f-input" placeholder="选填，如：珞喻路 152 号 3 号楼" />
        </div>
        <div class="f-field span-2">
          <label class="f-label">覆盖学段</label>
          <div class="stage-row">
            <button
              v-for="stage in STAGES"
              :key="stage"
              class="stage-btn"
              :class="{ active: createForm.stages.includes(stage) }"
              type="button"
              @click="toggleCreateStage(stage)"
            >
              {{ stage }}
            </button>
          </div>
        </div>
        <div class="f-field span-2">
          <label class="f-label">机构简介</label>
          <textarea v-model="createForm.intro" class="f-textarea" maxlength="200" placeholder="选填，便于审核时了解机构情况" />
        </div>
        <div class="f-field span-2">
          <label class="f-label">资质材料<span class="req">*</span></label>
          <div class="cert-groups">
            <div v-for="category in CERT_CATEGORIES" :key="category" class="cert-group">
              <div class="cert-group-head">
                <b class="cert-group-title">{{ CERT_CATEGORY_TEXT[category] }}</b>
                <span class="cert-group-hint">{{ CERT_HINTS[category] }}</span>
              </div>
              <button class="upload-zone" type="button" @click="pickFiles(category)">
                <AppIcon name="upload" :size="17" />
                <span>点击上传</span>
              </button>
              <ul v-if="createCerts[category].length" class="picked-list">
                <li v-for="(file, index) in createCerts[category]" :key="file.name">
                  <AppIcon :name="file.type === 'pdf' ? 'file' : 'image'" :size="16" />
                  <span class="picked-name">{{ file.name }}</span>
                  <button class="mini-btn danger" type="button" @click="removeCert(category, index)">
                    删除
                  </button>
                </li>
              </ul>
            </div>
          </div>
          <input
            ref="fileInput"
            type="file"
            multiple
            :accept="CERT_ACCEPT"
            style="display: none"
            @change="onPickFiles"
          />
          <p class="f-hint">支持 PDF / JPG / PNG，可多选；演示环境仅登记文件名用于审核展示，不实际上传文件内容。</p>
        </div>
      </div>
      <p v-if="createError" class="err">{{ createError }}</p>
      <template #footer>
        <button class="btn btn-ghost btn-sm" @click="createOpen = false">取消</button>
        <button class="btn btn-primary btn-sm" :disabled="creating" @click="submitCreate">
          {{ creating ? '提交中…' : '提交入驻审核' }}
        </button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
/* 筛选面板已是列表面板的兄弟节点（自带边框圆角），工具条顶部留白由它自己给 */
.panel > :deep(.list-toolbar) { padding: 14px 14px 0; }

/* 到期区间：与上方 chip 行同缩进（标签列宽 58px 对齐 AppFilterChips 的行首标签） */
.range-row { display: flex; align-items: center; gap: 12px; }
.range-label { width: 58px; flex-shrink: 0; font-size: 12.5px; font-weight: 600; color: var(--sub); }

/* 日期区间宽度：组件库给 daterange 的默认宽度是 350px，比这行的 chip 宽出一大截。
   两处坑叠在一起，只能这么写：
   1) 宽度值 `--el-date-editor-daterange-width: 350px` 声明在 `.el-date-editor` 自身上，
      从祖先元素覆盖这个变量传不下去；
   2) 标签上的内联 style / class 也压不住它 —— picker 的 $attrs 一路传到内部的 ElPopper，
      而 ElPopper 声明了 inheritAttrs: false 且从不读 $attrs，属性在这里被整个丢掉。
   于是改成「外层容器定宽 + 提高权重选中真正的控件」：外层类名带 scoped 的 data-v 属性，
   再加两个类名，权重 0,4,0 稳过组件库的 0,2,0（不必依赖样式注入顺序）。
   240px 是「够显示两个完整日期、又不比 chip 行显眼」的宽度。 */
.range-picker { width: 240px; flex-shrink: 0; }
.range-picker :deep(.el-date-editor.el-range-editor.el-input__wrapper) { width: 100%; }

.org-cell { display: flex; align-items: center; gap: 10px; }
.org-logo {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  color: #fff;
  font-size: 15px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.org-meta { display: flex; flex-direction: column; align-items: flex-start; line-height: 1.35; }
.org-name {
  border: none;
  background: none;
  padding: 0;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--ink);
}
.org-name:hover { color: var(--brand); }
.org-code { font-size: 11.5px; color: var(--sub); }

.expire-cell { display: flex; flex-direction: column; line-height: 1.4; }
.days-left { font-size: 11.5px; color: var(--sub); }
.expire-warn { color: var(--warn); font-weight: 600; }
.expire-over { color: var(--danger); font-weight: 600; }

.warn-banner {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  background: var(--warn-soft);
  color: var(--warn);
  border-radius: 10px;
  padding: 12px 14px;
  margin-bottom: 16px;
}
.warn-banner p { font-size: 13px; color: var(--ink-2); line-height: 1.6; }

.err { font-size: 12px; color: var(--danger); margin: 4px 0; }

.duration-row { display: flex; gap: 8px; }
.duration-btn {
  flex: 1;
  height: 38px;
  border: 1.5px solid var(--border);
  border-radius: 10px;
  background: #fff;
  font-size: 13px;
  color: var(--ink-2);
  font-weight: 600;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}
.duration-btn:hover { border-color: #c9d2e6; }
.duration-btn.active {
  border-color: var(--brand);
  background: var(--brand-soft);
  color: var(--brand);
}

.summary-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #f8fafd;
  border-radius: 10px;
  padding: 13px 16px;
}
.s-label { display: block; font-size: 11.5px; color: var(--sub); margin-bottom: 3px; }
.s-amount { font-size: 19px; color: var(--danger); }
.s-date { font-size: 15px; color: var(--ink); }

.modal-tip {
  font-size: 13px;
  color: var(--ink-2);
  background: #f8fafd;
  border-radius: 10px;
  padding: 11px 14px;
  margin-bottom: 16px;
  line-height: 1.6;
}
.create-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 16px;
}
.create-grid .span-2 { grid-column: span 2; }

/* 省市区级联（Element Plus）。它的外观全由自己的令牌算出来（默认高 32px、圆角 4px、
   边框是 1px 的 inset 阴影、主色是组件库自己的蓝），摆在 .f-input 旁边一眼就能看出是外来户。
   这里把尺寸与配色这几颗令牌换成设计系统的值 —— 令牌都是声明在 `.el-input` / `.el-input__wrapper`
   元素**自身**上的 var() 引用，从外层容器赋值传得下去，所以不用像日期选择器那样硬压权重
   （那个宽度坑是「值写死在元素自身上」，两回事，见上面 .range-picker 的注释）。 */
.region-picker {
  width: 100%;
  --el-component-size: 38px; /* 与 .f-input 同高（其中内层 36px + 上下各 1px 内边距） */
  --el-border-radius-base: 10px;
  --el-font-size-base: 13.5px;
  --el-input-border-color: var(--border);
  --el-input-hover-border-color: #c9d2e6;
  --el-input-placeholder-color: var(--sub);
  --el-input-icon-color: var(--sub);
  --el-color-primary: var(--brand); /* 聚焦描边（is-focus 的 box-shadow 用它） */
}
.region-picker :deep(.el-cascader) { width: 100%; line-height: normal; }
.stage-row { display: flex; gap: 8px; }
.stage-btn {
  height: 36px;
  padding: 0 18px;
  border: 1.5px solid var(--border);
  border-radius: 9px;
  background: #fff;
  color: var(--ink-2);
  font-size: 13px;
  font-weight: 600;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}
.stage-btn.active {
  border-color: var(--brand);
  background: var(--brand-soft);
  color: var(--brand);
}
/* 资质材料三分类并排：弹窗加宽后横向排开，比竖着堆三块省一半高度 */
.cert-groups { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.cert-group { min-width: 0; }
.cert-group-head { margin-bottom: 7px; }
.cert-group-title { font-size: 13px; color: var(--ink); }
.cert-group-hint { display: block; font-size: 11.5px; color: var(--sub); margin-top: 2px; }

.upload-zone {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  width: 100%;
  height: 76px;
  border: 1.5px dashed #c9d2e6;
  border-radius: 11px;
  background: #fafbfd;
  color: var(--sub);
  font-size: 13px;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}
.upload-zone:hover {
  border-color: var(--brand);
  background: var(--brand-soft);
  color: var(--brand);
}
.picked-list { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.picked-list li {
  display: flex;
  align-items: center;
  gap: 9px;
  background: #f8fafd;
  border-radius: 9px;
  padding: 8px 12px;
}
.picked-list li > :first-child { color: var(--brand); flex-shrink: 0; }
.picked-name { flex: 1; font-size: 13px; color: var(--ink-2); text-align: left; word-break: break-all; }
.trial-block { margin-bottom: 18px; }
.trial-row { display: flex; align-items: center; gap: 10px; }
.trial-row .f-input, .trial-row .f-select { height: 36px; }
.trial-unit { font-size: 12.5px; color: var(--sub); }
</style>
