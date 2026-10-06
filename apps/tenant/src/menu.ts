/**
 * 机构端菜单（对应 SRS 第 3.4 ~ 3.11 章模块划分）。
 * 机构端承担全部业务闭环（BR-002）。
 *
 * **菜单裁剪分两层，都在这份数据上标注**：
 * 1. `module` 对应角色权限矩阵（`/org/roles`）里的模块，没有「查看」权限的整个模块不显示；
 * 2. `op` 是**叶子额外要求的操作权限**，默认只要「查看」。审核中心要求「审核」——
 *    正是靠它，年级学科组长（有试卷管理、无审核权）不会看到试卷审核中心，
 *    否则两个页面同属 `paper` 模块，只能一起显示或一起藏。
 *
 * 分组不参与裁剪（它自己没有页面），由「子项是否全部被裁掉」决定去留 —— 所以分组上的
 * `module` 只是给分组自己也标一个归属，方便阅读，判断时以叶子为准。
 */
export interface MenuItem {
  path: string
  title: string
  icon?: string
  children?: MenuItem[]
  /** 所属权限模块（`PERM_MODULES[].key`），决定这个菜单是否可见 */
  module: string
  /** 该页额外要求的操作权限；不写则只要求模块内的「查看」 */
  op?: string
  /**
   * 在新标签页独立打开（全屏工作台式页面，不经 AppLayout 渲染）。
   * 侧边栏据此渲染 `<a target="_blank">` 而不是 `<RouterLink>`；对应路由也必须注册在
   * `/` 之外，否则会带着侧边栏渲染进当前页签，与新标签页的预期不符。
   */
  newTab?: boolean
}

export const menus: MenuItem[] = [
  { path: '/dashboard', title: '工作台', icon: 'dashboard', module: 'dashboard' },
  { path: '/file', title: '我的文件', icon: 'folder', module: 'file' },
  {
    path: '/question',
    title: '题目管理',
    icon: 'edit',
    module: 'question',
    children: [
      { path: '/question/bank', title: '题库管理', module: 'question' },
      { path: '/question/personal', title: '个人题库', module: 'question' },
      { path: '/question/create', title: '录题中心', module: 'question' },
      { path: '/question/photo', title: '图片识题', module: 'question' },
      // 审核中心比同组其它页多要一个「审核」权限：组长有题目管理但不管审核
      { path: '/question/review', title: '题目审核中心', module: 'question', op: '审核' },
    ],
  },
  {
    path: '/paper',
    title: '试卷管理',
    icon: 'file',
    module: 'paper',
    children: [
      { path: '/paper/list', title: '试卷库', module: 'paper' },
      // 紧邻试卷库：组卷是「新建」动作，与「看已有试卷」放在一起更顺手；新标签页独立全屏
      { path: '/paper/compose', title: '题库组卷', module: 'paper', newTab: true },
      // 协同组卷对参与组卷的老师同样可见（他要在里面干活），「发起任务」另由 op 控制
      { path: '/paper/collab', title: '协同组卷', module: 'paper' },
      // 智能组卷是独立整页（左知识点树 + 右三步 → 选存储位置 → 出卷进编辑），不再挂在试卷库头部弹窗里
      { path: '/paper/ai', title: '智能组卷', module: 'paper' },
      { path: '/paper/review', title: '试卷审核中心', module: 'paper', op: '审核' },
    ],
  },
  {
    path: '/teach',
    title: '备课中心',
    icon: 'layers',
    module: 'teach',
    children: [
      { path: '/teach/plan', title: '教案', module: 'teach' },
      { path: '/teach/guide', title: '学案', module: 'teach' },
      { path: '/teach/lecture', title: '讲义', module: 'teach' },
      { path: '/teach/courseware', title: '课件', module: 'teach' },
    ],
  },
  {
    path: '/exam',
    title: '考试阅卷',
    icon: 'clipboard',
    module: 'exam',
    children: [
      { path: '/exam/grading', title: '在线阅卷', module: 'exam' },
      { path: '/exam/analysis', title: '试卷分析', module: 'exam' },
      { path: '/exam/profile', title: '学情画像', module: 'exam' },
      { path: '/exam/mistake', title: '错题本', module: 'exam' },
    ],
  },
  {
    path: '/student',
    title: '班级学生',
    icon: 'users',
    module: 'student',
    children: [
      { path: '/student/class', title: '班级管理', module: 'student' },
      { path: '/student/archive', title: '学生档案', module: 'student' },
    ],
  },
  {
    path: '/ai-center',
    title: 'AI 能力中心',
    icon: 'cpu',
    module: 'ai-center',
    children: [
      { path: '/ai-center/workbench', title: 'AI 工作台', module: 'ai-center' },
      { path: '/ai-center/review', title: 'AI 内容复核', module: 'ai-center' },
    ],
  },
  { path: '/prep', title: '集体备课', icon: 'teamwork', module: 'prep' },
  { path: '/homework', title: '作业系统', icon: 'pen', module: 'homework' },
  {
    path: '/resource',
    title: '校本资源',
    icon: 'shield',
    module: 'resource',
    children: [
      { path: '/resource/library', title: '校本资源库', module: 'resource' },
      { path: '/resource/approval', title: '审批管理', module: 'resource' },
    ],
  },
  {
    path: '/material',
    title: '教辅管理',
    icon: 'book',
    module: 'material',
    children: [
      { path: '/material/list', title: '教辅资料', module: 'material' },
      { path: '/material/media/image', title: '图片', module: 'material' },
      { path: '/material/media/animation', title: '小程序动画', module: 'material' },
      { path: '/material/media/video', title: '视频', module: 'material' },
      { path: '/material/media/clip', title: '微课切片', module: 'material' },
    ],
  },
  {
    path: '/formula',
    title: '公式中心',
    icon: 'formula',
    module: 'formula',
    children: [
      { path: '/formula/standard', title: '标准公式库', module: 'formula' },
      { path: '/formula/mine', title: '我的公式', module: 'formula' },
      { path: '/formula/shared', title: '机构共享公式', module: 'formula' },
    ],
  },
  { path: '/prompt', title: '提示词模板', icon: 'sparkles', module: 'prompt' },
  { path: '/square', title: '知识广场', icon: 'star', module: 'square' },
  {
    path: '/org',
    title: '机构管理',
    icon: 'sliders',
    module: 'org',
    children: [
      { path: '/org/staff', title: '员工账号', module: 'org' },
      { path: '/org/roles', title: '角色权限', module: 'org' },
      { path: '/org/menus', title: '菜单权限', module: 'org' },
      { path: '/org/campus', title: '校区管理', module: 'org' },
      { path: '/org/logs', title: '日志管理', module: 'org' },
      { path: '/org/notify', title: '通知配置', module: 'org' },
      { path: '/org/settings', title: '机构设置', module: 'org' },
    ],
  },
]

/** 侧边栏底部固定入口（FR-GN-030：回收站位于机构端侧边栏底部） */
export const footerMenus: MenuItem[] = [{ path: '/recycle', title: '回收站', icon: 'download', module: 'recycle' }]

/** 展平所有叶子节点（含各级标题），供路由注册与标题反查 */
export function flattenMenus(items: MenuItem[]): MenuItem[] {
  return items.flatMap((item) => [item, ...(item.children ? flattenMenus(item.children) : [])])
}
