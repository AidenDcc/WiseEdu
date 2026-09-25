<script setup lang="ts">
/**
 * 组卷工作台的题目卡片：题干 / 选项高亮 / 标签 / 答案与解析 / 加入组卷车。
 *
 * 为什么这里抽成公共组件，而题库管理与 AI 生成结果各有一份 scoped 副本（见
 * `question/QuestionResultList.vue` 头部注释）：那两处的卡片各自背了对方没有的状态
 * （题库有 status / useCount / 变式，生成结果有质检结论），抽出公共件要挂一堆可选字段；
 * 而这里的三个使用处（试题池、知识点组卷、同步练习组卷）**卡片内容与操作完全一致**，
 * 差异只在「谁筛选出这批题」，所以抽出公共件反而更短。
 */
import { computed, ref } from 'vue'
import { AppIcon, RichTextViewer, QUESTION_STATUS_TEXT, hasImage, toPlainText } from '@aiteach/shared'
import type { OrgQuestion } from '@aiteach/shared'

const props = defineProps<{
  row: OrgQuestion
  /** 已在组卷车中：按钮切换为「移出组卷车」 */
  inBasket: boolean
  /** 教材课时等来源提示（同步练习组卷按课时出题时展示） */
  sectionHint?: string
}>()

const emit = defineEmits<{
  toggle: [row: OrgQuestion]
  /** 按该题的知识点去试题页签找同类题 */
  findSimilar: [tags: string[]]
}>()

const analysisOpen = ref(false)

/** 客观题正确答案字母（用于高亮正确选项；判断题 answer 为 A/B），与题库列表同一算法 */
const answerLetters = computed(() => {
  if (!props.row.options.length) return [] as string[]
  return [...new Set(props.row.answer.toUpperCase().replace(/[^A-F]/g, '').split(''))]
})

/** 难度标签配色，与题库列表一致 */
const difficultyClass = computed(() => {
  const value = props.row.difficulty
  if (value === '困难' || value === '较难') return 'tag-red'
  return value === '中等' ? 'tag-orange' : 'tag-green'
})

/** 图形占位框：题干提到配图、且题内确实没有嵌入图片时才显示 */
const needsFigure = computed(() => {
  if (hasImage(props.row.stem)) return false
  const text = toPlainText(props.row.stem)
  return text.includes('如图') || text.includes('图）')
})

/** 未入库题目不能进试卷（FR-PP-003），按钮禁用并说明原因 */
const blocked = computed(() => props.row.status !== 'approved')
</script>

<template>
  <article class="q-card" :class="{ blocked }">
    <div class="qc-meta">
      <span class="qc-id">#{{ row.id }}</span>
      <span class="tag tag-blue">{{ row.type }}</span>
      <span class="tag" :class="difficultyClass">{{ row.difficulty }}</span>
      <span class="tag tag-gray">{{ row.subject }} · {{ row.grade }}</span>
      <span v-if="blocked" class="tag tag-orange">{{ QUESTION_STATUS_TEXT[row.status] }}（不可入卷）</span>
      <span v-if="sectionHint" class="tag tag-blue">{{ sectionHint }}</span>
      <span class="qc-kp">{{ row.knowledge.join('、') }}</span>
    </div>

    <RichTextViewer class="qc-stem" :content="row.stem" />

    <div v-if="needsFigure" class="qc-figure">
      <AppIcon name="image" :size="26" />
      <span>题目配图（演示占位）</span>
    </div>

    <ul v-if="row.options.length > 0" class="qc-options">
      <li v-for="(opt, i) in row.options" :key="i" :class="{ right: answerLetters.includes('ABCDEF'[i]) }">
        <span class="opt-letter">{{ 'ABCDEF'[i] }}</span>
        <RichTextViewer :content="opt" tag="span" />
      </li>
    </ul>

    <div v-if="analysisOpen" class="qc-answer">
      <p>
        <b>答案：</b>
        <span v-if="row.options.length" class="qc-answer-text">{{ row.answer || '—' }}</span>
        <RichTextViewer v-else :content="row.answer" tag="span" empty="—" />
      </p>
      <p><b>解析：</b><RichTextViewer :content="row.analysis" tag="span" empty="—" /></p>
    </div>

    <div class="qc-ops">
      <button class="mini-btn" type="button" @click="analysisOpen = !analysisOpen">
        {{ analysisOpen ? '收起解析' : '答案与解析' }}
      </button>
      <button
        v-if="row.knowledge.length"
        class="mini-btn"
        type="button"
        title="按该题知识点去试题页签找同类题"
        @click="emit('findSimilar', row.knowledge)"
      >
        找同类题
      </button>
      <button
        class="mini-btn"
        :class="inBasket ? 'danger' : 'success'"
        :disabled="blocked && !inBasket"
        :title="blocked && !inBasket ? '仅「已入库」题目可入卷' : undefined"
        type="button"
        @click="emit('toggle', row)"
      >
        <AppIcon name="cart" :size="13" />
        {{ inBasket ? '移出组卷车' : '加入组卷车' }}
      </button>
    </div>
  </article>
</template>

<style scoped>
.q-card {
  border: 1px solid var(--border);
  border-radius: 12px;
  background: #fff;
  padding: 12px 16px;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.q-card:hover { border-color: #d6e0ee; box-shadow: var(--shadow); }
.q-card.blocked { background: #fbfcfe; }

.qc-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.qc-id { font-size: 12.5px; font-weight: 700; color: var(--sub); }
.qc-kp { font-size: 12px; color: var(--sub); }
.qc-stem { font-size: 13.5px; color: var(--ink); line-height: 1.8; }

.qc-figure {
  margin-top: 10px;
  height: 96px;
  border: 1px dashed var(--border);
  border-radius: 10px;
  background: repeating-conic-gradient(#f4f7f7 0% 25%, #fff 0% 50%) 50% / 16px 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--sub);
  font-size: 12.5px;
}

.qc-options { margin-top: 10px; display: flex; flex-direction: column; gap: 6px; }
.qc-options li {
  display: flex;
  align-items: baseline;
  gap: 8px;
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 7px 11px;
  font-size: 13px;
  color: var(--ink-2);
}
.qc-options li.right { border-color: var(--success); background: var(--success-soft); }
.opt-letter { font-weight: 700; color: var(--sub); }
.qc-options li.right .opt-letter { color: var(--success); }

.qc-answer {
  margin-top: 10px;
  border-left: 3px solid var(--brand);
  background: #f7fafa;
  border-radius: 0 10px 10px 0;
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: var(--ink-2);
  line-height: 1.7;
}
.qc-answer b { color: var(--ink); }
.qc-answer-text { color: var(--success); font-weight: 600; }

.qc-ops {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 10px;
  border-top: 1px dashed var(--border);
  padding-top: 9px;
}
.qc-ops .mini-btn { display: inline-flex; align-items: center; gap: 4px; }
</style>
