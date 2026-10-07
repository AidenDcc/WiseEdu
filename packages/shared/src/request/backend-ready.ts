/**
 * 后端已实现接口清单。
 *
 * 教学云后端的接口是分批落地的（Wave 1 只完成了登录会话、平台端概览、机构端题库分类），
 * 而前端有近 300 个 Mock 路由。若「打开后端开关」等于「所有请求都打后端」，未实现的路由
 * 会全部 404，页面反而比纯 Mock 时更不可用。因此这里显式登记后端**真正实现**的路径，
 * 只有登记的接口才可能走真实后端。
 *
 * 为什么是代码常量而不是环境变量：
 *   「后端实现了哪些接口」是代码库的事实，不是部署环境的差异。放在这里，补齐一个后端
 *   接口时只改一处；admin 与 tenant 两端共用同一份进度，不会出现「一端登记了、另一端忘了」。
 *   与之配套的开关只有 VITE_USE_MOCK 一个（见 mock-switch.ts）。
 *
 * 匹配规则：**前缀匹配**（startsWith）。条目请写到足够精确的层级 —— 例如
 *   '/tenant/categories' 会覆盖 '/tenant/categories/save' 与 '/tenant/categories/delete'，
 *   但不会命中 '/tenant/students'。
 *
 * 维护方式：后端新增接口后在此登记，再把 VITE_USE_MOCK 置为 'false'，该接口即走真实后端；
 *   未登记的接口一律回退 Mock，不会因为后端还没实现而报错。
 */
export const BACKEND_READY_PATHS = [
  /* 登录与会话（jeecg-system-biz / EduAuthController） */
  '/auth/login',
  '/auth/me',
  '/auth/logout',
  /* 平台端概览（jeecg-module-edu-platform / AdminDashboardController） */
  '/admin/dashboard/overview',
  /* 机构端题库分类（jeecg-module-edu-tenant / EduQuestionCategoryController） */
  '/tenant/categories',
] as const

/** 统一成不带前导斜杠的形式再比较，调用方传 '/auth/me' 或 'auth/me' 都能命中 */
function normalizePath(url: string): string {
  return url.startsWith('/') ? url.slice(1) : url
}

/** 该请求地址是否已有后端实现 */
export function isBackendReady(url: string): boolean {
  const path = normalizePath(url)
  return BACKEND_READY_PATHS.some((prefix) => path.startsWith(normalizePath(prefix)))
}
