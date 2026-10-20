<script setup lang="ts">
/**
 * 机构端 · 校本资源库。
 *
 * 只做一件事：把「已通过审批的资源 + 已发布的讲义课件教案学案 + 已共享广场的试卷」统一成
 * 卡片网格，支持类型 / 学科 / 年级 / 关键字筛选与分页，卡片可跳对应详情页。
 *
 * 审批动作（通过 / 驳回 / 日志）不在这里 —— 审批管理已拆成独立页面
 * （`/resource/approval`）。此前两者共用一个组件、靠顶部页签切换，进来审批的人会先撞上
 * 「资源库」这个跟他无关的页签，所以拆开、各自一页、页面里不再有页签。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  AppFilterPanel,
  AppListToolbar,
  AppPageHeader,
  AppPagination,
  RESOURCE_SCOPE_TEXT,
  TEACH_KIND_TEXT,
  showToast,
} from '@aiteach/shared'
import type { FilterRowDef } from '@aiteach/shared'
import type { OrgPaper, ResourceApproval, ResourceScope, TeachDoc, TeachDocKind } from '@aiteach/shared'

import { fetchApprovals, fetchPapers, fetchTeachDocs } from '@/api/org'
import { useBaseData } from '@aiteach/business-common'

const router = useRouter()
const { subjects, grades, ensure } = useBaseData()
const errMsg = (e: unknown) => (e instanceof Error ? e.message : '操作失败')

/* ================= 数据 ================= */
interface LibItem {
  kind: string
  name: string
  subject: string
  grade: string
  scope: ResourceScope
  uploader: string
  time: string
  id: number
  docKind?: TeachDocKind
  paper?: boolean
}

const approvals = ref<ResourceApproval[]>([])
const papers = ref<OrgPaper[]>([])
const docs = ref<TeachDoc[]>([])
const loading = ref(false)

const libFilter = reactive({ type: '', subject: '', grade: '', keyword: '' })
const libPage = ref(1)

/** 类型候选项跟着数据走：库里出现过的类型才列，避免点进去必然为空 */
const typeOptions = computed(() => [...new Set(library.value.map((row) => row.kind))])

/** 校本资源库筛选行（学科 / 年级是字典，需等基础数据就绪，故用 computed） */
const libFilterRows = computed<FilterRowDef[]>(() => [
  { key: 'type', label: '类型', options: typeOptions.value, multiple: false },
  { key: 'subject', label: '学科', options: subjects.value, multiple: false },
  { key: 'grade', label: '年级', options: grades.value, multiple: false },
])

const libFilters = computed<Record<string, string[]>>(() => ({
  type: libFilter.type ? [libFilter.type] : [],
  subject: libFilter.subject ? [libFilter.subject] : [],
  grade: libFilter.grade ? [libFilter.grade] : [],
}))

function onLibFiltersChange(next: Record<string, string[]>) {
  libFilter.type = next.type?.[0] ?? ''
  libFilter.subject = next.subject?.[0] ?? ''
  libFilter.grade = next.grade?.[0] ?? ''
}

const kindTagClass = (kind: string) =>
  kind === '题目' || kind === '试卷' ? 'tag-gray' : kind === '视频' ? 'tag-green' : 'tag-blue'

/** 三类来源合成一张卡片列表：审批通过的资源、已发布备课文档、已共享广场的试卷 */
const library = computed<LibItem[]>(() => {
  const items: LibItem[] = []
  for (const approval of approvals.value) {
    if (approval.status !== 'approved') continue
    items.push({
      kind: approval.kind,
      name: approval.name,
      subject: approval.subject,
      grade: approval.grade,
      scope: approval.scope,
      uploader: approval.applicant,
      time: approval.reviewedAt ?? approval.submittedAt,
      id: approval.id,
    })
  }
  for (const doc of docs.value) {
    if (doc.status !== 'published') continue
    items.push({
      kind: TEACH_KIND_TEXT[doc.kind],
      name: doc.name,
      subject: doc.subject,
      grade: doc.grade,
      scope: 'school',
      uploader: doc.owner,
      time: doc.updatedAt,
      id: doc.id,
      docKind: doc.kind,
    })
  }
  for (const paper of papers.value) {
    if (!paper.sharedSquare) continue
    items.push({
      kind: '试卷',
      name: paper.name,
      subject: paper.subject,
      grade: paper.grade,
      scope: 'public',
      uploader: paper.owner,
      time: paper.updatedAt,
      id: paper.id,
      paper: true,
    })
  }
  return items
})

const libFiltered = computed(() =>
  library.value.filter(
    (row) =>
      (!libFilter.type || row.kind === libFilter.type) &&
      (!libFilter.subject || row.subject === libFilter.subject) &&
      (!libFilter.grade || row.grade === libFilter.grade) &&
      (!libFilter.keyword || row.name.includes(libFilter.keyword)),
  ),
)
const libRows = computed(() => libFiltered.value.slice((libPage.value - 1) * 12, libPage.value * 12))

function viewResource(item: LibItem) {
  if (item.paper) return router.push('/paper/list')
  if (item.docKind) return router.push(`/teach/${item.docKind}?id=${item.id}`)
  if (item.kind === '题目') return router.push('/question/bank')
  return router.push('/square')
}

async function load() {
  loading.value = true
  try {
    const kinds: TeachDocKind[] = ['lecture', 'courseware', 'plan', 'guide']
    const [approvalRows, paperRows, docRows] = await Promise.all([
      fetchApprovals('approved'),
      fetchPapers(),
      Promise.all(kinds.map((kind) => fetchTeachDocs(kind))),
    ])
    approvals.value = approvalRows
    papers.value = paperRows
    docs.value = docRows.flat()
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  try {
    await ensure()
    await load()
  } catch (e) {
    showToast(errMsg(e), 'error')
  }
})
</script>

<template>
  <div class="page">
    <AppPageHeader desc="通过审批的资源与已发布的备课文档统一沉淀为校本资源库，可按类型 / 学科 / 年级检索。" />

    <AppFilterPanel :model-value="libFilters" :rows="libFilterRows" @update:model-value="onLibFiltersChange" />

    <div class="panel">
      <AppListToolbar v-model="libFilter.keyword" placeholder="资源名称" class="rv-toolbar" />

      <div class="rv-grid">
        <p v-if="!libRows.length && !loading" class="empty-row" style="grid-column: 1 / -1">
          暂无校本资源，通过审批的资源与已发布备课文档会在此沉淀
        </p>
        <p v-if="loading" class="empty-row" style="grid-column: 1 / -1">加载中…</p>
        <div v-for="item in libRows" :key="`${item.kind}-${item.id}`" class="rv-card">
          <div class="rv-card-top">
            <span class="tag" :class="kindTagClass(item.kind)">{{ item.kind }}</span>
            <span class="tag" :class="item.scope === 'public' ? 'tag-green' : 'tag-blue'">
              {{ RESOURCE_SCOPE_TEXT[item.scope] }}
            </span>
          </div>
          <h3 class="rv-card-name">{{ item.name }}</h3>
          <p class="rv-card-meta">{{ item.grade }} · {{ item.subject }}</p>
          <p class="rv-card-foot">{{ item.uploader }} · {{ item.time.slice(0, 16) }}</p>
          <div class="op-group">
            <button class="mini-btn" @click="viewResource(item)">查看</button>
          </div>
        </div>
      </div>
      <AppPagination :total="libFiltered.length" v-model:page="libPage" :page-size="12" />
    </div>
  </div>
</template>

<style scoped>
/* 面板自身不留白：工具条 / 网格各自带内边距，分页组件自带内边距 */
.rv-toolbar { padding: 14px 16px 0; margin-bottom: 0; }
.rv-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; padding: 14px 16px 4px; }
.rv-card {
  border: 1.5px solid var(--border); border-radius: 12px;
  padding: 14px; display: flex; flex-direction: column; gap: 8px;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.rv-card:hover { border-color: var(--brand); box-shadow: var(--shadow); }
.rv-card-top { display: flex; align-items: center; gap: 6px; }
.rv-card-name { font-size: 14px; font-weight: 700; line-height: 1.5; }
.rv-card-meta { font-size: 12px; color: var(--sub); }
.rv-card-foot { font-size: 11.5px; color: var(--sub); }
</style>
