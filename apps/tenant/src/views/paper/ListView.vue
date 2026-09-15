<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { AppIcon, PAPER_STATUS_TEXT, showToast } from '@aiteach/shared'
import type { OrgPaper, OrgQuestion } from '@aiteach/shared'
import AppModal from '@/components/ui/AppModal.vue'
import AppDrawer from '@/components/ui/AppDrawer.vue'
import AppPagination from '@/components/ui/AppPagination.vue'
import { aiComposePaper, deletePaper, fetchPapers, fetchQuestions, generateParallels, savePaper } from '@/api/org'
import { useBaseData } from '@/composables/useBaseData'

const router = useRouter()

const { subjects, grades, questionTypes, ensure, pick } = useBaseData()

const papers = ref<OrgPaper[]>([])
const questions = ref<OrgQuestion[]>([])

const STATUS_CLASS: Record<string, string> = {
  draft: 'tag-gray',
  aiReview: 'tag-blue',
  pending: 'tag-orange',
  approved: 'tag-green',
  rejected: 'tag-red',
}

/* ===== 筛选 ===== */
const filter = reactive({ status: '', keyword: '' })
const page = ref(1)
const filtered = computed(() =>
  papers.value.filter(
    (row) =>
      (!filter.status || row.status === filter.status) &&
      (!filter.keyword || row.name.includes(filter.keyword)),
  ),
)
const rows = computed(() => filtered.value.slice((page.value - 1) * 10, page.value * 10))

async function load() {
  await ensure()
  aiForm.subject = pick(subjects.value, aiForm.subject)
  aiForm.grade = pick(grades.value, aiForm.grade)
  ;[papers.value, questions.value] = await Promise.all([fetchPapers(), fetchQuestions()])
}

function totalScore(paper: OrgPaper) {
  return paper.sections.reduce((sum, s) => sum + s.questions.reduce((t, q) => t + q.score, 0), 0)
}
function totalCount(paper: OrgPaper) {
  return paper.sections.reduce((sum, s) => sum + s.questions.length, 0)
}
function questionOf(id: number) {
  return questions.value.find((row) => row.id === id)
}

/* ===== 预览 ===== */
const preview = ref<OrgPaper | null>(null)

/* ===== AI 组卷（FR-PP-008/009） ===== */
const aiOpen = ref(false)
const aiForm = reactive({
  name: '',
  subject: '数学',
  grade: '高一',
  structure: [
    { type: '单选题', count: 8, score: 5 },
    { type: '填空题', count: 4, score: 5 },
    { type: '解答题', count: 2, score: 12 },
  ],
})
const aiRunning = ref(false)

async function runAiCompose() {
  if (aiForm.name.trim().length < 2) {
    showToast('请填写试卷名称（2-50 字）', 'error')
    return
  }
  if (aiForm.structure.some((row) => row.count < 1 || row.score <= 0)) {
    showToast('每个大题的题数 ≥1、单题分值 >0', 'error')
    return
  }
  aiRunning.value = true
  try {
    const { paper, aiPicked } = await aiComposePaper({ ...aiForm })
    aiOpen.value = false
    await load()
    showToast(
      aiPicked > 0
        ? `AI 组卷完成：${totalCount(paper)} 题入卷，${aiPicked} 题因题量不足由 AI 新生成补足`
        : `AI 组卷完成：${totalCount(paper)} 题 · ${totalScore(paper)} 分（草稿）`,
      'success',
    )
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'AI 组卷失败', 'error')
  } finally {
    aiRunning.value = false
  }
}

/* ===== 平行卷（FR-PP-015） ===== */
const parallelOpen = ref(false)
const parallelTarget = ref<OrgPaper | null>(null)
const parallelCount = ref(1)

function openParallel(row: OrgPaper) {
  parallelTarget.value = row
  parallelCount.value = 1
  parallelOpen.value = true
}

async function runParallel() {
  if (!parallelTarget.value) return
  const list = await generateParallels(parallelTarget.value.id, parallelCount.value)
  parallelOpen.value = false
  await load()
  showToast(`已生成平行卷：${list.map((row) => row.parallelLabel).join('、')}（草稿）`, 'success')
}

/* ===== 行内操作 ===== */
async function onSubmit(row: OrgPaper) {
  try {
    await savePaper({ id: row.id, name: row.name, submit: true })
    showToast('已提交 AI 九项检测，通过后推送人工审核', 'success')
    load()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '提交失败', 'error')
  }
}

function onExport(row: OrgPaper) {
  showToast(`《${row.name}》导出任务已创建（Word/PDF），稍后到消息中心下载`, 'success')
}

async function onDelete(row: OrgPaper) {
  if (!window.confirm(`删除《${row.name}》？将进入回收站保留 30 天`)) return
  await deletePaper(row.id)
  showToast('已移入回收站', 'success')
  load()
}

onMounted(load)
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h2>试卷库</h2>
      <div class="op-group">
        <button class="btn btn-primary" @click="router.push('/paper/collab')">
          <AppIcon name="plus" :size="15" /> 手动协同组卷
        </button>
        <button class="btn btn-ghost" @click="aiOpen = true">
          <AppIcon name="sparkles" :size="15" /> AI 智能组卷
        </button>
        <button class="btn btn-ghost" @click="showToast('细目表组卷（双向细目表模式）开发中，敬请期待')">
          <AppIcon name="grid" :size="15" /> 细目表组卷
        </button>
      </div>
    </div>

    <div class="panel">
      <div class="filter-bar">
        <span class="filter-label">状态</span>
        <select v-model="filter.status" class="f-select">
          <option value="">全部</option>
          <option v-for="(text, key) in PAPER_STATUS_TEXT" :key="key" :value="key">{{ text }}</option>
        </select>
        <span class="filter-label">关键词</span>
        <input v-model="filter.keyword" class="f-input" placeholder="试卷名称" style="width: 200px" />
      </div>

      <table class="data-table">
        <thead>
          <tr>
            <th>试卷名称</th>
            <th>状态</th>
            <th>结构</th>
            <th>总分</th>
            <th>适用</th>
            <th>创建人</th>
            <th>更新时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="rows.length === 0">
            <td colspan="8" class="empty-row">暂无试卷，点击右上角创建</td>
          </tr>
          <template v-else>
            <tr v-for="row in rows" :key="row.id">
              <td class="cell-strong">
                {{ row.name }}
                <span v-if="row.parallelOf" class="tag tag-blue" style="margin-left: 6px">平行卷</span>
                <span v-if="row.sharedSquare" class="tag tag-gray" style="margin-left: 6px">已共享广场</span>
              </td>
              <td><span class="tag" :class="STATUS_CLASS[row.status]">{{ PAPER_STATUS_TEXT[row.status] }}</span></td>
              <td>{{ totalCount(row) }} 题 / {{ row.sections.length }} 大题</td>
              <td>{{ totalScore(row) }} 分</td>
              <td>{{ row.grade }} · {{ row.duration }} 分钟</td>
              <td>{{ row.owner }}</td>
              <td>{{ row.updatedAt }}</td>
              <td>
                <div class="op-group">
                  <button v-if="row.status === 'draft' || row.status === 'rejected'" class="mini-btn" @click="router.push(`/paper/collab?id=${row.id}`)">编辑</button>
                  <button class="mini-btn" @click="preview = row">预览</button>
                  <button v-if="row.status === 'draft' || row.status === 'rejected'" class="mini-btn success" @click="onSubmit(row)">提交审核</button>
                  <button v-if="row.status === 'approved'" class="mini-btn" @click="openParallel(row)">平行卷</button>
                  <button class="mini-btn" @click="onExport(row)">导出</button>
                  <button class="mini-btn danger" @click="onDelete(row)">删除</button>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
      <AppPagination :total="filtered.length" v-model:page="page" :page-size="10" />
    </div>

    <!-- AI 组卷弹窗 -->
    <AppModal v-if="aiOpen" title="AI 智能组卷" :width="560" @close="aiOpen = false">
      <div class="f-field">
        <label class="f-label">试卷名称<span class="req">*</span>（2-50 字）</label>
        <input v-model="aiForm.name" class="f-input" placeholder="如：高一数学第三章随堂测" />
      </div>
      <div class="f-field row2">
        <div>
          <label class="f-label">学科</label>
          <select v-model="aiForm.subject" class="f-select">
            <option v-for="s in subjects" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
        <div>
          <label class="f-label">年级</label>
          <select v-model="aiForm.grade" class="f-select">
            <option v-for="g in grades" :key="g" :value="g">{{ g }}</option>
          </select>
        </div>
      </div>
      <div class="f-field">
        <label class="f-label">卷面结构（按题型设置题数与单题分值）</label>
        <div v-for="(row, i) in aiForm.structure" :key="i" class="struct-row">
          <select v-model="row.type" class="f-select" style="width: 110px">
            <option v-for="t in questionTypes" :key="t" :value="t">{{ t }}</option>
          </select>
          <input v-model.number="row.count" type="number" min="1" class="f-input" style="width: 84px" />
          <span class="f-hint">题 ×</span>
          <input v-model.number="row.score" type="number" min="0.5" step="0.5" class="f-input" style="width: 84px" />
          <span class="f-hint">分/题</span>
          <button class="mini-btn danger" type="button" :disabled="aiForm.structure.length <= 1" @click="aiForm.structure.splice(i, 1)">删除</button>
        </div>
        <button class="btn btn-ghost btn-sm" type="button" :disabled="aiForm.structure.length >= 8" @click="aiForm.structure.push({ type: '单选题', count: 4, score: 5 })">
          <AppIcon name="plus" :size="14" /> 添加大题
        </button>
        <p class="f-hint">预计总分：{{ aiForm.structure.reduce((s, r) => s + r.count * r.score, 0) }} 分 · AI 优先从已入库题目抽取，不足时智能生成补齐</p>
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="aiOpen = false">取消</button>
        <button class="btn btn-primary" :disabled="aiRunning" @click="runAiCompose">
          {{ aiRunning ? '组卷中…' : '开始组卷（消耗 1 次额度）' }}
        </button>
      </template>
    </AppModal>

    <!-- 平行卷弹窗 -->
    <AppModal v-if="parallelOpen && parallelTarget" title="生成平行卷" :width="460" @close="parallelOpen = false">
      <p style="font-size: 13.5px; color: var(--ink-2); margin-bottom: 12px">
        以《{{ parallelTarget.name }}》为母卷，AI 逐题替换同构题（同知识点 / 题型 / 难度），生成结构一致、难度等值的平行卷。
      </p>
      <div class="f-field">
        <label class="f-label">生成份数（1-5，B 卷起编）</label>
        <input v-model.number="parallelCount" type="number" min="1" max="5" class="f-input" />
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="parallelOpen = false">取消</button>
        <button class="btn btn-primary" @click="runParallel">生成（消耗 {{ parallelCount }} 次额度）</button>
      </template>
    </AppModal>

    <!-- 整卷预览 -->
    <AppDrawer v-if="preview" :title="preview.name" :subtitle="`共 ${totalCount(preview)} 题 · ${totalScore(preview)} 分 · ${preview.duration} 分钟`" :width="620" @close="preview = null">
      <div v-for="section in preview.sections" :key="section.id" class="pv-section">
        <h4>{{ section.title }}（{{ section.questions.reduce((s, q) => s + q.score, 0) }} 分）</h4>
        <div v-for="(q, qi) in section.questions" :key="qi" class="pv-q">
          <p class="pv-q-stem">{{ qi + 1 }}.（{{ q.score }} 分）{{ questionOf(q.questionId)?.stem ?? `题目 #${q.questionId}` }}</p>
          <ul v-if="questionOf(q.questionId)?.options.length" class="pv-q-opts">
            <li v-for="(opt, oi) in questionOf(q.questionId)!.options" :key="oi">{{ 'ABCDEF'[oi] }}. {{ opt }}</li>
          </ul>
        </div>
      </div>
    </AppDrawer>
  </div>
</template>

<style scoped>
.struct-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.pv-section { margin-bottom: 18px; }
.pv-section h4 { font-size: 14px; color: var(--ink); border-left: 3px solid var(--brand); padding-left: 8px; margin-bottom: 10px; }
.pv-q { margin-bottom: 12px; }
.pv-q-stem { font-size: 13.5px; color: var(--ink-2); line-height: 1.7; }
.pv-q-opts { margin-top: 6px; padding-left: 18px; }
.pv-q-opts li { font-size: 13px; color: var(--sub); line-height: 1.8; }
</style>
