<script setup lang="ts">
/**
 * 题目纠错弹窗：多选问题类型 + 富文本描述 → 提交。
 *
 * 两处刻意的选择：
 * 1. **描述用题干的 RichTextEditor，而不是 textarea**。纠错经常要说「这里的公式应是 …」，
 *    需要能插公式 / 图片，也常要把题干里的式子贴过来 —— 纯文本说不清楚。
 * 2. **类型用共享 AppFilterChips（multiple）**，与筛选面板同一套 chip 交互，
 *    不再自己写一行按钮。
 *
 * 弹窗只产出「一条反馈记录」，不改动题目本身，所以提交成功只需 toast + 关闭：
 * 题目数据没有任何变化，父级没有要刷新的东西。唯一的例外是 **`submitted` 事件**——
 * 调用方（组卷工作台）要据此把按钮从「纠错」翻成「已提交纠错」，好知道这题提过了。
 */
import { computed, ref, watch } from 'vue'
import { AppFilterChips, AppModal, QUESTION_CORRECTION_TYPES, showToast, toPlainText, truncateRich } from '@aiteach/shared'
import type { OrgQuestion, QuestionCorrectionType } from '@aiteach/shared'
import RichTextEditor from '@/components/ui/RichTextEditor.vue'
import { submitQuestionCorrection } from '@/api/org'

const props = defineProps<{
  question: OrgQuestion
  /** 遮罩层级，透传给 AppModal：从试卷预览（130）里打开时要传 140 才压得住 */
  zIndex?: number
}>()
/** `submitted` 只在提交成功后发（取消 / 失败不发），带上题号，父级据此就地更新按钮态 */
const emit = defineEmits<{ close: []; submitted: [questionId: number] }>()

/** 纠错类型是只读元组，摊平成新数组给 AppFilterChips 的 `string[]` */
const TYPE_OPTIONS = [...QUESTION_CORRECTION_TYPES]

const types = ref<string[]>([])
const description = ref('')
const submitting = ref(false)

/** 换一道题（组件被复用）时清空上次的选择，避免把上一题的类型带过来 */
watch(
  () => props.question.id,
  () => {
    types.value = []
    description.value = ''
  },
  { immediate: true },
)

/** 两个必填项都到位才允许提交；按钮态与校验用同一条件，不会出现「能点但被拦」 */
const canSubmit = computed(() => types.value.length > 0 && !!toPlainText(description.value).trim())

async function submit() {
  if (submitting.value) return
  /* 按钮已 disabled，这里再兜一层：回车 / 误触等路径也要给出明确提示而不是静默失败 */
  if (types.value.length === 0) {
    showToast('请至少选择一个纠错类型', 'error')
    return
  }
  if (!toPlainText(description.value).trim()) {
    showToast('请填写问题描述', 'error')
    return
  }
  submitting.value = true
  try {
    await submitQuestionCorrection({
      questionId: props.question.id,
      types: types.value as QuestionCorrectionType[],
      description: description.value,
    })
    showToast('纠错已提交，感谢反馈', 'success')
    emit('submitted', props.question.id)
    emit('close')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '提交失败', 'error')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <!-- 宽度按编辑器的工具栏倒推：580 时工具栏（加粗…重做，含「填空线 / 括号 / 公式 / 图片 / 配图」
       五个带文字按钮）折成两行，编辑区也跟着矮一截。按各按钮的内边距 / 字号算，工具栏单行约需
       700px，加上弹窗左右各 22px 内边距 → 744px 起步，这里取 820 留出余量（字体度量有出入时不至于又折行）。
       窗口更窄时 AppModal 的 max-width 会兜住，那时工具栏只能折行。 -->
  <AppModal title="题目纠错" :width="820" :z-index="zIndex" @close="emit('close')">
    <div class="qcd-target">
      <span class="qcd-id">#{{ question.id }}</span>
      <span class="qcd-stem">{{ truncateRich(question.stem, 60) }}</span>
    </div>

    <div class="f-field">
      <label class="f-label">问题类型<span class="req">*</span></label>
      <!-- 行首标签由上方的 .f-label 承担；chip 行自带的空标签位与间隙一并去掉，与上标签左对齐 -->
      <AppFilterChips v-model="types" class="qcd-chips" label="" label-width="0px" :options="TYPE_OPTIONS" />
      <p class="f-hint">可多选，选中最贴切的几项，便于题库侧分类处理。</p>
    </div>

    <div class="f-field">
      <label class="f-label">问题描述<span class="req">*</span></label>
      <!-- 弹窗加宽后编辑区跟着放宽，140 会显得扁；160 与工具栏 + 一行正文的比例更顺眼 -->
      <RichTextEditor
        v-model="description"
        :subject="question.subject"
        :min-height="160"
        placeholder="请说明问题所在，可插入公式、图片，或把题干片段贴进来…"
      />
    </div>

    <template #footer>
      <button class="btn btn-ghost" type="button" :disabled="submitting" @click="emit('close')">取消</button>
      <button class="btn btn-primary" type="button" :disabled="submitting || !canSubmit" @click="submit">
        {{ submitting ? '提交中…' : '提交' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.qcd-target {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 9px 12px;
  margin-bottom: 16px;
  border-radius: 10px;
  background: #f7fafa;
  font-size: 12.5px;
  color: var(--ink-2);
  line-height: 1.6;
}
.qcd-id { font-weight: 700; color: var(--ink); flex-shrink: 0; }
.qcd-stem { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 去掉 chip 行首空标签留下的 12px 间隙，让选项与上方「问题类型」左对齐 */
.qcd-chips :deep(.chip-row) { gap: 0; }
</style>
