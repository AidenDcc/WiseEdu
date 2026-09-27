<script setup lang="ts">
/**
 * 集体备课（协同教研）。
 *
 * 列表与任务工作台合在一个路由里（列表用 `/prep`，`?id=` 进入任务工作台）。
 * 任务工作台承接三件事：左栏成员分工与提交状态、中栏可版本化的备课正文、右栏研讨记录与版本线——
 * 与协同组卷任务台的信息密度与排版对齐（见 CollabTaskView）。
 *
 * 备课正文不单独落库，只以「版本快照」形式持久化（addPrepVersion 的 snapshot 传正文 JSON 字符串），
 * 因此中栏正文即「最新一版的正文」；撤销 / 替换都把接口返回的 snapshot 写回中栏。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AppFilterPanel,
  AppIcon,
  AppListToolbar,
  AppPageHeader,
  PREP_TASK_STATUS_TEXT,
  TEACH_KIND_TEXT,
  showToast,
  truncateRich,
} from '@aiteach/shared'
import type { FilterRowDef, PrepMember, PrepTask, StaffMember, TeachDoc, TeachDocKind } from '@aiteach/shared'
import AppModal from '@/components/ui/AppModal.vue'
import AppPagination from '@/components/ui/AppPagination.vue'
import RichTextEditor from '@/components/ui/RichTextEditor.vue'
import {
  addPrepComment,
  addPrepVersion,
  deletePrepComment,
  deletePrepTask,
  fetchPrepTask,
  fetchPrepTasks,
  fetchStaff,
  fetchTeachDocs,
  finalizePrepTask,
  replacePrepVersion,
  revertPrepVersion,
  savePrepTask,
  submitPrepDuty,
} from '@/api/org'
import { useBaseData } from '@/composables/useBaseData'

const route = useRoute()
const router = useRouter()
const { subjects, grades, ensure, pick } = useBaseData()

const errMsg = (e: unknown) => (e instanceof Error ? e.message : '操作失败')

const taskId = computed(() => Number(route.query.id ?? 0))
const tasks = ref<PrepTask[]>([])
const task = ref<PrepTask | null>(null)
const loading = ref(true)
const busy = ref(false)

/* 当前身份（演示用下拉切换：真实场景由登录态决定） */
const activeName = ref('')

/* 中栏正文（最新一版快照） */
const content = ref('')
const versionSummary = ref('')

const DOC_KINDS: TeachDocKind[] = ['lecture', 'courseware', 'plan', 'guide']
const DUTY_OPTIONS = ['教学目标', '过程设计', '例题选取', '作业设计', '研讨评课']

const PREP_MEMBER_TEXT: Record<PrepMember['status'], string> = {
  pending: '待接受',
  working: '撰写中',
  submitted: '已提交',
}

/** 接口返回的 snapshot 是「正文 JSON 字符串」：约定用 JSON 包裹 HTML，兜底兼容纯 HTML 种子 */
function parseSnapshot(s?: string): string {
  if (!s) return ''
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}
function latestSnapshot(t: PrepTask): string {
  const vs = [...t.versions].sort((a, b) => b.no - a.no)
  return parseSnapshot(vs[0]?.snapshot)
}

/* ================= 列表 ================= */
const filter = reactive({ subject: '', grade: '', status: '', keyword: '' })
const page = ref(1)
const filtered = computed(() =>
  tasks.value.filter(
    (row) =>
      (!filter.subject || row.subject === filter.subject) &&
      (!filter.grade || row.grade === filter.grade) &&
      (!filter.status || row.status === filter.status) &&
      (!filter.keyword || row.name.includes(filter.keyword) || (row.requirement.topic ?? '').includes(filter.keyword)),
  ),
)
const rows = computed(() => filtered.value.slice((page.value - 1) * 9, page.value * 9))

/* 筛选：chip 上显示的是文案，filter 里仍存业务值 */
const PREP_FILTER_ROWS = computed<FilterRowDef[]>(() => [
  { key: 'subject', label: '学科', options: subjects.value, multiple: false },
  { key: 'grade', label: '年级', options: grades.value, multiple: false },
  { key: 'status', label: '状态', options: Object.values(PREP_TASK_STATUS_TEXT), multiple: false },
])

function prepStatusKeyOf(text: string): '' | PrepTask['status'] {
  return (Object.keys(PREP_TASK_STATUS_TEXT) as PrepTask['status'][]).find((k) => PREP_TASK_STATUS_TEXT[k] === text) ?? ''
}

const prepFilterModel = computed<Record<string, string[]>>(() => ({
  subject: filter.subject ? [filter.subject] : [],
  grade: filter.grade ? [filter.grade] : [],
  status: filter.status ? [PREP_TASK_STATUS_TEXT[filter.status as PrepTask['status']]] : [],
}))

function onPrepFilterChange(next: Record<string, string[]>) {
  filter.subject = next.subject?.[0] ?? ''
  filter.grade = next.grade?.[0] ?? ''
  filter.status = prepStatusKeyOf(next.status?.[0] ?? '')
}

async function loadList() {
  tasks.value = await fetchPrepTasks()
}

function memberStatusClass(s: PrepMember['status']): string {
  return s === 'submitted' ? 'tag-green' : s === 'working' ? 'tag-blue' : 'tag-gray'
}

async function onDelete(t: PrepTask) {
  if (!window.confirm(`删除备课任务《${t.name}》？此操作不可撤销`)) return
  try {
    await deletePrepTask(t.id)
    await loadList()
    showToast('备课任务已删除', 'success')
  } catch (e) {
    showToast(errMsg(e), 'error')
  }
}

/* ================= 新建 / 编辑弹窗 ================= */
const editOpen = ref(false)
const saving = ref(false)
const staffList = ref<StaffMember[]>([])
const docOptions = ref<TeachDoc[]>([])

const form = reactive({
  id: 0,
  name: '',
  subject: '数学',
  grade: '高一',
  docKind: '' as TeachDocKind | '',
  docId: 0,
  docName: '',
  requirement: { topic: '', goal: '', keyPoints: '', hardPoints: '', deadline: '', note: '' },
})
const memberRows = ref<Array<{ name: string; duty: string; checked: boolean }>>([])

async function openCreate() {
  if (!staffList.value.length) staffList.value = (await fetchStaff()).list
  form.id = 0
  form.name = ''
  form.subject = pick(subjects.value, '数学')
  form.grade = pick(grades.value, '高一')
  form.docKind = ''
  form.docId = 0
  form.docName = ''
  form.requirement = { topic: '', goal: '', keyPoints: '', hardPoints: '', deadline: '', note: '' }
  memberRows.value = staffList.value.map((s) => ({ name: s.name, duty: '', checked: false }))
  docOptions.value = []
  editOpen.value = true
}

async function openEdit(t: PrepTask) {
  if (!staffList.value.length) staffList.value = (await fetchStaff()).list
  form.id = t.id
  form.name = t.name
  form.subject = t.subject
  form.grade = t.grade
  form.docKind = t.docKind ?? ''
  form.docId = t.docId ?? 0
  form.docName = t.docName
  form.requirement = { ...t.requirement }
  const memberNames = new Set(t.members.map((m) => m.name))
  memberRows.value = staffList.value.map((s) => {
    const m = t.members.find((x) => x.name === s.name)
    return { name: s.name, duty: m?.duty ?? '', checked: memberNames.has(s.name) }
  })
  docOptions.value = form.docKind ? await fetchTeachDocs(form.docKind) : []
  editOpen.value = true
}

async function onDocKindChange() {
  form.docId = 0
  form.docName = ''
  docOptions.value = form.docKind ? await fetchTeachDocs(form.docKind) : []
}
function onDocChange() {
  form.docName = docOptions.value.find((d) => d.id === form.docId)?.name ?? ''
}

async function submitEdit() {
  if (form.name.trim().length < 2) {
    showToast('任务名称须为 2-50 字', 'error')
    return
  }
  const checked = memberRows.value.filter((r) => r.checked)
  if (!checked.length) {
    showToast('请至少邀请一位参与教师', 'error')
    return
  }
  const emptyDuty = checked.find((r) => !r.duty)
  if (emptyDuty) {
    showToast(`请为「${emptyDuty.name}」填写分工`, 'error')
    return
  }
  const seen = new Set<string>()
  for (const r of checked) {
    if (seen.has(r.duty)) {
      showToast(`分工「${r.duty}」重复，请为每位教师分配不同分工`, 'error')
      return
    }
    seen.add(r.duty)
  }
  saving.value = true
  try {
    const saved = await savePrepTask({
      id: form.id || undefined,
      name: form.name.trim(),
      subject: form.subject,
      grade: form.grade,
      docKind: (form.docKind || undefined) as TeachDocKind | undefined,
      docId: form.docId || undefined,
      docName: docOptions.value.find((d) => d.id === form.docId)?.name ?? form.docName,
      requirement: { ...form.requirement },
      members: checked.map((r) => ({ name: r.name, duty: r.duty })),
    })
    editOpen.value = false
    if (taskId.value && task.value) task.value = saved
    else await loadList()
    showToast(form.id ? '已更新备课任务' : '备课任务已创建', 'success')
  } catch (e) {
    showToast(errMsg(e), 'error')
  } finally {
    saving.value = false
  }
}

/* ================= 任务工作台 ================= */
const submittedCount = computed(() => task.value?.members.filter((m) => m.status === 'submitted').length ?? 0)
const totalCount = computed(() => task.value?.members.length ?? 0)
const canFinalize = computed(
  () => !!task.value && totalCount.value > 0 && submittedCount.value >= totalCount.value && task.value.status !== 'done',
)

function openDoc() {
  if (!task.value?.docKind || !task.value?.docId) {
    showToast('本任务未关联备课文档', 'error')
    return
  }
  router.push(`/teach/${task.value.docKind}?id=${task.value.docId}`)
}

function statusClass(s: PrepTask['status']): string {
  return s === 'done' ? 'tag-green' : s === 'review' ? 'tag-orange' : s === 'ongoing' ? 'tag-blue' : 'tag-gray'
}

async function onSubmitDuty() {
  if (!task.value) return
  busy.value = true
  try {
    task.value = await submitPrepDuty(task.value.id, activeName.value)
    showToast(`已提交「${activeName.value}」的分工`, 'success')
  } catch (e) {
    showToast(errMsg(e), 'error')
  } finally {
    busy.value = false
  }
}

async function onFinalize() {
  if (!task.value) return
  busy.value = true
  try {
    task.value = await finalizePrepTask(task.value.id)
    showToast('备课任务已定稿', 'success')
  } catch (e) {
    showToast(errMsg(e), 'error')
  } finally {
    busy.value = false
  }
}

async function onSaveVersion() {
  if (!task.value) return
  if (!versionSummary.value.trim()) {
    showToast('请填写版本说明', 'error')
    return
  }
  busy.value = true
  try {
    task.value = await addPrepVersion(task.value.id, versionSummary.value.trim(), JSON.stringify(content.value))
    versionSummary.value = ''
    showToast('已保存为新版本', 'success')
  } catch (e) {
    showToast(errMsg(e), 'error')
  } finally {
    busy.value = false
  }
}

/* 研讨记录 */
const commentForm = reactive({ body: '', target: '' })
async function onAddComment() {
  if (!task.value) return
  if (!commentForm.body.trim()) {
    showToast('请输入研讨内容', 'error')
    return
  }
  try {
    task.value = await addPrepComment(task.value.id, commentForm.body.trim(), commentForm.target.trim())
    commentForm.body = ''
    commentForm.target = ''
    showToast('已发布研讨记录', 'success')
  } catch (e) {
    showToast(errMsg(e), 'error')
  }
}
async function onDeleteComment(commentId: number) {
  if (!task.value) return
  try {
    task.value = await deletePrepComment(task.value.id, commentId)
    showToast('研讨记录已删除', 'success')
  } catch (e) {
    showToast(errMsg(e), 'error')
  }
}

/* 版本线 */
const replaceTargetId = ref<number | null>(null)
const replaceNote = ref('')
const orderedVersions = computed(() => (task.value ? [...task.value.versions].sort((a, b) => b.no - a.no) : []))

async function onRevert(versionId: number) {
  if (!task.value) return
  try {
    const { task: t, snapshot } = await revertPrepVersion(task.value.id, versionId)
    task.value = t
    content.value = parseSnapshot(snapshot)
    showToast('已撤销到所选版本', 'success')
  } catch (e) {
    showToast(errMsg(e), 'error')
  }
}
async function onReplaceConfirm() {
  if (!task.value || replaceTargetId.value == null) return
  try {
    const { task: t, snapshot } = await replacePrepVersion(task.value.id, replaceTargetId.value)
    task.value = t
    content.value = parseSnapshot(snapshot)
    replaceTargetId.value = null
    replaceNote.value = ''
    showToast('已用所选版本替换当前内容', 'success')
  } catch (e) {
    showToast(errMsg(e), 'error')
  }
}

/* ================= 数据 ================= */
async function load() {
  loading.value = true
  try {
    await ensure()
    if (taskId.value) {
      const t = await fetchPrepTask(taskId.value)
      task.value = t
      content.value = latestSnapshot(t)
      if (!activeName.value || !t.members.some((m) => m.name === activeName.value)) {
        activeName.value = t.members[0]?.name ?? t.owner
      }
    } else {
      await loadList()
    }
  } catch (e) {
    showToast(errMsg(e), 'error')
    task.value = null
  } finally {
    loading.value = false
  }
}

watch(taskId, () => void load())
onMounted(() => void load())
</script>

<template>
  <!-- ================= 任务工作台 ================= -->
  <div v-if="task && taskId" class="page">
    <div class="pv-head panel">
      <button class="pv-back" type="button" @click="router.push('/prep')">
        <AppIcon name="chevron-left" :size="15" />
      </button>
      <div class="pv-head-main">
        <h2>{{ task.name }}</h2>
        <p class="f-hint">
          {{ task.subject }} · {{ task.grade }} · 课题：{{ task.requirement.topic || '—' }} · 截止
          {{ task.requirement.deadline || '未设置' }} · 发起人 {{ task.owner }}
        </p>
      </div>
      <div class="pv-head-ops">
        <span class="tag" :class="statusClass(task.status)">{{ PREP_TASK_STATUS_TEXT[task.status] }}</span>
        <span class="tag" :class="canFinalize ? 'tag-green' : 'tag-blue'">进度 {{ submittedCount }}/{{ totalCount }}</span>
        <span class="pv-identity">
          <span class="f-hint">当前身份</span>
          <select v-model="activeName" class="f-select">
            <option v-for="m in task.members" :key="m.name" :value="m.name">{{ m.name }}</option>
          </select>
        </span>
        <button class="btn btn-ghost btn-sm" @click="openEdit(task)"><AppIcon name="edit" :size="14" /> 编辑信息</button>
        <button v-if="canFinalize" class="btn btn-primary btn-sm" :disabled="busy" @click="onFinalize">
          <AppIcon name="check" :size="14" /> 定稿
        </button>
        <button v-else class="btn btn-ghost btn-sm" disabled>待全员提交后定稿</button>
        <button class="btn btn-ghost btn-sm" @click="router.push('/prep')">返回列表</button>
      </div>
    </div>

    <div class="pv-body">
      <!-- 左：成员分工 -->
      <aside class="panel pv-members">
        <div class="section-title">成员分工</div>
        <div v-for="m in task.members" :key="m.name" class="pv-member">
          <div class="pv-member-top">
            <span class="pv-avatar">{{ m.name.slice(0, 1) }}</span>
            <b>{{ m.name }}</b>
            <span v-if="m.online" class="online-dot" title="在线" />
            <span class="tag" :class="memberStatusClass(m.status)">{{ PREP_MEMBER_TEXT[m.status] }}</span>
          </div>
          <p class="f-hint">分工：{{ m.duty || '未分配' }} · 最近活跃 {{ m.lastActive || '—' }}</p>
          <button
            v-if="m.name === activeName && m.status !== 'submitted'"
            class="mini-btn"
            :disabled="busy"
            @click="onSubmitDuty"
          >
            提交我的分工
          </button>
          <span v-else-if="m.name === activeName" class="f-hint">你已提交分工</span>
        </div>
      </aside>

      <!-- 中：备课内容 -->
      <main class="panel pv-content">
        <div class="pv-content-head">
          <div class="section-title" style="margin: 0">备课内容</div>
          <button v-if="task.docKind && task.docId" class="btn btn-ghost btn-sm" @click="openDoc">
            <AppIcon name="folder" :size="14" /> {{ TEACH_KIND_TEXT[task.docKind] }}：{{ task.docName }}
          </button>
        </div>

        <RichTextEditor v-model="content" :subject="task.subject" :min-height="320" placeholder="在此协作撰写备课正文，可插入公式与配图；保存为新版本以便留痕与对比" />

        <div class="pv-version-save">
          <input v-model="versionSummary" class="f-input" placeholder="版本说明，如：初稿 / 按评课意见修订" />
          <button class="btn btn-primary btn-sm" :disabled="busy" @click="onSaveVersion">
            <AppIcon name="plus" :size="14" /> 保存为新版本
          </button>
        </div>
      </main>

      <!-- 右：研讨记录 + 版本 -->
      <aside class="pv-side">
        <div class="panel pv-discuss">
          <div class="section-title">研讨记录</div>
          <div class="pv-discuss-list">
            <p v-if="!task.comments.length" class="f-hint">还没有研讨记录，发布第一条吧。</p>
            <div v-for="c in task.comments" :key="c.id" class="pv-comment">
              <div class="pv-comment-head">
                <b>{{ c.author }}</b>
                <span class="f-hint">{{ c.at }}</span>
                <button v-if="c.author === activeName" class="mini-btn danger" @click="onDeleteComment(c.id)">删除</button>
              </div>
              <p v-if="c.target" class="pv-comment-target">针对：{{ c.target }}</p>
              <p class="pv-comment-body">{{ c.body }}</p>
            </div>
          </div>
          <div class="pv-comment-form">
            <input v-model="commentForm.target" class="f-input" placeholder="针对环节（选填）" />
            <textarea v-model="commentForm.body" class="f-textarea" style="min-height: 60px" placeholder="发表研讨意见…" />
            <button class="btn btn-primary btn-sm" @click="onAddComment"><AppIcon name="message" :size="14" /> 发布</button>
          </div>
        </div>

        <div class="panel pv-versions">
          <div class="section-title">版本（{{ task.versions.length }}）</div>
          <div class="pv-ver-list">
            <p v-if="!orderedVersions.length" class="f-hint">暂无版本，保存正文即生成首个版本。</p>
            <div v-for="v in orderedVersions" :key="v.id" class="pv-ver" :class="{ replaced: v.replaced }">
              <div class="pv-ver-head">
                <b>v{{ v.no }}</b>
                <span>{{ v.author }}</span>
                <em>{{ v.at }}</em>
              </div>
              <p class="f-hint">{{ v.summary }}</p>
              <div class="op-group" style="margin-top: 4px">
                <button class="mini-btn" @click="onRevert(v.id)">撤销到此版</button>
                <button class="mini-btn" @click="replaceTargetId = v.id">替换当前</button>
                <span v-if="v.replaced" class="tag tag-gray">已被替换</span>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>

    <!-- 替换版本二次确认 -->
    <AppModal v-if="replaceTargetId != null" title="以所选版本替换当前内容" :width="480" @close="replaceTargetId = null">
      <p class="f-hint" style="margin-bottom: 12px">
        替换后当前正文会被该版本覆盖，原版本仍保留在版本线中（标记为「已被替换」），可在版本线中再次撤销回来。
      </p>
      <div class="f-field">
        <label class="f-label">替换说明（可选）</label>
        <input v-model="replaceNote" class="f-input" placeholder="如：改用 v3 的环节设计" />
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="replaceTargetId = null">取消</button>
        <button class="btn btn-primary" @click="onReplaceConfirm">确认替换</button>
      </template>
    </AppModal>
  </div>

  <!-- ================= 列表 ================= -->
  <div v-else-if="!taskId" class="page">
    <AppPageHeader desc="共备一份教案 / 课件，分工撰写、互相批注、版本对比、研讨定稿。">
      <template #actions>
        <button class="btn btn-primary" @click="openCreate"><AppIcon name="plus" :size="15" /> 新建备课任务</button>
      </template>
    </AppPageHeader>

    <AppFilterPanel :model-value="prepFilterModel" :rows="PREP_FILTER_ROWS" @update:model-value="onPrepFilterChange" />

    <div class="panel">
      <AppListToolbar v-model="filter.keyword" placeholder="名称 / 课题" class="pv-toolbar" />

      <div class="pv-grid">
        <div v-for="row in rows" :key="row.id" class="pv-card">
          <div class="pv-card-top">
            <h3>{{ row.name }}</h3>
            <span class="tag" :class="statusClass(row.status)">{{ PREP_TASK_STATUS_TEXT[row.status] }}</span>
          </div>
          <p class="pv-card-meta">{{ row.grade }} · {{ row.subject }} · 课题：{{ row.requirement.topic || '—' }}</p>
          <p v-if="row.docKind" class="pv-card-doc">
            <AppIcon name="folder" :size="13" /> {{ TEACH_KIND_TEXT[row.docKind] }}：{{ row.docName }}
          </p>
          <div class="pv-card-tags">
            <span class="tag tag-gray">成员 {{ row.members.length }}</span>
            <span class="tag" :class="row.members.every((m) => m.status === 'submitted') ? 'tag-green' : 'tag-blue'">
              已提交 {{ row.members.filter((m) => m.status === 'submitted').length }}
            </span>
            <span class="tag tag-orange">截止 {{ row.requirement.deadline || '—' }}</span>
          </div>
          <p class="pv-card-foot">发起人 {{ row.owner }} · 更新于 {{ row.updatedAt }}</p>
          <div class="op-group">
            <button class="mini-btn" @click="router.push(`/prep?id=${row.id}`)">进入任务</button>
            <button class="mini-btn" @click="openEdit(row)">编辑</button>
            <button class="mini-btn danger" @click="onDelete(row)">删除</button>
          </div>
        </div>
      </div>
      <p v-if="!rows.length" class="empty-row">
        {{ loading ? '正在载入…' : '暂无备课任务，点击右上角新建' }}
      </p>
      <AppPagination :total="filtered.length" v-model:page="page" :page-size="9" />
    </div>

    <!-- 新建 / 编辑 -->
    <AppModal v-if="editOpen" :title="form.id ? '编辑备课任务' : '新建备课任务'" :width="680" @close="editOpen = false">
      <div class="f-field">
        <label class="f-label">任务名称<span class="req">*</span></label>
        <input v-model="form.name" class="f-input" maxlength="50" placeholder="例如：高一函数单调性 集体备课" />
      </div>
      <div class="f-field row2">
        <div>
          <label class="f-label">学科</label>
          <select v-model="form.subject" class="f-select">
            <option v-for="s in subjects" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
        <div>
          <label class="f-label">年级</label>
          <select v-model="form.grade" class="f-select">
            <option v-for="g in grades" :key="g" :value="g">{{ g }}</option>
          </select>
        </div>
      </div>
      <div class="f-field row2">
        <div>
          <label class="f-label">关联备课文档类型</label>
          <select v-model="form.docKind" class="f-select" @change="onDocKindChange">
            <option value="">不关联</option>
            <option v-for="k in DOC_KINDS" :key="k" :value="k">{{ TEACH_KIND_TEXT[k] }}</option>
          </select>
        </div>
        <div>
          <label class="f-label">具体文档</label>
          <select v-model="form.docId" class="f-select" :disabled="!form.docKind" @change="onDocChange">
            <option value="0">请选择</option>
            <option v-for="d in docOptions" :key="d.id" :value="d.id">{{ d.name }}</option>
          </select>
        </div>
      </div>

      <div class="section-title" style="margin: 6px 0 10px">备课要求</div>
      <div class="f-field">
        <label class="f-label">课题</label>
        <input v-model="form.requirement.topic" class="f-input" placeholder="如：函数的单调性" />
      </div>
      <div class="f-field row2">
        <div>
          <label class="f-label">教学目标</label>
          <input v-model="form.requirement.goal" class="f-input" placeholder="知识 / 能力 / 情感目标" />
        </div>
        <div>
          <label class="f-label">截止日期</label>
          <input v-model="form.requirement.deadline" type="date" class="f-input" />
        </div>
      </div>
      <div class="f-field row2">
        <div>
          <label class="f-label">教学重点</label>
          <input v-model="form.requirement.keyPoints" class="f-input" placeholder="教学重点" />
        </div>
        <div>
          <label class="f-label">教学难点</label>
          <input v-model="form.requirement.hardPoints" class="f-input" placeholder="教学难点" />
        </div>
      </div>
      <div class="f-field">
        <label class="f-label">备注</label>
        <textarea v-model="form.requirement.note" class="f-textarea" placeholder="其他备课说明（选填）" />
      </div>

      <div class="section-title" style="margin: 6px 0 10px">参与教师与分工</div>
      <p class="f-hint" style="margin-bottom: 8px">从员工中勾选参与教师，并为每人分配一项不重复的分工。</p>
      <div class="pv-member-pick">
        <div v-for="r in memberRows" :key="r.name" class="pv-pick-row">
          <label class="pv-pick-check">
            <input v-model="r.checked" type="checkbox" />
            <span class="pv-avatar sm">{{ r.name.slice(0, 1) }}</span>
            <b>{{ r.name }}</b>
          </label>
          <select v-model="r.duty" class="f-select" :disabled="!r.checked">
            <option value="">选择分工</option>
            <option v-for="d in DUTY_OPTIONS" :key="d" :value="d">{{ d }}</option>
          </select>
        </div>
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="editOpen = false">取消</button>
        <button class="btn btn-primary" :disabled="saving" @click="submitEdit">{{ saving ? '保存中…' : '保存' }}</button>
      </template>
    </AppModal>
  </div>

  <p v-else class="panel empty-row">正在载入任务…</p>
</template>

<style scoped>
.pv-head { display: flex; align-items: center; gap: 12px; padding: 14px 16px; }
.pv-back {
  width: 34px; height: 34px; flex-shrink: 0;
  border: 1px solid var(--border); border-radius: 9px;
  background: #fff; color: var(--ink-2);
  display: flex; align-items: center; justify-content: center;
}
.pv-back:hover { border-color: var(--brand); color: var(--brand-deep); }
.pv-head-main { flex: 1; min-width: 0; }
.pv-head-main h2 { font-size: 16.5px; font-weight: 700; }
.pv-head-ops { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; flex-shrink: 0; }
.pv-identity { display: inline-flex; align-items: center; gap: 6px; }
/* .f-select 全局是 width:100%，放进横向工具条里必须就地收窄 */
.pv-identity .f-select { width: auto; min-width: 110px; flex-shrink: 0; height: var(--ctrl-h); }

.pv-body { display: grid; grid-template-columns: 268px minmax(0, 1fr) 320px; gap: 12px; align-items: start; }

.pv-members { padding: 14px; position: sticky; top: 0; max-height: calc(100vh - 150px); overflow-y: auto; }
.pv-member { border-bottom: 1px dashed var(--border); padding-bottom: 12px; margin-bottom: 12px; }
.pv-member-top { display: flex; align-items: center; gap: 7px; font-size: 13px; }
.pv-avatar {
  width: 26px; height: 26px; flex-shrink: 0; border-radius: 9px;
  background: var(--brand-soft); color: var(--brand-deep);
  font-size: 12.5px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
}
.pv-avatar.sm { width: 22px; height: 22px; font-size: 11px; border-radius: 7px; }
.online-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--success); }

.pv-content { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.pv-content-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.pv-version-save { display: flex; gap: 8px; align-items: center; }
.pv-version-save .f-input { flex: 1; min-width: 0; height: var(--ctrl-h); }

.pv-side { display: flex; flex-direction: column; gap: 12px; position: sticky; top: 0; max-height: calc(100vh - 150px); overflow-y: auto; }
.pv-discuss { padding: 14px; }
.pv-discuss-list { display: flex; flex-direction: column; gap: 10px; margin-bottom: 12px; max-height: 280px; overflow-y: auto; }
.pv-comment { border: 1px solid var(--border); border-radius: 10px; padding: 9px 11px; background: #fbfdfd; }
.pv-comment-head { display: flex; align-items: center; gap: 8px; font-size: 12.5px; }
.pv-comment-head b { color: var(--ink); }
.pv-comment-target { font-size: 11.5px; color: var(--brand-deep); margin: 4px 0; }
.pv-comment-body { font-size: 12.5px; color: var(--ink-2); line-height: 1.6; margin-top: 4px; white-space: pre-wrap; }
.pv-comment-form { display: flex; flex-direction: column; gap: 8px; padding-top: 10px; border-top: 1px dashed var(--border); }

.pv-versions { padding: 14px; }
.pv-ver-list { display: flex; flex-direction: column; gap: 10px; }
.pv-ver { border-left: 2px solid var(--border); padding: 0 0 2px 12px; }
.pv-ver.replaced { opacity: 0.6; }
.pv-ver-head { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--ink-2); }
.pv-ver-head b { color: var(--ink); }
.pv-ver-head em { margin-left: auto; font-style: normal; font-size: 11px; color: var(--sub); }

/* 列表 */
.pv-toolbar { padding: 14px 16px 0; margin-bottom: 0; }
.pv-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; padding: 14px 16px 4px; }
.pv-card {
  border: 1.5px solid var(--border); border-radius: 12px;
  padding: 14px; display: flex; flex-direction: column; gap: 8px;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.pv-card:hover { border-color: var(--brand); box-shadow: var(--shadow); }
.pv-card-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.pv-card-top h3 { font-size: 14px; font-weight: 700; line-height: 1.5; }
.pv-card-meta { font-size: 12px; color: var(--sub); }
.pv-card-doc { display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--brand-deep); }
.pv-card-tags { display: flex; flex-wrap: wrap; gap: 5px; }
.pv-card-foot { font-size: 11.5px; color: var(--sub); }
.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

.pv-member-pick { display: flex; flex-direction: column; gap: 8px; max-height: 240px; overflow-y: auto; }
.pv-pick-row { display: flex; align-items: center; gap: 10px; }
.pv-pick-row .f-select { flex: 1; min-width: 0; height: var(--ctrl-h); }
.pv-pick-check { display: flex; align-items: center; gap: 7px; width: 110px; flex-shrink: 0; }
.pv-pick-check input { accent-color: var(--brand); }
</style>
