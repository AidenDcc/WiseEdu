<script setup lang="ts">
/**
 * 错题本与错题重练（考后链路第三环）。
 *
 * 错题本是「班级维度」的共性薄弱点汇总：来源是阅卷/作业里答错的题，按班级归集。
 * 多选错题可一键生成重练题单（buildMistakeDrill 已含举一反三同知识点题），
 * 生成后直接跳到组卷或作业去落地，形成「错→练→巩固」闭环。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  AppIcon,
  type MistakeEntry,
  type MistakeMastery,
  MISTAKE_MASTERY_TEXT,
  MISTAKE_REASONS,
  type OrgQuestion,
  RichTextViewer,
  showToast,
  truncateRich,
} from '@aiteach/shared'
import AppModal from '@/components/ui/AppModal.vue'
import AppDrawer from '@/components/ui/AppDrawer.vue'
import AppPagination from '@/components/ui/AppPagination.vue'
import {
  buildMistakeDrill,
  deleteMistake,
  fetchMistakeScopes,
  fetchMistakes,
  fetchQuestions,
  fetchSimilarQuestions,
  saveMistake,
  setMistakeMastery,
} from '@/api/org'
import { useBaseData } from '@/composables/useBaseData'

const router = useRouter()
const { difficulties, ensure } = useBaseData()

const mistakes = ref<MistakeEntry[]>([])
const scopes = ref<string[]>([])
const questionMap = ref<Record<number, OrgQuestion>>({})
const loading = ref(true)
const busy = ref(false)

/* ================= 筛选 ================= */

const filter = reactive({ scope: '', mastery: '', reason: '', keyword: '' })
const page = ref(1)
const pageSize = 9

const filtered = computed(() =>
  mistakes.value.filter(
    (row) =>
      (!filter.scope || row.scope === filter.scope) &&
      (!filter.mastery || row.mastery === filter.mastery) &&
      (!filter.reason || row.reason === filter.reason) &&
      (!filter.keyword || (questionMap.value[row.questionId]?.stem ?? '').includes(filter.keyword)),
  ),
)
const paged = computed(() => filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize))

function masteryTagClass(m: MistakeMastery) {
  return m === 'mastered' ? 'tag-green' : m === 'improving' ? 'tag-blue' : 'tag-red'
}

/* ================= 多选 + 重练 ================= */

const selectedIds = ref<Set<number>>(new Set())
const drillResult = ref<{ name: string; questionIds: number[] } | null>(null)

function toggleSelect(id: number) {
  const next = new Set(selectedIds.value)
  next.has(id) ? next.delete(id) : next.add(id)
  selectedIds.value = next
}
function isSelected(id: number) {
  return selectedIds.value.has(id)
}
watch(filtered, () => {
  // 筛选变化后清掉已不可见的选中项，避免悬浮条计数失真
  const visible = new Set(filtered.value.map((row) => row.id))
  selectedIds.value = new Set([...selectedIds.value].filter((id) => visible.has(id)))
})

async function generateDrill() {
  if (!selectedIds.value.size) {
    showToast('请先勾选要重练的错题', 'error')
    return
  }
  busy.value = true
  try {
    // withSimilar=true：后端自动并入同知识点同题型的举一反三题
    const result = await buildMistakeDrill([...selectedIds.value], true)
    drillResult.value = result
    showToast(`已生成重练题单，共 ${result.questionIds.length} 题`, 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '生成失败', 'error')
  } finally {
    busy.value = false
  }
}

function printMistakes() {
  window.print()
}

/* ================= 行操作 ================= */

async function markMastered(row: MistakeEntry) {
  try {
    const updated = await setMistakeMastery(row.id, 'mastered')
    Object.assign(row, updated)
    showToast('已标记为已掌握', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '操作失败', 'error')
  }
}

async function removeMistake(row: MistakeEntry) {
  if (!window.confirm(`将《${questionMap.value[row.questionId]?.stem ? truncateRich(questionMap.value[row.questionId].stem, 20) : '该题'}》移出错题本？`)) return
  await deleteMistake(row.id)
  await loadList()
  showToast('已移除', 'success')
}

/* ================= 详情抽屉 ================= */

const detailOpen = ref(false)
const current = ref<MistakeEntry | null>(null)
const similar = ref<OrgQuestion[]>([])
const noteDraft = ref('')

function openDetail(row: MistakeEntry) {
  current.value = row
  noteDraft.value = row.note
  detailOpen.value = true
  // 举一反三：同知识点同题型的相似题，抽屉打开即拉
  fetchSimilarQuestions(row.id).then((list) => (similar.value = list))
}

async function saveNote() {
  if (!current.value) return
  busy.value = true
  try {
    const updated = await saveMistake({
      id: current.value.id,
      questionId: current.value.questionId,
      scope: current.value.scope,
      note: noteDraft.value.trim(),
    })
    Object.assign(current.value, updated)
    showToast('笔记已保存', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '保存失败', 'error')
  } finally {
    busy.value = false
  }
}

function addSimilarToDrill() {
  if (!current.value) return
  toggleSelect(current.value.id)
  showToast('已将本题加入重练清单', 'success')
}

/* ================= 手动添加错题 ================= */

const addOpen = ref(false)
const bank = ref<OrgQuestion[]>([])
const bankFilter = reactive({ type: '', difficulty: '', keyword: '' })
const addForm = reactive({ questionId: 0, scope: '', reason: '' })

const bankPool = computed(() =>
  bank.value.filter(
    (row) =>
      (!bankFilter.type || row.type === bankFilter.type) &&
      (!bankFilter.difficulty || row.difficulty === bankFilter.difficulty) &&
      (!bankFilter.keyword || row.stem.includes(bankFilter.keyword)),
  ),
)

function openAdd() {
  addForm.questionId = 0
  addForm.scope = scopes.value[0] ?? ''
  addForm.reason = String(MISTAKE_REASONS[0])
  addOpen.value = true
}

async function submitAdd() {
  if (!addForm.questionId) {
    showToast('请选择一道题', 'error')
    return
  }
  if (!addForm.scope) {
    showToast('请选择归属班级', 'error')
    return
  }
  busy.value = true
  try {
    await saveMistake({ questionId: addForm.questionId, scope: addForm.scope, reason: addForm.reason })
    addOpen.value = false
    await loadList()
    showToast('已加入班级错题本', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '添加失败', 'error')
  } finally {
    busy.value = false
  }
}

/* ================= 数据 ================= */

async function loadList() {
  const [list, scopeList, questions] = await Promise.all([
    fetchMistakes(filter.scope || undefined),
    fetchMistakeScopes(),
    fetchQuestions(),
  ])
  mistakes.value = list
  scopes.value = scopeList
  questionMap.value = Object.fromEntries(questions.map((q) => [q.id, q]))
  bank.value = questions
}

onMounted(async () => {
  loading.value = true
  try {
    await ensure()
    await loadList()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '载入失败', 'error')
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="mk-page">
    <div class="page-head">
      <div>
        <h2 style="font-size: 18px; font-weight: 700">错题本</h2>
        <p class="f-hint" style="margin-top: 4px">按班级归集共性薄弱点，多选可一键生成重练题单并跳到组卷 / 作业。</p>
      </div>
      <div class="op-group">
        <button class="btn btn-primary" @click="openAdd"><AppIcon name="plus" :size="15" /> 手动添加错题</button>
      </div>
    </div>

    <div class="panel">
      <div class="filter-bar">
        <span class="filter-label">班级</span>
        <select v-model="filter.scope" class="f-select" style="width: 130px">
          <option value="">全部班级</option>
          <option v-for="s in scopes" :key="s" :value="s">{{ s }}</option>
        </select>
        <span class="filter-label">掌握度</span>
        <select v-model="filter.mastery" class="f-select" style="width: 120px">
          <option value="">全部</option>
          <option v-for="(text, m) in MISTAKE_MASTERY_TEXT" :key="m" :value="m">{{ text }}</option>
        </select>
        <span class="filter-label">错误原因</span>
        <select v-model="filter.reason" class="f-select" style="width: 130px">
          <option value="">全部</option>
          <option v-for="r in MISTAKE_REASONS" :key="r" :value="r">{{ r }}</option>
        </select>
        <input v-model="filter.keyword" class="f-input" placeholder="搜索题干" style="width: 190px" />
      </div>

      <div class="mk-grid">
        <p v-if="!paged.length" class="f-hint" style="padding: 30px; text-align: center; grid-column: 1 / -1">
          {{ loading ? '正在载入…' : '暂无错题，去阅卷或作业里积累吧' }}
        </p>
        <div v-for="row in paged" :key="row.id" class="mk-card" :class="{ on: isSelected(row.id) }">
          <label class="mk-check"><input :checked="isSelected(row.id)" type="checkbox" @change="toggleSelect(row.id)" /></label>
          <p class="mk-stem">{{ questionMap[row.questionId] ? truncateRich(questionMap[row.questionId].stem, 70) : '（题干缺失）' }}</p>
          <div class="mk-tags">
            <span v-if="questionMap[row.questionId]" class="tag tag-gray">{{ questionMap[row.questionId].type }}</span>
            <span v-if="questionMap[row.questionId]" class="tag tag-gray">{{ questionMap[row.questionId].difficulty }}</span>
            <span v-for="k in questionMap[row.questionId]?.knowledge.slice(0, 2)" :key="k" class="tag tag-gray">{{ k }}</span>
            <span class="tag" :class="masteryTagClass(row.mastery)">{{ MISTAKE_MASTERY_TEXT[row.mastery] }}</span>
          </div>
          <p class="mk-meta">错误 {{ row.wrongCount }} 人 · 原因：{{ row.reason }} · 重练 {{ row.practiced }} 次 · 来源：{{ row.source }}</p>
          <div class="op-group">
            <button class="mini-btn" @click="openDetail(row)">查看详情</button>
            <button class="mini-btn" @click="openDetail(row)">举一反三</button>
            <button class="mini-btn success" @click="markMastered(row)">标记掌握</button>
            <button class="mini-btn danger" @click="removeMistake(row)">移除</button>
          </div>
        </div>
      </div>
      <AppPagination :total="filtered.length" v-model:page="page" :page-size="pageSize" />
    </div>

    <!-- 多选浮动条 -->
    <div v-if="selectedIds.size" class="mk-float">
      <span class="f-hint">已选 {{ selectedIds.size }} 道错题</span>
      <div class="op-group">
        <button class="btn btn-ghost btn-sm" @click="selectedIds = new Set()">清空</button>
        <button class="btn btn-ghost btn-sm" @click="printMistakes"><AppIcon name="print" :size="14" /> 打印错题集</button>
        <button class="btn btn-primary btn-sm" :disabled="busy" @click="generateDrill"><AppIcon name="sparkles" :size="14" /> 生成错题重练</button>
      </div>
    </div>

    <!-- 详情抽屉 -->
    <AppDrawer
      v-if="current"
      :title="questionMap[current.questionId] ? truncateRich(questionMap[current.questionId].stem, 24) : '错题详情'"
      :subtitle="`${current.scope} · 错误 ${current.wrongCount} 人 · 重练 ${current.practiced} 次`"
      :width="640"
      @close="detailOpen = false"
    >
      <div v-if="questionMap[current.questionId]" class="mk-detail">
        <div class="section-title" style="margin-bottom: 8px">原题</div>
        <RichTextViewer :content="questionMap[current.questionId].stem" />
        <ul v-if="questionMap[current.questionId].options.length" class="mk-opts">
          <li v-for="(opt, oi) in questionMap[current.questionId].options" :key="oi">
            <b>{{ 'ABCDEF'[oi] }}．</b><RichTextViewer :content="opt" tag="span" />
          </li>
        </ul>
        <p class="mk-line"><b>参考答案：</b><RichTextViewer :content="questionMap[current.questionId].answer" tag="span" /></p>
        <p class="mk-line"><b>解析：</b><RichTextViewer :content="questionMap[current.questionId].analysis" tag="span" /></p>

        <div class="mk-fault">
          <p><b>我的错答：</b>{{ current.wrongAnswer || '—' }}</p>
          <p><b>错误原因：</b>{{ current.reason }}</p>
        </div>

        <div class="f-field" style="margin-top: 12px">
          <label class="f-label">订正笔记</label>
          <textarea v-model="noteDraft" class="f-textarea" placeholder="记录错因与突破口，巩固时回看" />
          <button class="mini-btn" style="align-self: flex-start; margin-top: 6px" :disabled="busy" @click="saveNote">保存笔记</button>
        </div>

        <div class="section-title" style="margin: 14px 0 8px">举一反三（同知识点同题型）</div>
        <div v-if="!similar.length" class="f-hint">暂无相似题。</div>
        <div v-for="q in similar" :key="q.id" class="mk-sim">
          <span class="tag tag-gray">{{ q.type }}</span>
          <span class="mk-sim-stem">{{ truncateRich(q.stem, 60) }}</span>
          <button class="mini-btn" @click="addSimilarToDrill">加入重练</button>
        </div>
      </div>
    </AppDrawer>

    <!-- 重练结果 -->
    <AppModal v-if="drillResult" title="错题重练题单已生成" :width="520" @close="drillResult = null">
      <p class="f-hint" style="margin-bottom: 12px">
        题单《{{ drillResult.name }}》共 {{ drillResult.questionIds.length }} 题（已含举一反三）。可前往组卷或布置作业落地。
      </p>
      <div class="op-group" style="justify-content: flex-end; gap: 8px">
        <button class="btn btn-ghost" @click="drillResult = null">稍后处理</button>
        <button class="btn btn-ghost" @click="router.push('/paper/compose')"><AppIcon name="layers" :size="14" /> 去组卷</button>
        <button class="btn btn-primary" @click="router.push('/homework')"><AppIcon name="clipboard" :size="14" /> 布置作业</button>
      </div>
    </AppModal>

    <!-- 手动添加 -->
    <AppModal v-if="addOpen" title="从题库添加错题" :width="640" @close="addOpen = false">
      <div class="f-field row3">
        <div>
          <label class="f-label">归属班级</label>
          <select v-model="addForm.scope" class="f-select">
            <option v-for="s in scopes" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
        <div>
          <label class="f-label">错误原因</label>
          <select v-model="addForm.reason" class="f-select">
            <option v-for="r in MISTAKE_REASONS" :key="r" :value="r">{{ r }}</option>
          </select>
        </div>
      </div>
      <div class="mk-add-filter">
        <select v-model="bankFilter.type" class="f-select" style="width: 120px">
          <option value="">全部题型</option>
          <option v-for="t in ['单选题', '多选题', '判断题', '填空题', '解答题']" :key="t" :value="t">{{ t }}</option>
        </select>
        <select v-model="bankFilter.difficulty" class="f-select" style="width: 110px">
          <option value="">全部难度</option>
          <option v-for="d in difficulties" :key="d" :value="d">{{ d }}</option>
        </select>
        <input v-model="bankFilter.keyword" class="f-input" placeholder="搜索题干" />
      </div>
      <div class="mk-add-list">
        <div
          v-for="q in bankPool"
          :key="q.id"
          class="mk-add-card"
          :class="{ on: addForm.questionId === q.id }"
          @click="addForm.questionId = q.id"
        >
          <span class="tag tag-gray">{{ q.type }}</span>
          <span class="mk-add-stem">{{ truncateRich(q.stem, 56) }}</span>
        </div>
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="addOpen = false">取消</button>
        <button class="btn btn-primary" :disabled="busy" @click="submitAdd">加入错题本</button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.mk-page { display: flex; flex-direction: column; gap: 12px; padding-bottom: 60px; }
.mk-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; padding: 16px; }
.mk-card {
  position: relative; border: 1.5px solid var(--border); border-radius: 12px; padding: 14px;
  display: flex; flex-direction: column; gap: 8px;
}
.mk-card:hover { border-color: var(--brand); box-shadow: var(--shadow); }
.mk-card.on { border-color: var(--brand); background: var(--brand-soft); }
.mk-check { position: absolute; top: 12px; right: 12px; }
.mk-check input { accent-color: var(--brand); width: 16px; height: 16px; }
.mk-stem { font-size: 13px; color: var(--ink); line-height: 1.6; padding-right: 22px; }
.mk-tags { display: flex; flex-wrap: wrap; gap: 5px; }
.mk-meta { font-size: 11.5px; color: var(--sub); }

/* 浮动条 */
.mk-float {
  position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
  display: flex; align-items: center; gap: 14px;
  background: #fff; border: 1px solid var(--border); border-radius: 14px;
  box-shadow: var(--shadow-lg); padding: 10px 16px; z-index: 50;
}

/* 详情 */
.mk-detail { display: flex; flex-direction: column; }
.mk-opts { list-style: none; display: flex; flex-direction: column; gap: 4px; margin: 8px 0; }
.mk-opts li { font-size: 13px; color: var(--ink-2); line-height: 1.6; }
.mk-line { font-size: 13px; color: var(--ink-2); line-height: 1.6; margin-top: 6px; }
.mk-line :deep(.rt) { display: inline; }
.mk-fault {
  margin-top: 10px; padding: 10px 12px; border-radius: 10px;
  background: var(--danger-soft); color: var(--danger); font-size: 12.5px; line-height: 1.7;
}
.mk-fault b { color: var(--danger); }
.mk-sim {
  display: flex; align-items: center; gap: 8px; border: 1px solid var(--border);
  border-radius: 9px; padding: 8px 10px; margin-bottom: 6px; background: #fbfdfd;
}
.mk-sim-stem { flex: 1; min-width: 0; font-size: 12.5px; color: var(--ink-2); }

/* 手动添加 */
.mk-add-filter { display: flex; gap: 8px; margin-bottom: 10px; }
.mk-add-list { max-height: 320px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--border); padding-top: 10px; }
.mk-add-card {
  display: flex; align-items: center; gap: 8px; border: 1.5px solid var(--border);
  border-radius: 10px; padding: 9px 11px; cursor: pointer;
}
.mk-add-card:hover { border-color: var(--brand); }
.mk-add-card.on { border-color: var(--brand); background: var(--brand-soft); }
.mk-add-stem { flex: 1; min-width: 0; font-size: 12.5px; color: var(--ink-2); }
.row3 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
</style>
