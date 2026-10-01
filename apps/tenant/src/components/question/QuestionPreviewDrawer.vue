<script setup lang="ts">
/**
 * 题目预览抽屉（题库管理 / 录题中心共用）。
 *
 * 此前两页各写一份：题库管理是侧滑抽屉 + 六项元信息 + 分节标题，录题页是居中弹窗 + 三个 tag，
 * 同一道题在两处两个样子。这里把**抽屉容器一起**封装掉（而不是只抽内容），两页调用的就是同一个
 * 组件，样式与结构不再可能各自漂移。
 *
 * 入参取「预览需要的最小字段集」：题库的 `OrgQuestion` 结构上天然满足；录题页的草稿由父级按需拼
 * 一个对象，缺省项（编号 / 使用次数 / 变体来源 / 审核意见）都标了 `?`，草稿不传即不显示。
 */
import { RichTextViewer } from '@aiteach/shared'
import type { QuestionLibrary, QuestionSource } from '@aiteach/shared'
import AppDrawer from '@/components/ui/AppDrawer.vue'
import QuestionOptions from '@/components/question/QuestionOptions.vue'
import { isJudgeNoOptions, judgeAnswerText, optionColumnsOf } from '@/utils/question-card'

interface PreviewQuestion {
  /** 题目编号；录题页的新建草稿还没有入库，无编号 */
  id?: number
  subject: string
  grade: string
  type: string
  difficulty: string
  knowledge: string[]
  source: QuestionSource
  library: QuestionLibrary
  term?: string
  examType?: string
  /** 使用次数：草稿尚未入库、更没被使用过，不传则显示「—」而不是假数据「0 次」 */
  useCount?: number
  stem: string
  options: string[]
  answer: string
  analysis: string
  optionColumns?: 1 | 2 | 4
  /** 变式母题编号（v-if 判空，草稿不传） */
  variantOf?: number
  reviewOpinion?: string
}

defineProps<{ question: PreviewQuestion }>()
const emit = defineEmits<{ close: [] }>()

const LIBRARY_TEXT: Record<string, string> = { personal: '个人题库', org: '机构公共', wrong: '错题库' }
</script>

<template>
  <AppDrawer
    :title="question.id != null ? `题目 #${question.id}` : '题目预览'"
    subtitle="学生视角预览"
    @close="emit('close')"
  >
    <!-- .detail-grid / .detail-item / .d-label / .d-value / .section-title 都是 main.css 的全局类 -->
    <div class="detail-grid">
      <div class="detail-item"><div class="d-label">学科 / 年级</div><div class="d-value">{{ question.subject || '—' }} · {{ question.grade || '—' }}</div></div>
      <div class="detail-item"><div class="d-label">题型 / 难度</div><div class="d-value">{{ question.type }} · {{ question.difficulty }}</div></div>
      <div class="detail-item"><div class="d-label">知识点</div><div class="d-value">{{ question.knowledge.join('、') || '—' }}</div></div>
      <div class="detail-item"><div class="d-label">来源 / 库</div><div class="d-value">{{ question.source }} · {{ LIBRARY_TEXT[question.library] }}</div></div>
      <div class="detail-item"><div class="d-label">学期 / 考试类型</div><div class="d-value">{{ question.term ?? '—' }} · {{ question.examType ?? '—' }}</div></div>
      <div class="detail-item">
        <div class="d-label">使用次数</div>
        <div class="d-value">{{ question.useCount == null ? '—' : `${question.useCount} 次` }}</div>
      </div>
    </div>

    <h4 class="section-title">题干</h4>
    <RichTextViewer class="q-text" :content="question.stem" empty="—" />

    <template v-if="question.options.length > 0">
      <h4 class="section-title">选项</h4>
      <QuestionOptions
        variant="soft"
        :options="question.options"
        :answer="question.answer"
        :columns="optionColumnsOf(question)"
      />
    </template>

    <h4 class="section-title">答案</h4>
    <!-- 客观题答案是字母、无选项判断题是「对 / 错」，都用纯文本；其余（填空 / 解答）是富文本 -->
    <p v-if="question.options.length || isJudgeNoOptions(question)" class="q-text answer">
      {{ isJudgeNoOptions(question) ? judgeAnswerText(question.answer) : question.answer || '—' }}
    </p>
    <RichTextViewer v-else class="q-text" :content="question.answer" empty="—" />

    <h4 class="section-title">解析</h4>
    <RichTextViewer class="q-text" :content="question.analysis" empty="—" />

    <template v-if="question.variantOf != null">
      <h4 class="section-title">变式关联</h4>
      <p class="q-text">本题为题目 #{{ question.variantOf }} 的变式，原题-变式关联永久存档，可互跳。</p>
    </template>
    <template v-if="question.reviewOpinion">
      <h4 class="section-title">审核意见</h4>
      <p class="q-text reject">{{ question.reviewOpinion }}</p>
    </template>
  </AppDrawer>
</template>

<style scoped>
/* `.section-title` 是全局类（main.css），只带 margin-bottom —— 小标题会贴在上方内容上，
   这里补上间距。抽屉内容写在本题的模板里，teleport 到 body 也带着本组件的 scope id，
   且 scoped 规则特异性高于全局规则，所以不会外溢到别处的 section-title */
.section-title { margin-top: 18px; }

.q-text {
  font-size: 13.5px;
  color: var(--ink-2);
  line-height: 1.8;
  background: #f7fafa;
  border-radius: 10px;
  padding: 12px 14px;
}
.q-text.answer { color: var(--success); font-weight: 600; }
.q-text.reject { color: var(--danger); }
</style>
