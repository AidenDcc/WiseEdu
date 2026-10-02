<script setup lang="ts">
/**
 * 试卷分析与学情反馈（考后链路第二环）。
 *
 * 一次考试对应一份分析：顶部选考试即重算。所有图表都用纯 CSS 横向条——
 * 项目没装图表库，且这类「分数段 / 得分率」本就是单维比例，柱状条比引第三方更轻。
 * 区分度 < 0.2、得分率 < 50% / < 60% 等教研常用阈值直接标红，让老师一眼看到薄弱点。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { AppIcon, AppPageHeader, type ExamSession, type PaperAnalysis, showToast, AppModal } from '@aiteach/shared'
import { fetchExamSessions, fetchPaperAnalysis } from '@/api/org'
import { useBaseData } from '@/composables/useBaseData'

const { ensure } = useBaseData()

const sessions = ref<ExamSession[]>([])
const sessionId = ref<number>(0)
const analysis = ref<PaperAnalysis | null>(null)
const loading = ref(true)
/** 小题分析表按得分率排序方向：null 表示原始顺序 */
const scoreRateSort = ref<null | 'asc' | 'desc'>(null)

const selectedSession = computed(() => sessions.value.find((row) => row.id === sessionId.value) ?? null)

const sortedQuestions = computed(() => {
  const list = [...(analysis.value?.questions ?? [])]
  if (scoreRateSort.value === 'asc') list.sort((a, b) => a.scoreRate - b.scoreRate)
  else if (scoreRateSort.value === 'desc') list.sort((a, b) => b.scoreRate - a.scoreRate)
  return list
})

/** 知识点得分率升序（最薄弱的排最前） */
const knowledgeSorted = computed(() =>
  [...(analysis.value?.knowledge ?? [])].sort((a, b) => a.scoreRate - b.scoreRate),
)

const overviewCards = computed(() => {
  const a = analysis.value
  if (!a) return []
  return [
    { label: '参考人数', value: String(a.studentCount), hint: `${a.grade} · ${a.subject}` },
    { label: '平均分', value: a.avg.toFixed(1), hint: `满分 ${a.fullScore}` },
    { label: '最高 / 最低', value: `${a.max} / ${a.min}`, hint: '分' },
    { label: '中位数', value: a.median.toFixed(1), hint: '分' },
    { label: '标准差', value: a.stdDev.toFixed(2), hint: '离散程度' },
    { label: '及格率', value: `${a.passRate.toFixed(1)}%`, hint: '≥ 满分的 60%' },
    { label: '优秀率', value: `${a.excellentRate.toFixed(1)}%`, hint: '≥ 满分的 85%' },
    { label: '难度系数', value: a.difficulty.toFixed(2), hint: '越大越易' },
    {
      label: '区分度',
      value: a.discrimination.toFixed(2),
      hint: a.discrimination < 0.2 ? '偏低' : '正常',
      danger: a.discrimination < 0.2,
    },
  ]
})

/** 分数段占比：以参考人数为分母，避免空考试除零 */
function bandPercent(count: number) {
  const total = analysis.value?.studentCount ?? 0
  return total ? Math.round((count / total) * 100) : 0
}

async function loadSessions() {
  sessions.value = await fetchExamSessions()
  if (!sessionId.value && sessions.value.length) sessionId.value = sessions.value[0].id
  if (sessionId.value) await loadAnalysis()
}

async function loadAnalysis() {
  if (!sessionId.value) {
    analysis.value = null
    return
  }
  loading.value = true
  try {
    analysis.value = await fetchPaperAnalysis(sessionId.value)
  } catch (error) {
    showToast(error instanceof Error ? error.message : '分析失败', 'error')
  } finally {
    loading.value = false
  }
}

watch(sessionId, () => {
  scoreRateSort.value = null
  void loadAnalysis()
})

/* ================= 导出 / 打印 ================= */

function buildText() {
  const a = analysis.value
  if (!a) return ''
  const lines: string[] = []
  lines.push(`试卷分析报告：${a.paperName}`)
  lines.push(`学科/年级：${a.subject} ${a.grade}　参考人数：${a.studentCount}　满分：${a.fullScore}`)
  lines.push('')
  lines.push('【总体指标】')
  lines.push(`平均分 ${a.avg.toFixed(1)}　最高 ${a.max}　最低 ${a.min}　中位数 ${a.median.toFixed(1)}　标准差 ${a.stdDev.toFixed(2)}`)
  lines.push(`及格率 ${a.passRate.toFixed(1)}%　优秀率 ${a.excellentRate.toFixed(1)}%　难度系数 ${a.difficulty.toFixed(2)}　区分度 ${a.discrimination.toFixed(2)}`)
  lines.push('')
  lines.push('【分数段分布】')
  a.bands.forEach((b) => lines.push(`得分率 ${b.label}%：${b.count} 人，占比 ${bandPercent(b.count)}%`))
  lines.push('')
  lines.push('【小题分析】')
  lines.push('题号,题型,知识点,满分,平均分,得分率,难度,区分度,正确率')
  a.questions.forEach((q) =>
    lines.push(
      `${q.qIndex},${q.type},${q.knowledge.join('/')},${q.full},${q.avg.toFixed(1)},${(q.scoreRate * 100).toFixed(1)}%,${q.difficulty.toFixed(2)},${q.discrimination.toFixed(2)},${(q.correctRate * 100).toFixed(1)}%`,
    ),
  )
  lines.push('')
  lines.push('【知识点得分率】')
  knowledgeSorted.value.forEach((k) => lines.push(`${k.name}：${(k.scoreRate * 100).toFixed(1)}%（${k.count} 题）`))
  lines.push('')
  lines.push('【班级对比】')
  a.classes.forEach((c) =>
    lines.push(`${c.name}：${c.count} 人，平均 ${c.avg.toFixed(1)}，及格率 ${c.passRate.toFixed(1)}%，优秀率 ${c.excellentRate.toFixed(1)}%`),
  )
  lines.push('')
  lines.push('【讲评建议】')
  a.suggestions.forEach((s) => lines.push(`- ${s}`))
  return lines.join('\n')
}

function onExport() {
  const text = buildText()
  if (!text) return
  // Blob + a.download 纯前端导出，不引第三方库
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `试卷分析_${analysis.value?.paperName ?? ''}.txt`
  a.click()
  URL.revokeObjectURL(url)
  showToast('已导出分析报告（.txt）', 'success')
}

function onPrint() {
  window.print()
}

onMounted(async () => {
  try {
    await ensure()
    await loadSessions()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '载入失败', 'error')
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="page">
    <AppPageHeader desc="考后自动生成得分率、区分度、知识点与班级对比，支撑讲评与补弱。">
      <template #actions>
        <button class="btn btn-ghost" :disabled="!analysis" @click="onExport"><AppIcon name="download" :size="15" /> 导出分析报告</button>
        <button class="btn btn-ghost" :disabled="!analysis" @click="onPrint"><AppIcon name="print" :size="15" /> 打印</button>
      </template>
    </AppPageHeader>

    <div class="panel an-pick">
      <span class="filter-label">选择考试</span>
      <select v-model.number="sessionId" class="f-select">
        <option v-for="s in sessions" :key="s.id" :value="s.id">
          {{ s.name }}（{{ s.subject }} {{ s.grade }} · {{ s.examAt }}）
        </option>
      </select>
      <span v-if="selectedSession" class="f-hint">
        {{ selectedSession.classes.join('、') }} · {{ selectedSession.studentCount }} 人 · {{ selectedSession.status === 'finished' ? '已结束' : '阅卷中' }}
      </span>
    </div>

    <p v-if="loading" class="panel empty-row">正在分析…</p>
    <p v-else-if="!analysis" class="panel empty-row">请选择一次考试查看分析</p>

    <template v-else>
      <!-- 概览卡片 -->
      <div class="an-cards">
        <div v-for="card in overviewCards" :key="card.label" class="an-card panel" :class="{ danger: card.danger }">
          <span class="an-card-label">{{ card.label }}</span>
          <b class="an-card-value">{{ card.value }}</b>
          <span class="an-card-hint">{{ card.hint }}</span>
        </div>
      </div>

      <!-- 分数段分布 -->
      <div class="panel an-block">
        <div class="section-title" style="margin-bottom: 12px"><AppIcon name="chart" :size="14" /> 分数段分布（按得分率 %）</div>
        <div v-for="b in analysis.bands" :key="b.label" class="an-band">
          <span class="an-band-label">{{ b.label }}</span>
          <div class="an-band-bar">
            <i :style="{ width: `${bandPercent(b.count)}%` }" />
          </div>
          <span class="an-band-num">{{ b.count }} 人 · {{ bandPercent(b.count) }}%</span>
        </div>
      </div>

      <!-- 小题分析表 -->
      <div class="panel an-block">
        <div class="an-block-head">
          <div class="section-title"><AppIcon name="target" :size="14" /> 小题分析</div>
          <button class="mini-btn" @click="scoreRateSort = scoreRateSort === 'asc' ? 'desc' : scoreRateSort === 'desc' ? null : 'asc'">
            按得分率排序{{ scoreRateSort === 'asc' ? '↑' : scoreRateSort === 'desc' ? '↓' : '' }}
          </button>
        </div>
        <div class="data-table-wrap">
          <table class="data-table an-q-table">
            <thead>
              <tr>
                <th>题号</th>
                <th>题型</th>
                <th>知识点</th>
                <th>满分</th>
                <th>平均分</th>
                <th>得分率</th>
                <th>难度</th>
                <th>区分度</th>
                <th>正确率</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="q in sortedQuestions" :key="q.questionId" :class="{ danger: q.scoreRate < 0.5 }">
                <td class="cell-strong">{{ q.qIndex }}</td>
                <td>{{ q.type }}</td>
                <td class="an-know">{{ q.knowledge.join('/') }}</td>
                <td>{{ q.full }}</td>
                <td>{{ q.avg.toFixed(1) }}</td>
                <td>
                  <div class="an-rate">
                    <div class="mini-bar"><i :style="{ width: `${Math.round(q.scoreRate * 100)}%` }" /></div>
                    {{ (q.scoreRate * 100).toFixed(0) }}%
                  </div>
                </td>
                <td>{{ q.difficulty.toFixed(2) }}</td>
                <td :class="{ 'cell-danger': q.discrimination < 0.2 }">{{ q.discrimination.toFixed(2) }}</td>
                <td>{{ (q.correctRate * 100).toFixed(0) }}%</td>
              </tr>
              <tr v-if="!sortedQuestions.length">
                <td colspan="9" class="empty-row">暂无小题数据</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="f-hint" style="margin-top: 8px">得分率 &lt; 50% 的行标红，区分度 &lt; 0.2 的题区分度标红（偏低）。</p>
      </div>

      <!-- 知识点得分率 -->
      <div class="panel an-block">
        <div class="section-title" style="margin-bottom: 12px"><AppIcon name="layers" :size="14" /> 知识点得分率（升序）</div>
        <div v-for="k in knowledgeSorted" :key="k.name" class="an-krow">
          <span class="an-kname">{{ k.name }}<em>{{ k.count }} 题</em></span>
          <div class="an-kbar">
            <i :class="{ danger: k.scoreRate < 0.6 }" :style="{ width: `${Math.round(k.scoreRate * 100)}%` }" />
          </div>
          <span class="an-knum" :class="{ 'cell-danger': k.scoreRate < 0.6 }">{{ (k.scoreRate * 100).toFixed(0) }}%</span>
        </div>
      </div>

      <!-- 班级对比 -->
      <div class="panel an-block">
        <div class="section-title" style="margin-bottom: 12px"><AppIcon name="users" :size="14" /> 班级对比</div>
        <div class="data-table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>班级</th>
                <th>人数</th>
                <th>平均分</th>
                <th>及格率</th>
                <th>优秀率</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in analysis.classes" :key="c.name">
                <td class="cell-strong">{{ c.name }}</td>
                <td>{{ c.count }}</td>
                <td>{{ c.avg.toFixed(1) }}</td>
                <td>{{ c.passRate.toFixed(1) }}%</td>
                <td>{{ c.excellentRate.toFixed(1) }}%</td>
              </tr>
              <tr v-if="!analysis.classes.length">
                <td colspan="5" class="empty-row">暂无班级数据</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 讲评建议 -->
      <div class="panel an-block">
        <div class="section-title" style="margin-bottom: 10px"><AppIcon name="message" :size="14" /> 讲评建议</div>
        <ul class="an-sug">
          <li v-for="(s, i) in analysis.suggestions" :key="i">
            <AppIcon name="flag" :size="14" /> <span>{{ s }}</span>
          </li>
          <p v-if="!analysis.suggestions.length" class="f-hint">暂无讲评建议。</p>
        </ul>
      </div>
    </template>
  </div>
</template>

<style scoped>
.an-pick { display: flex; align-items: center; gap: 10px; padding: 12px 16px; }
.an-pick .f-select { width: auto; min-width: 280px; flex-shrink: 0; height: var(--ctrl-h); }

.an-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.an-card { padding: 14px 16px; display: flex; flex-direction: column; gap: 4px; }
.an-card.danger { border-color: var(--danger); background: var(--danger-soft); }
.an-card-label { font-size: 12px; color: var(--sub); }
.an-card-value { font-size: 22px; font-weight: 700; color: var(--ink); }
.an-card.danger .an-card-value { color: var(--danger); }
.an-card-hint { font-size: 11.5px; color: var(--sub); }

.an-block { padding: 16px; }
.an-block-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px; }

/* 分数段 */
.an-band { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.an-band-label { width: 60px; flex-shrink: 0; font-size: 12.5px; color: var(--ink-2); }
.an-band-bar { flex: 1; height: 14px; background: #f1f3f9; border-radius: 7px; overflow: hidden; }
.an-band-bar > i { display: block; height: 100%; background: var(--brand-grad); border-radius: 7px; }
.an-band-num { width: 110px; flex-shrink: 0; text-align: right; font-size: 12px; color: var(--sub); }

/* 表格 */
.an-know { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cell-danger { color: var(--danger); font-weight: 600; }
/* 得分率 < 50% 的行标红（含 hover 态，避免被全局 hover 底色盖掉） */
.an-q-table tbody tr.danger,
.an-q-table tbody tr.danger:hover { background: var(--danger-soft); }
.an-rate { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.mini-bar { width: 56px; height: 8px; background: #f1f3f9; border-radius: 5px; overflow: hidden; flex-shrink: 0; }
.mini-bar > i { display: block; height: 100%; background: var(--brand); border-radius: 5px; }

/* 知识点 */
.an-krow { display: flex; align-items: center; gap: 10px; margin-bottom: 9px; }
.an-kname { width: 130px; flex-shrink: 0; font-size: 12.5px; color: var(--ink-2); }
.an-kname em { font-style: normal; color: var(--sub); font-size: 11px; margin-left: 4px; }
.an-kbar { flex: 1; height: 14px; background: #f1f3f9; border-radius: 7px; overflow: hidden; }
.an-kbar > i { display: block; height: 100%; background: var(--brand); border-radius: 7px; }
.an-kbar > i.danger { background: var(--danger); }
.an-knum { width: 48px; flex-shrink: 0; text-align: right; font-size: 12.5px; color: var(--ink-2); }
.an-knum.cell-danger { color: var(--danger); font-weight: 600; }

/* 讲评建议 */
.an-sug { list-style: none; display: flex; flex-direction: column; gap: 8px; }
.an-sug li { display: flex; align-items: flex-start; gap: 8px; font-size: 13px; color: var(--ink-2); line-height: 1.6; }
.an-sug li :deep(svg) { color: var(--brand-deep); flex-shrink: 0; margin-top: 3px; }
</style>
