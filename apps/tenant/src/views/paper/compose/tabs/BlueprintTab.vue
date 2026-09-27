<script setup lang="ts">
/**
 * 细目表组卷页签：先定「知识点 × 题型」的配额，再让系统按格抽题。
 *
 * 与其它页签的思路相反——试题页签是「先搜到题、再决定要不要」，细目表是「先决定要什么、
 * 再去找题」。后者才是出一套覆盖均匀的正式考卷的方式：教师真正关心的是「函数要不要考、
 * 考几道、几分」，而不是从 200 道题里人工挑 12 道。
 *
 * 配额矩阵本身是页面状态（不是组卷车），因为它是一次组卷的**设计稿**，可能反复调整
 * 多次才抽到满意；故存 localStorage，切页签、刷新都还在。抽中结果最终靠「并入组卷车」
 * 交棒给组卷车，与手动选题殊途同归——后面的生成试卷、预览、导出完全不用知道题是怎么来的。
 */
import { computed, ref, watch } from 'vue'
import type { OrgQuestion } from '@aiteach/shared'
import { AppIcon, RichTextViewer, showToast } from '@aiteach/shared'
import { useComposeData } from '@/composables/useComposeData'
import { useComposeBasket } from '@/composables/useComposeBasket'
import { useBaseData } from '@/composables/useBaseData'
import AppDrawer from '@/components/ui/AppDrawer.vue'
import { defaultScore } from '@/views/paper/paper-sections'
import {
  availableKnowledges,
  blueprintEntries,
  blueprintStats,
  candidatesFor,
  cellKey,
  cellOf,
  clearPicked,
  emptyBlueprint,
  ensureCell,
  fillBlueprint,
  pruneCells,
  usedIds,
  type Blueprint,
  type BlueprintCell,
} from '../blueprint'
import type { ComposeFilter } from '../types'

const props = defineProps<{ filter: ComposeFilter }>()

const { questions, questionOf, ensure } = useComposeData()
const { questionTypes, difficulties } = useBaseData()
const basket = useComposeBasket()

void ensure()

/* ===== 配额矩阵的持久化 ===== */

const STORAGE_KEY = 'aiteach.compose-blueprint'

function load(): Blueprint {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyBlueprint()
    const parsed = JSON.parse(raw) as Blueprint
    /* 结构防御：手改坏的存档不该让整个页签白屏，退回空表 */
    if (!parsed || !Array.isArray(parsed.knowledges) || !Array.isArray(parsed.types)) return emptyBlueprint()
    return { knowledges: parsed.knowledges, types: parsed.types, cells: parsed.cells ?? {} }
  } catch {
    return emptyBlueprint()
  }
}

const bp = ref<Blueprint>(load())

watch(
  bp,
  (value) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
    } catch {
      /* 存不下不影响本次组卷，只是刷新后配置会丢 */
    }
  },
  { deep: true },
)

/* ===== 题池：跟随筛选条的年级学科，但不受知识点/题型/关键词限制 ===== */

const pool = computed(() =>
  questions.value.filter((row) => {
    if (row.status !== 'approved') return false
    if (props.filter.subject && row.subject !== props.filter.subject) return false
    if (props.filter.grade && row.grade !== props.filter.grade) return false
    return true
  }),
)

/** 可加入的知识点（题库里真有题的，按题数降序），已加入的不再出现 */
const knowledgeOptions = computed(() =>
  availableKnowledges(pool.value).filter((row) => !bp.value.knowledges.includes(row.name)),
)
const typeOptions = computed(() => questionTypes.value.filter((type) => !bp.value.types.includes(type)))

const stats = computed(() => blueprintStats(bp.value))
const used = computed(() => usedIds(bp.value))

/* ===== 行列增删 ===== */

function addKnowledge(name: string) {
  if (!name || bp.value.knowledges.includes(name)) return
  bp.value.knowledges.push(name)
  /* 新行要给每列都建格子，否则表格里会出现空格子点不动 */
  bp.value.types.forEach((type) => ensureCell(bp.value, name, type))
}
function removeKnowledge(name: string) {
  bp.value.knowledges = bp.value.knowledges.filter((row) => row !== name)
  pruneCells(bp.value)
}
function addType(type: string) {
  if (!type || bp.value.types.includes(type)) return
  bp.value.types.push(type)
  bp.value.knowledges.forEach((knowledge) => ensureCell(bp.value, knowledge, type))
}
function removeType(type: string) {
  bp.value.types = bp.value.types.filter((row) => row !== type)
  pruneCells(bp.value)
}

/** 行或列刚加进来时格子已由 add* 建好；这里兜底一个**不写回状态**的默认格，
 *  仅供模板渲染使用——若在模板里调 ensureCell 会在渲染过程中改状态，触发重渲染死循环。 */
function cellAt(knowledge: string, type: string): BlueprintCell {
  return (
    cellOf(bp.value, knowledge, type) ?? { knowledge, type, count: 0, score: defaultScore(type), picked: [] }
  )
}

/** 下拉选完即清空，否则同一个知识点连续加两次会「选不动」（value 没变不触发 change） */
function onAddKnowledge(event: Event) {
  const select = event.target as HTMLSelectElement
  addKnowledge(select.value)
  select.value = ''
}
function onAddType(event: Event) {
  const select = event.target as HTMLSelectElement
  addType(select.value)
  select.value = ''
}

/** 一键铺开：把当前筛选里的知识点与全部题型建成行列，省得一个个点 */
function seedFromFilter() {
  if (props.filter.knowledge.length) props.filter.knowledge.forEach((tag) => addKnowledge(tag))
  questionTypes.value.slice(0, 5).forEach((type) => addType(type))
  if (!bp.value.knowledges.length) showToast('先在左侧知识点树或筛选里选择知识点', 'error')
}

/* ===== 抽题 ===== */

const targetDifficulty = ref('')

function runFill() {
  if (!bp.value.knowledges.length || !bp.value.types.length) {
    showToast('先添加至少一个知识点与一种题型', 'error')
    return
  }
  if (stats.value.plannedCount === 0) {
    showToast('还没有填任何格子的题数', 'error')
    return
  }
  const result = fillBlueprint(bp.value, pool.value, targetDifficulty.value || '中等')
  if (result.added === 0 && !result.shortages.length) {
    showToast('各格已按配额抽满，无需补充')
    return
  }
  if (result.shortages.length) {
    const first = result.shortages[0]
    const rest = result.shortages.length > 1 ? ` 等 ${result.shortages.length} 个格子` : ''
    showToast(`已抽 ${result.added} 题；「${first.knowledge}·${first.type}」题库不足，还差 ${first.short} 题${rest}`, 'error')
    return
  }
  showToast(`已抽 ${result.added} 题`)
}

function resetPicked() {
  clearPicked(bp.value)
  showToast('已清空抽题结果（配额保留）')
}

function resetAll() {
  bp.value = emptyBlueprint()
  showToast('已重置细目表')
}

/* ===== 并入组卷车 ===== */

function pushToBasket() {
  const entries = blueprintEntries(bp.value)
  if (!entries.length) {
    showToast('还没有抽中任何题目', 'error')
    return
  }
  let added = 0
  let skipped = 0
  entries.forEach((entry) => {
    const row = questionOf(entry.questionId)
    if (!row) return
    if (basket.has(entry.questionId)) {
      skipped += 1
      return
    }
    basket.add(row, 'blueprint', undefined, entry.score)
    added += 1
  })
  if (!added) {
    showToast('这些题目都已在组卷车中', 'error')
    return
  }
  showToast(skipped ? `已并入 ${added} 题，${skipped} 题已在车中` : `已并入 ${added} 题到组卷车`)
}

/* ===== 单格查看 / 换题 ===== */

const activeKey = ref<string | null>(null)
const activeCell = computed<BlueprintCell | null>(() =>
  activeKey.value ? (bp.value.cells[activeKey.value] ?? null) : null,
)

function openCell(knowledge: string, type: string) {
  /* 点格子即建：题数还是 0 也要能进去看这一格题库里有什么 */
  ensureCell(bp.value, knowledge, type)
  activeKey.value = cellKey(knowledge, type)
}

/** 本格候选题：已被别的格子占用的排后面（由 UI 标注，不直接隐藏，避免「明明有题却选不了」） */
const cellCandidates = computed<OrgQuestion[]>(() => (activeCell.value ? candidatesFor(activeCell.value, pool.value) : []))

function inThisCell(questionId: number): boolean {
  return activeCell.value?.picked.includes(questionId) ?? false
}
function usedElsewhere(questionId: number): boolean {
  return used.value.has(questionId) && !inThisCell(questionId)
}

function takeInto(questionId: number) {
  const cell = activeCell.value
  if (!cell) return
  if (inThisCell(questionId)) return
  /* 配额满了就顶掉最后一题：比「先移除再加」少一步操作，且结果可预期 */
  if (cell.picked.length >= Math.max(cell.count, 1)) cell.picked.pop()
  cell.picked.push(questionId)
}

function dropFrom(questionId: number) {
  const cell = activeCell.value
  if (!cell) return
  cell.picked = cell.picked.filter((id) => id !== questionId)
}

/** 换一题：从本格候选题里取一个还没被占用的，顶掉指定位置 */
function swapAt(questionId: number) {
  const cell = activeCell.value
  if (!cell) return
  const next = cellCandidates.value.find(
    (row) => !inThisCell(row.id) && !usedElsewhere(row.id) && row.id !== questionId,
  )
  if (!next) {
    showToast('该知识点 · 题型下没有更多可换的题目', 'error')
    return
  }
  const index = cell.picked.indexOf(questionId)
  if (index >= 0) cell.picked[index] = next.id
  else takeInto(next.id)
}

function setCount(cell: BlueprintCell, raw: string) {
  const value = Math.max(0, Math.floor(Number(raw) || 0))
  cell.count = Math.min(99, value)
  /* 题数调小了要裁掉多出来的题，否则「配额 2 题却抽了 5 题」，统计与出卷都会对不上 */
  if (cell.picked.length > cell.count) cell.picked = cell.picked.slice(0, cell.count)
}

function setScore(cell: BlueprintCell, raw: string) {
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0.5 || value > 100) return
  cell.score = Math.round(value * 2) / 2
}

/** 单元格状态：满 / 部分 / 空 / 未配题 */
function cellState(cell: BlueprintCell): 'full' | 'partial' | 'empty' | 'idle' {
  if (!cell || cell.count <= 0) return 'idle'
  if (cell.picked.length >= cell.count) return 'full'
  return cell.picked.length > 0 ? 'partial' : 'empty'
}
</script>

<template>
  <div class="bp">
    <div class="bp-bar panel">
      <div class="bp-bar-row">
        <span class="bp-bar-title">双向细目表</span>

        <select class="bp-add" :value="''" @change="onAddKnowledge($event)">
          <option value="">+ 知识点行</option>
          <option v-for="row in knowledgeOptions" :key="row.name" :value="row.name">{{ row.name }}（{{ row.count }}）</option>
        </select>

        <select class="bp-add" :value="''" @change="onAddType($event)">
          <option value="">+ 题型列</option>
          <option v-for="type in typeOptions" :key="type" :value="type">{{ type }}</option>
        </select>

        <select v-model="targetDifficulty" class="bp-add" title="自动抽题时优先贴近的难度">
          <option value="">难度：默认中等</option>
          <option v-for="item in difficulties" :key="item" :value="item">难度：{{ item }}</option>
        </select>

        <button class="btn btn-ghost btn-sm" type="button" @click="seedFromFilter">按筛选铺开</button>
      </div>

      <div class="bp-bar-row">
        <span class="bp-stat">
          计划 <b>{{ stats.plannedCount }}</b> 题 · <b>{{ stats.plannedScore }}</b> 分
        </span>
        <span class="bp-stat" :class="{ ok: stats.filledCells === stats.plannedCells && stats.plannedCells > 0 }">
          已抽 <b>{{ stats.pickedCount }}</b> 题 · <b>{{ stats.pickedScore }}</b> 分
        </span>
        <span class="bp-stat">格子 {{ stats.filledCells }}/{{ stats.plannedCells }}</span>

        <div class="bp-bar-ops">
          <button class="btn btn-ghost btn-sm" type="button" @click="resetPicked">清空结果</button>
          <button class="btn btn-ghost btn-sm" type="button" @click="resetAll">重置</button>
          <button class="btn btn-primary btn-sm" type="button" @click="runFill">
            <AppIcon name="sparkles" :size="14" />
            自动抽题
          </button>
          <button class="btn btn-primary btn-sm" type="button" :disabled="stats.pickedCount === 0" @click="pushToBasket">
            <AppIcon name="cart" :size="14" />
            并入组卷车
          </button>
        </div>
      </div>
    </div>

    <section class="bp-panel panel">
      <p v-if="!bp.knowledges.length || !bp.types.length" class="empty-row">
        还没有行列。用上方「+ 知识点行」「+ 题型列」搭一张表，然后往格子里填「题数 × 分值」，再点「自动抽题」。
      </p>

      <div v-else class="bp-table-wrap">
        <table class="bp-table">
          <thead>
            <tr>
              <th class="bp-th-kp">知识点</th>
              <th v-for="type in bp.types" :key="type" class="bp-th">
                {{ type }}
                <button class="bp-x" type="button" title="删除该题型列" @click="removeType(type)">
                  <AppIcon name="close" :size="11" />
                </button>
              </th>
              <th class="bp-th-ops">合计</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="knowledge in bp.knowledges" :key="knowledge">
              <th class="bp-th-kp">
                <span class="bp-kp-name">{{ knowledge }}</span>
                <button class="bp-x" type="button" title="删除该知识点行" @click="removeKnowledge(knowledge)">
                  <AppIcon name="close" :size="11" />
                </button>
              </th>
              <td
                v-for="type in bp.types"
                :key="type"
                class="bp-cell"
                :class="cellState(cellAt(knowledge, type))"
              >
                <div class="bp-cell-inputs">
                  <input
                    class="bp-num"
                    type="number"
                    min="0"
                    max="99"
                    :value="cellAt(knowledge, type).count"
                    title="题数"
                    @change="setCount(ensureCell(bp, knowledge, type), ($event.target as HTMLInputElement).value)"
                  />
                  <span class="bp-times">题 ×</span>
                  <input
                    class="bp-num"
                    type="number"
                    min="0.5"
                    max="100"
                    step="0.5"
                    :value="cellAt(knowledge, type).score"
                    title="单题分值"
                    @change="setScore(ensureCell(bp, knowledge, type), ($event.target as HTMLInputElement).value)"
                  />
                  <span class="bp-times">分</span>
                </div>
                <button class="bp-cell-btn" type="button" @click="openCell(knowledge, type)">
                  <span class="bp-progress">
                    {{ cellAt(knowledge, type).picked.length }}/{{ cellAt(knowledge, type).count }}
                  </span>
                  选题
                </button>
              </td>
              <td class="bp-cell-sum">
                {{ bp.types.reduce((sum, type) => sum + cellAt(knowledge, type).picked.length, 0) }} 题
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <AppDrawer
      v-if="activeCell"
      :title="`${activeCell.knowledge} · ${activeCell.type}`"
      :subtitle="`配额 ${activeCell.count} 题 · 每题 ${activeCell.score} 分 · 已选 ${activeCell.picked.length} 题`"
      :width="720"
      @close="activeKey = null"
    >
      <div class="bp-drawer">
        <h4 class="bp-d-title">已选入本格</h4>
        <p v-if="!activeCell.picked.length" class="empty-row">还没有选题，从下方候选题里点「选用」</p>
        <div v-for="id in activeCell.picked" :key="id" class="bp-d-item">
          <div class="bp-d-head">
            <span class="tag tag-blue">#{{ id }}</span>
            <span class="tag tag-gray">{{ questionOf(id)?.difficulty }}</span>
            <span class="bp-d-kp">{{ questionOf(id)?.knowledge.join('、') }}</span>
            <button class="mini-btn" type="button" @click="swapAt(id)">换一题</button>
            <button class="mini-btn danger" type="button" @click="dropFrom(id)">移除</button>
          </div>
          <RichTextViewer class="bp-d-stem" :content="questionOf(id)?.stem ?? ''" />
        </div>

        <h4 class="bp-d-title">候选题（{{ cellCandidates.length }}）</h4>
        <p v-if="!cellCandidates.length" class="empty-row">题库里没有该知识点 + 题型的已入库题目</p>
        <div
          v-for="row in cellCandidates"
          :key="row.id"
          class="bp-d-item"
          :class="{ taken: inThisCell(row.id), elsewhere: usedElsewhere(row.id) }"
        >
          <div class="bp-d-head">
            <span class="tag tag-blue">#{{ row.id }}</span>
            <span class="tag tag-gray">{{ row.difficulty }}</span>
            <span class="bp-d-kp">{{ row.knowledge.join('、') }}</span>
            <span v-if="usedElsewhere(row.id)" class="tag tag-orange">已被其它格子占用</span>
            <button
              v-if="!inThisCell(row.id)"
              class="mini-btn success"
              type="button"
              :disabled="usedElsewhere(row.id)"
              @click="takeInto(row.id)"
            >
              选用
            </button>
            <span v-else class="bp-d-flag">已选</span>
          </div>
          <RichTextViewer class="bp-d-stem" :content="row.stem" />
        </div>
      </div>
    </AppDrawer>
  </div>
</template>

<style scoped>
.bp { display: flex; flex-direction: column; gap: 12px; min-height: 480px; }

.bp-bar { padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; flex-shrink: 0; }
.bp-bar-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.bp-bar-title { font-size: 14px; font-weight: 700; color: var(--ink); }
.bp-add {
  height: 30px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0 8px;
  font-size: 12.5px;
  color: var(--ink-2);
  background: #fff;
  max-width: 200px;
}
.bp-add:focus { border-color: var(--brand); outline: none; }

.bp-stat { font-size: 12.5px; color: var(--sub); }
.bp-stat b { color: var(--ink); font-size: 14px; }
.bp-stat.ok b { color: var(--success); }
.bp-bar-ops { margin-left: auto; display: flex; gap: 6px; }
.bp-bar-ops .btn { display: inline-flex; align-items: center; gap: 5px; }

.bp-panel { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 12px 14px; overflow: auto; }
.bp-table-wrap { overflow-x: auto; }
.bp-table { border-collapse: separate; border-spacing: 6px; font-size: 12.5px; }

.bp-th {
  font-weight: 700;
  color: var(--ink);
  font-size: 12.5px;
  white-space: nowrap;
  padding: 2px 4px;
}
.bp-th-kp {
  position: sticky;
  left: 0;
  background: #fff;
  text-align: left;
  font-weight: 600;
  color: var(--ink);
  min-width: 132px;
  max-width: 200px;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 6px;
}
.bp-kp-name { overflow: hidden; text-overflow: ellipsis; }
.bp-th-ops { font-weight: 700; color: var(--sub); font-size: 12px; }

.bp-x {
  border: none;
  background: none;
  color: #c3cad8;
  display: flex;
  padding: 1px;
  border-radius: 4px;
}
.bp-x:hover { color: var(--danger); background: var(--danger-soft); }

.bp-cell {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 7px 8px;
  min-width: 158px;
  vertical-align: top;
  background: #fff;
  transition: border-color 0.14s, background 0.14s;
}
/* 四态配色：未配题（灰）/ 空（白）/ 部分（黄）/ 满（绿），一眼看出哪一格还没凑齐 */
.bp-cell.idle { background: #fafbfd; }
.bp-cell.empty { border-color: var(--warn); background: var(--warn-soft); }
.bp-cell.partial { border-color: var(--warn); }
.bp-cell.full { border-color: var(--success); background: var(--success-soft); }

.bp-cell-inputs { display: flex; align-items: center; gap: 4px; }
.bp-num {
  width: 42px;
  height: 26px;
  border: 1px solid var(--border);
  border-radius: 6px;
  text-align: center;
  font-size: 12px;
}
.bp-num:focus { border-color: var(--brand); outline: none; }
.bp-times { font-size: 11px; color: var(--sub); }

.bp-cell-btn {
  margin-top: 6px;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 26px;
  border: 1px dashed var(--border);
  border-radius: 7px;
  background: #fff;
  color: var(--ink-2);
  font-size: 11.5px;
}
.bp-cell-btn:hover { border-color: var(--brand); color: var(--brand-deep); background: var(--brand-soft); }
.bp-progress { font-weight: 700; }

.bp-cell-sum { color: var(--sub); font-size: 12px; white-space: nowrap; }

/* 抽屉 */
.bp-drawer { display: flex; flex-direction: column; gap: 10px; }
.bp-d-title { font-size: 13px; font-weight: 700; color: var(--ink); margin-top: 4px; }
.bp-d-item {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 9px 12px;
}
.bp-d-item.taken { border-color: var(--success); background: var(--success-soft); }
.bp-d-item.elsewhere { opacity: 0.72; }
.bp-d-head { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; margin-bottom: 6px; }
.bp-d-kp { font-size: 11.5px; color: var(--sub); }
.bp-d-head .mini-btn { margin-left: auto; }
.bp-d-head .mini-btn + .mini-btn { margin-left: 0; }
.bp-d-flag { margin-left: auto; font-size: 11.5px; font-weight: 600; color: var(--success); }
.bp-d-stem { font-size: 13px; color: var(--ink); line-height: 1.75; }
</style>
