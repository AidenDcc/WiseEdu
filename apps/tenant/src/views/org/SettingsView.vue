<script setup lang="ts">
/**
 * 机构系统设置（T-11-01/02/03）。
 *
 * 三个区块：机构基础信息、学科与年级范围（决定录题 / 组卷 / 班级可选项）、
 * 审核流程配置（题目 / 试卷 / 校本资源是否审核、几级审核、是否 AI 预审）。
 *
 * 布局统一走「panel 头 / panel 体 / panel 底」三段：
 * 原来标题和输入框直接贴在 panel 圆角边线上（`.panel` 本身没有 padding），
 * 输入框一路顶到左右边框，读起来像表格而不是表单。现在头部 16/18、内容 14/18/18、
 * 底部 14/18 且带分隔线，任何控件与 panel 边线之间都至少留 18px。
 *
 * 勾选类控件改用 `AppChipGroup`（与班级管理、筛选面板同一套 chip），
 * 开关改用 `AppSwitch`，不再用原生 checkbox 自绘，避免与系统其它页面两套观感。
 */
import { computed, onMounted, ref } from 'vue'
import { AppChipGroup, AppIcon, AppPageHeader, AppSwitch, showToast } from '@aiteach/shared'
import type { OrgSettings, ReviewFlowConfig } from '@aiteach/shared'
import { fetchOrgSettings, fetchReviewFlows, saveOrgSettings, saveReviewFlow } from '@/api/student'
import { useBaseData } from '@aiteach/business-common'

const settings = ref<OrgSettings | null>(null)
const flows = ref<ReviewFlowConfig[]>([])
const loading = ref(true)
const saving = ref(false)

/**
 * 学科 / 年级候选项统一取自机构端基础字典（`useBaseData` 单例，底层就是平台字典 mock），
 * 与题库、组卷等页面**同源**，避免出现「七年级 / 初一」这种同一概念两种叫法。
 */
const { subjects: dictSubjects, grades: dictGrades, ensure } = useBaseData()
const ALL_TEXTBOOKS = ['人教 A 版', '人教版', '沪教版', '北师大版', '苏教版']
const STAFF = ['李文博', '孙悦', '王静宜', '周敏', '郑海涛']

/** 已选数量直接标在标签下面，省得用户对着几十个 chip 一个个数 */
const pickedSubjects = computed(() => settings.value?.subjects.length ?? 0)
const pickedGrades = computed(() => settings.value?.grades.length ?? 0)

async function load() {
  loading.value = true
  /* 学科 / 年级选项来自基础字典，先确保它已就绪 */
  await ensure()
  const [settingsData, flowList] = await Promise.all([fetchOrgSettings(), fetchReviewFlows()])
  settings.value = settingsData
  flows.value = flowList
  loading.value = false
}

async function submitSettings() {
  if (!settings.value) return
  if (!settings.value.name.trim()) {
    showToast('机构名称必填', 'error')
    return
  }
  saving.value = true
  try {
    settings.value = await saveOrgSettings({ ...settings.value })
    showToast('基础信息已保存', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '保存失败', 'error')
  } finally {
    saving.value = false
  }
}

async function submitFlow(flow: ReviewFlowConfig) {
  try {
    await saveReviewFlow(flow.key, {
      enabled: flow.enabled,
      levels: flow.levels,
      level1Reviewers: flow.level1Reviewers,
      level2Reviewers: flow.level2Reviewers,
      aiPrecheck: flow.aiPrecheck,
    })
    showToast(`「${flow.label}」已保存`, 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '保存失败', 'error')
  }
}

onMounted(load)
</script>

<template>
  <div class="page">
    <AppPageHeader desc="机构基础信息、学科年级范围与审核流程配置；学科范围决定录题 / 组卷 / 班级管理里的可选项。" />

    <template v-if="loading">
      <div class="panel set-panel"><p class="empty-row">加载中…</p></div>
    </template>

    <div v-else-if="settings" class="set-stack">
      <!-- ① 基础信息 + ② 学科与年级范围 -->
      <section class="panel set-panel">
        <header class="set-head">
          <h3 class="section-title">机构基础信息</h3>
          <p class="set-desc">机构全称会出现在合同、发票与家长端落款；简称用于顶栏与通知落款。</p>
        </header>
        <div class="set-body">
          <div class="form-grid">
            <div class="f-field">
              <label class="f-label">机构全称<span class="req">*</span></label>
              <input v-model="settings.name" class="f-input" />
            </div>
            <div class="f-field">
              <label class="f-label">机构简称</label>
              <input v-model="settings.shortName" class="f-input" />
            </div>
            <div class="f-field">
              <label class="f-label">联系人</label>
              <input v-model="settings.contact" class="f-input" />
            </div>
            <div class="f-field">
              <label class="f-label">联系电话</label>
              <input v-model="settings.phone" class="f-input" />
            </div>
            <div class="f-field span2">
              <label class="f-label">地址</label>
              <input v-model="settings.address" class="f-input" />
            </div>
            <div class="f-field span2">
              <label class="f-label">机构简介</label>
              <textarea v-model="settings.intro" class="f-textarea" rows="3" />
            </div>
          </div>
        </div>

        <div class="set-divider" />

        <header class="set-head">
          <h3 class="section-title">学科与年级范围</h3>
          <p class="set-desc">这里勾选的学科与年级，会作为录题、组卷、班级管理里的可选范围；取消勾选不影响已建内容。</p>
        </header>
        <div class="set-body">
          <div class="opt-row">
            <div class="opt-label">
              开设学科
              <span class="opt-count">已选 {{ pickedSubjects }} / {{ dictSubjects.length }}</span>
            </div>
            <AppChipGroup v-model="settings.subjects" :options="dictSubjects" placeholder="基础字典未配置学科" />
          </div>
          <div class="opt-row">
            <div class="opt-label">
              覆盖年级
              <span class="opt-count">已选 {{ pickedGrades }} / {{ dictGrades.length }}</span>
            </div>
            <AppChipGroup v-model="settings.grades" :options="dictGrades" placeholder="基础字典未配置年级" />
          </div>
          <div class="opt-row">
            <div class="opt-label">
              教材版本偏好
              <span class="opt-count">已选 {{ settings.preferredTextbooks.length }} / {{ ALL_TEXTBOOKS.length }}</span>
            </div>
            <AppChipGroup v-model="settings.preferredTextbooks" :options="ALL_TEXTBOOKS" />
          </div>
        </div>

        <footer class="set-foot">
          <span class="set-foot-hint">学科与年级范围保存后，下次进入录题 / 组卷即按新范围过滤。</span>
          <button class="btn btn-primary" :disabled="saving" @click="submitSettings">
            <AppIcon name="check" :size="15" /> {{ saving ? '保存中…' : '保存基础信息' }}
          </button>
        </footer>
      </section>

      <!-- ③ 审核流程配置 -->
      <section class="panel set-panel">
        <header class="set-head">
          <h3 class="section-title">审核流程配置</h3>
          <p class="set-desc">关闭审核后对应内容直接生效；开启 AI 预审会先跑自动质检（答案自洽 / 解析完整 / 年级适配），异常内容优先进入队列。</p>
        </header>
        <div class="set-body">
          <div v-for="flow in flows" :key="flow.key" class="flow-card">
            <div class="flow-head">
              <div class="flow-title">
                <b>{{ flow.label }}</b>
                <span class="tag" :class="flow.enabled ? 'tag-green' : 'tag-gray'">{{ flow.enabled ? '审核开启' : '免审直发' }}</span>
              </div>
              <div class="flow-switch">
                <span>{{ flow.enabled ? '开启审核' : '关闭审核' }}</span>
                <AppSwitch v-model="flow.enabled" />
              </div>
            </div>

            <template v-if="flow.enabled">
              <div class="flow-body">
                <div class="opt-row">
                  <div class="opt-label">审核级数</div>
                  <select v-model.number="flow.levels" class="f-select flow-select">
                    <option :value="1">一级审核</option>
                    <option :value="2">二级审核（终审）</option>
                  </select>
                </div>
                <div class="opt-row">
                  <div class="opt-label">一级审核人</div>
                  <AppChipGroup v-model="flow.level1Reviewers" :options="STAFF" placeholder="员工名单为空" />
                </div>
                <div v-if="flow.levels === 2" class="opt-row">
                  <div class="opt-label">
                    <span class="lab-main">二级审核人<span class="req">*</span></span>
                    <span class="opt-count">终审环节</span>
                  </div>
                  <AppChipGroup v-model="flow.level2Reviewers" :options="STAFF" placeholder="员工名单为空" />
                </div>
                <div class="opt-row">
                  <div class="opt-label">
                    AI 预审
                    <span class="opt-count">自动质检先行</span>
                  </div>
                  <div class="flow-switch">
                    <AppSwitch v-model="flow.aiPrecheck" />
                    <span>{{ flow.aiPrecheck ? '已开启' : '未开启' }}</span>
                  </div>
                </div>
              </div>
            </template>

            <div class="flow-actions">
              <button class="btn btn-sm btn-primary" @click="submitFlow(flow)">保存该流程</button>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
/* 两块 panel 之间的间距（顶部说明条已自带 16px 下边距） */
.set-stack { display: flex; flex-direction: column; gap: 14px; }

/* 加载态也要有内边距，否则「加载中…」贴在圆角边线上 */
.set-panel { overflow: hidden; }

/* —— panel 三段：头 / 体 / 底 —— */
.set-head { padding: 16px 18px 0; }
.set-head .section-title { margin-bottom: 6px; }
.set-desc { font-size: 12.5px; color: var(--sub); line-height: 1.7; max-width: 860px; }
.set-body { padding: 14px 18px 18px; }
.set-divider { height: 1px; background: var(--border); margin: 16px 18px 0; }
.set-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 14px 18px;
  border-top: 1px solid var(--border);
  background: #fbfcfe;
}
.set-foot-hint { font-size: 12.5px; color: var(--sub); line-height: 1.6; }

/* —— 基础信息表单 —— */
/* gap 已经负责行间距，.f-field 自带的 16px 下边距会叠成 30px */
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 18px; }
.form-grid .f-field { margin-bottom: 0; }
.span2 { grid-column: span 2; }

/* —— 「标签 + 选项」行：标签定宽，chip 从同一条竖线起排 —— */
.opt-row {
  display: grid;
  grid-template-columns: 132px minmax(0, 1fr);
  align-items: start;
  gap: 6px 16px;
  padding: 12px 0;
}
.opt-row:first-child { padding-top: 0; }
.opt-row:last-child { padding-bottom: 0; }
.opt-row + .opt-row { border-top: 1px dashed var(--border); }
.opt-label {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding-top: 5px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-2);
}
.opt-count { font-size: 11.5px; font-weight: 400; color: var(--sub); }
.lab-main { display: inline; }
.opt-label .req { color: var(--danger); margin-left: 2px; }
.flow-select { max-width: 220px; }

/* —— 审核流程卡片 —— */
.flow-card {
  border: 1.5px solid var(--border);
  border-radius: 12px;
  padding: 14px 16px;
}
.flow-card + .flow-card { margin-top: 12px; }
.flow-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.flow-title { display: flex; align-items: center; gap: 10px; }
.flow-title b { font-size: 14px; }
.flow-switch { display: inline-flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--ink-2); }
.flow-body {
  margin-top: 14px;
  border-top: 1px dashed var(--border);
  display: flex;
  flex-direction: column;
}
/* 首行与上方虚线之间也要留出与其它行一致的距离 */
.flow-body .opt-row:first-child { padding-top: 12px; }
.flow-actions { margin-top: 14px; padding-top: 12px; border-top: 1px dashed var(--border); display: flex; justify-content: flex-end; }
</style>
