<script setup lang="ts">
/**
 * 题目预览抽屉（题库管理 / 录题中心 / 审核中心的题目详情共用）。
 *
 * 此前题库管理与录题页各写一份：一个侧滑抽屉 + 六项元信息 + 分节标题，一个居中弹窗 + 三个 tag，
 * 同一道题在两处两个样子。这里把**抽屉容器**封装掉；正文（元信息 / 题干 / 选项 / 答案 / 解析）
 * 再抽成 QuestionPreviewBody，审核中心的中栏内嵌同一份，页面间不可能漂移。
 *
 * 入参取「预览需要的最小字段集」：题库的 `OrgQuestion` 结构上天然满足；录题页的草稿由父级按需拼
 * 一个对象，缺省项（编号 / 使用次数 / 变体来源 / 审核意见）都标了 `?`，草稿不传即不显示。
 * 纠错记录另走一个可选入参，理由见下方 `corrections`。
 */
import { AppDrawer } from '@aiteach/shared'
import type { QuestionCorrection } from '@aiteach/shared'
import QuestionPreviewBody from '@/components/question/QuestionPreviewBody.vue'
import type { PreviewQuestion } from '@/components/question/QuestionPreviewBody.vue'

/**
 * `corrections` 由调用方按题给（题库管理拉一份纠错记录后按 questionId 分组）。
 * 不并进 `question` 里：纠错是**别的老师提交的反馈流**，不是这道题自身的字段，
 * 录题页拿草稿来预览时天然没有这一段。
 */
withDefaults(
  defineProps<{
    question: PreviewQuestion
    corrections?: QuestionCorrection[]
    /** 遮罩层级，透传给 AppDrawer：从试卷预览（130）里打开时要传 140 才压得住 */
    zIndex?: number
  }>(),
  {
    corrections: () => [],
  },
)
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <AppDrawer
    :title="question.id != null ? `题目 #${question.id}` : '题目预览'"
    subtitle="学生视角预览"
    :z-index="zIndex"
    @close="emit('close')"
  >
    <QuestionPreviewBody :question="question" :corrections="corrections" />
  </AppDrawer>
</template>
