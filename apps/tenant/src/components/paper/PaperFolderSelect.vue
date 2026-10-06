<script setup lang="ts">
/**
 * 试卷存储位置选择：个人创建的试卷都存「我的文件」，建卷前必须先选一个文件夹。
 *
 * 从原生 `<select>` 换成了「触发按钮 + 选择弹窗」：目录是树形的，下拉只能压成一串
 * 「— — 名字」，选之前还看不见目录里已经有什么。真正的选择界面收在 FolderPickerDialog
 * （平行卷弹窗直接用它，不必再套一层），这里只负责「显示已选路径」和「打开它」。
 *
 * `v-model` 的契约（`number | null`，未选 = null）保持不变，所以三个使用方
 * （AI 组卷页 / 协同组卷页 / 组卷车生成试卷）的取值与校验都不用动。
 */
import { computed, onMounted, ref } from 'vue'
import { AppIcon } from '@aiteach/shared'
import type { FileFolder } from '@aiteach/shared'
import { fetchFolders } from '@/api/org'
import { folderPathOf } from '@/utils/folders'
import FolderPickerDialog from '@/components/file/FolderPickerDialog.vue'

const props = withDefaults(
  defineProps<{
    /** 已选目录 id；null = 未选（调用方据此判必选） */
    modelValue: number | null
    /**
     * 选择弹窗的层级，默认 130（高过 AppModal 的 120）。
     * 本组件若嵌在更高的宿主浮层里，调用方要传「宿主层级 + 10」——偏移量只在**直接宿主**那一层算一次，
     * 这里不再叠加，免得两处各加一遍最后谁也算不清。
     */
    zIndex?: number
  }>(),
  { zIndex: 130 },
)

const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

const folders = ref<FileFolder[]>([])
const pickerOpen = ref(false)

/**
 * 已选目录的可读路径，如「全部文件 / 期末备考 / 新建文件夹1」。
 * 目录查不到（陈旧值 / 已被删）时是空串，由模板回退成占位文案。
 */
const path = computed(() => folderPathOf(folders.value, props.modelValue))

/** 只关心 id：路径由本组件自己按最新的 folders 拼，不必用弹窗回传的那份 */
async function onConfirm(value: number) {
  /* 先回读目录再收起弹窗：用户可能刚在里面新建了文件夹，路径要立刻能拼出来 */
  folders.value = await fetchFolders()
  emit('update:modelValue', value)
  pickerOpen.value = false
}

onMounted(async () => {
  folders.value = await fetchFolders()
})
</script>

<template>
  <button class="pf-trigger" :class="{ 'is-empty': !path }" type="button" @click="pickerOpen = true">
    <AppIcon name="folder" :size="14" />
    <span class="pf-trigger-text">{{ path || '请选择存储位置' }}</span>
    <AppIcon name="chevron-down" :size="14" class="pf-trigger-caret" />
  </button>

  <FolderPickerDialog
    v-if="pickerOpen"
    :model-value="modelValue"
    :z-index="zIndex"
    @confirm="onConfirm"
    @close="pickerOpen = false"
  />
</template>

<style scoped>
/* 尺寸与观感对齐 .f-select，免得同一个表单里两个控件不等高 */
.pf-trigger {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  height: 38px;
  border: 1.5px solid var(--border);
  border-radius: 10px;
  background: #f7fafa;
  padding: 0 10px;
  font-size: 13px;
  color: var(--ink-2);
  text-align: left;
  transition: border-color 0.15s, background 0.15s;
}
.pf-trigger:hover { border-color: var(--brand); background: #fff; }
.pf-trigger.is-empty { color: var(--sub); }
.pf-trigger-text { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pf-trigger-caret { color: var(--sub); flex-shrink: 0; }
</style>
