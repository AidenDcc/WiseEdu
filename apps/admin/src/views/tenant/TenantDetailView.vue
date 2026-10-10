<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AppIcon,
  AppSegmented,
  AppTabs,
  BarChart,
  CERT_CATEGORIES,
  CERT_CATEGORY_TEXT,
  hueColor,
  showToast,
  ApiError,
} from '@aiteach/shared'
import type { FeatureSwitches, PackageRecord, TenantDetailModel } from '@aiteach/shared'
import AppSwitch from '@/components/ui/AppSwitch.vue'
import { REGION_OPTIONS, regionPath, regionText } from '@/utils/region'
import {
  fetchPackages,
  fetchTenantDetail,
  updateTenantBase,
  updateTenantFeature,
  updateTenantIsolation,
} from '@/api/tenant'

const route = useRoute()
const router = useRouter()

const TENANT_ID = Number(route.params.id)

const FEATURE_META: Array<{ key: keyof FeatureSwitches; label: string; desc: string }> = [
  { key: 'aiGenerate', label: 'AI 出题', desc: '智能生成各题型试题' },
  { key: 'aiVariant', label: 'AI 变式', desc: '一题多变巩固训练' },
  { key: 'aiPhoto', label: 'AI 拍照识题', desc: '拍照识别录入题目' },
  { key: 'docImport', label: '文档识别入库', desc: 'Word/PDF 教辅解析入库' },
  { key: 'collab', label: '协同组卷', desc: '多教师协同编辑试卷' },
  { key: 'customPrompt', label: '自定义提示词', desc: '机构自定义 AI 提示词模板' },
]

const STAGES = ['小学', '初中', '高中']
const REGIONS = ['华东 1（杭州）', '华东 2（上海）', '华北 1（青岛）', '华北 2（北京）', '华南 1（深圳）', '西南 1（成都）']

const STATUS_META: Record<number, { text: string; tag: string }> = {
  1: { text: '试用中', tag: 'tag-blue' },
  2: { text: '正式', tag: 'tag-green' },
  3: { text: '已到期', tag: 'tag-orange' },
  4: { text: '已禁用', tag: 'tag-red' },
}

const detail = ref<TenantDetailModel | null>(null)
const packages = ref<PackageRecord[]>([])
const activeTab = ref<'base' | 'feature' | 'isolation' | 'stats'>('base')
const saving = ref(false)
/* 详情页默认只读，点「编辑」才进编辑态、按钮变「保存」。三个页签各一份、互不牵连：
   在基础信息里点编辑不该把套餐权限也一并变成可改 */
const editingBase = ref(false)
const editingFeature = ref(false)
const editingIsolation = ref(false)

type TabKey = 'base' | 'feature' | 'isolation' | 'stats'
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'base', label: '基础信息' },
  { key: 'feature', label: '套餐权限' },
  { key: 'isolation', label: '数据隔离' },
  { key: 'stats', label: '数据统计' },
]

/* ===== Tab 1：基础信息 ===== */
const baseForm = reactive({
  name: '',
  contact: '',
  phone: '',
  /* city 存的是「省市区连写」的一行字（与列表、页头同一份），编辑时由 region 这个级联路径
     决定，保存时才 regionText() 回字符串。两者都留着：region 只服务编辑态，city 负责展示 ——
     数据里出现数据集没有的区划时，regionPath 解析不完整也不会让已存的值显示成空 */
  city: '',
  region: [] as string[],
  address: '',
  intro: '',
  stages: [] as string[],
})

/* ===== Tab 2：套餐权限 ===== */
const featureForm = reactive({
  switches: {} as FeatureSwitches,
  quotas: { aiQuota: 0, storageGb: 0, maxStaff: 0, maxConcurrent: 0 },
})
const currentPackageId = ref(0)

/* ===== Tab 3：数据隔离 ===== */
const isolationForm = reactive({ isolationType: 1 as 1 | 2, storageRegion: '' })

/* ===== Tab 4：数据统计 · AI 调用量的粒度 ===== */
const AI_RANGES = [
  { value: 'month', label: '本月' },
  { value: 'half', label: '半年' },
]
/* 默认落在「本月」：进这页多半是看当月的量，而「近 6 个月」在列表页和页头都已经有地方在说了 */
const aiRange = ref<'month' | 'half'>('month')
/* 正在查看的月份（YYYY-MM）。真正的初值在 load 里补成当月 —— 可选月份来自日历，不必预先知道 */
const aiMonth = ref('')

/* 有数据的月份集合（aiDaily 覆盖的近 12 个月），给日历标底色用 */
const aiDataMonths = computed(() => new Set((detail.value?.aiDaily ?? []).map((item) => item.month)))

/* el-date-picker 的 cell-class-name 钩子：每画一格月份调一次，返回值当类名打在格子上。
   只给「有数据」的格子加类，「没有数据」的由 CSS 用 :not() 反向选中 —— 这个返回值会被当成
   类名对象的键（组件内部是 `style[cell.customClass] = true`），要塞两个类名得靠空格，不值得 */
function aiMonthCellClass(date: Date): string {
  const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  return aiDataMonths.value.has(month) ? 'ai-month-has-data' : ''
}

/** 该月的天数（'2026-02' → 28）。横轴要摊满整月，数不到的日子由调用方补 0 */
function daysInMonth(month: string) {
  const [year, mon] = month.split('-').map(Number)
  return new Date(year, mon, 0).getDate()
}

/** 图表只认 labels + values + 标题，两种粒度在这一处收口，模板不必再分叉 */
const aiChart = computed(() => {
  const model = detail.value
  if (!model) return { labels: [] as string[], values: [] as number[], title: '' }
  if (aiRange.value === 'half') {
    return {
      labels: model.aiMonthly.months,
      values: model.aiMonthly.calls,
      title: '近 6 个月 AI 调用量（次）',
    }
  }
  const months = model.aiMonthly.months
  const month = aiMonth.value || months[months.length - 1] || ''
  const daily = model.aiDaily.find((item) => item.month === month)?.calls ?? []
  const days = daysInMonth(month)
  /* 月份的前导 0 要去掉：'2026-02' 读作「2026 年 2 月」，不是「02 月」 */
  const [year, monthNo] = month.split('-')
  return {
    /* 横轴恒为该月全部日子（1..28/30/31），数据里没有的位置补 0：当月没到的日子，
       以及日历上选到的窗口外月份（整月都是 0）—— 缺口画 0 好过把横轴截短 */
    labels: Array.from({ length: days }, (_, index) => String(index + 1)),
    values: Array.from({ length: days }, (_, index) => daily[index] ?? 0),
    /* 窗口外的月份数据里根本没有这一项，标题上点一句，免得一整片 0 的图看着像坏了 */
    title: `${year} 年 ${Number(monthNo)} 月 AI 调用量（次）${daily.length ? '' : ' · 暂无数据'}`,
  }
})

/* AppSegmented 回传的是 string，这里收窄回联合类型（仓库里几处调用同款写法）。
   切粒度不动 aiMonth：从「9 月」切去半年再切回来，应当还在 9 月 */
function setAiRange(value: string) {
  aiRange.value = value as 'month' | 'half'
}

const within24h = computed(() => {
  if (!detail.value) return false
  return (Date.now() - new Date(detail.value.tenant.createdAt).getTime()) / 3600_000 <= 24
})

const usageRatio = computed(() => {
  if (!detail.value) return 0
  const { aiUsed, quotas } = detail.value.tenant
  return quotas.aiQuota ? aiUsed / quotas.aiQuota : 0
})

/** 页头那行地址：所在地区 + 门牌级地址拼成一份完整地址（两者都空时才显示占位文案） */
const addressText = computed(() => {
  const tenant = detail.value?.tenant
  if (!tenant) return ''
  const parts = [tenant.city, tenant.address].filter((value) => value && value.trim())
  return parts.length ? parts.join(' ') : '未填写地址'
})

/**
 * 把详情回填进三份表单。拆成三个而不是合成一个，是为了让「取消」只回滚自己那个页签 ——
 * 三个页签各有独立编辑态，在基础信息点取消不该把套餐权限里未保存的改动一并抹掉。
 */
function fillBaseForm() {
  const tenant = detail.value?.tenant
  if (!tenant) return
  baseForm.name = tenant.name
  baseForm.contact = tenant.contact
  baseForm.phone = tenant.phone
  baseForm.city = tenant.city
  baseForm.region = regionPath(tenant.city)
  baseForm.address = tenant.address
  baseForm.intro = tenant.intro
  baseForm.stages = [...tenant.stages]
}

function fillFeatureForm() {
  const tenant = detail.value?.tenant
  if (!tenant) return
  featureForm.switches = { ...tenant.switches }
  featureForm.quotas = { ...tenant.quotas }
  currentPackageId.value = tenant.packageId
}

function fillIsolationForm() {
  const tenant = detail.value?.tenant
  if (!tenant) return
  isolationForm.isolationType = tenant.isolationType
  isolationForm.storageRegion = tenant.storageRegion
}

async function load() {
  const model = await fetchTenantDetail(TENANT_ID)
  detail.value = model
  fillBaseForm()
  fillFeatureForm()
  fillIsolationForm()
  /* 只在首次落位到当月；保存后重新 load 不该把用户选好的月份弹回当月 */
  if (!aiMonth.value) {
    const months = model.aiMonthly.months
    aiMonth.value = months[months.length - 1] ?? ''
  }
}

/* 「取消」＝丢弃本页签未保存的改动。就地用详情里的值重填，不再打一次接口
   （detail 已在内存里）。这与两端 ProfileView 的先例（取消不回滚）有意不同：
   那边只有 4 个字段，这边基础信息 7 个、套餐权限 10 个，不回滚会让只读视图显示一批
   并未保存的值，「看起来已改其实没存」。 */
function cancelBase() {
  fillBaseForm()
  editingBase.value = false
}
function cancelFeature() {
  fillFeatureForm()
  editingFeature.value = false
}
function cancelIsolation() {
  fillIsolationForm()
  editingIsolation.value = false
}

/* 切页签即退出编辑态并回滚，避免「改了没存 → 切走 → 切回来还是脏的、却没有任何提示」 */
function switchTab(value: string) {
  activeTab.value = value as TabKey
  cancelBase()
  cancelFeature()
  cancelIsolation()
}

function toggleStage(stage: string) {
  const index = baseForm.stages.indexOf(stage)
  if (index >= 0) baseForm.stages.splice(index, 1)
  else baseForm.stages.push(stage)
}

function previewFile(name: string) {
  showToast(`演示环境：在线预览「${name}」`, 'info')
}

/* 资质档案按上传时的分类分组展示（营业执照 / 许可证 / 法人信息），
   空分类不占位置 —— 少一类就不显示那一栏的标题 */
const certGroups = computed(() => {
  const files = detail.value?.tenant.certFiles ?? []
  return CERT_CATEGORIES.map((category) => ({
    category,
    label: CERT_CATEGORY_TEXT[category],
    files: files.filter((file) => file.category === category),
  })).filter((group) => group.files.length > 0)
})

async function saveBase() {
  if (!baseForm.name.trim()) {
    showToast('机构名称不能为空', 'error')
    return
  }
  saving.value = true
  try {
    await updateTenantBase(TENANT_ID, {
      name: baseForm.name,
      contact: baseForm.contact,
      phone: baseForm.phone,
      /* 发给后端的是拼好的字符串；region 是编辑态的内部表示，不出门 */
      city: regionText(baseForm.region),
      address: baseForm.address,
      intro: baseForm.intro,
      stages: [...baseForm.stages],
    })
    showToast('基础信息已保存', 'success')
    /* 保存成功即回到只读态。先置 false 再 await load()：load 只写表单数据、不碰编辑态，
       所以不会出现「编辑态闪回」；await 是为了让 saving 在数据刷新后才归位 */
    editingBase.value = false
    await load()
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : '保存失败，请重试', 'error')
  } finally {
    saving.value = false
  }
}

async function saveFeature() {
  saving.value = true
  try {
    await updateTenantFeature(TENANT_ID, {
      switches: { ...featureForm.switches },
      quotas: { ...featureForm.quotas },
    })
    showToast('套餐权限已保存，机构端菜单将实时生效', 'success')
    editingFeature.value = false
    await load()
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : '保存失败，请重试', 'error')
  } finally {
    saving.value = false
  }
}

async function saveIsolation() {
  saving.value = true
  try {
    await updateTenantIsolation(TENANT_ID, isolationForm.isolationType, isolationForm.storageRegion)
    showToast('数据隔离策略已保存', 'success')
    editingIsolation.value = false
    await load()
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : '保存失败，请重试', 'error')
  } finally {
    saving.value = false
  }
}

function onExport() {
  showToast('报表导出任务已创建，稍后可在下载中心获取（演示）', 'info')
}

onMounted(async () => {
  load()
  packages.value = await fetchPackages()
})
</script>

<template>
  <div v-if="detail">
    <!-- 头部 -->
    <div class="panel head">
      <button class="back-btn" type="button" @click="router.push('/tenant/list')">
        <AppIcon name="chevron-left" :size="16" /> 返回
      </button>
      <span class="org-logo" :style="{ background: hueColor(detail.tenant.logoHue) }">
        {{ detail.tenant.name.charAt(0) }}
      </span>
      <div class="head-meta">
        <div class="head-title">
          <h2>{{ detail.tenant.name }}</h2>
          <span class="tag" :class="STATUS_META[detail.tenant.status].tag">
            {{ STATUS_META[detail.tenant.status].text }}
          </span>
          <span class="tag tag-gray">{{ detail.pkg.name }}</span>
        </div>
        <p class="head-sub">
          {{ detail.tenant.code }} · {{ detail.tenant.orgType }} · {{ detail.tenant.stages.join(' / ') || '未设置学段' }}
          <template v-if="detail.tenant.status === 4">
            · <span class="disabled-reason">禁用原因：{{ detail.tenant.disableReason }}</span>
          </template>
        </p>
        <!-- 地址放左侧信息区，不放右侧 .head-facts —— 那是一栏右对齐的数字区，
             长地址塞进去会把「本月 AI 用量 / 到期时间」挤变形 -->
        <p class="head-sub">地址：{{ addressText }}</p>
      </div>
      <div class="head-facts">
        <div class="fact">
          <span>本月 AI 用量</span>
          <b :class="{ warn: usageRatio >= 0.8 && usageRatio < 1, danger: usageRatio >= 1 }">
            {{ usageRatio >= 1 ? '100%+' : `${Math.round(usageRatio * 100)}%` }}
          </b>
        </div>
        <div class="fact">
          <span>到期时间</span>
          <b>{{ detail.tenant.expireTime.slice(0, 10) }}</b>
        </div>
      </div>
    </div>

    <!-- Tabs -->
    <div class="panel">
      <div class="tabs-wrap">
        <AppTabs :tabs="TABS" :model-value="activeTab" @update:model-value="switchTab" />
      </div>

      <div class="tab-body">
        <!-- Tab 1 基础信息 -->
        <section v-if="activeTab === 'base'" class="form-col">
          <!-- 只读态：详情页默认就是一份档案，不点「编辑」不给输入框 -->
          <div v-if="!editingBase" class="detail-grid">
            <div class="detail-item">
              <div class="d-label">机构名称</div>
              <div class="d-value">{{ baseForm.name || '—' }}</div>
            </div>
            <div class="detail-item">
              <div class="d-label">联系人</div>
              <div class="d-value">{{ baseForm.contact || '—' }}</div>
            </div>
            <div class="detail-item">
              <div class="d-label">所在地区</div>
              <div class="d-value">{{ baseForm.city || '—' }}</div>
            </div>
            <div class="detail-item">
              <div class="d-label">联系电话</div>
              <div class="d-value">{{ baseForm.phone || '—' }}</div>
            </div>
            <div class="detail-item span-2">
              <div class="d-label">机构地址</div>
              <div class="d-value">{{ baseForm.address || '—' }}</div>
            </div>
            <div class="detail-item span-2">
              <div class="d-label">覆盖学段</div>
              <div class="d-value">{{ baseForm.stages.join(' / ') || '未设置学段' }}</div>
            </div>
            <div class="detail-item span-2">
              <div class="d-label">机构简介</div>
              <div class="d-value multi">{{ baseForm.intro || '未填写' }}</div>
            </div>
          </div>

          <!-- 编辑态：与改造前的基础信息表单一致 -->
          <template v-else>
            <div class="form-grid">
              <div class="f-field">
                <label class="f-label">机构名称<span class="req">*</span></label>
                <input v-model="baseForm.name" class="f-input" placeholder="机构全称" />
              </div>
              <!-- 与「新增机构」同一个控件、同一份省市区数据（样式在 main.css 的 .region-picker） -->
              <div class="f-field">
                <label class="f-label">所在地区</label>
                <div class="region-picker">
                  <el-cascader
                    v-model="baseForm.region"
                    :options="REGION_OPTIONS"
                    :props="{ expandTrigger: 'hover' }"
                    placeholder="省 / 市 / 区"
                    clearable
                    filterable
                  />
                </div>
              </div>
              <div class="f-field span-2">
                <label class="f-label">机构地址</label>
                <input v-model="baseForm.address" class="f-input" placeholder="门牌级详细地址，如：洪山区珞喻路 152 号 3 号楼" />
              </div>
              <div class="f-field">
                <label class="f-label">联系人</label>
                <input v-model="baseForm.contact" class="f-input" />
              </div>
              <div class="f-field">
                <label class="f-label">联系电话</label>
                <input v-model="baseForm.phone" class="f-input" />
              </div>
            </div>
            <div class="f-field">
              <label class="f-label">覆盖学段</label>
              <div class="stage-row">
                <button
                  v-for="stage in STAGES"
                  :key="stage"
                  class="stage-btn"
                  :class="{ active: baseForm.stages.includes(stage) }"
                  type="button"
                  @click="toggleStage(stage)"
                >
                  {{ stage }}
                </button>
              </div>
            </div>
            <div class="f-field">
              <label class="f-label">机构简介</label>
              <textarea v-model="baseForm.intro" class="f-textarea" maxlength="300" />
            </div>
          </template>

          <h4 class="section-title">资质材料</h4>
          <div v-for="group in certGroups" :key="group.category" class="cert-block">
            <p class="cert-block-title">{{ group.label }}</p>
            <div class="cert-list">
              <button
                v-for="file in group.files"
                :key="file.name"
                class="cert-item"
                type="button"
                @click="previewFile(file.name)"
              >
                <AppIcon :name="file.type === 'pdf' ? 'file' : 'image'" :size="20" />
                <span class="cert-name">{{ file.name }}</span>
                <span class="cert-act">预览</span>
              </button>
            </div>
          </div>
          <p v-if="certGroups.length === 0" class="cert-empty">该机构暂无资质档案</p>

          <div class="form-actions">
            <button v-if="!editingBase" class="btn btn-primary btn-sm" @click="editingBase = true">编辑</button>
            <div v-else class="op-group">
              <button class="btn btn-ghost btn-sm" :disabled="saving" @click="cancelBase">取消</button>
              <button class="btn btn-primary btn-sm" :disabled="saving" @click="saveBase">
                {{ saving ? '保存中…' : '保存' }}
              </button>
            </div>
          </div>
        </section>

        <!-- Tab 2 套餐权限 -->
        <section v-else-if="activeTab === 'feature'">
          <div class="pkg-banner">
            <div class="pkg-left">
              <span class="tag tag-blue">当前套餐</span>
              <b>{{ detail.pkg.name }}</b>
              <span class="pkg-price">¥{{ detail.pkg.monthlyPrice }}/月</span>
            </div>
            <div class="pkg-facts">
              <span>AI {{ detail.pkg.aiQuota.toLocaleString('zh-CN') }} 次/月</span>
              <span>{{ detail.pkg.storageGb }} GB 存储</span>
              <span>员工 {{ detail.pkg.maxStaff }} 人</span>
              <span>并发 {{ detail.pkg.maxConcurrent }}</span>
            </div>
          </div>
          <p class="f-hint" style="margin: 0 0 16px">
            以下开关与配额为该机构的实际生效值（继承自套餐，可单独调整）；关闭后机构端对应菜单即刻隐藏。
          </p>

          <h4 class="section-title">功能开关</h4>
          <div class="switch-grid">
            <div v-for="feature in FEATURE_META" :key="feature.key" class="switch-item">
              <div class="switch-text">
                <b>{{ feature.label }}</b>
                <span>{{ feature.desc }}</span>
              </div>
              <!-- 只读态用标签而不是禁用态的 AppSwitch：后者的 .disabled 是整体 opacity: .5，
                   会把「已开启」的品牌色一并灰掉，看起来像坏掉的控件，而只读要的是陈述事实 -->
              <AppSwitch v-if="editingFeature" v-model="featureForm.switches[feature.key]" />
              <span
                v-else
                class="tag"
                :class="featureForm.switches[feature.key] ? 'tag-green' : 'tag-gray'"
              >
                {{ featureForm.switches[feature.key] ? '已开启' : '已关闭' }}
              </span>
            </div>
          </div>

          <h4 class="section-title" style="margin-top: 22px">资源配额</h4>
          <!-- 只读态：四项配额正好两行，不必再套 .form-grid 的字段间距 -->
          <div v-if="!editingFeature" class="detail-grid">
            <div class="detail-item">
              <div class="d-label">AI 月度额度（次）</div>
              <div class="d-value">{{ featureForm.quotas.aiQuota.toLocaleString('zh-CN') }}</div>
            </div>
            <div class="detail-item">
              <div class="d-label">存储空间（GB）</div>
              <div class="d-value">{{ featureForm.quotas.storageGb }}</div>
            </div>
            <div class="detail-item">
              <div class="d-label">最大员工数</div>
              <div class="d-value">{{ featureForm.quotas.maxStaff }}</div>
            </div>
            <div class="detail-item">
              <div class="d-label">AI 并发上限</div>
              <div class="d-value">{{ featureForm.quotas.maxConcurrent }}</div>
            </div>
          </div>
          <div v-else class="form-grid">
            <div class="f-field">
              <label class="f-label">AI 月度额度（次）</label>
              <input v-model.number="featureForm.quotas.aiQuota" class="f-input" type="number" min="0" />
            </div>
            <div class="f-field">
              <label class="f-label">存储空间（GB）</label>
              <input v-model.number="featureForm.quotas.storageGb" class="f-input" type="number" min="0" />
            </div>
            <div class="f-field">
              <label class="f-label">最大员工数</label>
              <input v-model.number="featureForm.quotas.maxStaff" class="f-input" type="number" min="1" />
            </div>
            <div class="f-field">
              <label class="f-label">AI 并发上限</label>
              <input v-model.number="featureForm.quotas.maxConcurrent" class="f-input" type="number" min="1" />
            </div>
          </div>
          <div class="form-actions">
            <button v-if="!editingFeature" class="btn btn-primary btn-sm" @click="editingFeature = true">编辑</button>
            <div v-else class="op-group">
              <button class="btn btn-ghost btn-sm" :disabled="saving" @click="cancelFeature">取消</button>
              <button class="btn btn-primary btn-sm" :disabled="saving" @click="saveFeature">
                {{ saving ? '保存中…' : '保存' }}
              </button>
            </div>
          </div>
        </section>

        <!-- Tab 3 数据隔离 -->
        <section v-else-if="activeTab === 'isolation'" class="isolation-body">
          <div class="iso-cards">
            <!-- 只读态仍保留 .active 高亮（要看出当前生效的是哪一种），但不给点。
                 不复用 .disabled：它带较低的不透明度，会把选中卡片也一起洗白 -->
            <button
              class="iso-card"
              :class="{
                active: isolationForm.isolationType === 1,
                readonly: !editingIsolation,
                disabled: editingIsolation && !within24h,
              }"
              type="button"
              @click="editingIsolation && within24h && (isolationForm.isolationType = 1)"
            >
              <div class="iso-icon"><AppIcon name="grid" :size="22" /></div>
              <b>标准隔离（共享库 + 租户ID）</b>
              <p>同一数据库实例，按 tenant_id 行级隔离。适合绝大多数机构，成本低、开通快。</p>
            </button>
            <button
              class="iso-card"
              :class="{
                active: isolationForm.isolationType === 2,
                readonly: !editingIsolation,
                disabled: editingIsolation && !within24h,
              }"
              type="button"
              @click="editingIsolation && within24h && (isolationForm.isolationType = 2)"
            >
              <div class="iso-icon"><AppIcon name="shield" :size="22" /></div>
              <b>专属数据库（独立实例）</b>
              <p>独立数据库实例，数据物理隔离。适合有合规要求的大型机构。</p>
            </button>
          </div>

          <div v-if="!editingIsolation" class="detail-grid" style="margin-top: 18px">
            <div class="detail-item">
              <div class="d-label">存储区域</div>
              <div class="d-value">{{ isolationForm.storageRegion || '—' }}</div>
            </div>
          </div>
          <div v-else class="form-grid" style="margin-top: 18px">
            <div class="f-field">
              <label class="f-label">存储区域</label>
              <select v-model="isolationForm.storageRegion" class="f-select" :disabled="!within24h">
                <option v-for="region in REGIONS" :key="region" :value="region">{{ region }}</option>
              </select>
            </div>
          </div>

          <div v-if="!within24h" class="iso-lock">
            <AppIcon name="clock" :size="15" />
            机构创建超过 24 小时后，隔离策略变更需平台技术支持执行数据迁移，如有需要请提交工单。
          </div>

          <!-- 超过 24h 干脆不给「编辑」：点进去整屏控件全是禁用态，是个没有出口的死状态 -->
          <div class="form-actions">
            <button v-if="!within24h" class="btn btn-ghost btn-sm" disabled>
              隔离策略已锁定（创建超 24h）
            </button>
            <button v-else-if="!editingIsolation" class="btn btn-primary btn-sm" @click="editingIsolation = true">
              编辑
            </button>
            <div v-else class="op-group">
              <button class="btn btn-ghost btn-sm" :disabled="saving" @click="cancelIsolation">取消</button>
              <button class="btn btn-primary btn-sm" :disabled="saving || !within24h" @click="saveIsolation">
                {{ saving ? '保存中…' : '保存' }}
              </button>
            </div>
          </div>
        </section>

        <!-- Tab 4 数据统计（只读） -->
        <section v-else-if="activeTab === 'stats'">
          <div class="stats-row">
            <div class="panel stat">
              <span>题目总数</span>
              <b>{{ detail.stats.questionCount.toLocaleString('zh-CN') }}</b>
            </div>
            <div class="panel stat">
              <span>试卷总数</span>
              <b>{{ detail.stats.paperCount.toLocaleString('zh-CN') }}</b>
            </div>
            <div class="panel stat">
              <span>教辅资源</span>
              <b>{{ detail.stats.materialCount.toLocaleString('zh-CN') }}</b>
            </div>
            <div class="panel stat">
              <span>员工账号</span>
              <b>{{ detail.stats.staffCount.toLocaleString('zh-CN') }}</b>
            </div>
          </div>

          <div class="panel" style="padding: 18px 20px 8px; margin-top: 14px">
            <div class="chart-head">
              <h4 class="section-title" style="margin: 0">{{ aiChart.title }}</h4>
              <div class="chart-ops">
                <!-- 月份日历只在「本月」这种按天的粒度下出现：半年视图本来就摊着 6 个月，
                     再给一个「看哪个月」的选择器会让人以为它能改变那 6 根柱子。
                     有数据的月份在日历里带品牌淡底，标色写在 main.css 的 .ai-month-popper
                     （日历面板 teleport 到 body，scoped 样式够不着） -->
                <div v-if="aiRange === 'month'" class="chart-picker">
                  <el-date-picker
                    v-model="aiMonth"
                    type="month"
                    value-format="YYYY-MM"
                    :clearable="false"
                    :cell-class-name="aiMonthCellClass"
                    popper-class="ai-month-popper"
                    placeholder="选择月份"
                  />
                </div>
                <AppSegmented
                  :options="AI_RANGES"
                  :model-value="aiRange"
                  @update:model-value="setAiRange"
                />
                <button class="btn btn-ghost btn-sm" @click="onExport">
                  <AppIcon name="download" :size="14" /> 导出报表
                </button>
              </div>
            </div>
            <BarChart :labels="aiChart.labels" :values="aiChart.values" :height="240" />
          </div>
        </section>
      </div>
    </div>
  </div>

  <div v-else class="panel loading-panel">加载中…</div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 18px 22px;
  margin-bottom: 14px;
}
.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: #f2f4fa;
  color: var(--ink-2);
  font-size: 13px;
  font-weight: 600;
  padding: 8px 12px;
  border-radius: 9px;
  transition: background 0.15s, color 0.15s;
}
.back-btn:hover { background: #e8ecf4; color: var(--ink); }
.org-logo {
  width: 52px;
  height: 52px;
  border-radius: 14px;
  color: #fff;
  font-size: 22px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.head-meta { flex: 1; min-width: 0; }
.head-title { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.head-title h2 { font-size: 18px; font-weight: 700; }
.head-sub { font-size: 12.5px; color: var(--sub); margin-top: 5px; }
.disabled-reason { color: var(--danger); }
.head-facts { display: flex; align-items: center; gap: 26px; }
.fact { text-align: right; }
.fact span { display: block; font-size: 11.5px; color: var(--sub); margin-bottom: 3px; }
.fact b { font-size: 16px; }
.fact b.warn { color: var(--warn); }
.fact b.danger { color: var(--danger); }

/* 标签条交给 AppTabs（自带下划线样式与 align-items: center） */
.tabs-wrap { padding: 10px 18px 0; }

.tab-body { padding: 8px 22px 22px; }

.form-col { max-width: 640px; }
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 20px;
}
/* 机构地址独占一行：地址本来长，挤在半栏里放不下；顺带把字段数凑成
   「名称|城市 / 地址 / 联系人|电话」三行，不留半格空位 */
.form-grid .span-2 { grid-column: span 2; }
/* 只读态。`.detail-grid` 是 main.css 的全局类，自带两列网格、不带跨度规则，
   跨度得由使用方自己加。与上面那条刻意分开写：选择的容器不同，
   合并成一个选择器会让只读网格里的描述项跟着 .form-grid 的规则走 */
.detail-grid .span-2 { grid-column: span 2; }
/* 机构简介这类多行文本：别跟着 .d-value 的字重一起加粗，行距也放宽一点 */
.detail-grid .d-value.multi {
  font-weight: 400;
  color: var(--ink-2);
  line-height: 1.7;
  white-space: pre-wrap;
}
.stage-row { display: flex; align-items: center; gap: 8px; }
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
.form-actions { padding-top: 4px; }

/* 一个分类一块：小标题 + 该分类下的文件。间距放在 .cert-block 上，
   .cert-list 自己不再带下边距（否则每块底部会多出一截） */
.cert-block { margin-bottom: 14px; }
.cert-block-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--sub);
  margin-bottom: 7px;
}
.cert-list { display: flex; flex-direction: column; gap: 8px; }
.cert-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  border: 1.5px dashed var(--border);
  border-radius: 10px;
  background: #fff;
  padding: 12px 14px;
  color: var(--ink-2);
  text-align: left;
  transition: border-color 0.15s, background 0.15s;
}
.cert-item:hover { border-color: var(--brand); background: var(--brand-soft); }
.cert-item > :first-child { color: var(--brand); }
.cert-name { flex: 1; font-size: 13.5px; font-weight: 500; }
.cert-act { font-size: 12.5px; color: var(--brand); font-weight: 600; }
.cert-empty {
  font-size: 13px;
  color: var(--sub);
  background: #f8fafd;
  border-radius: 10px;
  padding: 14px;
  text-align: center;
}

.pkg-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  background: linear-gradient(135deg, var(--brand-soft), rgba(123, 92, 240, 0.07));
  border-radius: 12px;
  padding: 14px 18px;
  margin-bottom: 14px;
}
.pkg-left { display: flex; align-items: center; gap: 10px; }
.pkg-left b { font-size: 15px; }
.pkg-price { font-size: 12.5px; color: var(--sub); }
.pkg-facts { display: flex; align-items: center; gap: 16px; font-size: 12.5px; color: var(--ink-2); flex-wrap: wrap; }

.switch-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.switch-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid var(--border);
  border-radius: 11px;
  padding: 13px 15px;
  background: #fff;
  transition: border-color 0.15s;
}
.switch-item:hover { border-color: #c9d2e6; }
.switch-text { display: flex; flex-direction: column; gap: 3px; }
.switch-text b { font-size: 13.5px; color: var(--ink); }
.switch-text span { font-size: 12px; color: var(--sub); }

.isolation-body { max-width: 720px; }
.iso-cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.iso-card {
  text-align: left;
  border: 1.5px solid var(--border);
  border-radius: 12px;
  background: #fff;
  padding: 16px 18px;
  transition: border-color 0.15s, background 0.15s;
}
.iso-card b { display: block; font-size: 14px; margin: 10px 0 6px; color: var(--ink); }
.iso-card p { font-size: 12.5px; color: var(--sub); line-height: 1.6; }
.iso-card.active { border-color: var(--brand); background: var(--brand-soft); }
.iso-card.active .iso-icon { color: #fff; background: var(--brand-grad); }
.iso-card.disabled { opacity: 0.55; cursor: not-allowed; }
/* 只读态：卡片照常显示、保留 .active 高亮（要看得出当前生效的是哪一种），只是不给点。
   cursor 必须显式退回 default —— main.css 有全局的 `button { cursor: pointer }`，
   而这时卡片是点不动的；也不能复用 .disabled，它的 opacity 会把选中卡一起洗白 */
.iso-card.readonly { cursor: default; }
.iso-icon {
  width: 40px;
  height: 40px;
  border-radius: 11px;
  background: #f2f4fa;
  color: var(--ink-2);
  display: flex;
  align-items: center;
  justify-content: center;
}
.iso-lock {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--warn-soft);
  color: var(--warn);
  font-size: 12.5px;
  border-radius: 10px;
  padding: 11px 14px;
  margin: 4px 0 14px;
}

.stats-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.stat { padding: 16px 18px; }
.stat span { font-size: 12px; color: var(--sub); display: block; margin-bottom: 6px; }
.stat b { font-size: 22px; }

.chart-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.chart-ops { display: flex; align-items: center; gap: 8px; }
/* 图表头里的月份选择器。两层写法都是必须的：
   宽度 —— `.el-date-editor` 把 `--el-date-editor-width: 220px` 声明在**元素自己身上**，从祖先赋值
     传不下去（与 TenantListView 的 .range-picker 同一个坑），只能外层定宽 + :deep() 提权重压成 100%；
   配色 —— 它同样在自身上声明了一整套 --el-input-*，所以覆盖的是这些令牌本身。
   --el-component-size 定高 32px，与旁边的 AppSegmented、导出按钮齐平。 */
.chart-picker {
  width: 130px;
  flex-shrink: 0;
  --el-component-size: 32px;
}
.chart-picker :deep(.el-date-editor) {
  width: 100%;
  --el-input-border-color: var(--border);
  --el-input-hover-border-color: #c9d2e6;
  --el-input-focus-border-color: var(--brand);
  --el-input-text-color: var(--ink);
  --el-input-placeholder-color: var(--sub);
  --el-input-icon-color: var(--sub);
}

.loading-panel { text-align: center; color: var(--sub); padding: 60px 0; font-size: 13px; }
</style>
