<script setup lang="ts">
/**
 * 教案（教学设计）— **列表页**。
 *
 * 编辑不在这里：教案编辑器已经拆成独立的全屏工作台（`PlanEditView`，路由 `/teach/plan/edit`），
 * 与试卷编辑同构 —— 左目录 / 中纸面 / 右工具条那一套要尽量宽的画布，套在带侧边栏的
 * AppLayout 里 A4 纸展不开。所以本页只做一件事：**把稿子列清楚、把入口给到**。
 *
 * 列表与编辑之间的两条约定：
 * - 点名称 / 「编辑」一律**新页签**打开编辑器（见 utils/teach-edit.ts）：改完还要回这张列表
 *   接着处理下一份，在当前页签里跳过去等于把来路弄丢（返回要重新筛选、重新翻页）。
 * - 编辑器保存后本页看不到变化，所以窗口重新获得焦点时重取一次数据（mock 数据跨页签共享）。
 *
 * 教案与讲义的本质区别：讲义写「讲什么」，教案写「怎么教、为什么这么教」。列表上的字段
 * （年级 / 学科 / 教材 / 知识点 / 来源）就是为「按备课场景把稿子筛出来」服务的。
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AppFilterPanel, AppIcon, AppListToolbar, AppPageHeader, RichTextViewer, TEACH_DOC_SOURCE_TEXT, TEACH_DOC_STATUS_TEXT, appConfirm, showToast, AppModal, AppPagination } from '@aiteach/shared'
import type { FilterRowDef, TeachDoc, TeachDocSource } from '@aiteach/shared'

import { openBlankTab, openTeachEdit, teachEditHref } from '@/utils/teach-edit'
import { useMenuAccess } from '@/composables/useVisibleMenus'
import { docToHtml } from './doc-content'
import { deleteTeachDoc, duplicateTeachDoc, fetchTeachDocs, saveTeachDoc } from '@/api/org'
import { useBaseData } from '@aiteach/business-common'
import { PLAN_TEMPLATES, makePlan } from './teach-templates'

const route = useRoute()
const router = useRouter()
/* 「切换学案」这类跨类型的入口跟着菜单可见性走：标准版没有学案，按钮也不该在 */
const { canSee } = useMenuAccess()
const { subjects, grades, ensure, pick } = useBaseData()

const docs = ref<TeachDoc[]>([])
const loading = ref(true)
const saving = ref(false)

/* ================= 列表 ================= */

/**
 * 搜索条件与筛选。
 *
 * 年级 / 学科 / 教材 / 来源 四个条件都是**单选 chip**（`multiple: false`）：它们是「我在看哪一类」
 * 的口径，多选出来的结果集没有语义（同时看高一和高二、同时看个人和平台，老师也没法据此做决定）。
 * 知识点相反 —— 它天生是多个标签的组合，而且候选可能上百个，chip 铺不下，所以走**弹出选择**
 * （见 knowledgePickOpen），选中值仍进同一份 `filters.knowledge`。
 *
 * 选项一律**从当前列表数据里现取**（而不是从基础字典取）：字典里有但一份稿子都没用过的年级，
 * 摆出来只会点了没结果；而历史数据里可能存在字典里已没有的值，现取才筛得到。
 */
const uniq = (list: Array<string | undefined>) =>
  Array.from(new Set(list.map((row) => (row ?? '').trim()).filter(Boolean))).sort()

const gradeOptions = computed(() => uniq(docs.value.map((row) => row.grade)))
const subjectOptions = computed(() => uniq(docs.value.map((row) => row.subject)))
const textbookOptions = computed(() => uniq(docs.value.map((row) => row.textbook)))
const sourceOptions = computed(() => Object.values(TEACH_DOC_SOURCE_TEXT))
/** 全部知识点（弹出选择器的候选） */
const knowledgeOptions = computed(() => uniq(docs.value.flatMap((row) => row.knowledge)))

const FILTER_ROWS = computed<FilterRowDef[]>(() => [
  { key: 'grade', label: '年级', options: gradeOptions.value, multiple: false },
  { key: 'subject', label: '学科', options: subjectOptions.value, multiple: false },
  { key: 'textbook', label: '适配教材', options: textbookOptions.value, multiple: false, collapsible: true },
  { key: 'source', label: '来源', options: sourceOptions.value, multiple: false },
])
const filters = reactive<Record<string, string[]>>({ grade: [], subject: [], textbook: [], source: [], knowledge: [] })

/* AppFilterPanel 回传整份筛选值（覆盖式回写），逐 key 写回这份 reactive 对象本身。
   不能交给 `v-model`：它会替换掉整个对象，而替换引用不是一次响应式写入 —— 点了 chip
   页面不会有任何反应（连选中态都不亮），详见 CollabView 里同款函数的说明。 */
function onFiltersChange(next: Record<string, string[]>) {
  filters.grade = next.grade ?? []
  filters.subject = next.subject ?? []
  filters.textbook = next.textbook ?? []
  filters.source = next.source ?? []
  /* 知识点由弹出选择器维护，面板里没有它这一行，回写时不能把它冲掉 */
  filters.knowledge = next.knowledge ?? filters.knowledge
}

/** 名称模糊搜索（左上角输入框） */
const keyword = ref('')

/** 来源显示文案：老数据没有这个字段，一律按「个人」处理 */
function sourceOf(row: TeachDoc): TeachDocSource {
  return row.source ?? 'personal'
}
function sourceText(row: TeachDoc): string {
  return TEACH_DOC_SOURCE_TEXT[sourceOf(row)]
}
/** 校本 / 平台稿是学校与平台的定版，只读；只有个人稿可改 */
function canEdit(row: TeachDoc): boolean {
  return sourceOf(row) === 'personal'
}

/** 一页几行。表格比卡片窄，一页放得下 10 行（旧卡片是 9） */
const PAGE_SIZE = 10

const page = ref(1)
const filtered = computed(() =>
  docs.value.filter((row) => {
    if (filters.grade.length && !filters.grade.includes(row.grade)) return false
    if (filters.subject.length && !filters.subject.includes(row.subject)) return false
    if (filters.textbook.length && !filters.textbook.includes(row.textbook ?? '')) return false
    if (filters.source.length && !filters.source.includes(sourceText(row))) return false
    /* 知识点是「或」：选中两个知识点时，命中任一即算命中（老师的心智是「这两块我都想看」） */
    if (filters.knowledge.length && !filters.knowledge.some((k) => row.knowledge.includes(k))) return false
    if (keyword.value && !row.name.includes(keyword.value.trim())) return false
    return true
  }),
)
const rows = computed(() => filtered.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE))

/* ================= 知识点弹出选择 ================= */

const knowledgePickOpen = ref(false)
const knowledgePick = ref<string[]>([])

function openKnowledgePick() {
  knowledgePick.value = [...filters.knowledge]
  knowledgePickOpen.value = true
}
function submitKnowledgePick() {
  filters.knowledge = [...knowledgePick.value]
  page.value = 1
  knowledgePickOpen.value = false
}

/* ================= 详情（查看） ================= */

const detailRow = ref<TeachDoc | null>(null)
function openDetail(row: TeachDoc) {
  detailRow.value = row
}

/* ================= 打开编辑页（新页签） ================= */

/**
 * 点教案名称 / 「编辑」。
 *
 * 一律**新页签**：改完还要回这张列表接着处理下一份（见 utils/teach-edit.ts）。
 * 校本 / 平台稿不允许进编辑页 —— 名称点了就开详情，而不是给一个「点进去发现改不了」的探针。
 */
function openEditor(row: TeachDoc, tab?: Window | null) {
  if (!canEdit(row)) {
    tab?.close()
    openDetail(row)
    return
  }
  if (!openTeachEdit('plan', row.id, tab)) router.push(teachEditHref('plan', row.id))
}

/* ================= 新建 ================= */

const createOpen = ref(false)
const createForm = reactive({
  name: '',
  subject: '数学',
  grade: '高一',
  textbook: '',
  knowledgeText: '',
  template: 'new',
})

function openCreate() {
  createForm.name = ''
  createForm.subject = pick(subjects.value, '数学')
  createForm.grade = pick(grades.value, '高一')
  createForm.textbook = ''
  createForm.knowledgeText = ''
  createForm.template = 'new'
  createOpen.value = true
}

/**
 * 「创建并开始撰写」。
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
    showToast('教案名称须为 2-50 字', 'error')
    return
  }
  const template = PLAN_TEMPLATES.find((row) => row.key === createForm.template) ?? PLAN_TEMPLATES[0]
  saving.value = true
  try {
    const created = await saveTeachDoc({
      kind: 'plan',
      name: createForm.name.trim(),
      subject: createForm.subject,
      grade: createForm.grade,
      textbook: createForm.textbook,
      knowledge: createForm.knowledgeText.split(/[、,，\s]+/).map((row) => row.trim()).filter(Boolean),
      blocks: [],
      slides: [],
      plan: makePlan(template),
      status: 'draft',
    })
    createOpen.value = false
    await loadList()
    showToast('教案已创建，可开始撰写', 'success')
    /* 编辑页开在新页签；万一被拦，退回同页签跳转，不能让老师点了没反应 */
    if (!openTeachEdit('plan', created.id, tab)) router.push(teachEditHref('plan', created.id))
  } catch (error) {
    tab?.close()
    showToast(error instanceof Error ? error.message : '创建失败', 'error')
  } finally {
    saving.value = false
  }
}

/* ================= 列表行操作 ================= */

async function onDuplicate(row: TeachDoc) {
  await duplicateTeachDoc(row.id)
  await loadList()
  showToast('已复制一份副本（草稿）', 'success')
}

async function onDelete(row: TeachDoc) {
  if (!(await appConfirm(`删除《${row.name}》？将进入回收站保留 30 天`, { type: 'danger' }))) return
  await deleteTeachDoc(row.id)
  await loadList()
  showToast('已移入回收站', 'success')
}

async function loadList() {
  docs.value = await fetchTeachDocs('plan')
}

/**
 * 从编辑页签切回列表时重取一次数据。
 *
 * 编辑页开在新页签，保存发生在那边 —— 这边不刷新就会看到「刚改的名字没变」，
 * 而 mock 数据在标签页之间是共享的（见 shared/mock/persist.ts），所以重取一定拿得到最新值。
 */
function onWindowFocus() {
  void loadList()
}

/**
 * 旧地址兼容：`/teach/plan?id=3` 是拆分之前的编辑器地址（书签、演示脚本、旧文档里都有）。
 * 直接送到新的编辑页，不必让用户自己找。
 */
watch(
  () => route.query.id,
  (id) => {
    if (id) void router.replace({ path: '/teach/plan/edit', query: { id: String(id) } })
  },
  { immediate: true },
)

onMounted(async () => {
  loading.value = true
  try {
    await Promise.all([ensure(), loadList()])
  } finally {
    loading.value = false
  }
  window.addEventListener('focus', onWindowFocus)
})

onBeforeUnmount(() => window.removeEventListener('focus', onWindowFocus))
</script>

<template>
  <!-- ================= 列表 ================= -->
  <div class="page">
    <AppPageHeader desc="按「三维目标 → 重难点 → 教学过程 → 板书 → 反思」撰写教学设计，过程按环节写清教师活动、学生活动与设计意图，可直接关联题库题目并打印。">
      <template #actions>
        <button v-if="canSee('/teach/guide')" class="btn btn-ghost" @click="router.push('/teach/guide')"><AppIcon name="clipboard" :size="15" /> 切换学案</button>
        <button class="btn btn-primary" @click="openCreate"><AppIcon name="plus" :size="15" /> 新建教案</button>
      </template>
    </AppPageHeader>

    <AppFilterPanel :rows="FILTER_ROWS" :model-value="filters" @update:model-value="onFiltersChange">
      <!-- 知识点：候选可能上百个，chip 铺不下，走弹出选择 -->
      <template #extra>
        <div class="pl-kn">
          <span class="pl-kn-label">知识点</span>
          <button class="pl-kn-btn" type="button" :class="{ on: filters.knowledge.length }" @click="openKnowledgePick">
            <AppIcon name="target" :size="14" />
            {{ filters.knowledge.length ? `已选 ${filters.knowledge.length} 个` : '选择知识点' }}
          </button>
          <span v-for="k in filters.knowledge" :key="k" class="tag tag-blue">
            {{ k }}
            <button class="pl-kn-del" type="button" title="移除" @click="filters.knowledge = filters.knowledge.filter((s) => s !== k)">×</button>
          </span>
          <button v-if="filters.knowledge.length" class="pl-kn-clear" type="button" @click="filters.knowledge = []">清空</button>
        </div>
      </template>
    </AppFilterPanel>

    <div class="panel">
      <!-- 左上角：按教案名称模糊筛选。工具条自带 14/18 的内边距，与下方表格 / 分页的边距对齐 -->
      <div class="list-head">
        <AppListToolbar v-model="keyword" placeholder="搜索教案名称" :search-width="280">
          <template #right>
            <span class="f-hint">共 {{ filtered.length }} 份</span>
          </template>
        </AppListToolbar>
      </div>

      <div class="pl-tablewrap">
        <table class="pl-tb">
          <thead>
            <tr>
              <th class="pl-th-name">教案名称</th>
              <th class="pl-th-sm">年级</th>
              <th class="pl-th-sm">学科</th>
              <th class="pl-th-tb">适配教材</th>
              <th class="pl-th-kn">知识点</th>
              <th class="pl-th-sm">来源</th>
              <th class="pl-th-op">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.id">
              <td class="pl-td-name">
                <!-- 名称可点击：个人稿进编辑页（新页签），校本 / 平台稿进详情 -->
                <a class="pl-name" href="#" :title="row.name" @click.prevent="openEditor(row)">
                  {{ row.name }}
                  <AppIcon v-if="canEdit(row)" name="edit" :size="13" class="pl-name-ico" />
                  <AppIcon v-else name="eye" :size="13" class="pl-name-ico" />
                </a>
                <span class="tag" :class="row.status === 'published' ? 'tag-green' : 'tag-gray'">
                  {{ TEACH_DOC_STATUS_TEXT[row.status] }}
                </span>
                <span v-if="row.sharedSquare" class="tag tag-blue">已共享</span>
              </td>
              <td>{{ row.grade }}</td>
              <td>{{ row.subject }}</td>
              <td class="pl-ellipsis" :title="row.textbook">{{ row.textbook || '—' }}</td>
              <!-- 知识点：单行不换行、超出省略，鼠标悬浮用 title 展示全部 -->
              <td class="pl-td-kn">
                <div class="pl-kn-tags" :title="row.knowledge.join('、')">
                  <span v-for="k in row.knowledge" :key="k" class="tag tag-gray">{{ k }}</span>
                  <span v-if="!row.knowledge.length" class="f-hint">—</span>
                </div>
              </td>
              <td>
                <span
                  class="tag"
                  :class="sourceOf(row) === 'personal' ? 'tag-gray' : sourceOf(row) === 'school' ? 'tag-orange' : 'tag-blue'"
                >
                  {{ sourceText(row) }}
                </span>
              </td>
              <td class="pl-td-op">
                <div class="op-group">
                  <button class="mini-btn" @click="openDetail(row)">查看</button>
                  <button class="mini-btn" @click="onDuplicate(row)">复制</button>
                  <button v-if="canEdit(row)" class="mini-btn" @click="openEditor(row)">编辑</button>
                  <button v-if="canEdit(row)" class="mini-btn danger" @click="onDelete(row)">删除</button>
                </div>
              </td>
            </tr>
            <tr v-if="!rows.length">
              <td colspan="7" class="empty-row">{{ loading ? '正在载入…' : '没有符合条件的教案' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <AppPagination :total="filtered.length" v-model:page="page" :page-size="PAGE_SIZE" />
    </div>

    <!-- 知识点弹出选择 -->
    <AppModal v-if="knowledgePickOpen" title="选择知识点" :width="640" @close="knowledgePickOpen = false">
      <p class="f-hint" style="margin-bottom: 10px">选中两个以上时，命中任一知识点的教案都会列出（「或」的关系）。</p>
      <div v-if="knowledgeOptions.length" class="pl-kn-pool">
        <button
          v-for="k in knowledgeOptions"
          :key="k"
          class="pl-kn-chip"
          :class="{ on: knowledgePick.includes(k) }"
          type="button"
          @click="knowledgePick = knowledgePick.includes(k) ? knowledgePick.filter((s) => s !== k) : [...knowledgePick, k]"
        >
          {{ k }}
        </button>
      </div>
      <p v-else class="empty-row">当前还没有任何教案填过知识点</p>
      <template #footer>
        <button class="btn btn-ghost" @click="knowledgePick = []">清空</button>
        <button class="btn btn-primary" @click="submitKnowledgePick">确定（{{ knowledgePick.length }}）</button>
      </template>
    </AppModal>

    <!-- 详情（查看）：校本 / 平台稿的只读入口，也是个人稿的「先看看」 -->
    <AppModal v-if="detailRow" :title="detailRow.name" :width="900" @close="detailRow = null">
      <div class="pl-detail-meta">
        <span class="tag tag-blue">{{ detailRow.subject }}</span>
        <span class="tag tag-gray">{{ detailRow.grade }}</span>
        <span v-if="detailRow.textbook" class="tag tag-gray">{{ detailRow.textbook }}</span>
        <span class="tag" :class="sourceOf(detailRow) === 'personal' ? 'tag-gray' : 'tag-orange'">{{ sourceText(detailRow) }}</span>
        <span class="tag" :class="detailRow.status === 'published' ? 'tag-green' : 'tag-gray'">{{ TEACH_DOC_STATUS_TEXT[detailRow.status] }}</span>
        <span v-for="k in detailRow.knowledge" :key="k" class="tag tag-gray">{{ k }}</span>
        <span class="f-hint">{{ detailRow.owner }} · {{ detailRow.updatedAt }} · {{ detailRow.views }} 次浏览</span>
      </div>
      <p v-if="!canEdit(detailRow)" class="pl-detail-note">
        这是{{ sourceText(detailRow) }}稿，只读。需要按自己的思路改，请先「复制」一份副本 —— 副本归你个人所有，可自由编辑。
      </p>
      <article class="pl-detail rte-content">
        <RichTextViewer :content="docToHtml(detailRow)" empty="这份教案还没有正文，可在编辑器里撰写或套用模板。" />
      </article>
      <template #footer>
        <button class="btn btn-ghost" @click="onDuplicate(detailRow)">复制一份</button>
        <button v-if="canEdit(detailRow)" class="btn btn-primary" @click="openEditor(detailRow); detailRow = null">
          <AppIcon name="edit" :size="15" /> 去编辑
        </button>
      </template>
    </AppModal>

    <!-- 新建教案 -->
    <AppModal v-if="createOpen" title="新建教案" :width="640" @close="createOpen = false">
      <div class="f-field">
        <label class="f-label">教案名称<span class="req">*</span></label>
        <input v-model="createForm.name" class="f-input" maxlength="50" placeholder="例如：函数的单调性 · 教学设计" />
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
            v-for="row in PLAN_TEMPLATES"
            :key="row.key"
            class="te-tpl"
            :class="{ on: createForm.template === row.key }"
            type="button"
            @click="createForm.template = row.key"
          >
            <b>{{ row.name }}<AppIcon v-if="createForm.template === row.key" name="check" :size="13" /></b>
            <span>{{ row.desc }} · {{ row.periods }} 课时</span>
          </button>
        </div>
      </div>
      <template #footer>
        <span class="pl-tab-hint"><AppIcon name="branch" :size="13" /> 编辑器在新页签打开，这张列表会留在原处</span>
        <button class="btn btn-ghost" @click="createOpen = false">取消</button>
        <button class="btn btn-primary" :disabled="saving" @click="onCreateSubmit">创建并开始撰写</button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
/* 列表工具条与面板左右同边距（表格 / 栅格满幅，内边距给在工具条这一层） */
.list-head { padding: 14px 18px 0; }

/* ===== 列表（表格） =====
   一屏要看清「哪几份、什么年级学科、属于谁」，卡片排不下这些列，所以列表用表格。 */
.pl-tablewrap { padding: 0 18px; overflow-x: auto; }
.pl-tb { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.pl-tb th,
.pl-tb td {
  padding: 9px 10px;
  text-align: left;
  vertical-align: middle;
  border-bottom: 1px solid var(--border);
}
.pl-tb th {
  font-size: 12px;
  font-weight: 700;
  color: var(--sub);
  background: #f8fafc;
  white-space: nowrap;
}
.pl-tb tbody tr:hover { background: #f8fbff; }
.pl-tb tr:last-child td { border-bottom: none; }

.pl-th-name { min-width: 260px; }
.pl-th-sm { width: 84px; white-space: nowrap; }
.pl-th-tb { width: 160px; }
.pl-th-kn { min-width: 220px; }
.pl-th-op { width: 232px; white-space: nowrap; }

.pl-td-name { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.pl-name {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  color: var(--ink);
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
}
.pl-name:hover { color: var(--brand-deep); text-decoration: underline; }
.pl-name-ico { opacity: 0; transition: opacity 0.15s; flex-shrink: 0; }
.pl-name:hover .pl-name-ico { opacity: 0.75; }

/* 单行省略：教材名与知识点都可能很长，换行会把行高撑成三行、表格看着就散了 */
.pl-ellipsis { max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pl-td-kn { max-width: 300px; }
.pl-kn-tags {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: nowrap;
  overflow: hidden;
  white-space: nowrap;
  /* 渐隐右缘，提示「后面还有」；悬浮时由 title 给出全部 */
  mask-image: linear-gradient(90deg, #000 calc(100% - 18px), transparent);
}
.pl-kn-tags .tag { flex-shrink: 0; }

.pl-td-op .op-group { flex-wrap: nowrap; }

/* ===== 知识点筛选 ===== */
.pl-kn { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 4px 0 2px; }
.pl-kn-label { font-size: 12.5px; font-weight: 700; color: var(--ink-2); min-width: 46px; }
.pl-kn-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px;
  border: 1.5px solid var(--border);
  border-radius: 8px;
  background: var(--card);
  color: var(--ink-2);
  font-size: 12.5px;
}
.pl-kn-btn:hover { border-color: var(--brand); color: var(--brand-deep); }
.pl-kn-btn.on { border-color: var(--brand); background: var(--brand-soft); color: var(--brand-deep); }
.pl-kn-del { border: none; background: transparent; color: inherit; opacity: 0.6; margin-left: 2px; font-size: 13px; line-height: 1; }
.pl-kn-del:hover { opacity: 1; }
.pl-kn-clear { border: none; background: transparent; color: var(--sub); font-size: 12px; text-decoration: underline; }

.pl-kn-pool { display: flex; flex-wrap: wrap; gap: 6px; max-height: 320px; overflow-y: auto; }
.pl-kn-chip {
  border: 1.5px solid var(--border);
  border-radius: 999px;
  background: var(--card);
  color: var(--ink-2);
  font-size: 12.5px;
  padding: 4px 12px;
}
.pl-kn-chip:hover { border-color: var(--brand); color: var(--brand-deep); }
.pl-kn-chip.on { border-color: var(--brand); background: var(--brand-soft); color: var(--brand-deep); font-weight: 600; }

/* ===== 详情 ===== */
.pl-detail-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
.pl-detail-note {
  font-size: 12.5px;
  color: var(--warn);
  background: #fff8ea;
  border: 1px solid #f4dcae;
  border-radius: 9px;
  padding: 8px 11px;
  margin-bottom: 12px;
  line-height: 1.7;
}
.pl-detail { font-size: 13.5px; line-height: 1.9; color: var(--ink); }

.pl-tab-hint {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-right: auto;
  font-size: 11.5px;
  color: var(--sub);
}

.row3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.te-tpl-list { display: flex; flex-direction: column; gap: 8px; }
.te-tpl {
  text-align: left; border: 1.5px solid var(--border); border-radius: 11px;
  background: #fff; padding: 9px 12px; display: flex; flex-direction: column; gap: 4px;
}
.te-tpl.on { border-color: var(--brand); background: var(--brand-soft); }
.te-tpl b { display: flex; align-items: center; gap: 5px; font-size: 13px; color: var(--ink); }
.te-tpl.on b { color: var(--brand-deep); }
.te-tpl span { font-size: 11.5px; color: var(--sub); }
</style>
