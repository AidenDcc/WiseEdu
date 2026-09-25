<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { AppIcon, showToast, ApiError, DICT_TYPES } from '@aiteach/shared'
import type { DictItem, DictTypeKey } from '@aiteach/shared'
import AppModal from '@/components/ui/AppModal.vue'
import AppSwitch from '@/components/ui/AppSwitch.vue'
import { deleteDictItem, fetchDict, moveDictItem, saveDictItem, toggleDictItem } from '@/api/platform'

const activeType = ref<DictTypeKey>('subject')
const typeMeta = computed(() => DICT_TYPES.find((item) => item.key === activeType.value)!)

/** 「名称」在各字典类型下的业务叫法不同（难度 = 等级名称，版权 = 展示文案） */
const NAME_LABELS: Partial<Record<DictTypeKey, string>> = { difficulty: '等级名称', copyright: '展示文案' }
const nameLabel = computed(() => NAME_LABELS[activeType.value] ?? '名称')

const list = ref<DictItem[]>([])
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    list.value = await fetchDict(activeType.value)
  } finally {
    loading.value = false
  }
}

function switchType(type: DictTypeKey) {
  activeType.value = type
  load()
}

async function onToggle(item: DictItem) {
  try {
    const result = await toggleDictItem(activeType.value, item.id)
    showToast(result.enabled ? '已启用，机构端下拉项即时恢复' : '已停用，机构端下拉项即时隐藏', 'success')
    load()
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : '操作失败', 'error')
  }
}

async function onMove(item: DictItem, direction: -1 | 1) {
  await moveDictItem(activeType.value, item.id, direction)
  load()
}

async function onDelete(item: DictItem) {
  if (!window.confirm(`确认删除「${item.name}」？删除前将校验机构引用。`)) return
  try {
    await deleteDictItem(activeType.value, item.id)
    showToast('已删除', 'success')
    load()
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : '删除失败', 'error')
  }
}

function onExport() {
  showToast('已按当前类型导出 Excel（演示）', 'info')
}

function onImport() {
  showToast('批量导入：请下载模板 → 填写 → 上传，错误行将返回报告（演示）', 'info')
}

/* ===== 新增 / 编辑弹窗（编码编辑时置灰） ===== */
const STAGES = ['小学', '初中', '高中']
const ANSWER_TYPES = ['选择', '填空', '解答']

const editing = ref<DictItem | 'new' | null>(null)
const form = reactive({
  name: '',
  code: '',
  stage: '小学',
  year: '',
  termHalf: '上学期',
  dateFrom: '',
  dateTo: '',
  answerType: '选择',
  coefficient: 0.5,
})
const formError = ref('')
const saving = ref(false)

function openCreate() {
  editing.value = 'new'
  form.name = ''
  form.code = ''
  form.stage = '小学'
  form.year = `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`
  form.termHalf = '上学期'
  form.dateFrom = ''
  form.dateTo = ''
  form.answerType = '选择'
  form.coefficient = 0.5
  formError.value = ''
}

function openEdit(item: DictItem) {
  editing.value = item
  form.name = item.name
  form.code = item.code ?? ''
  form.stage = item.stage ?? '小学'
  form.year = item.year ?? ''
  form.termHalf = item.termHalf ?? '上学期'
  form.dateFrom = item.dateFrom ?? ''
  form.dateTo = item.dateTo ?? ''
  form.answerType = item.answerType ?? '选择'
  form.coefficient = item.coefficient ?? 0.5
  formError.value = ''
}

async function save() {
  if (!form.name.trim()) {
    formError.value = '名称不能为空'
    return
  }
  saving.value = true
  try {
    await saveDictItem(activeType.value, {
      id: editing.value instanceof Object ? editing.value.id : undefined,
      name: form.name.trim(),
      code: activeType.value === 'subject' ? form.code.trim() : undefined,
      stage: activeType.value === 'grade' ? form.stage : undefined,
      year: activeType.value === 'term' ? form.year.trim() : undefined,
      termHalf: activeType.value === 'term' ? form.termHalf : undefined,
      dateFrom: activeType.value === 'term' ? form.dateFrom : undefined,
      dateTo: activeType.value === 'term' ? form.dateTo : undefined,
      answerType: activeType.value === 'questionType' ? form.answerType : undefined,
      coefficient: activeType.value === 'difficulty' ? form.coefficient : undefined,
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
  <div class="dict-layout">
    <!-- 左：字典类型 -->
    <aside class="panel type-panel">
      <div class="type-head">字典类型</div>
      <button
        v-for="item in DICT_TYPES"
        :key="item.key"
        class="type-item"
        :class="{ active: activeType === item.key }"
        type="button"
        @click="switchType(item.key)"
      >
        <AppIcon name="book" :size="16" />
        <span class="type-name">{{ item.title }}</span>
      </button>
    </aside>

    <!-- 右：数据维护 -->
    <div class="panel table-panel">
      <div class="filter-bar">
        <span class="filter-label">{{ typeMeta.title }} · {{ typeMeta.hint }}</span>
        <div style="margin-left: auto; display: flex; gap: 8px">
          <button class="btn btn-ghost btn-sm" @click="onImport">
            <AppIcon name="upload" :size="14" /> 批量导入
          </button>
          <button class="btn btn-ghost btn-sm" @click="onExport">
            <AppIcon name="download" :size="14" /> 导出
          </button>
          <button class="btn btn-primary btn-sm" @click="openCreate">
            <AppIcon name="plus" :size="15" /> 新增
          </button>
        </div>
      </div>

      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th v-if="activeType === 'grade'">学段</th>
              <th v-if="activeType === 'term'">学年 / 学期</th>
              <th>{{ nameLabel }}</th>
              <th v-if="activeType === 'subject'">编码</th>
              <th v-if="activeType === 'term'">起止日期</th>
              <th v-if="activeType === 'questionType'">作答类型</th>
              <th v-if="activeType === 'difficulty'">系数</th>
              <th>排序</th>
              <th>机构引用</th>
              <th>状态</th>
              <th style="width: 200px">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading && list.length === 0">
              <td :colspan="12" class="empty-row">加载中…</td>
            </tr>
            <tr v-else-if="list.length === 0">
              <td :colspan="12" class="empty-row">暂无数据</td>
            </tr>
            <template v-else>
              <tr v-for="(item, index) in list" :key="item.id">
                <td v-if="activeType === 'grade'">{{ item.stage }}</td>
                <td v-if="activeType === 'term'">{{ item.year }} · {{ item.termHalf }}</td>
                <td class="cell-strong">{{ item.name }}</td>
                <td v-if="activeType === 'subject'"><code class="code-chip">{{ item.code }}</code></td>
                <td v-if="activeType === 'term'">{{ item.dateFrom }} ~ {{ item.dateTo }}</td>
                <td v-if="activeType === 'questionType'">{{ item.answerType }}</td>
                <td v-if="activeType === 'difficulty'">{{ item.coefficient?.toFixed(1) }}</td>
                <td>
                  <div class="op-group">
                    <button class="mini-btn" :disabled="index === 0" type="button" @click="onMove(item, -1)">上移</button>
                    <button class="mini-btn" :disabled="index === list.length - 1" type="button" @click="onMove(item, 1)">下移</button>
                  </div>
                </td>
                <td>
                  <span :class="{ 'ref-zero': item.refCount === 0 }">{{ item.refCount }} 个机构</span>
                </td>
                <td>
                  <AppSwitch :model-value="item.enabled" @update:model-value="onToggle(item)" />
                </td>
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

    <!-- 新增 / 编辑弹窗 -->
    <AppModal
      v-if="editing"
      :title="editing === 'new' ? `新增${typeMeta.title}` : `编辑${typeMeta.title}`"
      @close="editing = null"
    >
      <div v-if="editing !== 'new' && activeType === 'subject'" class="f-field">
        <label class="f-label">编码（创建后不可修改）</label>
        <input v-model="form.code" class="f-input" disabled />
      </div>
      <div v-if="editing === 'new' && activeType === 'subject'" class="f-field">
        <label class="f-label">编码<span class="req">*</span></label>
        <input v-model="form.code" class="f-input" placeholder="唯一，创建后不可改，如 MATH" />
      </div>
      <div v-if="activeType === 'grade'" class="f-field">
        <label class="f-label">学段<span class="req">*</span></label>
        <select v-model="form.stage" class="f-select">
          <option v-for="stage in STAGES" :key="stage" :value="stage">{{ stage }}</option>
        </select>
      </div>
      <div v-if="activeType === 'term'" class="f-field">
        <label class="f-label">学年<span class="req">*</span></label>
        <input v-model="form.year" class="f-input" placeholder="如 2026-2027" />
      </div>
      <div v-if="activeType === 'term'" class="f-field">
        <label class="f-label">学期<span class="req">*</span></label>
        <select v-model="form.termHalf" class="f-select">
          <option value="上学期">上学期</option>
          <option value="下学期">下学期</option>
        </select>
      </div>
      <div class="f-field">
        <label class="f-label">{{ nameLabel }}<span class="req">*</span></label>
        <input
          v-model="form.name"
          class="f-input"
          :placeholder="activeType === 'copyright' ? '如 © 2024-2026 星辰教育科技有限公司 版权所有' : '同级不可重名'"
        />
        <p v-if="activeType === 'copyright'" class="f-hint">
          一行一条，机构端首页页脚按排序依次展示；停用后该条不再出现。
        </p>
      </div>
      <div v-if="activeType === 'term'" class="f-field">
        <label class="f-label">起止日期<span class="req">*</span></label>
        <div class="date-row">
          <input v-model="form.dateFrom" class="f-input" type="date" />
          <span class="range-sep">至</span>
          <input v-model="form.dateTo" class="f-input" type="date" />
        </div>
        <p class="f-hint">同学年起止日期不可与已有学期交叉重叠。</p>
      </div>
      <div v-if="activeType === 'questionType'" class="f-field">
        <label class="f-label">作答类型<span class="req">*</span></label>
        <select v-model="form.answerType" class="f-select">
          <option v-for="type in ANSWER_TYPES" :key="type" :value="type">{{ type }}</option>
        </select>
        <p v-if="editing instanceof Object && editing.refCount > 0" class="f-hint warn-hint">
          该题型已被题目使用，保存后作答类型不建议修改。
        </p>
      </div>
      <div v-if="activeType === 'difficulty'" class="f-field">
        <label class="f-label">难度系数（0.1 - 1.0）<span class="req">*</span></label>
        <input v-model.number="form.coefficient" class="f-input" type="number" min="0.1" max="1" step="0.1" />
        <p class="f-hint">保留 1 位小数，且不可与其他等级重复。</p>
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
.dict-layout { display: flex; gap: 14px; align-items: flex-start; }
.type-panel { width: 200px; flex-shrink: 0; padding: 10px; }
.type-head { font-size: 12px; font-weight: 700; color: var(--sub); padding: 8px 12px 10px; }
.type-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: var(--ink-2);
  font-size: 13.5px;
  font-weight: 500;
  padding: 10px 12px;
  transition: background 0.15s, color 0.15s;
}
.type-item:hover { background: #f2f4fa; color: var(--ink); }
.type-item.active { background: var(--brand-soft); color: var(--brand); font-weight: 600; }
.table-panel { flex: 1; min-width: 0; }

.code-chip {
  font-family: 'SF Mono', Menlo, monospace;
  font-size: 12px;
  background: #f1f3f9;
  border-radius: 6px;
  padding: 2px 8px;
  color: #4b5568;
}
.ref-zero { color: var(--sub); }
.date-row { display: flex; align-items: center; gap: 8px; }
.date-row .f-input { flex: 1; }
.range-sep { font-size: 12.5px; color: var(--sub); }
.warn-hint { color: var(--warn); }
.form-err { font-size: 12px; color: var(--danger); margin: 4px 0; }
</style>
