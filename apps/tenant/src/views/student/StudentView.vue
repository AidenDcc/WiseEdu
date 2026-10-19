<script setup lang="ts">
/**
 * 学生档案管理（T-08-03 ~ 06）。
 *
 * 这一版把「知情同意」并入了档案详情，页面因此不再分页签：
 *
 * - 学生档案：列表（手机号默认脱敏，T-08-04 最小化收集）+ 新增 / 编辑 / Excel 批量导入
 *   + 详情抽屉（基本信息、监护人、知情同意、画像标签）；
 * - 知情同意：原来是一个独立页签的表格，现在收进详情抽屉 —— 同意记录是「一个学生的属性」，
 *   单独铺一张全机构表格既看不到上下文，又要多一次「按学生名找行」的对齐动作。
 *   抽屉里可预览归档 PDF、查看签名文字、补签与撤回（撤回后 AI 学情能力对该生停用）。
 *
 * 新增学生时学号自动生成、校区默认取当前登录用户所在校区、年级与班级按校区级联 ——
 * 三条都对应真实录入时最常错的地方：手工编号会重、跨校区选班会把学生挂错校区。
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
  CONSENT_STATUS_TEXT,
  STUDENT_WARNING_TEXT,
  appConfirm,
  showToast,
} from '@aiteach/shared'
import type { FilterRowDef } from '@aiteach/shared'
import type { ClassFormMeta, ConsentRecord, OrgClass, OrgStudent, StudentImportResult } from '@aiteach/shared'
import {
  deleteStudent,
  fetchClassFormMeta,
  fetchClasses,
  fetchConsentOfStudent,
  fetchNextStudentNo,
  fetchOrgSettings,
  fetchStudentDetail,
  fetchStudents,
  saveStudent,
  signConsent,
  withdrawConsent,
} from '@/api/student'
import { CONSENT_SCOPE_DETAILS } from '@/utils/consent-pdf'
import StudentImportModal from './components/StudentImportModal.vue'
import ConsentPdfModal from './components/ConsentPdfModal.vue'

const meta = ref<ClassFormMeta | null>(null)
const classes = ref<OrgClass[]>([])
const students = ref<OrgStudent[]>([])
const orgName = ref('')
const loading = ref(true)

/**
 * 列表一次取全量、本地筛选与分页。
 *
 * 机构的学生量级在千级以内，筛选项点一下就发一次请求反而卡顿（mock 有 200-600ms 延迟）；
 * 接真实后端时可以原样把 `filter` 传给 `fetchStudents` —— 参数与接口契约同构，
 * 只是把「本地过滤」换成「带上 query 再取一页」。
 */
async function load() {
  loading.value = true
  const [metaData, classList, studentList, settings] = await Promise.all([
    fetchClassFormMeta(),
    fetchClasses(),
    fetchStudents(),
    fetchOrgSettings(),
  ])
  meta.value = metaData
  classes.value = classList
  students.value = studentList
  orgName.value = settings.name
  loading.value = false
}

/* ================= 搜索与筛选 ================= */

const keyword = ref('')
const filter = reactive({
  campus: [] as string[],
  grade: [] as string[],
  className: [] as string[],
  consentStatus: [] as string[],
  warning: [] as string[],
})
const page = ref(1)
const PAGE_SIZE = 10

const campusOptions = computed(() => [...new Set(classes.value.map((row) => row.campus))])
const gradeOptions = computed(() => [...new Set(classes.value.map((row) => row.grade))])
/** 班级候选随校区 / 年级收窄：选了「东湖校区 · 高二」就不该出现本部的班 */
const classNameOptions = computed(() =>
  classes.value
    .filter((row) => !filter.campus.length || row.campus === filter.campus[0])
    .filter((row) => !filter.grade.length || row.grade === filter.grade[0])
    .map((row) => row.name),
)

const filterRows = computed<FilterRowDef[]>(() => [
  { key: 'campus', label: '校区', options: campusOptions.value, multiple: false },
  { key: 'grade', label: '年级', options: gradeOptions.value, multiple: false },
  { key: 'className', label: '班级', options: classNameOptions.value, multiple: false, collapsible: true },
  {
    key: 'consentStatus',
    label: '知情同意',
    options: ['granted', 'pending', 'withdrawn'],
    optionLabels: CONSENT_STATUS_TEXT as Record<string, string>,
    multiple: false,
  },
  { key: 'warning', label: '预警', options: ['none', 'watch', 'risk'], optionLabels: STUDENT_WARNING_TEXT as Record<string, string>, multiple: false },
])

/* 校区 / 年级一改，已选的班级可能已经不在候选里了：清掉，免得列表「凭空」变空 */
watch([() => filter.campus, () => filter.grade], () => {
  if (filter.className.length && !classNameOptions.value.includes(filter.className[0])) filter.className = []
})

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return students.value.filter((row) => {
    if (kw && !row.name.toLowerCase().includes(kw) && !row.studentNo.includes(kw) && !row.guardianName.toLowerCase().includes(kw)) return false
    if (filter.campus.length && row.campus !== filter.campus[0]) return false
    if (filter.grade.length && row.grade !== filter.grade[0]) return false
    if (filter.className.length && row.className !== filter.className[0]) return false
    if (filter.consentStatus.length && row.consentStatus !== filter.consentStatus[0]) return false
    if (filter.warning.length && row.warning !== filter.warning[0]) return false
    return true
  })
})

const paged = computed(() => filtered.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE))

watch([keyword, () => filter.campus, () => filter.grade, () => filter.className, () => filter.consentStatus, () => filter.warning], () => {
  page.value = 1
})

/* ================= 详情抽屉 ================= */

const detail = ref<OrgStudent | null>(null)
const detailConsent = ref<ConsentRecord | null>(null)
const detailLoading = ref(false)

async function openDetail(row: OrgStudent) {
  detail.value = row
  detailConsent.value = null
  detailLoading.value = true
  try {
    /* 列表里的手机号是脱敏的，详情要看全量 —— 这是「最小化收集」的另一半：
       列表脱敏、详情按权限看全量，两处不能共用同一份数据 */
    const [full, consent] = await Promise.all([fetchStudentDetail(row.id), fetchConsentOfStudent(row.id)])
    detail.value = full
    detailConsent.value = consent
  } finally {
    detailLoading.value = false
  }
}

/** 同意书 PDF 预览目标（需要学生全量信息 + 同意记录） */
const pdfTarget = ref<{ student: OrgStudent; record: ConsentRecord } | null>(null)

function openPdf() {
  if (!detail.value || !detailConsent.value) {
    showToast('该学生暂无知情同意记录', 'error')
    return
  }
  pdfTarget.value = { student: detail.value, record: detailConsent.value }
}

/* ================= 新增 / 编辑 ================= */

interface StudentForm {
  id: number | null
  campus: string
  grade: string
  className: string
  name: string
  studentNo: string
  gender: '男' | '女'
  guardianName: string
  guardianPhone: string
}

const editing = ref<StudentForm | null>(null)
const saving = ref(false)
const noLoading = ref(false)

/** 表单里的年级候选：只列该校区**已有班级**的年级（没有班的年级选了也没法落班） */
const formGrades = computed(() => {
  const campus = editing.value?.campus
  return [...new Set(classes.value.filter((row) => !campus || row.campus === campus).map((row) => row.grade))]
})

/** 表单里的班级候选：校区 + 年级双重收窄（只能选到对应校区的年级班级） */
const formClasses = computed(() => {
  const form = editing.value
  if (!form) return [] as OrgClass[]
  return classes.value.filter((row) => row.campus === form.campus && row.grade === form.grade && row.enabled)
})

async function refreshStudentNo() {
  const form = editing.value
  if (!form || !form.className) {
    if (form) form.studentNo = ''
    return
  }
  noLoading.value = true
  try {
    const { studentNo } = await fetchNextStudentNo(form.className)
    if (form.id == null) form.studentNo = studentNo
  } finally {
    noLoading.value = false
  }
}

function openCreate() {
  const campus = meta.value?.defaultCampus || classes.value[0]?.campus || ''
  const grade = classes.value.find((row) => row.campus === campus)?.grade ?? ''
  const cls = classes.value.find((row) => row.campus === campus && row.grade === grade && row.enabled)
  editing.value = {
    id: null,
    campus,
    grade,
    className: cls?.name ?? '',
    name: '',
    studentNo: '',
    gender: '男',
    guardianName: '',
    guardianPhone: '',
  }
  void refreshStudentNo()
}

function openEdit(row: OrgStudent) {
  editing.value = {
    id: row.id,
    campus: row.campus,
    grade: row.grade,
    className: row.className,
    name: row.name,
    studentNo: row.studentNo,
    gender: row.gender,
    guardianName: row.guardianName,
    guardianPhone: row.guardianPhone,
  }
}

/* 校区 → 年级 → 班级 的三级联动：上一级一改，下面两级的失效值就地纠正 */
watch(
  () => editing.value?.campus,
  () => {
    const form = editing.value
    if (!form || form.id != null) return
    if (!formGrades.value.includes(form.grade)) form.grade = formGrades.value[0] ?? ''
    if (!formClasses.value.some((row) => row.name === form.className)) {
      form.className = formClasses.value[0]?.name ?? ''
    }
    void refreshStudentNo()
  },
)
watch(
  () => editing.value?.grade,
  () => {
    const form = editing.value
    if (!form || form.id != null) return
    if (!formClasses.value.some((row) => row.name === form.className)) {
      form.className = formClasses.value[0]?.name ?? ''
    }
    void refreshStudentNo()
  },
)

async function submit() {
  const form = editing.value
  if (!form) return
  if (!form.name.trim()) {
    showToast('学生姓名必填', 'error')
    return
  }
  if (!form.className) {
    showToast('请选择班级', 'error')
    return
  }
  if (form.guardianPhone && !/^1\d{10}$/.test(form.guardianPhone)) {
    showToast('监护人手机号格式不正确', 'error')
    return
  }
  saving.value = true
  try {
    await saveStudent({
      id: form.id ?? undefined,
      name: form.name.trim(),
      studentNo: form.studentNo,
      className: form.className,
      gender: form.gender,
      guardianName: form.guardianName,
      guardianPhone: form.guardianPhone,
    })
    editing.value = null
    showToast(form.id ? '学生档案已更新' : '学生已创建，知情同意待签署', 'success')
    await load()
    /* 正在看详情时改完档案：把抽屉里的数据也刷新一遍，否则要关掉重开才看到新值 */
    if (detail.value) {
      const target = students.value.find((row) => row.id === detail.value!.id)
      if (target) await openDetail(target)
    }
  } catch (error) {
    showToast(error instanceof Error ? error.message : '保存失败', 'error')
  } finally {
    saving.value = false
  }
}

async function onDelete(row: OrgStudent) {
  if (!(await appConfirm(`删除学生「${row.name}」的档案？相关学情数据与同意记录将一并清除。`, { type: 'danger' }))) return
  try {
    await deleteStudent(row.id)
    if (detail.value?.id === row.id) detail.value = null
    showToast('已删除', 'success')
    await load()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '删除失败', 'error')
  }
}

/* ================= 知情同意补签 / 撤回 ================= */

const signing = ref<null | { id: number; studentName: string; scopes: string[]; signature: string }>(null)

function openSign(record: ConsentRecord, studentName: string) {
  /* 授权范围**不预勾选**：同意书的法律效力就建立在「监护人自己勾了什么」上，
     替他先勾好前两项，等于机构替他做了授权决定。已签过的（改范围）才回填原值。 */
  signing.value = {
    id: record.id,
    studentName,
    scopes: record.scopes.length ? [...record.scopes] : [],
    signature: record.signature ?? '',
  }
}

async function submitSign() {
  const target = signing.value
  if (!target) return
  if (!target.scopes.length) {
    showToast('请至少勾选一项授权范围', 'error')
    return
  }
  if (!target.signature.trim()) {
    showToast('请填写监护人签名', 'error')
    return
  }
  try {
    await signConsent(target.id, target.scopes, target.signature.trim())
    signing.value = null
    showToast('已记录监护人同意，同意书可预览下载', 'success')
    await load()
    if (detail.value) await openDetail(detail.value)
  } catch (error) {
    showToast(error instanceof Error ? error.message : '操作失败', 'error')
  }
}

async function onWithdraw(record: ConsentRecord) {
  if (!(await appConfirm(`撤回「${record.studentName}」监护人的知情同意？撤回后 AI 学情与个性化推送将对该生停用。`, { type: 'warning' }))) return
  try {
    await withdrawConsent(record.id)
    showToast('已撤回', 'success')
    await load()
    if (detail.value) await openDetail(detail.value)
  } catch (error) {
    showToast(error instanceof Error ? error.message : '操作失败', 'error')
  }
}

function consentTag(status: ConsentRecord['status']) {
  return status === 'granted' ? 'tag-green' : status === 'pending' ? 'tag-orange' : 'tag-red'
}

/* ================= Excel 批量导入 ================= */

const importOpen = ref(false)

function onImported(result: StudentImportResult) {
  showToast(`导入完成：成功 ${result.successCount} 条，失败 ${result.failCount} 条`, result.failCount ? 'error' : 'success')
  void load()
}

onMounted(load)
</script>

<template>
  <div class="page">
    <AppPageHeader />

    <!-- 搜索条件：校区 / 年级 / 班级 / 知情同意 / 预警 -->
    <AppFilterPanel
      :rows="filterRows"
      :model-value="filter"
      @update:model-value="(next) => Object.assign(filter, next)"
    />

    <div class="panel">
      <div class="list-head">
        <AppListToolbar v-model="keyword" placeholder="搜索姓名 / 学号 / 监护人" :search-width="240">
          <template #right>
            <button class="btn btn-ghost btn-sm" @click="importOpen = true">
              <AppIcon name="upload" :size="14" /> 批量导入
            </button>
            <button class="btn btn-primary btn-sm" @click="openCreate">
              <AppIcon name="plus" :size="14" /> 新增学生
            </button>
          </template>
        </AppListToolbar>
      </div>

      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>学号</th>
              <th>姓名</th>
              <th>校区</th>
              <th>年级</th>
              <th>班级</th>
              <th>监护人 / 手机</th>
              <th>知情同意</th>
              <th>画像标签</th>
              <th>预警</th>
              <th class="col-op">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="10" class="empty-row">加载中…</td>
            </tr>
            <tr v-else-if="paged.length === 0">
              <td colspan="10" class="empty-row">{{ students.length ? '没有符合条件的学生' : '暂无学生，点击右上角新增或批量导入' }}</td>
            </tr>
            <template v-else>
              <tr v-for="row in paged" :key="row.id">
                <td><code class="code-chip">{{ row.studentNo }}</code></td>
                <td class="cell-strong">
                  {{ row.name }}
                  <span class="cell-sub">{{ row.gender }}</span>
                </td>
                <td>{{ row.campus }}</td>
                <td>{{ row.grade }}</td>
                <td>{{ row.className }}</td>
                <td>
                  {{ row.guardianName }}
                  <span class="cell-sub mono">{{ row.guardianPhone }}</span>
                </td>
                <td><span class="tag" :class="consentTag(row.consentStatus)">{{ CONSENT_STATUS_TEXT[row.consentStatus] }}</span></td>
                <td>
                  <div class="tag-row">
                    <span v-for="tag in row.tags.slice(0, 2)" :key="tag" class="tag tag-blue">{{ tag }}</span>
                    <span v-if="row.tags.length > 2" class="tag tag-gray">+{{ row.tags.length - 2 }}</span>
                    <span v-if="!row.tags.length" class="muted">—</span>
                  </div>
                </td>
                <td>
                  <span class="tag" :class="row.warning === 'risk' ? 'tag-red' : row.warning === 'watch' ? 'tag-orange' : 'tag-gray'">
                    {{ STUDENT_WARNING_TEXT[row.warning] }}
                  </span>
                </td>
                <td class="col-op">
                  <div class="op-group">
                    <button class="mini-btn" @click="openDetail(row)">详情</button>
                    <button class="mini-btn" @click="openEdit(row)">编辑</button>
                    <button class="mini-btn danger" @click="onDelete(row)">删除</button>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <AppPagination v-model:page="page" :total="filtered.length" :page-size="PAGE_SIZE" />
    </div>

    <!-- 学生详情（含知情同意） -->
    <AppDrawer
      v-if="detail"
      :title="`${detail.name} · 学生档案`"
      :subtitle="`${detail.campus} · ${detail.className} · ${detail.studentNo}`"
      :width="620"
      @close="detail = null"
    >
      <div class="detail-tags">
        <span class="tag" :class="consentTag(detail.consentStatus)">{{ CONSENT_STATUS_TEXT[detail.consentStatus] }}</span>
        <span class="tag" :class="detail.warning === 'risk' ? 'tag-red' : detail.warning === 'watch' ? 'tag-orange' : 'tag-gray'">
          {{ STUDENT_WARNING_TEXT[detail.warning] }}
        </span>
        <span class="tag tag-gray">{{ detail.status }}</span>
      </div>

      <div class="detail-grid">
        <div class="detail-item"><span>学号</span><b class="mono">{{ detail.studentNo }}</b></div>
        <div class="detail-item"><span>性别</span><b>{{ detail.gender }}</b></div>
        <div class="detail-item"><span>校区</span><b>{{ detail.campus }}</b></div>
        <div class="detail-item"><span>年级班级</span><b>{{ detail.grade }} · {{ detail.className }}</b></div>
        <div class="detail-item"><span>入学日期</span><b>{{ detail.enrolledAt }}</b></div>
        <div class="detail-item"><span>最近统考分</span><b>{{ detail.lastScore ?? '—' }}</b></div>
        <div class="detail-item"><span>监护人</span><b>{{ detail.guardianName }}（{{ detailConsent?.relation ?? '—' }}）</b></div>
        <div class="detail-item"><span>监护人手机</span><b class="mono">{{ detail.guardianPhone }}</b></div>
      </div>

      <!-- 知情同意：原独立页签，现并入详情 -->
      <div class="detail-section">
        <div class="section-head">
          <h4>知情同意</h4>
          <div class="op-group">
            <button class="mini-btn" :disabled="detailLoading || !detailConsent" @click="openPdf">
              <AppIcon name="pdf" :size="14" /> 预览同意书
            </button>
            <button
              v-if="detailConsent && detailConsent.status !== 'granted'"
              class="mini-btn"
              @click="openSign(detailConsent, detail.name)"
            >
              补签
            </button>
            <button
              v-if="detailConsent && detailConsent.status === 'granted'"
              class="mini-btn danger"
              @click="onWithdraw(detailConsent)"
            >
              撤回
            </button>
          </div>
        </div>

        <p v-if="detailLoading" class="muted">正在读取同意记录…</p>
        <p v-else-if="!detailConsent" class="muted">该学生暂无同意记录，可点击「补签」发起。</p>
        <template v-else>
          <div class="consent-grid">
            <div class="detail-item"><span>状态</span><b><span class="tag" :class="consentTag(detailConsent.status)">{{ CONSENT_STATUS_TEXT[detailConsent.status] }}</span></b></div>
            <div class="detail-item"><span>同意书版本</span><b>{{ detailConsent.docVersion }}</b></div>
            <div class="detail-item"><span>签署渠道</span><b>{{ detailConsent.channel ?? '—' }}</b></div>
            <div class="detail-item"><span>签署时间</span><b class="mono">{{ detailConsent.signedAt ?? '—' }}</b></div>
            <div v-if="detailConsent.withdrawnAt" class="detail-item"><span>撤回时间</span><b class="mono">{{ detailConsent.withdrawnAt }}</b></div>
            <div class="detail-item signature-item">
              <span>监护人签名</span>
              <b v-if="detailConsent.signature" class="signature-text">{{ detailConsent.signature }}</b>
              <b v-else class="muted">未签署</b>
            </div>
          </div>

          <p class="sub-label">授权范围</p>
          <div class="tag-row">
            <span v-for="scope in detailConsent.scopes" :key="scope" class="tag tag-green">{{ scope }}</span>
            <span v-if="!detailConsent.scopes.length" class="muted">未授权任何 AI 数据处理范围</span>
          </div>
        </template>
      </div>

      <div class="detail-section">
        <h4>画像标签（AI 学情）</h4>
        <div class="tag-row">
          <span v-for="tag in detail.tags" :key="tag" class="tag tag-blue">{{ tag }}</span>
          <span v-if="!detail.tags.length" class="muted">暂无</span>
        </div>
      </div>

      <p class="privacy-note">
        按《未成年人个人信息保护》要求：学生照片与作答图片不作他用、按留存策略清理；撤回同意后 AI 学情能力对该生即时停用。
      </p>
    </AppDrawer>

    <!-- 新增 / 编辑学生 -->
    <AppModal v-if="editing" :title="editing.id ? '编辑学生' : '新增学生'" :width="560" @close="editing = null">
      <div class="f-field row2">
        <div>
          <label class="f-label">姓名<span class="req">*</span></label>
          <input v-model="editing.name" class="f-input" placeholder="学生姓名" />
        </div>
        <div>
          <label class="f-label">学号</label>
          <input :value="editing.studentNo || (noLoading ? '生成中…' : '')" class="f-input" disabled placeholder="按班级顺序自动生成" />
          <p class="f-hint">学号由系统按「年份 + 班级 + 班内序号」自动生成，创建后不可修改</p>
        </div>
      </div>

      <div class="f-field row3">
        <div>
          <label class="f-label">校区<span class="req">*</span></label>
          <select v-model="editing.campus" class="f-select" :disabled="editing.id != null">
            <option v-for="campus in meta?.campuses ?? []" :key="campus.code" :value="campus.name">{{ campus.name }}</option>
          </select>
        </div>
        <div>
          <label class="f-label">年级<span class="req">*</span></label>
          <select v-model="editing.grade" class="f-select" :disabled="editing.id != null">
            <option v-for="grade in formGrades" :key="grade" :value="grade">{{ grade }}</option>
          </select>
        </div>
        <div>
          <label class="f-label">班级<span class="req">*</span></label>
          <select v-model="editing.className" class="f-select" @change="refreshStudentNo">
            <option v-for="cls in formClasses" :key="cls.id" :value="cls.name">{{ cls.name }}</option>
          </select>
        </div>
      </div>
      <p class="f-hint" style="margin: -8px 0 14px">年级与班级只列出所选校区开设的班级；转班请直接修改班级（档案会记为转班）。</p>

      <div class="f-field row2">
        <div>
          <label class="f-label">性别</label>
          <select v-model="editing.gender" class="f-select">
            <option value="男">男</option>
            <option value="女">女</option>
          </select>
        </div>
        <div>
          <label class="f-label">监护人姓名</label>
          <input v-model="editing.guardianName" class="f-input" placeholder="选填" />
        </div>
      </div>
      <div class="f-field">
        <label class="f-label">监护人手机</label>
        <input v-model="editing.guardianPhone" class="f-input" placeholder="11 位手机号（用于签署通知）" maxlength="11" />
      </div>

      <template #footer>
        <button class="btn btn-ghost" @click="editing = null">取消</button>
        <button class="btn btn-primary" :disabled="saving" @click="submit">{{ saving ? '保存中…' : '保存' }}</button>
      </template>
    </AppModal>

    <!-- 补签知情同意 -->
    <AppModal v-if="signing" :title="`补签知情同意 · ${signing.studentName}`" :width="480" @close="signing = null">
      <p class="sign-note">请确认监护人已阅读《学生个人信息保护与 AI 学情分析知情同意书》并勾选授权范围（至少一项）：</p>
      <AppChipGroup v-model="signing.scopes" :options="CONSENT_SCOPE_DETAILS.map((row) => row.name)" />
      <div class="f-field" style="margin-top: 16px">
        <label class="f-label">监护人签名<span class="req">*</span></label>
        <input v-model="signing.signature" class="f-input sign-input" placeholder="请填写监护人姓名作为电子签名" maxlength="20" />
        <p class="f-hint">签名文字会写入同意书 PDF 的签署区，与授权范围、签署时间一并留档</p>
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="signing = null">取消</button>
        <button class="btn btn-primary" @click="submitSign">确认签署</button>
      </template>
    </AppModal>

    <!-- 知情同意书 PDF -->
    <ConsentPdfModal
      v-if="pdfTarget"
      :record="pdfTarget.record"
      :student="pdfTarget.student"
      :org-name="orgName"
      @close="pdfTarget = null"
    />

    <!-- Excel 批量导入 -->
    <StudentImportModal v-if="importOpen" :meta="meta" :classes="classes" @close="importOpen = false" @imported="onImported" />
  </div>
</template>

<style scoped>
.list-head { padding: 14px 18px 0; }
/* 学号 / 校区 / 班级这类短字段不折行：折成「本\n部\n校\n区」整张表就没法读了，
   放不下时让 data-table-wrap 横向滚动（全局已有 overflow-x: auto） */
.data-table :deep(td),
.data-table :deep(th) { white-space: nowrap; }
/* 画像标签最多两枚，给个上限避免长标签把表格撑爆 */
.tag-row { display: flex; flex-wrap: nowrap; gap: 4px; max-width: 190px; overflow: hidden; }
/* 操作列贴住右侧，横向滚动时不用来回找 */
.col-op { position: sticky; right: 0; background: var(--card); }
.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.row3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.code-chip {
  font-family: 'SF Mono', Menlo, monospace;
  font-size: 12px; color: var(--brand-deep);
  background: var(--brand-soft); border-radius: 6px; padding: 2px 8px;
}
.cell-strong { font-weight: 600; }
.cell-sub { display: block; font-size: 11.5px; color: var(--sub); font-weight: 400; margin-top: 2px; }
.mono { font-family: 'SF Mono', Menlo, monospace; font-size: 12px; }
.muted { color: var(--sub); font-size: 12px; }

.detail-tags { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 16px; }
.detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 20px; margin-bottom: 18px; }
.detail-item { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--sub); }
.detail-item b { font-size: 14px; color: var(--ink); font-weight: 600; }

.detail-section {
  border-top: 1px dashed var(--border);
  padding-top: 14px;
  margin-bottom: 16px;
}
.detail-section h4 { font-size: 13px; margin: 0 0 10px; display: flex; align-items: center; gap: 8px; }
.section-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.section-head h4 { margin: 0; }

.consent-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 20px; margin-bottom: 12px; }
.signature-item { grid-column: 1 / -1; }
.signature-text {
  font-family: 'Kaiti SC', 'STKaiti', 'KaiTi', serif;
  font-size: 22px !important;
  color: #0b3d91 !important;
  line-height: 1.2;
  letter-spacing: 1px;
}
.sub-label { font-size: 12px; color: var(--sub); margin: 0 0 6px; }

.privacy-note {
  margin-top: 8px; padding: 10px 12px; border-radius: 8px;
  background: #fff7ed; color: #92600a; font-size: 12px; line-height: 1.7;
}
.sign-note { font-size: 13px; color: var(--sub); margin-bottom: 12px; line-height: 1.7; }
.sign-input {
  font-family: 'Kaiti SC', 'STKaiti', 'KaiTi', serif;
  font-size: 20px;
  letter-spacing: 2px;
}
</style>
