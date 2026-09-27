<script setup lang="ts">
/**
 * 微课与视频切片。
 *
 * 单路由页面：左列视频资源列表，右列选中视频的时间轴 + 切片列表；新建/编辑切片走弹窗，
 * 关联题目走抽屉。顶部可按知识点/关键字跨视频检索切片。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { AppIcon, showToast, truncateRich } from '@aiteach/shared'
import type { OrgMedia, OrgQuestion, VideoClip } from '@aiteach/shared'
import AppModal from '@/components/ui/AppModal.vue'
import AppDrawer from '@/components/ui/AppDrawer.vue'
import { deleteVideoClip, fetchMedia, fetchQuestions, fetchVideoClips, saveVideoClip } from '@/api/org'
import { useBaseData } from '@/composables/useBaseData'

const { subjects, ensure, pick } = useBaseData()

const videos = ref<OrgMedia[]>([])
const selectedId = ref<number | null>(null)
const selectedVideo = computed(() => videos.value.find((row) => row.id === selectedId.value) ?? null)
/** 视频时长（秒），无 durationSec 时兜底 10 分钟 */
const duration = computed(() => selectedVideo.value?.durationSec ?? 600)
const durationUnknown = computed(() => !selectedVideo.value?.durationSec)

const clips = ref<VideoClip[]>([])
const allClips = ref<VideoClip[]>([])
const questions = ref<OrgQuestion[]>([])

const CLIP_COLORS = ['#00b4a6', '#4f6ef7', '#f0a23c', '#e0567a', '#7b61ff', '#2bb673', '#f5622d', '#16a3b3']
const colorOf = (clip: VideoClip) => {
  const i = clips.value.findIndex((row) => row.id === clip.id)
  return CLIP_COLORS[(i < 0 ? 0 : i) % CLIP_COLORS.length]
}

/* ================= 时间格式化 ================= */
function fmt(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
function parseTime(raw: string): number {
  const t = raw.trim()
  if (!t) return NaN
  if (t.includes(':')) {
    const [m, s] = t.split(':')
    const mm = Number(m)
    const ss = Number(s)
    if (Number.isNaN(mm) || Number.isNaN(ss)) return NaN
    return mm * 60 + ss
  }
  return Number(t)
}

/* ================= 跨视频检索 ================= */
const clipSearch = reactive({ knowledge: '', keyword: '' })
const searchActive = computed(() => !!(clipSearch.knowledge.trim() || clipSearch.keyword.trim()))
const searchResult = computed(() => {
  const kw = clipSearch.keyword.trim()
  const kd = clipSearch.knowledge.trim()
  return allClips.value.filter(
    (row) =>
      (!kd || row.knowledge.some((k) => k.includes(kd))) &&
      (!kw || row.title.includes(kw) || row.note.includes(kw)),
  )
})

/* ================= 视频选择 ================= */
async function selectVideo(id: number) {
  selectedId.value = id
  await loadClips(id)
}

async function loadClips(mediaId?: number) {
  clips.value = await fetchVideoClips(mediaId)
}
async function loadAllClips() {
  allClips.value = await fetchVideoClips()
}

/* ================= 时间轴点击预填起始时间 ================= */
const pendingStart = ref<number | null>(null)
function onTrackClick(event: MouseEvent) {
  const el = event.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  const ratio = (event.clientX - rect.left) / rect.width
  pendingStart.value = Math.round(Math.max(0, Math.min(1, ratio)) * duration.value)
}

/* ================= 新建 / 编辑切片 ================= */
const clipOpen = ref(false)
const clipEditingId = ref<number | null>(null)
const clipForm = reactive({ title: '', startText: '', endText: '', knowledgeText: '', note: '' })

function openNewClip() {
  if (!selectedId.value) {
    showToast('请先在左侧选择一个视频', 'error')
    return
  }
  clipEditingId.value = null
  clipForm.title = ''
  clipForm.startText = pendingStart.value != null ? fmt(pendingStart.value) : '0:00'
  clipForm.endText = fmt(duration.value)
  clipForm.knowledgeText = ''
  clipForm.note = ''
  clipOpen.value = true
}

function openEditClip(clip: VideoClip) {
  clipEditingId.value = clip.id
  clipForm.title = clip.title
  clipForm.startText = fmt(clip.start)
  clipForm.endText = fmt(clip.end)
  clipForm.knowledgeText = clip.knowledge.join('、')
  clipForm.note = clip.note
  clipOpen.value = true
}

async function submitClip() {
  if (!selectedId.value) return
  const title = clipForm.title.trim()
  if (title.length < 1) {
    showToast('切片标题不能为空', 'error')
    return
  }
  const start = parseTime(clipForm.startText)
  const end = parseTime(clipForm.endText)
  if (Number.isNaN(start) || Number.isNaN(end)) {
    showToast('请输入有效的时间（如 1:30 或 90）', 'error')
    return
  }
  if (start < 0) {
    showToast('开始时间不能为负', 'error')
    return
  }
  if (end <= start) {
    showToast('结束时间须大于开始时间', 'error')
    return
  }
  if (!durationUnknown.value && end > duration.value) {
    showToast(`超出视频总长（${fmt(duration.value)}）`, 'error')
    return
  }
  try {
    await saveVideoClip({
      id: clipEditingId.value ?? undefined,
      mediaId: selectedId.value,
      title,
      start,
      end,
      knowledge: clipForm.knowledgeText
        .split(/[、,，\s]+/)
        .map((row) => row.trim())
        .filter(Boolean),
      note: clipForm.note.trim(),
      questionIds: clipEditingId.value != null ? (clips.value.find((row) => row.id === clipEditingId.value)?.questionIds ?? []) : [],
    })
    clipOpen.value = false
    pendingStart.value = null
    await Promise.all([loadClips(selectedId.value), loadAllClips()])
    showToast(clipEditingId.value != null ? '切片已更新' : '切片已创建', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '保存失败', 'error')
  }
}

async function onDeleteClip(clip: VideoClip) {
  if (!window.confirm(`删除切片《${clip.title}》？`)) return
  try {
    await deleteVideoClip(clip.id)
    await Promise.all([loadClips(selectedId.value ?? undefined), loadAllClips()])
    showToast('切片已删除', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '删除失败', 'error')
  }
}

/* ================= 关联题目抽屉 ================= */
const linkOpen = ref(false)
const linkClip = ref<VideoClip | null>(null)
const linkSelected = ref<number[]>([])
const bankFilter = reactive({ type: '', difficulty: '', keyword: '' })
const bankPool = computed(() =>
  questions.value.filter(
    (row) =>
      row.status === 'approved' &&
      (!bankFilter.type || row.type === bankFilter.type) &&
      (!bankFilter.difficulty || row.difficulty === bankFilter.difficulty) &&
      (!bankFilter.keyword || row.stem.includes(bankFilter.keyword)),
  ),
)
const itemOf = (id: number) => questions.value.find((row) => row.id === id)

function openLink(clip: VideoClip) {
  linkClip.value = clip
  linkSelected.value = [...clip.questionIds]
  linkOpen.value = true
}
function toggleLink(id: number) {
  const i = linkSelected.value.indexOf(id)
  if (i >= 0) linkSelected.value.splice(i, 1)
  else linkSelected.value.push(id)
}
async function saveLink() {
  if (!linkClip.value || !selectedId.value) return
  try {
    await saveVideoClip({
      id: linkClip.value.id,
      mediaId: linkClip.value.mediaId,
      title: linkClip.value.title,
      start: linkClip.value.start,
      end: linkClip.value.end,
      knowledge: linkClip.value.knowledge,
      note: linkClip.value.note,
      questionIds: linkSelected.value,
    })
    linkOpen.value = false
    await Promise.all([loadClips(selectedId.value), loadAllClips()])
    showToast('关联题目已保存', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '保存失败', 'error')
  }
}

/* ================= 数据 ================= */
async function load() {
  await ensure()
  const media = await fetchMedia()
  videos.value = media.filter((row) => row.kind === 'video')
  questions.value = await fetchQuestions()
  await loadAllClips()
  /* 首屏优先落在已有切片的视频上，避免打开就是一个空轨道 */
  if (!selectedId.value && videos.value.length) {
    const withClip = videos.value.find((row) => allClips.value.some((clip) => clip.mediaId === row.id))
    await selectVideo((withClip ?? videos.value[0]).id)
  }
}

onMounted(load)
</script>

<template>
  <div class="page clip-page">
    <div class="page-head">
      <div>
        <h2 style="font-size: 18px; font-weight: 700">微课与视频切片</h2>
        <p class="f-hint" style="margin-top: 4px">
          在一条视频上按时间打点，标注知识点并关联题目，切片可作为课前预习 / 课堂素材复用。
        </p>
      </div>
      <div class="op-group">
        <input v-model="clipSearch.keyword" class="f-input" placeholder="检索切片标题 / 备注" style="width: 180px" />
        <input v-model="clipSearch.knowledge" class="f-input" placeholder="知识点" style="width: 130px" />
        <span v-if="searchActive" class="f-hint">命中 {{ searchResult.length }} 条</span>
      </div>
    </div>

    <div class="clip-body">
      <!-- 左：视频列表 -->
      <aside class="panel clip-videos">
        <div class="section-title" style="margin-bottom: 10px">视频资源（{{ videos.length }}）</div>
        <p v-if="!videos.length" class="f-hint" style="padding: 16px; text-align: center">暂无视频资源</p>
        <div
          v-for="v in videos"
          :key="v.id"
          class="cv-row"
          :class="{ on: v.id === selectedId }"
          @click="selectVideo(v.id)"
        >
          <div class="cv-thumb"><AppIcon name="video" :size="22" /></div>
          <div class="cv-main">
            <b>{{ v.name }}</b>
            <em>{{ fmt(v.durationSec ?? 0) }} · {{ v.sizeMb }} MB · {{ v.knowledge.slice(0, 2).join('/') || '未关联知识点' }}</em>
          </div>
        </div>
      </aside>

      <!-- 右：时间轴 + 切片列表 -->
      <section class="clip-right">
        <div v-if="selectedVideo" class="panel clip-timeline">
          <div class="ct-head">
            <b>{{ selectedVideo.name }}</b>
            <span v-if="durationUnknown" class="tag tag-orange">时长未知，按 10 分钟估算</span>
            <span v-else class="f-hint">总时长 {{ fmt(duration) }}</span>
            <button class="btn btn-primary btn-sm" style="margin-left: auto" @click="openNewClip">
              <AppIcon name="plus" :size="14" /> 新建切片
            </button>
          </div>
          <div class="track" @click="onTrackClick">
            <div
              v-for="c in clips"
              :key="c.id"
              class="seg"
              :style="{ left: `${(c.start / duration) * 100}%`, width: `${((c.end - c.start) / duration) * 100}%`, background: colorOf(c) }"
              :title="`${c.title} · ${fmt(c.start)}–${fmt(c.end)}`"
              @click.stop="openEditClip(c)"
            >
              <span class="seg-title">{{ c.title }}</span>
            </div>
            <div v-if="pendingStart != null" class="track-cursor" :style="{ left: `${(pendingStart / duration) * 100}%` }" />
          </div>
          <p class="f-hint" style="margin-top: 8px">
            <template v-if="pendingStart != null">已预选起始位置 {{ fmt(pendingStart) }}（点「新建切片」将带入）；</template>
            点击轨道任意位置可定位起始时间，点击彩色段可编辑该切片。
          </p>
        </div>

        <!-- 跨视频检索结果 -->
        <div v-if="searchActive" class="panel clip-list">
          <div class="section-title" style="margin-bottom: 10px">跨视频检索结果（{{ searchResult.length }}）</div>
          <p v-if="!searchResult.length" class="f-hint" style="padding: 16px; text-align: center">没有匹配的切片</p>
          <div v-for="c in searchResult" :key="c.id" class="cl-row" @click="c.mediaId && selectVideo(c.mediaId)">
            <div class="cl-head">
              <b>{{ c.title }}</b>
              <span class="tag tag-gray">{{ c.mediaName }}</span>
            </div>
            <p class="cl-meta">{{ fmt(c.start) }}–{{ fmt(c.end) }} · {{ c.knowledge.join('/') || '无知识点' }} · {{ c.createdBy }}</p>
          </div>
        </div>

        <!-- 当前视频切片列表 -->
        <div v-else class="panel clip-list">
          <div class="section-title" style="margin-bottom: 10px">
            切片列表（{{ clips.length }}）<template v-if="selectedVideo"> · {{ selectedVideo.name }}</template>
          </div>
          <p v-if="!selectedVideo" class="f-hint" style="padding: 16px; text-align: center">请选择左侧视频</p>
          <p v-else-if="!clips.length" class="f-hint" style="padding: 16px; text-align: center">该视频暂无切片，点上方「新建切片」</p>
          <div v-for="c in clips" :key="c.id" class="cl-row">
            <span class="cl-bar" :style="{ background: colorOf(c) }" />
            <div class="cl-main">
              <div class="cl-head">
                <b>{{ c.title }}</b>
                <span class="f-hint">{{ fmt(c.start) }}–{{ fmt(c.end) }} · 时长 {{ fmt(c.end - c.start) }}</span>
              </div>
              <div class="cl-tags">
                <span v-for="k in c.knowledge" :key="k" class="tag tag-gray">{{ k }}</span>
                <span class="tag tag-blue">关联 {{ c.questionIds.length }} 题</span>
                <span class="f-hint">创建人 {{ c.createdBy }}</span>
              </div>
            </div>
            <div class="op-group">
              <button class="mini-btn" @click="openEditClip(c)">编辑</button>
              <button class="mini-btn" @click="openLink(c)">关联题目</button>
              <button class="mini-btn danger" @click="onDeleteClip(c)">删除</button>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- 新建 / 编辑切片 -->
    <AppModal v-if="clipOpen" :title="clipEditingId != null ? '编辑切片' : '新建切片'" :width="540" @close="clipOpen = false">
      <div class="f-field">
        <label class="f-label">切片标题<span class="req">*</span></label>
        <input v-model="clipForm.title" class="f-input" placeholder="如：单调性的定义解读" />
      </div>
      <div class="f-field row2">
        <div>
          <label class="f-label">开始时间（mm:ss 或秒）</label>
          <input v-model="clipForm.startText" class="f-input" placeholder="0:00" />
        </div>
        <div>
          <label class="f-label">结束时间（mm:ss 或秒）</label>
          <input v-model="clipForm.endText" class="f-input" placeholder="1:36" />
        </div>
      </div>
      <p v-if="!durationUnknown" class="f-hint" style="margin: -4px 0 10px">视频总长 {{ fmt(duration) }}，结束时间不得超出。</p>
      <div class="f-field">
        <label class="f-label">知识点（顿号分隔）</label>
        <input v-model="clipForm.knowledgeText" class="f-input" placeholder="如：单调性、函数性质" />
      </div>
      <div class="f-field">
        <label class="f-label">备注</label>
        <textarea v-model="clipForm.note" class="f-textarea" placeholder="切片说明 / 使用建议" style="min-height: 64px" />
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="clipOpen = false">取消</button>
        <button class="btn btn-primary" @click="submitClip">保存切片</button>
      </template>
    </AppModal>

    <!-- 关联题目 -->
    <AppDrawer v-if="linkOpen" :title="`关联题目 · ${linkClip?.title ?? ''}`" :width="620" @close="linkOpen = false">
      <div class="f-field row3">
        <select v-model="bankFilter.type" class="f-select">
          <option value="">全部题型</option>
          <option v-for="t in ['单选题', '多选题', '判断题', '填空题', '解答题']" :key="t" :value="t">{{ t }}</option>
        </select>
        <select v-model="bankFilter.difficulty" class="f-select">
          <option value="">全部难度</option>
          <option v-for="d in ['容易', '较易', '中等', '较难', '困难']" :key="d" :value="d">{{ d }}</option>
        </select>
        <input v-model="bankFilter.keyword" class="f-input" placeholder="搜索题干" />
      </div>
      <p class="f-hint" style="margin-bottom: 8px">已选 {{ linkSelected.length }} 题</p>
      <div class="link-list">
        <div v-for="row in bankPool" :key="row.id" class="link-card" :class="{ on: linkSelected.includes(row.id) }">
          <label class="link-check">
            <input type="checkbox" :checked="linkSelected.includes(row.id)" @change="toggleLink(row.id)" />
            <span class="link-stem">{{ truncateRich(row.stem, 64) }}</span>
          </label>
          <span class="f-hint">{{ row.type }} · {{ row.difficulty }}</span>
        </div>
        <p v-if="!bankPool.length" class="f-hint" style="padding: 16px; text-align: center">题库暂无匹配题目</p>
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="linkOpen = false">取消</button>
        <button class="btn btn-primary" @click="saveLink">保存关联（{{ linkSelected.length }} 题）</button>
      </template>
    </AppDrawer>
  </div>
</template>

<style scoped>
.clip-body { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 14px; align-items: start; }
.clip-videos { padding: 14px; position: sticky; top: 0; max-height: calc(100vh - 140px); overflow-y: auto; }
.cv-row {
  display: flex; gap: 10px; align-items: center;
  border: 1.5px solid transparent; border-radius: 10px;
  padding: 8px; margin-bottom: 6px; cursor: pointer;
}
.cv-row:hover { background: #f6f9fc; }
.cv-row.on { border-color: var(--brand); background: var(--brand-soft); }
.cv-thumb {
  width: 40px; height: 40px; flex-shrink: 0; border-radius: 9px;
  background: linear-gradient(135deg, #4f6ef7, #6a5df0); color: #fff;
  display: flex; align-items: center; justify-content: center;
}
.cv-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.cv-main b { font-size: 13px; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cv-main em { font-size: 11px; color: var(--sub); font-style: normal; }

.clip-right { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.clip-timeline { padding: 14px 16px; }
.ct-head { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.ct-head b { font-size: 14px; color: var(--ink); }

.track {
  position: relative; height: 54px; border-radius: 10px;
  background: repeating-linear-gradient(90deg, #eef2f8, #eef2f8 1px, #f7f9fc 1px, 9.09%);
  background-color: #f3f6fb; border: 1px solid var(--border); cursor: crosshair; overflow: hidden;
}
.seg {
  position: absolute; top: 6px; bottom: 6px; border-radius: 7px;
  display: flex; align-items: center; padding: 0 8px; cursor: pointer;
  color: #fff; box-shadow: 0 2px 6px rgba(20, 26, 40, 0.18);
  transition: filter 0.15s; min-width: 4px;
}
.seg:hover { filter: brightness(1.06); }
.seg-title { font-size: 11.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.track-cursor { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--brand-deep); pointer-events: none; }

.clip-list { padding: 14px 16px; }
.cl-row {
  display: flex; align-items: center; gap: 10px;
  border: 1px solid var(--border); border-radius: 10px;
  padding: 10px 12px; margin-bottom: 8px; background: #fbfdfd;
}
.cl-row:hover { border-color: var(--brand); }
.cl-bar { width: 6px; align-self: stretch; border-radius: 4px; flex-shrink: 0; }
.cl-main { flex: 1; min-width: 0; }
.cl-head { display: flex; align-items: center; gap: 8px; }
.cl-head b { font-size: 13.5px; color: var(--ink); }
.cl-tags { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 6px; }
.cl-meta { font-size: 12px; color: var(--sub); margin-top: 4px; }

.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.row3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }

.link-list { display: flex; flex-direction: column; gap: 8px; }
.link-card {
  display: flex; align-items: center; gap: 10px; justify-content: space-between;
  border: 1.5px solid var(--border); border-radius: 10px; padding: 9px 11px;
}
.link-card.on { border-color: var(--brand); background: var(--brand-soft); }
.link-check { display: flex; align-items: center; gap: 9px; flex: 1; min-width: 0; cursor: pointer; }
.link-stem { font-size: 12.5px; color: var(--ink-2); line-height: 1.5; }
</style>
