<script setup lang="ts">
/**
 * 公共题库管理（P-03-01/02/03/06/07/08）。
 *
 * 平台侧的题目运营：检索浏览 → 详情查看（含解析）→ 待审核队列审批 → 上架 / 下架。
 * 展示方式对齐机构端「题库管理」：左侧教材树（学科 / 年级）+ 右上筛选面板 +
 * 表格 / 详细双视图 + 分页 + 预览抽屉。
 *
 * 平台铁律（BR-001）：本端只做内容资产的审核与配置，不把题目下发给具体机构
 * （那是「内容分发」模块的职责）。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import {
  AppFilterPanel,
  AppListToolbar,
  AppIcon,
  AppPageHeader,
  AppSegmented,
  PLATFORM_CONTENT_STATUS_TEXT,
  showToast,
  AppDrawer,
  AppModal,
} from '@aiteach/shared'
import type { FilterRowDef, PlatformContentStatus, PlatformQuestion } from '@aiteach/shared'
import AppPagination from '@/components/ui/AppPagination.vue'
import SideTree, { type SideTreeNode } from '@/components/ui/SideTree.vue'
import { fetchPlatformQuestions, reviewPlatformQuestion, togglePlatformQuestion } from '@/api/content'

const all = ref<PlatformQuestion[]>([])
const keyword = ref('')
const loading = ref(true)

/* ===== 左侧树：学科 → 年级（驱动 scope） ===== */
const scope = ref({ subject: '', grade: '' })
const treeSelected = ref('all')

const treeNodes = computed<SideTreeNode[]>(() => {
  const bySubject = new Map<string, PlatformQuestion[]>()
  for (const q of all.value) {
    if (!bySubject.has(q.subject)) bySubject.set(q.subject, [])
    bySubject.get(q.subject)!.push(q)
  }
  const groups: SideTreeNode[] = [{ id: 'all', label: '全部题目', count: all.value.length }]
  for (const [subject, qs] of bySubject) {
    const grades = [...new Set(qs.map((q) => q.grade))]
    const children: SideTreeNode[] = grades.map((grade) => ({
      id: `g:${subject}/${grade}`,
      label: grade,
      count: qs.filter((q) => q.grade === grade).length,
    }))
    groups.push({ id: `s:${subject}`, label: subject, count: qs.length, children })
  }
  return groups
})

function onTreeSelect(id: string) {
  treeSelected.value = id
  if (id === 'all') {
    scope.value = { subject: '', grade: '' }
  } else if (id.startsWith('s:')) {
    scope.value = { subject: id.slice(2), grade: '' }
  } else if (id.startsWith('g:')) {
    const [subject, grade] = id.slice(2).split('/')
    scope.value = { subject, grade }
  }
  page.value = 1
}

/* ===== 右上筛选面板（状态 / 来源 / 质量） ===== */
const STATUS_OPTIONS = [
  { value: 'pending', text: '待审核' },
  { value: 'published', text: '已上架' },
  { value: 'rejected', text: '已驳回' },
  { value: 'offline', text: '已下架' },
]
const SOURCES = computed(() => [...new Set(all.value.map((q) => q.source))])

const FILTERS = reactive<Record<string, string[]>>({ status: [], source: [], quality: [] })

function onFiltersChange(next: Record<string, string[]>) {
  FILTERS.status = next.status ?? []
  FILTERS.source = next.source ?? []
  FILTERS.quality = next.quality ?? []
}

const FILTER_ROWS = computed<FilterRowDef[]>(() => [
  {
    key: 'status',
    label: '状态',
    options: STATUS_OPTIONS.map((item) => item.value),
    optionLabels: Object.fromEntries(STATUS_OPTIONS.map((item) => [item.value, item.text])),
    multiple: false,
  },
  { key: 'source', label: '来源', options: SOURCES.value, multiple: false },
  { key: 'quality', label: '质量', options: ['A', 'B', 'C'], multiple: false },
])

/* ===== 列表筛选 / 分页 / 视图 ===== */
const filtered = computed(() =>
  all.value.filter((q) => {
    if (scope.value.subject && q.subject !== scope.value.subject) return false
    if (scope.value.grade && q.grade !== scope.value.grade) return false
    const st = FILTERS.status[0]
    if (st && q.status !== st) return false
    const src = FILTERS.source[0]
    if (src && q.source !== src) return false
    const ql = FILTERS.quality[0]
    if (ql && q.quality !== ql) return false
    const kw = keyword.value.trim()
    if (kw && !q.stem.includes(kw) && !q.source.includes(kw)) return false
    return true
  }),
)

const viewMode = ref<'table' | 'detail'>('table')
const page = ref(1)
const pageSize = 10
const paged = computed(() => filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize))

const pendingCount = computed(() => all.value.filter((q) => q.status === 'pending').length)

function statusTag(status: PlatformContentStatus) {
  if (status === 'published') return 'tag-green'
  if (status === 'pending') return 'tag-orange'
  if (status === 'rejected') return 'tag-red'
  return 'tag-gray'
}
function qualityTag(quality: PlatformQuestion['quality']) {
  return quality === 'A' ? 'tag-green' : quality === 'B' ? 'tag-blue' : 'tag-orange'
}

/* ===== 详情 / 审核 / 上下架 ===== */
const detail = ref<PlatformQuestion | null>(null)
const reviewing = ref<null | { id: number; stem: string; pass: boolean }>(null)

async function submitReview() {
  if (!reviewing.value) return
  try {
    await reviewPlatformQuestion(reviewing.value.id, reviewing.value.pass)
    showToast(reviewing.value.pass ? '已通过并上架' : '已驳回', 'success')
    reviewing.value = null
    detail.value = null
    load()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '操作失败', 'error')
  }
}

async function onToggle(row: PlatformQuestion) {
  try {
    await togglePlatformQuestion(row.id)
    showToast(row.status === 'published' ? '已下架' : '已上架', 'success')
    load()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '操作失败', 'error')
  }
}

async function load() {
  loading.value = true
  /* mock 仅按 学科 / 状态 / 关键词 过滤，其余维度（年级 / 来源 / 质量）在视图内统一筛 */
  all.value = await fetchPlatformQuestions('', '', '')
  loading.value = false
}

onMounted(load)
</script>

<template>
  <div class="bank-layout">
    <!-- 左：学科 / 年级树（选中即驱动 scope，与右上筛选面板互补） -->
    <aside class="tree-panel">
      <div class="tree-title">教材目录</div>
      <div class="tree-body">
        <SideTree :nodes="treeNodes" :selected="treeSelected" :default-expand="true" @select="onTreeSelect" />
      </div>
    </aside>

    <!-- 右：筛选面板在上，列表在下（结构对齐机构端题库管理） -->
    <div class="right-col">
      <AppPageHeader desc="公共题库的检索、审核与上下架；题目通过审核后进入公共库，再由「内容分发」授权给租户使用。" />

      <div v-if="pendingCount" class="notice-bar">
        <AppIcon name="warning" :size="15" /> 当前有 <b>{{ pendingCount }}</b> 道题待审核，通过后进入公共库。
      </div>

      <AppFilterPanel :rows="FILTER_ROWS" :model-value="FILTERS" @update:model-value="onFiltersChange" />

      <div class="panel table-panel">
        <AppListToolbar v-model="keyword" placeholder="题干 / 来源关键词" :search-width="240">
          <template #right>
            <AppSegmented
              :options="[
                { value: 'table', label: '表格', icon: 'grid' },
                { value: 'detail', label: '详细', icon: 'file' },
              ]"
              :model-value="viewMode"
              @update:model-value="(v: string) => (viewMode = v as 'table' | 'detail')"
            />
          </template>
        </AppListToolbar>

        <!-- 表格视图 -->
        <div v-if="viewMode === 'table'" class="data-table-wrap">
          <table class="data-table bank-table">
            <thead>
              <tr>
                <th style="width: 46px">序号</th>
                <th>题干</th>
                <th style="width: 76px">题型</th>
                <th style="width: 120px">学科 / 年级</th>
                <th style="width: 66px">难度</th>
                <th style="width: 150px">知识点</th>
                <th style="width: 70px">质量</th>
                <th style="width: 130px">来源</th>
                <th style="width: 84px">状态</th>
                <th style="width: 200px">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="loading && all.length === 0">
                <td colspan="10" class="empty-row">加载中…</td>
              </tr>
              <tr v-else-if="paged.length === 0">
                <td colspan="10" class="empty-row">暂无题目</td>
              </tr>
              <template v-else>
                <tr v-for="(row, i) in paged" :key="row.id">
                  <td>{{ (page - 1) * pageSize + i + 1 }}</td>
                  <td class="stem-cell" @click="detail = row">{{ row.stem }}</td>
                  <td>{{ row.type }}</td>
                  <td>{{ row.subject }} · {{ row.grade }}</td>
                  <td>{{ row.difficulty }}</td>
                  <td class="knowledge-cell" :title="row.knowledge.join('、')">{{ row.knowledge.join('、') }}</td>
                  <td><span class="tag" :class="qualityTag(row.quality)">{{ row.quality }} 级</span></td>
                  <td>{{ row.source }}</td>
                  <td><span class="tag" :class="statusTag(row.status)">{{ PLATFORM_CONTENT_STATUS_TEXT[row.status] }}</span></td>
                  <td>
                    <div class="op-group">
                      <button class="mini-btn" type="button" @click="detail = row">详情</button>
                      <button v-if="row.status === 'pending'" class="mini-btn" type="button" @click="reviewing = { id: row.id, stem: row.stem, pass: true }">审核</button>
                      <button
                        v-if="row.status === 'published' || row.status === 'offline'"
                        class="mini-btn"
                        type="button"
                        @click="onToggle(row)"
                      >
                        {{ row.status === 'published' ? '下架' : '上架' }}
                      </button>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>

        <!-- 详细视图 -->
        <div v-else class="detail-list">
          <p v-if="paged.length === 0" class="empty-row">暂无题目</p>
          <article v-for="row in paged" :key="row.id" class="q-card">
            <div class="qc-meta">
              <span class="qc-id">#{{ row.id }}</span>
              <span class="tag tag-blue">{{ row.type }}</span>
              <span class="tag" :class="qualityTag(row.quality)">{{ row.quality }} 级</span>
              <span class="tag" :class="statusTag(row.status)">{{ PLATFORM_CONTENT_STATUS_TEXT[row.status] }}</span>
              <span class="qc-kp">{{ row.subject }} · {{ row.grade }} · 难度 {{ row.difficulty }}</span>
            </div>
            <p class="qc-stem" @click="detail = row">{{ row.stem }}</p>
            <div class="qc-knowledge">知识点：{{ row.knowledge.join('、') }}</div>
            <div class="qc-ops">
              <button class="mini-btn" type="button" @click="detail = row">详情</button>
              <button v-if="row.status === 'pending'" class="mini-btn" type="button" @click="reviewing = { id: row.id, stem: row.stem, pass: true }">审核</button>
              <button
                v-if="row.status === 'published' || row.status === 'offline'"
                class="mini-btn"
                type="button"
                @click="onToggle(row)"
              >
                {{ row.status === 'published' ? '下架' : '上架' }}
              </button>
            </div>
          </article>
        </div>

        <AppPagination :total="filtered.length" v-model:page="page" :page-size="pageSize" />
      </div>
    </div>

    <!-- 题目详情 -->
    <AppDrawer
      v-if="detail"
      title="题目详情"
      :subtitle="`${detail.subject} · ${detail.grade} · ${detail.type}`"
      :width="560"
      @close="detail = null"
    >
      <div class="detail-block">
        <h4>题干</h4>
        <p class="stem-text">{{ detail.stem }}</p>
      </div>
      <div class="detail-block">
        <h4>答案</h4>
        <p class="stem-text">{{ detail.answer }}</p>
      </div>
      <div class="detail-block">
        <h4>解析</h4>
        <p class="analysis-text">{{ detail.analysis }}</p>
      </div>
      <div class="detail-meta">
        <span>难度：{{ detail.difficulty }}</span>
        <span>质量分级：{{ detail.quality }} 级</span>
        <span>来源：{{ detail.source }}</span>
        <span>引用：{{ detail.refs }} 次</span>
        <span>状态：{{ PLATFORM_CONTENT_STATUS_TEXT[detail.status] }}</span>
        <span>更新时间：{{ detail.updatedAt }}</span>
      </div>
      <div v-if="detail.status === 'pending'" class="drawer-actions">
        <button class="btn btn-ghost" type="button" @click="reviewing = { id: detail.id, stem: detail.stem, pass: false }">驳回</button>
        <button class="btn btn-primary" type="button" @click="reviewing = { id: detail.id, stem: detail.stem, pass: true }">通过并上架</button>
      </div>
    </AppDrawer>

    <!-- 审核确认 -->
    <AppModal
      v-if="reviewing"
      :title="reviewing.pass ? '通过审核' : '驳回题目'"
      :width="440"
      @close="reviewing = null"
    >
      <p class="confirm-text">{{ reviewing.stem.slice(0, 60) }}{{ reviewing.stem.length > 60 ? '…' : '' }}</p>
      <p class="confirm-note">
        {{ reviewing.pass ? '通过后题目进入公共题库（已上架），可由内容分发授权给租户。' : '驳回后题目状态置为已驳回，可修改后重新提审。' }}
      </p>
      <template #footer>
        <button class="btn btn-ghost" type="button" @click="reviewing = null">取消</button>
        <button class="btn" :class="reviewing.pass ? 'btn-primary' : 'btn-danger'" type="button" @click="submitReview">
          {{ reviewing.pass ? '确认通过' : '确认驳回' }}
        </button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
/* 左右两栏高度随屏幕撑满内容区（顶栏 62 + 内容区上下内边距 44），左右各自内部滚动 */
.bank-layout {
  --content-h: calc(100vh - 106px);
  display: flex;
  gap: 14px;
  align-items: stretch;
  height: var(--content-h);
  min-height: 460px;
}
.tree-panel {
  width: 220px;
  flex-shrink: 0;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.tree-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--ink);
  padding: 14px 14px 10px;
  border-bottom: 1px solid var(--border);
}
.tree-body { flex: 1; min-height: 0; overflow-y: auto; padding: 8px; }

.right-col {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%;
}
.notice-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: #fff7ed;
  border: 1px solid #fed7aa;
  border-radius: 10px;
  font-size: 13px;
  color: #92600a;
}
.notice-bar b { font-size: 15px; }

.table-panel {
  min-width: 0;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 14px 16px 12px;
}
.data-table-wrap { flex: 1; min-height: 0; overflow: auto; }
.bank-table { table-layout: fixed; min-width: 1080px; }
.stem-cell {
  max-width: 320px;
  cursor: pointer;
  color: var(--brand-deep);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.stem-cell:hover { text-decoration: underline; }
.knowledge-cell { font-size: 12.5px; max-width: 150px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* 详细视图卡片 */
.detail-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-right: 2px;
}
.q-card { border: 1px solid var(--border); border-radius: 14px; background: #fff; padding: 14px 18px; }
.qc-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.qc-id { font-size: 13px; font-weight: 700; color: var(--ink); }
.qc-kp { font-size: 12px; color: var(--sub); margin-left: auto; }
.qc-stem { font-size: 13.5px; color: var(--ink); line-height: 1.8; cursor: pointer; margin: 0; }
.qc-knowledge { font-size: 12px; color: var(--sub); margin-top: 8px; }
.qc-ops { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 12px; border-top: 1px dashed var(--border); padding-top: 10px; }

/* 抽屉详情 */
.detail-block { margin-bottom: 16px; }
.detail-block h4 { font-size: 13px; margin: 0 0 6px; color: var(--sub); }
.stem-text { font-size: 14px; line-height: 1.8; color: var(--text); margin: 0; }
.analysis-text { font-size: 13px; line-height: 1.9; color: var(--text); margin: 0; white-space: pre-wrap; }
.detail-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
  font-size: 12.5px;
  color: var(--sub);
}
.drawer-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
.confirm-text { font-size: 13px; color: var(--text); line-height: 1.7; margin: 0 0 8px; }
.confirm-note { font-size: 12.5px; color: var(--sub); line-height: 1.7; margin: 0; }
</style>
