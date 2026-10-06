<script setup lang="ts">
/**
 * 组卷车弹出框（右侧滑出 + 遮罩，复用共享 AppDrawer）：按大题分组预览、拖拽排序、
 * 逐题/批量改分、重复题提醒，底部给「生成试卷」。
 *
 * 分组**直接调 `buildSections`**，也就是生成试卷时真正会用的那个函数——预览与实际落库
 * 若各算一遍，迟早出现「预览是 3 个大题、存下来变 4 个」这种对不上的 bug。代价是这个
 * 计算会随每次改分重算，但组卷车规模（几十题）下完全可以忽略。
 *
 * **拖拽排的是「整表的相对次序」而不是「第几题」**：卷面大题由 `buildSections` 按题型自动归，
 * 大题内的题序就是条目在表中的相对次序。所以教师拖动的语义是「这道题放在那道题前面」，
 * 而不是「拖到第 3 题」——后者在自动归大题的规则下根本不成立（拖到解答题中间也还是在单选大题里）。
 *
 * 分值输入用失焦时提交而非逐字符提交：输入「1」到「12」的中间态会先把分值改成 1，
 * 有 `savePaper` 的分值区间校验在，逐字符提交会不停弹出非法提示。
 *
 * **题与资源分成两组页签展示**：媒体（图片 / 视频 / 小程序）进车后是「随卷参考资料」，
 * 不参与分值与大题结构，所以它们**不走 `buildSections`**，独立渲染一份列表 —— 硬塞进
 * 题目分组里会得到一个既没有分值、也不该被拖拽排序的假题目行。
 */
import { computed, nextTick, ref, watch } from 'vue'
import type { MediaKind, OrgQuestion } from '@aiteach/shared'
import { AppDrawer, AppIcon, AppModal, AppSegmented, resolveMediaSrc, showToast } from '@aiteach/shared'
import { useComposeData } from '@/composables/useComposeData'
import { useComposeBasket, type BasketEntry, type BasketResource } from '@/composables/useComposeBasket'
import { duplicatePairs } from '@/utils/question-match'
import { difficultyRank } from '@/views/paper/compose/blueprint'
import { MAX_SECTIONS, defaultScore, objectiveScoreOfSections, scoreOfSections } from '@/views/paper/paper-sections'

const props = withDefaults(
  defineProps<{
    open: boolean
    /**
     * 抽屉层级，透传给 AppDrawer（默认 110，即共享抽屉的常规层级）。
     * 组卷工作台传 310：那里的悬浮球在 301，抽屉按默认层级会被球盖住，
     * 也会落到试卷预览（130）后面 —— 在预览里点组卷车就打不开了。见 ComposeView 的层级说明。
     */
    zIndex?: number
  }>(),
  { zIndex: 110 },
)
const emit = defineEmits<{ close: []; compose: [] }>()

const { questions, questionOf } = useComposeData()
const basket = useComposeBasket()

/* ===== 页签：试题 / 图片 / 小程序 / 视频 ===== */

/** 资源三类与 `MediaKind` 一一对应（`animation` 在界面上叫「小程序」，与媒体库口径一致） */
type ResourceTab = MediaKind
type BasketTab = 'questions' | ResourceTab

const RESOURCE_TABS: ResourceTab[] = ['image', 'animation', 'video']
const KIND_TEXT: Record<MediaKind, string> = { image: '图片', animation: '小程序', video: '视频' }
const KIND_ICON: Record<MediaKind, string> = { image: 'image', animation: 'chart', video: 'smartphone' }

const tab = ref<BasketTab>('questions')

const tabCount = computed<Record<BasketTab, number>>(() => ({
  questions: basket.count.value,
  image: basket.resourceCount('image'),
  animation: basket.resourceCount('animation'),
  video: basket.resourceCount('video'),
}))

/** 四个页签常驻（数量为 0 也在），位置稳定，不做「有内容才出现」的跳动 */
const tabOptions = computed(() => [
  { value: 'questions', label: `试题 ${tabCount.value.questions}` },
  ...RESOURCE_TABS.map((kind) => ({ value: kind, label: `${KIND_TEXT[kind]} ${tabCount.value[kind]}` })),
])

/* 当前资源段的类型（试题段为 null）。模板里的 `tab !== 'questions'` 分支不会让 vue-tsc 收窄
   `tab` 的联合类型，所以下标一律走这个 computed，而不是直接 `KIND_TEXT[tab]`。 */
const activeKind = computed<MediaKind | null>(() => (tab.value === 'questions' ? null : tab.value))
const activeKindText = computed(() => (activeKind.value ? KIND_TEXT[activeKind.value] : ''))

const resourceRows = computed(() =>
  activeKind.value ? basket.resources.value.filter((row) => row.kind === activeKind.value) : [],
)

/**
 * 落在第一个非空段。只在**打开抽屉**与**移出最后一条**时调用，不做计数 watch ——
 * 否则用户手动点到一个空段（比如试题还没加）会被立刻弹走，像是点不动。
 */
function pickTab(): BasketTab {
  if (tabCount.value[tab.value] > 0) return tab.value
  return (['questions', ...RESOURCE_TABS] as BasketTab[]).find((key) => tabCount.value[key] > 0) ?? 'questions'
}

watch(
  () => props.open,
  (open) => {
    if (open) tab.value = pickTab()
  },
)

/** 移出题目：走这里而不是直接用 `basket.remove`，好把「当前段空了就换段」一起处理 */
function removeQuestion(questionId: number) {
  basket.remove(questionId)
  tab.value = pickTab()
}

function removeResource(row: BasketResource) {
  basket.removeResource(row.kind, row.id)
  tab.value = pickTab()
}

const previewResource = ref<BasketResource | null>(null)

const built = computed(() => basket.toSections(questions.value))
const totalScore = computed(() => scoreOfSections(built.value.sections))
const objectiveScore = computed(() => objectiveScoreOfSections(built.value.sections, questions.value))

/** 抽屉副标题：题数 / 总分，车里有资源时再补一句，好知道「生成试卷」会带上什么 */
const subtitle = computed(() => {
  if (!basket.totalCount.value) return '从试题、知识点或整卷里选题加入'
  const head = `${basket.count.value} 题 · 共 ${totalScore.value} 分`
  return basket.resourceTotal.value ? `${head} · ${basket.resourceTotal.value} 个资源` : head
})

/** 题目来源说明：让「这题我从哪加进来的」可追溯 */
const SOURCE_TEXT: Record<string, string> = {
  search: '搜索',
  pool: '试题池',
  sync: '同步练习',
  knowledge: '知识点',
  paper: '整卷引用',
  blueprint: '细目表',
}

const MIN_SCORE = 0.5
const MAX_SCORE = 100

/** 分值输入框的本地草稿：失焦/回车才写回组卷车，避免中间态触发校验 */
const editing = ref<Record<number, string>>({})
function scoreDraft(questionId: number, score: number): string {
  return editing.value[questionId] ?? String(score)
}
function setDraft(questionId: number, raw: string) {
  editing.value[questionId] = raw
}
function commitScore(questionId: number, raw: string) {
  const value = Number(raw)
  if (!Number.isFinite(value) || value < MIN_SCORE || value > MAX_SCORE) {
    showToast(`分值需在 ${MIN_SCORE}~${MAX_SCORE} 之间，已还原`, 'error')
  } else {
    basket.setScore(questionId, value)
  }
  const next = { ...editing.value }
  delete next[questionId]
  editing.value = next
}

/** 展开某题看题干（抽屉窄，默认只列题号与知识点） */
const expanded = ref<number | null>(null)
async function toggleExpand(id: number) {
  expanded.value = expanded.value === id ? null : id
  await nextTick()
}

function resetScoreAll() {
  basket.entries.value.forEach((entry) => {
    const row = questionOf(entry.questionId)
    if (row) basket.setScore(entry.questionId, defaultScore(row.type))
  })
  showToast('已按题型恢复默认分值')
}

/* ===== 拖拽排序 ===== */

/**
 * 只有按住左侧手柄才允许拖：整行 draggable 会让「在分值输入框里拖选文字」变成拖动题目，
 * 而 `draggable` 属性改为响应式绑定是来不及的——Vue 更新 DOM 在 nextTick，
 * dragstart 已经先触发了。所以用 mousedown 同步置一个开关，在 dragstart 里拦。
 */
const dragArmed = ref(false)
const draggingId = ref<number | null>(null)
const dropId = ref<number | null>(null)

function armDrag() {
  dragArmed.value = true
}
function endDrag() {
  dragArmed.value = false
  draggingId.value = null
  dropId.value = null
}
function onDragStart(questionId: number, event: DragEvent) {
  if (!dragArmed.value) {
    event.preventDefault()
    return
  }
  draggingId.value = questionId
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    /* 部分浏览器（Firefox）没有 dataTransfer 数据不会触发 drop */
    event.dataTransfer.setData('text/plain', String(questionId))
  }
}
function onDragOver(questionId: number, event: DragEvent) {
  if (draggingId.value === null) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  dropId.value = questionId
}
function onDrop(questionId: number, event: DragEvent) {
  event.preventDefault()
  const from = draggingId.value
  endDrag()
  if (from === null || from === questionId) return
  const to = basket.entries.value.findIndex((row) => row.questionId === questionId)
  if (to < 0) return
  basket.moveById(from, to)
}

/* ===== 批量改分 ===== */

const checked = ref<number[]>([])
function toggleCheck(questionId: number) {
  checked.value = checked.value.includes(questionId)
    ? checked.value.filter((id) => id !== questionId)
    : [...checked.value, questionId]
}
/** 抽屉里实际能看到的题（缺失题不参与全选） */
const visibleIds = computed(() => built.value.sections.flatMap((section) => section.questions.map((q) => q.questionId)))
const allChecked = computed(() => visibleIds.value.length > 0 && checked.value.length >= visibleIds.value.length)
function toggleAll() {
  checked.value = allChecked.value ? [] : [...visibleIds.value]
}

const batchScore = ref('')
function applyBatchScore() {
  const value = Number(batchScore.value)
  if (!Number.isFinite(value) || value < MIN_SCORE || value > MAX_SCORE) {
    showToast(`分值需在 ${MIN_SCORE}~${MAX_SCORE} 之间`, 'error')
    return
  }
  basket.setScoreMany(checked.value, value)
  showToast(`已将 ${checked.value.length} 道题设为 ${value} 分`)
}

/* ===== 自动排序 ===== */

type SortMode = 'added' | 'type' | 'difficulty' | 'score'
const OBJECTIVE = new Set(['单选', '多选', '判断'])

/** 组卷车条目 + 反查到的题目；题目已缺失的条目不参与排序（它们本来就进不了卷） */
interface BasketRow {
  entry: BasketEntry
  item: OrgQuestion
}

function applySort(mode: SortMode) {
  const rows: BasketRow[] = basket.entries.value.flatMap((entry) => {
    const item = questionOf(entry.questionId)
    return item ? [{ entry, item }] : []
  })

  const seqOf = (entry: BasketEntry) => entry.seq ?? 0

  const sorted = [...rows].sort((a, b) => {
    if (mode === 'type') {
      /* 客观题在前、主观题在后（真实考卷的通行顺序），同组内按加入顺序 */
      const rank = Number(OBJECTIVE.has(a.item.type)) - Number(OBJECTIVE.has(b.item.type))
      if (rank !== 0) return rank
      return seqOf(a.entry) - seqOf(b.entry)
    }
    if (mode === 'difficulty') {
      return difficultyRank(a.item.difficulty) - difficultyRank(b.item.difficulty) || seqOf(a.entry) - seqOf(b.entry)
    }
    if (mode === 'score') {
      return b.entry.score - a.entry.score || seqOf(a.entry) - seqOf(b.entry)
    }
    return seqOf(a.entry) - seqOf(b.entry)
  })

  const order = sorted.map((row) => row.entry.questionId)
  if (mode === 'added') {
    basket.applyOrder(basket.orderByAdded())
    showToast('已恢复加入顺序')
    return
  }
  basket.applyOrder(order)
  showToast('已重新排序')
}

/* ===== 重复题检测 ===== */

const basketQuestions = computed<OrgQuestion[]>(() =>
  basket.entries.value.flatMap((entry) => {
    const row = questionOf(entry.questionId)
    return row ? [row] : []
  }),
)
const duplicates = computed(() => duplicatePairs(basketQuestions.value, 0.82).slice(0, 3))
</script>

<template>
  <!-- 弹出框：遮罩 + 从右向左滑出（AppDrawer 自带动画 / Escape / 点击遮罩关闭） -->
  <AppDrawer
    v-if="open"
    title="组卷车"
    :subtitle="subtitle"
    :width="420"
    :z-index="zIndex"
    @close="emit('close')"
  >
    <!-- 车全空时不显示页签：四个「0」纯是噪音，空态本身已经说清了怎么加 -->
    <AppSegmented v-if="basket.totalCount.value" v-model="tab" class="bk-tabs" :options="tabOptions" />

    <div v-if="built.missing.length && tab === 'questions'" class="bk-warn">
      <AppIcon name="warning" :size="14" />
      {{ built.missing.length }} 道题在题库中已不存在（编号 {{ built.missing.join('、') }}），生成试卷时会跳过
    </div>
    <div v-if="built.overflow && tab === 'questions'" class="bk-warn">
      <AppIcon name="warning" :size="14" />
      已超过 {{ MAX_SECTIONS }} 个大题上限，{{ built.overflow }} 道题并入最后一个大题
    </div>
    <div v-if="duplicates.length && tab === 'questions'" class="bk-warn dup">
      <AppIcon name="warning" :size="14" />
      <span>
        检测到疑似重复题：
        <template v-for="(pair, index) in duplicates" :key="pair.a.id">
          <template v-if="index">；</template>
          <b>#{{ pair.a.id }}</b> 与 <b>#{{ pair.b.id }}</b>
        </template>
        （题干高度相似，建议替换其一）
      </span>
    </div>

    <div v-if="basket.totalCount.value === 0" class="bk-empty">
      <AppIcon name="cart" :size="34" />
      <p>组卷车还是空的</p>
      <p class="f-hint">
        在「试题 / 知识点组卷 / 同步练习组卷 / 细目表组卷」里点「加入组卷车」，或整卷引用一份现成试卷；
        图片 / 视频 / 小程序页签里的资源也能加进来，生成试卷时随卷存为参考资料。
      </p>
    </div>

    <!-- 资源段：参考资料不参与分值与大题结构，独立列表，不套 buildSections 的分组 -->
    <div v-else-if="tab !== 'questions'" class="bk-res">
      <p v-if="!resourceRows.length" class="bk-subempty">该页签下的资源都已移出</p>
      <div v-for="row in resourceRows" :key="`${row.kind}-${row.id}`" class="bk-res-row">
        <span class="bk-res-thumb" :class="`kind-${row.kind}`">
          <img v-if="row.url" :src="resolveMediaSrc(row.url)" :alt="row.name" />
          <AppIcon v-else :name="KIND_ICON[row.kind]" :size="16" />
        </span>
        <span class="bk-res-main">
          <span class="bk-res-name" :title="row.name">{{ row.name }}</span>
          <span class="bk-res-meta">{{ KIND_TEXT[row.kind] }} · {{ row.sizeMb.toFixed(1) }} MB</span>
        </span>
        <button class="bk-icon" type="button" title="预览" @click="previewResource = row">
          <AppIcon name="eye" :size="14" />
        </button>
        <button class="bk-icon danger" type="button" title="移出组卷车" @click="removeResource(row)">
          <AppIcon name="close" :size="14" />
        </button>
      </div>
    </div>

    <p v-else-if="basket.count.value === 0" class="bk-subempty">还没有题目，去「试题」等页签点「加入组卷车」</p>

    <div v-else class="bk-list">
      <div class="bk-batch">
        <label class="bk-check-all" title="全选 / 取消全选">
          <input type="checkbox" :checked="allChecked" @change="toggleAll" />
          已选 {{ checked.length }} 题
        </label>
        <span class="bk-tip">拖左侧手柄可调整题序</span>
      </div>

      <section v-for="section in built.sections" :key="section.id" class="bk-section">
        <h4 class="bk-section-title">
          {{ section.title }}
          <span>{{ section.questions.length }} 题 ·
            {{ section.questions.reduce((sum, q) => sum + (Number(q.score) || 0), 0) }} 分</span>
        </h4>

        <div
          v-for="item in section.questions"
          :key="item.questionId"
          class="bk-item"
          :class="{ 'drop-target': dropId === item.questionId, dragging: draggingId === item.questionId }"
          draggable="true"
          @dragstart="onDragStart(item.questionId, $event)"
          @dragend="endDrag"
          @dragover="onDragOver(item.questionId, $event)"
          @drop="onDrop(item.questionId, $event)"
        >
          <div class="bk-item-row">
            <button
              class="bk-drag"
              type="button"
              aria-label="按住拖动调整题序"
              title="按住拖动调整顺序"
              @mousedown="armDrag"
              @mouseup="endDrag"
            >
              <AppIcon name="menu" :size="13" />
            </button>
            <input
              class="bk-check"
              type="checkbox"
              :checked="checked.includes(item.questionId)"
              @change="toggleCheck(item.questionId)"
            />
            <span class="bk-id">#{{ item.questionId }}</span>
            <span class="bk-type">{{ questionOf(item.questionId)?.type ?? '题目缺失' }}</span>

            <input
              class="bk-score"
              type="number"
              :min="MIN_SCORE"
              :max="MAX_SCORE"
              step="0.5"
              :value="scoreDraft(item.questionId, item.score)"
              @input="setDraft(item.questionId, ($event.target as HTMLInputElement).value)"
              @blur="commitScore(item.questionId, scoreDraft(item.questionId, item.score))"
              @keydown.enter="($event.target as HTMLInputElement).blur()"
            />
            <span class="bk-unit">分</span>

            <button class="bk-icon" type="button" title="查看题干" @click="toggleExpand(item.questionId)">
              <AppIcon :name="expanded === item.questionId ? 'chevron-down' : 'chevron-right'" :size="13" />
            </button>
            <button class="bk-icon danger" type="button" title="移出组卷车" @click="removeQuestion(item.questionId)">
              <AppIcon name="close" :size="13" />
            </button>
          </div>

          <p v-if="expanded === item.questionId" class="bk-detail">
            <span class="bk-source">{{ SOURCE_TEXT[basket.entries.value.find((e) => e.questionId === item.questionId)?.source ?? 'pool'] }}</span>
            {{ questionOf(item.questionId)?.knowledge.join('、') || '未标注知识点' }}
          </p>
        </div>
      </section>
    </div>

    <template #footer>
      <div class="bk-foot">
        <!-- 试题段：排序 + 批量设分；资源段没有分值概念，换成「清空本类」 -->
        <div v-if="tab === 'questions' && basket.count.value" class="bk-sort">
          <select class="bk-select" @change="applySort(($event.target as HTMLSelectElement).value as SortMode)">
            <option value="">调整题序…</option>
            <option value="added">按加入顺序</option>
            <option value="type">客观题在前</option>
            <option value="difficulty">由易到难</option>
            <option value="score">分值由高到低</option>
          </select>
          <input v-model="batchScore" class="bk-batch-score" type="number" :min="MIN_SCORE" :max="MAX_SCORE" step="0.5" placeholder="分值" />
          <button class="mini-btn" type="button" :disabled="checked.length === 0" @click="applyBatchScore">批量设分</button>
        </div>
        <div v-else-if="tab !== 'questions'" class="bk-sort">
          <span class="bk-res-count">共 {{ resourceRows.length }} 个{{ activeKindText }}</span>
          <button
            class="mini-btn"
            type="button"
            :disabled="!resourceRows.length"
            @click="basket.clearResources(activeKind ?? undefined)"
          >
            清空本类
          </button>
        </div>

        <!-- 合计始终按「卷面」算：资源不计分，所以这两行不随页签变化 -->
        <div class="bk-sum">
          <span>{{ basket.count.value }} 题</span>
          <span>共 <b>{{ totalScore }}</b> 分</span>
          <span>客观题 {{ objectiveScore }} 分</span>
          <span v-if="basket.resourceTotal.value" class="bk-sum-res">另附 {{ basket.resourceTotal.value }} 个资源</span>
        </div>
        <div class="bk-ops">
          <button class="btn btn-ghost btn-sm" type="button" :disabled="!basket.count.value" @click="resetScoreAll">恢复默认分</button>
          <button class="btn btn-ghost btn-sm" type="button" :disabled="!basket.totalCount.value" @click="basket.clear()">清空</button>
          <button class="btn btn-primary" type="button" :disabled="!basket.count.value" @click="emit('compose')">
            <AppIcon name="file" :size="15" />
            生成试卷
          </button>
        </div>
      </div>
    </template>

    <!-- 资源预览：与媒体页签同一套呈现（有字节直接播，无字节的存量记录给占位说明）。
         层级跟着抽屉走 +10：抽屉被调用方抬到 310 时，这个弹窗要压在它上面 -->

    <AppModal
      v-if="previewResource"
      :title="previewResource.name"
      :width="640"
      :z-index="zIndex + 10"
      @close="previewResource = null"
    >
      <div v-if="previewResource.kind === 'image' && previewResource.url" class="bk-stage">
        <img :src="resolveMediaSrc(previewResource.url)" :alt="previewResource.name" />
      </div>
      <div v-else-if="previewResource.kind === 'video' && previewResource.url" class="bk-stage">
        <video :src="resolveMediaSrc(previewResource.url)" controls autoplay />
      </div>
      <div v-else class="bk-stage placeholder">
        <AppIcon :name="KIND_ICON[previewResource.kind]" :size="52" />
        <p>{{ KIND_TEXT[previewResource.kind] }}预览占位</p>
        <p class="f-hint">{{ previewResource.sizeMb.toFixed(1) }} MB · 随试卷保存为参考资料</p>
      </div>
    </AppModal>
  </AppDrawer>
</template>

<style scoped>
/* 外壳（遮罩 / 滑出 / 头尾布局）由共享 AppDrawer 提供，这里只剩内容自身的样式 */

.bk-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: none;
  color: var(--sub);
  padding: 3px;
  border-radius: 6px;
}
.bk-icon:hover { color: var(--brand-deep); background: var(--brand-soft); }
.bk-icon.danger:hover { color: var(--danger); background: var(--danger-soft); }

.bk-warn {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
  padding: 7px 10px;
  border-radius: 8px;
  background: var(--warn-soft);
  color: var(--warn);
  font-size: 11.5px;
}
.bk-warn.dup span { line-height: 1.6; }
.bk-warn.dup b { color: var(--ink); }

.bk-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--sub);
  font-size: 13px;
  padding: 72px 24px;
  text-align: center;
}

/* 页签撑满抽屉宽度、四段等分：抽屉固定 420px，等分比左对齐一簇更稳，
   计数涨到三位数也不会把「小程序」挤成两行 */
.bk-tabs { display: flex; width: 100%; margin-bottom: 14px; }
.bk-tabs :deep(.seg-btn) { flex: 1; padding: 7px 4px; }

.bk-list { display: flex; flex-direction: column; gap: 14px; }

/* ===== 资源段（图片 / 视频 / 小程序）===== */
.bk-res { display: flex; flex-direction: column; }
.bk-res-row {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 0;
  border-bottom: 1px dashed #eef1f7;
  font-size: 12px;
}
.bk-res-row:last-child { border-bottom: none; }
.bk-res-thumb {
  width: 42px;
  height: 30px;
  flex-shrink: 0;
  border-radius: 6px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #eef4fb 0%, #e6f7f5 100%);
  color: var(--brand);
}
.bk-res-thumb.kind-image { background: linear-gradient(135deg, #fdf3ea 0%, #fdece2 100%); color: #d0821f; }
.bk-res-thumb.kind-animation { background: linear-gradient(135deg, #f0eefb 0%, #e9e6fa 100%); color: #6b5bd2; }
.bk-res-thumb img { width: 100%; height: 100%; object-fit: cover; }
.bk-res-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.bk-res-name { font-weight: 600; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bk-res-meta { font-size: 11px; color: var(--sub); }
.bk-res-count { flex: 1; font-size: 12px; color: var(--sub); }

/* 某个页签暂时没有条目（比如刚把该类资源清空）时的就地提示，比整抽屉空态轻 */
.bk-subempty { padding: 46px 12px; text-align: center; font-size: 12.5px; color: var(--sub); }

.bk-stage {
  border-radius: 10px;
  overflow: hidden;
  background: #f4f7fb;
  display: flex;
  align-items: center;
  justify-content: center;
}
.bk-stage img, .bk-stage video { max-width: 100%; max-height: 62vh; display: block; }
.bk-stage.placeholder {
  flex-direction: column;
  gap: 8px;
  padding: 42px 0;
  color: var(--sub);
  font-size: 13px;
}

.bk-batch {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  color: var(--sub);
  padding-bottom: 2px;
}
.bk-check-all { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; user-select: none; }
.bk-check-all input, .bk-check { accent-color: var(--brand); }
.bk-tip { margin-left: auto; opacity: 0.8; }

.bk-section-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ink);
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 7px;
}
.bk-section-title span { margin-left: auto; font-size: 11px; font-weight: 400; color: var(--sub); }

.bk-item { padding: 6px 0; border-bottom: 1px dashed #eef1f7; border-top: 2px solid transparent; }
.bk-item:last-child { border-bottom: none; }
.bk-item.dragging { opacity: 0.45; }
/* 插入位置提示：一道细线，比整块高亮更能说明「会插到这里」 */
.bk-item.drop-target { border-top-color: var(--brand); }

.bk-item-row { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.bk-drag {
  display: flex;
  align-items: center;
  border: none;
  background: none;
  color: #c3cad8;
  cursor: grab;
  padding: 2px;
  border-radius: 5px;
}
.bk-drag:hover { color: var(--brand-deep); background: var(--brand-soft); }
.bk-drag:active { cursor: grabbing; }
.bk-id { font-weight: 700; color: var(--sub); }
.bk-type { color: var(--ink-2); }
.bk-score {
  width: 58px;
  margin-left: auto;
  border: 1px solid var(--border);
  border-radius: 7px;
  height: 26px;
  padding: 0 6px;
  font-size: 12px;
  text-align: right;
}
.bk-score:focus { border-color: var(--brand); outline: none; }
.bk-unit { color: var(--sub); font-size: 11.5px; }

.bk-detail { margin-top: 5px; font-size: 11.5px; color: var(--sub); display: flex; gap: 6px; align-items: baseline; }
.bk-source {
  flex-shrink: 0;
  font-size: 10.5px;
  color: var(--brand-deep);
  background: var(--brand-soft);
  border-radius: 4px;
  padding: 1px 6px;
}

/* 抽屉 footer 槽的内部布局（外边距 / 上边线由 AppDrawer 的 .drawer-foot 提供） */
.bk-foot { width: 100%; display: flex; flex-direction: column; gap: 10px; }
.bk-sort { display: flex; align-items: center; gap: 6px; }
.bk-select {
  flex: 1;
  min-width: 0;
  height: 28px;
  border: 1px solid var(--border);
  border-radius: 7px;
  font-size: 12px;
  color: var(--ink-2);
  padding: 0 6px;
  background: #fff;
}
.bk-select:focus { border-color: var(--brand); outline: none; }
.bk-batch-score {
  width: 62px;
  height: 28px;
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 0 6px;
  font-size: 12px;
  text-align: right;
}
.bk-batch-score:focus { border-color: var(--brand); outline: none; }
/* 允许换行：多了「另附 N 个资源」这一段后，420px 抽屉里不一定摆得下 */
.bk-sum { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12px; color: var(--sub); }
.bk-sum b { color: var(--brand-deep); font-size: 15px; }
.bk-sum-res { color: var(--brand-deep); }
.bk-ops { display: flex; gap: 6px; }
.bk-ops .btn { display: inline-flex; align-items: center; gap: 5px; }
.bk-ops .btn-primary { flex: 1; justify-content: center; }
</style>
