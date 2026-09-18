<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { AppIcon, resolveMediaSrc, showToast } from '@aiteach/shared'
import type { DrawEditorType, MediaKind, OrgMedia } from '@aiteach/shared'
import AppModal from '@/components/ui/AppModal.vue'
import MediaDrawSelectDialog from '@/components/draw/MediaDrawSelectDialog.vue'
import AiDrawGenerateDialog from '@/components/draw/AiDrawGenerateDialog.vue'
import DrawEditorHost from '@/components/draw/DrawEditorHost.vue'
import { deleteMedia, fetchMedia, fetchMediaDetail, linkMedia, uploadMedia } from '@/api/org'
import { useBaseData } from '@/composables/useBaseData'
import { useKnowledgePool } from '@/composables/useKnowledgePool'
import { readAsDataUrl } from '@/utils/file'

/**
 * 多媒体资源按类型拆分的资源库视图（图片 / 小程序动画 / 视频 三个菜单共用）。
 *
 * - 图片 / 视频：真实文件上传（字节以 data URL 落 mock 媒体库，返回可引用 URL），
 *   上传时选学科 + 知识点（知识点取当前学科的知识池，与录题一致）；
 * - 图片额外提供「在线画图」入口（几何 / 化学装置 / 分子式 / 通用简易画布四类编辑器，
 *   AI 只出草稿，人工确认导出后入库，工程数据可二次编辑）；
 * - 小程序动画：元信息登记（机构的小程序动画多托管在课件平台，登记名称 / 学科 / 知识点即可被引用）。
 */
const props = defineProps<{ kind: MediaKind }>()

const META: Record<MediaKind, { title: string; icon: string; accept: string; maxMb: number; emptyHint: string }> = {
  image: {
    title: '图片资源',
    icon: 'image',
    accept: 'image/*',
    maxMb: 10,
    emptyHint: '暂无图片，可上传本地图片或在线画图',
  },
  animation: {
    title: '小程序动画',
    icon: 'chart',
    accept: '',
    maxMb: 0,
    emptyHint: '暂无动画登记，点击右上角登记',
  },
  video: {
    title: '视频资源',
    icon: 'smartphone',
    accept: 'video/*',
    maxMb: 50,
    emptyHint: '暂无视频，点击右上角上传',
  },
}
const meta = computed(() => META[props.kind])

const { subjects, ensure, pick } = useBaseData()

const media = ref<OrgMedia[]>([])
const keyword = ref('')
const filtered = computed(() => {
  const kw = keyword.value.trim()
  return media.value.filter((row) => row.kind === props.kind && (!kw || row.name.includes(kw)))
})

async function load() {
  await ensure()
  uploadForm.subject = pick(subjects.value, uploadForm.subject)
  media.value = await fetchMedia()
}

/* ===== 上传（图片 / 视频带真实文件；动画仅元信息） ===== */
const uploadOpen = ref(false)
const uploadForm = reactive({ name: '', subject: '数学', file: null as File | null })
const uploadKnowledge = ref<string[]>([])
const uploading = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

const { pool: upPool } = useKnowledgePool(() => ({ subject: uploadForm.subject }))
const upChipOptions = computed(() => [
  ...upPool.value,
  ...uploadKnowledge.value.filter((k) => !upPool.value.includes(k)),
])

watch(
  () => uploadForm.subject,
  () => {
    uploadKnowledge.value = uploadKnowledge.value.filter((k) => upPool.value.includes(k))
  },
)

function openUpload() {
  uploadForm.name = ''
  uploadForm.file = null
  uploadKnowledge.value = []
  if (fileInput.value) fileInput.value.value = ''
  uploadOpen.value = true
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] ?? null
  uploadForm.file = file
  /* 未手动填名称时用文件名兜底 */
  if (file && !uploadForm.name.trim()) {
    uploadForm.name = file.name.replace(/\.[^.]+$/, '')
  }
}

async function submitUpload() {
  if (uploadForm.name.trim().length < 2) {
    showToast('请填写资源名称', 'error')
    return
  }
  const needsFile = props.kind !== 'animation'
  if (needsFile && !uploadForm.file) {
    showToast(meta.value.accept.includes('image') ? '请选择要上传的图片' : '请选择要上传的视频', 'error')
    return
  }
  if (uploadForm.file && uploadForm.file.size > meta.value.maxMb * 1024 * 1024) {
    showToast(`文件需小于 ${meta.value.maxMb}MB，请压缩后重试`, 'error')
    return
  }
  uploading.value = true
  try {
    const dataUrl = uploadForm.file ? await readAsDataUrl(uploadForm.file) : undefined
    const item = await uploadMedia({
      name: uploadForm.name.trim(),
      kind: props.kind,
      subject: uploadForm.subject,
      knowledge: [...uploadKnowledge.value],
      dataUrl,
      mime: uploadForm.file?.type,
      sizeMb: uploadForm.file ? Math.round((uploadForm.file.size / 1024 / 1024) * 100) / 100 : undefined,
    })
    uploadOpen.value = false
    await load()
    showToast(`《${item.name}》上传成功（${item.sizeMb} MB）`, 'success')
  } catch {
    showToast('上传失败，请重试', 'error')
  } finally {
    uploading.value = false
  }
}

/* ===== 在线画图：类型选择 → 编辑器 / AI 草稿；工程记录可二次编辑 ===== */
const drawSelectOpen = ref(false)
const aiDrawType = ref<DrawEditorType | null>(null)
interface DrawHostState {
  editorType: DrawEditorType
  mediaId?: number
  projectJson?: string
  molfileText?: string
}
const drawHost = ref<DrawHostState | null>(null)

function onDrawManual(type: DrawEditorType) {
  drawSelectOpen.value = false
  drawHost.value = { editorType: type }
}

function onDrawAi(type: DrawEditorType) {
  drawSelectOpen.value = false
  aiDrawType.value = type
}

function onDrawDraft(payload: { editorType: DrawEditorType; projectJson?: string; molfileText?: string }) {
  aiDrawType.value = null
  drawHost.value = { ...payload }
}

async function onDrawSaved() {
  drawHost.value = null
  await load()
  showToast('配图已保存到图片资源', 'success')
}

/** 图片卡片上的「编辑」：按工程数据重开对应编辑器（不从 SVG 反解析） */
async function onDrawEdit(row: OrgMedia) {
  if (!row.editorType) return
  try {
    await fetchMediaDetail(row.id)
    drawHost.value = { editorType: row.editorType, mediaId: row.id }
  } catch {
    showToast('绘图工程读取失败', 'error')
  }
}

/* ===== 预览 ===== */
const preview = ref<OrgMedia | null>(null)

/* ===== 关联知识点 ===== */
const linkTarget = ref<OrgMedia | null>(null)
const linkTargets = ref<string[]>([])
/* 知识点池跟随当前资源的学科；已关联但不在池中的旧值仍保留可选 */
const { pool: linkPool } = useKnowledgePool(() => ({ subject: linkTarget.value?.subject ?? '' }))
const linkOptions = computed(() => [
  ...linkPool.value,
  ...linkTargets.value.filter((k) => !linkPool.value.includes(k)),
])

async function submitLink() {
  if (!linkTarget.value) return
  if (!linkTargets.value.length) {
    showToast('请选择至少 1 个关联对象', 'error')
    return
  }
  await linkMedia(linkTarget.value.id, linkTargets.value)
  linkTarget.value = null
  await load()
  showToast(`已关联 ${linkTargets.value.length} 个知识点 / 题目`, 'success')
}

/* ===== 删除（引用提示） ===== */
async function onDelete(row: OrgMedia) {
  const tip = row.linkedCount > 0 ? `该资源已被引用 ${row.linkedCount} 次，删除后相关引用将失效，` : ''
  if (!window.confirm(`${tip}确认删除《${row.name}》？`)) return
  await deleteMedia(row.id)
  showToast('已删除（进入回收站）', 'success')
  load()
}

onMounted(load)
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h2>{{ meta.title }}</h2>
      <div class="op-group">
        <input v-model="keyword" class="f-input" placeholder="搜索资源名" style="width: 180px" />
        <button v-if="kind === 'image'" class="btn btn-ghost" @click="drawSelectOpen = true">
          <AppIcon name="shapes" :size="15" /> 在线画图
        </button>
        <button class="btn btn-primary" @click="openUpload">
          <AppIcon name="upload" :size="15" /> {{ kind === 'animation' ? '登记动画' : '上传资源' }}
        </button>
      </div>
    </div>

    <div class="media-grid">
      <p v-if="filtered.length === 0" class="f-hint" style="grid-column: 1 / -1; padding: 30px; text-align: center">
        {{ keyword ? '没有匹配的资源' : meta.emptyHint }}
      </p>
      <div v-for="row in filtered" :key="row.id" class="panel media-card">
        <div class="mc-thumb" :class="row.kind" @click="preview = row">
          <img v-if="row.kind === 'image' && row.url" :src="resolveMediaSrc(row.url)" :alt="row.name" />
          <video v-else-if="row.kind === 'video' && row.url" :src="resolveMediaSrc(row.url)" preload="metadata" muted />
          <AppIcon v-else :name="meta.icon" :size="30" />
          <span v-if="row.durationSec" class="mc-duration">{{ Math.floor(row.durationSec / 60) }}:{{ String(row.durationSec % 60).padStart(2, '0') }}</span>
        </div>
        <div class="mc-body">
          <div class="mc-title-row">
            <span class="mc-name">{{ row.name }}</span>
          </div>
          <p class="mc-meta">{{ row.subject }} · {{ row.sizeMb }} MB · {{ row.owner }}</p>
          <p class="mc-meta">
            <template v-if="row.knowledge.length">{{ row.knowledge.join(' / ') }}</template>
            <template v-else>未关联知识点</template>
            · 被引用 {{ row.linkedCount }} 次
          </p>
          <div class="mc-ops">
            <button class="mini-btn" @click="preview = row">预览</button>
            <button v-if="row.editorType" class="mini-btn" @click="onDrawEdit(row)">编辑</button>
            <button class="mini-btn" @click="linkTarget = row; linkTargets = [...row.knowledge]">关联</button>
            <button class="mini-btn danger" @click="onDelete(row)">删除</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 上传弹窗 -->
    <AppModal v-if="uploadOpen" :title="kind === 'animation' ? '登记小程序动画' : `上传${meta.title}`" :width="480" @close="uploadOpen = false">
      <div class="f-field">
        <label class="f-label">资源名称<span class="req">*</span></label>
        <input v-model="uploadForm.name" class="f-input" :placeholder="kind === 'animation' ? '如：圆锥曲线动点轨迹演示' : '上传文件后自动带入文件名'" />
      </div>
      <div v-if="kind !== 'animation'" class="f-field">
        <label class="f-label">文件<span class="req">*</span></label>
        <button class="file-pick" type="button" @click="fileInput?.click()">
          <AppIcon name="upload" :size="16" />
          <span v-if="uploadForm.file">{{ uploadForm.file.name }}（{{ (uploadForm.file.size / 1024 / 1024).toFixed(2) }} MB）</span>
          <span v-else>选择{{ kind === 'image' ? '图片' : '视频' }}文件（≤ {{ meta.maxMb }} MB）</span>
        </button>
        <input ref="fileInput" type="file" :accept="meta.accept" class="mp-file" @change="onFileChange" />
        <p class="f-hint" style="margin-top: 6px">
          {{ kind === 'image' ? '支持 PNG / JPG / SVG / GIF 等常见格式' : '支持 mp4 / webm 等常见格式' }}
        </p>
      </div>
      <div class="f-field">
        <label class="f-label">学科</label>
        <select v-model="uploadForm.subject" class="f-select">
          <option v-for="s in subjects" :key="s" :value="s">{{ s }}</option>
        </select>
      </div>
      <div class="f-field">
        <label class="f-label">关联知识点（选填，可多选）</label>
        <div class="chips">
          <button
            v-for="k in upChipOptions"
            :key="k"
            class="k-chip"
            :class="{ on: uploadKnowledge.includes(k) }"
            type="button"
            @click="uploadKnowledge.includes(k) ? uploadKnowledge.splice(uploadKnowledge.indexOf(k), 1) : uploadKnowledge.push(k)"
          >
            {{ k }}
          </button>
          <p v-if="!upChipOptions.length" class="f-hint">该学科暂未配置知识点</p>
        </div>
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="uploadOpen = false">取消</button>
        <button class="btn btn-primary" :disabled="uploading" @click="submitUpload">
          {{ uploading ? '上传中…' : kind === 'animation' ? '登记' : '上传' }}
        </button>
      </template>
    </AppModal>

    <!-- 在线画图：类型选择 → AI 草稿 → 编辑器 -->
    <MediaDrawSelectDialog
      v-if="drawSelectOpen"
      @close="drawSelectOpen = false"
      @manual="onDrawManual"
      @ai="onDrawAi"
    />
    <AiDrawGenerateDialog
      v-if="aiDrawType"
      :initial-type="aiDrawType"
      @close="aiDrawType = null"
      @draft="onDrawDraft"
    />
    <DrawEditorHost
      v-if="drawHost"
      purpose="library"
      :editor-type="drawHost.editorType"
      :media-id="drawHost.mediaId"
      :initial-project-json="drawHost.projectJson"
      :initial-molfile="drawHost.molfileText"
      :subject="uploadForm.subject"
      @close="drawHost = null"
      @saved="onDrawSaved"
    />

    <!-- 预览 -->
    <AppModal v-if="preview" :title="preview.name" :width="640" @close="preview = null">
      <div v-if="preview.kind === 'image' && preview.url" class="preview-stage media">
        <img :src="resolveMediaSrc(preview.url)" :alt="preview.name" />
      </div>
      <div v-else-if="preview.kind === 'video' && preview.url" class="preview-stage media">
        <video :src="resolveMediaSrc(preview.url)" controls autoplay />
      </div>
      <div v-else class="preview-stage">
        <AppIcon :name="meta.icon" :size="56" />
        <p>{{ preview.kind === 'animation' ? '动画' : preview.kind === 'video' ? '视频' : '图片' }}播放预览占位</p>
        <p class="f-hint">
          {{ preview.sizeMb }} MB<template v-if="preview.durationSec"> · 时长 {{ Math.floor(preview.durationSec / 60) }} 分 {{ preview.durationSec % 60 }} 秒</template>
          · 上传于 {{ preview.createdAt }}
        </p>
      </div>
    </AppModal>

    <!-- 关联 -->
    <AppModal v-if="linkTarget" :title="`关联 · ${linkTarget.name}`" :width="460" @close="linkTarget = null">
      <p class="f-hint" style="margin-bottom: 10px">选择要关联的知识点（也可在录题 / 组卷时反向引用该资源）</p>
      <div class="chips">
        <button
          v-for="k in linkOptions"
          :key="k"
          class="k-chip"
          :class="{ on: linkTargets.includes(k) }"
          type="button"
          @click="linkTargets.includes(k) ? linkTargets.splice(linkTargets.indexOf(k), 1) : linkTargets.push(k)"
        >
          {{ k }}
        </button>
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="linkTarget = null">取消</button>
        <button class="btn btn-primary" @click="submitLink">确认关联</button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.media-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; }
.media-card { padding: 0; overflow: hidden; }
.mc-thumb {
  height: 130px; display: flex; align-items: center; justify-content: center;
  color: #fff; position: relative; cursor: pointer; overflow: hidden;
}
.mc-thumb.animation { background: linear-gradient(135deg, #00b4a6, #0a8f9c); }
.mc-thumb.video { background: linear-gradient(135deg, #4f6ef7, #6a5df0); }
.mc-thumb.image { background: linear-gradient(135deg, #f0a23c, #f07a3c); }
.mc-thumb img, .mc-thumb video { width: 100%; height: 100%; object-fit: contain; background: #fff; }
.mc-duration {
  position: absolute; right: 8px; bottom: 8px;
  background: rgba(0,0,0,.45); border-radius: 6px; font-size: 11px; padding: 2px 7px;
}
.mc-body { padding: 12px 14px; }
.mc-title-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.mc-name { font-size: 14px; font-weight: 600; color: var(--ink); }
.mc-meta { font-size: 12px; color: var(--sub); margin-bottom: 4px; }
.mc-ops { display: flex; gap: 8px; margin-top: 10px; }

.file-pick {
  width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px;
  padding: 12px; border: 1.5px dashed var(--border); border-radius: 10px;
  background: #fff; color: var(--ink-2); font-size: 13px; cursor: pointer; transition: all 0.15s;
}
.file-pick:hover { border-color: var(--brand); color: var(--brand-deep); background: var(--brand-soft); }
.mp-file { display: none; }

.preview-stage {
  height: 280px; border-radius: 12px; background: #101828; color: #cbd5e5;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
  font-size: 13.5px;
}
.preview-stage.media { background: #0b1220; padding: 10px; }
.preview-stage.media img, .preview-stage.media video { max-width: 100%; max-height: 100%; object-fit: contain; }
.preview-stage .f-hint { color: #8fa0bb; }

.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.k-chip { border: 1.5px solid var(--border); border-radius: 999px; background: #fff; color: var(--ink-2); font-size: 12.5px; padding: 4px 12px; }
.k-chip.on { border-color: var(--brand); background: var(--brand-soft); color: var(--brand-deep); font-weight: 600; }
</style>
