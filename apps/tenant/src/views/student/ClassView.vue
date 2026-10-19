<script setup lang="ts">
/**
 * 班级与年级管理（T-08-01）+ 班级学生名单（T-08-02）。
 *
 * 列表 + 名册抽屉合在一页：班级是「壳」，点开看学生是老师最高频的动作，
 * 拆两个页面反而要多跳一次。名册直接复用学生档案接口按班过滤。
 *
 * 这一版把「新增 / 编辑」补成了教务口径的完整表单：校区、年级、班号、班主任、助教、
 * 任课教师、学科。三条设计取舍值得记一下：
 *
 * 1. **班级名称是「自动合成 + 可改」**：年级 + 班号先算出一个符合习惯的名字
 *    （高一 + 1 → 高一(1)班），老师改过之后就不再跟着年级 / 班号走 —— 否则
 *    「实验班」「竞赛班」这类自定义名字会被下一次联动悄悄覆盖。
 * 2. **学科跟着年级动态收窄**：候选来自基础字典的「学科」，字典里每科都带适配年级
 *    （化学从九年级起、物理从八年级起）。年级一换，已选但不适配的学科会被剔除，
 *    否则会出现「小学班级开设化学」这种一眼假的配置。
 * 3. **启停用做成状态列里的开关**：原来藏在操作列的文字按钮要「找到这一行 → 再找按钮」，
 *    而启停用是浏览列表时最想做的一个动作。约束不变（班里有学生不能停用），
 *    失败时开关不会翻过去 —— 状态永远以服务端返回为准，不在本地取反。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import {
  AppChipGroup,
  AppDrawer,
  AppFilterPanel,
  AppIcon,
  AppListToolbar,
  AppModal,
  AppPageHeader,
  AppPagination,
  AppSwitch,
  STUDENT_WARNING_TEXT,
  showToast,
} from '@aiteach/shared'
import type { ClassFormMeta, FilterRowDef, OrgClass, OrgStudent } from '@aiteach/shared'
import { fetchClassFormMeta, fetchClasses, fetchStudents, saveClass, toggleClass } from '@/api/student'

const meta = ref<ClassFormMeta | null>(null)
const classes = ref<OrgClass[]>([])
const loading = ref(true)

async function load() {
  loading.value = true
  const [metaData, classList] = await Promise.all([fetchClassFormMeta(), fetchClasses()])
  meta.value = metaData
  classes.value = classList
  loading.value = false
}

/* ================= 搜索与筛选 =================
   年级 / 学科候选都来自**基础字典**（平台端维护，机构端只读）：
   - 年级：字典配了多少就铺多少（即使机构当前没开班，也应能按年级筛）。
   - 学科：默认按「已选年级」收窄 —— 学科字典每科都带适配年级（`grades`），
     未限定年级的科目（语文/数学等）对全部年级开放；年级一变，不适配的已选学科会被清掉。 */

const keyword = ref('')
const filter = reactive({ grade: [] as string[], subject: [] as string[], status: [] as string[] })
const page = ref(1)
const PAGE_SIZE = 10

const STATUS_OPTIONS = ['启用', '停用']

const gradeOptions = computed(() => (meta.value?.grades ?? []).map((row) => row.name))
/* 学科按年级收窄：不选年级 → 全部学科；选了年级 → 该年级适配的学科 */
const subjectOptions = computed(() => {
  const grade = filter.grade[0] ?? ''
  return (meta.value?.subjects ?? [])
    .filter((item) => !item.grades.length || !grade || item.grades.includes(grade))
    .map((item) => item.name)
})

/* 搜索条件面板的行定义：交给共享的 AppFilterPanel 渲染，折叠 / 清空 / 汇总都由它管，
   页面不再自己拼筛选栏 —— 全站列表页的搜索条件形状必须一致 */
const filterRows = computed<FilterRowDef[]>(() => [
  { key: 'grade', label: '年级', options: gradeOptions.value, multiple: false, collapsible: true },
  { key: 'subject', label: '学科', options: subjectOptions.value, multiple: false, collapsible: true },
  { key: 'status', label: '状态', options: STATUS_OPTIONS, multiple: false },
])

/* 年级一换，已选学科可能已不在「该年级适配」的候选里：清掉，免得列表凭空变空 */
watch(() => filter.grade, () => {
  if (filter.subject.length && !subjectOptions.value.includes(filter.subject[0])) filter.subject = []
})

const filtered = computed(() => {
  const kw = keyword.value.trim()
  return classes.value.filter((row) => {
    /* 搜索框只认三个字段：班级名称 / 班主任 / 助教（学科与状态有专门的筛选项） */
    if (kw && !row.name.includes(kw) && !row.headTeacher.includes(kw) && !(row.assistant ?? '').includes(kw)) return false
    if (filter.grade.length && row.grade !== filter.grade[0]) return false
    if (filter.subject.length && !filter.subject.some((subject) => row.subjects.includes(subject))) return false
    if (filter.status.length && row.enabled !== (filter.status[0] === '启用')) return false
    return true
  })
})

const paged = computed(() => filtered.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE))

/* 条件变化后回到第 1 页：停在旧页码上会看到一张「明明有数据却空白」的表 */
watch([keyword, () => filter.grade, () => filter.subject, () => filter.status], () => {
  page.value = 1
})

/* ================= 班级新增 / 编辑 ================= */

interface ClassForm {
  id: number | null
  campus: string
  grade: string
  /** 班号（如「1」）：与年级一起合成班级名称 */
  classNo: string
  name: string
  /** 名称是否被手动改过：改过就不再自动覆盖 */
  nameTouched: boolean
  headTeacher: string
  assistant: string
  teachers: string[]
  subjects: string[]
  room: string
}

const editing = ref<ClassForm | null>(null)
const saving = ref(false)

/** 年级 + 班号 → 班级名称（高一 + 1 = 高一(1)班） */
function composeName(grade: string, classNo: string): string {
  const no = classNo.trim().replace(/^[(（]|[)）班]$/g, '')
  if (!grade) return no ? `${no}班` : ''
  return no ? `${grade}(${no})班` : `${grade}班`
}

/** 当前年级下可选的学科：字典里未限定年级的学科（语文 / 数学）对所有年级开放 */
const formSubjects = computed(() => {
  const grade = editing.value?.grade ?? ''
  return (meta.value?.subjects ?? [])
    .filter((item) => !item.grades.length || !grade || item.grades.includes(grade))
    .map((item) => item.name)
})

const teacherOptions = computed(() => (meta.value?.teachers ?? []).map((row) => row.name))
/* 助教候选去掉已选的班主任：同一个人同时是班主任和助教，八成是选错了 */
const assistantOptions = computed(() => teacherOptions.value.filter((name) => name !== editing.value?.headTeacher))

/**
 * 新增时的默认年级：优先取当前校区**已有班级**的年级。
 *
 * 字典里有 12 个年级（一年级到高三），直接取第一个会默认成「一年级」——
 * 高中机构每次新建班级都要先手动改年级，是个没必要的动作。
 */
function defaultGrade(campus: string): string {
  const firstOfCampus = classes.value.find((row) => row.campus === campus)?.grade
  return firstOfCampus ?? meta.value?.grades[0]?.name ?? ''
}

function openCreate() {
  const campus = meta.value?.defaultCampus ?? ''
  const grade = defaultGrade(campus)
  /* 同校区同年级的下一个班号：连着建 3 个班时不用自己数到几了 */
  editing.value = {
    id: null,
    campus,
    grade,
    classNo: nextClassNo(campus, grade),
    name: '',
    nameTouched: false,
    headTeacher: '',
    assistant: '',
    teachers: [],
    subjects: formSubjects.value.filter((name) => ['数学', '语文', '英语'].includes(name)),
    room: '',
  }
  editing.value.name = composeName(grade, editing.value.classNo)
}

function openEdit(row: OrgClass) {
  editing.value = {
    id: row.id,
    campus: row.campus,
    grade: row.grade,
    classNo: row.classNo ?? '',
    name: row.name,
    nameTouched: true,
    headTeacher: row.headTeacher,
    assistant: row.assistant ?? '',
    teachers: [...row.teachers],
    subjects: [...row.subjects],
    room: row.room ?? '',
  }
}

/** 下一个班号：取同校区同年级现有班号的最大值 +1（没有则从 1 开始） */
function nextClassNo(campus: string, grade: string): string {
  const used = classes.value
    .filter((row) => row.campus === campus && row.grade === grade)
    .map((row) => Number((row.classNo ?? row.name.replace(/[^0-9]/g, '')).replace(/[^0-9]/g, '')) || 0)
  return String(Math.max(0, ...used) + 1)
}

/* 年级 / 班号联动：没手改过名称就跟着变；同时剔除当前年级不适配的学科 */
watch(
  () => [editing.value?.grade, editing.value?.classNo],
  () => {
    const form = editing.value
    if (!form) return
    if (!form.nameTouched) form.name = composeName(form.grade, form.classNo)
    form.subjects = form.subjects.filter((name) => formSubjects.value.includes(name))
  },
)

/* 校区 / 年级变了，班号重新按新组合猜一个（仅新增时，编辑时班号是既成事实） */
watch(
  () => [editing.value?.campus, editing.value?.grade],
  () => {
    const form = editing.value
    if (!form || form.id != null) return
    form.classNo = nextClassNo(form.campus, form.grade)
  },
)

/** 编辑中的班级是否已有学生：有学生时校区 / 年级锁定（服务端同样会拦） */
const editingHasStudents = computed(() => {
  const id = editing.value?.id
  if (id == null) return false
  return (classes.value.find((row) => row.id === id)?.studentCount ?? 0) > 0
})

function onNameInput(value: string) {
  const form = editing.value
  if (!form) return
  form.name = value
  /* 清空即视为「恢复自动合成」：否则删完名字就再也联动不回来了 */
  form.nameTouched = value.trim().length > 0 && value !== composeName(form.grade, form.classNo)
}

async function submit() {
  const form = editing.value
  if (!form) return
  if (!form.campus) {
    showToast('请选择校区', 'error')
    return
  }
  if (!form.grade) {
    showToast('请选择年级', 'error')
    return
  }
  if (!form.name.trim()) {
    showToast('班级名称必填', 'error')
    return
  }
  if (!form.headTeacher) {
    showToast('请选择班主任', 'error')
    return
  }
  if (!form.subjects.length) {
    showToast('请至少选择一个学科', 'error')
    return
  }
  saving.value = true
  try {
    await saveClass({
      id: form.id ?? undefined,
      campus: form.campus,
      grade: form.grade,
      classNo: form.classNo || undefined,
      name: form.name.trim(),
      headTeacher: form.headTeacher,
      assistant: form.assistant || undefined,
      teachers: form.teachers,
      subjects: form.subjects,
      room: form.room || undefined,
    })
    editing.value = null
    showToast(form.id ? '班级已更新' : '班级已创建', 'success')
    await load()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '保存失败', 'error')
  } finally {
    saving.value = false
  }
}

/**
 * 启停用（状态列开关）。
 *
 * 失败时不做任何本地状态处理：`AppSwitch` 的取值来自 `row.enabled`，服务端没变，
 * 开关自然不会翻过去 —— 这正是我们要的「按不下去」，而不是先翻过去再翻回来。
 */
async function onToggle(row: OrgClass) {
  try {
    await toggleClass(row.id)
    await load()
    showToast(row.enabled ? '已停用（不能再给该班布置作业 / 考试）' : '已启用', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '操作失败', 'error')
  }
}

/* ================= 学生名册抽屉（T-08-02） ================= */

const rosterOf = ref<OrgClass | null>(null)
const roster = ref<OrgStudent[]>([])
const rosterLoading = ref(false)

async function openRoster(row: OrgClass) {
  rosterOf.value = row
  rosterLoading.value = true
  try {
    roster.value = await fetchStudents({ className: row.name })
  } finally {
    rosterLoading.value = false
  }
}

const rosterStats = computed(() => ({
  total: roster.value.length,
  risk: roster.value.filter((row) => row.warning === 'risk').length,
  watch: roster.value.filter((row) => row.warning === 'watch').length,
}))

onMounted(load)
</script>

<template>
  <div class="page">
    <AppPageHeader />

    <!-- 搜索条件：年级 / 学科 / 状态（沿用全站统一的筛选面板样式） -->
    <AppFilterPanel
      :rows="filterRows"
      :model-value="filter"
      @update:model-value="(next) => Object.assign(filter, next)"
    />

    <div class="panel">
      <!-- 工具条：左上搜索、右上新增按钮，同一行对齐 -->
      <div class="list-head">
        <AppListToolbar v-model="keyword" placeholder="搜索班级名称 / 班主任 / 助教" :search-width="260">
          <template #right>
            <button class="btn btn-primary btn-sm" @click="openCreate">
              <AppIcon name="plus" :size="14" /> 新增班级
            </button>
          </template>
        </AppListToolbar>
      </div>

      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>班级名称</th>
              <th>校区</th>
              <th>年级</th>
              <th>班主任</th>
              <th>助教</th>
              <th>任课教师</th>
              <th>开设学科</th>
              <th>学生数</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="10" class="empty-row">加载中…</td>
            </tr>
            <tr v-else-if="paged.length === 0">
              <td colspan="10" class="empty-row">{{ classes.length ? '没有符合条件的班级' : '暂无班级，点击右上角新增' }}</td>
            </tr>
            <template v-else>
              <tr v-for="row in paged" :key="row.id">
                <td class="cell-strong">
                  {{ row.name }}
                  <span v-if="row.room" class="cell-sub">{{ row.room }}</span>
                </td>
                <td>{{ row.campus }}</td>
                <td>{{ row.grade }}</td>
                <td>{{ row.headTeacher || '—' }}</td>
                <td>{{ row.assistant || '—' }}</td>
                <td>
                  <div class="chip-view">
                    <span v-for="name in row.teachers" :key="name" class="tag tag-gray">{{ name }}</span>
                    <span v-if="!row.teachers.length" class="muted">—</span>
                  </div>
                </td>
                <td>
                  <div class="chip-view">
                    <span v-for="subject in row.subjects" :key="subject" class="tag tag-blue">{{ subject }}</span>
                  </div>
                </td>
                <td>{{ row.studentCount }}</td>
                <!-- 状态列直接点开关（原「停用 / 启用」文字按钮已移除） -->
                <td>
                  <div class="status-cell">
                    <AppSwitch :model-value="row.enabled" @update:model-value="onToggle(row)" />
                    <span class="status-text" :class="{ off: !row.enabled }">{{ row.enabled ? '启用' : '停用' }}</span>
                  </div>
                </td>
                <td>
                  <div class="op-group">
                    <button class="mini-btn" @click="openRoster(row)">学生名单</button>
                    <button class="mini-btn" @click="openEdit(row)">编辑</button>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <AppPagination v-model:page="page" :total="filtered.length" :page-size="PAGE_SIZE" />
    </div>

    <!-- 学生名册抽屉 -->
    <AppDrawer
      v-if="rosterOf"
      :title="`${rosterOf.name} · 学生名单`"
      :subtitle="`${rosterOf.campus} · ${rosterOf.grade}${rosterOf.room ? ` · ${rosterOf.room}` : ''}`"
      :width="680"
      @close="rosterOf = null"
    >
      <div class="roster-stats">
        <span>在读 <b>{{ rosterStats.total }}</b> 人</span>
        <span>学习预警 <b class="risk-num">{{ rosterStats.risk }}</b> 人</span>
        <span>重点关注 <b class="watch-num">{{ rosterStats.watch }}</b> 人</span>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>学号</th>
            <th>姓名</th>
            <th>性别</th>
            <th>监护人</th>
            <th>知情同意</th>
            <th>学习预警</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="rosterLoading">
            <td colspan="6" class="empty-row">加载中…</td>
          </tr>
          <tr v-else-if="roster.length === 0">
            <td colspan="6" class="empty-row">该班暂无学生</td>
          </tr>
          <tr v-for="row in roster" :key="row.id">
            <td><code class="code-chip">{{ row.studentNo }}</code></td>
            <td class="cell-strong">{{ row.name }}</td>
            <td>{{ row.gender }}</td>
            <td>{{ row.guardianName }}</td>
            <td>
              <span
                class="tag"
                :class="row.consentStatus === 'granted' ? 'tag-green' : row.consentStatus === 'pending' ? 'tag-orange' : 'tag-red'"
              >
                {{ row.consentStatus === 'granted' ? '已同意' : row.consentStatus === 'pending' ? '待签署' : '已撤回' }}
              </span>
            </td>
            <td>
              <span class="tag" :class="row.warning === 'risk' ? 'tag-red' : row.warning === 'watch' ? 'tag-orange' : 'tag-gray'">
                {{ STUDENT_WARNING_TEXT[row.warning] }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </AppDrawer>

    <!-- 班级新增 / 编辑 -->
    <AppModal v-if="editing" :title="editing.id ? '编辑班级' : '新增班级'" :width="620" @close="editing = null">
      <div class="f-field row2">
        <div>
          <label class="f-label">校区<span class="req">*</span></label>
          <select v-model="editing.campus" class="f-select" :disabled="editingHasStudents">
            <option v-for="campus in meta?.campuses ?? []" :key="campus.code" :value="campus.name">{{ campus.name }}</option>
          </select>
          <p v-if="editingHasStudents" class="f-hint">班级下已有学生，校区与年级不可修改（需先转班）</p>
          <p v-else-if="editing.id == null" class="f-hint">默认取当前登录用户所在校区</p>
        </div>
        <div>
          <label class="f-label">年级<span class="req">*</span></label>
          <select v-model="editing.grade" class="f-select" :disabled="editingHasStudents">
            <option v-for="grade in meta?.grades ?? []" :key="grade.name" :value="grade.name">{{ grade.name }}</option>
          </select>
        </div>
      </div>

      <div class="f-field row2">
        <div>
          <label class="f-label">班级<span class="req">*</span></label>
          <input v-model="editing.classNo" class="f-input" placeholder="班号，如 1" maxlength="6" />
        </div>
        <div>
          <label class="f-label">班级名称<span class="req">*</span></label>
          <input :value="editing.name" class="f-input" placeholder="按年级 + 班级自动生成，可修改" @input="onNameInput(($event.target as HTMLInputElement).value)" />
          <p class="f-hint">改过之后不再跟随年级 / 班级联动</p>
        </div>
      </div>

      <div class="f-field row3">
        <div>
          <label class="f-label">班主任<span class="req">*</span></label>
          <select v-model="editing.headTeacher" class="f-select">
            <option value="">请选择</option>
            <option v-for="name in teacherOptions" :key="name" :value="name">{{ name }}</option>
          </select>
        </div>
        <div>
          <label class="f-label">助教</label>
          <select v-model="editing.assistant" class="f-select">
            <option value="">不设助教</option>
            <option v-for="name in assistantOptions" :key="name" :value="name">{{ name }}</option>
          </select>
        </div>
        <div>
          <label class="f-label">教室</label>
          <input v-model="editing.room" class="f-input" placeholder="如 教学楼 A304" />
        </div>
      </div>

      <div class="f-field">
        <label class="f-label">任课教师（可多选）</label>
        <AppChipGroup v-model="editing.teachers" :options="teacherOptions" placeholder="员工名单为空，请先在组织管理里添加员工" />
      </div>

      <div class="f-field">
        <label class="f-label">开设学科<span class="req">*</span></label>
        <AppChipGroup v-model="editing.subjects" :options="formSubjects" placeholder="该年级暂无可选学科" />
        <p class="f-hint">学科来自平台端基础字典，并按年级自动收窄（如化学仅在九年级及以上可选）</p>
      </div>

      <template #footer>
        <button class="btn btn-ghost" @click="editing = null">取消</button>
        <button class="btn btn-primary" :disabled="saving" @click="submit">{{ saving ? '保存中…' : '保存' }}</button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
/* 工具条嵌在面板顶部，表格保持满幅（贴面板边才能横向滚动）。
   与员工列表（StaffView）同一写法：间距由 AppListToolbar 自带的 margin 提供，不再覆盖 */
.list-head { padding: 14px 18px 0; }

.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.row3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
.status-cell { display: inline-flex; align-items: center; gap: 8px; }
.status-text { font-size: 12.5px; font-weight: 600; color: var(--success); }
.status-text.off { color: var(--sub); }
/* 班级名称 / 校区 / 年级这类短字段不折行：一旦折成「高\n一」整张表就没法读了，
   放不下时让表格横向滚动（data-table-wrap 本来就支持） */
.data-table :deep(td),
.data-table :deep(th) { white-space: nowrap; }
.chip-view { display: flex; flex-wrap: wrap; gap: 4px; max-width: 190px; }
.cell-sub { display: block; font-size: 11.5px; color: var(--sub); font-weight: 400; margin-top: 2px; }
.code-chip {
  font-family: 'SF Mono', Menlo, monospace;
  font-size: 12px; color: var(--brand-deep);
  background: var(--brand-soft); border-radius: 6px; padding: 2px 8px;
}
.roster-stats {
  display: flex; gap: 20px; margin-bottom: 12px; font-size: 13px; color: var(--sub);
}
.roster-stats b { font-size: 16px; color: var(--text); }
.risk-num { color: #d94f43; }
.watch-num { color: #d9822b; }
.muted { color: var(--sub); font-size: 12px; }
</style>
