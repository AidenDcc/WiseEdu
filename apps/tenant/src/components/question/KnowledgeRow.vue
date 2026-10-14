<script setup lang="ts">
/**
 * 知识点行：标签 + 已选标签 + 整行点击打开知识点树。
 *
 * 母题（题目基本信息面板的 `#extra`）与每一道子题共用这一份 —— 子题的「知识点」与母题
 * 是同一件事，抄一遍会立刻漂移（两处提示文案、上限提醒、已选标签的删除方式都不一致）。
 * 弹窗挂在 `v-if` 上：每次打开都从最新已选起算，取消即丢弃草稿态。
 */
import { ref } from 'vue'
import { AppIcon } from '@aiteach/shared'
import { KnowledgePickerModal } from '@aiteach/business-common'
import { MAX_KNOWLEDGE } from '@/utils/question-draft'

withDefaults(
  defineProps<{
    modelValue: string[]
    /** 知识点树按学科 / 年级 / 教材版本加载；子题跟随母题，由父级透传 */
    subject: string
    grade: string
    version?: string
    error?: string
    label?: string
  }>(),
  { version: '', error: '', label: '知识点' },
)

const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()

const open = ref(false)

function onConfirm(tags: string[]) {
  /* 弹窗内部已按 max 拦截，这里 slice 只是兜底（组件不该是唯一一道防线） */
  emit('update:modelValue', tags.slice(0, MAX_KNOWLEDGE))
  open.value = false
}
</script>

<template>
  <div class="kp-row">
    <span class="kp-row-label">{{ label }}<span class="req">*</span></span>
    <button class="kp-row-main" type="button" @click="open = true">
      <template v-if="modelValue.length">
        <span v-for="tag in modelValue" :key="tag" class="kp-row-chip">{{ tag }}</span>
      </template>
      <span v-else class="kp-row-empty">点击选择知识点（最多 {{ MAX_KNOWLEDGE }} 个）</span>
      <AppIcon name="chevron-right" :size="14" class="kp-row-arrow" />
    </button>
  </div>
  <p class="kp-hint">在知识点树上选，最多 {{ MAX_KNOWLEDGE }} 个；点上方已选可再次打开修改</p>
  <p v-if="error" class="kp-err">{{ error }}</p>

  <KnowledgePickerModal
    v-if="open"
    :model-value="modelValue"
    :subject="subject"
    :grade="grade"
    :version="version"
    :max="MAX_KNOWLEDGE"
    @close="open = false"
    @confirm="onConfirm"
  />
</template>

<style scoped>
/* 造型对齐 AppFilterChips 的行：标签左、取值右，只是取值区整体是一个按钮。
   全局的 `.req` 只在 `.f-field .f-label` 里生效，面板内要自己给一次 */
.kp-row { display: flex; align-items: flex-start; gap: 12px; margin-top: 8px; }
.kp-row-label {
  flex-shrink: 0;
  width: 58px; /* 与 AppFilterChips 的 labelWidth 默认值一致，标签列才对得齐 */
  padding-top: 5px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink-2);
}
.kp-row-label .req { color: var(--danger); margin-left: 2px; }
.kp-row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  appearance: none;
  border: 1px solid transparent;
  border-radius: 9px;
  background: #f7fafa;
  padding: 6px 10px;
  text-align: left;
  transition: border-color 0.12s, background 0.12s;
}
.kp-row-main:hover { border-color: var(--brand); background: #fff; }
.kp-row-chip {
  border: 1px solid var(--brand);
  border-radius: 999px;
  background: var(--brand-soft);
  color: var(--brand-deep);
  font-size: 12px;
  font-weight: 600;
  padding: 2px 9px;
}
.kp-row-empty { font-size: 12.5px; color: var(--sub); }
.kp-row-arrow { margin-left: auto; color: var(--sub); flex-shrink: 0; }
.kp-hint { margin: 6px 0 0; font-size: 12px; color: var(--sub); }
.kp-err { margin: 4px 0 0; font-size: 12px; color: var(--danger); }
</style>
