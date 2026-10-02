<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  AppFilterPanel,
  AppListToolbar,
  QUESTION_SOURCE_OPTIONS,
  RichTextViewer,
  appConfirm,
  showToast,
  ApiError,
  toPlainText,
} from '@aiteach/shared'
import type { FilterRowDef, OrgQuestion } from '@aiteach/shared'
import AppPagination from '@/components/ui/AppPagination.vue'
import QuestionPreviewDrawer from '@/components/question/QuestionPreviewDrawer.vue'
import { deleteQuestions, fetchQuestions, submitQuestions } from '@/api/org'
import { useAuthStore } from '@/stores/auth'
import { useBaseData } from '@/composables/useBaseData'

const router = useRouter()

/* 个人题库的口径是「我录的题」：按 owner 过滤而不是 library —— 审核通过的题 library 会被
   终审自动翻成机构公共（reviewQuestion 的升库逻辑），按 library 筛「审核通过」的题就从
   本列表消失了。手动草稿 / 待审 / 驳回 / AI 出题 / 图片识题 / 变式的题全都写 owner=当前用户。 */
const auth = useAuthStore()
const currentUserId = computed(() => auth.user?.id ?? 101)

/* 状态标签用教师视角措辞（待审核 / 审核通过 / 审核驳回），不复用全局 QUESTION_STATUS_TEXT
   的「待终审 / 已入库」—— 那套是审核中心与题库管理的口径。中文标签同时就是筛选面板里的取值。 */
const STATUS_LABEL = {
  draft: '草稿',
  checking: '校验中',
  pending: '待审核',
  approved: '审核通过',
  rejected: '审核驳回',
  offline: '已下架',
} as const
type StatusKey = keyof typeof STATUS_LABEL
const TAG_CLASS: Record<StatusKey, string> = {
  draft: 'tag-gray',
  checking: 'tag-blue',
  pending: 'tag-orange',
  approved: 'tag-green',
  rejected: 'tag-red',
  offline: 'tag-gray',
}

/* ===== 数据 ===== */
const list = ref<OrgQuestion[]>([])
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    /* 筛选行的年级 / 学科 / 题型 / 难度选项都出自这份全局字典（模块级单例，全站只请求一轮） */
    await ensure().catch(() => {})
    list.value = await fetchQuestions()
  } finally {
    loading.value = false
  }
}

/* ================= 可折叠筛选条件 ================= */
interface PersonalFilterRow {
  key: 'status' | 'source' | 'grade' | 'subject' | 'type' | 'difficulty'
  label: string
}

const FILTER_ROWS: PersonalFilterRow[] = [
  { key: 'status', label: '状态' },
  /* 来源给全量字典：文档导入 / 教辅导入进来的题同样写 owner=当前用户，属于本页 */
  { key: 'source', label: '来源' },
  { key: 'grade', label: '年级' },
  { key: 'subject', label: '学科' },
  { key: 'type', label: '题型' },
  { key: 'difficulty', label: '难度' },
]

const filterSel = reactive<Record<PersonalFilterRow['key'], string[]>>({
  status: [],
  source: [],
  grade: [],
  subject: [],
  type: [],
  difficulty: [],
})

const { subjects, grades, questionTypesFor, difficulties, ensure } = useBaseData()

const filterRows = computed<FilterRowDef[]>(() =>
  FILTER_ROWS.map((row) => ({ key: row.key, label: row.label, options: rowOptions(row) })),
)

/** AppFilterPanel 回传的是整份筛选值（覆盖式回写，不做级联） */
function onFiltersChange(next: Record<string, string[]>) {
  FILTER_ROWS.forEach((row) => {
    filterSel[row.key] = next[row.key] ?? []
  })
}

/* 题型不做学科收窄（本页没有学科作用域）：传空学科 = 通用 + 全部学科专属，英语完形填空也能筛 */
function rowOptions(row: PersonalFilterRow): string[] {
  if (row.key === 'status') return Object.values(STATUS_LABEL)
  if (row.key === 'source') return QUESTION_SOURCE_OPTIONS
  if (row.key === 'grade') return grades.value
  if (row.key === 'subject') return subjects.value
  if (row.key === 'type') return questionTypesFor('')
  return difficulties.value
}

/* ================= 列表筛选 / 分页 ================= */
const keyword = ref('')
const page = ref(1)
const pageSize = 10

/** 每个筛选 key 从题目上取哪个值（状态用中文标签，与面板显示一致） */
const FIELD_OF: Record<PersonalFilterRow['key'], (row: OrgQuestion) => string> = {
  status: (row) => STATUS_LABEL[row.status as StatusKey] ?? '',
  source: (row) => row.source,
  grade: (row) => row.grade,
  subject: (row) => row.subject,
  type: (row) => row.type,
  difficulty: (row) => row.difficulty,
}

const filtered = computed(() => {
  const kw = keyword.value.trim()
  return list.value
    .filter((row) => row.ownerId === currentUserId.value)
    .filter((row) => {
      for (const def of FILTER_ROWS) {
        const selected = filterSel[def.key]
        if (selected.length > 0 && !selected.includes(FIELD_OF[def.key](row))) return false
      }
      if (kw && !toPlainText(row.stem).includes(kw) && !String(row.id).includes(kw)) return false
      return true
    })
    /* 本页有「更新时间」列，新录的题排前面（不然刚提交的草稿沉底找不着） */
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
})

const paged = computed(() => filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize))

watch([() => JSON.stringify(filterSel), keyword], () => {
  page.value = 1
})

/* ===== 题干悬浮提示 =====
   表格里的题干最多给三行（.stem-clip），完整内容悬浮显示。原生 title 放不了富文本
   （上下标 / 公式），故自持一个 fixed 定位的小浮层：跟随光标、贴边翻转、限宽限高，
   pointer-events: none 让它永不挡住 hover 目标，也不会因滚轮滚表格而错位闪烁。 */
const TIP_W = 420
const TIP_H = 190
const tip = ref<{ x: number; y: number; row: OrgQuestion } | null>(null)

function onStemEnter(event: MouseEvent, row: OrgQuestion) {
  tip.value = { x: event.clientX, y: event.clientY, row }
}
function onStemMove(event: MouseEvent) {
  if (tip.value) tip.value = { ...tip.value, x: event.clientX, y: event.clientY }
}
function onStemLeave() {
  tip.value = null
}
/** 浮层落点：默认光标右下；越出视口时贴边 / 翻到上方 */
function tipStyle() {
  const t = tip.value
  if (!t) return {}
  const left = Math.min(Math.max(t.x + 14, 8), window.innerWidth - TIP_W - 8)
  const flipUp = t.y + 18 + TIP_H > window.innerHeight
  const top = flipUp ? Math.max(t.y - TIP_H - 12, 8) : t.y + 18
  return { left: `${left}px`, top: `${top}px` }
}

/* ===== 操作：预览 / 编辑 / 提交审核 / 放入回收站 ===== */
const preview = ref<OrgQuestion | null>(null)

/** 带题目 id 进录题中心编辑，页面里「保存并提交审核」即再次提交到机构题库 */
function goEdit(id: number) {
  router.push({ path: '/question/create', query: { id: String(id) } })
}

/* 提交审核 / 回收站只给草稿与驳回的题：待审核的在等终审，审核通过 / 已下架的已归机构池，
   回收操作走题库管理 */
function canSubmit(row: OrgQuestion): boolean {
  return row.status === 'draft' || row.status === 'rejected'
}

async function onSubmit(row: OrgQuestion) {
  if (!(await appConfirm(`确认将题目 #${row.id} 提交审核？`, { type: 'info' }))) return
  try {
    const { count } = await submitQuestions([row.id])
    showToast(
      count > 0 ? '已提交审核，完成后可在审核中心跟进终审' : '该题当前状态不可提交',
      count > 0 ? 'success' : 'error',
    )
    void load()
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : '提交失败', 'error')
  }
}

async function onRecycle(row: OrgQuestion) {
  if (!(await appConfirm(`确认将题目 #${row.id} 放入回收站？回收站内保留 30 天，期间可恢复。`, { type: 'danger' }))) return
  try {
    await deleteQuestions([row.id])
    showToast('已放入回收站（保留 30 天）', 'success')
    load()
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : '操作失败', 'error')
  }
}

/* ===== 挂载 ===== */
onMounted(() => {
  void load()
})
</script>

<template>
  <div class="personal-bank">
    <!-- 筛选条件（可折叠；行渲染 / 折叠汇总 / 清空由共享组件 AppFilterPanel 负责） -->
    <AppFilterPanel :rows="filterRows" :model-value="filterSel" @update:model-value="onFiltersChange" />

    <!-- 我的题目列表 -->
    <div class="panel table-panel">
      <AppListToolbar v-model="keyword" placeholder="题干关键词 / 题目编号" :search-width="240">
        <template #right>
          <span class="f-hint pb-count">共 {{ filtered.length }} 题</span>
        </template>
      </AppListToolbar>

      <div class="data-table-wrap">
        <table class="data-table personal-table">
          <thead>
            <tr>
              <!-- 列分三组：题干以左（序号 / 编号 / 年级 / 学科）钉在列表左端，题干以右
                   （题型 … 操作）钉在右端，题干是唯一不定宽列，吃掉中间的全部剩余宽度 ——
                   于是窗口越宽题干越舒展，其余列位置恒定不动。 -->
              <th style="width: 46px">序号</th>
              <th style="width: 84px">题目编号</th>
              <th style="width: 64px">年级</th>
              <th style="width: 64px">学科</th>
              <th>题干</th>
              <th style="width: 76px">题型</th>
              <th style="width: 66px">难度</th>
              <th style="width: 90px">来源</th>
              <th style="width: 100px">状态</th>
              <th style="width: 96px">更新时间</th>
              <th style="width: 285px">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading && list.length === 0">
              <td colspan="11" class="empty-row">加载中…</td>
            </tr>
            <tr v-else-if="paged.length === 0">
              <td colspan="11" class="empty-row">暂无题目：录题中心存的草稿、AI 出题 / 图片识题的题目都会汇集在这里</td>
            </tr>
            <template v-else>
              <tr v-for="(row, i) in paged" :key="row.id">
                <td>{{ (page - 1) * pageSize + i + 1 }}</td>
                <td class="cell-strong">#{{ row.id }}</td>
                <td>{{ row.grade }}</td>
                <td>{{ row.subject }}</td>
                <!-- 题干最多三行（行高随之有上界），完整内容悬浮显示、点开进预览抽屉 -->
                <td
                  class="stem-cell"
                  @click="preview = row"
                  @mouseenter="onStemEnter($event, row)"
                  @mousemove="onStemMove"
                  @mouseleave="onStemLeave"
                >
                  <div class="stem-clip"><RichTextViewer :content="row.stem" tag="span" /></div>
                </td>
                <td>{{ row.type }}</td>
                <td>{{ row.difficulty }}</td>
                <td>{{ row.source }}</td>
                <td>
                  <!-- 驳回的题悬停可见驳回意见（完整内容与审核意见都在预览抽屉里） -->
                  <span
                    class="tag"
                    :class="TAG_CLASS[row.status as StatusKey]"
                    :title="row.status === 'rejected' && row.reviewOpinion ? `驳回意见：${row.reviewOpinion}` : undefined"
                  >
                    {{ STATUS_LABEL[row.status as StatusKey] }}
                  </span>
                </td>
                <td class="time-cell">{{ row.updatedAt.slice(5, 16) }}</td>
                <td>
                  <div class="op-group">
                    <button class="mini-btn" type="button" @click="preview = row">预览</button>
                    <button class="mini-btn" type="button" @click="goEdit(row.id)">编辑</button>
                    <button v-if="canSubmit(row)" class="mini-btn" type="button" @click="onSubmit(row)">提交审核</button>
                    <button v-if="canSubmit(row)" class="mini-btn" type="button" @click="onRecycle(row)">放入回收站</button>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <AppPagination :total="filtered.length" v-model:page="page" :page-size="pageSize" />
    </div>

    <!-- 题干悬浮浮层：fixed 定位（不受表格滚动容器裁剪），限宽限高，不拦截鼠标 -->
    <div v-if="tip" class="stem-tip" :style="tipStyle()">
      <RichTextViewer :content="tip.row.stem" />
    </div>

    <!-- 题目预览：与题库管理 / 录题中心共用同一个抽屉（来源 / 库 / 审核意见 / 变式关联都在里面） -->
    <QuestionPreviewDrawer v-if="preview" :question="preview" @close="preview = null" />
  </div>
</template>

<style scoped>
/* 单栏列表页：高度随屏幕撑满内容区（顶栏 62 + 内容区上下内边距 44），仅题目列表区域滚动。
   与题库管理同一套布局令牌，只是没有左侧知识点面板 —— 本页按状态 / 来源看题，不过知识树。 */
.personal-bank {
  --content-h: calc(100vh - 106px);
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: var(--content-h);
  min-height: 460px;
}

/* 面板撑满剩余高度：工具栏、分页固定，仅表格区滚动 */
.table-panel { min-width: 0; flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 14px 16px 12px; }
.data-table-wrap { flex: 1; min-height: 0; overflow: auto; }
.table-panel .pagination { flex-shrink: 0; }

.pb-count { margin: 0; }

/* 列宽：只有题干列不给宽度，table-layout: fixed 下它吃掉全部剩余宽度 —— 题干左边的列
   靠左、右边的列靠右（配合表格 width:100% 即「左右吸附」）。固定列合计 971px，
   min-width 让窗口再窄就横向滚动而不是压缩固定列 */
.personal-table { table-layout: fixed; min-width: 1160px; }
.stem-cell {
  line-height: 1.6;
  font-size: 13px;
  color: var(--ink-2);
  cursor: pointer;
  text-align: left;
  vertical-align: middle;
}
.stem-cell:hover { color: var(--brand-deep); }
/* 行内题干最多三行：行高因此有上界（三行约 62px），超出的省略号截断，完整内容看悬浮浮层 / 预览 */
.stem-clip {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  max-height: 63px;
  overflow: hidden;
}
.time-cell { font-size: 12.5px; color: var(--sub); white-space: nowrap; }
/* 状态标签不换行：全局 .tag 没有 nowrap，四字标签（审核通过 / 审核驳回）在窄列里会折成两行 */
.personal-table .tag { white-space: nowrap; }

/* 题干悬浮浮层：有大小限制（宽 ≤420px、高 ≤190px），超出自身滚动；不拦截鼠标事件 */
.stem-tip {
  position: fixed;
  z-index: 60;
  max-width: 420px;
  max-height: 190px;
  overflow-y: auto;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 10px 28px rgba(28, 36, 52, 0.14);
  padding: 10px 12px;
  font-size: 13px;
  color: var(--ink-2);
  line-height: 1.7;
  pointer-events: none;
}
</style>
