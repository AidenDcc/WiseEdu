/**
 * 超级管理端菜单（对应 SRS 第 3.2 章 FR-PT 模块划分）。
 * 平台铁律（BR-001）：本端仅全局配置与只读审计，无任何业务操作入口。
 */
export interface MenuItem {
  path: string
  title: string
  icon?: string
  children?: MenuItem[]
}

export const menus: MenuItem[] = [
  { path: '/dashboard', title: '平台工作台', icon: 'dashboard' },
  {
    path: '/tenant',
    title: '租户管理',
    icon: 'building',
    children: [
      { path: '/tenant/apply', title: '入驻审核' },
      { path: '/tenant/list', title: '机构列表' },
      { path: '/tenant/package', title: '套餐管理' },
    ],
  },
  {
    path: '/dict',
    title: '全局字典',
    icon: 'book',
    children: [
      { path: '/dict/base', title: '基础字典' },
      { path: '/dict/knowledge', title: '知识点树' },
      { path: '/dict/textbook', title: '教材版本' },
    ],
  },
  {
    path: '/ai',
    title: 'AI 服务配置',
    icon: 'cpu',
    children: [
      { path: '/ai/models', title: '模型接入管理' },
      { path: '/ai/agents', title: '多智能体编排' },
      { path: '/ai/prompts', title: '全局 Prompt 模板' },
    ],
  },
  {
    path: '/audit',
    title: '数据审计',
    icon: 'chart',
    children: [
      { path: '/audit/ai-logs', title: 'AI 调用日志' },
      { path: '/audit/resources', title: '平台资源总库' },
      { path: '/audit/logs', title: '日志审计' },
    ],
  },
  {
    path: '/system',
    title: '系统管理',
    icon: 'sliders',
    children: [
      { path: '/system/accounts', title: '管理员账号' },
      { path: '/system/menus', title: '机构菜单权限' },
    ],
  },
]

/** 展平所有叶子节点（含各级标题），供路由注册与标题反查 */
export function flattenMenus(items: MenuItem[]): MenuItem[] {
  return items.flatMap((item) => [item, ...(item.children ? flattenMenus(item.children) : [])])
}
