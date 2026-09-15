<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AppIcon,
  BarChart,
  hueColor,
  showToast,
  ApiError,
} from '@aiteach/shared'
import type { FeatureSwitches, PackageRecord, TenantDetailModel } from '@aiteach/shared'
import AppSwitch from '@/components/ui/AppSwitch.vue'
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
  city: '',
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

const within24h = computed(() => {
  if (!detail.value) return false
  return (Date.now() - new Date(detail.value.tenant.createdAt).getTime()) / 3600_000 <= 24
})

const usageRatio = computed(() => {
  if (!detail.value) return 0
  const { aiUsed, quotas } = detail.value.tenant
  return quotas.aiQuota ? aiUsed / quotas.aiQuota : 0
})

async function load() {
  detail.value = await fetchTenantDetail(TENANT_ID)
  const { tenant, pkg } = detail.value
  baseForm.name = tenant.name
  baseForm.contact = tenant.contact
  baseForm.phone = tenant.phone
  baseForm.city = tenant.city
  baseForm.intro = tenant.intro
  baseForm.stages = [...tenant.stages]
  featureForm.switches = { ...tenant.switches }
  featureForm.quotas = { ...tenant.quotas }
  currentPackageId.value = tenant.packageId
  isolationForm.isolationType = tenant.isolationType
  isolationForm.storageRegion = tenant.storageRegion
}

function toggleStage(stage: string) {
  const index = baseForm.stages.indexOf(stage)
  if (index >= 0) baseForm.stages.splice(index, 1)
  else baseForm.stages.push(stage)
}

function previewFile(name: string) {
  showToast(`演示环境：在线预览「${name}」`, 'info')
}

async function saveBase() {
  if (!baseForm.name.trim()) {
    showToast('机构名称不能为空', 'error')
    return
  }
  saving.value = true
  try {
    await updateTenantBase(TENANT_ID, { ...baseForm, stages: [...baseForm.stages] })
    showToast('基础信息已保存', 'success')
    load()
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
    load()
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
    load()
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
      <div class="tabs">
        <button
          v-for="tab in TABS"
          :key="tab.key"
          class="tab"
          :class="{ active: activeTab === tab.key }"
          type="button"
          @click="activeTab = tab.key"
        >
          {{ tab.label }}
        </button>
      </div>

      <div class="tab-body">
        <!-- Tab 1 基础信息 -->
        <section v-if="activeTab === 'base'" class="form-col">
          <div class="form-grid">
            <div class="f-field">
              <label class="f-label">机构名称<span class="req">*</span></label>
              <input v-model="baseForm.name" class="f-input" placeholder="机构全称" />
            </div>
            <div class="f-field">
              <label class="f-label">所在城市</label>
              <input v-model="baseForm.city" class="f-input" placeholder="如：浙江省杭州市" />
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

          <h4 class="section-title">资质材料</h4>
          <div class="cert-list">
            <button
              v-for="file in detail.tenant.certFiles"
              :key="file.name"
              class="cert-item"
              type="button"
              @click="previewFile(file.name)"
            >
              <AppIcon :name="file.type === 'pdf' ? 'file' : 'image'" :size="20" />
              <span class="cert-name">{{ file.name }}</span>
              <span class="cert-act">预览</span>
            </button>
            <p v-if="detail.tenant.certFiles.length === 0" class="cert-empty">该机构暂无资质档案</p>
          </div>

          <div class="form-actions">
            <button class="btn btn-primary btn-sm" :disabled="saving" @click="saveBase">
              {{ saving ? '保存中…' : '保存修改' }}
            </button>
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
              <AppSwitch v-model="featureForm.switches[feature.key]" />
            </div>
          </div>

          <h4 class="section-title" style="margin-top: 22px">资源配额</h4>
          <div class="form-grid">
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
            <button class="btn btn-primary btn-sm" :disabled="saving" @click="saveFeature">
              {{ saving ? '保存中…' : '保存权限配置' }}
            </button>
          </div>
        </section>

        <!-- Tab 3 数据隔离 -->
        <section v-else-if="activeTab === 'isolation'" class="isolation-body">
          <div class="iso-cards">
            <button
              class="iso-card"
              :class="{ active: isolationForm.isolationType === 1, disabled: !within24h }"
              type="button"
              @click="within24h && (isolationForm.isolationType = 1)"
            >
              <div class="iso-icon"><AppIcon name="grid" :size="22" /></div>
              <b>标准隔离（共享库 + 租户ID）</b>
              <p>同一数据库实例，按 tenant_id 行级隔离。适合绝大多数机构，成本低、开通快。</p>
            </button>
            <button
              class="iso-card"
              :class="{ active: isolationForm.isolationType === 2, disabled: !within24h }"
              type="button"
              @click="within24h && (isolationForm.isolationType = 2)"
            >
              <div class="iso-icon"><AppIcon name="shield" :size="22" /></div>
              <b>专属数据库（独立实例）</b>
              <p>独立数据库实例，数据物理隔离。适合有合规要求的大型机构。</p>
            </button>
          </div>

          <div class="form-grid" style="margin-top: 18px">
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

          <div class="form-actions">
            <button class="btn btn-primary btn-sm" :disabled="saving || !within24h" @click="saveIsolation">
              {{ saving ? '保存中…' : '保存隔离策略' }}
            </button>
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
              <h4 class="section-title" style="margin: 0">近 6 个月 AI 调用量（次）</h4>
              <button class="btn btn-ghost btn-sm" @click="onExport">
                <AppIcon name="download" :size="14" /> 导出报表
              </button>
            </div>
            <BarChart :labels="detail.aiMonthly.months" :values="detail.aiMonthly.calls" :height="240" />
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
.head-facts { display: flex; gap: 26px; }
.fact { text-align: right; }
.fact span { display: block; font-size: 11.5px; color: var(--sub); margin-bottom: 3px; }
.fact b { font-size: 16px; }
.fact b.warn { color: var(--warn); }
.fact b.danger { color: var(--danger); }

.tabs {
  display: flex;
  gap: 4px;
  padding: 10px 18px 0;
  border-bottom: 1px solid var(--border);
}
.tab {
  border: none;
  background: transparent;
  color: var(--ink-2);
  font-size: 14px;
  font-weight: 600;
  padding: 10px 16px 13px;
  border-bottom: 2.5px solid transparent;
  margin-bottom: -1px;
  transition: color 0.15s, border-color 0.15s;
}
.tab:hover { color: var(--ink); }
.tab.active { color: var(--brand); border-bottom-color: var(--brand); }

.tab-body { padding: 22px; }

.form-col { max-width: 640px; }
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 20px;
}
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
.form-actions { padding-top: 4px; }

.cert-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
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
.pkg-facts { display: flex; gap: 16px; font-size: 12.5px; color: var(--ink-2); flex-wrap: wrap; }

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
  margin-bottom: 12px;
}

.loading-panel { text-align: center; color: var(--sub); padding: 60px 0; font-size: 13px; }
</style>
