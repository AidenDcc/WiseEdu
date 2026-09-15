<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { AppIcon, RichTextViewer, showToast, toPlainText } from '@aiteach/shared'
import type { AuditRecord, PublicPaper, PublicQuestion } from '@aiteach/shared'
import AppDrawer from '@/components/ui/AppDrawer.vue'
import { fetchAuditRecords, fetchPublicPapers, fetchPublicQuestions } from '@/api/platform'

type TabKey = 'questions' | 'papers' | 'audits'
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'questions', label: '公开题库' },
  { key: 'papers', label: '公开试卷' },
  { key: 'audits', label: '审核记录' },
]

const activeTab = ref<TabKey>('questions')
const questions = ref<PublicQuestion[]>([])
const papers = ref<PublicPaper[]>([])
const audits = ref<AuditRecord[]>([])
const loading = ref(false)

const qKeyword = ref('')
const qSubject = ref('')

async function load() {
  loading.value = true
  try {
    ;[questions.value, papers.value, audits.value] = await Promise.all([
      fetchPublicQuestions(),
      fetchPublicPapers(),
      fetchAuditRecords(),
    ])
  } finally {
    loading.value = false
  }
}

function filteredQuestions() {
  return questions.value.filter(
    (q) =>
      (!qSubject.value || q.subject === qSubject.value) &&
      (!qKeyword.value.trim() || toPlainText(q.stem).includes(qKeyword.value.trim())),
  )
}

function onExport(tab: string) {
  showToast(`已导出${tab}（演示，脱敏口径）`, 'success')
}

/* ===== 详情抽屉 ===== */
const questionOpen = ref<PublicQuestion | null>(null)
const paperOpen = ref<PublicPaper | null>(null)
const auditOpen = ref<AuditRecord | null>(null)

function aiStatusClass(status: string) {
  if (status.includes('通过')) return 'tag-green'
  if (status.includes('修复')) return 'tag-orange'
  return 'tag-gray'
}

onMounted(load)
</script>

<template>
  <div class="panel">
    <!-- 三类资源 Tab（FR-PT-029） -->
    <div class="tab-row">
      <button
        v-for="tab in TABS"
        :key="tab.key"
        class="tab-btn"
        :class="{ active: activeTab === tab.key }"
        type="button"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
      <span class="read-only-hint">
        <AppIcon name="shield" :size="13" /> 平台侧只读，机构名称已脱敏
      </span>
    </div>

    <!-- 公开题库（FR-PT-030） -->
    <div v-if="activeTab === 'questions'" class="tab-body">
      <div class="filter-bar">
        <select v-model="qSubject" class="f-select" style="width: 120px">
          <option value="">全部学科</option>
          <option v-for="subject in [...new Set(questions.map((q) => q.subject))]" :key="subject" :value="subject">
            {{ subject }}
          </option>
        </select>
        <input v-model="qKeyword" class="f-input" style="width: 220px" placeholder="搜索题干关键词" />
        <button class="btn btn-ghost btn-sm" style="margin-left: auto" @click="onExport('公开题库')">
          <AppIcon name="download" :size="14" /> 导出
        </button>
      </div>
      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>题干摘要</th>
              <th>学科</th>
              <th>题型</th>
              <th>难度</th>
              <th>知识点</th>
              <th>变式</th>
              <th>AI 校验</th>
              <th>来源机构</th>
              <th>入库时间</th>
              <th style="width: 80px">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading && questions.length === 0">
              <td colspan="10" class="empty-row">加载中…</td>
            </tr>
            <tr v-else-if="filteredQuestions().length === 0">
              <td colspan="10" class="empty-row">暂无题目</td>
            </tr>
            <template v-else>
              <tr v-for="q in filteredQuestions()" :key="q.id">
                <td class="stem-cell cell-strong"><RichTextViewer :content="q.stem" tag="span" /></td>
                <td>{{ q.subject }}</td>
                <td>{{ q.type }}</td>
                <td>{{ q.difficulty }}</td>
                <td class="knowledge-cell">{{ q.knowledge }}</td>
                <td>{{ q.variantCount > 0 ? `${q.variantCount} 个` : '—' }}</td>
                <td><span class="tag" :class="aiStatusClass(q.aiStatus)">{{ q.aiStatus }}</span></td>
                <td>{{ q.orgMasked }}</td>
                <td class="time-cell">{{ q.createdAt }}</td>
                <td>
                  <button class="mini-btn" type="button" @click="questionOpen = q">查看</button>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 公开试卷（FR-PT-031） -->
    <div v-else-if="activeTab === 'papers'" class="tab-body">
      <div class="filter-bar">
        <span class="filter-label">平行卷信息只读展示；源卷内容与组卷结构不向平台侧开放</span>
        <button class="btn btn-ghost btn-sm" style="margin-left: auto" @click="onExport('公开试卷')">
          <AppIcon name="download" :size="14" /> 导出
        </button>
      </div>
      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>试卷名称</th>
              <th>学科</th>
              <th>总分</th>
              <th>题量</th>
              <th>平行卷</th>
              <th>来源机构</th>
              <th>入库时间</th>
              <th style="width: 80px">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading && papers.length === 0">
              <td colspan="8" class="empty-row">加载中…</td>
            </tr>
            <tr v-else-if="papers.length === 0">
              <td colspan="8" class="empty-row">暂无试卷</td>
            </tr>
            <template v-else>
              <tr v-for="p in papers" :key="p.id">
                <td class="cell-strong">{{ p.name }}</td>
                <td>{{ p.subject }}</td>
                <td>{{ p.totalScore }} 分</td>
                <td>{{ p.questionCount }} 题</td>
                <td>
                  <span v-if="p.parallelCount > 0" class="tag tag-blue">{{ p.parallelCount }} 套</span>
                  <span v-else style="color: var(--sub)">—</span>
                </td>
                <td>{{ p.orgMasked }}</td>
                <td class="time-cell">{{ p.createdAt }}</td>
                <td>
                  <button class="mini-btn" type="button" @click="paperOpen = p">查看</button>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 审核记录（FR-PT-032） -->
    <div v-else class="tab-body">
      <div class="filter-bar">
        <span class="filter-label">多智能体检测 → 自动纠错 → 人工终审全链路记录</span>
        <button class="btn btn-ghost btn-sm" style="margin-left: auto" @click="onExport('审核记录')">
          <AppIcon name="download" :size="14" /> 导出
        </button>
      </div>
      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>对象类型</th>
              <th>对象名称</th>
              <th>智能体检测</th>
              <th>自动纠错</th>
              <th>终审人</th>
              <th>结论</th>
              <th>终审时间</th>
              <th style="width: 80px">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading && audits.length === 0">
              <td colspan="8" class="empty-row">加载中…</td>
            </tr>
            <tr v-else-if="audits.length === 0">
              <td colspan="8" class="empty-row">暂无记录</td>
            </tr>
            <template v-else>
              <tr v-for="a in audits" :key="a.id">
                <td><span class="tag tag-gray">{{ a.objectType }}</span></td>
                <td class="cell-strong">{{ a.objectName }}</td>
                <td>
                  <span :class="a.agentPassed === a.agentTotal ? 'pass-all' : 'pass-part'">
                    {{ a.agentPassed }}/{{ a.agentTotal }} 通过
                  </span>
                </td>
                <td>{{ a.autoFixed > 0 ? `${a.autoFixed} 处` : '—' }}</td>
                <td>{{ a.reviewer }}</td>
                <td>
                  <span class="tag" :class="a.conclusion.includes('通过') ? 'tag-green' : 'tag-orange'">
                    {{ a.conclusion }}
                  </span>
                </td>
                <td class="time-cell">{{ a.reviewedAt }}</td>
                <td>
                  <button class="mini-btn" type="button" @click="auditOpen = a">查看</button>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 题目详情 -->
    <AppDrawer
      v-if="questionOpen"
      :title="toPlainText(questionOpen.stem)"
      subtitle="公开题库 · 只读详情（含答案与解析，仅平台审计用途）"
      @close="questionOpen = null"
    >
      <div class="detail-grid">
        <div><span class="d-label">学科</span>{{ questionOpen.subject }}</div>
        <div><span class="d-label">题型</span>{{ questionOpen.type }}</div>
        <div><span class="d-label">难度</span>{{ questionOpen.difficulty }}</div>
        <div><span class="d-label">知识点</span>{{ questionOpen.knowledge }}</div>
        <div><span class="d-label">来源机构</span>{{ questionOpen.orgMasked }}</div>
        <div><span class="d-label">入库时间</span>{{ questionOpen.createdAt }}</div>
      </div>

      <h4 class="section-title">题干</h4>
      <RichTextViewer class="q-text" :content="questionOpen.stem" />

      <template v-if="questionOpen.options.length > 0">
        <h4 class="section-title">选项</h4>
        <ul class="option-list">
          <li v-for="(opt, i) in questionOpen.options" :key="i">{{ 'ABCD'[i] }}. <RichTextViewer :content="opt" tag="span" /></li>
        </ul>
      </template>

      <h4 class="section-title">答案</h4>
      <p class="q-text answer">{{ questionOpen.answer }}</p>
      <h4 class="section-title">解析</h4>
      <RichTextViewer class="q-text" :content="questionOpen.analysis" />

      <template v-if="questionOpen.report">
        <h4 class="section-title">AI 校验报告</h4>
        <p class="q-text report">{{ questionOpen.report }}</p>
      </template>

      <template v-if="questionOpen.variants.length > 0">
        <h4 class="section-title">变式题（{{ questionOpen.variants.length }}）</h4>
        <ul class="variant-list">
          <li v-for="(variant, i) in questionOpen.variants" :key="i">{{ variant }}</li>
        </ul>
      </template>
    </AppDrawer>

    <!-- 试卷详情 -->
    <AppDrawer v-if="paperOpen" :title="paperOpen.name" subtitle="公开试卷 · 只读" @close="paperOpen = null">
      <div class="detail-grid">
        <div><span class="d-label">学科</span>{{ paperOpen.subject }}</div>
        <div><span class="d-label">总分</span>{{ paperOpen.totalScore }} 分</div>
        <div><span class="d-label">题量</span>{{ paperOpen.questionCount }} 题</div>
        <div><span class="d-label">来源机构</span>{{ paperOpen.orgMasked }}</div>
        <div><span class="d-label">入库时间</span>{{ paperOpen.createdAt }}</div>
        <div><span class="d-label">平行卷</span>{{ paperOpen.parallelCount }} 套</div>
      </div>
      <h4 class="section-title">平行卷信息</h4>
      <ul v-if="paperOpen.parallels.length > 0" class="variant-list">
        <li v-for="(p, i) in paperOpen.parallels" :key="i">{{ p }}</li>
      </ul>
      <p v-else class="q-text" style="color: var(--sub)">无平行卷</p>
    </AppDrawer>

    <!-- 审核时间线 -->
    <AppDrawer
      v-if="auditOpen"
      :title="auditOpen.objectName"
      subtitle="审核记录 · 多智能体检测 / 自动纠错 / 人工终审"
      @close="auditOpen = null"
    >
      <div class="detail-grid">
        <div><span class="d-label">对象</span>{{ auditOpen.objectType }}</div>
        <div><span class="d-label">检测</span>{{ auditOpen.agentPassed }}/{{ auditOpen.agentTotal }} 通过</div>
        <div><span class="d-label">自动纠错</span>{{ auditOpen.autoFixed }} 处</div>
        <div><span class="d-label">终审人</span>{{ auditOpen.reviewer }}</div>
        <div><span class="d-label">结论</span>{{ auditOpen.conclusion }}</div>
        <div><span class="d-label">终审时间</span>{{ auditOpen.reviewedAt }}</div>
      </div>
      <h4 class="section-title">处理时间线</h4>
      <ol class="timeline">
        <li v-for="(step, i) in auditOpen.timeline" :key="i">
          <span class="tl-time">{{ step.time }}</span>
          <div class="tl-body">
            <span class="tl-step">{{ step.step }}</span>
            <span class="tl-detail">{{ step.detail }}</span>
          </div>
        </li>
      </ol>
    </AppDrawer>
  </div>
</template>

<style scoped>
.tab-row {
  display: flex;
  align-items: center;
  gap: 4px;
  border-bottom: 1px solid var(--border);
  padding: 0 16px;
}
.tab-btn {
  border: none;
  background: transparent;
  color: var(--sub);
  font-size: 13.5px;
  font-weight: 500;
  padding: 14px 16px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: color 0.15s;
}
.tab-btn:hover { color: var(--ink); }
.tab-btn.active { color: var(--brand); font-weight: 600; border-bottom-color: var(--brand); }
.read-only-hint {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--sub);
}
.tab-body { padding: 14px 16px 16px; }

.stem-cell { max-width: 300px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.knowledge-cell { font-size: 12.5px; color: var(--ink-2); max-width: 160px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.time-cell { font-size: 12.5px; color: var(--sub); white-space: nowrap; }
.pass-all { color: var(--success); font-weight: 600; }
.pass-part { color: var(--warn); font-weight: 600; }

.d-label {
  display: inline-block;
  color: var(--sub);
  font-size: 12px;
  margin-right: 8px;
  min-width: 60px;
}
.q-text {
  font-size: 13.5px;
  color: var(--ink-2);
  line-height: 1.8;
  background: #f8fafd;
  border-radius: 10px;
  padding: 12px 14px;
}
.q-text.answer { color: var(--success); font-weight: 600; }
.q-text.report { color: var(--ink-2); }
.option-list { list-style: none; display: flex; flex-direction: column; gap: 8px; }
.option-list li {
  font-size: 13.5px;
  color: var(--ink-2);
  background: #f8fafd;
  border-radius: 8px;
  padding: 9px 12px;
}
.variant-list { list-style: none; display: flex; flex-direction: column; gap: 8px; counter-reset: variant; }
.variant-list li {
  font-size: 13px;
  color: var(--ink-2);
  border: 1px dashed var(--border);
  border-radius: 8px;
  padding: 9px 12px;
  line-height: 1.7;
}

.timeline { list-style: none; display: flex; flex-direction: column; gap: 0; padding-left: 4px; }
.timeline li { display: flex; gap: 14px; position: relative; padding-bottom: 22px; }
.timeline li:not(:last-child)::before {
  content: '';
  position: absolute;
  left: 5px;
  top: 16px;
  bottom: 0;
  width: 2px;
  background: var(--border);
}
.tl-time { font-size: 11.5px; color: var(--sub); width: 120px; flex-shrink: 0; padding-top: 2px; }
.tl-body { display: flex; flex-direction: column; gap: 3px; }
.tl-step { font-size: 13.5px; font-weight: 600; color: var(--ink); display: flex; align-items: center; gap: 8px; }
.tl-step::before {
  content: '';
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--brand);
  flex-shrink: 0;
}
.tl-detail { font-size: 12.5px; color: var(--ink-2); line-height: 1.7; }
</style>
