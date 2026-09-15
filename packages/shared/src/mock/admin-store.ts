/**
 * 平台端其余模块 Mock 仓库：全局字典 / AI 服务配置 / 数据审计 / 系统管理 / 消息中心。
 * 与 tenant-store 相同：模块级可变状态，操作在会话内保持。
 */
import type {
  AdminAccount,
  AgentCheckItem,
  AgentConfig,
  AiCallLog,
  AiModel,
  AiModelType,
  AuditRecord,
  DictItem,
  DictTypeKey,
  ErrorLog,
  KnowledgeNode,
  LoginLog,
  OperationLog,
  PlatformNotification,
  PromptTemplate,
  PublicPaper,
  PublicQuestion,
  TextbookVersion,
  TenantMenuItem,
} from '../api/models'

function nowStr(offsetHours = 0): string {
  return new Date(Date.now() + offsetHours * 3600_000).toISOString().slice(0, 19).replace('T', ' ')
}

function dateAfter(days: number): string {
  return new Date(Date.now() + days * 86400_000).toISOString().slice(0, 19).replace('T', ' ')
}

/* ================= 全局字典（FR-PT-015 / 016） ================= */

export const DICT_TYPES: Array<{ key: DictTypeKey; title: string; hint: string }> = [
  { key: 'subject', title: '学科', hint: '编码唯一，创建后不可修改' },
  { key: 'grade', title: '年级 / 学段', hint: '年级挂靠学段' },
  { key: 'term', title: '学期', hint: '起止日期不可交叉重叠' },
  { key: 'questionType', title: '题型', hint: '已被题目使用的题型不可修改作答类型' },
  { key: 'difficulty', title: '难度等级', hint: '系数 0.1-1.0，保留 1 位小数且不可重复' },
  { key: 'examType', title: '考试类型', hint: '题目筛选与组卷场景使用的考试类型' },
]

export const dictStore: Record<DictTypeKey, DictItem[]> = {
  subject: [
    { id: 1, name: '数学', code: 'MATH', sort: 1, enabled: true, refCount: 9 },
    { id: 2, name: '语文', code: 'CHIN', sort: 2, enabled: true, refCount: 9 },
    { id: 3, name: '英语', code: 'ENG', sort: 3, enabled: true, refCount: 8 },
    { id: 4, name: '物理', code: 'PHY', sort: 4, enabled: true, refCount: 6 },
    { id: 5, name: '化学', code: 'CHEM', sort: 5, enabled: true, refCount: 6 },
    { id: 6, name: '生物', code: 'BIO', sort: 6, enabled: true, refCount: 7 },
    { id: 7, name: '政治', code: 'POL', sort: 7, enabled: true, refCount: 6 },
    { id: 8, name: '历史', code: 'HIST', sort: 8, enabled: true, refCount: 6 },
    { id: 9, name: '地理', code: 'GEO', sort: 9, enabled: true, refCount: 6 },
  ],
  /* refCount 为静态演示值：>0 时仅可停用、不可删除 */
  grade: [
    { id: 11, name: '一年级', stage: '小学', sort: 1, enabled: true, refCount: 6 },
    { id: 12, name: '二年级', stage: '小学', sort: 2, enabled: true, refCount: 5 },
    { id: 17, name: '三年级', stage: '小学', sort: 3, enabled: true, refCount: 2 },
    { id: 18, name: '四年级', stage: '小学', sort: 4, enabled: true, refCount: 2 },
    { id: 19, name: '五年级', stage: '小学', sort: 5, enabled: true, refCount: 2 },
    { id: 20, name: '六年级', stage: '小学', sort: 6, enabled: true, refCount: 2 },
    { id: 13, name: '七年级', stage: '初中', sort: 7, enabled: true, refCount: 6 },
    { id: 14, name: '八年级', stage: '初中', sort: 8, enabled: true, refCount: 7 },
    { id: 21, name: '九年级', stage: '初中', sort: 9, enabled: true, refCount: 7 },
    { id: 15, name: '高一', stage: '高中', sort: 10, enabled: true, refCount: 9 },
    { id: 22, name: '高二', stage: '高中', sort: 11, enabled: true, refCount: 7 },
    { id: 16, name: '高三', stage: '高中', sort: 12, enabled: true, refCount: 5 },
  ],
  term: [
    { id: 23, name: '2024-2025 上学期', year: '2024-2025', termHalf: '上学期', dateFrom: '2024-09-02', dateTo: '2025-01-25', sort: 1, enabled: true, refCount: 5 },
    { id: 24, name: '2024-2025 下学期', year: '2024-2025', termHalf: '下学期', dateFrom: '2025-02-24', dateTo: '2025-07-11', sort: 2, enabled: true, refCount: 4 },
    { id: 21, name: '2025-2026 上学期', year: '2025-2026', termHalf: '上学期', dateFrom: '2025-09-01', dateTo: '2026-01-24', sort: 3, enabled: true, refCount: 6 },
    { id: 22, name: '2025-2026 下学期', year: '2025-2026', termHalf: '下学期', dateFrom: '2026-02-23', dateTo: '2026-07-10', sort: 4, enabled: true, refCount: 3 },
    { id: 25, name: '2026-2027 上学期', year: '2026-2027', termHalf: '上学期', dateFrom: '2026-09-01', dateTo: '2027-01-23', sort: 5, enabled: true, refCount: 1 },
    { id: 26, name: '2026-2027 下学期', year: '2026-2027', termHalf: '下学期', dateFrom: '2027-02-22', dateTo: '2027-07-09', sort: 6, enabled: true, refCount: 0 },
  ],
  questionType: [
    { id: 31, name: '单选题', answerType: '选择', sort: 1, enabled: true, refCount: 9 },
    { id: 32, name: '多选题', answerType: '选择', sort: 2, enabled: true, refCount: 7 },
    { id: 36, name: '判断题', answerType: '选择', sort: 3, enabled: true, refCount: 3 },
    { id: 33, name: '填空题', answerType: '填空', sort: 4, enabled: true, refCount: 8 },
    { id: 34, name: '解答题', answerType: '解答', sort: 5, enabled: true, refCount: 9 },
    { id: 35, name: '作图题', answerType: '解答', sort: 6, enabled: false, refCount: 1 },
  ],
  difficulty: [
    { id: 41, name: '容易', coefficient: 0.3, sort: 1, enabled: true, refCount: 9 },
    { id: 42, name: '较易', coefficient: 0.5, sort: 2, enabled: true, refCount: 8 },
    { id: 43, name: '中等', coefficient: 0.7, sort: 3, enabled: true, refCount: 9 },
    { id: 44, name: '较难', coefficient: 0.85, sort: 4, enabled: true, refCount: 6 },
    { id: 45, name: '困难', coefficient: 1.0, sort: 5, enabled: true, refCount: 3 },
  ],
  examType: [
    { id: 51, name: '随堂练习', sort: 1, enabled: true, refCount: 8 },
    { id: 52, name: '单元测试', sort: 2, enabled: true, refCount: 8 },
    { id: 53, name: '期中考试', sort: 3, enabled: true, refCount: 9 },
    { id: 54, name: '期末考试', sort: 4, enabled: true, refCount: 9 },
    { id: 55, name: '模拟考试', sort: 5, enabled: true, refCount: 5 },
    { id: 56, name: '月考', sort: 6, enabled: true, refCount: 5 },
    { id: 57, name: '开学考', sort: 7, enabled: true, refCount: 3 },
    { id: 58, name: '学业水平考试', sort: 8, enabled: true, refCount: 2 },
    { id: 59, name: '高考真题', sort: 9, enabled: true, refCount: 4 },
    { id: 60, name: '专题训练', sort: 10, enabled: true, refCount: 3 },
  ],
}

function nextId(items: Array<{ id: number }>): number {
  return Math.max(0, ...items.map((item) => item.id)) + 1
}

export function listDict(type: DictTypeKey): DictItem[] {
  return [...dictStore[type]].sort((a, b) => a.sort - b.sort)
}

export function saveDictItem(type: DictTypeKey, input: Partial<DictItem>): DictItem {
  const items = dictStore[type]
  if (type === 'difficulty' && input.coefficient !== undefined) {
    const coefficient = Math.round(Number(input.coefficient) * 10) / 10
    if (!Number.isFinite(coefficient) || coefficient < 0.1 || coefficient > 1) {
      throw new Error('难度系数须在 0.1-1.0 之间（保留 1 位小数）')
    }
    input.coefficient = coefficient
  }
  if (input.id) {
    const item = items.find((row) => row.id === input.id)
    if (!item) throw new Error('字典项不存在')
    /* 同级重名校验 */
    if (
      input.name !== undefined &&
      items.some(
        (row) => row.id !== item.id && row.name === input.name && row.stage === (input.stage ?? item.stage),
      )
    ) {
      throw new Error('同级下已存在同名项')
    }
    /* 难度系数不可重复 */
    if (
      type === 'difficulty' &&
      input.coefficient !== undefined &&
      items.some((row) => row.id !== item.id && row.coefficient === input.coefficient)
    ) {
      throw new Error('难度系数已存在，不可重复')
    }
    /* 编码创建后不可改：忽略 input.code */
    const { id: _id, code: _code, ...rest } = input
    Object.assign(item, rest)
    return item
  }
  /* 新增：编码唯一 / 学期日期重叠 / 系数重复校验 */
  if (type === 'subject') {
    const code = (input.code ?? '').trim().toUpperCase()
    if (!code) throw new Error('学科编码不能为空')
    if (items.some((row) => row.code === code)) throw new Error('学科编码已存在')
    input.code = code
  }
  if (type === 'difficulty' && input.coefficient !== undefined) {
    if (items.some((row) => row.coefficient === input.coefficient)) {
      throw new Error('难度系数已存在，不可重复')
    }
  }
  if (type === 'term') {
    if (!input.dateFrom || !input.dateTo || input.dateFrom >= input.dateTo) {
      throw new Error('请填写正确的起止日期')
    }
    const overlapped = items.some(
      (row) => row.year === input.year && row.dateFrom! < input.dateTo! && input.dateFrom! < row.dateTo!,
    )
    if (overlapped) throw new Error('同学年起止日期与已有学期重叠')
  }
  const item: DictItem = {
    id: nextId(items),
    name: input.name ?? '',
    code: input.code,
    sort: input.sort ?? items.length + 1,
    enabled: input.enabled ?? true,
    refCount: 0,
    stage: input.stage,
    year: input.year,
    termHalf: input.termHalf,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    answerType: input.answerType,
    coefficient: input.coefficient,
  }
  items.push(item)
  return item
}

export function toggleDictItem(type: DictTypeKey, id: number): boolean {
  const item = dictStore[type].find((row) => row.id === id)
  if (!item) throw new Error('字典项不存在')
  item.enabled = !item.enabled
  return item.enabled
}

export function deleteDictItem(type: DictTypeKey, id: number): void {
  const item = dictStore[type].find((row) => row.id === id)
  if (!item) throw new Error('字典项不存在')
  if (item.refCount > 0) {
    throw new Error(`该项已被 ${item.refCount} 个机构引用，仅可停用`)
  }
  dictStore[type] = dictStore[type].filter((row) => row.id !== id)
}

export function moveDictItem(type: DictTypeKey, id: number, direction: -1 | 1): void {
  const items = listDict(type)
  const index = items.findIndex((row) => row.id === id)
  const target = index + direction
  if (index < 0 || target < 0 || target >= items.length) return
  const current = items[index]
  const other = items[target]
  const temp = current.sort
  current.sort = other.sort
  other.sort = temp
}

/* ================= 知识点树 ================= */

export const knowledgeNodes: KnowledgeNode[] = [
  { id: 1, parentId: null, name: '函数', subject: '数学', enabled: true },
  { id: 2, parentId: 1, name: '一次函数', subject: '数学', enabled: true },
  { id: 3, parentId: 1, name: '二次函数', subject: '数学', enabled: true },
  { id: 4, parentId: 3, name: '二次函数图像与性质', subject: '数学', enabled: true },
  { id: 5, parentId: 3, name: '二次函数应用题', subject: '数学', enabled: false },
  { id: 6, parentId: null, name: '几何', subject: '数学', enabled: true },
  { id: 7, parentId: 6, name: '平面几何', subject: '数学', enabled: true },
  { id: 8, parentId: 7, name: '三角形', subject: '数学', enabled: true },
  { id: 9, parentId: 7, name: '圆', subject: '数学', enabled: true },
  { id: 10, parentId: null, name: '力学', subject: '物理', enabled: true },
  { id: 11, parentId: 10, name: '牛顿运动定律', subject: '物理', enabled: true },
  { id: 12, parentId: 11, name: '匀变速直线运动', subject: '物理', enabled: true },
  { id: 13, parentId: null, name: '文言文阅读', subject: '语文', enabled: true },
  { id: 14, parentId: 13, name: '实词虚词', subject: '语文', enabled: true },
  { id: 15, parentId: 13, name: '断句与翻译', subject: '语文', enabled: true },
  { id: 16, parentId: null, name: '古代文化常识', subject: '语文', enabled: true },
  { id: 17, parentId: null, name: '现代文阅读', subject: '语文', enabled: true },
  { id: 18, parentId: 17, name: '论述类文本', subject: '语文', enabled: true },
  { id: 19, parentId: 17, name: '文学类文本', subject: '语文', enabled: true },
  { id: 20, parentId: null, name: '古代诗歌鉴赏', subject: '语文', enabled: true },
  { id: 21, parentId: null, name: '语言文字运用', subject: '语文', enabled: true },

  { id: 22, parentId: 1, name: '指数函数与对数函数', subject: '数学', enabled: true },
  { id: 23, parentId: 1, name: '三角函数', subject: '数学', enabled: true },
  { id: 24, parentId: 1, name: '数列', subject: '数学', enabled: true },
  { id: 25, parentId: 24, name: '等差数列', subject: '数学', enabled: true },
  { id: 26, parentId: 24, name: '等比数列', subject: '数学', enabled: true },
  { id: 27, parentId: null, name: '导数及其应用', subject: '数学', enabled: true },
  { id: 28, parentId: 27, name: '导数的概念', subject: '数学', enabled: true },
  { id: 29, parentId: 27, name: '导数在函数中的应用', subject: '数学', enabled: true },
  { id: 30, parentId: 6, name: '立体几何', subject: '数学', enabled: true },
  { id: 31, parentId: 30, name: '空间向量', subject: '数学', enabled: true },
  { id: 32, parentId: 6, name: '解析几何', subject: '数学', enabled: true },
  { id: 33, parentId: 32, name: '抛物线', subject: '数学', enabled: true },
  { id: 34, parentId: 32, name: '圆锥曲线', subject: '数学', enabled: true },
  { id: 35, parentId: null, name: '概率与统计', subject: '数学', enabled: true },

  { id: 36, parentId: 10, name: '电磁学', subject: '物理', enabled: true },
  { id: 37, parentId: 36, name: '静电场', subject: '物理', enabled: true },
  { id: 38, parentId: 36, name: '恒定电流', subject: '物理', enabled: true },
  { id: 39, parentId: 36, name: '电磁感应', subject: '物理', enabled: true },

  { id: 40, parentId: null, name: '语法专项', subject: '英语', enabled: true },
  { id: 41, parentId: 40, name: '时态与语态', subject: '英语', enabled: true },
  { id: 42, parentId: 40, name: '从句', subject: '英语', enabled: true },
  { id: 43, parentId: 40, name: '非谓语动词', subject: '英语', enabled: true },
  { id: 44, parentId: null, name: '完形填空', subject: '英语', enabled: true },
  { id: 45, parentId: null, name: '阅读理解', subject: '英语', enabled: true },
  { id: 46, parentId: null, name: '书面表达', subject: '英语', enabled: true },

  { id: 47, parentId: null, name: '化学实验基础', subject: '化学', enabled: true },
  { id: 48, parentId: null, name: '常见无机物及其应用', subject: '化学', enabled: true },

  { id: 49, parentId: null, name: '分子与细胞', subject: '生物', enabled: true },
  { id: 50, parentId: 49, name: '细胞的结构', subject: '生物', enabled: true },
  { id: 51, parentId: null, name: '遗传与进化', subject: '生物', enabled: true },
  { id: 52, parentId: 51, name: '孟德尔遗传定律', subject: '生物', enabled: true },
  { id: 53, parentId: 51, name: '基因的表达', subject: '生物', enabled: true },
  { id: 54, parentId: null, name: '稳态与调节', subject: '生物', enabled: true },
  { id: 55, parentId: null, name: '生物与环境', subject: '生物', enabled: true },

  { id: 56, parentId: null, name: '经济生活', subject: '政治', enabled: true },
  { id: 57, parentId: 56, name: '价格与消费', subject: '政治', enabled: true },
  { id: 58, parentId: 56, name: '生产与经营', subject: '政治', enabled: true },
  { id: 59, parentId: null, name: '政治生活', subject: '政治', enabled: true },
  { id: 60, parentId: 59, name: '公民与政府', subject: '政治', enabled: true },
  { id: 61, parentId: null, name: '文化生活', subject: '政治', enabled: true },
  { id: 62, parentId: null, name: '生活与哲学', subject: '政治', enabled: true },

  { id: 63, parentId: null, name: '中国古代史', subject: '历史', enabled: true },
  { id: 64, parentId: 63, name: '秦汉大一统', subject: '历史', enabled: true },
  { id: 65, parentId: 63, name: '明清时期', subject: '历史', enabled: true },
  { id: 66, parentId: null, name: '中国近现代史', subject: '历史', enabled: true },
  { id: 67, parentId: 66, name: '晚清变局', subject: '历史', enabled: true },
  { id: 68, parentId: 66, name: '新民主主义革命', subject: '历史', enabled: true },
  { id: 69, parentId: null, name: '世界史', subject: '历史', enabled: true },
  { id: 70, parentId: 69, name: '两次世界大战', subject: '历史', enabled: true },

  { id: 71, parentId: null, name: '自然地理', subject: '地理', enabled: true },
  { id: 72, parentId: 71, name: '大气运动', subject: '地理', enabled: true },
  { id: 73, parentId: 71, name: '水循环', subject: '地理', enabled: true },
  { id: 74, parentId: null, name: '人文地理', subject: '地理', enabled: true },
  { id: 75, parentId: 74, name: '人口与城市', subject: '地理', enabled: true },
  { id: 76, parentId: 74, name: '工农业区位', subject: '地理', enabled: true },
  { id: 77, parentId: null, name: '区域地理', subject: '地理', enabled: true },
]

export function listKnowledge(): KnowledgeNode[] {
  return knowledgeNodes
}

function isDescendant(rootId: number, maybeChildId: number): boolean {
  let current = knowledgeNodes.find((node) => node.id === maybeChildId)
  while (current?.parentId != null) {
    if (current.parentId === rootId) return true
    current = knowledgeNodes.find((node) => node.id === current!.parentId)
  }
  return false
}

export function saveKnowledgeNode(input: Partial<KnowledgeNode>): KnowledgeNode {
  if (input.parentId != null && input.id != null && isDescendant(input.id, input.parentId)) {
    throw new Error('不可将节点移动到其子节点下')
  }
  if (input.id) {
    const node = knowledgeNodes.find((row) => row.id === input.id)
    if (!node) throw new Error('节点不存在')
    Object.assign(node, input)
    return node
  }
  const node: KnowledgeNode = {
    id: nextId(knowledgeNodes),
    parentId: input.parentId ?? null,
    name: input.name ?? '未命名节点',
    subject: input.subject ?? '数学',
    enabled: true,
  }
  knowledgeNodes.push(node)
  return node
}

/** 整棵子树启停用 */
export function toggleKnowledgeNode(id: number): boolean {
  const root = knowledgeNodes.find((node) => node.id === id)
  if (!root) throw new Error('节点不存在')
  const next = !root.enabled
  const stack = [id]
  while (stack.length) {
    const current = stack.pop()!
    const node = knowledgeNodes.find((row) => row.id === current)
    if (node) node.enabled = next
    knowledgeNodes.filter((row) => row.parentId === current).forEach((child) => stack.push(child.id))
  }
  return next
}

export function deleteKnowledgeNode(id: number): void {
  const children = knowledgeNodes.filter((node) => node.parentId === id)
  if (children.length > 0) throw new Error('请先删除或移走子节点')
  const index = knowledgeNodes.findIndex((node) => node.id === id)
  knowledgeNodes.splice(index, 1)
}

/* ================= 教材版本 ================= */

export const textbooks: TextbookVersion[] = [
  { id: 1, subject: '数学', name: '人教版', publisher: '人民教育出版社', hue: 212, sort: 1, enabled: true, refCount: 9 },
  { id: 2, subject: '数学', name: '北师大版', publisher: '北京师范大学出版社', hue: 268, sort: 2, enabled: true, refCount: 6 },
  { id: 3, subject: '数学', name: '苏教版', publisher: '江苏凤凰教育出版社', hue: 152, sort: 3, enabled: true, refCount: 3 },
  { id: 4, subject: '语文', name: '人教版', publisher: '人民教育出版社', hue: 22, sort: 4, enabled: true, refCount: 6 },
  { id: 5, subject: '语文', name: '部编版', publisher: '人民教育出版社', hue: 330, sort: 5, enabled: true, refCount: 8 },
  { id: 6, subject: '英语', name: '外研版', publisher: '外语教学与研究出版社', hue: 190, sort: 6, enabled: true, refCount: 6 },
  { id: 7, subject: '物理', name: '沪科版', publisher: '上海科学技术出版社', hue: 246, sort: 7, enabled: true, refCount: 4 },
  { id: 8, subject: '数学', name: '人教A版', publisher: '人民教育出版社', hue: 220, sort: 8, enabled: true, refCount: 4 },
  { id: 9, subject: '数学', name: '苏科版', publisher: '江苏凤凰科学技术出版社', hue: 164, sort: 9, enabled: true, refCount: 3 },
  { id: 10, subject: '英语', name: '人教版', publisher: '人民教育出版社', hue: 198, sort: 10, enabled: true, refCount: 7 },
  { id: 11, subject: '英语', name: '人教新起点', publisher: '人民教育出版社', hue: 206, sort: 11, enabled: true, refCount: 2 },
  { id: 12, subject: '英语', name: '人教PEP', publisher: '人民教育出版社', hue: 214, sort: 12, enabled: true, refCount: 2 },
  { id: 13, subject: '物理', name: '人教版', publisher: '人民教育出版社', hue: 254, sort: 13, enabled: true, refCount: 5 },
  { id: 14, subject: '化学', name: '人教版', publisher: '人民教育出版社', hue: 96, sort: 14, enabled: true, refCount: 4 },
  { id: 15, subject: '化学', name: '鲁科版', publisher: '山东科学技术出版社', hue: 112, sort: 15, enabled: true, refCount: 2 },
  { id: 16, subject: '化学', name: '鲁教版', publisher: '山东教育出版社', hue: 128, sort: 16, enabled: true, refCount: 1 },
  { id: 17, subject: '生物', name: '人教版', publisher: '人民教育出版社', hue: 300, sort: 17, enabled: true, refCount: 5 },
  { id: 18, subject: '生物', name: '苏教版', publisher: '江苏凤凰教育出版社', hue: 318, sort: 18, enabled: true, refCount: 2 },
  { id: 19, subject: '政治', name: '人教版', publisher: '人民教育出版社', hue: 4, sort: 19, enabled: true, refCount: 4 },
  { id: 20, subject: '历史', name: '部编版', publisher: '人民教育出版社', hue: 38, sort: 20, enabled: true, refCount: 4 },
  { id: 21, subject: '地理', name: '人教版', publisher: '人民教育出版社', hue: 136, sort: 21, enabled: true, refCount: 4 },
  { id: 22, subject: '地理', name: '湘教版', publisher: '湖南教育出版社', hue: 150, sort: 22, enabled: true, refCount: 2 },
]

export function listTextbooks(): TextbookVersion[] {
  return [...textbooks].sort((a, b) => a.sort - b.sort)
}

export function saveTextbook(input: Partial<TextbookVersion>): TextbookVersion {
  if (input.id) {
    const item = textbooks.find((row) => row.id === input.id)
    if (!item) throw new Error('教材版本不存在')
    if (
      textbooks.some(
        (row) => row.id !== item.id && row.subject === input.subject && row.name === input.name,
      )
    ) {
      throw new Error('该学科下已存在同名版本')
    }
    Object.assign(item, input)
    return item
  }
  if (textbooks.some((row) => row.subject === input.subject && row.name === input.name)) {
    throw new Error('该学科下已存在同名版本')
  }
  const item: TextbookVersion = {
    id: nextId(textbooks),
    subject: input.subject ?? '数学',
    name: input.name ?? '',
    publisher: input.publisher ?? '',
    hue: Math.floor(Math.random() * 360),
    sort: input.sort ?? textbooks.length + 1,
    enabled: true,
    refCount: 0,
  }
  textbooks.push(item)
  return item
}

export function toggleTextbook(id: number): boolean {
  const item = textbooks.find((row) => row.id === id)
  if (!item) throw new Error('教材版本不存在')
  item.enabled = !item.enabled
  return item.enabled
}

export function deleteTextbook(id: number): void {
  const item = textbooks.find((row) => row.id === id)
  if (!item) throw new Error('教材版本不存在')
  if (item.refCount > 0) throw new Error(`该版本已被 ${item.refCount} 个机构引用，仅可停用`)
  const index = textbooks.findIndex((row) => row.id === id)
  textbooks.splice(index, 1)
}

/* ================= AI 模型接入（FR-PT-017 ~ 019） ================= */

export const aiModels: AiModel[] = [
  {
    id: 1, name: 'GPT-4o', type: 'llm', provider: 'OpenAI',
    apiUrl: 'https://api.openai.com/v1', apiKeyMasked: 'sk-****7f3a',
    qps: 20, pricePerK: 0.045, enabled: true,
    callsThisMonth: 128460, costThisMonth: 5780.7,
    lastCheckAt: nowStr(-2), lastCheckOk: true,
  },
  {
    id: 2, name: 'Claude Sonnet', type: 'llm', provider: 'Anthropic',
    apiUrl: 'https://api.anthropic.com/v1', apiKeyMasked: 'sk-****2b9c',
    qps: 15, pricePerK: 0.038, enabled: true,
    callsThisMonth: 86230, costThisMonth: 3276.7,
    lastCheckAt: nowStr(-2), lastCheckOk: true,
  },
  {
    id: 3, name: 'Qwen-VL-Max', type: 'multimodal', provider: '阿里云百炼',
    apiUrl: 'https://dashscope.aliyuncs.com/api/v1', apiKeyMasked: 'sk-****9d4e',
    qps: 10, pricePerK: 0.02, enabled: true,
    callsThisMonth: 24180, costThisMonth: 483.6,
    lastCheckAt: nowStr(-5), lastCheckOk: true,
  },
  {
    id: 4, name: 'MathOCR-Pro', type: 'ocr', provider: '合合信息',
    apiUrl: 'https://ocr.mathparser.cn/api', apiKeyMasked: 'sk-****1a6f',
    qps: 5, pricePerK: 0.012, enabled: true,
    callsThisMonth: 9840, costThisMonth: 118.1,
    lastCheckAt: nowStr(-26), lastCheckOk: false,
  },
  {
    id: 5, name: 'GLM-4-Plus', type: 'llm', provider: '智谱 AI',
    apiUrl: 'https://open.bigmodel.cn/api/paas/v4', apiKeyMasked: 'sk-****c821',
    qps: 30, pricePerK: 0.015, enabled: false,
    callsThisMonth: 0, costThisMonth: 0,
    lastCheckAt: nowStr(-72), lastCheckOk: true,
  },
]

export const AI_MODEL_TYPE_TEXT: Record<AiModelType, string> = {
  llm: '大语言模型',
  multimodal: '多模态',
  ocr: 'OCR 公式识别',
}

export function listAiModels(): AiModel[] {
  return aiModels.map((model) => ({ ...model }))
}

export function saveAiModel(input: Partial<AiModel> & { apiKey?: string }): AiModel {
  if (input.id) {
    const model = aiModels.find((row) => row.id === input.id)
    if (!model) throw new Error('模型不存在')
    /* API Key 不回显：留空表示不修改 */
    const { id: _id, apiKey, apiKeyMasked: _masked, ...rest } = input
    Object.assign(model, rest)
    if (apiKey && apiKey.trim()) model.apiKeyMasked = `sk-****${apiKey.trim().slice(-4)}`
    return model
  }
  if (!input.apiKey || !input.apiKey.trim()) throw new Error('API Key 不能为空')
  const model: AiModel = {
    id: nextId(aiModels),
    name: input.name ?? '',
    type: (input.type as AiModelType) ?? 'llm',
    provider: input.provider ?? '',
    apiUrl: input.apiUrl ?? '',
    apiKeyMasked: `sk-****${input.apiKey.trim().slice(-4)}`,
    qps: input.qps ?? 10,
    pricePerK: input.pricePerK ?? 0,
    enabled: true,
    callsThisMonth: 0,
    costThisMonth: 0,
  }
  aiModels.push(model)
  return model
}

/** 测试连接（FR-PT-018）：mock 固定成功，返回随机耗时 */
export function testModelConnection(): { latencyMs: number } {
  return { latencyMs: 120 + Math.floor(Math.random() * 380) }
}

/** 健康检测（FR-PT-019）：写入最近检测结果 */
export function healthCheckModel(id: number): { ok: boolean; latencyMs: number; lastCheckAt: string } {
  const model = aiModels.find((row) => row.id === id)
  if (!model) throw new Error('模型不存在')
  const ok = Math.random() > 0.15
  const latencyMs = 100 + Math.floor(Math.random() * 500)
  model.lastCheckAt = nowStr()
  model.lastCheckOk = ok
  return { ok, latencyMs, lastCheckAt: model.lastCheckAt }
}

export function toggleAiModel(id: number): boolean {
  const model = aiModels.find((row) => row.id === id)
  if (!model) throw new Error('模型不存在')
  if (model.enabled && !aiModels.some((row) => row.enabled && row.id !== id && row.type === model.type)) {
    throw new Error('无同类型备用模型，不可停用：请先启用另一个备用模型')
  }
  model.enabled = !model.enabled
  return model.enabled
}

/* ================= 多智能体编排（FR-PT-020 ~ 023） ================= */

const CHECK_SEEDS: Array<Omit<AgentCheckItem, 'enabled' | 'modelId' | 'weight' | 'timeoutSec'>> = [
  { key: 'semantic', label: '语义完整性', ocrOnly: false },
  { key: 'calc', label: '计算验算', ocrOnly: false },
  { key: 'latex', label: 'LaTeX 公式', ocrOnly: false },
  { key: 'figure', label: '图形描述', ocrOnly: true },
  { key: 'knowledge', label: '知识点匹配', ocrOnly: false },
  { key: 'difficulty', label: '难度匹配', ocrOnly: false },
  { key: 'duplicate', label: '查重', ocrOnly: false },
  { key: 'structure', label: '试卷结构', ocrOnly: false },
]

export const agentConfig: AgentConfig = {
  items: CHECK_SEEDS.map((seed, index) => ({
    ...seed,
    enabled: true,
    modelId: seed.ocrOnly ? 3 : (index % 2) + 1,
    weight: 10 + (index % 3) * 5,
    timeoutSec: 30,
  })),
  autoFix: { types: ['格式错误', '语法错误', '数值笔误'], threshold: 90 },
  manualReview: { minConfidence: 60, maxSimilarity: 80 },
  version: 3,
  versions: [
    { version: 1, savedAt: dateAfter(-30), note: '初始编排' },
    { version: 2, savedAt: dateAfter(-12), note: '查重权重上调至 20，图形描述绑定 Qwen-VL' },
    { version: 3, savedAt: dateAfter(-3), note: '自动修复阈值 85% → 90%' },
  ],
}

export function getAgentConfig(): AgentConfig {
  return JSON.parse(JSON.stringify(agentConfig)) as AgentConfig
}

export function saveAgentConfig(config: AgentConfig): AgentConfig {
  for (const item of config.items) {
    if (item.enabled && !item.modelId) {
      throw new Error(`「${item.label}」已启用但未绑定模型`)
    }
    if (item.weight < 0 || item.weight > 100) throw new Error(`「${item.label}」权重须在 0-100 之间`)
  }
  agentConfig.items = config.items
  agentConfig.autoFix = config.autoFix
  agentConfig.manualReview = config.manualReview
  agentConfig.version += 1
  agentConfig.versions.push({
    version: agentConfig.version,
    savedAt: nowStr(),
    note: `保存编排（${config.items.filter((item) => item.enabled).length} 项启用）`,
  })
  return getAgentConfig()
}

export function rollbackAgentConfig(version: number): AgentConfig {
  const exists = agentConfig.versions.some((item) => item.version === version)
  if (!exists) throw new Error('版本不存在')
  agentConfig.version += 1
  agentConfig.versions.push({
    version: agentConfig.version,
    savedAt: nowStr(),
    note: `回滚到版本 v${version}`,
  })
  return getAgentConfig()
}

/* ================= 全局 Prompt 模板（FR-PT-024 ~ 027） ================= */

export const PROMPT_SCENES = ['AI 出题', 'AI 变式', '题目校验', '拍照识题解析', '试卷分析']

/** 模板可用变量（{{subject}} 等） */
export const PROMPT_VARIABLES = [
  { key: '{{subject}}', desc: '学科' },
  { key: '{{grade}}', desc: '年级' },
  { key: '{{type}}', desc: '题型' },
  { key: '{{difficulty}}', desc: '难度' },
  { key: '{{knowledge}}', desc: '知识点' },
  { key: '{{stem}}', desc: '题干' },
  { key: '{{count}}', desc: '生成数量' },
]

export const prompts: PromptTemplate[] = [
  {
    id: 1,
    name: '数学出题-默认模板',
    scene: 'AI 出题',
    content:
      '你是一名{{subject}}命题专家。请围绕知识点「{{knowledge}}」，面向{{grade}}{{type}}，生成 {{count}} 道{{difficulty}}难度的试题，输出题干、选项、答案与解析，使用 LaTeX 表示公式。',
    status: 'published',
    isDefault: true,
    updatedAt: dateAfter(-6),
    versions: [
      { version: 1, savedAt: dateAfter(-40), content: '你是一名命题专家。请生成 {{count}} 道{{difficulty}}难度的{{subject}}试题。' },
      { version: 2, savedAt: dateAfter(-6), content: '你是一名{{subject}}命题专家。请围绕知识点「{{knowledge}}」，面向{{grade}}{{type}}，生成 {{count}} 道{{difficulty}}难度的试题，输出题干、选项、答案与解析，使用 LaTeX 表示公式。' },
    ],
  },
  {
    id: 2,
    name: '变式训练-通用',
    scene: 'AI 变式',
    content:
      '基于原题：{{stem}}\n请生成 3 道保持考点不变（{{knowledge}}）但情境与数值变化的变式题，难度依次为：同等、略高、略低。',
    status: 'published',
    isDefault: true,
    updatedAt: dateAfter(-15),
    versions: [{ version: 1, savedAt: dateAfter(-15), content: '基于原题：{{stem}}\n请生成 3 道保持考点不变（{{knowledge}}）但情境与数值变化的变式题，难度依次为：同等、略高、略低。' }],
  },
  {
    id: 3,
    name: '题目校验-语义完整性',
    scene: '题目校验',
    content: '检查以下{{subject}}题目语义是否完整、条件是否充分：{{stem}}。输出：通过/不通过 + 具体问题说明。',
    status: 'published',
    isDefault: false,
    updatedAt: dateAfter(-22),
    versions: [{ version: 1, savedAt: dateAfter(-22), content: '检查以下{{subject}}题目语义是否完整、条件是否充分：{{stem}}。输出：通过/不通过 + 具体问题说明。' }],
  },
  {
    id: 4,
    name: '拍照解析-内部测试',
    scene: '拍照识题解析',
    content: '识别图片中的题目并解析：{{stem}}',
    status: 'draft',
    isDefault: false,
    updatedAt: dateAfter(-1),
    versions: [{ version: 1, savedAt: dateAfter(-1), content: '识别图片中的题目并解析：{{stem}}' }],
  },
]

export function listPrompts(): PromptTemplate[] {
  return prompts.map((item) => ({ ...item, versions: [...item.versions] }))
}

export function validatePromptContent(content: string): string[] {
  const validKeys = PROMPT_VARIABLES.map((item) => item.key)
  const matches = content.match(/\{\{[^}]+\}\}/g) ?? []
  return Array.from(new Set(matches.filter((token) => !validKeys.includes(token))))
}

export function savePrompt(input: Partial<PromptTemplate> & { content: string }): PromptTemplate {
  const invalid = validatePromptContent(input.content)
  if (invalid.length > 0) {
    throw new Error(`包含未知变量：${invalid.join('、')}`)
  }
  if (input.id) {
    const item = prompts.find((row) => row.id === input.id)
    if (!item) throw new Error('模板不存在')
    item.name = input.name ?? item.name
    item.scene = input.scene ?? item.scene
    item.content = input.content
    item.status = input.status ?? item.status
    item.updatedAt = nowStr()
    item.versions.push({ version: item.versions.length + 1, savedAt: item.updatedAt, content: input.content })
    return item
  }
  const item: PromptTemplate = {
    id: nextId(prompts),
    name: input.name ?? '未命名模板',
    scene: input.scene ?? PROMPT_SCENES[0],
    content: input.content,
    status: 'draft',
    isDefault: false,
    updatedAt: nowStr(),
    versions: [{ version: 1, savedAt: nowStr(), content: input.content }],
  }
  prompts.push(item)
  return item
}

export function setDefaultPrompt(id: number): void {
  const item = prompts.find((row) => row.id === id)
  if (!item) throw new Error('模板不存在')
  prompts.forEach((row) => {
    if (row.scene === item.scene) row.isDefault = false
  })
  item.isDefault = true
  if (item.status !== 'published') item.status = 'published'
}

export function togglePrompt(id: number): PromptTemplate {
  const item = prompts.find((row) => row.id === id)
  if (!item) throw new Error('模板不存在')
  if (item.status === 'published' && item.isDefault) {
    throw new Error('默认模板不可停用，请先将同场景其他模板设为默认')
  }
  item.status = item.status === 'published' ? 'disabled' : 'published'
  return item
}

export function rollbackPrompt(id: number, version: number): PromptTemplate {
  const item = prompts.find((row) => row.id === id)
  if (!item) throw new Error('模板不存在')
  const target = item.versions.find((row) => row.version === version)
  if (!target) throw new Error('版本不存在')
  item.content = target.content
  item.updatedAt = nowStr()
  item.versions.push({ version: item.versions.length + 1, savedAt: nowStr(), content: target.content })
  return item
}

export function testPrompt(): { output: string; costMs: number; tokens: number } {
  return {
    output:
      '【示例输出】一、单选题（每题 5 分）\n1. 已知二次函数 f(x)=x²-2x-3，则其图像与 x 轴交点个数为（ ）\nA. 0　B. 1　C. 2　D. 3\n答案：C\n解析：令 f(x)=0，Δ=(-2)²+12=16>0，故有两个交点。',
    costMs: 1200 + Math.floor(Math.random() * 2400),
    tokens: 640 + Math.floor(Math.random() * 900),
  }
}

/* ================= AI 调用日志（FR-PT-028） ================= */

const AI_SCENES = ['AI 出题', 'AI 变式', '拍照识题', '文档识别入库', '题目校验', '试卷分析']

function seedAiLogs(): AiCallLog[] {
  const rows: AiCallLog[] = []
  for (let i = 0; i < 26; i += 1) {
    const ok = Math.random() > 0.14
    rows.push({
      id: i + 1,
      time: nowStr(-i * 5 - Math.random() * 3),
      orgMasked: `机构 ${String.fromCharCode(65 + (i % 7))}`,
      user: ['张老师', '李老师', '王老师', '赵老师'][i % 4],
      scene: AI_SCENES[i % AI_SCENES.length],
      model: ['GPT-4o', 'Claude Sonnet', 'Qwen-VL-Max', 'MathOCR-Pro'][i % 4],
      inputTokens: 300 + Math.floor(Math.random() * 2000),
      outputTokens: 200 + Math.floor(Math.random() * 1500),
      costMs: 800 + Math.floor(Math.random() * 6000),
      ok,
      error: ok ? undefined : ['模型限流（429），已自动重试 3 次仍失败', '输出超时（30s）', '内容安全拦截'][i % 3],
    })
  }
  return rows
}

export const aiCallLogs: AiCallLog[] = seedAiLogs()

export function listAiLogs(query: {
  org?: string
  scene?: string
  model?: string
  result?: string
}): AiCallLog[] {
  let rows = [...aiCallLogs].sort((a, b) => b.time.localeCompare(a.time))
  if (query.org) rows = rows.filter((row) => row.orgMasked === query.org)
  if (query.scene) rows = rows.filter((row) => row.scene === query.scene)
  if (query.model) rows = rows.filter((row) => row.model === query.model)
  if (query.result === 'fail') rows = rows.filter((row) => !row.ok)
  if (query.result === 'ok') rows = rows.filter((row) => row.ok)
  return rows
}

/* ================= 平台资源总库（FR-PT-029 ~ 032） ================= */

export const publicQuestions: PublicQuestion[] = [
  {
    id: 1, stem: '已知二次函数 f(x) = x² - 2x - 3，求其图像与 x 轴的交点坐标…', subject: '数学',
    knowledge: '二次函数图像与性质', type: '解答题', difficulty: '中等', orgMasked: '机构 A',
    variantCount: 3, aiStatus: '全部通过', createdAt: dateAfter(-9),
    options: [], answer: '(-1, 0) 与 (3, 0)', analysis: '令 f(x)=0 即 x²-2x-3=0，解得 x₁=-1，x₂=3。',
    report: '语义完整性✓ 计算验算✓ LaTeX✓ 知识点匹配✓ 难度匹配✓ 查重(8%)✓',
    variants: ['变式1：求与 y 轴交点', '变式2：求顶点坐标', '变式3：区间内最值'],
  },
  {
    id: 2, stem: '下列关于牛顿第三定律的说法正确的是（ ）…', subject: '物理',
    knowledge: '牛顿运动定律', type: '单选题', difficulty: '较易', orgMasked: '机构 C',
    variantCount: 1, aiStatus: '人工终审通过', createdAt: dateAfter(-6),
    options: ['A. 作用力与反作用力作用在同一物体上', 'B. 作用力与反作用力大小相等、方向相反', 'C. 先有作用力后有反作用力', 'D. 作用力与反作用力性质可以不同'],
    answer: 'B', analysis: '作用力与反作用力等大反向、作用在两个物体上、同时产生同时消失、性质相同。',
    report: '语义完整性✓ 计算验算✓ 图形描述✓ 知识点匹配✓ 难度匹配✓ 查重(22%)→人工终审通过',
    variants: ['变式1：牛顿第二定律情境'],
  },
  {
    id: 3, stem: '阅读下面的文言文，完成后面题目：邹忌修八尺有余……', subject: '语文',
    knowledge: '文言文阅读', type: '解答题', difficulty: '较难', orgMasked: '机构 A',
    variantCount: 0, aiStatus: '全部通过', createdAt: dateAfter(-4),
    options: [], answer: '（示例）纳谏、自知之明', analysis: '考查对文意的理解概括与实词推断。',
    report: '语义完整性✓ 知识点匹配✓ 难度匹配✓ 查重(5%)✓',
    variants: [],
  },
  {
    id: 4, stem: '设集合 A = {x | x² - 3x + 2 = 0}，B = {x | 0 < x < 3}，则 A ∩ B = …', subject: '数学',
    knowledge: '集合运算', type: '填空题', difficulty: '容易', orgMasked: '机构 D',
    variantCount: 2, aiStatus: '自动修复 2 处后通过', createdAt: dateAfter(-2),
    options: [], answer: '{1, 2}', analysis: 'A = {1,2}，B 为开区间，交集为 {1,2}。',
    report: '数值笔误×2 → 自动修复（置信度 96%/93%）其余项通过',
    variants: ['变式1：求 A ∪ B', '变式2：求 ∁ᵤB（补集）'],
  },
  {
    id: 5, stem: 'As is known to all, the Great Wall ___ (stretch) across northern China…', subject: '英语',
    knowledge: '时态语态', type: '填空题', difficulty: '中等', orgMasked: '机构 B',
    variantCount: 1, aiStatus: '全部通过', createdAt: dateAfter(-1),
    options: [], answer: 'stretches', analysis: '一般现在时，主语单数。',
    report: '语义完整性✓ 语法✓ 知识点匹配✓ 查重(11%)✓',
    variants: ['变式1：改为主谓一致易错题'],
  },
]

export const publicPapers: PublicPaper[] = [
  { id: 1, name: '2026 届高三数学期中模拟卷（一）', subject: '数学', totalScore: 150, questionCount: 22, parallelCount: 3, orgMasked: '机构 A', createdAt: dateAfter(-8), parallels: ['平行卷 A1（同构异序）', '平行卷 A2（数值替换）', '平行卷 A3（难度等值）'] },
  { id: 2, name: '九年级物理单元检测：电学综合', subject: '物理', totalScore: 100, questionCount: 18, parallelCount: 2, orgMasked: '机构 C', createdAt: dateAfter(-5), parallels: ['平行卷 B1（同构异序）', '平行卷 B2（情境替换）'] },
  { id: 3, name: '高一语文必修二阶段测试', subject: '语文', totalScore: 120, questionCount: 20, parallelCount: 0, orgMasked: '机构 A', createdAt: dateAfter(-3), parallels: [] },
  { id: 4, name: '七年级英语下学期期末模拟', subject: '英语', totalScore: 100, questionCount: 25, parallelCount: 1, orgMasked: '机构 D', createdAt: dateAfter(-1), parallels: ['平行卷 C1（同构异序）'] },
]

export const auditRecords: AuditRecord[] = [
  {
    id: 1, objectType: '题目', objectName: '二次函数与 x 轴交点（解答题）', agentPassed: 7, agentTotal: 8,
    autoFixed: 1, reviewer: '王老师（机构 A）', conclusion: '人工终审通过', reviewedAt: dateAfter(-2),
    timeline: [
      { time: dateAfter(-2.1), step: 'AI 出题', detail: 'GPT-4o 生成题目初稿（耗时 2.3s，1,842 tokens）' },
      { time: dateAfter(-2.08), step: '语义完整性', detail: '通过（置信度 97%）' },
      { time: dateAfter(-2.07), step: '计算验算', detail: '不通过：解析中“x₁=-1”误写为“x₁=1”' },
      { time: dateAfter(-2.06), step: '自动修复', detail: '数值笔误修复（置信度 96% ≥ 阈值 90%，已自动执行）改前：x₁=1 → 改后：x₁=-1' },
      { time: dateAfter(-2.05), step: '查重', detail: '与公开题库最大相似度 8%，通过' },
      { time: dateAfter(-2.02), step: '人工终审', detail: '王老师通过，备注“解析表述优化”' },
    ],
  },
  {
    id: 2, objectType: '题目', objectName: '牛顿第三定律（单选题）', agentPassed: 7, agentTotal: 8,
    autoFixed: 0, reviewer: '李老师（机构 C）', conclusion: '人工终审通过', reviewedAt: dateAfter(-4),
    timeline: [
      { time: dateAfter(-4.1), step: 'AI 出题', detail: 'Claude Sonnet 生成题目初稿' },
      { time: dateAfter(-4.08), step: '查重', detail: '相似度 22%（> 阈值 20%），触发人工终审' },
      { time: dateAfter(-4.02), step: '人工终审', detail: '李老师判定为常见考点表述、非抄袭，通过' },
    ],
  },
  {
    id: 3, objectType: '试卷', objectName: '高三数学期中模拟卷（一）', agentPassed: 8, agentTotal: 8,
    autoFixed: 3, reviewer: '张老师（机构 A）', conclusion: '人工终审通过', reviewedAt: dateAfter(-7),
    timeline: [
      { time: dateAfter(-7.3), step: '协同组卷', detail: '3 位教师协同完成 22 题组卷' },
      { time: dateAfter(-7.2), step: '多智能体校验', detail: '8 项检测全部通过（自动修复格式错误 3 处）' },
      { time: dateAfter(-7.1), step: '试卷结构', detail: '知识点覆盖率 92%，难度系数 0.68，结构合理' },
      { time: dateAfter(-7.05), step: '人工终审', detail: '张老师通过并发布到公开题库' },
    ],
  },
  {
    id: 4, objectType: '题目', objectName: '集合交集（填空题）', agentPassed: 6, agentTotal: 8,
    autoFixed: 2, reviewer: '赵老师（机构 D）', conclusion: '人工终审驳回', reviewedAt: dateAfter(-1),
    timeline: [
      { time: dateAfter(-1.2), step: '拍照识题入库', detail: 'MathOCR-Pro 识别（1,024 tokens）' },
      { time: dateAfter(-1.18), step: 'LaTeX 公式', detail: '不通过：∨ 误识别为 �' },
      { time: dateAfter(-1.15), step: '自动修复', detail: '格式错误 2 处修复（置信度 95%/91%）' },
      { time: dateAfter(-1.1), step: '知识点匹配', detail: '不通过：标注“一次函数”应为“集合运算”' },
      { time: dateAfter(-1.02), step: '人工终审', detail: '赵老师驳回：知识点标注错误，退回修改' },
    ],
  },
]

/* ================= 日志审计（FR-PT-035） ================= */

export const loginLogs: LoginLog[] = Array.from({ length: 12 }, (_, i) => ({
  id: i + 1,
  account: ['admin', 'ops_wang', 'orgadmin_a', 'orgadmin_c', 'teacher_li'][i % 5],
  ip: `10.20.${i}.${30 + i * 7}`,
  device: ['Chrome 132 / macOS', 'Safari 18 / iOS', 'Edge 131 / Windows', '小程序 / Android'][i % 4],
  ok: i !== 4 && i !== 9,
  time: nowStr(-i * 7 - 1),
}))

export const operationLogs: OperationLog[] = [
  { id: 1, account: 'admin', module: '租户管理', action: '通过入驻申请', target: '杭州西湖实验中学', ok: true, time: nowStr(-1) },
  { id: 2, account: 'admin', module: '租户管理', action: '禁用机构', target: '青岛崂山第一中学', ok: true, time: nowStr(-6) },
  { id: 3, account: 'ops_wang', module: '全局字典', action: '新增字典项', target: '学科-地理', ok: true, time: nowStr(-11) },
  { id: 4, account: 'admin', module: 'AI 服务配置', action: '停用模型', target: 'GLM-4-Plus', ok: true, time: nowStr(-20) },
  { id: 5, account: 'ops_wang', module: 'AI 服务配置', action: '保存智能体编排', target: 'v3', ok: true, time: nowStr(-70) },
  { id: 6, account: 'admin', module: '系统管理', action: '重置管理员密码', target: 'ops_wang', ok: true, time: nowStr(-30) },
  { id: 7, account: 'orgadmin_a', module: '试卷管理', action: '发布试卷', target: '期中模拟卷（一）', ok: false, time: nowStr(-46) },
  { id: 8, account: 'admin', module: '租户管理', action: '续费机构', target: '广州明师教育', ok: true, time: nowStr(-52) },
  { id: 9, account: 'ops_wang', module: '全局字典', action: '删除字典项', target: '题型-判断题', ok: false, time: nowStr(-80) },
  { id: 10, account: 'admin', module: '套餐管理', action: '新增套餐', target: '轻量版', ok: true, time: nowStr(-96) },
]

export const errorLogs: ErrorLog[] = [
  {
    id: 1, level: 'ERROR', time: nowStr(-2),
    stack: 'java.lang.RuntimeException: 模型调用超时（model=GPT-4o, timeout=30s）\n  at com.aiteach.ai.ModelClient.invoke(ModelClient.java:128)\n  at com.aiteach.ai.RateLimiter.lambda$acquire$0(RateLimiter.java:64)\n  at java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1144)',
  },
  {
    id: 2, level: 'WARN', time: nowStr(-8),
    stack: 'org.springframework.dao.DeadlockLoserDataAccessException: 死锁回滚并重试成功（retry=1, table=sys_question）\n  at com.aiteach.repo.QuestionRepo.batchInsert(QuestionRepo.java:302)',
  },
  {
    id: 3, level: 'ERROR', time: nowStr(-26),
    stack: 'com.aiteach.ocr.OcrException: 公式识别失败（code=4003, imageId=img_9f2c1）\n  at com.aiteach.ocr.MathOcrClient.parse(MathOcrClient.java:88)',
  },
  {
    id: 4, level: 'WARN', time: nowStr(-49),
    stack: 'RedisTimeoutException: lettuce command timeout (2s) — 已降级为本地缓存\n  at io.lettuce.core.protocol.RedisStateMachine.decode(RedisStateMachine.java:231)',
  },
]

/* ================= 系统管理（FR-PT-033 / 034） ================= */

export const adminAccounts: AdminAccount[] = [
  { id: 1, account: 'admin', name: '系统管理员', role: 'super', enabled: true, lastLoginAt: nowStr(-0.5) },
  { id: 2, account: 'ops_wang', name: '王运营', role: 'ops', enabled: true, lastLoginAt: nowStr(-20) },
  { id: 3, account: 'ops_liu', name: '刘运营', role: 'ops', enabled: true, lastLoginAt: nowStr(-74) },
  { id: 4, account: 'ops_chen', name: '陈运营', role: 'ops', enabled: false, lastLoginAt: dateAfter(-60) },
]

export const ADMIN_ROLE_TEXT: Record<string, string> = { super: '超级管理员', ops: '运营专员' }

export function listAdmins(): AdminAccount[] {
  return adminAccounts.map((item) => ({ ...item }))
}

export function saveAdmin(input: Partial<AdminAccount>): AdminAccount {
  const account = (input.account ?? '').trim()
  if (!/^[a-zA-Z0-9_]{4,20}$/.test(account)) {
    throw new Error('账号须为 4-20 位字母 / 数字 / 下划线')
  }
  if (input.id) {
    const item = adminAccounts.find((row) => row.id === input.id)
    if (!item) throw new Error('管理员不存在')
    if (adminAccounts.some((row) => row.id !== item.id && row.account === account)) {
      throw new Error('账号已存在')
    }
    Object.assign(item, input, { account })
    return item
  }
  if (adminAccounts.some((row) => row.account === account)) throw new Error('账号已存在')
  const item: AdminAccount = {
    id: nextId(adminAccounts),
    account,
    name: input.name ?? '',
    role: input.role ?? 'ops',
    enabled: true,
    lastLoginAt: '',
  }
  adminAccounts.push(item)
  return item
}

export function toggleAdmin(id: number): boolean {
  const item = adminAccounts.find((row) => row.id === id)
  if (!item) throw new Error('管理员不存在')
  if (item.role === 'super' && item.enabled) {
    const superCount = adminAccounts.filter((row) => row.role === 'super' && row.enabled).length
    if (superCount <= 1) throw new Error('最后一个超级管理员禁止禁用')
  }
  item.enabled = !item.enabled
  return item.enabled
}

export function resetAdminPassword(id: number): void {
  const item = adminAccounts.find((row) => row.id === id)
  if (!item) throw new Error('管理员不存在')
  /* 新密码经短信/邮件发送（演示） */
}

/* 机构端菜单权限（FR-PT-034） */
export const tenantMenus: TenantMenuItem[] = [
  {
    key: 'workspace', title: '工作台', enabled: true,
  },
  {
    key: 'question', title: '题目管理', enabled: true,
    children: [
      { key: 'question/list', title: '我的题库', enabled: true },
      { key: 'question/recommend', title: '推荐练习', enabled: true },
      { key: 'question/recycle', title: '题目回收站', enabled: true },
    ],
  },
  {
    key: 'paper', title: '试卷管理', enabled: true,
    children: [
      { key: 'paper/list', title: '我的试卷', enabled: true },
      { key: 'paper/parallel', title: '平行卷组', enabled: true },
    ],
  },
  {
    key: 'material', title: '教辅管理', enabled: true,
    children: [
      { key: 'material/library', title: '教辅资源库', enabled: true },
      { key: 'material/file', title: '我的文件', enabled: true },
    ],
  },
  {
    key: 'formula', title: '公式中心', enabled: true,
  },
  {
    key: 'square', title: '知识广场', enabled: true,
    children: [
      { key: 'square/public', title: '公开题库', enabled: true },
      { key: 'square/audit', title: '贡献与审核', enabled: true },
    ],
  },
  {
    key: 'org', title: '机构系统管理', enabled: true,
    children: [
      { key: 'org/staff', title: '员工与角色', enabled: true },
      { key: 'org/prompt', title: '机构提示词', enabled: true },
      { key: 'org/notice', title: '公告发布', enabled: true },
    ],
  },
]

export function getTenantMenus(): TenantMenuItem[] {
  return JSON.parse(JSON.stringify(tenantMenus)) as TenantMenuItem[]
}

export function saveTenantMenus(items: TenantMenuItem[]): void {
  tenantMenus.splice(0, tenantMenus.length, ...JSON.parse(JSON.stringify(items)))
}

/* ================= 消息中心 ================= */

export const notifications: PlatformNotification[] = [
  {
    id: 1, type: 'apply', title: '新的入驻申请',
    content: '「深圳市湾区国际学校」提交了入驻申请，包含 3 份资质材料，等待审核。',
    time: nowStr(-1.2), read: false,
  },
  {
    id: 2, type: 'quota', title: 'AI 额度预警',
    content: '「苏州工业园区星海中学」本月 AI 额度已使用 91%（9,100/10,000 次），请关注。',
    time: nowStr(-5), read: false,
  },
  {
    id: 3, type: 'quota', title: 'AI 额度耗尽',
    content: '「重庆巴蜀常春藤学校」本月 AI 额度已用尽，相关功能已限流。',
    time: nowStr(-9), read: false,
  },
  {
    id: 4, type: 'system', title: '模型健康检测异常',
    content: 'MathOCR-Pro 最近一次健康检测失败（超时），请及时处理或切换备用模型。',
    time: nowStr(-26), read: true,
  },
  {
    id: 5, type: 'apply', title: '入驻申请已驳回',
    content: '「西安领航考研培训学校」的申请已被驳回，原因：资质材料不完整。',
    time: nowStr(-50), read: true,
  },
  {
    id: 6, type: 'system', title: '编排配置已更新',
    content: '多智能体编排已保存为 v3（自动修复阈值 85% → 90%），仅对新任务生效。',
    time: nowStr(-72), read: true,
  },
]

export function listNotifications(): PlatformNotification[] {
  return [...notifications].sort((a, b) => b.time.localeCompare(a.time))
}

export function unreadNotificationCount(): number {
  return notifications.filter((item) => !item.read).length
}

export function markNotificationRead(id: number): void {
  const item = notifications.find((row) => row.id === id)
  if (item) item.read = true
}

export function markAllNotificationsRead(): void {
  notifications.forEach((item) => {
    item.read = true
  })
}
