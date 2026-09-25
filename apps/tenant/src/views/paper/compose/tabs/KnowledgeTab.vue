<script setup lang="ts">
/**
 * 知识点组卷页签：教材级联 → 知识点多选 → 出题 → 加入组卷车。
 *
 * 与「试题」页签的分工：试题页签是**条件检索**（关键词 + 题型 + 难度），本页签是
 * **按知识结构定位**——教师手里往往没有关键词，只有「这节我要考三角函数」。
 *
 * 选中的知识点写进**同一个** `filter.knowledge`，因此从本页签切到试题页签时条件保留，
 * 反之亦然；页签内的教材级联也直接读写 `filter.grade` / `filter.subject`，全工作台只有
 * 一套年级学科口径，避免「两个下拉框各说各话」。
 */
import { computed, ref, watch } from 'vue'
import { AppIcon, showToast } from '@aiteach/shared'
import { useComposeData } from '@/composables/useComposeData'
import { useComposeBasket } from '@/composables/useComposeBasket'
import { useBaseData } from '@/composables/useBaseData'
import KnowledgePicker from '@/components/compose/KnowledgePicker.vue'
import QuestionPoolCard from '@/components/compose/QuestionPoolCard.vue'
import { matchesQuestionFilter, type ComposeFilter } from '../types'

const props = defineProps<{ filter: ComposeFilter }>()
const emit = defineEmits<{
  patch: [patch: Partial<ComposeFilter>]
  findSimilar: [tags: string[]]
}>()

const { questions, loading, loaded, ensure } = useComposeData()
const { grades, optionsForGrade, versionsFor, ensure: ensureBase } = useBaseData()
const basket = useComposeBasket()

/** 版本不是全工作台共用的维度（只有教材类页签需要），故留在本页签本地 */
const version = ref('')

const subjectOptions = computed(() => (props.filter.grade ? optionsForGrade(props.filter.grade) : []))
const versionOptions = computed(() => versionsFor(props.filter.grade, props.filter.subject))

/** 年级/学科一变，版本候选整批换掉，原版本多半不存在了，归一到该组合下的首选版本 */
function syncVersion() {
  const options = versionOptions.value
  version.value = options.includes('人教A版') ? '人教A版' : options[0] ?? ''
}

/* 年级/学科的初始预设由 shell 统一在启动时落一次（见 ComposeView）；本页签只负责把版本
   对齐到当前年级学科，不在这里补种 —— 否则用户清空后切走再切回，条件会自己长回来 */
void (async () => {
  await Promise.all([ensure(), ensureBase()])
  syncVersion()
})()

/* 顶部搜索栏改了学科/年级（或本页签的级联被改）时同步版本 */
watch(() => `${props.filter.grade}|${props.filter.subject}`, syncVersion)

const rows = computed(() => questions.value.filter((row) => matchesQuestionFilter(row, props.filter)))

/** 未选知识点时不出题：本页签的语义就是「按知识点定位」，空选列出全库只会让人困惑 */
const picked = computed(() => props.filter.knowledge.length > 0)

function addAll() {
  const addable = rows.value.filter((row) => row.status === 'approved')
  if (addable.length === 0) {
    showToast('当前知识点下没有已入库题目可加入', 'error')
    return
  }
  const added = basket.addMany(addable, 'knowledge')
  if (added === 0) showToast('这些题目均已在组卷车中', 'error')
  else showToast(`已加入 ${added} 题到组卷车`)
}
</script>

<template>
  <div class="kt">
    <!-- 教材级联：年级 / 学科 / 版本 -->
    <div class="kt-cascade">
      <span class="filter-label">教材范围</span>
      <select class="f-select" :value="filter.grade" @change="emit('patch', { grade: ($event.target as HTMLSelectElement).value, subject: '', knowledge: [] })">
        <option value="">选择年级</option>
        <option v-for="grade in grades" :key="grade" :value="grade">{{ grade }}</option>
      </select>
      <select
        class="f-select"
        :value="filter.subject"
        :disabled="!filter.grade"
        @change="emit('patch', { subject: ($event.target as HTMLSelectElement).value, knowledge: [] })"
      >
        <option value="">选择学科</option>
        <option v-for="subject in subjectOptions" :key="subject" :value="subject">{{ subject }}</option>
      </select>
      <select class="f-select" :value="version" :disabled="!filter.subject" @change="version = ($event.target as HTMLSelectElement).value">
        <option value="">选择版本</option>
        <option v-for="item in versionOptions" :key="item" :value="item">{{ item }}</option>
      </select>
    </div>

    <div class="kt-body">
      <!-- 左：知识点树（多选） -->
      <aside class="kt-picker panel">
        <h3 class="section-title">选择知识点</h3>
        <KnowledgePicker
          :model-value="filter.knowledge"
          :subject="filter.subject"
          :grade="filter.grade"
          :version="version"
          :rows="questions"
          max-height="52vh"
          @update:model-value="emit('patch', { knowledge: $event })"
        />
      </aside>

      <!-- 右：命中的题目 -->
      <section class="kt-result">
        <div class="kt-result-bar">
          <span>共 <b>{{ rows.length }}</b> 题</span>
          <button class="btn btn-primary btn-sm" type="button" :disabled="!picked || rows.length === 0" @click="addAll">
            <AppIcon name="cart" :size="14" />
            全部加入组卷车
          </button>
        </div>

        <p v-if="loading && !loaded" class="empty-row">正在加载试题…</p>
        <p v-else-if="!picked" class="empty-row">请先在左侧选择知识点</p>
        <p v-else-if="rows.length === 0" class="empty-row">该知识点下暂未匹配到题目，可换个粒度更粗的知识点试试</p>
        <div v-else class="kt-list">
          <QuestionPoolCard
            v-for="row in rows"
            :key="row.id"
            :row="row"
            :in-basket="basket.has(row.id)"
            @toggle="basket.toggle($event, 'knowledge')"
            @find-similar="emit('findSimilar', $event)"
          />
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.kt-cascade {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
}
.kt-cascade .f-select { width: auto; min-width: 132px; height: 34px; font-size: 12.5px; }
.kt-cascade .f-select:disabled { background: #f6f8fb; }

.kt-body {
  display: grid;
  grid-template-columns: 360px 1fr;
  gap: 14px;
  padding: 14px 18px 20px;
  align-items: start;
}
@media (max-width: 1080px) { .kt-body { grid-template-columns: 1fr; } }

.kt-picker { padding: 14px; }
.kt-picker .section-title { margin-bottom: 10px; }

.kt-result { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.kt-result-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12.5px;
  color: var(--sub);
}
.kt-result-bar b { color: var(--brand-deep); font-size: 14px; }
.kt-result-bar .btn { margin-left: auto; display: inline-flex; align-items: center; gap: 5px; }
.kt-list { display: flex; flex-direction: column; gap: 12px; }
</style>
