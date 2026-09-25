<script setup lang="ts">
/**
 * 排版块 —— 预览弹窗的测量层与纸面页面共用同一个组件，
 * 保证「量到的高度」与「画出来的高度」完全一致，分版才不会溢出纸面。
 *
 * 两类块：试卷（卷头 / 大题标题 / 一道题）与答题卡（考生信息区 / 分区标题 / 填涂区 / 作答框）。
 * 刻意不引入任何交互与业务标签（来源、审核状态等）：这里模拟的是打印出来的卷子。
 */
import { computed } from 'vue'
import { RichTextViewer } from '@aiteach/shared'
import type { OrgPaper, OrgQuestion } from '@aiteach/shared'
import type { PaperBlock, PaperLayoutPreset } from './paper-layouts'

const props = defineProps<{
  block: PaperBlock
  paper: OrgPaper
  questions: OrgQuestion[]
  preset: PaperLayoutPreset
  /** 教师版：题目后附带答案与解析（答题卡上标出正确选项） */
  teacher: boolean
}>()

const section = computed(() => (props.block.kind === 'section' ? props.block : null))
/** 材料按空行分段：每段独立成行，才能逐段首行缩进（`.rt-plain` 的 pre-wrap 做不到） */
const materialParas = computed(() =>
  props.block.kind === 'material'
    ? props.block.text
        .split('\n')
        .map((row) => row.trim())
        .filter(Boolean)
    : [],
)
const question = computed(() => (props.block.kind === 'question' ? props.block : null))
const cardAnswer = computed(() => (props.block.kind === 'card-answer' ? props.block : null))

/** 题目按 id 建索引：填涂区一屏几十个题号，逐个 find 太费 */
const itemMap = computed(() => new Map(props.questions.map((row) => [row.id, row])))

const item = computed<OrgQuestion | undefined>(() => {
  const block = question.value ?? cardAnswer.value
  return block ? itemMap.value.get(block.questionId) : undefined
})

function itemOf(questionId: number): OrgQuestion | undefined {
  return itemMap.value.get(questionId)
}

const totalScore = computed(() =>
  props.paper.sections.reduce((sum, s) => sum + s.questions.reduce((t, q) => t + (Number(q.score) || 0), 0), 0),
)
const totalCount = computed(() => props.paper.sections.reduce((sum, s) => sum + s.questions.length, 0))

/** 分值去掉无意义的小数尾巴：5 / 2.5 */
function scoreText(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)))
}

/** 大题说明：各小题分值一致时写明「每小题 X 分」 */
const sectionMeta = computed(() => {
  const block = section.value
  if (!block) return ''
  const per = block.perScore ? `每小题 ${scoreText(block.perScore)} 分，` : ''
  return `（本大题共 ${block.count} 小题，${per}共 ${scoreText(block.score)} 分）`
})

/* ===== 题目渲染 ===== */

/** 判断题选项按试卷习惯渲染 √ / ×，其余题型渲染 A/B/C…（选项字母由序号推出） */
function optionMarks(row: OrgQuestion | undefined): string[] {
  return row ? row.options.map((_, i) => (row.type === '判断题' ? (i === 0 ? '√' : '×') : 'ABCDEF'[i])) : []
}

/** 正确答案对应的选项序号（单选 'C' → [2]，多选 'AC' → [0, 2]，判断题按 √/× 归位） */
function correctIndexes(row: OrgQuestion): number[] {
  const text = (row.answer || '').trim()
  if (!text) return []
  if (row.type === '判断题') return [/^(√|对|正确|是|T|TRUE)/i.test(text) ? 0 : 1]
  const marks = optionMarks(row)
  return marks.map((mark, i) => (mark && text.toUpperCase().includes(mark) ? i : -1)).filter((i) => i >= 0)
}

/** 题目答案缓存：填涂区一屏几十个题号都要判断对错 */
const correctMap = computed(() => {
  const map = new Map<number, number[]>()
  props.questions.forEach((row) => map.set(row.id, correctIndexes(row)))
  return map
})

function marksOf(questionId: number): string[] {
  return optionMarks(itemOf(questionId))
}

function isCorrect(questionId: number, index: number): boolean {
  return props.teacher && (correctMap.value.get(questionId) ?? []).includes(index)
}

/** 有选项即为客观题；无选项（解答题、问答题、作文…）才留答题空白 */
const subjective = computed(() => !!item.value && item.value.options.length === 0)

/** 答题空白行数：按分值给（12 分 → 4 行），并夹在 2~8 行之间 */
const blankLines = computed(() => {
  const score = question.value?.score ?? 0
  return Math.min(8, Math.max(2, Math.round(score / 3)))
})

/** 客观题答案是字母，直接展示；主观题答案是富文本（含公式 / 插图） */
const answerIsPlain = computed(() => !!item.value && item.value.options.length > 0)
</script>

<template>
  <!-- 卷头 -->
  <div v-if="block.kind === 'head'" class="pb-head">
    <h1 class="pb-title">{{ paper.name }}</h1>
    <p class="pb-head-meta">
      {{ paper.subject }} · {{ paper.grade }} · 满分 {{ scoreText(totalScore) }} 分 · 考试时间 {{ paper.duration }} 分钟 · 共
      {{ totalCount }} 题
    </p>

    <table v-if="preset.headStyle !== 'simple'" class="pb-head-form">
      <tbody>
        <tr>
          <th>班级</th>
          <td />
          <th>姓名</th>
          <td />
          <th>考号</th>
          <td />
          <th>得分</th>
          <td />
        </tr>
      </tbody>
    </table>
    <p v-if="preset.headStyle === 'simple'" class="pb-head-tip">请将答案填写在题目指定位置。</p>
    <p v-else-if="preset.headStyle === 'seal'" class="pb-head-tip">
      姓名、班级、考号须填写在左侧密封线内，考试结束后试卷与答题卡一并交回。
    </p>

    <div class="pb-notice">
      <b>注意事项：</b>
      <p>1．答题前请将姓名、班级、考号填写清楚，并核对试卷页数与题数。</p>
      <p>2．选择题作答后请将答案填写在题后括号内，解答题须写出必要的文字说明与演算步骤。</p>
      <p>3．考试结束后，将试卷与答题卡一并交回，不得带出考场。</p>
    </div>
  </div>

  <!-- 大题标题 -->
  <div v-else-if="block.kind === 'section'" class="pb-section">
    <h2 class="pb-section-title">{{ block.title }}</h2>
    <span class="pb-section-meta">{{ sectionMeta }}</span>
  </div>

  <!-- 大题材料（阅读文本，整版通栏）：按空行分段，逐段首行缩进两字 -->
  <div v-else-if="block.kind === 'material'" class="pb-mat" :class="{ 'has-text': !!block.text }">
    <p v-if="block.hint" class="pb-mat-hint">{{ block.hint }}</p>
    <p v-for="(para, pi) in materialParas" :key="pi" class="pb-mat-p">{{ para }}</p>
  </div>

  <!-- 一道题 -->
  <div v-else-if="block.kind === 'question'" class="pb-q">
    <p class="pb-stem">
      <span class="pb-no">{{ block.no }}．</span>
      <span v-if="preset.scoreStyle === 'inline'" class="pb-score">（{{ scoreText(block.score) }} 分）</span>
      <RichTextViewer v-if="item" :content="item.stem" tag="span" />
      <template v-else>题目 #{{ block.questionId }}（题源缺失）</template>
      <span v-if="preset.scoreStyle === 'trail'" class="pb-score">（{{ scoreText(block.score) }} 分）</span>
    </p>

    <ul v-if="item?.options.length" class="pb-opts" :class="{ 'is-two': preset.optionColumns === 2 }">
      <li v-for="(opt, oi) in item.options" :key="oi">
        <span class="pb-opt-key">{{ optionMarks(item)[oi] }}．</span>
        <RichTextViewer :content="opt" tag="span" />
      </li>
    </ul>

    <!-- 解答题答题空白（按分值给行数，教师版下让位给答案解析） -->
    <div v-if="preset.answerSpace && subjective && !teacher" class="pb-blank">
      <i v-for="n in blankLines" :key="n" class="pb-blank-line" />
    </div>

    <div v-if="teacher && item" class="pb-answer">
      <p class="pb-answer-row">
        <b>答案：</b>
        <span v-if="answerIsPlain">{{ item.answer || '（未填写）' }}</span>
        <RichTextViewer v-else :content="item.answer" tag="span" :empty="'（未填写）'" />
      </p>
      <p class="pb-answer-row">
        <b>解析：</b>
        <RichTextViewer :content="item.analysis" tag="span" :empty="'（未填写）'" />
      </p>
      <p class="pb-answer-meta">
        {{ item.type }} · {{ item.difficulty }}
        <template v-if="item.knowledge.length"> · {{ item.knowledge.join('、') }}</template>
      </p>
    </div>
  </div>

  <!-- ===== 答题卡 ===== -->

  <!-- 考生信息区 + 注意事项 -->
  <div v-else-if="block.kind === 'card-head'" class="pc-head">
    <h1 class="pc-title">{{ paper.name }}　答题卡</h1>
    <p class="pc-meta">
      {{ paper.subject }} · {{ paper.grade }} · 满分 {{ scoreText(totalScore) }} 分 · 共 {{ totalCount }} 题 · 考试时间
      {{ paper.duration }} 分钟
    </p>

    <div class="pc-id">
      <div class="pc-barcode">
        <span>条形码粘贴区</span>
        <i>（正面朝上，请勿贴出框外）</i>
      </div>
      <table class="pc-info">
        <tbody>
          <tr>
            <th>姓名</th>
            <td />
            <th>班级</th>
            <td />
          </tr>
          <tr>
            <th>考号</th>
            <td />
            <th>座位号</th>
            <td />
          </tr>
        </tbody>
      </table>
    </div>

    <p class="pc-miss">缺考标记：<i class="pc-tick" />缺考（由监考员填涂，考生禁填）</p>

    <div class="pc-notice">
      <b>注意事项：</b>
      <p>1．答题前请将姓名、班级、考号、座位号填写清楚，并在规定位置粘贴条形码。</p>
      <p>2．选择题必须使用 2B 铅笔填涂；非选择题必须使用 0.5 毫米黑色签字笔书写，字体工整、笔迹清楚。</p>
      <p>3．请按题号在各题答题区域内作答，超出答题区域的答案无效；保持卡面清洁，不要折叠、不要弄破。</p>
    </div>
  </div>

  <!-- 答题卡分区标题 -->
  <div v-else-if="block.kind === 'card-title'" class="pc-section">
    <h2 class="pc-section-title">{{ block.title }}</h2>
    <span class="pc-section-hint">{{ block.hint }}</span>
  </div>

  <!-- 客观题填涂区 -->
  <div
    v-else-if="block.kind === 'card-fill'"
    class="pc-fill"
    :style="{ gridTemplateColumns: `repeat(${block.columns}, minmax(0, 1fr))` }"
  >
    <div v-for="row in block.items" :key="row.key" class="pc-fill-item">
      <span class="pc-fill-no">{{ row.no }}</span>
      <span class="pc-bubs">
        <i v-if="!marksOf(row.questionId).length" class="pc-bub">?</i>
        <i v-for="(mark, mi) in marksOf(row.questionId)" :key="mi" class="pc-bub" :class="{ on: isCorrect(row.questionId, mi) }">{{ mark }}</i>
      </span>
    </div>
  </div>

  <!-- 主观题作答区 -->
  <div v-else class="pc-ans">
    <div class="pc-ans-head">
      <span class="pc-ans-no">{{ block.no }}．</span>
      <span class="pc-ans-score">（{{ scoreText(block.score) }} 分）</span>
      <span v-if="item" class="pc-ans-type">{{ item.type }}</span>
      <span class="pc-ans-mark">得分</span>
    </div>

    <!-- 填空题：作答横线；解答题：作答框 -->
    <div v-if="block.lines" class="pc-ans-lines">
      <i v-for="n in block.lines" :key="n" class="pc-ans-line" />
    </div>
    <div v-else class="pc-ans-box" :style="{ minHeight: `${block.boxH}px` }" />

    <div v-if="teacher && item" class="pb-answer">
      <p class="pb-answer-row">
        <b>答案：</b>
        <span v-if="answerIsPlain">{{ item.answer || '（未填写）' }}</span>
        <RichTextViewer v-else :content="item.answer" tag="span" :empty="'（未填写）'" />
      </p>
      <p class="pb-answer-row">
        <b>解析：</b>
        <RichTextViewer :content="item.analysis" tag="span" :empty="'（未填写）'" />
      </p>
    </div>
  </div>
</template>

<style scoped>
/* 所有尺寸都走 --pp-* 令牌：测量层与纸张页面拿到的是同一份变量 */
.pb-head { text-align: center; font-family: var(--pp-head-font); }
.pb-title {
  font-size: var(--pp-title-size);
  font-weight: 700;
  letter-spacing: 1px;
  color: var(--pp-accent);
  line-height: 1.4;
}
.pb-head-meta { font-size: calc(var(--pp-size) * 0.92); color: var(--pp-accent); margin-top: 6px; }
.pb-head-tip { font-size: calc(var(--pp-size) * 0.88); color: var(--pp-accent); margin-top: 6px; }
.pb-head-form {
  width: 100%;
  margin-top: 10px;
  border-collapse: collapse;
  font-family: var(--pp-head-font);
  font-size: calc(var(--pp-size) * 0.92);
}
.pb-head-form th,
.pb-head-form td {
  border: 1px solid var(--pp-accent);
  height: 30px;
  padding: 0 6px;
  font-weight: 400;
  color: var(--pp-accent);
}
.pb-head-form th { width: 48px; white-space: nowrap; background: rgba(0, 0, 0, 0.02); }
.pb-notice {
  margin-top: 10px;
  border-top: 1px solid var(--pp-accent);
  border-bottom: 1px solid var(--pp-accent);
  padding: 8px 2px;
  text-align: left;
  font-size: calc(var(--pp-size) * 0.9);
  line-height: var(--pp-line);
  color: var(--pp-accent);
}
.pb-notice b { font-family: var(--pp-head-font); }
.pb-notice p { margin: 2px 0 0; }

.pb-section { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; font-family: var(--pp-head-font); }
.pb-section-title { font-size: var(--pp-section-size); font-weight: 700; color: var(--pp-accent); }
.pb-section-meta { font-size: calc(var(--pp-size) * 0.9); color: var(--pp-accent); }

/* 大题材料：左侧细线区分「共用文本」与「题目」，正文两端对齐、首行缩进两字 */
/* 左侧细线只在真材料上画；纯作答说明（听力指令等）不加线，避免看成一段文字 */
.pb-mat { color: var(--pp-accent); }
.pb-mat.has-text { border-left: 2px solid #c9cfdb; padding-left: 10px; }
.pb-mat-hint { font-size: calc(var(--pp-size) * 0.9); font-family: var(--pp-head-font); margin-bottom: 4px; }
.pb-mat-p {
  font-size: var(--pp-size);
  line-height: var(--pp-line);
  text-align: justify;
  text-indent: 2em;
  margin: 0 0 4px;
}
.pb-mat-p:last-child { margin-bottom: 0; }

.pb-q { font-size: var(--pp-size); line-height: var(--pp-line); color: var(--pp-accent); }
.pb-stem { font-size: var(--pp-size); line-height: var(--pp-line); }
.pb-no { font-weight: 700; font-family: var(--pp-head-font); }
.pb-score { font-size: calc(var(--pp-size) * 0.9); }
.pb-opts { margin-top: 4px; display: flex; flex-direction: column; gap: 2px; }
.pb-opts.is-two { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 12px; }
.pb-opts li { display: flex; align-items: baseline; gap: 6px; font-size: var(--pp-size); line-height: var(--pp-line); }
.pb-opt-key { flex-shrink: 0; }

.pb-blank { margin-top: 10px; display: flex; flex-direction: column; gap: 4px; }
/* 答题留白行高随版式字号缩放，行数由分值决定（见 blankLines） */
.pb-blank-line {
  display: block;
  height: calc(var(--pp-size) * var(--pp-line) * 1.3);
  border-bottom: 1px dashed #c9cfdb;
}

.pb-answer {
  margin-top: 8px;
  border-left: 3px solid var(--brand);
  background: rgba(0, 180, 166, 0.05);
  padding: 6px 10px;
  font-size: calc(var(--pp-size) * 0.92);
  line-height: var(--pp-line);
}
.pb-answer-row { margin: 0; }
.pb-answer-row b { color: var(--brand-deep); }
.pb-answer-meta { margin: 2px 0 0; color: var(--sub); font-size: calc(var(--pp-size) * 0.85); }

/* ===== 答题卡 ===== */
.pc-head { text-align: center; font-family: var(--pp-head-font); color: var(--pp-accent); }
.pc-title { font-size: var(--pp-title-size); font-weight: 700; letter-spacing: 1px; line-height: 1.4; }
.pc-meta { font-size: calc(var(--pp-size) * 0.92); margin-top: 6px; }

/* 条形码区 + 考生信息栏 */
.pc-id { display: flex; align-items: stretch; gap: 10px; margin-top: 10px; }
.pc-barcode {
  flex: 0 0 34%;
  border: 1px solid var(--pp-accent);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 10px 8px;
  font-size: calc(var(--pp-size) * 0.95);
  letter-spacing: 1px;
}
.pc-barcode i { font-style: normal; font-size: calc(var(--pp-size) * 0.78); color: #6b7280; letter-spacing: 0; }
.pc-info { flex: 1 1 auto; border-collapse: collapse; font-size: calc(var(--pp-size) * 0.95); }
.pc-info th,
.pc-info td {
  border: 1px solid var(--pp-accent);
  height: calc(var(--pp-size) * var(--pp-line) * 1.6);
  padding: 0 6px;
  font-weight: 400;
}
.pc-info th { width: 62px; white-space: nowrap; text-align: center; background: rgba(0, 0, 0, 0.02); }

.pc-miss {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 8px;
  font-size: calc(var(--pp-size) * 0.88);
}
.pc-tick { width: calc(var(--pp-size) * 0.95); height: calc(var(--pp-size) * 0.95); border: 1px solid var(--pp-accent); }

.pc-notice {
  margin-top: 8px;
  border-top: 1px solid var(--pp-accent);
  border-bottom: 1px solid var(--pp-accent);
  padding: 7px 2px;
  text-align: left;
  font-family: var(--pp-font);
  font-size: calc(var(--pp-size) * 0.9);
  line-height: var(--pp-line);
}
.pc-notice b { font-family: var(--pp-head-font); }
.pc-notice p { margin: 2px 0 0; }

.pc-section { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; font-family: var(--pp-head-font); }
.pc-section-title { font-size: var(--pp-section-size); font-weight: 700; color: var(--pp-accent); }
.pc-section-hint { font-size: calc(var(--pp-size) * 0.85); color: #6b7280; }

/* 客观题填涂区：题号 + A B C D 涂点，多列自适应（列数由版面宽度算出） */
.pc-fill { display: grid; gap: calc(var(--pp-size) * 0.5) 8px; padding: 4px 0; }
.pc-fill-item { display: flex; align-items: center; gap: 6px; font-size: calc(var(--pp-size) * 0.95); }
.pc-fill-no { min-width: calc(var(--pp-size) * 1.9); text-align: right; font-weight: 700; font-family: var(--pp-head-font); }
.pc-bubs { display: flex; gap: 5px; }
.pc-bub {
  width: calc(var(--pp-size) * 1.35);
  height: calc(var(--pp-size) * 1.35);
  border: 1px solid var(--pp-accent);
  border-radius: 3px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-style: normal;
  font-size: calc(var(--pp-size) * 0.86);
  line-height: 1;
}
/* 教师版：标出正确选项 */
.pc-bub.on { background: var(--brand); border-color: var(--brand); color: #fff; font-weight: 700; }

/* 主观题作答区 */
.pc-ans { color: var(--pp-accent); }
.pc-ans-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
  font-family: var(--pp-head-font);
  font-size: var(--pp-size);
}
.pc-ans-no { font-weight: 700; }
.pc-ans-score { font-size: calc(var(--pp-size) * 0.9); }
.pc-ans-type { font-size: calc(var(--pp-size) * 0.82); color: #6b7280; }
.pc-ans-mark {
  margin-left: auto;
  border: 1px solid var(--pp-accent);
  padding: 0 8px;
  font-size: calc(var(--pp-size) * 0.82);
}
.pc-ans-box { border: 1px solid #b9c0cf; }
.pc-ans-lines { display: flex; flex-direction: column; gap: calc(var(--pp-size) * 0.5); padding-top: 4px; }
.pc-ans-line { display: block; height: calc(var(--pp-size) * var(--pp-line) * 1.6); border-bottom: 1px solid #b9c0cf; }
</style>
