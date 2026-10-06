<script setup lang="ts">
/**
 * 媒体页签：小程序 / 视频 / 图片三个页签**共用这一个组件**，按 `kind` 分流。
 *
 * 三者的差异只有「取哪一批数据」和「预览怎么放」，筛选条、网格、卡片操作完全一致，
 * 拆成三个文件会得到三份逐字重复的模板——故合一。
 *
 * 进车的资源不参与分值与大题结构，随卷存成参考资料附件，见 `MediaGridCard.vue` 头部。
 */
import { computed, ref } from 'vue'
import { AppIcon, resolveMediaSrc, showToast, AppModal } from '@aiteach/shared'
import type { MediaKind, OrgMedia } from '@aiteach/shared'
import { useComposeData } from '@/composables/useComposeData'
import { useComposeBasket } from '@/composables/useComposeBasket'
import ComposeFilterBar from '@/components/compose/ComposeFilterBar.vue'
import MediaGridCard from '@/components/compose/MediaGridCard.vue'
import { matchesMediaFilter, type ComposeFilter } from '../types'

const props = defineProps<{ filter: ComposeFilter; kind: MediaKind }>()
const emit = defineEmits<{
  patch: [patch: Partial<ComposeFilter>]
  findSimilar: [tags: string[]]
}>()

/* 与多媒体资源库（MediaKindView）保持同一套文案与图标，避免同名资源在两处叫法不同 */
const KIND_META: Record<MediaKind, { title: string; icon: string; empty: string }> = {
  image: { title: '图片', icon: 'image', empty: '没有匹配的图片' },
  video: { title: '视频', icon: 'smartphone', empty: '没有匹配的视频' },
  animation: { title: '小程序动画', icon: 'chart', empty: '没有匹配的小程序动画' },
}

const meta = computed(() => KIND_META[props.kind])

const { media, loading, loaded, ensure } = useComposeData()
const basket = useComposeBasket()

void ensure()

const rows = computed(() => media.value.filter((row) => matchesMediaFilter(row, props.filter, props.kind)))

const preview = ref<OrgMedia | null>(null)

function onFindSimilar(tags: string[]) {
  showToast(`已按该资源的知识点（${tags.join('、')}）去试题页签找题`)
  emit('findSimilar', tags)
}

/* 预览弹窗里的开关也要立刻反映车里的状态：`hasResource` 读的是响应式集合，
   在弹窗里点移出，背后那张卡片的按钮同时翻回「加入组卷车」。 */
function onToggleBasket(row: OrgMedia) {
  basket.toggleResource(row)
}
</script>

<template>
  <div class="gt">
    <ComposeFilterBar
      :filter="filter"
      :fields="['subject']"
      :result-count="rows.length"
      @patch="emit('patch', $event)"
      @reset="emit('patch', { subject: '' })"
    />

    <p v-if="loading && !loaded" class="empty-row">正在加载{{ meta.title }}…</p>
    <p v-else-if="rows.length === 0" class="empty-row">{{ meta.empty }}</p>
    <div v-else class="gt-grid" :class="`kind-${kind}`">
      <MediaGridCard
        v-for="row in rows"
        :key="row.id"
        :row="row"
        :in-basket="basket.hasResource(row.kind, row.id)"
        @preview="preview = $event"
        @find-similar="onFindSimilar"
        @toggle-basket="onToggleBasket"
      />
    </div>

    <!-- 预览：与多媒体资源库同一套呈现（真实图片/视频直接播，无字节的存量记录给占位说明） -->
    <AppModal v-if="preview" :title="preview.name" :width="640" @close="preview = null">
      <div v-if="preview.kind === 'image' && preview.url" class="gt-stage">
        <img :src="resolveMediaSrc(preview.url)" :alt="preview.name" />
      </div>
      <div v-else-if="preview.kind === 'video' && preview.url" class="gt-stage">
        <video :src="resolveMediaSrc(preview.url)" controls autoplay />
      </div>
      <div v-else class="gt-stage placeholder">
        <AppIcon :name="meta.icon" :size="56" />
        <p>{{ meta.title }}预览占位</p>
        <p class="f-hint">
          {{ preview.sizeMb.toFixed(1) }} MB<template v-if="preview.durationSec"> · 时长 {{ Math.floor(preview.durationSec / 60) }} 分 {{ preview.durationSec % 60 }} 秒</template>
          · 上传于 {{ preview.createdAt }}
        </p>
      </div>
      <div class="gt-ops">
        <p v-if="preview.knowledge.length" class="gt-kp">
          知识点：{{ preview.knowledge.join('、') }}
          <button class="mini-btn success" type="button" @click="onFindSimilar(preview.knowledge)">按知识点找题</button>
        </p>
        <!-- 点「预览」多半就是要在决定加不加之前看清楚内容，所以弹窗里必须也能加/移 -->
        <button
          class="mini-btn"
          :class="basket.hasResource(preview.kind, preview.id) ? 'danger' : 'success'"
          type="button"
          @click="onToggleBasket(preview)"
        >
          <AppIcon name="cart" :size="13" />
          {{ basket.hasResource(preview.kind, preview.id) ? '移出组卷车' : '加入组卷车' }}
        </button>
      </div>
    </AppModal>
  </div>
</template>

<style scoped>
.gt-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(212px, 1fr));
  gap: 14px;
  padding: 16px 18px;
}
/* 图片是横构图，网格略大一些才看得清内容 */
.gt-grid.kind-image { grid-template-columns: repeat(auto-fill, minmax(238px, 1fr)); }

.gt-stage {
  border-radius: 10px;
  overflow: hidden;
  background: #f4f7fb;
  display: flex;
  align-items: center;
  justify-content: center;
}
.gt-stage img, .gt-stage video { max-width: 100%; max-height: 62vh; display: block; }
.gt-stage.placeholder {
  flex-direction: column;
  gap: 8px;
  padding: 46px 0;
  color: var(--sub);
  font-size: 13px;
}
.gt-kp { font-size: 12.5px; color: var(--sub); display: flex; align-items: center; gap: 10px; }
/* 知识点行与「加入组卷车」并排；没有知识点时按钮靠左，不会孤零零飘在右边 */
.gt-ops { margin-top: 12px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.gt-ops .mini-btn { flex-shrink: 0; }
</style>
