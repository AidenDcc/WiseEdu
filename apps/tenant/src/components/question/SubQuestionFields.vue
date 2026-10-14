<script setup lang="ts">
/**
 * 材料组合题的**子题**编辑区（右侧「子题信息录入」）。
 *
 * 子题 = 一道结构完整的小题，但学段 / 教材版本 / 学期 / 考试类型 / 来源都继承母题，
 * 所以这里只有四件事要填：**题型 / 难度 / 知识点 / 正文**（正文整块交给 QuestionBodyFields，
 * 与母题同一份实现）。
 *
 * 两条产品约定落在这里：
 * - 题型只列「独立单题」类别的题型（材料组合题里再套材料组合题，卷面上没有意义）——
 *   候选项由父级按类别算好传进来；
 * - **难度与知识点默认继承母题**（新增子题时就带上母题的取值），但都可以改。
 */
import { watch } from 'vue'
import { AppFilterChips, appConfirm } from '@aiteach/shared'
import KnowledgeRow from './KnowledgeRow.vue'
import QuestionBodyFields from './QuestionBodyFields.vue'
import { hasContent, resetBodyStructure } from '@/utils/question-draft'
import type { SubQuestionDraft } from '@/utils/question-draft'

const props = defineProps<{
  /** 父级的同一个对象，就地修改 */
  draft: SubQuestionDraft
  /** 卷面序号（从 1 起，按在目录里的位置现算） */
  index: number
  subject: string
  grade: string
  version?: string
  /** 子题可选的题型：只含「独立单题」类别 */
  typeOptions: string[]
  difficultyOptions: string[]
  errors?: Record<string, string>
}>()

const emit = defineEmits<{ change: []; remove: [] }>()

/**
 * 换题型确认用的「上一次题型」，用户取消时把值退回去。
 *
 * 补一条 watch 是必须的：载入存量组合题时题型是外面写进来的（不经 pickType），
 * 不补的话「取消」会退回上一个子题的题型。
 * 不加 immediate：初值就是载入时的题型，watch 只管**之后**的变化。
 */
let lastType = props.draft.type
watch(
  () => props.draft.type,
  (type) => {
    lastType = type
  },
)

async function pickType(type: string) {
  if (type === props.draft.type) return
  props.draft.type = type
  /* 题干 / 选项里有内容才提醒会清空 —— 空子题切题型是常态，每次都弹确认很烦 */
  if (hasContent(props.draft.stem) || props.draft.options.some((opt) => hasContent(opt))) {
    if (!(await appConfirm('切换题型将清空本题的选项结构，确认切换？', { type: 'danger' }))) {
      props.draft.type = lastType
      return
    }
  }
  resetBodyStructure(props.draft, type)
  emit('change')
}

/** 学科变了但子题题型仍在候选里就什么都不做；题型被学科收窄掉时落回第一个可选题型 */
watch(
  () => props.typeOptions.join('|'),
  () => {
    const options = props.typeOptions
    if (!options.length || options.includes(props.draft.type)) return
    resetBodyStructure(props.draft, options[0])
  },
)

function onKnowledgeUpdate(tags: string[]) {
  props.draft.knowledge = tags
  emit('change')
}
</script>

<template>
  <div class="sub-form">
    <div class="sf-head">
      <span class="sf-title">子题 {{ index }}</span>
      <button class="mini-btn danger" type="button" @click="emit('remove')">删除子题</button>
    </div>

    <!-- 题型：只列独立单题类别的题型 -->
    <AppFilterChips
      label="题型"
      :options="typeOptions"
      :model-value="[draft.type]"
      :multiple="false"
      @update:model-value="pickType($event[0] ?? draft.type)"
    />
    <!-- 难度：默认继承母题，可改 -->
    <AppFilterChips
      label="难度"
      :options="difficultyOptions"
      :model-value="[draft.difficulty]"
      :multiple="false"
      @update:model-value="draft.difficulty = $event[0] ?? draft.difficulty"
    />
    <KnowledgeRow
      :model-value="draft.knowledge"
      :subject="subject"
      :grade="grade"
      :version="version"
      :error="errors?.knowledge"
      @update:model-value="onKnowledgeUpdate"
    />

    <div class="sf-body">
      <QuestionBodyFields
        :draft="draft"
        :subject="subject"
        :errors="errors"
        compact
        stem-label="子题题干"
        stem-placeholder="请编辑子题题干"
        @change="emit('change')"
      />
    </div>
  </div>
</template>

<style scoped>
.sub-form { display: flex; flex-direction: column; gap: 10px; }
.sf-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.sf-title { font-size: 13.5px; font-weight: 700; color: var(--ink); }
/* 正文与上面的 chip 行之间拉一道分割线，视觉上「上面是属性、下面是内容」 */
.sf-body { border-top: 1px dashed var(--border); padding-top: 12px; margin-top: 2px; }
</style>
