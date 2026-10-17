<script setup lang="ts">
/**
 * 题库列表骨架：工具条（搜索框 + 展示方式切换）+ 表格 / 详细双视图 + 分页。
 *
 * 平台管理端「公共题库」与机构端「题库管理」要求长得一模一样，两处各抄一份必然漂移，
 * 所以整块抽到公共层。组件的边界刻意画在「展示」上：
 *
 * - **数据由页面筛好传进来**（`rows` 是当前页、`total` 是筛选后的总数）：筛选条件、
 *   权限、`tenant_id` 过滤都归页面 —— 公共组件不参与数据查询，也不知道当前是哪个端。
 * - **操作按钮走 `#renderOperation` 插槽**：各端的按钮不同（机构端有「编辑 / 变式」，
 *   平台端将来可能是「审核 / 解析入库」），组件只负责把它们排进操作列。
 * - **行内的端差异走具名插槽**：`#renderQuestionNo`（编号列的附加标识，如机构端的「纠错 N」）、
 *   `#renderStem`（题干单元格）、`#renderCardMeta`（详细卡片的信息行）。
 * - **翻页复位留在页面**：筛选条件变了要回第 1 页，而筛选状态本来就归页面所有。
 *
 * 与 `PaperListPanel` 同一套约定：`views` 决定展示方式（只给一种就固定那一种且不渲染切换器）、
 * 视图偏好按 `viewKey` 分别记忆、根节点上的 class 由页面透传（Vue attribute 透传）用于布局。
 */
import { computed, ref } from 'vue'
import { AppIcon, AppListToolbar, AppPagination, AppSegmented, RichTextViewer } from '@aiteach/shared'
import type { OrgQuestion } from '@aiteach/shared'
import QuestionOptions from '../question/QuestionOptions.vue'
import CompositeTag from '../question/CompositeTag.vue'
import CompositeSubList from '../question/CompositeSubList.vue'
import { useViewMode } from '../../composables/useViewMode'
import {
  difficultyClass,
  isCompositeQuestion,
  isJudgeNoOptions,
  judgeAnswerText,
  needsFigure,
  optionColumnsOf,
  subQuestionCount,
  subQuestionsOf,
} from '../../utils/question-card'

const props = withDefaults(
  defineProps<{
    /** 当前页的题目（分页由页面切好） */
    rows: OrgQuestion[]
    /** 筛选后的总条数（分页器用），不是 rows.length */
    total: number
    page: number
    pageSize?: number
    /** 首屏加载中（只在没有任何数据时显示「加载中…」） */
    loading?: boolean
    /** 搜索关键词（`v-model:keyword`）；**筛选由页面做**，这里只画输入框 */
    keyword?: string
    placeholder?: string
    searchable?: boolean
    /** 视图偏好的存储键：每个列表必须唯一 */
    viewKey?: string
    /** 列表为空时的文案 */
    emptyText?: string
    /** 这个列表提供哪几种展示方式；只给一种时固定用它且不渲染切换器 */
    views?: Array<'table' | 'detail'>
  }>(),
  {
    pageSize: 10,
    loading: false,
    keyword: '',
    placeholder: '题干关键词 / 题目编号',
    searchable: true,
    viewKey: 'question-bank',
    emptyText: '暂无符合条件的题目',
    views: () => ['table', 'detail'],
  },
)

const emit = defineEmits<{
  'update:page': [value: number]
  'update:keyword': [value: string]
  /** 点题干 / 点卷名 = 预览（弹窗本体归页面） */
  preview: [row: OrgQuestion]
}>()

/** 两种展示方式的文案 / 图标；切换器顺序跟着 `views` 走 */
const VIEW_MODE_META = {
  table: { label: '表格', icon: 'grid' },
  detail: { label: '详细', icon: 'file' },
} as const
const viewOptions = computed(() => props.views.map((value) => ({ value, ...VIEW_MODE_META[value] })))

const viewMode = useViewMode(props.viewKey, ['table', 'detail'] as const, props.views[0] ?? 'table')
const activeView = computed(() => (props.views.length === 1 ? props.views[0] : viewMode.value))

/** AppSegmented 回传 string，这里收窄回联合类型 */
function setViewMode(value: string) {
  viewMode.value = value as 'table' | 'detail'
}

/** 详细列表：哪几题的解析是展开的（纯展示态，与数据无关，所以留在组件内） */
const analysisOpen = ref<number[]>([])
function toggleAnalysis(id: number) {
  const index = analysisOpen.value.indexOf(id)
  if (index >= 0) analysisOpen.value.splice(index, 1)
  else analysisOpen.value.push(id)
}

/** 行号：跨页连续 */
function rowNo(index: number): number {
  return (props.page - 1) * props.pageSize + index + 1
}

/** 组合题的子题列表（母题自身没有选项 / 答案 / 解析，正文都在子题里） */
function subsOf(row: OrgQuestion) {
  return subQuestionsOf(row)
}
</script>

<template>
  <div class="panel qb-panel">
    <div class="qb-head">
      <AppListToolbar
        :model-value="keyword"
        :searchable="searchable"
        :placeholder="placeholder"
        @update:model-value="emit('update:keyword', $event)"
      >
        <template #left>
          <slot name="toolbar-left" />
        </template>
        <template #right>
          <slot name="toolbar-right" />
          <AppSegmented
            v-if="views.length > 1"
            :options="viewOptions"
            :model-value="activeView"
            @update:model-value="setViewMode"
          />
        </template>
      </AppListToolbar>
    </div>

    <!-- ===== 表格显示 ===== -->
    <div v-if="activeView === 'table'" class="data-table-wrap">
      <table class="data-table qb-table">
        <thead>
          <tr>
            <th style="width: 46px">序号</th>
            <th style="width: 96px">题目编号</th>
            <!-- 题干列是唯一的「不定宽」列：table-layout: fixed 下它吃掉剩余空间，
                 于是窗口越宽题干越舒展、窄了就换行 -->
            <th>题干</th>
            <th style="width: 76px">题型</th>
            <th style="width: 66px">难度</th>
            <th style="width: 150px">知识点</th>
            <th style="width: 76px">使用次数</th>
            <th style="width: 96px">更新时间</th>
            <th style="width: 264px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading && rows.length === 0">
            <td colspan="9" class="empty-row">加载中…</td>
          </tr>
          <tr v-else-if="rows.length === 0">
            <td colspan="9" class="empty-row">{{ emptyText }}</td>
          </tr>
          <template v-else>
            <tr v-for="(row, i) in rows" :key="row.id">
              <td>{{ rowNo(i) }}</td>
              <td class="cell-strong">
                <!-- 编号列窄，附加标识（各端不同，如「纠错 N」）竖向排在编号下面 -->
                <div class="qb-no-cell">
                  <span>#{{ row.id }}</span>
                  <slot name="renderQuestionNo" :row="row" />
                </div>
              </td>
              <td class="qb-stem-cell" @click="emit('preview', row)">
                <!-- 组合题的题干格子里先标一个类别徽标：光看材料文字认不出它是组合题，
                     更看不出里面还有几道小题（徽标自带小问数） -->
                <CompositeTag v-if="isCompositeQuestion(row)" inline :count="subQuestionCount(row)" />
                <slot name="renderStem" :row="row">
                  <RichTextViewer :content="row.stem" tag="span" />
                </slot>
              </td>
              <td>{{ row.type }}</td>
              <td>{{ row.difficulty }}</td>
              <td class="qb-knowledge-cell" :title="row.knowledge.join('、')">{{ row.knowledge.join('、') }}</td>
              <td>{{ row.useCount }} 次</td>
              <td class="qb-time-cell">{{ row.updatedAt.slice(5, 16) }}</td>
              <td>
                <div class="op-group">
                  <slot name="renderOperation" :row="row" />
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <!-- ===== 详细列表：完整面板卡片 ===== -->
    <div v-else class="qb-detail-list">
      <p v-if="rows.length === 0" class="empty-row">{{ emptyText }}</p>
      <article v-for="row in rows" :key="row.id" class="qb-card">
        <div class="qb-meta">
          <span class="qb-id">#{{ row.id }}</span>
          <slot name="renderCardMeta" :row="row" />
          <CompositeTag v-if="isCompositeQuestion(row)" :count="subQuestionCount(row)" />
          <span class="tag tag-blue">{{ row.type }}</span>
          <span class="tag" :class="difficultyClass(row.difficulty)">{{ row.difficulty }}</span>
          <span class="qb-kp">{{ row.knowledge.join('、') }}</span>
          <span class="qb-right">使用 {{ row.useCount }} 次 · {{ row.updatedAt.slice(5, 16) }}</span>
        </div>
        <RichTextViewer class="qb-card-stem" :content="row.stem" @click="emit('preview', row)" />
        <!-- 配图（含图形描述的题展示图位；题内已嵌图的不再占位） -->
        <div v-if="!isCompositeQuestion(row) && needsFigure(row)" class="qb-figure">
          <AppIcon name="image" :size="26" />
          <span>题目配图（演示占位）</span>
        </div>

        <!-- 材料组合题：母题没有选项 / 答案 / 解析，正文按序号铺开子题；
             展开「答案与解析」时逐题铺开（答案都在子题里，母题那一层是空的） -->
        <CompositeSubList
          v-if="isCompositeQuestion(row)"
          class="qb-subs"
          :subs="subsOf(row)"
          :answers="analysisOpen.includes(row.id)"
          empty-text="该组合题还没有子题。"
        />

        <template v-else>
          <!-- 不传 answer：详细列表是选题态，选项里不透露正确项（答案在下方「解析」里展开） -->
          <QuestionOptions class="qb-options" :options="row.options" :columns="optionColumnsOf(row)" />
          <div v-if="analysisOpen.includes(row.id)" class="qb-answer">
            <p>
              <b>答案：</b>
              <!-- 客观题答案是字母用强调色纯文本；无选项判断题的对 / 错同理；
                   问答题答案是富文本（公式 / 插图） -->
              <span v-if="row.options.length || isJudgeNoOptions(row)" class="qb-answer-text">
                {{ isJudgeNoOptions(row) ? judgeAnswerText(row.answer) : row.answer || '—' }}
              </span>
              <RichTextViewer v-else :content="row.answer" tag="span" empty="—" />
            </p>
            <p><b>解析：</b><RichTextViewer :content="row.analysis" tag="span" empty="—" /></p>
          </div>
        </template>
        <div class="qb-ops">
          <!-- 组合题没有属于自己的解析（都在子题里），展开的是**逐题**答案与解析；
               文案因此写成「答案与解析」，与母题的「解析」区分开 -->
          <button class="mini-btn" type="button" @click="toggleAnalysis(row.id)">
            <template v-if="isCompositeQuestion(row)">
              {{ analysisOpen.includes(row.id) ? '收起解析' : '答案与解析' }}
            </template>
            <template v-else>{{ analysisOpen.includes(row.id) ? '收起解析' : '解析' }}</template>
          </button>
          <slot name="renderOperation" :row="row" />
        </div>
      </article>
    </div>

    <AppPagination :total="total" :page="page" :page-size="pageSize" @update:page="emit('update:page', $event)" />
  </div>
</template>

<style scoped>
/* 面板高度由父容器决定（页面里是 flex 子项），列表区吃掉剩余高度、自己滚动 */
.qb-panel { display: flex; flex-direction: column; }
/* 工具条自带内边距的收口：与下方表格的满幅排布配合（表格贴面板边才能横向滚动） */
.qb-head { padding: 14px 18px 0; flex-shrink: 0; }
.data-table-wrap,
.qb-detail-list { flex: 1 1 auto; min-height: 0; }
.qb-panel .pagination { flex-shrink: 0; }

/* 列宽：题干列不给宽度，在 table-layout: fixed 下自动吃掉剩余空间 —— 于是题干是「按列宽
   换行」而不是被截断（换行本身由 RichTextViewer 的 word-break 负责）。
   固定列合计 870px，min-width 让窗口再窄就横向滚动，题干列始终有地儿放字。 */
.qb-table { table-layout: fixed; min-width: 1100px; }
/* 编号列：编号 + 附加标识竖排（横排要 100px 以上，会把题干挤窄） */
.qb-no-cell { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; }
.qb-stem-cell {
  line-height: 1.6;
  font-size: 13px;
  color: var(--ink-2);
  cursor: pointer;
  text-align: left;
  vertical-align: middle;
}
.qb-stem-cell:hover { color: var(--brand-deep); }
/* 组合题卡片里的子题列表（徽标与子题的样式都在 CompositeTag / CompositeSubList 里，
   这里只负责与上方材料的间距） */
.qb-subs { margin-top: 10px; }
.qb-knowledge-cell { font-size: 12.5px; max-width: 150px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.qb-time-cell { font-size: 12.5px; color: var(--sub); white-space: nowrap; }

/* ===== 详细列表卡片 ===== */
.qb-detail-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  padding: 14px 18px 4px;
}
.qb-card { border: 1px solid var(--border); border-radius: 14px; background: var(--card); padding: 14px 18px; }
.qb-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.qb-id { font-size: 13px; font-weight: 700; color: var(--ink); }
.qb-kp { font-size: 12px; color: var(--sub); }
.qb-right { margin-left: auto; font-size: 12px; color: var(--sub); }
.qb-card-stem { font-size: 13.5px; color: var(--ink); line-height: 1.8; cursor: pointer; }
.qb-figure {
  margin-top: 10px;
  height: 110px;
  border: 1px dashed var(--border);
  border-radius: 10px;
  background: repeating-conic-gradient(var(--bg) 0% 25%, var(--card) 0% 50%) 50% / 16px 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--sub);
  font-size: 12.5px;
}
/* 选项的外观（描边块 / 一行 N 个）都在 QuestionOptions 里，这里只负责与上方题干的距离 */
.qb-options { margin-top: 10px; }
.qb-answer {
  margin-top: 10px;
  border-left: 3px solid var(--brand);
  background: var(--brand-soft);
  border-radius: 0 10px 10px 0;
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: var(--ink-2);
  line-height: 1.7;
}
.qb-answer b { color: var(--ink); }
.qb-answer-text { color: var(--success); font-weight: 600; }
.qb-ops {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
  border-top: 1px dashed var(--border);
  padding-top: 10px;
}
</style>
