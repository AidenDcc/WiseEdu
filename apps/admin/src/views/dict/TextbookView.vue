<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { AppFilterPanel, AppIcon, AppPageHeader, hueColor, showToast, ApiError, AppModal, appConfirm } from '@aiteach/shared'
import type { DictItem, FilterRowDef, TextbookVersion } from '@aiteach/shared'
import AppSwitch from '@/components/ui/AppSwitch.vue'
import { deleteTextbook, fetchDict, fetchTextbooks, saveTextbook, toggleTextbook } from '@/api/platform'

const subjects = ref<DictItem[]>([])
const list = ref<TextbookVersion[]>([])
const loading = ref(false)

const FILTERS = reactive<Record<string, string[]>>({ subject: [] })

/* AppFilterPanel 回传整份筛选值（覆盖式回写），逐 key 写回这份 reactive 对象本身。
   不能交给 `v-model`：它会替换掉整个对象，而替换引用不是一次响应式写入 —— 点了 chip
   既不亮选中态也不重新筛选。机构端 CollabView 里有同款说明。 */
function onFiltersChange(next: Record<string, string[]>) {
  FILTERS.subject = next.subject ?? []
}

/* 学科候选项取自接口数据，故用 computed 而不是模块级常量 */
const FILTER_ROWS = computed<FilterRowDef[]>(() => [
  { key: 'subject', label: '学科', options: subjects.value.filter((item) => item.enabled).map((item) => item.name), multiple: false },
])

const filtered = computed(() => {
  const subject = FILTERS.subject[0]
  return subject ? list.value.filter((item) => item.subject === subject) : list.value
})

async function load() {
  loading.value = true
  try {
    ;[subjects.value, list.value] = await Promise.all([fetchDict('subject'), fetchTextbooks()])
  } finally {
    loading.value = false
  }
}

async function onToggle(item: TextbookVersion) {
  try {
    const result = await toggleTextbook(item.id)
    showToast(result.enabled ? '已启用' : '已停用', 'success')
    load()
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : '操作失败', 'error')
  }
}

async function onDelete(item: TextbookVersion) {
  if (!(await appConfirm(`确认删除「${item.subject} · ${item.name}」？`, { type: 'danger' }))) return
  try {
    await deleteTextbook(item.id)
    showToast('已删除', 'success')
    load()
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : '删除失败', 'error')
  }
}

/* ===== 新增 / 编辑 ===== */
const editing = ref<TextbookVersion | 'new' | null>(null)
const form = reactive({ subject: '', name: '', publisher: '' })
const formError = ref('')
const saving = ref(false)

function openCreate() {
  editing.value = 'new'
  form.subject = subjects.value[0]?.name ?? '数学'
  form.name = ''
  form.publisher = ''
  formError.value = ''
}

function openEdit(item: TextbookVersion) {
  editing.value = item
  form.subject = item.subject
  form.name = item.name
  form.publisher = item.publisher
  formError.value = ''
}

async function save() {
  if (!form.name.trim()) {
    formError.value = '版本名称不能为空'
    return
  }
  saving.value = true
  try {
    await saveTextbook({
      id: editing.value instanceof Object ? editing.value.id : undefined,
      subject: form.subject,
      name: form.name.trim(),
      publisher: form.publisher.trim(),
    })
    showToast('已保存', 'success')
    editing.value = null
    load()
  } catch (error) {
    formError.value = error instanceof ApiError ? error.message : '保存失败，请重试'
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div>
    <AppPageHeader desc="版本与学科联动：同一学科下版本名不可重复">
      <template #actions>
        <button class="btn btn-primary btn-sm" @click="openCreate">
          <AppIcon name="plus" :size="15" /> 新增版本
        </button>
      </template>
    </AppPageHeader>

    <div class="panel">
      <AppFilterPanel :rows="FILTER_ROWS" :model-value="FILTERS" @update:model-value="onFiltersChange" />

      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>封面</th>
              <th>学科</th>
              <th>版本名称</th>
              <th>出版社</th>
              <th>机构引用</th>
              <th>状态</th>
              <th style="width: 140px">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading && list.length === 0">
              <td colspan="7" class="empty-row">加载中…</td>
            </tr>
            <tr v-else-if="filtered.length === 0">
              <td colspan="7" class="empty-row">暂无教材版本</td>
            </tr>
            <template v-else>
              <tr v-for="item in filtered" :key="item.id">
                <td>
                  <span class="cover" :style="{ background: hueColor(item.hue) }">{{ item.name.charAt(0) }}</span>
                </td>
                <td>{{ item.subject }}</td>
                <td class="cell-strong">{{ item.name }}</td>
                <td>{{ item.publisher }}</td>
                <td>
                  <span :class="{ 'ref-zero': item.refCount === 0 }">{{ item.refCount }} 个机构</span>
                </td>
                <td><AppSwitch :model-value="item.enabled" @update:model-value="onToggle(item)" /></td>
                <td>
                  <div class="op-group">
                    <button class="mini-btn" type="button" @click="openEdit(item)">编辑</button>
                    <button class="mini-btn danger" type="button" @click="onDelete(item)">删除</button>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <AppModal v-if="editing" :title="editing === 'new' ? '新增教材版本' : '编辑教材版本'" @close="editing = null">
      <div class="f-field">
        <label class="f-label">学科<span class="req">*</span></label>
        <select v-model="form.subject" class="f-select">
          <option v-for="subject in subjects.filter((item) => item.enabled)" :key="subject.id" :value="subject.name">
            {{ subject.name }}
          </option>
        </select>
      </div>
      <div class="f-field">
        <label class="f-label">版本名称<span class="req">*</span></label>
        <input v-model="form.name" class="f-input" placeholder="如：人教版" />
      </div>
      <div class="f-field">
        <label class="f-label">出版社</label>
        <input v-model="form.publisher" class="f-input" placeholder="选填" />
      </div>
      <p v-if="formError" class="form-err">{{ formError }}</p>
      <template #footer>
        <button class="btn btn-ghost btn-sm" @click="editing = null">取消</button>
        <button class="btn btn-primary btn-sm" :disabled="saving" @click="save">
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.panel :deep(.filter-panel) { margin: 14px 14px 12px; }

.cover {
  width: 32px;
  height: 42px;
  border-radius: 6px;
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 3px 8px rgba(28, 36, 52, 0.15);
}
.ref-zero { color: var(--sub); }
.form-err { font-size: 12px; color: var(--danger); margin: 4px 0; }
</style>
