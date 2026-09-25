<script setup lang="ts">
/**
 * 题库组卷工作台（独立全屏页面，从侧边栏「题库组卷」以新标签页打开）。
 *
 * 为什么是**顶层路由**而不是 `/` 的子路由：机构端的侧边栏在 `AppLayout` 里无条件渲染，
 * 没有任何 meta 开关能摘掉它（见 `router/index.ts` 的路由注释）。要「无侧边栏全屏」，
 * 只能让本页根本不进 AppLayout。代价是布局层提供的服务（顶部栏、滚动容器、消息中心、
 * AI 助手悬浮球）这里都没有，故本页自备顶栏与滚动区，也**不挂 AiAssistant**。
 *
 * 状态归属：`filter`（跨页签保留的检索条件）与 `activeTab` 由本页持有，页签只读 + 上抛 patch；
 * 组卷车是模块级单例（`useComposeBasket`），页签、抽屉、本页 FAB 共享同一份计数。
 */
import { computed, ref } from 'vue'
import { AppIcon, showToast } from '@aiteach/shared'
import { useComposeBasket } from '@/composables/useComposeBasket'
import { useComposeData } from '@/composables/useComposeData'
import { useBaseData } from '@/composables/useBaseData'
import ComposeSearchBar from '@/components/compose/ComposeSearchBar.vue'
import ComposeBasketPanel from '@/components/compose/ComposeBasketPanel.vue'
import ComposePaperDialog from '@/components/compose/ComposePaperDialog.vue'
import QuestionsTab from './tabs/QuestionsTab.vue'
import PapersTab from './tabs/PapersTab.vue'
import MaterialsTab from './tabs/MaterialsTab.vue'
import MediaGridTab from './tabs/MediaGridTab.vue'
import KnowledgeTab from './tabs/KnowledgeTab.vue'
import SyncTab from './tabs/SyncTab.vue'
import {
  COMPOSE_TABS,
  defaultComposeFilter,
  matchesMaterialFilter,
  matchesMediaFilter,
  matchesPaperFilter,
  matchesQuestionFilter,
  type ComposeFilter,
  type TabKey,
} from './types'

const basket = useComposeBasket()
/* 数据在 shell 层一次载入，8 个页签共用（见 useComposeData 头部）。媒体按 kind 预分好，
   页签直接取用自己那一份，不必各自过滤。 */
const { questions, papers, materials, videos, animations, images, questionOf, ensure } = useComposeData()
const { ensure: ensureBase, defaultTextbook } = useBaseData()

const filter = ref<ComposeFilter>(defaultComposeFilter())
const activeTab = ref<TabKey>('questions')
const basketOpen = ref(false)
const paperOpen = ref(false)

/**
 * 首次进入且工作台还没定范围时，落到种子题库所在的高一·数学。
 *
 * 为什么在 shell 而不是某个页签里：试题页签的左栏知识树要有学科才有内容，空树等于把
 * 工作台的主入口做成一个空框；但页签是 `v-if` 挂载的，把这段逻辑放进页签，用户一旦
 * 主动清空年级学科、切走再切回，被清掉的条件就会自己长回来。只在启动时做一次。
 */
void (async () => {
  await Promise.all([ensure(), ensureBase()])
  if (filter.value.grade || filter.value.subject) return
  const preset = defaultTextbook()
  if (preset.grade || preset.subject) patch({ grade: preset.grade, subject: preset.subject })
})()

/** 标题栏的教材范围提示：让教师随时知道自己搜的是哪个范围 */
const scopeText = computed(() => [filter.value.grade, filter.value.subject].filter(Boolean).join(' · ') || '全部年级学科')

interface TabCount {
  key: TabKey
  count: number
}

/**
 * 页签命中数：一次搜索要能跨资源类型看见结果，否则「搜了视频没搜到」会被误以为整个搜索没命中。
 *
 * 每个分支都必须与**对应页签自己的筛选口径**一致（题库走 matchesQuestionFilter，其余按
 * 关键词 + 学科/年级），否则会出现「页签写着 5 条、点进去只有 2 条」，用户会以为丢了资源。
 */
function countFor(key: TabKey): number {
  const current = filter.value
  switch (key) {
    case 'questions':
    case 'knowledge':
      return questions.value.filter((row) => matchesQuestionFilter(row, current)).length
    case 'papers':
      return papers.value.filter((row) => matchesPaperFilter(row, current, questionOf)).length
    case 'materials':
      return materials.value.filter((row) => matchesMaterialFilter(row, current)).length
    case 'miniapp':
      return animations.value.filter((row) => matchesMediaFilter(row, current, 'animation')).length
    case 'videos':
      return videos.value.filter((row) => matchesMediaFilter(row, current, 'video')).length
    case 'images':
      return images.value.filter((row) => matchesMediaFilter(row, current, 'image')).length
    /* 同步页签列的是「可用于组卷的教辅」而非题目，故命中数就是可用教辅数 */
    case 'sync':
      return materials.value.filter((row) => row.status === 'done' && (!current.subject || row.subject === current.subject)).length
    default:
      return 0
  }
}

const counts = computed<TabCount[]>(() => COMPOSE_TABS.map((tab) => ({ key: tab.key, count: countFor(tab.key) })))
const countOf = (key: TabKey) => counts.value.find((row) => row.key === key)?.count ?? 0

/* 页签条上「资源类」与「组卷类」之间加一道分隔，两组的用法不同（浏览检索 vs 按结构出题） */
const resourceTabs = computed(() => COMPOSE_TABS.filter((tab) => tab.group === 'resource'))
const composeTabs = computed(() => COMPOSE_TABS.filter((tab) => tab.group === 'compose'))

/** 页签只上抛差异，其余条件保持不变；用新对象替换以触发依赖 filter 的计算属性 */
function patch(next: Partial<ComposeFilter>) {
  filter.value = { ...filter.value, ...next }
}

/** 主区滚动容器（本页是内部滚动布局，不是整页滚动，故不能用 window.scrollTo） */
const mainRef = ref<HTMLElement | null>(null)

/** 媒体/教辅的「按知识点找题」：把知识点写进筛选并切到试题页签 */
function findSimilar(tags: string[]) {
  patch({ knowledge: [...tags], keyword: '' })
  activeTab.value = 'questions'
  mainRef.value?.scrollTo({ top: 0 })
}

function openPaper() {
  if (basket.count.value === 0) {
    showToast('组卷车是空的，先加入一些题目', 'error')
    return
  }
  paperOpen.value = true
}

/** 保存成功后把车里的题清掉：题目已经落进试卷，留在车里会让人误以为还没保存 */
function onPaperSaved() {
  basket.clear()
  basketOpen.value = false
}
</script>

<template>
  <div class="compose-shell" :class="{ 'basket-open': basketOpen }">
    <header class="cs-head">
      <a class="cs-brand" href="/" target="_self" title="返回机构端">
        <span class="cs-logo">教</span>
        <span class="cs-brand-text">
          <b>题库组卷</b>
          <em>{{ scopeText }}</em>
        </span>
      </a>

      <div class="cs-search">
        <ComposeSearchBar :filter="filter" @patch="patch" />
      </div>

      <div class="cs-head-ops">
        <button class="cs-basket-btn" type="button" @click="basketOpen = !basketOpen">
          <AppIcon name="cart" :size="16" />
          组卷车
          <b v-if="basket.count.value">{{ basket.count.value }}</b>
        </button>
      </div>
    </header>

    <nav class="cs-tabs">
      <button
        v-for="tab in resourceTabs"
        :key="tab.key"
        class="cs-tab"
        :class="{ on: activeTab === tab.key }"
        type="button"
        @click="activeTab = tab.key"
      >
        <AppIcon :name="tab.icon" :size="14" />
        {{ tab.label }}
        <span class="cs-tab-count">{{ countOf(tab.key) }}</span>
      </button>

      <span class="cs-tab-sep" />

      <button
        v-for="tab in composeTabs"
        :key="tab.key"
        class="cs-tab cs-tab-compose"
        :class="{ on: activeTab === tab.key }"
        type="button"
        @click="activeTab = tab.key"
      >
        <AppIcon :name="tab.icon" :size="14" />
        {{ tab.label }}
        <span class="cs-tab-count">{{ countOf(tab.key) }}</span>
      </button>
    </nav>

    <main ref="mainRef" class="cs-main">
      <QuestionsTab v-if="activeTab === 'questions'" :filter="filter" @patch="patch" @find-similar="findSimilar" />
      <PapersTab v-else-if="activeTab === 'papers'" :filter="filter" @patch="patch" />
      <MaterialsTab v-else-if="activeTab === 'materials'" :filter="filter" @patch="patch" @find-similar="findSimilar" />
      <MediaGridTab v-else-if="activeTab === 'miniapp'" :filter="filter" kind="animation" @patch="patch" @find-similar="findSimilar" />
      <MediaGridTab v-else-if="activeTab === 'videos'" :filter="filter" kind="video" @patch="patch" @find-similar="findSimilar" />
      <MediaGridTab v-else-if="activeTab === 'images'" :filter="filter" kind="image" @patch="patch" @find-similar="findSimilar" />
      <KnowledgeTab v-else-if="activeTab === 'knowledge'" :filter="filter" @patch="patch" @find-similar="findSimilar" />
      <SyncTab v-else-if="activeTab === 'sync'" :filter="filter" @patch="patch" @find-similar="findSimilar" />
    </main>

    <!-- 组卷车浮动按钮：抽屉关着时的常驻入口 -->
    <button v-if="!basketOpen" class="cs-fab" :class="{ empty: basket.count.value === 0 }" type="button" @click="basketOpen = true">
      <AppIcon name="cart" :size="18" />
      <span v-if="basket.count.value">{{ basket.count.value }} 题 · {{ basket.scoreTotal.value }} 分</span>
      <span v-else>组卷车空</span>
    </button>

    <ComposeBasketPanel :open="basketOpen" @close="basketOpen = false" @compose="openPaper" />
    <ComposePaperDialog :open="paperOpen" @close="paperOpen = false" @saved="onPaperSaved" />
  </div>
</template>

<style scoped>
/* 内部滚动布局（而不是整页滚动）：顶栏与页签条天然固定，不需要 sticky 去凑像素偏移 */
.compose-shell {
  height: 100vh;
  overflow: hidden;
  background: var(--bg);
  display: flex;
  flex-direction: column;

  /* 内容居中：左右留白 = max(24px, 剩余空间的一半)。
     用 padding 而不是给某层套 max-width —— 顶栏与页签条的白底和分隔线才能仍然贯通整屏，
     否则大屏上会出现一条「断掉」的边线。 */
  --compose-max: 1320px;
  --cs-gutter: max(24px, calc((100% - var(--compose-max)) / 2));
}

.cs-head {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 12px var(--cs-gutter);
  background: #fff;
  border-bottom: 1px solid var(--border);
  z-index: 50;
}

.cs-brand { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.cs-logo {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: var(--brand-grad);
  color: #fff;
  font-size: 18px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
.cs-brand-text { display: flex; flex-direction: column; line-height: 1.25; }
.cs-brand-text b { font-size: 15px; color: var(--ink); }
.cs-brand-text em { font-size: 11.5px; color: var(--sub); font-style: normal; }

.cs-search { flex: 1; display: flex; justify-content: center; }

.cs-head-ops { flex-shrink: 0; }
.cs-basket-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 38px;
  padding: 0 15px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: #fff;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-2);
}
.cs-basket-btn:hover { border-color: var(--brand); color: var(--brand-deep); }
.cs-basket-btn b {
  font-size: 11.5px;
  color: #fff;
  background: var(--brand-grad);
  border-radius: 999px;
  padding: 1px 7px;
}

.cs-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 var(--cs-gutter);
  background: #fff;
  border-bottom: 1px solid var(--border);
  overflow-x: auto;
  z-index: 40;
  flex-shrink: 0;
}
.cs-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: none;
  font-size: 13.5px;
  color: var(--ink-2);
  padding: 12px 13px;
  border-bottom: 2px solid transparent;
  white-space: nowrap;
  transition: color 0.14s, border-color 0.14s;
}
.cs-tab:hover { color: var(--brand-deep); }
.cs-tab.on { color: var(--brand-deep); font-weight: 600; border-bottom-color: var(--brand); }
.cs-tab-count {
  font-size: 10.5px;
  color: var(--sub);
  background: #f1f3f9;
  border-radius: 999px;
  padding: 1px 6px;
}
.cs-tab.on .cs-tab-count { background: var(--brand-soft); color: var(--brand-deep); }
.cs-tab-compose { font-weight: 500; }
.cs-tab-sep { width: 1px; height: 18px; background: var(--border); margin: 0 8px; flex-shrink: 0; }

.cs-main {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px var(--cs-gutter) 20px;
  transition: padding-right 0.22s ease;
}

.cs-fab {
  position: fixed;
  /* 贴视口右下角，**不**跟内容右缘对齐：内容有最大宽度，对齐后悬浮球会压住列表卡片与翻页，
     贴视口则在大屏上自然落进右侧留白里 */
  right: 24px;
  bottom: 24px;
  z-index: 55;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 46px;
  padding: 0 20px;
  border: none;
  border-radius: 999px;
  background: var(--brand-grad);
  color: #fff;
  font-size: 13.5px;
  font-weight: 600;
  box-shadow: var(--shadow-lg);
}
.cs-fab:hover { filter: brightness(1.06); }
.cs-fab.empty { background: #fff; color: var(--sub); border: 1px solid var(--border); }
/* 抽屉展开时给主区右侧留出空间，避免内容被抽屉永久压住。
   取 max(抽屉宽, 留白)：留白本来就比抽屉宽时（超宽屏），内容离右缘已经足够远，
   再按抽屉宽去推反而会把内容压窄。 */
.compose-shell.basket-open .cs-main { padding-right: max(372px, var(--cs-gutter)); }
</style>
