<script lang="ts">
/** 题目预览正文（题库管理的预览抽屉 / 审核中心的题目详情共用）：
 *  元信息栅格 + 题干 / 选项 / 答案 / 解析分节，结构与样式只在这一份里，两处渲染一模一样。 */

/** 材料组合题的子题（结构与 `OrgSubQuestion` 一致，这里只声明预览需要的字段） */
export interface PreviewSubQuestion {
  id: number
  type: string
  difficulty: string
  knowledge: string[]
  stem: string
  options: string[]
  answer: string
  analysis: string
  optionColumns?: 1 | 2 | 4
}

export interface PreviewQuestion {
  /** 题目编号；录题页的新建草稿还没有入库，无编号 */
  id?: number
  subject: string
  grade: string
  type: string
  difficulty: string
  knowledge: string[]
  source: string
  library: string
  /** 所属对象（平台 / 校本 / 个人）；缺省时由 library 兜底推导，草稿不传 */
  scope?: 'platform' | 'school' | 'personal'
  term?: string
  examType?: string
  /** 使用次数：草稿尚未入库、更没被使用过，不传则显示「—」而不是假数据「0 次」 */
  useCount?: number
  stem: string
  options: string[]
  answer: string
  analysis: string
  optionColumns?: 1 | 2 | 4
  /** 题目类别；缺省 = 独立单题。材料组合题时 `stem` 是共用题干 / 材料，正文在 `subQuestions` 里 */
  questionCategory?: string
  /** 子题（仅材料组合题） */
  subQuestions?: PreviewSubQuestion[]
  /** 变式母题编号（v-if 判空，草稿不传） */
  variantOf?: number
  reviewOpinion?: string
}
</script>

<script setup lang="ts">
import { computed } from 'vue'
import { RichTextViewer } from '@aiteach/shared'
import type { QuestionCorrection } from '@aiteach/shared'
import QuestionOptions from './QuestionOptions.vue'
import { isJudgeNoOptions, judgeAnswerText, optionColumnsOf } from '../../utils/question-card'

/** `corrections` 只有题库管理（和将来的纠错处理页）会传；审核中心 / 录题页不传即不显示这一段 */
const props = withDefaults(defineProps<{ question: PreviewQuestion; corrections?: QuestionCorrection[] }>(), {
  corrections: () => [],
})

const LIBRARY_TEXT: Record<string, string> = { personal: '个人题库', org: '机构公共', wrong: '错题库' }

/** 材料组合题：`stem` 是共用题干 / 材料，真正的作答单位是子题 */
const composite = computed(() => props.question.questionCategory === '材料组合题')
const subQuestions = computed(() => props.question.subQuestions ?? [])

/** 子题的选项列数：不传按单列（与题目自身的口径一致，见 optionColumnsOf） */
function subOptionColumns(row: PreviewSubQuestion): 1 | 2 | 4 {
  return optionColumnsOf(row)
}
</script>

<template>
  <!-- .detail-grid / .detail-item / .d-label / .d-value / .section-title 都是 main.css 的全局类 -->
  <div class="detail-grid">
    <div class="detail-item"><div class="d-label">学科 / 年级</div><div class="d-value">{{ question.subject || '—' }} · {{ question.grade || '—' }}</div></div>
    <div class="detail-item">
      <div class="d-label">{{ composite ? '题目类别 / 题型' : '题型 / 难度' }}</div>
      <div class="d-value">
        <template v-if="composite">{{ question.questionCategory }} · {{ question.type }}</template>
        <template v-else>{{ question.type }} · {{ question.difficulty }}</template>
      </div>
    </div>
    <div v-if="composite" class="detail-item"><div class="d-label">母题难度</div><div class="d-value">{{ question.difficulty }}</div></div>
    <div class="detail-item"><div class="d-label">知识点</div><div class="d-value">{{ question.knowledge.join('、') || '—' }}</div></div>
    <div class="detail-item"><div class="d-label">来源 / 库</div><div class="d-value">{{ question.source }} · {{ LIBRARY_TEXT[question.library] }}</div></div>
    <div class="detail-item"><div class="d-label">学期 / 考试类型</div><div class="d-value">{{ question.term ?? '—' }} · {{ question.examType ?? '—' }}</div></div>
    <div class="detail-item">
      <div class="d-label">使用次数</div>
      <div class="d-value">{{ question.useCount == null ? '—' : `${question.useCount} 次` }}</div>
    </div>
  </div>

  <h4 class="section-title">{{ composite ? '共用题干 / 材料' : '题干' }}</h4>
  <RichTextViewer class="q-text" :content="question.stem" empty="—" />

  <!-- 材料组合题：不做「答案 / 解析」分节，逐题列出子题（每题自带选项 / 答案 / 解析） -->
  <template v-if="composite">
    <h4 class="section-title">子题 <span class="sub-count">{{ subQuestions.length }} 道</span></h4>
    <div v-if="subQuestions.length" class="sub-list">
      <article v-for="(sub, i) in subQuestions" :key="sub.id" class="sub-item">
        <div class="sub-head">
          <span class="sub-no">（{{ i + 1 }}）</span>
          <span class="tag tag-blue">{{ sub.type }}</span>
          <span class="sub-meta">{{ sub.difficulty }}<template v-if="sub.knowledge.length"> · {{ sub.knowledge.join('、') }}</template></span>
        </div>
        <RichTextViewer class="sub-stem" :content="sub.stem" empty="—" />
        <QuestionOptions v-if="sub.options.length" variant="soft" :options="sub.options" :columns="subOptionColumns(sub)" />
        <p class="sub-line"><span class="sub-label">答案</span>
          <span v-if="sub.options.length || isJudgeNoOptions(sub)" class="sub-answer">
            {{ isJudgeNoOptions(sub) ? judgeAnswerText(sub.answer) : sub.answer || '—' }}
          </span>
          <RichTextViewer v-else class="sub-rich" :content="sub.answer" empty="—" />
        </p>
        <p class="sub-line"><span class="sub-label">解析</span>
          <RichTextViewer class="sub-rich" :content="sub.analysis" empty="—" />
        </p>
      </article>
    </div>
    <p v-else class="q-text">尚未添加子题。</p>
  </template>

  <template v-else>
    <template v-if="question.options.length > 0">
      <h4 class="section-title">选项</h4>
      <!-- 不传 answer：选项里不标正确项，答案统一看下方「答案」一节 -->
      <QuestionOptions variant="soft" :options="question.options" :columns="optionColumnsOf(question)" />
    </template>

    <h4 class="section-title">答案</h4>
    <!-- 客观题答案是字母、无选项判断题是「对 / 错」，都用纯文本；其余（填空 / 解答）是富文本 -->
    <p v-if="question.options.length || isJudgeNoOptions(question)" class="q-text answer">
      {{ isJudgeNoOptions(question) ? judgeAnswerText(question.answer) : question.answer || '—' }}
    </p>
    <RichTextViewer v-else class="q-text" :content="question.answer" empty="—" />

    <h4 class="section-title">解析</h4>
    <RichTextViewer class="q-text" :content="question.analysis" empty="—" />
  </template>

  <!-- 纠错记录：老师提交的反馈（类型多条 + 富文本描述），按提交时间倒序。
       与「审核意见」是两条线 —— 这是同事提的问题，不是审核结论 -->
  <template v-if="corrections.length > 0">
    <h4 class="section-title">
      纠错记录
      <span class="correction-count">{{ corrections.length }} 条</span>
    </h4>
    <div class="correction-list">
      <article v-for="item in corrections" :key="item.id" class="correction">
        <div class="correction-head">
          <span v-for="type in item.types" :key="type" class="tag tag-orange">{{ type }}</span>
          <span class="correction-meta">{{ item.reporter }} · {{ item.createdAt.slice(5, 16) }}</span>
        </div>
        <RichTextViewer class="correction-text" :content="item.description" empty="—" />
      </article>
    </div>
  </template>

  <template v-if="question.variantOf != null">
    <h4 class="section-title">变式关联</h4>
    <p class="q-text">本题为题目 #{{ question.variantOf }} 的变式，原题-变式关联永久存档，可互跳。</p>
  </template>
  <template v-if="question.reviewOpinion">
    <h4 class="section-title">审核意见</h4>
    <p class="q-text reject">{{ question.reviewOpinion }}</p>
  </template>
</template>

<style scoped>
/* `.section-title` 是全局类（main.css），只带 margin-bottom —— 小标题会贴在上方内容上，这里补上间距 */
.section-title { margin-top: 18px; }

.q-text {
  font-size: 13.5px;
  color: var(--ink-2);
  line-height: 1.8;
  background: var(--brand-soft);
  border-radius: 10px;
  padding: 12px 14px;
}
.q-text.answer { color: var(--success); font-weight: 600; }
.q-text.reject { color: var(--danger); }

/* ===== 材料组合题：子题列表 =====
   每道子题一张卡，题干与选项用与母题同源的排版，答案 / 解析压成「标签 + 值」一行 —— 
   组合题往往有四五道子题，每题都铺开「答案 / 解析」两个小标题会把抽屉拉得很长。 */
.sub-count { margin-left: 4px; font-size: 12px; font-weight: 600; color: var(--sub); }
.sub-list { display: flex; flex-direction: column; gap: 10px; }
.sub-item {
  border: 1px solid var(--border);
  border-left: 3px solid var(--brand);
  border-radius: 0 10px 10px 0;
  padding: 10px 14px;
  background: #fff;
}
.sub-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
.sub-no { font-size: 13px; font-weight: 700; color: var(--brand-deep); }
.sub-meta { font-size: 12px; color: var(--sub); }
.sub-stem { font-size: 13.5px; color: var(--ink-2); line-height: 1.8; }
.sub-line { display: flex; align-items: flex-start; gap: 8px; margin: 8px 0 0; }
.sub-label { flex-shrink: 0; font-size: 12px; font-weight: 600; color: var(--sub); padding-top: 3px; }
.sub-answer { font-size: 13px; font-weight: 600; color: var(--success); }
.sub-rich { flex: 1; min-width: 0; font-size: 13px; color: var(--ink-2); line-height: 1.7; }

/* ===== 纠错记录 ===== */
.correction-count { margin-left: 4px; font-size: 12px; font-weight: 600; color: var(--danger); }
.correction-list { display: flex; flex-direction: column; gap: 10px; }
/* 左侧红条与「审核意见」的样式同源，一眼能认出是「有问题」的信息而非题目正文 */
.correction {
  border: 1px solid var(--border);
  border-left: 3px solid var(--danger);
  border-radius: 0 10px 10px 0;
  padding: 10px 14px;
  background: var(--danger-soft);
}
.correction-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 6px; }
/* 提交人 / 时间推到行尾；类型多时自动换行，不会被挤扁 */
.correction-meta { margin-left: auto; font-size: 12px; color: var(--sub); }
.correction-text { font-size: 13.5px; color: var(--ink-2); line-height: 1.8; }
</style>
