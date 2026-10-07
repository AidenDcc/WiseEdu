import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { watch } from 'vue'
import { getToken, showToast } from '@aiteach/shared'
import { useAuthStore } from '@/stores/auth'
import { usePermission } from '@/composables/usePermission'
import { firstAllowedPath, pathVisible } from '@/composables/useVisibleMenus'

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
     `?id=` 指定试卷。各处入口一律以**新标签页**打开它（见 utils/paper-edit.ts）：
     它是个工作台页，用户从列表点进来改完一份还要回去接着处理下一份，
     在当前页签里跳走等于把来路弄丢。所以它虽然也在 `/` 之外，但不是从侧边栏进的。 */
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
      {
        path: 'paper/ai',
        name: 'paper-ai',
        component: () => import('@/views/paper/AiComposeView.vue'),
        meta: { title: '智能组卷' },
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

/* 权限判据与「第一个可进的页」都取自 composables，与侧边栏共用同一套实现 ——
   守卫自己写一份过滤逻辑，迟早会和侧边栏对不上（一边能进、一边没入口，或反之）。 */
const { can, role } = usePermission()

/**
 * 回头校验当前页 —— 守卫放行之后、权限信息到齐时才跑得动的检查。
 *
 * 为什么必须补这一道：首次进入（含刷新深链）时 `beforeEach` 一定跑在权限接口返回之前，
 * 那一刻 `can()` 按规则一律放行（见 usePermission 头注释），否则整个应用白屏。
 * 于是「管理员把老师的试卷管理关掉，老师刷新页面照样进得去」这种漏网就全落在这里。
 *
 * 触发时机是 `role` 变化，它同时覆盖三件事：
 * 1. 矩阵首次加载完成（null → 某条角色）；
 * 2. 保存角色权限后 `refresh()`（角色对象被整体替换）；
 * 3. **切换演示身份**（`permRoleId` 换了 → 指向另一条角色）。
 * 监听 `loaded` 只能覆盖前两件，切换身份后当前页会停在无权页面不动。
 */
async function revalidateRoute(): Promise<void> {
  const current = router.currentRoute.value
  if (!current.name || current.path === '/login') return
  if (pathVisible(can, current.path)) return

  const fallback = firstAllowedPath()
  /* 一个页面都不可见时不重定向：没有落点就原地留着，总好过跳到空页面上白屏 */
  if (!fallback || fallback === current.path) return
  await router.replace(fallback)
  showToast('当前身份无权访问该页面，已返回可访问的第一个页面', 'error')
}

watch(role, () => void revalidateRoute(), { flush: 'post' })

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
  /* 模块权限：矩阵未加载完时 `pathVisible` 一律放行（放行规则 1），到齐后由上面的
     `revalidateRoute` 回头补校验。落点用 `firstAllowedPath()` 而不是写死 /dashboard ——
     写死的目标自己也可能没权限，那就是跳转死循环。 */
  if (!pathVisible(can, to.path)) {
    const fallback = firstAllowedPath()
    if (fallback && fallback !== to.path) return { path: fallback, replace: true }
  }
  document.title = `${to.meta.title ?? ''} · 机构端 · AI教学云平台`
  return true
})

export default router
