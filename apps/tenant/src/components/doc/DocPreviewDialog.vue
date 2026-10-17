/**
 * 整篇预览（三个工作台共用的那一个弹窗）。
 *
 * ## 为什么要合并成一个入口
 *
 * 学案 / 讲义原先有两个「预览」：顶栏的「预览」看的是**编辑器里的正文**（排版、纸面、
 * 页面设置），顶栏的「版式预览」看的是**发下去的那一份**（按段落 + 题库现场排，可隐答案）。
 * 两个按钮并排放着，名字都叫「预览」，老师每次都要先点一下才知道 различия —— 而那些差别
 * 恰恰是「同一份稿子的两个视角」，本来就该在同一个窗口里切。
 *
 * 于是本组件只有一件固定的事：给一张**真实的 A4 纸**（宽 210mm、按页面设置填页边距与正文基线），
 * 上面放哪个视角由页签决定：
 *
 * - `paper`：纸面正文。直接吃编辑器里的 HTML，与打印正文完全一致；
 * - `layout`：版式。由调用方通过 `#layout` 插槽给 —— 教案是那张正式教案纸（环节表格），
 *   学案 / 讲义是带题的稿子（答案只存在题库里，正文里根本没有，所以只能在这里排）。
 *
 * ## 打印与预览同源
 *
 * 打印取的就是**这张纸上现在显示的东西**（`sheetRef.innerHTML`），不是另算一份 HTML。
 * 这是本组件最要紧的一条：预览与打印一旦各算一份，屏幕上 3 页、打出来 4 页这类问题
 * 就永远修不完。版式样式因此不能写在 scoped 里，见 doc-layout.ts 的说明。
 */
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { AppIcon, AppModal, RichTextViewer, showToast, toPlainText } from '@aiteach/shared'
import type { TeachDocPage } from '@aiteach/shared'

import { DOC_LAYOUT_CSS, ensureLayoutCss } from './doc-layout'
import { printHtmlDoc } from './doc-print'
import { useDocPage } from './useDocPage'

const props = withDefaults(
  defineProps<{
    title: string
    /** 副标题：学科 · 年级 · 教材（印在纸外面，纸上的标题一律来自内容本身） */
    subtitle?: string
    /** 纸面正文（编辑器当前内容） */
    content?: string
    /** 页面设置：纸张 / 页边距 / 正文基线，决定这张纸怎么排 */
    page?: TeachDocPage
    /**
     * 页签。不传就只有一个视角（纸面），此时不显示页签栏 ——
     * 模板预览、AI 草稿预览走的就是这种最简形态。
     */
    tabs?: Array<{ key: string; label: string; hint?: string }>
    /** 打开时停在哪个页签（正文为空时「打印」会直接开在版式上） */
    initialTab?: string
  }>(),
  { subtitle: '', content: '', tabs: () => [], initialTab: '' },
)

const emit = defineEmits<{ close: [] }>()

const { printCss, marginMm, paper } = useDocPage(() => props.page)

/** 默认停在第一个页签（调用方把最常看的那个放第一位） */
const tab = ref(props.initialTab || props.tabs[0]?.key || 'paper')
const sheetRef = ref<HTMLElement | null>(null)

const tabList = computed(() => (props.tabs.length ? props.tabs : [{ key: 'paper', label: '纸面排版', hint: '' }]))
const activeHint = computed(() => tabList.value.find((row) => row.key === tab.value)?.hint ?? '')

/** 纸张：宽度与最小高度按实际纸型，页边距与正文基线跟页面设置走（与画布同一个来源） */
const sheetStyle = computed(() => ({
  width: `${paper.value.width}mm`,
  minHeight: `${paper.value.height}mm`,
  padding: `${marginMm.value}mm`,
}))

onMounted(ensureLayoutCss)

/**
 * 打印当前页签。
 *
 * 纸面这一版直接从 `props.content` 拼（而不是抄 DOM）：DOM 里带 KaTeX 渲染结果与
 * scoped 的 `data-v` 属性，抄进去既没用又可能把公式拆成两半；打印用的正文样式在
 * `printCss()` 里另有一份（`.rte-content` 那一套），两份本来就是对同一段 HTML 的两种呈现。
 */
function onPrint() {
  const css = printCss() + DOC_LAYOUT_CSS
  if (tab.value === 'paper') {
    if (!toPlainText(props.content)) {
      showToast('正文还是空的，没有可打印的内容', 'error')
      return
    }
    printHtmlDoc({ title: props.title, css, body: `<article class="rte-content">${props.content}</article>` })
    return
  }
  const html = sheetRef.value?.innerHTML ?? ''
  if (!toPlainText(html)) {
    showToast('这一版还没有内容，没有可打印的东西', 'error')
    return
  }
  printHtmlDoc({ title: props.title, css, body: html })
}
</script>

<template>
  <AppModal :title="`预览 · ${title}`" :width="980" @close="emit('close')">
    <div class="pv-top">
      <div v-if="tabs.length > 1" class="pv-tabs">
        <button
          v-for="row in tabList"
          :key="row.key"
          class="pv-tab"
          :class="{ on: tab === row.key }"
          type="button"
          @click="tab = row.key"
        >
          {{ row.label }}
        </button>
      </div>
      <p v-if="activeHint" class="pv-hint">{{ activeHint }}</p>
      <!-- 视角内的控制条（学案的「学生版 / 教师版」）只属于版式那一页：纸面页签看的是正文本身，
           在这里切「教师版」没有意义，摆着只会让人以为纸面也跟着变了 -->
      <div v-if="tab !== tabList[0]?.key" class="pv-tools"><slot name="toolbar" /></div>
    </div>

    <div class="pv-stage">
      <div ref="sheetRef" class="pv-paper" :style="sheetStyle">
        <template v-if="tab === 'paper'">
          <RichTextViewer :content="content" empty="正文还是空的。可以先用「引用模板」套一份骨架，或切到结构化编辑逐段写。" />
        </template>
        <slot v-else name="layout" />
      </div>
    </div>

    <template #footer>
      <span class="pv-foot-note">打印按当前页签出纸（纸型与页边距同「全局设置 → 页面设置」）</span>
      <button class="btn btn-ghost" type="button" @click="emit('close')">关闭</button>
      <button class="btn btn-primary" type="button" @click="onPrint">
        <AppIcon name="print" :size="14" /> 打印这一版
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.pv-top {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.pv-tabs {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px;
  border-radius: 10px;
  background: #eef1f7;
}
.pv-tab {
  border: none;
  border-radius: 8px;
  background: transparent;
  padding: 5px 14px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-2);
}
.pv-tab:hover { color: var(--brand-deep); }
.pv-tab.on { background: #fff; color: var(--brand-deep); box-shadow: 0 1px 3px rgba(28, 36, 52, 0.12); }

.pv-hint { font-size: 11.5px; color: var(--sub); line-height: 1.6; margin: 0; flex: 1; min-width: 0; }
.pv-tools { margin-left: auto; display: flex; align-items: center; gap: 8px; }

/* 舞台：浅灰底 + 上下留白，让纸是「一张纸」而不是弹窗的一部分 */
.pv-stage {
  margin: 0 -8px;
  padding: 14px 0;
  background: #eef1f6;
  border-radius: 10px;
  max-height: min(66vh, 760px);
  overflow: auto;
}

.pv-paper {
  margin: 0 auto;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 2px;
  box-shadow: 0 6px 24px rgba(28, 36, 52, 0.12);
  /* 正文基线由页面设置给（字体 / 字号 / 行距都从纸张继承下去），这里只兜一个缺省值 */
  font-size: 12pt;
  line-height: 1.75;
  color: var(--ink);
}

/* 弹窗里的正文标题按 Word 的比例收一收。注意 RichTextViewer 的根类是 `.rich-text`
   （不是编辑器里的 `.rte-content`）—— 两处写混，样式会静默失效。 */
.pv-paper :deep(.rich-text h1) { font-size: 17pt; text-align: center; margin: 0 0 16px; }
.pv-paper :deep(.rich-text h2) { font-size: 13.5pt; margin: 15px 0 7px; }
.pv-paper :deep(.rich-text h3) { font-size: 12.5pt; margin: 12px 0 6px; }
.pv-paper :deep(.rich-text h4) { font-size: 12pt; margin: 10px 0 5px; }
.pv-paper :deep(.rich-text p) { margin: 0 0 6px; }
.pv-paper :deep(.rich-text img) { max-width: 100%; height: auto; }

.pv-foot-note { font-size: 11.5px; color: var(--sub); margin-right: auto; }
</style>
