<script setup lang="ts">
/**
 * 题目编辑：一道题的完整编辑表单（题目基本信息 + 题干 / 选项 / 答案 / 解析 / 来源备注）。
 *
 * 抽出来的原因：录题中心的「手动录入」是全站唯一一处完整编辑器，另外两个入口要用同一套能力时
 * 各自长出了更弱的替代品 —— AI 出题的「编辑后采纳」其实是把生成题回填进手动表单再切标签，
 * 拍照识别的「编辑」只能改学科/年级/题干/选项/答案/解析（识别结果明明带着难度与知识点，
 * 却既改不了也存不下去）。三处从此共用这一个组件。
 *
 * **`draft` 是父级持有的同一个 reactive 对象，这里就地改字段，不自己持一份 state。**
 * 理由是父级要在编辑过程中实时读它：录题中心的顶部栏 scope 联动、AI 检测的输入快照、
 * 学生视角预览、保存入参，读的都是同一个对象；自持 state 就得再镜像一份，必然漂移。
 * 弹窗场景（AI 结果 / 拍照识别）由调用方在打开时新建一份草稿，取消即丢弃，不需要回滚机制。
 *
 * 校验留在这里而不是全提成纯函数：`collectDraftErrors` 本身是纯的，但「解析为空要弹一次确认」
 * 与「基本信息红字在收起态看不见、失败时强制展开」是界面的事，所以 errors 由本组件持有，
 * 只对外暴露 `validate()`。同理 `appConfirm` 一律留在组件里，纯逻辑层不弹窗。
 *
 * ## 题目类别（独立单题 / 材料组合题）
 *
 * 「题目类别」是基本信息面板里的第一行（排在年级前面）—— 它决定**下面那半页长什么样**：
 * - 独立单题：题型取该学科的全部题型，正文就是一道题的题干 / 选项 / 答案 / 解析；
 * - 材料组合题：题型收窄为「材料组合题型」，正文换成「共用题干 / 材料」+「子题」两块
 *   （见 MaterialCompositePanel），子题自己的题型只从「独立单题」题型里取。
 *
 * 两个类别的正文**各自留在草稿里**（`stem` 与 `material` / `subQuestions` 互不覆盖），
 * 来回切不丢已经写好的内容；存库时按类别收口，见 `questionPayloadOf`。
 */
import { computed, ref, watch } from 'vue'
import {
  AppFilterPanel,
  appConfirm,
  QUESTION_CATEGORY_OPTIONS,
  QUESTION_SOURCE_OPTIONS,
} from '@aiteach/shared'
import type { FilterRowDef, QuestionCategory, QuestionSource } from '@aiteach/shared'
import KnowledgeRow from './KnowledgeRow.vue'
import MaterialCompositePanel from './MaterialCompositePanel.vue'
import QuestionBodyFields from './QuestionBodyFields.vue'
import { useBaseData } from '@aiteach/business-common'
import {
  collectDraftErrors,
  emptySubQuestionDraft,
  hasContent,
  isCompositeDraft,
  MAX_KNOWLEDGE,
  nextSubQuestionId,
  pickCategoryType,
  resetBodyStructure,
  setDraftGrade,
} from '@/utils/question-draft'
import type { QuestionDraft } from '@/utils/question-draft'

/** 基本信息面板里可出现的行 */
export type MetaRowKey =
  | 'category'
  | 'grade'
  | 'subject'
  | 'type'
  | 'difficulty'
  | 'term'
  | 'examType'
  | 'source'
  | 'textbook'

const props = withDefaults(
  defineProps<{
    /** 父级的同一个对象，就地修改（父级在编辑过程中也要读它，不能是副本） */
    draft: QuestionDraft
    /**
     * `edit` = 完整编辑（含正文），`params` = 只摆基本信息当出题参数。
     * 两者差的不只是「有没有正文」：参数态切题型**不能**动选项结构、也不该弹那句清空确认。
     */
    mode?: 'edit' | 'params'
    /** 覆盖基本信息的行集合；缺省按 mode 给一套 */
    rows?: MetaRowKey[]
  }>(),
  { mode: 'edit' },
)

const emit = defineEmits<{
  /** 草稿被改动（父级拿它置脏标记 / 标记「有未保存的修改」）。
      表单里每一处写入都要冒泡，否则父级的「未保存改动」确认会漏报 */
  change: []
}>()

/* 父级按约定始终持有同一个对象（录题中心的 form 只被 Object.assign 就地改写，
   弹窗场景每次打开都重新挂载本组件），故这里缓存引用即可，属性访问仍是响应式的。 */
const draft = props.draft

const {
  grades,
  questionTypesFor,
  difficulties,
  examTypes,
  versionsFor,
  optionsForGrade,
  withCurrent,
  optionLabel,
  pick,
} = useBaseData()

/** 学期保留短名，与题目 question.term 的存储形式一致（字典里的 term 是「2025-2026 上学期」全名） */
const TERMS = ['上学期', '下学期']

/* ===== 基本信息面板的行集合 =====
   录题中心手动态与「编辑入库」弹窗要全量行；AI 出题标签页只该给四个必填项 ——
   学期 / 考试类型 / 来源 / 教材版本影响不到出题参数，摆出来只会让人以为改了有用。
   拍照识别弹窗显式传 rows：识别结果不带学期 / 教材版本，摆了也存不下去。 */
const EDIT_ROWS: MetaRowKey[] = ['category', 'grade', 'subject', 'type', 'difficulty', 'term', 'examType', 'source', 'textbook']
const PARAMS_ROWS: MetaRowKey[] = ['grade', 'subject', 'type', 'difficulty']

const activeRows = computed(() => props.rows ?? (props.mode === 'params' ? PARAMS_ROWS : EDIT_ROWS))
const hasRow = (key: MetaRowKey) => activeRows.value.includes(key)

/* ===== 题目类别 ===== */

/** 材料组合题：正文换成「材料 + 子题」两块，作答单位是子题 */
const composite = computed(() => isCompositeDraft(draft))

/** 母题的可选题型：按类别 + 学科收窄（材料组合题只列材料组合题型） */
const typeOptions = computed(() => questionTypesFor(draft.subject, draft.category))

/** 子题的可选题型：**只含「独立单题」类别**（组合题里再套组合题在卷面上没有意义） */
const subTypeOptions = computed(() => questionTypesFor(draft.subject, '独立单题'))

/* ===== 题型与作答结构 ===== */

/**
 * 换题型确认用的「上一次题型」，用户取消时把 draft.type 退回去。
 *
 * 补一条 watch 是必须的：以前页面上的 `applyDraft`（AI 生成题回填）会显式回写它，
 * 现在回填改走弹窗、不再经过表单，没人告诉这里题型变了 —— 不补的话「取消」会退回旧题型。
 *
 * 不加 immediate：初值就是 draft 载入时的题型，watch 只管**之后**的变化。
 * 时序也是安全的：pickType 先改 draft.type 再同步调 onTypeChange，而 watch 的回调要等刷新；
 * 若用户取消了确认，回调触发前值已经退回 lastType，新旧相等，直接跳过。
 */
let lastType = draft.type
watch(() => props.draft.type, (type) => {
  lastType = type
})

async function onTypeChange() {
  if (hasContent(draft.stem) || draft.options.some((opt) => hasContent(opt))) {
    if (!(await appConfirm('切换题型将清空选项结构，确认切换？', { type: 'danger' }))) {
      draft.type = lastType
      return
    }
  }
  resetBodyStructure(draft, draft.type)
}

/**
 * 换学科后，原来的学科专属题型可能已不适用（英语的「完形填空」切到数学）——
 * 静默落回该学科（同类别）的通用题型并重建作答结构，不弹确认：切学科本身就是用户主动做的动作。
 */
watch(() => draft.subject, (subject) => {
  const options = questionTypesFor(subject, draft.category)
  if (!options.length || options.includes(draft.type)) return
  draft.type = pick(options, draft.type)
  /* 组合题没有作答结构可清（选项 / 答案都在子题里），重建会把独立单题那份草稿一起抹掉 */
  if (!composite.value) resetBodyStructure(draft, draft.type)
})

/** chip 版题型切换：点当前已选中的题型直接返回（下拉的 change 只在真的换值时触发，chip 的 click 每次都触发）。 */
function pickType(type: string) {
  if (type === draft.type) return
  draft.type = type
  /* 参数态只改出题参数、不动选项结构：手动态已填的题干/选项不该因为换个生成题型被清掉，
     而且那时正文根本不显示，弹那句「将清空选项结构」的确认更是莫名其妙 */
  if (props.mode === 'params') return
  void onTypeChange()
}

/**
 * 切题目类别：题型必须落在新类别的候选里（两类题型互不通用），其余取值原样保留 ——
 * 正文数据不销毁（`stem` 与 `material` / `subQuestions` 各存一份），切回来还在。
 *
 * 切到「材料组合题」时**自动补第一道子题**：组合题的作答单位就是子题，空着进来只会看到
 * 一句「还没有子题」的提示外加一次多余的点击。切回来再切出去时若已有子题则不补
 * （`subQuestions.length` 判空），不覆盖用户之前写的内容。
 */
function setCategory(next: QuestionCategory) {
  if (next === draft.category) return
  draft.category = next
  draft.type = pickCategoryType(questionTypesFor(draft.subject, next), draft.type, next)
  if (next === '材料组合题' && !draft.subQuestions.length) {
    /* 难度与知识点继承母题，与「添加子题」按钮同一条路径（见 MaterialCompositePanel） */
    draft.subQuestions.push(
      emptySubQuestionDraft(nextSubQuestionId(draft.subQuestions), {
        difficulty: draft.difficulty,
        knowledge: draft.knowledge,
      }),
    )
  }
  delete errors.value.type
  delete errors.value.subQuestions
  emit('change')
}

/* ===== 基本信息面板（共享 AppFilterPanel + AppFilterChips） =====
   折叠头与 chip 行原先手抄题库管理（BankView）的 `.prop-bar` / `.prop-head` / `.p-chip`，
   现改用共享组件：两端（机构端 / 超管端）的折叠交互与 chip 造型从此只有一份实现。
   面板的行定义与取值按需展开，草稿本身仍是单值（string / string[]），两边在下面互相转换。 */

/** 教材版本随年级 + 学科联动；已绑定但不在新列表中的旧值仍保留 */
const versionOptions = computed(() => withCurrent(versionsFor(draft.grade, draft.subject), draft.textbook))

/** 学科选项随年级收窄（多数年级开不齐全量学科），规则与顶部栏同一份：
    教材矩阵缺该年级则退回全量学科；当前学科不在其中时仍并入，供存量题保留原值。 */
const subjectOptions = computed(() => withCurrent(optionsForGrade(draft.grade), draft.subject))

/**
 * 历史题目的取值可能已停用：`withCurrent` 会把它并进选项（否则会被静默改写），
 * 但文案得标出「（已停用）」，否则看着像还能选。值不变，只改显示 —— 见 `useBaseData` 的 `optionLabel`。
 */
function retiredLabel(known: string[], value: string): Record<string, string> | undefined {
  return value && !known.includes(value) ? { [value]: optionLabel(known, value) } : undefined
}

/** 面板行：候选项随字典 / 教材矩阵变化，故为 computed；不允许的行整行不给 */
const metaRows = computed<FilterRowDef[]>(() => {
  const rows: FilterRowDef[] = []
  /* 题目类别排在最前：它决定下面所有行的含义（题型取哪一批、正文换成哪一块），
     所以必须先定它，与「先定怎么录、再填内容」是同一个顺序 */
  if (hasRow('category')) {
    rows.push({ key: 'category', label: '题目类别', multiple: false, options: [...QUESTION_CATEGORY_OPTIONS] })
  }
  if (hasRow('grade')) {
    rows.push({
      key: 'grade', label: '年级', multiple: false,
      options: withCurrent(grades.value, draft.grade),
      optionLabels: retiredLabel(grades.value, draft.grade),
    })
  }
  if (hasRow('subject')) {
    rows.push({
      key: 'subject', label: '学科', multiple: false,
      options: subjectOptions.value,
      optionLabels: retiredLabel(optionsForGrade(draft.grade), draft.subject),
    })
  }
  if (hasRow('type')) {
    /* 题型按「题目类别 + 学科」收窄：学科专属题型（英语的完形填空 / 七选五 / 短文改错）
       只在选中该学科时出现；材料组合题只列材料组合题型 */
    rows.push({
      key: 'type', label: '题型', multiple: false,
      options: withCurrent(typeOptions.value, draft.type),
      optionLabels: retiredLabel(typeOptions.value, draft.type),
    })
  }
  if (hasRow('difficulty')) {
    rows.push({
      key: 'difficulty', label: '难度', multiple: false,
      options: withCurrent(difficulties.value, draft.difficulty),
      optionLabels: retiredLabel(difficulties.value, draft.difficulty),
    })
  }
  /* 学期 / 考试类型 / 来源 / 教材版本只有完整编辑用得到（AI 出题不读它们，表单一并隐藏），
     整行连同取值一起不给面板，折叠摘要才不会摘出用户看不见的条件 */
  if (hasRow('term')) rows.push({ key: 'term', label: '学期', options: [...TERMS], multiple: false })
  if (hasRow('examType')) rows.push({ key: 'examType', label: '考试类型', options: examTypes.value, multiple: false })
  /* 题目来源：题库管理按它筛题，这里可选（名校考试 / AI 录入 …），默认手动录入 */
  if (hasRow('source')) rows.push({ key: 'source', label: '来源', options: [...QUESTION_SOURCE_OPTIONS], multiple: false })
  if (hasRow('textbook')) {
    rows.push({
      key: 'textbook', label: '教材版本', multiple: false,
      options: versionOptions.value,
      optionLabels: retiredLabel(versionsFor(draft.grade, draft.subject), draft.textbook),
    })
  }
  /* 知识点不在 rows 里：它是一棵树、要弹窗选，chip 行组件没有自定义点击。
     改由面板的 `#extra` 插槽渲染一行（见模板），顺带避开「清空」按钮把必填项一起清掉。 */
  return rows
})

/** 面板的当前取值：单值字段包成单元素数组（chip 组件以 string[] 表达选中） */
const metaFilter = computed<Record<string, string[]>>(() => {
  const value: Record<string, string[]> = {}
  if (hasRow('category')) value.category = draft.category ? [draft.category] : []
  if (hasRow('grade')) value.grade = draft.grade ? [draft.grade] : []
  if (hasRow('subject')) value.subject = draft.subject ? [draft.subject] : []
  if (hasRow('type')) value.type = draft.type ? [draft.type] : []
  if (hasRow('difficulty')) value.difficulty = draft.difficulty ? [draft.difficulty] : []
  if (hasRow('term')) value.term = draft.term ? [draft.term] : []
  if (hasRow('examType')) value.examType = draft.examType ? [draft.examType] : []
  if (hasRow('source')) value.source = draft.source ? [draft.source] : []
  if (hasRow('textbook')) value.textbook = draft.textbook ? [draft.textbook] : []
  return value
})

/**
 * 面板回传的是整份取值（覆盖式），这里逐行写回草稿。
 * 必填项（年级 / 学科 / 题型 / 难度）取消选中时保持原值 —— 它们没有「全部」这一档，
 * 点一下已选项只是误触，不该把必填字段清空；单选的行「点已选项 = 取消」正好表示
 * 考试类型「不指定」/ 教材版本「不绑定」。年级变更走 setDraftGrade 以联动收窄学科
 * （先定学科再走它，否则「同期切年级+学科」会被按旧年级校验掉新学科）。
 */
function onMetaChange(next: Record<string, string[]>) {
  const first = (key: string) => next[key]?.[0] ?? ''
  /* 题目类别要最先落：它会改题型的候选集，下面的题型取值得按新类别判是否有效。
     面板回传的整份取值里，题型那一项还是**切换前**的旧值（chip 行是覆盖式回写、不会替我们算新题型），
     所以类别真的变了就跳过题型那一行 —— 新题型由 setCategory 内部按新类别归一。 */
  const category = first('category') as QuestionCategory | ''
  const categoryChanged = Boolean(category) && category !== draft.category
  if (categoryChanged) setCategory(category as QuestionCategory)
  const grade = first('grade')
  const subject = first('subject')
  if (grade && grade !== draft.grade) setDraftGrade(draft, grade, subject || undefined, optionsForGrade)
  else if (subject) draft.subject = subject
  if (subject) delete errors.value.subject
  const type = first('type')
  if (!categoryChanged && type && type !== draft.type) pickType(type)
  const difficulty = first('difficulty')
  if (difficulty) draft.difficulty = difficulty
  /* 未在面板上渲染的行不会出现在 next 里：缺键就跳过，别把用户看不见的值清掉 */
  if ('term' in next) draft.term = first('term') || draft.term
  if ('examType' in next) draft.examType = first('examType')
  /* 来源与教材版本一样允许「取消选中」：点已选项即取消，此时回落到默认的手动录入
     （来源是枚举不是可选维度，空值会让题库筛选里那道题谁也筛不到） */
  if ('source' in next) draft.source = (first('source') as QuestionSource) || '手动录入'
  if ('textbook' in next) draft.textbook = first('textbook')
}

/** 年级或学科变化后，原教材版本可能已不适用 —— 清空，避免存出无效组合。
    没有教材版本那一行时本就无处可清（AI 参数态、拍照识别弹窗），跳过。 */
watch([() => draft.grade, () => draft.subject], () => {
  if (!hasRow('textbook')) return
  if (draft.textbook && !versionsFor(draft.grade, draft.subject).includes(draft.textbook)) draft.textbook = ''
})

/** 面板的展开态由 AppFilterPanel 自持（组件没有 open 双向绑定）；
    校验失败要强制展开时换 key 重挂载，否则用户只看到一句「请按红字提示修正」。 */
const metaPanelKey = ref(0)

const errors = ref<Record<string, string>>({})
/** 子题的红字，按子题 id 分组（右侧表单与左侧目录上的红点都读它） */
const subErrors = ref<Record<number, Record<string, string>>>({})

/** 知识点整行写入（母题）：KnowledgeRow 回传的是最新整份选择 */
function onKnowledgeUpdate(tags: string[]) {
  draft.knowledge = tags.slice(0, MAX_KNOWLEDGE)
  delete errors.value.knowledge
  emit('change')
}

/**
 * 校验。`full=false` 只校验必填属性（存草稿），`full=true` 全量校验（提交审核）。
 * 返回 false 时红字已就位、该展开的面板也展开了，调用方只需再提示一句。
 * 「解析为空」确认走 appConfirm，因此是 async —— 所有调用方都必须 await。
 */
async function validate(full: boolean): Promise<boolean> {
  const result = collectDraftErrors(draft, full)
  errors.value = result.errors
  subErrors.value = result.subErrors
  /* 基本信息的红字在收起态是看不见的，校验失败时展开 */
  if (result.errors.knowledge || result.errors.subject) metaPanelKey.value += 1
  if (result.analysisMissing && !(await appConfirm('解析为空（选填），提交审核时建议补充解析，确认继续提交？', { type: 'warning' }))) return false
  return Object.keys(result.errors).length === 0 && Object.keys(result.subErrors).length === 0
}

defineExpose({ validate })
</script>

<template>
  <div class="q-editor">
    <!-- 题目基本信息：各入口共用，全页唯一一处参数界面（FR-TM-008）。
         每个属性一行：标签左、候选项右平铺（候选项都不多，下拉是多余的一次点击，且看不到还有什么可选）。
         首行是「题目类别」——先定独立单题还是材料组合题，下面的题型与正文才知道该长什么样。 -->
    <AppFilterPanel
      :key="metaPanelKey"
      :model-value="metaFilter"
      :rows="metaRows"
      title="题目基本信息"
      @update:model-value="onMetaChange"
    >
      <!-- 知识点行：跟在 chip 行下面，位置就是「基本信息里的知识点那一行」 -->
      <template #extra>
        <KnowledgeRow
          :model-value="draft.knowledge"
          :subject="draft.subject"
          :grade="draft.grade"
          :version="hasRow('textbook') ? draft.textbook : ''"
          :error="errors.knowledge"
          @update:model-value="onKnowledgeUpdate"
        />
        <!-- 学科的红字也挂在这里：基本信息面板收起时它是看不见的，校验失败会自动展开（见 validate） -->
        <p v-if="errors.subject" class="prop-err">{{ errors.subject }}</p>
      </template>
    </AppFilterPanel>

    <!-- ===== 题目正文（参数态不渲染：那时这张表单是「出题参数」，不是一道待编辑的题） ===== -->
    <template v-if="mode === 'edit'">
      <!-- 材料组合题：共用题干 / 材料 + 子题（左目录 / 右录入）；来源备注从 #footer 落到子题面板底部 -->
      <MaterialCompositePanel
        v-if="composite"
        :draft="draft"
        :errors="errors"
        :sub-errors="subErrors"
        :type-options="subTypeOptions"
        :difficulty-options="difficulties"
        @change="emit('change')"
      >
        <template v-if="hasRow('source')" #footer>
          <div class="f-field source-remark">
            <label class="f-label">来源备注（选填 ≤100 字）</label>
            <input v-model="draft.sourceRemark" class="f-input" placeholder="如：改编自 2025 期中第 12 题" />
            <p v-if="errors.sourceRemark" class="f-err">{{ errors.sourceRemark }}</p>
          </div>
        </template>
      </MaterialCompositePanel>

      <!-- 独立单题：题干 / 选项 / 答案 / 解析（母题与子题共用同一份正文实现）+ 来源备注 -->
      <div v-else class="panel editor-panel">
        <QuestionBodyFields :draft="draft" :subject="draft.subject" :errors="errors" @change="emit('change')" />

        <!-- 来源备注不单独开一行基本信息：只对「手动录入」有意义的补充说明，
             与来源枚举一起看才完整。拍照识别没有「摘自哪份卷子」这一说，故随 source 行一起收起 -->
        <div v-if="hasRow('source')" class="f-field source-remark">
          <label class="f-label">来源备注（选填 ≤100 字）</label>
          <input v-model="draft.sourceRemark" class="f-input" placeholder="如：改编自 2025 期中第 12 题" />
          <p v-if="errors.sourceRemark" class="f-err">{{ errors.sourceRemark }}</p>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.q-editor { display: flex; flex-direction: column; gap: 14px; }

/* 基本信息面板的折叠头 / chip 行 / 面板外观都由共享的 AppFilterPanel 自持，
   知识点行由 KnowledgeRow 自持，正文由 QuestionBodyFields / MaterialCompositePanel 自持 ——
   本文件只剩面板外框的内边距与来源备注的间距。 */
.editor-panel { padding: 18px 20px; }
/* 来源备注是整页最后一项，要和上面的正文 / 子题区拉开距离：
   `.f-field` 自带 margin-bottom、没有 margin-top，不加这一条会紧贴在上一块的最后一行下面。
   底部留白仍压掉（面板自己还有内边距，否则面板底会多出一块空档）。 */
.source-remark { margin-top: 18px; margin-bottom: 0; }
/* 全局的 .f-err 选择器是 `.f-field .f-err`，面板内不在 .f-field 里，故字号与颜色要自己给 */
.prop-err { margin: 4px 0 0; font-size: 12px; color: var(--danger); }
</style>
