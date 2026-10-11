<script setup lang="ts">
/**
 * 教材版本（平台管理端字典）。
 *
 * 优化点（教材版本优化）：
 * 1. 不再展示「机构引用」信息；
 * 2. 关联 年级 / 学期 / 使用地区；
 * 3. 搜索条件支持 学科 / 年级 / 学期 / 状态 / 使用地区 / 年份；
 * 4. 列表头提供「版本名称 / 出版社」模糊搜索，右上角为「新增版本」，列表支持分页；
 * 5. 目录（章节等）**不在新增 / 编辑表单里维护**，统一走右侧抽屉（TextbookCatalogDrawer）；
 * 6. 新增表单覆盖 年级 / 学期 / 学科 / 版本名称 / 出版社 / 封面图 / 使用地区 /
 *    适配年份（近 5 年 + 更久之前，多选）/ 教材电子版 PDF（非必填）。
 *
 * 学科 / 年级 / 学期 用 chip 单选（`AppChipGroup`），与搜索条件上的 chip 同一套样式；
 * 年级候选项取自**年级字典**（`fetchDict('grade')`），不在这里写死 —— 避免出现
 * 「教材版本写 初一/初二/初三，别处写 七年级/八年级/九年级」这种同一概念两种叫法。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { AppChipGroup, AppFilterPanel, AppIcon, AppListToolbar, hueColor, showToast, ApiError, AppModal, appConfirm } from '@aiteach/shared'
import type { DictItem, FilterRowDef, TextbookVersion } from '@aiteach/shared'
import AppSwitch from '@/components/ui/AppSwitch.vue'
import AppPagination from '@/components/ui/AppPagination.vue'
import TextbookCatalogDrawer from '@/components/textbook/TextbookCatalogDrawer.vue'
import { deleteTextbook, fetchDict, fetchTextbooks, saveTextbook, toggleTextbook } from '@/api/platform'

/* ===== 选项常量 ===== */
const TERMS = ['上学期', '下学期']
/** 使用地区（多选） */
const REGIONS = [
  '全国', '北京', '上海', '天津', '重庆', '河北', '山西', '辽宁', '吉林', '黑龙江',
  '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南', '湖北', '湖南', '广东',
  '海南', '四川', '贵州', '云南', '陕西', '甘肃', '青海', '内蒙古', '广西', '西藏', '宁夏', '新疆',
]
/** 适配年份：近 5 年 + 更久之前（多选） */
const CURRENT_YEAR = new Date().getFullYear()
const YEARS = computed(() => {
  const recent: string[] = []
  for (let i = 0; i < 5; i++) recent.push(String(CURRENT_YEAR - i))
  recent.push('更久之前')
  return recent
})
/** 状态筛选项 */
const STATUS_OPTIONS = ['正常', '已停用']

const subjects = ref<DictItem[]>([])
const grades = ref<DictItem[]>([])
const list = ref<TextbookVersion[]>([])
const loading = ref(false)

/* 启用中的字典候选（学科 / 年级），与「使用地区 / 年份」一起供 chip 选择 */
const enabledSubjects = computed(() => subjects.value.filter((item) => item.enabled).map((item) => item.name))
/** 年级：字典顺序（一~六年级 / 七~九年级 / 高一~高三），首项补「不限定」 */
const enabledGrades = computed(() => grades.value.filter((item) => item.enabled).map((item) => item.name))
const gradeOptions = computed(() => ['不限定', ...enabledGrades.value])
const termOptions = ['不限定', ...TERMS]

/* ===== 筛选（独立面板：学科 / 年级 / 学期 / 状态 / 使用地区 / 年份） ===== */
const FILTERS = reactive<Record<string, string[]>>({ subject: [], grade: [], term: [], status: [], region: [], year: [] })

function onFiltersChange(next: Record<string, string[]>) {
  FILTERS.subject = next.subject ?? []
  FILTERS.grade = next.grade ?? []
  FILTERS.term = next.term ?? []
  FILTERS.status = next.status ?? []
  FILTERS.region = next.region ?? []
  FILTERS.year = next.year ?? []
}

const FILTER_ROWS = computed<FilterRowDef[]>(() => [
  { key: 'subject', label: '学科', options: enabledSubjects.value, multiple: false },
  { key: 'grade', label: '年级', options: enabledGrades.value, multiple: false },
  { key: 'term', label: '学期', options: TERMS, multiple: false },
  { key: 'status', label: '状态', options: STATUS_OPTIONS, multiple: false },
  { key: 'region', label: '使用地区', options: REGIONS, multiple: true, collapsible: true },
  { key: 'year', label: '适配年份', options: YEARS.value, multiple: true },
])

/** 列表头搜索：版本名称 / 出版社 模糊匹配 */
const keyword = ref('')

/** 命中任一选中地区 / 年份即算匹配（多选条件下取交集） */
function intersect(source: string[] | undefined, selected: string[]) {
  if (!selected.length) return true
  return (source ?? []).some((value) => selected.includes(value))
}

const filtered = computed(() => {
  const subject = FILTERS.subject[0]
  const grade = FILTERS.grade[0]
  const term = FILTERS.term[0]
  const status = FILTERS.status[0]
  const kw = keyword.value.trim().toLowerCase()
  return list.value.filter((item) => {
    if (subject && item.subject !== subject) return false
    if (grade && item.grade !== grade) return false
    if (term && item.term !== term) return false
    if (status === '正常' && !item.enabled) return false
    if (status === '已停用' && item.enabled) return false
    if (!intersect(item.region, FILTERS.region)) return false
    if (!intersect(item.years, FILTERS.year)) return false
    if (kw) {
      const hit = item.name.toLowerCase().includes(kw) || item.publisher.toLowerCase().includes(kw)
      if (!hit) return false
    }
    return true
  })
})

/* ===== 分页 ===== */
const page = ref(1)
const pageSize = 10
const total = computed(() => filtered.value.length)
const paged = computed(() => filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize))

/* 条件变化回到第 1 页；数据量变小（删除 / 过滤）时把页码夹回有效范围 */
watch([() => JSON.stringify(FILTERS), keyword], () => { page.value = 1 })
watch(total, () => {
  const max = Math.max(1, Math.ceil(total.value / pageSize))
  if (page.value > max) page.value = max
})

async function load() {
  loading.value = true
  try {
    ;[subjects.value, grades.value, list.value] = await Promise.all([
      fetchDict('subject'),
      fetchDict('grade'),
      fetchTextbooks(),
    ])
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
  if (!(await appConfirm(`确认删除「${item.subject} · ${item.grade ?? ''}${item.name}」？`, { type: 'danger' }))) return
  try {
    await deleteTextbook(item.id)
    showToast('已删除', 'success')
    load()
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : '删除失败', 'error')
  }
}

/* ===== 目录抽屉（录入 / 查看，与知识点树同 UI / 交互） ===== */
const catalogTarget = ref<TextbookVersion | null>(null)
function openCatalog(item: TextbookVersion) {
  catalogTarget.value = item
}
function onCatalogClose() {
  catalogTarget.value = null
  /* 目录可能在抽屉里改过，重新拉一次列表 */
  load()
}

/* ===== 新增 / 编辑（目录不在此维护） ===== */
const editing = ref<TextbookVersion | 'new' | null>(null)
const form = reactive({
  subject: '',
  name: '',
  publisher: '',
  grade: '',
  term: '',
  region: [] as string[],
  years: [] as string[],
  cover: '',
  fileUrl: '',
  fileName: '',
})
const formError = ref('')
const saving = ref(false)

/* 单选 chip 的受控值是「长度 0/1 的数组」，这里与表单里的字符串互转 */
const subjectModel = computed<string[]>({
  get: () => (form.subject ? [form.subject] : []),
  set: (value) => { form.subject = value[0] ?? enabledSubjects.value[0] ?? '' },
})
const gradeModel = computed<string[]>({
  get: () => [form.grade || '不限定'],
  set: (value) => { const next = value[0] ?? '不限定'; form.grade = next === '不限定' ? '' : next },
})
const termModel = computed<string[]>({
  get: () => [form.term || '不限定'],
  set: (value) => { const next = value[0] ?? '不限定'; form.term = next === '不限定' ? '' : next },
})

function resetForm() {
  form.subject = enabledSubjects.value[0] ?? '数学'
  form.name = ''
  form.publisher = ''
  form.grade = ''
  form.term = ''
  form.region = []
  form.years = []
  form.cover = ''
  form.fileUrl = ''
  form.fileName = ''
  formError.value = ''
}

function openCreate() {
  editing.value = 'new'
  resetForm()
}

function openEdit(item: TextbookVersion) {
  editing.value = item
  form.subject = item.subject
  form.name = item.name
  form.publisher = item.publisher
  form.grade = item.grade ?? ''
  form.term = item.term ?? ''
  form.region = item.region ? [...item.region] : []
  form.years = item.years ? [...item.years] : []
  form.cover = item.cover ?? ''
  form.fileUrl = item.fileUrl ?? ''
  form.fileName = item.fileName ?? ''
  formError.value = ''
}

function onCoverChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    form.cover = reader.result as string
  }
  reader.readAsDataURL(file)
  input.value = ''
}

function removeCover() {
  form.cover = ''
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  form.fileName = file.name
  form.fileUrl = URL.createObjectURL(file)
  input.value = ''
}

function removeFile() {
  form.fileName = ''
  form.fileUrl = ''
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
      grade: form.grade || undefined,
      term: form.term || undefined,
      region: form.region.length ? form.region : undefined,
      years: form.years.length ? form.years : undefined,
      cover: form.cover || undefined,
      fileUrl: form.fileUrl || undefined,
      fileName: form.fileName || undefined,
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
  <div class="page">
    <!-- 搜索条件：独立面板，与下方列表分开（对齐机构端列表页布局） -->
    <AppFilterPanel :rows="FILTER_ROWS" :model-value="FILTERS" @update:model-value="onFiltersChange" />

    <div class="panel">
      <!-- 列表头：左侧搜索框（版本名称 / 出版社），右上角「新增版本」 -->
      <AppListToolbar v-model="keyword" placeholder="搜索版本名称 / 出版社" :search-width="240">
        <template #right>
          <button class="btn btn-primary btn-sm" type="button" @click="openCreate">
            <AppIcon name="plus" :size="15" /> 新增版本
          </button>
        </template>
      </AppListToolbar>

      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>封面</th>
              <th>学科</th>
              <th>年级</th>
              <th>版本名称</th>
              <th>学期</th>
              <th>出版社</th>
              <th>使用地区</th>
              <th>适配年份</th>
              <th>目录</th>
              <th>状态</th>
              <th style="width: 170px">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading && list.length === 0">
              <td colspan="11" class="empty-row">加载中…</td>
            </tr>
            <tr v-else-if="filtered.length === 0">
              <td colspan="11" class="empty-row">暂无教材版本</td>
            </tr>
            <template v-else>
              <tr v-for="item in paged" :key="item.id">
                <td>
                  <img v-if="item.cover" :src="item.cover" class="cover-img" alt="封面" />
                  <span v-else class="cover" :style="{ background: hueColor(item.hue) }">{{ item.name.charAt(0) }}</span>
                </td>
                <td>{{ item.subject }}</td>
                <td>{{ item.grade || '—' }}</td>
                <td class="cell-strong">{{ item.name }}</td>
                <td>{{ item.term || '—' }}</td>
                <td>{{ item.publisher }}</td>
                <td class="region-cell">{{ item.region?.join('、') || '—' }}</td>
                <td class="year-cell">{{ item.years?.join('、') || '—' }}</td>
                <td>
                  <button class="link-btn" type="button" @click="openCatalog(item)">
                    {{ item.catalog?.length ? `${item.catalog.length} 章` : '录入' }}
                  </button>
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

      <AppPagination :total="total" v-model:page="page" :page-size="pageSize" />
    </div>

    <!-- 新增 / 编辑（目录不在此维护，走右侧抽屉） -->
    <AppModal
      v-if="editing"
      :title="editing === 'new' ? '新增教材版本' : '编辑教材版本'"
      :width="680"
      @close="editing = null"
    >
      <div class="f-field">
        <label class="f-label">学科<span class="req">*</span></label>
        <AppChipGroup v-model="subjectModel" :options="enabledSubjects" :multiple="false" :clearable="false" />
      </div>
      <div class="f-field">
        <label class="f-label">年级</label>
        <AppChipGroup v-model="gradeModel" :options="gradeOptions" :multiple="false" />
      </div>
      <div class="f-field">
        <label class="f-label">学期</label>
        <AppChipGroup v-model="termModel" :options="termOptions" :multiple="false" />
      </div>

      <div class="form-grid">
        <div class="f-field">
          <label class="f-label">版本名称<span class="req">*</span></label>
          <input v-model="form.name" class="f-input" placeholder="如：人教版" />
        </div>
        <div class="f-field">
          <label class="f-label">出版社</label>
          <input v-model="form.publisher" class="f-input" placeholder="选填" />
        </div>
      </div>

      <div class="f-field">
        <label class="f-label">使用地区<span class="muted">（多选）</span></label>
        <AppChipGroup v-model="form.region" :options="REGIONS" />
      </div>

      <div class="f-field">
        <label class="f-label">适配年份<span class="muted">（多选）</span></label>
        <AppChipGroup v-model="form.years" :options="YEARS" />
      </div>

      <div class="f-field">
        <label class="f-label">封面图</label>
        <div class="upload-row">
          <img v-if="form.cover" :src="form.cover" class="cover-preview" alt="封面预览" />
          <div v-else class="cover-placeholder">
            <AppIcon name="image" :size="22" />
            <span>未上传</span>
          </div>
          <div class="upload-ops">
            <label class="upload-btn">
              选择图片
              <input type="file" accept="image/*" class="hidden-file" @change="onCoverChange" />
            </label>
            <button v-if="form.cover" class="upload-btn ghost" type="button" @click="removeCover">移除</button>
          </div>
        </div>
      </div>

      <div class="f-field">
        <label class="f-label">教材电子版文件<span class="muted">（非必填 · PDF）</span></label>
        <div class="upload-row">
          <span class="file-name">{{ form.fileName || '未上传' }}</span>
          <div class="upload-ops">
            <label class="upload-btn">
              上传 PDF
              <input type="file" accept="application/pdf" class="hidden-file" @change="onFileChange" />
            </label>
            <button v-if="form.fileName" class="upload-btn ghost" type="button" @click="removeFile">移除</button>
          </div>
        </div>
      </div>

      <p v-if="formError" class="form-err">{{ formError }}</p>
      <template #footer>
        <button class="btn btn-ghost btn-sm" type="button" @click="editing = null">取消</button>
        <button class="btn btn-primary btn-sm" type="button" :disabled="saving" @click="save">
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </template>
    </AppModal>

    <!-- 目录抽屉（录入 / 查看） -->
    <TextbookCatalogDrawer :textbook="catalogTarget" @close="onCatalogClose" />
  </div>
</template>

<style scoped>
/* 列表头（AppListToolbar）在 .panel 内留出与面板一致的内边距，
   与「机构列表」的搜索框 / 新增按钮对齐。 */
.panel > :deep(.list-toolbar) { padding: 14px 14px 0; }

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
.cover-img {
  width: 32px;
  height: 42px;
  border-radius: 6px;
  object-fit: cover;
  box-shadow: 0 3px 8px rgba(28, 36, 52, 0.15);
}
.region-cell { font-size: 12.5px; max-width: 140px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.year-cell { font-size: 12.5px; color: var(--sub); }
.link-btn {
  border: none;
  background: transparent;
  color: var(--brand-deep);
  font-size: 12.5px;
  cursor: pointer;
  padding: 0;
}
.link-btn:hover { text-decoration: underline; }
.form-err { font-size: 12px; color: var(--danger); margin: 4px 0; }

/* ===== 表单 ===== */
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 16px;
}
.f-field { margin-bottom: 14px; }
.f-label {
  display: block;
  font-size: 12.5px;
  color: var(--ink-2);
  font-weight: 600;
  margin-bottom: 6px;
}
.f-label .req { color: var(--danger); margin-left: 2px; }
.f-label .muted { color: var(--sub); font-weight: 400; margin-left: 4px; }
.f-select,
.f-input {
  width: 100%;
  height: 36px;
  border: 1.5px solid var(--border);
  border-radius: 9px;
  padding: 0 12px;
  font-size: 13px;
  font-family: inherit;
  color: var(--ink);
  background: #fff;
  outline: none;
}
.f-select:focus,
.f-input:focus { border-color: var(--brand); }

.upload-row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.cover-preview {
  width: 44px;
  height: 60px;
  border-radius: 6px;
  object-fit: cover;
  box-shadow: 0 3px 8px rgba(28, 36, 52, 0.15);
}
.cover-placeholder {
  width: 44px;
  height: 60px;
  border-radius: 6px;
  border: 1px dashed var(--border);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  color: var(--sub);
  font-size: 10px;
}
.upload-ops { display: flex; align-items: center; gap: 8px; }
.upload-btn {
  display: inline-flex;
  align-items: center;
  border: 1.5px solid var(--brand);
  background: var(--brand-soft);
  color: var(--brand-deep);
  font-size: 12.5px;
  font-weight: 700;
  padding: 6px 14px;
  border-radius: 8px;
  cursor: pointer;
}
.upload-btn.ghost {
  border-color: var(--border);
  background: #fff;
  color: var(--sub);
  font-weight: 600;
}
.upload-btn:hover { filter: brightness(0.97); }
.hidden-file { display: none; }
.file-name { font-size: 12.5px; color: var(--ink-2); }
</style>
