<script setup lang="ts">
/**
 * AI 安全治理（P-05-10/11/12）。
 *
 * 三个页签：
 * - 敏感词策略：分组维护词表与命中动作（拒答 / 转人工 / 脱敏），按场景生效；
 * - 输出质量评测：多维度评分（准确 / 完整 / 适龄 / 安全）与环比；
 * - 生成内容留痕：AI 产物溯源（traceId、模型、租户、输入摘要、安全结论）。
 */
import { computed, onMounted, ref } from 'vue'
import { AppIcon, AppPageHeader, AppTabs, showToast, AppModal, appConfirm } from '@aiteach/shared'
import type { AiQualityEval, AiTraceRecord, SensitivePolicyGroup } from '@aiteach/shared'
import {
  deleteSensitivePolicy,
  fetchQualityEvals,
  fetchSensitivePolicies,
  fetchTraceRecords,
  runQualityEval,
  saveSensitivePolicy,
  toggleSensitivePolicy,
} from '@/api/content'

const tab = ref<'policy' | 'eval' | 'trace'>('policy')
const policies = ref<SensitivePolicyGroup[]>([])
const evals = ref<AiQualityEval[]>([])
const traces = ref<AiTraceRecord[]>([])
const loading = ref(true)

async function load() {
  loading.value = true
  const [p, e, t] = await Promise.all([fetchSensitivePolicies(), fetchQualityEvals(), fetchTraceRecords('', '')])
  policies.value = p
  evals.value = e
  traces.value = t
  loading.value = false
}

/* ===== 1. 敏感词策略 ===== */
const ACTION_TEXT: Record<SensitivePolicyGroup['action'], string> = { block: '拒答', human: '转人工', mask: '脱敏' }

function actionTag(action: SensitivePolicyGroup['action']) {
  return action === 'block' ? 'tag-red' : action === 'human' ? 'tag-orange' : 'tag-blue'
}

const editingPolicy = ref<null | { id: number | null; name: string; action: SensitivePolicyGroup['action']; scope: string; wordsText: string }>(null)

function openPolicyCreate() {
  editingPolicy.value = { id: null, name: '', action: 'human', scope: '全部', wordsText: '' }
}
function openPolicyEdit(row: SensitivePolicyGroup) {
  editingPolicy.value = { id: row.id, name: row.name, action: row.action, scope: row.scope, wordsText: row.words.join('\n') }
}

async function submitPolicy() {
  if (!editingPolicy.value) return
  const words = editingPolicy.value.wordsText.split('\n').map((row) => row.trim()).filter(Boolean)
  if (!editingPolicy.value.name.trim()) {
    showToast('策略名称必填', 'error')
    return
  }
  if (!words.length) {
    showToast('至少添加一个敏感词', 'error')
    return
  }
  try {
    await saveSensitivePolicy({
      id: editingPolicy.value.id ?? undefined,
      name: editingPolicy.value.name,
      action: editingPolicy.value.action,
      scope: editingPolicy.value.scope,
      words,
    })
    editingPolicy.value = null
    showToast('已保存', 'success')
    load()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '保存失败', 'error')
  }
}

async function onTogglePolicy(row: SensitivePolicyGroup) {
  await toggleSensitivePolicy(row.id)
  await load()
  showToast(row.enabled ? '已停用' : '已启用', 'success')
}

async function onDeletePolicy(row: SensitivePolicyGroup) {
  if (!(await appConfirm(`删除策略「${row.name}」？`, { type: 'danger' }))) return
  try {
    await deleteSensitivePolicy(row.id)
    showToast('已删除', 'success')
    load()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '删除失败', 'error')
  }
}

/* ===== 2. 质量评测 ===== */
const evalScene = ref('AI 出题')
const running = ref(false)

async function onRunEval() {
  running.value = true
  try {
    await runQualityEval(evalScene.value)
    showToast(`「${evalScene.value}」评测完成`, 'success')
    load()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '评测失败', 'error')
  } finally {
    running.value = false
  }
}

function scoreColor(value: number) {
  if (value >= 90) return '#2e9e5b'
  if (value >= 80) return '#d9822b'
  return '#d94f43'
}

/** 评测维度定义（key 与 AiQualityEval['scores'] 严格对应，避免模板里做字符串索引） */
const EVAL_METRICS: Array<{ key: keyof AiQualityEval['scores']; label: string }> = [
  { key: 'accuracy', label: '答案准确' },
  { key: 'completeness', label: '解析完整' },
  { key: 'gradeFit', label: '年级适配' },
  { key: 'safety', label: '内容安全' },
]

/* ===== 3. 留痕溯源 ===== */
const traceScene = ref('')
const traceSafety = ref('')

const SAFETY_META: Record<AiTraceRecord['safety'], { text: string; tag: string }> = {
  pass: { text: '通过', tag: 'tag-green' },
  masked: { text: '已脱敏', tag: 'tag-orange' },
  blocked: { text: '已拦截', tag: 'tag-red' },
}

const filteredTraces = computed(() =>
  traces.value.filter((row) => (!traceScene.value || row.scene === traceScene.value) && (!traceSafety.value || row.safety === traceSafety.value)),
)

const enabledPolicyCount = computed(() => policies.value.filter((row) => row.enabled).length)

onMounted(load)
</script>

<template>
  <div class="page">
    <AppPageHeader desc="AI 安全治理：输入输出双审的敏感词策略、输出质量多维评测、AI 生成内容全程留痕与溯源。" />

    <div class="toolbar">
      <AppTabs
        v-model="tab"
        :tabs="[
          { key: 'policy', label: '敏感词策略', count: enabledPolicyCount },
          { key: 'eval', label: '输出质量评测' },
          { key: 'trace', label: '生成内容留痕' },
        ]"
      />
    </div>

    <!-- 敏感词策略 -->
    <template v-if="tab === 'policy'">
      <div class="head-row">
        <span class="head-hint">命中动作：拒答 = 直接拒答；转人工 = 转教师人工处理；脱敏 = 替换敏感片段后放行。</span>
        <button class="btn btn-primary" @click="openPolicyCreate"><AppIcon name="plus" :size="15" /> 新建策略</button>
      </div>
      <div class="panel">
        <div class="data-table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>策略名称</th>
                <th>命中动作</th>
                <th>生效场景</th>
                <th>词条数</th>
                <th>词表示例</th>
                <th>近 30 天命中</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="loading"><td colspan="8" class="empty-row">加载中…</td></tr>
              <tr v-else-if="policies.length === 0"><td colspan="8" class="empty-row">暂无策略</td></tr>
              <template v-else>
                <tr v-for="row in policies" :key="row.id">
                  <td class="cell-strong">{{ row.name }}</td>
                  <td><span class="tag" :class="actionTag(row.action)">{{ ACTION_TEXT[row.action] }}</span></td>
                  <td>{{ row.scope }}</td>
                  <td>{{ row.words.length }}</td>
                  <td class="ellipsis">{{ row.words.slice(0, 3).join('、') }}{{ row.words.length > 3 ? '…' : '' }}</td>
                  <td>{{ row.hits30d }} 次</td>
                  <td><span class="tag" :class="row.enabled ? 'tag-green' : 'tag-gray'">{{ row.enabled ? '启用' : '停用' }}</span></td>
                  <td>
                    <div class="op-group">
                      <button class="mini-btn" @click="openPolicyEdit(row)">编辑</button>
                      <button class="mini-btn" @click="onTogglePolicy(row)">{{ row.enabled ? '停用' : '启用' }}</button>
                      <button class="mini-btn danger" :disabled="row.enabled" @click="onDeletePolicy(row)">删除</button>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <!-- 质量评测 -->
    <template v-else-if="tab === 'eval'">
      <div class="head-row">
        <div class="run-box">
          <select v-model="evalScene" class="f-select">
            <option v-for="scene in ['AI 出题', 'AI 组卷', 'AI 讲义', 'AI 阅卷', '学生 AI 问答']" :key="scene" :value="scene">{{ scene }}</option>
          </select>
          <button class="btn btn-primary" :disabled="running" @click="onRunEval">
            <AppIcon name="refresh" :size="15" /> {{ running ? '评测中…' : '发起评测' }}
          </button>
        </div>
      </div>
      <div class="eval-grid">
        <div v-for="row in evals" :key="row.id" class="eval-card">
          <div class="eval-head">
            <div>
              <b>{{ row.scene }}</b>
              <span class="eval-dataset">{{ row.dataset }}</span>
            </div>
            <div class="eval-overall">
              <b :style="{ color: scoreColor(row.overall) }">{{ row.overall }}</b>
              <span class="delta" :class="row.delta >= 0 ? 'up' : 'down'">{{ row.delta >= 0 ? '+' : '' }}{{ row.delta }}</span>
            </div>
          </div>
          <div class="metric-list">
            <div v-for="metric in EVAL_METRICS" :key="metric.key" class="metric-row">
              <span class="metric-label">{{ metric.label }}</span>
              <div class="bar-track">
                <div class="bar" :style="{ width: `${row.scores[metric.key]}%`, background: scoreColor(row.scores[metric.key]) }" />
              </div>
              <span class="metric-value">{{ row.scores[metric.key] }}</span>
            </div>
          </div>
          <p class="eval-meta">模型 {{ row.model }} · 样本 {{ row.sampleCount }} · {{ row.ranAt }}</p>
        </div>
      </div>
    </template>

    <!-- 留痕溯源 -->
    <template v-else>
      <div class="head-row">
        <div class="run-box">
          <select v-model="traceScene" class="f-select">
            <option value="">全部场景</option>
            <option v-for="scene in ['AI 出题', 'AI 组卷', 'AI 阅卷', 'AI 课件', '学生 AI 问答']" :key="scene" :value="scene">{{ scene }}</option>
          </select>
          <select v-model="traceSafety" class="f-select">
            <option value="">全部安全结论</option>
            <option value="pass">通过</option>
            <option value="masked">已脱敏</option>
            <option value="blocked">已拦截</option>
          </select>
        </div>
      </div>
      <div class="panel">
        <div class="data-table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>traceId</th>
                <th>场景</th>
                <th>模型</th>
                <th>租户</th>
                <th>产物</th>
                <th>输入摘要</th>
                <th>安全结论</th>
                <th>时间</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="filteredTraces.length === 0"><td colspan="8" class="empty-row">暂无记录</td></tr>
              <template v-else>
                <tr v-for="row in filteredTraces" :key="row.id">
                  <td class="mono">{{ row.traceId }}</td>
                  <td><span class="tag tag-blue">{{ row.scene }}</span></td>
                  <td class="mono">{{ row.model }}</td>
                  <td>{{ row.tenantName }}</td>
                  <td>{{ row.artifactKind }} · {{ row.artifactTitle }}</td>
                  <td class="ellipsis">{{ row.inputDigest }}</td>
                  <td><span class="tag" :class="SAFETY_META[row.safety].tag">{{ SAFETY_META[row.safety].text }}</span></td>
                  <td class="mono">{{ row.createdAt }}</td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <!-- 策略编辑 -->
    <AppModal v-if="editingPolicy" :title="editingPolicy.id ? '编辑敏感词策略' : '新建敏感词策略'" :width="480" @close="editingPolicy = null">
      <div class="f-field">
        <label class="f-label">策略名称<span class="req">*</span></label>
        <input v-model="editingPolicy.name" class="f-input" placeholder="如 未成年人保护" />
      </div>
      <div class="f-field row2">
        <div>
          <label class="f-label">命中动作</label>
          <select v-model="editingPolicy.action" class="f-select">
            <option value="block">拒答</option>
            <option value="human">转人工</option>
            <option value="mask">脱敏</option>
          </select>
        </div>
        <div>
          <label class="f-label">生效场景</label>
          <select v-model="editingPolicy.scope" class="f-select">
            <option value="全部">全部</option>
            <option value="学生问答">学生问答</option>
            <option value="教师助手">教师助手</option>
            <option value="出题">出题</option>
          </select>
        </div>
      </div>
      <div class="f-field">
        <label class="f-label">词表（每行一个）<span class="req">*</span></label>
        <textarea v-model="editingPolicy.wordsText" class="f-textarea" rows="5" placeholder="每行一个敏感词" />
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="editingPolicy = null">取消</button>
        <button class="btn btn-primary" @click="submitPolicy">保存</button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.toolbar { margin-bottom: 14px; }
.head-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; gap: 12px; }
.head-hint { font-size: 12.5px; color: var(--sub); }
.run-box { display: flex; align-items: center; gap: 10px; }
.mono { font-family: 'SF Mono', Menlo, monospace; font-size: 12px; }
.ellipsis { max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.eval-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.eval-card { background: #fff; border: 1px solid var(--border); border-radius: 12px; padding: 16px 18px; }
.eval-head { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 14px; }
.eval-head b { font-size: 14px; }
.eval-dataset { display: block; font-size: 12px; color: var(--sub); margin-top: 3px; }
.eval-overall { display: flex; align-items: baseline; gap: 6px; }
.eval-overall b { font-size: 24px; font-variant-numeric: tabular-nums; }
.delta { font-size: 12px; }
.delta.up { color: #2e9e5b; }
.delta.down { color: #d94f43; }
.metric-list { display: flex; flex-direction: column; gap: 9px; }
.metric-row { display: grid; grid-template-columns: 68px 1fr 34px; gap: 10px; align-items: center; }
.metric-label { font-size: 12.5px; color: var(--sub); }
.metric-value { font-size: 12.5px; text-align: right; font-variant-numeric: tabular-nums; }
.bar-track { position: relative; height: 8px; border-radius: 4px; background: #eef2f4; overflow: hidden; }
.bar { position: absolute; inset: 0 auto 0 0; border-radius: 4px; }
.eval-meta { margin: 14px 0 0; font-size: 11.5px; color: var(--sub); }
</style>
