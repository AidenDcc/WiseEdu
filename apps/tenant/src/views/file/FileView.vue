<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AppIcon, AppSearchInput, AppSegmented, appConfirm, FILE_KIND_COLOR, FILE_KIND_GROUPS, FILE_KIND_ICON, FILE_KIND_TEXT, UPLOAD_KIND_TEXT, hasImage, showToast, toPlainText, AppModal } from '@aiteach/shared'
import type { FileFolder, OrgFile } from '@aiteach/shared'
import AppDropdownMenu from '@/components/ui/AppDropdownMenu.vue'
import RichTextEditor from '@/components/ui/RichTextEditor.vue'
import {
  convertToCourseware,
  copyFiles,
  createFile,
  deleteFiles,
  deleteFolder,
  duplicateFile,
  fetchFiles,
  fetchFolders,
  importRecognizedFile,
  moveFiles,
  moveFolder,
  pinFile,
  pinFolder,
  renameFile,
  saveFolder,
  uploadFiles,
} from '@/api/org'
import {
  fileContentOf,
  recognizeFileContent,
  registerFileContent,
} from '@/api/ai-file'
import type { FileRecognizeResult, RecognizedQuestion } from '@/api/ai-file'
import { useBaseData } from '@/composables/useBaseData'
import { downloadFile, formatFileSize } from '@/utils/file'

/**
 * 我的文件（FR-FL-001 ~ 005）：网盘式文件管理器。
 *
 * - 目录层级用面包屑导航，文件夹与文件同列展示（文件夹恒排在前），目录进 URL（`?folder=`）；
 * - 列表 / 大图两种视图共用同一份排好序的行数据，行内操作走共用的 ⋯ 菜单（AppDropdownMenu）；
 * - 文件名与目录名都可点：目录名进目录，文件名开预览弹窗；
 * - 「创建者」列：自己的文件显示「我」，别人分享来的显示分享者姓名 + 分享标志（取自 `OrgFile.shared`）；
 * - 文件类型分三组共 17 种（见 models 的 FILE_KIND_GROUPS），类型文案、图标、图标底色、
 *   筛选面板的分组与上传格式的落点全部由那一份类型表推导，页面里不另写一份；
 * - 筛选是按钮下方的浮层（不占页面高度，列表不会被推开）：类型按三组勾选，勾选先落在草稿上，
 *   点「确认」才生效（中途关掉等于放弃，和一排 checkbox 的直觉一致 —— 边勾边变会把还没勾完的中间态也筛进去）；
 * - 支持新建文件夹、新建文档、上传、重命名、批量重命名、移动、复制到、删除、下载、预览、置顶等；
 * - 「AI 识别入库」= 上传 → 识别 → 逐题确认（可改）→ 入库，不做 AI 质检复核（复核入口在题库中心）。
 *
 * 预览与下载的字节来自 api/ai-file 的内存 Map（本次会话上传的文件才有实体），
 * 种子数据与系统产出的课件/讲义/试卷没有本地副本，一律走占位提示（写明它真正的家在哪）。
 */
const route = useRoute()
const router = useRouter()

const { subjects, grades, questionTypesFor, difficulties, ensure, optionLabel, withCurrent } = useBaseData()

const ROOT_ID = 0
const folders = ref<FileFolder[]>([])
const files = ref<OrgFile[]>([])
const usage = ref({ usedGb: 0, quotaGb: 1 })

const activeFolder = ref(ROOT_ID)
const keyword = ref('')

async function load() {
  await ensure()
  const [folderList, fileList] = await Promise.all([fetchFolders(), fetchFiles()])
  folders.value = folderList
  files.value = fileList.list
  usage.value = fileList.usage
  /* 当前目录可能刚被删掉（含被删目录的子孙，删除是递归的）——退回根目录并清掉 URL 里失效的 folder */
  if (!folders.value.some((row) => row.id === activeFolder.value)) {
    activeFolder.value = ROOT_ID
    if (route.query.folder) router.replace({ query: {} })
  }
}

/* ===== 目录导航（进 URL，刷新 / 后退可复原） ===== */
function syncFolderFromQuery() {
  const value = Number(route.query.folder ?? ROOT_ID)
  activeFolder.value = folders.value.some((row) => row.id === value) ? value : ROOT_ID
}
function enterFolder(id: number) {
  if (id === activeFolder.value) return
  router.replace({ query: id ? { folder: String(id) } : {} })
}
watch(() => route.query.folder, syncFolderFromQuery)

function folderById(id: number): FileFolder | undefined {
  return folders.value.find((row) => row.id === id)
}
function folderNameOf(id: number): string {
  return folderById(id)?.name ?? '—'
}
/** 目录及其全部子孙目录 id（搜索时向下钻取、移动时挡住自己的子孙） */
function descendantIds(id: number, acc: number[] = []): number[] {
  folders.value
    .filter((row) => row.parentId === id)
    .forEach((child) => {
      acc.push(child.id)
      descendantIds(child.id, acc)
    })
  return acc
}
/** 目录树（深度不限），供移动弹窗与面包屑祖先链使用 */
const folderTree = computed(() => {
  const rows: Array<{ folder: FileFolder; depth: number }> = []
  const walk = (parentId: number | null, depth: number) => {
    folders.value
      .filter((row) => row.parentId === parentId)
      .forEach((folder) => {
        rows.push({ folder, depth })
        walk(folder.id, depth + 1)
      })
  }
  walk(null, 0)
  return rows
})
const breadcrumb = computed<FileFolder[]>(() => {
  const path: FileFolder[] = []
  let cursor = folderById(activeFolder.value)
  while (cursor) {
    path.unshift(cursor)
    cursor = cursor.parentId === null ? undefined : folderById(cursor.parentId)
  }
  return path
})

/* ===== 列表行（文件夹 + 文件同一份模型，两种视图共用） ===== */
interface Row {
  key: string
  id: number
  type: 'folder' | 'file'
  name: string
  kindText: string
  sizeMb: number
  updatedAt: string
  folder: FileFolder
  file: OrgFile
  /** 创建者姓名（文件夹无此概念，给空串） */
  owner: string
  /** 是否由他人分享进来 —— 「创建者」列据它决定显示「我」还是「姓名 + 分享标志」 */
  shared: boolean
  /** 文件夹：直属子项数（大小列位置显示「N 项」） */
  childCount: number
  /** 关键字搜索命中子目录时的来源目录名 */
  location: string
}

const RECOGNIZE_TEXT: Record<OrgFile['recognize'], string> = { none: '未识别', recognizing: '识别中', done: '已识别入库', failed: '识别失败' }
/** 可走 AI 识别的载体（PPT 是讲稿不是题面，视频/音频/媒体类更没有可识别的文字，都不给这个入口） */
const RECOGNIZABLE_KINDS: OrgFile['kind'][] = ['doc', 'word', 'pdf', 'image', 'paper']
const RECOGNIZE_CLASS: Record<OrgFile['recognize'], string> = { none: 'tag-gray', recognizing: 'tag-blue', done: 'tag-green', failed: 'tag-red' }

function rowPinned(row: Row): boolean {
  return Boolean(row.type === 'folder' ? row.folder.pinned : row.file.pinned)
}

function folderRow(folder: FileFolder): Row {
  const childCount =
    folders.value.filter((row) => row.parentId === folder.id).length + files.value.filter((row) => row.folderId === folder.id).length
  return {
    key: `d${folder.id}`,
    id: folder.id,
    type: 'folder',
    name: folder.name,
    kindText: '文件夹',
    sizeMb: 0,
    updatedAt: '',
    folder,
    file: null as unknown as OrgFile,
    owner: '',
    shared: false,
    childCount,
    location: '',
  }
}
function fileRow(file: OrgFile, location = ''): Row {
  return {
    key: `f${file.id}`,
    id: file.id,
    type: 'file',
    name: file.name,
    kindText: FILE_KIND_TEXT[file.kind],
    sizeMb: file.sizeMb,
    updatedAt: file.updatedAt,
    folder: null as unknown as FileFolder,
    file,
    owner: file.owner,
    shared: Boolean(file.shared),
    childCount: 0,
    location,
  }
}

/* ===== 筛选（类型分组勾选，点「确认」生效；浮层由 AppDropdownMenu 的 panel 插槽承载） ===== */
/** 已生效的类型筛选；空数组 = 不筛 */
const kindFilter = ref<OrgFile['kind'][]>([])
/** 面板里的草稿勾选 —— 点「确认」才落到 kindFilter，中途关掉面板就是放弃这次改动 */
const kindDraft = ref<OrgFile['kind'][]>([])
const allKinds = FILE_KIND_GROUPS.flatMap((group) => group.kinds)
const allKindsChecked = computed(() => allKinds.every((kind) => kindDraft.value.includes(kind)))

/**
 * 打开浮层前把勾选重置为已生效的条件：上次没确认的草稿不该留在面板里。
 * 触发按钮的 click 由父组件先收到（子组件把 toggle 挂在包住按钮的 span 上，
 * 事件冒泡到那里更晚），所以传进来的 open 还是「打开前」的状态。
 */
function seedDraft(open: boolean) {
  if (!open) kindDraft.value = [...kindFilter.value]
}
function toggleAllKinds() {
  kindDraft.value = allKindsChecked.value ? [] : [...allKinds]
}
function toggleKind(kind: OrgFile['kind']) {
  const index = kindDraft.value.indexOf(kind)
  if (index >= 0) kindDraft.value.splice(index, 1)
  else kindDraft.value.push(kind)
}
function confirmFilter(close: () => void) {
  kindFilter.value = [...kindDraft.value]
  close()
}

/** 关键字命中当前目录及其子目录；无关键字时只看当前目录 */
const matchedFiles = computed(() => {
  const kw = keyword.value.trim()
  if (!kw) return files.value.filter((row) => row.folderId === activeFolder.value).map((row) => fileRow(row))
  const scope = new Set([activeFolder.value, ...descendantIds(activeFolder.value)])
  return files.value
    .filter((row) => scope.has(row.folderId) && row.name.includes(kw))
    .map((row) => fileRow(row, row.folderId === activeFolder.value ? '' : folderNameOf(row.folderId)))
})

const currentRows = computed<Row[]>(() => {
  const kw = keyword.value.trim()
  const folderRows = folders.value
    .filter((row) => row.parentId === activeFolder.value && (!kw || row.name.includes(kw)))
    .map(folderRow)
  const fileRows = matchedFiles.value.filter(
    (row) => !kindFilter.value.length || kindFilter.value.includes(row.file.kind),
  )
  return [...folderRows, ...fileRows]
})

/** 筛选按钮上括号里的数字 = 勾了几个类型（与面板里的勾选数一致，不是筛出的文件数） */
const filterCount = computed(() => kindFilter.value.length)

/* ===== 排序（表头点击与排序下拉共用同一份 state） ===== */
type SortField = 'name' | 'kind' | 'updatedAt' | 'size'
const SORT_TEXT: Record<SortField, string> = { name: '名称', kind: '文件类型', updatedAt: '更新时间', size: '大小' }
const sortField = ref<SortField>('updatedAt')
const sortOrder = ref<'asc' | 'desc'>('desc')

const sortedRows = computed(() => {
  const rows = [...currentRows.value]
  const order = sortOrder.value === 'asc' ? 1 : -1
  /* numeric: 让「试卷2」排在「试卷10」之前，否则是字典序 1 < 2 */
  const byName = (a: Row, b: Row) => a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true })
  return rows.sort((a, b) => {
    /* 系统文件夹的习惯：目录恒在文件之前 */
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
    /* 置顶项恒在同级最前，不随排序字段与升降序移动 */
    if (rowPinned(a) !== rowPinned(b)) return rowPinned(a) ? -1 : 1
    /* 目录没有大小与修改时间，非名称排序时按名称升序排，不跟着字段乱跳 */
    if (a.type === 'folder') return sortField.value === 'name' ? byName(a, b) * order : byName(a, b)
    let cmp = 0
    if (sortField.value === 'name') cmp = byName(a, b)
    else if (sortField.value === 'kind') cmp = a.kindText.localeCompare(b.kindText, 'zh-Hans-CN') || byName(a, b)
    else if (sortField.value === 'size') cmp = a.sizeMb - b.sizeMb
    else cmp = a.updatedAt.localeCompare(b.updatedAt)
    return cmp * order
  })
})

function sortBy(field: SortField) {
  if (field === sortField.value) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
    return
  }
  sortField.value = field
  sortOrder.value = field === 'name' || field === 'kind' ? 'asc' : 'desc'
}
const sortItems = computed(() =>
  (Object.keys(SORT_TEXT) as SortField[]).map((key) => ({
    key,
    label: key === sortField.value ? `${SORT_TEXT[key]} ${sortOrder.value === 'asc' ? '↑ 升序' : '↓ 降序'}` : SORT_TEXT[key],
  })),
)
function onSort(key: string) {
  sortBy(key as SortField)
}

/* ===== 视图切换 ===== */
const viewMode = ref('list')
const VIEW_MODES = [
  { value: 'list', label: '列表', icon: 'list-ul' },
  { value: 'grid', label: '大图', icon: 'grid' },
]
function setViewMode(value: string) {
  viewMode.value = value
}

/* ===== 时间与容量展示 ===== */
const DEFAULT_NOW = Date.now()
const loadedAt = ref(DEFAULT_NOW)

/**
 * mock 的时间戳是 toISOString 截出来的（UTC，且不带时区标记），
 * `new Date('2026-09-29T06:00:00')` 会按本地时间解析 —— 北京时间整体早 8 小时，
 * 刚上传的文件会显示成「今天 06:00」。这里显式补 Z 再换算回本地。
 */
function parseStamp(ts: string): number {
  const text = ts.trim().replace(' ', 'T')
  return new Date(/(?:Z|[+-]\d{2}:?\d{2})$/.test(text) ? text : `${text}Z`).getTime()
}
const pad2 = (n: number) => String(n).padStart(2, '0')
/** 完整时间戳：YYYY-MM-DD HH:mm:ss（本地） */
function formatStamp(ts: string): string {
  const at = parseStamp(ts)
  if (Number.isNaN(at)) return ts
  const d = new Date(at)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}
/** 更新时间：今天 / 昨天带日期词，更早的给完整年月日 —— 三种都精确到秒 */
function formatWhen(ts: string): string {
  if (!ts) return '—'
  const then = parseStamp(ts)
  if (Number.isNaN(then)) return ts
  const day = 86400000
  const startOfToday = new Date(loadedAt.value).setHours(0, 0, 0, 0)
  const minutes = Math.floor((loadedAt.value - then) / 60000)
  if (minutes < 1) return '刚刚'
  /* 一小时内用相对时间，秒级精度在这档没有意义 */
  if (minutes < 60) return `${minutes} 分钟前`
  const full = formatStamp(ts)
  if (then >= startOfToday) return `今天 ${full.slice(11)}`
  if (then >= startOfToday - day) return `昨天 ${full.slice(11)}`
  return full
}
const usagePercent = computed(() => Math.min(100, Math.round((usage.value.usedGb / usage.value.quotaGb) * 100)))

/* ===== 多选（约定同回收站：id 数组 + 全选/单选） ===== */
const selected = ref<string[]>([])
const selectedRows = computed(() => currentRows.value.filter((row) => selected.value.includes(row.key)))
/** 选中项以当前列表为准：切换目录/筛选后残留的 key 不计入，也不会让按钮显示成可点 */
const pickedCount = computed(() => selectedRows.value.length)
const allSelected = computed(() => currentRows.value.length > 0 && selected.value.length === currentRows.value.length)
function isSelected(key: string): boolean {
  return selected.value.includes(key)
}
function toggleRow(key: string) {
  const index = selected.value.indexOf(key)
  if (index >= 0) selected.value.splice(index, 1)
  else selected.value.push(key)
}
function toggleAll() {
  selected.value = allSelected.value ? [] : currentRows.value.map((row) => row.key)
}

/* ===== 新建 / 重命名 / 移动 / 删除 ===== */
type NodeMode = 'folder' | 'document' | 'rename-folder' | 'rename-file'
const nodeDialog = ref<null | { mode: NodeMode; id: number; name: string; parentId: number }>(null)
const NODE_TITLE: Record<NodeMode, string> = {
  folder: '新建文件夹',
  document: '新建文档',
  'rename-folder': '重命名文件夹',
  'rename-file': '重命名文件',
}
const createItems = [
  { key: 'folder', label: '新建文件夹', icon: 'folder-plus' },
  { key: 'document', label: '新建文档', icon: 'file' },
]
function onCreate(key: string) {
  nodeDialog.value =
    key === 'folder'
      ? { mode: 'folder', id: 0, name: '', parentId: activeFolder.value }
      : { mode: 'document', id: 0, name: '', parentId: activeFolder.value }
}
function onCreateSubFolder(folderId: number) {
  nodeDialog.value = { mode: 'folder', id: 0, name: '', parentId: folderId }
}
/**
 * 行图标的底色：文件按类型表取（FILE_KIND_COLOR），文件夹交给 `is-folder` 那条固定色。
 * 17 种类型逐个写 CSS 类会有三十多条重复规则，底色跟着类型表走就只用维护一份。
 */
function iconStyle(row: Row): Record<string, string> | undefined {
  return row.type === 'file' ? FILE_KIND_COLOR[row.file.kind] : undefined
}

/** 「创建者」列文案：分享进来的显示分享者姓名（另带分享标志），自己的显示「我」 */
function ownerText(row: Row): string {
  if (row.type === 'folder') return '—'
  return row.shared ? row.owner : '我'
}
function ownerTitle(row: Row): string {
  if (row.type === 'folder') return '文件夹没有创建者'
  return row.shared ? `由 ${row.owner} 分享给我` : '当前登录人创建'
}
function openRename(row: Row) {
  nodeDialog.value = {
    mode: row.type === 'folder' ? 'rename-folder' : 'rename-file',
    id: row.id,
    name: row.name,
    parentId: row.type === 'folder' ? row.folder.parentId ?? ROOT_ID : row.file.folderId,
  }
}
async function submitNode() {
  const dialog = nodeDialog.value
  if (!dialog) return
  const name = dialog.name.trim()
  if (!name) {
    showToast('名称不能为空', 'error')
    return
  }
  try {
    if (dialog.mode === 'folder') await saveFolder({ name, parentId: dialog.parentId })
    /* 新建的是在线文档（`doc`）：正文存平台，没有本地副本，所以名字也不带扩展名 */
    else if (dialog.mode === 'document') await createFile({ name, kind: 'doc', folderId: dialog.parentId })
    else if (dialog.mode === 'rename-folder') await saveFolder({ id: dialog.id, name, parentId: dialog.parentId })
    else await renameFile(dialog.id, name)
    nodeDialog.value = null
    showToast('已保存', 'success')
    await load()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '保存失败', 'error')
  }
}

/* 移动 / 复制到：弹窗里列出目录树；移动时屏蔽被移动目录自身与子孙 */
const pickerOpen = ref(false)
const pickerMode = ref<'move' | 'copy'>('move')
const pickerRows = ref<Row[]>([])
const pickerTarget = ref(ROOT_ID)
const PICKER_TEXT = {
  move: { title: '移动到', confirm: '移动到此处', done: '已移动' },
  copy: { title: '复制到', confirm: '复制到此处', done: '已复制' },
} as const
const pickerTargets = computed(() => {
  /* 复制不动原记录，不构成自环，目录树整份可用 */
  if (pickerMode.value === 'copy') return folderTree.value
  const blocked = new Set<number>()
  pickerRows.value
    .filter((row) => row.type === 'folder')
    .forEach((row) => {
      blocked.add(row.id)
      descendantIds(row.id).forEach((id) => blocked.add(id))
    })
  return folderTree.value.filter(({ folder }) => !blocked.has(folder.id))
})
function openPicker(mode: 'move' | 'copy', rows: Row[]) {
  if (!rows.length) return
  pickerMode.value = mode
  pickerRows.value = rows
  pickerTarget.value = activeFolder.value
  pickerOpen.value = true
}
function openMoveSelected() {
  openPicker('move', selectedRows.value)
}
async function submitPicker() {
  const rows = pickerRows.value
  if (!rows.length) return
  const mode = pickerMode.value
  const text = PICKER_TEXT[mode]
  try {
    const fileIds = rows.filter((row) => row.type === 'file').map((row) => row.id)
    if (mode === 'copy') await copyFiles(fileIds, pickerTarget.value)
    else {
      if (fileIds.length) await moveFiles(fileIds, pickerTarget.value)
      for (const row of rows.filter((item) => item.type === 'folder')) await moveFolder(row.id, pickerTarget.value)
    }
    pickerOpen.value = false
    selected.value = []
    showToast(`${text.done} ${rows.length} 项到「${folderNameOf(pickerTarget.value)}」`, 'success')
    await load()
  } catch (error) {
    showToast(error instanceof Error ? error.message : `${text.title}失败`, 'error')
  }
}

async function onDeleteRows(rows: Row[]) {
  if (!rows.length) return
  const label = rows.length === 1 ? `《${rows[0].name}》` : `选中的 ${rows.length} 项`
  if (!(await appConfirm(`删除 ${label}？将进入回收站保留 30 天`, { type: 'danger' }))) return
  try {
    const fileIds = rows.filter((row) => row.type === 'file').map((row) => row.id)
    if (fileIds.length) await deleteFiles(fileIds)
    for (const row of rows.filter((item) => item.type === 'folder')) await deleteFolder(row.id)
    selected.value = []
    showToast('已移入回收站', 'success')
    await load()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '删除失败', 'error')
  }
}
function onDeleteSelected() {
  onDeleteRows(selectedRows.value)
}

/* 批量重命名：统一加前缀 / 后缀（后缀插在扩展名之前），带前 3 条预览 */
const batchDialog = ref<null | { position: 'prefix' | 'suffix'; text: string }>(null)
function openBatchRename() {
  if (pickedCount.value) batchDialog.value = { position: 'prefix', text: '' }
}
function applyAffix(name: string, position: 'prefix' | 'suffix', text: string): string {
  const value = text.trim()
  if (!value) return name
  if (position === 'prefix') return `${value}${name}`
  const dot = name.lastIndexOf('.')
  return dot > 0 ? `${name.slice(0, dot)}${value}${name.slice(dot)}` : `${name}${value}`
}
const batchPreview = computed(() => {
  const dialog = batchDialog.value
  if (!dialog) return []
  return selectedRows.value.slice(0, 3).map((row) => ({ from: row.name, to: applyAffix(row.name, dialog.position, dialog.text) }))
})
async function submitBatchRename() {
  const dialog = batchDialog.value
  if (!dialog) return
  if (!dialog.text.trim()) {
    showToast('请输入要添加的前缀或后缀', 'error')
    return
  }
  try {
    for (const row of selectedRows.value) {
      const next = applyAffix(row.name, dialog.position, dialog.text)
      if (next === row.name) continue
      if (row.type === 'folder') await saveFolder({ id: row.id, name: next, parentId: row.folder.parentId ?? ROOT_ID })
      else await renameFile(row.id, next)
    }
    batchDialog.value = null
    selected.value = []
    showToast('批量重命名完成', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '批量重命名失败', 'error')
    batchDialog.value = null
  }
  await load()
}

/* ===== 预览 / 下载 ===== */
const preview = ref<null | { row: Row; url: string }>(null)
const previewKind = computed(() => {
  const current = preview.value
  if (!current?.url) return 'none'
  if (current.row.file.kind === 'image') return 'image'
  if (current.row.file.kind === 'video') return 'video'
  if (current.row.file.kind === 'audio') return 'audio'
  return 'none'
})
/** 没有本地字节的文件预览时的说明文案：讲清楚它真正的家在哪 */
const PREVIEW_HINT: Partial<Record<OrgFile['kind'], string>> = {
  doc: '在线文档，正文保存在平台内；编辑器将在后续版本接入。',
  word: 'Word 文档，下载后可用本地 Office 打开；在线预览与编辑将在后续版本接入。',
  ppt: 'PPT 演示文稿，下载后可用本地 Office 打开；在线预览将在后续版本接入。',
  paper: '试卷由题库组卷产出，可在「题库中心 → 试卷库」中打开与编辑。',
  aiPaper: 'AI 智能组卷产出的试卷，可在「题库中心 → 试卷库」中打开与编辑。',
  composePaper: '组卷工作台产出的试卷，可在「题库中心 → 试卷库」中打开与编辑。',
  courseware: '课件由备课中心维护，可在「备课中心 → 课件」中打开。',
  lecture: '讲义由备课中心维护，可在「备课中心 → 讲义」中打开。',
  book: '电子教辅，可在「教辅管理 → 教辅资料」中打开。',
  miniapp: '小程序资源，可在「教辅管理 → 小程序动画」中打开。',
  animation: '动画资源，可在「教辅管理 → 小程序动画」中打开。',
  h5: 'H5 互动资源随课程包分发，「我的文件」里只保留引用。',
  audio: '音频文件；在线试听需要文件实体，演示数据请下载后本地播放。',
}
const previewHint = computed(() => {
  const current = preview.value
  if (!current) return ''
  if (current.url) return ''
  return PREVIEW_HINT[current.row.file.kind] ?? '该文件暂不支持在线预览（演示数据没有本地副本），可下载后本地打开。'
})
/**
 * 系统产出的文件（试卷 / 课件 / 讲义 / 教辅 / 多媒体）在「我的文件」里只是引用，真正的家在别处。
 * 预览弹窗给一个跳转，否则「点文件名打开预览」这类文件只能看到一句提示。
 */
const PREVIEW_HOME: Partial<Record<OrgFile['kind'], { text: string; path: string }>> = {
  paper: { text: '去试卷库打开', path: '/paper/list' },
  aiPaper: { text: '去试卷库打开', path: '/paper/list' },
  composePaper: { text: '去试卷库打开', path: '/paper/list' },
  courseware: { text: '去备课中心打开', path: '/teach/courseware' },
  lecture: { text: '去备课中心打开', path: '/teach/lecture' },
  book: { text: '去教辅资料打开', path: '/material/list' },
  miniapp: { text: '去小程序动画打开', path: '/material/media/animation' },
  animation: { text: '去小程序动画打开', path: '/material/media/animation' },
}
const previewHome = computed(() => {
  const current = preview.value
  return current ? PREVIEW_HOME[current.row.file.kind] : undefined
})
function openPreviewHome() {
  const home = previewHome.value
  if (!home) return
  closePreview()
  router.push(home.path)
}
function openPreview(row: Row) {
  if (row.type !== 'file') return
  const raw = fileContentOf(row.file.id)
  preview.value = { row, url: raw ? URL.createObjectURL(raw) : '' }
}
function closePreview() {
  if (preview.value?.url) URL.revokeObjectURL(preview.value.url)
  preview.value = null
}
function onDownload(row: Row) {
  if (row.type !== 'file') return
  const raw = fileContentOf(row.file.id)
  if (!raw) {
    showToast(`《${row.name}》是演示数据，没有本地副本可下载`, 'info')
    return
  }
  downloadFile(raw)
  showToast(`《${row.name}》开始下载`, 'success')
}

/* ===== 行内 ⋯ 菜单（表格与大图共用） ===== */
interface MenuAction {
  key: string
  label: string
  icon?: string
  danger?: boolean
  disabled?: boolean
}
function menuItems(row: Row): MenuAction[] {
  if (row.type === 'folder') {
    return [
      { key: 'open', label: '打开', icon: 'folder' },
      { key: 'rename', label: '重命名', icon: 'pen' },
      { key: 'move', label: '移动到…', icon: 'move' },
      { key: 'new-folder', label: '新建子文件夹', icon: 'folder-plus' },
      { key: 'copy-id', label: '复制ID', icon: 'clipboard' },
      { key: 'pin', label: rowPinned(row) ? '取消置顶' : '置顶', icon: 'pin' },
      { key: 'delete', label: '删除', icon: 'trash', danger: true },
    ]
  }
  const items: MenuAction[] = [
    { key: 'preview', label: '预览', icon: 'eye' },
    { key: 'edit', label: '编辑', icon: 'edit' },
    { key: 'download', label: '下载', icon: 'download' },
    { key: 'copy-to', label: '复制到…', icon: 'copy' },
    { key: 'rename', label: '重命名', icon: 'pen' },
    { key: 'move', label: '移动到…', icon: 'move' },
    { key: 'share', label: '分享', icon: 'share' },
    { key: 'duplicate', label: '创建副本', icon: 'duplicate' },
    { key: 'copy-id', label: '复制ID', icon: 'clipboard' },
    { key: 'locate', label: '定位文件夹', icon: 'target' },
    { key: 'pin', label: rowPinned(row) ? '取消置顶' : '置顶', icon: 'pin' },
    { key: 'to-courseware', label: '转为课件', icon: 'layers', disabled: row.file.kind === 'courseware' },
  ]
  /* 识别只对文档/图片这类有文字的载体有意义：视频/音频/压缩包识别出来只会是空壳 */
  if (row.file.recognize === 'none' && RECOGNIZABLE_KINDS.includes(row.file.kind)) {
    items.push({ key: 'recognize', label: 'AI 识别入库', icon: 'sparkles' })
  }
  items.push({ key: 'delete', label: '删除', icon: 'trash', danger: true })
  return items
}

/* ---- 行内更多里的单项操作 ---- */

/** 复制文本：非安全上下文（http 访问局域网 IP）没有 navigator.clipboard，退回 execCommand */
function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).then(() => true, () => false)
  const area = document.createElement('textarea')
  area.value = text
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  const ok = document.execCommand('copy')
  document.body.removeChild(area)
  return Promise.resolve(ok)
}

function onEdit(row: Row) {
  if (row.type !== 'file') return
  const where: Partial<Record<OrgFile['kind'], string>> = {
    courseware: '课件请在「备课中心 → 课件」中编辑',
    lecture: '讲义请在「备课中心 → 讲义」中编辑',
    paper: '试卷请在「题库中心 → 试卷库」中编辑',
  }
  showToast(where[row.file.kind] ?? '该类型支持整份预览，编辑请下载后在本地进行', 'info')
}

/** 分享：生成对外链接并复制（mock 只有链接本身，没有真正的公开页） */
async function onShare(row: Row) {
  const link = `${window.location.origin}/s/${row.type === 'folder' ? 'd' : 'f'}${row.id}`
  const ok = await copyText(link)
  showToast(ok ? `已复制分享链接（演示环境未接入对外公开页）：${link}` : `分享链接：${link}`, ok ? 'success' : 'info')
}

async function onCopyId(row: Row) {
  const ok = await copyText(String(row.id))
  showToast(ok ? `已复制 ${row.type === 'folder' ? '文件夹' : '文件'} ID：${row.id}` : `ID：${row.id}`, ok ? 'success' : 'info')
}

async function onDuplicate(row: Row) {
  if (row.type !== 'file') return
  try {
    const copy = await duplicateFile(row.id)
    showToast(`已创建副本《${copy.name}》`, 'success')
    await load()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '创建副本失败', 'error')
  }
}

async function onTogglePin(row: Row) {
  const pinned = !rowPinned(row)
  try {
    if (row.type === 'folder') await pinFolder(row.id, pinned)
    else await pinFile(row.id, pinned)
    showToast(pinned ? `已置顶《${row.name}》` : `已取消置顶《${row.name}》`, 'success')
    await load()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '操作失败', 'error')
  }
}

async function onConvertToCourseware(row: Row) {
  if (row.type !== 'file') return
  if (!(await appConfirm(`将《${row.name}》转为课件？转换后可在「备课中心 → 课件」中编辑`, { type: 'warning' }))) return
  try {
    await convertToCourseware(row.id)
    showToast('已转为课件，可在「备课中心 → 课件」中编辑', 'success')
    await load()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '转为课件失败', 'error')
  }
}

/** 定位文件夹：跳到它所在的目录并高亮该行（搜索跨目录时的「我到底在哪」） */
const flashKey = ref('')
let flashTimer = 0
function onLocate(row: Row) {
  const folderId = row.type === 'folder' ? row.folder.parentId ?? ROOT_ID : row.file.folderId
  window.clearTimeout(flashTimer)
  flashKey.value = row.key
  flashTimer = window.setTimeout(() => (flashKey.value = ''), 2400)
  if (folderId !== activeFolder.value) enterFolder(folderId)
  showToast(`已定位到「${folderNameOf(folderId)}」`, 'success')
}

function onRowAction(row: Row, key: string) {
  if (key === 'open') enterFolder(row.id)
  else if (key === 'preview') openPreview(row)
  else if (key === 'edit') onEdit(row)
  else if (key === 'download') onDownload(row)
  else if (key === 'copy-to') openPicker('copy', [row])
  else if (key === 'rename') openRename(row)
  else if (key === 'move') openPicker('move', [row])
  else if (key === 'new-folder') onCreateSubFolder(row.id)
  else if (key === 'share') onShare(row)
  else if (key === 'duplicate') onDuplicate(row)
  else if (key === 'copy-id') onCopyId(row)
  else if (key === 'locate') onLocate(row)
  else if (key === 'pin') onTogglePin(row)
  else if (key === 'to-courseware') onConvertToCourseware(row)
  else if (key === 'recognize' && row.type === 'file') startRecognize(row.file)
  else if (key === 'delete') onDeleteRows([row])
}

/* ===== 上传（真实文件；实体保留在 ai-file 的缓存里供 AI 识别用） ===== */
const uploadOpen = ref(false)
const uploadPending = ref<File[]>([])
const uploadTarget = ref(ROOT_ID)
const fileInput = ref<HTMLInputElement | null>(null)

function openUpload() {
  uploadTarget.value = activeFolder.value
  uploadOpen.value = true
}
function onPickFiles() {
  fileInput.value?.click()
}
function onFilesPicked(event: Event) {
  const input = event.target as HTMLInputElement
  /* 读出来先清空：不清的话同一个文件连选两次不会触发 change */
  const picked = Array.from(input.files ?? [])
  input.value = ''
  /* 不再按扩展名挡文件：认不出格式的就是「其它文件」，传上来照样有归宿，
     挡在挑文件这一步反而会让人以为自己选错了类型（弹窗里的格式清单只是说明，
     不是白名单，所以输入框也不设 accept） */
  /* 同名去重（后选的覆盖先选的），避免列表里出现两个分不清的同名文件 */
  picked.forEach((file) => {
    const dup = uploadPending.value.findIndex((row) => row.name === file.name)
    if (dup >= 0) uploadPending.value.splice(dup, 1)
    uploadPending.value.push(file)
  })
}
async function submitUpload() {
  if (!uploadPending.value.length) return
  const pending = [...uploadPending.value]
  try {
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
    await load()
  } catch (error) {
    /* 弹窗保持打开：报错文案里点名了哪个文件不支持，用户可以就地摘掉它再传 */
    showToast(error instanceof Error ? error.message : '上传失败', 'error')
  }
}

/* ===== AI 识别入库（FR-FL-004/005 扩展：先确认、可修改，再入库） ===== */

const CHOICE_TYPES = ['单选', '多选', '判断']
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
let recogTimer = 0

async function startRecognize(row: OrgFile) {
  recogFile.value = row
  recogResult.value = null
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
    if (!q.options.length) q.options = q.type === '判断' ? ['正确', '错误'] : ['', '', '', '']
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

onMounted(async () => {
  loadedAt.value = Date.now()
  await load()
  syncFolderFromQuery()
})
onBeforeUnmount(() => {
  closePreview()
  window.clearTimeout(flashTimer)
})
</script>

<template>
  <div class="page fm">
    <!-- 标题 + 主操作 -->
    <div class="fm-head">
      <h3 class="fm-title">我的文件<span class="fm-count">（共 {{ sortedRows.length }} 个）</span></h3>
      <div class="fm-head-ops">
        <AppSearchInput v-model="keyword" placeholder="搜索资源" :width="220" />
        <button class="btn btn-ghost btn-sm" title="刷新" @click="load"><AppIcon name="refresh" :size="15" /></button>
        <button class="btn btn-ghost btn-sm" @click="openUpload"><AppIcon name="upload" :size="15" /> 上传</button>
        <AppDropdownMenu :items="createItems" :width="150" @select="onCreate">
          <button class="btn btn-primary btn-sm" type="button"><AppIcon name="plus" :size="15" /> 新建</button>
        </AppDropdownMenu>
      </div>
    </div>

    <!-- 筛选 / 批量 / 排序 / 视图 -->
    <div class="fm-bar">
      <!-- 筛选：浮层挂在按钮下方，列表不再被面板推开；面板内容见下面的 panel 插槽 -->
      <AppDropdownMenu :width="376" align="left">
        <template #default="{ open }">
          <button class="btn btn-ghost btn-sm" :class="{ on: open }" type="button" @click="seedDraft(open)">
            <AppIcon name="sliders" :size="15" /> 筛选<span v-if="filterCount">（{{ filterCount }}）</span>
          </button>
        </template>
        <template #panel="{ close }">
          <div class="fm-filter">
            <div class="fm-filter-row">
              <span class="fm-filter-label" />
              <label class="fm-check">
                <input type="checkbox" :checked="allKindsChecked" @change="toggleAllKinds" />
                <span>全选</span>
              </label>
            </div>
            <div v-for="group in FILE_KIND_GROUPS" :key="group.key" class="fm-filter-row">
              <span class="fm-filter-label">{{ group.text }}</span>
              <div class="fm-filter-opts">
                <label v-for="kind in group.kinds" :key="kind" class="fm-check">
                  <input type="checkbox" :checked="kindDraft.includes(kind)" @change="toggleKind(kind)" />
                  <span>{{ FILE_KIND_TEXT[kind] }}</span>
                </label>
              </div>
            </div>
            <div class="fm-filter-foot">
              <span class="f-hint">不勾 = 不限类型</span>
              <button class="btn btn-primary btn-sm" type="button" @click="confirmFilter(close)">确认</button>
            </div>
          </div>
        </template>
      </AppDropdownMenu>
      <span class="fm-divider" />
      <button class="btn btn-ghost btn-sm" type="button" :disabled="!pickedCount" @click="openMoveSelected">
        <AppIcon name="move" :size="15" /> 移动
      </button>
      <button class="btn btn-ghost btn-sm" type="button" :disabled="!pickedCount" @click="onDeleteSelected">
        <AppIcon name="trash" :size="15" /> 删除
      </button>
      <button class="btn btn-ghost btn-sm" type="button" :disabled="!pickedCount" @click="openBatchRename">
        <AppIcon name="pen" :size="15" /> 批量重命名
      </button>
      <span v-if="pickedCount" class="f-hint fm-picked">已选 {{ pickedCount }} 项</span>

      <div class="fm-bar-right">
        <AppDropdownMenu :items="sortItems" :width="170" @select="onSort">
          <button class="btn btn-ghost btn-sm" type="button" title="排序方式">
            <AppIcon name="sort" :size="15" />
            {{ SORT_TEXT[sortField] }}
            <AppIcon :name="sortOrder === 'asc' ? 'chevron-up' : 'chevron-down'" :size="13" />
          </button>
        </AppDropdownMenu>
        <AppSegmented :options="VIEW_MODES" :model-value="viewMode" @update:model-value="setViewMode" />
      </div>
    </div>

    <!-- 文件夹层级（点面包屑跳转） -->
    <nav class="fm-crumb">
      <template v-for="(node, index) in breadcrumb" :key="node.id">
        <AppIcon v-if="index" class="fm-crumb-sep" name="chevron-right" :size="13" />
        <button
          class="fm-crumb-btn"
          :class="{ on: index === breadcrumb.length - 1 }"
          type="button"
          @click="enterFolder(node.id)"
        >
          <AppIcon v-if="index === 0" name="folder" :size="14" />{{ node.name }}
        </button>
      </template>
      <span v-if="keyword.trim()" class="f-hint fm-crumb-hint">「{{ keyword.trim() }}」含子目录搜索结果</span>
    </nav>

    <div class="panel fm-panel">
      <p v-if="!sortedRows.length" class="empty-row">{{ keyword.trim() || filterCount ? '没有符合条件的文件' : '此文件夹为空，可上传文件或新建文档' }}</p>

      <!-- 列表视图 -->
      <div v-else-if="viewMode === 'list'" class="data-table-wrap">
        <table class="data-table fm-table">
          <thead>
            <tr>
              <th class="pick-col">
                <input type="checkbox" :checked="allSelected" @change="toggleAll" />
              </th>
              <th class="fm-th-sort" @click="sortBy('name')">
                名称<span v-if="sortField === 'name'" class="fm-arrow">{{ sortOrder === 'asc' ? '↑' : '↓' }}</span>
              </th>
              <th class="fm-col-ops"><span class="fm-sr">操作</span></th>
              <th class="fm-col-kind fm-sticky fm-th-sort" @click="sortBy('kind')">
                文件类型<span v-if="sortField === 'kind'" class="fm-arrow">{{ sortOrder === 'asc' ? '↑' : '↓' }}</span>
              </th>
              <th class="fm-col-time fm-sticky fm-th-sort" @click="sortBy('updatedAt')">
                更新时间<span v-if="sortField === 'updatedAt'" class="fm-arrow">{{ sortOrder === 'asc' ? '↑' : '↓' }}</span>
              </th>
              <th class="fm-col-size fm-sticky fm-th-sort" @click="sortBy('size')">
                大小<span v-if="sortField === 'size'" class="fm-arrow">{{ sortOrder === 'asc' ? '↑' : '↓' }}</span>
              </th>
              <th class="fm-col-owner fm-sticky">创建者</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in sortedRows"
              :key="row.key"
              :class="{ picked: isSelected(row.key), flash: flashKey === row.key }"
            >
              <td class="pick-col"><input type="checkbox" :checked="isSelected(row.key)" @change="toggleRow(row.key)" /></td>
              <td>
                <div class="fm-name-cell">
                  <span class="fm-ico" :class="{ 'is-folder': row.type === 'folder' }" :style="iconStyle(row)">
                    <AppIcon :name="row.type === 'folder' ? 'folder' : FILE_KIND_ICON[row.file.kind]" :size="16" />
                  </span>
                  <button v-if="row.type === 'folder'" class="fm-name fm-name-link" type="button" @click="enterFolder(row.id)">
                    {{ row.name }}
                  </button>
                  <!-- 文件名可点：与文件夹行「点名字进目录」对齐，「点名字看内容」 -->
                  <button
                    v-else
                    class="fm-name fm-name-link is-file"
                    type="button"
                    :title="`点击预览 · ${ownerTitle(row)} · ${formatStamp(row.file.uploadedAt)}`"
                    @click="openPreview(row)"
                  >
                    {{ row.name }}
                  </button>
                  <span v-if="rowPinned(row)" class="fm-pin" title="已置顶"><AppIcon name="pin" :size="12" /></span>
                  <span
                    v-if="row.type === 'file' && row.file.recognize !== 'none'"
                    class="tag"
                    :class="RECOGNIZE_CLASS[row.file.recognize]"
                  >
                    {{ RECOGNIZE_TEXT[row.file.recognize] }}
                  </span>
                  <span v-if="row.location" class="fm-loc">{{ row.location }}</span>
                </div>
              </td>
              <td class="fm-col-ops">
                <div class="fm-quick">
                  <button class="mini-btn" type="button" title="重命名" @click="openRename(row)">
                    <AppIcon name="pen" :size="15" />
                  </button>
                  <button class="mini-btn" type="button" title="移动到" @click="openPicker('move', [row])">
                    <AppIcon name="move" :size="15" />
                  </button>
                  <button v-if="row.type === 'file'" class="mini-btn" type="button" title="下载" @click="onDownload(row)">
                    <AppIcon name="download" :size="15" />
                  </button>
                  <AppDropdownMenu :items="menuItems(row)" :width="176" @select="(key) => onRowAction(row, key)">
                    <button class="mini-btn fm-more" type="button" title="更多操作"><AppIcon name="more" :size="18"  style="color: #000; font-weight: 800;" /></button>
                  </AppDropdownMenu>
                </div>
              </td>
              <td class="fm-col-kind fm-sticky">{{ row.kindText }}</td>
              <td class="fm-col-time fm-sticky fm-cell-time">{{ row.type === 'folder' ? '—' : formatWhen(row.updatedAt) }}</td>
              <td class="fm-col-size fm-sticky fm-cell-size">{{ row.type === 'folder' ? `${row.childCount} 项` : formatFileSize(row.sizeMb) }}</td>
              <td class="fm-col-owner fm-sticky fm-cell-owner">
                <!-- 别人分享来的：姓名 + 分享标志；自己的：一个「我」字 -->
                <span v-if="row.shared" class="fm-shared" :title="ownerTitle(row)">
                  <span class="fm-owner-name">{{ row.owner }}</span>
                  <AppIcon name="share" :size="12" />
                </span>
                <span v-else :title="ownerTitle(row)">{{ ownerText(row) }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 大图视图 -->
      <div v-else class="fm-grid">
        <div v-for="row in sortedRows" :key="row.key" class="fm-card" :class="{ picked: isSelected(row.key) }">
          <input class="fm-card-pick" type="checkbox" :checked="isSelected(row.key)" @change="toggleRow(row.key)" />
          <AppDropdownMenu class="fm-card-more" :items="menuItems(row)" :width="176" @select="(key) => onRowAction(row, key)">
            <button class="mini-btn" type="button" title="更多操作"><AppIcon name="more" :size="16" /></button>
          </AppDropdownMenu>
          <div
            class="fm-card-ico"
            :class="{ 'is-folder': row.type === 'folder' }"
            :style="iconStyle(row)"
            @click="row.type === 'folder' ? enterFolder(row.id) : openPreview(row)"
          >
            <AppIcon :name="row.type === 'folder' ? 'folder' : FILE_KIND_ICON[row.file.kind]" :size="34" />
          </div>
          <div class="fm-card-name" :title="row.name" @click="row.type === 'folder' ? enterFolder(row.id) : openPreview(row)">
            {{ row.name }}
          </div>
          <div class="fm-card-meta">
            <span v-if="rowPinned(row)" class="fm-pin" title="已置顶"><AppIcon name="pin" :size="11" /></span>
            {{ row.type === 'folder' ? `${row.childCount} 项` : `${row.kindText} · ${formatFileSize(row.sizeMb)}` }}
            <template v-if="row.type === 'file'"> · {{ formatWhen(row.updatedAt) }}</template>
            <!-- 卡片上只标「别人分享的」：自己的文件写满一屏「我」只是噪声 -->
            <span v-if="row.shared" class="fm-shared" :title="ownerTitle(row)">
              · {{ row.owner }}<AppIcon name="share" :size="11" />
            </span>
          </div>
        </div>
      </div>

      <!-- 存储用量（原左侧栏的容量块，侧栏去掉后收成底部窄条） -->
      <div class="fm-usage">
        <span class="fm-usage-text">存储用量 {{ usage.usedGb }} / {{ usage.quotaGb }} GB</span>
        <div class="usage-track"><div class="usage-fill" :style="{ width: `${usagePercent}%` }" /></div>
        <span class="f-hint">套餐容量 {{ usage.quotaGb }} GB，超容将限制上传</span>
      </div>
    </div>

    <!-- 新建 / 重命名 -->
    <AppModal v-if="nodeDialog" :title="NODE_TITLE[nodeDialog.mode]" :width="420" @close="nodeDialog = null">
      <div class="f-field">
        <label class="f-label">名称<span class="req">*</span></label>
        <input
          v-model="nodeDialog.name"
          class="f-input"
          :placeholder="nodeDialog.mode === 'document' ? '如：本学期教学进度安排' : '≤30 字'"
          maxlength="30"
        />
        <p v-if="nodeDialog.mode === 'folder' || nodeDialog.mode === 'document'" class="f-hint">
          将创建在「{{ folderNameOf(nodeDialog.parentId) }}」<template v-if="nodeDialog.mode === 'document'">，类型为文档</template>
        </p>
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="nodeDialog = null">取消</button>
        <button class="btn btn-primary" @click="submitNode">保存</button>
      </template>
    </AppModal>

    <!-- 移动 / 复制到 -->
    <AppModal v-if="pickerOpen" :title="PICKER_TEXT[pickerMode].title" :width="460" @close="pickerOpen = false">
      <p class="f-hint" style="margin-bottom: 10px">
        共 {{ pickerRows.length }} 项待{{ pickerMode === 'copy' ? '复制' : '移动' }}，选择目标文件夹：
      </p>
      <div class="fm-tree">
        <button
          v-for="{ folder, depth } in pickerTargets"
          :key="folder.id"
          class="fm-tree-row"
          :class="{ on: pickerTarget === folder.id }"
          type="button"
          :style="{ paddingLeft: `${10 + depth * 16}px` }"
          @click="pickerTarget = folder.id"
        >
          <AppIcon :name="folder.id === 0 ? 'layers' : 'folder'" :size="14" />
          <span class="fm-tree-name">{{ folder.name }}</span>
          <AppIcon v-if="pickerTarget === folder.id" name="check" :size="14" />
        </button>
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="pickerOpen = false">取消</button>
        <button class="btn btn-primary" @click="submitPicker">{{ PICKER_TEXT[pickerMode].confirm }}</button>
      </template>
    </AppModal>

    <!-- 批量重命名 -->
    <AppModal v-if="batchDialog" title="批量重命名" :width="460" @close="batchDialog = null">
      <div class="f-field">
        <label class="f-label">命名方式</label>
        <div class="fm-affix">
          <label><input v-model="batchDialog.position" type="radio" value="prefix" /> 统一加前缀</label>
          <label><input v-model="batchDialog.position" type="radio" value="suffix" /> 统一加后缀（扩展名前）</label>
        </div>
      </div>
      <div class="f-field">
        <label class="f-label">内容<span class="req">*</span></label>
        <input v-model="batchDialog.text" class="f-input" placeholder="如：高一数学-" maxlength="20" />
      </div>
      <div v-if="batchPreview.length" class="fm-preview">
        <p class="f-label">效果预览（前 {{ batchPreview.length }} 项）</p>
        <p v-for="row in batchPreview" :key="row.from" class="fm-preview-row">
          <span class="fm-preview-from">{{ row.from }}</span>
          <AppIcon name="arrow-right" :size="13" />
          <span class="fm-preview-to">{{ row.to }}</span>
        </p>
        <p v-if="selectedRows.length > batchPreview.length" class="f-hint">其余 {{ selectedRows.length - batchPreview.length }} 项同理</p>
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="batchDialog = null">取消</button>
        <button class="btn btn-primary" @click="submitBatchRename">重命名 {{ selectedRows.length }} 项</button>
      </template>
    </AppModal>

    <!-- 上传（真实文件；实体留在内存里供 AI 识别） -->
    <AppModal v-if="uploadOpen" title="上传文件" :width="460" @close="uploadOpen = false">
      <div class="f-field">
        <label class="f-label">目标文件夹</label>
        <select v-model="uploadTarget" class="f-select">
          <option v-for="{ folder, depth } in folderTree" :key="folder.id" :value="folder.id">
            {{ `${'　'.repeat(depth)}${folder.name}` }}
          </option>
        </select>
      </div>
      <div class="f-field">
        <label class="f-label">
          文件（可识别出类型：{{ UPLOAD_KIND_TEXT }}；其余格式归入「其它文件」。单文件 ≤200MB）
        </label>
        <input ref="fileInput" type="file" multiple hidden @change="onFilesPicked" />
        <button class="btn btn-ghost btn-sm" type="button" @click="onPickFiles"><AppIcon name="plus" :size="14" /> 选择文件</button>
        <div v-if="uploadPending.length" class="pending-list">
          <span v-for="(file, i) in uploadPending" :key="`${file.name}-${i}`" class="pending-chip">
            {{ file.name }}（{{ formatFileSize(file.size / 1048576) }}）
            <button class="chip-x" type="button" @click="uploadPending.splice(i, 1)"><AppIcon name="close" :size="11" /></button>
          </span>
        </div>
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="uploadOpen = false">取消</button>
        <button class="btn btn-primary" :disabled="!uploadPending.length" @click="submitUpload">上传（{{ uploadPending.length }}）</button>
      </template>
    </AppModal>

    <!-- 预览 -->
    <AppModal v-if="preview" :title="preview.row.name" :width="720" @close="closePreview">
      <div class="fm-stage">
        <img v-if="previewKind === 'image'" class="fm-stage-media" :src="preview.url" :alt="preview.row.name" />
        <video v-else-if="previewKind === 'video'" class="fm-stage-media" :src="preview.url" controls autoplay />
        <audio v-else-if="previewKind === 'audio'" class="fm-stage-audio" :src="preview.url" controls />
        <div v-else class="fm-stage-card">
          <span class="fm-ico lg" :style="iconStyle(preview.row)">
            <AppIcon :name="FILE_KIND_ICON[preview.row.file.kind]" :size="40" />
          </span>
          <p class="fm-stage-name">{{ preview.row.name }}</p>
          <p class="f-hint">{{ preview.row.kindText }} · {{ formatFileSize(preview.row.sizeMb) }}</p>
          <p class="f-hint">{{ previewHint }}</p>
        </div>
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="closePreview">关闭</button>
        <button v-if="previewHome" class="btn btn-ghost" @click="openPreviewHome">
          <AppIcon name="arrow-right" :size="14" /> {{ previewHome.text }}
        </button>
        <button v-if="preview.url" class="btn btn-primary" @click="onDownload(preview.row)">
          <AppIcon name="download" :size="14" /> 下载
        </button>
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
            <AppIcon :name="recogFile ? FILE_KIND_ICON[recogFile.kind] : 'file'" :size="36" />
            <p class="origin-name">{{ recogFile?.name }}</p>
            <p class="f-hint">{{ recogFile ? formatFileSize(recogFile.sizeMb) : '' }}</p>
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
                <!-- 题型随本题学科收窄（英语才有完形填空 / 七选五 / 短文改错）；已选值并入，改学科不会渲染成空白 -->
                <option v-for="t in withCurrent(questionTypesFor(q.subject), q.type)" :key="t" :value="t">{{ t }}</option>
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
              <button class="mini-btn danger" type="button" @click="recogResult?.questions.splice(qi, 1)">删除</button>
            </div>
            <label class="f-label">题干</label>
            <RichTextEditor v-model="q.stem" :subject="q.subject" :min-height="70" placeholder="识别出的题干，可直接修正" />
            <template v-if="isChoiceType(q.type)">
              <label class="f-label" style="margin-top: 8px">选项</label>
              <div v-for="(opt, oi) in q.options" :key="oi" class="rq-opt">
                <span class="rq-letter">{{ 'ABCDEF'[oi] }}</span>
                <RichTextEditor v-model="q.options[oi]" class="rq-opt-editor" compact :subject="q.subject" :min-height="36" :placeholder="`选项 ${'ABCDEF'[oi]}`" />
                <button v-if="q.options.length > 2 && q.type !== '判断'" class="mini-btn danger" type="button" @click="q.options.splice(oi, 1)">删</button>
              </div>
              <button v-if="q.type !== '判断' && q.options.length < 6" class="btn btn-ghost btn-sm" type="button" @click="q.options.push('')">
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
/* ===== 标题行 ===== */
.fm-head { display: flex; align-items: center; flex-wrap: wrap; gap: 12px 16px; margin-bottom: 12px; }
.fm-title { margin: 0; font-size: 17px; font-weight: 700; color: var(--ink); }
.fm-count { font-size: 13px; font-weight: 400; color: var(--sub); }
.fm-head-ops { margin-left: auto; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

/* ===== 操作行 ===== */
.fm-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.fm-bar .btn.on { background: var(--brand-soft); border-color: var(--brand); color: var(--brand-deep); }
.fm-bar-right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.fm-divider { width: 1px; height: 18px; background: var(--border); margin: 0 2px; }
.fm-picked { margin-top: 0; }

/* ===== 筛选浮层（挂在 AppDropdownMenu 的 panel 插槽里） =====
   外层 .dd-menu 自带白底 / 圆角 / 阴影 / 6px 内边距，这里只补内容间距：左右各 6px + 容器 6px = 12px。
   尺寸按「够用就好」定：376px 宽、约 300px 高，勾选项 3 列 —— 11 个的「其他类型」排 4 行，
   面板不至于长成半屏。 */
.fm-filter { padding: 2px 6px 0; }
/* 组标签占固定一列，勾选项在右边按网格排 —— 与参考稿一致，也让「全选」那行的
   复选框正好落在第一列勾选项的竖线上 */
.fm-filter-row { display: flex; align-items: flex-start; gap: 10px; padding: 5px 0; }
.fm-filter-row + .fm-filter-row { border-top: 1px solid var(--border); }
.fm-filter-label { width: 54px; flex-shrink: 0; padding-top: 5px; font-size: 12.5px; font-weight: 600; color: var(--ink); }
.fm-filter-opts { flex: 1; min-width: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 2px 8px; }
.fm-check {
  display: inline-flex; align-items: center; gap: 7px; height: 26px;
  font-size: 13px; color: var(--ink-2); cursor: pointer; user-select: none;
}
.fm-check:hover { color: var(--brand-deep); }
.fm-check input { width: 15px; height: 15px; flex-shrink: 0; accent-color: var(--brand); cursor: pointer; }
.fm-filter-foot {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  margin-top: 2px; padding: 8px 0; border-top: 1px solid var(--border);
}
.fm-filter-foot .f-hint { margin: 0; font-size: 12px; }

/* ===== 面包屑 ===== */
.fm-crumb { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; margin-bottom: 10px; }
.fm-crumb-sep { color: #b6bfd0; }
.fm-crumb-btn {
  display: inline-flex; align-items: center; gap: 5px;
  border: none; background: transparent; border-radius: 8px;
  padding: 4px 8px; font-family: inherit; font-size: 13px; color: var(--ink-2);
  transition: background 0.15s, color 0.15s;
}
.fm-crumb-btn:hover { background: var(--brand-soft); color: var(--brand-deep); }
.fm-crumb-btn.on { color: var(--ink); font-weight: 600; }
.fm-crumb-hint { margin: 0 0 0 6px; }

/* ===== 列表 ===== */
.fm-panel { padding: 0; overflow: hidden; }
/* 面板自身不留白，空态要自己撑出内边距，否则文字贴边 */
.fm-panel .empty-row { padding: 44px 16px; margin: 0; }

/* 列宽：名称列不给宽度，在 table-layout: fixed 下自动吃掉剩余空间；
   文件类型 / 更新时间 / 大小 / 创建者四列固定宽度并吸附在右侧 ——
   .data-table-wrap 是横向滚动容器，不吸附的话这几列会被推出视野。
   操作列（悬浮才现的快捷按钮）排在名称与文件类型之间，不吸附 */
.fm-table {
  --fm-col-kind: 104px;
  --fm-col-time: 172px;
  --fm-col-size: 96px;
  --fm-col-owner: 104px;
  --fm-col-ops: 150px;
  table-layout: fixed;
  min-width: 920px;
}
/* 列宽只写在表头：table-layout: fixed 就是按首行的宽度定列宽的 */
.fm-table th.fm-col-kind { width: var(--fm-col-kind); }
.fm-table th.fm-col-time { width: var(--fm-col-time); }
.fm-table th.fm-col-size { width: var(--fm-col-size); }
.fm-table th.fm-col-owner { width: var(--fm-col-owner); }
.fm-table th.fm-col-ops { width: var(--fm-col-ops); }
.fm-table .pick-col { width: 42px; text-align: center; }
.fm-table .pick-col input { width: 15px; height: 15px; accent-color: var(--brand); vertical-align: middle; }

.fm-table .fm-sticky { position: sticky; z-index: 1; }
/* 表头要压在吸附单元格之上（全局的 .data-table thead th 是 z-index: 1） */
.fm-table th.fm-sticky { z-index: 3; }
/* 操作列跟在名称列后面（在文件类型之前），随内容滚动，不参与吸附 */
.fm-table .fm-col-ops { text-align: right; }
/* 吸附列从右往左依次排开，偏移 = 它右边所有吸附列的宽度之和 */
.fm-table .fm-col-owner { right: 0; }
.fm-table .fm-col-size { right: var(--fm-col-owner); }
.fm-table .fm-col-time { right: calc(var(--fm-col-owner) + var(--fm-col-size)); }
.fm-table .fm-col-kind { right: calc(var(--fm-col-owner) + var(--fm-col-size) + var(--fm-col-time)); }
/* 吸附列必须自带实底色：--brand-soft 是 rgba(0,180,166,.1)，
   铺在横向滚过来的内容上会透出字，这里用它和白底混合后的实色 */
.fm-table tbody td.fm-sticky { background: #fff; }
.fm-table tbody tr:hover td.fm-sticky { background: #fafbfe; }
.fm-table tbody tr.picked td.fm-sticky { background: #e6f8f6; }
/* 吸附区左边界：一条分隔阴影，横向滚动时能看出内容是从下面穿过去的 */
.fm-table .fm-col-kind { box-shadow: -10px 0 10px -10px rgba(28, 36, 52, 0.16); }

.fm-table tbody tr.picked { background: var(--brand-soft); }
.fm-th-sort { cursor: pointer; user-select: none; white-space: nowrap; }
.fm-th-sort:hover { color: var(--brand-deep); }
.fm-arrow { margin-left: 4px; color: var(--brand-deep); }
/* 表头只给读屏用：操作列表头没有可见文案 */
.fm-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }

/* 行内快捷操作：悬浮或该行被选中时出现，平时不制造视觉噪声 */
.fm-quick { display: flex; align-items: center; justify-content: flex-end; gap: 2px; opacity: 0; transition: opacity 0.15s; }
.fm-table tbody tr:hover .fm-quick,
.fm-table tbody tr.picked .fm-quick,
/* 菜单展开后鼠标会移到浮层上，此时行不再 :hover，靠焦点把按钮留在原地 */
.fm-quick:focus-within { opacity: 1; }
.fm-quick .mini-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; padding: 0; color: var(--sub); font-weight: 400;
}
.fm-quick .mini-btn:hover { color: var(--brand-deep); }

.fm-name-cell { display: flex; align-items: center; gap: 8px; min-width: 0; }
/* 名称可伸缩（min-width: 0 才截得断）：标签跟在名称后面，不跟着被推到列最右 */
.fm-name { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink); }
.fm-name-link { border: none; background: transparent; padding: 0; font-family: inherit; font-size: inherit; font-weight: 600; cursor: pointer; text-align: left; }
.fm-name-link:hover { color: var(--brand-deep); text-decoration: underline; }
/* 文件名也是可点的（点开预览），但字重与目录名拉开：一眼能分出行末带扩展名的是文件 */
.fm-name-link.is-file { font-weight: 400; }
.fm-name-link:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; border-radius: 4px; }
.fm-name-cell .tag,
.fm-name-cell .fm-loc,
.fm-name-cell .fm-pin { flex-shrink: 0; }
.fm-loc { font-size: 11.5px; color: var(--sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 120px; }
.fm-pin { display: inline-flex; align-items: center; vertical-align: middle; color: var(--brand-deep); }
.fm-cell-time, .fm-cell-size { white-space: nowrap; color: var(--ink-2); }
.fm-cell-owner { white-space: nowrap; color: var(--ink-2); }
/* 分享进来的：姓名 + 分享标志做成一个小胶囊，扫一眼能把「别人的」挑出来 */
.fm-shared {
  display: inline-flex; align-items: center; gap: 4px;
  max-width: 100%; padding: 1px 6px; border-radius: 999px;
  background: var(--brand-soft); color: var(--brand-deep); font-size: 12px;
}
.fm-owner-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* 定位文件夹后闪一下被定位的行 */
.fm-table tbody tr.flash td,
.fm-table tbody tr.flash td.fm-sticky { background: #cdeeeb; transition: background 0.4s; }

/* 类型图标：文件夹与各文件类型给一档底色，扫一眼能分堆。
   文件那 17 种底色不在这里写类名，由类型表 FILE_KIND_COLOR 通过 :style 给
   （见 iconStyle）—— 30 多条同形规则改成一处数据，加类型时也不会漏配颜色 */
.fm-ico {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; flex-shrink: 0; border-radius: 8px;
  background: #eef1f8; color: #6b7688;
}
.fm-ico.is-folder { background: #fff3dd; color: #d69a1c; }
.fm-ico.lg { width: 76px; height: 76px; border-radius: 18px; }

/* ===== 大图 ===== */
.fm-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
  gap: 12px; padding: 16px;
}
.fm-card {
  position: relative; display: flex; flex-direction: column; align-items: center; gap: 6px;
  border: 1px solid var(--border); border-radius: 12px; padding: 16px 10px 12px;
  background: #fff; transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
}
.fm-card:hover { border-color: var(--brand); box-shadow: var(--shadow); }
.fm-card.picked { border-color: var(--brand); background: var(--brand-soft); }
.fm-card-pick { position: absolute; top: 9px; left: 10px; width: 15px; height: 15px; accent-color: var(--brand); }
.fm-card-more { position: absolute; top: 4px; right: 4px; opacity: 0; transition: opacity 0.15s; }
.fm-card:hover .fm-card-more, .fm-card.picked .fm-card-more { opacity: 1; }
.fm-card-ico {
  display: flex; align-items: center; justify-content: center;
  width: 64px; height: 64px; border-radius: 16px; cursor: pointer;
  background: #eef1f8; color: #6b7688;
}
.fm-card-ico.is-folder { background: #fff3dd; color: #d69a1c; }
.fm-card-name {
  width: 100%; text-align: center; font-size: 13px; color: var(--ink);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer;
}
.fm-card-name:hover { color: var(--brand-deep); }
.fm-card-meta { font-size: 11.5px; color: var(--sub); text-align: center; }
/* 卡片 meta 行本身是 11.5px，分享胶囊跟着缩一档才不显得突兀 */
.fm-card-meta .fm-shared { font-size: 11px; padding: 0 5px; vertical-align: middle; }

/* ===== 存储用量（面板底部窄条） ===== */
.fm-usage {
  display: flex; align-items: center; gap: 12px;
  border-top: 1px solid var(--border); padding: 10px 16px;
}
.fm-usage-text { font-size: 12.5px; color: var(--ink-2); white-space: nowrap; }
.fm-usage .f-hint { margin: 0; }
.usage-track { flex: 1; max-width: 260px; height: 7px; border-radius: 999px; background: var(--border); overflow: hidden; }
.usage-fill { height: 100%; background: linear-gradient(90deg, var(--brand), var(--brand-deep)); }

/* ===== 移动弹窗的目录树 ===== */
.fm-tree { max-height: 320px; overflow-y: auto; border: 1px solid var(--border); border-radius: 10px; padding: 4px; }
.fm-tree-row {
  display: flex; align-items: center; gap: 7px; width: 100%;
  border: none; background: transparent; border-radius: 8px;
  padding: 7px 10px; font-family: inherit; font-size: 13px; color: var(--ink-2); text-align: left;
}
.fm-tree-row:hover { background: #f4f8f8; }
.fm-tree-row.on { background: var(--brand-soft); color: var(--brand-deep); font-weight: 600; }
.fm-tree-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ===== 批量重命名 ===== */
.fm-affix { display: flex; align-items: center; gap: 18px; font-size: 13px; color: var(--ink-2); }
.fm-affix label { display: inline-flex; align-items: center; gap: 6px; }
.fm-affix input { accent-color: var(--brand); }
.fm-preview { border: 1px dashed var(--border); border-radius: 10px; padding: 10px 12px; background: #fafbfe; }
.fm-preview-row { display: flex; align-items: center; gap: 8px; margin: 6px 0 0; font-size: 12.5px; }
.fm-preview-from { color: var(--sub); text-decoration: line-through; }
.fm-preview-to { color: var(--ink); font-weight: 600; }

/* ===== 预览 ===== */
.fm-stage { display: flex; align-items: center; justify-content: center; min-height: 220px; }
.fm-stage-media { max-width: 100%; max-height: 62vh; border-radius: 10px; }
.fm-stage-audio { width: 100%; max-width: 420px; }
.fm-stage-card { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 24px 12px; text-align: center; }
.fm-stage-name { margin: 4px 0 0; font-size: 13.5px; font-weight: 600; color: var(--ink); word-break: break-all; }
.fm-stage-card .f-hint { max-width: 420px; }

/* ===== 上传弹窗 ===== */
.pending-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.pending-chip {
  display: inline-flex; align-items: center; gap: 6px;
  background: #fff; border: 1px solid var(--border); border-radius: 8px;
  font-size: 12.5px; color: var(--ink-2); padding: 4px 10px;
}
/* 纯图标按钮：撑成不小于 22×22 的命中区，图标在其中居中 */
.chip-x {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; flex-shrink: 0; padding: 0;
  border: none; border-radius: 6px; background: transparent; color: var(--sub);
}

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
.run-steps { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: center; }
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
