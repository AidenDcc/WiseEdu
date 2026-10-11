<script setup lang="ts">
/**
 * 教材目录抽屉（右侧滑出）：录入与查看目录树。
 *
 * 目录（章节等）只在此时单独维护，不再内联进「新增 / 编辑版本」表单；
 * 树组件（TextbookCatalogTree）的 UI / 功能 / 交互与知识点树保持一致。
 */
import { ref, watch } from 'vue'
import { AppDrawer, AppIcon, showToast, ApiError } from '@aiteach/shared'
import type { TextbookCatalogNode, TextbookVersion } from '@aiteach/shared'
import { saveTextbook } from '@/api/platform'
import TextbookCatalogTree from './TextbookCatalogTree.vue'

const props = defineProps<{
  textbook: TextbookVersion | null
}>()

const emit = defineEmits<{ close: [] }>()

const catalog = ref<TextbookCatalogNode[]>([])
const saving = ref(false)

watch(
  () => props.textbook,
  (book) => {
    catalog.value = book?.catalog ? JSON.parse(JSON.stringify(book.catalog)) : []
  },
  { immediate: true },
)

async function save() {
  if (!props.textbook) return
  saving.value = true
  try {
    await saveTextbook({ id: props.textbook.id, catalog: catalog.value })
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
    v-if="textbook"
    title="教材目录"
    :subtitle="`${textbook.subject} · ${textbook.grade ?? ''}${textbook.term ?? ''} · ${textbook.name}`"
    :width="640"
    flex-body
    @close="emit('close')"
  >
    <div class="drawer-head">
      <AppIcon name="book" :size="15" />
      <span>章节 / 小节支持多级嵌套，可拖拽排序、行内增删改与启停用。</span>
    </div>
    <TextbookCatalogTree v-model="catalog" />
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
