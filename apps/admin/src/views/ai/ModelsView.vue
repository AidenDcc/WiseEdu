<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { AppIcon, showToast, ApiError, AI_MODEL_TYPE_TEXT } from '@aiteach/shared'
import type { AiModel, AiModelType } from '@aiteach/shared'
import AppModal from '@/components/ui/AppModal.vue'
import AppSwitch from '@/components/ui/AppSwitch.vue'
import { fetchAiModels, healthCheckAiModel, saveAiModel, testAiModel, toggleAiModel } from '@/api/platform'

const list = ref<AiModel[]>([])
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    list.value = await fetchAiModels()
  } finally {
    loading.value = false
  }
}

async function onToggle(model: AiModel) {
  if (model.enabled) {
    const ok = window.confirm(
      '停用后所有机构涉及该模型的 AI 功能将走备用模型/降级，确认停用？',
    )
    if (!ok) return
  }
  try {
    const result = await toggleAiModel(model.id)
    showToast(result.enabled ? '已启用' : '已停用', 'success')
    load()
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : '操作失败', 'error')
  }
}

async function onHealthCheck(model: AiModel) {
  try {
    const result = await healthCheckAiModel(model.id)
    showToast(
      result.ok ? `检测通过（耗时 ${result.latencyMs}ms）` : '检测失败：连接超时，请检查配置',
      result.ok ? 'success' : 'error',
    )
    load()
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : '检测失败', 'error')
  }
}

/* ===== 新增 / 编辑（FR-PT-017 / 018） ===== */
const editing = ref<AiModel | 'new' | null>(null)
const form = reactive({
  name: '',
  type: 'llm' as AiModelType,
  provider: '',
  apiUrl: '',
  apiKey: '',
  qps: 10,
  pricePerK: 0.04,
})
const formError = ref('')
const testState = ref<'none' | 'testing' | 'ok' | 'fail'>('none')
const testLatency = ref(0)
const saving = ref(false)

function openCreate() {
  editing.value = 'new'
  Object.assign(form, { name: '', type: 'llm', provider: '', apiUrl: '', apiKey: '', qps: 10, pricePerK: 0.04 })
  formError.value = ''
  testState.value = 'none'
}

function openEdit(model: AiModel) {
  editing.value = model
  Object.assign(form, {
    name: model.name,
    type: model.type,
    provider: model.provider,
    apiUrl: model.apiUrl,
    apiKey: '',
    qps: model.qps,
    pricePerK: model.pricePerK,
  })
  formError.value = ''
  testState.value = model.lastCheckOk ? 'ok' : 'none'
}

function validateForm(): string | null {
  if (form.name.trim().length < 2 || form.name.trim().length > 20) return '模型名称须为 2-20 字'
  if (!form.provider.trim()) return '提供方不能为空'
  if (!/^https?:\/\/.+/.test(form.apiUrl.trim())) return 'API 地址须以 http(s):// 开头'
  if (editing.value === 'new' && !form.apiKey.trim()) return 'API Key 不能为空'
  if (!Number.isInteger(form.qps) || form.qps <= 0) return '限流 QPS 须为正整数'
  if (form.pricePerK < 0 || form.pricePerK > 9999) return '计费单价须为非负数字'
  return null
}

async function onTest() {
  const error = validateForm()
  if (error) {
    formError.value = error
    return
  }
  testState.value = 'testing'
  const result = await testAiModel()
  testLatency.value = result.latencyMs
  testState.value = 'ok'
}

async function save() {
  const error = validateForm()
  if (error) {
    formError.value = error
    return
  }
  if (editing.value === 'new' && testState.value !== 'ok') {
    formError.value = '测试连接通过后才能保存'
    return
  }
  saving.value = true
  try {
    await saveAiModel({
      id: editing.value instanceof Object ? editing.value.id : undefined,
      name: form.name.trim(),
      type: form.type,
      provider: form.provider.trim(),
      apiUrl: form.apiUrl.trim(),
      apiKey: form.apiKey.trim() || undefined,
      qps: form.qps,
      pricePerK: Math.round(form.pricePerK * 10000) / 10000,
    })
    showToast('模型已保存', 'success')
    editing.value = null
    load()
  } catch (error2) {
    formError.value = error2 instanceof ApiError ? error2.message : '保存失败，请重试'
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="panel">
    <div class="filter-bar">
      <span class="filter-label">大模型接入与限流计费配置；停用前请确保存在同类型备用模型</span>
      <button class="btn btn-primary btn-sm" style="margin-left: auto" @click="openCreate">
        <AppIcon name="plus" :size="15" /> 新增模型
      </button>
    </div>

    <div class="data-table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>模型名称</th>
            <th>类型</th>
            <th>提供方</th>
            <th>状态</th>
            <th>限流 QPS</th>
            <th>本月调用量</th>
            <th>本月费用</th>
            <th>最近健康检测</th>
            <th style="width: 200px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading && list.length === 0">
            <td colspan="9" class="empty-row">加载中…</td>
          </tr>
          <tr v-else-if="list.length === 0">
            <td colspan="9" class="empty-row">暂无接入模型</td>
          </tr>
          <template v-else>
            <tr v-for="model in list" :key="model.id">
              <td class="cell-strong">{{ model.name }}</td>
              <td><span class="tag tag-blue">{{ AI_MODEL_TYPE_TEXT[model.type] }}</span></td>
              <td>{{ model.provider }}</td>
              <td><AppSwitch :model-value="model.enabled" @update:model-value="onToggle(model)" /></td>
              <td>{{ model.qps }}</td>
              <td>{{ model.callsThisMonth.toLocaleString('zh-CN') }}</td>
              <td>¥{{ model.costThisMonth.toLocaleString('zh-CN', { minimumFractionDigits: 1 }) }}</td>
              <td>
                <span v-if="model.lastCheckAt" class="check-result" :class="model.lastCheckOk ? 'ok' : 'bad'">
                  {{ model.lastCheckOk ? '正常' : '异常' }} · {{ model.lastCheckAt.slice(5, 16) }}
                </span>
                <span v-else style="color: var(--sub)">未检测</span>
              </td>
              <td>
                <div class="op-group">
                  <button class="mini-btn" type="button" @click="onHealthCheck(model)">健康检测</button>
                  <button class="mini-btn" type="button" @click="openEdit(model)">编辑</button>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <!-- 新增 / 编辑弹窗 -->
    <AppModal
      v-if="editing"
      :title="editing === 'new' ? '新增模型' : `编辑模型 · ${editing.name}`"
      :width="520"
      :close-on-mask="false"
      @close="editing = null"
    >
      <div class="form-grid">
        <div class="f-field">
          <label class="f-label">模型名称<span class="req">*</span></label>
          <input v-model="form.name" class="f-input" placeholder="2-20 字" />
        </div>
        <div class="f-field">
          <label class="f-label">类型<span class="req">*</span></label>
          <select v-model="form.type" class="f-select">
            <option value="llm">大语言模型</option>
            <option value="multimodal">多模态</option>
            <option value="ocr">OCR 公式识别</option>
          </select>
        </div>
        <div class="f-field">
          <label class="f-label">提供方<span class="req">*</span></label>
          <input v-model="form.provider" class="f-input" placeholder="如 OpenAI / 阿里云百炼" />
        </div>
        <div class="f-field">
          <label class="f-label">限流 QPS<span class="req">*</span></label>
          <input v-model.number="form.qps" class="f-input" type="number" min="1" />
        </div>
        <div class="f-field span2">
          <label class="f-label">API 地址<span class="req">*</span></label>
          <input v-model="form.apiUrl" class="f-input" placeholder="https://..." />
        </div>
        <div class="f-field span2">
          <label class="f-label">
            API Key<span class="req">*</span>
            <span v-if="editing !== 'new'" class="key-hint">已存 {{ editing.apiKeyMasked }}，留空表示不修改</span>
          </label>
          <input
            v-model="form.apiKey"
            class="f-input"
            type="password"
            autocomplete="new-password"
            :placeholder="editing === 'new' ? '密文存储，脱敏展示' : '留空表示不修改'"
          />
        </div>
        <div class="f-field span2">
          <label class="f-label">计费单价（元 / 千 tokens）</label>
          <input v-model.number="form.pricePerK" class="f-input" type="number" min="0" step="0.0001" />
        </div>
      </div>

      <!-- 测试连接（FR-PT-018） -->
      <div class="test-bar">
        <button class="btn btn-ghost btn-sm" :disabled="testState === 'testing'" @click="onTest">
          <AppIcon name="sparkles" :size="14" />
          {{ testState === 'testing' ? '测试中…' : '测试连接' }}
        </button>
        <span v-if="testState === 'ok'" class="test-result ok">
          <AppIcon name="check" :size="13" /> 连接正常（耗时 {{ testLatency }} ms）
        </span>
        <span v-else-if="testState === 'fail'" class="test-result bad">连接失败</span>
        <span v-else class="test-result hint">新增模型需测试通过后才能保存</span>
      </div>

      <p v-if="formError" class="form-err">{{ formError }}</p>
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
.check-result.ok { color: var(--success); font-weight: 600; }
.check-result.bad { color: var(--danger); font-weight: 600; }
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 16px;
}
.span2 { grid-column: span 2; }
.key-hint { font-weight: 400; font-size: 12px; color: var(--sub); margin-left: 8px; }
.test-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  background: #f8fafd;
  border-radius: 10px;
  padding: 10px 14px;
}
.test-result { font-size: 12.5px; }
.test-result.ok { color: var(--success); display: inline-flex; align-items: center; gap: 4px; }
.test-result.bad { color: var(--danger); }
.test-result.hint { color: var(--sub); }
.form-err { font-size: 12px; color: var(--danger); margin: 10px 0 4px; }
</style>
