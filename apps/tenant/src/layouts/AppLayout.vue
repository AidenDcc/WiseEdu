<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AppIcon, showToast, hueColor, resolveApiMode, getAppConfig, buildBreadcrumb, appConfirm } from '@aiteach/shared'
import type { MenuItem } from '@/menu'
import { footerMenus, menus } from '@/menu'
import { useAuthStore } from '@/stores/auth'
import { useScope } from '@/composables/useScope'
import { useDemoRole, type DemoRole } from '@/composables/useDemoRole'
import { useVisibleMenus } from '@/composables/useVisibleMenus'
import ScopePicker from '@/components/ui/ScopePicker.vue'
import GlobalSearchOverlay from '@/components/search/GlobalSearchOverlay.vue'
import OrgNotificationCenter from '@/components/OrgNotificationCenter.vue'
import AiAssistant from '@/components/ai/AiAssistant.vue'
import { fetchOrgMessages } from '@/api/org'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

/* ===== 菜单裁剪：机构菜单开关 × 角色权限 =====
   侧边栏、折叠浮层、底部入口、面包屑四处的取数都从这里走（见 useVisibleMenus.ts 的说明）。 */
const { visibleMenus, visibleFooterMenus } = useVisibleMenus()

/* ===== 侧边栏折叠（状态记忆） ===== */
const COLLAPSE_KEY = `aiteach:${getAppConfig().appName}:sidebar-collapsed`
const collapsed = ref(localStorage.getItem(COLLAPSE_KEY) === '1')
watch(collapsed, (value) => {
  localStorage.setItem(COLLAPSE_KEY, value ? '1' : '0')
  if (!value) flyout.value = null
})

/** 分组展开状态：默认展开包含当前路由的分组 */
const expandedKeys = ref<string[]>([])

function expandActiveGroup() {
  for (const item of visibleMenus.value) {
    if (item.children?.some((child) => route.path.startsWith(child.path)) && !expandedKeys.value.includes(item.path)) {
      expandedKeys.value.push(item.path)
    }
  }
}
expandActiveGroup()
/* 权限是异步到达的：首次渲染时菜单可能还是全量（矩阵未加载），等真菜单出来后
   再补算一次当前路由所在分组，否则「刷新后直接落在 /paper/collab，侧边栏却是收着的」。 */
watch(visibleMenus, expandActiveGroup)

function toggleGroup(path: string) {
  const index = expandedKeys.value.indexOf(path)
  if (index >= 0) expandedKeys.value.splice(index, 1)
  else expandedKeys.value.push(path)
}

function isGroupActive(item: { path: string; children?: { path: string }[] }) {
  return Boolean(item.children?.some((child) => route.path.startsWith(child.path)))
}

/* ===== 折叠态分组浮层 ===== */
const flyout = ref<{ path: string; top: number } | null>(null)
let flyoutTimer: number | undefined

/* 从裁剪后的菜单里找：折叠态的浮层与展开态的侧边栏必须显示同一批菜单，
   否则折叠起来会冒出一个已经无权访问的分组 */
const flyoutItem = computed(() =>
  visibleMenus.value.find((item) => item.path === flyout.value?.path),
)

function openFlyout(item: MenuItem, event: MouseEvent) {
  if (!collapsed.value) return
  clearTimeout(flyoutTimer)
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  flyout.value = { path: item.path, top: Math.max(rect.top - 8, 8) }
}

function cancelCloseFlyout() {
  clearTimeout(flyoutTimer)
}

function scheduleCloseFlyout() {
  clearTimeout(flyoutTimer)
  flyoutTimer = window.setTimeout(() => (flyout.value = null), 150)
}

function onGroupHeadClick(item: MenuItem, event: MouseEvent) {
  if (collapsed.value) {
    openFlyout(item, event)
  } else {
    toggleGroup(item.path)
  }
}

onBeforeUnmount(() => clearTimeout(flyoutTimer))

/* 页面名不再单独显示，改由面包屑承担（层级取自 menu.ts，路由本身是平铺的）。
   底部的 footerMenus 也要并进来：回收站等页面的菜单项在那里。
   **这里刻意用全量 `menus` 而不是 `visibleMenus`**：面包屑靠菜单树做前缀匹配，
   用裁剪后的列表会让隐藏分组的深层页退化成单层标题。它是描述性的，不参与裁剪。 */
const crumbs = computed(() =>
  buildBreadcrumb([...menus, ...footerMenus], route.path, route.meta.title as string),
)
const isMockMode = resolveApiMode('/__probe__') === 'mock'

/* ===== 用户菜单 ===== */
const userMenuOpen = ref(false)
const userRef = ref<HTMLElement | null>(null)

function onDocumentClick(event: MouseEvent) {
  if (userRef.value && !userRef.value.contains(event.target as Node)) {
    userMenuOpen.value = false
  }
}

onMounted(() => document.addEventListener('click', onDocumentClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocumentClick))

/* ===== 消息中心（FR-GN-015 ~ 019） ===== */
const notifyOpen = ref(false)
const unreadTotal = ref(0)

async function refreshUnread() {
  const [todo, review, collab, system] = await Promise.all([
    fetchOrgMessages('todo'),
    fetchOrgMessages('review'),
    fetchOrgMessages('collab'),
    fetchOrgMessages('system'),
  ])
  unreadTotal.value = [todo, review, collab, system]
    .reduce((all, list) => [...all, ...list], [])
    .filter((row) => !row.read).length
}

function openNotifications() {
  notifyOpen.value = true
}

/* ===== 顶部全局「年级 / 学科」（ScopePicker 组件，localStorage 记忆，各业务视图带入默认值） ===== */
const { ensureScope } = useScope()

/* ===== 顶部全局搜索（FR-GN-026）：顶栏只作触发器，点击弹出搜索面板 ===== */
const searchOpen = ref(false)

async function onLogout() {
  if (!(await appConfirm('确定退出登录？', { type: 'info' }))) return
  await auth.logout()
  showToast('已退出登录', 'success')
  router.push('/login')
}

/* ===== 演示身份（右上角用户下拉里切换） =====
   机构端只有一个登录账号，而机构管理员 / 年级学科组长 / 参与组卷老师的菜单与权限完全不同。
   见 composables/useDemoRole.ts 的说明：不重登、不动 token。 */
const { identity, identities, apply } = useDemoRole()

function switchIdentity(role: DemoRole) {
  if (role === identity.value.role) return
  const user = apply(role)
  userMenuOpen.value = false
  showToast(`已切换为「${user?.name ?? ''} · ${user?.roleName ?? ''}」`, 'success')
}

onMounted(refreshUnread)
/* 触发字典加载并归一缓存的年级 / 学科（下拉选项与默认值都依赖字典） */
onMounted(() => void ensureScope())
/* mock 是内存态，刷新后回到默认身份 —— 挂载时按缓存把身份贴回去（含 CURRENT 与 auth.user） */
onMounted(() => apply(identity.value.role))
</script>

<template>
  <div class="layout" :class="{ collapsed }">
    <!-- ===== 侧边栏 ===== -->
    <aside class="sidebar">
      <div class="brand" :title="collapsed ? 'AI教学云平台' : undefined">
        <div class="brand-logo">
          <img src="/logo.png" alt="AI教学云平台" />
        </div>
        <div class="brand-text">
          <div class="brand-name">AI教学云平台</div>
          <div class="brand-sub">机构端 · {{ auth.user?.orgName ?? '' }}</div>
        </div>
      </div>

      <nav class="menu">
        <template v-for="item in visibleMenus" :key="item.path">
          <!-- 直接链接（工作台） -->
          <RouterLink
            v-if="!item.children"
            :to="item.path"
            class="menu-item"
            :class="{ active: route.path === item.path }"
            :title="collapsed ? item.title : undefined"
          >
            <AppIcon :name="item.icon ?? 'grid'" />
            <span class="menu-label">{{ item.title }}</span>
          </RouterLink>

          <!-- 可折叠分组 -->
          <div
            v-else
            class="menu-group"
            :class="{ open: expandedKeys.includes(item.path) && !collapsed }"
          >
            <button
              class="menu-item group-head"
              :class="{ active: isGroupActive(item) }"
              :title="collapsed ? item.title : undefined"
              @click="onGroupHeadClick(item, $event)"
              @mouseenter="openFlyout(item, $event)"
              @mouseleave="scheduleCloseFlyout"
            >
              <AppIcon :name="item.icon ?? 'grid'" />
              <span class="menu-label">{{ item.title }}</span>
              <AppIcon class="chev" name="chevron-down" :size="14" />
            </button>
            <div
              class="sub-items"
              :class="{ collapsed: !expandedKeys.includes(item.path) }"
            >
              <div class="sub-inner">
                <!-- 新标签页项渲染为 <a>：锚点导航不会被浏览器拦截，也不必先 window.open 再等异步 -->
                <template v-for="child in item.children" :key="child.path">
                  <a
                    v-if="child.newTab"
                    :href="child.path"
                    target="_blank"
                    rel="noopener"
                    class="menu-sub"
                    :title="`在新标签页打开${child.title}`"
                  >
                    {{ child.title }}<AppIcon class="ext" name="arrow-right" :size="11" />
                  </a>
                  <RouterLink
                    v-else
                    :to="child.path"
                    class="menu-sub"
                    :class="{ active: route.path.startsWith(child.path) }"
                  >
                    {{ child.title }}
                  </RouterLink>
                </template>
              </div>
            </div>
          </div>
        </template>
      </nav>

      <div class="sidebar-extra">
        <RouterLink
          v-for="item in visibleFooterMenus"
          :key="item.path"
          :to="item.path"
          class="menu-item"
          :class="{ active: route.path.startsWith(item.path) }"
          :title="collapsed ? item.title : undefined"
        >
          <AppIcon :name="item.icon ?? 'grid'" />
          <span class="menu-label">{{ item.title }}</span>
        </RouterLink>
      </div>
    </aside>

    <!-- 折叠态分组浮层 -->
    <Teleport to="body">
      <div
        v-if="flyout && flyoutItem?.children"
        class="flyout"
        :style="{ top: `${flyout.top}px` }"
        @mouseenter="cancelCloseFlyout"
        @mouseleave="scheduleCloseFlyout"
      >
        <div class="flyout-title">{{ flyoutItem.title }}</div>
        <template v-for="child in flyoutItem.children" :key="child.path">
          <a
            v-if="child.newTab"
            :href="child.path"
            target="_blank"
            rel="noopener"
            class="flyout-item"
            :title="`在新标签页打开${child.title}`"
            @click="flyout = null"
          >
            {{ child.title }}<AppIcon class="ext" name="arrow-right" :size="11" />
          </a>
          <RouterLink
            v-else
            :to="child.path"
            class="flyout-item"
            :class="{ active: route.path.startsWith(child.path) }"
            @click="flyout = null"
          >
            {{ child.title }}
          </RouterLink>
        </template>
      </div>
    </Teleport>

    <!-- ===== 主体 ===== -->
    <div class="main">
      <header class="topbar">
        <div class="topbar-left">
          <button
            class="icon-btn"
            :title="collapsed ? '展开菜单' : '收起菜单'"
            @click="collapsed = !collapsed"
          >
            <AppIcon name="menu" />
          </button>
          <!-- 面包屑：机构端路由是平铺的，层级从 menu.ts 的菜单树推导（buildBreadcrumb） -->
          <nav v-if="crumbs.length" class="crumb" aria-label="面包屑">
            <template v-for="(crumb, i) in crumbs" :key="`${crumb.label}-${i}`">
              <AppIcon v-if="i > 0" class="crumb-sep" name="chevron-right" :size="13" />
              <RouterLink v-if="crumb.to" class="crumb-link" :to="crumb.to">{{ crumb.label }}</RouterLink>
              <span v-else class="crumb-current" :title="crumb.label">{{ crumb.label }}</span>
            </template>
          </nav>
          <span v-if="isMockMode" class="mock-badge" title="当前使用 Mock 数据，环境变量可切换至真实后端">演示数据</span>
        </div>
        <div class="topbar-right">
          <!-- 全局年级 / 学科：选定后缓存到本地，题库管理、录题中心跟随 -->
          <ScopePicker />

          <!-- 全局搜索（FR-GN-026）：只读触发器，点击弹出搜索面板（文本 / 图片检索） -->
          <button class="global-search" type="button" title="全局搜索" @click="searchOpen = true">
            <AppIcon name="search" :size="15" />
            <span class="search-hint">搜索题目 / 试卷 / 资料</span>
          </button>

          <button class="icon-btn" title="消息中心" @click="openNotifications">
            <AppIcon name="bell" />
            <i v-if="unreadTotal > 0" class="badge">{{ unreadTotal > 99 ? '99+' : unreadTotal }}</i>
            <i v-else class="dot" />
          </button>
          <span class="v-divider" />

          <div ref="userRef" class="user-chip" @click="userMenuOpen = !userMenuOpen">
            <span
              class="avatar"
              :style="{ background: hueColor(auth.user?.avatarHue ?? 172) }"
            >
              {{ auth.user?.name?.charAt(0) ?? '师' }}
            </span>
            <span class="user-meta">
              <span class="user-name">{{ auth.user?.name ?? '未登录' }}</span>
              <span class="user-role">{{ auth.user?.roleName ?? '' }}</span>
            </span>
            <AppIcon name="chevron-down" :size="14" />

            <Transition name="fade">
              <div v-if="userMenuOpen" class="user-menu">
                <div class="user-menu-head">
                  <div class="org">{{ auth.user?.orgName }}</div>
                  <div class="account">{{ auth.user?.account }}</div>
                </div>

                <!-- 演示身份：用于演示不同角色的菜单与权限差异（真实场景由组织架构决定，
                     登录账号始终是 orgadmin，这里只是就地换视角，见 useDemoRole.ts） -->
                <div class="user-menu-group">
                  <span class="user-menu-label">演示身份</span>
                  <span class="user-menu-tip">切换后菜单与权限一起变，无需重新登录</span>
                </div>
                <button
                  v-for="row in identities"
                  :key="row.role"
                  class="user-menu-item identity-item"
                  :class="{ on: row.role === identity.role }"
                  @click="switchIdentity(row.role)"
                >
                  <AppIcon :name="row.role === identity.role ? 'check' : 'users'" :size="15" />
                  <span class="identity-text">
                    <b>{{ row.name }} · {{ row.roleName }}</b>
                    <em>{{ row.desc }}</em>
                  </span>
                </button>

                <div class="user-menu-divider" />
                <button class="user-menu-item" @click="router.push('/profile')">
                  <AppIcon name="users" :size="15" /> 个人中心
                </button>
                <button class="user-menu-item danger" @click="onLogout">
                  <AppIcon name="logout" :size="15" /> 退出登录
                </button>
              </div>
            </Transition>
          </div>
        </div>
      </header>

      <main class="content">
        <RouterView />
      </main>
    </div>

    <!-- 消息中心抽屉 -->
    <OrgNotificationCenter :open="notifyOpen" @close="notifyOpen = false" @refresh="refreshUnread" />

    <!-- 全局搜索面板（v-if 挂在关闭即卸载：关键词与结果不跨次保留） -->
    <GlobalSearchOverlay v-if="searchOpen" @close="searchOpen = false" />

    <!-- 全局 AI 问答（悬浮球可拖动，点击从右向左推出对话框） -->
    <AiAssistant />
  </div>
</template>

<style scoped>
.layout { display: flex; height: 100%; }

/* ---- 侧边栏 ---- */
.sidebar {
  width: 232px;
  flex-shrink: 0;
  background: #fff;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  transition: width 0.22s ease;
  overflow: hidden;
}
.layout.collapsed .sidebar { width: 64px; }

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 16px 16px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
.layout.collapsed .brand {
  justify-content: center;
  padding-inline: 0;
}
.brand-logo {
  width: 38px; height: 38px;
  border-radius: 11px;
  background: #fff;
  overflow: hidden;
  box-shadow: 0 6px 14px rgba(0, 180, 166, 0.3);
  flex-shrink: 0;
}
.brand-logo img { width: 100%; height: 100%; display: block; object-fit: contain; }
.brand-name { font-size: 15px; font-weight: 700; letter-spacing: 0.5px; }
.brand-sub { font-size: 11.5px; color: var(--sub); margin-top: 2px; }
.layout.collapsed .brand-text { display: none; }

.menu { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 10px 10px 14px; }
.menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 0 12px;
  height: 42px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: var(--ink-2);
  font-size: 14px;
  font-weight: 500;
  transition: background 0.15s, color 0.15s;
  white-space: nowrap;
}
.menu-item:hover { background: #f2f4fa; color: var(--ink); }
.menu-item.active {
  background: var(--brand-grad);
  color: #fff;
  box-shadow: 0 6px 14px rgba(0, 180, 166, 0.3);
}
.layout.collapsed .menu-item {
  justify-content: center;
  padding: 0;
}
.layout.collapsed .menu-label,
.layout.collapsed .chev { display: none; }

.group-head .chev { margin-left: auto; transition: transform 0.2s; }
.menu-group.open .chev { transform: rotate(180deg); }

/* 二级菜单：grid 高度动画实现平滑折叠/展开 */
.sub-items {
  display: grid;
  grid-template-rows: 1fr;
  transition: grid-template-rows 0.22s ease;
}
.sub-items.collapsed { grid-template-rows: 0fr; }
.sub-inner { overflow: hidden; min-height: 0; }
.layout.collapsed .sub-items { display: none; }
.menu-sub {
  display: block;
  padding: 0 12px 0 40px;
  line-height: 36px;
  font-size: 13.5px;
  color: var(--ink-2);
  border-radius: 9px;
  margin: 1px 0;
  transition: background 0.15s, color 0.15s;
}
.menu-sub:hover { background: #f2f4fa; color: var(--ink); }
.menu-sub.active { color: var(--brand); font-weight: 600; background: var(--brand-soft); }

/* 新标签页入口的外链箭头：inline-flex 跟随文字基线，不改变 .menu-sub 的 block 布局 */
.menu-sub .ext,
.flyout-item .ext {
  display: inline-flex;
  vertical-align: middle;
  margin-left: 4px;
  opacity: 0.55;
}
.menu-sub .ext { margin-top: -2px; }

.sidebar-foot {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--brand-soft);
  color: var(--brand);
  font-size: 11.5px;
  line-height: 1.5;
  white-space: nowrap;
  overflow: hidden;
}
.layout.collapsed .sidebar-foot {
  justify-content: center;
  padding-inline: 0;
}
.layout.collapsed .foot-text { display: none; }

/* 底部固定入口（回收站） */
.sidebar-extra {
  padding: 6px 10px 10px;
  border-top: 1px solid var(--border);
  
}

/* ---- 折叠态分组浮层 ---- */
.flyout {
  position: fixed;
  left: 70px;
  z-index: 80;
  min-width: 168px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--shadow-lg);
  padding: 6px;
}
.flyout-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--sub);
  padding: 8px 12px 6px;
}
.flyout-item {
  display: block;
  padding: 9px 12px;
  border-radius: 8px;
  font-size: 13.5px;
  color: var(--ink-2);
  transition: background 0.15s, color 0.15s;
}
.flyout-item:hover { background: #f2f4fa; color: var(--ink); }
.flyout-item.active { color: var(--brand); background: var(--brand-soft); font-weight: 600; }

/* ---- 主体 ---- */
.main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.topbar {
  height: 62px;
  flex-shrink: 0;
  background: #fff;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 26px;
}
.topbar-left { display: flex; align-items: center; gap: 12px; }
/* 面包屑：末项为当前页，不可点 */
.crumb { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 13.5px; }
.crumb-sep { color: #c3cad8; flex-shrink: 0; }
.crumb-link { color: var(--sub); font-weight: 500; transition: color 0.15s; }
.crumb-link:hover { color: var(--brand); }
.crumb-current {
  font-size: 14px;
  font-weight: 700;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mock-badge {
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--warn-soft);
  color: var(--warn);
  font-size: 12px;
  font-weight: 600;
  cursor: default;
}
.topbar-right { display: flex; align-items: center; gap: 14px; }

/* ---- 全局搜索（只读触发器，实际检索在 GlobalSearchOverlay 面板内） ---- */
.global-search {
  display: flex; align-items: center; gap: 7px;
  width: 200px; height: 36px;
  border: 1.5px solid var(--border); border-radius: 10px;
  background: #f7fafa; padding: 0 12px; color: var(--sub);
  transition: border-color 0.15s, background 0.15s;
}
.global-search:hover { border-color: var(--brand); background: #fff; }
.search-hint {
  flex: 1; min-width: 0;
  font-size: 13px; color: var(--sub); text-align: left;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

.icon-btn .badge {
  position: absolute;
  top: -5px; right: -7px;
  min-width: 18px; height: 18px;
  border-radius: 999px;
  background: var(--danger);
  color: #fff;
  font-size: 10.5px;
  font-weight: 700;
  font-style: normal;
  border: 1.5px solid #fff;
  display: flex; align-items: center; justify-content: center;
  padding: 0 4px;
}
.icon-btn {
  position: relative;
  width: 36px; height: 36px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: var(--ink-2);
  display: flex; align-items: center; justify-content: center;
  transition: background 0.15s;
  flex-shrink: 0;
}
.icon-btn:hover { background: #f2f4fa; }
.icon-btn .dot {
  position: absolute;
  top: 8px; right: 9px;
  width: 7px; height: 7px;
  border-radius: 50%;
  background: var(--danger);
  border: 1.5px solid #fff;
}
.v-divider { width: 1px; height: 22px; background: var(--border); }

.user-chip {
  position: relative;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 5px 10px 5px 6px;
  border-radius: 12px;
  cursor: pointer;
  transition: background 0.15s;
}
.user-chip:hover { background: #f2f4fa; }
.avatar {
  width: 34px; height: 34px;
  border-radius: 10px;
  color: #fff;
  font-size: 15px;
  font-weight: 700;
  display: flex; align-items: center; justify-content: center;
}
.user-meta { display: flex; flex-direction: column; line-height: 1.25; }
.user-name { font-size: 13.5px; font-weight: 600; }
.user-role { font-size: 11px; color: var(--sub); }

.user-menu {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: 268px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--shadow-lg);
  padding: 6px;
  z-index: 50;
}
.user-menu-head { padding: 10px 12px; border-bottom: 1px solid var(--border); margin-bottom: 6px; }
.user-menu-head .org { font-size: 13px; font-weight: 600; }
.user-menu-head .account { font-size: 12px; color: var(--sub); margin-top: 2px; }
.user-menu-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 9px 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--ink-2);
  font-size: 13.5px;
  text-align: left;
  transition: background 0.15s;
}
.user-menu-item:hover { background: #f2f4fa; }
.user-menu-item.danger { color: var(--danger); }
.user-menu-item.danger:hover { background: var(--danger-soft); }

/* 演示身份：三条选项比普通菜单项高（要放下说明文字），故下拉整体加宽 */
.user-menu-group { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px 4px; }
.user-menu-label { font-size: 12px; font-weight: 700; color: var(--ink); }
.user-menu-tip { font-size: 11.5px; color: var(--sub); }
.user-menu-divider { height: 1px; background: var(--border); margin: 6px 0; }
/* 说明文字折行会把图标挤歪，故与文字顶对齐 */
.identity-item { align-items: flex-start; }
.identity-item svg { margin-top: 2px; }
.identity-item.on { background: var(--brand-soft); color: var(--brand-deep); }
.identity-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.identity-text b { font-size: 12.5px; font-weight: 600; }
.identity-text em { font-size: 11.5px; font-style: normal; color: var(--sub); line-height: 1.5; }
.identity-item.on .identity-text em { color: var(--brand-deep); opacity: 0.75; }

.fade-enter-active, .fade-leave-active { transition: opacity 0.15s, transform 0.15s; }
.fade-enter-from, .fade-leave-to { opacity: 0; transform: translateY(-6px); }

.content {
  flex: 1;
  overflow-y: auto;
  padding: 22px 26px;
}
</style>
