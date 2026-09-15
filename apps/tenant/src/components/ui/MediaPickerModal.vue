<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { AppIcon, resolveMediaSrc, showToast } from '@aiteach/shared'
import type { OrgMedia } from '@aiteach/shared'
import AppModal from './AppModal.vue'
import { fetchMedia } from '@/api/org'

/**
 * 插图选择（FR-JC-005 复用）。
 *
 * 编辑器的「图片」按钮走这里，两条来源并列：机构多媒体库里已有的图片、以及本地文件。
 * 本组件只负责「选」，「传」仍归 RichTextEditor.uploadImage() —— 上传的大小 / 类型校验、
 * 落 Mock 媒体库、插入节点都只该有一份实现，本地文件以 pick-file 交回去即可。
 */
const props = withDefaults(defineProps<{ /** 当前学科，用于把同学科的图片排前面（不硬过滤） */ subject?: string }>(), { subject: '' })

const emit = defineEmits<{
  close: []
  /** 从系统图片库选中一张 */
  pick: [media: OrgMedia]
  /** 用户选了本地文件，交给调用方上传 */
  'pick-file': [file: File]
}>()

type Tab = 'library' | 'local'
const tab = ref<Tab>('library')

const images = ref<OrgMedia[]>([])
const loading = ref(true)
const keyword = ref('')
const selectedId = ref<number | null>(null)

/** 没有字节的记录插进去就是破图：mock 无 /media/:id/raw 路由，无 url 即无地址可请求 */
function insertable(row: OrgMedia): boolean {
  return Boolean(row.url)
}

const filtered = computed(() => {
  const kw = keyword.value.trim()
  const rows = kw ? images.value.filter((row) => row.name.includes(kw)) : [...images.value]
  /* 同学科优先：录数学题时不必先翻过语文的图 */
  if (props.subject) {
    rows.sort((a, b) => Number(b.subject === props.subject) - Number(a.subject === props.subject))
  }
  return rows
})

const selected = computed(() => images.value.find((row) => row.id === selectedId.value) ?? null)

onMounted(async () => {
  try {
    const rows = await fetchMedia()
    images.value = rows.filter((row) => row.kind === 'image')
  } catch {
    showToast('图片库加载失败', 'error')
  } finally {
    loading.value = false
  }
})

function choose(row: OrgMedia) {
  if (!insertable(row)) {
    showToast('该图片只有记录、没有文件，无法插入', 'error')
    return
  }
  /* 选中而非直接插入：与公式弹窗「先选再确认」一致，避免误点 */
  selectedId.value = row.id
}

function confirmPick() {
  if (!selected.value) {
    showToast('请先选择一张图片', 'error')
    return
  }
  emit('pick', selected.value)
}

/* ===== 本地文件 ===== */
const fileInput = ref<HTMLInputElement | null>(null)

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) emit('pick-file', file)
  /* 清空以便连续选择同一文件也能触发 change */
  input.value = ''
}

function localFileOf(dt: DataTransfer | null): File | null {
  if (!dt) return null
  for (const file of Array.from(dt.files)) {
    if (file.type.startsWith('image/')) return file
  }
  return null
}

function onDrop(event: DragEvent) {
  const file = localFileOf(event.dataTransfer)
  if (file) emit('pick-file', file)
}
</script>

<template>
  <AppModal title="插入图片" :width="720" @close="emit('close')">
    <div class="mp-tabs">
      <button class="mp-tab" :class="{ on: tab === 'library' }" type="button" @click="tab = 'library'">
        系统图片库
      </button>
      <button class="mp-tab" :class="{ on: tab === 'local' }" type="button" @click="tab = 'local'">
        上传本地图片
      </button>
    </div>

    <template v-if="tab === 'library'">
      <div class="f-field">
        <input v-model="keyword" class="f-input" placeholder="搜索图片名称" />
      </div>
      <p v-if="loading" class="mp-empty">加载中…</p>
      <p v-else-if="filtered.length === 0" class="mp-empty">
        {{ keyword ? '没有匹配的图片' : '图片库暂无图片，可切到「上传本地图片」' }}
      </p>
      <div v-else class="mp-grid">
        <button
          v-for="row in filtered"
          :key="row.id"
          class="mp-card"
          :class="{ on: row.id === selectedId, off: !insertable(row) }"
          type="button"
          :title="insertable(row) ? row.name : `${row.name}（无文件）`"
          @click="choose(row)"
        >
          <span class="mp-thumb">
            <img v-if="row.url" :src="resolveMediaSrc(row.url)" :alt="row.name" />
            <AppIcon v-else name="image" :size="26" />
            <span v-if="!insertable(row)" class="mp-nofile">无文件</span>
          </span>
          <span class="mp-name">{{ row.name }}</span>
          <span class="mp-meta">{{ row.subject }} · {{ row.sizeMb }} MB</span>
        </button>
      </div>
    </template>

    <template v-else>
      <div class="mp-drop" @click="fileInput?.click()" @dragover.prevent @drop.prevent="onDrop">
        <AppIcon name="upload" :size="26" />
        <p class="mp-drop-title">点击选择图片，或直接拖到这里</p>
        <p class="f-hint">上传后自动存入「多媒体资源」，正文里只引用其地址</p>
      </div>
      <input ref="fileInput" type="file" accept="image/*" class="mp-file" @change="onFileChange" />
    </template>

    <template #footer>
      <button class="btn btn-ghost" type="button" @click="emit('close')">取消</button>
      <button v-if="tab === 'library'" class="btn btn-primary" type="button" :disabled="!selected" @click="confirmPick">
        插入所选
      </button>
      <button v-else class="btn btn-primary" type="button" @click="fileInput?.click()">选择文件</button>
    </template>
  </AppModal>
</template>

<style scoped>
.mp-tabs { display: flex; gap: 6px; margin-bottom: 16px; }
.mp-tab {
  border: 1.5px solid var(--border);
  background: #fff;
  color: var(--ink-2);
  font-size: 13px;
  font-weight: 600;
  padding: 7px 14px;
  border-radius: 9px;
  transition: all 0.15s;
}
.mp-tab:hover { border-color: var(--brand); color: var(--brand-deep); }
.mp-tab.on { border-color: var(--brand); background: var(--brand-soft); color: var(--brand-deep); }

.mp-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
  gap: 12px;
  max-height: 340px;
  overflow-y: auto;
  padding: 2px;
}
.mp-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  border: 1.5px solid var(--border);
  border-radius: 10px;
  background: #fff;
  text-align: left;
  transition: all 0.15s;
}
.mp-card:hover { border-color: var(--brand); }
.mp-card.on { border-color: var(--brand); background: var(--brand-soft); box-shadow: 0 0 0 3px var(--brand-soft); }
/* 只有记录没有文件的：明确置灰，不要让人点了才发现插不进去 */
.mp-card.off { opacity: 0.55; cursor: not-allowed; }
.mp-card.off:hover { border-color: var(--border); }

.mp-thumb {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 84px;
  border-radius: 7px;
  background: linear-gradient(135deg, #f0a23c, #f07a3c);
  color: #fff;
  overflow: hidden;
}
.mp-thumb img { width: 100%; height: 100%; object-fit: contain; background: #fff; }
.mp-nofile {
  position: absolute;
  right: 4px;
  bottom: 4px;
  background: rgba(0, 0, 0, 0.45);
  border-radius: 6px;
  font-size: 10.5px;
  padding: 1px 6px;
}

.mp-name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mp-meta { font-size: 11.5px; color: var(--sub); }

.mp-empty { padding: 30px; text-align: center; font-size: 13px; color: var(--sub); }

.mp-drop {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 200px;
  border: 1.5px dashed var(--border);
  border-radius: 12px;
  color: var(--brand);
  cursor: pointer;
  transition: all 0.15s;
}
.mp-drop:hover { border-color: var(--brand); background: var(--brand-soft); }
.mp-drop-title { font-size: 13.5px; font-weight: 600; color: var(--ink-2); }
.mp-drop .f-hint { margin-top: 0; }
.mp-file { display: none; }
</style>
