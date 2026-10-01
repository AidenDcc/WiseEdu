<script setup lang="ts">
/**
 * 知识点树选择弹窗（录题中心用）。
 *
 * 就是 `KnowledgePicker` 的弹窗外壳：树本身（搜索 / 展开 / 勾选 / 已选 chip）完全复用组卷工作台
 * 那套，这里只负责三件事 —— 弹窗容器、**先选后确认**的草稿态、个数上限的兜底。
 *
 * 草稿态由 `v-if` 挂载保证：父级每次打开都重新挂载，`draft` 自然从最新的 `modelValue` 起算，
 * 「取消」只要不 emit 就丢弃，不需要额外的重置逻辑（与 MediaPickerModal / FormulaPickerModal 同款）。
 */
import { computed, ref } from 'vue'
import AppModal from '@/components/ui/AppModal.vue'
import KnowledgePicker from '@/components/compose/KnowledgePicker.vue'

const props = withDefaults(
  defineProps<{
    modelValue: string[]
    /** 树按「年级 / 学科 / 教材版本」加载，取表单当前值 */
    subject: string
    grade?: string
    version?: string
    /** 最多可选个数（默认 5，与题目的知识点上限一致） */
    max?: number
    title?: string
  }>(),
  { grade: '', version: '', max: 5, title: '选择知识点' },
)

const emit = defineEmits<{ close: []; confirm: [tags: string[]] }>()

const draft = ref<string[]>([...props.modelValue])

/** 当前教材：给用户一个「这棵树是按什么筛出来的」的参照 */
const scopeText = computed(() => [props.grade, props.subject, props.version].filter(Boolean).join(' / ') || '未选择教材')
</script>

<template>
  <AppModal :title="title" :width="720" @close="emit('close')">
    <p class="kp-scope">
      <span class="kp-scope-label">当前教材</span>
      {{ scopeText }}
      <span class="kp-scope-tip">最多选 {{ max }} 个，分类节点请展开后选具体知识点</span>
    </p>

    <!-- 树要自己限高：AppModal 的 .modal-body 只负责滚动，不给固定高度 -->
    <KnowledgePicker
      v-model="draft"
      mode="node"
      :max="max"
      :subject="subject"
      :grade="grade"
      :version="version"
      max-height="46vh"
    />

    <template #footer>
      <button class="btn btn-ghost" type="button" @click="emit('close')">取消</button>
      <button class="btn btn-primary" type="button" @click="emit('confirm', draft.slice(0, max))">
        确认（{{ draft.length }}）
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.kp-scope {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 10px;
  font-size: 12.5px;
  color: var(--ink-2);
}
.kp-scope-label {
  font-size: 11px;
  font-weight: 700;
  color: var(--brand-deep);
  background: var(--brand-soft);
  border-radius: 6px;
  padding: 2px 7px;
}
.kp-scope-tip { margin-left: auto; font-size: 12px; color: var(--sub); }
</style>
