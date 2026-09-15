<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { AppIcon, showToast } from '@aiteach/shared'
import type { OrgMedia } from '@aiteach/shared'
import AppModal from '@/components/ui/AppModal.vue'
import { deleteMedia, fetchMedia, linkMedia, uploadMedia } from '@/api/org'
import { useBaseData } from '@/composables/useBaseData'
import { useKnowledgePool } from '@/composables/useKnowledgePool'

const { subjects, ensure, pick } = useBaseData()

const media = ref<OrgMedia[]>([])

const KIND_TEXT: Record<OrgMedia['kind'], string> = { animation: '动画', video: '视频', image: '图片' }
const KIND_CLASS: Record<OrgMedia['kind'], string> = { animation: 'tag-blue', video: 'tag-green', image: 'tag-gray' }

const filter = reactive({ kind: '', keyword: '' })
const filtered = computed(() =>
  media.value.filter(
    (row) => (!filter.kind || row.kind === filter.kind) && (!filter.keyword || row.name.includes(filter.keyword)),
  ),
)

async function load() {
  await ensure()
  uploadForm.subject = pick(subjects.value, uploadForm.subject)
  media.value = await fetchMedia()
}

/* ===== 上传 ===== */
const uploadOpen = ref(false)
const uploadForm = reactive({ name: '', kind: 'video' as OrgMedia['kind'], subject: '数学', knowledge: '' })

async function submitUpload() {
  if (uploadForm.name.trim().length < 2) {
    showToast('请填写资源名称', 'error')
    return
  }
  const item = await uploadMedia({
    name: uploadForm.name.trim(),
    kind: uploadForm.kind,
    subject: uploadForm.subject,
    knowledge: uploadForm.knowledge ? uploadForm.knowledge.split(/[,，\s]+/).filter(Boolean) : [],
  })
  uploadOpen.value = false
  await load()
  showToast(`《${item.name}》上传成功（${item.sizeMb} MB）`, 'success')
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
      <h2>多媒体资源</h2>
      <div class="op-group">
        <select v-model="filter.kind" class="f-select">
          <option value="">全部类型</option>
          <option value="animation">动画</option>
          <option value="video">视频</option>
          <option value="image">图片</option>
        </select>
        <input v-model="filter.keyword" class="f-input" placeholder="搜索资源名" style="width: 180px" />
        <button class="btn btn-primary" @click="uploadOpen = true"><AppIcon name="upload" :size="15" /> 上传资源</button>
      </div>
    </div>

    <div class="media-grid">
      <p v-if="filtered.length === 0" class="f-hint" style="grid-column: 1 / -1; padding: 30px; text-align: center">暂无资源</p>
      <div v-for="row in filtered" :key="row.id" class="panel media-card">
        <div class="mc-thumb" :class="row.kind" @click="preview = row">
          <AppIcon :name="row.kind === 'image' ? 'image' : row.kind === 'video' ? 'smartphone' : 'chart'" :size="30" />
          <span v-if="row.durationSec" class="mc-duration">{{ Math.floor(row.durationSec / 60) }}:{{ String(row.durationSec % 60).padStart(2, '0') }}</span>
        </div>
        <div class="mc-body">
          <div class="mc-title-row">
            <span class="mc-name">{{ row.name }}</span>
            <span class="tag" :class="KIND_CLASS[row.kind]">{{ KIND_TEXT[row.kind] }}</span>
          </div>
          <p class="mc-meta">{{ row.subject }} · {{ row.sizeMb }} MB · {{ row.owner }}</p>
          <p class="mc-meta">
            <template v-if="row.knowledge.length">{{ row.knowledge.join(' / ') }}</template>
            <template v-else>未关联知识点</template>
            · 被引用 {{ row.linkedCount }} 次
          </p>
          <div class="mc-ops">
            <button class="mini-btn" @click="preview = row">预览</button>
            <button class="mini-btn" @click="linkTarget = row; linkTargets = [...row.knowledge]">关联</button>
            <button class="mini-btn danger" @click="onDelete(row)">删除</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 上传弹窗 -->
    <AppModal v-if="uploadOpen" title="上传多媒体资源" :width="480" @close="uploadOpen = false">
      <div class="f-field">
        <label class="f-label">资源名称<span class="req">*</span></label>
        <input v-model="uploadForm.name" class="f-input" placeholder="如：圆锥曲线动点轨迹演示" />
      </div>
      <div class="f-field row2">
        <div>
          <label class="f-label">类型</label>
          <select v-model="uploadForm.kind" class="f-select">
            <option value="animation">动画（GIF/SVG）</option>
            <option value="video">视频（mp4）</option>
            <option value="image">图片</option>
          </select>
        </div>
        <div>
          <label class="f-label">学科</label>
          <select v-model="uploadForm.subject" class="f-select">
            <option v-for="s in subjects" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
      </div>
      <div class="f-field">
        <label class="f-label">关联知识点（逗号分隔，选填）</label>
        <input v-model="uploadForm.knowledge" class="f-input" placeholder="如：函数与导数, 数列" />
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="uploadOpen = false">取消</button>
        <button class="btn btn-primary" @click="submitUpload">上传</button>
      </template>
    </AppModal>

    <!-- 预览 -->
    <AppModal v-if="preview" :title="preview.name" :width="640" @close="preview = null">
      <div class="preview-stage" :class="preview.kind">
        <AppIcon :name="preview.kind === 'image' ? 'image' : preview.kind === 'video' ? 'smartphone' : 'chart'" :size="56" />
        <p>{{ KIND_TEXT[preview.kind] }}播放预览占位</p>
        <p class="f-hint">{{ preview.sizeMb }} MB<template v-if="preview.durationSec"> · 时长 {{ Math.floor(preview.durationSec / 60) }} 分 {{ preview.durationSec % 60 }} 秒</template> · 上传于 {{ preview.createdAt }}</p>
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
.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

.media-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; }
.media-card { padding: 0; overflow: hidden; }
.mc-thumb {
  height: 130px; display: flex; align-items: center; justify-content: center;
  color: #fff; position: relative; cursor: pointer;
}
.mc-thumb.animation { background: linear-gradient(135deg, #00b4a6, #0a8f9c); }
.mc-thumb.video { background: linear-gradient(135deg, #4f6ef7, #6a5df0); }
.mc-thumb.image { background: linear-gradient(135deg, #f0a23c, #f07a3c); }
.mc-duration {
  position: absolute; right: 8px; bottom: 8px;
  background: rgba(0,0,0,.45); border-radius: 6px; font-size: 11px; padding: 2px 7px;
}
.mc-body { padding: 12px 14px; }
.mc-title-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.mc-name { font-size: 14px; font-weight: 600; color: var(--ink); }
.mc-meta { font-size: 12px; color: var(--sub); margin-bottom: 4px; }
.mc-ops { display: flex; gap: 8px; margin-top: 10px; }

.preview-stage {
  height: 280px; border-radius: 12px; background: #101828; color: #cbd5e5;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
  font-size: 13.5px;
}
.preview-stage .f-hint { color: #8fa0bb; }

.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.k-chip { border: 1.5px solid var(--border); border-radius: 999px; background: #fff; color: var(--ink-2); font-size: 12.5px; padding: 4px 12px; }
.k-chip.on { border-color: var(--brand); background: var(--brand-soft); color: var(--brand-deep); font-weight: 600; }
</style>
