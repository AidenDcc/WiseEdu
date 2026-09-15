<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { AppIcon, showToast } from '@aiteach/shared'
import type { FileFolder, OrgFile } from '@aiteach/shared'
import AppModal from '@/components/ui/AppModal.vue'
import {
  deleteFile,
  deleteFolder,
  fetchFiles,
  fetchFolders,
  recognizeFile,
  saveFolder,
  uploadFiles,
} from '@/api/org'

const folders = ref<FileFolder[]>([])
const files = ref<OrgFile[]>([])
const usage = ref({ usedGb: 0, quotaGb: 1 })

const activeFolder = ref(0)
const keyword = ref('')

async function load() {
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

/* ===== 上传 ===== */
const uploadOpen = ref(false)
const uploadNames = ref<string[]>([])
const uploadTarget = ref(0)

function onAddUpload() {
  const name = window.prompt('输入模拟文件名（如：期末复习题集.pdf）', `新文件-${Date.now() % 1000}.pdf`)
  if (name) uploadNames.value.push(name)
}

async function submitUpload() {
  if (!uploadNames.value.length) return
  await uploadFiles(uploadNames.value, uploadTarget.value)
  uploadOpen.value = false
  uploadNames.value = []
  showToast('上传完成', 'success')
  load()
}

/* ===== 识别入库（FR-FL-004/005，含额度确认） ===== */
async function onRecognize(row: OrgFile) {
  if (
    !window.confirm(
      `对《${row.name}》执行文档识别入库？\n预计消耗 1 次 AI 额度，识别结果：拆题入题库 + 生成草稿试卷。`,
    )
  ) {
    return
  }
  try {
    const { questionCount, paperId } = await recognizeFile(row.id)
    await load()
    showToast(`识别完成：${questionCount} 题入题库（待终审），草稿试卷 #${paperId} 已生成`, 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '识别失败', 'error')
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
                  <button v-if="row.recognize === 'none'" class="mini-btn success" @click="onRecognize(row)">识别入库</button>
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

    <!-- 上传弹窗 -->
    <AppModal v-if="uploadOpen" title="上传文件" :width="460" @close="uploadOpen = false">
      <div class="f-field">
        <label class="f-label">目标文件夹</label>
        <select v-model="uploadTarget" class="f-select">
          <option :value="0">全部文件（根目录）</option>
          <option v-for="f in folders.filter((row) => row.id !== 0)" :key="f.id" :value="f.id">{{ f.name }}</option>
        </select>
      </div>
      <div class="f-field">
        <label class="f-label">文件（支持 pdf / word / ppt / 图片 / zip，单文件 ≤200MB）</label>
        <button class="btn btn-ghost btn-sm" type="button" @click="onAddUpload"><AppIcon name="plus" :size="14" /> 添加文件</button>
        <div v-if="uploadNames.length" class="pending-list">
          <span v-for="(name, i) in uploadNames" :key="i" class="pending-chip">
            {{ name }}
            <button class="chip-x" type="button" @click="uploadNames.splice(i, 1)"><AppIcon name="close" :size="11" /></button>
          </span>
        </div>
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="uploadOpen = false">取消</button>
        <button class="btn btn-primary" :disabled="!uploadNames.length" @click="submitUpload">上传（{{ uploadNames.length }}）</button>
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

.pending-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.pending-chip {
  display: inline-flex; align-items: center; gap: 6px;
  background: #fff; border: 1px solid var(--border); border-radius: 8px;
  font-size: 12.5px; color: var(--ink-2); padding: 4px 10px;
}
.chip-x { display: flex; color: var(--sub); }
</style>
