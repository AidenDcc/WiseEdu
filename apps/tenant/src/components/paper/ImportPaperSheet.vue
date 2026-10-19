<script setup lang="ts">
/**
 * 试卷导入 · 「识别结果」的纸面预览。
 *
 * 识别完不直接丢一张表单给老师 —— 试卷是**版面物**，题干、选项、分值、大题标题挤在一起才看得出
 * 「这份卷子像不像原卷」。所以这里按 A4 纸面排版渲染，题目块可点选、可编辑、可移出，
 * 与右侧清单双向联动（选中态由父页持有，本组件只负责画）。
 *
 * 刻意不复用 `PaperPreviewModal`：那是「看一份已入库的卷」的弹窗（分版、答题卡、分享、平行卷…），
 * 而这里要的是**同一页里可编辑的校对视图** —— 弹窗遮住半屏之后就没地方摆校对面板了。
 * 真正要看排版效果时，父页会另开 `PaperPreviewModal`（工具栏「排版预览」）。
 */
import { computed } from 'vue'
import { RichTextViewer } from '@aiteach/shared'
import { QuestionOptions } from '@aiteach/business-common'
import type { RecognizedQuestion, RecognizedSection } from '@/api/ai-paper-import'

const props = withDefaults(
  defineProps<{
    name: string
    subject: string
    grade: string
    duration: number
    notices: string[]
    sections: RecognizedSection[]
    questions: RecognizedQuestion[]
    selectedId: string | null
    /** 是否显示答案与解析（校对答案时开，纯看卷面时关） */
    showAnswer?: boolean
    /** 卷面识别结论（一行说明，如「共 2 页 · 单栏 · 有答题卡」） */
    layoutNote?: string
  }>(),
  { showAnswer: true, layoutNote: '' },
)

const emit = defineEmits<{
  select: [id: string]
  edit: [id: string]
  /** 纳入 / 移出 */
  toggle: [id: string]
  /** 上移 / 下移（-1 / +1） */
  move: [id: string, step: number]
}>()

const totalScore = computed(() =>
  props.questions.filter((row) => row.include).reduce((sum, row) => sum + (Number(row.score) || 0), 0),
)
const totalCount = computed(() => props.questions.filter((row) => row.include).length)

/** 只渲染有题目的大题：卷面识别读到大题、题目却没识别进来时不留空标题 */
const visibleSections = computed(() =>
  props.sections
    .map((section) => ({
      section,
      items: props.questions.filter((row) => row.sectionId === section.id),
    }))
    .filter((row) => row.items.length > 0),
)

function scoreText(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)))
}

function sectionScore(sectionId: string): number {
  return props.questions
    .filter((row) => row.sectionId === sectionId && row.include)
    .reduce((sum, row) => sum + (Number(row.score) || 0), 0)
}

/** 选项排布：4 个选项两列，判断题（2 个短选项）也两列，其余单列 */
function optionColumns(count: number): 1 | 2 {
  return count === 2 || count === 4 ? 2 : 1
}
</script>

<template>
  <div class="sheet">
    <!-- 卷头：与真实卷子一致（卷名 / 学段学科 / 满分时长 / 注意事项） -->
    <header class="sheet-head">
      <h2 class="sheet-title">{{ name || '未命名试卷' }}</h2>
      <p class="sheet-sub">
        {{ [grade, subject].filter(Boolean).join(' · ') || '学段学科待确认' }}
        <span class="dot">·</span> 满分 {{ scoreText(totalScore) }} 分
        <span class="dot">·</span> 考试时间 {{ duration || 120 }} 分钟
        <span class="dot">·</span> 共 {{ totalCount }} 题
      </p>
      <p v-if="layoutNote" class="sheet-layout">{{ layoutNote }}</p>
      <ol v-if="notices.length" class="sheet-notices">
        <li v-for="(item, index) in notices" :key="index">{{ item }}</li>
      </ol>
    </header>

    <section v-for="group in visibleSections" :key="group.section.id" class="sheet-section">
      <h3 class="sec-title">
        {{ group.section.title }}
        <span class="sec-score">（共 {{ scoreText(sectionScore(group.section.id)) }} 分）</span>
      </h3>
      <p v-if="group.section.hint" class="sec-hint">{{ group.section.hint }}</p>
      <div v-if="group.section.material" class="sec-material">
        <RichTextViewer :content="group.section.material" />
      </div>

      <article
        v-for="row in group.items"
        :key="row.id"
        class="q-block"
        :class="{ on: selectedId === row.id, off: !row.include }"
        :data-qid="row.id"
        @click="emit('select', row.id)"
      >
        <div class="q-head">
          <span class="q-no">{{ row.number }}.</span>
          <span class="q-score">（{{ scoreText(row.score) }} 分）</span>
          <span class="q-type">{{ row.type }}</span>
          <span v-if="!row.include" class="tag tag-gray">不纳入</span>
          <span v-else-if="row.issues.some((item) => item.level === 'error')" class="tag tag-red">AI 异常</span>
          <span v-else-if="row.issues.length" class="tag tag-orange">AI 提醒</span>
          <span v-if="row.aiCorrected" class="tag tag-blue">AI 已修正</span>
          <span v-if="row.edited" class="tag tag-green">已修改</span>
          <!-- 悬停操作条：只在选中 / 悬停时出现，平时让卷面干净 -->
          <span class="q-ops">
            <button type="button" @click.stop="emit('edit', row.id)">编辑</button>
            <button type="button" @click.stop="emit('toggle', row.id)">{{ row.include ? '移出' : '纳入' }}</button>
            <button type="button" title="在本大题内上移" @click.stop="emit('move', row.id, -1)">上移</button>
            <button type="button" title="在本大题内下移" @click.stop="emit('move', row.id, 1)">下移</button>
          </span>
        </div>

        <RichTextViewer class="q-stem" :content="row.stem" empty="（题干为空，请补录）" />
        <QuestionOptions
          v-if="row.options.length"
          class="q-opts"
          variant="doc"
          :options="row.options"
          :columns="optionColumns(row.options.length)"
        />

        <div v-if="showAnswer" class="q-answer">
          <p class="qa-line">
            <b>答案</b>
            <!-- 客观题答案是选项字母（纯文本）；主观题答案是富文本（公式 / 插图） -->
            <span v-if="row.options.length" class="qa-letter">{{ row.answer || '—' }}</span>
            <RichTextViewer v-else :content="row.answer" tag="span" empty="—" />
          </p>
          <p class="qa-line">
            <b>解析</b>
            <RichTextViewer :content="row.analysis" tag="span" empty="—" />
          </p>
          <p v-for="(issue, index) in row.issues" :key="index" class="qa-issue" :class="issue.level">
            <b>AI 质检 · {{ issue.aspect }}</b>{{ issue.message }}
          </p>
        </div>
      </article>
    </section>

    <p v-if="!visibleSections.length" class="sheet-empty">还没有识别出题目</p>
  </div>
</template>

<style scoped>
/* 纸面：宽度吃满容器，内边距按 A4 比例给（上 46 / 左右 44），底色白 + 细边框，
   与预览弹窗的纸张观感一致，但**不做分页** —— 校对视的是内容，不是页数 */
.sheet {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 40px 44px 48px;
  box-shadow: var(--shadow);
  color: var(--ink);
}

/* ===== 卷头 ===== */
.sheet-head {
  text-align: center;
  padding-bottom: 16px;
  border-bottom: 1px dashed var(--border);
  margin-bottom: 18px;
}
.sheet-title {
  font-size: 19px;
  font-weight: 700;
  letter-spacing: 0.5px;
  line-height: 1.5;
  margin-bottom: 8px;
}
.sheet-sub {
  font-size: 12.5px;
  color: var(--ink-2);
}
.sheet-sub .dot {
  color: var(--sub);
  margin: 0 4px;
}
.sheet-layout {
  margin-top: 6px;
  font-size: 11.5px;
  color: var(--sub);
}
.sheet-notices {
  margin: 12px auto 0;
  max-width: 620px;
  text-align: left;
  font-size: 11.5px;
  line-height: 1.85;
  color: var(--sub);
  list-style: decimal;
  padding-left: 18px;
}

/* ===== 大题 ===== */
.sheet-section {
  margin-bottom: 22px;
}
.sec-title {
  font-size: 14.5px;
  font-weight: 700;
  color: var(--ink);
  margin-bottom: 6px;
}
.sec-score {
  font-size: 12px;
  font-weight: 400;
  color: var(--sub);
}
.sec-hint {
  font-size: 11.5px;
  color: var(--sub);
  margin-bottom: 8px;
}
.sec-material {
  font-size: 12.5px;
  color: var(--ink-2);
  line-height: 1.8;
  border-left: 3px solid var(--border);
  padding: 2px 0 2px 12px;
  margin-bottom: 10px;
}

/* ===== 题目块 ===== */
.q-block {
  position: relative;
  border: 1px solid transparent;
  border-radius: 9px;
  padding: 8px 10px 10px;
  margin: 0 -10px 6px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.q-block:hover {
  background: #fafcfe;
  border-color: var(--border);
}
.q-block.on {
  background: var(--brand-soft);
  border-color: rgba(0, 180, 166, 0.45);
}
.q-block.off {
  opacity: 0.48;
}
.q-block.off .q-stem {
  text-decoration: line-through;
  text-decoration-color: rgba(0, 0, 0, 0.2);
}

.q-head {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}
.q-no {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--ink);
}
.q-score {
  font-size: 12px;
  color: var(--sub);
}
.q-type {
  font-size: 11px;
  color: var(--sub);
  background: #f3f5fa;
  border-radius: 999px;
  padding: 1px 7px;
}
.q-ops {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.15s;
}
.q-block:hover .q-ops,
.q-block.on .q-ops {
  opacity: 1;
}
.q-ops button {
  border: none;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 11.5px;
  color: var(--ink-2);
  padding: 2px 7px;
  line-height: 1.6;
}
.q-ops button:hover {
  border-color: var(--brand);
  color: var(--brand-deep);
}

.q-stem {
  font-size: 13.5px;
  line-height: 1.85;
  color: var(--ink);
}
.q-opts {
  margin-top: 6px;
  padding-left: 6px;
}

/* ===== 答案 / 解析（校对态） ===== */
.q-answer {
  margin-top: 7px;
  padding: 8px 10px;
  border-radius: 8px;
  background: #f7fafc;
  border: 1px dashed var(--border);
  font-size: 12.5px;
  line-height: 1.75;
  color: var(--ink-2);
}
.qa-line {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.qa-line b {
  flex-shrink: 0;
  font-size: 11.5px;
  color: var(--brand-deep);
  background: var(--brand-soft);
  border-radius: 5px;
  padding: 1px 6px;
  line-height: 1.7;
}
.qa-letter {
  font-weight: 700;
  color: var(--success);
  letter-spacing: 1px;
}
.qa-issue {
  margin-top: 5px;
  font-size: 11.5px;
  color: var(--warn);
}
.qa-issue.error {
  color: var(--danger);
}
.qa-issue b {
  color: inherit;
  background: none;
  padding: 0;
  margin-right: 4px;
}
.sheet-empty {
  text-align: center;
  color: var(--sub);
  font-size: 13px;
  padding: 40px 0;
}
</style>
