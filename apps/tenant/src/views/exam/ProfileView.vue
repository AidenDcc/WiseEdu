<script setup lang="ts">
/**
 * AI 学情分析（T-07-08/09/10）。
 *
 * 顶部选班级 → 班级学情报告（学科掌握度对比、共性薄弱点、分数段分布、AI 教学建议）；
 * 点击学生行 → 抽屉展开个人画像（分学科知识点掌握度、AI 归因、个性化练习推送）。
 *
 * 治理红线：不做公开排名 —— 分数段只呈现分布与自身区间（成长型激励设计）。
 * 所有掌握度条与 AnalysisView 一致用纯 CSS 横条，不引图表库。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { AppIcon, AppPageHeader, showToast } from '@aiteach/shared'
import type { ClassProfileReport, OrgClass, OrgStudent, StudentProfile } from '@aiteach/shared'
import AppDrawer from '@/components/ui/AppDrawer.vue'
import AppModal from '@/components/ui/AppModal.vue'
import { fetchClassProfile, fetchClasses, fetchStudents, fetchStudentProfile, pushPractice } from '@/api/student'

const classes = ref<OrgClass[]>([])
const className = ref('')
const report = ref<ClassProfileReport | null>(null)
const students = ref<OrgStudent[]>([])
const loading = ref(true)

async function load() {
  if (!className.value && classes.value.length) className.value = classes.value[0].name
  if (!className.value) return
  loading.value = true
  const [classReport, studentList] = await Promise.all([
    fetchClassProfile(className.value),
    fetchStudents('', className.value),
  ])
  report.value = classReport
  /* 只列在读学生：与班级报告的「在读人数」口径一致（休学 / 转班学生不参与学情统计） */
  students.value = studentList.filter((row) => row.status === '在读')
  loading.value = false
}

watch(className, load)
onMounted(async () => {
  classes.value = await fetchClasses()
  await load()
})

/* ===== 个人画像抽屉 ===== */
const profile = ref<StudentProfile | null>(null)
const profileLoading = ref(false)

async function openProfile(row: OrgStudent) {
  profileLoading.value = true
  profile.value = null
  try {
    profile.value = await fetchStudentProfile(row.id)
  } catch (error) {
    showToast(error instanceof Error ? error.message : '加载画像失败', 'error')
  } finally {
    profileLoading.value = false
  }
}

const activeSubject = ref('')
const visibleNodes = computed(() => {
  if (!profile.value) return []
  const subject = profile.value.subjects.find((row) => row.subject === activeSubject.value)
  return subject?.nodes ?? []
})

function masteryColor(value: number) {
  if (value >= 80) return '#2e9e5b'
  if (value >= 60) return '#d9822b'
  return '#d94f43'
}

/* ===== 个性化练习推送（T-07-10） ===== */
const pushing = ref<null | { studentName: string; knowledge: string; count: number }>(null)

function openPush(node: { knowledge: string }) {
  if (!profile.value) return
  /* 知识点条形里带「学科 · 知识点」前缀，推送时拆开 */
  const knowledge = node.knowledge.split(' · ').pop() ?? node.knowledge
  pushing.value = { studentName: profile.value.studentName, knowledge, count: 8 }
}

async function submitPush() {
  if (!pushing.value || !profile.value) return
  try {
    await pushPractice(profile.value.studentId, pushing.value.knowledge, pushing.value.count)
    showToast(`已向 ${pushing.value.studentName} 推送「${pushing.value.knowledge}」练习 ${pushing.value.count} 题`, 'success')
    pushing.value = null
  } catch (error) {
    showToast(error instanceof Error ? error.message : '推送失败', 'error')
  }
}

const TREND_TEXT = { up: '↑ 上升', flat: '→ 持平', down: '↓ 下降' } as const
</script>

<template>
  <div class="page">
    <AppPageHeader desc="AI 学情画像：班级共性薄弱点 + 学生个人掌握度归因 + 个性化练习推送。按成长型激励要求不做公开排名，只呈现分布与自身区间。">
      <template #actions>
        <select v-model="className" class="f-select">
          <option v-for="cls in classes" :key="cls.id" :value="cls.name">{{ cls.name }}</option>
        </select>
      </template>
    </AppPageHeader>

    <template v-if="loading">
      <div class="panel"><p class="empty-row">加载中…</p></div>
    </template>

    <template v-else-if="report">
      <!-- 班级学情报告 -->
      <div class="report-grid">
        <div class="panel">
          <h3 class="panel-title">学科掌握度（较上学期）</h3>
          <div class="subject-list">
            <div v-for="row in report.subjectMastery" :key="row.subject" class="subject-row">
              <span class="subject-name">{{ row.subject }}</span>
              <div class="bar-track">
                <div class="bar last" :style="{ width: `${row.lastTerm}%` }" />
                <div class="bar current" :style="{ width: `${row.mastery}%` }" />
              </div>
              <span class="subject-value">{{ row.mastery }}%</span>
              <span class="delta" :class="row.mastery >= row.lastTerm ? 'up' : 'down'">
                {{ row.mastery >= row.lastTerm ? '+' : '' }}{{ row.mastery - row.lastTerm }}
              </span>
            </div>
          </div>
          <p class="legend"><i class="dot current" />本学期 <i class="dot last" />上学期</p>
        </div>

        <div class="panel">
          <h3 class="panel-title">共性薄弱知识点（AI 归因）</h3>
          <div class="weak-list">
            <div v-for="row in report.weakNodes" :key="row.knowledge" class="weak-row">
              <span class="weak-name">{{ row.knowledge }}</span>
              <div class="bar-track"><div class="bar" :style="{ width: `${row.mastery}%`, background: masteryColor(row.mastery) }" /></div>
              <span class="subject-value">{{ row.mastery }}%</span>
            </div>
          </div>
        </div>

        <div class="panel">
          <h3 class="panel-title">最近统考分数段分布</h3>
          <div class="band-list">
            <div v-for="row in report.scoreBands" :key="row.band" class="band-row">
              <span class="band-name">{{ row.band }}</span>
              <div class="bar-track"><div class="bar band" :style="{ width: `${(row.count / Math.max(...report.scoreBands.map((b) => b.count), 1)) * 100}%` }" /></div>
              <span class="subject-value">{{ row.count }} 人</span>
            </div>
          </div>
          <p class="privacy-note">不做公开排名：仅呈现分布与自身区间。</p>
        </div>

        <div class="panel">
          <h3 class="panel-title">AI 教学建议</h3>
          <ul class="advice-list">
            <li v-for="item in report.advice" :key="item">{{ item }}</li>
          </ul>
        </div>
      </div>

      <!-- 学生列表 -->
      <div class="panel">
        <h3 class="panel-title">学生画像列表（{{ report.studentCount }} 人 · 点击查看个人画像）</h3>
        <div class="data-table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>姓名</th>
                <th>画像标签</th>
                <th>最近统考</th>
                <th>班级分位</th>
                <th>学习预警</th>
                <th>知情同意</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in students" :key="row.id">
                <td class="cell-strong">{{ row.name }}</td>
                <td>
                  <div class="tag-row">
                    <span v-for="tag in row.tags" :key="tag" class="tag tag-blue">{{ tag }}</span>
                  </div>
                </td>
                <td>{{ row.lastScore ?? '—' }}</td>
                <td>前 {{ 100 - (row.lastPercentile ?? 0) }}%</td>
                <td>
                  <span class="tag" :class="row.warning === 'risk' ? 'tag-red' : row.warning === 'watch' ? 'tag-orange' : 'tag-gray'">
                    {{ row.warning === 'risk' ? '预警' : row.warning === 'watch' ? '关注' : '正常' }}
                  </span>
                </td>
                <td>
                  <span class="tag" :class="row.consentStatus === 'granted' ? 'tag-green' : 'tag-orange'">
                    {{ row.consentStatus === 'granted' ? '已授权' : '未授权' }}
                  </span>
                </td>
                <td>
                  <div class="op-group">
                    <button class="mini-btn" :disabled="row.consentStatus !== 'granted'" @click="openProfile(row)">
                      查看画像
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <!-- 个人画像抽屉 -->
    <AppDrawer
      v-if="profile || profileLoading"
      :title="profile ? `${profile.studentName} · AI 学情画像` : 'AI 学情画像'"
      :subtitle="profile ? `${profile.className} · 综合掌握度 ${profile.overall}% · 年级前 ${100 - profile.percentile}%` : '加载中…'"
      :width="620"
      @close="profile = null; profileLoading = false"
    >
      <template v-if="profile">
        <div class="subject-tabs">
          <button
            v-for="subject in profile.subjects"
            :key="subject.subject"
            class="subject-tab"
            :class="{ on: subject.subject === activeSubject }"
            type="button"
            @click="activeSubject = subject.subject"
          >
            {{ subject.subject }} {{ subject.mastery }}%
          </button>
        </div>
        <div class="node-list">
          <div v-for="node in visibleNodes" :key="node.knowledge" class="node-row">
            <div class="node-info">
              <span class="node-name">{{ node.knowledge }}</span>
              <span class="trend" :class="node.trend">{{ TREND_TEXT[node.trend] }}</span>
            </div>
            <div class="bar-track">
              <div class="bar" :style="{ width: `${node.mastery}%`, background: masteryColor(node.mastery) }" />
            </div>
            <div class="node-meta">
              <span :class="{ weak: node.weak }">{{ node.mastery }}%</span>
              <span class="practice">{{ node.practices }} 次练习</span>
              <button v-if="node.weak" class="mini-btn" @click="openPush(node)">推送练习</button>
            </div>
          </div>
        </div>

        <div class="diagnosis-box">
          <h4><AppIcon name="sparkles" :size="14" /> AI 归因</h4>
          <p>{{ profile.diagnosis }}</p>
        </div>
        <div class="diagnosis-box suggest">
          <h4><AppIcon name="target" :size="14" /> 建议动作</h4>
          <p>{{ profile.suggestion }}</p>
        </div>

        <div class="detail-section">
          <h4>个性化练习推送记录</h4>
          <div v-for="push in profile.pushes" :key="push.id" class="push-row">
            <div class="push-info">
              <b>{{ push.title }}</b>
              <span>{{ push.weakPoints.join('、') }} · {{ push.questionCount }} 题 · {{ push.pushedAt }}</span>
            </div>
            <div class="push-progress">
              <div class="bar-track"><div class="bar" :style="{ width: `${Math.min(100, (push.done / push.questionCount) * 100)}%` }" /></div>
              <span>{{ push.done }}/{{ push.questionCount }}</span>
            </div>
          </div>
        </div>
      </template>
      <p v-else class="empty-row">画像生成中…</p>
    </AppDrawer>

    <!-- 推送个性化练习 -->
    <AppModal v-if="pushing" :title="`推送个性化练习 · ${pushing.studentName}`" :width="420" @close="pushing = null">
      <div class="f-field">
        <label class="f-label">薄弱知识点</label>
        <input v-model="pushing.knowledge" class="f-input" />
      </div>
      <div class="f-field">
        <label class="f-label">题量</label>
        <select v-model="pushing.count" class="f-select">
          <option :value="5">5 题</option>
          <option :value="8">8 题</option>
          <option :value="12">12 题</option>
        </select>
      </div>
      <p class="sign-note">练习由 AI 按薄弱点从题库精选并组卷，学生完成后自动更新掌握度。</p>
      <template #footer>
        <button class="btn btn-ghost" @click="pushing = null">取消</button>
        <button class="btn btn-primary" @click="submitPush">确认推送</button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.report-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px; }
.panel-title { font-size: 14px; margin: 0 0 14px; }
.subject-list, .weak-list, .band-list { display: flex; flex-direction: column; gap: 10px; }
.subject-row, .weak-row, .band-row { display: grid; grid-template-columns: 130px 1fr 52px; gap: 10px; align-items: center; }
.subject-row { grid-template-columns: 56px 1fr 44px 40px; }
.subject-name, .weak-name, .band-name { font-size: 13px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.subject-value { font-size: 12.5px; color: var(--sub); text-align: right; font-variant-numeric: tabular-nums; }
.delta { font-size: 12px; text-align: right; }
.delta.up { color: #2e9e5b; }
.delta.down { color: #d94f43; }
.bar-track { position: relative; height: 10px; border-radius: 5px; background: #eef2f4; overflow: hidden; }
.bar { position: absolute; inset: 0 auto 0 0; border-radius: 5px; background: var(--brand); transition: width 0.3s; }
.bar.last { background: #c6d4de; }
.bar.current { background: var(--brand); }
.bar.band { background: #7fa8d9; }
.legend { margin: 12px 0 0; font-size: 12px; color: var(--sub); display: flex; gap: 12px; align-items: center; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; }
.dot.current { background: var(--brand); }
.dot.last { background: #c6d4de; }
.advice-list { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 10px; }
.advice-list li { font-size: 13px; line-height: 1.8; color: var(--text); }
.privacy-note { margin: 12px 0 0; font-size: 12px; color: var(--sub); }
.tag-row { display: flex; flex-wrap: wrap; gap: 4px; }
.subject-tabs { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
.subject-tab {
  border: 1.5px solid var(--border); background: #fff; border-radius: 8px;
  padding: 7px 12px; font-size: 12.5px; color: var(--sub); cursor: pointer; font-family: inherit;
}
.subject-tab.on { border-color: var(--brand); color: var(--brand-deep); background: var(--brand-soft); font-weight: 600; }
.node-list { display: flex; flex-direction: column; gap: 12px; margin-bottom: 18px; }
.node-row { display: grid; grid-template-columns: 1fr 150px auto; gap: 12px; align-items: center; }
.node-info { display: flex; align-items: center; gap: 8px; }
.node-name { font-size: 13px; }
.trend { font-size: 11.5px; }
.trend.up { color: #2e9e5b; }
.trend.down { color: #d94f43; }
.trend.flat { color: var(--sub); }
.node-meta { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--sub); }
.node-meta .weak { color: #d94f43; font-weight: 600; }
.practice { white-space: nowrap; }
.diagnosis-box {
  border-left: 3px solid var(--brand); background: #f7f9fb; border-radius: 0 8px 8px 0;
  padding: 12px 14px; margin-bottom: 10px;
}
.diagnosis-box.suggest { border-left-color: #2e9e5b; }
.diagnosis-box h4 { display: flex; align-items: center; gap: 6px; font-size: 13px; margin: 0 0 6px; }
.diagnosis-box p { margin: 0; font-size: 12.5px; line-height: 1.8; color: var(--text); }
.detail-section h4 { font-size: 13px; margin: 16px 0 10px; }
.push-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border); }
.push-row:last-child { border-bottom: none; }
.push-info { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--sub); }
.push-info b { font-size: 13px; color: var(--text); }
.push-progress { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--sub); }
.push-progress .bar-track { width: 90px; }
.sign-note { font-size: 12px; color: var(--sub); margin: 10px 0 0; line-height: 1.7; }
</style>
