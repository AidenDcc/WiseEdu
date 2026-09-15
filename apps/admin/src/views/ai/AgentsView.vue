<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { AppIcon, showToast, ApiError } from '@aiteach/shared'
import type { AgentConfig, AiModel } from '@aiteach/shared'
import AppModal from '@/components/ui/AppModal.vue'
import AppSwitch from '@/components/ui/AppSwitch.vue'
import { fetchAgentConfig, fetchAiModels, rollbackAgentConfig, saveAgentConfig } from '@/api/platform'

const AUTO_FIX_TYPES = ['格式错误', '语法错误', '数值笔误']

const config = ref<AgentConfig | null>(null)
const models = ref<AiModel[]>([])
const saving = ref(false)

const enabledModels = computed(() => models.value.filter((model) => model.enabled))

async function load() {
  ;[config.value, models.value] = await Promise.all([fetchAgentConfig(), fetchAiModels()])
}

function modelsFor(item: AgentConfig['items'][number]) {
  return item.ocrOnly
    ? enabledModels.value.filter((model) => model.type === 'multimodal' || model.type === 'ocr')
    : enabledModels.value
}

function toggleAutoFixType(type: string) {
  if (!config.value) return
  const types = config.value.autoFix.types
  const index = types.indexOf(type)
  if (index >= 0) types.splice(index, 1)
  else types.push(type)
}

function rowError(item: AgentConfig['items'][number]) {
  return item.enabled && !item.modelId
}

async function save() {
  if (!config.value) return
  const missing = config.value.items.filter((item) => rowError(item))
  if (missing.length > 0) {
    showToast(`「${missing[0].label}」已启用但未绑定模型，请先补充绑定`, 'error')
    return
  }
  if (!window.confirm('保存后仅对新任务生效，不影响进行中任务，确认保存？')) return
  saving.value = true
  try {
    config.value = await saveAgentConfig(JSON.parse(JSON.stringify(config.value)))
    showToast(`编排已保存为 v${config.value.version}，并写入版本日志`, 'success')
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : '保存失败，请重试', 'error')
  } finally {
    saving.value = false
  }
}

/* ===== 版本历史 / 回滚 ===== */
const historyOpen = ref(false)
const rollingBack = ref(false)

async function rollback(version: number) {
  if (!window.confirm(`回滚到版本 v${version}？（将生成新版本，不物理覆盖）`)) return
  rollingBack.value = true
  try {
    config.value = await rollbackAgentConfig(version)
    showToast(`已回滚到 v${version} 的配置（当前为 v${config.value.version}）`, 'success')
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : '回滚失败', 'error')
  } finally {
    rollingBack.value = false
  }
}

onMounted(load)
</script>

<template>
  <div v-if="config">
    <!-- 检测项（FR-PT-020） -->
    <div class="panel" style="margin-bottom: 14px">
      <div class="filter-bar">
        <span class="filter-label">多智能体检测项（8 项）：启用项必须绑定已启用模型，OCR 类仅可选多模态 / OCR 模型</span>
        <span class="tag tag-blue" style="margin-left: auto">当前版本 v{{ config.version }}</span>
      </div>
      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>检测项</th>
              <th>启用</th>
              <th style="width: 220px">绑定模型</th>
              <th>权重（0-100）</th>
              <th>超时（秒）</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in config.items" :key="item.key" :class="{ 'row-err': rowError(item) }">
              <td>
                <span class="cell-strong">{{ item.label }}</span>
                <span v-if="item.ocrOnly" class="tag tag-orange" style="margin-left: 8px">仅多模态 / OCR</span>
              </td>
              <td>
                <AppSwitch v-model="item.enabled" />
              </td>
              <td>
                <select
                  v-model="item.modelId"
                  class="f-select"
                  style="height: 34px"
                  :class="{ 'input-err': rowError(item) }"
                >
                  <option :value="null" disabled>请选择模型</option>
                  <option v-for="model in modelsFor(item)" :key="model.id" :value="model.id">
                    {{ model.name }}
                  </option>
                </select>
                <p v-if="rowError(item)" class="err-text">已启用未绑定模型</p>
              </td>
              <td>
                <input v-model.number="item.weight" class="f-input table-input" type="number" min="0" max="100" />
              </td>
              <td>
                <input v-model.number="item.timeoutSec" class="f-input table-input" type="number" min="5" max="120" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 自动纠错 + 人工终审（FR-PT-021 / 022） -->
    <div class="dual">
      <div class="panel rule-panel">
        <h4 class="section-title">自动纠错规则</h4>
        <label class="f-label" style="margin-bottom: 10px">可自动修复的错误类型</label>
        <div class="fix-types">
          <label v-for="type in AUTO_FIX_TYPES" :key="type" class="fix-chip">
            <input
              type="checkbox"
              :checked="config.autoFix.types.includes(type)"
              @change="toggleAutoFixType(type)"
            />
            {{ type }}
          </label>
        </div>
        <label class="f-label" style="margin: 16px 0 8px">
          自动修复置信度阈值：<b class="threshold">{{ config.autoFix.threshold }}%</b>
        </label>
        <input
          v-model.number="config.autoFix.threshold"
          class="range-slider"
          type="range"
          min="0"
          max="100"
          step="5"
        />
        <p class="f-hint">低于阈值的修复不自动执行，转人工处理。</p>
      </div>

      <div class="panel rule-panel">
        <h4 class="section-title">人工终审触发条件</h4>
        <div class="review-rule locked">
          <AppIcon name="check" :size="14" />
          任一检测项不通过即触发（锁定，不可修改）
        </div>
        <div class="review-rule">
          <span>追加：置信度 <</span>
          <input v-model.number="config.manualReview.minConfidence" class="f-input cond-input" type="number" min="0" max="100" placeholder="关闭" />
          <span>% 时触发</span>
        </div>
        <div class="review-rule">
          <span>追加：查重相似度 ></span>
          <input v-model.number="config.manualReview.maxSimilarity" class="f-input cond-input" type="number" min="0" max="100" placeholder="关闭" />
          <span>% 时触发（0-100 整数）</span>
        </div>
        <p class="f-hint">留空表示关闭该追加条件。</p>
      </div>
    </div>

    <!-- 操作 -->
    <div class="action-bar">
      <button class="btn btn-ghost btn-sm" @click="historyOpen = true">
        <AppIcon name="clock" :size="14" /> 版本历史
      </button>
      <button class="btn btn-primary btn-sm" :disabled="saving" @click="save">
        {{ saving ? '保存中…' : '保存编排' }}
      </button>
    </div>

    <!-- 版本历史 -->
    <AppModal v-if="historyOpen" title="编排版本历史" @close="historyOpen = false">
      <ul class="version-list">
        <li v-for="version in [...config.versions].reverse()" :key="version.version">
          <div class="version-head">
            <span class="tag" :class="version.version === config?.version ? 'tag-blue' : 'tag-gray'">
              v{{ version.version }}{{ version.version === config?.version ? ' · 当前' : '' }}
            </span>
            <span class="version-time">{{ version.savedAt }}</span>
            <button
              v-if="version.version !== config?.version"
              class="mini-btn"
              type="button"
              :disabled="rollingBack"
              @click="rollback(version.version)"
            >
              回滚到该版本
            </button>
          </div>
          <p class="version-note">{{ version.note }}</p>
        </li>
      </ul>
    </AppModal>
  </div>

  <div v-else class="panel loading-panel">加载中…</div>
</template>

<style scoped>
.row-err td { background: rgba(214, 69, 69, 0.04); }
.input-err { border-color: var(--danger) !important; }
.err-text { font-size: 12px; color: var(--danger); margin-top: 4px; }
.table-input { height: 34px; width: 110px; }

.dual { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; align-items: start; }
.rule-panel { padding: 18px 20px; }

.fix-types { display: flex; flex-wrap: wrap; gap: 10px 18px; }
.fix-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 13.5px;
  color: var(--ink-2);
  cursor: pointer;
}
.fix-chip input { accent-color: var(--brand); width: 15px; height: 15px; }

.threshold { color: var(--brand); font-size: 15px; }
.range-slider { width: 100%; accent-color: var(--brand); }

.review-rule {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13.5px;
  color: var(--ink-2);
  background: #f8fafd;
  border-radius: 10px;
  padding: 11px 14px;
  margin-bottom: 10px;
}
.review-rule.locked { color: var(--success); font-weight: 600; }
.cond-input { height: 32px; width: 84px; text-align: center; }

.action-bar {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 14px;
}

.version-list { list-style: none; display: flex; flex-direction: column; gap: 10px; }
.version-list li {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px 14px;
}
.version-head { display: flex; align-items: center; gap: 10px; }
.version-time { font-size: 12px; color: var(--sub); flex: 1; }
.version-note { font-size: 13px; color: var(--ink-2); margin-top: 8px; }

.loading-panel { text-align: center; color: var(--sub); padding: 60px 0; font-size: 13px; }
</style>
