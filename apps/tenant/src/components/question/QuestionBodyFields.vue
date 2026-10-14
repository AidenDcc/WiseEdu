<script setup lang="ts">
/**
 * 题目正文编辑区：题干 + 选项 / 答案（选择 / 判断 / 填空 / 解答四种形态）+ 解析。
 *
 * 母题与**每一道子题**共用这一份 —— 子题的正文和母题在结构上完全一样（只是学段继承母题），
 * 所以判定与渲染都收在这里，子题不再抄一遍。组件只认 `QuestionBody` 这个窄接口
 * （题型 / 题干 / 选项 / 作答结构 / 解析），不关心外面那层是母题还是子题。
 *
 * **`draft` 是父级持有的同一个 reactive 对象，这里就地改字段**（同 QuestionEditor 的约定）；
 * 题型 chip 与「切换题型」的确认留在父级（母题在题目基本信息面板、子题在子题基础信息里），
 * 本组件只负责渲染当前题型对应的作答界面。
 */
import { computed } from 'vue'
import { ANSWER_PAREN, AppIcon, AppSegmented, showToast, toPlainText } from '@aiteach/shared'
import RichTextEditor from '@/components/ui/RichTextEditor.vue'
import { isJudgeNoOptionsDraft } from '@/utils/question-draft'
import type { OptionColumns, QuestionBody } from '@/utils/question-draft'

const props = withDefaults(
  defineProps<{
    /** 父级的同一个对象，就地修改 */
    draft: QuestionBody
    /** 富文本编辑器的学科上下文（公式面板按学科给常用符号） */
    subject: string
    /** 校验红字，key 与 `collectDraftErrors` 一致：stem / options / answer */
    errors?: Record<string, string>
    stemLabel?: string
    stemPlaceholder?: string
    /** 子题里题干短一些，压一压最小高度，一屏能多放一道题 */
    compact?: boolean
  }>(),
  { errors: () => ({}), stemLabel: '题干', stemPlaceholder: '请编辑题干', compact: false },
)

const emit = defineEmits<{ change: [] }>()

/** 有选项、答案存字母的题型 */
const isChoice = computed(() => props.draft.type === '单选' || props.draft.type === '多选' || props.draft.type === '判断')

/** 参考答案栏的占位文案：连线题的答案是配对结果，不是演算过程 */
const essayPlaceholder = computed(() =>
  props.draft.type === '连线' ? '逐组写出配对结果，如：①—③；②—①；③—④…' : '输入解答过程…（可插入公式与图片）',
)

/** 判断题：把「正确 / 错误」两项换成题干前的（　　）。两种形态共用 answers 的下标（0 = 对，1 = 错），
    来回切不会丢已选的答案。 */
const judgeNoOptions = computed(() => isJudgeNoOptionsDraft(props.draft))

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
const columnValue = computed(() => String(props.draft.optionColumns))

function setColumnValue(value: string) {
  props.draft.optionColumns = (Number(value) === 2 ? 2 : Number(value) === 4 ? 4 : 1) as OptionColumns
  emit('change')
}

/** 排布只对单选 / 多选有意义：判断题就两项，解答题没有选项 */
const showColumnPicker = computed(() => props.draft.type === '单选' || props.draft.type === '多选')

/** 题干是否已以作答括号开头（富文本下要按纯文本判，`<p>（　　）x</p>` 也算） */
const stemHasAnswerParen = computed(() => toPlainText(props.draft.stem).trimStart().startsWith(ANSWER_PAREN))

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
    props.draft.options = []
    if (!stemHasAnswerParen.value) props.draft.stem = prependAnswerParen(props.draft.stem)
  } else if (props.draft.options.length === 0) {
    props.draft.options = ['正确', '错误']
    /* 括号是本模式自动加的，切回来时一并收回，避免题干留下一个多余的（　　） */
    if (stemHasAnswerParen.value) props.draft.stem = props.draft.stem.replace(ANSWER_PAREN, '')
  }
  emit('change')
}

function addOption() {
  if (props.draft.options.length >= 6) {
    showToast('选项最多 6 个', 'error')
    return
  }
  props.draft.options.push('')
  emit('change')
}

function removeOption(index: number) {
  if (props.draft.options.length <= 2) {
    showToast('选项至少 2 个', 'error')
    return
  }
  props.draft.options.splice(index, 1)
  props.draft.answers = props.draft.answers.filter((i) => i !== index).map((i) => (i > index ? i - 1 : i))
  emit('change')
}

function toggleAnswer(index: number) {
  if (props.draft.type === '单选' || props.draft.type === '判断') {
    props.draft.answers = [index]
  } else {
    const pos = props.draft.answers.indexOf(index)
    if (pos >= 0) props.draft.answers.splice(pos, 1)
    else props.draft.answers.push(index)
  }
  emit('change')
}
</script>

<template>
  <div class="q-body">
    <div class="f-field">
      <label class="f-label">{{ stemLabel }}<span class="req">*</span></label>
      <!-- 简化工具有：录题只讲「顺手排一下版」，工具栏上的「字体 / 字号 / 表格 / 填空线…」
           每个字都占一格宽，题干这种要写整段文字的框里，文字标签把工具栏挤成两行反而更碍事。
           按钮含义交给 title 悬浮提示，与选项 / 填空答案两处早就这么做了（见下方 compact）。 -->
      <RichTextEditor
        v-model="draft.stem"
        compact
        :subject="subject"
        :min-height="compact ? 72 : 150"
        :placeholder="stemPlaceholder"
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
                :subject="subject"
                :min-height="40"
                :placeholder="`选项 ${'ABCDEF'[i]} 内容`"
                @change="emit('change')"
              />
              <button v-if="draft.type !== '判断'" class="mini-btn danger" type="button" @click="removeOption(i)">
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
            :subject="subject"
            :min-height="40"
            placeholder="答案…（可用公式按钮插入 LaTeX 公式）"
            @change="emit('change')"
          />
          <label class="blank-label">等价答案（选填）</label>
          <RichTextEditor
            v-model="blank.equivalents"
            compact
            :subject="subject"
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
          compact
          :subject="subject"
          :min-height="compact ? 80 : 110"
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
        compact
        :subject="subject"
        :min-height="compact ? 80 : 110"
        placeholder="输入解析…（可插入公式与图片）"
        @change="emit('change')"
      />
    </div>
  </div>
</template>

<style scoped>
.q-body { display: flex; flex-direction: column; gap: 14px; }

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
