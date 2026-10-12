<script setup lang="ts">
/**
 * 教材目录抽屉（右侧滑出）：录入与查看**某个教材分册**的目录树。
 *
 * 目录在版本 / 分册的表单里都不维护，统一走此抽屉；树组件（TextbookCatalogTree）的
 * UI / 功能 / 交互与知识点树保持一致，并可给章节**关联知识点**（弹窗里选，最多 6 个）。
 *
 * 为什么还要传 `version`：章节关联知识点时得知道「这册是哪个学段、哪个学科」，
 * 才能取到对应的那棵平台知识点树。
 */
import { ref, watch } from 'vue'
import { AppDrawer, AppIcon, showToast, ApiError } from '@aiteach/shared'
import type { TextbookCatalogNode, TextbookVersion, TextbookVolume } from '@aiteach/shared'
import { saveTextbookCatalog } from '@/api/platform'
import TextbookCatalogTree from './TextbookCatalogTree.vue'

const props = defineProps<{
  volume: TextbookVolume | null
  /** 当前分册所属的教材版本（提供学段 / 学科给「关联知识点」用） */
  version?: TextbookVersion | null
}>()

const emit = defineEmits<{ close: [] }>()

const catalog = ref<TextbookCatalogNode[]>([])
const saving = ref(false)

watch(
  () => props.volume,
  (item) => {
    catalog.value = item?.catalog ? JSON.parse(JSON.stringify(item.catalog)) : []
  },
  { immediate: true },
)

async function save() {
  if (!props.volume) return
  saving.value = true
  try {
    await saveTextbookCatalog(props.volume.id, catalog.value)
    showToast('目录已保存', 'success')
    emit('close')
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : '保存失败', 'error')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <AppDrawer
    v-if="volume"
    title="教材目录"
    :subtitle="`${volume.alias} · ${volume.grade}${volume.term}`"
    :width="640"
    flex-body
    @close="emit('close')"
  >
    <div class="drawer-head">
      <AppIcon name="book" :size="15" />
      <span>
        章节 / 小节支持多级嵌套，可拖拽排序、行内增删改与启停用；
        <b>知识树</b>图标可为章节关联知识点（最多 6 个，任意层级），关联结果直接显示在章节名后面。
      </span>
    </div>
    <TextbookCatalogTree
      v-model="catalog"
      :stage="version?.stage"
      :subject="version?.subject"
    />
    <template #footer>
      <button class="btn btn-ghost btn-sm" type="button" @click="emit('close')">取消</button>
      <button class="btn btn-primary btn-sm" type="button" :disabled="saving" @click="save">
        {{ saving ? '保存中…' : '保存目录' }}
      </button>
    </template>
  </AppDrawer>
</template>

<style scoped>
.drawer-head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  flex-shrink: 0;
  font-size: 12.5px;
  color: var(--sub);
  line-height: 1.6;
  background: #f7fafa;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 12px;
  margin-bottom: 14px;
}
</style>
