<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { AppIcon, showToast, ApiError } from '@aiteach/shared'
import type { PackageRecord, TenantApply } from '@aiteach/shared'
import AppDrawer from '@/components/ui/AppDrawer.vue'
import AppModal from '@/components/ui/AppModal.vue'
import { approveApply, fetchApplies, fetchPackages, rejectApply } from '@/api/tenant'

/* ===== 列表 ===== */
const ORG_TYPES = ['公立学校', '民办学校', '培训机构', '其他']
const filters = reactive({ status: '', orgType: '', keyword: '' })

const list = ref<TenantApply[]>([])
const loading = ref(false)
const packages = ref<PackageRecord[]>([])

async function load() {
  loading.value = true
  try {
    list.value = await fetchApplies({ ...filters })
  } finally {
    loading.value = false
  }
}

function resetFilters() {
  filters.status = ''
  filters.orgType = ''
  filters.keyword = ''
  load()
}

const pendingCount = computed(() => list.value.filter((item) => item.status === '待审核').length)
const overtimeCount = computed(
  () => list.value.filter((item) => item.status === '待审核' && item.waitingHours > 48).length,
)

function statusTag(status: TenantApply['status']) {
  return status === '待审核' ? 'tag-blue' : status === '已通过' ? 'tag-green' : 'tag-red'
}

function fmtTime(time: string) {
  return time.slice(0, 16)
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
    const result = await approveApply(approveTarget.value.id, { ...approveForm })
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
    await rejectApply(rejectTarget.value.id, reason)
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

onMounted(async () => {
  load()
  packages.value = await fetchPackages()
})
</script>

<template>
  <div>
    <!-- 统计条 -->
    <div class="head-row">
      <div class="panel head-card">
        <AppIcon name="clock" :size="18" />
        <div>
          <b>{{ pendingCount }}</b>
          <span>待审核</span>
        </div>
      </div>
      <div class="panel head-card warn" :class="{ muted: overtimeCount === 0 }">
        <AppIcon name="warning" :size="18" />
        <div>
          <b>{{ overtimeCount }}</b>
          <span>超 48h 未处理</span>
        </div>
      </div>
    </div>

    <!-- 列表 -->
    <div class="panel">
      <div class="filter-bar">
        <select v-model="filters.status" class="f-select" style="width: 130px" @change="load">
          <option value="">全部状态</option>
          <option value="待审核">待审核</option>
          <option value="已通过">已通过</option>
          <option value="已驳回">已驳回</option>
        </select>
        <select v-model="filters.orgType" class="f-select" style="width: 130px" @change="load">
          <option value="">全部类型</option>
          <option v-for="type in ORG_TYPES" :key="type" :value="type">{{ type }}</option>
        </select>
        <div class="search-box">
          <AppIcon name="search" :size="15" />
          <input
            v-model="filters.keyword"
            class="f-input"
            placeholder="机构名称 / 申请编号"
            @keyup.enter="load"
          />
        </div>
        <button class="btn btn-primary btn-sm" @click="load">查询</button>
        <button class="btn btn-ghost btn-sm" @click="resetFilters">重置</button>
      </div>

      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>申请编号</th>
              <th>机构名称</th>
              <th>类型</th>
              <th>学段</th>
              <th>联系人</th>
              <th>联系电话</th>
              <th>提交时间</th>
              <th>状态</th>
              <th style="width: 170px">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading && list.length === 0">
              <td colspan="9" class="empty-row">加载中…</td>
            </tr>
            <tr v-else-if="list.length === 0">
              <td colspan="9" class="empty-row">暂无符合条件的入驻申请</td>
            </tr>
            <template v-else>
              <tr v-for="item in list" :key="item.id">
              <td class="cell-strong">{{ item.applyNo }}</td>
              <td>
                <div class="org-cell">
                  <span class="org-name">{{ item.orgName }}</span>
                  <span v-if="item.status === '待审核' && item.waitingHours > 48" class="tag tag-orange">超时</span>
                </div>
              </td>
              <td>{{ item.orgType }}</td>
              <td>{{ item.stages.join(' / ') }}</td>
              <td>{{ item.contact }}</td>
              <td>{{ item.phone }}</td>
              <td>{{ fmtTime(item.submittedAt) }}</td>
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
    </div>

    <!-- 审核详情抽屉 -->
    <AppDrawer
      v-if="detail"
      :title="detail.orgName"
      :subtitle="`申请编号 ${detail.applyNo}`"
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
        <div class="detail-item">
          <div class="d-label">提交时间</div>
          <div class="d-value">{{ fmtTime(detail.submittedAt) }}</div>
        </div>
      </div>

      <h4 class="section-title">机构简介</h4>
      <p class="intro">{{ detail.intro || '未填写' }}</p>

      <h4 class="section-title" style="margin-top: 22px">资质材料</h4>
      <div class="cert-list">
        <p v-if="detail.certFiles.length === 0" class="cert-empty">
          该申请未上传资质材料
        </p>
        <button
          v-for="file in detail.certFiles"
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

      <template v-if="detail.status !== '待审核'">
        <h4 class="section-title" style="margin-top: 22px">审核结果</h4>
        <div class="result-banner" :class="detail.status === '已通过' ? 'ok' : 'no'">
          <AppIcon :name="detail.status === '已通过' ? 'check' : 'close'" :size="16" />
          <div>
            <b>{{ detail.status }}</b>
            <p v-if="detail.rejectReason">{{ detail.rejectReason }}</p>
            <p v-else>已开通租户并短信通知联系人。</p>
          </div>
        </div>
      </template>

      <template #footer>
        <template v-if="detail.status === '待审核'">
          <button class="btn btn-ghost" style="flex: 1" @click="openReject(detail); detail = null">驳回</button>
          <button class="btn btn-primary" style="flex: 1" @click="openApprove(detail); detail = null">通过并开通</button>
        </template>
        <button v-else class="btn btn-ghost" style="flex: 1" @click="detail = null">关闭</button>
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
.head-row { display: flex; gap: 14px; margin-bottom: 16px; }
.head-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 20px;
  color: var(--brand);
  min-width: 180px;
}
.head-card.warn { color: var(--warn); }
.head-card.muted { color: var(--sub); opacity: 0.75; }
.head-card b { font-size: 22px; display: block; line-height: 1.1; }
.head-card span { font-size: 12px; color: var(--sub); }

.search-box {
  position: relative;
  width: 230px;
}
.search-box .f-input { padding-left: 34px; height: 34px; }
.search-box > :first-child {
  position: absolute;
  left: 11px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--sub);
  pointer-events: none;
}

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
