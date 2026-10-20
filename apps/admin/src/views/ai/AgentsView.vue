<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { AppIcon, AppPageHeader, AppHelpTip, showToast, ApiError, AppModal, appConfirm, AppSwitch } from '@aiteach/shared'
import type { AgentConfig, AiModel } from '@aiteach/shared'

import { fetchAgentConfig, fetchAiModels, rollbackAgentConfig, saveAgentConfig } from '@/api/platform'

const AUTO_FIX_TYPES = ['格式错误', '语法错误', '数值笔误']

/**
 * 权重列说明：这一列是整张表里最容易被误读的字段（当成置信度 / 百分比），
 * 而它实际只决定「多项结论汇总时谁说话更算数」，故把口径写进列头提示。
 */
const WEIGHT_TIP = [
  '权重是这一项在综合判定里的话语权（0-100），不是置信度、也不是命中概率。',
  '多项检测同时给出结论时，平台按权重加权汇总：权重越高，该项判为不通过时对综合得分的影响越大；权重 0 = 只留痕、不参与判定。',
  '权重不改变单项检测本身的通过与否，只影响综合得分与人工终审的触发优先级。',
  '建议：合规 / 安全类（敏感词、隐私）80-100；准确性类（答案、知识点）50-70；格式类 20-40。',
].join('\n')

/** 自动纠错规则说明：配置口径 + 对业务的实际影响（阈值调高调低各自换来什么） */
const AUTO_FIX_TIP = [
  '配置说明：勾选可自动修复的错误类型，并设定置信度阈值。AI 判定置信度 ≥ 阈值时直接改稿并保留 diff；低于阈值一律不自动执行，转人工处理。',
  '业务影响：阈值调低 → 自动改得多、出稿快，但误改风险上升（老师需回看 diff）；调高 → 更保守，人工工单随之变多。',
  '数值笔误属高风险类型（一个小数点就是另一道题），建议阈值 ≥ 85，并让学生端可见内容强制走复核。',
  '规则只作用于 AI 生成 / 批改的产物，不会修改教师手工编辑过的内容。',
].join('\n')

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
  if (!(await appConfirm('保存后仅对新任务生效，不影响进行中任务，确认保存？', { type: 'warning' }))) return
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
  if (!(await appConfirm(`回滚到版本 v${version}？（将生成新版本，不物理覆盖）`, { type: 'warning' }))) return
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
    <AppPageHeader desc="多智能体检测项（8 项）：启用项必须绑定已启用模型，OCR 类仅可选多模态 / OCR 模型">
      <template #actions>
        <span class="tag tag-blue">当前版本 v{{ config.version }}</span>
      </template>
    </AppPageHeader>

    <!-- 检测项（FR-PT-020） -->
    <div class="panel" style="margin-bottom: 14px">
      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>检测项</th>
              <th>启用</th>
              <th style="width: 220px">绑定模型</th>
              <th>
                <span class="th-tip">权重（0-100）<AppHelpTip title="检测项权重怎么用" :text="WEIGHT_TIP" /></span>
              </th>
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
        <h4 class="section-title">
          自动纠错规则
          <AppHelpTip title="自动纠错规则与业务影响" :text="AUTO_FIX_TIP" />
        </h4>
        <div class="rule-body">
          <div class="rule-block">
            <label class="f-label">可自动修复的错误类型</label>
            <div class="fix-types">
              <label
                v-for="type in AUTO_FIX_TYPES"
                :key="type"
                class="fix-chip"
                :class="{ on: config.autoFix.types.includes(type) }"
              >
                <input
                  type="checkbox"
                  :checked="config.autoFix.types.includes(type)"
                  @change="toggleAutoFixType(type)"
                />
                {{ type }}
              </label>
            </div>
            <p class="f-hint">仅所选类型会被自动改写，其余类型原样保留并进入人工队列。</p>
          </div>

          <div class="rule-block">
            <div class="threshold-head">
              <label class="f-label">自动修复置信度阈值</label>
              <b class="threshold">{{ config.autoFix.threshold }}%</b>
            </div>
            <input
              v-model.number="config.autoFix.threshold"
              class="range-slider"
              type="range"
              min="0"
              max="100"
              step="5"
            />
            <div class="range-scale"><span>0%（激进）</span><span>100%（保守）</span></div>
            <p class="f-hint">低于阈值的修复不自动执行，转人工处理。</p>
          </div>
        </div>
      </div>

      <div class="panel rule-panel">
        <h4 class="section-title">人工终审触发条件</h4>
        <div class="rule-body">
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

/* 列头里的「文字 + 提示」：inline-flex 让问号跟着文字走，不会被 th 的居中排版甩开 */
.th-tip { display: inline-flex; align-items: center; gap: 4px; }

/* 两块规则面板等高：grid 默认 stretch，面板内部用 flex 列撑满，
   右栏文字少时把提示语压到底部，两块卡片的底边就对齐了 */
.dual { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; align-items: stretch; }
.rule-panel { padding: 18px 20px; display: flex; flex-direction: column; }
.rule-body { display: flex; flex-direction: column; gap: 20px; flex: 1; }
.rule-block { display: flex; flex-direction: column; gap: 10px; }
.rule-panel > .f-hint { margin-top: auto; padding-top: 14px; }

.fix-types { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
/* 类型 chip 做成可点的方框：勾选态用品牌色边框 + 浅底，比裸 checkbox 更容易看出「已启用」 */
.fix-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13.5px;
  color: var(--ink-2);
  cursor: pointer;
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 7px 12px;
  background: #fff;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}
.fix-chip:hover { border-color: var(--brand); }
.fix-chip.on { border-color: var(--brand); background: var(--brand-soft); color: var(--brand-deep); font-weight: 600; }
.fix-chip input { accent-color: var(--brand); width: 15px; height: 15px; }

.threshold-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.threshold { color: var(--brand); font-size: 16px; font-variant-numeric: tabular-nums; }
.range-slider { width: 100%; accent-color: var(--brand); margin: 4px 0 0; }
.range-scale { display: flex; justify-content: space-between; font-size: 11.5px; color: var(--sub); }

.review-rule {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13.5px;
  color: var(--ink-2);
  background: #f8fafd;
  border-radius: 10px;
  padding: 11px 14px;
}
.review-rule.locked { color: var(--success); font-weight: 600; }
.cond-input { height: 32px; width: 84px; text-align: center; }

.action-bar {
  display: flex;
  align-items: center;
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
