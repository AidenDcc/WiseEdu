<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { AppIcon, MATERIAL_STATUS_TEXT, PAPER_STATUS_TEXT, showToast, toPlainText } from '@aiteach/shared'
import type { OrgPaper, OrgSearchResult } from '@aiteach/shared'
import { fetchGlobalSearch } from '@/api/org'
import { searchImageEngine, searchKeywordFromImage } from '@/api/ai-search'

/**
 * 全局搜索面板（FR-GN-026）：顶部搜索框为只读触发器，点击后弹出本面板。
 * 支持文本检索与以图搜资源，结果按 题目 / 试卷 / 同步备课 / 视频 / 我的文件 五个页签分列。
 *
 * 检索走后端（mock 为 /tenant/search），一次请求返回全部分类，切页签不再重新请求；
 * 图片搜索只产出关键词，随后与文本搜索共用同一条检索链路。
 */
const emit = defineEmits<{ close: [] }>()
const router = useRouter()

/** 页签顺序即展示顺序，key 与搜索接口返回的分类字段一致 */
const TABS = [
  { key: 'questions', label: '题目', icon: 'edit' },
  { key: 'papers', label: '试卷', icon: 'file' },
  { key: 'preparations', label: '同步备课', icon: 'book' },
  { key: 'videos', label: '视频', icon: 'smartphone' },
  { key: 'files', label: '我的文件', icon: 'folder' },
] as const
type TabKey = (typeof TABS)[number]['key']

/** 空态推荐词：均能在演示数据中命中结果 */
const HOT_KEYWORDS = ['函数', '三角函数', '立体几何', '浮力', '概率']

const keyword = ref('')
const activeTab = ref<TabKey>('questions')
const result = ref<OrgSearchResult | null>(null)
const loading = ref(false)
/** 图片识别中：与文本检索的 loading 区分，用于提示文案与按钮禁用 */
const imageBusy = ref(false)
/** 图片搜索完成后的提示（识别出的关键词 + 识图来源） */
const imageNote = ref('')
const dragging = ref(false)

const inputRef = ref<HTMLInputElement | null>(null)
const fileRef = ref<HTMLInputElement | null>(null)
const bodyRef = ref<HTMLElement | null>(null)

const questions = computed(() => result.value?.questions ?? [])
const papers = computed(() => result.value?.papers ?? [])
const preparations = computed(() => result.value?.preparations ?? [])
const videos = computed(() => result.value?.videos ?? [])
const files = computed(() => result.value?.files ?? [])

function countOf(key: TabKey): number {
  return result.value ? result.value[key].length : 0
}
const totalHits = computed(() => TABS.reduce((sum, tab) => sum + countOf(tab.key), 0))
/** 当前页签无结果、其它页签有结果时的跳转目标（避免用户以为整个搜索都没命中） */
const otherTab = computed(() => TABS.find((tab) => tab.key !== activeTab.value && countOf(tab.key) > 0) ?? null)

/* ===== 文本检索 ===== */
/** 递增的请求序号：图片搜索与连续输入可能并发，只接受最后一次的结果 */
let searchSeq = 0
let debounceTimer: number | undefined
/** 已完成检索的关键词：图片搜索回填输入框后跳过 watcher 里排的重复检索 */
const searchedKeyword = ref('')

async function runSearch(kw: string) {
  const seq = (searchSeq += 1)
  searchedKeyword.value = kw
  loading.value = true
  try {
    const data = await fetchGlobalSearch(kw)
    if (seq !== searchSeq) return
    result.value = data
  } catch (error) {
    if (seq !== searchSeq) return
    result.value = null
    showToast((error as Error).message || '搜索失败，请稍后重试', 'error')
  } finally {
    if (seq === searchSeq) loading.value = false
  }
}

watch(keyword, (value) => {
  window.clearTimeout(debounceTimer)
  const kw = value.trim()
  if (!kw) {
    /* 关键字清空即撤回列表：作废在途请求，避免过期响应把结果又填回来 */
    searchSeq += 1
    searchedKeyword.value = ''
    result.value = null
    loading.value = false
    return
  }
  if (kw === searchedKeyword.value) return
  debounceTimer = window.setTimeout(() => void runSearch(kw), 260)
})

function onHotKeyword(word: string) {
  imageNote.value = ''
  keyword.value = word
}

function switchTab(key: TabKey) {
  activeTab.value = key
  bodyRef.value?.scrollTo({ top: 0 })
}

/* ===== 图片搜索 ===== */
async function runImageSearch(file: File) {
  if (!file.type.startsWith('image/')) {
    showToast('请选择图片文件（支持截图、拍照或本地图片）', 'error')
    return
  }
  imageBusy.value = true
  imageNote.value = ''
  keyword.value = ''
  searchSeq += 1
  result.value = null
  try {
    const word = await searchKeywordFromImage(file)
    if (!word) {
      imageNote.value = `未能从「${file.name}」中识别出可检索的内容，请换一张更清晰的图片或改用文本搜索`
      return
    }
    imageNote.value = `已按图片识别结果检索：${word}（${searchImageEngine() === 'vision' ? '真实 AI 识图' : '本地演示识图'}）`
    keyword.value = word
    await runSearch(word)
  } catch (error) {
    imageNote.value = ''
    showToast((error as Error).message || '图片识别失败，请稍后重试', 'error')
  } finally {
    imageBusy.value = false
  }
}

function onPickFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  /* 复位 value：连续选同一张图片也要触发 change */
  input.value = ''
  if (file) void runImageSearch(file)
}

/* 拖拽计数：dragleave 会在子元素上冒泡触发，用深度计数避免高亮闪烁 */
let dragDepth = 0
function onDragEnter() {
  dragDepth += 1
  dragging.value = true
}
function onDragLeave() {
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) dragging.value = false
}
function onDrop(event: DragEvent) {
  dragDepth = 0
  dragging.value = false
  const file = event.dataTransfer?.files?.[0]
  if (file) void runImageSearch(file)
}

/** 直接粘贴截图即搜（面板打开期间生效；文本粘贴仍由输入框自身处理） */
function onPaste(event: ClipboardEvent) {
  const file = [...(event.clipboardData?.items ?? [])]
    .find((item) => item.kind === 'file' && item.type.startsWith('image/'))
    ?.getAsFile()
  if (!file) return
  event.preventDefault()
  void runImageSearch(file)
}

/* ===== 关闭与跳转 ===== */
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
}

onMounted(() => {
  inputRef.value?.focus()
  document.addEventListener('keydown', onKeydown)
  document.addEventListener('paste', onPaste)
})
onBeforeUnmount(() => {
  window.clearTimeout(debounceTimer)
  document.removeEventListener('keydown', onKeydown)
  document.removeEventListener('paste', onPaste)
})

function go(path: string) {
  emit('close')
  router.push(path)
}

const fileSizeText = (sizeMb: number) => `${sizeMb.toFixed(1)} MB`
const durationText = (seconds?: number) =>
  seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : ''
function scoreOf(paper: OrgPaper) {
  return paper.sections.reduce((sum, section) => sum + section.questions.reduce((total, q) => total + q.score, 0), 0)
}
function questionCountOf(paper: OrgPaper) {
  return paper.sections.reduce((sum, section) => sum + section.questions.length, 0)
}
</script>

<template>
  <Teleport to="body">
    <div class="search-mask" @click.self="emit('close')">
      <div
        class="search-box panel"
        :class="{ dragging }"
        @dragenter.prevent="onDragEnter"
        @dragover.prevent
        @dragleave.prevent="onDragLeave"
        @drop.prevent="onDrop"
      >
        <!-- ===== 搜索输入 + 图片搜索 ===== -->
        <header class="box-head">
          <div class="input-row">
            <AppIcon name="search" :size="17" class="input-ico" />
            <input
              ref="inputRef"
              v-model="keyword"
              class="input"
              placeholder="搜索题目 / 试卷 / 备课资料 / 视频 / 文件"
              @input="imageNote = ''"
            />
            <button class="img-btn" type="button" :disabled="imageBusy" @click="fileRef?.click()">
              <AppIcon name="image" :size="14" />
              {{ imageBusy ? '识别中…' : '图片搜索' }}
            </button>
            <input ref="fileRef" class="file-input" type="file" accept="image/*" @change="onPickFile" />
            <button class="box-x" type="button" title="关闭（Esc）" @click="emit('close')">
              <AppIcon name="close" :size="16" />
            </button>
          </div>
          <p v-if="imageNote" class="img-note">{{ imageNote }}</p>
          <p v-else-if="imageBusy" class="img-note busy">
            <AppIcon name="clock" :size="13" class="spin" />
            正在识别图片内容并提取检索关键词…
          </p>
        </header>

        <!-- ===== 分类页签 ===== -->
        <nav class="tabs">
          <button
            v-for="tab in TABS"
            :key="tab.key"
            class="tab"
            :class="{ active: activeTab === tab.key }"
            type="button"
            @click="switchTab(tab.key)"
          >
            <AppIcon :name="tab.icon" :size="14" />
            {{ tab.label }}
            <span v-if="countOf(tab.key)" class="tab-count">{{ countOf(tab.key) }}</span>
          </button>
        </nav>

        <!-- ===== 结果列表 ===== -->
        <div ref="bodyRef" class="box-body">
          <div v-if="loading" class="state">
            <AppIcon name="clock" :size="18" class="spin" />
            正在检索…
          </div>

          <!-- 未输入：引导文案 + 推荐词 -->
          <div v-else-if="!result" class="state idle">
            <p>支持文本搜索与图片搜索，结果按题目、试卷、同步备课、视频、我的文件分类展示。</p>
            <div class="hot">
              <span class="hot-label">热门搜索</span>
              <button v-for="word in HOT_KEYWORDS" :key="word" class="hot-chip" type="button" @click="onHotKeyword(word)">
                {{ word }}
              </button>
            </div>
            <p class="hot-tip">也可以把图片拖到面板里，或直接粘贴截图，按图片内容检索。</p>
          </div>

          <div v-else-if="totalHits === 0" class="state">
            <p>未找到「{{ keyword }}」相关内容</p>
            <p class="state-sub">试试更换关键词，或用图片搜索。</p>
          </div>

          <!-- 当前分类无结果：给出其它分类的入口 -->
          <div v-else-if="countOf(activeTab) === 0" class="state">
            <p>「{{ TABS.find((tab) => tab.key === activeTab)?.label }}」分类下没有匹配结果</p>
            <button v-if="otherTab" class="jump-btn" type="button" @click="switchTab(otherTab.key)">
              查看「{{ otherTab.label }}」（{{ countOf(otherTab.key) }}）
            </button>
          </div>

          <template v-else>
            <!-- 题目 -->
            <template v-if="activeTab === 'questions'">
              <button v-for="row in questions" :key="row.id" class="row" type="button" @click="go(`/question/create?id=${row.id}`)">
                <span class="row-ico"><AppIcon name="edit" :size="15" /></span>
                <span class="row-main">
                  <span class="row-title">{{ toPlainText(row.stem) }}</span>
                  <span class="row-meta">{{ row.subject }} · {{ row.grade }} · {{ row.type }} · {{ row.difficulty }}</span>
                </span>
                <span class="row-side">#{{ row.id }}</span>
              </button>
            </template>

            <!-- 试卷 -->
            <template v-else-if="activeTab === 'papers'">
              <button v-for="row in papers" :key="row.id" class="row" type="button" @click="go(`/paper/collab?id=${row.id}`)">
                <span class="row-ico"><AppIcon name="file" :size="15" /></span>
                <span class="row-main">
                  <span class="row-title">{{ row.name }}</span>
                  <span class="row-meta">
                    {{ row.subject }} · {{ row.grade }} · {{ questionCountOf(row) }} 题 · {{ scoreOf(row) }} 分 ·
                    {{ PAPER_STATUS_TEXT[row.status] }}
                  </span>
                </span>
                <span class="row-side">{{ row.updatedAt.slice(0, 10) }}</span>
              </button>
            </template>

            <!-- 同步备课（教辅资料） -->
            <template v-else-if="activeTab === 'preparations'">
              <button v-for="row in preparations" :key="row.id" class="row" type="button" @click="go('/material/list')">
                <span class="row-ico"><AppIcon name="book" :size="15" /></span>
                <span class="row-main">
                  <span class="row-title">{{ row.name }}</span>
                  <span class="row-meta">
                    {{ row.type }} · {{ row.subject }} · {{ row.knowledge.join(' / ') }} · {{ MATERIAL_STATUS_TEXT[row.status] }}
                  </span>
                </span>
                <span class="row-side">{{ row.sizeMb }} MB</span>
              </button>
            </template>

            <!-- 视频（多媒体微课） -->
            <template v-else-if="activeTab === 'videos'">
              <button v-for="row in videos" :key="row.id" class="row" type="button" @click="go('/material/media/video')">
                <span class="row-ico"><AppIcon name="smartphone" :size="15" /></span>
                <span class="row-main">
                  <span class="row-title">{{ row.name }}</span>
                  <span class="row-meta">{{ row.subject }} · {{ row.knowledge.join(' / ') }} · {{ row.owner }}</span>
                </span>
                <span class="row-side">{{ durationText(row.durationSec) }}</span>
              </button>
            </template>

            <!-- 我的文件 -->
            <template v-else>
              <button v-for="row in files" :key="row.id" class="row" type="button" @click="go('/file')">
                <span class="row-ico"><AppIcon name="folder" :size="15" /></span>
                <span class="row-main">
                  <span class="row-title">{{ row.name }}</span>
                  <span class="row-meta">{{ row.kind.toUpperCase() }} · {{ row.owner }} · {{ row.uploadedAt.slice(0, 10) }}</span>
                </span>
                <span class="row-side">{{ fileSizeText(row.sizeMb) }}</span>
              </button>
            </template>
          </template>
        </div>

        <!-- ===== 拖拽提示 ===== -->
        <div v-if="dragging" class="drop-hint">
          <AppIcon name="image" :size="22" />
          松开即可按图片内容检索
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.search-mask {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(20, 26, 40, 0.42);
  backdrop-filter: blur(2px);
  display: flex;
  justify-content: center;
  padding: 76px 24px 24px;
  animation: fade-in 0.16s ease;
}
.search-box {
  position: relative;
  width: 720px;
  max-width: 100%;
  height: fit-content;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-lg);
  animation: pop-in 0.2s cubic-bezier(0.34, 1.4, 0.64, 1);
}
.search-box.dragging { border-color: var(--brand); }

/* ---- 输入区 ---- */
.box-head { padding: 16px 18px 10px; border-bottom: 1px solid var(--border); }
.input-row { display: flex; align-items: center; gap: 10px; }
.input-ico { color: var(--sub); flex-shrink: 0; }
.input {
  flex: 1;
  min-width: 0;
  height: 38px;
  border: 1.5px solid var(--border);
  border-radius: 10px;
  background: #f7fafa;
  padding: 0 12px;
  font-size: 14px;
  color: var(--ink);
  outline: none;
  transition: border-color 0.15s, background 0.15s;
}
.input:focus { border-color: var(--brand); background: #fff; }
.img-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 38px;
  padding: 0 14px;
  border: 1.5px solid var(--border);
  border-radius: 10px;
  background: #fff;
  color: var(--ink-2);
  font-size: 13px;
  font-weight: 600;
  flex-shrink: 0;
  transition: border-color 0.15s, color 0.15s;
}
.img-btn:hover:not(:disabled) { border-color: var(--brand); color: var(--brand); }
.img-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.file-input { display: none; }
.box-x {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--sub);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background 0.15s, color 0.15s;
}
.box-x:hover { background: #f2f4fa; color: var(--ink); }
.img-note {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  padding: 7px 10px;
  border-radius: 8px;
  background: var(--brand-soft);
  color: var(--brand-deep);
  font-size: 12.5px;
  line-height: 1.6;
}
.img-note.busy { background: #f2f4fa; color: var(--sub); }

/* ---- 页签 ---- */
.tabs { display: flex; gap: 4px; padding: 8px 12px 0; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: transparent;
  color: var(--ink-2);
  font-size: 13.5px;
  font-weight: 600;
  padding: 9px 12px;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: color 0.15s;
}
.tab:hover { color: var(--brand-deep); }
.tab.active { color: var(--brand); border-bottom-color: var(--brand); }
.tab-count {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: #f2f4fa;
  color: var(--sub);
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
.tab.active .tab-count { background: var(--brand-soft); color: var(--brand); }

/* ---- 结果列表 ---- */
.box-body {
  min-height: 300px;
  max-height: min(52vh, 500px);
  overflow-y: auto;
  padding: 8px;
}
.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 260px;
  color: var(--sub);
  font-size: 13px;
  text-align: center;
  padding: 0 24px;
}
.state-sub { font-size: 12.5px; }
.state.idle { gap: 14px; line-height: 1.8; }
.hot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: center; }
.hot-label { font-size: 12.5px; color: var(--sub); }
.hot-chip {
  border: 1px solid var(--border);
  border-radius: 999px;
  background: #f7fafa;
  color: var(--ink-2);
  font-size: 12.5px;
  padding: 4px 12px;
  transition: border-color 0.15s, color 0.15s;
}
.hot-chip:hover { border-color: var(--brand); color: var(--brand); }
.hot-tip { font-size: 12px; color: var(--sub); }
.jump-btn {
  border: 1px solid var(--brand);
  border-radius: 999px;
  background: var(--brand-soft);
  color: var(--brand);
  font-size: 12.5px;
  font-weight: 600;
  padding: 5px 14px;
}
.jump-btn:hover { background: var(--brand); color: #fff; }

.row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  border: none;
  background: transparent;
  text-align: left;
  padding: 11px 12px;
  border-radius: 10px;
  transition: background 0.15s;
}
.row:hover { background: var(--brand-soft); }
.row-ico {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: #f2f4fa;
  color: var(--brand);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.row:hover .row-ico { background: #fff; }
.row-main { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1; }
.row-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--ink);
  line-height: 1.5;
  /* 题干等长文本最多两行，超出省略 */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.row-meta { font-size: 12px; color: var(--sub); }
.row-side { font-size: 12px; color: var(--sub); flex-shrink: 0; }

.drop-hint {
  position: absolute;
  inset: 0;
  z-index: 2;
  border-radius: var(--radius);
  background: rgba(255, 255, 255, 0.92);
  border: 2px dashed var(--brand);
  color: var(--brand);
  font-size: 14px;
  font-weight: 600;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes pop-in {
  from { opacity: 0; transform: translateY(-14px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
</style>
