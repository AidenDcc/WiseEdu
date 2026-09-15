<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { AppIcon, PAPER_STATUS_TEXT, RichTextViewer, showToast } from '@aiteach/shared'
import type { OrgPaper, OrgQuestion } from '@aiteach/shared'
import { fetchPapers, fetchQuestions, reviewPaper } from '@/api/org'

const papers = ref<OrgPaper[]>([])
const questions = ref<OrgQuestion[]>([])
const opinion = ref('')
const busy = ref(false)

const pending = computed(() => papers.value.filter((row) => row.status === 'pending'))
const reviewed = computed(() => papers.value.filter((row) => row.status === 'approved' || row.status === 'rejected'))

const activeId = ref(0)
const active = computed(() => pending.value.find((row) => row.id === activeId.value) ?? pending.value[0] ?? null)

async function load() {
  ;[papers.value, questions.value] = await Promise.all([fetchPapers(), fetchQuestions()])
}

function pick(row: OrgPaper) {
  activeId.value = row.id
  opinion.value = ''
}

function questionOf(id: number) {
  return questions.value.find((row) => row.id === id)
}
function totalCount(paper: OrgPaper) {
  return paper.sections.reduce((sum, s) => sum + s.questions.length, 0)
}
function totalScore(paper: OrgPaper) {
  return paper.sections.reduce((sum, s) => sum + s.questions.reduce((t, q) => t + q.score, 0), 0)
}
const passedCount = computed(() => active.value?.aiChecks?.filter((row) => row.pass).length ?? 0)

/** 双层审核（FR-PP-012 ~ 014）：AI 九项检测 → 人工终审 */
async function decide(pass: boolean) {
  if (!active.value) return
  if (!pass && opinion.value.trim().length < 5) {
    showToast('驳回意见不能少于 5 个字', 'error')
    return
  }
  busy.value = true
  try {
    const updated = await reviewPaper(active.value.id, pass, opinion.value.trim())
    const pos = papers.value.findIndex((row) => row.id === updated.id)
    if (pos >= 0) papers.value[pos] = updated
    showToast(pass ? '已通过，试卷入机构试卷库' : '已驳回，意见已推送创建人', 'success')
    opinion.value = ''
  } catch (error) {
    showToast(error instanceof Error ? error.message : '操作失败', 'error')
  } finally {
    busy.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="review-layout">
    <!-- 左：待审队列 -->
    <div class="panel queue-panel">
      <div class="section-title">待人工审核（{{ pending.length }}）</div>
      <div class="queue-list">
        <p v-if="pending.length === 0" class="f-hint" style="padding: 12px">队列已清空 🎉</p>
        <button
          v-for="row in pending"
          :key="row.id"
          class="queue-item"
          :class="{ on: active?.id === row.id }"
          type="button"
          @click="pick(row)"
        >
          <span class="qi-stem">《{{ row.name }}》</span>
          <span class="qi-meta">{{ row.owner }} · {{ totalCount(row) }} 题 / {{ totalScore(row) }} 分 · {{ row.updatedAt }}</span>
        </button>
      </div>
      <div class="section-title" style="margin-top: 14px">已审（{{ reviewed.length }}）</div>
      <div class="queue-list reviewed">
        <span v-for="row in reviewed.slice(0, 8)" :key="row.id" class="rv-chip" :class="row.status">
          《{{ row.name.slice(0, 12) }}》{{ PAPER_STATUS_TEXT[row.status] }}
        </span>
      </div>
    </div>

    <!-- 中：整卷预览 -->
    <div class="panel preview-panel">
      <template v-if="active">
        <div class="pv-head">
          <h3>{{ active.name }}</h3>
          <p class="f-hint">
            {{ active.subject }} · {{ active.grade }} · {{ active.duration }} 分钟 · 共 {{ totalCount(active) }} 题 / {{ totalScore(active) }} 分 · 出卷人 {{ active.owner }}
          </p>
        </div>
        <div v-for="section in active.sections" :key="section.id" class="pv-section">
          <h4>{{ section.title }}（{{ section.questions.reduce((s, q) => s + q.score, 0) }} 分）</h4>
          <div v-for="(entry, qi) in section.questions" :key="qi" class="pv-q">
            <p class="pv-q-stem">
              {{ qi + 1 }}.（{{ entry.score }} 分）
              <RichTextViewer v-if="questionOf(entry.questionId)" :content="questionOf(entry.questionId)!.stem" tag="span" />
              <template v-else>题目 #{{ entry.questionId }}</template>
            </p>
            <ul v-if="questionOf(entry.questionId)?.options.length" class="pv-q-opts">
              <li
                v-for="(opt, oi) in questionOf(entry.questionId)!.options"
                :key="oi"
                :class="{ right: questionOf(entry.questionId)!.answer.includes('ABCDEF'[oi]) }"
              >
                {{ 'ABCDEF'[oi] }}. <RichTextViewer :content="opt" tag="span" />
              </li>
            </ul>
            <p v-if="questionOf(entry.questionId)" class="pv-q-ans">
              <span class="tag tag-green">答案</span>{{ questionOf(entry.questionId)!.answer }}
            </p>
          </div>
        </div>
      </template>
      <p v-else class="f-hint" style="padding: 30px">暂无待审试卷</p>
    </div>

    <!-- 右：AI 检测报告 + 终审 -->
    <div class="panel report-panel">
      <template v-if="active">
        <div class="section-title">AI 九项检测（{{ passedCount }}/{{ active.aiChecks?.length ?? 0 }} 通过）</div>
        <div class="check-list">
          <div v-for="check in active.aiChecks ?? []" :key="check.name" class="check-row">
            <AppIcon :name="check.pass ? 'check' : 'warning'" :size="14" :class="check.pass ? 'ok' : 'bad'" />
            <span class="ck-name">{{ check.name }}</span>
            <span class="ck-note">{{ check.note }}<template v-if="check.fixed">（已自动纠错 → {{ check.fixed }}）</template></span>
          </div>
        </div>

        <div v-if="(active.aiSuspects ?? []).length" class="section-title" style="margin-top: 12px">疑点清单</div>
        <div v-for="(item, i) in active.aiSuspects ?? []" :key="i" class="suspect-row">
          <AppIcon name="warning" :size="13" />
          <span>{{ item }}</span>
        </div>

        <div class="section-title" style="margin-top: 14px">审核意见</div>
        <textarea v-model="opinion" class="f-textarea" rows="3" placeholder="驳回时必填 5-500 字；通过时选填" />
        <div class="decide-ops">
          <button class="btn btn-primary" :disabled="busy" @click="decide(true)">
            <AppIcon name="check" :size="15" /> 通过并入库
          </button>
          <button class="btn btn-danger" :disabled="busy" @click="decide(false)">驳回</button>
        </div>
      </template>
      <p v-else class="f-hint" style="padding: 30px">选择左侧试卷开始审核</p>
    </div>
  </div>
</template>

<style scoped>
.review-layout { display: grid; grid-template-columns: 280px 1fr 360px; gap: 14px; align-items: start; }

.queue-panel { padding: 14px; max-height: calc(100vh - 150px); overflow: auto; }
.queue-list { display: flex; flex-direction: column; gap: 8px; }
.queue-item {
  display: flex; flex-direction: column; gap: 5px; text-align: left;
  border: 1.5px solid var(--border); border-radius: 10px; background: #fff;
  padding: 10px 12px; cursor: pointer; transition: all 0.15s;
}
.queue-item:hover { border-color: var(--brand); }
.queue-item.on { border-color: var(--brand); background: var(--brand-soft); }
.qi-stem { font-size: 13px; color: var(--ink); font-weight: 600; }
.qi-meta { font-size: 11.5px; color: var(--sub); }
.queue-list.reviewed { flex-direction: row; flex-wrap: wrap; }
.rv-chip { font-size: 11.5px; border-radius: 999px; padding: 2px 9px; background: #f2f5f5; color: var(--sub); }
.rv-chip.approved { background: var(--success-soft); color: var(--success); }
.rv-chip.rejected { background: var(--danger-soft); color: var(--danger); }

.preview-panel { padding: 18px 20px; }
.pv-head h3 { font-size: 16px; color: var(--ink); margin-bottom: 4px; }
.pv-section { margin-top: 16px; }
.pv-section h4 { font-size: 14px; color: var(--ink); border-left: 3px solid var(--brand); padding-left: 8px; margin-bottom: 10px; }
.pv-q { margin-bottom: 12px; }
.pv-q-stem { font-size: 13.5px; color: var(--ink-2); line-height: 1.7; }
.pv-q-opts { margin-top: 6px; padding-left: 18px; }
.pv-q-opts li { font-size: 13px; color: var(--sub); line-height: 1.8; }
.pv-q-opts li.right { color: var(--success); font-weight: 600; }
.pv-q-ans { display: flex; align-items: center; gap: 8px; margin-top: 4px; font-size: 12.5px; font-weight: 600; color: var(--success); }

.report-panel { padding: 14px 16px; position: sticky; top: 0; }
.check-list { display: flex; flex-direction: column; gap: 8px; }
.check-row { display: flex; align-items: flex-start; gap: 7px; font-size: 12.5px; }
.check-row .ok { color: var(--success); }
.check-row .bad { color: var(--warn); }
.ck-name { font-weight: 600; color: var(--ink-2); flex-shrink: 0; }
.ck-note { color: var(--sub); line-height: 1.5; }
.suspect-row {
  display: flex; align-items: flex-start; gap: 7px; font-size: 12.5px; color: var(--warn);
  background: var(--warn-soft); border-radius: 8px; padding: 7px 10px; margin-bottom: 6px;
}
.decide-ops { display: flex; gap: 10px; margin-top: 12px; }
</style>
