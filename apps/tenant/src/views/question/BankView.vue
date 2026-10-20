<script setup lang="ts">
/**
 * 机构端 · 题库管理。
 *
 * 骨架（知识点树槽位 + 可折叠筛选面板 + 表格 / 详细双视图 + 分页 + 行内标识落点）来自
 * `@aiteach/business-common`，与平台端「公共题库」是同一份 —— 一处改、两处生效。
 *
 * 本页只保留「机构端自己的事」：
 * - 取数：`@/api/org`（含 `tenant_id` 与机构权限），公共层不认识这些；
 * - 本端专属筛选条件：走 `BankFilterBar` 的 `extraRows`（仍是 chip 行、进折叠汇总与「清空」）
 *   或 `#extraFilter`（开关 / 区间这类非 chip 控件）。本端的专属行是**所属对象**
 *   （平台 / 校本 / 个人），排在「杯赛」后面；
 * - 操作按钮：走 `QuestionBankPanel` 的 `#renderOperation` —— 机构端的「编辑 / 变式」都要进录题中心，
 *   个人题另有「提交校本」；
 * - 行内标识：走 `#renderQuestionNo` / `#renderCardMeta`（所属对象 + 「纠错 N」）。
 *
 * ## 个人题库已并入本页
 *
 * 原本「个人题库」是独立一页（按 owner 过滤看自己录的题）。现在它的内容就是本页
 * 「所属对象 = 个人」这一档，所以那一页连同菜单入口一起撤掉了，草稿 / 已入库的个人题都在这里看。
 * 个人题**只有创建人可见**，直到提交校本并通过审批（`scope` 翻成 `school`）才对全机构可见。
 *
 * 公共组件内部不判断当前是哪个端，也不知道 `tenant_id`。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AppIcon,
  AppModal,
  ApiError,
  QUESTION_SCOPE_OPTIONS,
  QUESTION_SCOPE_TEXT,
  RichTextViewer,
  appConfirm,
  questionScopeOf,
  showToast,
  truncateRich,
} from '@aiteach/shared'
import type { FilterRowDef, OrgQuestion, QuestionCorrection, ResourceApproval } from '@aiteach/shared'
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
} from '@aiteach/business-common'
import {
  fetchApprovals,
  fetchQuestionCorrections,
  fetchQuestions,
  fetchTenantDict,
  submitQuestionToSchool,
  toggleQuestionOffline,
  variantOf,
} from '@/api/org'
import type { TenantDictItem } from '@/api/org'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

/** 当前登录人：个人题的可见性、以及「我的题」判定都按这个 id */
const currentUserId = computed(() => auth.user?.id ?? 101)

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
/**
 * 提审单（只为「这一题是否正在审核中」服务）。
 *
 * 个人题提交校本后**题本身不动状态**（仍是可用的个人题），所以「审核中」只能从审批单看出来 ——
 * 列表上的按钮据此变成「审核中」并禁用，避免重复提交。
 */
const approvals = ref<ResourceApproval[]>([])
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
    const [rows, records, pending] = await Promise.all([
      fetchQuestions(),
      fetchQuestionCorrections(),
      /* 审批单拉不到不该挡住题库 —— 退化为空数组，「提交校本」按「可以提交」处理 */
      fetchApprovals().catch(() => [] as ResourceApproval[]),
    ])
    list.value = rows
    corrections.value = records
    approvals.value = pending
  } finally {
    loading.value = false
  }
}

/** 正在走校本审批的个人题 id（按钮据此显示「审核中」） */
const schoolPendingIds = computed(
  () =>
    new Set(
      approvals.value
        .filter((row) => row.status === 'pending' && row.kind === '题目' && row.resourceId != null)
        .map((row) => row.resourceId as number),
    ),
)

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
   机构端专属条件加在 EXTRA_ROWS 里即可 —— 与共有行同权：进折叠汇总、也进「清空」。 */

/**
 * 本端专属条件：**所属对象**（平台 / 校本 / 个人）。
 *
 * 位置由 `BankFilterBar` 决定（共有行在前、专属行在后），所以它天然排在「杯赛」下面，
 * 正是产品要求的顺序。chip 多选：三个都不选 = 全部可见范围。
 */
const SCOPE_ROW: BankFilterRow = {
  key: 'scope',
  label: '所属对象',
  options: QUESTION_SCOPE_OPTIONS.map((scope) => QUESTION_SCOPE_TEXT[scope]),
}

const EXTRA_ROWS: BankFilterRow[] = [SCOPE_ROW]

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

/**
 * 一道题是否可见。
 *
 * - **个人题只有创建人可见**：别人录的题在题库里根本不出现，直到提交校本并通过审批
 *   （届时 `scope` 变成 `school`，对全机构可见）。这条是硬性规则，不参与筛选
 *   —— 筛选面板里选「个人」看到的是「我自己的个人题」，不是「所有人的」。
 * - 机构 / 平台题：仍按状态白名单（已入库 / 已下架 / 草稿）过，待审中 / 已驳回属于审核流。
 */
function visibleOf(row: OrgQuestion): boolean {
  const scopeOf = questionScopeOf(row)
  if (scopeOf === 'personal') return row.ownerId === currentUserId.value
  return BANK_VISIBLE_STATUS.includes(row.status)
}

const filtered = computed(() => {
  const kw = keyword.value.trim()
  const field = fields.value
  /* 状态不选时 = 只看可用题（已入库 + 自己的草稿）；选「已下架」才把下架题翻出来重新上架。
     草稿放进默认档，是因为个人题库并进来之后「保存草稿」的题只在这里能看到 ——
     默认藏起来等于让老师找不到刚存的东西。 */
  const statusSel = filterSel.status.length
    ? filterSel.status
    : [BANK_STATUS_LABEL.approved, BANK_STATUS_LABEL.draft]
  return list.value.filter((row) => {
    if (!visibleOf(row)) return false
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

/** 带题目 id 进录题中心（落手动态；新建入口在侧边菜单，列表里只做编辑改题） */
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

/* ===== 所属对象（行内标签 / 按钮分支共用） ===== */
/** 题目的所属对象取值（'platform' | 'school' | 'personal'），模板按它决定标签与按钮 */
function scopeKeyOf(row: OrgQuestion) {
  return questionScopeOf(row)
}
/** 所属对象标签的配色：平台蓝、校本绿、个人橙（与审批状态、纠错标签的色系区分开） */
const SCOPE_TAG_CLASS: Record<string, string> = {
  platform: 'tag-blue',
  school: 'tag-green',
  personal: 'tag-orange',
}

/**
 * 提交校本审核。
 *
 * 只有个人题有这个动作：提交后生成一条 `kind='题目'` 的审批单，题**仍留在个人题库**可用，
 * 审批通过后才翻成校本题（`scope=school`，全机构可见）。审核中重复点没有意义，
 * 所以按钮在这一状态下变成「审核中」并禁用。
 */
async function onSubmitSchool(row: OrgQuestion) {
  const ok = await appConfirm(`将题目 #${row.id} 提交校本审核？通过后该题将进入校本题库，全机构可见。`, {
    title: '提交校本',
    type: 'info',
    confirmText: '提交审核',
  })
  if (!ok) return
  try {
    await submitQuestionToSchool(row.id)
    showToast('已提交校本审核，可在「审批管理」或「题目审核中心」跟进', 'success')
    await load()
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : '提交失败', 'error')
  }
}

/* ===== 挂载 ===== */
onMounted(() => {
  /* 个人题库并入后，旧入口（含书签）会带 ?scope=personal 跳过来：预选「所属对象 = 个人」，
     让用户落到的正是他原来那一屏 */
  if (route.query.scope === 'personal') filterSel.scope = [QUESTION_SCOPE_TEXT.personal]
  void load()
  void loadDicts()
})
</script>

<template>
  <div class="bank-layout">
    <!-- 年级 / 学科由左侧教材级联驱动（scopeChange），右上不再重复出这两行。
         题库管理左侧是「知识点 / 章节」双页签，知识点页签只选年级 / 学科（不选教材版本） -->
    <KnowledgeFilterPanel
      :rows="list"
      with-chapter
      :with-version="false"
      @change="onKnowledgeChange"
      @scope-change="onScopeChange"
    />

    <!-- 右侧 -->
    <div class="right-col">
      <!-- 通用筛选面板：共有行来自公共层，机构端专属条件走 extraRows / #extraFilter -->
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
        <!-- 编号列下挂两枚标识：所属对象（平台 / 校本 / 个人）+ 纠错 N。
             这一列本来就窄，骨架已把这一格排成竖列 -->
        <template #renderQuestionNo="{ row }">
          <span class="tag no-badge" :class="SCOPE_TAG_CLASS[scopeKeyOf(row)]">
            {{ QUESTION_SCOPE_TEXT[scopeKeyOf(row)] }}
          </span>
          <span
            v-if="correctionsOf(row.id).length"
            class="tag tag-red no-badge"
            :title="correctionTitle(row.id)"
          >
            纠错 {{ correctionsOf(row.id).length }}
          </span>
        </template>

        <!-- 详细卡片信息行里的同一组标识（编号后面是所属对象，与预览抽屉的排法一致） -->
        <template #renderCardMeta="{ row }">
          <span class="tag" :class="SCOPE_TAG_CLASS[scopeKeyOf(row)]">{{ QUESTION_SCOPE_TEXT[scopeKeyOf(row)] }}</span>
          <span v-if="correctionsOf(row.id).length" class="tag tag-red" :title="correctionTitle(row.id)">
            纠错 {{ correctionsOf(row.id).length }}
          </span>
        </template>

        <!-- 操作列：机构端的入口（编辑 / 变式都进录题中心），表格与详细两处共用。
             按钮按**所属对象**分：
             - 平台题只读：可预览、可变式（变式产出的是一份自己的个人题）；
             - 个人题：预览 / 编辑 / 提交校本（审核中禁用）/ 变式；
             - 校本题：预览 / 编辑 / 变式 / 上下架。 -->
        <template #renderOperation="{ row }">
          <button class="mini-btn" type="button" @click="preview = row">预览</button>
          <button v-if="scopeKeyOf(row) !== 'platform'" class="mini-btn" type="button" @click="goEdit(row.id)">编辑</button>
          <button class="mini-btn" type="button" @click="variantOpen = row">变式</button>
          <template v-if="scopeKeyOf(row) === 'personal'">
            <button
              v-if="schoolPendingIds.has(row.id)"
              class="mini-btn"
              type="button"
              disabled
              title="已提交校本审核，通过后自动进入校本题库"
            >
              审核中
            </button>
            <button v-else class="mini-btn success" type="button" @click="onSubmitSchool(row)">提交校本</button>
          </template>
          <button
            v-if="scopeKeyOf(row) === 'school'"
            class="mini-btn"
            type="button"
            @click="onToggleOffline(row)"
          >
            {{ row.status === 'offline' ? '上架' : '下架' }}
          </button>
        </template>
      </QuestionBankPanel>
    </div>

    <!-- 题目预览（与录题中心共用同一个抽屉组件，两页不再各写一份）；
         纠错记录按题现取：处理纠错的入口就是「预览」 -->
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
