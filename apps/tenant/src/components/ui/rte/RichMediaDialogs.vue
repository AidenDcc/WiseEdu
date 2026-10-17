<script setup lang="ts">
/**
 * 富文本编辑器「公式 / 图片 / 理科配图」三个按钮要开的弹窗宿主。
 *
 * 五个弹窗的**开闭与数据流**都在 useRichMediaPlumbing 里，本组件只负责「把状态接到弹窗上」。
 * 抽出来的唯一理由是：录题编辑器与备课文档编辑器要用同一批弹窗、同一套绑定，写两份必然慢慢长歪
 * （改了一处的标题、另一处忘了改）。
 *
 * 之所以不是「把弹窗塞进 composable」，是因为 composable 里不放模板 —— 弹窗得由渲染层挂在模板上。
 */
import type { Editor } from '@tiptap/vue-3'
import FormulaInlineInput from './FormulaInlineInput.vue'
import FormulaPickerModal from '../FormulaPickerModal.vue'
import MediaPickerModal from '../MediaPickerModal.vue'
import MediaDrawSelectDialog from '@/components/draw/MediaDrawSelectDialog.vue'
import AiDrawGenerateDialog from '@/components/draw/AiDrawGenerateDialog.vue'
import DrawEditorHost from '@/components/draw/DrawEditorHost.vue'
import type { RichMediaPlumbing } from './useRichMediaPlumbing'

const props = defineProps<{
  /** useRichMediaPlumbing 的返回值（原样传入，不做二次包装） */
  media: RichMediaPlumbing
  editor: Editor
  /** 当前学科：公式库筛选项与配图入库用 */
  subject: string
}>()
</script>

<template>
  <!-- 内联公式输入框：贴光标开、失焦即转成正文公式。key 让它每次「插入公式」都重新贴光标定位 -->
  <FormulaInlineInput
    v-if="props.media.inlineMath.value"
    :key="props.media.inlineMathSession.value"
    :editor="editor"
    :pos="props.media.inlineMath.value.pos"
    :initial-latex="props.media.inlineMath.value.latex"
    :initial-block="props.media.inlineMath.value.block"
    :subject="subject"
    @insert="props.media.onInlineInsert"
    @cancel="props.media.inlineMath.value = null"
    @open-editor="props.media.onInlineOpenEditor"
  />

  <FormulaPickerModal
    v-if="props.media.mathOpen.value"
    :subject="subject"
    :initial-latex="props.media.mathInitialLatex.value"
    :editing="props.media.mathEditingPos.value !== null"
    :initial-block="props.media.mathEditingBlock.value"
    @close="props.media.onMathClose"
    @confirm="props.media.onMathConfirm"
  />

  <MediaPickerModal
    v-if="props.media.imageOpen.value"
    :subject="subject"
    @close="props.media.imageOpen.value = false"
    @pick="props.media.onPickMedia"
    @pick-file="props.media.onPickFile"
  />

  <MediaDrawSelectDialog
    v-if="props.media.drawSelectOpen.value"
    @close="props.media.drawSelectOpen.value = false"
    @manual="props.media.onDrawManual"
    @ai="props.media.onDrawAi"
  />

  <AiDrawGenerateDialog
    v-if="props.media.aiDrawOpen.value"
    :initial-type="props.media.aiDrawOpen.value"
    @close="props.media.aiDrawOpen.value = null"
    @draft="props.media.onDrawDraft"
  />

  <DrawEditorHost
    v-if="props.media.drawHost.value"
    purpose="insert"
    :editor-type="props.media.drawHost.value.editorType"
    :media-id="props.media.drawHost.value.mediaId"
    :initial-project-json="props.media.drawHost.value.projectJson"
    :initial-molfile="props.media.drawHost.value.molfileText"
    :subject="subject"
    @close="props.media.drawHost.value = null"
    @saved="props.media.onDrawSaved"
  />
</template>
