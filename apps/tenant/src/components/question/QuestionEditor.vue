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
 */
import { computed, ref, watch } from 'vue'
import {
  ANSWER_PAREN,
  AppFilterPanel,
  AppIcon,
  AppSegmented,
  QUESTION_SOURCE_OPTIONS,
  appConfirm,
  showToast,
  toPlainText,
} from '@aiteach/shared'
import type { FilterRowDef, QuestionSource } from '@aiteach/shared'
import KnowledgePickerModal from '@/components/compose/KnowledgePickerModal.vue'
import RichTextEditor from '@/components/ui/RichTextEditor.vue'
import { useBaseData } from '@/composables/useBaseData'
import {
  collectDraftErrors,
  hasContent,
  isJudgeNoOptionsDraft,
  MAX_KNOWLEDGE,
  setDraftGrade,
} from '@/utils/question-draft'
import type { OptionColumns, QuestionDraft } from '@/utils/question-draft'

/** 基本信息面板里可出现的行 */
export type MetaRowKey = 'grade' | 'subject' | 'type' | 'difficulty' | 'term' | 'examType' | 'source' | 'textbook'

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
const EDIT_ROWS: MetaRowKey[] = ['grade', 'subject', 'type', 'difficulty', 'term', 'examType', 'source', 'textbook']
const PARAMS_ROWS: MetaRowKey[] = ['grade', 'subject', 'type', 'difficulty']

const activeRows = computed(() => props.rows ?? (props.mode === 'params' ? PARAMS_ROWS : EDIT_ROWS))
const hasRow = (key: MetaRowKey) => activeRows.value.includes(key)

/* ===== 题型与作答结构 ===== */

/** 有选项、答案存字母的题型 */
const isChoice = computed(() => draft.type === '单选' || draft.type === '多选' || draft.type === '判断')

/** 参考答案栏的占位文案：连线题的答案是配对结果，不是演算过程 */
const essayPlaceholder = computed(() =>
  draft.type === '连线' ? '逐组写出配对结果，如：①—③；②—①；③—④…' : '输入解答过程…（可插入公式与图片）',
)

/** 判断题：把「正确 / 错误」两项换成题干前的（　　）。两种形态共用 answers 的下标（0 = 对，1 = 错），
    来回切不会丢已选的答案。 */
const judgeNoOptions = computed(() => isJudgeNoOptionsDraft(draft))

const JUDGE_MODES = [
  { value: 'options', label: '显示选项 √ ×' },
  { value: 'none', label: '无选项（题前括号）' },
]

/* ===== 选项排布（一行 1 / 2 / 4 个） =====
   只改表单的呈现结构，不改存储口径：排布存成题目字段 `optionColumns`，缺省 1（存量题不受影响）。 */
const COLUMN_OPTIONS = [
  { value: '1', label: '单行显示' },
  { value: '2', label: '一行 2 个' },
  { value: '4', label: '一行 4 个' },
]

/** AppSegmented 的 modelValue 是 string，这里在两类取值间转换 */
const columnValue = computed(() => String(draft.optionColumns))

function setColumnValue(value: string) {
  draft.optionColumns = (Number(value) === 2 ? 2 : Number(value) === 4 ? 4 : 1) as OptionColumns
  emit('change')
}

/** 排布只对单选 / 多选有意义：判断题就两项，解答题没有选项 */
const showColumnPicker = computed(() => draft.type === '单选' || draft.type === '多选')

/** 题干是否已以作答括号开头（富文本下要按纯文本判，`<p>（　　）x</p>` 也算） */
const stemHasAnswerParen = computed(() => toPlainText(draft.stem).trimStart().startsWith(ANSWER_PAREN))

/**
 * 把作答括号放到题干最前面。
 * 题干是富文本 HTML，直接字符串拼接会得到 `（　　）<p>题干</p>` —— 括号被隔到段落外面独占一行；
 * 因此有首个段落标签时插进段落内部，与题干同行（与卷面「（　　）题干」的写法一致）。
 */
function prependAnswerParen(stem: string): string {
  if (!stem) return ANSWER_PAREN
  if (/^<p[^>]*>/.test(stem)) return stem.replace(/^(<p[^>]*>)/, `$1${ANSWER_PAREN}`)
  return `${ANSWER_PAREN}${stem}`
}

function setJudgeMode(mode: string) {
  if (mode === 'none') {
    draft.options = []
    if (!stemHasAnswerParen.value) draft.stem = prependAnswerParen(draft.stem)
  } else if (draft.options.length === 0) {
    draft.options = ['正确', '错误']
    /* 括号是本模式自动加的，切回来时一并收回，避免题干留下一个多余的（　　） */
    if (stemHasAnswerParen.value) draft.stem = draft.stem.replace(ANSWER_PAREN, '')
  }
  emit('change')
}

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

/** 换题型后重建该题型专属的作答结构（选项 / 答案 / 每空答案） */
function resetTypeStructure() {
  lastType = draft.type
  draft.answers = []
  draft.options = draft.type === '判断' ? ['正确', '错误'] : ['', '', '', '']
  draft.fillAnswers = [{ value: '', equivalents: '' }]
}

async function onTypeChange() {
  if (hasContent(draft.stem) || draft.options.some((opt) => hasContent(opt))) {
    if (!(await appConfirm('切换题型将清空选项结构，确认切换？', { type: 'danger' }))) {
      draft.type = lastType
      return
    }
  }
  resetTypeStructure()
}

/**
 * 换学科后，原来的学科专属题型可能已不适用（英语的「完形填空」切到数学）——
 * 静默落回该学科的通用题型并重建作答结构，不弹确认：切学科本身就是用户主动做的动作。
 */
watch(() => draft.subject, (subject) => {
  const options = questionTypesFor(subject)
  if (!options.length || options.includes(draft.type)) return
  draft.type = pick(options, draft.type)
  resetTypeStructure()
})

/** chip 版题型切换：点当前已选中的题型直接返回（下拉的 change 只在真的换值时触发，chip 的 click 每次都触发）。 */
function pickType(type: string) {
  if (type === draft.type) return
  draft.type = type
  /* 参数态只改出题参数、不动选项结构：手动态已填的题干/选项不该因为换个生成题型被清掉，
     而且那时正文根本不显示，弹那句「将清空选项结构」的确认更是莫名其妙 */
  if (props.mode === 'params') return
  onTypeChange()
}

function addOption() {
  if (draft.options.length >= 6) {
    showToast('选项最多 6 个', 'error')
    return
  }
  draft.options.push('')
}

function removeOption(index: number) {
  if (draft.options.length <= 2) {
    showToast('选项至少 2 个', 'error')
    return
  }
  draft.options.splice(index, 1)
  draft.answers = draft.answers.filter((i) => i !== index).map((i) => (i > index ? i - 1 : i))
}

function toggleAnswer(index: number) {
  if (draft.type === '单选' || draft.type === '判断') {
    draft.answers = [index]
  } else {
    const pos = draft.answers.indexOf(index)
    if (pos >= 0) draft.answers.splice(pos, 1)
    else draft.answers.push(index)
  }
}

/* ===== 知识点（树弹窗） =====
   知识点是一棵树（分类节点 + 带 tag 的叶子），一行 chip 平铺看不出层级，改为点开弹窗在树上选。
   弹窗挂在 `#extra` 那一行的 v-if 上，每次打开都重新挂载 → 草稿态天然从最新已选起算。 */
const knowledgeOpen = ref(false)

function onKnowledgeConfirm(tags: string[]) {
  /* 弹窗内部已按 max 拦截，这里 slice 只是兜底（组件不该是唯一一道防线） */
  draft.knowledge = tags.slice(0, MAX_KNOWLEDGE)
  delete errors.value.knowledge
  knowledgeOpen.value = false
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
    /* 学科专属题型（英语的完形填空 / 七选五 / 短文改错）只在选中该学科时出现 */
    rows.push({
      key: 'type', label: '题型', multiple: false,
      options: withCurrent(questionTypesFor(draft.subject), draft.type),
      optionLabels: retiredLabel(questionTypesFor(draft.subject), draft.type),
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
  const grade = first('grade')
  const subject = first('subject')
  if (grade && grade !== draft.grade) setDraftGrade(draft, grade, subject || undefined, optionsForGrade)
  else if (subject) draft.subject = subject
  if (subject) delete errors.value.subject
  const type = first('type')
  if (type && type !== draft.type) pickType(type)
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

/**
 * 校验。`full=false` 只校验必填属性（存草稿），`full=true` 全量校验（提交审核）。
 * 返回 false 时红字已就位、该展开的面板也展开了，调用方只需再提示一句。
 * 「解析为空」确认走 appConfirm，因此是 async —— 所有调用方都必须 await。
 */
async function validate(full: boolean): Promise<boolean> {
  const { errors: next, analysisMissing } = collectDraftErrors(draft, full)
  errors.value = next
  /* 基本信息的红字在收起态是看不见的，校验失败时展开 */
  if (next.knowledge || next.subject) metaPanelKey.value += 1
  if (analysisMissing && !(await appConfirm('解析为空（选填），提交审核时建议补充解析，确认继续提交？', { type: 'warning' }))) return false
  return Object.keys(next).length === 0
}

defineExpose({ validate })
</script>

<template>
  <div class="q-editor">
    <!-- 题目基本信息：各入口共用，全页唯一一处参数界面（FR-TM-008）。
         每个属性一行：标签左、候选项右平铺（候选项都不多，下拉是多余的一次点击，且看不到还有什么可选）。
         顺序取数据源现成顺序（字典 sort / 教材矩阵 / TERMS），唯一例外是年级排到学科前面
         —— 学科选项由年级收窄，先选年级才不用回头改学科。 -->
    <AppFilterPanel
      :key="metaPanelKey"
      :model-value="metaFilter"
      :rows="metaRows"
      title="题目基本信息"
      @update:model-value="onMetaChange"
    >
      <!-- 知识点行：跟在 chip 行下面，位置就是「基本信息里的知识点那一行」。
           做成整行按钮 = 点已选标签也是打开树（重选 / 增删都在弹窗里做），
           chip 本身只读展示，不再就地删 —— 逐个删和树上取消勾选是同一件事，没必要两套。 -->
      <template #extra>
        <div class="kp-row">
          <span class="kp-row-label">知识点<span class="req">*</span></span>
          <button class="kp-row-main" type="button" @click="knowledgeOpen = true">
            <template v-if="draft.knowledge.length">
              <span v-for="tag in draft.knowledge" :key="tag" class="kp-row-chip">{{ tag }}</span>
            </template>
            <span v-else class="kp-row-empty">点击选择知识点（最多 5 个）</span>
            <AppIcon name="chevron-right" :size="14" class="kp-row-arrow" />
          </button>
        </div>
        <p class="prop-hint">在知识点树上选，最多 {{ MAX_KNOWLEDGE }} 个；点上方已选可再次打开修改</p>
        <p v-if="errors.knowledge" class="prop-err">{{ errors.knowledge }}</p>
        <p v-if="errors.subject" class="prop-err">{{ errors.subject }}</p>
      </template>
    </AppFilterPanel>

    <!-- ===== 题目正文（参数态不渲染：那时这张表单是「出题参数」，不是一道待编辑的题） ===== -->
    <div v-if="mode === 'edit'" class="panel editor-panel">
      <div class="f-field">
        <label class="f-label">题干<span class="req">*</span></label>
        <RichTextEditor
          v-model="draft.stem"
          :subject="draft.subject"
          :min-height="150"
          placeholder="如：已知二次函数 f(x)=x²-2x-3…（工具栏可插入公式、图片，也支持粘贴 / 拖入图片）"
          @change="emit('change')"
        />
        <p v-if="errors.stem" class="f-err">{{ errors.stem }}</p>
      </div>

      <!-- 选项区（FR-TM-010） -->
      <template v-if="isChoice">
        <div class="f-field">
          <!-- 判断题：可在「√ × 两个选项」与「无选项、题干前括号作答」之间切换 -->
          <div v-if="draft.type === '判断'" class="opt-head">
            <label class="f-label">作答方式</label>
            <AppSegmented
              :model-value="judgeNoOptions ? 'none' : 'options'"
              :options="JUDGE_MODES"
              @update:model-value="setJudgeMode"
            />
            <span class="f-hint" style="margin: 0">
              {{ judgeNoOptions ? '题干前已加「（　　）」，学生在括号里写对 / 错' : '选项固定为「正确 / 错误」两项' }}
            </span>
          </div>

          <template v-if="draft.options.length">
            <div class="opt-head">
              <label class="f-label">
                选项（{{ draft.options.length }}/{{ draft.type === '判断' ? 2 : 6 }}）
                <span class="f-hint" style="display: inline; margin-left: 8px">点击左侧圆点标记正确答案</span>
              </label>
              <!-- 排布：短选项（数字、单词）排一行更省卷面，也少滚一屏 -->
              <template v-if="showColumnPicker">
                <span class="f-hint" style="margin: 0 2px 0 auto">选项排布</span>
                <AppSegmented :model-value="columnValue" :options="COLUMN_OPTIONS" @update:model-value="setColumnValue" />
              </template>
            </div>
            <div class="opt-list" :class="`cols-${draft.optionColumns}`">
              <div v-for="(opt, i) in draft.options" :key="i" class="opt-row">
                <button
                  class="answer-dot"
                  :class="{ on: draft.answers.includes(i), multi: draft.type === '多选' }"
                  type="button"
                  :title="draft.type === '多选' ? '正确答案（≥2 个）' : '正确答案'"
                  @click="toggleAnswer(i)"
                >
                  {{ 'ABCDEF'[i] }}
                </button>
                <RichTextEditor
                  v-model="draft.options[i]"
                  class="opt-editor"
                  compact
                  :subject="draft.subject"
                  :min-height="40"
                  :placeholder="`选项 ${'ABCDEF'[i]} 内容`"
                  @change="emit('change')"
                />
                <button
                  v-if="draft.type !== '判断'"
                  class="mini-btn danger"
                  type="button"
                  @click="removeOption(i)"
                >
                  删除
                </button>
              </div>
            </div>
            <button v-if="draft.type !== '判断'" class="btn btn-ghost btn-sm" type="button" @click="addOption">
              <AppIcon name="plus" :size="14" /> 添加选项
            </button>
          </template>

          <!-- 无选项判断题：答案只有对 / 错，两个互斥按钮 -->
          <div v-else class="judge-answer">
            <span class="f-label" style="margin: 0">正确答案</span>
            <button
              v-for="(label, i) in ['对', '错']"
              :key="label"
              class="judge-btn"
              :class="{ on: draft.answers[0] === i }"
              type="button"
              @click="draft.answers = [i]"
            >
              {{ label }}
            </button>
          </div>
          <p v-if="errors.options" class="f-err">{{ errors.options }}</p>
        </div>
      </template>

      <!-- 填空答案区 -->
      <template v-else-if="draft.type === '填空'">
        <div class="f-field">
          <label class="f-label">填空答案（每空独立，支持等价写法）<span class="req">*</span></label>
          <!-- 答案与等价答案都用富文本编辑器：填空答案常常是分式 / 根号，纯输入框写不出来 -->
          <div v-for="(blank, bi) in draft.fillAnswers" :key="bi" class="blank-row">
            <div class="blank-head">
              <span class="blank-no">第 {{ bi + 1 }} 空</span>
              <button
                v-if="draft.fillAnswers.length > 1"
                class="mini-btn danger"
                type="button"
                @click="draft.fillAnswers.splice(bi, 1)"
              >
                删除
              </button>
            </div>
            <label class="blank-label">答案<span class="req">*</span></label>
            <RichTextEditor
              v-model="blank.value"
              compact
              :subject="draft.subject"
              :min-height="40"
              placeholder="答案…（可用公式按钮插入 LaTeX 公式）"
              @change="emit('change')"
            />
            <label class="blank-label">等价答案（选填）</label>
            <RichTextEditor
              v-model="blank.equivalents"
              compact
              :subject="draft.subject"
              :min-height="40"
              placeholder="等价写法，多种用顿号或逗号分隔，如：-1、−1"
              @change="emit('change')"
            />
          </div>
          <button class="btn btn-ghost btn-sm" type="button" @click="draft.fillAnswers.push({ value: '', equivalents: '' })">
            <AppIcon name="plus" :size="14" /> 添加一空
          </button>
          <p v-if="errors.answer" class="f-err">{{ errors.answer }}</p>
        </div>
      </template>

      <!-- 演算 / 写作类答案：解答、计算、证明、连线、作文 -->
      <template v-else>
        <div class="f-field">
          <label class="f-label">参考答案<span class="req">*</span></label>
          <RichTextEditor
            v-model="draft.essayAnswer"
            :subject="draft.subject"
            :min-height="110"
            :placeholder="essayPlaceholder"
            @change="emit('change')"
          />
          <p v-if="errors.answer" class="f-err">{{ errors.answer }}</p>
        </div>
      </template>

      <div class="f-field">
        <label class="f-label">解析</label>
        <RichTextEditor
          v-model="draft.analysis"
          :subject="draft.subject"
          :min-height="110"
          placeholder="输入解析…（可插入公式与图片）"
          @change="emit('change')"
        />
      </div>

      <!-- 来源备注不单独开一行基本信息：只对「手动录入」有意义的补充说明，
           与来源枚举一起看才完整。拍照识别没有「摘自哪份卷子」这一说，故随 source 行一起收起 -->
      <div v-if="hasRow('source')" class="f-field">
        <label class="f-label">来源备注（选填 ≤100 字）</label>
        <input v-model="draft.sourceRemark" class="f-input" placeholder="如：改编自 2025 期中第 12 题" />
        <p v-if="errors.sourceRemark" class="f-err">{{ errors.sourceRemark }}</p>
      </div>
    </div>

    <!-- 知识点树：`v-if` 挂载 = 每次打开都从最新已选起算，取消（不 confirm）即丢弃 -->
    <KnowledgePickerModal
      v-if="knowledgeOpen"
      :model-value="draft.knowledge"
      :subject="draft.subject"
      :grade="draft.grade"
      :version="hasRow('textbook') ? draft.textbook : ''"
      :max="MAX_KNOWLEDGE"
      @close="knowledgeOpen = false"
      @confirm="onKnowledgeConfirm"
    />
  </div>
</template>

<style scoped>
.q-editor { display: flex; flex-direction: column; gap: 14px; }

/* 基本信息面板的折叠头 / chip 行 / 面板外观都由共享的 AppFilterPanel 自持，
   原先手抄自题库管理的那套 `.prop-bar` / `.prop-head` / `.prop-row` / `.p-chip` 已全部删除。
   只剩面板末尾的小字（说明文案、校验红字）与知识点行 —— 知识点是树弹窗，chip 行组件做不出
   「整行点击」，只能落在 #extra 里。 */
.prop-hint { font-size: 12px; color: var(--sub); }
/* 全局的 .f-err 选择器是 `.f-field .f-err`，面板内不在 .f-field 里，故字号与颜色要自己给 */
.prop-err { margin: 0; font-size: 12px; color: var(--danger); }

/* ===== 知识点行（面板里的伪 chip 行） =====
   造型对齐 AppFilterChips 的行：标签左、取值右，只是取值区整体是一个按钮。 */
.kp-row { display: flex; align-items: flex-start; gap: 12px; margin-top: 8px; }
.kp-row-label {
  flex-shrink: 0;
  width: 58px; /* 与 AppFilterChips 的 labelWidth 默认值一致，标签列才对得齐 */
  padding-top: 5px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink-2);
}
/* 全局的 `.req` 只在 `.f-field .f-label` 里生效，面板内要自己给一次 */
.kp-row-label .req { color: var(--danger); margin-left: 2px; }
.kp-row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  appearance: none;
  border: 1px solid transparent;
  border-radius: 9px;
  background: #f7fafa;
  padding: 6px 10px;
  text-align: left;
  transition: border-color 0.12s, background 0.12s;
}
.kp-row-main:hover { border-color: var(--brand); background: #fff; }
.kp-row-chip {
  border: 1px solid var(--brand);
  border-radius: 999px;
  background: var(--brand-soft);
  color: var(--brand-deep);
  font-size: 12px;
  font-weight: 600;
  padding: 2px 9px;
}
.kp-row-empty { font-size: 12.5px; color: var(--sub); }
.kp-row-arrow { margin-left: auto; color: var(--sub); flex-shrink: 0; }

.editor-panel { padding: 18px 20px; }

/* 选项区标题行：标签 / 排布 segmented 分居两侧，判断题的作答方式也走这一行 */
.opt-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
.opt-head .f-label { margin: 0; }

/* 选项排布：按列数切 grid —— 一行 2 / 4 个时选项编辑器等宽，短选项不再各占一行 */
.opt-list.cols-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 10px; }
.opt-list.cols-4 { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0 10px; }

.opt-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
/* 选项编辑器占满剩余宽度（删除按钮与答案圆点保持原尺寸） */
.opt-editor { flex: 1; min-width: 0; }
.answer-dot {
  width: 30px;
  height: 34px;
  border-radius: 9px;
  border: 1.5px solid var(--border);
  background: #fff;
  color: var(--sub);
  font-weight: 700;
  flex-shrink: 0;
  transition: all 0.15s;
}
.answer-dot.on { border-color: var(--success); background: var(--success-soft); color: var(--success); }
.answer-dot.multi { border-radius: 999px; }

/* 无选项判断题的答案按钮（对 / 错，互斥） */
.judge-answer { display: flex; align-items: center; gap: 10px; }
.judge-btn {
  min-width: 64px;
  padding: 8px 18px;
  border: 1.5px solid var(--border);
  border-radius: 9px;
  background: #fff;
  font-family: inherit;
  font-size: 13.5px;
  color: var(--sub);
  transition: all 0.15s;
}
.judge-btn:hover { color: var(--brand-deep); }
.judge-btn.on { border-color: var(--success); background: var(--success-soft); color: var(--success); font-weight: 700; }

/* 填空答案：一空两块编辑器，纵排（横排会把富文本工具栏挤到换行） */
.blank-row {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 12px;
  margin-bottom: 10px;
}
.blank-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.blank-no { font-size: 12.5px; font-weight: 700; color: var(--ink-2); }
.blank-label { display: block; font-size: 12px; color: var(--sub); margin: 6px 0 4px; }
</style>
