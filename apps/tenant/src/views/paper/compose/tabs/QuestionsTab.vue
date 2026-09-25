<script setup lang="ts">
/**
 * 试题页签：工作台的主检索面。**左树右列**——左栏常驻知识点树，右侧筛选条 + 题目列表。
 *
 * 布局与题库管理（BankView）对齐，差别在**教材范围的归属**：题库管理的左树自带一套
 * 年级/学科级联（它跟随顶部栏作用域），而工作台没有顶部栏，年级/学科只有一个来源——
 * 上方筛选条（即 shell 的 `filter`）。所以左树只读 `filter.grade` / `filter.subject`，
 * 不再复制一套下拉框，避免「两个下拉框各说各话」。
 *
 * 知识点也因此从筛选条的弹层挪进左栏：常驻可见，且别的页签「按知识点找题」跳过来时，
 * 左栏立刻显示出刚写进 `filter` 的 chip，而不是把结果藏在一个收起的弹层里。
 *
 * 默认**不显示未入库题**（`includeUnapproved`），与协同组卷选题池「仅已入库可入卷」同口径；
 * 录题中心刚录完、还没审核的题要主动勾选才能看到，避免把待审题误加进正式试卷。
 */
import { computed, ref, watch } from 'vue'
import { AppIcon, showToast } from '@aiteach/shared'
import { useComposeData } from '@/composables/useComposeData'
import { useComposeBasket } from '@/composables/useComposeBasket'
import { useBaseData } from '@/composables/useBaseData'
import QuestionPoolCard from '@/components/compose/QuestionPoolCard.vue'
import ComposeFilterBar from '@/components/compose/ComposeFilterBar.vue'
import KnowledgePicker from '@/components/compose/KnowledgePicker.vue'
import { matchesQuestionFilter, type ComposeFilter } from '../types'

const props = defineProps<{ filter: ComposeFilter }>()
const emit = defineEmits<{
  patch: [patch: Partial<ComposeFilter>]
  findSimilar: [tags: string[]]
}>()

const { questions, loading, loaded, ensure } = useComposeData()
const { questionTypes } = useBaseData()
const basket = useComposeBasket()

const PAGE_SIZE = 10
const page = ref(1)

void ensure()

const rows = computed(() => questions.value.filter((row) => matchesQuestionFilter(row, props.filter)))

/**
 * 知识点树上的计数用「除知识点外，其余条件全生效」的题池。
 *
 * 直接拿全库计数会与点下去看到的结果对不上：树上写着「三角函数 15」，而当前是高一·数学，
 * 点进去只有 8 条 —— 用户会以为丢了题。先摘掉 knowledge 再筛，这个数就正好是「选了它会看到几道」。
 */
const countRows = computed(() =>
  questions.value.filter((row) => matchesQuestionFilter(row, { ...props.filter, knowledge: [] })),
)

/** 列表内部滚动容器：换页/换条件后必须回到顶部，否则会停在半路显得列表是空的 */
const scrollRef = ref<HTMLElement | null>(null)

/** 命中数变了就回第 1 页，否则会出现「筛完只剩 3 条却停在第 7 页」的空列表 */
watch(
  () => rows.value.length,
  () => {
    page.value = 1
    scrollRef.value?.scrollTo({ top: 0 })
  },
)

watch(page, () => scrollRef.value?.scrollTo({ top: 0 }))

const pageCount = computed(() => Math.max(1, Math.ceil(rows.value.length / PAGE_SIZE)))
const paged = computed(() => rows.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE))

/** 组卷车合计：让教师不用拉开抽屉就知道已经选了多少分 */
const basketTip = computed(() => `${basket.count.value} 题 · ${basket.scoreTotal.value} 分`)

/** 未入库题目不能入卷（FR-PP-003），批量加入时必须先剔除，否则会静默多出几道进不了卷的题 */
function addAllOnPage() {
  const addable = paged.value.filter((row) => row.status === 'approved')
  if (addable.length === 0) {
    showToast('本页没有已入库题目可加入组卷车', 'error')
    return
  }
  const added = basket.addMany(addable, 'search')
  const skipped = addable.length - added
  if (added === 0) showToast('本页题目均已在组卷车中', 'error')
  else showToast(skipped > 0 ? `已加入 ${added} 题，${skipped} 题已在车中` : `已加入 ${added} 题`)
}

/** 未入库题目数量：勾选框旁回显，让「为什么搜不到刚录的题」有解释 */
const unapprovedCount = computed(() => questions.value.filter((row) => row.status !== 'approved').length)
</script>

<template>
  <div class="qt">
    <!-- 左：知识点树（常驻）。选中项直接写进 filter.knowledge，与筛选条、其他页签共用一份 -->
    <aside class="qt-tree panel">
      <div class="qtt-head">知识点</div>
      <KnowledgePicker
        fill
        :model-value="filter.knowledge"
        :subject="filter.subject"
        :grade="filter.grade"
        :rows="countRows"
        @update:model-value="emit('patch', { knowledge: $event })"
      />
    </aside>

    <!-- 右：筛选条件在上，题目列表在下 -->
    <div class="qt-right">
      <ComposeFilterBar
        :filter="filter"
        :fields="['grade', 'subject', 'difficulty', 'types']"
        :type-options="questionTypes"
        :result-count="rows.length"
        @patch="emit('patch', $event)"
        @reset="emit('patch', { grade: '', subject: '', difficulty: '', types: [], knowledge: [] })"
      />

      <section class="qt-panel panel">
        <div class="qt-bar">
          <label class="qt-switch" :title="`题库中共 ${unapprovedCount} 道未入库题目（待审 / 驳回）`">
            <input
              type="checkbox"
              :checked="filter.includeUnapproved"
              @change="emit('patch', { includeUnapproved: ($event.target as HTMLInputElement).checked })"
            />
            包含未入库题目<span v-if="unapprovedCount" class="qt-dim">（{{ unapprovedCount }}）</span>
          </label>

          <span class="qt-total">共 <b>{{ rows.length }}</b> 题</span>

          <button class="btn btn-ghost btn-sm" type="button" :disabled="paged.length === 0" @click="addAllOnPage">
            <AppIcon name="cart" :size="13" />
            本页全部加入
          </button>
          <span v-if="basket.count.value" class="qt-basket">{{ basketTip }}</span>
        </div>

        <div ref="scrollRef" class="qt-scroll">
          <p v-if="loading && !loaded" class="empty-row">正在加载试题…</p>
          <p v-else-if="rows.length === 0" class="empty-row">
            没有匹配的试题<template v-if="!filter.includeUnapproved">；若刚录入的题还没审核，可勾选「包含未入库题目」</template>
          </p>
          <template v-else>
            <QuestionPoolCard
              v-for="row in paged"
              :key="row.id"
              :row="row"
              :in-basket="basket.has(row.id)"
              @toggle="basket.toggle($event, 'search')"
              @find-similar="emit('findSimilar', $event)"
            />
          </template>
        </div>

        <div v-if="pageCount > 1" class="qt-pager">
          <button class="mini-btn" type="button" :disabled="page === 1" @click="page -= 1">上一页</button>
          <span>{{ page }} / {{ pageCount }}</span>
          <button class="mini-btn" type="button" :disabled="page === pageCount" @click="page += 1">下一页</button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
/* 左右两栏各自撑满内容区高度：左树内部滚动，右列的列表内部滚动，翻页时筛选条不动 */
.qt {
  display: flex;
  gap: 14px;
  align-items: stretch;
  height: 100%;
  min-height: 480px;
}

.qt-tree {
  width: 288px;
  flex-shrink: 0;
  min-height: 0;
  padding: 12px;
  display: flex;
  flex-direction: column;
}
.qtt-head { font-size: 13px; font-weight: 700; color: var(--ink); padding: 2px 4px 10px; flex-shrink: 0; }

.qt-right { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: 12px; }

.qt-panel { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 12px 14px 10px; }
.qt-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 10px;
  border-bottom: 1px dashed var(--border);
  font-size: 12.5px;
  color: var(--sub);
  flex-shrink: 0;
}
.qt-switch { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; user-select: none; }
.qt-switch input { accent-color: var(--brand); }
.qt-dim { opacity: 0.7; }
.qt-total b { color: var(--brand-deep); font-size: 14px; }
.qt-bar .btn { margin-left: auto; display: inline-flex; align-items: center; gap: 4px; }
.qt-basket {
  padding: 2px 9px;
  border-radius: 999px;
  background: var(--brand-soft);
  color: var(--brand-deep);
  font-weight: 600;
}

/* 题目卡片区独占剩余高度并自行滚动（筛选条、工具行、翻页都固定不动） */
.qt-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 2px 4px 0;
}
.qt-pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding-top: 10px;
  border-top: 1px dashed var(--border);
  font-size: 12.5px;
  color: var(--sub);
  flex-shrink: 0;
}
</style>
