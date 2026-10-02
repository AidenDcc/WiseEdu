<script setup lang="ts">
/**
 * 公共试卷库管理（P-03-11/12/13）。
 *
 * 平台侧试卷资产的审核与上架；试卷解析拆题入库（P-03-12 AI 增强）在演示中用
 * 「解析入库」按钮体现拆解结果，真实环境接 OCR + 题目结构化服务。
 */
import { onMounted, ref } from 'vue'
import { AppIcon, AppPageHeader, PLATFORM_CONTENT_STATUS_TEXT, showToast, AppModal } from '@aiteach/shared'
import type { PlatformContentStatus, PlatformPaper } from '@aiteach/shared'
import { fetchPlatformPapers, reviewPlatformPaper } from '@/api/content'

const papers = ref<PlatformPaper[]>([])
const keyword = ref('')
const subjectFilter = ref('')
const loading = ref(true)

async function load() {
  loading.value = true
  papers.value = await fetchPlatformPapers(keyword.value, subjectFilter.value)
  loading.value = false
}

function statusTag(status: PlatformContentStatus) {
  if (status === 'published') return 'tag-green'
  if (status === 'pending') return 'tag-orange'
  if (status === 'rejected') return 'tag-red'
  return 'tag-gray'
}

const reviewing = ref<null | { id: number; name: string; pass: boolean }>(null)

async function submitReview() {
  if (!reviewing.value) return
  try {
    await reviewPlatformPaper(reviewing.value.id, reviewing.value.pass)
    showToast(reviewing.value.pass ? '已通过并上架' : '已驳回', 'success')
    reviewing.value = null
    load()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '操作失败', 'error')
  }
}

onMounted(load)
</script>

<template>
  <div class="page">
    <AppPageHeader desc="公共试卷库：整卷资产审核与上架；支持从试卷解析拆题入库（AI 增强），拆出的题回流公共题库。">
      <template #actions>
        <div class="head-actions">
          <select v-model="subjectFilter" class="f-select" @change="load">
            <option value="">全部学科</option>
            <option v-for="subject in ['数学', '语文', '英语', '物理']" :key="subject" :value="subject">{{ subject }}</option>
          </select>
          <input v-model="keyword" class="f-input search" placeholder="试卷名称" @keyup.enter="load" />
          <button class="btn btn-primary" @click="load">检索</button>
        </div>
      </template>
    </AppPageHeader>

    <div class="panel">
      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>试卷名称</th>
              <th>学科 / 年级</th>
              <th>题量</th>
              <th>总分</th>
              <th>来源</th>
              <th>引用</th>
              <th>状态</th>
              <th>更新时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="9" class="empty-row">加载中…</td>
            </tr>
            <tr v-else-if="papers.length === 0">
              <td colspan="9" class="empty-row">暂无试卷</td>
            </tr>
            <template v-else>
              <tr v-for="row in papers" :key="row.id">
                <td class="cell-strong">{{ row.name }}</td>
                <td>{{ row.subject }} · {{ row.grade }}</td>
                <td>{{ row.questionCount }} 题</td>
                <td>{{ row.fullScore }} 分</td>
                <td>{{ row.source }}</td>
                <td>{{ row.refs }}</td>
                <td><span class="tag" :class="statusTag(row.status)">{{ PLATFORM_CONTENT_STATUS_TEXT[row.status] }}</span></td>
                <td class="mono">{{ row.updatedAt }}</td>
                <td>
                  <div class="op-group">
                    <button v-if="row.status === 'pending'" class="mini-btn" @click="reviewing = { id: row.id, name: row.name, pass: true }">审核</button>
                    <button class="mini-btn" @click="showToast('解析拆题入库（AI 增强）已加入任务队列', 'success')">解析入库</button>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <AppModal v-if="reviewing" :title="reviewing.pass ? '通过审核' : '驳回试卷'" :width="440" @close="reviewing = null">
      <p class="confirm-text">{{ reviewing.name }}</p>
      <p class="confirm-note">
        {{ reviewing.pass ? '通过后试卷进入公共试卷库（已上架），可由内容分发授权给租户使用。' : '驳回后试卷状态置为已驳回。' }}
      </p>
      <template #footer>
        <button class="btn btn-ghost" @click="reviewing = null">取消</button>
        <button class="btn" :class="reviewing.pass ? 'btn-primary' : 'btn-danger'" @click="submitReview">
          {{ reviewing.pass ? '确认通过' : '确认驳回' }}
        </button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.head-actions { display: flex; align-items: center; gap: 10px; }
.search { width: 220px; }
.mono { font-family: 'SF Mono', Menlo, monospace; font-size: 12px; }
.confirm-text { font-size: 14px; font-weight: 600; color: var(--text); margin: 0 0 8px; }
.confirm-note { font-size: 12.5px; color: var(--sub); line-height: 1.7; margin: 0; }
</style>
