<script setup lang="ts">
/**
 * 题库组卷工作台（独立全屏页面，从侧边栏「题库组卷」以新标签页打开）。
 *
 * 为什么是**顶层路由**而不是 `/` 的子路由：机构端的侧边栏在 `AppLayout` 里无条件渲染，
 * 没有任何 meta 开关能摘掉它（见 `router/index.ts` 的路由注释）。要「无侧边栏全屏」，
 * 只能让本页根本不进 AppLayout。代价是布局层提供的服务（顶部栏、滚动容器、消息中心）
 * 这里都没有，故本页自备顶栏与滚动区；AI 助手悬浮球是 Teleport 到 body 的自包含组件，
 * 直接挂一份即可，与 AppLayout 内的页面行为一致。
 *
 * 状态归属：`filter`（跨页签保留的检索条件）与 `activeTab` 由本页持有，页签只读 + 上抛 patch；
 * `activeTab` 另与地址栏的 `?tab=` 双向同步（见下），刷新后回到同一个页签。
 * 组卷车是模块级单例（`useComposeBasket`），页签、抽屉、本页 FAB 共享同一份计数。
 */
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AppIcon, showToast } from '@aiteach/shared'
import { useComposeBasket } from '@/composables/useComposeBasket'
import { useComposeData } from '@/composables/useComposeData'
import { useScope } from '@/composables/useScope'
import ScopePicker from '@/components/ui/ScopePicker.vue'
import AiAssistant from '@/components/ai/AiAssistant.vue'
import ComposeSearchBar from '@/components/compose/ComposeSearchBar.vue'
import ComposeBasketPanel from '@/components/compose/ComposeBasketPanel.vue'
import ComposePaperDialog from '@/components/compose/ComposePaperDialog.vue'
import QuestionsTab from './tabs/QuestionsTab.vue'
import PapersTab from './tabs/PapersTab.vue'
import MaterialsTab from './tabs/MaterialsTab.vue'
import MediaGridTab from './tabs/MediaGridTab.vue'
import KnowledgeTab from './tabs/KnowledgeTab.vue'
import SyncTab from './tabs/SyncTab.vue'
import BlueprintTab from './tabs/BlueprintTab.vue'
import { COMPOSE_TABS, defaultComposeFilter, type ComposeFilter, type TabKey } from './types'

const basket = useComposeBasket()

/**
 * 本页这一串浮层的层级。
 *
 * AI 与组卷车两个悬浮球都在 301（高于全局搜索 200 与下拉 300，见 AiAssistant）。球抬上去之后，
 * 按默认层级挂的抽屉（110）会落到**试卷预览（130）后面** —— 在预览里点组卷车根本打不开；
 * 即便打得开，301 的球也会盖住抽屉底部的「生成试卷」。所以这一串整体提到球之上：
 * 组卷车抽屉 310 < 抽屉里资源预览 330（复用抽屉的 `zIndex + 10`）< 生成试卷弹窗 340（压在抽屉上）。
 *
 * ⚠️ 高于 `appConfirm` 的 130：这三个浮层里都**不要**用 appConfirm，否则确认框会被压在下面。
 * 真要加确认框，得先把它一起抬上来。
 */
const BASKET_Z = 310
const PAPER_DIALOG_Z = BASKET_Z + 30

/* 数据在 shell 层一次载入，页签共用（见 useComposeData 头部）；筛选与角标都由各页签自理 */
const { ensure } = useComposeData()

const route = useRoute()
const router = useRouter()
const filter = ref<ComposeFilter>(defaultComposeFilter())

/**
 * 页签 ⇄ 地址栏：`?tab=` 与 `activeTab` 双向同步，地址栏是页签的可还原表示。
 *
 * - **读**：进页面（刷新、把地址发给同事、从别处带 `?tab=papers` 直达）按 `?tab=` 定页签。
 *   只认 COMPOSE_TABS 里存在的 key：拼错的 query 不该落到空白页；
 *   **没有 `?tab=` 就是「试题」**（工作台的主入口）。
 * - **写**：切页签把 key 写回地址栏，刷新后仍在同一页签。默认页签（试题）不带参数，
 *   地址保持干净 —— 于是 `?tab=` 有值可读时一定是一个非默认页签。
 *
 * 用 `replace` 而不是 `push`：页签是**页内视图**，浏览器后退该退出工作台（回上一张页面），
 * 而不是在九个页签里一路倒着走 —— 那会让「后退」变得不可预期。
 */
function tabFromQuery(): TabKey {
  return COMPOSE_TABS.find((tab) => tab.key === route.query.tab)?.key ?? 'questions'
}

const activeTab = ref<TabKey>(tabFromQuery())

watch(activeTab, (key) => {
  const query = { ...route.query }
  if (key === 'questions') delete query.tab
  else query.tab = key
  void router.replace({ query })
})

/* 地址被外部改动（手改地址栏 / 别处带参跳转）时回写页签 ——
   上面那条只做「页签 → 地址」，两条合起来才是双向同步。
   程序内部的页签切换（如 findSimilar）走的是 activeTab，不必各自记得改地址 */
watch(
  () => route.query.tab,
  () => {
    activeTab.value = tabFromQuery()
  },
)

const basketOpen = ref(false)
const paperOpen = ref(false)

/* ===== 全局「年级 / 学科」作用域：页签条前的 ScopePicker 就是系统顶栏同一个组件 =====
 * 初值取顶部栏已选的年级学科（useScope 的 localStorage 记忆），此后工作台的筛选一直
 * 跟随它 —— 在这里改选也会写回全局作用域，行为与系统顶栏一模一样。 */
const { grade: scopeGrade, subject: scopeSubject, ensureScope } = useScope()
watch([scopeGrade, scopeSubject], () => {
  patch({ grade: scopeGrade.value, subject: scopeSubject.value })
})

/**
 * 启动即定范围：先归一全局作用域（字典未就绪时取不到值），再把它写进筛选。
 *
 * 为什么在 shell 而不是某个页签里：试题页签的左栏知识树要有学科才有内容，空树等于把
 * 工作台的主入口做成一个空框；页签是 `v-if` 挂载的，把跟随逻辑放进页签，
 * 用户切走再切回时会用旧值覆盖新选择。此后范围变化由上面的 watch 跟随。
 */
void (async () => {
  await Promise.all([ensure(), ensureScope().catch(() => {})])
  patch({ grade: scopeGrade.value, subject: scopeSubject.value })
})()

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
  /* 只看题数：只有参考资料成不了卷（`savePaper` 也要求至少 1 道题），
     资源是随卷附件，不能替代题目 */
  if (basket.count.value === 0) {
    showToast(
      basket.resourceTotal.value
        ? '组卷车里只有参考资料、还没有题目，试卷至少需要 1 道题'
        : '组卷车是空的，先加入一些题目',
      'error',
    )
    return
  }
  paperOpen.value = true
}

/** 保存成功后清空整车：题目进了卷面、资源存成了随卷参考资料，留在车里会让人误以为还没保存 */
function onPaperSaved() {
  basket.clear()
  basketOpen.value = false
}
</script>

<template>
  <div class="compose-shell">
    <header class="cs-head">
      <a class="cs-brand" href="/" target="_self" title="返回机构端">
        <span class="cs-logo"><img src="/logo.png" alt="AI教学云平台" /></span>
        <span class="cs-brand-text">
          <b>题库组卷</b>
          <em>AI教学云平台 · 机构端</em>
        </span>
      </a>

      <div class="cs-search">
        <ComposeSearchBar :filter="filter" @patch="patch" />
      </div>
    </header>

    <!-- 页签条：年级 / 学科选择器贴左端（与系统顶栏同一个 ScopePicker 组件，选定即驱动下方
         所有页签只展示该年级学科的内容），页签组居中于内容区。
         居中靠三列网格实现（选择器在第 1 列，页签在中间的 auto 列，第 3 列留空），见 .cs-tabbar -->
    <div class="cs-tabbar">
      <div class="cs-scope"><ScopePicker /></div>
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
        </button>
      </nav>
    </div>

    <main ref="mainRef" class="cs-main">
      <QuestionsTab v-if="activeTab === 'questions'" :filter="filter" @patch="patch" @find-similar="findSimilar" />
      <PapersTab v-else-if="activeTab === 'papers'" :filter="filter" @patch="patch" />
      <MaterialsTab v-else-if="activeTab === 'materials'" :filter="filter" @patch="patch" @find-similar="findSimilar" />
      <MediaGridTab v-else-if="activeTab === 'miniapp'" :filter="filter" kind="animation" @patch="patch" @find-similar="findSimilar" />
      <MediaGridTab v-else-if="activeTab === 'videos'" :filter="filter" kind="video" @patch="patch" @find-similar="findSimilar" />
      <MediaGridTab v-else-if="activeTab === 'images'" :filter="filter" kind="image" @patch="patch" @find-similar="findSimilar" />
      <KnowledgeTab v-else-if="activeTab === 'knowledge'" :filter="filter" @patch="patch" @find-similar="findSimilar" />
      <SyncTab v-else-if="activeTab === 'sync'" :filter="filter" @patch="patch" @find-similar="findSimilar" />
      <BlueprintTab v-else-if="activeTab === 'blueprint'" :filter="filter" />
    </main>

    <ComposeBasketPanel
      :open="basketOpen"
      :z-index="BASKET_Z"
      @close="basketOpen = false"
      @compose="openPaper"
    />
    <ComposePaperDialog
      :open="paperOpen"
      :z-index="PAPER_DIALOG_Z"
      @close="paperOpen = false"
      @saved="onPaperSaved"
    />

    <!-- AI 问答：与系统顶栏内页面同一组件（Teleport 悬浮球 + 对话面板），逻辑共用。
         组卷车以 `#above-fab` 挂在 AI 球正上方 —— 两个球共用同一份实时位置，
         拖动 AI 球时组卷车跟着走（见 AiAssistant 的插槽说明） -->
    <AiAssistant>
      <template #above-fab>
        <button class="cs-basket-fab" type="button" title="组卷车" @click="basketOpen = !basketOpen">
          <AppIcon name="cart" :size="20" />
          <span class="cs-basket-fab-text">组卷车</span>
          <!-- 角标算「题 + 资源」：媒体进车后如果不计数，用户会以为加失败了 -->
          <b v-if="basket.totalCount.value" class="cs-basket-count">{{ basket.totalCount.value }}</b>
        </button>
      </template>
    </AiAssistant>
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
  --compose-max: 1440px;
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
/* 与系统全局侧边栏同一个 logo（/logo.png），样式对齐 AppLayout 的 .brand-logo */
.cs-logo {
  width: 38px;
  height: 38px;
  border-radius: 11px;
  background: #fff;
  overflow: hidden;
  box-shadow: 0 6px 14px rgba(0, 180, 166, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.cs-logo img { width: 100%; height: 100%; display: block; object-fit: contain; }
.cs-brand-text { display: flex; flex-direction: column; line-height: 1.25; }
.cs-brand-text b { font-size: 15px; color: var(--ink); }
.cs-brand-text em { font-size: 11.5px; color: var(--sub); font-style: normal; }

/* 横向居中搜索条：补 align-items 让子元素按自身高度纵向居中（否则被拉伸到条高） */
.cs-search { flex: 1; display: flex; align-items: center; justify-content: center; }

/* 组卷车悬浮球：位置与层级由 AiAssistant 的 `.ai-fab-above` 壳提供（两者都是 64px 方框），
   这里只管球本身。白色球与 AI 的渐变球并排，一眼能分出「找题」与「看车」两个入口 */
.cs-basket-fab {
  position: relative;
  width: 100%;
  height: 100%;
  border: 1px solid var(--border);
  border-radius: 50%;
  background: #fff;
  color: var(--brand-deep);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  box-shadow: 0 10px 24px rgba(28, 36, 52, 0.2);
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}
.cs-basket-fab:hover { transform: scale(1.06); box-shadow: 0 12px 28px rgba(28, 36, 52, 0.26); }
.cs-basket-fab:active { transform: scale(0.98); }
.cs-basket-fab-text { font-size: 11px; line-height: 1; font-weight: 600; }
.cs-basket-count {
  position: absolute;
  top: -3px;
  right: -3px;
  min-width: 19px;
  height: 19px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--brand-grad);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  line-height: 19px;
  text-align: center;
  box-shadow: 0 2px 8px rgba(0, 180, 166, 0.42);
}

/* 页签条外壳：白底贯通 + 底部分隔线；年级/学科选择器与页签同行，选择器不进滚动容器
   （overflow-x: auto 会把它的下拉面板一起裁掉，所以整条**不能**给 overflow） */
.cs-tabbar {
  display: grid;
  /* 三列：选择器 / 页签 / 空列。两侧都是 `1fr`，**与各自内容宽无关地等分剩余空间**，
     中间那列于是正好落在内容区中点 —— 这正是「页签居中、选择器仍贴左」的做法；
     靠 flex + margin:auto 做不到：那样页签的居中基准是「选择器右边的剩余空间」，会偏右。
     中间列写成 minmax(0, auto)：页签放得下就取自身宽度（居中成立），
     放不下时先收缩、由 .cs-tabs 横向滚动，而不是把整条撑出屏幕被裁掉。
     代价：视口窄到两侧各不足选择器最小宽度（约 1250px 以下）时左列会长过右列，页签略偏右 ——
     比让选择器与页签重叠好。 */
  grid-template-columns: 1fr minmax(0, auto) 1fr;
  align-items: center;
  gap: 14px;
  padding: 0 var(--cs-gutter);
  background: #fff;
  border-bottom: 1px solid var(--border);
  z-index: 40;
  flex-shrink: 0;
}
/* 选择器只占第一列并贴左；不写 min-width: 0（那会让它的自动最小尺寸变成 0，
   第一列就可能窄过选择器、被页签压上去） */
.cs-scope { display: flex; justify-content: flex-start; }
.cs-tabs {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
}
/* 页签条整体加高、间距放宽：去掉了角标之后不再拥挤，行高更舒展 */
.cs-tab {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border: none;
  background: none;
  font-size: 13.5px;
  color: var(--ink-2);
  padding: 14px 16px;
  border-bottom: 2px solid transparent;
  white-space: nowrap;
  transition: color 0.14s, border-color 0.14s;
}
.cs-tab:hover { color: var(--brand-deep); }
.cs-tab.on { color: var(--brand-deep); font-weight: 600; border-bottom-color: var(--brand); }
.cs-tab-compose { font-weight: 500; }
.cs-tab-sep { width: 1px; height: 18px; background: var(--border); margin: 0 8px; flex-shrink: 0; }

.cs-main {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 20px var(--cs-gutter) 26px;
}
</style>
