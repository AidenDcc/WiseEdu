<script setup lang="ts">
/**
 * 讲义（列表 + 编辑器）。
 *
 * 与「试卷编辑」的分工：试卷是**题目容器**（一张卷从头到尾都是题），讲义是**课堂脚本**
 * （讲解文字 + 少量例题 + 练习）。所以讲义编辑器的主体是段落流：每段有类型（学习目标 /
 * 知识点讲解 / 典型例题 / 随堂练习 / 课堂小结 / 课后作业）、富文本正文，以及可选关联的题库题目。
 *
 * 列表与编辑合在一个路由里（`?id=` 切换），是因为「编辑讲义」不是一个独立的常驻入口：
 * 教师的心智是「打开这份讲义」，而不是「先到讲义编辑页，再选一份讲义」。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AppFilterPanel,
  AppIcon,
  AppListToolbar,
  AppPageHeader,
  BLOCK_KIND_TEXT,
  LECTURE_BLOCK_TEXT,
  RichTextViewer,
  TEACH_DOC_STATUS_TEXT,
  showToast,
  truncateRich,
} from '@aiteach/shared'
import type { FilterRowDef, LectureBlock, LectureBlockKind, OrgQuestion, TeachDoc } from '@aiteach/shared'
import AppModal from '@/components/ui/AppModal.vue'
import AppPagination from '@/components/ui/AppPagination.vue'
import RichTextEditor from '@/components/ui/RichTextEditor.vue'
import {
  deleteTeachDoc,
  duplicateTeachDoc,
  fetchQuestions,
  fetchTeachDocs,
  saveTeachDoc,
  toggleTeachDocPublish,
} from '@/api/org'
import QuestionOptions from '@/components/question/QuestionOptions.vue'
import { optionColumnsOf } from '@/utils/question-card'
import { useBaseData } from '@/composables/useBaseData'
import { LECTURE_TEMPLATES, makeBlocks } from './teach-templates'

const route = useRoute()
const router = useRouter()
const { subjects, grades, difficulties, ensure, pick, withCurrent } = useBaseData()

const docs = ref<TeachDoc[]>([])
const questions = ref<OrgQuestion[]>([])
const loading = ref(true)
const saving = ref(false)

const editingId = computed(() => Number(route.query.id ?? 0))
const doc = ref<TeachDoc | null>(null)

/* ================= 列表 ================= */

const FILTER_ROWS = computed<FilterRowDef[]>(() => [
  { key: 'subject', label: '学科', options: subjects.value, multiple: false },
  { key: 'grade', label: '年级', options: grades.value, multiple: false },
  { key: 'status', label: '状态', options: Object.values(TEACH_DOC_STATUS_TEXT), multiple: false },
])
const filters = reactive<Record<string, string[]>>({ subject: [], grade: [], status: [] })
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

async function submitCreate() {
  if (createForm.name.trim().length < 2) {
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
    router.push(`/teach/lecture?id=${created.id}`)
  } catch (error) {
    showToast(error instanceof Error ? error.message : '创建失败', 'error')
  } finally {
    saving.value = false
  }
}

/* ================= 编辑器 ================= */

const activeBlockId = ref<number>(0)
const activeBlock = computed<LectureBlock | null>(() => doc.value?.blocks.find((row) => row.id === activeBlockId.value) ?? null)

async function openDoc(id: number) {
  const found = docs.value.find((row) => row.id === id)
  if (!found) {
    showToast('讲义不存在或已删除', 'error')
    router.replace('/teach/lecture')
    return
  }
  /* 深拷贝进编辑态：直接改列表里的对象会让「取消」无从实现，也污染列表展示 */
  doc.value = JSON.parse(JSON.stringify(found)) as TeachDoc
  activeBlockId.value = doc.value.blocks[0]?.id ?? 0
}

watch(editingId, (id) => {
  if (id) void openDoc(id)
})

function backToList() {
  doc.value = null
  router.push('/teach/lecture')
}

function addBlock(kind: LectureBlockKind) {
  if (!doc.value) return
  const block: LectureBlock = {
    id: Date.now(),
    kind,
    title: LECTURE_BLOCK_TEXT[kind],
    body: '<p></p>',
    questionIds: [],
  }
  doc.value.blocks.push(block)
  activeBlockId.value = block.id
}

function removeBlock(id: number) {
  if (!doc.value) return
  const index = doc.value.blocks.findIndex((row) => row.id === id)
  if (index < 0) return
  doc.value.blocks.splice(index, 1)
  if (activeBlockId.value === id) activeBlockId.value = doc.value.blocks[Math.max(0, index - 1)]?.id ?? 0
}

function moveBlock(id: number, delta: number) {
  if (!doc.value) return
  const index = doc.value.blocks.findIndex((row) => row.id === id)
  const target = index + delta
  if (index < 0 || target < 0 || target >= doc.value.blocks.length) return
  const [row] = doc.value.blocks.splice(index, 1)
  doc.value.blocks.splice(target, 0, row)
}

/* ================= 关联题目 ================= */

const bankFilter = reactive({ type: '', difficulty: '', keyword: '' })
const bankPool = computed(() =>
  questions.value.filter(
    (row) =>
      row.status === 'approved' &&
      (!bankFilter.type || row.type === bankFilter.type) &&
      (!bankFilter.difficulty || row.difficulty === bankFilter.difficulty) &&
      (!bankFilter.keyword || row.stem.includes(bankFilter.keyword)),
  ),
)

function linkQuestion(questionId: number) {
  if (!activeBlock.value) {
    showToast('请先选中一个段落', 'error')
    return
  }
  if (activeBlock.value.questionIds.includes(questionId)) {
    showToast('该题已在当前段落中', 'error')
    return
  }
  activeBlock.value.questionIds.push(questionId)
}

function unlinkQuestion(questionId: number) {
  if (!activeBlock.value) return
  activeBlock.value.questionIds = activeBlock.value.questionIds.filter((row) => row !== questionId)
}

const itemOf = (id: number) => questions.value.find((row) => row.id === id)

/* ================= 保存 / 发布 / 打印 / 预览 ================= */

async function save() {
  if (!doc.value) return
  if (doc.value.name.trim().length < 2) {
    showToast('讲义名称须为 2-50 字', 'error')
    return
  }
  saving.value = true
  try {
    const saved = await saveTeachDoc({
      id: doc.value.id,
      kind: 'lecture',
      name: doc.value.name.trim(),
      subject: doc.value.subject,
      grade: doc.value.grade,
      textbook: doc.value.textbook,
      knowledge: doc.value.knowledge,
      blocks: doc.value.blocks,
      slides: [],
      status: doc.value.status,
    })
    doc.value.id = saved.id
    await loadList()
    showToast('讲义已保存', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '保存失败', 'error')
  } finally {
    saving.value = false
  }
}

async function publish() {
  if (!doc.value) return
  if (doc.value.id && !docs.value.some((row) => JSON.stringify(row) === JSON.stringify(doc.value))) await save()
  try {
    const next = await toggleTeachDocPublish(doc.value.id)
    doc.value.status = next.status
    await loadList()
    showToast(next.status === 'published' ? '已发布，机构内教师可直接取用' : '已下架', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '操作失败', 'error')
  }
}

const previewOpen = ref(false)

function onPrint() {
  window.print()
}

/* ================= 列表行操作 ================= */

async function onDuplicate(row: TeachDoc) {
  await duplicateTeachDoc(row.id)
  await loadList()
  showToast('已复制一份副本（草稿）', 'success')
}

async function onDelete(row: TeachDoc) {
  if (!window.confirm(`删除《${row.name}》？将进入回收站保留 30 天`)) return
  await deleteTeachDoc(row.id)
  await loadList()
  showToast('已移入回收站', 'success')
}

/* ================= 数据 ================= */

async function loadList() {
  docs.value = await fetchTeachDocs('lecture')
}

onMounted(async () => {
  loading.value = true
  try {
    await Promise.all([ensure(), loadList(), fetchQuestions().then((rows) => (questions.value = rows))])
    if (editingId.value) await openDoc(editingId.value)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <!-- ================= 编辑器 ================= -->
  <div v-if="doc" class="te-shell">
    <div class="te-head panel">
      <button class="te-back" type="button" @click="backToList"><AppIcon name="chevron-left" :size="15" /></button>
      <div class="te-head-main">
        <input v-model="doc.name" class="te-title" maxlength="50" placeholder="讲义名称" />
        <div class="te-head-meta">
          <select v-model="doc.subject" class="f-select">
            <option v-for="s in withCurrent(subjects, doc.subject)" :key="s" :value="s">{{ s }}</option>
          </select>
          <select v-model="doc.grade" class="f-select">
            <option v-for="g in withCurrent(grades, doc.grade)" :key="g" :value="g">{{ g }}</option>
          </select>
          <span class="tag" :class="doc.status === 'published' ? 'tag-green' : 'tag-gray'">
            {{ TEACH_DOC_STATUS_TEXT[doc.status] }}
          </span>
          <span class="f-hint">{{ doc.blocks.length }} 个段落 · 更新于 {{ doc.updatedAt }}</span>
        </div>
      </div>
      <div class="op-group">
        <button class="btn btn-ghost btn-sm" @click="previewOpen = true"><AppIcon name="eye" :size="14" /> 预览</button>
        <button class="btn btn-ghost btn-sm" @click="onPrint"><AppIcon name="print" :size="14" /> 打印</button>
        <button class="btn btn-ghost btn-sm" @click="publish">
          <AppIcon name="upload" :size="14" /> {{ doc.status === 'published' ? '下架' : '发布' }}
        </button>
        <button class="btn btn-primary btn-sm" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存' }}</button>
      </div>
    </div>

    <div class="te-body">
      <!-- 左：段落大纲 -->
      <aside class="panel te-outline">
        <div class="section-title" style="margin-bottom: 10px">段落</div>
        <div
          v-for="(block, i) in doc.blocks"
          :key="block.id"
          class="te-ol-row"
          :class="{ on: activeBlockId === block.id }"
          @click="activeBlockId = block.id"
        >
          <span class="te-ol-no">{{ i + 1 }}</span>
          <div class="te-ol-main">
            <b>{{ block.title || BLOCK_KIND_TEXT[block.kind] }}</b>
            <em>{{ BLOCK_KIND_TEXT[block.kind] }}<template v-if="block.questionIds.length"> · {{ block.questionIds.length }} 题</template></em>
          </div>
          <div class="te-ol-ops" @click.stop>
            <button class="te-icon" type="button" title="上移" @click="moveBlock(block.id, -1)">↑</button>
            <button class="te-icon" type="button" title="下移" @click="moveBlock(block.id, 1)">↓</button>
            <button class="te-icon danger" type="button" title="删除" @click="removeBlock(block.id)">×</button>
          </div>
        </div>

        <div class="te-add">
          <span class="f-hint">新增段落</span>
          <div class="chips">
            <button
              v-for="(text, kind) in LECTURE_BLOCK_TEXT"
              :key="kind"
              class="k-chip"
              type="button"
              @click="addBlock(kind as LectureBlockKind)"
            >
              + {{ text }}
            </button>
          </div>
        </div>
      </aside>

      <!-- 中：段落编辑 -->
      <main class="te-main">
        <div v-if="activeBlock" class="panel te-edit">
          <div class="te-edit-head">
            <span class="tag tag-blue">{{ BLOCK_KIND_TEXT[activeBlock.kind] }}</span>
            <input v-model="activeBlock.title" class="f-input" style="max-width: 320px" placeholder="段落标题" />
          </div>
          <RichTextEditor v-model="activeBlock.body" :subject="doc.subject" :min-height="220" placeholder="在此撰写讲解内容，可插入公式与配图" />

          <div class="te-linked">
            <div class="te-linked-head">
              <b>关联题目</b>
              <span class="f-hint">例题 / 随堂练习可从右侧题库直接加入</span>
            </div>
            <p v-if="!activeBlock.questionIds.length" class="f-hint">本段尚未关联题目</p>
            <div v-for="qid in activeBlock.questionIds" :key="qid" class="te-linked-row">
              <span class="tag tag-gray">{{ itemOf(qid)?.type ?? '题目' }}</span>
              <span class="te-linked-stem">{{ truncateRich(itemOf(qid)?.stem ?? `题目 #${qid}`, 60) }}</span>
              <button class="mini-btn danger" @click="unlinkQuestion(qid)">移除</button>
            </div>
          </div>
        </div>
        <div v-else class="panel te-empty">左侧还没有段落，先「新增段落」</div>
      </main>

      <!-- 右：题库 -->
      <aside class="panel te-bank">
        <div class="section-title" style="margin-bottom: 10px">题库选题</div>
        <select v-model="bankFilter.type" class="f-select" style="margin-bottom: 8px">
          <option value="">全部题型</option>
          <option v-for="t in ['单选', '多选', '判断', '填空', '解答']" :key="t" :value="t">{{ t }}</option>
        </select>
        <select v-model="bankFilter.difficulty" class="f-select" style="margin-bottom: 8px">
          <option value="">全部难度</option>
          <option v-for="d in difficulties" :key="d" :value="d">{{ d }}</option>
        </select>
        <input v-model="bankFilter.keyword" class="f-input" placeholder="搜索题干" style="margin-bottom: 10px" />
        <div class="te-bank-list">
          <div v-for="row in bankPool" :key="row.id" class="te-bank-card">
            <p class="te-bank-stem">{{ truncateRich(row.stem, 54) }}</p>
            <div class="te-bank-foot">
              <span class="f-hint">{{ row.type }} · {{ row.difficulty }}</span>
              <button class="mini-btn" :disabled="activeBlock?.questionIds.includes(row.id)" @click="linkQuestion(row.id)">
                {{ activeBlock?.questionIds.includes(row.id) ? '已加入' : '+ 加入本段' }}
              </button>
            </div>
          </div>
        </div>
      </aside>
    </div>

    <!-- 预览（同时作为打印稿） -->
    <AppModal v-if="previewOpen" :title="doc.name" :width="880" @close="previewOpen = false">
      <div class="te-doc">
        <div class="te-doc-head">
          <h1>{{ doc.name }}</h1>
          <p>{{ doc.subject }} · {{ doc.grade }}<template v-if="doc.textbook"> · {{ doc.textbook }}</template></p>
        </div>
        <section v-for="(block, i) in doc.blocks" :key="block.id" class="te-doc-block">
          <h2><span class="te-doc-no">{{ i + 1 }}.</span> {{ block.title || BLOCK_KIND_TEXT[block.kind] }}</h2>
          <RichTextViewer :content="block.body" />
          <div v-if="block.questionIds.length" class="te-doc-qs">
            <div v-for="(qid, qi) in block.questionIds" :key="qid" class="te-doc-q">
              <p class="te-doc-stem">
                <b>{{ qi + 1 }}．</b>
                <RichTextViewer v-if="itemOf(qid)" :content="itemOf(qid)!.stem" tag="span" />
                <span v-if="itemOf(qid)?.type.includes('填空')">______</span>
              </p>
              <!-- 讲义正文里的题目不标正确项（学生版是练习，标出来等于给答案） -->
              <QuestionOptions
                v-if="itemOf(qid)"
                class="te-doc-opts"
                variant="doc"
                :options="itemOf(qid)!.options"
                :columns="optionColumnsOf(itemOf(qid)!)"
              />
            </div>
          </div>
        </section>
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="previewOpen = false">关闭</button>
        <button class="btn btn-primary" @click="onPrint"><AppIcon name="print" :size="14" /> 打印讲义</button>
      </template>
    </AppModal>
  </div>

  <!-- ================= 列表 ================= -->
  <div v-else class="page">
    <AppPageHeader desc="按「学习目标 → 知识点讲解 → 典型例题 → 随堂练习 → 课堂小结 → 课后作业」组织课堂内容，可直接关联题库题目并打印。">
      <template #actions>
        <button class="btn btn-ghost" @click="router.push('/teach/courseware')"><AppIcon name="presentation" :size="15" /> 切换课件</button>
        <button class="btn btn-primary" @click="openCreate"><AppIcon name="plus" :size="15" /> 新建讲义</button>
      </template>
    </AppPageHeader>

    <AppFilterPanel v-model="filters" :rows="FILTER_ROWS" />

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
          <p class="te-card-meta">{{ row.grade }} · {{ row.subject }}<template v-if="row.textbook"> · {{ row.textbook }}</template></p>
          <div class="te-card-tags">
            <span v-for="k in row.knowledge.slice(0, 3)" :key="k" class="tag tag-gray">{{ k }}</span>
            <span v-if="row.sharedSquare" class="tag tag-blue">已共享广场</span>
          </div>
          <p class="te-card-foot">{{ row.blocks.length }} 个段落 · {{ row.views }} 次浏览 · {{ row.owner }} · {{ row.updatedAt }}</p>
          <div class="op-group">
            <button class="mini-btn" @click="router.push(`/teach/lecture?id=${row.id}`)">编辑</button>
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
        <input v-model="createForm.name" class="f-input" maxlength="50" placeholder="例如：函数的单调性 · 新课讲义" />
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
        <input v-model="createForm.knowledgeText" class="f-input" placeholder="如：单调性、函数与导数" />
      </div>
      <div class="f-field">
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
        <button class="btn btn-primary" :disabled="saving" @click="submitCreate">创建并开始编辑</button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.te-shell { display: flex; flex-direction: column; gap: 12px; }
.te-head { display: flex; align-items: center; gap: 12px; padding: 12px 16px; }
.te-back {
  width: 34px; height: 34px; flex-shrink: 0;
  border: 1px solid var(--border); border-radius: 9px;
  background: #fff; color: var(--ink-2);
  display: flex; align-items: center; justify-content: center;
}
.te-back:hover { border-color: var(--brand); color: var(--brand-deep); }
.te-head-main { flex: 1; min-width: 0; }
.te-title {
  width: 100%; border: none; background: transparent;
  font-size: 16px; font-weight: 700; color: var(--ink);
  padding: 2px 4px; border-radius: 7px;
}
.te-title:hover { background: #f4f7fb; }
.te-title:focus { outline: none; box-shadow: 0 0 0 2px var(--brand-soft); }
.te-head-meta { display: flex; align-items: center; gap: 8px; margin-top: 4px; flex-wrap: wrap; }
/* 横向居中的行里，f-hint 自带的 5px 上边距会把文字顶歪 */
.te-head-meta .f-hint,
.te-linked-head .f-hint,
.te-bank-foot .f-hint { margin-top: 0; }

.te-body { display: grid; grid-template-columns: 258px minmax(0, 1fr) 300px; gap: 12px; align-items: start; }

.te-outline { padding: 14px; position: sticky; top: 0; max-height: calc(100vh - 150px); overflow-y: auto; }
.te-ol-row {
  display: flex; align-items: center; gap: 8px;
  border: 1.5px solid transparent; border-radius: 10px;
  padding: 7px 8px; margin-bottom: 4px; cursor: pointer;
}
.te-ol-row:hover { background: #f6f9fc; }
.te-ol-row.on { border-color: var(--brand); background: var(--brand-soft); }
.te-ol-no {
  width: 20px; height: 20px; flex-shrink: 0; border-radius: 6px;
  background: #eef1f7; color: var(--ink-2);
  font-size: 11.5px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
}
.te-ol-row.on .te-ol-no { background: var(--brand); color: #fff; }
.te-ol-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.te-ol-main b { font-size: 12.5px; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.te-ol-main em { font-size: 11px; color: var(--sub); font-style: normal; }
.te-ol-ops { display: flex; align-items: center; gap: 2px; opacity: 0; transition: opacity 0.15s; }
.te-ol-row:hover .te-ol-ops { opacity: 1; }
.te-icon {
  width: 22px; height: 22px; border: none; border-radius: 5px;
  background: #f0f3f8; color: var(--ink-2); font-size: 12px;
  display: inline-flex; align-items: center; justify-content: center;
}
.te-icon:hover { background: var(--brand-soft); color: var(--brand-deep); }
.te-icon.danger:hover { background: var(--danger-soft); color: var(--danger); }
.te-add { margin-top: 14px; padding-top: 12px; border-top: 1px dashed var(--border); }
.chips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 8px; }
/* 「新增段落」是动作按钮（无选中态），不是选择器，因此不能换成 AppFilterChips；
   但外形与筛选 chip 保持同一套尺寸（与共享组件 AppFilterChips 的 .opt-chip 同形，
   包括同样不设 line-height）。 */
.k-chip {
  border: 1.5px solid var(--border); border-radius: 8px;
  background: var(--card); color: var(--ink-2); font-size: 12.5px; padding: 3px 12px;
  white-space: nowrap; flex-shrink: 0;
  transition: border-color 0.12s, color 0.12s;
}
.k-chip:hover { border-color: var(--brand); color: var(--brand-deep); }

.te-main { min-width: 0; }
.te-edit { padding: 16px; }
.te-edit-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.te-linked { margin-top: 16px; padding-top: 14px; border-top: 1px dashed var(--border); }
.te-linked-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; font-size: 13px; }
.te-linked-row {
  display: flex; align-items: center; gap: 8px;
  border: 1px solid var(--border); border-radius: 9px;
  padding: 8px 10px; margin-bottom: 6px; background: #fbfdfd;
}
.te-linked-stem { flex: 1; min-width: 0; font-size: 12.5px; color: var(--ink-2); }
.te-empty { padding: 40px; text-align: center; color: var(--sub); font-size: 13px; }

.te-bank { padding: 14px; position: sticky; top: 0; max-height: calc(100vh - 150px); display: flex; flex-direction: column; }
.te-bank-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
.te-bank-card { border: 1.5px solid var(--border); border-radius: 10px; padding: 9px 11px; }
.te-bank-stem { font-size: 12.5px; color: var(--ink-2); line-height: 1.6; }
.te-bank-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 5px; }

/* 预览稿 */
.te-doc { background: #fff; padding: 8px 6px; }
.te-doc-head { text-align: center; border-bottom: 2px solid var(--ink); padding-bottom: 10px; margin-bottom: 16px; }
.te-doc-head h1 { font-size: 20px; font-weight: 700; }
.te-doc-head p { font-size: 12.5px; color: var(--sub); margin-top: 5px; }
.te-doc-block { margin-bottom: 18px; }
.te-doc-block h2 { font-size: 15px; font-weight: 700; margin-bottom: 8px; }
.te-doc-no { color: var(--brand-deep); }
.te-doc-qs { margin-top: 10px; padding-left: 4px; }
.te-doc-q { margin-bottom: 10px; }
.te-doc-stem { font-size: 13.5px; line-height: 1.75; color: var(--ink); }
/* 选项外观由 QuestionOptions 负责，这里只管与题干的距离 */
.te-doc-opts { margin-top: 4px; }

/* 列表工具条与面板左右同边距（表格 / 栅格满幅，内边距给在工具条这一层） */
.list-head { padding: 14px 18px 0; }

/* 列表 */
.te-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; padding: 0 18px 4px; }
.te-card {
  border: 1.5px solid var(--border); border-radius: 12px;
  padding: 14px; display: flex; flex-direction: column; gap: 8px;
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
  text-align: left; border: 1.5px solid var(--border); border-radius: 11px;
  background: #fff; padding: 9px 12px; display: flex; flex-direction: column; gap: 4px;
}
.te-tpl.on { border-color: var(--brand); background: var(--brand-soft); }
.te-tpl b { display: flex; align-items: center; gap: 5px; font-size: 13px; color: var(--ink); }
.te-tpl.on b { color: var(--brand-deep); }
.te-tpl span { font-size: 11.5px; color: var(--sub); }
</style>
