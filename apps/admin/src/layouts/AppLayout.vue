<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AppIcon, showToast, hueColor, resolveApiMode, getAppConfig } from '@aiteach/shared'
import type { MenuItem } from '@/menu'
import { menus } from '@/menu'
import { useAuthStore } from '@/stores/auth'
import NotificationCenter from '@/components/NotificationCenter.vue'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

/* ===== 侧边栏折叠（状态记忆） ===== */
const COLLAPSE_KEY = `aiteach:${getAppConfig().appName}:sidebar-collapsed`
const collapsed = ref(localStorage.getItem(COLLAPSE_KEY) === '1')
watch(collapsed, (value) => {
  localStorage.setItem(COLLAPSE_KEY, value ? '1' : '0')
  if (!value) flyout.value = null
})

/** 分组展开状态：默认展开包含当前路由的分组 */
const expandedKeys = ref<string[]>([])
for (const item of menus) {
  if (item.children?.some((child) => route.path.startsWith(child.path))) {
    expandedKeys.value.push(item.path)
  }
}

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

const flyoutItem = computed(() =>
  menus.find((item) => item.path === flyout.value?.path),
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

const pageTitle = computed(() => (route.meta.title as string) ?? '')
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

function onPendingFeature(name: string) {
  showToast(`「${name}」功能正在开发中，敬请期待`, 'info')
}

/* ===== 消息中心 ===== */
const notifyOpen = ref(false)
const unreadCount = ref(0)

async function onLogout() {
  if (!window.confirm('确定退出登录？')) return
  await auth.logout()
  showToast('已退出登录', 'success')
  router.push('/login')
}
</script>

<template>
  <div class="layout" :class="{ collapsed }">
    <!-- ===== 侧边栏 ===== -->
    <aside class="sidebar">
      <div class="brand" :title="collapsed ? 'AI教学云平台' : undefined">
        <div class="brand-logo">🛡️</div>
        <div class="brand-text">
          <div class="brand-name">AI教学云平台</div>
          <div class="brand-sub">超级管理端</div>
        </div>
      </div>

      <nav class="menu">
        <template v-for="item in menus" :key="item.path">
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
                <RouterLink
                  v-for="child in item.children"
                  :key="child.path"
                  :to="child.path"
                  class="menu-sub"
                  :class="{ active: route.path.startsWith(child.path) }"
                >
                  {{ child.title }}
                </RouterLink>
              </div>
            </div>
          </div>
        </template>
      </nav>

      
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
        <RouterLink
          v-for="child in flyoutItem.children"
          :key="child.path"
          :to="child.path"
          class="flyout-item"
          :class="{ active: route.path.startsWith(child.path) }"
          @click="flyout = null"
        >
          {{ child.title }}
        </RouterLink>
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
          <h1 class="page-title">{{ pageTitle }}</h1>
          <span v-if="isMockMode" class="mock-badge" title="当前使用 Mock 数据，环境变量可切换至真实后端">演示数据</span>
        </div>
        <div class="topbar-right">
          <button class="icon-btn" title="消息中心" @click="notifyOpen = true">
            <AppIcon name="bell" />
            <i v-if="unreadCount > 0" class="dot" />
            <span v-if="unreadCount > 0" class="badge">{{ unreadCount > 99 ? '99+' : unreadCount }}</span>
          </button>
          <NotificationCenter :open="notifyOpen" @close="notifyOpen = false" @unread="unreadCount = $event" />
          <span class="v-divider" />

          <div ref="userRef" class="user-chip" @click="userMenuOpen = !userMenuOpen">
            <span
              class="avatar"
              :style="{ background: hueColor(auth.user?.avatarHue ?? 232) }"
            >
              {{ auth.user?.name?.charAt(0) ?? '管' }}
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
                <button class="user-menu-item" @click="onPendingFeature('个人中心')">
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
  background: var(--brand-grad);
  display: flex; align-items: center; justify-content: center;
  font-size: 19px;
  box-shadow: 0 6px 14px rgba(79, 110, 247, 0.3);
  flex-shrink: 0;
}
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
  box-shadow: 0 6px 14px rgba(79, 110, 247, 0.3);
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
.page-title { font-size: 17px; font-weight: 700; }
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
.icon-btn .badge {
  position: absolute;
  top: 2px; right: -2px;
  min-width: 16px;
  height: 16px;
  border-radius: 999px;
  background: var(--danger);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  line-height: 16px;
  padding: 0 4px;
  border: 1.5px solid #fff;
  font-variant-numeric: tabular-nums;
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
  width: 200px;
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

.fade-enter-active, .fade-leave-active { transition: opacity 0.15s, transform 0.15s; }
.fade-enter-from, .fade-leave-to { opacity: 0; transform: translateY(-6px); }

.content {
  flex: 1;
  overflow-y: auto;
  padding: 22px 26px;
}
</style>
