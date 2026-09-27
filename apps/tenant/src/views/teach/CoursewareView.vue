<script setup lang="ts">
/**
 * 课件（列表 + 幻灯片编辑器）。
 *
 * 与讲义的分工：讲义是**课堂脚本**（连续段落流，打印给学生看），课件是**投屏页面**
 * （一张张 16:9 的幻灯片，字号大、要点化）。所以这里的数据结构是 `slides` 分页数组，
 * 而不是讲义的 `blocks` 段落流；两者共用同一个 TeachDoc 模型（见 models.ts 的说明）。
 *
 * 编辑器三栏：左缩略图（顺序即放映顺序）/ 中画布（所见即所得）/ 右属性与题库。
 * 「放映」用全屏弹层而不是新开路由，是因为放映是一次性动作，退出后要回到原编辑位置。
 */
import { computed, onMounted, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AppFilterPanel,
  AppIcon,
  AppListToolbar,
  AppPageHeader,
  RichTextViewer,
  SLIDE_LAYOUT_TEXT,
  TEACH_DOC_STATUS_TEXT,
  showToast,
  truncateRich,
} from '@aiteach/shared'
import type { CoursewareSlide, FilterRowDef, OrgQuestion, SlideLayout, TeachDoc } from '@aiteach/shared'
import AppModal from '@/components/ui/AppModal.vue'
import AppPagination from '@/components/ui/AppPagination.vue'
import {
  deleteTeachDoc,
  duplicateTeachDoc,
  fetchQuestions,
  fetchTeachDocs,
  saveTeachDoc,
  toggleTeachDocPublish,
} from '@/api/org'
import { useBaseData } from '@/composables/useBaseData'
import { COURSEWARE_TEMPLATES, SLIDE_LAYOUTS, makeSlides } from './teach-templates'

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
const createForm = reactive({ name: '', subject: '数学', grade: '高一', textbook: '', knowledgeText: '', template: 'lesson' })

function openCreate() {
  createForm.name = ''
  createForm.subject = pick(subjects.value, '数学')
  createForm.grade = pick(grades.value, '高一')
  createForm.textbook = ''
  createForm.knowledgeText = ''
  createForm.template = 'lesson'
  createOpen.value = true
}

async function submitCreate() {
  if (createForm.name.trim().length < 2) {
    showToast('课件名称须为 2-50 字', 'error')
    return
  }
  const tpl = COURSEWARE_TEMPLATES.find((row) => row.key === createForm.template) ?? COURSEWARE_TEMPLATES[0]
  saving.value = true
  try {
    const created = await saveTeachDoc({
      kind: 'courseware',
      name: createForm.name.trim(),
      subject: createForm.subject,
      grade: createForm.grade,
      textbook: createForm.textbook,
      knowledge: createForm.knowledgeText.split(/[、,，\s]+/).map((row) => row.trim()).filter(Boolean),
      blocks: [],
      slides: makeSlides(tpl.slides, createForm.name.trim()),
      status: 'draft',
    })
    createOpen.value = false
    await loadList()
    showToast('课件已创建，可开始编辑', 'success')
    router.push(`/teach/courseware?id=${created.id}`)
  } catch (error) {
    showToast(error instanceof Error ? error.message : '创建失败', 'error')
  } finally {
    saving.value = false
  }
}

/* ================= 编辑器 ================= */

const activeId = ref<number>(0)
const activeSlide = computed<CoursewareSlide | null>(
  () => doc.value?.slides.find((row) => row.id === activeId.value) ?? null,
)

async function openDoc(id: number) {
  const found = docs.value.find((row) => row.id === id)
  if (!found) {
    showToast('课件不存在或已删除', 'error')
    router.replace('/teach/courseware')
    return
  }
  doc.value = JSON.parse(JSON.stringify(found)) as TeachDoc
  activeId.value = doc.value.slides[0]?.id ?? 0
}

watch(editingId, (id) => {
  if (id) void openDoc(id)
})

function backToList() {
  doc.value = null
  router.push('/teach/courseware')
}

function addSlide(layout: SlideLayout) {
  if (!doc.value) return
  const slide: CoursewareSlide = {
    id: Date.now(),
    layout,
    title: layout === 'cover' ? doc.value.name : SLIDE_LAYOUT_TEXT[layout],
    subtitle: layout === 'cover' ? 'AI 教学云 · 课堂教学课件' : undefined,
    bullets: layout === 'bullets' ? ['要点一', '要点二'] : [],
    note: '',
  }
  doc.value.slides.push(slide)
  activeId.value = slide.id
}

function duplicateSlide(id: number) {
  if (!doc.value) return
  const index = doc.value.slides.findIndex((row) => row.id === id)
  if (index < 0) return
  const copy: CoursewareSlide = JSON.parse(JSON.stringify(doc.value.slides[index])) as CoursewareSlide
  copy.id = Date.now()
  doc.value.slides.splice(index + 1, 0, copy)
  activeId.value = copy.id
}

function removeSlide(id: number) {
  if (!doc.value) return
  if (doc.value.slides.length === 1) {
    showToast('至少保留一页', 'error')
    return
  }
  const index = doc.value.slides.findIndex((row) => row.id === id)
  if (index < 0) return
  doc.value.slides.splice(index, 1)
  if (activeId.value === id) activeId.value = doc.value.slides[Math.max(0, index - 1)].id
}

function moveSlide(id: number, delta: number) {
  if (!doc.value) return
  const index = doc.value.slides.findIndex((row) => row.id === id)
  const target = index + delta
  if (index < 0 || target < 0 || target >= doc.value.slides.length) return
  const [row] = doc.value.slides.splice(index, 1)
  doc.value.slides.splice(target, 0, row)
}

function addBullet() {
  activeSlide.value?.bullets.push('')
}

function dropBullet(index: number) {
  activeSlide.value?.bullets.splice(index, 1)
}

/* ================= 例题页关联题目 ================= */

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
  if (!activeSlide.value) {
    showToast('请先选中一页幻灯片', 'error')
    return
  }
  activeSlide.value.layout = 'question'
  activeSlide.value.questionId = questionId
  showToast('已关联例题，可在右侧设置是否显示解析', 'success')
}

const itemOf = (id?: number) => (id ? questions.value.find((row) => row.id === id) : undefined)

/* ================= 保存 / 发布 / 放映 / 打印 ================= */

async function save() {
  if (!doc.value) return
  if (doc.value.name.trim().length < 2) {
    showToast('课件名称须为 2-50 字', 'error')
    return
  }
  saving.value = true
  try {
    const saved = await saveTeachDoc({
      id: doc.value.id,
      kind: 'courseware',
      name: doc.value.name.trim(),
      subject: doc.value.subject,
      grade: doc.value.grade,
      textbook: doc.value.textbook,
      knowledge: doc.value.knowledge,
      blocks: [],
      slides: doc.value.slides,
      status: doc.value.status,
    })
    doc.value.id = saved.id
    await loadList()
    showToast('课件已保存', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '保存失败', 'error')
  } finally {
    saving.value = false
  }
}

async function publish() {
  if (!doc.value) return
  if (!doc.value.id) await save()
  try {
    const next = await toggleTeachDocPublish(doc.value.id)
    doc.value.status = next.status
    await loadList()
    showToast(next.status === 'published' ? '已发布到校内课件库' : '已下架', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '操作失败', 'error')
  }
}

/* 放映：全屏弹层 + 键盘翻页 */
const showOpen = ref(false)
const showIndex = ref(0)
const showNote = ref(true)

function startShow() {
  if (!doc.value?.slides.length) {
    showToast('还没有幻灯片', 'error')
    return
  }
  showIndex.value = Math.max(0, doc.value.slides.findIndex((row) => row.id === activeId.value))
  showOpen.value = true
}

function stepShow(delta: number) {
  if (!doc.value) return
  const next = showIndex.value + delta
  if (next < 0 || next >= doc.value.slides.length) return
  showIndex.value = next
}

function onKey(event: KeyboardEvent) {
  if (!showOpen.value) return
  if (event.key === 'ArrowRight' || event.key === 'PageDown') stepShow(1)
  else if (event.key === 'ArrowLeft' || event.key === 'PageUp') stepShow(-1)
  else if (event.key === 'Escape') showOpen.value = false
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

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
  docs.value = await fetchTeachDocs('courseware')
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
  <div v-if="doc" class="cw-shell">
    <div class="cw-head panel">
      <button class="cw-back" type="button" title="返回列表" @click="backToList">
        <AppIcon name="chevron-left" :size="15" />
      </button>
      <div class="cw-head-main">
        <input v-model="doc.name" class="cw-title" maxlength="50" placeholder="课件名称" />
        <div class="cw-head-meta">
          <select v-model="doc.subject" class="f-select">
            <option v-for="s in withCurrent(subjects, doc.subject)" :key="s" :value="s">{{ s }}</option>
          </select>
          <select v-model="doc.grade" class="f-select">
            <option v-for="g in withCurrent(grades, doc.grade)" :key="g" :value="g">{{ g }}</option>
          </select>
          <span class="tag" :class="doc.status === 'published' ? 'tag-green' : 'tag-gray'">
            {{ TEACH_DOC_STATUS_TEXT[doc.status] }}
          </span>
          <span class="f-hint">{{ doc.slides.length }} 页 · 更新于 {{ doc.updatedAt }}</span>
        </div>
      </div>
      <div class="op-group">
        <button class="btn btn-ghost btn-sm" @click="startShow"><AppIcon name="presentation" :size="14" /> 放映</button>
        <button class="btn btn-ghost btn-sm" @click="onPrint"><AppIcon name="print" :size="14" /> 打印</button>
        <button class="btn btn-ghost btn-sm" @click="publish">
          <AppIcon name="upload" :size="14" /> {{ doc.status === 'published' ? '下架' : '发布' }}
        </button>
        <button class="btn btn-primary btn-sm" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存' }}</button>
      </div>
    </div>

    <div class="cw-body">
      <!-- 左：幻灯片缩略图（顺序即放映顺序） -->
      <aside class="panel cw-rail">
        <div class="section-title" style="margin-bottom: 10px">幻灯片</div>
        <div
          v-for="(slide, i) in doc.slides"
          :key="slide.id"
          class="cw-thumb"
          :class="{ on: activeId === slide.id }"
          @click="activeId = slide.id"
        >
          <span class="cw-thumb-no">{{ i + 1 }}</span>
          <div class="cw-thumb-mini" :class="`mini-${slide.layout}`">
            <b v-if="slide.layout === 'cover'">{{ slide.title }}</b>
            <b v-else-if="slide.layout === 'section'">{{ slide.title }}</b>
            <b v-else>{{ slide.title }}</b>
            <i v-if="slide.layout === 'bullets'">{{ slide.bullets.length }} 个要点</i>
            <i v-else-if="slide.layout === 'question'">{{ itemOf(slide.questionId) ? '已关联例题' : '待关联例题' }}</i>
            <i v-else>{{ SLIDE_LAYOUT_TEXT[slide.layout] }}</i>
          </div>
          <div class="cw-thumb-ops" @click.stop>
            <button class="te-icon" type="button" title="上移" @click="moveSlide(slide.id, -1)">↑</button>
            <button class="te-icon" type="button" title="下移" @click="moveSlide(slide.id, 1)">↓</button>
            <button class="te-icon" type="button" title="复制页" @click="duplicateSlide(slide.id)">⧉</button>
            <button class="te-icon danger" type="button" title="删除页" @click="removeSlide(slide.id)">×</button>
          </div>
        </div>

        <div class="te-add">
          <span class="f-hint">新增页面</span>
          <div class="chips">
            <button v-for="row in SLIDE_LAYOUTS" :key="row.key" class="k-chip" type="button" @click="addSlide(row.key)">
              + {{ row.name }}
            </button>
          </div>
        </div>
      </aside>

      <!-- 中：16:9 画布 -->
      <main class="cw-main">
        <div v-if="activeSlide" class="cw-stage">
          <div class="cw-slide" :class="`ly-${activeSlide.layout}`">
            <!-- 封面页 -->
            <template v-if="activeSlide.layout === 'cover'">
              <div class="cw-cover">
                <h1>{{ activeSlide.title }}</h1>
                <p v-if="activeSlide.subtitle">{{ activeSlide.subtitle }}</p>
                <span class="cw-cover-foot">{{ doc.grade }} · {{ doc.subject }}</span>
              </div>
            </template>

            <!-- 章节过渡页 -->
            <template v-else-if="activeSlide.layout === 'section'">
              <div class="cw-section">
                <span class="cw-sec-line" />
                <h1>{{ activeSlide.title }}</h1>
              </div>
            </template>

            <!-- 结束页 -->
            <template v-else-if="activeSlide.layout === 'end'">
              <div class="cw-end">
                <h1>{{ activeSlide.title }}</h1>
                <p v-if="activeSlide.subtitle">{{ activeSlide.subtitle }}</p>
              </div>
            </template>

            <!-- 要点页 / 图文页 -->
            <template v-else-if="activeSlide.layout === 'bullets' || activeSlide.layout === 'image'">
              <h2 class="cw-tt">{{ activeSlide.title }}</h2>
              <div class="cw-cols">
                <ul class="cw-bullets">
                  <li v-for="(text, i) in activeSlide.bullets" :key="i">
                    <em>{{ i + 1 }}</em>
                    <span>{{ text || '（待填写要点）' }}</span>
                  </li>
                  <li v-if="!activeSlide.bullets.length" class="cw-mute">右侧「要点」中添加内容</li>
                </ul>
                <div v-if="activeSlide.layout === 'image'" class="cw-figure">
                  <AppIcon name="image" :size="30" />
                  <span>{{ activeSlide.subtitle || '图示区域（插入图片 / 公式图）' }}</span>
                </div>
              </div>
            </template>

            <!-- 例题页 -->
            <template v-else>
              <h2 class="cw-tt">{{ activeSlide.title }}</h2>
              <div v-if="itemOf(activeSlide.questionId)" class="cw-qbox">
                <div class="cw-qmeta">
                  <span class="tag tag-gray">{{ itemOf(activeSlide.questionId)!.type }}</span>
                  <span class="tag tag-gray">{{ itemOf(activeSlide.questionId)!.difficulty }}</span>
                </div>
                <p class="cw-qstem">
                  <RichTextViewer :content="itemOf(activeSlide.questionId)!.stem" tag="span" />
                  <span v-if="itemOf(activeSlide.questionId)!.type.includes('填空')">______</span>
                </p>
                <ul class="cw-qopts">
                  <li v-for="(opt, oi) in itemOf(activeSlide.questionId)!.options" :key="oi">
                    <span>{{ 'ABCDEF'[oi] }}．</span>
                    <RichTextViewer :content="opt" tag="span" />
                  </li>
                </ul>
              </div>
              <p v-else class="cw-mute">右侧「题库选题」中挑选一道题作为本页例题</p>
            </template>
          </div>
          <p class="cw-tip">
            第 {{ doc.slides.findIndex((row) => row.id === activeSlide!.id) + 1 }} / {{ doc.slides.length }} 页 ·
            放映时按 ← → 翻页
          </p>
        </div>
        <div v-else class="panel cw-empty">左侧还没有幻灯片，先「新增页面」</div>
      </main>

      <!-- 右：属性 + 题库 -->
      <aside class="panel cw-side">
        <div class="section-title" style="margin-bottom: 10px">页面属性</div>
        <template v-if="activeSlide">
          <div class="cw-field">
            <label>版式</label>
            <select v-model="activeSlide.layout" class="f-select">
              <option v-for="row in SLIDE_LAYOUTS" :key="row.key" :value="row.key">{{ row.name }} · {{ row.desc }}</option>
            </select>
          </div>
          <div class="cw-field">
            <label>标题</label>
            <input v-model="activeSlide.title" class="f-input" maxlength="40" />
          </div>
          <div v-if="activeSlide.layout === 'cover' || activeSlide.layout === 'end' || activeSlide.layout === 'image'" class="cw-field">
            <label>{{ activeSlide.layout === 'image' ? '图示说明' : '副标题' }}</label>
            <input v-model="activeSlide.subtitle" class="f-input" maxlength="40" />
          </div>

          <div v-if="activeSlide.layout === 'bullets' || activeSlide.layout === 'image'" class="cw-field">
            <label class="cw-label-row">
              <span>要点</span>
              <button class="mini-btn" type="button" @click="addBullet">+ 添加</button>
            </label>
            <div v-for="(text, i) in activeSlide.bullets" :key="i" class="cw-bullet-row">
              <textarea v-model="activeSlide.bullets[i]" class="f-textarea" rows="2" />
              <button class="te-icon danger" type="button" title="删除要点" @click="dropBullet(i)">×</button>
            </div>
            <p v-if="!activeSlide.bullets.length" class="f-hint">暂无要点</p>
          </div>

          <div v-if="activeSlide.layout === 'question'" class="cw-field">
            <label>例题</label>
            <p v-if="itemOf(activeSlide.questionId)" class="cw-linked">
              {{ truncateRich(itemOf(activeSlide.questionId)!.stem, 44) }}
            </p>
            <p v-else class="f-hint">尚未关联题目</p>
          </div>

          <div class="cw-field">
            <label>讲稿备注</label>
            <textarea v-model="activeSlide.note" class="f-textarea" rows="3" placeholder="放映时对教师可见，不投屏" />
          </div>

          <div class="cw-divider" />
        </template>

        <div class="section-title" style="margin-bottom: 8px">题库选题</div>
        <select v-model="bankFilter.type" class="f-select" style="margin-bottom: 8px">
          <option value="">全部题型</option>
          <option v-for="t in ['单选题', '多选题', '判断题', '填空题', '解答题']" :key="t" :value="t">{{ t }}</option>
        </select>
        <select v-model="bankFilter.difficulty" class="f-select" style="margin-bottom: 8px">
          <option value="">全部难度</option>
          <option v-for="d in difficulties" :key="d" :value="d">{{ d }}</option>
        </select>
        <input v-model="bankFilter.keyword" class="f-input" placeholder="搜索题干" style="margin-bottom: 10px" />
        <div class="cw-bank">
          <div v-for="row in bankPool" :key="row.id" class="cw-bank-card">
            <p class="cw-bank-stem">{{ truncateRich(row.stem, 46) }}</p>
            <div class="cw-bank-foot">
              <span class="f-hint">{{ row.type }} · {{ row.difficulty }}</span>
              <button
                class="mini-btn"
                :disabled="activeSlide?.questionId === row.id"
                @click="linkQuestion(row.id)"
              >
                {{ activeSlide?.questionId === row.id ? '当前例题' : '设为例题' }}
              </button>
            </div>
          </div>
        </div>
      </aside>
    </div>

    <!-- 放映 -->
    <AppModal v-if="showOpen && doc" :title="`放映 · ${doc.name}`" :width="1080" @close="showOpen = false">
      <div class="cw-show">
        <div class="cw-show-stage" :class="`ly-${doc.slides[showIndex].layout}`">
          <template v-if="doc.slides[showIndex].layout === 'cover'">
            <div class="cw-cover">
              <h1>{{ doc.slides[showIndex].title }}</h1>
              <p v-if="doc.slides[showIndex].subtitle">{{ doc.slides[showIndex].subtitle }}</p>
            </div>
          </template>
          <template v-else-if="doc.slides[showIndex].layout === 'section'">
            <div class="cw-section"><span class="cw-sec-line" /><h1>{{ doc.slides[showIndex].title }}</h1></div>
          </template>
          <template v-else-if="doc.slides[showIndex].layout === 'end'">
            <div class="cw-end"><h1>{{ doc.slides[showIndex].title }}</h1></div>
          </template>
          <template v-else-if="doc.slides[showIndex].layout === 'question'">
            <h2 class="cw-tt">{{ doc.slides[showIndex].title }}</h2>
            <div v-if="itemOf(doc.slides[showIndex].questionId)" class="cw-qbox">
              <p class="cw-qstem">
                <RichTextViewer :content="itemOf(doc.slides[showIndex].questionId)!.stem" tag="span" />
              </p>
              <ul class="cw-qopts">
                <li v-for="(opt, oi) in itemOf(doc.slides[showIndex].questionId)!.options" :key="oi">
                  <span>{{ 'ABCDEF'[oi] }}．</span>
                  <RichTextViewer :content="opt" tag="span" />
                </li>
              </ul>
            </div>
            <p v-else class="cw-mute">本页未关联题目</p>
          </template>
          <template v-else>
            <h2 class="cw-tt">{{ doc.slides[showIndex].title }}</h2>
            <ul class="cw-bullets">
              <li v-for="(text, i) in doc.slides[showIndex].bullets" :key="i">
                <em>{{ i + 1 }}</em><span>{{ text }}</span>
              </li>
            </ul>
          </template>
        </div>
        <div class="cw-show-bar">
          <button class="btn btn-ghost btn-sm" @click="stepShow(-1)">上一页</button>
          <span class="f-hint">{{ showIndex + 1 }} / {{ doc.slides.length }}</span>
          <button class="btn btn-ghost btn-sm" @click="stepShow(1)">下一页</button>
          <button class="btn btn-ghost btn-sm" @click="showNote = !showNote">
            {{ showNote ? '隐藏讲稿' : '显示讲稿' }}
          </button>
        </div>
        <p v-if="showNote" class="cw-note">讲稿：{{ doc.slides[showIndex].note || '（本页无备注）' }}</p>
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="showOpen = false">退出放映</button>
        <button class="btn btn-primary" @click="onPrint"><AppIcon name="print" :size="14" /> 打印课件</button>
      </template>
    </AppModal>
  </div>

  <!-- ================= 列表 ================= -->
  <div v-else class="page">
    <AppPageHeader desc="按「封面 → 学习目标 → 讲解 → 例题 → 小结」组织投屏页面，支持要点页 / 图文页 / 例题页，可放映与打印。">
      <template #actions>
        <button class="btn btn-ghost" @click="router.push('/teach/lecture')"><AppIcon name="book" :size="15" /> 切换讲义</button>
        <button class="btn btn-primary" @click="openCreate"><AppIcon name="plus" :size="15" /> 新建课件</button>
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
          <p class="te-card-foot">{{ row.slides.length }} 页 · {{ row.views }} 次浏览 · {{ row.owner }} · {{ row.updatedAt }}</p>
          <div class="op-group">
            <button class="mini-btn" @click="router.push(`/teach/courseware?id=${row.id}`)">编辑</button>
            <button class="mini-btn" @click="onDuplicate(row)">复制</button>
            <button class="mini-btn danger" @click="onDelete(row)">删除</button>
          </div>
        </div>
      </div>
      <p v-if="!rows.length" class="empty-row">{{ loading ? '正在载入…' : '暂无课件，点击右上角新建' }}</p>
      <AppPagination :total="filtered.length" v-model:page="page" :page-size="9" />
    </div>

    <!-- 新建课件 -->
    <AppModal v-if="createOpen" title="新建课件" :width="620" @close="createOpen = false">
      <div class="f-field">
        <label class="f-label">课件名称<span class="req">*</span></label>
        <input v-model="createForm.name" class="f-input" maxlength="50" placeholder="例如：函数的单调性 · 授课课件" />
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
            v-for="row in COURSEWARE_TEMPLATES"
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
.cw-shell { display: flex; flex-direction: column; gap: 12px; }
.cw-head { display: flex; align-items: center; gap: 12px; padding: 12px 16px; }
.cw-back {
  width: 34px; height: 34px; flex-shrink: 0;
  border: 1px solid var(--border); border-radius: 9px;
  background: #fff; color: var(--ink-2);
  display: flex; align-items: center; justify-content: center;
}
.cw-back:hover { border-color: var(--brand); color: var(--brand-deep); }
.cw-head-main { flex: 1; min-width: 0; }
.cw-title { width: 100%; border: none; background: transparent; font-size: 16px; font-weight: 700; color: var(--ink); padding: 2px 4px; border-radius: 7px; }
.cw-title:hover { background: #f4f7fb; }
.cw-title:focus { outline: none; box-shadow: 0 0 0 2px var(--brand-soft); }
.cw-head-meta { display: flex; align-items: center; gap: 8px; margin-top: 4px; flex-wrap: wrap; }
/* 自写横向工具条里的下拉：全局 .f-select 是 width:100%，会把这一行撑满（见规范第 4 条） */
.cw-head-meta .f-select { width: auto; min-width: 96px; height: 28px; flex-shrink: 0; }
/* 横向居中的行里，f-hint 自带的 5px 上边距会把文字顶歪 */
.cw-head-meta .f-hint,
.cw-bank-foot .f-hint,
.cw-show-bar .f-hint { margin-top: 0; }

.cw-body { display: grid; grid-template-columns: 232px minmax(0, 1fr) 306px; gap: 12px; align-items: start; }

.cw-rail { padding: 14px; position: sticky; top: 0; max-height: calc(100vh - 150px); overflow-y: auto; }
.cw-thumb {
  border: 1.5px solid transparent; border-radius: 10px; padding: 6px; margin-bottom: 6px;
  cursor: pointer; position: relative;
}
.cw-thumb:hover { background: #f6f9fc; }
.cw-thumb.on { border-color: var(--brand); background: var(--brand-soft); }
.cw-thumb-no { position: absolute; left: 10px; top: 10px; z-index: 2; font-size: 10.5px; font-weight: 700; color: #fff; background: rgba(0, 0, 0, 0.45); border-radius: 4px; padding: 0 4px; }
.cw-thumb-mini {
  height: 62px; border-radius: 7px; background: #fff; border: 1px solid var(--border);
  padding: 8px 9px; display: flex; flex-direction: column; justify-content: center; gap: 3px; overflow: hidden;
}
.cw-thumb-mini b { font-size: 11.5px; color: var(--ink); line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.cw-thumb-mini i { font-size: 10px; color: var(--sub); font-style: normal; }
.mini-cover, .mini-end, .mini-section { background: linear-gradient(135deg, var(--brand-soft), #fff); }
.cw-thumb-ops { display: flex; align-items: center; gap: 2px; justify-content: flex-end; margin-top: 4px; opacity: 0; transition: opacity 0.15s; }
.cw-thumb:hover .cw-thumb-ops { opacity: 1; }
.te-icon {
  width: 22px; height: 22px; border: none; border-radius: 5px;
  background: #f0f3f8; color: var(--ink-2); font-size: 12px;
  display: inline-flex; align-items: center; justify-content: center;
}
.te-icon:hover { background: var(--brand-soft); color: var(--brand-deep); }
.te-icon.danger:hover { background: var(--danger-soft); color: var(--danger); }
.te-add { margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--border); }
.chips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 8px; }
/* 「新增页面」是动作按钮（无选中态），不是选择器，因此不能换成 AppFilterChips；
   但外形与筛选 chip 保持同一套尺寸（与共享组件 AppFilterChips 的 .opt-chip 同形，
   包括同样不设 line-height）。 */
.k-chip {
  border: 1.5px solid var(--border);
  border-radius: 8px;
  background: var(--card);
  color: var(--ink-2);
  font-size: 12.5px;
  padding: 3px 12px;
  white-space: nowrap;
  flex-shrink: 0;
  transition: border-color 0.12s, color 0.12s;
}
.k-chip:hover { border-color: var(--brand); color: var(--brand-deep); }

.cw-main { min-width: 0; }
.cw-stage { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.cw-slide {
  width: 100%; aspect-ratio: 16 / 9; background: #fff;
  border: 1.5px solid var(--border); border-radius: 12px; box-shadow: var(--shadow);
  padding: 34px 38px; display: flex; flex-direction: column; overflow: hidden;
}
.cw-tt { font-size: 20px; font-weight: 700; color: var(--ink); border-left: 4px solid var(--brand); padding-left: 10px; margin-bottom: 16px; }
.cw-cols { display: grid; grid-template-columns: minmax(0, 1fr) 190px; gap: 18px; flex: 1; min-height: 0; }
.cw-bullets { display: flex; flex-direction: column; gap: 12px; overflow: auto; }
.cw-bullets li { display: flex; align-items: flex-start; gap: 9px; font-size: 15px; color: var(--ink-2); line-height: 1.6; }
.cw-bullets em {
  width: 20px; height: 20px; flex-shrink: 0; border-radius: 50%;
  background: var(--brand-soft); color: var(--brand-deep);
  font-size: 11px; font-weight: 700; font-style: normal;
  display: flex; align-items: center; justify-content: center;
}
.cw-figure {
  border: 2px dashed var(--border); border-radius: 10px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  color: var(--sub); font-size: 12px; text-align: center; padding: 12px;
}
.cw-mute { color: var(--sub); font-size: 14px; }
.cw-cover, .cw-end, .cw-section { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 10px; }
.cw-cover h1, .cw-end h1, .cw-section h1 { font-size: 30px; font-weight: 700; color: var(--ink); }
.cw-cover p, .cw-end p { font-size: 15px; color: var(--sub); }
.cw-cover-foot { font-size: 12.5px; color: var(--sub); margin-top: 6px; }
.cw-sec-line { width: 54px; height: 4px; border-radius: 2px; background: var(--brand); }
.ly-cover, .ly-section, .ly-end { background: linear-gradient(160deg, var(--brand-soft) 0%, #fff 62%); }
.cw-qbox { border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; background: #fbfdfd; overflow: auto; }
.cw-qmeta { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.cw-qstem { font-size: 15px; line-height: 1.75; color: var(--ink); }
.cw-qopts { margin-top: 8px; display: flex; flex-direction: column; gap: 5px; }
.cw-qopts li { display: flex; align-items: center; gap: 6px; font-size: 14px; color: var(--ink-2); line-height: 1.6; }
.cw-tip { font-size: 11.5px; color: var(--sub); }
.cw-empty { padding: 40px; text-align: center; color: var(--sub); font-size: 13px; }

.cw-side { padding: 14px; position: sticky; top: 0; max-height: calc(100vh - 150px); display: flex; flex-direction: column; }
.cw-field { margin-bottom: 12px; }
.cw-field > label { display: block; font-size: 12px; color: var(--sub); margin-bottom: 5px; }
.cw-label-row { display: flex; align-items: center; justify-content: space-between; }
.cw-bullet-row { display: flex; gap: 6px; align-items: flex-start; margin-bottom: 6px; }
.cw-bullet-row .f-textarea { flex: 1; }
.cw-linked { font-size: 12.5px; color: var(--ink-2); line-height: 1.6; }
.cw-divider { height: 1px; background: var(--border); margin: 4px 0 12px; }
.cw-bank { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
.cw-bank-card { border: 1.5px solid var(--border); border-radius: 10px; padding: 9px 11px; }
.cw-bank-stem { font-size: 12.5px; color: var(--ink-2); line-height: 1.6; }
.cw-bank-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 5px; }

/* 放映 */
.cw-show { display: flex; flex-direction: column; gap: 10px; }
.cw-show-stage {
  width: 100%; aspect-ratio: 16 / 9; background: #fff;
  border: 1px solid var(--border); border-radius: 12px;
  padding: 44px 52px; display: flex; flex-direction: column; overflow: hidden;
}
.cw-show-bar { display: flex; align-items: center; justify-content: center; gap: 14px; }
.cw-note { font-size: 12.5px; color: var(--ink-2); background: #f7f9fc; border-radius: 8px; padding: 9px 12px; line-height: 1.7; }

/* 列表工具条与面板左右同边距（表格 / 栅格满幅，内边距给在工具条这一层） */
.list-head { padding: 14px 18px 0; }

/* 列表（复用讲义页的栅格样式命名，保持一致） */
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
.te-tpl { text-align: left; border: 1.5px solid var(--border); border-radius: 11px; background: #fff; padding: 9px 12px; display: flex; flex-direction: column; gap: 4px; }
.te-tpl.on { border-color: var(--brand); background: var(--brand-soft); }
.te-tpl b { display: flex; align-items: center; gap: 5px; font-size: 13px; color: var(--ink); }
.te-tpl.on b { color: var(--brand-deep); }
.te-tpl span { font-size: 11.5px; color: var(--sub); }

@media print {
  .cw-head, .cw-rail, .cw-side, .cw-tip { display: none !important; }
}
</style>
