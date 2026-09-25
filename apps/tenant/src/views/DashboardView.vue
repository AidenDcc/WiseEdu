<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { AppIcon, formatCount, showToast } from '@aiteach/shared'
import type { OrgMaterial, OrgMedia, OrgPaper, TextbookOption } from '@aiteach/shared'
import { fetchMaterials, fetchMedia, fetchPapers, fetchTextbookMatrix } from '@/api/org'
import HomeSection from '@/components/home/HomeSection.vue'
import MiniAppPreview from '@/components/home/MiniAppPreview.vue'
import ResourceThumb from '@/components/home/ResourceThumb.vue'
import SiteFooter from '@/components/home/SiteFooter.vue'
import { collectCountOf, commentCountOf, dateOf, viewCountOf } from '@/utils/resourceMetrics'
import { menus } from '@/menu'

/**
 * 机构端工作台首页（资源发现型）：搜索 + 功能入口 → 运营位 → 真题试卷 → 同步备课 → 课程小程序 → 电子教辅 → 页脚版权。
 * 资源卡数据全部来自机构端现有接口（试卷 / 教辅 / 多媒体 / 教材矩阵）。
 */
const router = useRouter()

/* ================= 数据 ================= */
const loading = ref(true)
const papers = ref<OrgPaper[]>([])
const materials = ref<OrgMaterial[]>([])
const media = ref<OrgMedia[]>([])
const textbooks = ref<TextbookOption[]>([])

onMounted(async () => {
  try {
    const [paperList, materialList, mediaList, matrix] = await Promise.all([
      fetchPapers(),
      fetchMaterials(),
      fetchMedia(),
      fetchTextbookMatrix(),
    ])
    papers.value = paperList
    materials.value = materialList
    media.value = mediaList
    textbooks.value = matrix
    initTextbook()
  } catch (error) {
    showToast((error as Error).message || '首页数据加载失败', 'error')
  } finally {
    loading.value = false
  }
})

/* ================= 模块1：搜索 + 功能入口 ================= */
const keyword = ref('')

function onSearch() {
  const kw = keyword.value.trim()
  router.push(kw ? { path: '/question/bank', query: { keyword: kw } } : { path: '/question/bank' })
}

/** 功能入口均指向机构端已上线页面；「更多」展开完整一级菜单 */
const ENTRIES = [
  { label: '题库组卷', icon: 'edit', to: '/question/bank' },
  { label: '真题试卷', icon: 'file', to: '/paper/list', hot: true },
  { label: '同步教辅', icon: 'book', to: '/material/list' },
  { label: '录制微课', icon: 'smartphone', to: '/material/media/video' },
  { label: 'AI 出题', icon: 'sparkles', to: '/question/create?mode=ai', hot: true },
  { label: '拍照识题', icon: 'image', to: '/question/photo' },
] as const

const moreOpen = ref(false)
const moreMenus = menus
  .filter((item) => item.path !== '/dashboard')
  .map((item) => ({ title: item.title, to: item.children?.[0]?.path ?? item.path }))

/* ================= 模块2：运营位 ================= */
const BANNERS = [
  { title: 'AI 智能出题', desc: '描述考点与难度，一句话生成整卷，知识点与难度自动配比', action: '立即体验', to: '/question/create?mode=ai', seed: 1 },
  { title: '拍照识题', desc: '拍下纸质试卷，AI 还原题干、公式与配图，确认即可入库', action: '去试试', to: '/question/photo', seed: 2 },
  { title: '协同组卷', desc: '多人实时协作组卷，改分值、换题全程留痕', action: '发起协作', to: '/paper/collab', seed: 3 },
  { title: '知识广场', desc: '共享机构优质资源，一键收藏到本校资料库', action: '去逛逛', to: '/square', seed: 5 },
]

const bannerTrack = ref<HTMLElement | null>(null)

function scrollBanner(step: number) {
  bannerTrack.value?.scrollBy({ left: step, behavior: 'smooth' })
}

/* ================= 模块3：真题试卷 ================= */
const PAPER_TABS = ['最新', '真题', '同步试卷', '单元测试', '期中', '期末', '月考', '模拟', '小升初']

/** 试卷接口未单独返回资源分类，按卷名关键词归类到标签页 */
const PAPER_TAG_RULES: Array<[string, string[]]> = [
  ['小升初', ['小升初']],
  ['模拟', ['模拟', '冲刺']],
  ['月考', ['月考']],
  ['单元测试', ['单元']],
  ['期中', ['期中']],
  ['期末', ['期末']],
  ['真题', ['真题']],
  ['同步试卷', ['同步']],
]

function paperTabOf(name: string): string {
  for (const [tab, keywords] of PAPER_TAG_RULES) {
    if (keywords.some((kw) => name.includes(kw))) return tab
  }
  return '同步试卷'
}

const paperTab = ref('最新')

/** 各标签页资源数：空标签页给出明确提示，避免看起来像加载失败 */
function paperCountOf(tab: string): number {
  return tab === '最新' ? papers.value.length : papers.value.filter((p) => paperTabOf(p.name) === tab).length
}

const paperList = computed(() => {
  const byTime = [...papers.value].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const list = paperTab.value === '最新' ? byTime : byTime.filter((p) => paperTabOf(p.name) === paperTab.value)
  return list.slice(0, 9)
})

/* ================= 模块4：同步备课 ================= */
const PREP_TABS = ['全部', '课件', '学案', '作业', '视频']

/** 教辅类型 → 备课资源类型（讲义即课件、笔记即学案，练习册与试卷集归入作业） */
function prepKindOf(type: string): string {
  if (type === '讲义') return '课件'
  if (type === '笔记') return '学案'
  return '作业'
}

interface PrepCard {
  key: string
  title: string
  kind: string
  typeText: string
  subject: string
  thumb: 'lesson' | 'video'
  seed: number
  duration?: number
  to: string
}

const prepTab = ref('全部')

/** 教材版本选择：`年级|学科|版本`，当前按学科过滤资源（教材版本维度待资源侧补 textbook 字段） */
const textbookKey = ref('')

const textbookOptions = computed(() =>
  textbooks.value.flatMap((grade) =>
    grade.subjects.flatMap((subject) =>
      subject.versions.map((version) => ({
        key: `${grade.grade}|${subject.name}|${version}`,
        label: `${version} · ${grade.grade} · ${subject.name}`,
      })),
    ),
  ),
)

const textbookSubject = computed(() => textbookKey.value.split('|')[1] ?? '')

/** 默认选中「人教版 · 七年级 · 数学」，与机构端现有资源学科一致 */
function initTextbook() {
  const options = textbookOptions.value
  const preferred =
    options.find((item) => item.key.startsWith('七年级|数学|人教版')) ??
    options.find((item) => item.key.includes('|数学|')) ??
    options[0]
  textbookKey.value = preferred?.key ?? ''
}

const prepCards = computed<PrepCard[]>(() => {
  const subject = textbookSubject.value
  const fromMaterials: PrepCard[] = materials.value.map((item) => ({
    key: `m${item.id}`,
    title: item.name,
    kind: prepKindOf(item.type),
    typeText: item.type,
    subject: item.subject,
    thumb: 'lesson',
    seed: item.id,
    to: '/material/list',
  }))
  const fromVideos: PrepCard[] = media.value
    .filter((item) => item.kind === 'video')
    .map((item) => ({
      key: `v${item.id}`,
      title: item.name,
      kind: '视频',
      typeText: '微课',
      subject: item.subject,
      thumb: 'video',
      seed: item.id,
      duration: item.durationSec,
      to: '/material/media/video',
    }))
  const all = [...fromMaterials, ...fromVideos].filter((item) => !subject || item.subject === subject)
  /* 「全部」只列备课资料：视频由「视频」页签与下方「精选视频」子模块承载，避免同屏重复 */
  const list =
    prepTab.value === '全部'
      ? all.filter((item) => item.kind !== '视频')
      : all.filter((item) => item.kind === prepTab.value)
  return list.slice(0, 10)
})

/** 精选视频：同板块下的嵌套子模块，复用同等网格；按热度取前 5 作为推荐位 */
const featuredVideos = computed(() => {
  const subject = textbookSubject.value
  return media.value
    .filter((item) => item.kind === 'video' && (!subject || item.subject === subject))
    .sort((a, b) => viewCountOf(b.id) - viewCountOf(a.id))
    .slice(0, 5)
})

/* ================= 模块5 / 6 ================= */
const miniApps = computed(() => media.value.filter((item) => item.kind === 'animation').slice(0, 10))
const handbooks = computed(() => materials.value.slice(0, 10))
</script>

<template>
  <div class="home">
    <!-- ===== 模块1：搜索 + 功能入口 ===== -->
    <section class="hero panel">
      <!-- <div class="search">
        <AppIcon name="search" :size="18" class="search-icon" />
        <input
          v-model="keyword"
          class="search-input"
          placeholder="搜索试题/试卷/备课资料"
          @keyup.enter="onSearch"
        />
        <button class="btn btn-primary btn-sm" @click="onSearch">搜索</button>
      </div> -->

      <nav class="entries">
        <RouterLink v-for="entry in ENTRIES" :key="entry.label" class="entry" :to="entry.to">
          <span class="entry-icon">
            <AppIcon :name="entry.icon" :size="26" />
            <i v-if="'hot' in entry && entry.hot" class="hot">HOT</i>
          </span>
          <span class="entry-label">{{ entry.label }}</span>
        </RouterLink>

        <div class="more-wrap">
          <button class="entry" @click="moreOpen = !moreOpen">
            <span class="entry-icon"><AppIcon name="grid" :size="26" /></span>
            <span class="entry-label">更多</span>
          </button>
          <Transition name="fade">
            <div v-if="moreOpen" class="more-panel panel">
              <RouterLink
                v-for="item in moreMenus"
                :key="item.title"
                class="more-item"
                :to="item.to"
                @click="moreOpen = false"
              >
                {{ item.title }}
              </RouterLink>
            </div>
          </Transition>
        </div>
      </nav>
    </section>

    <!-- ===== 模块2：运营位 ===== -->
    <!-- <section class="banner-area">
      <div ref="bannerTrack" class="banner-track">
        <article v-for="(banner, index) in BANNERS" :key="banner.title" class="banner" :class="`t${index % 4}`">
          <div class="banner-text">
            <h3>{{ banner.title }}</h3>
            <p>{{ banner.desc }}</p>
            <RouterLink class="banner-btn" :to="banner.to">{{ banner.action }}</RouterLink>
          </div>
          <div class="banner-art"><ResourceThumb :seed="banner.seed" kind="image" /></div>
        </article>
      </div>
      <div class="banner-nav">
        <button aria-label="上一组" @click="scrollBanner(-400)"><AppIcon name="chevron-left" :size="16" /></button>
        <button aria-label="下一组" @click="scrollBanner(400)"><AppIcon name="chevron-right" :size="16" /></button>
      </div>
    </section> -->

    <!-- ===== 模块3：真题试卷 ===== -->
    <HomeSection title="真题试卷" more="/paper/list">
      <div class="tabs">
        <button
          v-for="tab in PAPER_TABS"
          :key="tab"
          :class="{ active: paperTab === tab }"
          @click="paperTab = tab"
        >
          {{ tab }}<em v-if="paperCountOf(tab)">{{ paperCountOf(tab) }}</em>
        </button>
      </div>
      <div v-if="paperList.length" class="grid grid-3">
        <RouterLink v-for="paper in paperList" :key="paper.id" class="doc-card" to="/paper/list">
          <div class="doc-head">
            <span class="doc-icon"><AppIcon name="file" :size="15" /></span>
            <h4 class="doc-title">{{ paper.name }}</h4>
          </div>
          <div class="doc-meta">
            <span><AppIcon name="eye" :size="13" />{{ formatCount(viewCountOf(paper.id)) }}</span>
            <span><AppIcon name="message" :size="13" />{{ commentCountOf(paper.id) }}</span>
            <span class="doc-date">{{ dateOf(paper.updatedAt) }}</span>
          </div>
        </RouterLink>
      </div>
      <p v-else class="sec-empty">该分类暂无试卷资源</p>
    </HomeSection>

    <!-- ===== 模块4：同步备课 ===== -->
    <HomeSection title="同步备课" more="/material/list">
      <!-- <template #extra>
        <select v-model="textbookKey" class="f-select textbook-select" aria-label="教材版本">
          <option v-for="item in textbookOptions" :key="item.key" :value="item.key">{{ item.label }}</option>
        </select>
      </template> -->

      <div class="tabs">
        <button v-for="tab in PREP_TABS" :key="tab" :class="{ active: prepTab === tab }" @click="prepTab = tab">
          {{ tab }}
        </button>
      </div>

      <div v-if="prepCards.length" class="grid grid-5">
        <RouterLink v-for="card in prepCards" :key="card.key" class="res-card" :to="card.to">
          <ResourceThumb :seed="card.seed" :kind="card.thumb" :duration="card.duration" :badge="card.typeText" />
          <h4 class="res-title">{{ card.title }}</h4>
          <div class="res-meta">
            <span><AppIcon name="eye" :size="13" />{{ formatCount(viewCountOf(card.seed)) }}</span>
            <span><AppIcon name="star" :size="13" />{{ collectCountOf(card.seed) }}</span>
          </div>
        </RouterLink>
      </div>
      <p v-else class="sec-empty">该教材下暂无备课资源</p>

      <!-- 嵌套子模块：精选视频 -->
      <div class="sub-head">
        <h3>精选视频</h3>
        <RouterLink class="sec-more" to="/material/media/video">
          查看更多<AppIcon name="chevron-right" :size="13" />
        </RouterLink>
      </div>
      <div v-if="featuredVideos.length" class="grid grid-5">
        <RouterLink v-for="video in featuredVideos" :key="video.id" class="res-card" to="/material/media/video">
          <ResourceThumb :seed="video.id" kind="video" :duration="video.durationSec" badge="微课" />
          <h4 class="res-title">{{ video.name }}</h4>
          <div class="res-meta">
            <span><AppIcon name="eye" :size="13" />{{ formatCount(viewCountOf(video.id)) }}</span>
            <span><AppIcon name="star" :size="13" />{{ collectCountOf(video.id) }}</span>
          </div>
        </RouterLink>
      </div>
      <p v-else class="sec-empty">该教材下暂无视频资源</p>
    </HomeSection>

    <!-- ===== 模块5：课程小程序 ===== -->
    <HomeSection title="课程小程序" more="/material/media/animation">
      <div v-if="miniApps.length" class="grid grid-5">
        <div v-for="app in miniApps" :key="app.id" class="res-card">
          <MiniAppPreview :name="app.name" :seed="app.id" to="/material/media/animation" />
        </div>
      </div>
      <p v-else class="sec-empty">暂无小程序动画资源</p>
    </HomeSection>

    <!-- ===== 模块6：电子教辅 ===== -->
    <HomeSection title="电子教辅" more="/material/list">
      <div v-if="handbooks.length" class="grid grid-5">
        <RouterLink v-for="book in handbooks" :key="book.id" class="res-card" to="/material/list">
          <ResourceThumb :seed="book.id" kind="material" :meta="`${book.subject} · ${book.type}`" />
          <h4 class="res-title">{{ book.name }}</h4>
          <div class="res-meta">
            <span><AppIcon name="eye" :size="13" />{{ formatCount(viewCountOf(book.id)) }}</span>
            <span><AppIcon name="star" :size="13" />{{ collectCountOf(book.id) }}</span>
          </div>
        </RouterLink>
      </div>
      <p v-else class="sec-empty">暂无电子教辅资源</p>
    </HomeSection>

    <div v-if="loading" class="loading panel">
      <AppIcon name="clock" :size="20" class="spin" />
      正在加载机构资源…
    </div>

    <!-- ===== 页脚：版权信息（管理端数据字典维护） ===== -->
    <SiteFooter />
  </div>
</template>

<style scoped>
.home { display: flex; flex-direction: column; gap: 18px; }

/* ===== 模块1：搜索 + 功能入口 ===== */
.hero { padding: 26px 26px 22px; }
.search {
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: 720px;
  margin: 0 auto;
  border: 1.5px solid var(--border);
  border-radius: 999px;
  background: #fbfcfe;
  padding: 5px 6px 5px 18px;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.search:focus-within { border-color: var(--brand); box-shadow: 0 0 0 4px var(--brand-soft); }
.search-icon { color: var(--sub); flex-shrink: 0; }
.search-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: none;
  outline: none;
  font-size: 14.5px;
  height: 34px;
  color: var(--ink);
}

.entries {
  display: flex;
  justify-content: center;
  gap: 12px;
  margin-top: 26px;
}
.entry {
  flex: 0 1 132px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 9px;
  border: none;
  background: none;
  padding: 0;
}
.entry-icon {
  position: relative;
  width: 100%;
  aspect-ratio: 1 / 0.74;
  border-radius: 14px;
  background: #f6f8fc;
  color: var(--brand-deep);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s, transform 0.2s, box-shadow 0.2s, color 0.2s;
}
.entry:hover .entry-icon {
  background: var(--brand-soft);
  transform: translateY(-4px);
  box-shadow: 0 10px 22px rgba(28, 36, 52, 0.1);
}
.entry-label { font-size: 13.5px; font-weight: 600; color: var(--ink-2); }
.entry:hover .entry-label { color: var(--brand-deep); }
.hot {
  position: absolute;
  top: 6px;
  right: 6px;
  padding: 0 5px;
  border-radius: 6px 6px 6px 2px;
  background: var(--danger);
  color: #fff;
  font-size: 9.5px;
  font-weight: 700;
  font-style: normal;
  letter-spacing: 0.4px;
  line-height: 15px;
}

.more-wrap { position: relative; flex: 0 1 132px; display: flex; justify-content: center; }
.more-panel {
  position: absolute;
  top: calc(100% + 10px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  width: 224px;
  padding: 8px;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 2px;
  box-shadow: var(--shadow-lg);
}
.more-item {
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 13px;
  color: var(--ink-2);
  transition: background 0.15s, color 0.15s;
}
.more-item:hover { background: var(--brand-soft); color: var(--brand-deep); }

/* ===== 模块2：运营位 ===== */
.banner-area { position: relative; }
.banner-track {
  display: flex;
  gap: 16px;
  overflow-x: auto;
  scroll-behavior: smooth;
  padding-bottom: 4px;
  scrollbar-width: none;
}
.banner-track::-webkit-scrollbar { display: none; }
.banner {
  flex: 0 0 372px;
  display: flex;
  align-items: center;
  gap: 14px;
  border-radius: var(--radius);
  padding: 20px 20px 20px 22px;
  border: 1px solid var(--border);
  transition: transform 0.2s, box-shadow 0.2s;
}
.banner:hover { transform: translateY(-3px); box-shadow: var(--shadow-lg); }
.banner-text { flex: 1; min-width: 0; }
.banner-text h3 { font-size: 16.5px; font-weight: 700; }
.banner-text p { font-size: 12.5px; line-height: 1.6; margin: 7px 0 13px; }
.banner-btn {
  display: inline-flex;
  align-items: center;
  height: 30px;
  padding: 0 14px;
  border-radius: 999px;
  font-size: 12.5px;
  font-weight: 600;
  transition: opacity 0.15s;
}
.banner-btn:hover { opacity: 0.86; }
.banner-art { flex: 0 0 128px; }

.banner.t0 { background: linear-gradient(120deg, var(--brand) 0%, var(--brand-2) 100%); border-color: transparent; }
.banner.t0 h3, .banner.t0 .banner-text p { color: #fff; }
.banner.t0 .banner-text p { opacity: 0.88; }
.banner.t0 .banner-btn { background: #fff; color: var(--brand-deep); }
.banner.t1 { background: var(--brand-soft); }
.banner.t1 h3 { color: var(--brand-deep); }
.banner.t1 .banner-text p { color: var(--ink-2); }
.banner.t1 .banner-btn { background: var(--brand); color: #fff; }
.banner.t2 { background: #eef6f5; }
.banner.t2 h3 { color: var(--brand-deep); }
.banner.t2 .banner-text p { color: var(--ink-2); }
.banner.t2 .banner-btn { background: #fff; color: var(--ink-2); border: 1px solid var(--border); }
.banner.t3 { background: linear-gradient(120deg, var(--brand-deep) 0%, var(--brand) 100%); border-color: transparent; }
.banner.t3 h3, .banner.t3 .banner-text p { color: #fff; }
.banner.t3 .banner-text p { opacity: 0.88; }
.banner.t3 .banner-btn { background: #fff; color: var(--brand-deep); }

.banner-nav { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
.banner-nav button {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: #fff;
  color: var(--ink-2);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.15s, color 0.15s;
}
.banner-nav button:hover { border-color: var(--brand); color: var(--brand-deep); }

/* ===== 标签选项卡 ===== */
.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}
.tabs button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: #f6f8fc;
  color: var(--ink-2);
  font-size: 13px;
  font-weight: 600;
  padding: 6px 14px;
  transition: background 0.15s, color 0.15s;
}
.tabs button:hover { color: var(--brand-deep); background: var(--brand-soft); }
.tabs button.active { background: var(--brand-grad); color: #fff; }
.tabs button em { font-style: normal; font-size: 11.5px; opacity: 0.62; }

.textbook-select { width: 232px; height: 34px; font-size: 13px; }

/* ===== 资源网格 ===== */
.grid { display: grid; gap: 16px; }
.grid-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.grid-5 { grid-template-columns: repeat(5, minmax(0, 1fr)); }
@media (max-width: 1400px) {
  .grid-3 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .grid-5 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
@media (max-width: 1100px) {
  .grid-5 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

/* 真题试卷：文档列表卡 */
.doc-card {
  display: block;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: #fff;
  padding: 15px 16px;
  transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s;
}
.doc-card:hover { transform: translateY(-3px); box-shadow: var(--shadow-lg); border-color: transparent; }
.doc-head { display: flex; align-items: flex-start; gap: 9px; }
.doc-icon {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  background: var(--brand-soft);
  color: var(--brand-deep);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 1px;
}
.doc-title {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.5;
  color: var(--ink);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.doc-meta {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 12px;
  font-size: 12px;
  color: var(--sub);
}
.doc-meta span { display: inline-flex; align-items: center; gap: 4px; }
.doc-date { margin-left: auto; }

/* 备课 / 视频 / 教辅 / 小程序卡 */
.res-card { display: block; }
.res-card:hover .res-title { color: var(--brand-deep); }
.res-card :deep(.thumb), .res-card :deep(.mini-canvas) {
  transition: transform 0.2s, box-shadow 0.2s;
}
.res-card:hover :deep(.thumb), .res-card:hover :deep(.mini-canvas) {
  transform: translateY(-3px);
  box-shadow: var(--shadow-lg);
}
.res-title {
  font-size: 13.5px;
  font-weight: 600;
  line-height: 1.5;
  margin-top: 10px;
  color: var(--ink);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  transition: color 0.15s;
}
.res-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 6px;
  font-size: 12px;
  color: var(--sub);
}
.res-meta span { display: inline-flex; align-items: center; gap: 4px; }

/* 嵌套子模块标题 */
.sub-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 26px 0 16px;
}
.sub-head h3 { font-size: 16px; font-weight: 700; }
.sec-more {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 13px;
  color: var(--sub);
  transition: color 0.15s;
}
.sec-more:hover { color: var(--brand-deep); }

.sec-empty {
  padding: 34px 0;
  text-align: center;
  font-size: 13.5px;
  color: var(--sub);
}

/* ===== 加载态 ===== */
.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 50px;
  color: var(--sub);
  font-size: 14px;
}
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.fade-enter-active, .fade-leave-active { transition: opacity 0.15s, transform 0.15s; }
.fade-enter-from, .fade-leave-to { opacity: 0; transform: translate(-50%, -6px); }
</style>
