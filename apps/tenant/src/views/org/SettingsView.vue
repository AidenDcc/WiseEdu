<script setup lang="ts">
/**
 * 机构系统设置（T-11-01/02/03）。
 *
 * 三个区块：机构基础信息、学科与年级范围（决定录题 / 组卷 / 班级可选项）、
 * 审核流程配置（题目 / 试卷 / 校本资源是否审核、几级审核、是否 AI 预审）。
 */
import { onMounted, ref } from 'vue'
import { AppIcon, AppPageHeader, showToast } from '@aiteach/shared'
import type { OrgSettings, ReviewFlowConfig } from '@aiteach/shared'
import { fetchOrgSettings, fetchReviewFlows, saveOrgSettings, saveReviewFlow } from '@/api/student'

const settings = ref<OrgSettings | null>(null)
const flows = ref<ReviewFlowConfig[]>([])
const loading = ref(true)
const saving = ref(false)

const ALL_SUBJECTS = ['数学', '语文', '英语', '物理', '化学', '生物', '历史', '地理', '政治']
const ALL_GRADES = ['初一', '初二', '初三', '高一', '高二', '高三']
const ALL_TEXTBOOKS = ['人教 A 版', '人教版', '沪教版', '北师大版', '苏教版']
const STAFF = ['李文博', '孙悦', '王静宜', '周敏', '郑海涛']

async function load() {
  loading.value = true
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
      <div class="panel"><p class="empty-row">加载中…</p></div>
    </template>

    <template v-else-if="settings">
      <!-- 基础信息 -->
      <div class="panel">
        <h3 class="panel-title">机构基础信息</h3>
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

        <h3 class="panel-title section-gap">学科与年级范围</h3>
        <div class="check-block">
          <label class="check-label">开设学科</label>
          <div class="subject-checks">
            <label v-for="subject in ALL_SUBJECTS" :key="subject" class="check-item">
              <input v-model="settings.subjects" type="checkbox" :value="subject" />
              {{ subject }}
            </label>
          </div>
        </div>
        <div class="check-block">
          <label class="check-label">覆盖年级</label>
          <div class="subject-checks">
            <label v-for="grade in ALL_GRADES" :key="grade" class="check-item">
              <input v-model="settings.grades" type="checkbox" :value="grade" />
              {{ grade }}
            </label>
          </div>
        </div>
        <div class="check-block">
          <label class="check-label">教材版本偏好</label>
          <div class="subject-checks">
            <label v-for="book in ALL_TEXTBOOKS" :key="book" class="check-item">
              <input v-model="settings.preferredTextbooks" type="checkbox" :value="book" />
              {{ book }}
            </label>
          </div>
        </div>

        <div class="form-actions">
          <button class="btn btn-primary" :disabled="saving" @click="submitSettings">
            <AppIcon name="check" :size="15" /> {{ saving ? '保存中…' : '保存基础信息' }}
          </button>
        </div>
      </div>

      <!-- 审核流程配置 -->
      <div class="panel">
        <h3 class="panel-title">审核流程配置</h3>
        <p class="flow-note">关闭审核后对应内容直接生效；开启 AI 预审会先跑自动质检（答案自洽 / 解析完整 / 年级适配），异常内容优先进入队列。</p>
        <div v-for="flow in flows" :key="flow.key" class="flow-card">
          <div class="flow-head">
            <div class="flow-title">
              <b>{{ flow.label }}</b>
              <span class="tag" :class="flow.enabled ? 'tag-green' : 'tag-gray'">{{ flow.enabled ? '审核开启' : '免审直发' }}</span>
            </div>
            <label class="switch-item">
              <input v-model="flow.enabled" type="checkbox" />
              {{ flow.enabled ? '开启审核' : '关闭审核' }}
            </label>
          </div>
          <template v-if="flow.enabled">
            <div class="flow-body">
              <div class="flow-field">
                <label class="f-label">审核级数</label>
                <select v-model.number="flow.levels" class="f-select">
                  <option :value="1">一级审核</option>
                  <option :value="2">二级审核（终审）</option>
                </select>
              </div>
              <div class="flow-field">
                <label class="f-label">一级审核人</label>
                <div class="subject-checks">
                  <label v-for="name in STAFF" :key="name" class="check-item">
                    <input v-model="flow.level1Reviewers" type="checkbox" :value="name" />
                    {{ name }}
                  </label>
                </div>
              </div>
              <div v-if="flow.levels === 2" class="flow-field">
                <label class="f-label">二级审核人（终审）<span class="req">*</span></label>
                <div class="subject-checks">
                  <label v-for="name in STAFF" :key="name" class="check-item">
                    <input v-model="flow.level2Reviewers" type="checkbox" :value="name" />
                    {{ name }}
                  </label>
                </div>
              </div>
              <label class="switch-item precheck">
                <input v-model="flow.aiPrecheck" type="checkbox" />
                AI 预审（自动质检先行）
              </label>
            </div>
          </template>
          <div class="flow-actions">
            <button class="btn btn-sm btn-primary" @click="submitFlow(flow)">保存该流程</button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.panel-title { font-size: 14px; margin: 0 0 14px; }
.section-gap { margin-top: 22px; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 16px; }
.span2 { grid-column: span 2; }
.form-actions { margin-top: 18px; display: flex; justify-content: flex-end; }
.check-block { display: flex; gap: 16px; margin-bottom: 12px; align-items: flex-start; }
.check-label { font-size: 13px; color: var(--sub); min-width: 84px; padding-top: 4px; }
.subject-checks { display: flex; flex-wrap: wrap; gap: 6px 16px; }
.check-item { display: flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer; }
.flow-note { font-size: 12.5px; color: var(--sub); margin: -6px 0 14px; line-height: 1.7; }
.flow-card { border: 1.5px solid var(--border); border-radius: 12px; padding: 14px 16px; margin-bottom: 12px; }
.flow-head { display: flex; align-items: center; justify-content: space-between; }
.flow-title { display: flex; align-items: center; gap: 10px; }
.flow-title b { font-size: 14px; }
.flow-body { margin-top: 14px; display: flex; flex-direction: column; gap: 12px; }
.flow-field { display: flex; flex-direction: column; gap: 6px; }
.flow-field .f-select { max-width: 200px; }
.switch-item { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; }
.switch-item.precheck { color: var(--brand-deep); }
.flow-actions { margin-top: 14px; display: flex; justify-content: flex-end; }
</style>
