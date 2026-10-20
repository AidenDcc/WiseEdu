<script setup lang="ts">
/**
 * AI 安全治理（P-05-10/11/12）。
 *
 * 三个页签：
 * - 敏感词策略：分组维护词表与命中动作（拒答 / 转人工 / 脱敏），按场景生效；
 * - 输出质量评测：多维度评分（准确 / 完整 / 适龄 / 安全）与环比；
 * - 生成内容留痕：AI 产物溯源（traceId、模型、租户、输入摘要、安全结论）。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { AppFilterPanel, AppHelpTip, AppIcon, AppPageHeader, AppTabs, showToast, AppModal, appConfirm } from '@aiteach/shared'
import type { AiQualityEval, AiTraceRecord, FilterRowDef, SensitivePolicyGroup } from '@aiteach/shared'
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
const SAFETY_META: Record<AiTraceRecord['safety'], { text: string; tag: string }> = {
  pass: { text: '通过', tag: 'tag-green' },
  masked: { text: '已脱敏', tag: 'tag-orange' },
  blocked: { text: '已拦截', tag: 'tag-red' },
}

/** 候选项取自数据本身：写死清单一旦后端新增租户 / 接入新模型，筛选里就选不到 */
const traceScenes = computed(() => Array.from(new Set(traces.value.map((row) => row.scene))))
const traceTenants = computed(() => Array.from(new Set(traces.value.map((row) => row.tenantName))))
const traceModels = computed(() => Array.from(new Set(traces.value.map((row) => row.model))))

/* 搜索条件（AppFilterPanel 面板）：不选即不过滤，故取值直接是「选中项的第一个」，
   原来那两个「全部场景 / 全部安全结论」的空值选项由 chip 的「取消选中」承担 */
const TRACE_FILTERS = reactive<Record<string, string[]>>({ scene: [], tenant: [], model: [], safety: [], time: [] })
const TRACE_FILTER_ROWS = computed<FilterRowDef[]>(() => [
  { key: 'scene', label: '场景', options: traceScenes.value, multiple: false },
  { key: 'tenant', label: '租户', options: traceTenants.value, multiple: false },
  { key: 'model', label: '模型', options: traceModels.value, multiple: false },
  {
    key: 'safety',
    label: '安全结论',
    options: Object.keys(SAFETY_META),
    /* 取值是接口枚举，界面显示中文：optionLabels 只改文案不改值 */
    optionLabels: Object.fromEntries(Object.entries(SAFETY_META).map(([value, meta]) => [value, meta.text])),
    multiple: false,
  },
  /* 时间不是 chip：标成 custom，控件由下面 #extra 插槽画，汇总 / 清空仍归面板管 */
  { key: 'time', label: '时间', options: [], multiple: false, custom: true },
])

const timeStart = ref('')
const timeEnd = ref('')

/** 日期控件的原始值回写成面板可汇总的一条文案（折叠时头部会显示「时间 10-01 ~ 10-19」） */
function syncTimeFilter() {
  const parts = [timeStart.value, timeEnd.value].filter(Boolean)
  TRACE_FILTERS.time = parts.length ? [parts.join(' ~ ')] : []
}

function clearTime() {
  timeStart.value = ''
  timeEnd.value = ''
  syncTimeFilter()
}

/* 共享面板回传的是整份筛选值（覆盖式回写），逐 key 写回这份 reactive 对象本身 */
function onTraceFiltersChange(next: Record<string, string[]>) {
  TRACE_FILTERS.scene = next.scene ?? []
  TRACE_FILTERS.tenant = next.tenant ?? []
  TRACE_FILTERS.model = next.model ?? []
  TRACE_FILTERS.safety = next.safety ?? []
  const time = next.time?.[0] ?? ''
  TRACE_FILTERS.time = time ? [time] : []
  /* 面板的「清空」只回传空数组，这里同步把两个日期控件也清掉，否则条件被清、输入框还留着日期 */
  if (!time) {
    timeStart.value = ''
    timeEnd.value = ''
  }
}

const filteredTraces = computed(() => {
  const scene = TRACE_FILTERS.scene[0] ?? ''
  const tenant = TRACE_FILTERS.tenant[0] ?? ''
  const model = TRACE_FILTERS.model[0] ?? ''
  const safety = TRACE_FILTERS.safety[0] ?? ''
  /* 起止写反了就交换，不提示也不报错：日期区间这种输入，纠错比警告更有用 */
  const [from, to] = timeStart.value > timeEnd.value && timeEnd.value
    ? [timeEnd.value, timeStart.value]
    : [timeStart.value, timeEnd.value]
  return traces.value.filter((row) => {
    if (scene && row.scene !== scene) return false
    if (tenant && row.tenantName !== tenant) return false
    if (model && row.model !== model) return false
    if (safety && row.safety !== safety) return false
    const day = row.createdAt.slice(0, 10)
    if (from && day < from) return false
    if (to && day > to) return false
    return true
  })
})

/** 老数据没带触发条件时的兜底说明（结论本身仍是可信的，只是不知道命中了什么） */
const SAFETY_FALLBACK: Record<'masked' | 'blocked', string> = {
  masked: '命中隐私 / 敏感信息策略，按脱敏动作替换后放行；该条记录未留存具体命中的策略名。',
  blocked: '命中内容合规策略（拒答），产物未落库；该条记录未留存具体命中的策略名。',
}

function safetyTip(row: AiTraceRecord): string {
  if (row.safety === 'pass') return ''
  return row.safetyReason || SAFETY_FALLBACK[row.safety]
}

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
      <!-- 搜索条件：独立面板，与下方列表分开（对齐机构端列表页布局） -->
      <AppFilterPanel
        :rows="TRACE_FILTER_ROWS"
        :model-value="TRACE_FILTERS"
        @update:model-value="onTraceFiltersChange"
      >
        <!-- 时间区间：日期控件进不了 chip 行，但汇总 / 清空仍由面板统一管理 -->
        <template #extra>
          <div class="time-row">
            <span class="time-label">时间</span>
            <div class="time-range">
              <input v-model="timeStart" class="f-input time-input" type="date" @change="syncTimeFilter" />
              <span class="time-sep">至</span>
              <input v-model="timeEnd" class="f-input time-input" type="date" @change="syncTimeFilter" />
              <button v-if="timeStart || timeEnd" class="time-clear" type="button" @click="clearTime">清除日期</button>
            </div>
          </div>
        </template>
      </AppFilterPanel>

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
              <tr v-if="filteredTraces.length === 0"><td colspan="8" class="empty-row">没有符合条件的记录</td></tr>
              <template v-else>
                <tr v-for="row in filteredTraces" :key="row.id">
                  <td class="mono">{{ row.traceId }}</td>
                  <td><span class="tag tag-blue">{{ row.scene }}</span></td>
                  <td class="mono">{{ row.model }}</td>
                  <td>{{ row.tenantName }}</td>
                  <td>{{ row.artifactKind }} · {{ row.artifactTitle }}</td>
                  <td class="ellipsis">{{ row.inputDigest }}</td>
                  <td>
                    <!-- 已脱敏 / 已拦截后面挂问号：平台追溯时「命中了什么」比结论本身更重要 -->
                    <span class="safety-tag tag" :class="SAFETY_META[row.safety].tag">
                      {{ SAFETY_META[row.safety].text }}
                      <AppHelpTip
                        v-if="row.safety !== 'pass'"
                        title="触发条件"
                        :text="safetyTip(row)"
                        :size="12"
                      />
                    </span>
                  </td>
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
/* 纵向节奏交给 .page 的 gap，这里不再自带下边距，否则与 gap 叠加成双倍间距 */
/* 页签条与头部操作行原先各自带 margin-bottom，与 .page 的 gap 叠加成双倍间距，已去掉 */
.head-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.head-hint { font-size: 12.5px; color: var(--sub); }
.run-box { display: flex; align-items: center; gap: 10px; }
.mono { font-family: 'SF Mono', Menlo, monospace; font-size: 12px; white-space: nowrap; }
/* 八列 + 长 traceId：允许整表横向滚动，而不是把「租户 / 产物」压成一字一行。
   输入摘要仍靠 .ellipsis 截断，否则它会把整表宽度拉到屏幕外。 */
.data-table :deep(th),
.data-table :deep(td) { white-space: nowrap; }
.data-table :deep(.tag) { white-space: nowrap; }
.ellipsis { max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* 时间条件行：与 chip 行的「标签 58px + 内容」对齐，视觉上仍是同一组搜索条件 */
.time-row { display: flex; align-items: center; gap: 12px; }
.time-label { width: 58px; flex-shrink: 0; font-size: 12.5px; font-weight: 600; color: var(--sub); line-height: 26px; }
.time-range { display: flex; align-items: center; gap: 8px; }
.time-input { height: 30px; width: 148px; font-size: 12.5px; padding: 0 8px; }
.time-sep { font-size: 12.5px; color: var(--sub); }
.time-clear {
  border: none;
  background: transparent;
  padding: 0 4px;
  height: 26px;
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--brand);
  cursor: pointer;
}
.time-clear:hover { color: var(--brand-deep); }

/* 「已拦截 / 已脱敏」标签里的问号：跟标签同色，缩到 12px 不撑高胶囊 */
.safety-tag :deep(.help-tip) { width: 14px; height: 14px; color: currentColor; opacity: 0.72; }
.safety-tag :deep(.help-tip:hover) { opacity: 1; }
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
