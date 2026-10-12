<script setup lang="ts">
/**
 * 题目纠错弹窗：多选问题类型 + 问题描述 → 提交。
 *
 * 两处刻意的选择：
 * 1. **描述框走 `#description` 插槽**，默认回退为 `<textarea>`。带公式 / 图片的富文本编辑器
 *    （题干那套 tiptap）体积很大，且两端各有各的实现 —— 机构端有、平台端暂无。
 *    用插槽把编辑器交给宿主，公共组件只保留「一个能输入描述的框」这个骨架，
 *    免得为了一个输入框把整条富文本依赖链拖进公共包。
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
import { useBusinessApi } from '../../api/business-api'

const props = withDefaults(
  defineProps<{
    question: OrgQuestion
    /** 遮罩层级，透传给 AppModal：从试卷预览（130）里打开时要传 140 才压得住 */
    zIndex?: number
    /**
     * 弹窗宽度。宿主用富文本编辑器（工具栏较宽）时自己传大值；
     * 默认值按纯文本输入框的比例给。
     */
    width?: number
  }>(),
  { width: 620 },
)

/** 接口实现由宿主注入（见 src/api/business-api.ts） */
const api = useBusinessApi()
/**
 * `submitted` 只在提交成功后发（取消 / 失败不发），带上**这次纠错的全部内容**而不是只有题号：
 * 父级除了把按钮翻成「已提交纠错」，还要把这条反馈记进卷面评论（组卷编辑页），
 * 只有题号写不出一条有内容的评论。
 */
const emit = defineEmits<{
  close: []
  submitted: [payload: { questionId: number; types: string[]; description: string }]
}>()

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
    await api.submitQuestionCorrection({
      questionId: props.question.id,
      types: types.value as QuestionCorrectionType[],
      description: description.value,
    })
    showToast('纠错已提交，感谢反馈', 'success')
    emit('submitted', { questionId: props.question.id, types: [...types.value], description: description.value })
    emit('close')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '提交失败', 'error')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <AppModal title="题目纠错" :width="width" :z-index="zIndex" @close="emit('close')">
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
      <!-- 富文本编辑器由宿主提供（`v-model` = 描述文本）；不提供时退回纯文本输入框 -->
      <slot name="description" :model-value="description" :subject="question.subject" :update="(v: string) => (description = v)">
        <textarea
          v-model="description"
          class="f-textarea"
          rows="6"
          placeholder="请说明问题所在（如「这里的分母写错了」）…"
        />
      </slot>
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
  /* 品牌淡底：两端令牌不同色相，靠变量自动跟随（公共组件里不写死任何一个端的品牌色） */
  background: var(--brand-soft);
  font-size: 12.5px;
  color: var(--ink-2);
  line-height: 1.6;
}
.qcd-id { font-weight: 700; color: var(--ink); flex-shrink: 0; }
.qcd-stem { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 去掉 chip 行首空标签留下的 12px 间隙，让选项与上方「问题类型」左对齐 */
.qcd-chips :deep(.chip-row) { gap: 0; }
</style>
