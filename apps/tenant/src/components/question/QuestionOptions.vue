<script setup lang="ts">
/**
 * 题目选项列表（只读）。
 *
 * 抽出来的直接原因：同一段「字母 + 富文本选项、正确项高亮」的 `<ul>` 在题库卡片、组卷卡片、
 * AI 结果列表、审核页、错题详情、教案 / 讲义 / 课件里各抄了一份，共十余处；本次要加的
 * 「一行 N 个」排布若逐处补 CSS，等于把同一件事写十几遍，且必然漏掉一两处。
 *
 * 三套外观是**既有实现里真实存在的三种**，不是预设的扩展点：
 * - `chip`：描边小块（题库卡片、组卷卡片、AI 结果列表）
 * - `soft`：浅底圆角块（题目审核、录题页的学生视角预览）
 * - `doc`：无装饰的文档行（试卷审核、教案 / 讲义 / 课件、错题详情）
 *
 * 正确项高亮只认 `answer`：不传 answer 的调用方（教案等）本来就不标正确项，无需额外的开关。
 * 判断题仍按 A/B/C 标字母 —— √/× 是卷面习惯，只在试卷打印层（PaperBlock）里换。
 */
import { computed } from 'vue'
import { RichTextViewer } from '@aiteach/shared'
import { answerLetters } from '@/utils/question-card'

const props = withDefaults(
  defineProps<{
    options: string[]
    /** 正确答案（字母串，如 'AC'）；留空则不高亮任何选项 */
    answer?: string
    /** 一行放几个：1（每行一个，缺省）/ 2 / 4 */
    columns?: 1 | 2 | 4
    variant?: 'chip' | 'soft' | 'doc'
  }>(),
  { answer: '', columns: 1, variant: 'chip' },
)

const letters = 'ABCDEF'
const right = computed(() => new Set(answerLetters({ options: props.options, answer: props.answer })))
</script>

<template>
  <ul
    v-if="options.length"
    class="qo"
    :class="[`qo-${variant}`, columns > 1 ? `qo-cols-${columns}` : '']"
  >
    <li v-for="(opt, i) in options" :key="i" :class="{ right: right.has(letters[i]) }">
      <span class="qo-key">{{ letters[i] }}</span>
      <RichTextViewer :content="opt" tag="span" />
    </li>
  </ul>
</template>

<style scoped>
.qo { display: flex; flex-direction: column; }
/* 多列：grid 而非 flex-wrap —— 选项宽度由列数均分，「AB 短、CD 长」时列才不会错位 */
.qo-cols-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.qo-cols-4 { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
.qo li { display: flex; align-items: baseline; gap: 8px; min-width: 0; font-size: 13px; color: var(--ink-2); }
.qo-key { font-weight: 700; color: var(--sub); flex-shrink: 0; }

/* 描边小块 */
.qo-chip { gap: 6px; }
.qo-chip li { border: 1px solid var(--border); border-radius: 9px; padding: 8px 12px; }
.qo-chip li.right { border-color: var(--success); background: var(--success-soft, #ecfaf4); }
.qo-chip li.right .qo-key { color: var(--success); }

/* 浅底圆角块 */
.qo-soft { gap: 8px; }
.qo-soft li { background: #f7fafa; border-radius: 8px; padding: 9px 12px; font-size: 13.5px; }
.qo-soft li.right { border-left: 3px solid var(--success); color: var(--success); font-weight: 600; }

/* 文档行：无底色无描边，靠行距区分；字母后补一个全角句点，与卷面「A．」的写法一致 */
.qo-doc { gap: 3px; }
.qo-doc li { line-height: 1.8; }
.qo-doc .qo-key::after { content: '．'; }
.qo-doc li.right { color: var(--success); font-weight: 600; }
</style>
