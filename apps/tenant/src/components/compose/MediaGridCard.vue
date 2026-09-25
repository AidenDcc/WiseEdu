<script setup lang="ts">
/**
 * 组卷工作台的媒体卡片：小程序 / 视频 / 图片三个页签共用（按 kind 渲染不同外观）。
 *
 * 关键约束（决定了这张卡片的操作只有「预览」和「按知识点找题」）：
 * `PaperSection.questions` 只装 `{ questionId, score }`，媒体资源**在数据模型上进不了试卷**。
 * 所以这里不做「加入组卷车」—— 承诺一个后端装不下的动作，只会在保存时静默丢资源。
 * 媒体对组卷的真实价值是「看到一段微课/一张图 → 想配套出题」，故交接方式是按它的知识点去试题页签。
 */
import { computed } from 'vue'
import { AppIcon, resolveMediaSrc } from '@aiteach/shared'
import type { OrgMedia } from '@aiteach/shared'

const props = defineProps<{ row: OrgMedia }>()
const emit = defineEmits<{
  preview: [row: OrgMedia]
  findSimilar: [tags: string[]]
}>()

const KIND_TEXT: Record<OrgMedia['kind'], string> = {
  image: '图片',
  video: '视频',
  animation: '小程序动画',
}

/** 无真实字节的存量记录没有 url，缩略图位置退化为图标（mock 演示数据多为此类） */
const hasThumb = computed(() => Boolean(props.row.url))

const durationText = computed(() => {
  const seconds = props.row.durationSec
  if (!seconds) return ''
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
})
</script>

<template>
  <article class="m-card">
    <div class="mc-thumb" :class="`kind-${row.kind}`">
      <img v-if="hasThumb" :src="resolveMediaSrc(row.url ?? '')" :alt="row.name" />
      <AppIcon v-else :name="row.kind === 'image' ? 'image' : row.kind === 'video' ? 'smartphone' : 'chart'" :size="30" />
      <span v-if="durationText" class="mc-duration">{{ durationText }}</span>
      <span class="mc-kind">{{ KIND_TEXT[row.kind] }}</span>
    </div>

    <div class="mc-body">
      <h4 class="mc-name" :title="row.name">{{ row.name }}</h4>
      <p class="mc-meta">{{ row.subject }} · {{ row.sizeMb.toFixed(1) }} MB · {{ row.owner }}</p>
      <p class="mc-kp">{{ row.knowledge.join('、') || '未标注知识点' }}</p>

      <div class="mc-ops">
        <button class="mini-btn" type="button" @click="emit('preview', row)">预览</button>
        <button
          class="mini-btn success"
          type="button"
          :disabled="row.knowledge.length === 0"
          :title="row.knowledge.length ? '按该资源的知识点去试题页签找配套题' : '该资源未标注知识点，无法按知识点找题'"
          @click="emit('findSimilar', row.knowledge)"
        >
          按知识点找题
        </button>
      </div>
    </div>
  </article>
</template>

<style scoped>
.m-card {
  border: 1px solid var(--border);
  border-radius: 12px;
  background: #fff;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.m-card:hover { border-color: #d6e0ee; box-shadow: var(--shadow); }

.mc-thumb {
  position: relative;
  height: 118px;
  background: linear-gradient(135deg, #eef4fb 0%, #e6f7f5 100%);
  color: var(--brand);
  display: flex;
  align-items: center;
  justify-content: center;
}
.mc-thumb.kind-image { background: linear-gradient(135deg, #fdf3ea 0%, #fdece2 100%); color: #d0821f; }
.mc-thumb.kind-animation { background: linear-gradient(135deg, #f0eefb 0%, #e9e6fa 100%); color: #6b5bd2; }
.mc-thumb img { width: 100%; height: 100%; object-fit: cover; }

.mc-duration {
  position: absolute;
  right: 8px;
  bottom: 8px;
  padding: 1px 6px;
  border-radius: 5px;
  background: rgba(20, 26, 40, 0.62);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
}
.mc-kind {
  position: absolute;
  left: 8px;
  top: 8px;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.86);
  color: var(--ink-2);
  font-size: 11px;
  font-weight: 600;
}

.mc-body { padding: 11px 13px 12px; display: flex; flex-direction: column; flex: 1; gap: 4px; }
.mc-name {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--ink);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.mc-meta { font-size: 11.5px; color: var(--sub); }
.mc-kp {
  font-size: 11.5px;
  color: var(--brand-deep);
  background: var(--brand-soft);
  border-radius: 6px;
  padding: 2px 7px;
  align-self: flex-start;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mc-ops { display: flex; gap: 6px; margin-top: auto; padding-top: 9px; }
.mc-ops .mini-btn { flex: 1; }
</style>
