<script setup lang="ts">
/**
 * 顶部横向功能区（Word 式）。
 *
 * 它只是一层很薄的壳：真正的功能表在 `doc-plugins.ts`，渲染在 `DocRibbon.vue` ——
 * 这里存在的唯一理由是**排版**：顶部要横着铺、分组之间用竖线分隔、整条贴着画布上沿；
 * 而右侧那条竖排工具栏（DocToolbar.vue）要竖着叠。两者的功能与观感完全一致，
 * 所以分成两个组件而不是给一个组件传一堆 class。
 */
import { AppIcon } from '@aiteach/shared'
import type { Editor } from '@tiptap/vue-3'

import DocRibbon from './DocRibbon.vue'

defineProps<{
  editor: Editor
  /** 正文默认字号（页面设置里的「正文字号」） */
  baseSize?: string
}>()

defineEmits<{
  image: []
  formula: []
  draw: []
  paragraph: []
}>()
</script>

<template>
  <div class="dtt panel">
    <div class="dtt-bar">
      <DocRibbon
        layout="top"
        :editor="editor"
        :base-size="baseSize"
        @image="$emit('image')"
        @formula="$emit('formula')"
        @draw="$emit('draw')"
        @paragraph="$emit('paragraph')"
      />
    </div>
    <p class="dtt-hint">
      <AppIcon name="sparkles" :size="12" />
      选中一段文字会浮出「AI 改这段」；排版菜单在右侧竖栏里也有一份，两处完全等价。
    </p>
  </div>
</template>

<style scoped>
.dtt { padding: 6px 10px 8px; }
.dtt-bar { display: flex; flex-wrap: wrap; align-items: stretch; }
.dtt-hint {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 4px;
  padding-top: 6px;
  border-top: 1px dashed var(--border);
  font-size: 11.5px;
  color: var(--sub);
}
</style>
