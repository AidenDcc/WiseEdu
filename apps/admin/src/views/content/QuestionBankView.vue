<script setup lang="ts">
/**
 * 平台管理端 · 公共题库。
 *
 * 骨架（知识点树槽位 + 可折叠筛选面板 + 表格 / 详细双视图 + 分页 + 行内标识落点）来自
 * `@aiteach/business-common`，与机构端「题库管理」是同一份 —— 一处改、两处生效。
 * 原平台端的版本（学科 / 年级简树 + 审核队列 + 解析入库）已被替换，UI 与机构端逐项一致。
 *
 * 本页只保留「平台端自己的事」：
 * - 取数：`@/api/bank`（接平台公共库时只改那个文件里的 URL，页面与公共组件不动）；
 * - 平台专属筛选条件：走 `BankFilterBar` 的 `extraRows`（仍是 chip 行）或 `#extraFilter`
 *   （开关 / 区间这类非 chip 控件）。当前与机构端条件一致，故 `EXTRA_ROWS` 为空 ——
 *   将来加「所属机构」「入库审核状态」这类维度时加在这里，不需要动公共层；
 * - 操作按钮：走 `QuestionBankPanel` 的 `#renderOperation`（平台端将来会是「审核 / 解析入库」，
 *   机构端是「编辑 / 变式」，正是这个插槽要承载的差异）。**当前按「与机构端一致」处理**，
 *   所以按钮暂时与机构端相同 —— 其中「编辑 / 变式」会跳到平台端还没有的录题中心路由，
 *   落到全局兜底的「开发中」占位页（见文件末尾待办）；
 * - 行内标识：走 `#renderQuestionNo` / `#renderCardMeta`（公共库里的「纠错 N」）。
 *
 * 公共组件内部不判断当前是哪个端，也不知道 `tenant_id`。
 *
 * 待办：平台端自己的「题目审核（通过 / 驳回）」「解析拆题入库」入口尚未恢复；
 * 录题中心页在平台端不存在，「编辑 / 变式」的落点待定。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AppIcon,
  AppModal,
  ApiError,
  RichTextViewer,
  showToast,
  truncateRich,
} from '@aiteach/shared'
import type { FilterRowDef, OrgQuestion, QuestionCorrection } from '@aiteach/shared'
import {
  BANK_ALL_ROWS,
  BANK_FILTER_ROWS,
  BANK_MORE_ROWS,
  BANK_STATUS_LABEL,
  BANK_VISIBLE_STATUS,
  BankFilterBar,
  KnowledgeFilterPanel,
  QuestionBankPanel,
  questionSearchText,
  QuestionPreviewDrawer,
  bankDictTypes,
  bankFilterFields,
  defaultBankFilterSelection,
  scopedQuestionTypes,
  toBankFilterRowDefs,
  useScope,
  type BankFilterContext,
  type BankFilterRow,
  type TenantDictItem,
} from '@aiteach/business-common'
import {
  fetchQuestionCorrections,
  fetchQuestions,
  fetchTenantDict,
  toggleQuestionOffline,
  variantOf,
} from '@/api/bank'

const router = useRouter()
const route = useRoute()

/** 顶部栏的全局年级 / 学科：只用来给下面的 scope 一个初值，之后以左侧面板为准 */
const { grade: scopeGrade, subject: scopeSubject, ensureScope } = useScope()

/* ===== 数据 ===== */
const list = ref<OrgQuestion[]>([])
/**
 * 纠错记录（全量，按提交时间倒序）。
 * 列表上的标识、预览抽屉里的「纠错记录」分节、右上「纠错题目」筛选条件，三处共用这一份，
 * 本地按 questionId 分组即可 —— 记录量级是「一题几条」，不值得再开一个「哪些题有纠错」的接口。
 */
const corrections = ref<QuestionCorrection[]>([])
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    /* 顶部栏作用域只作为 scope 的初值（左侧知识点面板随后会抛出它自己的年级 / 学科，
       那里才是这两个维度的权威来源）；字典失败不阻断开列，退化为缓存值即可 */
    await ensureScope().catch(() => {})
    if (!scope.value.grade && scopeGrade.value) {
      scope.value = { grade: scopeGrade.value, subject: scopeSubject.value }
    }
    const [rows, records] = await Promise.all([fetchQuestions(), fetchQuestionCorrections()])
    list.value = rows
    corrections.value = records
  } finally {
    loading.value = false
  }
}

const correctionsByQuestion = computed(() => {
  const grouped = new Map<number, QuestionCorrection[]>()
  for (const record of corrections.value) {
    const rows = grouped.get(record.questionId)
    if (rows) rows.push(record)
    else grouped.set(record.questionId, [record])
  }
  return grouped
})

/** 某道题的纠错记录；没有则空数组，模板里直接用 length 判「有没有标识」 */
function correctionsOf(id: number): QuestionCorrection[] {
  return correctionsByQuestion.value.get(id) ?? []
}

/** 标识的悬浮说明：摊平类型，省得为了知道是哪类问题还得点开预览 */
function correctionTitle(id: number): string {
  const records = correctionsOf(id)
  return `${records.length} 条纠错：${[...new Set(records.flatMap((item) => item.types))].join('、')}`
}

/* ===== 左侧教材知识点过滤（选中节点返回子树叶子 tag） ===== */
const activeTags = ref<string[] | null>(null)
function onKnowledgeChange(tags: string[] | null) {
  activeTags.value = tags
}

/**
 * 年级 / 学科：不再单独出筛选行，改由左侧知识点面板的教材级联（年级 → 学科 → 版本）驱动 ——
 * 知识点树本来就是按这两个维度加载的，两处各筛一次只会互相打架。面板默认跟随顶部栏作用域，
 * 所以初始行为与从前一致。
 */
const scope = ref({ grade: '', subject: '' })
function onScopeChange(next: { grade: string; subject: string }) {
  scope.value = next
  /*
   * 换学科后，原学科专属题型（英语的完形填空 / 七选五 / 短文改错）不再是候选项。
   * 这种选中值在筛选面板里渲染不出 chip（chips 只按 options 渲染），却仍在参与筛选 ——
   * 结果恒为空且用户找不到地方取消，所以一并去掉。字典未到位时不动，免得误清空。
   */
  const types = scopedQuestionTypes(typeItems.value, next.subject)
  if (!next.subject || !types.length) return
  filterSel.type = filterSel.type.filter((type) => types.includes(type))
}

/* ================= 右上：可折叠筛选条件 =================
   行定义与候选项解析都在公共层（`bank/filter-model`），本页只提供本端数据与 scope。
   平台端专属条件加在 EXTRA_ROWS 里即可 —— 与共有行同权：进折叠汇总、也进「清空」。 */
const EXTRA_ROWS: BankFilterRow[] = []

/** 主条件 + 更多查询 + 本端专属（面板里渲染的行） */
const PANEL_ROWS = [...BANK_ALL_ROWS, ...EXTRA_ROWS]

const filterSel = reactive<Record<string, string[]>>(defaultBankFilterSelection(EXTRA_ROWS))
const filterOptions = reactive<Record<string, string[]>>({})
/** 题型字典原始项（含适用学科），候选项按当前学科实时收窄 */
const typeItems = ref<TenantDictItem[]>([])

/** 候选项解析的上下文：字典异步到达，所以行定义只在运行时展开 */
const filterCtx = computed<BankFilterContext>(() => ({
  typeItems: typeItems.value,
  grade: scope.value.grade,
  subject: scope.value.subject,
  dictOptions: filterOptions,
}))

const filterRows = computed<FilterRowDef[]>(() => toBankFilterRowDefs(BANK_FILTER_ROWS, filterCtx.value))
const moreFilterRows = computed<FilterRowDef[]>(() => toBankFilterRowDefs(BANK_MORE_ROWS, filterCtx.value))
const extraFilterRows = computed<FilterRowDef[]>(() => toBankFilterRowDefs(EXTRA_ROWS, filterCtx.value))

/** 面板回传的是整份筛选值（覆盖式回写，不做级联） */
function onFiltersChange(next: Record<string, string[]>) {
  PANEL_ROWS.forEach((row) => {
    filterSel[row.key] = next[row.key] ?? []
  })
}

async function loadDicts() {
  /* examType 不在这里拉：候选项要按学段 / 学科实时收窄，统一走 useBaseData（见 bankRowOptions） */
  const dictTypes = bankDictTypes(PANEL_ROWS)
  await Promise.all(
    dictTypes.map(async (type) => {
      const items = await fetchTenantDict(type)
      /* 题型的候选项要随学科重算，留下原始字典项；其余字典只用到名字 */
      if (type === 'questionType') typeItems.value = items
      else filterOptions[type] = items.map((item) => item.name)
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

const page = ref(1)

/** 有纠错记录的题目 id 集合（纠错取自记录而非题目字段） */
const correctedIds = computed(() => new Set(corrections.value.map((record) => record.questionId)))

/**
 * 每个筛选 key 从题目上取哪个值 —— 映射表在公共层，因为两端口径必须一致。
 * 本页专属条件若用到题目以外的字段（如纠错记录），也要在这里补一条。
 */
const fields = computed(() => bankFilterFields({ correctedIds: correctedIds.value }))

const filtered = computed(() => {
  const kw = keyword.value.trim()
  const field = fields.value
  /* 状态不选时 = 只看已入库；选「已下架」才把下架题翻出来重新上架。
     硬性可见性（BANK_VISIBLE_STATUS）在下面第一道卡住草稿 / 校验中 / 待终审 / 已驳回。 */
  const statusSel = filterSel.status.length ? filterSel.status : [BANK_STATUS_LABEL.approved]
  return list.value.filter((row) => {
    if (!BANK_VISIBLE_STATUS.includes(row.status)) return false
    if (scope.value.grade && row.grade !== scope.value.grade) return false
    if (scope.value.subject && row.subject !== scope.value.subject) return false
    if (activeTags.value && !row.knowledge.some((tag) => activeTags.value!.includes(tag))) return false
    if (!statusSel.includes(field.status(row))) return false
    for (const def of PANEL_ROWS) {
      const selected = filterSel[def.key]
      if (selected.length > 0 && !selected.includes(field[def.key](row))) return false
    }
    /* 关键词覆盖面：题干 + 组合题的各子题题干（questionSearchText 只此一份） */
    if (kw && !questionSearchText(row).includes(kw) && !String(row.id).includes(kw)) return false
    return true
  })
})

/** 表格与详细两种展示每页都是 10 条 */
const pageSize = 10
const paged = computed(() => filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize))

/* 筛选条件变了要回第 1 页。展示方式（表格 / 详细）的偏好在骨架组件里，翻页与它无关，
   所以这里不再像从前那样跟着一起复位。 */
watch([activeTags, scope, () => JSON.stringify(filterSel), keyword], () => {
  page.value = 1
})

/* ===== 操作：预览 / 编辑 / 变式 / 上下架（按钮本体在各端页面，见模板的 #renderOperation） ===== */
const preview = ref<OrgQuestion | null>(null)
const variantOpen = ref<OrgQuestion | null>(null)

/** 带题目 id 进录题中心。⚠️ 平台端暂无该页面，会落到全局兜底的「开发中」占位页 */
function goEdit(id: number) {
  router.push({ path: '/question/create', query: { id: String(id) } })
}

/**
 * 上架 / 下架。后端只在 `已入库 ⇄ 已下架` 之间切换，其余状态会报错（那种题本来也不在本列表里）。
 * toast 按**返回值**说，不按点击前的状态取反 —— 列表点完就重载，说错了用户也看不出是哪里不对。
 */
async function onToggleOffline(row: OrgQuestion) {
  try {
    const next = await toggleQuestionOffline(row.id)
    showToast(next.status === 'offline' ? `题目 #${row.id} 已下架` : `题目 #${row.id} 已重新上架`, 'success')
    void load()
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : '操作失败', 'error')
  }
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

/* ===== 挂载 ===== */
onMounted(() => {
  void load()
  void loadDicts()
})
</script>

<template>
  <div class="bank-layout">
    <!-- 年级 / 学科由左侧教材级联驱动（scopeChange），右上不再重复出这两行 -->
    <KnowledgeFilterPanel :rows="list" @change="onKnowledgeChange" @scope-change="onScopeChange" />

    <!-- 右侧 -->
    <div class="right-col">
      <!-- 通用筛选面板：共有行来自公共层，平台专属条件走 extraRows / #extraFilter -->
      <BankFilterBar
        :rows="filterRows"
        :more-rows="moreFilterRows"
        :extra-rows="extraFilterRows"
        :model-value="filterSel"
        @update:model-value="onFiltersChange"
      />

      <!-- 列表骨架：工具条 / 表格-详细双视图 / 分页都在公共层。
           行内标识与操作列由本页通过插槽填 —— 骨架不判断当前是哪个端 -->
      <QuestionBankPanel
        class="table-panel"
        :rows="paged"
        :total="filtered.length"
        :page="page"
        :page-size="pageSize"
        :loading="loading"
        :keyword="keyword"
        view-key="question-bank"
        placeholder="题干关键词 / 题目编号"
        @update:page="page = $event"
        @update:keyword="keyword = $event"
        @preview="preview = $event"
      >
        <!-- 编号列下挂「纠错 N」：这一列本来就窄，骨架已把它排成竖列 -->
        <template #renderQuestionNo="{ row }">
          <span
            v-if="correctionsOf(row.id).length"
            class="tag tag-red no-badge"
            :title="correctionTitle(row.id)"
          >
            纠错 {{ correctionsOf(row.id).length }}
          </span>
        </template>

        <!-- 详细卡片信息行里的同一枚标识 -->
        <template #renderCardMeta="{ row }">
          <span v-if="correctionsOf(row.id).length" class="tag tag-red" :title="correctionTitle(row.id)">
            纠错 {{ correctionsOf(row.id).length }}
          </span>
        </template>

        <!-- 操作列：平台端将来接自己的「审核 / 解析入库」；当前按「与机构端一致」处理 -->
        <template #renderOperation="{ row }">
          <button class="mini-btn" type="button" @click="preview = row">预览</button>
          <button class="mini-btn" type="button" @click="goEdit(row.id)">编辑</button>
          <button class="mini-btn" type="button" @click="variantOpen = row">变式</button>
          <button class="mini-btn" type="button" @click="onToggleOffline(row)">
            {{ row.status === 'offline' ? '上架' : '下架' }}
          </button>
        </template>
      </QuestionBankPanel>
    </div>

    <!-- 题目预览（与机构端共用同一个抽屉组件） -->
    <QuestionPreviewDrawer
      v-if="preview"
      :question="preview"
      :corrections="correctionsOf(preview.id)"
      @close="preview = null"
    />

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

/* ===== 列表 =====
   面板吃满右栏剩余高度：工具条与分页固定，仅列表区滚动。
   面板自带内边距（工具条 14/18、卡片 14/18），这里**不要**再补 padding，否则两边都是。 */
.table-panel { flex: 1; min-height: 0; }

/* 编号列里的纠错标识：比常规 tag 更紧凑，才塞得进 96px 的编号列 */
.no-badge { padding: 0 8px; font-size: 11px; line-height: 18px; }

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
