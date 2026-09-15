<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { AppIcon, showToast, ApiError } from '@aiteach/shared'
import type { FeatureSwitches, PackageRecord } from '@aiteach/shared'
import AppModal from '@/components/ui/AppModal.vue'
import AppSwitch from '@/components/ui/AppSwitch.vue'
import { fetchPackages, savePackage } from '@/api/tenant'

const FEATURE_META: Array<{ key: keyof FeatureSwitches; label: string }> = [
  { key: 'aiGenerate', label: 'AI 出题' },
  { key: 'aiVariant', label: 'AI 变式' },
  { key: 'aiPhoto', label: 'AI 拍照识题' },
  { key: 'docImport', label: '文档识别' },
  { key: 'collab', label: '协同组卷' },
  { key: 'customPrompt', label: '自定义提示词' },
]

const packages = ref<PackageRecord[]>([])
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    packages.value = await fetchPackages()
  } finally {
    loading.value = false
  }
}

/* ===== 新增 / 编辑弹窗 ===== */
const editing = ref<PackageRecord | 'new' | null>(null)
const form = reactive({
  name: '',
  monthlyPrice: 0,
  aiQuota: 0,
  storageGb: 0,
  maxStaff: 0,
  maxConcurrent: 0,
  smsEnabled: false,
  features: {} as FeatureSwitches,
})
const formError = ref('')
const saving = ref(false)

function openCreate() {
  editing.value = 'new'
  form.name = ''
  form.monthlyPrice = 599
  form.aiQuota = 3000
  form.storageGb = 200
  form.maxStaff = 20
  form.maxConcurrent = 20
  form.smsEnabled = true
  form.features = {
    aiGenerate: true,
    aiVariant: true,
    aiPhoto: true,
    docImport: true,
    collab: true,
    customPrompt: false,
  }
  formError.value = ''
}

function openEdit(pkg: PackageRecord) {
  editing.value = pkg
  form.name = pkg.name
  form.monthlyPrice = pkg.monthlyPrice
  form.aiQuota = pkg.aiQuota
  form.storageGb = pkg.storageGb
  form.maxStaff = pkg.maxStaff
  form.maxConcurrent = pkg.maxConcurrent
  form.smsEnabled = pkg.smsEnabled
  form.features = { ...pkg.features }
  formError.value = ''
}

async function save() {
  if (!form.name.trim()) {
    formError.value = '套餐名称不能为空'
    return
  }
  if (form.monthlyPrice < 0 || form.aiQuota < 0 || form.storageGb < 0) {
    formError.value = '金额与配额不能为负数'
    return
  }
  saving.value = true
  try {
    const id = editing.value instanceof Object ? editing.value.id : undefined
    await savePackage({
      id,
      name: form.name.trim(),
      monthlyPrice: form.monthlyPrice,
      aiQuota: form.aiQuota,
      storageGb: form.storageGb,
      maxStaff: form.maxStaff,
      maxConcurrent: form.maxConcurrent,
      smsEnabled: form.smsEnabled,
      features: { ...form.features },
    })
    showToast(id ? '套餐已更新' : '套餐已创建', 'success')
    editing.value = null
    load()
  } catch (error) {
    formError.value = error instanceof ApiError ? error.message : '保存失败，请重试'
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <div class="title">套餐管理</div>
        <p class="desc">套餐定义了机构的 AI 额度、存储、员工数与功能开关；机构开通 / 续费时按套餐初始化配额。</p>
      </div>
      <button class="btn btn-primary btn-sm" @click="openCreate">
        <AppIcon name="plus" :size="15" /> 新增套餐
      </button>
    </div>

    <div v-if="loading && packages.length === 0" class="panel loading-panel">加载中…</div>

    <div v-else class="pkg-grid">
      <div v-for="pkg in packages" :key="pkg.id" class="panel pkg-card">
        <div class="pkg-head">
          <div>
            <h3 class="pkg-name">{{ pkg.name }}</h3>
            <p class="pkg-price"><b>¥{{ pkg.monthlyPrice.toLocaleString('zh-CN') }}</b>/ 月</p>
          </div>
          <button class="mini-btn" type="button" @click="openEdit(pkg)">
            <AppIcon name="edit" :size="14" /> 编辑
          </button>
        </div>

        <div class="pkg-quotas">
          <div class="quota">
            <span>AI 月度额度</span>
            <b>{{ pkg.aiQuota.toLocaleString('zh-CN') }} 次</b>
          </div>
          <div class="quota">
            <span>存储空间</span>
            <b>{{ pkg.storageGb >= 1024 ? `${(pkg.storageGb / 1024).toFixed(1)} TB` : `${pkg.storageGb} GB` }}</b>
          </div>
          <div class="quota">
            <span>最大员工数</span>
            <b>{{ pkg.maxStaff }} 人</b>
          </div>
          <div class="quota">
            <span>并发上限</span>
            <b>{{ pkg.maxConcurrent }}</b>
          </div>
        </div>

        <div class="pkg-features">
          <template v-for="feature in FEATURE_META" :key="feature.key">
            <span
              class="tag"
              :class="pkg.features[feature.key] ? 'tag-blue' : 'tag-gray'"
              style="font-weight: 500"
            >
              {{ feature.label }}
            </span>
          </template>
          <span class="tag" :class="pkg.smsEnabled ? 'tag-green' : 'tag-gray'" style="font-weight: 500">
            {{ pkg.smsEnabled ? '短信通道' : '无短信' }}
          </span>
        </div>
      </div>
    </div>

    <!-- 新增 / 编辑弹窗 -->
    <AppModal
      v-if="editing"
      :title="editing === 'new' ? '新增套餐' : `编辑套餐 · ${form.name}`"
      :close-on-mask="false"
      @close="editing = null"
    >
      <div class="form-grid">
        <div class="f-field">
          <label class="f-label">套餐名称<span class="req">*</span></label>
          <input v-model="form.name" class="f-input" placeholder="如：专业版" />
        </div>
        <div class="f-field">
          <label class="f-label">月费（元）</label>
          <input v-model.number="form.monthlyPrice" class="f-input" type="number" min="0" />
        </div>
        <div class="f-field">
          <label class="f-label">AI 月度额度（次）</label>
          <input v-model.number="form.aiQuota" class="f-input" type="number" min="0" />
        </div>
        <div class="f-field">
          <label class="f-label">存储空间（GB）</label>
          <input v-model.number="form.storageGb" class="f-input" type="number" min="0" />
        </div>
        <div class="f-field">
          <label class="f-label">最大员工数</label>
          <input v-model.number="form.maxStaff" class="f-input" type="number" min="1" />
        </div>
        <div class="f-field">
          <label class="f-label">并发上限</label>
          <input v-model.number="form.maxConcurrent" class="f-input" type="number" min="1" />
        </div>
      </div>

      <label class="f-label" style="margin-bottom: 10px">功能开关</label>
      <div class="feature-row">
        <label v-for="feature in FEATURE_META" :key="feature.key" class="feature-chip">
          <AppSwitch v-model="form.features[feature.key]" />
          <span>{{ feature.label }}</span>
        </label>
        <label class="feature-chip">
          <AppSwitch v-model="form.smsEnabled" />
          <span>短信通道</span>
        </label>
      </div>

      <p v-if="formError" class="err">{{ formError }}</p>
      <template #footer>
        <button class="btn btn-ghost btn-sm" @click="editing = null">取消</button>
        <button class="btn btn-primary btn-sm" :disabled="saving" @click="save">
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.pkg-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
  gap: 14px;
}
.pkg-card { padding: 20px; transition: box-shadow 0.2s, transform 0.2s; }
.pkg-card:hover { box-shadow: var(--shadow-lg); transform: translateY(-2px); }

.pkg-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 16px;
}
.pkg-name { font-size: 16px; font-weight: 700; }
.pkg-price { margin-top: 5px; font-size: 12px; color: var(--sub); }
.pkg-price b { font-size: 21px; color: var(--brand); font-weight: 700; margin-right: 2px; }

.pkg-quotas {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  background: #f8fafd;
  border-radius: 11px;
  padding: 13px 15px;
  margin-bottom: 14px;
}
.quota span { display: block; font-size: 11.5px; color: var(--sub); margin-bottom: 3px; }
.quota b { font-size: 13.5px; color: var(--ink); }

.pkg-features { display: flex; flex-wrap: wrap; gap: 6px; }

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 18px;
}
.feature-row { display: flex; flex-wrap: wrap; gap: 10px 18px; }
.feature-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--ink-2);
  font-weight: 500;
  cursor: pointer;
}
.err { font-size: 12px; color: var(--danger); margin: 10px 0 4px; }

.loading-panel { text-align: center; color: var(--sub); padding: 60px 0; font-size: 13px; }
</style>
