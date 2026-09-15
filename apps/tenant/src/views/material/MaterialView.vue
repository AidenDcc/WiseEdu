<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { AppIcon, MATERIAL_STATUS_TEXT, RichTextViewer, showToast } from '@aiteach/shared'
import type { OrgMaterial } from '@aiteach/shared'
import AppModal from '@/components/ui/AppModal.vue'
import { decideExample, deleteMaterial, fetchMaterials, finishMaterial, reRecognizeMaterial, uploadMaterial } from '@/api/org'
import { useBaseData } from '@/composables/useBaseData'

const { subjects, ensure, pick } = useBaseData()

const materials = ref<OrgMaterial[]>([])

const STATUS_CLASS: Record<string, string> = {
  recognizing: 'tag-blue',
  proofreading: 'tag-orange',
  done: 'tag-green',
  failed: 'tag-red',
}
const EX_STATUS_TEXT: Record<string, string> = { pending: '待处理', imported: '已入题库', ignored: '已忽略' }

async function load() {
  await ensure()
  uploadForm.subject = pick(subjects.value, uploadForm.subject)
  materials.value = await fetchMaterials()
}

/* ===== 上传（FR-JC-001：pdf/图片，自动结构化识别） ===== */
const uploadOpen = ref(false)
const uploadForm = reactive({ name: '', type: '讲义', subject: '数学' })
const TYPES = ['讲义', '练习册', '试卷集', '笔记']

async function submitUpload() {
  if (uploadForm.name.trim().length < 2) {
    showToast('请填写教辅名称', 'error')
    return
  }
  const item = await uploadMaterial({ ...uploadForm })
  uploadOpen.value = false
  await load()
  showToast(`《${item.name}》已上传，AI 正在结构化识别（章节 / 知识点 / 例题）`, 'success')
  window.setTimeout(load, 600)
}

/* ===== 校对工作台（FR-JC-002/003） ===== */
const proofOpen = ref(false)
const proofTarget = ref<OrgMaterial | null>(null)
const activeChapter = ref(0)

function openProof(row: OrgMaterial) {
  proofTarget.value = row
  activeChapter.value = 0
  proofOpen.value = true
}

const chapter = computed(() => proofTarget.value?.chapters[activeChapter.value] ?? null)
const pendingExamples = computed(() =>
  (proofTarget.value?.chapters ?? []).reduce((sum, ch) => sum + ch.examples.filter((ex) => ex.status === 'pending').length, 0),
)

async function onDecide(exampleId: number, decision: 'import' | 'ignore') {
  if (!proofTarget.value) return
  await decideExample(proofTarget.value.id, exampleId, decision)
  // 以服务端状态为准刷新
  materials.value = await fetchMaterials()
  proofTarget.value = materials.value.find((row) => row.id === proofTarget.value?.id) ?? null
  showToast(decision === 'import' ? '已入题库（AI 校验 → 待人工终审）' : '已忽略', 'success')
}

async function onFinish() {
  if (!proofTarget.value) return
  if (pendingExamples.value > 0 && !window.confirm(`还有 ${pendingExamples.value} 道例题未处理，完成后将永久丢弃，确认？`)) return
  const { message } = await finishMaterial(proofTarget.value.id, pendingExamples.value)
  proofOpen.value = false
  await load()
  showToast(message, 'success')
}

/* ===== 其他操作 ===== */
async function onReRecognize(row: OrgMaterial) {
  if (!window.confirm('重新识别将覆盖当前章节结构（消耗 1 次额度），确认？')) return
  await reRecognizeMaterial(row.id)
  await load()
  showToast('已重新识别，请进入校对', 'success')
}

async function onDelete(row: OrgMaterial) {
  if (!window.confirm(`删除《${row.name}》？将进入回收站保留 30 天`)) return
  await deleteMaterial(row.id)
  showToast('已移入回收站', 'success')
  load()
}

function onExport(row: OrgMaterial) {
  showToast(`《${row.name}》结构化数据导出任务已创建`, 'success')
}

onMounted(load)
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h2>教辅资料</h2>
      <span class="f-hint">上传 pdf / 图片教辅 → AI 结构化（章节树 / 知识点 / 例题）→ 人工校对一键入题库</span>
      <button class="btn btn-primary" style="margin-left: auto" @click="uploadOpen = true">
        <AppIcon name="upload" :size="15" /> 上传教辅
      </button>
    </div>

    <div class="panel">
      <table class="data-table">
        <thead>
          <tr>
            <th>教辅名称</th>
            <th>类型</th>
            <th>学科</th>
            <th>大小</th>
            <th>状态</th>
            <th>章节 / 例题</th>
            <th>上传人</th>
            <th>上传时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="materials.length === 0">
            <td colspan="9" class="empty-row">暂无教辅资料</td>
          </tr>
          <template v-else>
            <tr v-for="row in materials" :key="row.id">
              <td class="cell-strong">{{ row.name }}</td>
              <td><span class="tag tag-gray">{{ row.type }}</span></td>
              <td>{{ row.subject }}</td>
              <td>{{ row.sizeMb }} MB</td>
              <td>
                <span class="tag" :class="STATUS_CLASS[row.status]">{{ MATERIAL_STATUS_TEXT[row.status as keyof typeof MATERIAL_STATUS_TEXT] }}</span>
                <p v-if="row.failReason" class="f-err" style="margin-top: 4px">{{ row.failReason }}</p>
              </td>
              <td>
                {{ row.chapters.length }} 章 /
                {{ row.chapters.reduce((s, ch) => s + ch.examples.length, 0) }} 例题
                <span v-if="row.status === 'proofreading'" class="tag tag-orange" style="margin-left: 4px">
                  待处理 {{ row.chapters.reduce((s, ch) => s + ch.examples.filter((ex) => ex.status === 'pending').length, 0) }}
                </span>
              </td>
              <td>{{ row.owner }}</td>
              <td>{{ row.createdAt }}</td>
              <td>
                <div class="op-group">
                  <button v-if="row.status === 'proofreading'" class="mini-btn success" @click="openProof(row)">校对</button>
                  <button v-if="row.status === 'done'" class="mini-btn" @click="onExport(row)">导出</button>
                  <button v-if="row.status === 'failed' || row.status === 'done'" class="mini-btn" @click="onReRecognize(row)">重新识别</button>
                  <button class="mini-btn danger" @click="onDelete(row)">删除</button>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <!-- 上传弹窗 -->
    <AppModal v-if="uploadOpen" title="上传教辅" :width="480" @close="uploadOpen = false">
      <div class="f-field">
        <label class="f-label">教辅名称<span class="req">*</span></label>
        <input v-model="uploadForm.name" class="f-input" placeholder="如：高二数学选修一同步讲义" />
      </div>
      <div class="f-field row2">
        <div>
          <label class="f-label">类型</label>
          <select v-model="uploadForm.type" class="f-select">
            <option v-for="t in TYPES" :key="t">{{ t }}</option>
          </select>
        </div>
        <div>
          <label class="f-label">学科</label>
          <select v-model="uploadForm.subject" class="f-select">
            <option v-for="s in subjects" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
      </div>
      <p class="f-hint">支持 pdf / 图片（≤200MB），上传后自动进入「结构化识别 → 待校对」流程</p>
      <template #footer>
        <button class="btn btn-ghost" @click="uploadOpen = false">取消</button>
        <button class="btn btn-primary" @click="submitUpload">开始上传</button>
      </template>
    </AppModal>

    <!-- 校对工作台 -->
    <AppModal v-if="proofOpen && proofTarget" :title="`校对 · ${proofTarget.name}`" :width="860" @close="proofOpen = false">
      <div class="proof-layout">
        <!-- 章节树 -->
        <div class="chapter-pane">
          <div class="pane-title">章节结构（AI 识别）</div>
          <button
            v-for="(ch, i) in proofTarget.chapters"
            :key="ch.id"
            class="chapter-item"
            :class="{ on: i === activeChapter }"
            type="button"
            @click="activeChapter = i"
          >
            <span class="ch-title">{{ ch.title }}</span>
            <span class="ch-meta">
              {{ ch.examples.filter((ex) => ex.status === 'pending').length }}/{{ ch.examples.length }} 待处理
            </span>
          </button>
        </div>
        <!-- 例题卡片 -->
        <div class="example-pane">
          <div class="pane-title">
            例题确认（一键入题库）
            <span class="f-hint">共 {{ pendingExamples }} 道待处理</span>
          </div>
          <p v-if="!chapter || chapter.examples.length === 0" class="f-hint">本章无识别出的例题</p>
          <div v-for="ex in chapter?.examples ?? []" :key="ex.id" class="example-card" :class="ex.status">
            <RichTextViewer :content="ex.stem" class="ex-stem" />
            <div class="ex-ans"><span class="tag tag-green">答案</span>{{ ex.answer }}</div>
            <p class="ex-analysis"><b>解析：</b><RichTextViewer :content="ex.analysis" tag="span" /></p>
            <div class="ex-ops">
              <template v-if="ex.status === 'pending'">
                <button class="mini-btn success" @click="onDecide(ex.id, 'import')"><AppIcon name="check" :size="13" /> 入题库</button>
                <button class="mini-btn danger" @click="onDecide(ex.id, 'ignore')">忽略</button>
              </template>
              <span v-else class="tag" :class="ex.status === 'imported' ? 'tag-green' : 'tag-gray'">{{ EX_STATUS_TEXT[ex.status] }}</span>
            </div>
          </div>
          <button class="btn btn-primary" style="margin-top: 14px" @click="onFinish">
            完成校对{{ pendingExamples > 0 ? `（丢弃 ${pendingExamples} 道未处理）` : '' }}
          </button>
        </div>
      </div>
    </AppModal>
  </div>
</template>

<style scoped>
.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

.proof-layout { display: grid; grid-template-columns: 250px 1fr; gap: 16px; }
.pane-title { font-size: 13px; font-weight: 600; color: var(--ink); margin-bottom: 10px; display: flex; align-items: baseline; gap: 8px; }
.chapter-pane { border-right: 1px solid var(--border); padding-right: 14px; }
.chapter-item {
  display: flex; flex-direction: column; gap: 4px; width: 100%; text-align: left;
  border: 1.5px solid var(--border); border-radius: 10px; background: #fff;
  padding: 9px 11px; margin-bottom: 8px; cursor: pointer;
}
.chapter-item.on { border-color: var(--brand); background: var(--brand-soft); }
.ch-title { font-size: 13px; color: var(--ink); font-weight: 600; }
.ch-meta { font-size: 11.5px; color: var(--sub); }

.example-card { border: 1.5px solid var(--border); border-radius: 10px; padding: 12px 14px; margin-bottom: 10px; background: #fff; }
.example-card.imported { border-color: var(--success); }
.ex-stem { font-size: 13.5px; color: var(--ink); line-height: 1.7; margin-bottom: 8px; }
.ex-ans { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--success); margin-bottom: 6px; }
.ex-analysis { font-size: 12.5px; color: var(--ink-2); line-height: 1.6; margin-bottom: 10px; }
.ex-ops { display: flex; gap: 8px; align-items: center; border-top: 1px dashed var(--border); padding-top: 9px; }
</style>
