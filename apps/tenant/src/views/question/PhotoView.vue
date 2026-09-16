<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { AppIcon, showToast, toPlainText } from '@aiteach/shared'
import type { PhotoTask } from '@aiteach/shared'
import AppModal from '@/components/ui/AppModal.vue'
import RichTextEditor from '@/components/ui/RichTextEditor.vue'
import { decidePhoto, fetchKnowledgeTree, fetchPhotoTasks, recognizePhoto, registerPhotoTask, uploadPhotos } from '@/api/org'
import { alignKnowledgeToPool, persistEmbeddedImages, photoEngine, photoModelName, recognizePhotoFile } from '@/api/ai-photo'
import { collectTags } from '@/composables/useKnowledgePool'
import { useBaseData } from '@/composables/useBaseData'

const { subjects, grades, ensure, pick } = useBaseData()

const tasks = ref<PhotoTask[]>([])
/** 已选待上传的本地图片文件（≤20 张） */
const pending = ref<File[]>([])
const uploading = ref(false)

/** 识别引擎：已配置视觉模型走真实多模态识别，否则本地演示数据 */
const engine = ref<'vision' | 'mock'>(photoEngine())
const engineLabel = computed(() =>
  engine.value === 'vision' ? `多模态识别（${photoModelName()}）` : '本地演示数据（未配置视觉模型）',
)

/** 任务 id → 本地文件（失败重试用）与缩略图 objectURL（确认弹窗展示原图用） */
const fileByTaskId = new Map<string, File>()
const previewByTaskId = new Map<string, string>()

const MAX_FILES = 20
const MAX_SIZE_MB = 10
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp']

const fileInput = ref<HTMLInputElement | null>(null)
const cameraInput = ref<HTMLInputElement | null>(null)

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
  await ensure()
  tasks.value = await fetchPhotoTasks()
}

/* ===== 知识点关联：模型自判知识点 → 机构知识点池（按该题年级+学科） ===== */
const knowledgePools = new Map<string, string[]>()
async function poolFor(grade: string, subject: string): Promise<string[]> {
  const key = `${grade}|${subject}`
  if (!knowledgePools.has(key)) {
    try {
      knowledgePools.set(key, collectTags(await fetchKnowledgeTree(grade, subject, '')))
    } catch {
      knowledgePools.set(key, [])
    }
  }
  return knowledgePools.get(key) ?? []
}

/* ===== 选图：点击选择 / 拖拽 / 相机拍摄（FR-TM-017） ===== */

function pickFiles() {
  fileInput.value?.click()
}

function pickCamera() {
  cameraInput.value?.click()
}

function addFiles(list: FileList | File[] | null) {
  if (!list) return
  for (const file of Array.from(list)) {
    if (!ACCEPTED.includes(file.type)) {
      showToast(`仅支持 jpg / png / webp：${file.name}`, 'error')
      continue
    }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      showToast(`单张不能超过 ${MAX_SIZE_MB}MB：${file.name}`, 'error')
      continue
    }
    if (pending.value.length + tasks.value.length >= MAX_FILES) {
      showToast(`单次最多 ${MAX_FILES} 张`, 'error')
      break
    }
    pending.value.push(file)
  }
  /* 允许连续选择同一文件 */
  if (fileInput.value) fileInput.value.value = ''
  if (cameraInput.value) cameraInput.value.value = ''
}

const dragOver = ref(false)
function onDrop(event: DragEvent) {
  dragOver.value = false
  addFiles(event.dataTransfer?.files ?? null)
}

function removePending(index: number) {
  URL.revokeObjectURL(previewUrl(pending.value[index]))
  pending.value.splice(index, 1)
}

function previewUrl(file: File): string {
  /* objectURL 按 file 对象缓存，避免每次渲染新建泄漏 */
  const key = `pending_${file.name}_${file.size}_${file.lastModified}`
  const cached = previewByTaskId.get(key)
  if (cached) return cached
  const url = URL.createObjectURL(file)
  previewByTaskId.set(key, url)
  return url
}

/* ===== 上传识别（FR-TM-018） ===== */

let localSeq = 0

async function startUpload() {
  if (!pending.value.length || uploading.value) return
  uploading.value = true
  try {
    if (engine.value === 'mock') {
      await startMockUpload()
    } else {
      await startVisionUpload()
    }
  } finally {
    uploading.value = false
  }
}

/** 未配置视觉模型：走本地 mock 识别（文件名级模拟） */
async function startMockUpload() {
  const created = await uploadPhotos(pending.value.map((file) => file.name))
  tasks.value = [...created, ...tasks.value]
  pending.value = []
  showToast('上传完成，已提交识别队列', 'success')
  for (const task of created) await recognize(task.id)
}

/** 真实引擎：逐张本地压缩编码 → 多模态模型识别 → 回注册到任务库 */
async function startVisionUpload() {
  const files = [...pending.value]
  pending.value = []
  for (const file of files) {
    const task: PhotoTask = {
      id: `pl${++localSeq}`,
      name: file.name,
      sizeMb: Math.round((file.size / 1024 / 1024) * 10) / 10,
      status: 'recognizing',
      results: [],
    }
    fileByTaskId.set(task.id, file)
    previewByTaskId.set(task.id, URL.createObjectURL(file))
    tasks.value.unshift(task)
    await runRecognize(task)
  }
}

/** 单任务识别：成功回注册（后续确认/入库走统一 decide 链路），失败落原因供重试 */
async function runRecognize(task: PhotoTask) {
  const file = fileByTaskId.get(task.id)
  if (!file) return
  const pos = () => tasks.value.findIndex((row) => row.id === task.id)
  try {
    const results = await recognizePhotoFile(file, task.id)
    /* 学科/年级归一到机构字典（模型可能输出「高中数学」等自由文本），
       并把自判知识点对齐到该年级+学科的知识点池，保证入库后与筛选体系一致 */
    const normalized = []
    for (const row of results) {
      const subject = pick(subjects.value, row.subject ?? '')
      const grade = pick(grades.value, row.grade ?? '')
      const pool = await poolFor(grade, subject)
      const knowledge = [...new Set(row.knowledge.map((name) => alignKnowledgeToPool(name, pool)))]
        .filter(Boolean)
        .slice(0, 3)
      /* 内联 SVG 配图转存媒体库、正文改写为媒体 URL，否则校对编辑时会被编辑器剥掉 */
      const [stem, analysis] = await Promise.all([
        persistEmbeddedImages(row.stem, subject),
        persistEmbeddedImages(row.analysis, subject),
      ])
      const options = await Promise.all(row.options.map((opt) => persistEmbeddedImages(opt, subject)))
      normalized.push({ ...row, stem, options, analysis, subject, grade, knowledge })
    }
    const done: PhotoTask = { ...task, status: 'done', results: normalized }
    tasks.value[pos()] = done
    /* 回注册到任务库：确认入库/存草稿/丢弃与 mock 识别同一条 decide 链路 */
    tasks.value[pos()] = await registerPhotoTask(done)
  } catch (error) {
    tasks.value[pos()] = {
      ...task,
      status: 'failed',
      failReason: error instanceof Error ? error.message : '识别失败',
    }
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

/** 失败重试：真实引擎用保留的本地文件重识别；mock 引擎直接重试 */
async function onRetry(task: PhotoTask) {
  if (engine.value === 'vision' && fileByTaskId.has(task.id)) {
    await runRecognize({ ...task, status: 'recognizing', failReason: undefined })
  } else {
    await recognize(task.id)
  }
}

/* ===== 结果确认（FR-TM-019） ===== */
const activeTask = ref<PhotoTask | null>(null)
const activeResultId = ref('')
const activeResult = computed(() => activeTask.value?.results.find((row) => row.id === activeResultId.value) ?? null)
/** 当前任务的原图（真实引擎为本地预览，mock 为占位图） */
const activePreview = computed(() => (activeTask.value ? previewByTaskId.get(activeTask.value.id) : undefined))

function openConfirm(task: PhotoTask) {
  activeTask.value = task
  const first = task.results.find((row) => !row.decided) ?? task.results[0]
  if (first) selectResult(first.id)
  else activeResultId.value = ''
}

/** 本地编辑暂存（确认入库时一并提交；选项 / 学科 / 年级均可在校对区修正） */
const editDraft = ref<{ stem: string; options: string[]; answer: string; analysis: string; subject: string; grade: string }>({
  stem: '',
  options: [],
  answer: '',
  analysis: '',
  subject: '',
  grade: '',
})

/** 去掉选项文本里自带的「A. 」前缀（mock 演示数据带，AI 识别结果不带），
    统一为「内容不含字母」，字母由界面按位置统一渲染 */
function stripOptionLetter(text: string): string {
  return text.replace(/^[A-F]\s*[.、．)]\s*/, '')
}

function fillDraft(row: PhotoTask['results'][number]) {
  editDraft.value = {
    stem: row.stem,
    options: row.options.map(stripOptionLetter),
    answer: row.answer,
    analysis: row.analysis,
    subject: row.subject ?? '',
    grade: row.grade ?? '',
  }
}

function selectResult(id: string) {
  activeResultId.value = id
  const row = activeTask.value?.results.find((item) => item.id === id)
  if (row) fillDraft(row)
}

async function decide(decision: 'import' | 'draft' | 'drop') {
  if (!activeTask.value || !activeResult.value) return
  /* 校对区改动（题干/选项/答案/解析/学科/年级）必须随决策一起提交，否则会被静默丢弃；
     选项过滤空项，避免教师删空后残留空选项 */
  const updated = await decidePhoto(activeTask.value.id, activeResult.value.id, decision, {
    ...editDraft.value,
    options: editDraft.value.options.filter((opt) => toPlainText(opt).trim()),
  })
  const pos = tasks.value.findIndex((task) => task.id === updated.id)
  if (pos >= 0) tasks.value[pos] = updated
  showToast(decision === 'import' ? '已入题库（待人工终审）' : decision === 'draft' ? '已存入题库草稿' : '已丢弃', 'success')
  const next = updated.results.find((row) => !row.decided)
  if (next) {
    activeTask.value = updated
    activeResultId.value = next.id
    fillDraft(next)
  } else {
    activeTask.value = null
  }
}

async function confirmAll() {
  if (!activeTask.value) return
  if (!window.confirm('未确认的结果将按「存草稿」处理，确认全部完成？')) return
  for (const row of activeTask.value.results.filter((item) => !item.decided)) {
    /* 当前正在校对的那条带上改动，其余未确认项本就没人改过 */
    const edit = row.id === activeResultId.value ? { ...editDraft.value } : undefined
    const updated = await decidePhoto(activeTask.value.id, row.id, 'draft', edit)
    const pos = tasks.value.findIndex((task) => task.id === updated.id)
    if (pos >= 0) tasks.value[pos] = updated
  }
  activeTask.value = null
  showToast('全部处理完成（未确认项已存草稿）', 'success')
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
        <span class="f-hint">已处理 {{ doneCount }} / {{ tasks.length }} 张 · 单次最多 20 张，支持 jpg / png / webp</span>
        <span class="tag" :class="engine === 'vision' ? 'tag-green' : 'tag-gray'" style="margin-left: auto">
          {{ engineLabel }}
        </span>
      </div>
      <div
        class="drop-zone"
        :class="{ hover: dragOver }"
        @click="pickFiles"
        @dragover.prevent="dragOver = true"
        @dragleave.prevent="dragOver = false"
        @drop.prevent="onDrop"
      >
        <AppIcon name="upload" :size="28" />
        <p>点击选择 / 拖拽图片到此处，单张不超过 10MB</p>
        <p class="f-hint">识别引擎：版面分析 → 公式还原（LaTeX）→ 结构化入库</p>
        <button class="btn btn-ghost btn-sm camera-btn" type="button" @click.stop="pickCamera">
          <AppIcon name="smartphone" :size="14" /> 调用相机拍摄
        </button>
      </div>
      <input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden @change="addFiles(fileInput?.files ?? null)" />
      <input ref="cameraInput" type="file" accept="image/*" capture="environment" hidden @change="addFiles(cameraInput?.files ?? null)" />

      <template v-if="pending.length">
        <div class="pending-list">
          <div v-for="(file, i) in pending" :key="`${file.name}_${file.lastModified}`" class="pending-card">
            <img class="pending-thumb" :src="previewUrl(file)" :alt="file.name" />
            <div class="pending-meta">
              <span class="pending-name" :title="file.name">{{ file.name }}</span>
              <span class="f-hint">{{ (file.size / 1024 / 1024).toFixed(1) }} MB</span>
            </div>
            <button class="chip-x" type="button" @click.stop="removePending(i)"><AppIcon name="close" :size="11" /></button>
          </div>
        </div>
        <div class="op-group" style="margin-top: 12px">
          <button class="btn btn-primary btn-sm" :disabled="uploading" @click="startUpload">
            {{ uploading ? '识别中…' : `开始识别（${pending.length} 张）` }}
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
                  <button v-if="task.status === 'failed'" class="mini-btn" @click="onRetry(task)">重新识别</button>
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
          <img v-if="activePreview" class="origin-img" :src="activePreview" :alt="activeTask.name" />
          <div v-else class="img-placeholder">
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
            <div class="result-meta">
              <span v-if="activeResult.subject" class="tag tag-blue">{{ activeResult.subject }}</span>
              <span v-if="activeResult.grade" class="tag tag-blue">{{ activeResult.grade }}</span>
              <span class="tag tag-gray">{{ activeResult.difficulty }}</span>
              <span v-for="k in activeResult.knowledge" :key="k" class="tag tag-green">{{ k }}</span>
            </div>
            <div class="prop-row">
              <div class="f-field compact">
                <label class="f-label">学科（可修正）</label>
                <select v-model="editDraft.subject" class="f-select">
                  <option v-for="s in subjects" :key="s" :value="s">{{ s }}</option>
                </select>
              </div>
              <div class="f-field compact">
                <label class="f-label">年级（可修正）</label>
                <select v-model="editDraft.grade" class="f-select">
                  <option v-for="g in grades" :key="g" :value="g">{{ g }}</option>
                </select>
              </div>
            </div>
            <label class="f-label">题干（可修正）</label>
            <RichTextEditor v-model="editDraft.stem" :min-height="90" placeholder="OCR 识别结果，可直接修正" />
            <template v-if="editDraft.options.length">
              <label class="f-label" style="margin-top: 10px">选项（可修正）</label>
              <div class="option-edit-list">
                <div v-for="(_opt, oi) in editDraft.options" :key="oi" class="option-edit-row">
                  <span class="option-letter">{{ 'ABCDEF'[oi] }}.</span>
                  <RichTextEditor
                    v-model="editDraft.options[oi]"
                    compact
                    :min-height="44"
                    :subject="editDraft.subject"
                    placeholder="选项内容"
                  />
                  <button class="chip-x" type="button" title="删除该选项" @click="editDraft.options.splice(oi, 1)">
                    <AppIcon name="close" :size="12" />
                  </button>
                </div>
                <button v-if="editDraft.options.length < 6" class="mini-btn" type="button" @click="editDraft.options.push('')">
                  + 添加选项
                </button>
              </div>
            </template>
            <label class="f-label" style="margin-top: 10px">答案（可修正）</label>
            <input v-model="editDraft.answer" class="f-input" />
            <label class="f-label" style="margin-top: 10px">解析</label>
            <RichTextEditor v-model="editDraft.analysis" :min-height="80" placeholder="解析（选填）" />
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
  padding: 26px;
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
.camera-btn { margin-top: 6px; }

.pending-list { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
.pending-card {
  display: flex; align-items: center; gap: 8px;
  background: #fff; border: 1px solid var(--border); border-radius: 10px;
  padding: 6px 10px 6px 6px; max-width: 240px;
}
.pending-thumb { width: 44px; height: 44px; border-radius: 7px; object-fit: cover; background: #f2f5f5; }
.pending-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.pending-name { font-size: 12.5px; color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip-x { display: flex; color: var(--sub); }

.confirm-layout { display: grid; grid-template-columns: 300px 1fr; gap: 16px; }
.pane-title { font-size: 13px; font-weight: 600; color: var(--ink); margin-bottom: 10px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

.origin-img {
  width: 100%; max-height: 340px; object-fit: contain;
  border-radius: 12px; border: 1px solid var(--border); background: #fff;
}
.origin-pane .img-placeholder {
  height: 320px;
  border-radius: 12px;
  background: repeating-conic-gradient(#f2f5f5 0% 25%, #fff 0% 50%) 50% / 18px 18px;
  border: 1px solid var(--border);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
  color: var(--sub); font-size: 13px;
}

.result-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.prop-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; margin-bottom: 10px; }
.option-edit-list { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.option-edit-row { display: grid; grid-template-columns: 26px 1fr 24px; gap: 8px; align-items: start; width: 100%; }
.option-letter { font-size: 13px; font-weight: 600; color: var(--ink-2); padding-top: 10px; }
.option-edit-row .chip-x { display: flex; padding-top: 10px; }

.struct-pane .result-tabs { display: flex; gap: 6px; }
.rt-chip {
  border: 1.5px solid var(--border); border-radius: 7px; background: #fff;
  font-size: 12px; color: var(--sub); padding: 2px 9px;
}
.rt-chip.on { border-color: var(--brand); color: var(--brand-deep); background: var(--brand-soft); }
.rt-chip.decided { color: var(--success); border-color: var(--success); }
.decide-ops { display: flex; gap: 8px; margin-top: 14px; border-top: 1px dashed var(--border); padding-top: 12px; }
</style>
