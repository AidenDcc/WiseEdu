<script setup lang="ts">
/**
 * 试卷列表面板：工具条（搜索框 + 展示方式）+ 表格 / 详细双视图 + 分页。
 *
 * 「试卷库」与「组卷工作台 · 试卷页签」要求列表长得一样，两处各抄一份必然漂移
 * （本仓最近的几次提交都在做这类收敛），所以把整块抽出来共用。
 *
 * 组件的边界刻意画在「展示」上：
 * - **弹窗留在父页面**（预览 / 平行卷 / 导出 / 删除确认 / 详情），组件只回抛事件
 *   —— 这些流程各页差别很大（工作台没有导出与删除），塞进来只会退化成 if/else 堆。
 * - **翻页复位留在父页面**：筛选条件变了要回第 1 页，而筛选状态本来就归父页面所有。
 * - **展示方式由 `views` 决定**：传两种就是「表格 / 详细」可切换（试卷库），只传一种就固定那一种
 *   且不渲染切换器（工作台「试卷」页签只要详细）——两处卡片长得一样，但各自能决定要不要表格。
 * - 视图偏好按 `viewKey` 分开记忆：一边切「详细」不该把另一边也带成详细。
 *
 * 详细卡片的两条交互（两处共用）：**整卡可点即预览**（行级悬浮高亮），操作按钮区拦冒泡
 * —— 点「删除」不该先弹一次预览。
 */
import { computed } from 'vue'
import { AppListToolbar, AppSegmented, paperQuestionCount } from '@aiteach/shared'
import type { OrgPaper } from '@aiteach/shared'
import AppPagination from '@/components/ui/AppPagination.vue'
import { difficultyClass } from '@/utils/question-card'
import { useViewMode } from '@/composables/useViewMode'

const props = withDefaults(
  defineProps<{
    /** 当前页的试卷（分页由父组件切好） */
    rows: OrgPaper[]
    /** 筛选后的总条数（分页器用），不是 rows.length */
    total: number
    page: number
    /**
     * 搜索关键词（`v-model:keyword`），**筛选本身由页面做** —— 组件只负责把输入框画出来。
     * 工作台里这个框与顶栏的 `ComposeSearchBar` 写的是同一个 `filter.keyword`
     * （两边同步见 useComposeKeyword），所以两处显示的是同一个词，不是两个独立的搜索。
     */
    keyword?: string
    searchable?: boolean
    placeholder?: string
    /** 视图偏好的存储键：每个列表必须唯一 */
    viewKey?: string
    /** 列表为空时的文案（工作台筛选后为空与「试卷库还没有卷」不是一回事） */
    emptyText?: string
    /**
     * 这个列表提供哪几种展示方式，顺序即切换器里的顺序。
     * 只给一种时固定用它、且**不渲染切换器**（只有一个选项的开关是纯噪声）。
     */
    views?: Array<'table' | 'detail'>
  }>(),
  {
    keyword: '',
    searchable: true,
    placeholder: '试卷名称',
    viewKey: 'paper-list',
    emptyText: '暂无已审核试卷',
    views: () => ['table', 'detail'],
  },
)

const emit = defineEmits<{
  'update:page': [value: number]
  'update:keyword': [value: string]
  preview: [row: OrgPaper]
}>()

/** 两种展示方式的文案 / 图标；切换器的选项顺序跟着 `views` 走，不在两处各写一遍顺序 */
const VIEW_MODE_META = {
  table: { label: '表格', icon: 'grid' },
  detail: { label: '详细', icon: 'file' },
} as const
const viewOptions = computed(() => props.views.map((value) => ({ value, ...VIEW_MODE_META[value] })))

/** 记忆里的取值仍按白名单校验（缓存里可能是已下线的方式），但**实际渲染**以 `views` 为准：
    只给了一种时无视偏好 —— 父页面说了这个列表没有表格视图，就不该被上一次的缓存带回去 */
const viewMode = useViewMode(props.viewKey, ['table', 'detail'] as const, props.views[0] ?? 'table')
const activeView = computed(() => (props.views.length === 1 ? props.views[0] : viewMode.value))

/** AppSegmented 回传 string，这里收窄回 viewMode 的联合类型 */
function setViewMode(value: string) {
  viewMode.value = value as 'table' | 'detail'
}

/** 地区 + 杯赛合并展示（斜杠分隔）：非竞赛卷只显示地区，两者皆无给「—」（列内超长省略，悬浮看全） */
function scopeOf(row: OrgPaper): string {
  return [row.region, row.competition].filter(Boolean).join(' / ') || '—'
}
</script>

<template>
  <div class="panel">
    <!-- 工具条自带 14/18 的内边距，与下方表格的满幅排布配合（表格要贴着面板边才能横向滚动） -->
    <div class="list-head">
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
          <!-- 只有一种展示方式时不渲染切换器：那是个点了没得选的开关 -->
          <AppSegmented
            v-if="views.length > 1"
            :options="viewOptions"
            :model-value="activeView"
            @update:model-value="setViewMode"
          />
        </template>
      </AppListToolbar>
    </div>

    <div v-if="activeView === 'table'" class="data-table-wrap">
      <!-- 固定列宽表格：试卷名称是唯一弹性列（吃剩余宽度），其余列定宽不换行；
           视口放不下时 data-table-wrap 出横向滚动条，名称/操作两列冻结在两端 -->
      <table class="data-table paper-table">
        <colgroup>
          <!-- 试卷名称：不设宽度，自动占满剩余空间 -->
          <col />
          <col class="w-grade" />
          <col class="w-diff" />
          <col class="w-exam" />
          <col class="w-scope" />
          <col class="w-updated" />
          <col class="w-view" />
          <col class="w-down" />
          <col class="w-op" />
        </colgroup>
        <thead>
          <tr>
            <th class="col-name">试卷名称</th>
            <th>年级 / 学科</th>
            <th>难度</th>
            <th>考试类型</th>
            <th>地区 / 杯赛</th>
            <th>更新时间</th>
            <th>浏览次数</th>
            <th>下载次数</th>
            <th class="col-op">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="rows.length === 0">
            <td colspan="9" class="empty-row">{{ emptyText }}</td>
          </tr>
          <template v-else>
            <tr v-for="row in rows" :key="row.id">
              <td class="cell-strong col-name">
                <span class="cell-clip" :title="row.name" @click="emit('preview', row)">{{ row.name }}</span>
                <span v-if="row.parallelOf" class="tag tag-blue">平行卷</span>
              </td>
              <td>{{ row.grade }} / {{ row.subject }}</td>
              <td>{{ row.difficulty ?? '—' }}</td>
              <td>{{ row.examType ?? '—' }}</td>
              <td class="col-scope">
                <span class="cell-clip" :title="scopeOf(row)">{{ scopeOf(row) }}</span>
              </td>
              <td>{{ row.updatedAt }}</td>
              <td>{{ row.viewCount ?? 0 }}</td>
              <td>{{ row.downloadCount ?? 0 }}</td>
              <td class="col-op">
                <div class="op-group">
                  <slot name="ops" :row="row" />
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <!-- 详细列表：整卷信息卡（卷头标签 + 卷名 + 操作 + 来源），排版与卷内细节仍走「预览」。
         整卡可点即预览（行级悬浮高亮），所以操作按钮那一块要拦冒泡 -->
    <div v-else class="detail-list">
      <p v-if="rows.length === 0" class="empty-row">{{ emptyText }}</p>
      <article v-for="row in rows" :key="row.id" class="p-card" @click="emit('preview', row)">
        <div class="pc-meta">
          <span class="pc-id">#{{ row.id }}</span>
          <span class="tag tag-blue">{{ row.grade }} / {{ row.subject }}</span>
          <span class="tag" :class="difficultyClass(row.difficulty ?? '')">{{ row.difficulty ?? '难度未定' }}</span>
          <!-- 考试类型 / 地区·杯赛 / 来源都并入标签行：它们是「这份卷是什么」的一部分，和难度同级；
               没有值的卷不占位（显一个「—」标签比不显示更吵）。
               「已共享广场」标签产品已要求去掉 —— 卷头属性那一块随之整个取消，卡片只有「标签行 + 卷名」两层 -->
          <span v-if="row.examType" class="tag tag-gray">{{ row.examType }}</span>
          <span v-if="row.region || row.competition" class="tag tag-gray">{{ scopeOf(row) }}</span>
          <span v-if="row.source" class="tag tag-gray">{{ row.source }}</span>
          <span v-if="row.parallelOf" class="tag tag-blue">平行卷</span>
          <!-- 题量排在热度前面：它是「这份卷有多大」的属性，比浏览 / 下载次数更值得先看到 -->
          <span class="pc-right">题量 {{ paperQuestionCount(row) }} · 浏览 {{ row.viewCount ?? 0 }} · 下载 {{ row.downloadCount ?? 0 }} · 更新 {{ row.updatedAt.slice(5, 16) }}</span>
        </div>
        <div class="pc-head">
          <h3 class="pc-name" :title="row.name">{{ row.name }}</h3>
          <div class="pc-ops" @click.stop>
            <slot name="ops" :row="row" />
          </div>
        </div>
      </article>
    </div>

    <AppPagination
      :total="total"
      :page="page"
      :page-size="10"
      @update:page="emit('update:page', $event)"
    />
  </div>
</template>

<style scoped>
/* 列表工具条与面板同宽同边距：表格满幅贴边才能横向滚动，所以内边距给在工具条这一层 */
.list-head { padding: 14px 18px 0; flex-shrink: 0; }

/* 面板高度由父容器决定（工作台里是 flex 子项），列表区吃掉剩余高度、自己滚动 */
.panel { display: flex; flex-direction: column; }
.data-table-wrap,
.detail-list { flex: 1 1 auto; min-height: 0; }

/* ===== 定宽表格：试卷名称弹性吃满剩余宽度，其余列定宽不换行 =====
 * table-layout: fixed 下，<col> 不设宽度的列平分剩余空间 —— 名称列是唯一不设宽的，
 * 于是独占全部剩余宽度；min-width = 定宽列之和 1000 + 名称列最小 200，
 * 视口不够时表格撑开、由外层 wrap 出横向滚动条。 */
.paper-table { table-layout: fixed; min-width: 1200px; }
.paper-table th,
.paper-table td { white-space: nowrap; }
.paper-table .w-grade { width: 118px; }
.paper-table .w-diff { width: 64px; }
.paper-table .w-exam { width: 108px; }
.paper-table .w-scope { width: 150px; }
.paper-table .w-updated { width: 168px; }
.paper-table .w-view { width: 84px; }
.paper-table .w-down { width: 84px; }
.paper-table .w-op { width: 224px; }

/* ===== 冻结列：名称贴左、操作贴右 =====
 * sticky 单元格必须给实底色（透明会透出底下滚过的内容）；行悬浮色在下面单独盖一层。
 * box-shadow 画竖向分隔线：border-collapse 的边框不随 sticky 走，shadow 才靠得住。 */
.paper-table .col-name,
.paper-table .col-op { position: sticky; z-index: 2; background: var(--card); }
.paper-table .col-name {
  left: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  /* flex 子项默认不肯收缩到内容宽以下，名称的省略就发生在这一层 */
  box-shadow: 1px 0 0 var(--border);
}
.paper-table .col-op { right: 0; box-shadow: -1px 0 0 var(--border); }
/* 表头两角：表头有自己的底色和更高的层级（全局 thead th 是 sticky top / z-1） */
.paper-table thead .col-name,
.paper-table thead .col-op { z-index: 3; background: #f8fafd; }
/* 行悬浮时冻结列跟着换色，否则左右两块「焊死」在白色上很扎眼 */
.paper-table tbody tr:hover .col-name,
.paper-table tbody tr:hover .col-op { background: #fafbfe; }

/* 单行省略（名称 / 地区杯赛）：min-width: 0 让 flex 子项可收缩，title 负责悬浮看全 */
.cell-clip {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.col-scope .cell-clip { display: block; }
/* 名称列里的标签（平行卷）永远完整显示，不参与收缩 */
.col-name .tag { flex: none; }
/* 名称即预览入口（与题库管理「点行预览」同语义），给出手型反馈 */
.paper-table .col-name .cell-clip { cursor: pointer; }
.paper-table .col-name .cell-clip:hover { color: var(--brand); }

/* ===== 详细列表：整卷信息卡（结构对齐题库管理的题目卡片） ===== */
.detail-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  /* 表格模式是贴面板边的满幅排布，详细模式是卡片流，需要补回内边距 */
  padding: 14px 18px 4px;
}
/* 整卡即预览入口：悬浮时描边转品牌色 + 轻微投影，提示「这块可以点」 */
.p-card {
  border: 1px solid var(--border);
  border-radius: 14px;
  background: #fff;
  padding: 14px 18px;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.p-card:hover { border-color: var(--brand); box-shadow: 0 6px 18px rgba(0, 180, 166, 0.14); }
.pc-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.pc-id { font-size: 13px; font-weight: 700; color: var(--ink); }
.pc-right { margin-left: auto; font-size: 12px; color: var(--sub); }
/* 卷名与操作同一行：名称吃剩余宽度（长了省略，悬浮看全），操作按钮靠右且不被压窄。
   卷头属性已全部并入上面的标签行，这一行就是卡片最后一行，不再留底边距 */
.pc-head { display: flex; align-items: center; gap: 12px; }
.pc-name {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--ink);
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pc-ops { display: flex; align-items: center; gap: 4px; flex: none; }
</style>
