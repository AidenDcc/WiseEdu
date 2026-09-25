<script setup lang="ts">
/**
 * 同步练习组卷页签：教材 → 教辅 → 勾课时 → 一键按课时组卷。
 *
 * 产品定义行为是**一课一个大题**：选中的每个课时都带着 `sectionTitle = 课时名` 进组卷车，
 * 生成试卷时同名课时合并成同一个大题（归类规则见 `paper-sections.ts` 的 `findSectionIndex`）。
 * 因此教师得到的是「第一大题 3.1 函数的概念、第二大题 3.2 函数的表示法」这种直接可用的卷面，
 * 而不是一堆混在一起、还要手工重排的题。
 *
 * 课时知识点匹配取的是**教辅章节的 knowledge**（教材口径），与题库题目的 knowledge 是同一套标签，
 * 这是「同步」二字成立的前提；匹配不到就如实说 0 题，不静默给一道无关的题凑数。
 */
import { computed, ref, watch } from 'vue'
import { AppIcon, showToast } from '@aiteach/shared'
import type { OrgMaterial } from '@aiteach/shared'
import { useComposeData } from '@/composables/useComposeData'
import { useComposeBasket } from '@/composables/useComposeBasket'
import { useBaseData } from '@/composables/useBaseData'
import QuestionPoolCard from '@/components/compose/QuestionPoolCard.vue'
import { matchesQuestionFilter, type ComposeFilter } from '../types'

type Chapter = OrgMaterial['chapters'][number]

const props = defineProps<{ filter: ComposeFilter }>()
const emit = defineEmits<{
  patch: [patch: Partial<ComposeFilter>]
  findSimilar: [tags: string[]]
}>()

const { materials, questions, loading, loaded, ensure } = useComposeData()
const { grades, optionsForGrade, versionsFor, defaultTextbook, ensure: ensureBase } = useBaseData()
const basket = useComposeBasket()

const version = ref('')
const materialId = ref<number | null>(null)
const pickedIds = ref<number[]>([])

const subjectOptions = computed(() => (props.filter.grade ? optionsForGrade(props.filter.grade) : []))
const versionOptions = computed(() => versionsFor(props.filter.grade, props.filter.subject))

/** 该学科下已完成识别的教辅：识别中/校对中的教辅章节还没定稿，不能作为组卷依据 */
const candidates = computed(() =>
  materials.value.filter(
    (row) => row.status === 'done' && (!props.filter.subject || row.subject === props.filter.subject),
  ),
)

const material = computed(() => candidates.value.find((row) => row.id === materialId.value) ?? null)
const chapters = computed(() => material.value?.chapters ?? [])

/** 年级/学科/版本一变，原来选的教辅与课时都可能对不上，整体清空 */
function resetSelection() {
  const options = versionOptions.value
  version.value = options.includes('人教A版') ? '人教A版' : options[0] ?? ''
  materialId.value = null
  pickedIds.value = []
}

void (async () => {
  await Promise.all([ensure(), ensureBase()])
  if (!props.filter.grade && !props.filter.subject) {
    const preset = defaultTextbook()
    emit('patch', { grade: preset.grade, subject: preset.subject })
  }
  resetSelection()
  /* 学科定下来后自动选中第一份教辅，省掉一次无意义的下拉操作 */
  if (!materialId.value && candidates.value.length) materialId.value = candidates.value[0].id
})()

watch(() => `${props.filter.grade}|${props.filter.subject}`, resetSelection)

watch(candidates, (list) => {
  if (!materialId.value || !list.some((row) => row.id === materialId.value)) {
    materialId.value = list[0]?.id ?? null
    pickedIds.value = []
  }
})

const pickedChapters = computed(() => chapters.value.filter((chapter) => pickedIds.value.includes(chapter.id)))

function toggleChapter(id: number) {
  pickedIds.value = pickedIds.value.includes(id)
    ? pickedIds.value.filter((row) => row !== id)
    : [...pickedIds.value, id]
}

/** 某课时的候选题：已入库 + 命中当前年级学科 + 知识点与章节有交集 */
function matchOf(chapter: Chapter) {
  if (!chapter.knowledge.length) return []
  return questions.value.filter(
    (row) =>
      row.status === 'approved' &&
      (!props.filter.grade || row.grade === props.filter.grade) &&
      (!props.filter.subject || row.subject === props.filter.subject) &&
      row.knowledge.some((tag) => chapter.knowledge.includes(tag)),
  )
}

/** 单个课时的候选题做缓存：章节数 × 题库规模的求交在模板里会被反复调用（见下） */
const matchCache = new Map<number, ReturnType<typeof matchOf>>()
function matched(chapter: Chapter) {
  const cached = matchCache.get(chapter.id)
  if (cached) return cached
  const rows = matchOf(chapter)
  matchCache.set(chapter.id, rows)
  return rows
}
/* 题库、筛选范围或所选教辅变了，缓存必须作废：缓存键是章节 id，换教辅时若两份教辅的
   章节 id 恰好重复，会把上一份教辅的匹配结果当成这一份的（会静默出错题） */
watch(
  () => `${questions.value.length}|${props.filter.grade}|${props.filter.subject}|${materialId.value}`,
  () => matchCache.clear(),
)

/** 一键按课时组卷：每课时把所有匹配到的题加入，并带上课时名作为大题名 */
function composeByChapter() {
  if (!pickedChapters.value.length) {
    showToast('请先勾选至少一个课时', 'error')
    return
  }
  const short: string[] = []
  let added = 0
  pickedChapters.value.forEach((chapter) => {
    const rows = matched(chapter)
    if (!rows.length) {
      short.push(`${chapter.title} 无匹配题`)
      return
    }
    const count = basket.addMany(rows, 'sync', chapter.title)
    if (count === 0) short.push(`${chapter.title} 已在车中`)
    added += count
  })

  if (added === 0) {
    showToast(short.length ? `未新增题目：${short.join('；')}` : '未新增题目', 'error')
    return
  }
  showToast(
    short.length
      ? `已按 ${pickedChapters.value.length} 个课时加入 ${added} 题（${short.join('；')}）`
      : `已按 ${pickedChapters.value.length} 个课时加入 ${added} 题，生成试卷时每课时为一个大题`,
  )
}

/** 单课时加入：同 composeByChapter 的单章版本 */
function addChapter(chapter: Chapter) {
  const rows = matched(chapter)
  if (!rows.length) {
    showToast(`「${chapter.title}」没有匹配的已入库题目`, 'error')
    return
  }
  const count = basket.addMany(rows, 'sync', chapter.title)
  if (count === 0) showToast('该课时题目均已在组卷车中', 'error')
  else showToast(`已加入 ${count} 题到「${chapter.title}」大题`)
}

/** 预览：该课时匹配到的题（与题库卡片同一呈现） */
const previewChapter = ref<Chapter | null>(null)
</script>

<template>
  <div class="st">
    <div class="st-cascade">
      <span class="filter-label">教材范围</span>
      <select class="f-select" :value="filter.grade" @change="emit('patch', { grade: ($event.target as HTMLSelectElement).value, subject: '' })">
        <option value="">选择年级</option>
        <option v-for="grade in grades" :key="grade" :value="grade">{{ grade }}</option>
      </select>
      <select class="f-select" :value="filter.subject" :disabled="!filter.grade" @change="emit('patch', { subject: ($event.target as HTMLSelectElement).value })">
        <option value="">选择学科</option>
        <option v-for="subject in subjectOptions" :key="subject" :value="subject">{{ subject }}</option>
      </select>
      <select class="f-select" :value="version" :disabled="!filter.subject" @change="version = ($event.target as HTMLSelectElement).value">
        <option value="">选择版本</option>
        <option v-for="item in versionOptions" :key="item" :value="item">{{ item }}</option>
      </select>

      <select v-model="materialId" class="f-select st-material" :disabled="candidates.length === 0">
        <option :value="null">{{ candidates.length ? '选择教辅' : '该学科暂无可用教辅' }}</option>
        <option v-for="row in candidates" :key="row.id" :value="row.id">{{ row.name }}</option>
      </select>

      <button class="btn btn-primary btn-sm st-compose" type="button" :disabled="pickedIds.length === 0" @click="composeByChapter">
        <AppIcon name="list-ol" :size="14" />
        一键组卷（{{ pickedIds.length }} 课时）
      </button>
    </div>

    <p v-if="loading && !loaded" class="empty-row">正在加载教辅与试题…</p>
    <p v-else-if="!material" class="empty-row">请先选择年级、学科与教辅</p>
    <div v-else class="st-body">
      <aside class="st-chapters panel">
        <h3 class="section-title">{{ material.name }}（{{ chapters.length }} 课时）</h3>
        <label v-for="chapter in chapters" :key="chapter.id" class="st-chapter" :class="{ on: pickedIds.includes(chapter.id) }">
          <input type="checkbox" :checked="pickedIds.includes(chapter.id)" @change="toggleChapter(chapter.id)" />
          <span class="st-chapter-title">{{ chapter.title }}</span>
          <span class="st-count" :class="{ zero: matched(chapter).length === 0 }">{{ matched(chapter).length }} 题</span>
          <button
            class="mini-btn"
            type="button"
            :disabled="matched(chapter).length === 0"
            @click.stop.prevent="previewChapter = chapter"
          >
            预览
          </button>
          <button
            class="mini-btn success"
            type="button"
            :disabled="matched(chapter).length === 0"
            @click.stop.prevent="addChapter(chapter)"
          >
            加入
          </button>
          <span class="st-kp">{{ chapter.knowledge.join('、') || '未标注知识点' }}</span>
        </label>
      </aside>

      <section class="st-result">
        <h3 class="section-title">
          {{ previewChapter ? `「${previewChapter.title}」匹配的题目` : '课时预览' }}
        </h3>
        <p v-if="!previewChapter" class="empty-row">在左侧点「预览」查看某课时匹配到的题目</p>
        <p v-else-if="matched(previewChapter).length === 0" class="empty-row">该课时暂未匹配到已入库题目</p>
        <div v-else class="st-list">
          <QuestionPoolCard
            v-for="row in matched(previewChapter)"
            :key="row.id"
            :row="row"
            :in-basket="basket.has(row.id)"
            :section-hint="previewChapter.title"
            @toggle="basket.toggle($event, 'sync')"
            @find-similar="emit('findSimilar', $event)"
          />
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.st-cascade {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
}
.st-cascade .f-select { width: auto; min-width: 132px; height: 34px; font-size: 12.5px; }
.st-cascade .f-select:disabled { background: #f6f8fb; }
.st-material { min-width: 220px !important; }
.st-compose { margin-left: auto; display: inline-flex; align-items: center; gap: 5px; }

.st-body {
  display: grid;
  grid-template-columns: 420px 1fr;
  gap: 14px;
  padding: 14px 18px 20px;
  align-items: start;
}
@media (max-width: 1180px) { .st-body { grid-template-columns: 1fr; } }

.st-chapters { padding: 14px; max-height: 64vh; overflow-y: auto; }
.st-chapters .section-title { margin-bottom: 10px; }
.st-chapter {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 8px 10px;
  margin-bottom: 7px;
  cursor: pointer;
  user-select: none;
  transition: all 0.14s;
}
.st-chapter:hover { border-color: var(--brand); }
.st-chapter.on { border-color: var(--brand); background: var(--brand-soft); }
.st-chapter input { accent-color: var(--brand); }
.st-chapter-title { font-size: 12.5px; font-weight: 600; color: var(--ink); }
.st-count { font-size: 11.5px; color: var(--success); font-weight: 600; }
.st-count.zero { color: var(--sub); font-weight: 400; }
.st-chapter .mini-btn { margin-left: auto; }
.st-kp {
  flex-basis: 100%;
  font-size: 11px;
  color: var(--sub);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.st-result { min-width: 0; }
.st-result .section-title { margin-bottom: 10px; }
.st-list { display: flex; flex-direction: column; gap: 12px; }
</style>
