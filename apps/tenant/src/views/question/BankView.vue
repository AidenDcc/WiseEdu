<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AppIcon, RichTextViewer, showToast, ApiError, QUESTION_STATUS_TEXT, hasImage, toPlainText, truncateRich } from '@aiteach/shared'
import type { OrgQuestion } from '@aiteach/shared'
import AppModal from '@/components/ui/AppModal.vue'
import AppDrawer from '@/components/ui/AppDrawer.vue'
import AppPagination from '@/components/ui/AppPagination.vue'
import KnowledgeFilter from '@/components/ui/KnowledgeFilter.vue'
import {
  deleteQuestions,
  fetchQuestions,
  fetchTenantDict,
  variantOf,
} from '@/api/org'
import { useScope } from '@/composables/useScope'
import { useComposeBasket } from '@/composables/useComposeBasket'

const router = useRouter()
const route = useRoute()

/** 顶部栏的全局年级 / 学科：作为筛选默认值，切换时同步 */
const { grade: scopeGrade, subject: scopeSubject, ensureScope } = useScope()

const LIBRARY_TEXT: Record<string, string> = { personal: '个人题库', org: '机构公共', wrong: '错题库' }
const STATUS_CLASS: Record<string, string> = {
  draft: 'tag-gray',
  checking: 'tag-blue',
  pending: 'tag-orange',
  approved: 'tag-green',
  rejected: 'tag-red',
}

/* ===== 数据 ===== */
const list = ref<OrgQuestion[]>([])
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    // 字典加载失败不阻断开列（顶部栏作用域退化为缓存值，筛选仍可手动调整）
    await ensureScope().catch(() => {})
    applyScope()
    list.value = await fetchQuestions()
  } finally {
    loading.value = false
  }
}

/* ===== 左侧教材知识点过滤（KnowledgeFilter 组件，选中节点返回子树叶子 tag） ===== */
const activeTags = ref<string[] | null>(null)
function onKnowledgeChange(tags: string[] | null) {
  activeTags.value = tags
}

/* ================= 右上：可折叠筛选条件 ================= */
interface FilterRowDef {
  key: 'type' | 'difficulty' | 'grade' | 'subject' | 'term' | 'examType'
  label: string
  dict?: string
  options?: string[]
}

const FILTER_ROWS: FilterRowDef[] = [
  { key: 'type', label: '题型', dict: 'questionType' },
  { key: 'difficulty', label: '难度', dict: 'difficulty' },
  { key: 'grade', label: '年级', dict: 'grade' },
  { key: 'subject', label: '学科', dict: 'subject' },
  { key: 'term', label: '学期', options: ['上学期', '下学期'] },
  { key: 'examType', label: '考试类型', dict: 'examType' },
]

const filterSel = reactive<Record<FilterRowDef['key'], string[]>>({
  type: [],
  difficulty: [],
  grade: [],
  subject: [],
  term: [],
  examType: [],
})
const filterOptions = reactive<Record<string, string[]>>({})
const filterOpen = ref(true)
/** 折叠态每个已选条件值串的最大展示长度（超出省略） */
const COLLAPSE_MAX = 18

const activeFilterRows = computed(() =>
  FILTER_ROWS.filter((row) => filterSel[row.key].length > 0).map((row) => ({
    ...row,
    text: filterSel[row.key].join('、'),
    overflow: filterSel[row.key].join('、').length > COLLAPSE_MAX,
  })),
)

function toggleOption(key: FilterRowDef['key'], option: string) {
  const bucket = filterSel[key]
  const index = bucket.indexOf(option)
  if (index >= 0) bucket.splice(index, 1)
  else bucket.push(option)
}

function rowOptions(row: FilterRowDef): string[] {
  if (row.options) return row.options
  return filterOptions[row.dict ?? ''] ?? []
}

function clearFilters() {
  FILTER_ROWS.forEach((row) => (filterSel[row.key] = []))
}

/* ================= 顶部栏全局年级 / 学科 → 筛选默认值 ================= */
/** 题库默认只看当前作用域（年级 + 学科）；顶部栏切换后立刻跟随，避免两个入口各说各话 */
function applyScope() {
  if (scopeGrade.value) filterSel.grade = [scopeGrade.value]
  if (scopeSubject.value) filterSel.subject = [scopeSubject.value]
}

watch([scopeGrade, scopeSubject], () => applyScope())

async function loadDicts() {
  const dictTypes = [...new Set(FILTER_ROWS.map((row) => row.dict).filter((d): d is string => !!d))]
  await Promise.all(
    dictTypes.map(async (type) => {
      filterOptions[type] = (await fetchTenantDict(type)).map((item) => item.name)
    }),
  )
}

/* ================= 列表筛选 / 分页 ================= */
/** 工作台全局搜索跳转过来时带 ?keyword=；同路由换关键词不会重新挂载，故用 watch 跟随 */
const keyword = ref(typeof route.query.keyword === 'string' ? route.query.keyword : '')
watch(
  () => route.query.keyword,
  (value) => {
    if (typeof value === 'string') keyword.value = value
  },
)
const viewMode = ref<'table' | 'detail'>('table')
const page = ref(1)

const FIELD_OF: Record<FilterRowDef['key'], (row: OrgQuestion) => string> = {
  type: (row) => row.type,
  difficulty: (row) => row.difficulty,
  grade: (row) => row.grade,
  subject: (row) => row.subject,
  term: (row) => row.term ?? '',
  examType: (row) => row.examType ?? '',
}

const filtered = computed(() => {
  const kw = keyword.value.trim()
  return list.value.filter((row) => {
    if (activeTags.value && !row.knowledge.some((tag) => activeTags.value!.includes(tag))) return false
    for (const def of FILTER_ROWS) {
      const selected = filterSel[def.key]
      if (selected.length > 0 && !selected.includes(FIELD_OF[def.key](row))) return false
    }
    if (kw && !toPlainText(row.stem).includes(kw) && !String(row.id).includes(kw)) return false
    return true
  })
})

/** 表格与详细两种展示每页都是 10 条 */
const pageSize = 10
const paged = computed(() => filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize))

watch([activeTags, () => JSON.stringify(filterSel), keyword, viewMode], () => {
  page.value = 1
})

/** 图形占位框：题干提到配图、且题内确实没有嵌入图片时才显示 */
function needsFigure(row: OrgQuestion): boolean {
  if (hasImage(row.stem)) return false
  const text = toPlainText(row.stem)
  return text.includes('如图') || text.includes('图）')
}

/** 选项答案字母（选择题高亮正确项） */
function answerLetters(row: OrgQuestion): string[] {
  return row.options.length > 0 ? [...new Set(row.answer.toUpperCase().replace(/[^A-F]/g, '').split(''))] : []
}

/* ===== 详细列表：解析展开 ===== */
const analysisOpen = ref<number[]>([])

function toggleAnalysis(id: number) {
  const index = analysisOpen.value.indexOf(id)
  if (index >= 0) analysisOpen.value.splice(index, 1)
  else analysisOpen.value.push(id)
}

/* ================= 组卷篮（加入组卷库） ================= */
/* 组卷工作台的组卷车（localStorage）：跨标签页交接的落点，见 pourIntoCompose */
const composeBasket = useComposeBasket()
const BASKET_KEY = 'aiteach.paper-basket'
const basket = ref<number[]>([])

function restoreBasket() {
  try {
    const raw = sessionStorage.getItem(BASKET_KEY)
    if (raw) basket.value = JSON.parse(raw) as number[]
  } catch {
    basket.value = []
  }
}

watch(
  basket,
  (ids) => {
    if (ids.length) sessionStorage.setItem(BASKET_KEY, JSON.stringify(ids))
    else sessionStorage.removeItem(BASKET_KEY)
  },
  { deep: true },
)

function addToBasket(row: OrgQuestion) {
  if (basket.value.includes(row.id)) return
  basket.value.push(row.id)
  showToast(`题目 #${row.id} 已加入组卷库`, 'success')
}

function clearBasket() {
  basket.value = []
  showToast('已清空组卷库', 'info')
}

function goCollab() {
  router.push({ path: '/paper/collab', query: { basket: '1' } })
}

/**
 * 带着本页组卷篮去「题库组卷」工作台。
 *
 * 为什么需要这道桥：本页的篮子是 `sessionStorage`（按标签页隔离），而工作台开在**另一个
 * 标签页**里，读不到它。所以交接必须在点击的当下、在本页把题灌进工作台的 localStorage 组卷车。
 *
 * 用 `<a target="_blank">` 而不是 `window.open`：新标签页由浏览器自己打开，永远不会被
 * 弹窗拦截器拦下（本函数虽然是同步的，但把「开标签页」交给浏览器更稳）。
 */
function pourIntoCompose() {
  const rows = basket.value
    .map((id) => list.value.find((row) => row.id === id))
    .filter((row): row is OrgQuestion => Boolean(row))
  const added = composeBasket.addMany(rows, 'pool')
  const skipped = rows.length - added
  if (added === 0) {
    showToast(rows.length === 0 ? '组卷篮中的题目已不在题库中' : `这 ${rows.length} 道题都已在组卷车中`)
    return
  }
  showToast(skipped > 0 ? `已带入 ${added} 题，另有 ${skipped} 题已在组卷车中` : `已带入 ${added} 题到组卷工作台`)
}

/* ===== 操作：预览 / 编辑 / 变式 / 删除 ===== */
const preview = ref<OrgQuestion | null>(null)
const variantOpen = ref<OrgQuestion | null>(null)

/** 带题目 id 进录题中心（落手动态；新建入口在侧边菜单，列表里只做编辑） */
function goEdit(id: number) {
  router.push({ path: '/question/create', query: { id: String(id) } })
}

async function onManualVariant() {
  if (!variantOpen.value) return
  const copy = await variantOf(variantOpen.value.id)
  showToast('已复制原题为变式草稿，永久建立关联', 'success')
  variantOpen.value = null
  goEdit(copy.id)
  void load()
}

function goAiVariant() {
  if (!variantOpen.value) return
  router.push({ path: '/question/create', query: { mode: 'ai', variantOf: String(variantOpen.value.id) } })
  variantOpen.value = null
}

async function onDelete(row: OrgQuestion) {
  if (!window.confirm('确认删除该题？删除后进入回收站（30 天）。')) return
  try {
    await deleteQuestions([row.id])
    showToast('已删除（进入回收站）', 'success')
    load()
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : '删除失败', 'error')
  }
}

/* ===== 挂载 ===== */
onMounted(() => {
  restoreBasket()
  void load()
  void loadDicts()
})
</script>

<template>
  <div class="bank-layout">
    <KnowledgeFilter :rows="list" @change="onKnowledgeChange" />

    <!-- 右侧 -->
    <div class="right-col">
      <!-- 搜索条件（可折叠） -->
      <div class="panel filter-panel">
        <div class="fp-head" @click="filterOpen = !filterOpen">
          <span class="fp-title">
            搜索条件
            <span v-if="!filterOpen" class="fp-summary">
              <template v-if="activeFilterRows.length">
                <span v-for="row in activeFilterRows" :key="row.key" class="fp-chip">
                  <b>{{ row.label }}</b>
                  <span class="fp-values" :class="{ overflow: row.overflow }" :title="row.text">{{ row.text }}</span>
                </span>
              </template>
              <span v-else class="fp-none">暂无筛选条件</span>
            </span>
          </span>
          <span class="fp-toggle">
            <button v-if="activeFilterRows.length" class="mini-btn" type="button" @click.stop="clearFilters">清空</button>
            {{ filterOpen ? '收起' : '展开' }}
            <AppIcon name="chevron-down" :size="15" class="fp-caret" :class="{ up: filterOpen }" />
          </span>
        </div>
        <div v-if="filterOpen" class="fp-body">
          <div v-for="def in FILTER_ROWS" :key="def.key" class="cf-row">
            <span class="cf-label">{{ def.label }}</span>
            <div class="cf-opts">
              <button
                v-for="option in rowOptions(def)"
                :key="option"
                class="opt-chip"
                :class="{ on: filterSel[def.key].includes(option) }"
                type="button"
                @click="toggleOption(def.key, option)"
              >
                {{ option }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 试题列表 -->
      <div class="panel table-panel">
        <div class="list-toolbar">
          <div class="search-box">
            <AppIcon name="search" :size="15" />
            <input v-model="keyword" class="f-input" placeholder="题干关键词 / 题目编号" />
          </div>
          <div class="mode-toggle">
            <button :class="{ on: viewMode === 'table' }" type="button" @click="viewMode = 'table'">
              <AppIcon name="grid" :size="14" /> 表格
            </button>
            <button :class="{ on: viewMode === 'detail' }" type="button" @click="viewMode = 'detail'">
              <AppIcon name="file" :size="14" /> 详细
            </button>
          </div>
        </div>

        <!-- 表格显示 -->
        <div v-if="viewMode === 'table'" class="data-table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th style="width: 46px">序号</th>
                <th style="width: 84px">题目编号</th>
                <th class="th-stem">题干</th>
                <th style="width: 76px">题型</th>
                <th style="width: 66px">难度</th>
                <th style="width: 150px">知识点</th>
                <th style="width: 76px">考试次数</th>
                <th style="width: 96px">更新时间</th>
                <th style="width: 250px">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="loading && list.length === 0">
                <td colspan="9" class="empty-row">加载中…</td>
              </tr>
              <tr v-else-if="paged.length === 0">
                <td colspan="9" class="empty-row">暂无符合条件的题目</td>
              </tr>
              <template v-else>
                <tr v-for="(row, i) in paged" :key="row.id">
                  <td>{{ (page - 1) * pageSize + i + 1 }}</td>
                  <td class="cell-strong">#{{ row.id }}</td>
                  <td class="stem-cell" @click="preview = row"><RichTextViewer :content="row.stem" tag="span" /></td>
                  <td>{{ row.type }}</td>
                  <td>{{ row.difficulty }}</td>
                  <td class="knowledge-cell" :title="row.knowledge.join('、')">{{ row.knowledge.join('、') }}</td>
                  <td>{{ row.useCount }} 次</td>
                  <td class="time-cell">{{ row.updatedAt.slice(5, 16) }}</td>
                  <td>
                    <div class="op-group">
                      <button class="mini-btn" type="button" @click="preview = row">预览</button>
                      <button class="mini-btn" type="button" @click="goEdit(row.id)">编辑</button>
                      <button class="mini-btn" type="button" @click="variantOpen = row">变式</button>
                      <button
                        class="mini-btn success"
                        :disabled="basket.includes(row.id)"
                        type="button"
                        @click="addToBasket(row)"
                      >
                        {{ basket.includes(row.id) ? '已在组卷库' : '加入组卷库' }}
                      </button>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>

        <!-- 详细列表：完整面板卡片 -->
        <div v-else class="detail-list">
          <p v-if="paged.length === 0" class="empty-row" style="padding: 30px 0; text-align: center">暂无符合条件的题目</p>
          <article v-for="row in paged" :key="row.id" class="q-card">
            <div class="qc-meta">
              <span class="qc-id">#{{ row.id }}</span>
              <span class="tag tag-blue">{{ row.type }}</span>
              <span class="tag" :class="row.difficulty === '困难' || row.difficulty === '较难' ? 'tag-red' : row.difficulty === '中等' ? 'tag-orange' : 'tag-green'">{{ row.difficulty }}</span>
              <span class="tag" :class="STATUS_CLASS[row.status]">{{ QUESTION_STATUS_TEXT[row.status] }}</span>
              <span class="qc-kp">{{ row.knowledge.join('、') }}</span>
              <span class="qc-right">考试 {{ row.useCount }} 次 · {{ row.updatedAt.slice(5, 16) }}</span>
            </div>
            <RichTextViewer class="qc-stem" :content="row.stem" @click="preview = row" />
            <!-- 配图（含图形描述的题展示图位；题内已嵌图的不再占位） -->
            <div v-if="needsFigure(row)" class="qc-figure">
              <AppIcon name="image" :size="26" />
              <span>题目配图（演示占位）</span>
            </div>
            <ul v-if="row.options.length > 0" class="qc-options">
              <li
                v-for="(opt, i) in row.options"
                :key="i"
                :class="{ right: answerLetters(row).includes('ABCDEF'[i]) }"
              >
                <span class="opt-letter">{{ 'ABCDEF'[i] }}</span>
                <RichTextViewer :content="opt" tag="span" />
              </li>
            </ul>
            <div v-if="analysisOpen.includes(row.id)" class="qc-answer">
              <p>
                <b>答案：</b>
                <!-- 客观题答案是字母用强调色纯文本；问答题答案是富文本（公式/插图） -->
                <span v-if="row.options.length" class="qc-answer-text">{{ row.answer || '—' }}</span>
                <RichTextViewer v-else :content="row.answer" tag="span" empty="—" />
              </p>
              <p><b>解析：</b><RichTextViewer :content="row.analysis" tag="span" empty="—" /></p>
            </div>
            <div v-if="basket.includes(row.id) || row.status === 'rejected'" class="qc-flags">
              <span v-if="basket.includes(row.id)" class="tag tag-green">已加入组卷库</span>
              <span v-if="row.status === 'rejected'" class="qc-reject">驳回意见：{{ row.reviewOpinion }}</span>
            </div>
            <div class="qc-ops">
              <button class="btn btn-ghost btn-sm" type="button" @click="onDelete(row)">删除</button>
              <button class="mini-btn" type="button" @click="preview = row">预览</button>
              <button class="mini-btn" type="button" @click="toggleAnalysis(row.id)">
                {{ analysisOpen.includes(row.id) ? '收起解析' : '解析' }}
              </button>
              <button class="mini-btn" type="button" @click="goEdit(row.id)">编辑</button>
              <button class="mini-btn" type="button" @click="variantOpen = row">变式</button>
              <button
                class="mini-btn success"
                :disabled="basket.includes(row.id)"
                type="button"
                @click="addToBasket(row)"
              >
                {{ basket.includes(row.id) ? '已在组卷库' : '加入组卷库' }}
              </button>
            </div>
          </article>
        </div>

        <AppPagination :total="filtered.length" v-model:page="page" :page-size="pageSize" />
      </div>
    </div>

    <!-- 题目预览 -->
    <AppDrawer v-if="preview" :title="`题目 #${preview.id}`" subtitle="学生视角预览" @close="preview = null">
      <div class="detail-grid">
        <div class="detail-item"><div class="d-label">学科 / 年级</div><div class="d-value">{{ preview.subject }} · {{ preview.grade }}</div></div>
        <div class="detail-item"><div class="d-label">题型 / 难度</div><div class="d-value">{{ preview.type }} · {{ preview.difficulty }}</div></div>
        <div class="detail-item"><div class="d-label">知识点</div><div class="d-value">{{ preview.knowledge.join('、') }}</div></div>
        <div class="detail-item"><div class="d-label">来源 / 库</div><div class="d-value">{{ preview.source }} · {{ LIBRARY_TEXT[preview.library] }}</div></div>
        <div class="detail-item"><div class="d-label">学期 / 考试类型</div><div class="d-value">{{ preview.term ?? '—' }} · {{ preview.examType ?? '—' }}</div></div>
        <div class="detail-item"><div class="d-label">考试次数</div><div class="d-value">{{ preview.useCount }} 次</div></div>
      </div>
      <h4 class="section-title">题干</h4>
      <RichTextViewer class="q-text" :content="preview.stem" empty="—" />
      <template v-if="preview.options.length > 0">
        <h4 class="section-title">选项</h4>
        <ul class="option-list">
          <li v-for="(opt, i) in preview.options" :key="i" :class="{ right: answerLetters(preview).includes('ABCDEF'[i]) }">
            {{ 'ABCDEF'[i] }}. <RichTextViewer :content="opt" tag="span" />
          </li>
        </ul>
      </template>
      <h4 class="section-title">答案</h4>
      <RichTextViewer v-if="!preview.options.length" class="q-text" :content="preview.answer" empty="—" />
      <p v-else class="q-text answer">{{ preview.answer || '—' }}</p>
      <h4 class="section-title">解析</h4>
      <RichTextViewer class="q-text" :content="preview.analysis" empty="—" />
      <template v-if="preview.variantOf != null">
        <h4 class="section-title">变式关联</h4>
        <p class="q-text">本题为题目 #{{ preview.variantOf }} 的变式，原题-变式关联永久存档，可互跳。</p>
      </template>
      <template v-if="preview.reviewOpinion">
        <h4 class="section-title">审核意见</h4>
        <p class="q-text reject">{{ preview.reviewOpinion }}</p>
      </template>
    </AppDrawer>

    <!-- 变式入口 -->
    <AppModal v-if="variantOpen" :title="`变式 · 题目 #${variantOpen.id}`" @close="variantOpen = null">
      <p class="f-hint" style="margin-bottom: 12px">{{ truncateRich(variantOpen.stem, 60) }}…</p>
      <button class="variant-entry" type="button" @click="onManualVariant">
        <span class="ve-title">手动变式</span>
        <span class="ve-desc">复制原题全部内容进入录题页，人工修改后保存，系统永久建立原题-变式关联</span>
      </button>
      <button class="variant-entry" type="button" @click="goAiVariant">
        <span class="ve-title">AI 变式</span>
        <span class="ve-desc">选择变式策略批量生成（消耗 AI 额度），结果卡片可逐题采纳 / 丢弃</span>
      </button>
    </AppModal>

    <!-- 组卷篮浮动条 -->
    <div v-if="basket.length" class="basket-bar">
      <AppIcon name="file" :size="16" />
      <span>已选 <b>{{ basket.length }}</b> 题</span>
      <button class="btn btn-primary btn-sm" @click="goCollab">去组卷</button>
      <a class="btn btn-ghost btn-sm" href="/paper/compose" target="_blank" rel="noopener" @click="pourIntoCompose">
        在新标签页组卷
      </a>
      <button class="btn btn-ghost btn-sm" @click="clearBasket">清空</button>
    </div>
  </div>
</template>

<style scoped>
/* 整体高度随屏幕高度动态撑满内容区（顶栏 62 + 内容区上下内边距 44），
   左右两栏各自内部滚动，滚动题目列表时左侧知识点面板保持不动 */
.bank-layout {
  --content-h: calc(100vh - 106px);
  display: flex;
  gap: 14px;
  align-items: stretch;
  height: var(--content-h);
  min-height: 460px;
}
.right-col {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%;
}

/* ===== 筛选面板 ===== */
.filter-panel { padding: 0; overflow: visible; flex-shrink: 0; }
.fp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 16px;
  cursor: pointer;
  min-height: 46px;
}
.fp-title { font-size: 13.5px; font-weight: 700; color: var(--ink); display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-width: 0; }
.fp-summary { display: flex; align-items: center; gap: 8px; flex-wrap: nowrap; overflow: hidden; font-weight: 400; }
.fp-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: var(--brand-soft);
  color: var(--brand-deep);
  border-radius: 7px;
  padding: 3px 9px;
  font-size: 12px;
  max-width: 200px;
  min-width: 0;
}
.fp-chip b { font-weight: 700; flex-shrink: 0; }
.fp-values { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fp-none { font-size: 12.5px; color: var(--sub); font-weight: 400; }
.fp-toggle { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--sub); flex-shrink: 0; }
.fp-caret { transition: transform 0.18s; }
.fp-caret.up { transform: rotate(180deg); }
.fp-body { border-top: 1px dashed var(--border); padding: 12px 16px 14px; display: flex; flex-direction: column; gap: 10px; }

.cf-row { display: flex; align-items: flex-start; gap: 12px; }
.cf-label { width: 58px; flex-shrink: 0; font-size: 12.5px; font-weight: 600; color: var(--sub); line-height: 26px; }
.cf-opts { display: flex; flex-wrap: wrap; gap: 7px; flex: 1; min-width: 0; }
.opt-chip {
  border: 1.5px solid var(--border);
  border-radius: 8px;
  background: #fff;
  font-size: 12.5px;
  color: var(--ink-2);
  padding: 3px 12px;
  transition: all 0.12s;
}
.opt-chip:hover { border-color: var(--brand); color: var(--brand-deep); }
.opt-chip.on { background: var(--brand); border-color: var(--brand); color: #fff; font-weight: 600; }

/* ===== 列表 =====
   面板撑满右栏剩余高度：工具栏、分页固定，仅题目列表区域滚动。
   面板自带内边距：搜索框 / 表格-详细显示切换不与面板边缘贴边 */
.table-panel { min-width: 0; flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 14px 16px 12px; }
.list-toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; flex-shrink: 0; }
.search-box { position: relative; width: 240px; }
.search-box .f-input { padding-left: 32px; height: 34px; width: 100%; }
.search-box > :first-child { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--sub); pointer-events: none; }
.mode-toggle { margin-left: auto; display: flex; border: 1.5px solid var(--border); border-radius: 9px; overflow: hidden; }
.mode-toggle button {
  display: flex;
  align-items: center;
  gap: 5px;
  border: none;
  background: #fff;
  font-size: 12.5px;
  color: var(--sub);
  padding: 7px 14px;
}
.mode-toggle button.on { background: var(--brand-soft); color: var(--brand-deep); font-weight: 700; }

/* 表格区独立滚动（表头全局样式已 sticky） */
.data-table-wrap { flex: 1; min-height: 0; overflow: auto; }
.table-panel .pagination { flex-shrink: 0; }

.th-stem { min-width: 220px; }
.stem-cell {
  max-width: 320px;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  overflow: hidden;
  line-height: 1.6;
  font-size: 13px;
  color: var(--ink-2);
  cursor: pointer;
  text-align: left;
  vertical-align: middle;
}
.stem-cell:hover { color: var(--brand-deep); }
.knowledge-cell { font-size: 12.5px; max-width: 150px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.time-cell { font-size: 12.5px; color: var(--sub); white-space: nowrap; }

/* ===== 详细列表卡片 ===== */
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
.qc-kp { font-size: 12px; color: var(--sub); }
.qc-right { margin-left: auto; font-size: 12px; color: var(--sub); }
.qc-stem { font-size: 13.5px; color: var(--ink); line-height: 1.8; cursor: pointer; }
.qc-figure {
  margin-top: 10px;
  height: 110px;
  border: 1px dashed var(--border);
  border-radius: 10px;
  background: repeating-conic-gradient(#f4f7f7 0% 25%, #fff 0% 50%) 50% / 16px 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--sub);
  font-size: 12.5px;
}
.qc-options { margin-top: 10px; display: flex; flex-direction: column; gap: 6px; }
.qc-options li {
  display: flex;
  align-items: baseline;
  gap: 8px;
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--ink-2);
}
.qc-options li.right { border-color: var(--success); background: var(--success-soft, #ecfaf4); }
.opt-letter { font-weight: 700; color: var(--sub); }
.qc-options li.right .opt-letter { color: var(--success); }
.qc-answer {
  margin-top: 10px;
  border-left: 3px solid var(--brand);
  background: #f7fafa;
  border-radius: 0 10px 10px 0;
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: var(--ink-2);
  line-height: 1.7;
}
.qc-answer b { color: var(--ink); }
.qc-answer-text { color: var(--success); font-weight: 600; }
.qc-flags { margin-top: 8px; display: flex; align-items: center; gap: 10px; }
.qc-reject { font-size: 12.5px; color: var(--danger); }
.qc-ops { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 12px; border-top: 1px dashed var(--border); padding-top: 10px; }

/* ===== 组卷篮浮动条 ===== */
.basket-bar {
  position: fixed;
  right: 28px;
  bottom: 28px;
  z-index: 40;
  display: flex;
  align-items: center;
  gap: 10px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 999px;
  box-shadow: 0 10px 30px rgba(15, 60, 55, 0.16);
  padding: 9px 12px 9px 18px;
  font-size: 13px;
  color: var(--ink-2);
}
.basket-bar b { color: var(--brand-deep); }

/* ===== 预览抽屉 ===== */
.q-text {
  font-size: 13.5px;
  color: var(--ink-2);
  line-height: 1.8;
  background: #f7fafa;
  border-radius: 10px;
  padding: 12px 14px;
}
.q-text.answer { color: var(--success); font-weight: 600; }
.q-text.reject { color: var(--danger); }
.option-list { display: flex; flex-direction: column; gap: 8px; }
.option-list li { background: #f7fafa; border-radius: 8px; padding: 9px 12px; font-size: 13.5px; color: var(--ink-2); }
.option-list li.right { background: var(--success-soft, #ecfaf4); color: var(--success); font-weight: 600; }

/* ===== 变式入口 ===== */
.variant-entry {
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: 100%;
  text-align: left;
  border: 1.5px solid var(--border);
  border-radius: 12px;
  padding: 13px 16px;
  background: #fff;
  margin-bottom: 10px;
  transition: border-color 0.15s;
}
.variant-entry:hover { border-color: var(--brand); }
.ve-title { font-size: 14px; font-weight: 700; color: var(--ink); }
.ve-desc { font-size: 12.5px; color: var(--sub); line-height: 1.6; }
</style>
