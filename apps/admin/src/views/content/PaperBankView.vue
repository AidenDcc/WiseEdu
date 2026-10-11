<script setup lang="ts">
/**
 * 公共试卷库管理（P-03-11/12/13）。
 *
 * 平台侧试卷资产的审核与上架；试卷解析拆题入库（P-03-12 AI 增强）在演示中用
 * 「解析入库」按钮体现拆解结果，真实环境接 OCR + 题目结构化服务。
 *
 * 展示方式对齐机构端「试卷库」：左侧教材树（学科 / 年级）+ 右上筛选面板 +
 * 表格 / 详细双视图 + 分页 + 预览抽屉。
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
import type { FilterRowDef, PlatformContentStatus, PlatformPaper } from '@aiteach/shared'
import AppPagination from '@/components/ui/AppPagination.vue'
import SideTree, { type SideTreeNode } from '@/components/ui/SideTree.vue'
import { fetchPlatformPapers, reviewPlatformPaper } from '@/api/content'

const all = ref<PlatformPaper[]>([])
const keyword = ref('')
const loading = ref(true)

/* ===== 左侧树：学科 → 年级 ===== */
const scope = ref({ subject: '', grade: '' })
const treeSelected = ref('all')

const treeNodes = computed<SideTreeNode[]>(() => {
  const bySubject = new Map<string, PlatformPaper[]>()
  for (const p of all.value) {
    if (!bySubject.has(p.subject)) bySubject.set(p.subject, [])
    bySubject.get(p.subject)!.push(p)
  }
  const groups: SideTreeNode[] = [{ id: 'all', label: '全部试卷', count: all.value.length }]
  for (const [subject, ps] of bySubject) {
    const grades = [...new Set(ps.map((p) => p.grade))]
    const children: SideTreeNode[] = grades.map((grade) => ({
      id: `g:${subject}/${grade}`,
      label: grade,
      count: ps.filter((p) => p.grade === grade).length,
    }))
    groups.push({ id: `s:${subject}`, label: subject, count: ps.length, children })
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

/* ===== 右上筛选面板（状态 / 来源） ===== */
const STATUS_OPTIONS = [
  { value: 'pending', text: '待审核' },
  { value: 'published', text: '已上架' },
  { value: 'rejected', text: '已驳回' },
  { value: 'offline', text: '已下架' },
]
const SOURCES = computed(() => [...new Set(all.value.map((p) => p.source))])

const FILTERS = reactive<Record<string, string[]>>({ status: [], source: [] })

function onFiltersChange(next: Record<string, string[]>) {
  FILTERS.status = next.status ?? []
  FILTERS.source = next.source ?? []
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
])

/* ===== 列表筛选 / 分页 / 视图 ===== */
const filtered = computed(() =>
  all.value.filter((p) => {
    if (scope.value.subject && p.subject !== scope.value.subject) return false
    if (scope.value.grade && p.grade !== scope.value.grade) return false
    const st = FILTERS.status[0]
    if (st && p.status !== st) return false
    const src = FILTERS.source[0]
    if (src && p.source !== src) return false
    if (keyword.value.trim() && !p.name.includes(keyword.value.trim())) return false
    return true
  }),
)

const viewMode = ref<'table' | 'detail'>('table')
const page = ref(1)
const pageSize = 10
const paged = computed(() => filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize))

const pendingCount = computed(() => all.value.filter((p) => p.status === 'pending').length)

function statusTag(status: PlatformContentStatus) {
  if (status === 'published') return 'tag-green'
  if (status === 'pending') return 'tag-orange'
  if (status === 'rejected') return 'tag-red'
  return 'tag-gray'
}

/* ===== 详情 / 审核 ===== */
const detail = ref<PlatformPaper | null>(null)
const reviewing = ref<null | { id: number; name: string; pass: boolean }>(null)

async function submitReview() {
  if (!reviewing.value) return
  try {
    await reviewPlatformPaper(reviewing.value.id, reviewing.value.pass)
    showToast(reviewing.value.pass ? '已通过并上架' : '已驳回', 'success')
    reviewing.value = null
    detail.value = null
    load()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '操作失败', 'error')
  }
}

function parseInto(row: PlatformPaper) {
  void row
  showToast('解析拆题入库（AI 增强）已加入任务队列', 'success')
}

async function load() {
  loading.value = true
  all.value = await fetchPlatformPapers('', '')
  loading.value = false
}

onMounted(load)
</script>

<template>
  <div class="paper-layout">
    <!-- 左：学科 / 年级树 -->
    <aside class="tree-panel">
      <div class="tree-title">教材目录</div>
      <div class="tree-body">
        <SideTree :nodes="treeNodes" :selected="treeSelected" :default-expand="true" @select="onTreeSelect" />
      </div>
    </aside>

    <!-- 右：筛选面板 + 列表 -->
    <div class="right-col">
      <AppPageHeader desc="公共试卷库：整卷资产审核与上架；支持从试卷解析拆题入库（AI 增强），拆出的题回流公共题库。" />

      <div v-if="pendingCount" class="notice-bar">
        <AppIcon name="warning" :size="15" /> 当前有 <b>{{ pendingCount }}</b> 份试卷待审核，通过后进入公共试卷库。
      </div>

      <AppFilterPanel :rows="FILTER_ROWS" :model-value="FILTERS" @update:model-value="onFiltersChange" />

      <div class="panel table-panel">
        <AppListToolbar v-model="keyword" placeholder="试卷名称" :search-width="240">
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
          <table class="data-table paper-table">
            <thead>
              <tr>
                <th style="width: 46px">序号</th>
                <th>试卷名称</th>
                <th style="width: 130px">学科 / 年级</th>
                <th style="width: 90px">题量</th>
                <th style="width: 90px">总分</th>
                <th style="width: 130px">来源</th>
                <th style="width: 84px">状态</th>
                <th style="width: 200px">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="loading && all.length === 0">
                <td colspan="8" class="empty-row">加载中…</td>
              </tr>
              <tr v-else-if="paged.length === 0">
                <td colspan="8" class="empty-row">暂无试卷</td>
              </tr>
              <template v-else>
                <tr v-for="(row, i) in paged" :key="row.id">
                  <td>{{ (page - 1) * pageSize + i + 1 }}</td>
                  <td class="name-cell" @click="detail = row">{{ row.name }}</td>
                  <td>{{ row.subject }} · {{ row.grade }}</td>
                  <td>{{ row.questionCount }} 题</td>
                  <td>{{ row.fullScore }} 分</td>
                  <td>{{ row.source }}</td>
                  <td><span class="tag" :class="statusTag(row.status)">{{ PLATFORM_CONTENT_STATUS_TEXT[row.status] }}</span></td>
                  <td>
                    <div class="op-group">
                      <button class="mini-btn" type="button" @click="detail = row">详情</button>
                      <button v-if="row.status === 'pending'" class="mini-btn" type="button" @click="reviewing = { id: row.id, name: row.name, pass: true }">审核</button>
                      <button class="mini-btn" type="button" @click="parseInto(row)">解析入库</button>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>

        <!-- 详细视图 -->
        <div v-else class="detail-list">
          <p v-if="paged.length === 0" class="empty-row">暂无试卷</p>
          <article v-for="row in paged" :key="row.id" class="p-card">
            <div class="pc-meta">
              <span class="pc-name" @click="detail = row">{{ row.name }}</span>
              <span class="tag" :class="statusTag(row.status)">{{ PLATFORM_CONTENT_STATUS_TEXT[row.status] }}</span>
            </div>
            <div class="pc-info">{{ row.subject }} · {{ row.grade }} · {{ row.questionCount }} 题 · {{ row.fullScore }} 分 · {{ row.source }}</div>
            <div class="pc-ops">
              <button class="mini-btn" type="button" @click="detail = row">详情</button>
              <button v-if="row.status === 'pending'" class="mini-btn" type="button" @click="reviewing = { id: row.id, name: row.name, pass: true }">审核</button>
              <button class="mini-btn" type="button" @click="parseInto(row)">解析入库</button>
            </div>
          </article>
        </div>

        <AppPagination :total="filtered.length" v-model:page="page" :page-size="pageSize" />
      </div>
    </div>

    <!-- 试卷详情 -->
    <AppDrawer
      v-if="detail"
      title="试卷详情"
      :subtitle="`${detail.subject} · ${detail.grade}`"
      :width="520"
      @close="detail = null"
    >
      <div class="detail-block">
        <h4>试卷名称</h4>
        <p class="stem-text">{{ detail.name }}</p>
      </div>
      <div class="detail-meta">
        <span>学科：{{ detail.subject }}</span>
        <span>年级：{{ detail.grade }}</span>
        <span>题量：{{ detail.questionCount }} 题</span>
        <span>总分：{{ detail.fullScore }} 分</span>
        <span>来源：{{ detail.source }}</span>
        <span>引用：{{ detail.refs }} 次</span>
        <span>状态：{{ PLATFORM_CONTENT_STATUS_TEXT[detail.status] }}</span>
        <span>更新时间：{{ detail.updatedAt }}</span>
      </div>
      <div class="drawer-actions">
        <button v-if="detail.status === 'pending'" class="btn btn-ghost" type="button" @click="reviewing = { id: detail.id, name: detail.name, pass: false }">驳回</button>
        <button v-if="detail.status === 'pending'" class="btn btn-primary" type="button" @click="reviewing = { id: detail.id, name: detail.name, pass: true }">通过并上架</button>
        <button class="btn btn-ghost" type="button" @click="parseInto(detail)">解析入库</button>
      </div>
    </AppDrawer>

    <!-- 审核确认 -->
    <AppModal
      v-if="reviewing"
      :title="reviewing.pass ? '通过审核' : '驳回试卷'"
      :width="440"
      @close="reviewing = null"
    >
      <p class="confirm-text">{{ reviewing.name }}</p>
      <p class="confirm-note">
        {{ reviewing.pass ? '通过后试卷进入公共试卷库（已上架），可由内容分发授权给租户使用。' : '驳回后试卷状态置为已驳回。' }}
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
.bank-layout,
.paper-layout {
  --content-h: calc(100vh - 106px);
  display: flex;
  gap: 14px;
  align-items: stretch;
  height: var(--content-h);
  min-height: 480px;
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
.paper-table { table-layout: fixed; min-width: 980px; }
.name-cell {
  cursor: pointer;
  color: var(--brand-deep);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.name-cell:hover { text-decoration: underline; }

.detail-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-right: 2px;
}
.p-card { border: 1px solid var(--border); border-radius: 14px; background: #fff; padding: 14px 18px; }
.pc-meta { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.pc-name { font-size: 14px; font-weight: 700; color: var(--ink); cursor: pointer; }
.pc-name:hover { color: var(--brand-deep); }
.pc-info { font-size: 12.5px; color: var(--sub); }
.pc-ops { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 12px; border-top: 1px dashed var(--border); padding-top: 10px; }

.detail-block { margin-bottom: 16px; }
.detail-block h4 { font-size: 13px; margin: 0 0 6px; color: var(--sub); }
.stem-text { font-size: 14px; line-height: 1.8; color: var(--text); margin: 0; }
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
.confirm-text { font-size: 14px; font-weight: 600; color: var(--text); margin: 0 0 8px; }
.confirm-note { font-size: 12.5px; color: var(--sub); line-height: 1.7; margin: 0; }
</style>
