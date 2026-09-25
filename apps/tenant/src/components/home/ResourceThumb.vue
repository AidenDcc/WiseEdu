<script setup lang="ts">
import { computed } from 'vue'
import { durationText } from '@/utils/resourceMetrics'

/**
 * 资源封面占位：按业务类型渲染主题化示意图 / 封面色块。
 * 不引入外部图片，配色全部取自系统主题令牌（--brand*），同一资源按 seed 稳定取同一图型与配色。
 */
type ThumbKind = 'material' | 'video' | 'image' | 'animation' | 'lesson'

const props = defineProps<{
  seed: number
  kind: ThumbKind
  /** 封面角标文字（学科 · 类型），仅教辅封面展示 */
  meta?: string
  /** 时长（秒），仅视频展示 */
  duration?: number
  /** 左上角角标（课件 / 学案 / 作业 …） */
  badge?: string
}>()

const FIGURES = ['parabola', 'cube', 'circle', 'wave', 'bars', 'grid', 'triangle'] as const

const FIGURE_PATHS: Record<(typeof FIGURES)[number], string[]> = {
  parabola: ['M16 84h128', 'M24 14v76', 'M18 22q62 78 124 0'],
  cube: ['M28 34h60v50H28z', 'M28 34l16-16h60l-16 16', 'M88 34v50l16-16V18'],
  circle: ['M80 50a30 30 0 1 0 .1 0z', 'M50 50h60', 'M80 50l22-22'],
  wave: ['M16 52c12-28 24-28 36 0s24 28 36 0 24-28 36 0'],
  bars: ['M22 84h120', 'M36 84V52', 'M60 84V34', 'M84 84V62', 'M108 84V26', 'M132 84V46'],
  grid: ['M26 24h108v56H26z', 'M53 24v56', 'M80 24v56', 'M107 24v56', 'M26 52h108'],
  triangle: ['M30 78 80 14l50 64z', 'M80 14v64'],
}

const figure = computed(() => FIGURE_PATHS[FIGURES[props.seed % FIGURES.length]])
const palette = computed(() => `p${props.seed % 5}`)
</script>

<template>
  <div class="thumb" :class="[`k-${kind}`, palette]">
    <!-- 教辅封面：只做封面色块，资料标题由卡片下方统一承载 -->
    <div v-if="kind === 'material'" class="cover">
      <svg class="cover-book" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 5c-2-1.5-5-2-8-2v15c3 0 6 .5 8 2 2-1.5 5-2 8-2V3c-3 0-6 .5-8 2z" />
        <path d="M12 5v17" />
      </svg>
      <span v-if="meta" class="cover-meta">{{ meta }}</span>
    </div>

    <!-- 其他类型：学科示意图 -->
    <svg v-else class="fig" viewBox="0 0 160 100" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
      <path v-for="(d, i) in figure" :key="i" :d="d" />
    </svg>

    <span v-if="badge" class="badge">{{ badge }}</span>
    <span v-if="kind === 'video'" class="play">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 6.5v11l9-5.5z" /></svg>
    </span>
    <span v-if="duration" class="dur">{{ durationText(duration) }}</span>
  </div>
</template>

<style scoped>
.thumb {
  position: relative;
  aspect-ratio: 16 / 10;
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
}

/* 配色：1/5 饱和品牌色，其余为浅色底，避免整页色块过重 */
.p0 { background: linear-gradient(135deg, var(--brand) 0%, var(--brand-2) 100%); color: rgba(255, 255, 255, 0.9); border-color: transparent; }
.p1 { background: var(--brand-soft); color: var(--brand); }
.p2 { background: #f2f5fa; color: #a7b3c6; }
.p3 { background: linear-gradient(135deg, var(--brand-deep) 0%, var(--brand) 100%); color: rgba(255, 255, 255, 0.9); border-color: transparent; }
.p4 { background: #f6f9f9; color: #9fb6b4; }

.fig { width: 68%; height: 68%; }

/* 教辅封面 */
.cover {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 9px;
}
.cover-book { width: 38px; height: 38px; opacity: 0.92; }
.cover-meta { font-size: 11.5px; font-weight: 600; opacity: 0.82; }

.badge {
  position: absolute;
  top: 8px;
  left: 8px;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  background: rgba(255, 255, 255, 0.88);
  color: var(--ink-2);
}
.play {
  position: absolute;
  inset: 0;
  margin: auto;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.86);
  color: var(--brand-deep);
}
.play svg { width: 22px; height: 22px; }
.dur {
  position: absolute;
  right: 8px;
  bottom: 8px;
  padding: 1px 7px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  background: rgba(28, 36, 52, 0.62);
  color: #fff;
}
</style>
