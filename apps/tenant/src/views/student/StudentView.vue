<script setup lang="ts">
/**
 * 学生档案管理（T-08-03 ~ 06）。
 *
 * 两个页签：
 * - 学生档案：列表（手机号默认脱敏，T-08-04 最小化收集）+ 新增 / 编辑 + 详情抽屉（全量信息按权限展示）；
 * - 知情同意：监护人知情同意记录（T-08-06），支持补签（勾选授权范围）与撤回（撤回后 AI 学情能力对该生停用）。
 */
import { computed, onMounted, ref } from 'vue'
import { AppIcon, AppPageHeader, AppSearchInput, AppTabs, CONSENT_STATUS_TEXT, STUDENT_WARNING_TEXT, appConfirm, showToast, AppModal, AppDrawer } from '@aiteach/shared'
import type { ConsentRecord, OrgClass, OrgStudent } from '@aiteach/shared'
import {
  deleteStudent,
  fetchClasses,
  fetchConsents,
  fetchStudents,
  saveStudent,
  signConsent,
  withdrawConsent,
} from '@/api/student'

const tab = ref<'archive' | 'consent'>('archive')
const classes = ref<OrgClass[]>([])
const students = ref<OrgStudent[]>([])
const consents = ref<ConsentRecord[]>([])
const keyword = ref('')
const classFilter = ref('')
const loading = ref(true)

async function load() {
  loading.value = true
  const [classList, studentList, consentList] = await Promise.all([
    fetchClasses(),
    fetchStudents(keyword.value, classFilter.value),
    fetchConsents(keyword.value),
  ])
  classes.value = classList
  students.value = studentList
  consents.value = consentList
  loading.value = false
}

const filteredStudents = computed(() =>
  students.value.filter((row) => !classFilter.value || row.className === classFilter.value),
)

/* ===== 详情抽屉 ===== */
const detail = ref<OrgStudent | null>(null)
const detailConsent = computed(() => consents.value.find((row) => row.studentId === detail.value?.id) ?? null)

/* ===== 新增 / 编辑 ===== */
const editing = ref<null | {
  id: number | null
  name: string
  studentNo: string
  className: string
  gender: '男' | '女'
  guardianName: string
  guardianPhone: string
}>(null)

function openCreate() {
  editing.value = {
    id: null,
    name: '',
    studentNo: '',
    className: classes.value[0]?.name ?? '',
    gender: '男',
    guardianName: '',
    guardianPhone: '',
  }
}
function openEdit(row: OrgStudent) {
  /* 列表行里的手机号是脱敏的，编辑前拉全量 */
  editing.value = {
    id: row.id,
    name: row.name,
    studentNo: row.studentNo,
    className: row.className,
    gender: row.gender,
    guardianName: row.guardianName,
    guardianPhone: row.guardianPhone,
  }
}

async function submit() {
  if (!editing.value) return
  if (!editing.value.name.trim()) {
    showToast('学生姓名必填', 'error')
    return
  }
  if (editing.value.guardianPhone && !/^1\d{10}$/.test(editing.value.guardianPhone)) {
    showToast('监护人手机号格式不正确', 'error')
    return
  }
  try {
    await saveStudent({
      id: editing.value.id ?? undefined,
      name: editing.value.name,
      studentNo: editing.value.studentNo,
      className: editing.value.className,
      gender: editing.value.gender,
      guardianName: editing.value.guardianName,
      guardianPhone: editing.value.guardianPhone,
    })
    editing.value = null
    showToast('已保存', 'success')
    load()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '保存失败', 'error')
  }
}

async function onDelete(row: OrgStudent) {
  if (!(await appConfirm(`删除学生「${row.name}」的档案？相关学情数据将一并清除。`, { type: 'danger' }))) return
  try {
    await deleteStudent(row.id)
    showToast('已删除', 'success')
    load()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '删除失败', 'error')
  }
}

/* ===== 知情同意补签 / 撤回 ===== */
const CONSENT_SCOPES = ['学情分析', '个性化练习推送', '错题本生成', 'AI 问答记录']
const signing = ref<null | { id: number; studentName: string; scopes: string[] }>(null)

function openSign(row: ConsentRecord) {
  signing.value = { id: row.id, studentName: row.studentName, scopes: [...CONSENT_SCOPES.slice(0, 2)] }
}

async function submitSign() {
  if (!signing.value) return
  try {
    await signConsent(signing.value.id, signing.value.scopes)
    signing.value = null
    showToast('已记录监护人同意', 'success')
    load()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '操作失败', 'error')
  }
}

async function onWithdraw(row: ConsentRecord) {
  if (!(await appConfirm(`撤回「${row.studentName}」监护人的知情同意？撤回后 AI 学情与个性化推送将对该生停用。`, { type: 'warning' }))) return
  try {
    await withdrawConsent(row.id)
    showToast('已撤回', 'success')
    load()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '操作失败', 'error')
  }
}

function consentTag(status: ConsentRecord['status']) {
  return status === 'granted' ? 'tag-green' : status === 'pending' ? 'tag-orange' : 'tag-red'
}

onMounted(load)
</script>

<template>
  <div class="page">
    <AppPageHeader desc="学生档案与监护人知情同意管理；列表默认脱敏展示监护人手机号（T-08-04 最小化收集），详情按权限查看全量。">
      <template #actions>
        <button v-if="tab === 'archive'" class="btn btn-primary" @click="openCreate">
          <AppIcon name="plus" :size="15" /> 新增学生
        </button>
      </template>
    </AppPageHeader>

    <div class="toolbar">
      <AppTabs
        v-model="tab"
        :tabs="[
          { key: 'archive', label: '学生档案', count: students.length },
          { key: 'consent', label: '知情同意记录', count: consents.filter((row) => row.status !== 'granted').length },
        ]"
      />
      <div class="toolbar-right">
        <template v-if="tab === 'archive'">
          <select v-model="classFilter" class="f-select" @change="load">
            <option value="">全部班级</option>
            <option v-for="cls in classes" :key="cls.id" :value="cls.name">{{ cls.name }}</option>
          </select>
        </template>
        <AppSearchInput v-model="keyword" placeholder="姓名 / 学号" @search="load" />
      </div>
    </div>

    <!-- 学生档案 -->
    <div v-if="tab === 'archive'" class="panel">
      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>学号</th>
              <th>姓名</th>
              <th>班级</th>
              <th>性别</th>
              <th>监护人</th>
              <th>监护人手机</th>
              <th>知情同意</th>
              <th>画像标签</th>
              <th>预警</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="10" class="empty-row">加载中…</td>
            </tr>
            <tr v-else-if="filteredStudents.length === 0">
              <td colspan="10" class="empty-row">暂无学生</td>
            </tr>
            <template v-else>
              <tr v-for="row in filteredStudents" :key="row.id">
                <td><code class="code-chip">{{ row.studentNo }}</code></td>
                <td class="cell-strong">{{ row.name }}</td>
                <td>{{ row.className }}</td>
                <td>{{ row.gender }}</td>
                <td>{{ row.guardianName }}</td>
                <td class="mono">{{ row.guardianPhone }}</td>
                <td><span class="tag" :class="consentTag(row.consentStatus)">{{ CONSENT_STATUS_TEXT[row.consentStatus] }}</span></td>
                <td>
                  <div class="tag-row">
                    <span v-for="tag in row.tags" :key="tag" class="tag tag-blue">{{ tag }}</span>
                  </div>
                </td>
                <td>
                  <span class="tag" :class="row.warning === 'risk' ? 'tag-red' : row.warning === 'watch' ? 'tag-orange' : 'tag-gray'">
                    {{ STUDENT_WARNING_TEXT[row.warning] }}
                  </span>
                </td>
                <td>
                  <div class="op-group">
                    <button class="mini-btn" @click="detail = row">详情</button>
                    <button class="mini-btn" @click="openEdit(row)">编辑</button>
                    <button class="mini-btn danger" @click="onDelete(row)">删除</button>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 知情同意记录 -->
    <div v-else class="panel">
      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>学生</th>
              <th>监护人</th>
              <th>关系</th>
              <th>同意书版本</th>
              <th>状态</th>
              <th>授权范围</th>
              <th>签署 / 撤回时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="consents.length === 0">
              <td colspan="8" class="empty-row">暂无记录</td>
            </tr>
            <tr v-for="row in consents" :key="row.id">
              <td class="cell-strong">{{ row.studentName }}</td>
              <td>{{ row.guardianName }}</td>
              <td>{{ row.relation }}</td>
              <td>{{ row.docVersion }}</td>
              <td><span class="tag" :class="consentTag(row.status)">{{ CONSENT_STATUS_TEXT[row.status] }}</span></td>
              <td>
                <div class="tag-row">
                  <span v-for="scope in row.scopes" :key="scope" class="tag tag-blue">{{ scope }}</span>
                  <span v-if="row.scopes.length === 0" class="muted">—</span>
                </div>
              </td>
              <td class="mono">{{ row.signedAt ?? row.withdrawnAt ?? '—' }}</td>
              <td>
                <div class="op-group">
                  <button v-if="row.status !== 'granted'" class="mini-btn" @click="openSign(row)">补签</button>
                  <button v-if="row.status === 'granted'" class="mini-btn danger" @click="onWithdraw(row)">撤回</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 学生详情抽屉 -->
    <AppDrawer v-if="detail" :title="`${detail.name} · 学生档案`" :subtitle="`${detail.className} · ${detail.studentNo}`" :width="520" @close="detail = null">
      <div class="detail-grid">
        <div class="detail-item"><span>性别</span><b>{{ detail.gender }}</b></div>
        <div class="detail-item"><span>状态</span><b>{{ detail.status }}</b></div>
        <div class="detail-item"><span>入学日期</span><b>{{ detail.enrolledAt }}</b></div>
        <div class="detail-item"><span>监护人</span><b>{{ detail.guardianName }}（{{ detailConsent?.relation ?? '—' }}）</b></div>
        <div class="detail-item"><span>监护人手机</span><b class="mono">{{ detail.guardianPhone }}</b></div>
        <div class="detail-item">
          <span>知情同意</span>
          <b>{{ detailConsent ? CONSENT_STATUS_TEXT[detailConsent.status] : '—' }}</b>
        </div>
        <div class="detail-item"><span>最近统考分</span><b>{{ detail.lastScore ?? '—' }}</b></div>
        <div class="detail-item"><span>班级分位</span><b>前 {{ 100 - (detail.lastPercentile ?? 0) }}%</b></div>
      </div>
      <div class="detail-section">
        <h4>画像标签（AI 学情）</h4>
        <div class="tag-row">
          <span v-for="tag in detail.tags" :key="tag" class="tag tag-blue">{{ tag }}</span>
          <span v-if="detail.tags.length === 0" class="muted">暂无</span>
        </div>
      </div>
      <div class="detail-section">
        <h4>授权范围（监护人签署）</h4>
        <div class="tag-row">
          <span v-for="scope in detailConsent?.scopes ?? []" :key="scope" class="tag tag-green">{{ scope }}</span>
          <span v-if="!detailConsent?.scopes?.length" class="muted">未授权任何 AI 数据处理范围</span>
        </div>
      </div>
      <p class="privacy-note">
        按《未成年人个人信息保护》要求：学生照片与作答图片不作他用、按留存策略清理；撤回同意后 AI 学情能力对该生即时停用。
      </p>
    </AppDrawer>

    <!-- 新增 / 编辑 -->
    <AppModal v-if="editing" :title="editing.id ? '编辑学生' : '新增学生'" :width="480" @close="editing = null">
      <div class="f-field row2">
        <div>
          <label class="f-label">姓名<span class="req">*</span></label>
          <input v-model="editing.name" class="f-input" placeholder="学生姓名" />
        </div>
        <div>
          <label class="f-label">学号</label>
          <input v-model="editing.studentNo" class="f-input" placeholder="留空自动生成" />
        </div>
      </div>
      <div class="f-field row2">
        <div>
          <label class="f-label">班级<span class="req">*</span></label>
          <select v-model="editing.className" class="f-select">
            <option v-for="cls in classes.filter((row) => row.enabled)" :key="cls.id" :value="cls.name">{{ cls.name }}</option>
          </select>
        </div>
        <div>
          <label class="f-label">性别</label>
          <select v-model="editing.gender" class="f-select">
            <option value="男">男</option>
            <option value="女">女</option>
          </select>
        </div>
      </div>
      <div class="f-field row2">
        <div>
          <label class="f-label">监护人姓名</label>
          <input v-model="editing.guardianName" class="f-input" placeholder="选填" />
        </div>
        <div>
          <label class="f-label">监护人手机</label>
          <input v-model="editing.guardianPhone" class="f-input" placeholder="11 位手机号" />
        </div>
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="editing = null">取消</button>
        <button class="btn btn-primary" @click="submit">保存</button>
      </template>
    </AppModal>

    <!-- 补签知情同意 -->
    <AppModal v-if="signing" :title="`补签知情同意 · ${signing.studentName}`" :width="440" @close="signing = null">
      <p class="sign-note">请确认监护人已阅读《知情同意书 V2026.2》并勾选授权范围（至少一项）：</p>
      <div class="subject-checks">
        <label v-for="scope in CONSENT_SCOPES" :key="scope" class="check-item">
          <input v-model="signing.scopes" type="checkbox" :value="scope" />
          {{ scope }}
        </label>
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="signing = null">取消</button>
        <button class="btn btn-primary" @click="submitSign">确认签署</button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
.toolbar-right { display: flex; align-items: center; gap: 10px; }
.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.code-chip {
  font-family: 'SF Mono', Menlo, monospace;
  font-size: 12px; color: var(--brand-deep);
  background: var(--brand-soft); border-radius: 6px; padding: 2px 8px;
}
.mono { font-family: 'SF Mono', Menlo, monospace; font-size: 12px; }
.tag-row { display: flex; flex-wrap: wrap; gap: 4px; }
.muted { color: var(--sub); font-size: 12px; }
.detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 20px; margin-bottom: 18px; }
.detail-item { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--sub); }
.detail-item b { font-size: 14px; color: var(--text); font-weight: 600; }
.detail-section h4 { font-size: 13px; margin: 0 0 8px; }
.privacy-note {
  margin-top: 18px; padding: 10px 12px; border-radius: 8px;
  background: #fff7ed; color: #92600a; font-size: 12px; line-height: 1.7;
}
.subject-checks { display: flex; flex-wrap: wrap; gap: 6px 16px; }
.check-item { display: flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer; }
.sign-note { font-size: 13px; color: var(--sub); margin-bottom: 12px; line-height: 1.7; }
</style>
