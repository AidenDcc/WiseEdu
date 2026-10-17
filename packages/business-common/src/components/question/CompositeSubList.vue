<script setup lang="ts">
/**
 * 材料组合题的**子题列表**（列表卡片 / 组卷卡片 / 组卷车展开区共用）。
 *
 * 组合题是一个整体：共用题干（母题的 `stem`）+ 若干子题，子题里才是真正的作答结构。
 * 之前列表只画母题的 `stem`，于是组合题在组卷时「只有题干、没有子题」，教师根本无法
 * 判断该不该选它。这里把子题按卷面顺序（数组顺序 = （1）（2）（3））铺开。
 *
 * 三档详略由调用方按场景取：
 * - 默认：只有「（n） 题型 题干」——列表卡片的信息密度刚好；
 * - `options`：再铺开每道子题的选项（选题时要看选项才知道难度）；
 * - `answers`：再铺开每道子题的答案与解析（展开「解析」时用；母题自己没有答案，答案都在子题里）。
 *
 * **只读**：子题在此没有任何可点/可加入的动作 —— 入卷的单位恒为整道组合题，
 * 单独加某一道子题在数据上没有意义（组卷车条目存的是母题 id）。
 */
import { RichTextViewer } from '@aiteach/shared'
import type { OrgSubQuestion } from '@aiteach/shared'
import QuestionOptions from './QuestionOptions.vue'
import { optionColumnsOf, subAnswerIsPlain, subAnswerText, subStemText } from '../../utils/question-card'

withDefaults(
  defineProps<{
    subs: OrgSubQuestion[]
    /** 铺开每道子题的选项 */
    options?: boolean
    /** 铺开每道子题的答案与解析 */
    answers?: boolean
    /** 空态文案；不传则不渲染空态（由调用方自己决定怎么说明） */
    emptyText?: string
  }>(),
  { options: false, answers: false, emptyText: '' },
)
</script>

<template>
  <div class="csl">
    <div v-for="(sub, i) in subs" :key="sub.id" class="csl-item">
      <div class="csl-row">
        <span class="csl-no">（{{ i + 1 }}）</span>
        <span class="tag tag-blue">{{ sub.type }}</span>
        <RichTextViewer class="csl-stem" :content="subStemText(sub.stem)" tag="span" />
      </div>

      <!-- 不传 answer：与母题侧同一口径 —— 选题态不在选项里透露正确项 -->
      <QuestionOptions
        v-if="options && sub.options.length"
        class="csl-opts"
        :options="sub.options"
        :columns="optionColumnsOf(sub)"
      />

      <div v-if="answers" class="csl-ans">
        <p>
          <b>答案：</b>
          <span v-if="subAnswerIsPlain(sub)" class="csl-answer">{{ subAnswerText(sub) || '—' }}</span>
          <RichTextViewer v-else :content="sub.answer" tag="span" empty="—" />
        </p>
        <p><b>解析：</b><RichTextViewer :content="sub.analysis" tag="span" empty="—" /></p>
      </div>
    </div>

    <p v-if="!subs.length && emptyText" class="csl-empty">{{ emptyText }}</p>
  </div>
</template>

<style scoped>
.csl { display: flex; flex-direction: column; gap: 6px; }
.csl-item { display: flex; flex-direction: column; gap: 6px; }
.csl-row { display: flex; align-items: flex-start; gap: 6px; font-size: 13px; color: var(--ink-2); line-height: 1.7; }
.csl-no { flex-shrink: 0; font-weight: 700; color: var(--brand-deep); }
/* flex: 1 让子题题干吃掉整行剩余宽度（软换行），不被序号挤成窄柱 */
.csl-stem { flex: 1; min-width: 0; }
.csl-opts { margin-top: 2px; }
/* 逐题答案：与母题卡片里的「答案 / 解析」同一套观感（品牌色左条 + 淡底），
   一眼能看出这段不是题干、而是答案区 */
.csl-ans {
  border-left: 3px solid var(--brand);
  background: var(--brand-soft);
  border-radius: 0 10px 10px 0;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
  color: var(--ink-2);
  line-height: 1.7;
}
.csl-ans b { color: var(--ink); }
.csl-answer { color: var(--success); font-weight: 600; }
.csl-empty { margin: 0; font-size: 12.5px; color: var(--sub); }
</style>
