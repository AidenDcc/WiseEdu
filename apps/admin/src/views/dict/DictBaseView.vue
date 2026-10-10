<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import {
  AppIcon,
  AppListToolbar,
  showToast,
  ApiError,
  /* examType / competition 已移到「考试类型」树维护，左栏不再展示这两项，
     本页也再没有针对它们的表单分支。DICT_TYPES 仍保留 9 项 —— 机构端
     `/tenant/dict` 读的就是它，那份数据由考试类型树的投影刷新（见 mock/admin-store.ts）。 */
  ADMIN_DICT_TYPES,
  AppModal,
  appConfirm,
} from '@aiteach/shared'
import type { DictItem, DictTypeKey } from '@aiteach/shared'
import AppSwitch from '@/components/ui/AppSwitch.vue'
import { deleteDictItem, fetchDict, saveDictItem, toggleDictItem } from '@/api/platform'

const activeType = ref<DictTypeKey>('subject')
const typeMeta = computed(() => ADMIN_DICT_TYPES.find((item) => item.key === activeType.value)!)

/** 「名称」在各字典类型下的业务叫法不同（难度 = 等级名称，版权 = 展示文案） */
const NAME_LABELS: Partial<Record<DictTypeKey, string>> = { difficulty: '等级名称', copyright: '展示文案' }
const nameLabel = computed(() => NAME_LABELS[activeType.value] ?? '名称')

/** 需要「编码」列 / 表单项的字典类型（与 mock 侧 `CODE_TYPES` 同口径，改一处要改两处） */
const CODE_TYPES: DictTypeKey[] = ['subject', 'grade', 'questionType']
const hasCode = computed(() => CODE_TYPES.includes(activeType.value))

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

async function onDelete(item: DictItem) {
  if (!(await appConfirm(`确认删除「${item.name}」？删除前将校验机构引用。`, { type: 'danger' }))) return
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
const ANSWER_TYPES = ['选择', '填空', '连线', '解答']

const editing = ref<DictItem | 'new' | null>(null)
const form = reactive({
  name: '',
  code: '',
  /* 序号：列表按它升序展示，越小越靠前 */
  sort: 1,
  stage: '小学',
  year: '',
  termHalf: '上学期',
  dateFrom: '',
  dateTo: '',
  answerType: '选择',
  /* 适用学科（仅题型用）：空 = 全学科通用 */
  subjects: [] as string[],
  /* 适配年级（仅学科用）：空 = 不限年级 */
  grades: [] as string[],
  coefficient: 0.5,
})
const formError = ref('')
const saving = ref(false)

/**
 * el-date-picker 的 daterange 只认 `[起始, 结束]` 一个数组，而表单字段、保存参数、
 * 同学期重叠校验用的都是 `dateFrom` / `dateTo` 两个独立字符串。
 * 这里用一个可写 computed 做双向映射，两边就都不用改：空值统一成 `null`
 * （半截区间在 daterange 里是非法状态，落回未选更诚实）。
 */
const termRange = computed<string[] | null>({
  get: () => (form.dateFrom && form.dateTo ? [form.dateFrom, form.dateTo] : null),
  set: (value) => {
    form.dateFrom = value?.[0] ?? ''
    form.dateTo = value?.[1] ?? ''
  },
})

/** 适用学科候选项取自学科字典，与机构端下拉同一份口径 */
const subjectOptions = ref<string[]>([])
/** 适配年级候选项取自年级字典（`.name`），与机构端下拉同一份口径 */
const gradeOptions = ref<string[]>([])

async function loadSubjectOptions() {
  subjectOptions.value = (await fetchDict('subject')).map((item) => item.name)
}

async function loadGradeOptions() {
  gradeOptions.value = (await fetchDict('grade')).map((item) => item.name)
}

/* 学科名只在「题型」弹窗里用到、年级名只在「学科」弹窗里用到，
   进入对应类型时按需加载一次，不为其他类型多打请求 */
watch(
  activeType,
  (type) => {
    if (type === 'questionType' && !subjectOptions.value.length) {
      void loadSubjectOptions()
    }
    if (type === 'subject' && !gradeOptions.value.length) {
      void loadGradeOptions()
    }
  },
  { immediate: true },
)

/* 学段只有「年级」用（小学/初中/高中三选一，必填）。openEdit 无条件覆写 form.stage，
   所以初值必须在这里按类型给 —— 只改 reactive 里的声明是无效的。 */
function defaultStage() {
  return activeType.value === 'grade' ? '小学' : ''
}

function openCreate() {
  editing.value = 'new'
  form.name = ''
  form.code = ''
  /* 追加到末尾：取现有最大序号 + 1，而不是条数 + 1（序号可被改成任意 ≥1 的整数，会撞号） */
  form.sort = Math.max(0, ...list.value.map((item) => item.sort)) + 1
  form.stage = defaultStage()
  form.year = `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`
  form.termHalf = '上学期'
  form.dateFrom = ''
  form.dateTo = ''
  form.answerType = '选择'
  form.subjects = []
  form.grades = []
  form.coefficient = 0.5
  formError.value = ''
}

function openEdit(item: DictItem) {
  editing.value = item
  form.name = item.name
  form.code = item.code ?? ''
  form.sort = item.sort
  form.stage = item.stage ?? defaultStage()
  form.year = item.year ?? ''
  form.termHalf = item.termHalf ?? '上学期'
  form.dateFrom = item.dateFrom ?? ''
  form.dateTo = item.dateTo ?? ''
  form.answerType = item.answerType ?? '选择'
  form.subjects = [...(item.subjects ?? [])]
  form.grades = [...(item.grades ?? [])]
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
      sort: form.sort,
      code: hasCode.value ? form.code.trim() : undefined,
      /* 学段只有年级用，且必填 */
      stage: activeType.value === 'grade' ? form.stage : undefined,
      year: activeType.value === 'term' ? form.year.trim() : undefined,
      termHalf: activeType.value === 'term' ? form.termHalf : undefined,
      dateFrom: activeType.value === 'term' ? form.dateFrom : undefined,
      dateTo: activeType.value === 'term' ? form.dateTo : undefined,
      answerType: activeType.value === 'questionType' ? form.answerType : undefined,
      /* 不勾任何学科即全学科通用：传 undefined 而不是空数组，两种写法在字典里都表示「不限定」 */
      subjects:
        activeType.value === 'questionType' && form.subjects.length ? [...form.subjects] : undefined,
      /* 不勾任何年级即不限年级：传 undefined 而不是空数组，两种写法在字典里都表示「不限定」 */
      grades: activeType.value === 'subject' && form.grades.length ? [...form.grades] : undefined,
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
        v-for="item in ADMIN_DICT_TYPES"
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
      <div class="panel-tools">
        <AppListToolbar :searchable="false">
          <template #left>
            <span class="panel-hint">{{ typeMeta.title }} · {{ typeMeta.hint }}</span>
          </template>
          <template #right>
            <button class="btn btn-ghost btn-sm" @click="onImport">
              <AppIcon name="upload" :size="14" /> 批量导入
            </button>
            <button class="btn btn-ghost btn-sm" @click="onExport">
              <AppIcon name="download" :size="14" /> 导出
            </button>
            <button class="btn btn-primary btn-sm" @click="openCreate">
              <AppIcon name="plus" :size="15" /> 新增
            </button>
          </template>
        </AppListToolbar>
      </div>

      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th v-if="activeType === 'grade'">学段</th>
              <th v-if="activeType === 'term'">学年 / 学期</th>
              <th>{{ nameLabel }}</th>
              <th v-if="hasCode">编码</th>
              <th v-if="activeType === 'subject'">适配年级</th>
              <th v-if="activeType === 'term'">起止日期</th>
              <th v-if="activeType === 'questionType'">作答类型</th>
              <th v-if="activeType === 'questionType'">适用学科</th>
              <th v-if="activeType === 'difficulty'">系数</th>
              <th>序号</th>
              <th>状态</th>
              <th style="width: 200px">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading && list.length === 0">
              <td :colspan="9" class="empty-row">加载中…</td>
            </tr>
            <tr v-else-if="list.length === 0">
              <td :colspan="9" class="empty-row">暂无数据</td>
            </tr>
            <template v-else>
              <tr v-for="item in list" :key="item.id">
                <td v-if="activeType === 'grade'">{{ item.stage }}</td>
                <td v-if="activeType === 'term'">{{ item.year }} · {{ item.termHalf }}</td>
                <td class="cell-strong">{{ item.name }}</td>
                <td v-if="hasCode"><code class="code-chip">{{ item.code }}</code></td>
                <td v-if="activeType === 'subject'">
                  <span v-if="item.grades?.length">{{ item.grades.join('、') }}</span>
                  <span v-else class="ref-zero">不限</span>
                </td>
                <td v-if="activeType === 'term'">{{ item.dateFrom }} ~ {{ item.dateTo }}</td>
                <td v-if="activeType === 'questionType'">{{ item.answerType }}</td>
                <td v-if="activeType === 'questionType'">
                  <span v-if="item.subjects?.length">{{ item.subjects.join('、') }}</span>
                  <span v-else class="ref-zero">全学科</span>
                </td>
                <td v-if="activeType === 'difficulty'">{{ item.coefficient?.toFixed(1) }}</td>
                <td>{{ item.sort }}</td>
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
      <div v-if="editing !== 'new' && hasCode" class="f-field">
        <label class="f-label">编码（创建后不可修改）</label>
        <input v-model="form.code" class="f-input" disabled />
      </div>
      <div v-if="editing === 'new' && hasCode" class="f-field">
        <label class="f-label">编码<span class="req">*</span></label>
        <input v-model="form.code" class="f-input" placeholder="唯一，创建后不可改，如 MATH / G01 / QT01" />
      </div>
      <div v-if="activeType === 'subject'" class="f-field">
        <label class="f-label">适配年级（不勾选 = 不限年级）</label>
        <div class="subject-checks">
          <label v-for="grade in gradeOptions" :key="grade" class="check-item">
            <input v-model="form.grades" type="checkbox" :value="grade" />
            {{ grade }}
          </label>
        </div>
        <p class="f-hint">勾选后该学科只在机构端选到这些年级时出现，如「物理」只开在高中。</p>
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
      <div class="f-field">
        <label class="f-label">序号<span class="req">*</span></label>
        <input v-model.number="form.sort" class="f-input" type="number" min="1" step="1" />
        <p class="f-hint">列表按序号从小到大展示，越小越靠前。</p>
      </div>
      <div v-if="activeType === 'term'" class="f-field">
        <label class="f-label">起止日期<span class="req">*</span></label>
        <el-date-picker
          v-model="termRange"
          type="daterange"
          value-format="YYYY-MM-DD"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
        />
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
      <div v-if="activeType === 'questionType'" class="f-field">
        <label class="f-label">适用学科（不勾选 = 全学科通用）</label>
        <div class="subject-checks">
          <label v-for="subject in subjectOptions" :key="subject" class="check-item">
            <input v-model="form.subjects" type="checkbox" :value="subject" />
            {{ subject }}
          </label>
        </div>
        <p class="f-hint">勾选后该题型只在机构端选到这些学科时出现，如「完形填空 / 七选五 / 短文改错」只勾英语。</p>
      </div>
      <div v-if="activeType === 'difficulty'" class="f-field">
        <label class="f-label">难度系数（0 - 1.0，越小越难）<span class="req">*</span></label>
        <input v-model.number="form.coefficient" class="f-input" type="number" min="0" max="1" step="0.1" />
        <p class="f-hint">保留 1 位小数，越小越难，且不可与其他等级重复。</p>
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
.panel-tools { padding: 14px 18px 0; }
.panel-hint { font-size: 12.5px; color: var(--sub); }

.code-chip {
  font-family: 'SF Mono', Menlo, monospace;
  font-size: 12px;
  background: #f1f3f9;
  border-radius: 6px;
  padding: 2px 8px;
  color: #4b5568;
}
.ref-zero { color: var(--sub); }
/* 起止日期改用 el-date-picker（daterange）。宽度不能写在标签的 style 上：picker 的
   $attrs 最终落到内部的 ElPopper，而它声明了 inheritAttrs: false 且从不读 $attrs，
   内联 width 会被整个丢掉，控件就按组件库默认的 350px 渲染。只能从外面用 :deep() 选中
   真正的 .el-date-editor 元素（类名写全是为了压过组件库 .el-date-editor.el-input__wrapper
   那条 350px 的宽度规则，且不依赖样式注入顺序）。
   原来的 .date-row / .range-sep 已无调用方，删除 */
.f-field :deep(.el-date-editor.el-range-editor.el-input__wrapper) { width: 100%; }
.warn-hint { color: var(--warn); }
.subject-checks { display: flex; flex-wrap: wrap; gap: 6px 16px; }
.check-item { display: flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer; }
.form-err { font-size: 12px; color: var(--danger); margin: 4px 0; }
</style>
