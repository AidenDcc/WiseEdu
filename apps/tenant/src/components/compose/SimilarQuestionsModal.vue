<script setup lang="ts">
/**
 * 相似题弹窗：按题干相似度 + 知识点重合度找出与目标题相近的题目。
 *
 * 两个真实用途：一是「这道题太偏 / 太难，想换个同类型的」，二是「怀疑题库里有重复题，先看看」。
 * 所以列表里同时给出**相似度百分比**与**知识点**，让教师自己判断是「确实撞题」还是「同知识点换了个问法」——
 * 后者往往正是想要的平行题，不该被当成重复题删掉。
 *
 * 支持「以此题再找相似」：找相似常常要跳两三跳才能找到合适的题，关掉再开太笨。
 */
import { computed, ref } from 'vue'
import type { OrgQuestion } from '@aiteach/shared'
import { AppIcon, RichTextViewer, AppModal } from '@aiteach/shared'
import { useComposeData } from '@/composables/useComposeData'
import { useComposeBasket } from '@/composables/useComposeBasket'
import { useQuestionFavorites } from '@/composables/useQuestionFavorites'
import { similarQuestions } from '@/utils/question-match'

const props = defineProps<{ row: OrgQuestion }>()
const emit = defineEmits<{ close: []; findSimilar: [tags: string[]] }>()

const { questions } = useComposeData()
const basket = useComposeBasket()
const favorites = useQuestionFavorites()

/** 当前作为基准的题：可被列表里的题替换（跳着找相似） */
const target = ref<OrgQuestion>(props.row)

const hits = computed(() => similarQuestions(target.value, questions.value, 8))

function percent(score: number): string {
  return `${Math.round(score * 100)}%`
}

/** 高风险撞题（≥90%）用红标，提醒优先处理 */
function danger(score: number): boolean {
  return score >= 0.9
}
</script>

<template>
  <AppModal :title="`相似题 · #${target.id}`" :width="760" @close="emit('close')">
    <p class="sm-sub">
      以 <b>#{{ target.id }}</b>（{{ target.type }} · {{ target.difficulty }} ·
      {{ target.knowledge.join('、') || '未标知识点' }}）为基准，按题干相似度与知识点重合度排序，共
      {{ hits.length }} 道
    </p>

    <p v-if="!hits.length" class="empty-row">题库里没有与题干或知识点相近的题目</p>

    <div v-else class="sm-list">
      <article v-for="hit in hits" :key="hit.row.id" class="sm-item">
        <div class="sm-head">
          <span class="tag" :class="danger(hit.score) ? 'tag-red' : 'tag-blue'">{{ percent(hit.score) }} 相似</span>
          <span class="tag tag-gray">{{ hit.row.type }} · {{ hit.row.difficulty }}</span>
          <span class="sm-kp">{{ hit.row.knowledge.join('、') }}</span>
        </div>

        <RichTextViewer class="sm-stem" :content="hit.row.stem" />

        <div class="sm-ops">
          <button class="mini-btn" type="button" title="以这道题为基准再找一次相似题" @click="target = hit.row">
            <AppIcon name="search" :size="12" />
            以此题再找
          </button>
          <button class="mini-btn" type="button" @click="emit('findSimilar', hit.row.knowledge)">
            按知识点筛选
          </button>
          <button
            class="mini-btn fav"
            :class="{ on: favorites.has(hit.row.id) }"
            type="button"
            @click="favorites.toggle(hit.row.id)"
          >
            <AppIcon name="star" :size="12" />
            {{ favorites.has(hit.row.id) ? '已收藏' : '收藏' }}
          </button>
          <button
            class="mini-btn"
            :class="basket.has(hit.row.id) ? 'danger' : 'success'"
            type="button"
            :disabled="hit.row.status !== 'approved' && !basket.has(hit.row.id)"
            @click="basket.toggle(hit.row, 'pool')"
          >
            <AppIcon name="cart" :size="12" />
            {{ basket.has(hit.row.id) ? '移出组卷车' : '加入组卷车' }}
          </button>
        </div>
      </article>
    </div>
  </AppModal>
</template>

<style scoped>
.sm-sub { font-size: 12.5px; color: var(--sub); margin-bottom: 12px; line-height: 1.7; }
.sm-sub b { color: var(--ink); }

.sm-list { display: flex; flex-direction: column; gap: 12px; max-height: 58vh; overflow-y: auto; padding-right: 4px; }
.sm-item { border: 1px solid var(--border); border-radius: 12px; padding: 10px 14px; }
.sm-head { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; margin-bottom: 7px; }
.sm-kp { font-size: 11.5px; color: var(--sub); }
.sm-stem { font-size: 13.5px; color: var(--ink); line-height: 1.8; }
.sm-ops { display: flex; align-items: center; justify-content: flex-end; gap: 6px; margin-top: 9px; padding-top: 8px; border-top: 1px dashed var(--border); }
.sm-ops .mini-btn { display: inline-flex; align-items: center; gap: 4px; }
.sm-ops .mini-btn.fav.on { color: #b7791f; border-color: #e8c07a; background: #fdf6e6; }
</style>
