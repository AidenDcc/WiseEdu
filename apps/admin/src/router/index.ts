import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { clearSession, hasValidSession, isSessionExpired } from '@aiteach/shared'
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
        meta: { title: '机构入驻审核' },
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
      {
        path: 'dict/exam-type',
        name: 'dict-exam-type',
        component: () => import('@/views/dict/ExamTypeTreeView.vue'),
        meta: { title: '考试类型' },
      },
      // 内容运营（P-03）
      {
        path: 'content/questions',
        name: 'content-questions',
        component: () => import('@/views/content/QuestionBankView.vue'),
        meta: { title: '公共题库' },
      },
      {
        path: 'content/papers',
        name: 'content-papers',
        component: () => import('@/views/content/PaperBankView.vue'),
        meta: { title: '公共试卷库' },
      },
      {
        path: 'content/distribution',
        name: 'content-distribution',
        component: () => import('@/views/content/DistributionView.vue'),
        meta: { title: '内容分发' },
      },
      {
        path: 'content/compliance',
        name: 'content-compliance',
        component: () => import('@/views/content/ComplianceView.vue'),
        meta: { title: '内容合规抽检' },
      },
      {
        path: 'content/feedback',
        name: 'content-feedback',
        component: () => import('@/views/content/FeedbackView.vue'),
        meta: { title: '内容问题反馈' },
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
      {
        path: 'ai/safety',
        name: 'ai-safety',
        component: () => import('@/views/ai/SafetyView.vue'),
        meta: { title: 'AI 安全治理' },
      },
      {
        path: 'ai/billing',
        name: 'ai-billing',
        component: () => import('@/views/ai/BillingView.vue'),
        meta: { title: 'AI 计费与能力开关' },
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
      {
        path: 'audit/health',
        name: 'audit-health',
        component: () => import('@/views/system/HealthView.vue'),
        meta: { title: '服务健康监控' },
      },
      // 系统管理
      {
        path: 'system/accounts',
        name: 'system-accounts',
        component: () => import('@/views/system/AccountsView.vue'),
        meta: { title: '管理员账号' },
      },
      {
        path: 'system/roles',
        name: 'system-roles',
        component: () => import('@/views/system/RolesView.vue'),
        meta: { title: '角色权限' },
      },
      /* 管理端菜单（驱动左侧边栏），路径 /system/menus；机构端菜单可见性在 /system/tenant-menus */
      {
        path: 'system/menus',
        name: 'system-menus',
        component: () => import('@/views/system/MenuManageView.vue'),
        meta: { title: '菜单管理' },
      },
      {
        path: 'system/tenant-menus',
        name: 'system-tenant-menus',
        component: () => import('@/views/system/TenantMenusView.vue'),
        meta: { title: '机构菜单权限' },
      },
      {
        path: 'system/dict',
        name: 'system-dict',
        component: () => import('@/views/system/SystemDictView.vue'),
        meta: { title: '系统数据字典' },
      },
      {
        path: 'system/params',
        name: 'system-params',
        component: () => import('@/views/system/ParamsView.vue'),
        meta: { title: '系统参数' },
      },
      {
        path: 'system/messages',
        name: 'system-messages',
        component: () => import('@/views/system/MessageTemplateView.vue'),
        meta: { title: '消息模板' },
      },
      {
        path: 'system/storage',
        name: 'system-storage',
        component: () => import('@/views/system/StorageView.vue'),
        meta: { title: '存储与备份' },
      },
      /* 个人中心：刻意不进 menu.ts —— 它不是业务模块，入口在顶栏头像下拉里
         （与机构端 /profile 同一套做法）。面包屑靠 meta.title 兜底。 */
      {
        path: 'profile',
        name: 'profile',
        component: () => import('@/views/ProfileView.vue'),
        meta: { title: '个人中心' },
      },
      /* 菜单数据已移到「系统管理 → 菜单管理」维护（见 useAdminMenus），路由不再由菜单树生成 ——
         菜单路径是运行时数据，编译期拿不到。上面已显式注册全部内置页面；「菜单管理」里新增的
         自定义菜单路径会落到下面这条兜底路由，渲染为「开发中」占位页。 */
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

  /* 会话过期但 token 还在（token 在 localStorage 里不会自己消失）：先清干净再说去向。
     不清的话下面第一个分支按「有 token」把人放行、第二个分支又把进登录页的人送回首页，
     两个分支来回弹。清掉后请求层看到的是「未登录」，不会再弹「登录已失效」。 */
  if (isSessionExpired()) clearSession()

  const authed = hasValidSession()
  if (to.path !== '/login' && !authed) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }
  if (to.path === '/login' && authed) {
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
