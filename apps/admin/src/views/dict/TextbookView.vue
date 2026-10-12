<script setup lang="ts">
/**
 * 教材版本 + 教材分册（平台管理端）。
 *
 * 版式（教材版本优化）：
 * - 顶部：搜索条件面板（**学科 / 年级 / 适用地区** 三个条件）；
 * - 下方左侧：**教材版本树**（学段 → 学科 → 版本，固定宽度，UI 对齐机构端知识点树：
 *   标题 + 搜索 + 行内「数据条数」，学段 / 学科只读、学科可「添加教材」）；
 * - 下方右侧：**教材分册面板**（当前版本信息 + 详情 + 分册表格 + 新增分册 + 目录抽屉）。
 *
 * 搜索条件「左右都筛」：
 * - 左树：学科 / 适用地区按**版本**匹配，年级按「该版本下存在命中分册」匹配；
 * - 右表：再按**年级**对分册二次筛选（学科、适用地区是版本级属性，右侧已被所选版本锁定）。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ApiError, AppChipGroup, AppFilterPanel, AppModal, appConfirm, showToast } from '@aiteach/shared'
import type { DictItem, FilterRowDef, TextbookVersion, TextbookVolume } from '@aiteach/shared'
import TextbookVersionTree from '@/components/textbook/TextbookVersionTree.vue'
import TextbookVolumePanel from '@/components/textbook/TextbookVolumePanel.vue'
import {
  deleteTextbook,
  fetchDict,
  fetchTextbookVolumes,
  fetchTextbooks,
  saveTextbook,
  toggleTextbook,
} from '@/api/platform'

/* ===== 选项常量 ===== */
/** 适用地区（多选） */
const REGIONS = [
  '全国', '北京', '上海', '天津', '重庆', '河北', '山西', '辽宁', '吉林', '黑龙江',
  '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南', '湖北', '湖南', '广东',
  '海南', '四川', '贵州', '云南', '陕西', '甘肃', '青海', '内蒙古', '广西', '西藏', '宁夏', '新疆',
]
/** 修订年份：近 5 年 + 更久之前（多选） */
const YEARS = computed(() => {
  const year = new Date().getFullYear()
  return [...Array.from({ length: 5 }, (_, i) => String(year - i)), '更久之前']
})

/* ===== 数据 ===== */
const versions = ref<TextbookVersion[]>([])
const volumes = ref<TextbookVolume[]>([])
const grades = ref<DictItem[]>([])
const subjects = ref<DictItem[]>([])
const loading = ref(false)
const activeVersionId = ref<number | null>(null)

const enabledSubjects = computed(() => subjects.value.filter((item) => item.enabled).map((item) => item.name))
const enabledGrades = computed(() => grades.value.filter((item) => item.enabled).map((item) => item.name))

/* ===== 搜索条件（左右都筛） ===== */
const FILTERS = reactive<Record<string, string[]>>({ subject: [], grade: [], region: [] })

function onFiltersChange(next: Record<string, string[]>) {
  FILTERS.subject = next.subject ?? []
  FILTERS.grade = next.grade ?? []
  FILTERS.region = next.region ?? []
}

const FILTER_ROWS = computed<FilterRowDef[]>(() => [
  { key: 'subject', label: '学科', options: enabledSubjects.value, multiple: false },
  { key: 'grade', label: '年级', options: enabledGrades.value, multiple: false },
  { key: 'region', label: '适用地区', options: REGIONS, multiple: true, collapsible: true },
])

/** 多选条件下「命中任一」即算匹配 */
function intersect(source: string[] | undefined, selected: string[]) {
  if (!selected.length) return true
  return (source ?? []).some((value) => selected.includes(value))
}

/** 左侧版本树的数据源：学科 / 适用地区按版本匹配，年级要求该版本下有命中分册 */
const filteredVersions = computed(() => {
  const subject = FILTERS.subject[0]
  const grade = FILTERS.grade[0]
  return versions.value.filter((item) => {
    if (subject && item.subject !== subject) return false
    if (!intersect(item.region, FILTERS.region)) return false
    if (grade && !volumes.value.some((volume) => volume.textbookId === item.id && volume.grade === grade)) return false
    return true
  })
})

/** 选中版本若被条件筛掉了，自动落到第一个可见版本；一个都没有则回到空态 */
watch(
  () => filteredVersions.value.map((item) => item.id).join(','),
  () => {
    const list = filteredVersions.value
    if (!list.some((item) => item.id === activeVersionId.value)) {
      activeVersionId.value = list[0]?.id ?? null
    }
  },
  { immediate: true },
)

const activeVersion = computed(() => filteredVersions.value.find((item) => item.id === activeVersionId.value) ?? null)

/** 右侧分册表的数据源：在所选版本的分册上再按年级收一层 */
const activeVolumes = computed(() => {
  if (activeVersionId.value == null) return []
  const grade = FILTERS.grade[0]
  return volumes.value.filter((item) => {
    if (item.textbookId !== activeVersionId.value) return false
    if (grade && item.grade !== grade) return false
    return true
  })
})

/* ===== 加载 ===== */
async function load() {
  loading.value = true
  try {
    ;[versions.value, volumes.value, grades.value, subjects.value] = await Promise.all([
      fetchTextbooks(),
      fetchTextbookVolumes(),
      fetchDict('grade'),
      fetchDict('subject'),
    ])
  } finally {
    loading.value = false
  }
}
/** 分册面板增删改后只重拉分册（版本树不受影响） */
async function reloadVolumes() {
  volumes.value = await fetchTextbookVolumes()
}

/* ===== 版本：新增 / 编辑（学段、学科由左侧树带入，只读） ===== */
const editing = ref<TextbookVersion | 'new' | null>(null)
const form = reactive({ stage: '', subject: '', name: '', publisher: '', region: [] as string[], years: [] as string[] })
const formError = ref('')
const saving = ref(false)

function openCreate(payload: { stage: string; subject: string }) {
  editing.value = 'new'
  form.stage = payload.stage
  form.subject = payload.subject
  form.name = ''
  form.publisher = ''
  form.region = []
  form.years = []
  formError.value = ''
}
function openEdit(item: TextbookVersion) {
  editing.value = item
  form.stage = item.stage
  form.subject = item.subject
  form.name = item.name
  form.publisher = item.publisher
  form.region = item.region ? [...item.region] : []
  form.years = item.years ? [...item.years] : []
  formError.value = ''
}

async function saveVersion() {
  if (!form.name.trim()) { formError.value = '版本名称不能为空'; return }
  saving.value = true
  try {
    const saved = await saveTextbook({
      id: editing.value instanceof Object ? editing.value.id : undefined,
      stage: form.stage,
      subject: form.subject,
      name: form.name.trim(),
      publisher: form.publisher.trim(),
      region: form.region.length ? form.region : undefined,
      years: form.years.length ? form.years : undefined,
    })
    showToast('已保存', 'success')
    editing.value = null
    await load()
    activeVersionId.value = saved.id
  } catch (error) {
    formError.value = error instanceof ApiError ? error.message : '保存失败，请重试'
  } finally {
    saving.value = false
  }
}

async function onToggleVersion(item: TextbookVersion) {
  try {
    const result = await toggleTextbook(item.id)
    showToast(result.enabled ? '已启用' : '已停用', 'success')
    await load()
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : '操作失败', 'error')
  }
}

async function onRemoveVersion(item: TextbookVersion) {
  if (!(await appConfirm(`确认删除教材版本「${item.stage} · ${item.subject} · ${item.name}」？其下分册将一并删除。`, { type: 'danger' }))) return
  try {
    await deleteTextbook(item.id)
    showToast('已删除', 'success')
    await load()
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : '删除失败', 'error')
  }
}

onMounted(load)
</script>

<template>
  <div class="page tb-page">
    <!-- 搜索条件：学科 / 年级 / 适用地区，左右两侧都参与筛选 -->
    <AppFilterPanel :rows="FILTER_ROWS" :model-value="FILTERS" @update:model-value="onFiltersChange" />

    <div class="tb-layout">
      <!-- 左：教材版本树（固定宽度） -->
      <div class="panel tree-col">
        <TextbookVersionTree
          :versions="filteredVersions"
          :volumes="volumes"
          :grades="grades"
          :subjects="subjects"
          :active-version-id="activeVersionId"
          @select="activeVersionId = $event"
          @create="openCreate"
          @edit="openEdit"
          @remove="onRemoveVersion"
          @toggle="onToggleVersion"
        />
      </div>

      <!-- 右：教材分册 -->
      <div class="panel volume-col">
        <TextbookVolumePanel :version="activeVersion" :volumes="activeVolumes" @changed="reloadVolumes" />
      </div>
    </div>

    <!-- 新增 / 编辑教材版本（学段、学科由左侧树带入，不可修改） -->
    <AppModal
      v-if="editing"
      :title="editing === 'new' ? '新增教材版本' : '编辑教材版本'"
      :width="640"
      @close="editing = null"
    >
      <div class="form-grid">
        <div class="f-field">
          <label class="f-label">学段</label>
          <div class="f-text">{{ form.stage }}</div>
        </div>
        <div class="f-field">
          <label class="f-label">学科</label>
          <div class="f-text">{{ form.subject }}</div>
        </div>
      </div>
      <p class="f-hint scope-hint">学段 / 学科由左侧树带入，在「基础字典」里维护，此处不可修改。</p>

      <div class="form-grid">
        <div class="f-field">
          <label class="f-label">版本名称<span class="req">*</span></label>
          <input v-model="form.name" class="f-input" placeholder="如：人教版" />
        </div>
        <div class="f-field">
          <label class="f-label">出版社</label>
          <input v-model="form.publisher" class="f-input" placeholder="如：人民教育出版社" />
        </div>
      </div>
      <div class="f-field">
        <label class="f-label">适用地区<span class="muted">（多选）</span></label>
        <AppChipGroup v-model="form.region" :options="REGIONS" />
      </div>
      <div class="f-field">
        <label class="f-label">修订年份</label>
        <AppChipGroup v-model="form.years" :options="YEARS" :multiple="false" />
      </div>

      <p v-if="formError" class="form-err">{{ formError }}</p>
      <template #footer>
        <button class="btn btn-ghost btn-sm" type="button" @click="editing = null">取消</button>
        <button class="btn btn-primary btn-sm" type="button" :disabled="saving" @click="saveVersion">
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
/* 页面不再整体滚动：高度锁死，滚动收进左右两栏（小屏靠 min-height 兜底） */
.tb-page { height: calc(100vh - 62px - 44px); min-height: 520px; }
.tb-layout { display: flex; gap: 14px; flex: 1; min-height: 0; }
/* 左：固定宽度版本树（比机构端知识点面板略宽，行内操作图标才不会压住右侧条数） */
.tree-col { width: 320px; flex-shrink: 0; display: flex; flex-direction: column; min-height: 0; }
/* 右：分册面板自适应 */
.volume-col { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0; }

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
/* 学段 / 学科：只读纯文本（与输入框同高，避免与下方字段错位） */
.f-text { display: flex; align-items: center; height: 38px; font-size: 13.5px; color: var(--ink); font-weight: 500; }
/* 紧跟「学段 / 学科」两列之后的说明：收紧上间距，让它明确挂在这两个字段下面 */
.scope-hint { margin-top: -10px; margin-bottom: 16px; }
.form-err { font-size: 12px; color: var(--danger); margin: 4px 0; }
</style>
