<script setup lang="ts">
/**
 * 试卷页签：浏览试卷库并**整卷引用**进组卷车。
 *
 * 「整卷引用」而非「逐题挑」：这里的产品语义是「拿一份现成的卷当底稿改」——按原大题名
 * 与原分值整段搬进组卷车（`addFromPaper`），大题结构得以保留，教师改的是内容而不是重排结构。
 * 已在车中的题会被跳过，因此重复引用同一份卷不会产生重复题目（可放心多点几次）。
 *
 * 不做「把这份卷的题全选出来逐题勾」：那正是协同组卷编辑器已有的能力，工作台重复一遍没有增量。
 */
import { computed, ref } from 'vue'
import { AppIcon, PAPER_STATUS_TEXT, showToast } from '@aiteach/shared'
import type { OrgPaper } from '@aiteach/shared'
import { useComposeData } from '@/composables/useComposeData'
import { useComposeBasket } from '@/composables/useComposeBasket'
import ComposeFilterBar from '@/components/compose/ComposeFilterBar.vue'
import PaperPreviewModal from '@/components/paper/PaperPreviewModal.vue'
import { matchesPaperFilter, type ComposeFilter } from '../types'

const props = defineProps<{ filter: ComposeFilter }>()
const emit = defineEmits<{ patch: [patch: Partial<ComposeFilter>] }>()

const { papers, questions, loading, loaded, ensure, questionOf } = useComposeData()
const basket = useComposeBasket()

void ensure()

const STATUS_CLASS: Record<string, string> = {
  draft: 'tag-gray',
  aiReview: 'tag-blue',
  pending: 'tag-orange',
  approved: 'tag-green',
  rejected: 'tag-red',
}

const rows = computed(() => papers.value.filter((paper) => matchesPaperFilter(paper, props.filter, questionOf)))

const openPreview = ref<OrgPaper | null>(null)

/** 卷内题量：sections 里各小题求和（试卷列表页同一算法） */
function itemCount(paper: OrgPaper): number {
  return paper.sections.reduce((sum, section) => sum + section.questions.length, 0)
}

function totalScore(paper: OrgPaper): number {
  return paper.sections.reduce(
    (sum, section) => sum + section.questions.reduce((inner, item) => inner + (Number(item.score) || 0), 0),
    0,
  )
}

function usePaper(paper: OrgPaper) {
  const added = basket.addFromPaper(paper)
  const total = itemCount(paper)
  if (added === 0) showToast('该卷题目均已在组卷车中', 'error')
  else showToast(added < total ? `已引用 ${added} 题（另 ${total - added} 题已在车中）` : `已引用《${paper.name}》全部 ${added} 题`)
}
</script>

<template>
  <div class="pt">
    <ComposeFilterBar
      :filter="filter"
      :fields="['grade', 'subject']"
      :result-count="rows.length"
      @patch="emit('patch', $event)"
      @reset="emit('patch', { grade: '', subject: '' })"
    />

    <p v-if="loading && !loaded" class="empty-row">正在加载试卷…</p>
    <p v-else-if="rows.length === 0" class="empty-row">没有匹配的试卷</p>
    <div v-else class="pt-list">
      <article v-for="paper in rows" :key="paper.id" class="p-card">
        <div class="pc-head">
          <h4 class="pc-name">{{ paper.name }}</h4>
          <span class="tag" :class="STATUS_CLASS[paper.status]">{{ PAPER_STATUS_TEXT[paper.status] }}</span>
          <span v-if="paper.parallelOf" class="tag tag-blue">{{ paper.parallelLabel ?? '平行卷' }}</span>
        </div>

        <p class="pc-meta">
          {{ paper.subject }} · {{ paper.grade }} · {{ paper.duration }} 分钟 · {{ itemCount(paper) }} 题 · 共
          {{ totalScore(paper) }} 分
        </p>

        <div class="pc-sections">
          <span v-for="section in paper.sections" :key="section.id" class="pc-section">
            {{ section.title }} <b>{{ section.questions.length }}</b>
          </span>
        </div>

        <p class="pc-foot">{{ paper.owner }} · {{ paper.updatedAt }}</p>

        <div class="pc-ops">
          <button class="mini-btn" type="button" @click="openPreview = paper">预览</button>
          <button class="mini-btn" type="button" :disabled="itemCount(paper) === 0" @click="usePaper(paper)">
            <AppIcon name="cart" :size="13" />
            整卷引用
          </button>
        </div>
      </article>
    </div>

    <!-- 卷面预览直接复用试卷库的预览弹窗（A4/8K 排版与答题卡），不必在工作台重写一套 -->
    <PaperPreviewModal v-if="openPreview" :paper="openPreview" :questions="questions" @close="openPreview = null" />
  </div>
</template>

<style scoped>
.pt-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; padding: 16px 18px; }

.p-card {
  border: 1px solid var(--border);
  border-radius: 12px;
  background: #fff;
  padding: 13px 15px;
  display: flex;
  flex-direction: column;
  gap: 7px;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.p-card:hover { border-color: #d6e0ee; box-shadow: var(--shadow); }

.pc-head { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.pc-name { font-size: 14px; font-weight: 600; color: var(--ink); }
.pc-meta { font-size: 12px; color: var(--sub); }
.pc-sections { display: flex; flex-wrap: wrap; gap: 5px; }
.pc-section {
  font-size: 11.5px;
  color: var(--ink-2);
  background: #f4f7fb;
  border-radius: 6px;
  padding: 2px 8px;
}
.pc-section b { color: var(--brand-deep); }
.pc-foot { font-size: 11.5px; color: var(--sub); }
.pc-ops { display: flex; gap: 6px; margin-top: auto; padding-top: 8px; border-top: 1px dashed var(--border); }
.pc-ops .mini-btn { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 4px; }
</style>
