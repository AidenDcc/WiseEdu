<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { AppIcon, QUESTION_STATUS_TEXT, RichTextViewer, showToast, truncateRich } from '@aiteach/shared'
import type { OrgQuestion } from '@aiteach/shared'
import { fetchQuestions, reviewQuestion } from '@/api/org'

const all = ref<OrgQuestion[]>([])
const opinion = ref('')
const busy = ref(false)

/** 待人工终审队列（AI 校验完成 → pending；FR-AI-006 / FR-TM-021） */
const pending = computed(() => all.value.filter((row) => row.status === 'pending'))
/** 已审记录（今日） */
const reviewed = computed(() => all.value.filter((row) => row.status === 'approved' || row.status === 'rejected'))

const activeId = ref(0)
const active = computed(() => pending.value.find((row) => row.id === activeId.value) ?? pending.value[0] ?? null)

const passedCount = computed(() => active.value?.aiChecks?.filter((row) => row.pass).length ?? 0)
const suspects = computed(() => active.value?.aiSuspects ?? [])

async function load() {
  all.value = await fetchQuestions()
}

function pick(row: OrgQuestion) {
  activeId.value = row.id
  opinion.value = ''
}

/** 终审通过 / 驳回（FR-TM-022：驳回意见必填 ≥5 字） */
async function decide(pass: boolean) {
  if (!active.value) return
  if (!pass && opinion.value.trim().length < 5) {
    showToast('驳回意见不能少于 5 个字', 'error')
    return
  }
  busy.value = true
  try {
    const updated = await reviewQuestion(active.value.id, pass, opinion.value.trim())
    const pos = all.value.findIndex((row) => row.id === updated.id)
    if (pos >= 0) all.value[pos] = updated
    showToast(pass ? '已通过，题目入机构正式题库' : '已驳回，意见已推送作者', 'success')
    opinion.value = ''
    const next = pending.value[0]
    if (next) activeId.value = next.id
  } catch (error) {
    showToast(error instanceof Error ? error.message : '操作失败', 'error')
  } finally {
    busy.value = false
  }
}

function onTransfer() {
  if (!active.value) return
  showToast(`已转交给审核员「沈丽华」，消息已送达`, 'success')
}

onMounted(load)
</script>

<template>
  <div class="review-layout">
    <!-- 左：待审队列 -->
    <div class="panel queue-panel">
      <div class="section-title">待终审队列（{{ pending.length }}）</div>
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
          <span class="qi-top">
            <span class="tag tag-blue">#{{ row.id }}</span>
            <span class="tag tag-gray">{{ row.type }}</span>
            <span class="tag" :class="row.source === '拍照识别' ? 'tag-orange' : 'tag-gray'">{{ row.source }}</span>
          </span>
          <span class="qi-stem">{{ truncateRich(row.stem, 46) }}…</span>
          <span class="qi-meta">{{ row.owner }} · {{ row.subject }} {{ row.grade }}</span>
        </button>
      </div>
      <div class="section-title" style="margin-top: 14px">已审（{{ reviewed.length }}）</div>
      <div class="queue-list reviewed">
        <span v-for="row in reviewed.slice(0, 8)" :key="row.id" class="rv-chip" :class="row.status">
          #{{ row.id }} {{ QUESTION_STATUS_TEXT[row.status] }}
        </span>
      </div>
    </div>

    <!-- 中：题目预览 -->
    <div class="panel preview-panel">
      <template v-if="active">
        <div class="pv-meta">
          <span class="tag tag-blue">{{ active.subject }} · {{ active.grade }}</span>
          <span class="tag tag-gray">{{ active.type }}</span>
          <span class="tag tag-gray">{{ active.difficulty }}</span>
          <span v-for="k in active.knowledge" :key="k" class="tag tag-gray">{{ k }}</span>
        </div>
        <RichTextViewer class="pv-stem" :content="active.stem" />
        <ul v-if="active.options.length" class="pv-options">
          <li v-for="(opt, i) in active.options" :key="i" :class="{ right: active.answer.includes('ABCDEF'[i]) }">
            {{ 'ABCDEF'[i] }}. <RichTextViewer :content="opt" tag="span" />
          </li>
        </ul>
        <div class="pv-answer"><span class="tag tag-green">答案</span>{{ active.answer }}</div>
        <p class="pv-analysis"><b>解析：</b><RichTextViewer :content="active.analysis" tag="span" /></p>
        <div v-if="active.variantOf" class="pv-variant">
          <AppIcon name="branch" :size="13" /> 变式自母题 #{{ active.variantOf }}
        </div>
        <div v-if="active.sourceRemark" class="pv-variant f-hint">来源备注：{{ active.sourceRemark }}</div>
      </template>
      <p v-else class="f-hint" style="padding: 30px">暂无待审题目</p>
    </div>

    <!-- 右：AI 检测报告 + 终审操作（FR-AI-001 ~ 006） -->
    <div class="panel report-panel">
      <template v-if="active">
        <div class="section-title">
          AI 多智能体检测（{{ passedCount }}/{{ active.aiChecks?.length ?? 0 }} 通过）
          <span class="tag tag-green">自动纠错已应用</span>
        </div>
        <div class="check-list">
          <div v-for="check in active.aiChecks ?? []" :key="check.name" class="check-row">
            <AppIcon :name="check.pass ? 'check' : 'warning'" :size="14" :class="check.pass ? 'ok' : 'bad'" />
            <span class="ck-name">{{ check.name }}</span>
            <span class="ck-note">{{ check.note }}<template v-if="check.fixed">（已自动纠错 → {{ check.fixed }}）</template></span>
          </div>
        </div>

        <div v-if="suspects.length" class="section-title" style="margin-top: 12px">疑点清单</div>
        <div v-for="(item, i) in suspects" :key="i" class="suspect-row">
          <AppIcon name="warning" :size="13" />
          <span>{{ item }}</span>
        </div>

        <div class="section-title" style="margin-top: 14px">终审意见</div>
        <textarea
          v-model="opinion"
          class="f-textarea"
          rows="3"
          :placeholder="active.status === 'rejected' ? active.reviewOpinion : '驳回时必填 ≥5 字；通过时选填'"
        />
        <div class="decide-ops">
          <button class="btn btn-primary" :disabled="busy" @click="decide(true)">
            <AppIcon name="check" :size="15" /> 通过并入库
          </button>
          <button class="btn btn-danger" :disabled="busy" @click="decide(false)">驳回</button>
          <button class="btn btn-ghost" style="margin-left: auto" @click="onTransfer">转交其他审核员</button>
        </div>
      </template>
      <p v-else class="f-hint" style="padding: 30px">选择左侧题目开始终审</p>
    </div>
  </div>
</template>

<style scoped>
.review-layout { display: grid; grid-template-columns: 280px 1fr 360px; gap: 14px; align-items: start; }

.queue-panel { padding: 14px; max-height: calc(100vh - 150px); overflow: auto; }
.queue-list { display: flex; flex-direction: column; gap: 8px; }
.queue-item {
  display: flex; flex-direction: column; gap: 6px; text-align: left;
  border: 1.5px solid var(--border); border-radius: 10px; background: #fff;
  padding: 10px 12px; cursor: pointer; transition: all 0.15s;
}
.queue-item:hover { border-color: var(--brand); }
.queue-item.on { border-color: var(--brand); background: var(--brand-soft); }
.qi-top { display: flex; gap: 6px; }
.qi-stem { font-size: 13px; color: var(--ink); line-height: 1.5; }
.qi-meta { font-size: 11.5px; color: var(--sub); }
.queue-list.reviewed { flex-direction: row; flex-wrap: wrap; }
.rv-chip { font-size: 11.5px; border-radius: 999px; padding: 2px 9px; background: #f2f5f5; color: var(--sub); }
.rv-chip.approved { background: var(--success-soft); color: var(--success); }
.rv-chip.rejected { background: var(--danger-soft); color: var(--danger); }

.preview-panel { padding: 18px 20px; }
.pv-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.pv-stem { font-size: 14.5px; color: var(--ink); line-height: 1.8; margin-bottom: 12px; }
.pv-options { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
.pv-options li { background: #f7fafa; border-radius: 8px; padding: 9px 12px; font-size: 13.5px; color: var(--ink-2); }
.pv-options li.right { border-left: 3px solid var(--success); color: var(--success); font-weight: 600; }
.pv-answer { display: flex; align-items: center; gap: 8px; font-size: 13.5px; font-weight: 600; color: var(--success); margin-bottom: 10px; }
.pv-analysis { font-size: 13px; color: var(--ink-2); line-height: 1.7; }
.pv-variant { display: flex; align-items: center; gap: 6px; margin-top: 10px; font-size: 12.5px; color: var(--brand-deep); }

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
.decide-ops { display: flex; gap: 10px; margin-top: 12px; align-items: center; }
</style>
