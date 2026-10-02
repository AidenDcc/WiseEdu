<script setup lang="ts">
/**
 * 班级与年级管理（T-08-01）+ 班级学生名单（T-08-02）。
 *
 * 列表 + 名册抽屉合在一页：班级是「壳」，点开看学生是老师最高频的动作，
 * 拆两个页面反而要多跳一次。名册直接复用学生档案接口按班过滤。
 */
import { computed, onMounted, ref } from 'vue'
import { AppIcon, AppPageHeader, CLASS_NAMES, STUDENT_WARNING_TEXT, showToast, AppModal, AppDrawer } from '@aiteach/shared'
import type { OrgClass, OrgStudent } from '@aiteach/shared'
import { fetchClasses, fetchStudents, saveClass, toggleClass } from '@/api/student'

const classes = ref<OrgClass[]>([])
const loading = ref(true)

async function load() {
  loading.value = true
  classes.value = await fetchClasses()
  loading.value = false
}

/* ===== 班级新增 / 编辑 ===== */
const editing = ref<null | { id: number | null; name: string; grade: string; headTeacher: string; assistant: string; room: string; subjects: string[] }>(null)

function openCreate() {
  editing.value = { id: null, name: '', grade: '高一', headTeacher: '', assistant: '', room: '', subjects: ['数学', '语文', '英语', '物理'] }
}
function openEdit(row: OrgClass) {
  editing.value = {
    id: row.id,
    name: row.name,
    grade: row.grade,
    headTeacher: row.headTeacher,
    assistant: row.assistant ?? '',
    room: row.room ?? '',
    subjects: [...row.subjects],
  }
}

async function submit() {
  if (!editing.value) return
  if (!editing.value.name.trim()) {
    showToast('班级名称必填', 'error')
    return
  }
  try {
    await saveClass({
      id: editing.value.id ?? undefined,
      name: editing.value.name,
      grade: editing.value.grade,
      headTeacher: editing.value.headTeacher,
      assistant: editing.value.assistant || undefined,
      room: editing.value.room || undefined,
      subjects: editing.value.subjects,
    })
    editing.value = null
    showToast('已保存', 'success')
    load()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '保存失败', 'error')
  }
}

async function onToggle(row: OrgClass) {
  try {
    await toggleClass(row.id)
    await load()
    showToast(row.enabled ? '已停用（不能再给该班布置作业 / 考试）' : '已启用', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '操作失败', 'error')
  }
}

/* ===== 学生名册抽屉（T-08-02） ===== */
const rosterOf = ref<OrgClass | null>(null)
const roster = ref<OrgStudent[]>([])

async function openRoster(row: OrgClass) {
  rosterOf.value = row
  roster.value = await fetchStudents('', row.name)
}

const rosterStats = computed(() => {
  const risk = roster.value.filter((row) => row.warning === 'risk').length
  const watch = roster.value.filter((row) => row.warning === 'watch').length
  return { total: roster.value.length, risk, watch }
})

const SUBJECT_OPTIONS = ['数学', '语文', '英语', '物理', '化学', '生物', '历史', '地理', '政治']

onMounted(load)
</script>

<template>
  <div class="page">
    <AppPageHeader desc="教学班与班级学生名单；阅卷、作业、学情统计都按班级维度展开。停用班级前需先转出全部学生。">
      <template #actions>
        <button class="btn btn-primary" @click="openCreate">
          <AppIcon name="plus" :size="15" /> 新增班级
        </button>
      </template>
    </AppPageHeader>

    <div class="panel">
      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>班级名称</th>
              <th>年级</th>
              <th>班主任</th>
              <th>助教</th>
              <th>学生数</th>
              <th>开设学科</th>
              <th>教室</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="9" class="empty-row">加载中…</td>
            </tr>
            <tr v-else-if="classes.length === 0">
              <td colspan="9" class="empty-row">暂无班级</td>
            </tr>
            <template v-else>
              <tr v-for="row in classes" :key="row.id">
                <td class="cell-strong">{{ row.name }}</td>
                <td>{{ row.grade }}</td>
                <td>{{ row.headTeacher || '—' }}</td>
                <td>{{ row.assistant || '—' }}</td>
                <td>{{ row.studentCount }}</td>
                <td>
                  <div class="subject-chips">
                    <span v-for="subject in row.subjects" :key="subject" class="tag tag-blue">{{ subject }}</span>
                  </div>
                </td>
                <td>{{ row.room || '—' }}</td>
                <td>
                  <span class="tag" :class="row.enabled ? 'tag-green' : 'tag-gray'">{{ row.enabled ? '启用' : '停用' }}</span>
                </td>
                <td>
                  <div class="op-group">
                    <button class="mini-btn" @click="openRoster(row)">学生名单</button>
                    <button class="mini-btn" @click="openEdit(row)">编辑</button>
                    <button class="mini-btn" @click="onToggle(row)">{{ row.enabled ? '停用' : '启用' }}</button>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 学生名册抽屉 -->
    <AppDrawer v-if="rosterOf" :title="`${rosterOf.name} · 学生名单`" :width="640" @close="rosterOf = null">
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
          <tr v-if="roster.length === 0">
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
    <AppModal v-if="editing" :title="editing.id ? '编辑班级' : '新增班级'" :width="520" @close="editing = null">
      <div class="f-field row2">
        <div>
          <label class="f-label">班级名称<span class="req">*</span></label>
          <input v-model="editing.name" class="f-input" placeholder="如 高一(4)班" />
        </div>
        <div>
          <label class="f-label">年级</label>
          <select v-model="editing.grade" class="f-select">
            <option v-for="grade in ['高一', '高二', '高三']" :key="grade" :value="grade">{{ grade }}</option>
          </select>
        </div>
      </div>
      <div class="f-field row2">
        <div>
          <label class="f-label">班主任</label>
          <input v-model="editing.headTeacher" class="f-input" placeholder="选填" />
        </div>
        <div>
          <label class="f-label">助教</label>
          <input v-model="editing.assistant" class="f-input" placeholder="选填" />
        </div>
      </div>
      <div class="f-field">
        <label class="f-label">教室</label>
        <input v-model="editing.room" class="f-input" placeholder="选填，如 教学楼 A304" />
      </div>
      <div class="f-field">
        <label class="f-label">开设学科</label>
        <div class="subject-checks">
          <label v-for="subject in SUBJECT_OPTIONS" :key="subject" class="check-item">
            <input v-model="editing.subjects" type="checkbox" :value="subject" />
            {{ subject }}
          </label>
        </div>
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="editing = null">取消</button>
        <button class="btn btn-primary" @click="submit">保存</button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.subject-chips { display: flex; flex-wrap: wrap; gap: 4px; }
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
.subject-checks { display: flex; flex-wrap: wrap; gap: 6px 16px; }
.check-item { display: flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer; }
</style>
