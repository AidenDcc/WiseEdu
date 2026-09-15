import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { getToken } from '@aiteach/shared'
import { flattenMenus, menus } from '@/menu'
import { useAuthStore } from '@/stores/auth'

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
    meta: { title: '登录' },
  },
  {
    path: '/',
    component: () => import('@/layouts/AppLayout.vue'),
    redirect: '/dashboard',
    children: [
      {
        path: 'dashboard',
        name: 'dashboard',
        component: () => import('@/views/DashboardView.vue'),
        meta: { title: '平台工作台' },
      },
      // 租户管理（已实现的真实页面）
      {
        path: 'tenant/apply',
        name: 'tenant-apply',
        component: () => import('@/views/tenant/ApplyListView.vue'),
        meta: { title: '入驻审核' },
      },
      {
        path: 'tenant/list',
        name: 'tenant-list',
        component: () => import('@/views/tenant/TenantListView.vue'),
        meta: { title: '机构列表' },
      },
      {
        path: 'tenant/list/:id',
        name: 'tenant-detail',
        component: () => import('@/views/tenant/TenantDetailView.vue'),
        meta: { title: '机构详情' },
      },
      {
        path: 'tenant/package',
        name: 'tenant-package',
        component: () => import('@/views/tenant/PackageListView.vue'),
        meta: { title: '套餐管理' },
      },
      // 全局字典
      {
        path: 'dict/base',
        name: 'dict-base',
        component: () => import('@/views/dict/DictBaseView.vue'),
        meta: { title: '基础字典' },
      },
      {
        path: 'dict/knowledge',
        name: 'dict-knowledge',
        component: () => import('@/views/dict/KnowledgeTreeView.vue'),
        meta: { title: '知识点树' },
      },
      {
        path: 'dict/textbook',
        name: 'dict-textbook',
        component: () => import('@/views/dict/TextbookView.vue'),
        meta: { title: '教材版本' },
      },
      // AI 服务配置
      {
        path: 'ai/models',
        name: 'ai-models',
        component: () => import('@/views/ai/ModelsView.vue'),
        meta: { title: '模型接入管理' },
      },
      {
        path: 'ai/agents',
        name: 'ai-agents',
        component: () => import('@/views/ai/AgentsView.vue'),
        meta: { title: '多智能体编排' },
      },
      {
        path: 'ai/prompts',
        name: 'ai-prompts',
        component: () => import('@/views/ai/PromptsView.vue'),
        meta: { title: '全局 Prompt 模板' },
      },
      // 数据审计
      {
        path: 'audit/ai-logs',
        name: 'audit-ai-logs',
        component: () => import('@/views/audit/AiLogsView.vue'),
        meta: { title: 'AI 调用日志' },
      },
      {
        path: 'audit/resources',
        name: 'audit-resources',
        component: () => import('@/views/audit/ResourcesView.vue'),
        meta: { title: '平台资源总库' },
      },
      {
        path: 'audit/logs',
        name: 'audit-logs',
        component: () => import('@/views/audit/AuditLogsView.vue'),
        meta: { title: '日志审计' },
      },
      // 系统管理
      {
        path: 'system/accounts',
        name: 'system-accounts',
        component: () => import('@/views/system/AccountsView.vue'),
        meta: { title: '管理员账号' },
      },
      {
        path: 'system/menus',
        name: 'system-menus',
        component: () => import('@/views/system/TenantMenusView.vue'),
        meta: { title: '机构菜单权限' },
      },
      // 其余菜单统一注册为「开发中」占位页
      ...flattenMenus(menus)
        .filter(
          (item) =>
            item.path !== '/dashboard' &&
            !item.path.startsWith('/tenant/') &&
            !item.path.startsWith('/dict/') &&
            !item.path.startsWith('/ai/') &&
            !item.path.startsWith('/audit/') &&
            !item.path.startsWith('/system/'),
        )
        .map((item) => ({
          path: item.path.slice(1),
          name: item.path,
          component: () => import('@/views/DevelopingView.vue'),
          meta: { title: item.title },
        })),
      { path: ':pathMatch(.*)*', component: () => import('@/views/DevelopingView.vue'), meta: { title: '页面' } },
    ],
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach((to) => {
  const auth = useAuthStore()
  if (to.path !== '/login' && !getToken()) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }
  if (to.path === '/login' && getToken()) {
    return { path: '/' }
  }
  // 刷新后恢复用户信息
  if (!auth.user) {
    auth.restore()
  }
  document.title = `${to.meta.title ?? ''} · 超级管理端 · AI教学云平台`
  return true
})

export default router
