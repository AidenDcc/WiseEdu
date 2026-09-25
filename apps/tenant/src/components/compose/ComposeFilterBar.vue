<script setup lang="ts">
/**
 * 组卷工作台的资源筛选条：试题 / 试卷 / 教辅 / 媒体四个「检索浏览类」页签共用。
 *
 * 筛选条件不落在本组件里，而是**上抛给 shell 统一持有**（`ComposeFilter`）——一次搜索
 * 的条件要能跨页签保留（搜「函数」切到视频页签，条件还在），条件若各页签自己存一份，
 * 切页签就丢。故本组件只读 `filter`，改动一律 `patch` 上抛，绝不就地改 props。
 *
 * **没有知识点**：它已挪进试题页签左栏的常驻知识树（`KnowledgePicker`），在那儿既看得见
 * 又只出现在真正需要它的页签里；本组件曾用一个弹层放它，左栏化之后弹层就是重复入口。
 * 但知识点仍是 `ComposeFilter` 的一员，故改年级 / 学科时照样要清掉它（见 pickGrade）。
 */
import { computed } from 'vue'
import { useBaseData } from '@/composables/useBaseData'
import type { ComposeFilter } from '@/views/paper/compose/types'

/** 可显示的筛选项；缺省由各页签按自身数据维度裁剪 */
export type FilterField = 'grade' | 'subject' | 'difficulty' | 'types'

const props = withDefaults(
  defineProps<{
    filter: ComposeFilter
    fields?: FilterField[]
    /** 题型候选（字典），不传则不渲染题型多选 */
    typeOptions?: string[]
    /** 难度候选（字典） */
    difficultyOptions?: string[]
    /** 结果数 / 命中数，用于右侧回显 */
    resultCount?: number
  }>(),
  { fields: () => ['grade', 'subject', 'difficulty', 'types'] },
)

const emit = defineEmits<{ patch: [patch: Partial<ComposeFilter>]; reset: [] }>()

const { grades, subjects, optionsForGrade, difficulties } = useBaseData()

const show = (field: FilterField) => props.fields.includes(field)

/* 选了年级就把学科收窄到该年级有教材的学科（与顶部栏、录题表单同一规则） */
const subjectOptions = computed(() => (props.filter.grade ? optionsForGrade(props.filter.grade) : subjects.value))

const difficultyOptions = computed(() => props.difficultyOptions ?? difficulties.value)

function toggleType(type: string) {
  const types = props.filter.types.includes(type)
    ? props.filter.types.filter((row) => row !== type)
    : [...props.filter.types, type]
  emit('patch', { types })
}

/**
 * 年级/学科改了，之前基于旧范围选的知识点已无意义 —— 左栏知识树是跟着这两个值取的，
 * 不清掉会留下一批对不上任何节点的 tag（树上显示「已选 3 个」却一个勾都没有）。
 * 清空交回左栏自己的 chip 行去显示，本组件不碰知识点的呈现。
 */
function pickGrade(grade: string) {
  emit('patch', { grade, knowledge: [] })
}

function pickSubject(subject: string) {
  emit('patch', { subject, knowledge: [] })
}

/** 「重置筛选」只按本组件能显示的条件出现（知识点由左栏自清，不在这里揽） */
const hasAny = computed(
  () =>
    Boolean(props.filter.grade || props.filter.subject || props.filter.difficulty) ||
    props.filter.types.length > 0,
)
</script>

<template>
  <div class="filter-bar compose-filter-bar">
    <select v-if="show('grade')" class="f-select" :value="filter.grade" @change="pickGrade(($event.target as HTMLSelectElement).value)">
      <option value="">全部年级</option>
      <option v-for="grade in grades" :key="grade" :value="grade">{{ grade }}</option>
    </select>

    <select v-if="show('subject')" class="f-select" :value="filter.subject" @change="pickSubject(($event.target as HTMLSelectElement).value)">
      <option value="">全部学科</option>
      <option v-for="subject in subjectOptions" :key="subject" :value="subject">{{ subject }}</option>
    </select>

    <select
      v-if="show('difficulty')"
      class="f-select"
      :value="filter.difficulty"
      @change="emit('patch', { difficulty: ($event.target as HTMLSelectElement).value })"
    >
      <option value="">全部难度</option>
      <option v-for="item in difficultyOptions" :key="item" :value="item">{{ item }}</option>
    </select>

    <div v-if="show('types') && typeOptions?.length" class="type-chips">
      <button
        v-for="type in typeOptions"
        :key="type"
        class="type-chip"
        :class="{ on: filter.types.includes(type) }"
        type="button"
        @click="toggleType(type)"
      >
        {{ type }}
      </button>
    </div>

    <button v-if="hasAny" class="filter-reset" type="button" @click="emit('reset')">重置筛选</button>

    <span v-if="resultCount !== undefined" class="filter-count">
      命中 <b>{{ resultCount }}</b> 条
    </span>
  </div>
</template>

<style scoped>
/* 全局 .f-select 是 width:100%（为表单栅格设计），在横向筛选条里必须收回自有宽度 */
.compose-filter-bar .f-select { width: auto; min-width: 116px; height: 34px; font-size: 12.5px; }

.type-chips { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.type-chip {
  border: 1px solid var(--border);
  border-radius: 999px;
  background: #fff;
  color: var(--ink-2);
  font-size: 12.5px;
  padding: 4px 11px;
  transition: all 0.14s;
}
.type-chip:hover { border-color: var(--brand); color: var(--brand-deep); }
.type-chip.on { background: var(--brand-soft); border-color: var(--brand); color: var(--brand-deep); font-weight: 600; }

.filter-reset {
  border: none;
  background: none;
  color: var(--sub);
  font-size: 12.5px;
  text-decoration: underline;
  padding: 0 2px;
}
.filter-reset:hover { color: var(--danger); }
.filter-count { margin-left: auto; font-size: 12.5px; color: var(--sub); }
.filter-count b { color: var(--brand-deep); font-size: 14px; }
</style>
