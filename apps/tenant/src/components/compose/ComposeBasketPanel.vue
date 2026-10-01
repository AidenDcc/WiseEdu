<script setup lang="ts">
/**
 * 组卷车抽屉：按大题分组预览、拖拽排序、逐题/批量改分、重复题提醒，底部给「生成试卷」。
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
 */
import { computed, nextTick, ref } from 'vue'
import type { OrgQuestion } from '@aiteach/shared'
import { AppIcon, showToast } from '@aiteach/shared'
import { useComposeData } from '@/composables/useComposeData'
import { useComposeBasket, type BasketEntry } from '@/composables/useComposeBasket'
import { duplicatePairs } from '@/utils/question-match'
import { difficultyRank } from '@/views/paper/compose/blueprint'
import { MAX_SECTIONS, defaultScore, objectiveScoreOfSections, scoreOfSections } from '@/views/paper/paper-sections'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; compose: [] }>()

const { questions, questionOf } = useComposeData()
const basket = useComposeBasket()

const built = computed(() => basket.toSections(questions.value))
const totalScore = computed(() => scoreOfSections(built.value.sections))
const objectiveScore = computed(() => objectiveScoreOfSections(built.value.sections, questions.value))

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
  <aside class="basket" :class="{ open }">
    <header class="bk-head">
      <h3>
        组卷车
        <span v-if="basket.count.value" class="bk-badge">{{ basket.count.value }}</span>
      </h3>
      <button class="bk-icon" type="button" title="关闭" @click="emit('close')">
        <AppIcon name="close" :size="16" />
      </button>
    </header>

    <div v-if="built.missing.length" class="bk-warn">
      <AppIcon name="warning" :size="14" />
      {{ built.missing.length }} 道题在题库中已不存在（编号 {{ built.missing.join('、') }}），生成试卷时会跳过
    </div>
    <div v-if="built.overflow" class="bk-warn">
      <AppIcon name="warning" :size="14" />
      已超过 {{ MAX_SECTIONS }} 个大题上限，{{ built.overflow }} 道题并入最后一个大题
    </div>
    <div v-if="duplicates.length" class="bk-warn dup">
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

    <div v-if="basket.count.value === 0" class="bk-empty">
      <AppIcon name="cart" :size="34" />
      <p>组卷车还是空的</p>
      <p class="f-hint">在「试题 / 知识点组卷 / 同步练习组卷 / 细目表组卷」里点「加入组卷车」，或整卷引用一份现成试卷。</p>
    </div>

    <div v-else class="bk-body">
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
            <button class="bk-icon danger" type="button" title="移出组卷车" @click="basket.remove(item.questionId)">
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

    <footer class="bk-foot">
      <div v-if="basket.count.value" class="bk-sort">
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

      <div class="bk-sum">
        <span>{{ basket.count.value }} 题</span>
        <span>共 <b>{{ totalScore }}</b> 分</span>
        <span>客观题 {{ objectiveScore }} 分</span>
      </div>
      <div class="bk-ops">
        <button class="btn btn-ghost btn-sm" type="button" :disabled="!basket.count.value" @click="resetScoreAll">恢复默认分</button>
        <button class="btn btn-ghost btn-sm" type="button" :disabled="!basket.count.value" @click="basket.clear()">清空</button>
        <button class="btn btn-primary" type="button" :disabled="!basket.count.value" @click="emit('compose')">
          <AppIcon name="file" :size="15" />
          生成试卷
        </button>
      </div>
    </footer>
  </aside>
</template>

<style scoped>
.basket {
  position: fixed;
  right: 0;
  top: 0;
  bottom: 0;
  width: 372px;
  max-width: 92vw;
  background: #fff;
  border-left: 1px solid var(--border);
  box-shadow: -6px 0 26px rgba(28, 36, 52, 0.08);
  display: flex;
  flex-direction: column;
  transform: translateX(100%);
  transition: transform 0.22s ease;
  z-index: 60;
}
.basket.open { transform: translateX(0); }

.bk-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
}
.bk-head h3 { font-size: 15px; font-weight: 700; color: var(--ink); display: flex; align-items: center; gap: 7px; }
.bk-badge {
  font-size: 11.5px;
  font-weight: 600;
  color: #fff;
  background: var(--brand-grad);
  border-radius: 999px;
  padding: 1px 8px;
}
.bk-head .bk-icon { margin-left: auto; }

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
  margin: 10px 14px 0;
  padding: 7px 10px;
  border-radius: 8px;
  background: var(--warn-soft);
  color: var(--warn);
  font-size: 11.5px;
}
.bk-warn.dup span { line-height: 1.6; }
.bk-warn.dup b { color: var(--ink); }

.bk-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--sub);
  font-size: 13px;
  padding: 0 32px;
  text-align: center;
}

.bk-body { flex: 1; overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 14px; }

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

.bk-foot { border-top: 1px solid var(--border); padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 10px; }
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
.bk-sum { display: flex; gap: 14px; font-size: 12px; color: var(--sub); }
.bk-sum b { color: var(--brand-deep); font-size: 15px; }
.bk-ops { display: flex; gap: 6px; }
.bk-ops .btn { display: inline-flex; align-items: center; gap: 5px; }
.bk-ops .btn-primary { flex: 1; justify-content: center; }
</style>
