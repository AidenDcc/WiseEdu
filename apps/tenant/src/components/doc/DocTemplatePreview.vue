<script setup lang="ts">
/**
 * 整篇内容预览（模板骨架 / AI 生成草稿共用）。
 *
 * 两处预览必须是**同一套界面**：老师判断「这份模板能不能用」与「AI 这份稿子能不能用」
 * 用的是同一双眼睛，两套预览的排版、栏宽、字号不一样，就会得出不一样的结论。
 *
 * 这里刻意按**纸张**来画（A4 宽高 + 页边距），而不是在弹窗里铺满一行字：
 * 教案最终是要打印的，行宽与页边距直接决定「一页能放多少内容」，
 * 铺满弹窗的预览看起来总是比实际更宽松。
 */
import { AppIcon, AppModal, RichTextViewer } from '@aiteach/shared'

withDefaults(
  defineProps<{
    title: string
    content: string
    /** 副标题（学科年级 / 模板来源），印在纸面上方 */
    subtitle?: string
    /** 传了才在底部出现一个主按钮（如「套用这份模板」）；文案即按钮文字 */
    useLabel?: string
  }>(),
  { subtitle: '', useLabel: '' },
)

const emit = defineEmits<{
  close: []
  use: []
}>()
</script>

<template>
  <AppModal :title="`预览 · ${title}`" :width="900" @close="emit('close')">
    <!-- 学科年级放在纸外面：纸面上的标题一律来自内容本身（模板的 h1 / AI 稿的 h1），
         两处各画一次就会在纸上出现两行标题 -->
    <p v-if="subtitle" class="tp-caption">{{ subtitle }}</p>

    <div class="tp-stage">
      <article class="tp-paper">
        <RichTextViewer :content="content" empty="这份内容还是空的。" />
      </article>
    </div>

    <template #footer>
      <button class="btn btn-ghost btn-sm" type="button" @click="emit('close')">关闭</button>
      <button v-if="useLabel" class="btn btn-primary btn-sm" type="button" @click="emit('use')">
        <AppIcon name="check" :size="14" /> {{ useLabel }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.tp-caption {
  font-size: 11.5px;
  color: var(--sub);
  margin-bottom: 8px;
}

/* 舞台：浅灰底 + 上下留白，让纸是「一张纸」而不是弹窗的一部分 */
.tp-stage {
  margin: 0 -8px -6px;
  padding: 14px 0;
  background: #eef1f6;
  border-radius: 10px;
  max-height: min(64vh, 720px);
  overflow-y: auto;
}

.tp-paper {
  width: 210mm;
  max-width: 100%;
  min-height: 297mm;
  margin: 0 auto;
  padding: 22mm 20mm;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 2px;
  box-shadow: 0 6px 24px rgba(28, 36, 52, 0.12);
  font-size: 12pt;
  line-height: 1.75;
  color: var(--ink);
}

/* 正文各级标题按 Word 的比例收一收：弹窗里 12pt 正文，标题不必像画布上那么夸张。
   注意 RichTextViewer 的根类是 `.rich-text`（不是编辑器里的 `.rte-content`）——
   两处写混了样式就会静默失效（标题既不居中也不放大）。 */
.tp-paper :deep(.rich-text h1) { font-size: 17pt; text-align: center; margin: 0 0 16px; }
.tp-paper :deep(.rich-text h2) { font-size: 13.5pt; margin: 15px 0 7px; }
.tp-paper :deep(.rich-text h3) { font-size: 12.5pt; margin: 12px 0 6px; }
.tp-paper :deep(.rich-text h4) { font-size: 12pt; margin: 10px 0 5px; }
.tp-paper :deep(.rich-text p) { margin: 0 0 6px; }
.tp-paper :deep(.rich-text img) { max-width: 100%; height: auto; }
</style>
