<script setup lang="ts">
/**
 * 试卷库：只展示**已审核通过**的试卷（个人创建的草稿存「我的文件」，编辑从那里进），
 * 因此列表是只读的 —— 没有「编辑 / 提交审核」入口，仅保留 预览 / 平行卷 / 导出 / 删除。
 * 新建入口只留 手动协同组卷 与 细目表组卷；AI 智能组卷是独立菜单页（/paper/ai）。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import {
  AppFilterPanel,
  AppIcon,
  PAPER_SOURCE_OPTIONS,
  appConfirm,
  showToast,
  AppModal,
} from '@aiteach/shared'
import type { FilterRowDef, OrgPaper, OrgQuestion } from '@aiteach/shared'
import PaperPreviewModal from '@/components/paper/PaperPreviewModal.vue'
import PaperListPanel from '@/components/paper/PaperListPanel.vue'
import ParallelPaperDialog from '@/components/paper/ParallelPaperDialog.vue'
import { browsePaper, deletePaper, downloadPaper, fetchPapers, fetchQuestions, fetchTenantDict } from '@/api/org'
import { exportPaperDoc, exportPaperPdf, type ExportVersion } from '@/utils/paper-export'

const papers = ref<OrgPaper[]>([])
const questions = ref<OrgQuestion[]>([])

/* ===== 筛选 =====
 * 年级 / 科目 / 难度 / 考试类型 / 杯赛 / 地区候选项来自租户字典（与题库管理同一口径），
 * 字典是异步到达的，行定义只在运行时展开成 FilterRowDef；来源是试卷自己的取值域。 */
interface PaperFilterRow {
  key: 'grade' | 'subject' | 'difficulty' | 'examType' | 'competition' | 'region' | 'source'
  label: string
  dict?: string
  options?: string[]
}

/** 主条件（产品指定的顺序：年级 / 科目 / 难度 / 考试类型） */
const FILTER_ROWS: PaperFilterRow[] = [
  { key: 'grade', label: '年级', dict: 'grade' },
  { key: 'subject', label: '科目', dict: 'subject' },
  { key: 'difficulty', label: '难度', dict: 'difficulty' },
  { key: 'examType', label: '考试类型', dict: 'examType' },
]

/** 次要条件：收在「更多查询」里 */
const MORE_ROWS: PaperFilterRow[] = [
  { key: 'competition', label: '杯赛', dict: 'competition' },
  { key: 'region', label: '地区', dict: 'region' },
  { key: 'source', label: '来源', options: [...PAPER_SOURCE_OPTIONS] },
]

const ALL_ROWS = [...FILTER_ROWS, ...MORE_ROWS]
const filters = reactive<Record<PaperFilterRow['key'], string[]>>({
  grade: [],
  subject: [],
  difficulty: [],
  examType: [],
  competition: [],
  region: [],
  source: [],
})
const filterOptions = reactive<Record<string, string[]>>({})

/** 每个筛选 key 从试卷上取哪个值（可缺省的维度给空串，等价于「没有该属性」） */
const FIELD_OF: Record<PaperFilterRow['key'], (row: OrgPaper) => string> = {
  grade: (row) => row.grade,
  subject: (row) => row.subject,
  difficulty: (row) => row.difficulty ?? '',
  examType: (row) => row.examType ?? '',
  competition: (row) => row.competition ?? '',
  region: (row) => row.region ?? '',
  source: (row) => row.source ?? '',
}

function toRowDefs(rows: PaperFilterRow[]): FilterRowDef[] {
  return rows.map((row) => ({ key: row.key, label: row.label, options: row.options ?? filterOptions[row.dict ?? ''] ?? [] }))
}
const filterRowDefs = computed(() => toRowDefs(FILTER_ROWS))
const moreRowDefs = computed(() => toRowDefs(MORE_ROWS))

/** AppFilterPanel 回传整份筛选值（覆盖式回写） */
function onFiltersChange(next: Record<string, string[]>) {
  ALL_ROWS.forEach((row) => {
    filters[row.key] = next[row.key] ?? []
  })
}

const keyword = ref('')
const page = ref(1)
const filtered = computed(() =>
  papers.value.filter((row) => {
    for (const def of ALL_ROWS) {
      const selected = filters[def.key]
      if (selected.length > 0 && !selected.includes(FIELD_OF[def.key](row))) return false
    }
    return !keyword.value || row.name.includes(keyword.value)
  }),
)
const rows = computed(() => filtered.value.slice((page.value - 1) * 10, page.value * 10))

/* 筛选 / 关键词变动后停在原页码会看到空列表，回第一页。
   分页已经搬进 PaperListPanel，但这条复位规则依赖的筛选状态仍归本页所有，所以留在这里。 */
watch([() => JSON.stringify(filters), keyword], () => {
  page.value = 1
})

async function load() {
  /* 试卷库只放审核通过的卷；草稿 / 待审在「我的文件」与审核中心里 */
  const [all, qs] = await Promise.all([fetchPapers(), fetchQuestions()])
  papers.value = all.filter((row) => row.status === 'approved')
  questions.value = qs
}

async function loadDicts() {
  const types = [...new Set(ALL_ROWS.map((row) => row.dict).filter((d): d is string => !!d))]
  await Promise.all(
    types.map(async (type) => {
      filterOptions[type] = (await fetchTenantDict(type)).map((item) => item.name)
    }),
  )
}

function totalScore(paper: OrgPaper) {
  return paper.sections.reduce((sum, s) => sum + s.questions.reduce((t, q) => t + q.score, 0), 0)
}
function totalCount(paper: OrgPaper) {
  return paper.sections.reduce((sum, s) => sum + s.questions.length, 0)
}

/* ===== 预览 ===== */
const preview = ref<OrgPaper | null>(null)

/** 打开整卷预览 = 一次浏览：计数发给 mock，本地同步 +1（无需为此重拉列表） */
function onPreview(row: OrgPaper) {
  preview.value = row
  void browsePaper(row.id)
  row.viewCount = (row.viewCount ?? 0) + 1
}

/* ===== 平行卷（FR-PP-015） =====
   弹窗本体在 ParallelPaperDialog（工作台「试卷」页签也用同一个），这里只留「选中哪份卷」 */
const parallelTarget = ref<OrgPaper | null>(null)

/* ===== 导出 =====
 * 不再走「创建导出任务」的占位：试卷数据本来就在前端，直接生成文档即可。
 * 版本（学生版 / 教师版 / 纯答案）必须让老师选——把带答案的教师版误发给学生是实打实的教学事故，
 * 所以不做「默认给最全的」这种省事的决定。
 */
const exportTarget = ref<OrgPaper | null>(null)
const exportVersion = ref<'student' | 'teacher' | 'answer'>('student')
const exportWithCard = ref(true)

function openExport(row: OrgPaper) {
  exportTarget.value = row
  exportVersion.value = 'student'
  exportWithCard.value = row.sections.some((section) => section.questions.length > 0)
}

function doExport(kind: 'doc' | 'pdf') {
  const paper = exportTarget.value
  if (!paper) return
  if (totalCount(paper) === 0) {
    showToast('该试卷还没有题目，无法导出', 'error')
    return
  }
  const options = { version: exportVersion.value, withInfo: true, withAnswerCard: exportWithCard.value }
  try {
    if (kind === 'doc') {
      const fileName = exportPaperDoc(paper, questions.value, options)
      showToast(`已导出 ${fileName}`, 'success')
    } else {
      exportPaperPdf(paper, questions.value, options)
      showToast('已在新窗口打开，选择「另存为 PDF」即可', 'success')
    }
    /* 导出成功才算一次下载，本地同步 +1 */
    void downloadPaper(paper.id)
    paper.downloadCount = (paper.downloadCount ?? 0) + 1
    exportTarget.value = null
  } catch (error) {
    showToast(error instanceof Error ? error.message : '导出失败', 'error')
  }
}

async function onDelete(row: OrgPaper) {
  if (!(await appConfirm(`删除《${row.name}》？删除后放入回收站（保留 30 天可恢复）`, { type: 'danger' }))) return
  await deletePaper(row.id)
  showToast('已放入回收站', 'success')
  load()
}

onMounted(() => {
  void load()
  void loadDicts()
})
</script>

<template>
  <div class="page">
    <!-- <AppPageHeader desc="试卷库收录审核通过的试卷（只读）；个人创建的试卷存放在「我的文件」，送审通过后自动进入本库。" /> -->

    <AppFilterPanel :rows="filterRowDefs" :more-rows="moreRowDefs" :model-value="filters" @update:model-value="onFiltersChange" />

    <!-- 列表整块交给共享面板（工作台「试卷」页签用同一个），弹窗与筛选状态仍留在本页 -->
    <PaperListPanel
      :rows="rows"
      :total="filtered.length"
      v-model:page="page"
      v-model:keyword="keyword"
      placeholder="试卷名称"
      view-key="paper-list"
      @preview="onPreview"
    >
      <template #ops="{ row }">
        <button class="mini-btn" @click="onPreview(row)">预览</button>
        <button class="mini-btn" @click="parallelTarget = row">平行卷</button>
        <button class="mini-btn" @click="openExport(row)">导出</button>
        <button class="mini-btn danger" @click="onDelete(row)">删除</button>
      </template>
    </PaperListPanel>

    <!-- 平行卷弹窗（生成 + 落库 + 提示都在组件里，本页只传母卷） -->
    <ParallelPaperDialog :paper="parallelTarget" @close="parallelTarget = null" />

    <!-- 导出弹窗：版本必须显式选，避免把带答案的教师版误发给学生 -->
    <AppModal v-if="exportTarget" title="导出试卷" :width="460" @close="exportTarget = null">
      <p style="font-size: 13.5px; color: var(--ink-2); margin-bottom: 12px">
        《{{ exportTarget.name }}》· {{ totalCount(exportTarget) }} 题 · {{ totalScore(exportTarget) }} 分
      </p>
      <div class="f-field">
        <label class="f-label">卷面版本</label>
        <select v-model="exportVersion" class="f-select">
          <option value="student">学生版（只有题目，解答留作答空白）</option>
          <option value="teacher">教师版（附答案与解析）</option>
          <option value="answer">纯答案页</option>
        </select>
      </div>
      <label class="f-check">
        <input v-model="exportWithCard" type="checkbox" />
        附带答题卡参考答案
      </label>
      <template #footer>
        <button class="btn btn-ghost" @click="exportTarget = null">取消</button>
        <button class="btn btn-ghost" @click="doExport('doc')">
          <AppIcon name="download" :size="14" /> 导出 Word
        </button>
        <button class="btn btn-primary" @click="doExport('pdf')">
          <AppIcon name="print" :size="14" /> 导出 PDF
        </button>
      </template>
    </AppModal>

    <!-- 整卷预览：弹窗按真实纸张（8K/A3/16K…）自动分版排版，可切换排版样式、答题卡 -->
    <PaperPreviewModal v-if="preview" :paper="preview" :questions="questions" @close="preview = null" />
  </div>
</template>

<style scoped>
/* 列表本体（工具条 / 表格 / 详细卡片 / 分页）已抽到 PaperListPanel，本页只剩导出弹窗的小样式 */
.f-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--ink-2);
  cursor: pointer;
  user-select: none;
}
.f-check input { accent-color: var(--brand); }
</style>
