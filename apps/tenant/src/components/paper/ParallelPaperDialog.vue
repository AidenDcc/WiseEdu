<script setup lang="ts">
/**
 * 生成平行卷弹窗（FR-PP-015）：以某份卷为母卷，AI 逐题替换同构题（同知识点 / 题型 / 难度），
 * 产出结构一致、难度等值的平行卷，落「我的文件」的指定文件夹（草稿）。
 *
 * 「试卷库」与组卷工作台「试卷」页签都要这个入口（两处按钮文案分别是「平行卷」/「平行组卷」），
 * 按本仓近期的收敛做法抽成一个组件 —— 弹窗里的话术、落库后的提示只有一份。
 *
 * 弹窗本体就是「我的文件」文件夹选择框（FolderPickerDialog），不再套一层：
 * 这一步要用户回答的问题只有一个「存哪儿」，中间隔一层「生成份数」纯属多按一次。
 * 份数固定 1 份（B 卷），所以没有份数字段。
 *
 * 接口与 toast 收在本组件内，父页面只管「传哪份卷 / 关掉」：三处的调用方都没有额外逻辑，
 * 让它们各自再写一遍 `generateParallels` + 成功提示，正是会慢慢漂移的那类重复。
 */
import { ref, watch } from 'vue'
import { showToast } from '@aiteach/shared'
import type { OrgPaper } from '@aiteach/shared'
import { generateParallels } from '@/api/org'
import FolderPickerDialog from '@/components/file/FolderPickerDialog.vue'

const props = defineProps<{
  /** 母卷；为 null 表示弹窗未打开（父页面用它控制显隐，与 FolderPickerDialog 的 v-if 配套） */
  paper: OrgPaper | null
  /** 遮罩层级，透传给 FolderPickerDialog：从试卷预览（130）里打开时要传 140 才压得住 */
  zIndex?: number
}>()
const emit = defineEmits<{ close: [] }>()

const folderId = ref<number | null>(null)
const busy = ref(false)

/** 换母卷时把选中的位置复位：上一份卷选的目录不该被当成这一份的意愿 */
watch(
  () => props.paper,
  () => {
    folderId.value = null
  },
)

/** 确认按钮就是「保存」：这一步的动作是把平行卷存到所选目录，生成与落库是同一件事 */
async function run(id: number, path: string) {
  const paper = props.paper
  if (!paper || busy.value) return
  busy.value = true
  try {
    const list = await generateParallels(paper.id, id)
    const labels = list.map((row) => row.parallelLabel).join('、')
    /* 提示里带上全路径：「我的文件」下同名目录很常见，只说「已存入我的文件」等于没说存哪儿 */
    showToast(`已生成平行卷：${labels}，已存入「${path || '我的文件'}」（草稿）`, 'success')
    emit('close')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '生成失败', 'error')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <FolderPickerDialog
    v-if="paper"
    title="生成平行卷"
    confirm-text="保存"
    :z-index="zIndex ?? 120"
    :model-value="folderId"
    :busy="busy"
    @update:model-value="folderId = $event"
    @confirm="run"
    @close="emit('close')"
  >
    <p style="font-size: 13.5px; color: var(--ink-2); margin-bottom: 12px">
      以《{{ paper.name }}》为母卷，AI 逐题替换同构题（同知识点 / 题型 / 难度），生成 1 份结构一致、难度等值的平行卷。
    </p>
  </FolderPickerDialog>
</template>
