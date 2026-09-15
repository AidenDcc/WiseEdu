<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { AppIcon, showToast } from '@aiteach/shared'
import type { PhotoTask } from '@aiteach/shared'
import AppModal from '@/components/ui/AppModal.vue'
import { decidePhoto, fetchPhotoTasks, recognizePhoto, uploadPhotos } from '@/api/org'

const tasks = ref<PhotoTask[]>([])
/** 待上传文件名（模拟，≤20 张） */
const pending = ref<string[]>([])
const uploading = ref(false)

const STATUS_TEXT: Record<PhotoTask['status'], string> = {
  pending: '等待识别',
  recognizing: '识别中',
  done: '识别完成',
  failed: '识别失败',
}
const STATUS_CLASS: Record<PhotoTask['status'], string> = {
  pending: 'tag-gray',
  recognizing: 'tag-blue',
  done: 'tag-green',
  failed: 'tag-red',
}

async function load() {
  tasks.value = await fetchPhotoTasks()
}

function onPick() {
  const name = window.prompt('输入模拟文件名（如：期末试卷-P3.jpg）', `拍照-${Date.now() % 1000}.jpg`)
  if (!name) return
  if (pending.value.length + tasks.value.length >= 20) {
    showToast('单次最多 20 张', 'error')
    return
  }
  pending.value.push(name)
}

async function startUpload() {
  if (!pending.value.length) return
  uploading.value = true
  try {
    tasks.value = await uploadPhotos(pending.value)
    pending.value = []
    showToast('上传完成，已提交 OCR 识别队列', 'success')
    // 新上传的任务依次识别
    tasks.value.filter((task) => task.status === 'recognizing').forEach((task) => { void recognize(task.id) })
  } finally {
    uploading.value = false
  }
}

async function recognize(id: string) {
  try {
    const updated = await recognizePhoto(id)
    const pos = tasks.value.findIndex((task) => task.id === id)
    if (pos >= 0) tasks.value[pos] = updated
  } catch (error) {
    showToast(error instanceof Error ? error.message : '识别失败', 'error')
    await load()
  }
}

/* ===== 结果确认（FR-TM-019） ===== */
const activeTask = ref<PhotoTask | null>(null)
const activeResultId = ref('')
const activeResult = computed(() => activeTask.value?.results.find((row) => row.id === activeResultId.value) ?? null)

function openConfirm(task: PhotoTask) {
  activeTask.value = task
  const first = task.results.find((row) => !row.decided) ?? task.results[0]
  activeResultId.value = first ? first.id : ''
}

/** 本地编辑暂存（确认入库时一并提交） */
const editDraft = ref<{ stem: string; answer: string; analysis: string }>({ stem: '', answer: '', analysis: '' })
function selectResult(id: string) {
  activeResultId.value = id
  const row = activeTask.value?.results.find((item) => item.id === id)
  if (row) editDraft.value = { stem: row.stem, answer: row.answer, analysis: row.analysis }
}

async function decide(decision: 'import' | 'draft' | 'drop') {
  if (!activeTask.value || !activeResult.value) return
  const updated = await decidePhoto(activeTask.value.id, activeResult.value.id, decision)
  const pos = tasks.value.findIndex((task) => task.id === updated.id)
  if (pos >= 0) tasks.value[pos] = updated
  showToast(decision === 'import' ? '已入题库（待人工终审）' : decision === 'draft' ? '已存入题库草稿' : '已丢弃', 'success')
  const next = updated.results.find((row) => !row.decided)
  if (next) {
    activeTask.value = updated
    activeResultId.value = next.id
    editDraft.value = { stem: next.stem, answer: next.answer, analysis: next.analysis }
  } else {
    activeTask.value = null
  }
}

async function confirmAll() {
  if (!activeTask.value) return
  if (!window.confirm('未确认的结果将按「存草稿」处理，确认全部完成？')) return
  for (const row of activeTask.value.results.filter((item) => !item.decided)) {
    const updated = await decidePhoto(activeTask.value.id, row.id, 'draft')
    const pos = tasks.value.findIndex((task) => task.id === updated.id)
    if (pos >= 0) tasks.value[pos] = updated
  }
  activeTask.value = null
  showToast('全部处理完成（未确认项已存草稿）', 'success')
}

async function onRetry(task: PhotoTask) {
  // 失败重传：换一张等价图片再识别（演示为直接重试识别）
  await recognize(task.id)
}

const doneCount = computed(() => tasks.value.filter((task) => task.status === 'done').length)

onMounted(load)
</script>

<template>
  <div class="photo-layout">
    <!-- 上传区（FR-TM-017：拖拽 / 拍照 / 相册，≤20 张） -->
    <div class="panel upload-panel">
      <div class="page-head" style="margin-bottom: 12px">
        <h2>AI 拍照识题</h2>
        <span class="f-hint">已处理 {{ doneCount }} / {{ tasks.length }} 张 · 单次最多 20 张，支持 jpg / png / pdf</span>
      </div>
      <div
        class="drop-zone"
        :class="{ hover: pending.length }"
        @click="onPick"
      >
        <AppIcon name="upload" :size="28" />
        <p>拖拽 / 点击上传题目照片，或调用相机拍摄</p>
        <p class="f-hint">识别引擎：版面分析 → 公式还原 → 结构化入库</p>
      </div>
      <template v-if="pending.length">
        <div class="pending-list">
          <span v-for="(name, i) in pending" :key="i" class="pending-chip">
            {{ name }}
            <button class="chip-x" type="button" @click.stop="pending.splice(i, 1)"><AppIcon name="close" :size="11" /></button>
          </span>
        </div>
        <div class="op-group" style="margin-top: 12px">
          <button class="btn btn-primary btn-sm" :disabled="uploading" @click="startUpload">
            {{ uploading ? '上传中…' : `开始识别（${pending.length} 张）` }}
          </button>
          <button class="btn btn-ghost btn-sm" @click="pending = []">清空</button>
        </div>
      </template>
    </div>

    <!-- 任务列表 -->
    <div class="panel">
      <div class="section-title">识别任务</div>
      <table class="data-table">
        <thead>
          <tr>
            <th>文件</th>
            <th>状态</th>
            <th>识别结果</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="tasks.length === 0">
            <td colspan="4" class="empty-row">暂无识别任务，先上传照片试试</td>
          </tr>
          <template v-else>
            <tr v-for="task in tasks" :key="task.id">
              <td class="cell-strong">{{ task.name }}</td>
              <td><span class="tag" :class="STATUS_CLASS[task.status]">{{ STATUS_TEXT[task.status] }}</span></td>
              <td>
                <template v-if="task.status === 'done'">
                  {{ task.results.length }} 题 · 已处理 {{ task.results.filter((row) => row.decided).length }}
                </template>
                <span v-else class="f-hint">{{ task.failReason ?? '—' }}</span>
              </td>
              <td>
                <div class="op-group">
                  <button
                    v-if="task.status === 'done'"
                    class="mini-btn"
                    @click="openConfirm(task)"
                  >
                    确认结果
                  </button>
                  <button v-if="task.status === 'failed'" class="mini-btn" @click="onRetry(task)">重新上传识别</button>
                  <span v-if="task.status === 'recognizing'" class="f-hint">正在还原公式…</span>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <!-- 结果确认三栏：原图 | 结构化编辑 | 决策（FR-TM-019） -->
    <AppModal
      v-if="activeTask && activeResult"
      :title="`结果确认 · ${activeTask.name}`"
      :width="920"
      @close="activeTask = null"
    >
      <div class="confirm-layout">
        <!-- 左：原图 -->
        <div class="origin-pane">
          <div class="pane-title">原始图片</div>
          <div class="img-placeholder">
            <AppIcon name="image" :size="34" />
            <p>{{ activeTask.name }}</p>
            <p class="f-hint">OCR 热区 {{ activeResult.id }}</p>
          </div>
        </div>
        <!-- 右：结构化结果 -->
        <div class="struct-pane">
          <div class="pane-title">
            识别结果（{{ activeTask.results.findIndex((row) => row.id === activeResult?.id) + 1 }} / {{ activeTask.results.length }}）
            <div class="result-tabs">
              <button
                v-for="row in activeTask.results"
                :key="row.id"
                class="rt-chip"
                :class="{ on: row.id === activeResult.id, decided: row.decided }"
                type="button"
                @click="selectResult(row.id)"
              >
                #{{ row.id }}
              </button>
            </div>
          </div>
          <template v-if="!activeResult.decided">
            <label class="f-label">题干（可修正）</label>
            <textarea v-model="editDraft.stem" class="f-textarea" rows="3" />
            <label class="f-label" style="margin-top: 10px">答案（可修正）</label>
            <input v-model="editDraft.answer" class="f-input" />
            <label class="f-label" style="margin-top: 10px">解析</label>
            <textarea v-model="editDraft.analysis" class="f-textarea" rows="2" />
          </template>
          <template v-else>
            <p class="f-hint" style="margin: 20px 0">该结果已处理，点击上方其他编号继续</p>
          </template>
          <div class="decide-ops">
            <template v-if="!activeResult.decided">
              <button class="btn btn-primary btn-sm" @click="decide('import')"><AppIcon name="check" :size="14" /> 确认入库</button>
              <button class="btn btn-ghost btn-sm" @click="decide('draft')">存草稿</button>
              <button class="btn btn-ghost btn-sm" @click="decide('drop')">丢弃</button>
              <button class="btn btn-ghost btn-sm" style="margin-left: auto" @click="confirmAll">全部确认</button>
            </template>
          </div>
        </div>
      </div>
    </AppModal>
  </div>
</template>

<style scoped>
.photo-layout { display: flex; flex-direction: column; gap: 14px; }

.upload-panel { padding: 18px 20px; }
.drop-zone {
  border: 2px dashed var(--border);
  border-radius: 14px;
  padding: 30px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  color: var(--sub);
  cursor: pointer;
  transition: all 0.15s;
  background: #fbfdfd;
}
.drop-zone:hover, .drop-zone.hover { border-color: var(--brand); background: var(--brand-soft); }
.drop-zone p { font-size: 13.5px; color: var(--ink-2); }

.pending-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.pending-chip {
  display: inline-flex; align-items: center; gap: 6px;
  background: #fff; border: 1px solid var(--border); border-radius: 8px;
  font-size: 12.5px; color: var(--ink-2); padding: 4px 10px;
}
.chip-x { display: flex; color: var(--sub); }

.confirm-layout { display: grid; grid-template-columns: 300px 1fr; gap: 16px; }
.pane-title { font-size: 13px; font-weight: 600; color: var(--ink); margin-bottom: 10px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

.origin-pane .img-placeholder {
  height: 320px;
  border-radius: 12px;
  background: repeating-conic-gradient(#f2f5f5 0% 25%, #fff 0% 50%) 50% / 18px 18px;
  border: 1px solid var(--border);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
  color: var(--sub); font-size: 13px;
}

.struct-pane .result-tabs { display: flex; gap: 6px; }
.rt-chip {
  border: 1.5px solid var(--border); border-radius: 7px; background: #fff;
  font-size: 12px; color: var(--sub); padding: 2px 9px;
}
.rt-chip.on { border-color: var(--brand); color: var(--brand-deep); background: var(--brand-soft); }
.rt-chip.decided { color: var(--success); border-color: var(--success); }
.decide-ops { display: flex; gap: 8px; margin-top: 14px; border-top: 1px dashed var(--border); padding-top: 12px; }
</style>
