<script setup lang="ts">
/**
 * 备课文档的**全屏工作台**（教案 / 学案 / 讲义共用）。
 *
 * ## 与三个页面的关系
 *
 * 骨架是同一套：顶栏（品牌 + 文档信息 + 动作 + 登录人）→ 工具带（功能区 / 结构化的加段落）
 * → 三栏（左大纲 / 中画布 / 右图标栏 + 面板）→ 底栏（版面读数 + 统计）。
 * 三个页面只差三件事：**大纲里有哪些节点**（教案是教学目标 / 环节，学案是预习导学 / 课堂探究）、
 * **中栏写什么**（环节三栏表单 / 段落正文）、**有没有第二版预览**（教案纸 / 带题稿）。
 * 这三件事都通过 props 与插槽交出去，骨架只留一份 —— 否则「右边栏加一项」要改三遍。
 *
 * ## 大纲为什么是数据而不是插槽
 *
 * 教案与学案的左栏行长得一模一样（编号方块 + 标题 + 副标题 + 上移下移删除），
 * 差别只在数据来源（`plan.steps` vs `blocks`）。让页面各画一份，就得各写一份样式，
 * 下次改行高要改两处；交出一份 `structOutline` 数组，行结构与操作图标留在这一处。
 *
 * ## 面板一律开在右栏这一列
 *
 * 全局设置、AI、题库、媒体库、编辑记录都是「开一块面板干活」，且都要**看着正文调** ——
 * 弹居中窗口会把纸盖住。这也是教案页改版时定下的口径（DocSettingsDialog / DocAiDraftPanel
 * 的 `embedded` 形态就是为这个准备的）。
 *
 * ## 谁管状态
 *
 * `doc` 是父级持有的编辑态对象（父级已从列表深拷贝），本组件只往上 `emit`：
 * 保存 / 发布由页面做，元数据改动走 `update:dirty` + 页面自己的写回。
 * 唯一的例外是 AI 草稿与引用模板 —— 它们要换**正文**，而正文的宿主是编辑器，
 * 页面拿不到画布句柄，所以由本组件直接落到画布上（见 `onApplyContent`）。
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { Editor } from '@tiptap/vue-3'
import {
  AppAvatar,
  AppIcon,
  TEACH_DOC_SOURCE_TEXT,
  TEACH_DOC_STATUS_TEXT,
  TEACH_TEMPLATE_KIND_TEXT,
  showToast,
  toPlainText,
  truncateRich,
} from '@aiteach/shared'
import type { OrgMedia, OrgQuestion, TeachDoc, TeachTemplateKind } from '@aiteach/shared'

import AiAssistant from '@/components/ai/AiAssistant.vue'
import DocAiDraftPanel from './DocAiDraftPanel.vue'
import DocEditor from './DocEditor.vue'
import DocOutline from './DocOutline.vue'
import DocPreviewDialog from './DocPreviewDialog.vue'
import DocRibbon from './DocRibbon.vue'
import DocSettingsDialog from './DocSettingsDialog.vue'
import { DOC_PAPERS } from './doc-options'
import type { StructOutlineAction, StructOutlineRow } from './workbench-types'
import { fetchMedia } from '@/api/org'
import { useBaseData } from '@aiteach/business-common'
import { useAuthStore } from '@/stores/auth'

const props = withDefaults(
  defineProps<{
    /** 编辑态文档对象（父级持有） */
    doc: TeachDoc
    /** 文档类型：决定模板候选、AI 口径与文案 */
    kind: TeachTemplateKind
    /** 编辑方式（v-model:mode） */
    mode: 'doc' | 'struct'
    /** 有未保存的改动（v-model:dirty） */
    dirty: boolean
    saving?: boolean
    publishing?: boolean
    /** 题库数据由页面拉一次，面板与结构化编辑共用同一份 */
    questions?: OrgQuestion[]
    /** 结构化模式下「新增」按钮的清单（教案是教学环节，学案是段落类型） */
    structKinds: Array<{ key: string; label: string }>
    /** 结构化模式的左栏数据（由页面从 `plan` / `blocks` 生成） */
    structOutline: StructOutlineRow[]
    /** 当前选中的大纲节点（v-model:active-key） */
    activeKey: string
    /** 结构化模式下题库加入的目标名；为空说明还没选中 */
    structTarget?: string
    /** 底栏在结构化模式下的统计文案 */
    structStat?: string
    /** 左栏标题（教案「教学设计」/ 学案「段落大纲」） */
    structOutlineTitle?: string
    /** 顶栏元信息里额外那一段（教案的「3 课时」） */
    metaExtra?: string
    /** 版式的页签名：传了才在预览弹窗里出现「版式」页签（教案纸 / 带题稿） */
    layoutLabel?: string
    /** 版式页签的一行说明 */
    layoutHint?: string
    /** 找不到文档时的返回地址 */
    listHref: string
  }>(),
  {
    saving: false,
    publishing: false,
    questions: () => [],
    structTarget: '',
    structStat: '',
    structOutlineTitle: '段落大纲',
    metaExtra: '',
    layoutLabel: '',
    layoutHint: '',
  },
)

const emit = defineEmits<{
  save: []
  publish: []
  /** 元数据 / 页面设置改动（页面写回文档并置脏） */
  patch: [value: Partial<TeachDoc>]
  'update:mode': [value: 'doc' | 'struct']
  'update:dirty': [value: boolean]
  'update:active-key': [value: string]
  /** 结构化模式：把题目挂到当前节点 */
  'link-question': [value: number]
  /** 结构化模式：新增一个节点（参数是 structKinds 里的 key） */
  'add-struct': [value: string]
  /** 结构化模式：某一行被上移 / 下移 / 删除（行由页面持有，本组件只报动作） */
  'outline-action': [key: string, action: StructOutlineAction]
}>()

const router = useRouter()
const auth = useAuthStore()
const { difficulties, ensure } = useBaseData()

/* 「教案 / 学案 / 讲义」三档都读同一张文案表：这里写死三元式的话，教案会被叫成「讲义」 */
const kindText = computed(() => TEACH_TEMPLATE_KIND_TEXT[props.kind])
const statusText = computed(() => TEACH_DOC_STATUS_TEXT[props.doc.status])

/**
 * 来源与只读：校本 / 平台稿是学校与平台的定版，能看能打印能导出，但不能就地改
 * （口径与教案页、DocEditor 一致）。
 */
const source = computed(() => props.doc.source ?? 'personal')
const readonly = computed(() => source.value !== 'personal')
const sourceText = computed(() => TEACH_DOC_SOURCE_TEXT[source.value])

/* ================= 画布 ================= */

interface WorkbenchEditorApi {
  editor: Editor | undefined
  media: { pickImage: () => void; openMathInsert: () => void; openDrawSelect: () => void } | undefined
  baseSize: string
  charCount: number
  headCount: number
  pageCount: number
  zoom: number
  paginated: boolean
  setZoom: (value: number) => void
  stepZoom: (delta: number) => void
  fitWidth: () => void
  setPaginated: (value: boolean) => void
  insertAtCursor: (fragment: string) => void
  insertHtml: (fragment: string) => void
  setHtml: (value: string) => void
  getHtml: () => string
  importing: boolean
  exporting: boolean
  openPreview: () => void
  openParagraph: () => void
  pickDocx: () => void
  onExport: () => void
  onPrint: () => void
}

/**
 * `shallowRef` 而不是 `ref`：`ref` 会做深解包，把 TipTap 的 `Editor` 类碾成组件实例形状，
 * DocRibbon 的 `:editor` 就再也对不上类型（教案页踩过同一个坑）。
 */
const canvasRef = shallowRef<WorkbenchEditorApi | null>(null)
const editorInstance = computed<Editor | null>(() => canvasRef.value?.editor ?? null)
const baseSize = computed(() => canvasRef.value?.baseSize ?? '')
const pageCount = computed(() => canvasRef.value?.pageCount ?? 1)
const headCount = computed(() => canvasRef.value?.headCount ?? 0)
const charCount = computed(() => canvasRef.value?.charCount ?? 0)
const zoom = computed(() => canvasRef.value?.zoom ?? 100)
const importing = computed(() => canvasRef.value?.importing ?? false)
const exporting = computed(() => canvasRef.value?.exporting ?? false)
const paginated = computed(() => canvasRef.value?.paginated ?? true)

/** 底栏的纸张读数：新文档一律 A4，但存量稿可能选过 B5，界面上不说会让人奇怪「这页怎么这么窄」 */
const paperLabel = computed(() => {
  const key = props.doc.page?.paper
  return (DOC_PAPERS.find((row) => row.key === key) ?? DOC_PAPERS[0]).label.split('（')[0]
})

const outlineOpen = ref(true)

function setDirty(value: boolean) {
  emit('update:dirty', value)
}

/* ================= 正文落地（引用模板 / AI 草稿） ================= */

/**
 * 把「引用模板 / AI 草稿」的结果落进正文。
 *
 * 两者都写 `content`（文案编辑的那份正文）；结构化编辑没有正文流，此时**替换**直接写
 * 文档字段（切回文案编辑自然带上），**追加**则做不了 —— 如实提示，而不是静默无反应。
 */
function onApplyContent(payload: { content: string; mode: 'replace' | 'append'; label: string }) {
  if (payload.mode === 'append') {
    if (!canvasRef.value) {
      showToast('「追加」需要先切到文案编辑（结构化编辑没有正文流可以追加）', 'error')
      return
    }
    canvasRef.value.insertHtml(payload.content)
  } else if (canvasRef.value) {
    canvasRef.value.setHtml(payload.content)
  } else {
    props.doc.content = payload.content
  }
  setDirty(true)
  showToast(`${payload.label}已应用，记得保存`, 'success')
}

/** AI 草稿一律整篇覆盖（骨架与课题都换了）—— 面板里已经二次确认过 */
function onApplyDraft(payload: { content: string; label: string }) {
  onApplyContent({ ...payload, mode: 'replace' })
}

/* ================= 预览（纸面 / 版式） ================= */

const previewOpen = ref(false)
/** 打开时停在哪个页签：正文为空时「打印」会直接开在版式上 */
const previewTab = ref('paper')

/**
 * 纸面预览要的正文。
 *
 * 文案编辑时以**画布里的实时内容**为准（用户可能刚敲完还没保存，`doc.content` 落后一拍）；
 * 结构化编辑时画布没挂载（`canvasRef` 为 null），退回文档字段。
 */
const previewContent = computed(() => canvasRef.value?.getHtml() ?? props.doc.content ?? '')

const previewTabs = computed(() => {
  const base = [{ key: 'paper', label: '纸面排版', hint: '编辑器里的正文，按「页面设置」排 —— 与打印正文同版' }]
  if (!props.layoutLabel) return base
  return [...base, { key: 'layout', label: props.layoutLabel, hint: props.layoutHint }]
})

function openPreview(tab = 'paper') {
  previewTab.value = tab
  previewOpen.value = true
}

/**
 * 顶栏「打印」。
 *
 * 直接打正文（省掉「先看一眼」这一步 —— 看过的场景留给了「预览」）。但正文为空时不能只报错：
 * 结构化编辑写的不是正文流，老师眼里的「这份稿子」明明有内容，一句「正文是空的」等于说他不存在的错。
 * 这种时候改开版式预览，让他在那一版里打印。
 */
function onPrintTop() {
  if (toPlainText(previewContent.value)) {
    canvasRef.value?.onPrint()
    return
  }
  if (props.layoutLabel) {
    openPreview('layout')
    showToast('正文是空的，已切到「版式」—— 从那一版打印', 'info')
    return
  }
  showToast('正文还是空的，没有可打印的内容', 'error')
}

/**
 * 导入 / 导出 Word 都挂在编辑器上，而结构化编辑时编辑器**没有挂载**（`canvasRef` 为 null）。
 * 不拦一下的话，按钮点下去毫无反应 —— 用户会以为功能坏了，而不是「这个模式下不能用」。
 */
function onImportWord() {
  if (!canvasRef.value) {
    showToast('导入会写进正文，请先在「全局设置 → 编辑方式」切到文案编辑', 'error')
    return
  }
  canvasRef.value.pickDocx()
}

function onExportWord() {
  if (!canvasRef.value) {
    showToast('导出取的是正文，请先在「全局设置 → 编辑方式」切到文案编辑', 'error')
    return
  }
  canvasRef.value.onExport()
}

/* ================= 右侧栏 ================= */

type RailKey = 'settings' | 'ai' | 'bank' | 'media' | 'history'

/** 前两项作用于整篇，后三项是「往正文里取素材」—— 顺序即优先级 */
const RAIL = computed<Array<{ key: RailKey; label: string; icon: string }>>(() => [
  { key: 'settings', label: '全局设置', icon: 'sliders' },
  { key: 'ai', label: `AI ${kindText.value}`, icon: 'sparkles' },
  { key: 'bank', label: '题库选题', icon: 'edit' },
  { key: 'media', label: '媒体库', icon: 'image' },
  { key: 'history', label: '编辑记录', icon: 'clock' },
])

const panelRail = ref<'' | RailKey>('')

function onRailClick(key: RailKey) {
  panelRail.value = panelRail.value === key ? '' : key
}
const railOn = (key: RailKey) => panelRail.value === key

/* ================= 题库选题 ================= */

const bankFilter = reactive({ type: '', difficulty: '', keyword: '' })

const bankPool = computed(() =>
  props.questions.filter(
    (row) =>
      row.status === 'approved' &&
      (!bankFilter.type || row.type === bankFilter.type) &&
      (!bankFilter.difficulty || row.difficulty === bankFilter.difficulty) &&
      (!bankFilter.keyword || toPlainText(row.stem).includes(bankFilter.keyword.trim())),
  ),
)
const bankTypes = computed(() => Array.from(new Set(props.questions.map((row) => row.type))))

/** 题目正文 → 可直接插进文档流的 HTML（题干 + 选项；答案与解析不入正文，学案留白给答案） */
function questionHtml(row: OrgQuestion): string {
  const head = `<p><b>【${row.type}】</b>${row.stem}</p>`
  const options = row.options?.length ? `<p>${row.options.join('　')}</p>` : ''
  return head + options
}

function pickQuestion(row: OrgQuestion) {
  if (readonly.value) return
  if (props.mode === 'struct') {
    emit('link-question', row.id)
    return
  }
  canvasRef.value?.insertAtCursor(questionHtml(row))
  setDirty(true)
  showToast('已插入到正文光标处，记得保存', 'success')
}

/* ================= 媒体库 ================= */

const media = ref<OrgMedia[]>([])
const mediaLoading = ref(false)

async function loadMedia() {
  if (media.value.length || mediaLoading.value) return
  mediaLoading.value = true
  try {
    media.value = await fetchMedia()
  } catch {
    showToast('媒体库加载失败', 'error')
  } finally {
    mediaLoading.value = false
  }
}

function insertMedia(row: OrgMedia) {
  if (readonly.value) return
  if (row.kind !== 'image' || !row.url) {
    showToast('目前只支持把图片插进正文，视频 / 动画请用「插入链接」', 'error')
    return
  }
  if (!canvasRef.value) {
    showToast('切到文案编辑后再插图（结构化编辑没有正文流）', 'error')
    return
  }
  canvasRef.value.insertAtCursor(`<img src="${row.url}" alt="${row.name}">`)
  setDirty(true)
  showToast('图片已插入到正文，记得保存', 'success')
}

watch(panelRail, (value) => {
  if (value === 'media') void loadMedia()
})

/* ================= 编辑记录 ================= */

interface Snapshot {
  label: string
  time: string
  html: string
}

const snapshots = ref<Snapshot[]>([])
/** 停手 10 秒才记一次：每个字都进栈会把面板刷屏 */
const SNAPSHOT_IDLE_MS = 10_000
const SNAPSHOT_MAX = 15
let snapshotTimer = 0

function nowText(): string {
  const date = new Date()
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`
}

/**
 * 记一档快照。
 *
 * 页面保存成功后也会调（`defineExpose.pushSnapshot`）—— 手动保存是明确的「一个版本」，
 * 不该等停手 10 秒。
 */
function pushSnapshot(label: string) {
  const html = canvasRef.value?.getHtml() ?? ''
  if (!html) return
  const last = snapshots.value[snapshots.value.length - 1]
  if (last && last.html === html) return
  snapshots.value.push({ label, time: nowText(), html })
  if (snapshots.value.length > SNAPSHOT_MAX) snapshots.value.splice(0, snapshots.value.length - SNAPSHOT_MAX)
}

function onDocChange() {
  setDirty(true)
  clearTimeout(snapshotTimer)
  snapshotTimer = window.setTimeout(() => pushSnapshot('自动快照'), SNAPSHOT_IDLE_MS)
}

function restoreSnapshot(row: Snapshot) {
  canvasRef.value?.setHtml(row.html)
  setDirty(true)
  showToast(`已回退到「${row.label} ${row.time}」，确认无误后保存`, 'success')
}

/* ================= 离页提醒 ================= */

function onBeforeUnload(event: BeforeUnloadEvent) {
  if (!props.dirty) return
  event.preventDefault()
  event.returnValue = ''
}

onMounted(() => {
  window.addEventListener('beforeunload', onBeforeUnload)
  /* 题库面板的难度筛选读字典（`difficulties`），面板可能在任何一处先被打开 —— 在这里起一轮，
     比让每个页面都记得调 ensure() 可靠 */
  void ensure()
})
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onBeforeUnload)
  clearTimeout(snapshotTimer)
})

/** 页面保存成功后把「手动保存」这一档记进时间线 */
defineExpose({ pushSnapshot })
</script>

<template>
  <div class="pl2-shell">
    <!-- ================= 顶栏 =================
         教案编辑页是「别人的新页签」，进出都没有 AppLayout 兜着，所以品牌与登录人得自带一套：
         顶部一片空白的话，用户不知道自己站在哪个系统里，也找不到回工位的路。 -->
    <header class="pl2-head">
      <button class="pl2-brand" type="button" title="返回工作台首页" @click="router.push('/dashboard')">
        <img src="/logo.png" alt="AI教学云平台" />
        <span>AI教学云平台</span>
      </button>
      <span class="pl2-head-sep" />

      <div class="pl2-title-wrap">
        <input
          v-if="!readonly"
          v-model="doc.name"
          class="pl2-title"
          maxlength="50"
          :placeholder="`${kindText}名称（2-50 字）`"
          @input="setDirty(true)"
        />
        <p v-else class="pl2-title pl2-title-ro">{{ doc.name }}</p>
        <div class="pl2-title-meta">
          <span class="pl2-meta-text">
            {{ doc.subject }} · {{ doc.grade }}<template v-if="doc.textbook"> · {{ doc.textbook }}</template>
            <template v-if="metaExtra"> · {{ metaExtra }}</template>
          </span>
          <span class="tag" :class="doc.status === 'published' ? 'tag-green' : 'tag-gray'">{{ statusText }}</span>
          <span class="tag" :class="source === 'personal' ? 'tag-gray' : source === 'school' ? 'tag-orange' : 'tag-blue'">
            {{ sourceText }}
          </span>
          <span v-for="k in doc.knowledge" :key="k" class="tag tag-gray">{{ k }}</span>
          <span v-if="dirty" class="pl2-dirty" title="有改动还没保存">● 未保存</span>
          <span v-else class="pl2-meta-text">已保存</span>
        </div>
      </div>

      <div class="pl2-head-ops">
        <!-- 页面自己的动作排在最前，与「一次性动作」同组。
             目前三个页面都没用到 —— 留着是为了不让「加一个页面专属按钮」变成改造骨架的理由。 -->
        <slot name="ops" />

        <template v-if="!readonly">
          <button
            class="btn btn-ghost btn-sm"
            type="button"
            :disabled="importing"
            title="导入 .docx：语义化重建为可在线编辑的文档（版面不保留）"
            @click="onImportWord()"
          >
            <AppIcon name="upload" :size="14" /> {{ importing ? '导入中…' : '导入 Word' }}
          </button>
          <button
            class="btn btn-ghost btn-sm"
            type="button"
            :disabled="exporting"
            title="导出 Word：优先 .docx，依赖未装时退回 .doc"
            @click="onExportWord()"
          >
            <AppIcon name="word" :size="14" /> {{ exporting ? '导出中…' : '导出 Word' }}
          </button>
        </template>
        <!-- 一个「预览」入口：纸面与版式在弹窗里切页签（原先学案有两个并排的预览按钮） -->
        <button class="btn btn-ghost btn-sm" type="button" title="整篇预览：纸面排版 / 版式" @click="openPreview()">
          <AppIcon name="eye" :size="14" /> 预览
        </button>
        <button class="btn btn-ghost btn-sm" type="button" title="直接打印正文" @click="onPrintTop()">
          <AppIcon name="print" :size="14" /> 打印
        </button>

        <button
          v-if="!readonly"
          class="btn btn-ghost btn-sm"
          type="button"
          :disabled="publishing"
          :title="doc.status === 'published' ? '下架：校内教师不再能取用' : '发布到校内，其他教师可直接取用'"
          @click="emit('publish')"
        >
          <AppIcon :name="doc.status === 'published' ? 'download' : 'share'" :size="14" />
          {{ doc.status === 'published' ? '下架' : '发布' }}
        </button>

        <button v-if="!readonly" class="btn btn-primary btn-sm" type="button" :disabled="saving" @click="emit('save')">
          <AppIcon name="save" :size="14" /> {{ saving ? '保存中…' : '保存' }}
        </button>

        <span class="pl2-head-sep" />
        <div class="pl2-user">
          <AppAvatar :name="auth.user?.name" :hue="auth.user?.avatarHue ?? 172" :avatar="auth.user?.avatar" />
          <span class="pl2-user-meta">
            <span class="pl2-user-name">{{ auth.user?.name ?? '未登录' }}</span>
            <span class="pl2-user-role">{{ auth.user?.roleName ?? '' }}</span>
          </span>
        </div>
      </div>
    </header>

    <!-- ================= 工具带 ================= -->
    <div class="pl2-toolbar">
      <template v-if="mode === 'doc'">
        <DocRibbon
          v-if="editorInstance"
          class="pl2-ribbon"
          layout="top"
          :editor="editorInstance"
          :base-size="baseSize"
          @image="canvasRef?.media?.pickImage()"
          @formula="canvasRef?.media?.openMathInsert()"
          @draw="canvasRef?.media?.openDrawSelect()"
          @paragraph="canvasRef?.openParagraph()"
        />
        <span v-else class="pl2-toolbar-loading">编辑器载入中…</span>

        <div class="pl2-toolbar-right">
          <span class="pl2-tool-sep" />
          <span class="pl2-tool-label">缩放</span>
          <div class="pl2-seg">
            <button type="button" title="缩小" @click="canvasRef?.stepZoom(-1)"><AppIcon name="minus" :size="13" /></button>
            <label class="pl2-zoom-cell" title="可直接输入百分比">
              <input
                :value="zoom"
                inputmode="numeric"
                aria-label="缩放百分比"
                @change="canvasRef?.setZoom(Number(($event.target as HTMLInputElement).value))"
              />
              <span>%</span>
            </label>
            <button type="button" title="放大" @click="canvasRef?.stepZoom(1)"><AppIcon name="plus" :size="13" /></button>
          </div>
          <button class="pl2-tool" type="button" title="把纸缩到铺满画布" @click="canvasRef?.fitWidth()">适应</button>
          <button
            class="pl2-tool"
            type="button"
            :class="{ on: paginated }"
            title="分页视图：按纸张把正文断开（与 Word 的页面视图同义）"
            @click="canvasRef?.setPaginated(!paginated)"
          >
            <AppIcon name="page-break" :size="13" /> 分页
          </button>
        </div>
      </template>

      <!-- 结构化编辑：功能带换成「加节点」，正文是一段段写而不是排版。
           节点清单由页面给（教案是「教学环节」，学案是「段落类型」）—— 两侧的用词不同，
           但按钮形态必须是同一个，不然同一套工作台会有两种手感。 -->
      <template v-else>
        <span class="pl2-tool-label">新增</span>
        <div class="pl2-chips">
          <button
            v-for="row in structKinds"
            :key="row.key"
            class="pl2-chip"
            type="button"
            @click="emit('add-struct', row.key)"
          >
            + {{ row.label }}
          </button>
        </div>
        <div class="pl2-toolbar-right">
          <!-- 页面自己的读数之外的东西（教案的「课时」输入框） -->
          <slot name="struct-tools" />
          <span class="pl2-tool-sep" />
          <span class="pl2-tool-hint">{{ structStat }}</span>
        </div>
      </template>
    </div>

    <!-- ================= 主体三栏 ================= -->
    <div class="pl2-body">
      <!-- 左：目录 / 结构化大纲 -->
      <aside v-if="outlineOpen" class="pl2-outline">
        <template v-if="mode === 'doc'">
          <DocOutline
            v-if="editorInstance"
            :editor="editorInstance"
            :title="doc.name"
            fill
            closable
            @close="outlineOpen = false"
          />
          <p v-else class="pl2-outline-loading">目录载入中…</p>
        </template>
        <template v-else>
          <div class="pl2-ol-head">
            <AppIcon name="outline" :size="15" />
            <span>{{ structOutlineTitle }}</span>
            <button class="pl2-icon-btn" type="button" title="收起" @click="outlineOpen = false">
              <AppIcon name="close" :size="13" />
            </button>
          </div>
          <div class="pl2-ol-list">
            <template v-for="row in structOutline" :key="row.key">
              <p v-if="row.group" class="pl2-ol-title">{{ row.group }}</p>
              <div class="pl2-ol-row" :class="{ on: activeKey === row.key }">
                <button class="pl2-ol-pick" type="button" @click="emit('update:active-key', row.key)">
                  <span class="pl2-ol-no">{{ row.no }}</span>
                  <span class="pl2-ol-main">
                    <b>{{ row.title }}</b>
                    <em v-if="row.meta">{{ row.meta }}</em>
                  </span>
                </button>
                <div v-if="row.movable" class="pl2-ol-ops">
                  <button class="pl2-icon-btn" type="button" title="上移" @click="emit('outline-action', row.key, 'up')">↑</button>
                  <button class="pl2-icon-btn" type="button" title="下移" @click="emit('outline-action', row.key, 'down')">↓</button>
                  <button
                    class="pl2-icon-btn danger"
                    type="button"
                    title="删除"
                    @click="emit('outline-action', row.key, 'remove')"
                  >
                    ×
                  </button>
                </div>
              </div>
            </template>
            <p v-if="!structOutline.length" class="pl2-hint">还没有内容，点上方「新增」开始。</p>
          </div>
        </template>
      </aside>

      <!-- 中：画布 / 段落编辑 -->
      <div class="pl2-stage">
        <!-- 目录收起后贴在左边界的竖把手：绝对定位，不占版面宽度 -->
        <button v-if="!outlineOpen" class="pl2-outline-tab" type="button" title="展开大纲" @click="outlineOpen = true">
          <AppIcon name="list-ul" :size="14" />
          <span>{{ mode === 'doc' ? '目录' : '大纲' }}</span>
        </button>

        <!-- headless：不画 DocEditor 自带的顶栏，保存 / 发布 / 导入导出全走上面这条自绘顶栏 -->
        <DocEditor
          v-if="mode === 'doc'"
          ref="canvasRef"
          class="pl2-editor"
          :doc="doc"
          :kind="kind"
          :mode="mode"
          headless
          :chrome="false"
          @update:mode="emit('update:mode', $event)"
          @change="onDocChange"
        />

        <div v-else class="pl2-struct">
          <slot name="struct-main" />
        </div>
      </div>

      <!-- 右：面板（图标栏选中的那一项），一律开在右栏这一列 -->
      <aside v-if="panelRail" class="pl2-side">
        <template v-if="panelRail === 'settings'">
          <div class="pl2-side-head">
            <h3>全局设置</h3>
            <button class="pl2-icon-btn" type="button" title="收起" @click="panelRail = ''">
              <AppIcon name="close" :size="13" />
            </button>
          </div>
          <div class="pl2-side-body">
            <DocSettingsDialog
              :doc="doc"
              :kind="kind"
              :mode="mode"
              embedded
              @close="panelRail = ''"
              @patch="emit('patch', $event)"
              @apply-content="onApplyContent"
              @update:mode="emit('update:mode', $event)"
            />
          </div>
        </template>

        <template v-else-if="panelRail === 'ai'">
          <div class="pl2-side-head">
            <h3>AI {{ kindText }}</h3>
            <button class="pl2-icon-btn" type="button" title="收起" @click="panelRail = ''">
              <AppIcon name="close" :size="13" />
            </button>
          </div>
          <div class="pl2-side-body">
            <DocAiDraftPanel :doc="doc" :kind="kind" @apply="onApplyDraft" />
          </div>
        </template>

        <template v-else-if="panelRail === 'bank'">
          <div class="pl2-side-head">
            <h3>题库选题</h3>
            <button class="pl2-icon-btn" type="button" title="收起" @click="panelRail = ''">
              <AppIcon name="close" :size="13" />
            </button>
          </div>
          <div class="pl2-side-body">
            <div class="pl2-filters">
              <select v-model="bankFilter.type">
                <option value="">全部题型</option>
                <option v-for="t in bankTypes" :key="t" :value="t">{{ t }}</option>
              </select>
              <select v-model="bankFilter.difficulty">
                <option value="">全部难度</option>
                <option v-for="d in difficulties" :key="d" :value="d">{{ d }}</option>
              </select>
            </div>
            <input v-model="bankFilter.keyword" class="pl2-input" placeholder="搜索题干关键词" />
            <p class="pl2-hint">
              仅显示已入库题目 · 共 {{ bankPool.length }} 道
              <template v-if="mode === 'struct'">
                <br />加入后挂到：<b>{{ structTarget || '请先在左侧选中一个段落' }}</b>
              </template>
              <template v-else><br />加入即插入到正文光标处（例题 / 练习）。</template>
            </p>
            <div class="pl2-bank-list">
              <div v-for="row in bankPool" :key="row.id" class="pl2-bank-card">
                <div class="pl2-bank-meta">
                  <span class="tag tag-gray">{{ row.type }}</span>
                  <span class="tag tag-gray">{{ row.difficulty }}</span>
                  <span v-if="row.knowledge[0]" class="tag tag-gray">{{ row.knowledge[0] }}</span>
                </div>
                <p class="pl2-bank-stem">{{ truncateRich(row.stem, 70) }}</p>
                <div class="pl2-bank-foot">
                  <span class="pl2-hint">{{ row.useCount }} 次使用</span>
                  <button class="mini-btn" :disabled="readonly" @click="pickQuestion(row)">
                    {{ mode === 'struct' ? '+ 加入段落' : '+ 插入正文' }}
                  </button>
                </div>
              </div>
              <p v-if="!bankPool.length" class="pl2-hint">没有符合条件的题目。</p>
            </div>
          </div>
        </template>

        <template v-else-if="panelRail === 'media'">
          <div class="pl2-side-head">
            <h3>媒体库</h3>
            <button class="pl2-icon-btn" type="button" title="收起" @click="panelRail = ''">
              <AppIcon name="close" :size="13" />
            </button>
          </div>
          <div class="pl2-side-body">
            <p class="pl2-hint">
              机构媒体库资源，点一张即插入到正文光标处。正文只存图片地址（不内联图片本身），
              所以本地新图请先用工具栏的「图片」上传。
            </p>
            <div class="pl2-media-grid">
              <button
                v-for="row in media"
                :key="row.id"
                class="pl2-media"
                type="button"
                :disabled="readonly"
                :title="`插入「${row.name}」到正文`"
                @click="insertMedia(row)"
              >
                <span class="pl2-media-thumb">
                  <img v-if="row.kind === 'image' && row.url" :src="row.url" :alt="row.name" />
                  <AppIcon v-else :name="row.kind === 'video' ? 'video' : 'smartphone'" :size="18" />
                </span>
                <span class="pl2-media-name">{{ truncateRich(row.name, 10) }}</span>
              </button>
            </div>
            <p v-if="mediaLoading" class="pl2-hint">媒体库加载中…</p>
            <p v-else-if="!media.length" class="pl2-hint">媒体库暂无资源。</p>
          </div>
        </template>

        <template v-else>
          <div class="pl2-side-head">
            <h3>编辑记录</h3>
            <button class="pl2-icon-btn" type="button" title="收起" @click="panelRail = ''">
              <AppIcon name="close" :size="13" />
            </button>
          </div>
          <div class="pl2-side-body">
            <p class="pl2-hint">
              本次打开的稿子在这里留下的快照（保存、停手一会儿各记一次）。点一条即把正文换回那一刻，
              确认无误后再保存。
            </p>
            <div class="pl2-timeline">
              <button
                v-for="(row, i) in snapshots.slice().reverse()"
                :key="`${row.time}-${i}`"
                class="pl2-tl-row"
                type="button"
                @click="restoreSnapshot(row)"
              >
                <b>{{ row.label }}</b>
                <em>{{ row.time }}</em>
              </button>
              <p v-if="!snapshots.length" class="pl2-hint">还没有记录。改点内容或保存一次就会出现。</p>
            </div>
          </div>
        </template>
      </aside>

      <!-- 图标竖栏：与试卷 / 教案编辑同一套（76px、图标在上文案在下、选中态用品牌色底） -->
      <nav class="pl2-rail">
        <button
          v-for="item in RAIL"
          :key="item.key"
          class="pl2-rail-btn"
          :class="{ on: railOn(item.key) }"
          type="button"
          :title="item.label"
          @click="onRailClick(item.key)"
        >
          <AppIcon :name="item.icon" :size="17" />
          <span>{{ item.label }}</span>
        </button>
      </nav>
    </div>

    <!-- ================= 底栏 ================= -->
    <footer class="pl2-foot">
      <span class="pl2-foot-chip">纸张 {{ paperLabel }}</span>
      <span class="pl2-foot-note">版心 / 页边距 / 页码在右侧「全局设置 → 页面设置」里调</span>

      <div class="pl2-foot-right">
        <span v-if="saving" class="pl2-foot-note">保存中…</span>
        <span v-else-if="dirty" class="pl2-foot-note is-warn">有未保存的改动</span>
        <span v-else-if="doc.updatedAt" class="pl2-foot-note">更新于 {{ doc.updatedAt }}</span>
        <span class="pl2-foot-stat">
          <template v-if="mode === 'doc'">{{ headCount }} 节 · {{ charCount }} 字 · 共 {{ pageCount }} 页</template>
          <template v-else>{{ structStat }}</template>
        </span>
      </div>
    </footer>

    <!-- ================= 预览（纸面 / 版式） =================
         学案 / 讲义原先有两个「预览」按钮（纸面、版式），名字一样、差别要点了才知道；
         合并成一个入口，在弹窗里切页签。版式由页面通过 #layout 插槽给 —— 教案纸与
         「带题的稿子」是两种完全不同的版式，塞进工作台只会让这里变成大杂烩。 -->
    <DocPreviewDialog
      v-if="previewOpen"
      :title="doc.name"
      :subtitle="[doc.subject, doc.grade, doc.textbook].filter(Boolean).join(' · ')"
      :content="previewContent"
      :page="doc.page"
      :tabs="previewTabs"
      :initial-tab="previewTab"
      @close="previewOpen = false"
    >
      <template #toolbar><slot name="preview-toolbar" /></template>
      <template #layout><slot name="layout" /></template>
    </DocPreviewDialog>

    <!-- AI 问答悬浮球：本页不在 AppLayout 里，全局那颗挂不到这儿 -->
    <AiAssistant />
  </div>
</template>

<style scoped>
/* 骨架与教案编辑页（PlanEditView 的 .pl2-*）逐值一致：同一套工作台，换文档类型不该换手感。
   改这里的高度 / 间距 / 圆角时，那边要同步 —— 两边都是全屏工作台，视觉上一眼能看出不一样。 */
.pl2-shell {
  --pl2-side-w: 312px;
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg);
}

/* ===== 顶栏 ===== */
.pl2-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 18px;
  background: #fff;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  position: sticky;
  top: 0;
  z-index: 30;
}
.pl2-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  padding: 4px 6px;
  margin-left: -6px;
  border: none;
  border-radius: 9px;
  background: transparent;
  font-family: inherit;
  font-size: 14px;
  font-weight: 700;
  color: var(--ink);
  white-space: nowrap;
  transition: background 0.15s;
}
.pl2-brand:hover { background: #f2f4fa; }
.pl2-brand img { width: 26px; height: 26px; border-radius: 7px; object-fit: contain; }
.pl2-head-sep { width: 1px; height: 22px; background: var(--border); flex-shrink: 0; }

.pl2-title-wrap { flex: 1; min-width: 0; }
.pl2-title {
  width: 100%;
  border: none;
  background: transparent;
  font-family: inherit;
  font-size: 16px;
  font-weight: 700;
  color: var(--ink);
  padding: 2px 4px;
  border-radius: 7px;
}
.pl2-title:hover { background: #f4f7fb; }
.pl2-title:focus { outline: none; background: #fff; box-shadow: 0 0 0 2px var(--brand-soft); }
.pl2-title-ro { padding: 2px 4px; }
.pl2-title-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 2px 4px 0;
  font-size: 12px;
  color: var(--sub);
}
.pl2-dirty { color: var(--warn); font-weight: 600; }
.pl2-head-ops { display: flex; align-items: center; gap: 8px; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; }
.pl2-user { display: flex; align-items: center; gap: 9px; flex-shrink: 0; padding: 5px 6px; }
.pl2-user-meta { display: flex; flex-direction: column; line-height: 1.25; }
.pl2-user-name { font-size: 13.5px; font-weight: 600; color: var(--ink); }
.pl2-user-role { font-size: 11px; color: var(--sub); }

/* ===== 工具带 ===== */
.pl2-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 18px;
  background: #fff;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  flex-wrap: wrap;
  z-index: 29;
}
.pl2-ribbon { flex: 1; min-width: 0; }
.pl2-toolbar-right { margin-left: auto; display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.pl2-toolbar-loading { flex: 1; font-size: 12.5px; color: var(--sub); padding: 8px 6px; }
.pl2-tool-label { font-size: 12px; color: var(--sub); }
.pl2-tool-hint { font-size: 12px; color: var(--sub); }
.pl2-tool-sep { width: 1px; height: 20px; background: var(--border); }
.pl2-tool {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  font-family: inherit;
  font-size: 12.5px;
  color: var(--ink-2);
}
.pl2-tool:hover { background: #f2f5fa; }
.pl2-tool.on { background: var(--brand-soft); color: var(--brand-deep); border-color: var(--brand); }

.pl2-seg { display: inline-flex; align-items: stretch; border: 1.5px solid var(--border); border-radius: 9px; overflow: hidden; background: #fff; }
.pl2-seg button {
  border: none;
  background: transparent;
  padding: 5px 9px;
  color: var(--ink-2);
  display: flex;
  align-items: center;
  justify-content: center;
}
.pl2-seg button:hover { background: #f2f5fa; }
/* 缩放数字可手输：`%` 单独一个 span，两者在 flex 行里居中对齐（当一整块文本居中会歪） */
.pl2-zoom-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1px;
  padding: 0 6px;
  border-left: 1px solid var(--border);
  border-right: 1px solid var(--border);
  font-size: 12.5px;
  color: var(--ink-2);
}
.pl2-zoom-cell input {
  width: 30px;
  border: none;
  background: transparent;
  padding: 0;
  font: inherit;
  line-height: 1;
  color: inherit;
  text-align: right;
}
.pl2-zoom-cell input:focus { outline: none; color: var(--brand-deep); font-weight: 600; }

/* 结构化编辑时的加段落按钮：与筛选 chip 同一套尺寸，但它是动作按钮（无选中态） */
.pl2-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.pl2-chip {
  border: 1.5px solid var(--border);
  border-radius: 8px;
  background: var(--card);
  color: var(--ink-2);
  font-family: inherit;
  font-size: 12.5px;
  padding: 4px 12px;
  white-space: nowrap;
  transition: border-color 0.12s, color 0.12s;
}
.pl2-chip:hover { border-color: var(--brand); color: var(--brand-deep); }

.pl2-input {
  width: 100%;
  height: 30px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0 9px;
  font-family: inherit;
  font-size: 12.5px;
  color: var(--ink);
  background: #fff;
}
.pl2-input:focus { outline: none; border-color: var(--brand); box-shadow: 0 0 0 3px var(--brand-soft); }

/* ===== 主体三栏 ===== */
.pl2-body { flex: 1; display: flex; min-height: 0; }

.pl2-outline {
  width: var(--pl2-side-w);
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  background: #fff;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
}
.pl2-outline-loading { padding: 16px; font-size: 12.5px; color: var(--sub); }

.pl2-ol-head {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 14px 14px 10px;
  font-size: 13px;
  font-weight: 700;
  color: var(--ink);
  flex-shrink: 0;
}
.pl2-ol-head .pl2-icon-btn { margin-left: auto; }
.pl2-ol-list { flex: 1; padding: 0 10px 14px; display: flex; flex-direction: column; gap: 2px; }

/* 分组名（教案的「教学过程」）：一行小字 + 上方的分隔，把「固定的几项」与「可增删的环节」分开 */
.pl2-ol-title {
  margin: 10px 2px 4px;
  padding-top: 9px;
  border-top: 1px dashed var(--border);
  font-size: 11.5px;
  font-weight: 700;
  color: var(--sub);
  letter-spacing: 0.3px;
}

.pl2-ol-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  border: 1.5px solid transparent;
  border-radius: 9px;
  padding: 7px 8px;
  background: transparent;
  font-family: inherit;
  text-align: left;
}
.pl2-ol-row:hover { background: #f2f5fa; }
.pl2-ol-row.on { border-color: var(--brand); background: var(--brand-soft); }
.pl2-ol-pick {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  border: none;
  background: transparent;
  font-family: inherit;
  text-align: left;
  padding: 0;
}
.pl2-ol-no {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  border-radius: 6px;
  background: #eef1f7;
  color: var(--ink-2);
  font-size: 11.5px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
.pl2-ol-row.on .pl2-ol-no { background: var(--brand); color: #fff; }
.pl2-ol-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.pl2-ol-main b { font-size: 13px; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pl2-ol-main em { font-size: 11px; color: var(--sub); font-style: normal; }
.pl2-ol-ops { display: flex; align-items: center; gap: 2px; opacity: 0; transition: opacity 0.15s; }
.pl2-ol-row:hover .pl2-ol-ops { opacity: 1; }

.pl2-icon-btn {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--sub);
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.pl2-icon-btn:hover { background: #f2f5fa; color: var(--brand-deep); }
.pl2-icon-btn.danger:hover { background: var(--danger-soft); color: var(--danger); }

/* 中：画布 / 段落编辑 */
.pl2-stage {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #eef1f6;
}
/* 目录开关：贴在左边界上的竖把手，绝对定位不占版面宽度 —— 目录收起时画布是满宽的 */
.pl2-outline-tab {
  position: absolute;
  left: 0;
  top: 10px;
  z-index: 25;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 5px;
  border: 1px solid var(--border);
  border-left: none;
  border-radius: 0 10px 10px 0;
  background: #fff;
  color: var(--ink-2);
  font-size: 12px;
  writing-mode: vertical-rl;
  letter-spacing: 2px;
  box-shadow: 2px 0 8px rgba(20, 30, 60, 0.07);
}
.pl2-outline-tab:hover { color: var(--brand-deep); border-color: var(--brand); }

/* 编辑器那一栏要占满，画布自己滚（见 DocCanvas 的 is-bare） */
.pl2-editor { flex: 1; min-width: 0; min-height: 0; }

/* 结构化：段落表单一列铺开，宽度给足（学案要写留白、讲义要写例题） */
.pl2-struct { flex: 1; min-height: 0; overflow-y: auto; padding: 18px 26px 40px; }

/* 右：面板 */
.pl2-side {
  width: var(--pl2-side-w);
  flex-shrink: 0;
  border-left: 1px solid var(--border);
  background: #fff;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.pl2-side-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.pl2-side-head h3 { font-size: 13.5px; font-weight: 700; }
.pl2-side-body { flex: 1; overflow-y: auto; padding: 14px; }

.pl2-filters { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px; }
.pl2-filters select {
  height: 32px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0 8px;
  font-family: inherit;
  font-size: 12.5px;
  color: var(--ink);
  background: #fff;
}
.pl2-side-body .pl2-input { margin-bottom: 10px; }

.pl2-bank-list { display: flex; flex-direction: column; gap: 9px; margin-top: 10px; }
.pl2-bank-card { border: 1.5px solid var(--border); border-radius: 10px; padding: 9px 11px; background: #fff; }
.pl2-bank-meta { display: flex; gap: 5px; margin-bottom: 5px; flex-wrap: wrap; }
.pl2-bank-stem { font-size: 12.5px; color: var(--ink-2); line-height: 1.6; }
.pl2-bank-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 6px; }

.pl2-media-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; margin-top: 10px; }
.pl2-media {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  padding: 8px 6px;
  border: 1.5px solid var(--border);
  border-radius: 10px;
  background: #fff;
}
.pl2-media:hover:not(:disabled) { border-color: var(--brand); }
.pl2-media:disabled { opacity: 0.6; cursor: not-allowed; }
.pl2-media-thumb {
  width: 100%;
  height: 62px;
  border-radius: 7px;
  background: #f4f6fb;
  color: var(--sub);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.pl2-media-thumb img { width: 100%; height: 100%; object-fit: cover; }
.pl2-media-name { font-size: 11.5px; color: var(--ink-2); }

.pl2-timeline { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
.pl2-tl-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: #fff;
  font-family: inherit;
  font-size: 12.5px;
  color: var(--ink-2);
  text-align: left;
}
.pl2-tl-row:hover { border-color: var(--brand); color: var(--brand-deep); }
.pl2-tl-row em { font-style: normal; font-size: 11.5px; color: var(--sub); }

/* 图标竖栏：与试卷 / 教案编辑逐值一致 */
.pl2-rail {
  width: 76px;
  flex-shrink: 0;
  border-left: 1px solid var(--border);
  background: #fff;
  padding: 10px 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
}
.pl2-rail-btn {
  border: none;
  background: transparent;
  border-radius: 10px;
  padding: 9px 4px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  font-family: inherit;
  font-size: 11px;
  color: var(--ink-2);
}
.pl2-rail-btn:hover { background: #f2f5fa; }
.pl2-rail-btn.on { background: var(--brand-soft); color: var(--brand-deep); font-weight: 600; }

.pl2-hint { font-size: 11.5px; color: var(--sub); line-height: 1.7; }

/* ===== 底栏 ===== */
.pl2-foot {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 18px;
  background: #fff;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
  flex-wrap: wrap;
}
.pl2-foot-chip {
  padding: 3px 10px;
  border-radius: 999px;
  background: #eef1f7;
  color: var(--ink-2);
  font-size: 12px;
  font-weight: 600;
}
.pl2-foot-note { font-size: 12px; color: var(--sub); margin-left: 4px; }
.pl2-foot-note.is-warn { color: var(--warn); }
.pl2-foot-right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.pl2-foot-stat { font-size: 12px; color: var(--sub); }
</style>
