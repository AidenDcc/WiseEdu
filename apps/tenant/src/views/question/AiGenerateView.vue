<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AppIcon, RichTextViewer, showToast, truncateRich } from '@aiteach/shared'
import type { GeneratedQuestion, OrgQuestion } from '@aiteach/shared'
import { adoptGenerated, fetchQuestions, fetchQuota, variantOf } from '@/api/org'
import { aiEngine, generateByAi } from '@/api/ai-generate'
import { useBaseData } from '@/composables/useBaseData'
import { useKnowledgePool } from '@/composables/useKnowledgePool'

const route = useRoute()
const router = useRouter()

const { subjects, grades, questionTypes, difficulties, ensure, pick } = useBaseData()

/** 变式模式：从题库「AI 变式」进入（FR-TM-016） */
const variantOfId = computed(() => Number(route.query.variantOf ?? 0))
const variantSource = ref<OrgQuestion | null>(null)

const form = reactive({
  subject: '数学',
  grade: '高一',
  type: '单选题',
  difficulty: '中等',
  knowledge: [] as string[],
  count: 5,
  variantStrategies: [] as string[],
})
const STRATEGIES = ['数值替换', '情境改编', '条件反转', '问法变换']

/* 知识点池按当前学科实时取（不再是写死的数学知识点） */
const { pool: knowledgePool } = useKnowledgePool(() => ({ grade: form.grade, subject: form.subject }))
/** 已选但不在当前学科池中的知识点（如切换学科前选的）仍保留可选，避免被静默清空 */
const orphanKnowledge = computed(() => form.knowledge.filter((k) => !knowledgePool.value.includes(k)))
const knowledgeOptions = computed(() => [...knowledgePool.value, ...orphanKnowledge.value])

const quota = ref({ used: 0, quota: 1000 })
/** 本次生成预计消耗（FR-TM-015） */
const estimate = computed(() => form.count)
const remain = computed(() => quota.value.quota - quota.value.used)
const insufficient = computed(() => estimate.value > remain.value)

/** 生成引擎：已配置 Deepseek Key 走真实模型，否则本地演示数据 */
const engine = ref<'deepseek' | 'mock'>(aiEngine())
/** 最近一次真实生成的 token 消耗（结果阶段展示） */
const lastTokens = ref(0)

const phase = ref<'form' | 'running' | 'result'>('form')
const progress = ref(0)
const results = ref<GeneratedQuestion[]>([])
const adoptedIds = ref<Set<number>>(new Set())

async function load() {
  await ensure()
  form.subject = pick(subjects.value, form.subject)
  form.grade = pick(grades.value, form.grade)
  form.type = pick(questionTypes.value, form.type)
  form.difficulty = pick(difficulties.value, form.difficulty)
  quota.value = await fetchQuota()
  if (variantOfId.value) {
    const all = await fetchQuestions()
    variantSource.value = all.find((row) => row.id === variantOfId.value) ?? null
    if (variantSource.value) {
      Object.assign(form, {
        subject: variantSource.value.subject,
        grade: variantSource.value.grade,
        type: variantSource.value.type === '多选题' ? '单选题' : variantSource.value.type,
        knowledge: [...variantSource.value.knowledge],
      })
      form.variantStrategies = ['数值替换']
    }
  }
}

function toggleKnowledge(item: string) {
  const pos = form.knowledge.indexOf(item)
  if (pos >= 0) form.knowledge.splice(pos, 1)
  else {
    if (form.knowledge.length >= 5) {
      showToast('知识点最多 5 个', 'error')
      return
    }
    form.knowledge.push(item)
  }
}

function toggleStrategy(item: string) {
  const pos = form.variantStrategies.indexOf(item)
  if (pos >= 0) form.variantStrategies.splice(pos, 1)
  else form.variantStrategies.push(item)
}

/** 生成（FR-TM-013：额度校验 → 多智能体流水线 → 结果卡片） */
async function run() {
  if (!form.knowledge.length) {
    showToast('请先选择知识点', 'error')
    return
  }
  if (form.count < 1 || form.count > 10) {
    showToast('生成数量须为 1 ~ 10 题', 'error')
    return
  }
  if (insufficient.value) {
    showToast(`本月额度不足：剩余 ${remain.value}，本次预计 ${estimate.value}`, 'error')
    return
  }
  phase.value = 'running'
  progress.value = 0
  const timer = window.setInterval(() => {
    progress.value = Math.min(97, progress.value + 7 + Math.floor(Math.random() * 9))
  }, 260)
  try {
    if (variantOfId.value) await variantOf(variantOfId.value)
    /* 真实 AI：固定提示词 + 变量渲染 → Deepseek；未配置 Key 时自动回退 mock */
    const result = await generateByAi({
      subject: form.subject,
      grade: form.grade,
      type: form.type,
      difficulty: form.difficulty,
      knowledge: [...form.knowledge],
      count: form.count,
      variant:
        variantOfId.value && variantSource.value
          ? { stem: variantSource.value.stem, strategies: [...form.variantStrategies] }
          : undefined,
    })
    results.value = result.list
    engine.value = result.engine
    lastTokens.value = result.tokens
    adoptedIds.value = new Set()
    progress.value = 100
    quota.value.used += estimate.value
    window.setTimeout(() => {
      phase.value = 'result'
    }, 320)
  } catch (error) {
    phase.value = 'form'
    showToast(error instanceof Error ? error.message : '生成失败，请稍后重试', 'error')
  } finally {
    window.clearInterval(timer)
  }
}

/** 采纳入题库（进入待终审，FR-TM-014） */
async function adopt(item: GeneratedQuestion, index: number) {
  await adoptGenerated({
    stem: item.stem,
    options: item.options,
    answer: item.answer,
    analysis: item.analysis,
    knowledge: item.knowledge,
    difficulty: item.difficulty,
    subject: form.subject,
    grade: form.grade,
    type: item.options.length > 0 ? (item.answer.length > 1 ? '多选题' : '单选题') : form.type === '多选题' ? '单选题' : form.type,
  })
  adoptedIds.value.add(index)
  showToast('已入题库（待人工终审），可在题库中查看', 'success')
}

/** 编辑后采纳：暂存到 sessionStorage，跳转录题页 */
function goEdit(item: GeneratedQuestion) {
  sessionStorage.setItem(
    'aiteach.ai-draft',
    JSON.stringify({ ...item, subject: form.subject, grade: form.grade, type: form.type }),
  )
  router.push('/question/manual?from=ai')
}

const pendingCount = computed(() => results.value.length - adoptedIds.value.size)

function onRerun() {
  if (pendingCount.value > 0 && !window.confirm(`还有 ${pendingCount.value} 题未处理，重新生成将丢弃，确认？`)) return
  phase.value = 'form'
  results.value = []
}

async function adoptAll() {
  for (let i = 0; i < results.value.length; i += 1) {
    if (!adoptedIds.value.has(i)) await adopt(results.value[i], i)
  }
  showToast('全部采纳完成', 'success')
}

onMounted(load)
</script>

<template>
  <div class="ai-layout">
    <!-- 变式来源条 -->
    <div v-if="variantSource" class="panel variant-bar">
      <span class="tag tag-blue">AI 变式</span>
      <span class="vs-label">母题 #{{ variantSource.id }}</span>
      <span class="vs-stem">{{ truncateRich(variantSource.stem, 60) }}…</span>
      <span class="f-hint" style="margin-left: auto">变式题自动挂接「变式关联」，策略可多选</span>
    </div>

    <!-- 表单阶段 -->
    <div v-if="phase === 'form'" class="panel form-panel">
      <div class="page-head" style="margin-bottom: 16px">
        <h2>AI 智能出题</h2>
        <span class="f-hint">多智能体协作：出题 → 查重 → 纠错 → 校标，产出即达「待人工终审」</span>
        <span class="tag" :class="engine === 'deepseek' ? 'tag-green' : 'tag-gray'" style="margin-left: auto">
          {{ engine === 'deepseek' ? 'Deepseek 真实生成' : '本地演示数据（未配置 Key）' }}
        </span>
      </div>

      <div class="prop-grid">
        <div class="f-field compact">
          <label class="f-label">学科<span class="req">*</span></label>
          <select v-model="form.subject" class="f-select">
            <option v-for="s in subjects" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
        <div class="f-field compact">
          <label class="f-label">年级<span class="req">*</span></label>
          <select v-model="form.grade" class="f-select">
            <option v-for="g in grades" :key="g" :value="g">{{ g }}</option>
          </select>
        </div>
        <div class="f-field compact">
          <label class="f-label">题型</label>
          <select v-model="form.type" class="f-select">
            <option v-for="t in questionTypes" :key="t" :value="t">{{ t }}</option>
          </select>
        </div>
        <div class="f-field compact">
          <label class="f-label">难度</label>
          <select v-model="form.difficulty" class="f-select">
            <option v-for="d in difficulties" :key="d" :value="d">{{ d }}</option>
          </select>
        </div>
        <div class="f-field compact">
          <label class="f-label">数量（1 ~ 10）</label>
          <input v-model.number="form.count" type="number" min="1" max="10" class="f-input" />
        </div>
      </div>

      <div class="f-field">
        <label class="f-label">知识点（最多 5 个）<span class="req">*</span></label>
        <div class="chips">
          <button
            v-for="k in knowledgeOptions"
            :key="k"
            class="k-chip"
            :class="{ on: form.knowledge.includes(k) }"
            type="button"
            @click="toggleKnowledge(k)"
          >
            {{ k }}
          </button>
        </div>
      </div>

      <div v-if="variantOfId" class="f-field">
        <label class="f-label">变式策略（可多选）</label>
        <div class="chips">
          <button
            v-for="sgy in STRATEGIES"
            :key="sgy"
            class="k-chip"
            :class="{ on: form.variantStrategies.includes(sgy) }"
            type="button"
            @click="toggleStrategy(sgy)"
          >
            {{ sgy }}
          </button>
        </div>
      </div>

      <!-- 额度预估（FR-TM-015） -->
      <div class="quota-bar">
        <AppIcon name="sparkles" :size="15" />
        <span>
          本月额度已用 <b>{{ quota.used }}</b> / {{ quota.quota }}；
          本次生成预计消耗 <b :class="{ danger: insufficient }">{{ estimate }}</b>
        </span>
        <button class="btn btn-primary" style="margin-left: auto" @click="run">
          <AppIcon name="sparkles" :size="15" /> 开始生成
        </button>
      </div>
      <p v-if="insufficient" class="f-err">额度不足，可联系机构管理员升级套餐或下月再试</p>
    </div>

    <!-- 生成进度 -->
    <div v-else-if="phase === 'running'" class="panel running-panel">
      <div class="running-ring"><AppIcon name="sparkles" :size="30" /></div>
      <h3>多智能体流水线执行中…</h3>
      <div class="pipeline">
        <span class="pl-step done">理解需求</span>
        <span class="pl-arrow">→</span>
        <span class="pl-step" :class="{ done: progress > 30 }">生成候选</span>
        <span class="pl-arrow">→</span>
        <span class="pl-step" :class="{ done: progress > 60 }">查重比对</span>
        <span class="pl-arrow">→</span>
        <span class="pl-step" :class="{ done: progress > 85 }">纠错校标</span>
      </div>
      <div class="progress-track"><div class="progress-fill" :style="{ width: `${progress}%` }" /></div>
      <p class="f-hint">{{ progress }}% · 通常 5 ~ 15 秒完成</p>
    </div>

    <!-- 结果阶段 -->
    <template v-else>
      <div class="result-head">
        <h3>
          生成完成（{{ results.length }} 题）· 已采纳 {{ adoptedIds.size }} 题
          <span v-if="engine === 'deepseek' && lastTokens" class="f-hint" style="font-weight: 400">
            · Deepseek 消耗 {{ lastTokens }} tokens
          </span>
        </h3>
        <div class="op-group">
          <button class="btn btn-ghost btn-sm" @click="onRerun">重新生成</button>
          <button class="btn btn-primary btn-sm" :disabled="pendingCount === 0" @click="adoptAll">全部采纳</button>
        </div>
      </div>
      <div class="result-grid">
        <div v-for="(item, i) in results" :key="i" class="panel result-card" :class="{ adopted: adoptedIds.has(i) }">
          <div class="rc-meta">
            <span class="tag tag-blue">{{ item.options.length > 0 ? '客观题' : form.type }}</span>
            <span class="tag tag-gray">{{ item.difficulty }}</span>
            <span v-for="k in item.knowledge" :key="k" class="tag tag-gray">{{ k }}</span>
            <span v-if="adoptedIds.has(i)" class="tag tag-green">已采纳</span>
          </div>
          <RichTextViewer class="rc-stem" :content="item.stem" />
          <ul v-if="item.options.length" class="rc-options">
            <li v-for="(opt, oi) in item.options" :key="oi" :class="{ right: item.answer.includes('ABCDEF'[oi]) }">
              {{ 'ABCDEF'[oi] }}. <RichTextViewer :content="opt" tag="span" />
            </li>
          </ul>
          <div class="rc-answer"><span class="tag tag-green">答案</span>{{ item.answer }}</div>
          <p class="rc-analysis"><b>解析：</b><RichTextViewer :content="item.analysis" tag="span" /></p>
          <div class="rc-ops">
            <template v-if="!adoptedIds.has(i)">
              <button class="mini-btn success" @click="adopt(item, i)">采纳</button>
              <button class="mini-btn" @click="goEdit(item)">编辑后采纳</button>
              <button class="mini-btn danger" @click="results.splice(i, 1); adoptedIds.delete(i)">丢弃</button>
            </template>
            <span v-else class="f-hint">已进入题库待终审</span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ai-layout { display: flex; flex-direction: column; gap: 14px; }

.variant-bar { display: flex; align-items: center; gap: 10px; padding: 10px 16px; }
.vs-label { font-size: 12.5px; color: var(--sub); }
.vs-stem { font-size: 13px; color: var(--ink-2); max-width: 480px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.form-panel { padding: 18px 20px; }
.prop-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 0 14px; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.k-chip {
  border: 1.5px solid var(--border);
  border-radius: 999px;
  background: #fff;
  color: var(--ink-2);
  font-size: 12.5px;
  padding: 4px 12px;
}
.k-chip.on { border-color: var(--brand); background: var(--brand-soft); color: var(--brand-deep); font-weight: 600; }

.quota-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--brand-soft);
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 13px;
  color: var(--ink-2);
}
.quota-bar b.danger { color: var(--danger); }

.running-panel { padding: 48px 24px; display: flex; flex-direction: column; align-items: center; gap: 14px; }
.running-ring {
  width: 72px; height: 72px; border-radius: 50%;
  background: var(--brand-soft); color: var(--brand-deep);
  display: flex; align-items: center; justify-content: center;
  animation: pulse 1.4s ease-in-out infinite;
}
@keyframes pulse { 50% { transform: scale(1.08); } }
.pipeline { display: flex; align-items: center; gap: 8px; }
.pl-step {
  font-size: 12.5px; color: var(--sub);
  border: 1.5px solid var(--border); border-radius: 999px; padding: 4px 12px;
}
.pl-step.done { border-color: var(--brand); color: var(--brand-deep); background: var(--brand-soft); }
.pl-arrow { color: var(--sub); }
.progress-track { width: 420px; max-width: 100%; height: 8px; border-radius: 999px; background: var(--border); overflow: hidden; }
.progress-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--brand), var(--brand-deep)); transition: width 0.25s; }

.result-head { display: flex; align-items: center; justify-content: space-between; }
.result-head h3 { font-size: 15.5px; color: var(--ink); }
.result-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); gap: 14px; }
.result-card { padding: 16px 18px; }
.result-card.adopted { border-color: var(--success); }
.rc-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.rc-stem { font-size: 14px; color: var(--ink); line-height: 1.7; margin-bottom: 10px; }
.rc-options { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
.rc-options li { font-size: 13px; color: var(--ink-2); background: #f7fafa; border-radius: 7px; padding: 6px 10px; }
.rc-options li.right { color: var(--success); font-weight: 600; }
.rc-answer { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--success); margin-bottom: 8px; }
.rc-analysis { font-size: 12.5px; color: var(--ink-2); line-height: 1.7; margin-bottom: 12px; }
.rc-ops { display: flex; gap: 8px; align-items: center; border-top: 1px dashed var(--border); padding-top: 10px; }
</style>
