<script setup lang="ts">
/**
 * 「题目编辑」弹窗：AppModal 外壳 + QuestionEditor + 底部按钮插槽。
 *
 * 两个入口用它（AI 出题结果卡的「编辑入库」、图片识题校对区的「编辑」），字段集与校验完全一致，
 * 只有底部按钮不同（一个要选存草稿 / 提交审核，一个只是保存改动），所以按钮留在调用方 ——
 * 弹窗只做三件壳该管的事：
 *
 * - 套 AppModal（标题 / 宽度 / 滚动 / Esc）；
 * - **点遮罩不关**：整份编辑内容静默丢弃太亏，要退出请按取消或 ×；
 * - 把 `validate` 透进底部插槽，让按钮自己决定「存草稿（只校验必填）」还是「提交审核（全量校验）」。
 *
 * 弹窗的草稿由调用方在打开时新建（`draftFromGenerated` / `draftFromPhotoResult` / …），
 * 取消即丢弃 —— 本组件不管生命周期，`v-if` 挂载一次就是一次编辑会话。
 */
import { ref } from 'vue'
import { AppModal } from '@aiteach/shared'
import QuestionEditor from '@/components/question/QuestionEditor.vue'
import type { MetaRowKey } from '@/components/question/QuestionEditor.vue'
import type { QuestionDraft } from '@/utils/question-draft'

withDefaults(
  defineProps<{
    draft: QuestionDraft
    title?: string
    width?: number
    /** 透传给 QuestionEditor：弹窗外的入口通常要收掉「学期 / 教材版本」这类存不下去的字段 */
    rows?: MetaRowKey[]
  }>(),
  { title: '编辑题目', width: 860 },
)

const emit = defineEmits<{ close: [] }>()

const editorRef = ref<{ validate: (full: boolean) => Promise<boolean> } | null>(null)

/** 未挂载时返回 false（保守：说不清能不能存就别存）。
 *  QuestionEditor 的「解析为空」确认走 appConfirm，因此整条链路是 async 的。 */
async function validate(full: boolean): Promise<boolean> {
  return editorRef.value?.validate(full) ?? false
}
</script>

<template>
  <AppModal :title="title" :width="width" :close-on-mask="false" @close="emit('close')">
    <QuestionEditor ref="editorRef" :draft="draft" :rows="rows" />

    <template #footer>
      <slot name="footer" :validate="validate" />
    </template>
  </AppModal>
</template>
