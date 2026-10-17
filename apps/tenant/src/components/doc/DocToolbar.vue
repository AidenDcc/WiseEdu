<script setup lang="ts">
/**
 * 教案 / 学案 / 讲义文档编辑器的**右侧竖排工具栏**。
 *
 * 与顶部功能区（DocToolbarTop.vue）是同一份功能的两种排版：功能表在 `doc-plugins.ts`、
 * 渲染在 `DocRibbon.vue`，这里只把 `layout` 设成 `rail`。
 *
 * 为什么顶部已经有了还要留这一条竖排：
 * - 窄屏 / 分屏时顶部功能区会折行成两三层，把纸挤得只剩一半；竖排不吃纸的宽度；
 * - 老师改稿时手常常停在右侧，竖排离得更近。
 * 两处共用同一份注册表，所以不存在「一边有、一边没有」的漂移 —— 这也是这次改造的重点。
 *
 * 边界划分与 RteToolbar 一致：**只碰编辑器内容的动作在注册表里**（加粗、改行距、插表格、格式刷……），
 * 需要媒体库 / 弹窗的动作（图片、公式、理科配图、段落对话框）emit 回 DocCanvas —— 那些状态的宿主是页面。
 */
import type { Editor } from '@tiptap/vue-3'

import DocRibbon from './DocRibbon.vue'

defineProps<{
  editor: Editor
  /** 正文默认字号（页面设置里的「正文字号」），用于「默认字号」那一档的展示 */
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
  <div class="dt">
    <DocRibbon
      layout="rail"
      :editor="editor"
      :base-size="baseSize"
      @image="$emit('image')"
      @formula="$emit('formula')"
      @draw="$emit('draw')"
      @paragraph="$emit('paragraph')"
    />
  </div>
</template>

<style scoped>
.dt { display: flex; flex-direction: column; }
</style>
