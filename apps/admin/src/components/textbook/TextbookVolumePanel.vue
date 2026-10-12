<script setup lang="ts">
/**
 * 教材分册面板（右侧）：展示并维护「当前所选教材版本」下的分册列表。
 *
 * - 顶部一行直接展示当前版本基本信息（学段 学科 版本名称 出版社，无 label 标签），
 *   最右侧靠边一个「详情」按钮，点开弹窗查看全部信息（含适用地区 / 修订年份 / 状态）；
 * - 工具条：左侧按「册别名」搜索，右上角「新增分册」；
 * - 表格：封面 / 册别名 / 年级 / 学期 / 适配学年 / 目录 / 状态 / 操作；
 * - 新增 / 编辑分册表单顶部只读展示「学段 / 学科 / 教材版本」，年级只列该学段下的年级；
 * - 目录走右侧抽屉单独维护（新增 / 编辑分册表单里不出现目录）。
 *
 * 面板只接收「已经过全局搜索条件过滤」的分册数组（`volumes`），自己再叠加册别名搜索与分页；
 * 任何增删改后 emit `changed`，由宿主重新拉取数据（保持单一数据源）。
 */
import { computed, reactive, ref, watch } from 'vue'
import {
  ApiError,
  AppChipGroup,
  AppIcon,
  AppListToolbar,
  AppModal,
  appConfirm,
  hueColor,
  showToast,
} from '@aiteach/shared'
import type { DictItem, TextbookVolume, TextbookVersion } from '@aiteach/shared'
import AppSwitch from '@/components/ui/AppSwitch.vue'
import AppPagination from '@/components/ui/AppPagination.vue'
import TextbookCatalogDrawer from './TextbookCatalogDrawer.vue'
import { deleteTextbookVolume, fetchDict, saveTextbookVolume, toggleTextbookVolume } from '@/api/platform'

const TERMS = ['上学期', '下学期']

const props = defineProps<{
  /** 当前选中的教材版本；为空时右侧显示空态 */
  version: TextbookVersion | null
  /** 已按全局搜索条件过滤过的分册列表 */
  volumes: TextbookVolume[]
}>()

const emit = defineEmits<{ changed: [] }>()

const grades = ref<DictItem[]>([])
const keyword = ref('')
const detailOpen = ref(false)

/** 适配学年候选：近 5 年 + 「更久之前」（与搜索条件「年份」同一套取值域） */
const yearOptions = computed(() => {
  const year = new Date().getFullYear()
  return [...Array.from({ length: 5 }, (_, i) => String(year - i)), '更久之前']
})
/** 年级候选只保留「当前版本所属学段」下的年级（如小学版本只出现一~六年级） */
const gradeOptions = computed(() =>
  grades.value
    .filter((item) => item.enabled && (!props.version?.stage || item.stage === props.version.stage))
    .map((item) => item.name),
)

/* 册别名模糊搜索（在全局条件之上再收一层） */
const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return props.volumes
  return props.volumes.filter((item) => item.alias.toLowerCase().includes(kw))
})

/* ===== 分页 ===== */
const page = ref(1)
const pageSize = 10
const paged = computed(() => filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize))
watch(keyword, () => { page.value = 1 })
watch(() => props.version?.id, () => { page.value = 1; detailOpen.value = false })
watch(filtered, () => {
  const max = Math.max(1, Math.ceil(filtered.value.length / pageSize))
  if (page.value > max) page.value = max
})

/* ===== 新增 / 编辑分册 ===== */
const editing = ref<TextbookVolume | 'new' | null>(null)
const form = reactive({ alias: '', grade: '', term: '', year: '', cover: '', fileUrl: '', fileName: '' })
const formError = ref('')
const saving = ref(false)

const gradeModel = computed<string[]>({
  get: () => (form.grade ? [form.grade] : []),
  set: (value) => { form.grade = value[0] ?? '' },
})
const termModel = computed<string[]>({
  get: () => (form.term ? [form.term] : []),
  set: (value) => { form.term = value[0] ?? '' },
})
const yearModel = computed<string[]>({
  get: () => (form.year ? [form.year] : []),
  set: (value) => { form.year = value[0] ?? '' },
})

/**
 * 册别名自动建议：新增时年级 + 学期一选好、而别名还空着（用户没动过），
 * 就预填一个「一年级上册」这类默认名 —— 只是建议，用户随时可改成「必修第一册」。
 */
watch([() => form.grade, () => form.term], () => {
  if (editing.value !== 'new' || form.alias.trim()) return
  if (!form.grade || !form.term) return
  form.alias = `${form.grade}${form.term === '下学期' ? '下册' : '上册'}`
})

function resetForm() {
  form.alias = ''
  form.grade = gradeOptions.value[0] ?? ''
  form.term = TERMS[0]
  form.year = yearOptions.value[0] ?? ''
  form.cover = ''
  form.fileUrl = ''
  form.fileName = ''
  formError.value = ''
}
function openCreate() {
  if (!props.version) return
  editing.value = 'new'
  resetForm()
}
function openEdit(item: TextbookVolume) {
  editing.value = item
  form.alias = item.alias
  form.grade = item.grade
  form.term = item.term
  form.year = item.year ?? ''
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
  reader.onload = () => { form.cover = reader.result as string }
  reader.readAsDataURL(file)
  input.value = ''
}
function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  form.fileName = file.name
  form.fileUrl = URL.createObjectURL(file)
  input.value = ''
}

async function saveModal() {
  if (!props.version) return
  if (!form.alias.trim()) { formError.value = '册别名不能为空'; return }
  saving.value = true
  try {
    await saveTextbookVolume({
      id: editing.value instanceof Object ? editing.value.id : undefined,
      textbookId: props.version.id,
      alias: form.alias.trim(),
      grade: form.grade,
      term: form.term,
      year: form.year || undefined,
      cover: form.cover || undefined,
      fileUrl: form.fileUrl || undefined,
      fileName: form.fileName || undefined,
    })
    showToast('已保存', 'success')
    editing.value = null
    emit('changed')
  } catch (error) {
    formError.value = error instanceof ApiError ? error.message : '保存失败，请重试'
  } finally {
    saving.value = false
  }
}

async function onToggle(item: TextbookVolume) {
  try {
    const result = await toggleTextbookVolume(item.id)
    showToast(result.enabled ? '已启用' : '已停用', 'success')
    emit('changed')
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : '操作失败', 'error')
  }
}

async function onDelete(item: TextbookVolume) {
  if (!(await appConfirm(`确认删除分册「${item.alias}」？`, { type: 'danger' }))) return
  try {
    await deleteTextbookVolume(item.id)
    showToast('已删除', 'success')
    emit('changed')
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : '删除失败', 'error')
  }
}

/* ===== 目录抽屉 ===== */
const catalogTarget = ref<TextbookVolume | null>(null)
function openCatalog(item: TextbookVolume) { catalogTarget.value = item }
function onCatalogClose() {
  catalogTarget.value = null
  /* 目录改过，刷新一下列表里的「N 章」 */
  emit('changed')
}

/** 新页签预览教材电子版 PDF（仅当该分册已上传电子版时才出现该按钮） */
function preview(item: TextbookVolume) {
  if (!item.fileUrl) return
  window.open(item.fileUrl, '_blank', 'noopener')
}

fetchDict('grade').then((list) => { grades.value = list })
</script>

<template>
  <div class="volume-panel">
    <template v-if="version">
      <!-- 当前版本基本信息：直接平铺，无 label；最右侧靠边「详情」 -->
      <div class="v-head">
        <div class="v-title">
          <span class="v-t">{{ version.stage }}</span>
          <span class="v-t">{{ version.subject }}</span>
          <span class="v-t strong">{{ version.name }}</span>
          <span class="v-t sub">{{ version.publisher || '—' }}</span>
          <span v-if="!version.enabled" class="tag tag-red">已停用</span>
        </div>
        <button class="mini-btn detail-btn" type="button" @click="detailOpen = true">详情</button>
      </div>

      <AppListToolbar v-model="keyword" placeholder="搜索册别名" :search-width="220">
        <template #right>
          <button class="btn btn-primary btn-sm" type="button" @click="openCreate">
            <AppIcon name="plus" :size="15" /> 新增分册
          </button>
        </template>
      </AppListToolbar>

      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>封面</th>
              <th>册别名</th>
              <th>年级</th>
              <th>学期</th>
              <th>适配学年</th>
              <th>目录</th>
              <th>状态</th>
              <th style="width: 170px">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="filtered.length === 0">
              <td colspan="8" class="empty-row">暂无分册，点击右上角「新增分册」</td>
            </tr>
            <template v-else>
              <tr v-for="item in paged" :key="item.id">
                <td>
                  <img v-if="item.cover" :src="item.cover" class="cover-img" alt="封面" />
                  <span v-else class="cover" :style="{ background: hueColor(version.hue) }">{{ item.alias.charAt(0) }}</span>
                </td>
                <td class="cell-strong">{{ item.alias }}</td>
                <td>{{ item.grade || '—' }}</td>
                <td>{{ item.term || '—' }}</td>
                <td class="year-cell">{{ item.year || '—' }}</td>
                <td>
                  <button class="link-btn" type="button" @click="openCatalog(item)">
                    {{ item.catalog?.length ? `${item.catalog.length} 章` : '录入' }}
                  </button>
                </td>
                <td><AppSwitch :model-value="item.enabled" @update:model-value="onToggle(item)" /></td>
                <td>
                  <div class="op-group">
                    <button v-if="item.fileUrl" class="mini-btn" type="button" @click="preview(item)">预览</button>
                    <button class="mini-btn" type="button" @click="openEdit(item)">编辑</button>
                    <button class="mini-btn danger" type="button" @click="onDelete(item)">删除</button>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <AppPagination :total="filtered.length" v-model:page="page" :page-size="pageSize" />
    </template>

    <!-- 未选中版本时的空态 -->
    <div v-else class="volume-empty">
      <AppIcon name="book" :size="30" />
      <p>请选择左侧教材版本，查看其教材分册</p>
    </div>

    <!-- 教材版本详情（全部信息） -->
    <AppModal v-if="detailOpen && version" title="教材版本详情" :width="520" @close="detailOpen = false">
      <dl class="detail-list">
        <div class="dl-row"><dt>学段</dt><dd>{{ version.stage }}</dd></div>
        <div class="dl-row"><dt>学科</dt><dd>{{ version.subject }}</dd></div>
        <div class="dl-row"><dt>版本名称</dt><dd>{{ version.name }}</dd></div>
        <div class="dl-row"><dt>出版社</dt><dd>{{ version.publisher || '—' }}</dd></div>
        <div class="dl-row"><dt>适用地区</dt><dd>{{ version.region?.join('、') || '—' }}</dd></div>
        <div class="dl-row"><dt>修订年份</dt><dd>{{ version.years?.join('、') || '—' }}</dd></div>
        <div class="dl-row">
          <dt>状态</dt>
          <dd><span class="tag" :class="version.enabled ? 'tag-green' : 'tag-red'">{{ version.enabled ? '启用' : '已停用' }}</span></dd>
        </div>
      </dl>
      <template #footer>
        <button class="btn btn-primary btn-sm" type="button" @click="detailOpen = false">知道了</button>
      </template>
    </AppModal>

    <!-- 新增 / 编辑分册（目录不在此维护） -->
    <AppModal
      v-if="editing"
      :title="editing === 'new' ? '新增分册' : '编辑分册'"
      :width="620"
      @close="editing = null"
    >
      <!-- 所属教材版本：与面板顶部同款纯文本展示（学段 学科 版本名称 出版社），不用禁用输入框 -->
      <div class="meta-title">
        <span class="v-t">{{ version?.stage }}</span>
        <span class="v-t">{{ version?.subject }}</span>
        <span class="v-t strong">{{ version?.name }}</span>
        <span class="v-t sub">{{ version?.publisher || '—' }}</span>
      </div>
      <div class="f-field">
        <label class="f-label">册别名<span class="req">*</span></label>
        <input v-model="form.alias" class="f-input" placeholder="如：必修第一册 / 一年级上册" />
      </div>
      <div class="form-grid">
        <div class="f-field">
          <label class="f-label">年级<span class="muted">（仅 {{ version?.stage }}）</span></label>
          <AppChipGroup v-model="gradeModel" :options="gradeOptions" :multiple="false" :clearable="false" />
        </div>
        <div class="f-field">
          <label class="f-label">学期</label>
          <AppChipGroup v-model="termModel" :options="TERMS" :multiple="false" :clearable="false" />
        </div>
      </div>
      <div class="f-field">
        <label class="f-label">适配学年</label>
        <AppChipGroup v-model="yearModel" :options="yearOptions" :multiple="false" />
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
            <button v-if="form.cover" class="upload-btn ghost" type="button" @click="form.cover = ''">移除</button>
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
            <button v-if="form.fileName" class="upload-btn ghost" type="button" @click="form.fileName = ''; form.fileUrl = ''">移除</button>
          </div>
        </div>
      </div>

      <p v-if="formError" class="form-err">{{ formError }}</p>
      <template #footer>
        <button class="btn btn-ghost btn-sm" type="button" @click="editing = null">取消</button>
        <button class="btn btn-primary btn-sm" type="button" :disabled="saving" @click="saveModal">
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </template>
    </AppModal>

    <!-- 目录抽屉（录入 / 查看，与知识点树同 UI；章节能关联知识点） -->
    <TextbookCatalogDrawer :volume="catalogTarget" :version="version" @close="onCatalogClose" />
  </div>
</template>

<style scoped>
.volume-panel { display: flex; flex-direction: column; flex: 1; min-height: 0; }

/* 当前版本信息：一行平铺，无 label；详情按钮靠最右 */
.v-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.v-title { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-width: 0; }
.v-t { font-size: 13.5px; color: var(--ink); }
.v-t.strong { font-weight: 700; }
.v-t.sub { color: var(--sub); }
/* 「详情」用表格操作列同款文字按钮，仅需靠右固定 */
.detail-btn { margin-left: auto; flex-shrink: 0; }

/* 详情弹窗：键值列表 */
.detail-list { display: flex; flex-direction: column; gap: 0; }
.dl-row { display: flex; align-items: flex-start; gap: 12px; padding: 9px 2px; border-bottom: 1px dashed var(--border); }
.dl-row:last-child { border-bottom: none; }
.dl-row dt { width: 84px; flex-shrink: 0; font-size: 12.5px; color: var(--sub); }
.dl-row dd { flex: 1; min-width: 0; font-size: 13px; color: var(--ink); }

/* 工具条留出与面板一致的内边距 */
.volume-panel :deep(.list-toolbar) { padding: 14px 14px 0; }
/* 表格占满剩余高度并自己滚动，分页器固定在底部 */
.volume-panel :deep(.data-table-wrap) { flex: 1; min-height: 0; overflow: auto; padding: 0 14px; }
.volume-panel :deep(.pagination) { padding: 10px 14px 12px; }

.volume-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--sub);
  font-size: 13.5px;
}

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
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 16px; }
.f-field { margin-bottom: 14px; }
.f-label {
  display: block;
  font-size: 12.5px;
  color: var(--ink-2);
  font-weight: 600;
  margin-bottom: 6px;
}
.f-label .muted { color: var(--sub); font-weight: 400; margin-left: 4px; }
/* 弹窗里展示「所属教材版本」的纯文本块（与面板顶部 .v-title 同款内容） */
.meta-title {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  background: #f7f9fd;
  border-radius: 10px;
  padding: 10px 12px;
  margin-bottom: 14px;
}

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
