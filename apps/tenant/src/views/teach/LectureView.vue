<script setup lang="ts">
/**
 * 讲义列表。
 *
 * 编辑器已搬到**独立全屏页** `/teach/lecture/edit?id=`（与教案、学案同一套工作台），
 * 本页只负责「找一份 / 新建一份」：筛选、搜索、分页、复制、删除、新建。
 *
 * 与「试卷」的分工：试卷是**题目容器**（一张卷从头到尾都是题），讲义是**课堂脚本**
 * （讲解文字 + 少量例题 + 练习）。所以讲义的编辑器主体是段落流：每段有类型（学习目标 /
 * 知识点讲解 / 典型例题 / 随堂练习 / 课堂小结 / 课后作业）、富文本正文，以及可选关联的题库题目。
 *
 * 为什么编辑不再就地展开：纸面型编辑要满宽 A4 画布 + 常驻左目录与右工具条，
 * 套在带侧边栏的 AppLayout 里纸展不开（教案页改版时定下的同一条理由）。
 * 入口一律新页签：改完一份还要回这张列表接着处理下一份，同页签跳走等于把来路弄丢。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  AppFilterPanel,
  AppIcon,
  AppListToolbar,
  AppModal,
  AppPageHeader,
  AppPagination,
  TEACH_DOC_STATUS_TEXT,
  appConfirm,
  showToast,
} from '@aiteach/shared'
import type { FilterRowDef, TeachDoc } from '@aiteach/shared'

import { deleteTeachDoc, duplicateTeachDoc, fetchTeachDocs, saveTeachDoc } from '@/api/org'
import { useBaseData } from '@aiteach/business-common'
import { LECTURE_TEMPLATES, makeBlocks } from './teach-templates'
import { openBlankTab, openTeachEdit, teachEditHref } from '@/utils/teach-edit'
import { useMenuAccess } from '@/composables/useVisibleMenus'

const router = useRouter()
/* 「切换课件」跟着菜单可见性走：标准版没有课件，按钮也不该在 */
const { canSee } = useMenuAccess()
const { subjects, grades, ensure, pick } = useBaseData()

const docs = ref<TeachDoc[]>([])
const loading = ref(true)
const saving = ref(false)

/* ================= 列表 ================= */

const FILTER_ROWS = computed<FilterRowDef[]>(() => [
  { key: 'subject', label: '学科', options: subjects.value, multiple: false },
  { key: 'grade', label: '年级', options: grades.value, multiple: false },
  { key: 'status', label: '状态', options: Object.values(TEACH_DOC_STATUS_TEXT), multiple: false },
])
const filters = reactive<Record<string, string[]>>({ subject: [], grade: [], status: [] })

/* AppFilterPanel 回传整份筛选值（覆盖式回写），逐 key 写回这份 reactive 对象本身。
   不能交给 `v-model`：它会替换掉整个对象，而替换引用不是一次响应式写入 —— 点了 chip
   页面不会有任何反应（连选中态都不亮），详见 CollabView 里同款函数的说明。 */
function onFiltersChange(next: Record<string, string[]>) {
  filters.subject = next.subject ?? []
  filters.grade = next.grade ?? []
  filters.status = next.status ?? []
}

const keyword = ref('')
const page = ref(1)
const filtered = computed(() =>
  docs.value.filter(
    (row) =>
      (filters.subject.length === 0 || filters.subject.includes(row.subject)) &&
      (filters.grade.length === 0 || filters.grade.includes(row.grade)) &&
      (filters.status.length === 0 || filters.status.includes(TEACH_DOC_STATUS_TEXT[row.status])) &&
      (!keyword.value || row.name.includes(keyword.value) || row.knowledge.some((k) => k.includes(keyword.value))),
  ),
)
const rows = computed(() => filtered.value.slice((page.value - 1) * 9, page.value * 9))

const questionCountOf = (row: TeachDoc) => row.blocks.reduce((sum, block) => sum + block.questionIds.length, 0)

/* ================= 新建 ================= */

const createOpen = ref(false)
const createForm = reactive({ name: '', subject: '数学', grade: '高一', textbook: '', knowledgeText: '', template: 'basic' })

function openCreate() {
  createForm.name = ''
  createForm.subject = pick(subjects.value, '数学')
  createForm.grade = pick(grades.value, '高一')
  createForm.textbook = ''
  createForm.knowledgeText = ''
  createForm.template = 'basic'
  createOpen.value = true
}

/**
 * 「创建并开始编辑」。
 *
 * 空白页签在**点击那一刻**就占下来（手势有效期内），保存完成后再落位 ——
 * 等 `await` 回来再开会被当成弹窗拦掉（见 utils/teach-edit.ts）。校验不过时把占下的页签关掉，
 * 不留一个空白页给用户。
 */
async function onCreateSubmit() {
  const tab = openBlankTab()
  await submitCreate(tab)
}

async function submitCreate(tab?: Window | null) {
  if (createForm.name.trim().length < 2) {
    tab?.close()
    showToast('讲义名称须为 2-50 字', 'error')
    return
  }
  const template = LECTURE_TEMPLATES.find((row) => row.key === createForm.template) ?? LECTURE_TEMPLATES[0]
  saving.value = true
  try {
    const created = await saveTeachDoc({
      kind: 'lecture',
      name: createForm.name.trim(),
      subject: createForm.subject,
      grade: createForm.grade,
      textbook: createForm.textbook,
      knowledge: createForm.knowledgeText.split(/[、,，\s]+/).map((row) => row.trim()).filter(Boolean),
      blocks: makeBlocks(template.blocks),
      slides: [],
      status: 'draft',
    })
    createOpen.value = false
    await loadList()
    showToast('讲义已创建，可开始编辑', 'success')
    /* 万一被拦（没有 tab），退回同页签跳转，不能让老师点了没反应 */
    if (!openTeachEdit('lecture', created.id, tab)) router.push(teachEditHref('lecture', created.id))
  } catch (error) {
    tab?.close()
    showToast(error instanceof Error ? error.message : '创建失败', 'error')
  } finally {
    saving.value = false
  }
}

/* ================= 行内动作 ================= */

async function onDuplicate(row: TeachDoc) {
  const tab = openBlankTab()
  try {
    const copy = await duplicateTeachDoc(row.id)
    await loadList()
    showToast('已复制一份副本（草稿）', 'success')
    if (!openTeachEdit('lecture', copy.id, tab)) router.push(teachEditHref('lecture', copy.id))
  } catch (error) {
    tab?.close()
    showToast(error instanceof Error ? error.message : '复制失败', 'error')
  }
}

async function onDelete(row: TeachDoc) {
  if (!(await appConfirm(`删除《${row.name}》？将进入回收站保留 30 天`, { type: 'danger' }))) return
  await deleteTeachDoc(row.id)
  await loadList()
  showToast('已移入回收站', 'success')
}

async function loadList() {
  docs.value = await fetchTeachDocs('lecture')
}

onMounted(async () => {
  loading.value = true
  try {
    await Promise.all([ensure(), loadList()])
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="page">
    <AppPageHeader desc="按「学习目标 → 知识点讲解 → 典型例题 → 随堂练习 → 课堂小结 → 课后作业」组织课堂内容，可直接关联题库题目并打印。">
      <template #actions>
        <button v-if="canSee('/teach/courseware')" class="btn btn-ghost" @click="router.push('/teach/courseware')"><AppIcon name="presentation" :size="15" /> 切换课件</button>
        <button class="btn btn-primary" @click="openCreate"><AppIcon name="plus" :size="15" /> 新建讲义</button>
      </template>
    </AppPageHeader>

    <AppFilterPanel :rows="FILTER_ROWS" :model-value="filters" @update:model-value="onFiltersChange" />

    <div class="panel">
      <!-- 工具条自带 14/18 的内边距，与下方栅格 / 分页的边距对齐 -->
      <div class="list-head">
        <AppListToolbar v-model="keyword" placeholder="名称 / 知识点" />
      </div>

      <div class="te-grid">
        <div v-for="row in rows" :key="row.id" class="te-card">
          <div class="te-card-top">
            <h3>{{ row.name }}</h3>
            <span class="tag" :class="row.status === 'published' ? 'tag-green' : 'tag-gray'">
              {{ TEACH_DOC_STATUS_TEXT[row.status] }}
            </span>
          </div>
          <p class="te-card-meta">
            {{ row.grade }} · {{ row.subject }}<template v-if="row.textbook"> · {{ row.textbook }}</template>
            <template v-if="row.chapter"> · {{ row.chapter }}</template>
          </p>
          <div class="te-card-tags">
            <span v-for="k in row.knowledge.slice(0, 3)" :key="k" class="tag tag-gray">{{ k }}</span>
            <span v-if="row.sharedSquare" class="tag tag-blue">已共享广场</span>
          </div>
          <p class="te-card-foot">
            {{ row.blocks.length }} 个段落 · {{ questionCountOf(row) }} 题 · {{ row.views }} 次浏览 · {{ row.owner }} ·
            {{ row.updatedAt }}
          </p>
          <div class="op-group">
            <!-- 编辑一律新页签：锚点导航不会被当成弹窗拦，还自带中键 / Ctrl+点击 -->
            <a class="mini-btn" :href="teachEditHref('lecture', row.id)" target="_blank" rel="noopener">编辑</a>
            <button class="mini-btn" @click="onDuplicate(row)">复制</button>
            <button class="mini-btn danger" @click="onDelete(row)">删除</button>
          </div>
        </div>
      </div>
      <p v-if="!rows.length" class="empty-row">{{ loading ? '正在载入…' : '暂无讲义，点击右上角新建' }}</p>
      <AppPagination :total="filtered.length" v-model:page="page" :page-size="9" />
    </div>

    <!-- 新建讲义 -->
    <AppModal v-if="createOpen" title="新建讲义" :width="620" @close="createOpen = false">
      <div class="f-field">
        <label class="f-label">讲义名称<span class="req">*</span></label>
        <input v-model="createForm.name" class="f-input" maxlength="50" placeholder="例如：函数的单调性 · 课堂讲义" />
      </div>
      <div class="f-field row3">
        <div>
          <label class="f-label">学科</label>
          <select v-model="createForm.subject" class="f-select">
            <option v-for="s in subjects" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
        <div>
          <label class="f-label">年级</label>
          <select v-model="createForm.grade" class="f-select">
            <option v-for="g in grades" :key="g" :value="g">{{ g }}</option>
          </select>
        </div>
        <div>
          <label class="f-label">教材版本</label>
          <input v-model="createForm.textbook" class="f-input" placeholder="如：人教 A 版 必修一" />
        </div>
      </div>
      <div class="f-field">
        <label class="f-label">知识点（顿号分隔）</label>
        <input v-model="createForm.knowledgeText" class="f-input" placeholder="如：单调性、函数性质" />
      </div>
      <div class="f-field" style="margin-bottom: 0">
        <label class="f-label">选用模板</label>
        <div class="te-tpl-list">
          <button
            v-for="row in LECTURE_TEMPLATES"
            :key="row.key"
            class="te-tpl"
            :class="{ on: createForm.template === row.key }"
            type="button"
            @click="createForm.template = row.key"
          >
            <b>{{ row.name }}<AppIcon v-if="createForm.template === row.key" name="check" :size="13" /></b>
            <span>{{ row.desc }}</span>
          </button>
        </div>
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="createOpen = false">取消</button>
        <button class="btn btn-primary" :disabled="saving" @click="onCreateSubmit">创建并开始编辑</button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
/* 列表工具条与面板左右同边距（表格 / 栅格满幅，内边距给在工具条这一层） */
.list-head { padding: 14px 18px 0; }

.te-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; padding: 0 18px 4px; }
.te-card {
  border: 1.5px solid var(--border);
  border-radius: 12px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.te-card:hover { border-color: var(--brand); box-shadow: var(--shadow); }
.te-card-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.te-card-top h3 { font-size: 14px; font-weight: 700; line-height: 1.5; }
.te-card-meta { font-size: 12px; color: var(--sub); }
.te-card-tags { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; }
.te-card-foot { font-size: 11.5px; color: var(--sub); }
.row3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.te-tpl-list { display: flex; flex-direction: column; gap: 8px; }
.te-tpl {
  text-align: left;
  border: 1.5px solid var(--border);
  border-radius: 11px;
  background: #fff;
  padding: 9px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.te-tpl.on { border-color: var(--brand); background: var(--brand-soft); }
.te-tpl b { display: flex; align-items: center; gap: 5px; font-size: 13px; color: var(--ink); }
.te-tpl.on b { color: var(--brand-deep); }
.te-tpl span { font-size: 11.5px; color: var(--sub); }
</style>
