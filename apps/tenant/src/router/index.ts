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
  /* 题库组卷：独立全屏工作台，侧边栏以新标签页打开它。
     必须挂在 `/` 之外 —— 侧边栏在 AppLayout 里是无条件渲染的，放进 `/` 的 children
     就一定会带上侧边栏，而这里要的是「自带顶栏、无侧边栏」的独立页面。 */
  {
    path: '/paper/compose',
    name: 'paper-compose',
    component: () => import('@/views/paper/compose/ComposeView.vue'),
    meta: { title: '题库组卷' },
  },
  /* 试卷编辑：同样要「无侧边栏全屏」，理由与题库组卷一致（见上）。
     从「生成试卷」保存后进入，或由试卷库「编辑」进入，`?id=` 指定试卷。 */
  {
    path: '/paper/edit',
    name: 'paper-edit',
    component: () => import('@/views/paper/PaperEditView.vue'),
    meta: { title: '试卷编辑' },
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
        meta: { title: '工作台' },
      },
      /* ===== 题目管理（FR-TM） ===== */
      {
        path: 'question/bank',
        name: 'question-bank',
        component: () => import('@/views/question/BankView.vue'),
        meta: { title: '题库管理' },
      },
      {
        path: 'question/personal',
        name: 'question-personal',
        component: () => import('@/views/question/PersonalBankView.vue'),
        meta: { title: '个人题库' },
      },
      {
        path: 'question/create',
        name: 'question-create',
        component: () => import('@/views/question/CreateView.vue'),
        meta: { title: '录题中心' },
      },
      /* 旧地址兼容（书签 / 演示脚本 / 旧文档）：手动录题那条直链常带 ?id=（编辑既有题目），
         AI 出题那条常带 ?variantOf=，故用函数式 redirect 原样带上 query —— 字符串写法会丢掉它们。 */
      {
        path: 'question/manual',
        redirect: (to) => ({ path: '/question/create', query: { ...to.query } }),
      },
      {
        path: 'question/ai',
        redirect: (to) => ({ path: '/question/create', query: { ...to.query, mode: 'ai' } }),
      },
      {
        path: 'question/photo',
        name: 'question-photo',
        component: () => import('@/views/question/PhotoView.vue'),
        meta: { title: '图片识题' },
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
      /* 协同组卷的任务工作台：`?id=` 指定任务。处理人在此选题入卷、看整卷、看进度与版本。 */
      {
        path: 'paper/collab/task',
        name: 'paper-collab-task',
        component: () => import('@/views/paper/CollabTaskView.vue'),
        meta: { title: '协同组卷任务' },
      },
      {
        path: 'paper/review',
        name: 'paper-review',
        component: () => import('@/views/paper/ReviewView.vue'),
        meta: { title: '试卷审核中心' },
      },
      /* ===== 备课中心：教案 / 学案 / 讲义 / 课件 ===== */
      {
        path: 'teach/plan',
        name: 'teach-plan',
        component: () => import('@/views/teach/PlanView.vue'),
        meta: { title: '教案' },
      },
      {
        path: 'teach/guide',
        name: 'teach-guide',
        component: () => import('@/views/teach/GuideView.vue'),
        meta: { title: '学案' },
      },
      {
        path: 'teach/lecture',
        name: 'teach-lecture',
        component: () => import('@/views/teach/LectureView.vue'),
        meta: { title: '讲义' },
      },
      {
        path: 'teach/courseware',
        name: 'teach-courseware',
        component: () => import('@/views/teach/CoursewareView.vue'),
        meta: { title: '课件' },
      },
      /* ===== 考试阅卷：在线阅卷 / 试卷分析 / 错题本 ===== */
      {
        path: 'exam/grading',
        name: 'exam-grading',
        component: () => import('@/views/exam/GradingView.vue'),
        meta: { title: '在线阅卷' },
      },
      {
        path: 'exam/analysis',
        name: 'exam-analysis',
        component: () => import('@/views/exam/AnalysisView.vue'),
        meta: { title: '试卷分析' },
      },
      {
        path: 'exam/mistake',
        name: 'exam-mistake',
        component: () => import('@/views/exam/MistakeView.vue'),
        meta: { title: '错题本' },
      },
      /* ===== AI 学情画像（T-07-08 ~ 10） ===== */
      {
        path: 'exam/profile',
        name: 'exam-profile',
        component: () => import('@/views/exam/ProfileView.vue'),
        meta: { title: '学情画像' },
      },
      /* ===== 班级与学生管理（T-08） ===== */
      {
        path: 'student/class',
        name: 'student-class',
        component: () => import('@/views/student/ClassView.vue'),
        meta: { title: '班级管理' },
      },
      {
        path: 'student/archive',
        name: 'student-archive',
        component: () => import('@/views/student/StudentView.vue'),
        meta: { title: '学生档案' },
      },
      /* ===== AI 能力中心（T-10） ===== */
      {
        path: 'ai-center/workbench',
        name: 'ai-workbench',
        component: () => import('@/views/ai/WorkbenchView.vue'),
        meta: { title: 'AI 工作台' },
      },
      {
        path: 'ai-center/review',
        name: 'ai-review',
        component: () => import('@/views/ai/ReviewView.vue'),
        meta: { title: 'AI 内容复核' },
      },
      /* ===== 集体备课（协同教研） ===== */
      {
        path: 'prep',
        name: 'prep',
        component: () => import('@/views/prep/PrepView.vue'),
        meta: { title: '集体备课' },
      },
      /* ===== 校本资源：资源库 / 审批管理（同一组件两个 Tab） ===== */
      {
        path: 'resource/library',
        name: 'resource-library',
        component: () => import('@/views/resource/ResourceView.vue'),
        props: { tab: 'library' },
        meta: { title: '校本资源库' },
      },
      {
        path: 'resource/approval',
        name: 'resource-approval',
        component: () => import('@/views/resource/ResourceView.vue'),
        props: { tab: 'approval' },
        meta: { title: '审批管理' },
      },
      /* ===== 作业系统 ===== */
      {
        path: 'homework',
        name: 'homework',
        component: () => import('@/views/homework/HomeworkView.vue'),
        meta: { title: '作业系统' },
      },
      /* ===== 教辅管理（FR-JC） ===== */
      {
        path: 'material/list',
        name: 'material-list',
        component: () => import('@/views/material/MaterialView.vue'),
        meta: { title: '教辅资料' },
      },
      {
        path: 'material/media/image',
        name: 'material-media-image',
        component: () => import('@/views/material/MediaKindView.vue'),
        props: { kind: 'image' },
        meta: { title: '图片' },
      },
      {
        path: 'material/media/animation',
        name: 'material-media-animation',
        component: () => import('@/views/material/MediaKindView.vue'),
        props: { kind: 'animation' },
        meta: { title: '小程序动画' },
      },
      {
        path: 'material/media/video',
        name: 'material-media-video',
        component: () => import('@/views/material/MediaKindView.vue'),
        props: { kind: 'video' },
        meta: { title: '视频' },
      },
      {
        path: 'material/media/clip',
        name: 'material-media-clip',
        component: () => import('@/views/material/ClipView.vue'),
        meta: { title: '微课切片' },
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
      /* ===== 机构系统设置（T-11） ===== */
      {
        path: 'org/settings',
        name: 'org-settings',
        component: () => import('@/views/org/SettingsView.vue'),
        meta: { title: '机构设置' },
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
