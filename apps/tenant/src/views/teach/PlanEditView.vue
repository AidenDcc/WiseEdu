<script setup lang="ts">
/**
 * 教案编辑（全屏工作台，从「教案」列表以**新页签**打开）。
 *
 * ## 与学案 / 讲义共用一套骨架
 *
 * 顶栏 / 工具带 / 三栏 / 右栏五块面板 / 底栏 / 整篇预览都在 `DocWorkbench` 里。
 * 本页只提供教案**特有的三件事**：
 *
 * 1. **左栏大纲**：教学目标 / 重难点 / 方法与教具 → 教学过程（可增删的环节）→ 板书 / 反思。
 *    它与学案的「段落流」不是同一套模型（`plan` vs `blocks`），但行的形态一样，
 *    所以只交数据、不交骨架（见 workbench-types.ts）。
 * 2. **中栏表单**：当前节点写什么 —— 三维目标三栏、重难点两栏、环节的「教师活动 / 学生活动 /
 *    设计意图」、板书与反思的富文本。
 * 3. **版式那一版**：教案最终是打印到纸上给听课的人看的，那张纸不是正文流能表达的
 *    （环节是表格），所以按 `plan` 现场排一份正式教案纸。
 *
 * ## 为什么教案也必须有自己的版式
 *
 * 教案的正文（`content`）与教学设计（`plan`）是两份数据。只用结构化编辑写的教案，
 * 正文是空的 —— 打印正文出来是一张白纸。以前顶栏那个「打印」在这种情况下只会提示
 * 「正文是空的」，老师看着满屏的教学设计无从下手。有了这一版，打印打的就是他写的那些东西。
 *
 * ## 编辑方式
 *
 * 默认进「文案编辑」（排版、目录、打印都在里面），结构化编辑是补充视角 —— 需要把题目挂到
 * 具体教学环节时才切过去。两种模式各写各自的字段（`content` / `plan`），互不覆盖。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AppFilterChips,
  PLAN_STEP_TEXT,
  RichTextViewer,
  showToast,
  toPlainText,
  truncateRich,
} from '@aiteach/shared'
import type { OrgQuestion, PlanStep, PlanStepKind, TeachDoc } from '@aiteach/shared'

import DocWorkbench from '@/components/doc/DocWorkbench.vue'
import RichTextEditor from '@/components/ui/RichTextEditor.vue'
import type { StructOutlineAction, StructOutlineRow } from '@/components/doc/workbench-types'
import { fetchQuestions, fetchTeachDocs, saveTeachDoc, toggleTeachDocPublish } from '@/api/org'

const route = useRoute()
const router = useRouter()

/* ================= 文档 ================= */

const doc = ref<TeachDoc | null>(null)
const loading = ref(true)
const saving = ref(false)
const publishing = ref(false)
const dirty = ref(false)
const mode = ref<'doc' | 'struct'>('doc')
const questions = ref<OrgQuestion[]>([])

const editingId = computed(() => Number(route.query.id ?? 0))

async function loadDoc() {
  const id = editingId.value
  if (!id) {
    showToast('缺少教案 id，已返回列表', 'error')
    router.replace('/teach/plan')
    return
  }
  const rows = await fetchTeachDocs('plan')
  const found = rows.find((row) => row.id === id)
  if (!found) {
    showToast('教案不存在或已删除', 'error')
    router.replace('/teach/plan')
    return
  }
  /* 深拷贝进编辑态：直接改列表里的对象会让「取消」无从实现，也污染列表展示 */
  doc.value = JSON.parse(JSON.stringify(found)) as TeachDoc
  document.title = `${doc.value.name} · 教案编辑 · 机构端 · AI教学云平台`
}

onMounted(async () => {
  loading.value = true
  try {
    await Promise.all([loadDoc(), fetchQuestions().then((rows) => (questions.value = rows))])
  } finally {
    loading.value = false
  }
})

/* 同一页签里换 id（演示脚本会这么点）时重新载入 */
watch(
  () => route.query.id,
  async (next, prev) => {
    if (next && next !== prev) await loadDoc()
  },
)

/* ================= 保存 / 发布 ================= */

const workbench = ref<InstanceType<typeof DocWorkbench> | null>(null)

async function save() {
  if (!doc.value) return
  if (doc.value.name.trim().length < 2) {
    showToast('教案名称须为 2-50 字', 'error')
    return
  }
  saving.value = true
  try {
    const saved = await saveTeachDoc({
      id: doc.value.id,
      kind: 'plan',
      name: doc.value.name.trim(),
      subject: doc.value.subject,
      grade: doc.value.grade,
      textbook: doc.value.textbook,
      chapter: doc.value.chapter,
      knowledge: doc.value.knowledge,
      blocks: doc.value.blocks,
      slides: [],
      plan: doc.value.plan,
      page: doc.value.page,
      content: doc.value.content,
      status: doc.value.status,
    })
    doc.value.id = saved.id
    dirty.value = false
    workbench.value?.pushSnapshot('手动保存')
    showToast('教案已保存', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '保存失败', 'error')
  } finally {
    saving.value = false
  }
}

async function publish() {
  const current = doc.value
  if (!current) return
  if (!current.id) {
    await save()
    if (!current.id) return
  }
  publishing.value = true
  try {
    const next = await toggleTeachDocPublish(current.id)
    current.status = next.status
    showToast(next.status === 'published' ? '已发布，校内教师可直接取用' : '已下架', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '操作失败', 'error')
  } finally {
    publishing.value = false
  }
}

/**
 * 全局设置里改的元数据与页面设置，直接写回编辑态的文档对象。
 *
 * **必须真的写回去**：面板内部是它自己的一份表单副本（见 DocSettingsDialog 的 `form` / `page`），
 * 只置脏不落值的话，界面上「改了」，纸面上却纹丝不动 —— 保存下来的也还是旧值。
 */
function onPatch(value: Partial<TeachDoc>) {
  if (!doc.value) return
  Object.assign(doc.value, value)
  dirty.value = true
}

/* ================= 结构化编辑（教学设计） ================= */

const activeKey = ref('objectives')
const activeStepId = computed(() => (activeKey.value.startsWith('step:') ? Number(activeKey.value.slice(5)) : 0))
const activeStep = computed<PlanStep | null>(
  () => doc.value?.plan?.steps.find((row) => row.id === activeStepId.value) ?? null,
)

/** 「新增」清单：教学环节的种类（与学案的「段落类型」同一个位置，只是词不同） */
const structKinds = computed(() =>
  (Object.keys(PLAN_STEP_TEXT) as PlanStepKind[]).map((key) => ({ key, label: PLAN_STEP_TEXT[key] })),
)

/** 环节时间合计：超过一节课 45 分钟 × 课时时给出提示，老师好据此调整 */
const totalMinutes = computed(() => doc.value?.plan?.steps.reduce((sum, row) => sum + row.minutes, 0) ?? 0)
const overTime = computed(() => totalMinutes.value > (doc.value?.plan?.periods ?? 1) * 45)

/**
 * 左栏大纲：固定的三项 + 可增删的环节 + 固定的两项。
 *
 * `group` 会把「教学过程」一条分组名画在环节前面 —— 教案的左栏不是一列平铺的节点，
 * 前半截是这张教案的属性，后半截才是一节课的流程。
 */
const structOutline = computed<StructOutlineRow[]>(() => {
  const plan = doc.value?.plan
  const fixed: StructOutlineRow[] = [
    { key: 'objectives', no: '目', title: '教学目标', meta: '三维目标' },
    { key: 'points', no: '重', title: '重点难点', meta: '教学重点 / 教学难点' },
    { key: 'method', no: '法', title: '方法与教具', meta: `${plan?.methods.length ?? 0} 项` },
  ]
  const steps: StructOutlineRow[] = (plan?.steps ?? []).map((step, index) => ({
    key: `step:${step.id}`,
    no: String(index + 1),
    title: step.title || PLAN_STEP_TEXT[step.kind],
    meta: [PLAN_STEP_TEXT[step.kind], `${step.minutes} 分钟`, step.questionIds.length ? `${step.questionIds.length} 题` : '']
      .filter(Boolean)
      .join(' · '),
    group: index === 0 ? '教学过程' : undefined,
    movable: true,
  }))
  const tail: StructOutlineRow[] = [
    { key: 'blackboard', no: '板', title: '板书设计', meta: '课堂板书布局' },
    { key: 'reflection', no: '思', title: '教学反思', meta: '课后填写' },
  ]
  return [...fixed, ...steps, ...tail]
})

const structStat = computed(() => {
  const steps = doc.value?.plan?.steps ?? []
  return `${steps.length} 个环节 · 合计 ${totalMinutes.value} 分钟`
})

const structTarget = computed(() =>
  activeStep.value ? activeStep.value.title || PLAN_STEP_TEXT[activeStep.value.kind] : '',
)

const metaExtra = computed(() => `${doc.value?.plan?.periods ?? 1} 课时`)

function addStruct(key: string) {
  const plan = doc.value?.plan
  if (!plan) return
  const kind = key as PlanStepKind
  const step: PlanStep = {
    id: Date.now(),
    kind,
    title: PLAN_STEP_TEXT[kind],
    teacher: '',
    student: '',
    intent: '',
    minutes: 5,
    questionIds: [],
  }
  plan.steps.push(step)
  activeKey.value = `step:${step.id}`
  dirty.value = true
}

function removeStep(id: number) {
  const plan = doc.value?.plan
  if (!plan) return
  const index = plan.steps.findIndex((row) => row.id === id)
  if (index < 0) return
  plan.steps.splice(index, 1)
  activeKey.value = 'objectives'
  dirty.value = true
}

function moveStep(id: number, delta: number) {
  const plan = doc.value?.plan
  if (!plan) return
  const index = plan.steps.findIndex((row) => row.id === id)
  const target = index + delta
  if (index < 0 || target < 0 || target >= plan.steps.length) return
  const [row] = plan.steps.splice(index, 1)
  plan.steps.splice(target, 0, row)
  dirty.value = true
}

/** 大纲行上的上移 / 下移 / 删除（key 形如 `step:1712…`） */
function onOutlineAction(key: string, action: StructOutlineAction) {
  if (!key.startsWith('step:')) return
  const id = Number(key.slice(5))
  if (!Number.isFinite(id)) return
  if (action === 'remove') removeStep(id)
  else moveStep(id, action === 'up' ? -1 : 1)
}

const METHOD_POOL = ['讲授法', '探究式学习', '合作交流', '讲练结合', '归纳法', '演示实验', '错因分析', '分层教学']
const AID_POOL = ['多媒体课件', '几何画板', '实物教具', '实验器材', '导学案', '微课视频']

function setMethods(next: string[]) {
  if (doc.value?.plan) doc.value.plan.methods = next
}
function setAids(next: string[]) {
  if (doc.value?.plan) doc.value.plan.aids = next
}

const customMethod = ref('')
const customAid = ref('')

function addCustom(list: string[] | undefined, value: string, reset: () => void) {
  const text = value.trim()
  if (!list || !text) return
  if (!list.includes(text)) list.push(text)
  reset()
}

/** 结构化编辑：题目挂到当前环节上 */
function linkQuestion(questionId: number) {
  const step = activeStep.value
  if (!step) {
    showToast('请先选中一个教学环节，再关联题目', 'error')
    return
  }
  if (step.questionIds.includes(questionId)) {
    showToast('该题已在当前环节中', 'error')
    return
  }
  step.questionIds.push(questionId)
  dirty.value = true
}

function unlinkQuestion(questionId: number) {
  const step = activeStep.value
  if (!step) return
  step.questionIds = step.questionIds.filter((row) => row !== questionId)
  dirty.value = true
}

const itemOf = (id: number) => questions.value.find((row) => row.id === id)

/* ================= 版式（正式教案纸） ================= */

const layoutLabel = '教案纸'
const layoutHint = '按「教学设计」排成一份正式教案：三维目标 / 重难点 / 教学过程表 / 板书 / 反思'

/** 页数用不到，但版式里「一节课多少分钟」要显示出来 */
const totalText = computed(() => `共 ${doc.value?.plan?.periods ?? 1} 课时 · 环节合计 ${totalMinutes.value} 分钟`)
</script>

<template>
  <DocWorkbench
    v-if="doc"
    ref="workbench"
    v-model:mode="mode"
    v-model:dirty="dirty"
    v-model:active-key="activeKey"
    :doc="doc"
    kind="plan"
    :saving="saving"
    :publishing="publishing"
    :questions="questions"
    :struct-kinds="structKinds"
    :struct-outline="structOutline"
    :struct-target="structTarget"
    :struct-stat="structStat"
    :struct-outline-title="'教学设计'"
    :meta-extra="metaExtra"
    :layout-label="layoutLabel"
    :layout-hint="layoutHint"
    list-href="/teach/plan"
    @save="save"
    @publish="publish"
    @patch="onPatch"
    @add-struct="addStruct"
    @outline-action="onOutlineAction"
    @link-question="linkQuestion"
  >

    <!-- ============ 预览 → 版式：一份正式教案纸 ============ -->
    <template #layout>
      <div class="dl">
        <div class="dl-head">
          <h1 class="dl-title">{{ doc.name }}</h1>
          <p class="dl-sub">
            {{ doc.subject }} · {{ doc.grade }}<template v-if="doc.textbook"> · {{ doc.textbook }}</template>
            <template v-if="doc.chapter"> · {{ doc.chapter }}</template>
          </p>
          <p class="dl-note">{{ totalText }}</p>
        </div>

        <section v-if="doc.plan" class="dl-sec">
          <h2 class="dl-sec-h"><span class="dl-sec-no">一、</span>教学目标</h2>
          <p class="dl-kv"><b>知识与技能</b>{{ doc.plan.objectives.knowledge || '—' }}</p>
          <p class="dl-kv"><b>过程与方法</b>{{ doc.plan.objectives.process || '—' }}</p>
          <p class="dl-kv"><b>情感态度与价值观</b>{{ doc.plan.objectives.emotion || '—' }}</p>
        </section>

        <section v-if="doc.plan" class="dl-sec">
          <h2 class="dl-sec-h"><span class="dl-sec-no">二、</span>教学重点与难点</h2>
          <p class="dl-kv"><b>教学重点</b>{{ doc.plan.keyPoints || '—' }}</p>
          <p class="dl-kv"><b>教学难点</b>{{ doc.plan.hardPoints || '—' }}</p>
        </section>

        <section v-if="doc.plan" class="dl-sec">
          <h2 class="dl-sec-h"><span class="dl-sec-no">三、</span>教学方法与教具</h2>
          <p class="dl-kv"><b>教学方法</b>{{ doc.plan.methods.join('、') || '—' }}</p>
          <p class="dl-kv"><b>教具与媒体</b>{{ doc.plan.aids.join('、') || '—' }}</p>
        </section>

        <section v-if="doc.plan" class="dl-sec">
          <h2 class="dl-sec-h"><span class="dl-sec-no">四、</span>教学过程</h2>
          <table v-if="doc.plan.steps.length" class="dl-table">
            <!-- 列宽写死比例：教学过程表最怕「教师活动」被挤成一列细缝，而设计意图占掉半张纸 -->
            <colgroup>
              <col style="width: 16%" />
              <col style="width: 32%" />
              <col style="width: 26%" />
              <col style="width: 18%" />
              <col style="width: 8%" />
            </colgroup>
            <thead>
              <tr>
                <th>教学环节</th>
                <th>教师活动</th>
                <th>学生活动</th>
                <th>设计意图</th>
                <th>时长</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="step in doc.plan.steps" :key="step.id">
                <td>
                  <span class="dl-step-name">{{ step.title || PLAN_STEP_TEXT[step.kind] }}</span>
                  <div v-for="qid in step.questionIds" :key="qid" class="dl-q">
                    <p class="dl-q-head">【练】<RichTextViewer v-if="itemOf(qid)" :content="itemOf(qid)!.stem" tag="span" /></p>
                  </div>
                </td>
                <td><RichTextViewer v-if="step.teacher" :content="step.teacher" /><span v-else class="dl-empty">—</span></td>
                <td><RichTextViewer v-if="step.student" :content="step.student" /><span v-else class="dl-empty">—</span></td>
                <td>{{ step.intent || '—' }}</td>
                <td class="is-time">{{ step.minutes }}′</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="dl-blank">还没有教学环节。在「结构化编辑」里点上方「新增」添加。</p>
        </section>

        <section v-if="doc.plan" class="dl-sec">
          <h2 class="dl-sec-h"><span class="dl-sec-no">五、</span>板书设计</h2>
          <RichTextViewer v-if="doc.plan.blackboard" :content="doc.plan.blackboard" />
          <p v-else class="dl-empty">—</p>
        </section>

        <section v-if="doc.plan" class="dl-sec">
          <h2 class="dl-sec-h"><span class="dl-sec-no">六、</span>教学反思</h2>
          <RichTextViewer v-if="doc.plan.reflection" :content="doc.plan.reflection" />
          <p v-else class="dl-empty">（课后填写）</p>
        </section>

        <p v-if="!doc.plan && !toPlainText(doc.content ?? '')" class="dl-blank">
          这份教案还没有内容。<br />在「结构化编辑」里按环节写，或在「文案编辑」里写整篇。
        </p>
      </div>
    </template>

    <!-- ============ 结构化编辑中栏 ============ -->
    <template #struct-main>
      <!-- 三维目标 -->
      <section v-if="activeKey === 'objectives' && doc.plan" class="pl-card">
        <div class="pl-card-head"><span class="tag tag-blue">教学目标</span><b>三维教学目标</b></div>
        <label class="pl-field">
          <span>知识与技能</span>
          <textarea v-model="doc.plan.objectives.knowledge" rows="3" placeholder="学生能理解 / 掌握 / 运用什么" @input="dirty = true" />
        </label>
        <label class="pl-field">
          <span>过程与方法</span>
          <textarea v-model="doc.plan.objectives.process" rows="3" placeholder="通过什么活动、经历什么过程获得" @input="dirty = true" />
        </label>
        <label class="pl-field">
          <span>情感态度与价值观</span>
          <textarea v-model="doc.plan.objectives.emotion" rows="3" placeholder="体会什么思想、形成什么态度" @input="dirty = true" />
        </label>
      </section>

      <!-- 重难点 -->
      <section v-else-if="activeKey === 'points' && doc.plan" class="pl-card">
        <div class="pl-card-head"><span class="tag tag-blue">重点难点</span><b>教学重点与教学难点</b></div>
        <label class="pl-field">
          <span>教学重点</span>
          <textarea v-model="doc.plan.keyPoints" rows="4" placeholder="本节课必须落实的核心知识与能力" @input="dirty = true" />
        </label>
        <label class="pl-field">
          <span>教学难点</span>
          <textarea v-model="doc.plan.hardPoints" rows="4" placeholder="学生易错、难以理解的环节，并说明突破办法" @input="dirty = true" />
          <em class="pl-hint">难点要写「难在哪 + 怎么突破」，只写知识点等于没写。</em>
        </label>
      </section>

      <!-- 方法与教具 -->
      <section v-else-if="activeKey === 'method' && doc.plan" class="pl-card">
        <div class="pl-card-head"><span class="tag tag-blue">方法与教具</span><b>教学方法与教具媒体</b></div>
        <div class="pl-field">
          <AppFilterChips
            label="教学方法"
            label-width="72px"
            :options="METHOD_POOL"
            :model-value="doc.plan.methods"
            @update:model-value="setMethods"
          />
          <div class="pl-custom">
            <input
              v-model="customMethod"
              placeholder="自定义方法"
              @keyup.enter="addCustom(doc.plan.methods, customMethod, () => (customMethod = ''))"
            />
            <button class="mini-btn" @click="addCustom(doc.plan.methods, customMethod, () => (customMethod = ''))">添加</button>
          </div>
        </div>
        <div class="pl-field">
          <AppFilterChips
            label="教具与媒体"
            label-width="72px"
            :options="AID_POOL"
            :model-value="doc.plan.aids"
            @update:model-value="setAids"
          />
          <div class="pl-custom">
            <input
              v-model="customAid"
              placeholder="自定义教具"
              @keyup.enter="addCustom(doc.plan.aids, customAid, () => (customAid = ''))"
            />
            <button class="mini-btn" @click="addCustom(doc.plan.aids, customAid, () => (customAid = ''))">添加</button>
          </div>
        </div>
      </section>

      <!-- 教学环节 -->
      <section v-else-if="activeStep" class="pl-card">
        <div class="pl-card-head">
          <span class="tag tag-blue">{{ PLAN_STEP_TEXT[activeStep.kind] }}</span>
          <input v-model="activeStep.title" class="pl-input" style="max-width: 260px" placeholder="环节名称" @input="dirty = true" />
          <span class="pl-inline">
            时长
            <input v-model.number="activeStep.minutes" class="pl-num" type="number" min="1" max="90" @input="dirty = true" />
            分钟
          </span>
        </div>

        <div class="pl-field">
          <span>教师活动</span>
          <RichTextEditor
            v-model="activeStep.teacher"
            :subject="doc.subject"
            :min-height="130"
            placeholder="教师在这一环节做什么：提问、演示、点拨、板书…"
          />
        </div>
        <div class="pl-field">
          <span>学生活动</span>
          <RichTextEditor
            v-model="activeStep.student"
            :subject="doc.subject"
            :min-height="130"
            placeholder="学生做什么：思考、讨论、板演、练习…"
          />
        </div>
        <label class="pl-field">
          <span>设计意图</span>
          <textarea v-model="activeStep.intent" rows="3" placeholder="为什么这样设计：解决什么问题、达成什么目标" @input="dirty = true" />
        </label>

        <div class="pl-linked">
          <div class="pl-linked-head">
            <b>本环节题目</b>
            <span class="pl-hint">例题与练习从右侧「题库选题」加入</span>
          </div>
          <p v-if="!activeStep.questionIds.length" class="pl-hint">本环节尚未关联题目</p>
          <div v-for="(qid, qi) in activeStep.questionIds" :key="qid" class="pl-linked-row">
            <span class="tag tag-gray">{{ itemOf(qid)?.type ?? '题目' }}</span>
            <span class="pl-linked-stem">{{ qi + 1 }}. {{ truncateRich(itemOf(qid)?.stem ?? `题目 #${qid}`, 56) }}</span>
            <button class="mini-btn danger" @click="unlinkQuestion(qid)">移除</button>
          </div>
        </div>
      </section>

      <!-- 板书 -->
      <section v-else-if="activeKey === 'blackboard' && doc.plan" class="pl-card">
        <div class="pl-card-head"><span class="tag tag-blue">板书设计</span><b>课堂板书布局</b></div>
        <RichTextEditor
          v-model="doc.plan.blackboard"
          :subject="doc.subject"
          :min-height="280"
          placeholder="按左右分栏描述板书：左侧主板书（知识结构），右侧副板书（例题演算）"
        />
        <p class="pl-hint">板书要留得下、看得清，建议先画结构再填细节。</p>
      </section>

      <!-- 反思 -->
      <section v-else-if="activeKey === 'reflection' && doc.plan" class="pl-card">
        <div class="pl-card-head"><span class="tag tag-blue">教学反思</span><b>课后填写</b></div>
        <RichTextEditor
          v-model="doc.plan.reflection"
          :subject="doc.subject"
          :min-height="280"
          placeholder="目标达成情况、环节时间是否合理、学生的意外生成、下次改进点…"
        />
        <p class="pl-hint">反思建议结合考试 / 作业数据写，别写成流水账。</p>
      </section>

      <div v-else class="pl-card pl-empty">左侧选择要编辑的部分</div>
    </template>
    <!-- 工具带右侧：课时与超时提示。教案的「一节课装不放得下」是结构化编辑里唯一的算术。
         两处细节都是踩坑记下的，别顺手改：
         ① 内容包一层 `.pl-tools`：单根好排，也让这块与「已保存 / 字数」那组读数分开；
         ② 这个插槽刻意排在其它插槽**之后**。它原先紧跟组件开标签、前面还有一条注释，
            那个组合下编译器会把整个插槽静默丢掉（内容不进产物、无警告、vue-tsc 也不报，
            界面上就是「课时」输入框凭空消失）。挪到后面即恢复正常。 -->
    <template #struct-tools>
      <span class="pl-tools">
        <span class="pl-tool-label">课时</span>
        <input
          v-if="doc.plan"
          v-model.number="doc.plan.periods"
          class="pl-num"
          type="number"
          min="1"
          max="6"
          @input="dirty = true"
        />
        <span v-if="overTime" class="pl-warn">超出 {{ (doc.plan?.periods ?? 1) * 45 }} 分钟，建议压缩</span>
      </span>
    </template>
  </DocWorkbench>

  <!-- 载入中 / 找不到：都不该是一片空白 -->
  <div v-else class="pl-blank">
    <p v-if="loading">正在载入教案…</p>
    <template v-else>
      <p>没有找到这份教案（可能已被删除，或链接里的 id 不对）。</p>
      <button class="btn btn-primary" type="button" @click="router.push('/teach/plan')">回到教案列表</button>
    </template>
  </div>
</template>

<style scoped>
/* 结构化编辑的表单：一列铺开、限宽居中。骨架（三栏、面板、底栏）都在工作台里 */
.pl-card {
  max-width: 980px;
  margin: 0 auto 16px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 18px 20px;
}
.pl-card-head { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
.pl-empty { color: var(--sub); font-size: 13px; text-align: center; padding: 40px; }

.pl-field { display: block; margin-bottom: 14px; }
.pl-field > span { display: block; font-size: 12.5px; font-weight: 600; color: var(--ink-2); margin-bottom: 6px; }
.pl-field textarea,
.pl-input,
.pl-custom input {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 8px 11px;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.7;
  color: var(--ink);
  background: #fff;
  resize: vertical;
}
.pl-field textarea:focus,
.pl-input:focus,
.pl-custom input:focus {
  outline: none;
  border-color: var(--brand);
  box-shadow: 0 0 0 3px var(--brand-soft);
}
.pl-inline { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--ink-2); }
.pl-num {
  width: 58px;
  height: 30px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0 8px;
  font-family: inherit;
  font-size: 13px;
  color: var(--ink);
  text-align: center;
  background: #fff;
}
.pl-num:focus { outline: none; border-color: var(--brand); box-shadow: 0 0 0 3px var(--brand-soft); }
.pl-tools { display: inline-flex; align-items: center; gap: 6px; }
.pl-tool-label { font-size: 12px; color: var(--sub); }
.pl-warn { font-size: 12px; color: var(--warn); font-weight: 600; }

.pl-custom { display: flex; gap: 8px; margin-top: 8px; }
.pl-custom input { flex: 1; min-width: 0; height: 32px; padding: 0 11px; }

.pl-linked { margin-top: 16px; padding-top: 14px; border-top: 1px dashed var(--border); }
.pl-linked-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; font-size: 13px; flex-wrap: wrap; }
.pl-linked-row {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 8px 10px;
  margin-bottom: 6px;
  background: #fbfdfd;
}
.pl-linked-stem { flex: 1; min-width: 0; font-size: 12.5px; color: var(--ink-2); }

.pl-hint { font-size: 11.5px; color: var(--sub); line-height: 1.7; font-style: normal; }

.pl-blank {
  height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  font-size: 13px;
  color: var(--sub);
  background: var(--bg);
}
</style>
