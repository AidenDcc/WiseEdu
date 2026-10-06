<script setup lang="ts">
/**
 * 智能组卷（FR-PP-008/009）：左边知识点树，右边三步，底部「开始组卷」。
 *
 * 版式与试卷库 / 题库管理对齐（左树 272px 内部滚动、右栏自身滚动）。三步是**堆叠的三段**
 * 而不是一次显示一步的向导：知识点树在三段里都要看得见，做成向导的话第二步开始左树就成了
 * 摆设；三段同屏也才看得清「第一步选的知识点」与「第三步配的题型」是不是一回事。
 *
 * 「我的模板」不占三段里的一格，收在右侧抽屉里，入口按钮排在「开始组卷」左边：它是可选
 * 的抄近路动作（套用一套参数），不是流程里的一步 —— 但入口得摆在提交前，用户才会在按下
 * 开始组卷之前想起「上次那套参数挺好，直接用」。
 *
 * 两个维度的分量不同，是本页最要紧的口径（实现在 org-store 的 aiComposePaper）：
 * - **知识点是硬条件** —— 命中它的题一律排在未命中的之前；
 * - **考试类型 / 难度 / 地区 / 年份是「优先」** —— 只影响排序。全做成过滤的话，
 *   「困难 + 2022 年」这种组合基本必然空卷，而产品原话就是「优先地区」「优先年份」。
 *
 * 「试卷名称」不在三步里（产品给的三步没有这一步），但它落库与存文件都要用，因此放到
 * 点「开始组卷」后弹出的存储位置弹窗里，并按年级学科知识点预填一个可改的名字。
 *
 * 出卷后直接进试卷编辑页，编辑页开在**新标签页**，本页留在原地可以接着组下一份
 * （见 utils/paper-edit.ts）。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { AppDrawer, AppFilterChips, AppIcon, AppModal, appConfirm, showToast } from '@aiteach/shared'
import type { AiComposeParams, AiComposeTemplate, OrgPaper } from '@aiteach/shared'
import { EARLIER_YEAR } from '@aiteach/shared'
import {
  aiComposePaper,
  deleteAiComposeTemplate,
  fetchAiComposeTemplates,
  fetchPapers,
  fetchTenantDict,
} from '@/api/org'
import { useBaseData } from '@/composables/useBaseData'
import KnowledgePicker from '@/components/compose/KnowledgePicker.vue'
import FolderPickerDialog from '@/components/file/FolderPickerDialog.vue'
import { openBlankTab, openPaperEdit, paperEditHref } from '@/utils/paper-edit'
import { paperYearOptions, yearOptionLabels } from '@/utils/paper-years'

const router = useRouter()
const { subjects, grades, difficulties, examTypes, questionTypesFor, ensure, pick, withCurrent } = useBaseData()

/** 三步共用一份表单：模板「复用」回写的也是它 */
const form = reactive({
  grade: '高一',
  subject: '数学',
  /** 知识点 tag：硬条件，没选不让提交 */
  knowledge: [] as string[],
  /** 以下四维都是「优先」，空串 = 不限 */
  examType: '',
  difficulty: '',
  region: '',
  year: '',
  structure: [{ type: '单选', count: 10 }] as Array<{ type: string; count: number }>,
})

const totalCount = computed(() => form.structure.reduce((sum, row) => sum + (row.count || 0), 0))

/* ===== 候选项 ===== */

/**
 * 优先地区 = 字典里的地区，但显式把「全国」提到最前。
 * 字典种子本来就把全国排在第一（sort=1），这里再保证一次：管理员调过字典顺序后，
 * 「全国」也得在第一位 —— 它是这一行里最常点的一项（= 不偏袒任何地区）。
 */
const regionOptions = ref<string[]>(['全国'])

/**
 * 优先年份与试卷筛选同一份实现（见 utils/paper-years）：
 * 档位取自**已入库的卷池**，所以「优先 2025 年」和「试卷库筛 2025 年」说的必然是一批卷。
 */
const approvedPapers = ref<OrgPaper[]>([])
const yearOptions = computed(() => paperYearOptions(approvedPapers.value))

async function loadOptions() {
  await Promise.all([ensure(), loadTemplates(), loadPapers()])
  form.subject = pick(subjects.value, form.subject)
  form.grade = pick(grades.value, form.grade)
  /* 初次给一个该学科真实存在的题型（英语有完形填空、七选五这类专属项） */
  form.structure.forEach((row) => {
    row.type = pick(questionTypesFor(form.subject), row.type)
  })
  const regions = await fetchTenantDict('region')
  regionOptions.value = ['全国', ...regions.map((row) => row.name).filter((name) => name !== '全国')]
}

async function loadPapers() {
  approvedPapers.value = (await fetchPapers()).filter((row) => row.status === 'approved')
}

/* ===== 我的模板（右侧抽屉） ===== */

const templates = ref<AiComposeTemplate[]>([])
const templatesOpen = ref(false)

async function loadTemplates() {
  templates.value = await fetchAiComposeTemplates()
}

/** 一套参数的一句话摘要：确认弹窗与模板行共用，两处的说法该是同一句 */
function paramsSummary(params: Omit<AiComposeParams, 'name' | 'folderId'>): string {
  const parts = [`${params.grade}${params.subject}`, `${params.knowledge.length} 个知识点`]
  if (params.examType) parts.push(params.examType)
  if (params.difficulty) parts.push(params.difficulty)
  if (params.region) parts.push(`优先${params.region}`)
  if (params.year) parts.push(`优先${params.year === EARLIER_YEAR ? '更早以前' : `${params.year} 年`}`)
  parts.push(params.structure.map((row) => `${row.type} ${row.count} 题`).join(' + '))
  return parts.join(' · ')
}

/**
 * 复用模板：把参数写回三步表单。
 *
 * `grade` / `subject` 先写、`knowledge` 后写，中间隔一个 `nextTick`：学科一变，
 * `KnowledgePicker` 会去拉新树，并**把新树里不存在的已选标签摘掉**（见其 `nodes` watch）。
 * 同一个 tick 里写完，等于让「刚套用上的标签」和「树换新」挤在一拍里比先后，
 * 顺序读起来就不再是确定的。隔一拍是让「换了树、再填值」这个先后关系显式成立。
 */
async function applyTemplate(tpl: AiComposeTemplate) {
  const scopeChanged = form.grade !== tpl.grade || form.subject !== tpl.subject
  form.grade = tpl.grade
  form.subject = tpl.subject
  if (scopeChanged) await nextTick()
  form.knowledge = [...tpl.knowledge]
  form.examType = tpl.examType
  form.difficulty = tpl.difficulty
  form.region = tpl.region
  form.year = tpl.year
  form.structure = tpl.structure.map((row) => ({ ...row }))
  showToast(`已套用模板《${tpl.name}》，可直接开始组卷`)
}

async function removeTemplate(tpl: AiComposeTemplate) {
  if (!(await appConfirm(`删除模板《${tpl.name}》？`, { type: 'danger' }))) return
  await deleteAiComposeTemplate(tpl.id)
  await loadTemplates()
  showToast('已删除模板', 'success')
}

/** 抽屉里点「复用」：套用参数后**关掉抽屉** —— 参数已经写回三步表单，抽屉再挡着就看不见了 */
function reuseTemplate(tpl: AiComposeTemplate) {
  templatesOpen.value = false
  void applyTemplate(tpl)
}

/* ===== 第三步：题型与题量 ===== */

function addStructure() {
  const options = questionTypesFor(form.subject)
  const used = new Set(form.structure.map((row) => row.type))
  /* 优先挑一个还没用过的题型：连点两次「添加题型」长出两行一样的，多半不是用户想要的 */
  form.structure.push({ type: options.find((type) => !used.has(type)) ?? options[0] ?? '单选', count: 5 })
}

/* ===== 单选 chip 行的 v-model 适配（chip 要数组，表单里是字符串） ===== */

/**
 * 年级 / 学科是**必选**，没有「不限」这一档，所以不吃 `AppFilterChips` 单选时的
 * 「再点一下 = 清空」语义（那是筛选条上用来表示「全部」的）—— 空回传直接忽略，
 * 表单值不动，chip 因此也保持染色。真清空了左树会拿不到年级/学科，整页失去作用域。
 */
function onGrade(value: string[]) {
  if (value[0]) form.grade = value[0]
}
function onSubject(value: string[]) {
  if (value[0]) form.subject = value[0]
}
function onExamType(value: string[]) {
  form.examType = value[0] ?? ''
}
function onDifficulty(value: string[]) {
  form.difficulty = value[0] ?? ''
}
function onRegion(value: string[]) {
  form.region = value[0] ?? ''
}
function onYear(value: string[]) {
  form.year = value[0] ?? ''
}

/* ===== 开始组卷：先选存储位置，再跑进度 ===== */

const pickerOpen = ref(false)
const paperName = ref('')
/** 上一次选的目录：连组几份时默认落在同一个文件夹（弹窗里仍可改） */
const targetFolder = ref<number | null>(null)

const progressOpen = ref(false)
const progress = ref(0)
const busy = ref(false)
let timer: number | undefined

/**
 * 按年级学科知识点预填一个可改的卷名 —— 三步里没有「填名称」这一步，但落库必须有名字。
 * 日期走本地时区：`toISOString()` 是 UTC，晚上八点之后组卷会显示成第二天。
 */
function defaultName() {
  const focus = form.knowledge.length > 1 ? `${form.knowledge[0]}等` : form.knowledge[0]
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return `${form.grade}${form.subject} · ${focus} 智能组卷（${today}）`
}

function startCompose() {
  if (!form.grade || !form.subject) {
    showToast('请选择年级与学科', 'error')
    return
  }
  if (!form.knowledge.length) {
    showToast('请先从左侧知识点树中选择至少一个知识点', 'error')
    return
  }
  if (form.structure.length === 0 || form.structure.some((row) => !row.count || row.count < 1)) {
    showToast('每个题型的题数须 ≥1', 'error')
    return
  }
  paperName.value = defaultName()
  pickerOpen.value = true
}

/**
 * 存储位置弹窗里点「开始组卷」。
 *
 * `openBlankTab()` 必须在**这一个用户手势里同步**调用：真正的出卷要 await，
 * 等结果回来再开新标签页，手势已经过期，浏览器会当成弹窗拦掉（同 utils/paper-edit 的说明）。
 * 名称校验放在占坑之前，免得校验不过白留一个空白页。
 */
async function confirmCompose(folderId: number) {
  const name = paperName.value.trim()
  if (name.length < 2 || name.length > 50) {
    showToast('试卷名称需 2-50 字', 'error')
    return
  }
  pickerOpen.value = false
  const tab = openBlankTab()
  busy.value = true
  progressOpen.value = true
  progress.value = 0
  timer = window.setInterval(() => {
    progress.value = Math.min(97, progress.value + 6 + Math.round(Math.random() * 8))
  }, 260)
  try {
    const { paper, aiPicked } = await aiComposePaper({ ...form, name, folderId })
    progress.value = 100
    /* 组卷成功时 mock 已经记了一条模板，回读一次让列表立刻能看到 */
    await loadTemplates()
    /* 停一下再跳：进度条刚满就切页，用户看不到「完成」这一帧 */
    await new Promise((resolve) => window.setTimeout(resolve, 320))
    progressOpen.value = false
    const count = paper.sections.reduce((sum, section) => sum + section.questions.length, 0)
    showToast(
      aiPicked > 0
        ? `组卷完成：${count} 题入卷，${aiPicked} 题因题库不足由 AI 新生成补足，已存入「我的文件」`
        : `组卷完成：${count} 题，已存入「我的文件」`,
      'success',
    )
    /* 编辑页开新标签页，本页留在原地可以接着组下一份；万一被拦了退回同页签，不能让老师点了没反应 */
    if (!openPaperEdit(paper.id, tab)) router.push(paperEditHref(paper.id))
    /* 这一次的卷名不复用：下一份卷该有自己的名字 */
    paperName.value = ''
  } catch (error) {
    /* 组卷失败就把那个空白页关掉 */
    tab?.close()
    progressOpen.value = false
    showToast(error instanceof Error ? error.message : '智能组卷失败', 'error')
  } finally {
    clearTimer()
    busy.value = false
  }
}

function clearTimer() {
  if (timer != null) window.clearInterval(timer)
  timer = undefined
}

/** 组卷中不给关：进度条走到一半被 Esc 关掉，用户会以为组卷也跟着停了 */
function onProgressClose() {
  if (!busy.value) progressOpen.value = false
}

onMounted(() => {
  void loadOptions()
})

onBeforeUnmount(clearTimer)
</script>

<template>
  <div class="ai-layout">
    <!-- 左：知识点树。已选知识点不在这里显示 —— 它回显在右侧第一步里（见 KnowledgePicker 的 hideSelected） -->
    <aside class="panel kp-panel">
      <div class="kp-head">知识点</div>
      <KnowledgePicker
        fill
        hide-selected
        :model-value="form.knowledge"
        :subject="form.subject"
        :grade="form.grade"
        @update:model-value="form.knowledge = $event"
      />
    </aside>

    <div class="right-col">
      <!-- 第一步：年级 / 学科 / 知识点 -->
      <section class="panel step">
        <h3 class="step-head"><span class="step-no">1</span>选择知识点</h3>
        <div class="step-body">
          <!-- 年级 / 学科用 chip 单选：与第二步四行同一种控件、同一列宽，整页只有一种「选一项」
               的样子。年级 12 项会折成两行 —— 比下拉表好，一眼能看全自己教的学段 -->
          <div class="chip-rows">
            <AppFilterChips
              label="年级"
              :options="grades"
              :model-value="form.grade ? [form.grade] : []"
              :multiple="false"
              @update:model-value="onGrade"
            />
            <AppFilterChips
              label="学科"
              :options="subjects"
              :model-value="form.subject ? [form.subject] : []"
              :multiple="false"
              @update:model-value="onSubject"
            />
          </div>

          <div class="f-field">
            <label class="f-label">知识点<span class="req">*</span></label>
            <div v-if="form.knowledge.length" class="kp-chips">
              <button
                v-for="tag in form.knowledge"
                :key="tag"
                class="kp-chip"
                type="button"
                @click="form.knowledge = form.knowledge.filter((item) => item !== tag)"
              >
                {{ tag }}
                <AppIcon name="close" :size="11" />
              </button>
              <button class="kp-clear" type="button" @click="form.knowledge = []">清空</button>
            </div>
            <p v-else class="f-hint">
              请从左侧知识点树中选择。点到分类节点会选中它下面的全部知识点，个别不要的可以在这里单独删掉。
            </p>
          </div>
        </div>
      </section>

      <!-- 第二步：组卷设置（四行都是「优先」，不是过滤） -->
      <section class="panel step">
        <h3 class="step-head"><span class="step-no">2</span>组卷设置</h3>
        <div class="step-body chip-rows">
          <!-- 考试类型取自字典全量，**不按学段学科收窄**：产品要求「展示所有的考试类型」。
               与试卷库 / 组卷工作台的左树口径不同，那两处是按学段学科收窄的。
               14 项必然超过一行，所以与地区一样收起 —— 全量是「选项里有」，不必「一次全摊开」 -->
          <AppFilterChips
            label="考试类型"
            :options="examTypes"
            :model-value="form.examType ? [form.examType] : []"
            :multiple="false"
            collapsible
            @update:model-value="onExamType"
          />
          <AppFilterChips
            label="题目难度"
            :options="difficulties"
            :model-value="form.difficulty ? [form.difficulty] : []"
            :multiple="false"
            @update:model-value="onDifficulty"
          />
          <!-- 地区 35 项一行放不下：收起态只留一行 -->
          <AppFilterChips
            label="优先地区"
            :options="regionOptions"
            :model-value="form.region ? [form.region] : []"
            :multiple="false"
            collapsible
            @update:model-value="onRegion"
          />
          <AppFilterChips
            label="优先年份"
            :options="yearOptions"
            :option-labels="yearOptionLabels(yearOptions)"
            :model-value="form.year ? [form.year] : []"
            :multiple="false"
            @update:model-value="onYear"
          />
          <p class="f-hint">
            这四项只影响「优先抽哪些题」，题量不足时会自动放宽 —— 不会因为这些条件而抽不出题。
          </p>
        </div>
      </section>

      <!-- 第三步：试题设置（只有题型与题量，分值由系统按题型分配） -->
      <section class="panel step">
        <h3 class="step-head">
          <span class="step-no">3</span>试题设置
          <!-- 添加按钮放标题行右侧：它作用的是**整块**题型列表，跟着最后一行往下走会随行数
               一直挪位置，越加越找不着 -->
          <button
            class="btn btn-ghost btn-sm step-action"
            type="button"
            :disabled="form.structure.length >= 8"
            @click="addStructure"
          >
            <AppIcon name="plus" :size="14" /> 添加题型
          </button>
        </h3>
        <div class="step-body">
          <div v-for="(row, index) in form.structure" :key="index" class="struct-row">
            <select v-model="row.type" class="f-select" style="width: 132px">
              <!-- 题型随学科收窄（英语才有完形填空 / 七选五）；已选值并入，换学科不会渲染成空白 -->
              <option v-for="type in withCurrent(questionTypesFor(form.subject), row.type)" :key="type" :value="type">
                {{ type }}
              </option>
            </select>
            <input v-model.number="row.count" type="number" min="1" max="50" class="f-input" style="width: 86px" />
            <span class="f-hint">题</span>
            <button
              class="mini-btn danger"
              type="button"
              :disabled="form.structure.length <= 1"
              @click="form.structure.splice(index, 1)"
            >
              删除
            </button>
          </div>
          <p class="f-hint">共 {{ totalCount }} 题，单题分值由系统按题型自动分配。</p>
        </div>
      </section>

      <div class="form-actions">
        <!-- 我的模板排在「开始组卷」前面：先有机会抄近路，再提交 -->
        <button class="btn btn-ghost" type="button" @click="templatesOpen = true">
          <AppIcon name="layers" :size="15" /> 我的模板
          <span v-if="templates.length" class="tpl-badge">{{ templates.length }}</span>
        </button>
        <button class="btn btn-primary" :disabled="busy" @click="startCompose">
          <AppIcon name="sparkles" :size="15" /> 开始组卷
        </button>
      </div>
    </div>

    <!-- 我的模板：每次组卷成功自动记一条，只展示 / 只可删自己的。右侧抽屉 -->
    <AppDrawer
      v-if="templatesOpen"
      title="我的模板"
      subtitle="每次组卷成功后自动记录一条；点「复用」把参数填回三步表单"
      :width="560"
      @close="templatesOpen = false"
    >
      <p v-if="templates.length === 0" class="f-hint">还没有模板，组卷成功后会自动记一条，下次可以一键复用。</p>
      <!-- v-for 与 v-else 不放在同一元素上：Vue 3 里两者同处一个元素会让条件与循环的先后关系变得难读 -->
      <div v-else class="tpl-list">
        <div v-for="tpl in templates" :key="tpl.id" class="tpl-row">
          <div class="tpl-main">
            <div class="tpl-name">{{ tpl.name }}</div>
            <div class="tpl-meta">{{ paramsSummary(tpl) }}</div>
          </div>
          <span class="tpl-count">组卷 {{ tpl.useCount }} 次</span>
          <button class="mini-btn" type="button" @click="reuseTemplate(tpl)">复用</button>
          <button class="mini-btn danger" type="button" @click="removeTemplate(tpl)">删除</button>
        </div>
      </div>
    </AppDrawer>

    <!-- 存储位置 + 试卷名称：点「开始组卷」后才出现，选完位置即开跑 -->
    <FolderPickerDialog
      v-if="pickerOpen"
      title="开始智能组卷"
      confirm-text="开始组卷"
      :model-value="targetFolder"
      @update:model-value="targetFolder = $event"
      @confirm="confirmCompose"
      @close="pickerOpen = false"
    >
      <div class="f-field">
        <label class="f-label">试卷名称<span class="req">*</span>（2-50 字）</label>
        <input v-model="paperName" class="f-input" maxlength="50" />
      </div>
      <p class="f-hint">本次参数：{{ paramsSummary(form) }}</p>
    </FolderPickerDialog>

    <!-- 组卷进度：mock 是同步返回、没有中间回报，这里按仓库既有的做法跑假进度
         （见 CreateView 的 AI 出题、FileView 的文档识别），到 97% 等接口返回再补满 -->
    <AppModal v-if="progressOpen" title="AI 正在组卷" :width="520" :close-on-mask="false" @close="onProgressClose">
      <div class="pipeline">
        <span class="pl-step done">解析知识点</span>
        <span class="pl-arrow">→</span>
        <span class="pl-step" :class="{ done: progress > 30 }">检索题库</span>
        <span class="pl-arrow">→</span>
        <span class="pl-step" :class="{ done: progress > 60 }">难度配比</span>
        <span class="pl-arrow">→</span>
        <span class="pl-step" :class="{ done: progress > 85 }">生成卷面</span>
      </div>
      <div class="progress-track"><div class="progress-fill" :style="{ width: `${progress}%` }" /></div>
      <p class="f-hint">
        {{ progress < 100 ? `${Math.round(progress)}% · 正在按知识点从题库中抽题` : '整理卷面，即将打开编辑页…' }}
      </p>
      <p class="f-hint">{{ paramsSummary(form) }}</p>
    </AppModal>
  </div>
</template>

<style scoped>
/* ===== 左右两栏 =====
   高度随屏幕动态撑满内容区（顶栏 62 + 内容区上下内边距 44），左树内部滚动、右栏自身滚动。
   取值与试卷库的 .paper-layout 逐项一致，两页并排切换才不跳。 */
.ai-layout {
  --content-h: calc(100vh - 106px);
  display: flex;
  gap: 14px;
  align-items: stretch;
  height: var(--content-h);
  min-height: 480px;
}
/* 列宽与 KnowledgeFilter 的 .tree-panel 对齐（272px），两棵树并排切换时宽度不跳 */
.kp-panel {
  width: 272px;
  flex-shrink: 0;
  height: 100%;
  padding: 12px;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.kp-head {
  font-size: 13px;
  font-weight: 700;
  color: var(--ink);
  padding: 2px 4px 10px;
  flex-shrink: 0;
}

.right-col {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
}

/* ===== 三步 ===== */
.step { padding: 16px 18px; flex-shrink: 0; }
.step-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 700;
  color: var(--ink);
  margin-bottom: 12px;
}
.step-no {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--brand);
  color: #fff;
  font-size: 12px;
}
/* 标题行右侧的动作（第三步的「添加题型」）：推到行尾，且不吃标题的字号与字重 */
.step-action { margin-left: auto; flex-shrink: 0; font-weight: 600; }
.step-body { display: flex; flex-direction: column; gap: 12px; }
/* 步骤体自己用 gap 控间距，字段自带的 16px 下边距会与它叠加（最后一行还会多顶出面板底边） */
.step-body .f-field { margin-bottom: 0; }
/* 一组 chip 行：第二步直接长在 .step-body 上（本来就是 flex 列），第一步则用它包住
   年级 / 学科两行 —— 不写成 flex 的话这两行是普通块级兄弟，行与行之间没有任何间隔 */
.chip-rows { display: flex; flex-direction: column; gap: 9px; }

/* 已选知识点：与 KnowledgePicker 里的那排 chip 同款观感（同一批值，两处样式不该各长一样） */
.kp-chips { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.kp-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--brand);
  border-radius: 999px;
  background: var(--brand-soft);
  color: var(--brand-deep);
  font-size: 12px;
  font-weight: 600;
  padding: 2px 9px;
}
.kp-chip:hover { background: #fff; }
.kp-clear {
  border: none;
  background: none;
  color: var(--sub);
  font-size: 11.5px;
  text-decoration: underline;
  padding: 0 2px;
}
.kp-clear:hover { color: var(--danger); }

.struct-row { display: flex; align-items: center; gap: 8px; }
/* 横向居中的行里，f-hint 自带的 5px 上边距会把文字顶歪 */
.struct-row .f-hint { margin-top: 0; }

.form-actions { display: flex; justify-content: flex-end; gap: 10px; flex-shrink: 0; }

/* ===== 我的模板（抽屉） ===== */
.tpl-list { display: flex; flex-direction: column; gap: 10px; }
/* 按钮上的条数：做了几条模板不点开也要看得见，否则「有没有可复用的」得点进去才知道。
   与左侧文字的间距由 .btn 的 gap 给，这里不再加外边距 */
.tpl-badge {
  font-size: 11.5px;
  font-weight: 700;
  color: var(--brand-deep);
  background: var(--brand-soft);
  border-radius: 999px;
  padding: 1px 7px;
}
.tpl-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
}
.tpl-row:hover { border-color: var(--brand); }
.tpl-main { flex: 1; min-width: 0; }
.tpl-name { font-size: 13px; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tpl-meta { font-size: 12px; color: var(--sub); margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tpl-count {
  flex-shrink: 0;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--brand-deep);
  background: var(--brand-soft);
  border-radius: 999px;
  padding: 3px 9px;
}

/* ===== 组卷进度 ===== */
/* 步骤条与进度条取值照抄 CreateView 的 AI 出题（同一套观感，仓库里没有可复用的组件） */
.pipeline { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
.pl-step {
  font-size: 12.5px;
  color: var(--sub);
  border: 1.5px solid var(--border);
  border-radius: 999px;
  padding: 4px 12px;
}
.pl-step.done { border-color: var(--brand); color: var(--brand-deep); background: var(--brand-soft); }
.pl-arrow { color: var(--sub); }
.progress-track { height: 8px; border-radius: 999px; background: var(--border); overflow: hidden; }
.progress-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--brand), var(--brand-deep));
  transition: width 0.25s;
}
</style>
