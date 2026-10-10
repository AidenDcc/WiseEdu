<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import {
  AppDrawer,
  AppFilterPanel,
  AppIcon,
  AppListToolbar,
  AppModal,
  ApiError,
  CERT_CATEGORIES,
  CERT_CATEGORY_TEXT,
  showToast,
} from '@aiteach/shared'
import type { FilterRowDef, PackageRecord, TenantApply } from '@aiteach/shared'
import AppPagination from '@/components/ui/AppPagination.vue'
import { useAuthStore } from '@/stores/auth'
import { approveApply, fetchApplies, fetchPackages, rejectApply } from '@/api/tenant'

/* ===== 列表 ===== */
const ORG_TYPES = ['公立学校', '民办学校', '培训机构', '其他']
const STATUS_OPTIONS = ['待审核', '已通过', '已驳回']
const STAGES = ['小学', '初中', '高中']

/* 联系人是本页唯一「不是 chip」的条件：控件是文本框，由 #extra 插槽画。
   行定义里仍然登记它（`custom: true`），面板据此把它算进折叠摘要、也据此清空它 ——
   否则折叠起来就看不见这个条件，也永远清不掉。 */
const CONTACT_KEY = 'contact'
const CONTACT_LABEL = '联系人'

const FILTER_ROWS: FilterRowDef[] = [
  { key: 'status', label: '状态', options: STATUS_OPTIONS, multiple: false },
  { key: 'orgType', label: '类型', options: ORG_TYPES, multiple: false },
  { key: 'stages', label: '学段', options: STAGES, multiple: true },
  { key: CONTACT_KEY, label: CONTACT_LABEL, options: [], custom: true },
]

const FILTERS = reactive<Record<string, string[]>>({ status: [], orgType: [], stages: [] })

/* AppFilterPanel 回传整份筛选值（覆盖式回写），逐 key 写回这份 reactive 对象本身。
   不能交给 `v-model`：它会替换掉整个对象，而替换引用不是一次响应式写入 ——
   下面那句 `watch(FILTERS, search, { deep: true })` 就永远不会触发。
   机构端 CollabView 里有同款说明。 */
function onFiltersChange(next: Record<string, string[]>) {
  FILTERS.status = next.status ?? []
  FILTERS.orgType = next.orgType ?? []
  FILTERS.stages = next.stages ?? []
  /* 联系人这一行没有 chip，面板只可能在「清空」时给出空数组 */
  if (!next[CONTACT_KEY]?.length) contact.value = ''
}
const keyword = ref('')
/** 联系人姓名（模糊查询）。单独一个 ref，与 FILTERS 合并进同一个 watcher */
const contact = ref('')

/* 交给面板的筛选值：在 FILTERS 之上补一个只读的 contact 项，值就是折叠时要显示的那行字。
   单向派生（不是第二份状态）—— 输入仍只存在 contact 里，这里只是把它的展示文案
   翻译成面板认识的样子。 */
const panelValue = computed<Record<string, string[]>>(() => ({
  ...FILTERS,
  [CONTACT_KEY]: contact.value.trim() ? [contact.value.trim()] : [],
}))

const page = ref(1)
const pageSize = 10
const total = ref(0)
const list = ref<TenantApply[]>([])
const loading = ref(false)
const packages = ref<PackageRecord[]>([])
const auth = useAuthStore()

/** 审核留痕里的操作人：取当前登录管理员的姓名（mock 的 admin 账号 = 「平台运营」） */
function reviewerName() {
  return auth.user?.name ?? ''
}

async function load() {
  loading.value = true
  try {
    const result = await fetchApplies({
      status: FILTERS.status[0] ?? '',
      orgType: FILTERS.orgType[0] ?? '',
      /* 学段是多选，先 join 成逗号串再交给接口（withQuery 会 String(value)） */
      stages: FILTERS.stages.join(','),
      contact: contact.value.trim(),
      keyword: keyword.value.trim(),
      page: page.value,
      pageSize,
    })
    list.value = result.list
    total.value = result.total
  } finally {
    loading.value = false
  }
}

/* 加分页后，每个筛选 / 关键词变化都要把页码归 1，否则停在第 3 页时会显示空列表 */
function search() {
  page.value = 1
  load()
}

/* 筛选条件 / 关键词 / 联系人变化即重新查询（原来是点「查询」按钮）。
   三个源合成一个 watcher：面板的「清空」会同时改 FILTERS 和 contact，
   拆成两个 watcher 就是两次内容相同的请求。 */
watch([FILTERS, keyword, contact], search, { deep: true })

function statusTag(status: TenantApply['status']) {
  return status === '待审核' ? 'tag-blue' : status === '已通过' ? 'tag-green' : 'tag-red'
}

function fmtTime(time: string) {
  return time.slice(0, 16)
}

/** 联系电话中间四位脱密：列表是「一眼扫过」的场景，完整号码只留在详情里（详情不脱敏） */
function maskPhone(phone: string) {
  return phone.length >= 7 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : phone
}

/* ===== 审核详情抽屉 ===== */
const detail = ref<TenantApply | null>(null)

/* ===== 通过弹窗（FR-PT-006：开通配置） ===== */
const approveTarget = ref<TenantApply | null>(null)
const approveForm = reactive({
  trialDays: 14,
  packageId: 2,
  adminAccount: '',
})
const approveError = ref('')
const approving = ref(false)

function openApprove(apply: TenantApply) {
  approveTarget.value = apply
  approveForm.trialDays = 14
  approveForm.packageId = packages.value.find((p) => p.name === '标准版')?.id ?? packages.value[0]?.id ?? 0
  approveForm.adminAccount = apply.phone
  approveError.value = ''
}

async function confirmApprove() {
  if (!approveTarget.value) return
  if (!Number.isInteger(approveForm.trialDays) || approveForm.trialDays < 1 || approveForm.trialDays > 90) {
    approveError.value = '试用天数须为 1-90 的整数'
    return
  }
  if (!approveForm.adminAccount.trim()) {
    approveError.value = '初始管理员账号不能为空'
    return
  }
  approving.value = true
  try {
    const result = await approveApply(approveTarget.value.id, {
      ...approveForm,
      reviewer: reviewerName(),
    })
    showToast(`已开通租户「${result.tenantName}」，初始密码已短信发送至联系人`, 'success')
    approveTarget.value = null
    load()
  } catch (error) {
    approveError.value = error instanceof ApiError ? error.message : '操作失败，请重试'
  } finally {
    approving.value = false
  }
}

/* ===== 驳回弹窗（FR-PT-007：必填原因） ===== */
const rejectTarget = ref<TenantApply | null>(null)
const rejectReason = ref('')
const rejectError = ref('')
const rejecting = ref(false)

function openReject(apply: TenantApply) {
  rejectTarget.value = apply
  rejectReason.value = ''
  rejectError.value = ''
}

async function confirmReject() {
  if (!rejectTarget.value) return
  const reason = rejectReason.value.trim()
  if (reason.length < 5 || reason.length > 200) {
    rejectError.value = `驳回原因须为 5-200 字（当前 ${reason.length} 字）`
    return
  }
  rejecting.value = true
  try {
    await rejectApply(rejectTarget.value.id, reason, reviewerName())
    showToast('已驳回该入驻申请', 'success')
    rejectTarget.value = null
    load()
  } catch (error) {
    rejectError.value = error instanceof ApiError ? error.message : '操作失败，请重试'
  } finally {
    rejecting.value = false
  }
}

function previewFile(name: string) {
  showToast(`演示环境：在线预览「${name}」`, 'info')
}

/* 资质材料按提交时的分类分组（营业执照 / 许可证 / 法人信息），空分类不占位置 */
const certGroups = computed(() => {
  const files = detail.value?.certFiles ?? []
  return CERT_CATEGORIES.map((category) => ({
    category,
    label: CERT_CATEGORY_TEXT[category],
    files: files.filter((file) => file.category === category),
  })).filter((group) => group.files.length > 0)
})

onMounted(async () => {
  load()
  packages.value = await fetchPackages()
})
</script>

<template>
  <div class="page">
    <!-- 搜索条件：独立面板，与下方列表分开（对齐机构端列表页布局） -->
    <AppFilterPanel :rows="FILTER_ROWS" :model-value="panelValue" @update:model-value="onFiltersChange">
      <template #extra>
        <div class="contact-row">
          <span class="contact-label">{{ CONTACT_LABEL }}</span>
          <input v-model="contact" class="f-input" placeholder="姓名，支持模糊查询" />
        </div>
      </template>
    </AppFilterPanel>

    <!-- 列表 -->
    <div class="panel">
      <AppListToolbar v-model="keyword" placeholder="机构名称 / 机构编号" :search-width="220" />

      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>机构编号</th>
              <th>机构名称</th>
              <th>类型</th>
              <th>学段</th>
              <th>联系人</th>
              <th>联系电话</th>
              <th>提交时间</th>
              <th>审核时间</th>
              <th>状态</th>
              <th style="width: 170px">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading && list.length === 0">
              <td colspan="10" class="empty-row">加载中…</td>
            </tr>
            <tr v-else-if="list.length === 0">
              <td colspan="10" class="empty-row">暂无符合条件的入驻申请</td>
            </tr>
            <template v-else>
              <tr v-for="item in list" :key="item.id">
              <td class="cell-strong">{{ item.code }}</td>
              <td>
                <div class="org-cell">
                  <span class="org-name">{{ item.orgName }}</span>
                  <span
                    v-if="item.status === '待审核' && item.waitingHours > 48"
                    class="tag tag-orange"
                    title="超 48h 未处理"
                  >超时</span>
                </div>
              </td>
              <td>{{ item.orgType }}</td>
              <td>{{ item.stages.join(' / ') }}</td>
              <td>{{ item.contact }}</td>
              <td>{{ maskPhone(item.phone) }}</td>
              <td>{{ fmtTime(item.submittedAt) }}</td>
              <td>{{ item.reviewedAt ? fmtTime(item.reviewedAt) : '—' }}</td>
              <td>
                <span class="tag" :class="statusTag(item.status)">{{ item.status }}</span>
              </td>
              <td>
                <div class="op-group">
                  <button class="mini-btn" type="button" @click="detail = item">查看</button>
                  <template v-if="item.status === '待审核'">
                    <button class="mini-btn success" type="button" @click="openApprove(item)">通过</button>
                    <button class="mini-btn danger" type="button" @click="openReject(item)">驳回</button>
                  </template>
                </div>
              </td>
            </tr>
            </template>
          </tbody>
        </table>
      </div>

      <AppPagination :total="total" :page="page" :page-size="pageSize" @update:page="page = $event; load()" />
    </div>

    <!-- 审核详情抽屉 -->
    <AppDrawer
      v-if="detail"
      :title="detail.orgName"
      :subtitle="`机构编号 ${detail.code}`"
      @close="detail = null"
    >
      <div class="detail-grid" style="margin-bottom: 20px">
        <div class="detail-item">
          <div class="d-label">机构类型</div>
          <div class="d-value">{{ detail.orgType }}</div>
        </div>
        <div class="detail-item">
          <div class="d-label">覆盖学段</div>
          <div class="d-value">{{ detail.stages.join(' / ') }}</div>
        </div>
        <div class="detail-item">
          <div class="d-label">所在地区</div>
          <div class="d-value">{{ detail.city || '—' }}</div>
        </div>
        <div class="detail-item">
          <div class="d-label">联系人</div>
          <div class="d-value">{{ detail.contact }}</div>
        </div>
        <div class="detail-item">
          <div class="d-label">联系电话</div>
          <div class="d-value">{{ detail.phone }}</div>
        </div>
        <div class="detail-item">
          <div class="d-label">电子邮箱</div>
          <div class="d-value">{{ detail.email || '—' }}</div>
        </div>
        <!-- 地址独占一行：门牌级地址比半栏宽，挤在两列里会折得很难看。
            紧随其后的「提交时间」也一并占整行，否则会在它后面留出半格空位 -->
        <div class="detail-item span-2">
          <div class="d-label">机构地址</div>
          <div class="d-value">{{ detail.address || '—' }}</div>
        </div>
        <div class="detail-item span-2">
          <div class="d-label">提交时间</div>
          <div class="d-value">{{ fmtTime(detail.submittedAt) }}</div>
        </div>
      </div>

      <h4 class="section-title">机构简介</h4>
      <p class="intro">{{ detail.intro || '未填写' }}</p>

      <h4 class="section-title" style="margin-top: 22px">资质材料</h4>
      <p v-if="certGroups.length === 0" class="cert-empty">该申请未上传资质材料</p>
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

      <template v-if="detail.status !== '待审核'">
        <h4 class="section-title" style="margin-top: 22px">审核结果</h4>
        <div class="result-banner" :class="detail.status === '已通过' ? 'ok' : 'no'">
          <AppIcon :name="detail.status === '已通过' ? 'check' : 'close'" :size="16" />
          <div>
            <b>{{ detail.status }}</b>
            <p v-if="detail.rejectReason">{{ detail.rejectReason }}</p>
            <p v-else>已开通租户并短信通知联系人。</p>
            <!-- 审核留痕：谁在什么时候处理的 -->
            <p class="result-meta">
              审核时间：{{ detail.reviewedAt ? fmtTime(detail.reviewedAt) : '—' }}
              · 操作人：{{ detail.reviewer || '—' }}
            </p>
          </div>
        </div>
      </template>

      <!-- 只留「驳回 / 通过并开通」两个动作；关闭走抽屉右上角自带的 icon，
           已审核的申请没有可执行动作，整块 footer 不渲染（空 slot 会留一条空栏） -->
      <template v-if="detail.status === '待审核'" #footer>
        <button class="btn btn-ghost" style="flex: 1" @click="openReject(detail); detail = null">驳回</button>
        <button class="btn btn-primary" style="flex: 1" @click="openApprove(detail); detail = null">通过并开通</button>
      </template>
    </AppDrawer>

    <!-- 通过弹窗 -->
    <AppModal
      v-if="approveTarget"
      title="通过入驻申请"
      :close-on-mask="false"
      @close="approveTarget = null"
    >
      <p class="modal-tip">
        即将为「{{ approveTarget.orgName }}」开通租户，以下参数可在机构详情中随时调整。
      </p>
      <div class="f-field">
        <label class="f-label">试用天数<span class="req">*</span></label>
        <input v-model.number="approveForm.trialDays" class="f-input" type="number" min="1" max="90" />
        <p class="f-hint">范围 1-90 天，默认 14 天，试用期结束前可转正式或续费。</p>
      </div>
      <div class="f-field">
        <label class="f-label">初始套餐<span class="req">*</span></label>
        <select v-model="approveForm.packageId" class="f-select">
          <option v-for="pkg in packages" :key="pkg.id" :value="pkg.id">
            {{ pkg.name }}（AI {{ pkg.aiQuota.toLocaleString('zh-CN') }} 次/月 · ¥{{ pkg.monthlyPrice }}/月）
          </option>
        </select>
      </div>
      <div class="f-field">
        <label class="f-label">初始管理员账号<span class="req">*</span></label>
        <input v-model="approveForm.adminAccount" class="f-input" placeholder="默认使用联系人手机号" />
        <p class="f-hint">开通后系统将以短信形式发送初始密码。</p>
      </div>
      <p v-if="approveError" class="f-err">{{ approveError }}</p>
      <template #footer>
        <button class="btn btn-ghost btn-sm" @click="approveTarget = null">取消</button>
        <button class="btn btn-primary btn-sm" :disabled="approving" @click="confirmApprove">
          {{ approving ? '开通中…' : '确认开通' }}
        </button>
      </template>
    </AppModal>

    <!-- 驳回弹窗 -->
    <AppModal
      v-if="rejectTarget"
      title="驳回入驻申请"
      :close-on-mask="false"
      @close="rejectTarget = null"
    >
      <p class="modal-tip">
        驳回「{{ rejectTarget.orgName }}」的入驻申请，原因将以短信和邮件通知联系人。
      </p>
      <div class="f-field">
        <label class="f-label">驳回原因<span class="req">*</span></label>
        <textarea
          v-model="rejectReason"
          class="f-textarea"
          maxlength="200"
          placeholder="请说明驳回原因，如资质材料不完整、信息填写有误等（5-200 字）"
        />
        <p class="f-hint">{{ rejectReason.trim().length }} / 200 字</p>
      </div>
      <p v-if="rejectError" class="f-err">{{ rejectError }}</p>
      <template #footer>
        <button class="btn btn-ghost btn-sm" @click="rejectTarget = null">取消</button>
        <button class="btn btn-danger btn-sm" :disabled="rejecting" @click="confirmReject">
          {{ rejecting ? '提交中…' : '确认驳回' }}
        </button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
/* 联系人这一行的节奏对齐面板里其他 chip 行（标签左对齐 + 控件跟在其后），
   标签宽度与 TenantListView 的 .range-label 一致，两页看起来是一套 */
.contact-row { display: flex; align-items: center; gap: 12px; }
.contact-label {
  width: 58px;
  flex-shrink: 0;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--sub);
}
.contact-row .f-input { width: 220px; flex-shrink: 0; }

/* 详情抽屉里让「机构地址 / 提交时间」独占一行。.detail-grid 是全局类（main.css），
   它只定义了两列网格、不带 span 规则，所以跨度得由使用方自己加 */
.detail-grid .span-2 { grid-column: span 2; }

/* 筛选面板已是列表面板的兄弟节点（自带边框圆角），工具条顶部留白由它自己给 */
.panel > :deep(.list-toolbar) { padding: 14px 14px 0; }

.org-cell { display: flex; align-items: center; gap: 6px; }
.org-name { color: var(--ink); font-weight: 600; }

.intro {
  font-size: 13.5px;
  color: var(--ink-2);
  line-height: 1.7;
  background: #f8fafd;
  border-radius: 10px;
  padding: 12px 14px;
}

/* 分类小标题 + 该分类下的文件；间距放 .cert-block，.cert-list 自己不带 */
.cert-block { margin-bottom: 14px; }
.cert-block-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--sub);
  margin-bottom: 7px;
}
.cert-list { display: flex; flex-direction: column; gap: 8px; }
.cert-empty {
  font-size: 13px;
  color: var(--sub);
  background: #f8fafd;
  border-radius: 10px;
  padding: 14px;
  text-align: center;
}
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

.result-banner {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  border-radius: 10px;
  padding: 14px 16px;
  font-size: 13.5px;
}
.result-banner.ok { background: var(--success-soft); color: var(--success); }
.result-banner.no { background: var(--danger-soft); color: var(--danger); }
.result-banner p { color: var(--ink-2); margin-top: 4px; line-height: 1.6; }
/* 审核留痕比正文弱一档，不抢「审核结果」的视线 */
.result-banner .result-meta { font-size: 12.5px; color: var(--sub); }

.modal-tip {
  font-size: 13px;
  color: var(--ink-2);
  background: #f8fafd;
  border-radius: 10px;
  padding: 11px 14px;
  margin-bottom: 16px;
  line-height: 1.6;
}
.f-err { font-size: 12px; color: var(--danger); margin: 2px 0 4px; }
</style>
