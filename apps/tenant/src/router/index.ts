import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { getToken } from '@aiteach/shared'
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
        meta: { title: '机构工作台' },
      },
      /* ===== 题目管理（FR-TM） ===== */
      {
        path: 'question/bank',
        name: 'question-bank',
        component: () => import('@/views/question/BankView.vue'),
        meta: { title: '题库管理' },
      },
      {
        path: 'question/manual',
        name: 'question-manual',
        component: () => import('@/views/question/ManualEditView.vue'),
        meta: { title: '手动录题' },
      },
      {
        path: 'question/ai',
        name: 'question-ai',
        component: () => import('@/views/question/AiGenerateView.vue'),
        meta: { title: 'AI 智能出题' },
      },
      {
        path: 'question/photo',
        name: 'question-photo',
        component: () => import('@/views/question/PhotoView.vue'),
        meta: { title: 'AI 拍照识题' },
      },
      {
        path: 'question/review',
        name: 'question-review',
        component: () => import('@/views/question/ReviewView.vue'),
        meta: { title: '题目审核中心' },
      },
      /* ===== 试卷管理（FR-PP） ===== */
      {
        path: 'paper/list',
        name: 'paper-list',
        component: () => import('@/views/paper/ListView.vue'),
        meta: { title: '试卷库' },
      },
      {
        path: 'paper/collab',
        name: 'paper-collab',
        component: () => import('@/views/paper/CollabView.vue'),
        meta: { title: '协同组卷' },
      },
      {
        path: 'paper/review',
        name: 'paper-review',
        component: () => import('@/views/paper/ReviewView.vue'),
        meta: { title: '试卷审核中心' },
      },
      /* ===== 教辅管理（FR-JC） ===== */
      {
        path: 'material/list',
        name: 'material-list',
        component: () => import('@/views/material/MaterialView.vue'),
        meta: { title: '教辅资料' },
      },
      {
        path: 'material/media',
        name: 'material-media',
        component: () => import('@/views/material/MediaView.vue'),
        meta: { title: '多媒体资源' },
      },
      /* ===== 我的文件（FR-FL） ===== */
      {
        path: 'file',
        name: 'file',
        component: () => import('@/views/file/FileView.vue'),
        meta: { title: '我的文件' },
      },
      /* ===== 公式中心（FR-FX） ===== */
      {
        path: 'formula/standard',
        name: 'formula-standard',
        component: () => import('@/views/formula/StandardView.vue'),
        meta: { title: '标准公式库' },
      },
      {
        path: 'formula/mine',
        name: 'formula-mine',
        component: () => import('@/views/formula/MineView.vue'),
        meta: { title: '我的公式' },
      },
      {
        path: 'formula/shared',
        name: 'formula-shared',
        component: () => import('@/views/formula/SharedView.vue'),
        meta: { title: '机构共享公式' },
      },
      /* ===== 提示词 / 广场 ===== */
      {
        path: 'prompt',
        name: 'prompt',
        component: () => import('@/views/prompt/PromptView.vue'),
        meta: { title: '提示词模板' },
      },
      {
        path: 'square',
        name: 'square',
        component: () => import('@/views/square/SquareView.vue'),
        meta: { title: '知识广场' },
      },
      /* ===== 机构管理（FR-OS） ===== */
      {
        path: 'org/staff',
        name: 'org-staff',
        component: () => import('@/views/org/StaffView.vue'),
        meta: { title: '员工账号' },
      },
      {
        path: 'org/roles',
        name: 'org-roles',
        component: () => import('@/views/org/RolesView.vue'),
        meta: { title: '角色权限' },
      },
      {
        path: 'org/menus',
        name: 'org-menus',
        component: () => import('@/views/org/MenusView.vue'),
        meta: { title: '菜单权限' },
      },
      {
        path: 'org/campus',
        name: 'org-campus',
        component: () => import('@/views/org/CampusView.vue'),
        meta: { title: '校区管理' },
      },
      {
        path: 'org/logs',
        name: 'org-logs',
        component: () => import('@/views/org/LogsView.vue'),
        meta: { title: '日志管理' },
      },
      {
        path: 'org/notify',
        name: 'org-notify',
        component: () => import('@/views/org/NotifyView.vue'),
        meta: { title: '通知配置' },
      },
      /* ===== 回收站 / 个人中心 ===== */
      {
        path: 'recycle',
        name: 'recycle',
        component: () => import('@/views/recycle/RecycleView.vue'),
        meta: { title: '回收站' },
      },
      {
        path: 'profile',
        name: 'profile',
        component: () => import('@/views/ProfileView.vue'),
        meta: { title: '个人中心' },
      },
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
  document.title = `${to.meta.title ?? ''} · 机构端 · AI教学云平台`
  return true
})

export default router
