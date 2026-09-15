/**
 * 机构端菜单（对应 SRS 第 3.4 ~ 3.11 章模块划分）。
 * 机构端承担全部业务闭环（BR-002）；题目/试卷审核中心仅审核员与机管可见（正式版按角色裁剪）。
 */
export interface MenuItem {
  path: string
  title: string
  icon?: string
  children?: MenuItem[]
}

export const menus: MenuItem[] = [
  { path: '/dashboard', title: '机构工作台', icon: 'dashboard' },
  {
    path: '/question',
    title: '题目管理',
    icon: 'edit',
    children: [
      { path: '/question/bank', title: '题库管理' },
      { path: '/question/manual', title: '手动录题' },
      { path: '/question/ai', title: 'AI 智能出题' },
      { path: '/question/photo', title: 'AI 拍照识题' },
      { path: '/question/review', title: '题目审核中心' },
    ],
  },
  {
    path: '/paper',
    title: '试卷管理',
    icon: 'file',
    children: [
      { path: '/paper/list', title: '试卷库' },
      { path: '/paper/collab', title: '协同组卷' },
      { path: '/paper/review', title: '试卷审核中心' },
    ],
  },
  {
    path: '/material',
    title: '教辅管理',
    icon: 'book',
    children: [
      { path: '/material/list', title: '教辅资料' },
      { path: '/material/media', title: '多媒体资源' },
    ],
  },
  { path: '/file', title: '我的文件', icon: 'folder' },
  {
    path: '/formula',
    title: '公式中心',
    icon: 'formula',
    children: [
      { path: '/formula/standard', title: '标准公式库' },
      { path: '/formula/mine', title: '我的公式' },
      { path: '/formula/shared', title: '机构共享公式' },
    ],
  },
  { path: '/prompt', title: '提示词模板', icon: 'sparkles' },
  { path: '/square', title: '知识广场', icon: 'star' },
  {
    path: '/org',
    title: '机构管理',
    icon: 'sliders',
    children: [
      { path: '/org/staff', title: '员工账号' },
      { path: '/org/roles', title: '角色权限' },
      { path: '/org/menus', title: '菜单权限' },
      { path: '/org/campus', title: '校区管理' },
      { path: '/org/logs', title: '日志管理' },
      { path: '/org/notify', title: '通知配置' },
    ],
  },
]

/** 侧边栏底部固定入口（FR-GN-030：回收站位于机构端侧边栏底部） */
export const footerMenus: MenuItem[] = [{ path: '/recycle', title: '回收站', icon: 'download' }]

/** 展平所有叶子节点（含各级标题），供路由注册与标题反查 */
export function flattenMenus(items: MenuItem[]): MenuItem[] {
  return items.flatMap((item) => [item, ...(item.children ? flattenMenus(item.children) : [])])
}
