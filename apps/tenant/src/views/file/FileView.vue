<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { AppIcon, showToast, hasImage, toPlainText } from '@aiteach/shared'
import type { FileFolder, OrgFile } from '@aiteach/shared'
import AppModal from '@/components/ui/AppModal.vue'
import RichTextEditor from '@/components/ui/RichTextEditor.vue'
import {
  deleteFile,
  deleteFolder,
  fetchFiles,
  fetchFolders,
  importRecognizedFile,
  saveFolder,
  uploadFiles,
} from '@/api/org'
import {
  fileContentOf,
  recognizeFileContent,
  registerFileContent,
} from '@/api/ai-file'
import type { FileRecognizeResult, RecognizedQuestion } from '@/api/ai-file'
import { getCheckRounds, setCheckRounds, verifyQuestionsByAi, type VerifyIssue } from '@/api/ai-verify'
import { persistEmbeddedImages } from '@/api/ai-photo'
import { useBaseData } from '@/composables/useBaseData'

const { subjects, grades, questionTypes, difficulties, ensure, optionLabel } = useBaseData()

const folders = ref<FileFolder[]>([])
const files = ref<OrgFile[]>([])
const usage = ref({ usedGb: 0, quotaGb: 1 })

const activeFolder = ref(0)
const keyword = ref('')

async function load() {
  await ensure()
  const [folderList, fileList] = await Promise.all([fetchFolders(), fetchFiles()])
  folders.value = folderList
  files.value = fileList.list
  usage.value = fileList.usage
}

/** 文件夹树（一层展开即可） */
const treeRows = computed(() => {
  const roots = folders.value.filter((row) => row.parentId === null)
  const rows: Array<{ folder: FileFolder; depth: number }> = []
  roots.forEach((root) => {
    rows.push({ folder: root, depth: 0 })
    folders.value.filter((row) => row.parentId === root.id).forEach((child) => rows.push({ folder: child, depth: 1 }))
  })
  return rows
})

const visibleFiles = computed(() =>
  files.value.filter(
    (row) =>
      (activeFolder.value === 0 || row.folderId === activeFolder.value || isInSubfolder(row.folderId)) &&
      (!keyword.value || row.name.includes(keyword.value)),
  ),
)
function isInSubfolder(folderId: number): boolean {
  const children = folders.value.filter((row) => row.parentId === activeFolder.value).map((row) => row.id)
  return children.includes(folderId)
}
function folderName(id: number) {
  return folders.value.find((row) => row.id === id)?.name ?? '—'
}

const KIND_ICON: Record<OrgFile['kind'], string> = { pdf: 'file', word: 'file', image: 'image', ppt: 'form', zip: 'folder' }
const RECOGNIZE_TEXT: Record<OrgFile['recognize'], string> = { none: '未识别', recognizing: '识别中', done: '已识别入库', failed: '识别失败' }
const RECOGNIZE_CLASS: Record<OrgFile['recognize'], string> = { none: 'tag-gray', recognizing: 'tag-blue', done: 'tag-green', failed: 'tag-red' }

const usagePercent = computed(() => Math.min(100, Math.round((usage.value.usedGb / usage.value.quotaGb) * 100)))

/* ===== 文件夹维护 ===== */
const catEditing = ref<null | { id: number | null; name: string; parentId: number | null }>(null)

function openFolderCreate(parentId: number) {
  catEditing.value = { id: null, name: '', parentId }
}
function openFolderRename(folder: FileFolder) {
  catEditing.value = { id: folder.id, name: folder.name, parentId: folder.parentId }
}

async function submitFolder() {
  if (!catEditing.value) return
  if (catEditing.value.name.trim().length === 0) {
    showToast('文件夹名称不能为空', 'error')
    return
  }
  try {
    await saveFolder({ id: catEditing.value.id ?? undefined, name: catEditing.value.name.trim(), parentId: catEditing.value.parentId })
    catEditing.value = null
    showToast('已保存', 'success')
    load()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '保存失败', 'error')
  }
}

async function onDeleteFolder(folder: FileFolder) {
  if (folder.id === 0) return
  if (!window.confirm(`删除文件夹「${folder.name}」？其中文件将一并进入回收站`)) return
  const { moved } = await deleteFolder(folder.id)
  if (activeFolder.value === folder.id) activeFolder.value = 0
  showToast(`文件夹已删除（${moved} 个文件进入回收站）`, 'success')
  load()
}

/* ===== 上传（真实文件；实体保留在 ai-file 的缓存里供 AI 识别用） ===== */
const uploadOpen = ref(false)
const uploadPending = ref<File[]>([])
const uploadTarget = ref(0)
const fileInput = ref<HTMLInputElement | null>(null)

function onPickFiles() {
  fileInput.value?.click()
}

function onFilesPicked(event: Event) {
  const input = event.target as HTMLInputElement
  const picked = Array.from(input.files ?? [])
  /* 同名去重（后选的覆盖先选的），避免列表里出现两个分不清的同名文件 */
  picked.forEach((file) => {
    const dup = uploadPending.value.findIndex((row) => row.name === file.name)
    if (dup >= 0) uploadPending.value.splice(dup, 1)
    uploadPending.value.push(file)
  })
  input.value = ''
}

function fmtSize(mb: number): string {
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(mb * 1024)} KB`
}

async function submitUpload() {
  if (!uploadPending.value.length) return
  const pending = [...uploadPending.value]
  const uploaded = await uploadFiles(
    pending.map((file) => file.name),
    uploadTarget.value,
    pending.map((file) => file.size / 1048576),
  )
  /* 实体文件按返回顺序绑定，后续「识别入库」有真实内容可走 AI 引擎 */
  uploaded.forEach((row, i) => registerFileContent(row.id, pending[i]))
  uploadOpen.value = false
  uploadPending.value = []
  showToast(`上传完成（${uploaded.length} 个文件）`, 'success')
  load()
}

/* ===== AI 识别入库（FR-FL-004/005 扩展：先确认、可修改，再入库） ===== */

const CHOICE_TYPES = ['单选题', '多选题', '判断题']
function isChoiceType(type: string): boolean {
  return CHOICE_TYPES.includes(type)
}

const recogOpen = ref(false)
const recogPhase = ref<'running' | 'edit' | 'failed'>('running')
const recogProgress = ref(0)
const recogFailReason = ref('')
/** 正在识别的文件与其预览（真实图片显示缩略图，其余显示文件卡） */
const recogFile = ref<OrgFile | null>(null)
const recogPreview = ref('')
const recogResult = ref<FileRecognizeResult | null>(null)
/** 识别结果的 AI 质检报告（确认弹窗打标 + 超轮人工介入提醒） */
const recogVerify = ref<{ issues: Map<string, VerifyIssue[]>; manual: boolean; rounds: number; engine: 'deepseek' | 'mock' } | null>(null)
/** 检查轮次（0=关闭，1~3；localStorage 持久化） */
const checkRounds = ref(getCheckRounds())
function onRoundsChange() {
  setCheckRounds(checkRounds.value)
}
let recogTimer = 0

/**
 * 识别结果的 AI 质检：按设置轮次逐轮复核答案/解析（每轮修正版进入下一轮），
 * 修正字段回写确认列表；超轮仍有 error 级异常 → manual=true，提醒人工介入。
 */
async function runVerify(result: FileRecognizeResult) {
  recogVerify.value = null
  if (checkRounds.value <= 0 || !result.questions.length) return
  try {
    let current = result.questions.map((q) => ({
      id: q.key,
      stem: q.stem,
      options: [...q.options],
      answer: q.answer,
      analysis: q.analysis,
      knowledge: [...q.knowledge],
      difficulty: q.difficulty,
      subject: q.subject,
      grade: q.grade,
    }))
    let lastIssues: VerifyIssue[] = []
    let manual = false
    let engine: 'deepseek' | 'mock' = 'mock'
    for (let r = 1; r <= checkRounds.value; r += 1) {
      const report = await verifyQuestionsByAi(current, { scene: '文档识别' }, 1)
      engine = report.engine
      lastIssues = report.rounds[report.rounds.length - 1]?.issues ?? []
      if (report.corrected.length === current.length) {
        current = await Promise.all(
          report.corrected.map(async (fixed, i) => {
            const origin = current[i]
            /* 修正版里的内联配图转存素材库，避免 data URL 进存储后编辑器剥掉 */
            const [stem, analysis] = await Promise.all([
              persistEmbeddedImages(fixed.stem, origin.subject),
              persistEmbeddedImages(fixed.analysis, origin.subject),
            ])
            const options = await Promise.all(fixed.options.map((opt) => persistEmbeddedImages(opt, origin.subject)))
            return { ...origin, stem, options, analysis, answer: fixed.answer, knowledge: fixed.knowledge, difficulty: fixed.difficulty }
          }),
        )
      }
      manual = lastIssues.some((issue) => issue.level === 'error')
      if (!manual) break
    }
    /* 修正版回写确认列表（key/顺序不变，编辑区所见即入库内容） */
    current.forEach((row, i) => {
      const q = result.questions[i]
      if (!q) return
      q.stem = row.stem
      q.options = row.options
      q.answer = row.answer
      q.analysis = row.analysis
      q.knowledge = row.knowledge
      q.difficulty = row.difficulty
    })
    const issues = new Map<string, VerifyIssue[]>()
    for (const issue of lastIssues) {
      const row = current[issue.index]
      if (!row) continue
      const bucket = issues.get(row.id) ?? []
      bucket.push(issue)
      issues.set(row.id, bucket)
    }
    recogVerify.value = { issues, manual, rounds: checkRounds.value, engine }
  } catch {
    /* 质检失败不阻塞识别确认：不留痕，按未质检处理 */
  }
}

async function startRecognize(row: OrgFile) {
  recogFile.value = row
  recogResult.value = null
  recogVerify.value = null
  recogFailReason.value = ''
  recogPreview.value = ''
  recogPhase.value = 'running'
  recogProgress.value = 0
  recogOpen.value = true
  /* 真实图片文件先备好预览 */
  const raw = fileContentOf(row.id)
  if (row.kind === 'image' && raw) recogPreview.value = URL.createObjectURL(raw)
  window.clearInterval(recogTimer)
  recogTimer = window.setInterval(() => {
    recogProgress.value = Math.min(97, recogProgress.value + 5 + Math.random() * 6)
  }, 260)
  try {
    const result = await recognizeFileContent(row)
    recogResult.value = result
    recogPhase.value = 'edit'
    /* 识别完成即按设置轮次做 AI 质检（修正版直接呈现在确认列表里） */
    await runVerify(result)
  } catch (error) {
    recogFailReason.value = error instanceof Error ? error.message : '识别失败'
    recogPhase.value = 'failed'
  } finally {
    window.clearInterval(recogTimer)
    recogProgress.value = 100
  }
}

function closeRecognize() {
  window.clearInterval(recogTimer)
  if (recogPreview.value) URL.revokeObjectURL(recogPreview.value)
  recogOpen.value = false
  recogFile.value = null
  recogResult.value = null
}

/** 修改题型时同步选项结构：客观题保底 4 个空选项，主观题清空选项 */
function onRecogTypeChange(q: RecognizedQuestion) {
  if (isChoiceType(q.type)) {
    if (!q.options.length) q.options = q.type === '判断题' ? ['正确', '错误'] : ['', '', '', '']
    q.score = 5
  } else {
    q.options = []
    q.score = 12
  }
}

async function submitRecognize() {
  const row = recogFile.value
  const result = recogResult.value
  if (!row || !result) return
  const picked = result.questions.filter((q) => q.include)
  if (!picked.length) {
    showToast('请至少勾选 1 道题目', 'error')
    return
  }
  try {
    const { questionCount, paperId } = await importRecognizedFile(row.id, {
      makePaper: result.isPaper,
      paperName: result.paperName,
      questions: result.questions.map((q) => ({
        stem: q.stem,
        options: isChoiceType(q.type) ? q.options.filter((opt) => toPlainText(opt).trim() || hasImage(opt)) : [],
        answer: q.answer,
        analysis: q.analysis,
        subject: q.subject,
        grade: q.grade,
        type: q.type,
        difficulty: q.difficulty,
        knowledge: q.knowledge,
        score: q.score,
        include: q.include,
      })),
    })
    closeRecognize()
    await load()
    showToast(
      paperId != null
        ? `入库完成：${questionCount} 题入题库（待终审），草稿试卷 #${paperId} 已生成`
        : `入库完成：${questionCount} 题入题库（待终审）`,
      'success',
    )
  } catch (error) {
    showToast(error instanceof Error ? error.message : '入库失败', 'error')
  }
}

function onPreview(row: OrgFile) {
  showToast(`《${row.name}》预览打开（${row.sizeMb} MB）`, 'success')
}
function onDownload(row: OrgFile) {
  showToast(`《${row.name}》开始下载`, 'success')
}

async function onDelete(row: OrgFile) {
  if (!window.confirm(`删除《${row.name}》？将进入回收站保留 30 天`)) return
  await deleteFile(row.id)
  showToast('已移入回收站', 'success')
  load()
}

onMounted(load)
</script>

<template>
  <div class="file-layout">
    <!-- 左：文件夹树 -->
    <div class="panel folder-panel">
      <div class="section-title">
        文件夹
        <button class="mini-btn" type="button" @click="openFolderCreate(0)"><AppIcon name="plus" :size="12" /> 新建</button>
      </div>
      <div class="folder-list">
        <div
          v-for="{ folder, depth } in treeRows"
          :key="folder.id"
          class="folder-row"
          :class="{ on: activeFolder === folder.id, root: depth === 0 }"
          :style="{ paddingLeft: `${10 + depth * 18}px` }"
          @click="activeFolder = folder.id"
        >
          <AppIcon :name="depth === 0 && folder.id !== 0 ? 'chevron-right' : 'folder'" :size="14" />
          <span class="fr-name">{{ folder.name }}</span>
          <span class="fr-count">{{ files.filter((row) => row.folderId === folder.id).length }}</span>
          <span v-if="folder.id !== 0" class="fr-ops" @click.stop>
            <button class="mini-btn" type="button" @click="openFolderCreate(folder.id)">+</button>
            <button class="mini-btn" type="button" @click="openFolderRename(folder)">改</button>
            <button class="mini-btn danger" type="button" @click="onDeleteFolder(folder)">删</button>
          </span>
        </div>
      </div>
      <!-- 容量 -->
      <div class="usage-box">
        <div class="usage-row">
          <span>存储用量</span>
          <span>{{ usage.usedGb }} / {{ usage.quotaGb }} GB</span>
        </div>
        <div class="usage-track"><div class="usage-fill" :style="{ width: `${usagePercent}%` }" /></div>
        <p class="f-hint">套餐容量 {{ usage.quotaGb }} GB，超容将限制上传</p>
      </div>
    </div>

    <!-- 右：文件表 -->
    <div class="panel table-panel">
      <div class="filter-bar">
        <input v-model="keyword" class="f-input search-box" placeholder="搜索文件名" style="width: 220px" />
        <span class="f-hint">当前：{{ activeFolder === 0 ? '全部文件' : folderName(activeFolder) }}（{{ visibleFiles.length }}）</span>
        <label class="rounds-pick" title="识别后自动复核答案/解析的轮数；超轮仍有异常将提醒人工介入">
          AI 检查轮次
          <select v-model.number="checkRounds" class="f-select" @change="onRoundsChange">
            <option :value="0">关闭</option>
            <option :value="1">1 轮</option>
            <option :value="2">2 轮</option>
            <option :value="3">3 轮</option>
          </select>
        </label>
        <button class="btn btn-primary btn-sm" style="margin-left: auto" @click="uploadTarget = activeFolder; uploadOpen = true">
          <AppIcon name="upload" :size="14" /> 上传文件
        </button>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>文件名</th>
            <th>类型</th>
            <th>大小</th>
            <th>所属文件夹</th>
            <th>识别状态</th>
            <th>上传人</th>
            <th>上传时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="visibleFiles.length === 0">
            <td colspan="8" class="empty-row">暂无文件</td>
          </tr>
          <template v-else>
            <tr v-for="row in visibleFiles" :key="row.id">
              <td class="cell-strong">
                <span class="file-ico"><AppIcon :name="KIND_ICON[row.kind]" :size="14" /></span>
                {{ row.name }}
              </td>
              <td>{{ row.kind.toUpperCase() }}</td>
              <td>{{ row.sizeMb }} MB</td>
              <td>{{ folderName(row.folderId) }}</td>
              <td><span class="tag" :class="RECOGNIZE_CLASS[row.recognize]">{{ RECOGNIZE_TEXT[row.recognize] }}</span></td>
              <td>{{ row.owner }}</td>
              <td>{{ row.uploadedAt }}</td>
              <td>
                <div class="op-group">
                  <button class="mini-btn" @click="onPreview(row)">预览</button>
                  <button v-if="row.recognize === 'none'" class="mini-btn success" @click="startRecognize(row)">识别入库</button>
                  <button class="mini-btn" @click="onDownload(row)">下载</button>
                  <button class="mini-btn danger" @click="onDelete(row)">删除</button>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <!-- 文件夹弹窗 -->
    <AppModal
      v-if="catEditing"
      :title="catEditing.id ? '重命名文件夹' : '新建文件夹'"
      :width="400"
      @close="catEditing = null"
    >
      <div class="f-field">
        <label class="f-label">文件夹名称<span class="req">*</span></label>
        <input v-model="catEditing.name" class="f-input" placeholder="≤20 字" maxlength="20" />
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="catEditing = null">取消</button>
        <button class="btn btn-primary" @click="submitFolder">保存</button>
      </template>
    </AppModal>

    <!-- 上传弹窗（真实文件；实体留在内存里供 AI 识别） -->
    <AppModal v-if="uploadOpen" title="上传文件" :width="460" @close="uploadOpen = false">
      <div class="f-field">
        <label class="f-label">目标文件夹</label>
        <select v-model="uploadTarget" class="f-select">
          <option :value="0">全部文件（根目录）</option>
          <option v-for="f in folders.filter((row) => row.id !== 0)" :key="f.id" :value="f.id">{{ f.name }}</option>
        </select>
      </div>
      <div class="f-field">
        <label class="f-label">文件（支持 pdf / word / ppt / 图片 / zip，单文件 ≤200MB；图片可直接 AI 识别）</label>
        <input
          ref="fileInput"
          type="file"
          multiple
          hidden
          accept=".pdf,.doc,.docx,.ppt,.pptx,.jpg,.jpeg,.png,.webp,.gif,.zip"
          @change="onFilesPicked"
        />
        <button class="btn btn-ghost btn-sm" type="button" @click="onPickFiles"><AppIcon name="plus" :size="14" /> 选择文件</button>
        <div v-if="uploadPending.length" class="pending-list">
          <span v-for="(file, i) in uploadPending" :key="`${file.name}-${i}`" class="pending-chip">
            {{ file.name }}（{{ fmtSize(file.size / 1048576) }}）
            <button class="chip-x" type="button" @click="uploadPending.splice(i, 1)"><AppIcon name="close" :size="11" /></button>
          </span>
        </div>
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="uploadOpen = false">取消</button>
        <button class="btn btn-primary" :disabled="!uploadPending.length" @click="submitUpload">上传（{{ uploadPending.length }}）</button>
      </template>
    </AppModal>

    <!-- AI 识别：进度 → 确认编辑 → 入库 -->
    <AppModal v-if="recogOpen" :title="`AI 识别 · ${recogFile?.name ?? ''}`" :width="920" @close="closeRecognize">
      <!-- 进度 -->
      <div v-if="recogPhase === 'running'" class="recog-running">
        <div class="run-ring"><AppIcon name="sparkles" :size="30" /></div>
        <p class="run-title">AI 正在识别文档内容…</p>
        <div class="run-steps">
          <span>提取文档题目</span>
          <span>判定试卷/题集类型</span>
          <span>结构化公式与图形</span>
        </div>
        <div class="progress-track"><div class="progress-fill" :style="{ width: `${recogProgress}%` }" /></div>
        <p class="f-hint">{{ recogProgress < 100 ? '正在调用大模型…' : '整理识别结果…' }}</p>
      </div>

      <!-- 失败 -->
      <div v-else-if="recogPhase === 'failed'" class="recog-failed">
        <AppIcon name="warning" :size="30" />
        <p>{{ recogFailReason }}</p>
        <button class="btn btn-ghost btn-sm" @click="recogFile && startRecognize(recogFile)">重试</button>
      </div>

      <!-- 确认编辑 -->
      <div v-else-if="recogResult" class="recog-layout">
        <!-- 左：原文件预览 -->
        <div class="origin-pane">
          <div class="pane-title">原始文件</div>
          <img v-if="recogPreview" class="origin-img" :src="recogPreview" :alt="recogFile?.name" />
          <div v-else class="origin-card">
            <AppIcon :name="recogFile ? KIND_ICON[recogFile.kind] : 'file'" :size="36" />
            <p class="origin-name">{{ recogFile?.name }}</p>
            <p class="f-hint">{{ recogFile ? fmtSize(recogFile.sizeMb) : '' }}</p>
          </div>
        </div>

        <!-- 右：结构化结果（逐题可改） -->
        <div class="struct-pane">
          <div class="pane-title">
            识别结果（{{ recogResult.questions.length }} 题）
            <span class="tag" :class="recogResult.engine === 'ai' ? 'tag-green' : 'tag-gray'" style="margin-left: 8px">
              {{ recogResult.engine === 'ai' ? '真实 AI' : '本地演示' }}
            </span>
          </div>

          <!-- AI 质检结论条：超轮仍有异常 → 提醒人工介入处理 -->
          <div v-if="recogVerify" class="verify-banner" :class="{ manual: recogVerify.manual }">
            <AppIcon :name="recogVerify.manual ? 'warning' : 'check'" :size="15" />
            <span v-if="recogVerify.manual">
              AI 质检 {{ recogVerify.rounds }} 轮后仍有 {{ recogVerify.issues.size }} 题存在异常（如答案存疑），<b>请人工核对后再入库</b>。
            </span>
            <span v-else>
              AI 质检 {{ recogVerify.rounds }} 轮通过{{ recogVerify.engine === 'deepseek' ? '' : '（本地演示）' }}，答案与解析已复核{{ recogVerify.issues.size ? '，个别题目有提醒请留意' : '' }}。
            </span>
          </div>

          <!-- 试卷结论 -->
          <div class="paper-judge">
            <label class="pj-check">
              <input v-model="recogResult.isPaper" type="checkbox" />
              识别为<b>完整试卷</b>（入库时生成草稿试卷）
            </label>
            <input v-if="recogResult.isPaper" v-model="recogResult.paperName" class="f-input" placeholder="试卷名称" />
          </div>

          <div v-for="(q, qi) in recogResult.questions" :key="q.key" class="recog-q" :class="{ off: !q.include }">
            <div class="rq-head">
              <label class="rq-include">
                <input v-model="q.include" type="checkbox" />
                <b>第 {{ qi + 1 }} 题</b>
              </label>
              <select v-model="q.type" class="f-select rq-type" @change="onRecogTypeChange(q)">
                <option v-for="t in questionTypes" :key="t" :value="t">{{ t }}</option>
              </select>
              <select v-model="q.subject" class="f-select rq-meta">
                <option v-for="s in subjects" :key="s" :value="s">{{ optionLabel(subjects, s) }}</option>
              </select>
              <select v-model="q.grade" class="f-select rq-meta">
                <option v-for="g in grades" :key="g" :value="g">{{ optionLabel(grades, g) }}</option>
              </select>
              <select v-model="q.difficulty" class="f-select rq-meta">
                <option v-for="d in difficulties" :key="d" :value="d">{{ d }}</option>
              </select>
              <label class="rq-score">分值 <input v-model.number="q.score" type="number" min="0.5" max="100" step="0.5" class="f-input" /></label>
              <!-- 逐题质检打标：异常红 / 提醒橙 -->
              <span
                v-for="(issue, ii) in recogVerify?.issues.get(q.key) ?? []"
                :key="ii"
                class="tag"
                :class="issue.level === 'error' ? 'tag-red' : 'tag-orange'"
                :title="issue.message"
              >
                质检{{ issue.level === 'error' ? '异常' : '提醒' }} · {{ issue.aspect }}
              </span>
              <button class="mini-btn danger" type="button" @click="recogResult?.questions.splice(qi, 1)">删除</button>
            </div>
            <label class="f-label">题干</label>
            <RichTextEditor v-model="q.stem" :subject="q.subject" :min-height="70" placeholder="识别出的题干，可直接修正" />
            <template v-if="isChoiceType(q.type)">
              <label class="f-label" style="margin-top: 8px">选项</label>
              <div v-for="(opt, oi) in q.options" :key="oi" class="rq-opt">
                <span class="rq-letter">{{ 'ABCDEF'[oi] }}</span>
                <RichTextEditor v-model="q.options[oi]" class="rq-opt-editor" compact :subject="q.subject" :min-height="36" :placeholder="`选项 ${'ABCDEF'[oi]}`" />
                <button v-if="q.options.length > 2 && q.type !== '判断题'" class="mini-btn danger" type="button" @click="q.options.splice(oi, 1)">删</button>
              </div>
              <button v-if="q.type !== '判断题' && q.options.length < 6" class="btn btn-ghost btn-sm" type="button" @click="q.options.push('')">
                <AppIcon name="plus" :size="13" /> 添加选项
              </button>
              <label class="f-label" style="margin-top: 8px">答案（选项字母，多选连写如 AC）</label>
              <input v-model="q.answer" class="f-input" placeholder="如 A 或 AC" />
            </template>
            <template v-else>
              <label class="f-label" style="margin-top: 8px">答案（主观题，支持公式）</label>
              <RichTextEditor v-model="q.answer" :subject="q.subject" :min-height="70" placeholder="参考答案，可用公式按钮插入 LaTeX" />
            </template>
            <label class="f-label" style="margin-top: 8px">解析</label>
            <RichTextEditor v-model="q.analysis" :subject="q.subject" :min-height="60" placeholder="解析（选填）" />
          </div>
          <p v-if="!recogResult.questions.length" class="f-hint">识别结果为空，可重试或放弃</p>
        </div>
      </div>

      <template #footer>
        <button class="btn btn-ghost" @click="closeRecognize">取消</button>
        <button v-if="recogPhase === 'edit'" class="btn btn-primary" :disabled="!recogResult?.questions.some((q) => q.include)" @click="submitRecognize">
          确认入库（消耗 1 次 AI 额度）
        </button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.file-layout { display: grid; grid-template-columns: 250px 1fr; gap: 14px; align-items: start; }

.folder-panel { padding: 12px; position: sticky; top: 0; }
.folder-list { display: flex; flex-direction: column; gap: 2px; }
.folder-row {
  display: flex; align-items: center; gap: 7px;
  padding: 7px 10px; border-radius: 8px; cursor: pointer;
  color: var(--ink-2); font-size: 13px;
}
.folder-row:hover { background: #f4f8f8; }
.folder-row.on { background: var(--brand-soft); color: var(--brand-deep); font-weight: 600; }
.folder-row.root { font-weight: 600; }
.fr-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fr-count { font-size: 11.5px; color: var(--sub); }
.fr-ops { display: none; gap: 3px; }
.folder-row:hover .fr-ops { display: flex; }

.usage-box { border-top: 1px solid var(--border); margin-top: 12px; padding-top: 12px; }
.usage-row { display: flex; justify-content: space-between; font-size: 12.5px; color: var(--ink-2); margin-bottom: 6px; }
.usage-track { height: 7px; border-radius: 999px; background: var(--border); overflow: hidden; }
.usage-fill { height: 100%; background: linear-gradient(90deg, var(--brand), var(--brand-deep)); }

.table-panel { padding: 14px 16px; }
.file-ico { display: inline-flex; color: var(--brand-deep); margin-right: 5px; }

.rounds-pick {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12.5px; color: var(--sub); white-space: nowrap;
}
.rounds-pick .f-select { width: 84px; height: 32px; font-size: 12.5px; }

/* AI 质检结论条：通过绿 / 超轮异常红 */
.verify-banner {
  display: flex; align-items: center; gap: 8px;
  border-radius: 10px; padding: 9px 12px; margin-bottom: 12px;
  font-size: 13px; line-height: 1.6;
  background: var(--success-soft); color: var(--success);
  border: 1px solid rgba(16, 142, 90, 0.3);
}
.verify-banner.manual { background: var(--danger-soft); color: var(--danger); border-color: rgba(214, 69, 69, 0.35); }

.pending-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.pending-chip {
  display: inline-flex; align-items: center; gap: 6px;
  background: #fff; border: 1px solid var(--border); border-radius: 8px;
  font-size: 12.5px; color: var(--ink-2); padding: 4px 10px;
}
.chip-x { display: flex; color: var(--sub); }

/* ===== AI 识别弹窗 ===== */
.recog-running { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 18px 0 8px; }
.run-ring {
  width: 64px; height: 64px; border-radius: 50%;
  background: var(--brand-soft); color: var(--brand-deep);
  display: flex; align-items: center; justify-content: center;
  animation: ring-pulse 1.6s ease-in-out infinite;
}
@keyframes ring-pulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(0.92); opacity: 0.75; } }
.run-title { font-size: 14.5px; font-weight: 600; color: var(--ink); }
.run-steps { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
.run-steps span { font-size: 12px; color: var(--sub); background: #f5f8f8; border-radius: 999px; padding: 3px 10px; }
.progress-track { width: 100%; height: 7px; border-radius: 999px; background: var(--border); overflow: hidden; }
.progress-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--brand), var(--brand-deep)); transition: width 0.25s; }
.recog-failed { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 16px 0; color: var(--ink-2); }

.recog-layout { display: grid; grid-template-columns: 280px 1fr; gap: 14px; align-items: start; }
.origin-pane {
  border: 1px solid var(--border); border-radius: 10px; padding: 12px;
  background: #f7fafa; position: sticky; top: 0;
}
.pane-title { font-size: 13px; font-weight: 700; color: var(--ink); margin-bottom: 10px; display: flex; align-items: center; }
.origin-img { width: 100%; border-radius: 8px; border: 1px solid var(--border); }
.origin-card { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 28px 10px; color: var(--brand-deep); }
.origin-name { margin: 0; font-size: 12.5px; color: var(--ink-2); word-break: break-all; text-align: center; }

.struct-pane { min-width: 0; }
.paper-judge {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  border: 1px dashed var(--border); border-radius: 10px;
  padding: 10px 12px; margin-bottom: 12px; background: #fff;
}
.pj-check { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--ink-2); }
.paper-judge .f-input { width: 260px; }

.recog-q { border: 1px solid var(--border); border-radius: 10px; padding: 12px; margin-bottom: 12px; background: #fff; }
.recog-q.off { opacity: 0.55; }
.rq-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.rq-include { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--ink); }
.rq-type { width: 96px; }
.rq-meta { width: 88px; }
.rq-score { display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--sub); margin-left: auto; }
.rq-score .f-input { width: 64px; }
.rq-opt { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.rq-letter {
  width: 24px; height: 24px; flex-shrink: 0; border-radius: 6px;
  background: var(--brand-soft); color: var(--brand-deep);
  font-size: 12px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
}
.rq-opt-editor { flex: 1; min-width: 0; }
</style>
