<script setup lang="ts">
/**
 * 教辅页签：浏览教辅的章 / 课时 / 知识点结构，并把知识点交回试题页签。
 *
 * 为什么不给「加入组卷车」：`PaperSection.questions` 只装 `{ questionId, score }`，
 * 教辅助下面的例题（`MaterialExample`）是**教辅自己的例题**，id 空间与题库题目不共享，
 * 硬塞进去会在保存时解析不到题干、静默丢题。教辅对组卷的真实用法是「照这一节的
 * 知识点去题库找题」，所以这里的交接动作是 `findSimilar(knowledge)` → 切到试题页签。
 */
import { computed, ref } from 'vue'
import { AppIcon, MATERIAL_STATUS_TEXT, showToast } from '@aiteach/shared'
import type { OrgMaterial } from '@aiteach/shared'
import { useComposeData } from '@/composables/useComposeData'
import ComposeFilterBar from '@/components/compose/ComposeFilterBar.vue'
import { matchesMaterialFilter, type ComposeFilter } from '../types'

const props = defineProps<{ filter: ComposeFilter }>()
const emit = defineEmits<{
  patch: [patch: Partial<ComposeFilter>]
  findSimilar: [tags: string[]]
}>()

const { materials, questions, loading, loaded, ensure } = useComposeData()

void ensure()

const rows = computed(() => materials.value.filter((row) => matchesMaterialFilter(row, props.filter)))

/** 展开的教辅 id 集合（默认全收起：一份教辅几十个课时，全展开要滚很久） */
const openIds = ref<Set<number>>(new Set())
function toggleOpen(id: number) {
  const next = new Set(openIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  openIds.value = next
}

/* 搜索时自动展开命中的教辅，否则用户看到卡片却看不到命中的课时 */
const keywordActive = computed(() => props.filter.keyword.trim().length > 0)
const isOpen = (id: number) => keywordActive.value || openIds.value.has(id)

/** 当前筛选下，题库中命中该知识点集合的题目数量（教辅课时上回显「可出 N 题」） */
const questionCountCache = new Map<string, number>()
function matchCount(knowledge: string[]): number {
  if (!knowledge.length) return 0
  const key = knowledge.join('|')
  const cached = questionCountCache.get(key)
  if (cached !== undefined) return cached
  const count = questions.value.filter(
    (row) => row.status === 'approved' && row.knowledge.some((tag) => knowledge.includes(tag)),
  ).length
  questionCountCache.set(key, count)
  return count
}

/** 按课时找题：知识点并集交给试题页签，并明确告知命中数（0 也要说，避免用户以为点了没反应） */
function findFor(title: string, knowledge: string[]) {
  const count = matchCount(knowledge)
  if (count === 0) {
    showToast(`「${title}」的知识点在题库中暂无可出的题`, 'error')
    return
  }
  showToast(`已按「${title}」筛选出 ${count} 道题`)
  emit('findSimilar', knowledge)
}

function itemCount(material: OrgMaterial): number {
  return material.chapters.reduce((sum, chapter) => sum + chapter.examples.length, 0)
}
</script>

<template>
  <div class="mt">
    <ComposeFilterBar
      :filter="filter"
      :fields="['grade', 'subject']"
      :result-count="rows.length"
      @patch="emit('patch', $event)"
      @reset="emit('patch', { grade: '', subject: '' })"
    />

    <p v-if="loading && !loaded" class="empty-row">正在加载教辅…</p>
    <p v-else-if="rows.length === 0" class="empty-row">没有匹配的教辅</p>
    <div v-else class="mt-list">
      <article v-for="row in rows" :key="row.id" class="m-card">
        <header class="mc-head" @click="toggleOpen(row.id)">
          <AppIcon class="mc-caret" :class="{ open: isOpen(row.id) }" name="chevron-right" :size="13" />
          <h4 class="mc-name">{{ row.name }}</h4>
          <span class="tag" :class="row.status === 'done' ? 'tag-green' : row.status === 'failed' ? 'tag-red' : 'tag-blue'">
            {{ MATERIAL_STATUS_TEXT[row.status] }}
          </span>
          <span class="mc-meta">
            {{ row.subject }} · {{ row.chapters.length }} 课时 · {{ itemCount(row) }} 道例题 · {{ row.sizeMb.toFixed(1) }} MB
          </span>
        </header>

        <div v-if="isOpen(row.id)" class="mc-body">
          <p class="mc-note">
            教辅例题与题库题目 id 不共享，无法直接入卷；按课时知识点去题库找题才是这条资源的用法。
          </p>
          <div v-for="chapter in row.chapters" :key="chapter.id" class="mc-chapter">
            <div class="mc-chapter-head">
              <span class="mc-chapter-title">{{ chapter.title }}</span>
              <span class="mc-kp">{{ chapter.knowledge.join('、') || '未标注知识点' }}</span>
              <span class="mc-count" :class="{ zero: matchCount(chapter.knowledge) === 0 }">
                可出 {{ matchCount(chapter.knowledge) }} 题
              </span>
              <button
                class="mini-btn success"
                type="button"
                :disabled="chapter.knowledge.length === 0"
                :title="chapter.knowledge.length ? '按该课时知识点去试题页签找题' : '该课时未标注知识点'"
                @click="findFor(chapter.title, chapter.knowledge)"
              >
                按课时找题
              </button>
            </div>
            <div v-if="chapter.examples.length" class="mc-examples">
              <span v-for="example in chapter.examples" :key="example.id" class="mc-example" :title="example.stem">
                {{ example.stem }}
              </span>
            </div>
          </div>
        </div>
      </article>
    </div>
  </div>
</template>

<style scoped>
.mt-list { display: flex; flex-direction: column; gap: 12px; padding: 16px 18px; }

.m-card { border: 1px solid var(--border); border-radius: 12px; background: #fff; overflow: hidden; }
.mc-head {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 12px 15px;
  cursor: pointer;
  user-select: none;
}
.mc-head:hover { background: #fafcfe; }
.mc-caret { color: var(--sub); transition: transform 0.18s; flex-shrink: 0; }
.mc-caret.open { transform: rotate(90deg); }
.mc-name { font-size: 14px; font-weight: 600; color: var(--ink); }
.mc-meta { font-size: 11.5px; color: var(--sub); margin-left: auto; }

.mc-body { border-top: 1px solid var(--border); padding: 12px 15px; display: flex; flex-direction: column; gap: 9px; }
.mc-note {
  font-size: 11.5px;
  color: var(--warn);
  background: var(--warn-soft);
  border-radius: 8px;
  padding: 6px 10px;
}
.mc-chapter { border: 1px solid var(--border); border-radius: 10px; padding: 9px 11px; }
.mc-chapter-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.mc-chapter-title { font-size: 13px; font-weight: 600; color: var(--ink); }
.mc-kp { font-size: 11.5px; color: var(--brand-deep); background: var(--brand-soft); border-radius: 6px; padding: 2px 7px; }
.mc-count { font-size: 11.5px; color: var(--success); font-weight: 600; }
.mc-count.zero { color: var(--sub); font-weight: 400; }
.mc-chapter-head .mini-btn { margin-left: auto; }
.mc-examples { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.mc-example {
  font-size: 11.5px;
  color: var(--sub);
  background: #f5f7fb;
  border-radius: 6px;
  padding: 3px 8px;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
