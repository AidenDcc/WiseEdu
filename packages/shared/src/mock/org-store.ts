/**
 * 机构端业务 Mock 仓库（FR-TM / FR-PP / FR-JC / FR-FL / FR-FX / FR-PM / FR-SQ / FR-OS / FR-GN-015/030）。
 * 会话级可变状态：所有审批、生成、删除动作直接落到内存数据，刷新页面即还原（演示口径）。
 */
import type {
  AiCheckResult,
  Campus,
  DrawEditorType,
  FileFolder,
  GeneratedQuestion,
  MaterialExample,
  MaterialStatus,
  NotifyMatrixRow,
  OrgCategory,
  OrgFile,
  OrgKnowledgeNode,
  TextbookOption,
  OrgFormula,
  OrgMaterial,
  OrgMedia,
  OrgMessage,
  OrgOperationLog,
  OrgPaper,
  OrgPrompt,
  OrgQuestion,
  OrgRole,
  PaperSection,
  QuestionLibrary,
  QuestionStatus,
  RecycleItem,
  SquareResource,
  StaffMember,
  StandardFormula,
} from '../api/models'
import { registerMediaSrc, unregisterMediaSrc } from '../utils/media-ref'
/* 相对导入而非 '@aiteach/shared'：从 shared 内部引自己的桶文件会形成循环依赖 */
import { hasImage, sanitizeRichHtml, toPlainText, truncateRich } from '../utils/richtext'

function nowStr(offsetHours = 0): string {
  return new Date(Date.now() + offsetHours * 3600_000).toISOString().slice(0, 19).replace('T', ' ')
}

/** 当前登录机构用户（演示固定为 orgadmin；真实场景由 token 解析） */
export const CURRENT = { id: 101, name: '陈明远', role: 'orgAdmin' as 'orgAdmin' | 'auditor' | 'teacher' }

/** AI 额度（FR-TM-014） */
export const aiQuota = { used: 412, quota: 1000 }

export function estimateQuota(count: number): { cost: number; left: number; enough: boolean } {
  const cost = count
  const left = aiQuota.quota - aiQuota.used
  return { cost, left, enough: left >= cost }
}

export function consumeQuota(count: number): void {
  aiQuota.used += count
}

export const QUOTA_TEXT = { used: aiQuota.used, quota: aiQuota.quota }

/* ================= 分类树（FR-TM-001） ================= */

let categorySeq = 100
export const categories: OrgCategory[] = [
  { id: 1, name: '个人题库', library: 'personal', parentId: null, ownerId: 101 },
  { id: 2, name: '函数与导数', library: 'personal', parentId: 1, ownerId: 101 },
  { id: 3, name: '立体几何', library: 'personal', parentId: 1, ownerId: 101 },
  { id: 10, name: '机构公共题库', library: 'org', parentId: null, ownerId: 101 },
  { id: 11, name: '高一同步', library: 'org', parentId: 10, ownerId: 101 },
  { id: 12, name: '高三一轮复习', library: 'org', parentId: 10, ownerId: 101 },
  { id: 13, name: '语文专区', library: 'org', parentId: 10, ownerId: 101 },
  { id: 14, name: '英语专区', library: 'org', parentId: 10, ownerId: 101 },
  { id: 15, name: '物理专区', library: 'org', parentId: 10, ownerId: 101 },
  { id: 16, name: '化学专区', library: 'org', parentId: 10, ownerId: 101 },
  { id: 17, name: '小学专区', library: 'org', parentId: 10, ownerId: 101 },
  { id: 18, name: '初中专区', library: 'org', parentId: 10, ownerId: 101 },
  { id: 22, name: '生物专区', library: 'org', parentId: 10, ownerId: 101 },
  { id: 23, name: '政治专区', library: 'org', parentId: 10, ownerId: 101 },
  { id: 24, name: '历史专区', library: 'org', parentId: 10, ownerId: 101 },
  { id: 25, name: '地理专区', library: 'org', parentId: 10, ownerId: 101 },
  { id: 20, name: '错题库', library: 'wrong', parentId: null, ownerId: 101 },
]

export function saveCategory(input: Partial<OrgCategory> & { name: string }): OrgCategory {
  if (input.id != null) {
    const item = categories.find((row) => row.id === input.id)
    if (!item) throw new Error('分类不存在')
    if (categories.some((row) => row.id !== item.id && row.parentId === item.parentId && row.name === input.name)) {
      throw new Error('同级下已存在同名分类')
    }
    item.name = input.name
    return item
  }
  const parentId = input.parentId ?? null
  if (categories.some((row) => row.parentId === parentId && row.name === input.name)) {
    throw new Error('同级下已存在同名分类')
  }
  const parent = parentId != null ? categories.find((row) => row.id === parentId) : undefined
  const item: OrgCategory = {
    id: ++categorySeq,
    name: input.name,
    library: (parent?.library ?? input.library ?? 'personal') as QuestionLibrary,
    parentId,
    ownerId: input.ownerId ?? CURRENT.id,
  }
  categories.push(item)
  return item
}

export function deleteCategory(id: number): void {
  const item = categories.find((row) => row.id === id)
  if (!item) throw new Error('分类不存在')
  if (questions.some((q) => q.categoryId === id)) throw new Error('该分类下仍有题目，请先移出题目再删除')
  if (categories.some((row) => row.parentId === id)) throw new Error('请先删除子分类')
  categories.splice(categories.indexOf(item), 1)
}

/* ================= 题目（FR-TM-002 ~ 007 / 017 ~ 019 / 024 ~ 028） ================= */

/** 运行期新建题目的自增 id：种子题已占用 9001-9100，从其后开始避免撞号 */
let questionSeq = 9100

/** AI 多智能体检测结果（8 项，FR-AI-002） */
function aiChecksFor(stem: string, suspects: string[] = []): AiCheckResult[] {
  const base = [
    { name: '语义完整性', pass: true, note: '题干表述完整，无歧义' },
    { name: '计算验算', pass: true, note: '数值计算复核一致' },
    { name: 'LaTeX 公式', pass: true, note: '公式语法合法' },
    { name: '图形描述', pass: true, note: '无图形依赖' },
    {
      name: '知识点匹配',
      pass: true,
      note: '知识点与题干一致',
      fixed: toPlainText(stem).includes('抛物线') ? '「抛物线」→「二次函数图像」' : undefined,
    },
    { name: '难度匹配', pass: true, note: '难度系数与题干复杂度相符' },
    { name: '查重', pass: suspects.length === 0, note: suspects.length ? `与题库 1 题相似度 87%` : '未发现相似题' },
    { name: '试卷结构', pass: true, note: '单题不适用，通过' },
  ]
  return base
}

function seedQuestion(input: Partial<OrgQuestion> & { stem: string; id: number }): OrgQuestion {
  return {
    subject: '数学',
    grade: '高一',
    type: '单选题',
    difficulty: '中等',
    knowledge: ['函数与导数'],
    source: '手动录入',
    status: 'approved',
    library: 'org',
    categoryId: 11,
    ownerId: 103,
    owner: '李文博',
    options: [],
    answer: '',
    analysis: '',
    term: '上学期',
    examType: '期中考试',
    useCount: Math.floor(Math.random() * 40),
    updatedAt: nowStr(-Math.floor(Math.random() * 400)),
    ...input,
  } as OrgQuestion
}

export const questions: OrgQuestion[] = [
  seedQuestion({
    id: 9001,
    stem: '已知二次函数 f(x)=x²-2x-3，则其图像与 x 轴交点个数为（ ）',
    type: '单选题',
    options: ['0 个', '1 个', '2 个', '3 个'],
    answer: 'C',
    analysis: '令 f(x)=0，Δ=(-2)²+12=16>0，故有两个交点。',
    knowledge: ['二次函数', '函数与导数'],
    library: 'org',
    categoryId: 11,
    aiChecks: aiChecksFor(''),
  }),
  seedQuestion({
    id: 9002,
    stem: '求 ∁ᵤB（补集）：设全集 U={1,2,3,4,5}，B={2,4}，则 ∁ᵤB = ______',
    type: '填空题',
    answer: '{1,3,5}',
    analysis: '补集即全集中去掉 B 的元素。',
    knowledge: ['集合'],
    library: 'personal',
    categoryId: 2,
    owner: '陈明远',
    ownerId: 101,
    status: 'pending',
    source: 'AI 出题',
    examType: '随堂练习',
    aiChecks: aiChecksFor('', ['与题库第 9001 题设问结构相似']),
    aiSuspects: ['与题库第 9001 题设问结构相似（87%）'],
  }),
  seedQuestion({
    id: 9003,
    stem: '如图，正方体 ABCD-A₁B₁C₁D₁ 棱长为 2，求异面直线 AC 与 BD₁ 所成角的余弦值。',
    type: '解答题',
    answer: 'cosθ=√6/3',
    analysis: '建立空间直角坐标系，A(0,0,0)、C(2,2,0)、B(2,0,0)、D₁(0,2,2)，由向量法可得。',
    knowledge: ['立体几何', '空间向量'],
    difficulty: '困难',
    library: 'org',
    categoryId: 12,
    status: 'draft',
    term: '下学期',
    examType: '期末考试',
    owner: '陈明远',
    ownerId: 101,
  }),
  seedQuestion({
    id: 9004,
    stem: '下列函数中，在 (0,+∞) 上单调递增的是（ ）',
    type: '多选题',
    options: ['y=x³', 'y=1/x', 'y=√x', 'y=-x²+4x'],
    answer: 'AC',
    analysis: 'y=1/x 在 (0,+∞) 单调递减；y=-x²+4x 在 (2,+∞) 递减。',
    knowledge: ['函数单调性'],
    status: 'pending',
    source: '拍照识别',
    examType: '单元测试',
    library: 'personal',
    categoryId: 2,
    owner: '陈明远',
    ownerId: 101,
    aiChecks: aiChecksFor(''),
    aiSuspects: [],
  }),
  seedQuestion({
    id: 9005,
    stem: '已知等差数列 {aₙ} 中 a₁=2，公差 d=3，求 a₁₀。',
    type: '填空题',
    answer: '29',
    analysis: 'a₁₀=a₁+9d=2+27=29。',
    knowledge: ['数列'],
    status: 'rejected',
    reviewOpinion: '解析过简，请补充等差数列通项公式的推导过程。',
    term: '下学期',
    examType: '模拟考试',
    library: 'personal',
    categoryId: 2,
    owner: '陈明远',
    ownerId: 101,
  }),
  seedQuestion({
    id: 9006,
    stem: '判断：函数 y=|x| 在 x=0 处可导。',
    type: '判断题',
    options: ['正确', '错误'],
    answer: 'B',
    analysis: '左右导数分别为 -1 与 1，不相等，故不可导。',
    knowledge: ['导数概念'],
    status: 'approved',
    library: 'wrong',
    categoryId: 20,
    owner: '李文博',
  }),
  seedQuestion({
    id: 9007,
    stem: '已知抛物线 y²=4x 的焦点为 F，过 F 的直线交抛物线于 A、B 两点，|AB|=8，求直线斜率。',
    type: '解答题',
    answer: 'k=±1',
    analysis: '设直线 y=k(x-1)，联立抛物线方程，由焦点弦长公式 |AB|=4/k²·(1+k²) 得 k²=1。',
    knowledge: ['抛物线', '圆锥曲线'],
    difficulty: '困难',
    status: 'checking',
    source: 'AI 变式',
    variantOf: 9001,
    examType: '模拟考试',
    library: 'org',
    categoryId: 12,
    owner: '李文博',
  }),
  seedQuestion({
    id: 9008,
    stem: '化简：sin(α+β)cosβ - cos(α+β)sinβ = ______',
    type: '填空题',
    answer: 'sinα',
    analysis: '逆用两角差的正弦公式。',
    knowledge: ['三角恒等变换'],
    subject: '数学',
    grade: '高一',
    status: 'approved',
    term: '下学期',
    examType: '单元测试',
    library: 'org',
    categoryId: 11,
    owner: '沈丽华',
    ownerId: 102,
  }),

  /* ---- 扩充题库：数学（高一，对应 TREE_SPECS.数学 知识点） ---- */
  seedQuestion({
    id: 9009,
    stem: '已知集合 A={1,2,3}，B={2,3,4}，则 A∩B=（ ）',
    type: '单选题',
    difficulty: '容易',
    options: ['{1,2}', '{2,3}', '{3,4}', '{1,4}'],
    answer: 'B',
    analysis: '交集取两集合的公共元素，A 与 B 的公共元素为 2、3，故 A∩B={2,3}。',
    knowledge: ['集合'],
    library: 'org',
    categoryId: 11,
    examType: '随堂练习',
    source: '手动录入',
    owner: '李文博',
    ownerId: 103,
  }),
  seedQuestion({
    id: 9010,
    stem: '函数 f(x)=x²-4x+3 的单调递减区间是（ ）',
    type: '单选题',
    difficulty: '中等',
    options: ['(-∞,2)', '(2,+∞)', '(-∞,-2)', '(-2,+∞)'],
    answer: 'A',
    analysis: '二次函数开口向上，对称轴为 x=2，故在 (-∞,2) 上单调递减。',
    knowledge: ['函数单调性', '二次函数'],
    library: 'personal',
    categoryId: 2,
    examType: '单元测试',
    owner: '陈明远',
    ownerId: 101,
  }),
  seedQuestion({
    id: 9011,
    stem: '设函数 f(x)=x³-3x，则下列结论正确的是（ ）',
    type: '多选题',
    difficulty: '较难',
    options: [
      'f(x) 在 x=-1 处取得极大值',
      'f(x) 在 x=1 处取得极小值',
      'f(x) 恰有三个零点',
      'f(x) 在 R 上单调递增',
    ],
    answer: 'ABC',
    analysis: 'f′(x)=3x²-3=3(x-1)(x+1)：x=-1 处取极大值 f(-1)=2，x=1 处取极小值 f(1)=-2；极大值大于 0、极小值小于 0，故有三个零点；f′ 变号，D 错误。',
    knowledge: ['函数与导数'],
    library: 'org',
    categoryId: 11,
    term: '下学期',
    examType: '期中考试',
    source: 'AI 出题',
    aiChecks: aiChecksFor('设函数 f(x)=x³-3x'),
    owner: '李文博',
    ownerId: 103,
  }),
  seedQuestion({
    id: 9012,
    stem: '计算：log₂8 + lg100 = ______',
    type: '填空题',
    difficulty: '容易',
    answer: '5',
    analysis: 'log₂8=3，lg100=2，两者之和为 5。',
    knowledge: ['对数函数'],
    library: 'org',
    categoryId: 11,
    examType: '随堂练习',
    source: '手动录入',
    owner: '沈丽华',
    ownerId: 102,
  }),
  seedQuestion({
    id: 9013,
    stem: '已知 sinα=3/5，且 α∈(π/2,π)，则 cosα = ______',
    type: '填空题',
    difficulty: '中等',
    answer: '-4/5',
    analysis: '由 sin²α+cos²α=1 得 |cosα|=4/5；α 在第二象限，余弦值为负，故 cosα=-4/5。',
    knowledge: ['三角函数'],
    library: 'org',
    categoryId: 11,
    term: '下学期',
    examType: '单元测试',
    source: '手动录入',
    owner: '沈丽华',
    ownerId: 102,
  }),
  seedQuestion({
    id: 9014,
    stem: '已知等比数列 {aₙ} 中 a₁=2，a₃=8，且公比 q>0，求该数列的通项公式 aₙ 及前 n 项和 Sₙ。',
    type: '解答题',
    difficulty: '较难',
    answer: 'aₙ=2ⁿ，Sₙ=2ⁿ⁺¹-2',
    analysis: '由 a₃=a₁q² 得 q²=4，又 q>0，故 q=2，aₙ=2·2ⁿ⁻¹=2ⁿ；Sₙ=a₁(1-qⁿ)/(1-q)=2(2ⁿ-1)=2ⁿ⁺¹-2。',
    knowledge: ['数列'],
    library: 'org',
    categoryId: 11,
    term: '下学期',
    examType: '期末考试',
    source: '手动录入',
    owner: '李文博',
    ownerId: 103,
  }),
  seedQuestion({
    id: 9015,
    stem: '已知椭圆 x²/4+y²=1 的左、右焦点分别为 F₁、F₂，过 F₂ 的直线交椭圆于 A、B 两点，求 △F₁AB 的周长。',
    type: '解答题',
    difficulty: '困难',
    answer: '8',
    analysis: '由椭圆定义 |AF₁|+|AF₂|=2a=4，|BF₁|+|BF₂|=4，且 |AB|=|AF₂|+|BF₂|，故 △F₁AB 的周长 = |AF₁|+|BF₁|+|AB| = 4a = 8，与直线位置无关。',
    knowledge: ['圆锥曲线'],
    status: 'pending',
    library: 'org',
    categoryId: 11,
    term: '下学期',
    examType: '模拟考试',
    source: 'AI 出题',
    aiChecks: aiChecksFor('已知椭圆 x²/4+y²=1'),
    owner: '陈明远',
    ownerId: 101,
  }),
  seedQuestion({
    id: 9016,
    stem: '二次函数 y=x²+2x-3 的图像与 y 轴的交点坐标是（ ）',
    type: '单选题',
    difficulty: '较易',
    options: ['(0,-3)', '(-3,0)', '(0,3)', '(1,0)'],
    answer: 'A',
    analysis: '令 x=0 得 y=-3，故图像与 y 轴的交点为 (0,-3)。',
    knowledge: ['二次函数'],
    library: 'org',
    categoryId: 11,
    examType: '随堂练习',
    source: 'AI 变式',
    variantOf: 9001,
    owner: '李文博',
    ownerId: 103,
  }),
  seedQuestion({
    id: 9017,
    stem: '判断：函数 f(x)=|x-1| 在 x=1 处连续且可导。',
    type: '判断题',
    difficulty: '容易',
    options: ['正确', '错误'],
    answer: 'B',
    analysis: 'f(x) 在 x=1 处连续，但左右导数分别为 -1 与 1，不相等，故在该点不可导。',
    knowledge: ['导数概念'],
    library: 'personal',
    categoryId: 2,
    term: '下学期',
    examType: '随堂练习',
    source: '手动录入',
    owner: '陈明远',
    ownerId: 101,
  }),
  seedQuestion({
    id: 9018,
    stem: '已知正方体 ABCD-A₁B₁C₁D₁ 的棱长为 a，则该正方体外接球的表面积为（ ）',
    type: '单选题',
    difficulty: '中等',
    options: ['3πa²', '2πa²', 'πa²', '4πa²'],
    answer: 'A',
    analysis: '正方体外接球的直径等于其体对角线 √3a，半径 R=√3a/2，表面积 S=4πR²=3πa²。',
    knowledge: ['立体几何'],
    library: 'personal',
    categoryId: 3,
    examType: '单元测试',
    source: '手动录入',
    owner: '陈明远',
    ownerId: 101,
  }),
  seedQuestion({
    id: 9019,
    stem: '在空间直角坐标系中，已知向量 a=(1,0,-1)，b=(0,1,1)，则下列结论正确的是（ ）',
    type: '多选题',
    difficulty: '困难',
    options: ['a·b=1', '|a|=|b|', 'a 与 b 垂直', 'a+b=(1,1,0)'],
    answer: 'BD',
    analysis: 'a·b=1×0+0×1+(-1)×1=-1，A 错误；|a|=|b|=√2，B 正确；数量积不为 0，两向量不垂直，C 错误；a+b=(1,1,0)，D 正确。',
    knowledge: ['空间向量'],
    library: 'org',
    categoryId: 11,
    term: '上学期',
    examType: '期中考试',
    source: 'AI 出题',
    aiChecks: aiChecksFor('在空间直角坐标系中，已知向量'),
    owner: '沈丽华',
    ownerId: 102,
  }),
  seedQuestion({
    id: 9020,
    stem: '计算：(1/2)⁻² + 8^(1/3) = ______',
    type: '填空题',
    difficulty: '较易',
    answer: '6',
    analysis: '(1/2)⁻²=2²=4，8^(1/3)=2，两者之和为 6。',
    knowledge: ['指数函数'],
    library: 'org',
    categoryId: 11,
    examType: '单元测试',
    source: '手动录入',
    owner: '沈丽华',
    ownerId: 102,
  }),
  seedQuestion({
    id: 9021,
    stem: '已知直线 l 过点 P(1,2)，且与直线 2x-y+1=0 平行，求直线 l 的方程。',
    type: '解答题',
    difficulty: '中等',
    answer: '2x-y=0',
    analysis: '两直线平行则斜率相等，由 2x-y+1=0 得 k=2；由点斜式 y-2=2(x-1)，整理得 2x-y=0。',
    knowledge: ['解析几何'],
    library: 'org',
    categoryId: 11,
    term: '下学期',
    examType: '期末考试',
    source: '手动录入',
    owner: '李文博',
    ownerId: 103,
  }),
  seedQuestion({
    id: 9022,
    stem: '已知命题 p：对任意 x∈R，x²+ax+1>0 恒成立，则实数 a 的取值范围是 ______',
    type: '填空题',
    difficulty: '中等',
    answer: '-2<a<2',
    analysis: '二次项系数 1>0，恒成立只需判别式 Δ=a²-4<0，解得 -2<a<2。',
    knowledge: ['常用逻辑用语'],
    status: 'pending',
    library: 'org',
    categoryId: 11,
    term: '上学期',
    examType: '期中考试',
    source: 'AI 出题',
    aiChecks: aiChecksFor('已知命题 p：对任意 x∈R'),
    owner: '李文博',
    ownerId: 103,
  }),

  /* ---- 扩充题库：语文（一年级 ~ 高一，对应 TREE_SPECS.语文 知识点） ---- */
  seedQuestion({
    id: 9023,
    stem: '「春天来了，小草从地里钻出来。」句中「钻」字的正确读音是（ ）',
    type: '单选题',
    difficulty: '容易',
    subject: '语文',
    grade: '一年级',
    options: ['zuān', 'zuàn', 'chuān', 'zhuān'],
    answer: 'A',
    analysis: '「钻出来」表示穿过、进入，读 zuān；表示工具（如「电钻」）时才读 zuàn。',
    knowledge: ['语言文字运用'],
    library: 'org',
    categoryId: 13,
    examType: '随堂练习',
    source: '手动录入',
    owner: '沈丽华',
    ownerId: 102,
  }),
  seedQuestion({
    id: 9024,
    stem: '补写诗句：欲穷千里目，______。',
    type: '填空题',
    difficulty: '较易',
    subject: '语文',
    grade: '二年级',
    answer: '更上一层楼',
    analysis: '出自王之涣《登鹳雀楼》，全句为「欲穷千里目，更上一层楼」，表达积极进取之意。',
    knowledge: ['诗歌鉴赏'],
    library: 'org',
    categoryId: 13,
    term: '下学期',
    examType: '单元测试',
    source: '手动录入',
    owner: '沈丽华',
    ownerId: 102,
  }),
  seedQuestion({
    id: 9025,
    stem: '下列句中「之」字的用法与其他三项不同的一项是（ ）',
    type: '单选题',
    difficulty: '中等',
    subject: '语文',
    grade: '七年级',
    options: ['学而时习之', '择其善者而从之', '下车引之', '予独爱莲之出淤泥而不染'],
    answer: 'D',
    analysis: 'A、B、C 中的「之」均为代词，分别指代所学的内容、善者、元方；D 中的「之」用在主谓之间，取消句子独立性。',
    knowledge: ['实词虚词'],
    library: 'org',
    categoryId: 13,
    examType: '期中考试',
    source: '手动录入',
    owner: '陈明远',
    ownerId: 101,
  }),
  seedQuestion({
    id: 9026,
    stem: '阅读《秋天的怀念》选段，结合全文，说说作者为什么反复写「看花」这一细节，并分析其在文中的作用。',
    type: '解答题',
    difficulty: '较难',
    subject: '语文',
    grade: '七年级',
    answer: '「看花」是母亲生前的心愿，反复出现串联起母子情感的变化；既表现母亲的隐忍与深沉的爱，也寄托了作者对母亲的怀念与愧疚之情。',
    analysis: '需从「线索」与「情感载体」两个角度作答，并结合文中具体语句分析，答出情感变化过程。',
    knowledge: ['文学类文本'],
    status: 'pending',
    library: 'org',
    categoryId: 13,
    term: '下学期',
    examType: '期末考试',
    source: 'AI 出题',
    aiChecks: aiChecksFor('阅读《秋天的怀念》选段'),
    owner: '陈明远',
    ownerId: 101,
  }),
  seedQuestion({
    id: 9027,
    stem: '关于议论文常用的论证方法，下列说法正确的有（ ）',
    type: '多选题',
    difficulty: '中等',
    subject: '语文',
    grade: '八年级',
    options: [
      '举例论证通过典型事例证明论点',
      '道理论证引用名言警句增强说服力',
      '对比论证只能用于反驳错误观点',
      '比喻论证可以把抽象的道理讲得形象易懂',
    ],
    answer: 'ABD',
    analysis: '对比论证既能立论也能驳论，C 的表述过于绝对，错误；其余三项均是对应论证方法的正确描述。',
    knowledge: ['论述类文本'],
    library: 'org',
    categoryId: 13,
    examType: '单元测试',
    source: '手动录入',
    owner: '沈丽华',
    ownerId: 102,
  }),
  seedQuestion({
    id: 9028,
    stem: '判断：「令尊」「令堂」是对对方父母的尊称，「家父」「家母」是对自己父母的谦称。',
    type: '判断题',
    difficulty: '较易',
    subject: '语文',
    grade: '八年级',
    options: ['正确', '错误'],
    answer: 'A',
    analysis: '「令」用于敬称对方的亲属，「家」用于谦称自己的亲属，题干表述正确。',
    knowledge: ['古代文化常识'],
    library: 'org',
    categoryId: 13,
    term: '下学期',
    examType: '随堂练习',
    source: '手动录入',
    owner: '沈丽华',
    ownerId: 102,
  }),
  seedQuestion({
    id: 9029,
    stem: '翻译句子：所以遣将守关者，备他盗之出入与非常也。',
    type: '解答题',
    difficulty: '困难',
    subject: '语文',
    grade: '高一',
    answer: '派遣将领把守函谷关的原因，是为了防备其他盗贼进入和意外变故的发生。',
    analysis: '「……者，……也」为判断句式，此处表原因；「出入」是偏义复词，意义偏在「入」；「非常」为古今异义词，古义指意外的变故。',
    knowledge: ['断句与翻译'],
    library: 'org',
    categoryId: 13,
    term: '下学期',
    examType: '模拟考试',
    source: '手动录入',
    owner: '李文博',
    ownerId: 103,
  }),
  seedQuestion({
    id: 9030,
    stem: '杜甫《登高》中「______，不尽长江滚滚来」一句，写出了秋景的苍凉与时光的流逝。',
    type: '填空题',
    difficulty: '中等',
    subject: '语文',
    grade: '高一',
    answer: '无边落木萧萧下',
    analysis: '出自《登高》颔联，「落木」与「长江」对举，意境开阔而沉郁，为全诗名句。',
    knowledge: ['诗歌鉴赏'],
    library: 'org',
    categoryId: 13,
    examType: '期中考试',
    source: '手动录入',
    owner: '李文博',
    ownerId: 103,
  }),
  seedQuestion({
    id: 9031,
    stem: '下列词语中，表示颜色的有（ ）',
    type: '多选题',
    difficulty: '容易',
    subject: '语文',
    grade: '一年级',
    options: ['碧绿', '雪白', '火红', '飞快'],
    answer: 'ABC',
    analysis: '「碧绿」「雪白」「火红」都表示颜色，「飞快」形容速度，不表示颜色。',
    knowledge: ['语言文字运用'],
    library: 'org',
    categoryId: 13,
    term: '下学期',
    examType: '随堂练习',
    source: '手动录入',
    owner: '沈丽华',
    ownerId: 102,
  }),
  seedQuestion({
    id: 9032,
    stem: '「弯弯的月亮像一只小船。」这句话使用的修辞手法是（ ）',
    type: '单选题',
    difficulty: '较易',
    subject: '语文',
    grade: '二年级',
    options: ['比喻', '拟人', '夸张', '排比'],
    answer: 'A',
    analysis: '句中用「小船」来比「月亮」，两者在形状上有相似点，属于比喻中的明喻。',
    knowledge: ['语言文字运用'],
    library: 'org',
    categoryId: 13,
    examType: '单元测试',
    source: '手动录入',
    owner: '沈丽华',
    ownerId: 102,
  }),

  /* ---- 扩充题库：英语（一年级 ~ 高一，对应 TREE_SPECS.英语 知识点） ---- */
  seedQuestion({
    id: 9033,
    stem: '— How old are you?  — ______',
    type: '单选题',
    difficulty: '容易',
    subject: '英语',
    grade: '一年级',
    options: ['I am six.', 'I am fine.', 'It is six.', 'Yes, I am.'],
    answer: 'A',
    analysis: 'How old 用于询问年龄，答语用「I am + 数字」；How are you 才用 I am fine 作答。',
    knowledge: ['阅读理解'],
    library: 'org',
    categoryId: 14,
    examType: '随堂练习',
    source: '手动录入',
    owner: '沈丽华',
    ownerId: 102,
  }),
  seedQuestion({
    id: 9034,
    stem: 'My mother ______ breakfast for us every morning.',
    type: '单选题',
    difficulty: '较易',
    subject: '英语',
    grade: '二年级',
    options: ['makes', 'make', 'making', 'made'],
    answer: 'A',
    analysis: 'every morning 表明是一般现在时，主语 My mother 为第三人称单数，谓语动词用 makes。',
    knowledge: ['时态语态'],
    status: 'rejected',
    reviewOpinion: '解析过简，请补充一般现在时第三人称单数的变化规则说明。',
    library: 'org',
    categoryId: 14,
    term: '下学期',
    examType: '单元测试',
    source: '手动录入',
    owner: '沈丽华',
    ownerId: 102,
  }),
  seedQuestion({
    id: 9035,
    stem: 'Look! The children ______ football on the playground.',
    type: '单选题',
    difficulty: '中等',
    subject: '英语',
    grade: '七年级',
    options: ['are playing', 'play', 'played', 'have played'],
    answer: 'A',
    analysis: 'Look! 提示动作正在发生，应用现在进行时，主语 The children 为复数，故用 are playing。',
    knowledge: ['时态语态'],
    library: 'org',
    categoryId: 14,
    examType: '期中考试',
    source: '手动录入',
    owner: '陈明远',
    ownerId: 101,
  }),
  seedQuestion({
    id: 9036,
    stem: '用所给动词的适当形式填空：He ______ (visit) his grandparents last weekend.',
    type: '填空题',
    difficulty: '中等',
    subject: '英语',
    grade: '七年级',
    answer: 'visited',
    analysis: 'last weekend 是一般过去时的时间状语，visit 的过去式直接加 -ed，为 visited。',
    knowledge: ['时态语态'],
    library: 'org',
    categoryId: 14,
    term: '下学期',
    examType: '单元测试',
    source: '手动录入',
    owner: '陈明远',
    ownerId: 101,
  }),
  seedQuestion({
    id: 9037,
    stem: '下列句子中，含有宾语从句的有（ ）',
    type: '多选题',
    difficulty: '较难',
    subject: '英语',
    grade: '八年级',
    options: [
      'I know that he is a doctor.',
      'The book which I bought is interesting.',
      'Tell me where he lives.',
      'When I got home, my mother was cooking.',
    ],
    answer: 'AC',
    analysis: 'A 中 that 引导宾语从句，C 中 where 引导宾语从句；B 为定语从句，D 为时间状语从句，均不作宾语。',
    knowledge: ['从句'],
    status: 'pending',
    library: 'org',
    categoryId: 14,
    examType: '期中考试',
    source: 'AI 出题',
    aiChecks: aiChecksFor('下列句子中，含有宾语从句的有'),
    owner: '李文博',
    ownerId: 103,
  }),
  seedQuestion({
    id: 9038,
    stem: '以 My Weekend 为题，写一篇不少于 60 词的短文，介绍你上个周末的活动安排，要求至少使用三种不同的时态。',
    type: '解答题',
    difficulty: '较难',
    subject: '英语',
    grade: '八年级',
    answer: '参考范文（略）：需用一般过去时叙述上周活动，用一般现在时描述周末习惯，用一般将来时说明下个周末计划，全文语句连贯、时态准确。',
    analysis: '评分要点：要点齐全、三种时态使用正确、语法与拼写错误少、字数达标、书写规范。',
    knowledge: ['书面表达'],
    library: 'org',
    categoryId: 14,
    term: '下学期',
    examType: '期末考试',
    source: '手动录入',
    owner: '李文博',
    ownerId: 103,
  }),
  seedQuestion({
    id: 9039,
    stem: '______ from the top of the hill, the city looks beautiful.',
    type: '单选题',
    difficulty: '中等',
    subject: '英语',
    grade: '高一',
    options: ['Seen', 'Seeing', 'To see', 'See'],
    answer: 'A',
    analysis: '句中逻辑主语 the city 与 see 之间是被动关系，故用过去分词 Seen 作状语。',
    knowledge: ['非谓语动词'],
    library: 'org',
    categoryId: 14,
    examType: '单元测试',
    source: '手动录入',
    owner: '陈明远',
    ownerId: 101,
  }),
  seedQuestion({
    id: 9040,
    stem: '假设你是李华，你的英国朋友 Peter 对中国的传统节日很感兴趣，请给他写一封 80 词左右的邮件，介绍春节的主要习俗并邀请他来中国体验。',
    type: '解答题',
    difficulty: '困难',
    subject: '英语',
    grade: '高一',
    answer: '参考范文（略）：需包含节日时间、主要习俗（贴春联、吃年夜饭、拜年、放鞭炮等）以及明确的邀请意图，邮件格式正确、语言得体。',
    analysis: '评分要点：邮件格式（称呼、正文、落款）、要点覆盖完整、语言得体、语法与拼写准确、词数达标。',
    knowledge: ['书面表达'],
    library: 'org',
    categoryId: 14,
    term: '下学期',
    examType: '模拟考试',
    source: 'AI 出题',
    aiChecks: aiChecksFor('假设你是李华，你的英国朋友 Peter'),
    owner: '李文博',
    ownerId: 103,
  }),
  seedQuestion({
    id: 9041,
    stem: '阅读短文，选择最佳答案：Tom is a student. He gets up at six every day. He goes to school at seven. — What time does Tom get up?',
    type: '单选题',
    difficulty: '容易',
    subject: '英语',
    grade: '高一',
    options: ['At six.', 'At seven.', 'At eight.', 'At nine.'],
    answer: 'A',
    analysis: '短文第二句明确说明 He gets up at six every day，故答案为 At six。',
    knowledge: ['阅读理解'],
    library: 'org',
    categoryId: 14,
    examType: '随堂练习',
    source: '手动录入',
    owner: '沈丽华',
    ownerId: 102,
  }),

  /* ---- 扩充题库：物理（八年级 / 高一，对应 TREE_SPECS.物理 知识点） ---- */
  seedQuestion({
    id: 9042,
    stem: '一辆汽车以 20 m/s 的速度在平直公路上匀速行驶，10 s 内通过的路程是（ ）',
    type: '单选题',
    difficulty: '容易',
    subject: '物理',
    grade: '八年级',
    options: ['200 m', '20 m', '2 m', '2000 m'],
    answer: 'A',
    analysis: '匀速直线运动 s=vt，代入得 s=20 m/s×10 s=200 m。',
    knowledge: ['匀变速直线运动'],
    library: 'org',
    categoryId: 15,
    examType: '随堂练习',
    source: '手动录入',
    owner: '李文博',
    ownerId: 103,
  }),
  seedQuestion({
    id: 9043,
    stem: '两个力的大小分别为 3 N 和 4 N，方向互相垂直，则它们的合力大小为 ______ N。',
    type: '填空题',
    difficulty: '中等',
    subject: '物理',
    grade: '八年级',
    answer: '5',
    analysis: '两力互相垂直，由勾股定理得合力 F=√(3²+4²)=5 N。',
    knowledge: ['力的合成'],
    library: 'org',
    categoryId: 15,
    status: 'draft',
    examType: '单元测试',
    source: '手动录入',
    owner: '李文博',
    ownerId: 103,
  }),
  seedQuestion({
    id: 9044,
    stem: '质量为 2 kg 的物体放在水平地面上，受到 10 N 的水平拉力，物体与地面间的滑动摩擦力为 4 N，求物体运动的加速度大小。',
    type: '解答题',
    difficulty: '较难',
    subject: '物理',
    grade: '八年级',
    answer: 'a=3 m/s²',
    analysis: '物体所受合力 F合=10 N-4 N=6 N，由牛顿第二定律 a=F合/m=6 N÷2 kg=3 m/s²。',
    knowledge: ['牛顿运动定律'],
    library: 'org',
    categoryId: 15,
    term: '下学期',
    examType: '期中考试',
    source: '手动录入',
    owner: '陈明远',
    ownerId: 101,
  }),
  seedQuestion({
    id: 9045,
    stem: '判断：物体所受合外力为零时，一定处于静止状态。',
    type: '判断题',
    difficulty: '较易',
    subject: '物理',
    grade: '八年级',
    options: ['正确', '错误'],
    answer: 'B',
    analysis: '合外力为零时物体处于平衡状态，可能静止，也可能做匀速直线运动，故该说法错误。',
    knowledge: ['牛顿运动定律'],
    library: 'org',
    categoryId: 15,
    term: '下学期',
    examType: '随堂练习',
    source: '手动录入',
    owner: '陈明远',
    ownerId: 101,
  }),
  seedQuestion({
    id: 9046,
    stem: '真空中两个点电荷之间的静电力大小，与它们之间距离的关系是（ ）',
    type: '单选题',
    difficulty: '中等',
    subject: '物理',
    grade: '高一',
    options: ['与距离成正比', '与距离成反比', '与距离的平方成正比', '与距离的平方成反比'],
    answer: 'D',
    analysis: '由库仑定律 F=kq₁q₂/r² 可知，静电力与两电荷间距离的平方成反比。',
    knowledge: ['静电场'],
    library: 'org',
    categoryId: 15,
    examType: '期中考试',
    source: '手动录入',
    owner: '沈丽华',
    ownerId: 102,
  }),
  seedQuestion({
    id: 9047,
    stem: '关于闭合电路，下列说法正确的有（ ）',
    type: '多选题',
    difficulty: '较难',
    subject: '物理',
    grade: '高一',
    options: [
      '电源电动势等于内、外电路电压之和',
      '外电路电阻增大时，路端电压增大',
      '外电路短路时，路端电压达到最大',
      '电源电动势在数值上等于非静电力把 1 C 正电荷从负极移到正极所做的功',
    ],
    answer: 'ABD',
    analysis: '短路时外电阻为零，路端电压为零而非最大，C 错误；其余三项均正确描述了电动势与闭合电路的性质。',
    knowledge: ['恒定电流'],
    status: 'checking',
    library: 'org',
    categoryId: 15,
    examType: '期末考试',
    source: 'AI 出题',
    aiChecks: aiChecksFor('关于闭合电路'),
    owner: '沈丽华',
    ownerId: 102,
  }),
  seedQuestion({
    id: 9048,
    stem: '长为 L 的导体棒在磁感应强度为 B 的匀强磁场中，以速度 v 沿垂直于磁场的方向做切割磁感线运动，求导体棒两端产生的感应电动势大小，并说明判断感应电流方向的方法。',
    type: '解答题',
    difficulty: '困难',
    subject: '物理',
    grade: '高一',
    answer: 'E=BLv；感应电流的方向用右手定则（或楞次定律）判断。',
    analysis: '导体棒垂直切割磁感线时 E=BLv；方向判断：右手定则适用于导体切割磁感线的情形，楞次定律适用于一切电磁感应现象。',
    knowledge: ['电磁感应'],
    status: 'pending',
    library: 'org',
    categoryId: 15,
    term: '下学期',
    examType: '模拟考试',
    source: 'AI 出题',
    aiChecks: aiChecksFor('长为 L 的导体棒在磁感应强度为 B 的匀强磁场中', ['与题库第 9003 题设问结构相似']),
    aiSuspects: ['与题库第 9003 题设问结构相似（81%）'],
    owner: '李文博',
    ownerId: 103,
  }),
  seedQuestion({
    id: 9049,
    stem: '物体做自由落体运动（g 取 10 m/s²），下落 2 s 时的速度大小为（ ）',
    type: '单选题',
    difficulty: '较易',
    subject: '物理',
    grade: '高一',
    options: ['10 m/s', '20 m/s', '40 m/s', '5 m/s'],
    answer: 'B',
    analysis: '自由落体是初速度为零的匀加速直线运动，v=gt=10 m/s²×2 s=20 m/s。',
    knowledge: ['匀变速直线运动'],
    library: 'org',
    categoryId: 15,
    examType: '单元测试',
    source: '手动录入',
    owner: '李文博',
    ownerId: 103,
  }),
  seedQuestion({
    id: 9050,
    stem: '穿过某线圈的磁通量在 0.2 s 内由 0.1 Wb 均匀增加到 0.5 Wb，则线圈中产生的感应电动势大小为 ______ V。',
    type: '填空题',
    difficulty: '中等',
    subject: '物理',
    grade: '高一',
    answer: '2',
    analysis: '由法拉第电磁感应定律 E=ΔΦ/Δt=(0.5 Wb-0.1 Wb)÷0.2 s=2 V。',
    knowledge: ['电磁感应'],
    status: 'draft',
    library: 'org',
    categoryId: 15,
    term: '下学期',
    examType: '期末考试',
    source: '手动录入',
    owner: '陈明远',
    ownerId: 101,
  }),

  /* ---- 扩充题库：化学（高一，对应 TREE_SPECS.化学 知识点） ---- */
  seedQuestion({
    id: 9051,
    stem: '1 mol 任何物质中都含有的粒子数约为（ ）',
    type: '单选题',
    difficulty: '容易',
    subject: '化学',
    grade: '高一',
    options: ['6.02×10²³', '6.02×10²²', '3.01×10²³', '1.204×10²⁴'],
    answer: 'A',
    analysis: '阿伏加德罗常数 NA≈6.02×10²³ mol⁻¹，即 1 mol 任何物质含有的粒子数约为 6.02×10²³。',
    knowledge: ['物质的量'],
    library: 'org',
    categoryId: 16,
    examType: '随堂练习',
    source: '手动录入',
    owner: '沈丽华',
    ownerId: 102,
  }),
  seedQuestion({
    id: 9052,
    stem: '下列离子方程式书写正确的是（ ）',
    type: '单选题',
    difficulty: '中等',
    subject: '化学',
    grade: '高一',
    options: [
      '氢氧化钠溶液与盐酸反应：OH⁻+H⁺=H₂O',
      '碳酸钙与稀盐酸反应：CO₃²⁻+2H⁺=H₂O+CO₂↑',
      '铁与稀盐酸反应：2Fe+6H⁺=2Fe³⁺+3H₂↑',
      '硫酸铜溶液与氢氧化钡溶液反应：Ba²⁺+SO₄²⁻=BaSO₄↓',
    ],
    answer: 'A',
    analysis: '碳酸钙难溶于水，应写化学式，B 错误；铁与稀盐酸反应生成 Fe²⁺ 而非 Fe³⁺，C 错误；D 漏写了 Cu²⁺ 与 OH⁻ 生成 Cu(OH)₂ 沉淀，错误。',
    knowledge: ['离子反应'],
    library: 'org',
    categoryId: 16,
    examType: '单元测试',
    source: '手动录入',
    owner: '李文博',
    ownerId: 103,
  }),
  seedQuestion({
    id: 9053,
    stem: '关于氧化还原反应，下列说法正确的有（ ）',
    type: '多选题',
    difficulty: '较难',
    subject: '化学',
    grade: '高一',
    options: [
      '氧化反应是指元素化合价升高的反应',
      '还原剂在反应中被氧化',
      '氧化剂在反应中得到电子',
      '置换反应一定属于氧化还原反应',
    ],
    answer: 'ABCD',
    analysis: '四项均符合氧化还原反应的基本概念；置换反应中必有单质参与和生成，一定伴随元素化合价的变化。',
    knowledge: ['氧化还原反应'],
    library: 'org',
    categoryId: 16,
    examType: '期中考试',
    source: 'AI 出题',
    aiChecks: aiChecksFor('关于氧化还原反应'),
    owner: '沈丽华',
    ownerId: 102,
  }),
  seedQuestion({
    id: 9054,
    stem: '元素周期表中，同周期元素从左到右，原子半径逐渐 ______（填「增大」或「减小」）。',
    type: '填空题',
    difficulty: '中等',
    subject: '化学',
    grade: '高一',
    answer: '减小',
    analysis: '同周期从左到右核电荷数依次增大，原子核对最外层电子的吸引增强，原子半径逐渐减小。',
    knowledge: ['元素周期律'],
    library: 'org',
    categoryId: 16,
    term: '下学期',
    examType: '期末考试',
    source: '手动录入',
    owner: '陈明远',
    ownerId: 101,
  }),
  seedQuestion({
    id: 9055,
    stem: '判断：所有的酸碱中和反应都属于离子反应。',
    type: '判断题',
    difficulty: '较易',
    subject: '化学',
    grade: '高一',
    options: ['正确', '错误'],
    answer: 'A',
    analysis: '酸碱中和反应的实质是 H⁺ 与 OH⁻ 结合生成水，属于离子反应，故该说法正确。',
    knowledge: ['离子反应'],
    library: 'org',
    categoryId: 16,
    term: '下学期',
    examType: '随堂练习',
    source: '手动录入',
    owner: '沈丽华',
    ownerId: 102,
  }),
  seedQuestion({
    id: 9056,
    stem: '已知短周期元素 X 原子的最外层电子数是其电子层数的 2 倍，且 X 的最高价氧化物对应的水化物为强酸。推断 X 是哪种元素，并写出推断过程。',
    type: '解答题',
    difficulty: '困难',
    subject: '化学',
    grade: '高一',
    answer: 'X 为硫元素（S）。',
    analysis: '短周期元素中，最外层电子数是电子层数 2 倍的有碳（2 层 4 电子）和硫（3 层 6 电子）；其中最高价氧化物对应的水化物为强酸的只有硫，对应硫酸，故 X 为硫。',
    knowledge: ['元素周期律'],
    status: 'pending',
    library: 'org',
    categoryId: 16,
    term: '下学期',
    examType: '模拟考试',
    source: 'AI 出题',
    aiChecks: aiChecksFor('已知短周期元素 X 原子的最外层电子数是其电子层数的 2 倍'),
    owner: '李文博',
    ownerId: 103,
  }),
  seedQuestion({
    id: 9057,
    stem: '标准状况下，11.2 L 由 CO 和 CO₂ 组成的混合气体，所含氧原子的物质的量不可能是（ ）',
    type: '单选题',
    difficulty: '较难',
    subject: '化学',
    grade: '高一',
    options: ['0.3 mol', '0.5 mol', '0.7 mol', '0.8 mol'],
    answer: 'A',
    analysis: '混合气体总物质的量为 11.2 L÷22.4 L/mol=0.5 mol；设 CO₂ 为 x mol，则氧原子为 2x+(0.5-x)=0.5+x，x∈[0,0.5]，故氧原子物质的量范围为 0.5~1.0 mol，0.3 mol 不可能。',
    knowledge: ['物质的量'],
    library: 'org',
    categoryId: 16,
    examType: '期中考试',
    source: 'AI 出题',
    aiChecks: aiChecksFor('标准状况下，11.2 L 由 CO 和 CO₂ 组成的混合气体'),
    owner: '李文博',
    ownerId: 103,
  }),
  seedQuestion({
    id: 9058,
    stem: '在反应 Fe + CuSO₄ = FeSO₄ + Cu 中，还原剂是 ______。',
    type: '填空题',
    difficulty: '容易',
    subject: '化学',
    grade: '高一',
    answer: 'Fe（铁）',
    analysis: 'Fe 的化合价由 0 升高到 +2，失去电子被氧化，作还原剂；Cu²⁺ 得电子被还原，CuSO₄ 作氧化剂。',
    knowledge: ['氧化还原反应'],
    library: 'org',
    categoryId: 16,
    term: '下学期',
    examType: '单元测试',
    source: '手动录入',
    owner: '沈丽华',
    ownerId: 102,
  }),

  /* ---- 扩充题库：生物（九年级 / 高二，对应 TREE_SPECS.初中:生物 · 生物） ---- */
  seedQuestion({
    id: 9059,
    stem: '细胞中控制物质进出、具有选择透过性的结构是（ ）',
    type: '单选题',
    difficulty: '容易',
    subject: '生物',
    grade: '九年级',
    options: ['细胞壁', '细胞膜', '细胞核', '液泡'],
    answer: 'B',
    analysis: '细胞膜具有选择透过性，控制物质进出细胞；细胞壁起支持和保护作用，是全透性的。',
    knowledge: ['细胞'],
    library: 'org',
    categoryId: 22,
    term: '上学期',
    examType: '单元测试',
    source: '手动录入',
    owner: '沈丽华',
    ownerId: 102,
  }),
  seedQuestion({
    id: 9060,
    stem: '一个完整的生态系统由 ______ 和 ______ 两部分组成。',
    type: '填空题',
    difficulty: '中等',
    subject: '生物',
    grade: '九年级',
    answer: '生物部分（生产者、消费者、分解者）；非生物部分',
    analysis: '生态系统 = 生物部分 + 非生物的物质和能量。生物部分按营养方式分为生产者、消费者、分解者。',
    knowledge: ['生态系统'],
    library: 'org',
    categoryId: 22,
    term: '上学期',
    examType: '期末考试',
    source: '手动录入',
    owner: '沈丽华',
    ownerId: 102,
  }),
  seedQuestion({
    id: 9061,
    stem: '简述食物中的淀粉在人体内被消化和吸收的主要过程。',
    type: '解答题',
    difficulty: '中等',
    subject: '生物',
    grade: '九年级',
    answer:
      '淀粉在口腔中经唾液淀粉酶初步分解为麦芽糖；进入小肠后，在肠液、胰液中的淀粉酶和麦芽糖酶作用下最终分解为葡萄糖。葡萄糖主要在小肠绒毛处经主动运输被吸收进入血液，随血液循环运往全身组织细胞氧化供能。',
    analysis: '得分点：①口腔初步消化 ②小肠内最终水解为葡萄糖 ③吸收部位是小肠绒毛 ④吸收方式为主动运输。',
    knowledge: ['消化与吸收'],
    library: 'org',
    categoryId: 22,
    term: '下学期',
    examType: '期中考试',
    source: '手动录入',
    owner: '李文博',
    ownerId: 103,
  }),
  seedQuestion({
    id: 9062,
    stem: '孟德尔一对相对性状的杂交实验中，F₁ 自交所得 F₂ 的性状分离比是（ ）',
    type: '单选题',
    difficulty: '中等',
    subject: '生物',
    grade: '高二',
    options: ['1 : 1', '3 : 1', '9 : 3 : 3 : 1', '1 : 2 : 1'],
    answer: 'B',
    analysis: 'F₁ 为杂合子 Dd，自交后代基因型比为 1DD : 2Dd : 1dd，表现型比为显性 : 隐性 = 3 : 1。',
    knowledge: ['遗传定律'],
    library: 'org',
    categoryId: 22,
    term: '上学期',
    examType: '月考',
    source: '手动录入',
    owner: '李文博',
    ownerId: 103,
  }),
  seedQuestion({
    id: 9063,
    stem: '细胞膜的基本支架是 ______，组成它的元素除 C、H、O 外还含有 ______。',
    type: '填空题',
    difficulty: '中等',
    subject: '生物',
    grade: '高二',
    answer: '磷脂双分子层；N、P',
    analysis: '流动镶嵌模型认为磷脂双分子层构成基本支架，蛋白质镶嵌、贯穿或覆盖其中。磷脂含 N、P 元素。',
    knowledge: ['细胞结构'],
    library: 'org',
    categoryId: 22,
    term: '上学期',
    examType: '随堂练习',
    source: '手动录入',
    owner: '沈丽华',
    ownerId: 102,
  }),
  seedQuestion({
    id: 9064,
    stem: '简述基因表达的过程，并说明转录和翻译在细胞中的发生场所。',
    type: '解答题',
    difficulty: '困难',
    subject: '生物',
    grade: '高二',
    answer:
      '基因表达包括转录和翻译两个阶段。转录：以 DNA 的一条链为模板，在 RNA 聚合酶催化下合成 mRNA，发生场所主要是细胞核。翻译：以 mRNA 为模板，在核糖体上按碱基互补配对原则由 tRNA 转运氨基酸，合成具有一定氨基酸序列的多肽链。',
    analysis: '得分点：①转录的模板、酶、产物、场所 ②翻译的模板、场所、运载工具 ③中心法则 DNA→mRNA→蛋白质。',
    knowledge: ['基因表达'],
    library: 'org',
    categoryId: 22,
    term: '下学期',
    examType: '期末考试',
    source: '手动录入',
    owner: '李文博',
    ownerId: 103,
  }),
  seedQuestion({
    id: 9065,
    stem: '判断：兴奋在离体神经纤维上可以双向传导，但在突触处只能由突触前膜向突触后膜单向传递。',
    type: '判断题',
    difficulty: '容易',
    subject: '生物',
    grade: '高二',
    options: ['正确', '错误'],
    answer: 'A',
    analysis: '神经纤维上兴奋以局部电流形式双向传导；突触处神经递质只能由突触前膜释放、作用于突触后膜，故单向传递。',
    knowledge: ['神经调节'],
    library: 'org',
    categoryId: 22,
    term: '上学期',
    examType: '专题训练',
    source: '手动录入',
    owner: '沈丽华',
    ownerId: 102,
  }),

  /* ---- 扩充题库：政治（九年级 / 高二，对应 TREE_SPECS.初中:政治 · 政治） ---- */
  seedQuestion({
    id: 9066,
    stem: '进入青春期后，下列对待自身身体变化的做法恰当的是（ ）',
    type: '单选题',
    difficulty: '容易',
    subject: '政治',
    grade: '九年级',
    options: ['因身高变化而自卑', '正视变化并保持规律作息与适度锻炼', '盲目节食控制体重', '拒绝与同学交往'],
    answer: 'B',
    analysis: '青春期身体变化是正常的生理现象，应科学认识、坦然接纳，通过规律作息和适度锻炼促进健康成长。',
    knowledge: ['认识自我'],
    library: 'org',
    categoryId: 23,
    term: '上学期',
    examType: '随堂练习',
    source: '手动录入',
    owner: '沈丽华',
    ownerId: 102,
  }),
  seedQuestion({
    id: 9067,
    stem: '结合所学知识，说明法律在保护未成年人健康成长中的主要作用。',
    type: '解答题',
    difficulty: '中等',
    subject: '政治',
    grade: '九年级',
    answer:
      '①法律为未成年人健康成长提供专门保护，《未成年人保护法》《预防未成年人犯罪法》构筑了家庭、学校、社会、网络、政府、司法六大保护体系；②法律规范社会成员的行为，制裁侵害未成年人合法权益的违法行为；③法律为未成年人维护自身合法权益提供救济途径，未成年人应学会依法维权。',
    analysis: '得分点：①专门法律与六大保护 ②制裁侵权行为的规范作用 ③依法维权的途径。',
    knowledge: ['法律基础'],
    library: 'org',
    categoryId: 23,
    term: '下学期',
    examType: '期末考试',
    source: '手动录入',
    owner: '沈丽华',
    ownerId: 102,
  }),
  seedQuestion({
    id: 9068,
    stem: '判断：积极参与社会公益活动、主动承担力所能及的社会责任，是公民意识的重要体现。',
    type: '判断题',
    difficulty: '容易',
    subject: '政治',
    grade: '九年级',
    options: ['正确', '错误'],
    answer: 'A',
    analysis: '承担社会责任不分大小，参与公益、服务社会是公民责任感的体现，也是社会主义核心价值观的要求。',
    knowledge: ['社会责任'],
    library: 'org',
    categoryId: 23,
    term: '上学期',
    examType: '单元测试',
    source: '手动录入',
    owner: '李文博',
    ownerId: 103,
  }),
  seedQuestion({
    id: 9069,
    stem: '在其他条件不变的情况下，某商品价格下降，通常会导致（ ）',
    type: '单选题',
    difficulty: '中等',
    subject: '政治',
    grade: '高二',
    options: ['该商品需求量减少', '该商品需求量增加', '该商品供给量必然增加', '该商品需求量保持不变'],
    answer: 'B',
    analysis: '价格与需求量呈反向变动：价格下降，需求量增加。供给量与价格同向变动，价格下降一般使供给量减少。',
    knowledge: ['价格与消费'],
    library: 'org',
    categoryId: 23,
    term: '上学期',
    examType: '月考',
    source: '手动录入',
    owner: '李文博',
    ownerId: 103,
  }),
  seedQuestion({
    id: 9070,
    stem: '我国政府的基本职能包括（ ）',
    type: '多选题',
    difficulty: '中等',
    subject: '政治',
    grade: '高二',
    options: [
      '保障人民民主和维护国家长治久安',
      '组织社会主义经济建设',
      '组织社会主义文化建设',
      '加强社会建设、推进生态文明建设',
    ],
    answer: 'ABCD',
    analysis: '我国政府的基本职能共四项：政治职能、经济职能、文化职能、社会建设与生态文明建设职能，四项全选。',
    knowledge: ['公民与政府'],
    library: 'org',
    categoryId: 23,
    term: '下学期',
    examType: '期中考试',
    source: '手动录入',
    owner: '沈丽华',
    ownerId: 102,
  }),
  seedQuestion({
    id: 9071,
    stem: '运用唯物辩证法矛盾观的相关知识，分析说明为什么要在发展中既要抓住重点又要统筹兼顾。',
    type: '解答题',
    difficulty: '困难',
    subject: '政治',
    grade: '高二',
    answer:
      '①矛盾具有普遍性，要承认矛盾、分析矛盾、敢于揭露矛盾；②主要矛盾在事物发展中处于支配地位、起决定作用，要求我们集中力量抓重点、抓关键；③主次矛盾相互依赖、相互影响，次要矛盾也会影响主要矛盾的解决，因此必须统筹兼顾、恰当处理次要矛盾；④矛盾的主次方面要求我们分清主流与支流，坚持两点论与重点论的统一。',
    analysis: '得分点：①矛盾普遍性 ②主要矛盾决定作用→抓重点 ③主次矛盾关系→统筹兼顾 ④两点论与重点论统一。',
    knowledge: ['唯物辩证法'],
    library: 'org',
    categoryId: 23,
    term: '下学期',
    examType: '高考真题',
    source: '手动录入',
    owner: '李文博',
    ownerId: 103,
  }),
  seedQuestion({
    id: 9072,
    stem: '文化的传承与发展，既要 ______ 优秀传统文化，又要面向世界、博采众长，不断 ______ 。',
    type: '填空题',
    difficulty: '较易',
    subject: '政治',
    grade: '高二',
    answer: '继承；推陈出新（革故鼎新）',
    analysis: '对待传统文化应“取其精华、去其糟粕”，推陈出新、革故鼎新；对外来文化应面向世界、博采众长。',
    knowledge: ['文化传承'],
    library: 'org',
    categoryId: 23,
    term: '上学期',
    examType: '随堂练习',
    source: '手动录入',
    owner: '沈丽华',
    ownerId: 102,
  }),

  /* ---- 扩充题库：历史（九年级 / 高二，对应 TREE_SPECS.初中:历史 · 历史） ---- */
  seedQuestion({
    id: 9073,
    stem: '秦朝为加强对地方的控制，在全国范围内推行的制度是（ ）',
    type: '单选题',
    difficulty: '容易',
    subject: '历史',
    grade: '九年级',
    options: ['分封制', '郡县制', '行省制', '三省六部制'],
    answer: 'B',
    analysis: '秦统一后废分封、行郡县，郡县长官由皇帝直接任免，加强了中央对地方的控制。行省制始于元朝。',
    knowledge: ['秦汉大一统'],
    library: 'org',
    categoryId: 24,
    term: '上学期',
    examType: '单元测试',
    source: '手动录入',
    owner: '李文博',
    ownerId: 103,
  }),
  seedQuestion({
    id: 9074,
    stem: '洋务运动前期以“______”为口号，后期以“______”为口号。',
    type: '填空题',
    difficulty: '中等',
    subject: '历史',
    grade: '九年级',
    answer: '自强；求富',
    analysis: '洋务运动前期创办军事工业，口号是“自强”；后期创办民用工业，口号是“求富”。',
    knowledge: ['近代化探索'],
    library: 'org',
    categoryId: 24,
    term: '上学期',
    examType: '期末考试',
    source: '手动录入',
    owner: '沈丽华',
    ownerId: 102,
  }),
  seedQuestion({
    id: 9075,
    stem: '简述第一次工业革命的主要成果，并说明它对社会生产组织方式产生的影响。',
    type: '解答题',
    difficulty: '中等',
    subject: '历史',
    grade: '九年级',
    answer:
      '主要成果：哈格里夫斯发明珍妮机、瓦特改良蒸汽机、史蒂芬孙发明火车机车、富尔顿发明汽船。影响：机器生产取代手工劳动，工厂制度确立并逐渐取代手工工场，人类进入“蒸汽时代”；生产力大幅提高，社会日益分裂为工业资产阶级和无产阶级两大对立阶级。',
    analysis: '得分点：①珍妮机、改良蒸汽机、火车/汽船 ②工厂制度确立 ③进入蒸汽时代 ④阶级结构变化。',
    knowledge: ['工业革命'],
    library: 'org',
    categoryId: 24,
    term: '下学期',
    examType: '期中考试',
    source: '手动录入',
    owner: '李文博',
    ownerId: 103,
  }),
  seedQuestion({
    id: 9076,
    stem: '标志着中国新民主主义革命开端的历史事件是（ ）',
    type: '单选题',
    difficulty: '中等',
    subject: '历史',
    grade: '高二',
    options: ['辛亥革命', '五四运动', '中共一大召开', '南昌起义'],
    answer: 'B',
    analysis: '1919 年五四运动中工人阶级登上政治舞台并发挥主力军作用，标志着中国新民主主义革命的开端。',
    knowledge: ['新民主主义革命'],
    library: 'org',
    categoryId: 24,
    term: '上学期',
    examType: '月考',
    source: '手动录入',
    owner: '沈丽华',
    ownerId: 102,
  }),
  seedQuestion({
    id: 9077,
    stem: '明清时期加强君主专制的措施有（ ）',
    type: '多选题',
    difficulty: '中等',
    subject: '历史',
    grade: '高二',
    options: ['明太祖废除丞相制度', '明成祖设立内阁', '清雍正帝设置军机处', '元朝实行行省制度'],
    answer: 'ABC',
    analysis: '废丞相、设内阁、设军机处均为明清强化皇权的措施；行省制是元朝的地方行政制度，不属于明清措施。',
    knowledge: ['明清时期'],
    library: 'org',
    categoryId: 24,
    term: '下学期',
    examType: '模拟考试',
    source: '手动录入',
    owner: '沈丽华',
    ownerId: 102,
  }),
  seedQuestion({
    id: 9078,
    stem: '分析两次世界大战爆发的共同原因，并说明第二次世界大战后国际格局的变化。',
    type: '解答题',
    difficulty: '困难',
    subject: '历史',
    grade: '高二',
    answer:
      '共同原因：①帝国主义国家政治经济发展不平衡是根本原因；②列强争夺殖民地与势力范围、重新瓜分世界的矛盾激化；③军事集团对立与扩军备战；④绥靖政策助长了侵略气焰。战后格局变化：欧洲中心地位衰落，美苏崛起并形成两极对峙格局，联合国成立，世界殖民体系逐步瓦解。',
    analysis: '得分点：①经济政治发展不平衡（根本） ②争夺殖民地与势力范围 ③军事集团与绥靖政策 ④美苏两极格局与联合国成立。',
    knowledge: ['两次世界大战'],
    library: 'org',
    categoryId: 24,
    term: '下学期',
    examType: '高考真题',
    source: '手动录入',
    owner: '李文博',
    ownerId: 103,
  }),
  seedQuestion({
    id: 9079,
    stem: '英国于 1689 年颁布《______》，以法律形式确立了君主立宪制；美国于 1787 年制定宪法，确立了 ______ 制。',
    type: '填空题',
    difficulty: '较易',
    subject: '历史',
    grade: '高二',
    answer: '权利法案；联邦（共和）',
    analysis: '《权利法案》限制王权、确立议会至上；1787 年美国宪法确立联邦制、三权分立与共和制。',
    knowledge: ['资本主义制度'],
    library: 'org',
    categoryId: 24,
    term: '上学期',
    examType: '随堂练习',
    source: '手动录入',
    owner: '沈丽华',
    ownerId: 102,
  }),

  /* ---- 扩充题库：地理（九年级 / 高二，对应 TREE_SPECS.初中:地理 · 地理） ---- */
  seedQuestion({
    id: 9080,
    stem: '关于经纬网的说法，正确的是（ ）',
    type: '单选题',
    difficulty: '容易',
    subject: '地理',
    grade: '九年级',
    options: ['经线指示东西方向', '所有纬线长度都相等', '经线指示南北方向', '赤道是最长的经线'],
    answer: 'C',
    analysis: '经线连接南北两极，指示南北方向；纬线指示东西方向，长度由赤道向两极递减。赤道是最长的纬线。',
    knowledge: ['经纬网'],
    library: 'org',
    categoryId: 25,
    term: '上学期',
    examType: '随堂练习',
    source: '手动录入',
    owner: '沈丽华',
    ownerId: 102,
  }),
  seedQuestion({
    id: 9081,
    stem: '地中海气候的主要特征是：夏季 ______ ，冬季 ______ 。',
    type: '填空题',
    difficulty: '中等',
    subject: '地理',
    grade: '九年级',
    answer: '炎热干燥；温和多雨',
    analysis: '地中海气候受副热带高气压带与西风带交替控制，夏季受副高控制炎热干燥，冬季受西风带控制温和多雨。',
    knowledge: ['气候类型'],
    library: 'org',
    categoryId: 25,
    term: '上学期',
    examType: '期末考试',
    source: '手动录入',
    owner: '李文博',
    ownerId: 103,
  }),
  seedQuestion({
    id: 9082,
    stem: '简述我国地势西高东低、呈阶梯状分布的特点对气候和河流的影响。',
    type: '解答题',
    difficulty: '中等',
    subject: '地理',
    grade: '九年级',
    answer:
      '对气候的影响：①地势西高东低有利于海洋暖湿气流深入内陆，带来丰沛降水；②阶梯交界处地势落差大，气候垂直差异显著。对河流的影响：①使大江大河自西向东奔流入海，沟通东西交通；②阶梯交界处落差大、水能资源丰富，适宜建设水电站。',
    analysis: '得分点：气候方面——利于海洋气流深入、垂直差异明显；河流方面——自西向东流向、水能丰富。',
    knowledge: ['中国地形'],
    library: 'org',
    categoryId: 25,
    term: '下学期',
    examType: '期中考试',
    source: '手动录入',
    owner: '沈丽华',
    ownerId: 102,
  }),
  seedQuestion({
    id: 9083,
    stem: '形成季风环流的主要原因是（ ）',
    type: '单选题',
    difficulty: '中等',
    subject: '地理',
    grade: '高二',
    options: ['海陆热力性质差异', '地球自转偏向力', '太阳辐射的纬度差异', '地形起伏'],
    answer: 'A',
    analysis: '东亚季风形成的主要原因是海陆热力性质差异；南亚季风还叠加了气压带风带的季节移动。',
    knowledge: ['大气运动'],
    library: 'org',
    categoryId: 25,
    term: '上学期',
    examType: '月考',
    source: '手动录入',
    owner: '李文博',
    ownerId: 103,
  }),
  seedQuestion({
    id: 9084,
    stem: '下列环节属于海陆间水循环的有（ ）',
    type: '多选题',
    difficulty: '较难',
    subject: '地理',
    grade: '高二',
    options: ['海水蒸发', '水汽输送', '大气降水与下渗', '地表径流与地下径流'],
    answer: 'ABCD',
    analysis: '海陆间循环的完整环节为：蒸发→水汽输送→降水→下渗→径流（地表、地下）→回归海洋，四项均属于。',
    knowledge: ['水循环'],
    library: 'org',
    categoryId: 25,
    term: '下学期',
    examType: '学业水平考试',
    source: '手动录入',
    owner: '沈丽华',
    ownerId: 102,
  }),
  seedQuestion({
    id: 9085,
    stem: '分析影响农业区位选择的主要因素，并结合实例说明其影响。',
    type: '解答题',
    difficulty: '困难',
    subject: '地理',
    grade: '高二',
    answer:
      '①自然因素：气候（热量、光照、降水）决定作物种类与熟制，如我国南方适宜水稻；地形影响农业类型，平原宜耕、山地宜林牧；土壤肥力影响作物产量；水源是干旱区农业的主导因素，如绿洲农业。②社会经济因素：市场决定生产类型与规模，如城市郊区形成蔬菜花卉带；交通与保鲜技术扩大市场范围；政策提供引导与补贴；劳动力与科技影响生产效率和品质。',
    analysis: '得分点：自然因素四类各举一例 + 社会经济因素（市场、交通、政策、科技）+ 主导因素随地域变化。',
    knowledge: ['工农业区位'],
    library: 'org',
    categoryId: 25,
    term: '下学期',
    examType: '高考真题',
    source: '手动录入',
    owner: '李文博',
    ownerId: 103,
  }),
  seedQuestion({
    id: 9086,
    stem: '衡量一个国家或地区城市化水平的主要标志是 ______ 占总人口的比重。',
    type: '填空题',
    difficulty: '容易',
    subject: '地理',
    grade: '高二',
    answer: '城市人口',
    analysis: '城市化水平通常用城市人口占总人口的比重来衡量，该比重越高，城市化水平越高。',
    knowledge: ['人口与城市'],
    library: 'org',
    categoryId: 25,
    term: '上学期',
    examType: '随堂练习',
    source: '手动录入',
    owner: '沈丽华',
    ownerId: 102,
  }),

  /* ---- 扩充题库：小学段（三~六年级，补齐新增年级） ---- */
  seedQuestion({
    id: 9087,
    stem: '下列词语中书写完全正确的一项是（ ）',
    type: '单选题',
    difficulty: '容易',
    subject: '语文',
    grade: '三年级',
    options: ['迫不急待', '一如既往', '无微不致', '再接再励'],
    answer: 'B',
    analysis: 'A 应为“迫不及待”，C 应为“无微不至”，D 应为“再接再厉”，只有 B 项书写正确。',
    knowledge: ['词语积累'],
    library: 'org',
    categoryId: 17,
    term: '上学期',
    examType: '单元测试',
    source: '手动录入',
    owner: '沈丽华',
    ownerId: 102,
  }),
  seedQuestion({
    id: 9088,
    stem: '计算：25 × 4 + 36 ÷ 6 = ______ 。',
    type: '填空题',
    difficulty: '中等',
    subject: '数学',
    grade: '三年级',
    answer: '106',
    analysis: '先乘除后加减：25 × 4 = 100，36 ÷ 6 = 6，100 + 6 = 106。',
    knowledge: ['四则运算'],
    library: 'org',
    categoryId: 17,
    term: '下学期',
    examType: '期末考试',
    source: '手动录入',
    owner: '沈丽华',
    ownerId: 102,
  }),
  seedQuestion({
    id: 9089,
    stem: '由 3 个万、5 个千和 7 个一组成的数是（ ）',
    type: '单选题',
    difficulty: '容易',
    subject: '数学',
    grade: '四年级',
    options: ['35007', '3507', '30507', '35700'],
    answer: 'A',
    analysis: '3 个万是 30000，5 个千是 5000，7 个一是 7，合起来是 30000 + 5000 + 7 = 35007。',
    knowledge: ['数的认识'],
    library: 'org',
    categoryId: 17,
    term: '上学期',
    examType: '随堂练习',
    source: '手动录入',
    owner: '李文博',
    ownerId: 103,
  }),
  seedQuestion({
    id: 9090,
    stem: '选出与 book 属于同一类的一项（ ）',
    type: '单选题',
    difficulty: '中等',
    subject: '英语',
    grade: '四年级',
    options: ['desk', 'run', 'red', 'happy'],
    answer: 'A',
    analysis: 'book 与 desk 均为名词（物品类）；run 是动词，red 是颜色形容词，happy 是情绪形容词。',
    knowledge: ['词汇积累'],
    library: 'org',
    categoryId: 17,
    term: '上学期',
    examType: '单元测试',
    source: '手动录入',
    owner: '沈丽华',
    ownerId: 102,
  }),
  seedQuestion({
    id: 9091,
    stem: '一辆汽车 3 小时行驶 180 千米。照这样的速度，行驶 300 千米需要多少小时？',
    type: '解答题',
    difficulty: '中等',
    subject: '数学',
    grade: '五年级',
    answer: '5 小时',
    analysis: '先求速度：180 ÷ 3 = 60（千米/时）；再求时间：300 ÷ 60 = 5（小时）。',
    knowledge: ['应用题'],
    library: 'org',
    categoryId: 17,
    term: '下学期',
    examType: '期中考试',
    source: '手动录入',
    owner: '李文博',
    ownerId: 103,
  }),
  seedQuestion({
    id: 9092,
    stem: '《题西林壁》中“不识庐山真面目”的下一句是“______”。',
    type: '填空题',
    difficulty: '容易',
    subject: '语文',
    grade: '五年级',
    answer: '只缘身在此山中',
    analysis: '出自苏轼《题西林壁》，全诗借观山说明“当局者迷、旁观者清”的道理。',
    knowledge: ['课文理解'],
    library: 'org',
    categoryId: 17,
    term: '上学期',
    examType: '随堂练习',
    source: '手动录入',
    owner: '沈丽华',
    ownerId: 102,
  }),
  seedQuestion({
    id: 9093,
    stem: '一个圆的半径是 3 厘米，它的周长是（ ）厘米。',
    type: '单选题',
    difficulty: '中等',
    subject: '数学',
    grade: '六年级',
    options: ['6', '9.42', '18.84', '28.26'],
    answer: 'C',
    analysis: '圆周长 C = 2πr = 2 × 3.14 × 3 = 18.84（厘米）。28.26 是面积 πr²，注意区分。',
    knowledge: ['周长与面积'],
    library: 'org',
    categoryId: 17,
    term: '下学期',
    examType: '期末考试',
    source: '手动录入',
    owner: '李文博',
    ownerId: 103,
  }),
  seedQuestion({
    id: 9094,
    stem: '— How ______ you? — I\'m fine, thank you.',
    type: '填空题',
    difficulty: '较易',
    subject: '英语',
    grade: '六年级',
    answer: 'are',
    analysis: '主语 you 搭配 be 动词 are，构成日常问候语 How are you?',
    knowledge: ['情景交际'],
    library: 'org',
    categoryId: 17,
    term: '上学期',
    examType: '随堂练习',
    source: '手动录入',
    owner: '沈丽华',
    ownerId: 102,
  }),

  /* ---- 扩充题库：九年级 · 高三（补齐新增年级） ---- */
  seedQuestion({
    id: 9095,
    stem: '下列化学方程式书写完全正确的是（ ）',
    type: '单选题',
    difficulty: '中等',
    subject: '化学',
    grade: '九年级',
    options: ['2H₂ + O₂ 点燃 2H₂O', 'H₂ + O₂ 点燃 H₂O', '2H₂ + O₂ = 2H₂O↑', 'H₂ + O₂ = H₂O₂'],
    answer: 'A',
    analysis: '化学方程式须配平并注明条件。B 未配平，C 反应物中有气体、生成物不需标“↑”，D 产物错误。',
    knowledge: ['化学方程式'],
    library: 'org',
    categoryId: 18,
    term: '上学期',
    examType: '单元测试',
    source: '手动录入',
    owner: '沈丽华',
    ownerId: 102,
  }),
  seedQuestion({
    id: 9096,
    stem: '已知二次函数 y = x² - 4x + 3。(1) 求其图像的顶点坐标；(2) 求图像与 x 轴交点的坐标。',
    type: '解答题',
    difficulty: '困难',
    subject: '数学',
    grade: '九年级',
    answer: '(1) 顶点 (2, -1)；(2) 交点 (1, 0) 与 (3, 0)',
    analysis: '(1) 配方得 y=(x-2)²-1，顶点 (2,-1)。(2) 令 y=0，x²-4x+3=0，因式分解 (x-1)(x-3)=0，得 x=1 或 x=3。',
    knowledge: ['二次函数'],
    library: 'org',
    categoryId: 18,
    term: '下学期',
    examType: '期末考试',
    source: '手动录入',
    owner: '李文博',
    ownerId: 103,
  }),
  seedQuestion({
    id: 9097,
    stem: '已知椭圆 C: x²/4 + y²/3 = 1 的左、右焦点分别为 F₁、F₂，P 为椭圆上一点且 ∠F₁PF₂ = 90°，求 △F₁PF₂ 的面积。',
    type: '解答题',
    difficulty: '困难',
    subject: '数学',
    grade: '高三',
    answer: '面积为 3',
    analysis: 'a=2，b=√3，c=1。设 |PF₁|=m，|PF₂|=n，则 m+n=2a=4，且 m²+n²=(2c)²=4。由 (m+n)²=m²+n²+2mn 得 16=4+2mn，mn=6。面积 S=½mn=3。',
    knowledge: ['圆锥曲线'],
    library: 'org',
    categoryId: 12,
    term: '下学期',
    examType: '高考真题',
    source: '手动录入',
    owner: '陈明远',
    ownerId: 101,
  }),
  seedQuestion({
    id: 9098,
    stem: '关于电磁感应现象，下列说法正确的有（ ）',
    type: '多选题',
    difficulty: '较难',
    subject: '物理',
    grade: '高三',
    options: [
      '只要穿过闭合回路的磁通量发生变化，回路中就会产生感应电流',
      '感应电流的磁场总是阻碍引起感应电流的磁通量的变化',
      '感应电动势的大小与磁通量的大小成正比',
      '感应电动势的大小与磁通量的变化率成正比',
    ],
    answer: 'ABD',
    analysis: 'C 错：由法拉第电磁感应定律 E = nΔΦ/Δt，感应电动势与磁通量的变化率成正比，而不是与磁通量本身成正比。',
    knowledge: ['电磁感应'],
    library: 'org',
    categoryId: 15,
    term: '上学期',
    examType: '模拟考试',
    source: '手动录入',
    owner: '李文博',
    ownerId: 103,
  }),
  seedQuestion({
    id: 9099,
    stem: '古人所称“而立之年”指的是 ______ 岁，“不惑之年”指的是 ______ 岁。',
    type: '填空题',
    difficulty: '中等',
    subject: '语文',
    grade: '高三',
    answer: '三十；四十',
    analysis: '出自《论语·为政》：“三十而立，四十而不惑，五十而知天命，六十而耳顺，七十而从心所欲”。',
    knowledge: ['古代文化常识'],
    library: 'org',
    categoryId: 13,
    term: '上学期',
    examType: '月考',
    source: '手动录入',
    owner: '沈丽华',
    ownerId: 102,
  }),
  seedQuestion({
    id: 9100,
    stem: '写出实验室用二氧化锰与浓盐酸制取氯气的化学方程式，并标出电子转移的方向和数目。',
    type: '解答题',
    difficulty: '困难',
    subject: '化学',
    grade: '高三',
    answer: 'MnO₂ + 4HCl(浓) 加热 MnCl₂ + Cl₂↑ + 2H₂O；Mn 由 +4 降为 +2，得 2e⁻，2 个 Cl 由 -1 升为 0，共失 2e⁻，转移电子数为 2e⁻。',
    analysis: '得分点：①方程式配平与反应条件 ②标出“双线桥”方向 ③转移电子数为 2e⁻（4 mol HCl 中仅 2 mol 被氧化）。',
    knowledge: ['氧化还原反应'],
    library: 'org',
    categoryId: 16,
    term: '下学期',
    examType: '高考真题',
    source: '手动录入',
    owner: '李文博',
    ownerId: 103,
  }),
]

/* ================= 知识点树 / 教材级联（FR-TM-002） ================= */

/** 小学段通用学科（一~六年级） */
const PRIMARY_SUBJECTS: TextbookOption['subjects'] = [
  { name: '语文', versions: ['部编版', '人教版'] },
  { name: '数学', versions: ['人教版', '北师大版'] },
  { name: '英语', versions: ['人教新起点', '外研版'] },
]

/** 初中段七/八年级共有的学科（八年级另加物理） */
const JUNIOR_CORE: TextbookOption['subjects'] = [
  { name: '语文', versions: ['部编版'] },
  { name: '数学', versions: ['人教版', '北师大版', '苏科版'] },
  { name: '英语', versions: ['人教版', '外研版'] },
  { name: '生物', versions: ['人教版', '苏教版'] },
  { name: '政治', versions: ['人教版'] },
  { name: '历史', versions: ['部编版'] },
  { name: '地理', versions: ['人教版', '湘教版'] },
]

/** 高中段学科（高一/高二同版） */
const SENIOR_SUBJECTS: TextbookOption['subjects'] = [
  { name: '语文', versions: ['人教版', '部编版'] },
  { name: '数学', versions: ['人教A版', '北师大版', '苏教版'] },
  { name: '英语', versions: ['人教版', '外研版'] },
  { name: '物理', versions: ['人教版', '沪科版'] },
  { name: '化学', versions: ['人教版', '鲁科版'] },
  { name: '生物', versions: ['人教版', '苏教版'] },
  { name: '政治', versions: ['人教版'] },
  { name: '历史', versions: ['部编版'] },
  { name: '地理', versions: ['人教版', '湘教版'] },
]

/** 年级 → 学科 → 教材版本 级联矩阵（学科选项在选定年级后动态显示） */
export const textbookMatrix: TextbookOption[] = [
  { grade: '一年级', subjects: PRIMARY_SUBJECTS },
  { grade: '二年级', subjects: PRIMARY_SUBJECTS },
  {
    grade: '三年级',
    subjects: [
      { name: '语文', versions: ['部编版', '人教版'] },
      { name: '数学', versions: ['人教版', '北师大版'] },
      { name: '英语', versions: ['人教PEP', '外研版'] },
    ],
  },
  {
    grade: '四年级',
    subjects: [
      { name: '语文', versions: ['部编版', '人教版'] },
      { name: '数学', versions: ['人教版', '北师大版'] },
      { name: '英语', versions: ['人教PEP', '外研版'] },
    ],
  },
  {
    grade: '五年级',
    subjects: [
      { name: '语文', versions: ['部编版', '人教版'] },
      { name: '数学', versions: ['人教版', '北师大版'] },
      { name: '英语', versions: ['人教PEP', '外研版'] },
    ],
  },
  {
    grade: '六年级',
    subjects: [
      { name: '语文', versions: ['部编版', '人教版'] },
      { name: '数学', versions: ['人教版', '北师大版'] },
      { name: '英语', versions: ['人教PEP', '外研版'] },
    ],
  },
  { grade: '七年级', subjects: JUNIOR_CORE },
  { grade: '八年级', subjects: [...JUNIOR_CORE, { name: '物理', versions: ['人教版', '沪科版'] }] },
  {
    grade: '九年级',
    subjects: [
      { name: '语文', versions: ['部编版'] },
      { name: '数学', versions: ['人教版', '北师大版'] },
      { name: '英语', versions: ['人教版', '外研版'] },
      { name: '物理', versions: ['人教版', '沪科版'] },
      { name: '化学', versions: ['人教版', '鲁教版'] },
      { name: '生物', versions: ['人教版'] },
      { name: '政治', versions: ['人教版'] },
      { name: '历史', versions: ['部编版'] },
      { name: '地理', versions: ['人教版'] },
    ],
  },
  { grade: '高一', subjects: SENIOR_SUBJECTS },
  { grade: '高二', subjects: SENIOR_SUBJECTS },
  {
    grade: '高三',
    subjects: [
      { name: '语文', versions: ['人教版'] },
      { name: '数学', versions: ['人教A版'] },
      { name: '英语', versions: ['人教版'] },
      { name: '物理', versions: ['人教版'] },
      { name: '化学', versions: ['人教版'] },
      { name: '生物', versions: ['人教版'] },
      { name: '政治', versions: ['人教版'] },
      { name: '历史', versions: ['部编版'] },
      { name: '地理', versions: ['人教版'] },
    ],
  },
]

/** 知识点树定义（叶子 tag 与题目 knowledge 值保持一致） */
interface TreeSpec {
  name: string
  tag?: string
  children?: TreeSpec[]
}

type Stage = '小学' | '初中' | '高中'

/** 由年级名推导学段：一~六年级 → 小学；七/八/九年级 → 初中；高* → 高中 */
export function stageOfGrade(grade: string): Stage | null {
  if (!grade) return null
  if (grade.startsWith('高')) return '高中'
  const first = grade[0]
  if ('一二三四五六'.includes(first)) return '小学'
  if ('七八九'.includes(first)) return '初中'
  return null
}

/**
 * 键格式：`学段:学科`（学段限定，优先命中）| `学科`（该学科默认，兼作高中树）。
 * 高中刻意不单独建键 —— 裸键本身就是高中内容，这样 listKnowledgeTree('高一','数学',…) 的结果
 * 与拆分前逐字一致，不影响既有题目。
 */
const TREE_SPECS: Record<string, TreeSpec[]> = {
  /* ---------- 小学 ---------- */
  '小学:语文': [
    {
      name: '识字与写字',
      children: [
        { name: '拼音与汉字', tag: '拼音与汉字' },
        { name: '词语积累', tag: '词语积累' },
      ],
    },
    {
      name: '阅读',
      children: [
        { name: '课文理解', tag: '课文理解' },
        { name: '古诗诵读', tag: '诗歌鉴赏' },
      ],
    },
    {
      name: '表达',
      children: [
        { name: '看图写话', tag: '看图写话' },
        { name: '语言运用', tag: '语言文字运用' },
      ],
    },
  ],
  '小学:数学': [
    {
      name: '数与代数',
      children: [
        { name: '数的认识', tag: '数的认识' },
        { name: '四则运算', tag: '四则运算' },
        { name: '简易方程', tag: '简易方程' },
      ],
    },
    {
      name: '图形与几何',
      children: [
        { name: '图形的认识', tag: '图形的认识' },
        { name: '周长与面积', tag: '周长与面积' },
      ],
    },
    {
      name: '统计与概率',
      children: [{ name: '数据统计', tag: '数据统计' }],
    },
    { name: '解决问题', tag: '应用题' },
  ],
  '小学:英语': [
    {
      name: '语音与词汇',
      children: [
        { name: '字母与音标', tag: '字母与音标' },
        { name: '词汇积累', tag: '词汇积累' },
      ],
    },
    {
      name: '语法基础',
      children: [
        { name: '一般时态', tag: '时态语态' },
        { name: '名词与代词', tag: '名词与代词' },
      ],
    },
    {
      name: '语言技能',
      children: [
        { name: '短文阅读', tag: '阅读理解' },
        { name: '情景交际', tag: '情景交际' },
      ],
    },
  ],

  /* ---------- 初中 ---------- */
  '初中:语文': [
    {
      name: '文言文阅读',
      children: [
        { name: '实词虚词', tag: '实词虚词' },
        { name: '断句与翻译', tag: '断句与翻译' },
        { name: '古代文化常识', tag: '古代文化常识' },
      ],
    },
    {
      name: '现代文阅读',
      children: [
        { name: '议论文阅读', tag: '论述类文本' },
        { name: '记叙文阅读', tag: '文学类文本' },
      ],
    },
    {
      name: '写作',
      children: [
        { name: '记叙文写作', tag: '记叙文写作' },
        { name: '议论文写作', tag: '议论文写作' },
      ],
    },
  ],
  '初中:数学': [
    {
      name: '数与式',
      children: [
        { name: '有理数与实数', tag: '有理数与实数' },
        { name: '整式与分式', tag: '整式与分式' },
      ],
    },
    {
      name: '方程与不等式',
      children: [
        { name: '一元一次方程', tag: '一元一次方程' },
        { name: '一元二次方程', tag: '一元二次方程' },
        { name: '不等式', tag: '不等式' },
      ],
    },
    {
      name: '函数',
      children: [
        { name: '一次函数', tag: '一次函数' },
        { name: '反比例函数', tag: '反比例函数' },
        { name: '二次函数', tag: '二次函数' },
      ],
    },
    {
      name: '几何',
      children: [
        { name: '三角形', tag: '三角形' },
        { name: '四边形', tag: '四边形' },
        { name: '圆', tag: '圆' },
      ],
    },
    { name: '统计与概率', tag: '统计与概率' },
  ],
  '初中:英语': [
    {
      name: '语法专项',
      children: [
        { name: '时态与语态', tag: '时态语态' },
        { name: '从句', tag: '从句' },
        { name: '非谓语动词', tag: '非谓语动词' },
      ],
    },
    {
      name: '题型专项',
      children: [
        { name: '完形填空', tag: '完形填空' },
        { name: '阅读理解', tag: '阅读理解' },
        { name: '书面表达', tag: '书面表达' },
      ],
    },
  ],
  '初中:物理': [
    {
      name: '机械运动',
      children: [
        { name: '长度与时间测量', tag: '长度与时间测量' },
        { name: '运动与速度', tag: '匀变速直线运动' },
      ],
    },
    {
      name: '力与运动',
      children: [
        { name: '力的合成', tag: '力的合成' },
        { name: '二力平衡', tag: '二力平衡' },
        { name: '牛顿运动定律', tag: '牛顿运动定律' },
      ],
    },
    {
      name: '声与光',
      children: [
        { name: '声现象', tag: '声现象' },
        { name: '光的反射与折射', tag: '光的反射' },
      ],
    },
    {
      name: '电与磁',
      children: [
        { name: '电流与电路', tag: '电流与电路' },
        { name: '欧姆定律', tag: '欧姆定律' },
      ],
    },
  ],
  '初中:化学': [
    {
      name: '物质的构成',
      children: [
        { name: '分子与原子', tag: '分子与原子' },
        { name: '元素与元素符号', tag: '元素与元素符号' },
      ],
    },
    {
      name: '化学方程式',
      children: [
        { name: '质量守恒定律', tag: '质量守恒定律' },
        { name: '化学方程式', tag: '化学方程式' },
      ],
    },
    {
      name: '身边的化学物质',
      children: [
        { name: '氧气与二氧化碳', tag: '氧气与二氧化碳' },
        { name: '金属与酸', tag: '金属与酸' },
      ],
    },
    {
      name: '实验与计算',
      children: [
        { name: '实验操作', tag: '实验操作' },
        { name: '溶质质量分数', tag: '溶质质量分数' },
      ],
    },
  ],
  '初中:生物': [
    {
      name: '生物体的结构层次',
      children: [
        { name: '细胞', tag: '细胞' },
        { name: '组织与器官', tag: '组织与器官' },
      ],
    },
    { name: '生物与环境', tag: '生态系统' },
    {
      name: '人体生理',
      children: [
        { name: '消化与吸收', tag: '消化与吸收' },
        { name: '血液循环', tag: '血液循环' },
      ],
    },
    { name: '生物的多样性', tag: '植物类群' },
  ],
  '初中:政治': [
    {
      name: '成长中的我',
      children: [
        { name: '认识自我', tag: '认识自我' },
        { name: '情绪与情感', tag: '情绪与情感' },
      ],
    },
    {
      name: '我与他人',
      children: [
        { name: '交往与沟通', tag: '交往与沟通' },
        { name: '法律基础', tag: '法律基础' },
      ],
    },
    { name: '我与社会', tag: '社会责任' },
  ],
  '初中:历史': [
    {
      name: '中国古代史',
      children: [
        { name: '秦汉大一统', tag: '秦汉大一统' },
        { name: '隋唐盛世', tag: '隋唐盛世' },
      ],
    },
    {
      name: '中国近代史',
      children: [
        { name: '列强侵略与抗争', tag: '列强侵略与抗争' },
        { name: '近代化探索', tag: '近代化探索' },
      ],
    },
    { name: '世界历史', tag: '工业革命' },
  ],
  '初中:地理': [
    {
      name: '地球与地图',
      children: [
        { name: '经纬网', tag: '经纬网' },
        { name: '等高线地形图', tag: '等高线' },
      ],
    },
    {
      name: '世界地理',
      children: [
        { name: '大洲与大洋', tag: '大洲与大洋' },
        { name: '气候类型', tag: '气候类型' },
      ],
    },
    {
      name: '中国地理',
      children: [
        { name: '中国疆域', tag: '中国疆域' },
        { name: '中国地形', tag: '中国地形' },
      ],
    },
  ],

  /* ---------- 高中（默认树，按学科） ---------- */
  数学: [
    {
      name: '集合与常用逻辑用语',
      children: [
        { name: '集合的概念与表示', tag: '集合' },
        { name: '集合间的关系与运算', tag: '集合' },
        { name: '充分条件与必要条件', tag: '常用逻辑用语' },
      ],
    },
    {
      name: '函数的概念与性质',
      children: [
        { name: '函数的概念与表示', tag: '函数概念' },
        { name: '函数的单调性与最值', tag: '函数单调性' },
        { name: '二次函数', tag: '二次函数' },
      ],
    },
    {
      name: '指数函数与对数函数',
      children: [
        { name: '指数幂运算', tag: '指数函数' },
        { name: '对数运算', tag: '对数函数' },
      ],
    },
    {
      name: '三角函数',
      children: [
        { name: '任意角与弧度制', tag: '三角函数' },
        { name: '三角恒等变换', tag: '三角恒等变换' },
      ],
    },
    {
      name: '数列',
      children: [
        { name: '等差数列', tag: '数列' },
        { name: '等比数列', tag: '数列' },
      ],
    },
    {
      name: '立体几何与空间向量',
      children: [
        { name: '空间几何体', tag: '立体几何' },
        { name: '点线面位置关系', tag: '立体几何' },
        { name: '空间向量及其应用', tag: '空间向量' },
      ],
    },
    {
      name: '解析几何',
      children: [
        { name: '直线与方程', tag: '解析几何' },
        { name: '抛物线', tag: '抛物线' },
        { name: '圆锥曲线综合', tag: '圆锥曲线' },
      ],
    },
    {
      name: '导数及其应用',
      children: [
        { name: '导数的概念', tag: '导数概念' },
        { name: '导数在函数中的应用', tag: '函数与导数' },
      ],
    },
  ],
  物理: [
    {
      name: '力学',
      children: [
        { name: '运动的描述', tag: '匀变速直线运动' },
        { name: '匀变速直线运动的研究', tag: '匀变速直线运动' },
        { name: '相互作用与力的平衡', tag: '力的合成' },
        { name: '牛顿运动定律', tag: '牛顿运动定律' },
      ],
    },
    {
      name: '电磁学',
      children: [
        { name: '静电场', tag: '静电场' },
        { name: '恒定电流', tag: '恒定电流' },
        { name: '磁场与电磁感应', tag: '电磁感应' },
      ],
    },
  ],
  语文: [
    {
      name: '文言文阅读',
      children: [
        { name: '实词虚词', tag: '实词虚词' },
        { name: '断句与翻译', tag: '断句与翻译' },
        { name: '古代文化常识', tag: '古代文化常识' },
      ],
    },
    {
      name: '现代文阅读',
      children: [
        { name: '论述类文本', tag: '论述类文本' },
        { name: '文学类文本', tag: '文学类文本' },
      ],
    },
    { name: '古代诗歌鉴赏', tag: '诗歌鉴赏' },
    { name: '语言文字运用', tag: '语言文字运用' },
  ],
  英语: [
    {
      name: '语法专项',
      children: [
        { name: '时态与语态', tag: '时态语态' },
        { name: '非谓语动词', tag: '非谓语动词' },
        { name: '从句', tag: '从句' },
      ],
    },
    { name: '阅读理解', tag: '阅读理解' },
    { name: '完形填空', tag: '完形填空' },
    { name: '书面表达', tag: '书面表达' },
  ],
  化学: [
    { name: '物质的量', tag: '物质的量' },
    { name: '离子反应', tag: '离子反应' },
    { name: '氧化还原反应', tag: '氧化还原反应' },
    { name: '元素周期律', tag: '元素周期律' },
  ],
  生物: [
    {
      name: '分子与细胞',
      children: [
        { name: '细胞的分子组成', tag: '细胞分子组成' },
        { name: '细胞的结构', tag: '细胞结构' },
      ],
    },
    {
      name: '遗传与进化',
      children: [
        { name: '孟德尔遗传定律', tag: '遗传定律' },
        { name: '基因的表达', tag: '基因表达' },
      ],
    },
    {
      name: '稳态与调节',
      children: [
        { name: '神经调节', tag: '神经调节' },
        { name: '体液调节', tag: '体液调节' },
      ],
    },
    { name: '生物与环境', tag: '种群与群落' },
  ],
  政治: [
    {
      name: '经济生活',
      children: [
        { name: '价格与消费', tag: '价格与消费' },
        { name: '生产与经营', tag: '生产与经营' },
      ],
    },
    {
      name: '政治生活',
      children: [
        { name: '公民与政府', tag: '公民与政府' },
        { name: '国际关系', tag: '国际关系' },
      ],
    },
    { name: '文化生活', tag: '文化传承' },
    { name: '生活与哲学', tag: '唯物辩证法' },
  ],
  历史: [
    {
      name: '中国古代史',
      children: [
        { name: '先秦秦汉', tag: '先秦秦汉' },
        { name: '明清时期', tag: '明清时期' },
      ],
    },
    {
      name: '中国近现代史',
      children: [
        { name: '晚清变局', tag: '晚清变局' },
        { name: '新民主主义革命', tag: '新民主主义革命' },
      ],
    },
    {
      name: '世界史',
      children: [
        { name: '资本主义制度的确立', tag: '资本主义制度' },
        { name: '两次世界大战', tag: '两次世界大战' },
      ],
    },
  ],
  地理: [
    {
      name: '自然地理',
      children: [
        { name: '大气运动', tag: '大气运动' },
        { name: '水循环', tag: '水循环' },
        { name: '地质作用', tag: '地质作用' },
      ],
    },
    {
      name: '人文地理',
      children: [
        { name: '人口与城市', tag: '人口与城市' },
        { name: '工农业区位', tag: '工农业区位' },
      ],
    },
    { name: '区域地理', tag: '区域可持续发展' },
  ],
}

/** 未知学科时的通用兜底树 */
const GENERIC_SPEC: TreeSpec[] = [
  { name: '基础知识', tag: '基础知识' },
  { name: '重点专题', children: [{ name: '专题一', tag: '专题一' }, { name: '专题二', tag: '专题二' }] },
  { name: '综合应用', tag: '综合应用' },
]

/** 查找链：`学段:学科` → `学科`（高中默认） → 通用兜底 */
export function resolveTreeSpec(grade: string, subject: string): TreeSpec[] {
  const stage = stageOfGrade(grade)
  return (stage ? TREE_SPECS[`${stage}:${subject}`] : undefined) ?? TREE_SPECS[subject] ?? GENERIC_SPEC
}

/** 展开教材对应的知识点树（节点 id 以 年级-学科-版本 命名空间隔离） */
export function listKnowledgeTree(grade: string, subject: string, version: string): OrgKnowledgeNode[] {
  const spec = resolveTreeSpec(grade, subject)
  const nodes: OrgKnowledgeNode[] = []
  const prefix = `${grade}-${subject}-${version}`
  let seq = 0
  const walk = (rows: TreeSpec[], parentId: string | null) => {
    rows.forEach((row) => {
      const node: OrgKnowledgeNode = { id: `${prefix}-${++seq}`, parentId, name: row.name }
      if (row.tag) node.tag = row.tag
      nodes.push(node)
      if (row.children?.length) walk(row.children, node.id)
    })
  }
  walk(spec, null)
  return nodes
}

let recycleSeq = 500
const recycleBin: RecycleItem[] = [
  { id: 501, kind: '题目', name: '已知集合 A={x|x²<4}，求 A∩Z…', deletedBy: '李文博', deletedAt: nowStr(-52), remainDays: 28, ownerId: 103 },
  { id: 502, kind: '试卷', name: '月考模拟卷（旧版）', deletedBy: '陈明远', deletedAt: nowStr(-120), remainDays: 25, ownerId: 101 },
  { id: 503, kind: '教辅', name: '高中数学必修二同步讲义（草稿）', deletedBy: '陈明远', deletedAt: nowStr(-310), remainDays: 20, ownerId: 101 },
  { id: 504, kind: '文件', name: '2025 期末真题扫描件.pdf', deletedBy: '李文博', deletedAt: nowStr(-24), remainDays: 29, ownerId: 103 },
]

export function toRecycle(kind: RecycleItem['kind'], name: string): void {
  recycleBin.unshift({ id: ++recycleSeq, kind, name, deletedBy: CURRENT.name, deletedAt: nowStr(), remainDays: 30, ownerId: CURRENT.id })
}

export function listRecycle(kind: string): RecycleItem[] {
  return kind ? recycleBin.filter((item) => item.kind === kind) : [...recycleBin]
}

export function restoreRecycle(ids: number[]): string {
  const rows = recycleBin.filter((item) => ids.includes(item.id))
  rows.forEach((row) => recycleBin.splice(recycleBin.indexOf(row), 1))
  return `已还原 ${rows.length} 项至原位置（原分类已删除的题目将落入「未分类」），并写入操作日志`
}

export function purgeRecycle(ids: number[]): string {
  const rows = recycleBin.filter((item) => ids.includes(item.id))
  rows.forEach((row) => recycleBin.splice(recycleBin.indexOf(row), 1))
  return `已彻底删除 ${rows.length} 项（物理删除，已写日志）`
}

/* ================= 题目增删改 / 审核流 ================= */

export const QUESTION_STATUS_TEXT: Record<QuestionStatus, string> = {
  draft: '草稿',
  checking: '校验中',
  pending: '待终审',
  approved: '已入库',
  rejected: '已驳回',
}

export function saveQuestion(input: Partial<OrgQuestion> & { stem: string; submit: boolean }): OrgQuestion {
  /* 写入侧净化：题干/解析/选项可能来自 AI 生成或 OCR 粘贴，mock 层是唯一能兜底的地方。
     answer 保持原样 —— 它存的是 A/B/C 选项字母，多处按字符解析。 */
  const stem = sanitizeRichHtml(input.stem)
  const analysis = input.analysis ? sanitizeRichHtml(input.analysis) : input.analysis
  const options = (input.options ?? []).map((opt) => sanitizeRichHtml(opt))

  /* 富文本下 `<p></p>` 的 trim() 非空，故按纯文本判空；仅含图片的题干也算有内容 */
  if (!toPlainText(stem).trim() && !hasImage(stem)) throw new Error('题干不能为空')
  if ((input.type === '单选题' || input.type === '多选题' || input.type === '判断题') && !input.answer) {
    throw new Error('请设置正确答案')
  }
  const isEdit = input.id != null
  const item = isEdit
    ? questions.find((row) => row.id === input.id)
    : seedQuestion({ stem, id: ++questionSeq })

  if (isEdit && !item) throw new Error('题目不存在')
  const target = item as OrgQuestion
  /* seedQuestion 是纯工厂，不会入池；新建题目须显式入池，否则保存后被静默丢弃 */
  if (!isEdit) questions.unshift(target)
  Object.assign(target, {
    stem,
    subject: input.subject ?? target.subject,
    grade: input.grade ?? target.grade,
    type: input.type ?? target.type,
    difficulty: input.difficulty ?? target.difficulty,
    knowledge: input.knowledge ?? target.knowledge,
    textbook: input.textbook,
    term: input.term ?? target.term,
    examType: input.examType ?? target.examType,
    sourceRemark: input.sourceRemark,
    options,
    answer: input.answer ?? '',
    analysis: analysis ?? '',
    library: input.library ?? target.library,
    categoryId: input.categoryId ?? target.categoryId,
    owner: isEdit ? target.owner : CURRENT.name,
    ownerId: isEdit ? target.ownerId : CURRENT.id,
    source: isEdit ? target.source : '手动录入',
    updatedAt: nowStr(),
  })
  if (input.submit) {
    target.status = 'checking'
    pushMessage({
      tab: 'review',
      title: `题目《${truncateRich(target.stem, 18)}…》已提交 AI 校验`,
      summary: '多智能体并行检测完成后将推送终审待办',
      module: '题目管理',
      link: '/question/review',
    })
    // 演示：AI 校验即时完成 → 待终审
    window_setTimeout(() => {
      target.status = 'pending'
      target.aiChecks = aiChecksFor(target.stem)
      target.aiSuspects = []
    }, 0)
  } else if (!isEdit) {
    target.status = 'draft'
  }
  return target
}

/** mock 内部立即执行（避免引入真实计时） */
function window_setTimeout(fn: () => void, _ms: number): void {
  fn()
}

export function submitQuestions(ids: number[]): number {
  let count = 0
  for (const id of ids) {
    const item = questions.find((row) => row.id === id)
    if (item && (item.status === 'draft' || item.status === 'rejected')) {
      item.status = 'pending'
      item.aiChecks = aiChecksFor(item.stem)
      item.aiSuspects = []
      count += 1
    }
  }
  return count
}

export function deleteQuestions(ids: number[]): number {
  const rows = questions.filter((row) => ids.includes(row.id))
  rows.forEach((row) => {
    toRecycle('题目', truncateRich(row.stem, 24) + '…')
    questions.splice(questions.indexOf(row), 1)
  })
  return rows.length
}

export function moveQuestions(ids: number[], categoryId: number): number {
  let count = 0
  questions.forEach((row) => {
    if (ids.includes(row.id)) {
      row.categoryId = categoryId
      count += 1
    }
  })
  return count
}

export function reviewQuestion(id: number, pass: boolean, opinion: string): OrgQuestion {
  const item = questions.find((row) => row.id === id)
  if (!item) throw new Error('题目不存在')
  if (!pass && opinion.trim().length < 5) throw new Error('驳回意见必填（5-500 字）')
  item.status = pass ? 'approved' : 'rejected'
  item.reviewOpinion = opinion
  item.updatedAt = nowStr()
  if (pass && item.library === 'personal') item.library = 'org'
  pushMessage({
    tab: 'todo',
    title: `题目审核${pass ? '通过' : '驳回'}：《${truncateRich(item.stem, 16)}…》`,
    summary: pass ? '已入机构正式题库' : `驳回意见：${opinion}`,
    module: '题目审核',
    link: '/question/bank',
  })
  return item
}

/** 手动变式（FR-TM-017）：复制原题进入编辑，永久建立关联 */
export function variantOf(id: number): OrgQuestion {
  const source = questions.find((row) => row.id === id)
  if (!source) throw new Error('原题不存在')
  const copy = seedQuestion({
    ...source,
    id: ++questionSeq,
    stem: source.stem,
    status: 'draft',
    source: 'AI 变式',
    variantOf: source.id,
    owner: CURRENT.name,
    ownerId: CURRENT.id,
    library: 'personal',
    categoryId: 2,
  })
  questions.unshift(copy)
  return copy
}

/* ================= AI 出题 / 变式（FR-TM-013 ~ 016 / 018） ================= */

const AI_STEMS = [
  '已知函数 f(x)=lnx-ax 在 (0,+∞) 上有两个零点，求实数 a 的取值范围。',
  '设等比数列 {aₙ} 的前 n 项和为 Sₙ，若 S₃=7，S₆=63，求公比 q。',
  '已知向量 a=(1,2)，b=(x,1)，若 a⊥b，求 x 并计算 |a+b|。',
  '过点 (1,2) 作圆 x²+y²=5 的切线，求切线方程。',
  '已知 sinα=3/5，α∈(π/2,π)，求 cos2α 的值。',
  '椭圆 x²/4+y²/3=1 的左右焦点为 F₁、F₂，过 F₁ 的直线交椭圆于 A、B，求 △ABF₂ 周长。',
]

export function generateQuestions(count: number): GeneratedQuestion[] {
  consumeQuota(count)
  return Array.from({ length: count }, (_, i) => {
    const stem = AI_STEMS[(Math.random() * AI_STEMS.length) | 0] ?? AI_STEMS[0]
    return {
      id: `g${Date.now()}_${i}`,
      stem: `${stem}（变体 ${i + 1}）`,
      options: [],
      answer: '见解析',
      analysis: '由题意构造函数/数列模型，结合单调性与最值讨论即可（AI 生成解析，请人工复核）。',
      knowledge: ['函数与导数', '数列', '解析几何'][i % 3] ? [(['函数与导数', '数列', '解析几何'] as string[])[i % 3]] : ['函数与导数'],
      difficulty: (['容易', '中等', '困难'] as const)[i % 3],
    }
  })
}

export function adoptGenerated(item: GeneratedQuestion, subject: string, grade: string, type: string): OrgQuestion {
  /* AI 生成内容同样是不可信输入，入库前净化 */
  const q = seedQuestion({
    id: ++questionSeq,
    stem: sanitizeRichHtml(item.stem),
    subject,
    grade,
    type,
    difficulty: item.difficulty,
    knowledge: item.knowledge,
    answer: sanitizeRichHtml(item.answer),
    analysis: sanitizeRichHtml(item.analysis),
    options: (item.options ?? []).map((opt) => sanitizeRichHtml(opt)),
    source: 'AI 出题',
    status: 'checking',
    library: 'personal',
    categoryId: 2,
    owner: CURRENT.name,
    ownerId: CURRENT.id,
  })
  questions.unshift(q)
  window_setTimeout(() => {
    q.status = 'pending'
    q.aiChecks = aiChecksFor(q.stem)
    q.aiSuspects = []
  }, 0)
  return q
}

/* ================= 拍照识题（FR-TM-020 ~ 023） ================= */

export interface PhotoTask {
  id: string
  name: string
  sizeMb: number
  status: 'pending' | 'recognizing' | 'done' | 'failed'
  failReason?: string
  results: Array<{
    id: string
    stem: string
    options: string[]
    answer: string
    analysis: string
    knowledge: string[]
    difficulty: string
    /** 真实 AI 识别时模型判定的学科 / 年级（mock 识别不填，入库走默认） */
    subject?: string
    grade?: string
    decided: null | 'import' | 'draft' | 'drop'
  }>
}

let photoSeq = 0
export const photoTasks: PhotoTask[] = []

export function uploadPhotos(names: string[]): PhotoTask[] {
  return names.map((name) => {
    const task: PhotoTask = {
      id: `p${++photoSeq}`,
      name,
      sizeMb: Math.round((2 + Math.random() * 6) * 10) / 10,
      status: 'recognizing',
      results: [],
    }
    photoTasks.unshift(task)
    return task
  })
}

/**
 * 真实 AI 识别结果的回注册：前端本地完成多模态识别后，把任务整体写入 store，
 * 使「确认 / 存草稿 / 丢弃」决策与入库流程（decidePhotoResult）对真实识别与
 * mock 识别走同一条路径，无需在视图层分叉。
 */
export function registerPhotoTask(task: PhotoTask): PhotoTask {
  photoTasks.unshift(task)
  return task
}

/** 模拟识别完成：90% 成功拆题，10% 失败 */
export function recognizePhoto(id: string): PhotoTask {
  const task = photoTasks.find((row) => row.id === id)
  if (!task) throw new Error('任务不存在')
  if (Math.random() < 0.12) {
    task.status = 'failed'
    task.failReason = '图片模糊，无法定位题目区域'
    return task
  }
  task.status = 'done'
  task.results = Array.from({ length: 2 + (Math.floor(Math.random() * 2)) }, (_, i) => ({
    id: `${task.id}_r${i}`,
    stem: AI_STEMS[(i + photoSeq) % AI_STEMS.length],
    options: ['A. 选项一', 'B. 选项二', 'C. 选项三', 'D. 选项四'],
    answer: 'C',
    analysis: '识别出的解析文本（公式已转 LaTeX），可编辑修正。',
    knowledge: ['函数与导数'],
    difficulty: '中等',
    decided: null,
  }))
  return task
}

export function decidePhotoResult(
  taskId: string,
  resultId: string,
  decision: 'import' | 'draft' | 'drop',
  /** 教师在校对区改过的内容；此前前端根本没有回传，改动被静默丢弃 */
  edit?: { stem?: string; options?: string[]; answer?: string; analysis?: string; subject?: string; grade?: string },
): PhotoTask {
  const task = photoTasks.find((row) => row.id === taskId)
  if (!task) throw new Error('任务不存在')
  const result = task.results.find((row) => row.id === resultId)
  if (!result) throw new Error('识别结果不存在')
  result.decided = decision

  /* 先落回结果本身，再据此入库，保证「入库的」与「看到的」一致 */
  if (edit) {
    if (edit.stem !== undefined) result.stem = sanitizeRichHtml(edit.stem)
    if (edit.options !== undefined) result.options = edit.options.map((opt) => sanitizeRichHtml(opt))
    if (edit.analysis !== undefined) result.analysis = sanitizeRichHtml(edit.analysis)
    /* 客观题答案是 A/B/C 选项字母保持纯文本；问答题答案是富文本（公式/插图），同解析口径净化 */
    if (edit.answer !== undefined) {
      result.answer = result.options.length ? edit.answer : sanitizeRichHtml(edit.answer)
    }
    if (edit.subject !== undefined) result.subject = edit.subject
    if (edit.grade !== undefined) result.grade = edit.grade
  }

  if (decision === 'import') {
    /* 题型按选项结构推导：无选项 → 解答题（问答题），有选项 → 单选/多选按答案字母数 */
    const letters = result.answer.toUpperCase().replace(/[^A-F]/g, '')
    const q = seedQuestion({
      id: ++questionSeq,
      type: result.options.length ? (letters.length > 1 ? '多选题' : '单选题') : '解答题',
      stem: result.stem,
      options: result.options.map((opt) => sanitizeRichHtml(opt)),
      answer: result.answer,
      analysis: result.analysis,
      knowledge: result.knowledge,
      difficulty: result.difficulty,
      subject: result.subject ?? '数学',
      grade: result.grade ?? '高一',
      source: '拍照识别',
      status: 'checking',
      library: 'personal',
      categoryId: 2,
      owner: CURRENT.name,
      ownerId: CURRENT.id,
    })
    questions.unshift(q)
    window_setTimeout(() => {
      q.status = 'pending'
      q.aiChecks = aiChecksFor(q.stem)
      q.aiSuspects = []
    }, 0)
  }
  return task
}

/* ================= 试卷（FR-PP-001 ~ 016 / 022 ~ 026） ================= */

let paperSeq = 300
let sectionSeq = 900

export const PAPER_STATUS_TEXT: Record<string, string> = {
  draft: '草稿',
  aiReview: 'AI 审核中',
  pending: '待人工审核',
  approved: '已入库',
  rejected: '已驳回',
}

function paperChecks(suspects: string[] = []): AiCheckResult[] {
  return [
    { name: '试卷结构', pass: true, note: '大题分区与题型顺序符合规范' },
    { name: '总分题量', pass: true, note: '各题分值之和 = 卷面总分' },
    { name: '题型分布', pass: true, note: '客观题:主观题 = 6:4' },
    { name: '单题完整性', pass: true, note: '全部题目含答案与解析' },
    { name: '公式批量', pass: true, note: 'LaTeX 批量语法校验通过' },
    { name: '答案验算', pass: true, note: '客观题答案复核一致', fixed: '第 3 题答案 B → C（数值笔误自动修复）' },
    { name: '难度均衡', pass: true, note: '易:中:难 = 3:5:2' },
    { name: '知识点覆盖', pass: true, note: '覆盖本章 12/14 个知识点' },
    { name: '卷内查重', pass: suspects.length === 0, note: suspects.length ? '第 5 题与第 12 题互为变式（强制加入时已标记）' : '无重复题' },
  ]
}

function seedPaper(input: Partial<OrgPaper> & { id: number; name: string }): OrgPaper {
  return {
    subject: '数学',
    grade: '高一',
    duration: 120,
    status: 'approved',
    sections: [],
    owner: '李文博',
    updatedAt: nowStr(-Math.floor(Math.random() * 300)),
    sharedSquare: false,
    ...input,
  } as OrgPaper
}

function defaultSections(): PaperSection[] {
  return [
    {
      id: ++sectionSeq,
      title: '一、选择题',
      questions: [
        { questionId: 9001, score: 5 },
        { questionId: 9004, score: 5 },
      ],
    },
    {
      id: ++sectionSeq,
      title: '二、填空题',
      questions: [{ questionId: 9008, score: 5 }],
    },
    {
      id: ++sectionSeq,
      title: '三、解答题',
      questions: [{ questionId: 9003, score: 12 }],
    },
  ]
}

export const papers: OrgPaper[] = [
  seedPaper({
    id: 301,
    name: '2026 级高一数学期中测试卷',
    sections: defaultSections(),
    sharedSquare: true,
    collaborators: [
      { name: '李文博', perms: ['选题', '改分值'], online: true },
      { name: '沈丽华', perms: ['只读'], online: false },
    ],
    dynamics: [
      { time: nowStr(-5), actor: '李文博', action: '将「化简 sin…」加入第二大题' },
      { time: nowStr(-8), actor: '陈明远', action: '修改卷面描述' },
    ],
  }),
  seedPaper({
    id: 302,
    name: '高三一轮复习 · 函数与导数专项卷',
    status: 'pending',
    sections: defaultSections(),
    aiChecks: paperChecks(),
    aiSuspects: [],
    owner: '陈明远',
  }),
  seedPaper({
    id: 303,
    name: '高一月考模拟卷（二）',
    status: 'draft',
    sections: defaultSections(),
    owner: '陈明远',
  }),
  seedPaper({
    id: 304,
    name: '2026 级高一数学期中测试卷 · B 卷',
    status: 'approved',
    sections: defaultSections(),
    parallelOf: 301,
    parallelLabel: 'B 卷',
    owner: '沈丽华',
  }),
]

export function paperTotalScore(paper: OrgPaper): number {
  return paper.sections.reduce((sum, section) => sum + section.questions.reduce((s, q) => s + q.score, 0), 0)
}

export function paperQuestionCount(paper: OrgPaper): number {
  return paper.sections.reduce((sum, section) => sum + section.questions.length, 0)
}

export function savePaper(input: Partial<OrgPaper> & { name: string; submit?: boolean; totalScore?: number }): OrgPaper {
  if (input.name.trim().length < 2 || input.name.trim().length > 50) throw new Error('试卷名称须为 2-50 字')
  const isEdit = input.id != null
  const item = isEdit ? papers.find((row) => row.id === input.id) : undefined
  if (isEdit && !item) throw new Error('试卷不存在')
  const target = (item ?? seedPaper({ id: ++paperSeq, name: input.name, owner: CURRENT.name })) as OrgPaper
  Object.assign(target, {
    name: input.name.trim(),
    subject: input.subject ?? target.subject,
    grade: input.grade ?? target.grade,
    duration: input.duration ?? target.duration,
    sections: input.sections ?? target.sections,
    updatedAt: nowStr(),
  })
  if (!isEdit) {
    target.status = 'draft'
    papers.push(target)
  }
  if (input.submit) {
    if (paperQuestionCount(target) === 0) throw new Error('试卷至少需要 1 道题目')
    const total = paperTotalScore(target)
    if (input.totalScore != null && input.totalScore !== total) {
      throw new Error(`总分与各题分值之和不符（应为 ${total} 分）`)
    }
    target.status = 'pending'
    target.aiChecks = paperChecks()
    target.aiSuspects = []
    pushMessage({
      tab: 'review',
      title: `试卷《${target.name}》已进入人工审核`,
      summary: 'AI 九项检测完成：1 处自动修复，无阻断性疑点',
      module: '试卷管理',
      link: '/paper/review',
    })
  }
  return target
}

export function deletePaper(id: number): void {
  const item = papers.find((row) => row.id === id)
  if (!item) throw new Error('试卷不存在')
  toRecycle('试卷', item.name)
  papers.splice(papers.indexOf(item), 1)
}

export function reviewPaper(id: number, pass: boolean, opinion: string): OrgPaper {
  const item = papers.find((row) => row.id === id)
  if (!item) throw new Error('试卷不存在')
  if (!pass && opinion.trim().length < 5) throw new Error('驳回意见必填（5-500 字）')
  item.status = pass ? 'approved' : 'rejected'
  item.reviewOpinion = opinion
  item.updatedAt = nowStr()
  pushMessage({
    tab: 'todo',
    title: `试卷审核${pass ? '通过' : '驳回'}：《${item.name}》`,
    summary: pass ? '已入机构公开试卷库' : `驳回意见：${opinion}`,
    module: '试卷审核',
    link: '/paper/list',
  })
  return item
}

/** AI 智能组卷（FR-PP-008/009）：按题型结构抽题 */
export function aiComposePaper(input: {
  name: string
  subject: string
  grade: string
  structure: Array<{ type: string; count: number; score: number }>
}): { paper: OrgPaper; aiPicked: number } {
  consumeQuota(1)
  let aiPicked = 0
  const sections: PaperSection[] = input.structure.map((row, i) => {
    /* 优先同学科同年级的已入库题目；该学科题量不足时回退到全库同学科，再回退到仅按题型 */
    const base = questions.filter((q) => q.type === row.type && q.status === 'approved')
    const sameSubject = base.filter((q) => q.subject === input.subject)
    const pool = sameSubject.filter((q) => q.grade === input.grade).length >= row.count
      ? sameSubject.filter((q) => q.grade === input.grade)
      : sameSubject.length >= row.count
        ? sameSubject
        : base
    const picked: Array<{ questionId: number; score: number }> = []
    for (let j = 0; j < row.count; j += 1) {
      const candidate = pool[(j + i) % Math.max(pool.length, 1)]
      if (candidate) picked.push({ questionId: candidate.id, score: row.score })
      else aiPicked += 1
    }
    return { id: ++sectionSeq, title: `${'一二三四五六七八'[i]}、${row.type}`, questions: picked }
  })
  const paper = seedPaper({
    id: ++paperSeq,
    name: input.name,
    subject: input.subject,
    grade: input.grade,
    status: 'draft',
    sections,
    owner: CURRENT.name,
  })
  papers.unshift(paper)
  return { paper, aiPicked }
}

/** 换一题（FR-PP-009）：同知识点/题型/难度替换 */
export function swapPaperQuestion(paperId: number, questionId: number): { paper: OrgPaper; newId: number } {
  const paper = papers.find((row) => row.id === paperId)
  if (!paper) throw new Error('试卷不存在')
  const current = questions.find((row) => row.id === questionId)
  if (!current) throw new Error('原题不存在')
  consumeQuota(1)
  const candidate = questions.find(
    (row) => row.id !== questionId && row.type === current.type && row.status === 'approved',
  )
  if (!candidate) throw new Error('题库中暂无可替换的同构题，请先补充题目')
  paper.sections.forEach((section) => {
    section.questions.forEach((row) => {
      if (row.questionId === questionId) row.questionId = candidate.id
    })
  })
  paper.updatedAt = nowStr()
  paper.dynamics = [{ time: nowStr(), actor: CURRENT.name, action: `第 ${questionId} 题已替换为同构题` }, ...(paper.dynamics ?? [])]
  return { paper, newId: candidate.id }
}

/** AI 平行卷（FR-PP-015） */
export function generateParallels(motherId: number, count: number): OrgPaper[] {
  const mother = papers.find((row) => row.id === motherId)
  if (!mother) throw new Error('母卷不存在')
  consumeQuota(count)
  const labels = ['B', 'C', 'D', 'E', 'F']
  return Array.from({ length: count }, (_, i) => {
    const paper = seedPaper({
      id: ++paperSeq,
      name: `${mother.name} · ${labels[i]} 卷`,
      status: 'draft',
      sections: JSON.parse(JSON.stringify(mother.sections)),
      parallelOf: mother.id,
      parallelLabel: `${labels[i]} 卷`,
      owner: CURRENT.name,
    })
    paper.sections = paper.sections.map((section, si) => ({
      ...section,
      id: ++sectionSeq,
      questions: section.questions.map((row, qi) => {
        const alt = questions.filter((q) => q.type === '选择题' || q.status === 'approved')[(si + qi) % questions.length]
        return { questionId: alt && alt.id !== row.questionId ? alt.id : row.questionId, score: row.score }
      }),
    }))
    papers.unshift(paper)
    return paper
  })
}

/* ================= 教辅（FR-JC-001 ~ 004） ================= */

let materialSeq = 700
let chapterSeq = 800
let exampleSeq = 850

export const MATERIAL_STATUS_TEXT: Record<MaterialStatus, string> = {
  recognizing: '识别中',
  proofreading: '待校对',
  done: '已完成',
  failed: '失败',
}

function seedExamples(): MaterialExample[] {
  return [
    { id: ++exampleSeq, stem: '判断函数 f(x)=x³ 在 R 上的单调性并证明。', answer: '单调递增', analysis: '任取 x₁<x₂，f(x₁)-f(x₂)=(x₁-x₂)(x₁²+x₁x₂+x₂²)<0。', status: 'pending' },
    { id: ++exampleSeq, stem: '求 y=2sin(3x+π/6) 的最小正周期。', answer: 'T=2π/3', analysis: 'T=2π/ω=2π/3。', status: 'pending' },
  ]
}

export const materials: OrgMaterial[] = [
  {
    id: 701,
    name: '高中数学必修一同步讲义',
    type: '讲义',
    subject: '数学',
    knowledge: ['函数与导数', '集合'],
    sizeMb: 24.6,
    status: 'proofreading',
    owner: '陈明远',
    createdAt: nowStr(-30),
    chapters: [
      { id: ++chapterSeq, title: '第一章 集合与函数', knowledge: ['集合', '函数概念'], examples: seedExamples() },
      { id: ++chapterSeq, title: '第二章 函数性质', knowledge: ['单调性', '奇偶性'], examples: seedExamples() },
    ],
  },
  {
    id: 702,
    name: '高一物理力学专项练习',
    type: '练习册',
    subject: '物理',
    knowledge: ['牛顿运动定律'],
    sizeMb: 12.8,
    status: 'done',
    owner: '李文博',
    createdAt: nowStr(-200),
    chapters: [{ id: ++chapterSeq, title: '专题一 受力分析', knowledge: ['力的合成'], examples: [] }],
  },
  {
    id: 703,
    name: '扫描版 2019 高考真题汇编',
    type: '试卷集',
    subject: '数学',
    knowledge: [],
    sizeMb: 86.2,
    status: 'failed',
    failReason: '扫描件无文字层，无法结构化识别',
    owner: '陈明远',
    createdAt: nowStr(-74),
    chapters: [],
  },
]

export function uploadMaterial(input: { name: string; type: string; subject: string }): OrgMaterial {
  const item: OrgMaterial = {
    id: ++materialSeq,
    name: input.name,
    type: input.type,
    subject: input.subject,
    knowledge: [],
    sizeMb: Math.round((8 + Math.random() * 60) * 10) / 10,
    status: 'recognizing',
    owner: CURRENT.name,
    createdAt: nowStr(),
    chapters: [],
  }
  materials.unshift(item)
  window_setTimeout(() => {
    item.status = 'proofreading'
    item.chapters = [{ id: ++chapterSeq, title: '第一章（AI 识别）', knowledge: ['待绑定'], examples: seedExamples() }]
  }, 0)
  pushMessage({
    tab: 'system',
    title: `教辅《${input.name}》识别完成`,
    summary: 'AI 结构化识别完成，请进入校对',
    module: '教辅管理',
    link: '/material/list',
  })
  return item
}

export function reRecognizeMaterial(id: number): OrgMaterial {
  const item = materials.find((row) => row.id === id)
  if (!item) throw new Error('教辅不存在')
  consumeQuota(1)
  item.status = 'proofreading'
  item.failReason = undefined
  item.chapters = [{ id: ++chapterSeq, title: '第一章（重新识别）', knowledge: ['待绑定'], examples: seedExamples() }]
  return item
}

export function decideExample(materialId: number, exampleId: number, decision: 'import' | 'edit' | 'ignore'): MaterialExample {
  const item = materials.find((row) => row.id === materialId)
  if (!item) throw new Error('教辅不存在')
  let target: MaterialExample | undefined
  item.chapters.forEach((chapter) => chapter.examples.forEach((example) => {
    if (example.id === exampleId) target = example
  }))
  if (!target) throw new Error('例题不存在')
  if (decision === 'ignore') {
    target.status = 'ignored'
    return target
  }
  target.status = 'imported'
  const q = seedQuestion({
    id: ++questionSeq,
    stem: target.stem,
    type: '解答题',
    answer: target.answer,
    analysis: target.analysis,
    source: '教辅导入',
    status: 'checking',
    library: 'personal',
    categoryId: 2,
    owner: CURRENT.name,
    ownerId: CURRENT.id,
  })
  questions.unshift(q)
  window_setTimeout(() => {
    q.status = 'pending'
    q.aiChecks = aiChecksFor(q.stem)
    q.aiSuspects = []
  }, 0)
  return target
}

export function finishMaterial(id: number, pendingCount: number): string {
  const item = materials.find((row) => row.id === id)
  if (!item) throw new Error('教辅不存在')
  item.status = 'done'
  return pendingCount > 0
    ? `校对完成，${pendingCount} 道未处理例题已永久丢弃`
    : '校对完成'
}

export function deleteMaterial(id: number): void {
  const item = materials.find((row) => row.id === id)
  if (!item) throw new Error('教辅不存在')
  toRecycle('教辅', item.name)
  materials.splice(materials.indexOf(item), 1)
}

/* ================= 多媒体资源（FR-JC-005/006） ================= */

let mediaSeq = 600
export const mediaResources: OrgMedia[] = [
  { id: 601, name: '函数图像动态演示', kind: 'animation', subject: '数学', knowledge: ['函数图像'], sizeMb: 18.4, linkedCount: 2, owner: '李文博', createdAt: nowStr(-100) },
  { id: 602, name: '立体几何截面微课', kind: 'video', subject: '数学', knowledge: ['立体几何'], sizeMb: 156.0, durationSec: 642, linkedCount: 1, owner: '陈明远', createdAt: nowStr(-260) },
  { id: 603, name: '抛物线标准图（矢量）', kind: 'image', subject: '数学', knowledge: ['抛物线'], sizeMb: 0.8, linkedCount: 0, owner: '沈丽华', createdAt: nowStr(-50) },
  { id: 604, name: '单位圆与三角函数线', kind: 'image', subject: '数学', knowledge: ['三角函数'], sizeMb: 0.6, linkedCount: 1, owner: '陈明远', createdAt: nowStr(-180) },
  { id: 605, name: '立体几何三视图', kind: 'image', subject: '数学', knowledge: ['立体几何'], sizeMb: 0.7, linkedCount: 3, owner: '沈丽华', createdAt: nowStr(-30) },
]

/**
 * 上传字节的会话级存放处：id → data URL。
 *
 * 与题库同为内存态（刷新即还原），因此不落 localStorage。题目正文里只引用 `/api/tenant/media/{id}/raw`
 * 这样的 URL，渲染时经 resolveMediaSrc 换回可显示地址 —— 真实后端接入后由服务端直接提供字节，
 * 这张表自然为空。
 */
const mediaBlobs = new Map<number, string>()

function mediaUrlOf(id: number): string {
  return `/api/tenant/media/${id}/raw`
}

/**
 * 种子图片的内联字节（演示用）。
 *
 * 演示数据只有元信息、没有文件，mock 里也没有 `/media/:id/raw` 路由（routes.ts 的媒体只有
 * list / upload / link / delete 四条），所以这些记录一旦进了正文就是破图 —— 编辑器里选不出东西。
 * 这里给每张种子图生成一张 SVG 存进 mediaBlobs 并注册，让「系统图片库」真的可选、可显示。
 * 真实后端接入后由服务端托管字节，本段可整段删除。
 */
function figureSvg(label: string, figure: string): string {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 160">' +
    '<rect width="240" height="160" fill="#f7fafa"/>' +
    `<g fill="none" stroke="#00b4a6" stroke-width="2" stroke-linecap="round">${figure}</g>` +
    `<text x="120" y="148" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#5b6b7f">${label}</text>` +
    '</svg>'
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

const SEED_FIGURES: Record<number, { label: string; figure: string }> = {
  603: { label: '抛物线', figure: '<path d="M20 20 Q120 210 220 20"/>' },
  604: { label: '单位圆与三角函数线', figure: '<circle cx="120" cy="72" r="50"/><path d="M62 72h116M120 14v116"/>' },
  605: { label: '立体几何三视图', figure: '<path d="M88 34h58v58H88zM88 34l20-16h58v58l-20 16M146 34l20-16M146 92l20-16"/>' },
}

for (const row of mediaResources) {
  const figure = SEED_FIGURES[row.id]
  if (!figure || row.url) continue
  const dataUrl = figureSvg(figure.label, figure.figure)
  row.url = mediaUrlOf(row.id)
  row.mime = 'image/svg+xml'
  mediaBlobs.set(row.id, dataUrl)
  registerMediaSrc(row.url, dataUrl)
}

export function uploadMedia(input: {
  name: string
  kind: OrgMedia['kind']
  subject: string
  knowledge: string[]
  /** 走真实上传通道时携带；存量演示数据不带 */
  dataUrl?: string
  mime?: string
  sizeMb?: number
}): OrgMedia {
  const id = ++mediaSeq
  /* 有字节就据实计算体积，没有则沿用演示用的随机值 */
  const sizeMb = input.sizeMb ?? Math.round((1 + Math.random() * 80) * 10) / 10
  const item: OrgMedia = {
    id,
    name: input.name,
    kind: input.kind,
    subject: input.subject,
    knowledge: input.knowledge,
    sizeMb,
    durationSec: input.kind === 'image' ? undefined : 300 + Math.floor(Math.random() * 600),
    linkedCount: 0,
    owner: CURRENT.name,
    createdAt: nowStr(),
    mime: input.mime,
  }
  if (input.dataUrl) {
    mediaBlobs.set(id, input.dataUrl)
    item.url = mediaUrlOf(id)
    registerMediaSrc(item.url, input.dataUrl)
  }
  mediaResources.unshift(item)
  return item
}

/** 取回上传字节（题目正文图片渲染用） */
export function resolveMediaBlob(id: number): string | undefined {
  return mediaBlobs.get(id)
}

export function linkMedia(id: number, targets: string[]): number {
  const item = mediaResources.find((row) => row.id === id)
  if (!item) throw new Error('资源不存在')
  item.linkedCount += targets.length
  return item.linkedCount
}

export function deleteMedia(id: number): number {
  const item = mediaResources.find((row) => row.id === id)
  if (!item) throw new Error('资源不存在')
  toRecycle('文件', item.name)
  if (item.url) unregisterMediaSrc(item.url)
  mediaBlobs.delete(id)
  mediaResources.splice(mediaResources.indexOf(item), 1)
  return item.linkedCount
}

/* ================= 理科配图绘图工程（静态 SVG 配图） =================
 *
 * 业务约束（规格硬性要求）：
 * - 画布输出只能是静态图片，工程 JSON 里不允许出现 slider / animation / button，
 *   入库前由前端 Schema 校验过滤（见 apps/tenant 的 drawSchemaValidator），这里兜底再清一遍；
 * - 「保存草稿」只落 project_json / molfile_text；「确认导出」才携带 svg 字节生成可引用 URL；
 * - 二次编辑读工程数据重开编辑器，不从 SVG 反解析。
 */

const INTERACTIVE_KEYS = new Set(['slider', 'sliders', 'animation', 'animations', 'button', 'buttons', 'play', 'pause', 'anim'])

/** 入库前兜底清洗交互字段（前端校验之外的第二道闸，防绕过） */
function stripInteractive(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map(stripInteractive)
  }
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (INTERACTIVE_KEYS.has(key.toLowerCase())) continue
      out[key] = stripInteractive(value)
    }
    return out
  }
  return input
}

export function getMediaById(id: number): OrgMedia | undefined {
  return mediaResources.find((row) => row.id === id)
}

export function saveDrawMedia(input: {
  /** 二次编辑时携带，更新同一条记录 */
  id?: number
  name: string
  subject: string
  knowledge?: string[]
  editorType: DrawEditorType
  projectJson?: string
  molfileText?: string
  /** 确认导出时携带（SVG data URL）；仅保存草稿时不带 */
  svgDataUrl?: string
}): OrgMedia {
  const existing = input.id != null ? mediaResources.find((row) => row.id === input.id) : undefined
  const projectJson = input.projectJson ? JSON.stringify(stripInteractive(JSON.parse(input.projectJson))) : undefined

  if (existing) {
    existing.name = input.name
    existing.subject = input.subject
    if (input.knowledge) existing.knowledge = input.knowledge
    existing.editorType = input.editorType
    existing.projectJson = projectJson
    existing.molfileText = input.molfileText
    if (input.svgDataUrl) {
      if (existing.url) unregisterMediaSrc(existing.url)
      mediaBlobs.set(existing.id, input.svgDataUrl)
      existing.url = mediaUrlOf(existing.id)
      existing.mime = 'image/svg+xml'
      registerMediaSrc(existing.url, input.svgDataUrl)
      existing.sizeMb = Math.round(((input.svgDataUrl.length * 0.75) / 1024 / 1024) * 100) / 100
    }
    return existing
  }

  const item = uploadMedia({
    name: input.name,
    kind: 'image',
    subject: input.subject,
    knowledge: input.knowledge ?? [],
    dataUrl: input.svgDataUrl,
    mime: input.svgDataUrl ? 'image/svg+xml' : undefined,
  })
  item.editorType = input.editorType
  item.projectJson = projectJson
  item.molfileText = input.molfileText
  return item
}

/**
 * AI 构图草稿（mock 大模型网关）。
 *
 * 返回的原始工程 JSON 刻意混入交互字段 / 未知元件（见 jsxgraph 草稿里的 animation、
 * chem 草稿里的 magnet_stirrer），用于走通前端 Schema 校验的过滤与提示链路；
 * 真实网关接入后只替换本函数的数据来源，校验逻辑不变。
 */
export function generateAiDrawDraft(input: { mediaType: DrawEditorType; userPrompt: string }): {
  projectJson?: string
  molfileText?: string
} {
  void input.userPrompt
  switch (input.mediaType) {
    case 'jsxgraph':
      return {
        projectJson: JSON.stringify({
          version: 1,
          /* AI 幻觉出来的交互配置：校验器必须把它过滤掉 */
          animation: { play: true, loop: true },
          elements: [
            { type: 'polygon', vertices: [[-3, 0.5], [0, 4.5], [3, 0.5]], label: 'ABC' },
            { type: 'segment', p1: [0, 4.5], p2: [0, 0.5], dash: true },
            { type: 'point', x: 0, y: 0.5, label: 'D' },
            { type: 'angleMark', p1: [-3, 0.5], vertex: [0, 4.5], p2: [3, 0.5] },
            { type: 'rightAngleMark', p1: [0, 4.5], vertex: [0, 0.5], p2: [3, 0.5] },
            { type: 'text', x: -3.4, y: 4.9, text: 'AB = AC', latex: false },
          ],
        }),
      }
    case 'fabric-chem':
      return {
        projectJson: JSON.stringify({
          version: 1,
          elements: [
            /* magnet_stirrer 不在预制元件白名单：校验过滤 + toast 提示 */
            { elementId: 'alcohol_lamp', x: 60, y: 300 },
            { elementId: 'test_tube', x: 55, y: 150, angle: -18 },
            { elementId: 'rubber_stopper', x: 148, y: 128 },
            { elementId: 'glass_tube', x: 210, y: 130, angle: 90 },
            { elementId: 'gas_collect_bottle', x: 330, y: 220 },
            { elementId: 'magnet_stirrer', x: 400, y: 400 },
          ],
          texts: [{ text: '加热制取氧气', x: 40, y: 40 }],
        }),
      }
    case 'ketcher':
      return {
        /* 乙醇 Molfile V2000（AI 草稿，加载前须经 validateMolfile 校验） */
        molfileText: [
          ' ethanol',
          '  Ketcher  926260000',
          '',
          '  3  2  0  0  0  0  0  0  0  0999 V2000',
          '    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
          '    1.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
          '    2.0000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0',
          '  1  2  1  0  0  0  0',
          '  2  3  1  0  0  0  0',
          'M  END',
        ].join('\n'),
      }
    case 'fabric-general':
      return {
        /* 标准 fabric canvas JSON（loadFromJSON 可直接还原） */
        projectJson: JSON.stringify({
          version: '5.3.0',
          objects: [
            { type: 'rect', left: 60, top: 70, width: 220, height: 130, fill: 'transparent', stroke: '#3a4a63', strokeWidth: 2 },
            { type: 'textbox', left: 90, top: 110, text: '光路示意图', fill: '#3a4a63', fontSize: 18, styles: {} },
            { type: 'line', left: 310, top: 130, x1: 0, y1: 0, x2: 120, y2: 0, stroke: '#3a4a63', strokeWidth: 2.5 },
          ],
        }),
      }
  }
}

/* ================= 我的文件（FR-FL-001 ~ 005） ================= */

let fileSeq = 400
let folderSeq = 90
export const folders: FileFolder[] = [
  { id: 0, name: '全部文件', parentId: null },
  { id: 91, name: '期末备考', parentId: 0 },
  { id: 92, name: '扫描试卷', parentId: 0 },
  { id: 93, name: '2025 真题', parentId: 92 },
]

export const orgFiles: OrgFile[] = [
  { id: 401, name: '2026 期中数学试卷（教师版）.pdf', kind: 'pdf', folderId: 91, sizeMb: 3.2, recognize: 'done', owner: '陈明远', uploadedAt: nowStr(-28) },
  { id: 402, name: '函数专题练习.docx', kind: 'word', folderId: 91, sizeMb: 1.1, recognize: 'none', owner: '李文博', uploadedAt: nowStr(-96) },
  { id: 403, name: '月考答题卡扫描 01.jpg', kind: 'image', folderId: 92, sizeMb: 4.6, recognize: 'none', owner: '李文博', uploadedAt: nowStr(-150) },
  { id: 404, name: '历年真题打包.zip', kind: 'zip', folderId: 0, sizeMb: 78.9, recognize: 'none', owner: '陈明远', uploadedAt: nowStr(-300) },
]

export const storageUsage = { usedGb: 18.6, quotaGb: 50 }

export function saveFolder(input: { id?: number; name: string; parentId: number | null }): FileFolder {
  if (input.id != null) {
    const item = folders.find((row) => row.id === input.id)
    if (!item) throw new Error('文件夹不存在')
    if (folders.some((row) => row.id !== item.id && row.parentId === item.parentId && row.name === input.name)) {
      throw new Error('同级已存在同名文件夹')
    }
    item.name = input.name
    return item
  }
  if (folders.some((row) => row.parentId === input.parentId && row.name === input.name)) {
    throw new Error('同级已存在同名文件夹')
  }
  const item: FileFolder = { id: ++folderSeq, name: input.name, parentId: input.parentId }
  folders.push(item)
  return item
}

export function deleteFolder(id: number): number {
  const item = folders.find((row) => row.id === id)
  if (!item) throw new Error('文件夹不存在')
  const inner = orgFiles.filter((row) => row.folderId === id)
  inner.forEach((row) => toRecycle('文件', row.name))
  orgFiles.filter((row) => row.folderId === id).forEach((row) => orgFiles.splice(orgFiles.indexOf(row), 1))
  folders.splice(folders.indexOf(item), 1)
  return inner.length
}

/** 扩展名 → 文件类型（真实上传的 jpg/docx 等也归到对应大类） */
const FILE_KIND_BY_EXT: Record<string, OrgFile['kind']> = {
  pdf: 'pdf',
  word: 'word', doc: 'word', docx: 'word',
  ppt: 'ppt', pptx: 'ppt',
  image: 'image', jpg: 'image', jpeg: 'image', png: 'image', webp: 'image', gif: 'image',
  zip: 'zip',
}

export function uploadFiles(names: string[], folderId: number, sizes?: number[]): OrgFile[] {
  return names.map((name, i) => {
    const ext = name.split('.').pop()?.toLowerCase() ?? 'pdf'
    const kind = FILE_KIND_BY_EXT[ext] ?? 'pdf'
    const item: OrgFile = {
      id: ++fileSeq,
      name,
      kind,
      folderId,
      /* 真实上传（sizes 传入）用实际大小；模拟上传保持随机演示值 */
      sizeMb: sizes?.[i] != null ? Math.round(sizes[i] * 10) / 10 : Math.round((1 + Math.random() * 20) * 10) / 10,
      recognize: 'none',
      owner: CURRENT.name,
      uploadedAt: nowStr(),
    }
    orgFiles.unshift(item)
    return item
  })
}

export function deleteFile(id: number): void {
  const item = orgFiles.find((row) => row.id === id)
  if (!item) throw new Error('文件不存在')
  toRecycle('文件', item.name)
  orgFiles.splice(orgFiles.indexOf(item), 1)
}

/** 文档识别入库（FR-FL-004/005）：返回生成的草稿试卷 id */
export function recognizeFile(id: number): { file: OrgFile; questionCount: number; paperId: number } {
  const item = orgFiles.find((row) => row.id === id)
  if (!item) throw new Error('文件不存在')
  consumeQuota(1)
  item.recognize = 'done'
  const count = 3
  const imported = Array.from({ length: count }, (_, i) => {
    const q = seedQuestion({
      id: ++questionSeq,
      stem: `${item.name.replace(/\.\w+$/, '')} · 第 ${i + 1} 题：${AI_STEMS[i % AI_STEMS.length]}`,
      type: i === 2 ? '解答题' : '填空题',
      answer: '见解析',
      analysis: '文档识别结果，公式已转 LaTeX。',
      source: '文档导入',
      status: 'checking',
      library: 'personal',
      categoryId: 2,
      owner: CURRENT.name,
      ownerId: CURRENT.id,
    })
    questions.unshift(q)
    window_setTimeout(() => {
      q.status = 'pending'
      q.aiChecks = aiChecksFor(q.stem)
      q.aiSuspects = []
    }, 0)
    return q
  })
  const paper = seedPaper({
    id: ++paperSeq,
    name: item.name.replace(/\.\w+$/, ''),
    status: 'draft',
    sections: [{ id: ++sectionSeq, title: '一、识别题目', questions: imported.map(() => ({ questionId: imported[0].id, score: 10 })) }],
    owner: CURRENT.name,
  })
  papers.unshift(paper)
  return { file: item, questionCount: count, paperId: paper.id }
}

/* ================= 文档 AI 识别：确认后入库（FR-FL-004/005 扩展） ================= */

export interface RecognizedImportQuestion {
  stem: string
  options: string[]
  answer: string
  analysis: string
  subject: string
  grade: string
  type: string
  difficulty: string
  knowledge: string[]
  score: number
  /** 确认弹窗里的勾选：取消勾选则不入库 */
  include: boolean
}

/** 题型 → 试卷大题标题（组卷自动归类与协同组卷页保持同一套命名） */
const IMPORT_SECTION_TITLE: Record<string, string> = {
  单选题: '单项选择题',
  多选题: '多项选择题',
  判断题: '判断题',
  填空题: '填空题',
  解答题: '解答题',
}
const SECTION_TYPE_ORDER = ['单选题', '多选题', '判断题', '填空题', '解答题']

/**
 * 文档识别确认入库：勾选题目入题库（待终审），makePaper 时按题型自动归组
 * 生成草稿试卷（大题顺序固定：单选 → 多选 → 判断 → 填空 → 解答）。
 * 返回 { questionCount, paperId }；paperId 为 null 表示纯题集入库（未生成试卷）。
 */
export function importRecognizedFile(
  id: number,
  payload: { makePaper: boolean; paperName: string; questions: RecognizedImportQuestion[] },
): { file: OrgFile; questionCount: number; paperId: number | null } {
  const item = orgFiles.find((row) => row.id === id)
  if (!item) throw new Error('文件不存在')
  if (item.recognize === 'done') throw new Error('该文件已识别入库')
  consumeQuota(1)
  const included = payload.questions.filter((q) => q.include && q.stem.trim())
  if (!included.length) throw new Error('请至少勾选 1 道题目')
  const imported = included.map((q) => {
    /* 客观题答案是字母保持纯文本；主观题答案是富文本（公式/插图），同解析口径净化 */
    const question = seedQuestion({
      id: ++questionSeq,
      stem: sanitizeRichHtml(q.stem),
      subject: q.subject,
      grade: q.grade,
      type: q.type,
      difficulty: q.difficulty,
      knowledge: q.knowledge.slice(0, 3),
      answer: q.options.length ? q.answer.trim() : sanitizeRichHtml(q.answer),
      analysis: sanitizeRichHtml(q.analysis),
      options: (q.options ?? []).map((opt) => sanitizeRichHtml(opt)),
      source: '文档导入',
      status: 'checking',
      library: 'personal',
      categoryId: 2,
      owner: CURRENT.name,
      ownerId: CURRENT.id,
    })
    questions.unshift(question)
    window_setTimeout(() => {
      question.status = 'pending'
      question.aiChecks = aiChecksFor(question.stem)
      question.aiSuspects = []
    }, 0)
    return { question, score: q.score }
  })
  let paperId: number | null = null
  if (payload.makePaper) {
    const sections = SECTION_TYPE_ORDER.map((type, i) => {
      const rows = imported.filter((row) => row.question.type === type)
      if (!rows.length) return null
      return {
        id: ++sectionSeq,
        title: `${'一二三四五六七八'[i]}、${IMPORT_SECTION_TITLE[type] ?? `${type}大题`}`,
        questions: rows.map((row) => ({ questionId: row.question.id, score: row.score })),
      }
    }).filter((section): section is NonNullable<typeof section> => section !== null)
    /* 大题编号按实际个数重新顺排（上面的 i 是固定顺序位，可能出现跳号） */
    sections.forEach((section, i) => {
      section.title = section.title.replace(/^[一二三四五六七八九十]+、/, `${'一二三四五六七八'[i]}、`)
    })
    const paper = seedPaper({
      id: ++paperSeq,
      name: payload.paperName.trim() || item.name.replace(/\.\w+$/, ''),
      status: 'draft',
      sections,
      owner: CURRENT.name,
    })
    papers.unshift(paper)
    paperId = paper.id
  }
  item.recognize = 'done'
  return { file: item, questionCount: imported.length, paperId }
}

/* ================= 公式中心（FR-FX-001 ~ 004） ================= */

export const standardFormulas: StandardFormula[] = [
  { id: 1, name: '二次方程求根公式', branch: '数学', chapter: '函数与方程', latex: 'x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}', collected: true, knowledge: ['一元二次方程', '二次函数'] },
  { id: 2, name: '基本不等式', branch: '数学', chapter: '不等式', latex: 'a+b \\geq 2\\sqrt{ab} \\quad (a,b>0)', collected: false, knowledge: ['不等式'] },
  { id: 3, name: '等差数列通项', branch: '数学', chapter: '数列', latex: 'a_n = a_1 + (n-1)d', collected: false, knowledge: ['数列'] },
  { id: 4, name: '两角和差公式', branch: '数学', chapter: '三角恒等变换', latex: '\\sin(\\alpha \\pm \\beta) = \\sin\\alpha\\cos\\beta \\pm \\cos\\alpha\\sin\\beta', collected: false, knowledge: ['三角恒等变换', '三角函数'] },
  { id: 5, name: '牛顿第二定律', branch: '物理', chapter: '力学', latex: '\\vec{F} = m\\vec{a}', collected: false, knowledge: ['牛顿运动定律'] },
  { id: 6, name: '万有引力定律', branch: '物理', chapter: '天体运动', latex: 'F = G\\frac{m_1 m_2}{r^2}', collected: false, knowledge: ['牛顿运动定律'] },
  { id: 7, name: '质量守恒（配平）', branch: '化学', chapter: '化学方程式', latex: '2H_2 + O_2 \\xrightarrow{\\text{点燃}} 2H_2O', collected: false, knowledge: ['质量守恒定律', '化学方程式'] },
  { id: 8, name: '理想气体状态方程', branch: '物理', chapter: '热学', latex: 'pV = nRT', collected: false, knowledge: [] },
  { id: 9, name: '二次函数顶点式', branch: '数学', chapter: '二次函数', latex: 'y = a(x-h)^2 + k \\quad (a \\neq 0)', collected: false, knowledge: ['二次函数'] },
  { id: 10, name: '点到直线距离公式', branch: '数学', chapter: '解析几何', latex: 'd = \\frac{|Ax_0+By_0+C|}{\\sqrt{A^2+B^2}}', collected: false, knowledge: ['解析几何'] },
  { id: 11, name: '等比数列前 n 项和', branch: '数学', chapter: '数列', latex: 'S_n = \\frac{a_1(1-q^n)}{1-q} \\quad (q \\neq 1)', collected: false, knowledge: ['数列'] },
  { id: 12, name: '抛物线标准方程', branch: '数学', chapter: '圆锥曲线', latex: 'y^2 = 2px \\quad (p>0)', collected: false, knowledge: ['抛物线', '圆锥曲线'] },
  { id: 13, name: '对数换底公式', branch: '数学', chapter: '对数函数', latex: '\\log_a b = \\frac{\\ln b}{\\ln a}', collected: false, knowledge: ['对数函数'] },
  { id: 14, name: '导数定义', branch: '数学', chapter: '导数', latex: "f'(x_0) = \\lim_{\\Delta x \\to 0} \\frac{f(x_0+\\Delta x)-f(x_0)}{\\Delta x}", collected: false, knowledge: ['导数概念'] },
  { id: 15, name: '欧姆定律', branch: '物理', chapter: '恒定电流', latex: 'I = \\frac{U}{R}', collected: false, knowledge: ['恒定电流', '欧姆定律'] },
  { id: 16, name: '电功率公式', branch: '物理', chapter: '恒定电流', latex: 'P = UI = I^2R = \\frac{U^2}{R}', collected: false, knowledge: ['恒定电流'] },
  { id: 17, name: '浮力公式', branch: '物理', chapter: '力学', latex: 'F_{\\text{浮}} = \\rho_{\\text{液}} g V_{\\text{排}}', collected: false, knowledge: ['二力平衡'] },
  { id: 18, name: '匀变速位移-速度关系', branch: '物理', chapter: '力学', latex: 'v^2 - v_0^2 = 2ax', collected: false, knowledge: ['匀变速直线运动'] },
  { id: 19, name: '物质的量浓度', branch: '化学', chapter: '物质的量', latex: 'c = \\frac{n}{V}', collected: false, knowledge: ['物质的量'] },
  { id: 20, name: '溶质质量分数', branch: '化学', chapter: '实验与计算', latex: '\\omega = \\frac{m_{\\text{溶质}}}{m_{\\text{溶液}}} \\times 100\\%', collected: false, knowledge: ['溶质质量分数'] },
]

/** 标准公式库列表过滤：学科 / 知识点 tag（命中其一即可）/ 关键词（FR-FX 查询契约，与真实后端同 URL） */
export function listStandardFormulas(filter: { subject?: string; knowledge?: string[]; keyword?: string } = {}): StandardFormula[] {
  const kw = (filter.keyword ?? '').trim()
  return standardFormulas.filter((row) => {
    if (filter.subject && row.branch !== filter.subject) return false
    if (filter.knowledge?.length && !row.knowledge.some((tag) => filter.knowledge!.includes(tag))) return false
    if (kw && !row.name.includes(kw) && !row.chapter.includes(kw) && !row.latex.includes(kw)) return false
    return true
  })
}

export function collectStandardFormula(id: number): StandardFormula {
  const item = standardFormulas.find((row) => row.id === id)
  if (!item) throw new Error('公式不存在')
  item.collected = !item.collected
  return item
}

let formulaSeq = 200
export const orgFormulas: OrgFormula[] = [
  { id: 201, name: '圆锥曲线焦点弦长', subject: '数学', category: '解析几何', latex: '|AB| = \\frac{2p}{\\sin^2\\theta}', scope: 'shared', status: 'approved', owner: '李文博', updatedAt: nowStr(-90) },
  { id: 202, name: '三棱锥体积速算', subject: '数学', category: '立体几何', latex: 'V = \\frac{1}{6}|\\vec{a} \\cdot (\\vec{b} \\times \\vec{c})|', scope: 'shared', status: 'pending', owner: '李文博', updatedAt: nowStr(-12) },
  { id: 203, name: '裂项相消通式', subject: '数学', category: '数列', latex: '\\frac{1}{n(n+1)} = \\frac{1}{n} - \\frac{1}{n+1}', scope: 'mine', status: 'approved', owner: '陈明远', updatedAt: nowStr(-40) },
  { id: 204, name: '位移-速度关系速用', subject: '物理', category: '运动学', latex: 'v^2 - v_0^2 = 2ax', scope: 'mine', status: 'approved', owner: '陈明远', updatedAt: nowStr(-6) },
]

/** 我的公式列表过滤：学科 / 关键词（scope 仍由视图按「我的」客户端过滤） */
export function listOrgFormulas(filter: { subject?: string; keyword?: string } = {}): OrgFormula[] {
  const kw = (filter.keyword ?? '').trim()
  return orgFormulas.filter((row) => {
    if (filter.subject && row.subject !== filter.subject) return false
    if (kw && !row.name.includes(kw) && !row.category.includes(kw) && !row.latex.includes(kw)) return false
    return true
  })
}

/** LaTeX 粗粒度语法校验：花括号/定界符配对（FR-FX-002） */
export function validateLatex(latex: string): string | null {
  if (!latex.trim()) return 'LaTeX 源码不能为空'
  let depth = 0
  let line = 1
  for (const ch of latex) {
    if (ch === '\n') line += 1
    if (ch === '{') depth += 1
    if (ch === '}') depth -= 1
    if (depth < 0) return `第 ${line} 行：多余的「}」`
  }
  if (depth > 0) return `第 ${line} 行：缺少 ${depth} 个「}」`
  return null
}

export function saveOrgFormula(input: Partial<OrgFormula> & { name: string; latex: string }): OrgFormula {
  if (input.name.trim().length < 2 || input.name.trim().length > 20) throw new Error('公式名称须为 2-20 字')
  const latexError = validateLatex(input.latex)
  if (latexError) throw new Error(latexError)
  if (input.id == null && !input.subject?.trim()) throw new Error('请选择学科')
  if (input.id != null) {
    const item = orgFormulas.find((row) => row.id === input.id)
    if (!item) throw new Error('公式不存在')
    Object.assign(item, { name: input.name.trim(), latex: input.latex, subject: input.subject ?? item.subject, category: input.category ?? item.category, updatedAt: nowStr() })
    return item
  }
  const item: OrgFormula = {
    id: ++formulaSeq,
    name: input.name.trim(),
    subject: input.subject!.trim(),
    category: input.category ?? '未分类',
    latex: input.latex,
    scope: 'mine',
    status: 'approved',
    owner: CURRENT.name,
    updatedAt: nowStr(),
  }
  orgFormulas.unshift(item)
  return item
}

export function shareFormula(id: number): OrgFormula {
  const item = orgFormulas.find((row) => row.id === id)
  if (!item) throw new Error('公式不存在')
  item.scope = 'shared'
  item.status = CURRENT.role === 'orgAdmin' ? 'approved' : 'pending'
  return item
}

export function reviewFormula(id: number, pass: boolean): OrgFormula {
  const item = orgFormulas.find((row) => row.id === id)
  if (!item) throw new Error('公式不存在')
  item.status = pass ? 'approved' : 'rejected'
  return item
}

export function offshelfFormula(id: number): OrgFormula {
  const item = orgFormulas.find((row) => row.id === id)
  if (!item) throw new Error('公式不存在')
  item.status = 'off'
  return item
}

export function deleteFormula(id: number): void {
  const item = orgFormulas.find((row) => row.id === id)
  if (!item) throw new Error('公式不存在')
  orgFormulas.splice(orgFormulas.indexOf(item), 1)
}

/* ================= 机构提示词模板（FR-PM-001 ~ 006） ================= */

export const ORG_PROMPT_SCENES = ['AI 出题', 'AI 变式', 'AI 智能组卷', '拍照识题解析']

export const platformPrompts = [
  { id: -1, name: '数学出题-平台默认', scene: 'AI 出题', content: '你是一位{{subject}}名师，请为{{grade}}学生命制{{count}}道{{type}}，难度为{{difficulty}}，考查知识点：{{knowledge}}。' },
  { id: -2, name: '变式生成-平台默认', scene: 'AI 变式', content: '请基于题干 {{stem}} 生成 {{count}} 道变式题，保持知识点与难度不变。' },
  { id: -3, name: '组卷策略-平台默认', scene: 'AI 智能组卷', content: '按题型结构 {{type}} 与难度配比 {{difficulty}} 组卷，共 {{count}} 题。' },
]

let orgPromptSeq = 300
export const orgPrompts: OrgPrompt[] = [
  {
    id: 301,
    name: '本校出题风格-函数专题',
    scene: 'AI 出题',
    content: '你是一位{{subject}}名师，请为{{grade}}学生命制{{count}}道{{type}}，难度为{{difficulty}}，考查{{knowledge}}，题干须贴近生活情境。',
    status: 'enabled',
    isDefault: true,
    remark: '结合本校期末命题风格',
    updatedAt: nowStr(-60),
    versions: [{ version: 1, savedAt: nowStr(-120), content: '你是一位{{subject}}名师，请命制{{count}}道{{type}}。' }],
  },
]

export function copyPlatformPrompt(platformId: number): OrgPrompt {
  const source = platformPrompts.find((row) => row.id === platformId)
  if (!source) throw new Error('平台模板不存在')
  if (orgPrompts.some((row) => row.scene === source.scene && row.name === `${source.name}（副本）`)) {
    throw new Error('机构内已存在同名模板')
  }
  const item: OrgPrompt = {
    id: ++orgPromptSeq,
    name: `${source.name}（副本）`,
    scene: source.scene,
    content: source.content,
    status: 'enabled',
    isDefault: false,
    remark: '',
    updatedAt: nowStr(),
    versions: [],
  }
  orgPrompts.unshift(item)
  return item
}

const PROMPT_VARS = ['{{subject}}', '{{grade}}', '{{type}}', '{{difficulty}}', '{{knowledge}}', '{{stem}}', '{{count}}']

export function saveOrgPrompt(input: Partial<OrgPrompt> & { name: string; content: string }): OrgPrompt {
  if (!input.name.trim()) throw new Error('模板名称不能为空')
  if (orgPrompts.some((row) => row.id !== input.id && row.name === input.name.trim())) {
    throw new Error('机构内已存在同名模板')
  }
  const unknown = (input.content.match(/\{\{[^}]+\}\}/g) ?? []).filter((token) => !PROMPT_VARS.includes(token))
  if (unknown.length > 0) throw new Error(`未知变量：${[...new Set(unknown)].join('、')}`)
  const item = input.id != null ? orgPrompts.find((row) => row.id === input.id) : undefined
  if (input.id != null && !item) throw new Error('模板不存在')
  const target = (item ?? {
    id: ++orgPromptSeq,
    scene: input.scene ?? ORG_PROMPT_SCENES[0],
    status: 'enabled',
    isDefault: false,
    versions: [],
  }) as OrgPrompt
  target.versions.push({ version: target.versions.length + 1, savedAt: nowStr(), content: target.content ?? input.content })
  target.name = input.name.trim()
  target.content = input.content
  target.scene = input.scene ?? target.scene
  target.remark = input.remark ?? target.remark
  target.updatedAt = nowStr()
  if (input.id == null) orgPrompts.unshift(target)
  return target
}

export function toggleOrgPrompt(id: number): OrgPrompt {
  const item = orgPrompts.find((row) => row.id === id)
  if (!item) throw new Error('模板不存在')
  if (item.status === 'enabled') {
    if (item.isDefault) throw new Error('默认启用模板不可停用，请先将其他模板设为默认')
    item.status = 'disabled'
  } else {
    // 同场景仅一个默认启用：启用新默认自动停用旧的
    if (item.isDefault) {
      orgPrompts.forEach((row) => {
        if (row.id !== item.id && row.scene === item.scene && row.status === 'enabled') row.status = 'disabled'
      })
    }
    item.status = 'enabled'
  }
  return item
}

export function setDefaultOrgPrompt(id: number): OrgPrompt {
  const item = orgPrompts.find((row) => row.id === id)
  if (!item) throw new Error('模板不存在')
  orgPrompts.forEach((row) => {
    if (row.scene === item.scene) row.isDefault = row.id === item.id
  })
  item.status = 'enabled'
  return item
}

export function testOrgPrompt(): { output: string; costMs: number; tokens: number } {
  consumeQuota(1)
  return {
    output: '【示例输出】已按机构模板风格生成：一、单选题（每题 5 分）\n1. 某商场促销，商品原价 200 元…（情境化题干，贴近生活）',
    costMs: 980 + Math.floor(Math.random() * 1800),
    tokens: 520 + Math.floor(Math.random() * 700),
  }
}

export function rollbackOrgPrompt(id: number, version: number): OrgPrompt {
  const item = orgPrompts.find((row) => row.id === id)
  if (!item) throw new Error('模板不存在')
  const target = item.versions.find((row) => row.version === version)
  if (!target) throw new Error('版本不存在')
  item.content = target.content
  item.versions.push({ version: item.versions.length + 1, savedAt: nowStr(), content: item.content })
  item.updatedAt = nowStr()
  return item
}

export function deleteOrgPrompt(id: number): void {
  const item = orgPrompts.find((row) => row.id === id)
  if (!item) throw new Error('模板不存在')
  if (item.status === 'enabled' && item.isDefault) throw new Error('正在使用中（默认启用），请先停用')
  orgPrompts.splice(orgPrompts.indexOf(item), 1)
}

/* ================= 知识广场（FR-SQ-001 ~ 005） ================= */

let squareSeq = 100
export const squareResources: SquareResource[] = [
  { id: 101, title: '二次函数图像十题精编', kind: '题目', subject: '数学', knowledge: '二次函数', sharer: '王老师', org: '明德中学', collects: 58, downloads: 132, collected: false, desc: '覆盖开口方向、对称轴、定点三类图像问题。' },
  { id: 102, title: '高一物理力学月考卷', kind: '试卷', subject: '物理', knowledge: '牛顿运动定律', sharer: '周老师', org: '三中教育集团', collects: 41, downloads: 96, collected: true, desc: '含答题卡与双向细目表。' },
  { id: 103, title: '三角函数微课（动图演示）', kind: '动画', subject: '数学', knowledge: '三角恒等变换', sharer: '刘老师', org: '实验外国语学校', collects: 73, downloads: 210, collected: false, desc: '单位圆诱导公式动态推导。' },
  { id: 104, title: '导数应用专题讲义', kind: '教辅', subject: '数学', knowledge: '导数应用', sharer: '陈老师', org: '育才高中', collects: 35, downloads: 88, collected: false, desc: '含 22 道分层例题。' },
  { id: 105, title: '立体几何截面问题视频', kind: '视频', subject: '数学', knowledge: '立体几何', sharer: '赵老师', org: '明德中学', collects: 26, downloads: 64, collected: false, desc: '12 分钟讲清截面作图通法。' },
  { id: 106, title: '数列求和方法归纳', kind: '教辅', subject: '数学', knowledge: '数列', sharer: '李老师', org: '星辰实验中学', collects: 19, downloads: 45, collected: false, desc: '裂项、错位、分组三大方法对比。' },
]

export function collectSquare(id: number): SquareResource {
  const item = squareResources.find((row) => row.id === id)
  if (!item) throw new Error('资源不存在')
  item.collected = !item.collected
  item.collects += item.collected ? 1 : -1
  return item
}

export function downloadSquare(id: number): SquareResource {
  const item = squareResources.find((row) => row.id === id)
  if (!item) throw new Error('资源不存在')
  item.downloads += 1
  return item
}

/* ================= 员工 / 角色 / 校区（FR-OS-001 ~ 010） ================= */

export const STAFF_QUOTA = { max: 20, current: 6 }

let staffSeq = 400
export const staff: StaffMember[] = [
  { id: 401, name: '陈明远', phone: '13900000001', role: '管理员', campus: '本部校区', enabled: true, pendingReviews: 0, lastLoginAt: nowStr(-1) },
  { id: 402, name: '沈丽华', phone: '13900000002', role: '审核员', campus: '本部校区', enabled: true, pendingReviews: 3, lastLoginAt: nowStr(-3) },
  { id: 403, name: '李文博', phone: '13900000003', role: '老师', campus: '东湖校区', enabled: true, pendingReviews: 0, lastLoginAt: nowStr(-6) },
  { id: 404, name: '王静', phone: '13900000004', role: '老师', campus: '本部校区', enabled: true, pendingReviews: 0, lastLoginAt: nowStr(-30) },
  { id: 405, name: '赵鹏', phone: '13900000005', role: '出题专员', campus: '东湖校区', enabled: false, pendingReviews: 1, lastLoginAt: nowStr(-600) },
  { id: 406, name: '孙悦', phone: '13900000006', role: '老师', campus: '本部校区', enabled: true, pendingReviews: 0, lastLoginAt: nowStr(-70) },
]

export function saveStaff(input: Partial<StaffMember> & { name: string; phone: string; role: string; campus: string }): StaffMember {
  if (input.name.trim().length < 2 || input.name.trim().length > 10) throw new Error('姓名须为 2-10 字')
  if (!/^1[3-9]\d{9}$/.test(input.phone)) throw new Error('手机号格式不正确')
  if (input.id == null && staff.some((row) => row.phone === input.phone)) throw new Error('该手机号已存在')
  if (input.id != null) {
    const item = staff.find((row) => row.id === input.id)
    if (!item) throw new Error('员工不存在')
    if (staff.some((row) => row.id !== item.id && row.phone === input.phone)) throw new Error('该手机号已存在')
    item.name = input.name.trim()
    item.phone = input.phone
    item.role = input.role
    item.campus = input.campus
    return item
  }
  if (staff.length >= STAFF_QUOTA.max) throw new Error('员工账号数已达套餐上限（20），请升级套餐')
  const item: StaffMember = {
    id: ++staffSeq,
    name: input.name.trim(),
    phone: input.phone,
    role: input.role,
    campus: input.campus,
    enabled: true,
    pendingReviews: 0,
    lastLoginAt: '—',
  }
  staff.push(item)
  STAFF_QUOTA.current = staff.length
  return item
}

export function toggleStaff(id: number): StaffMember {
  const item = staff.find((row) => row.id === id)
  if (!item) throw new Error('员工不存在')
  if (item.enabled && item.role === '管理员' && staff.filter((row) => row.role === '管理员' && row.enabled).length === 1) {
    throw new Error('最后一个管理员账号禁止停用')
  }
  item.enabled = !item.enabled
  return item
}

export function deleteStaff(id: number): void {
  const item = staff.find((row) => row.id === id)
  if (!item) throw new Error('员工不存在')
  if (item.pendingReviews > 0) throw new Error('名下有未处理审核任务，请先转交')
  staff.splice(staff.indexOf(item), 1)
  STAFF_QUOTA.current = staff.length
}

/** 角色权限矩阵（FR-OS-005 ~ 008） */
export const PERM_MODULES: Array<{ key: string; title: string; ops: string[] }> = [
  { key: 'question', title: '题目管理', ops: ['查看', '新增', '编辑', '删除', '审核', '导出'] },
  { key: 'paper', title: '试卷管理', ops: ['查看', '新增', '编辑', '删除', '审核', '导出'] },
  { key: 'material', title: '教辅管理', ops: ['查看', '新增', '编辑', '删除'] },
  { key: 'file', title: '我的文件', ops: ['查看', '上传', '删除'] },
  { key: 'formula', title: '公式中心', ops: ['查看', '新增', '分享'] },
  { key: 'prompt', title: '提示词模板', ops: ['查看', '测试'] },
  { key: 'square', title: '知识广场', ops: ['查看', '下载'] },
  { key: 'org', title: '机构管理', ops: ['查看', '配置'] },
]

const FULL = (ops: string[]) => ops

export const orgRoles: OrgRole[] = [
  { id: 1, name: '管理员', builtin: true, locked: true, perms: Object.fromEntries(PERM_MODULES.map((m) => [m.key, FULL(m.ops)])) },
  { id: 2, name: '审核员', builtin: true, locked: false, perms: { question: ['查看', '审核', '导出'], paper: ['查看', '审核', '导出'], material: ['查看'], file: ['查看'], formula: ['查看'], prompt: ['查看', '测试'], square: ['查看', '下载'], org: [] } },
  { id: 3, name: '老师', builtin: true, locked: false, perms: { question: ['查看', '新增', '编辑', '导出'], paper: ['查看', '新增', '编辑', '导出'], material: ['查看', '新增', '编辑'], file: ['查看', '上传'], formula: ['查看', '新增', '分享'], prompt: ['查看', '测试'], square: ['查看', '下载'], org: [] } },
  { id: 4, name: '出题专员', builtin: false, locked: false, perms: { question: ['查看', '新增', '编辑'], paper: ['查看'], material: ['查看'], file: ['查看', '上传'], formula: ['查看'], prompt: ['查看'], square: ['查看'], org: [] } },
]

let roleSeq = 10

export function saveRole(input: { id?: number; name: string; perms: Record<string, string[]>; copyFrom?: number }): OrgRole {
  if (input.id != null) {
    const item = orgRoles.find((row) => row.id === input.id)
    if (!item) throw new Error('角色不存在')
    if (item.locked) throw new Error('管理员角色锁定不可修改（防自锁）')
    if (orgRoles.some((row) => row.id !== item.id && row.name === input.name)) throw new Error('角色名称已存在')
    item.name = input.name
    item.perms = input.perms
    return item
  }
  if (orgRoles.some((row) => row.name === input.name)) throw new Error('角色名称已存在')
  const item: OrgRole = { id: ++roleSeq, name: input.name, builtin: false, locked: false, perms: input.perms }
  orgRoles.push(item)
  return item
}

export function deleteRole(id: number): void {
  const item = orgRoles.find((row) => row.id === id)
  if (!item) throw new Error('角色不存在')
  if (item.builtin) throw new Error('预置角色不可删除')
  if (staff.some((row) => row.role === item.name)) throw new Error('该角色名下仍有账号，请先转移')
  orgRoles.splice(orgRoles.indexOf(item), 1)
}

/** 校区（FR-OS-010） ================= */
let campusSeq = 50
export const campuses: Campus[] = [
  { id: 51, name: '本部校区', code: 'C01', address: '湖滨路 1 号', manager: '陈明远', staffCount: 4, enabled: true },
  { id: 52, name: '东湖校区', code: 'C02', address: '东湖高新大道 88 号', manager: '李文博', staffCount: 2, enabled: true },
]

export function saveCampus(input: Partial<Campus> & { name: string; code: string }): Campus {
  if (input.id != null) {
    const item = campuses.find((row) => row.id === input.id)
    if (!item) throw new Error('校区不存在')
    if (campuses.some((row) => row.id !== item.id && row.name === input.name)) throw new Error('机构内已存在同名校区')
    Object.assign(item, { name: input.name, address: input.address ?? item.address, manager: input.manager ?? item.manager })
    return item
  }
  if (campuses.some((row) => row.name === input.name)) throw new Error('机构内已存在同名校区')
  if (campuses.some((row) => row.code === input.code)) throw new Error('校区编码已存在（创建后不可改）')
  const item: Campus = { id: ++campusSeq, name: input.name, code: input.code, address: input.address ?? '', manager: input.manager ?? '', staffCount: 0, enabled: true }
  campuses.push(item)
  return item
}

export function toggleCampus(id: number): Campus {
  const item = campuses.find((row) => row.id === id)
  if (!item) throw new Error('校区不存在')
  item.enabled = !item.enabled
  return item
}

export function deleteCampus(id: number): void {
  const item = campuses.find((row) => row.id === id)
  if (!item) throw new Error('校区不存在')
  if (item.staffCount > 0) throw new Error('该校区名下仍有员工，请先转移员工')
  campuses.splice(campuses.indexOf(item), 1)
}

/* ================= 日志 / 通知配置（FR-OS-011 / 012） ================= */

export const orgLoginLogs = Array.from({ length: 10 }, (_, i) => ({
  id: i + 1,
  account: ['orgadmin', 'auditor', 'teacher', 'teacher_wang'][(i + 3) % 4],
  ip: `10.20.${30 + i}.${(i * 7) % 200 + 10}`,
  device: ['Chrome · macOS', 'Edge · Windows', 'Safari · iOS'][(i + 3) % 3],
  ok: i % 5 !== 2,
  time: nowStr(-(i * 9 + 2)),
}))

export const orgOperationLogs: OrgOperationLog[] = [
  { id: 1, account: 'orgadmin', module: '题目管理', action: '提交审核', target: '9002 · 求补集', ok: true, time: nowStr(-2) },
  { id: 2, account: 'teacher', module: '试卷管理', action: '创建试卷', target: '高一月考模拟卷（二）', ok: true, time: nowStr(-20) },
  { id: 3, account: 'auditor', module: '题目审核', action: '驳回', target: '9005 · 等差数列', ok: true, time: nowStr(-46) },
  { id: 4, account: 'orgadmin', module: '机构管理', action: '新增员工', target: '孙悦', ok: true, time: nowStr(-70) },
  { id: 5, account: 'teacher', module: '教辅管理', action: '上传教辅', target: '高一物理力学专项练习', ok: false, time: nowStr(-96) },
  { id: 6, account: 'orgadmin', module: '公式中心', action: '分享公式', target: '裂项相消通式', ok: true, time: nowStr(-120) },
]

export const notifyMatrix: NotifyMatrixRow[] = [
  { key: 'todo', label: '审核待办', inApp: true, sms: true, email: false },
  { key: 'result', label: '审核结果', inApp: true, sms: false, email: true },
  { key: 'collab', label: '协同邀请', inApp: true, sms: false, email: false },
  { key: 'ai', label: 'AI 任务完成', inApp: true, sms: false, email: false },
  { key: 'notice', label: '系统公告', inApp: true, sms: true, email: true },
]

/* ================= 消息中心（FR-GN-015 ~ 019） ================= */

let messageSeq = 900
export const orgMessages: OrgMessage[] = [
  { id: 901, tab: 'todo', title: '题目待终审：《求 ∁ᵤB（补集）…》', summary: 'AI 检测发现 1 处疑点（相似度 87%），请人工终审', module: '题目审核', time: nowStr(-1), read: false, link: '/question/review' },
  { id: 902, tab: 'todo', title: '试卷待人工审核：《高三一轮复习专项卷》', summary: 'AI 九项检测完成：1 处自动修复', module: '试卷审核', time: nowStr(-5), read: false, link: '/paper/review' },
  { id: 903, tab: 'review', title: '你的题目被驳回：《已知等差数列…》', summary: '驳回意见：解析过简，请补充推导过程', module: '题目审核', time: nowStr(-30), read: false, link: '/question/bank' },
  { id: 904, tab: 'collab', title: '李文博 邀请你协同组卷', summary: '《2026 级高一数学期中测试卷》· 权限：选题、改分值', module: '协同组卷', time: nowStr(-50), read: true, link: '/paper/collab' },
  { id: 905, tab: 'system', title: '本月 AI 额度已使用 41%', summary: '当前 412/1000 次，超出 80% 将再次提醒', module: '系统通知', time: nowStr(-100), read: true, link: '/dashboard' },
]

function pushMessage(input: Omit<OrgMessage, 'id' | 'read' | 'time'> & { time?: string }): void {
  orgMessages.unshift({ id: ++messageSeq, read: false, time: nowStr(), ...input })
}

export function listOrgMessages(tab: string): OrgMessage[] {
  return tab === 'all' ? [...orgMessages] : orgMessages.filter((row) => row.tab === tab)
}

export function markOrgMessageRead(id: number): void {
  const item = orgMessages.find((row) => row.id === id)
  if (item) item.read = true
}

export function markAllOrgMessagesRead(tab: string): void {
  orgMessages.forEach((row) => {
    if (tab === 'all' || row.tab === tab) row.read = true
  })
}

export function deleteOrgMessage(id: number): void {
  const item = orgMessages.find((row) => row.id === id)
  if (item) orgMessages.splice(orgMessages.indexOf(item), 1)
}

/* ================= 机构菜单权限（FR-OS-009，受超管套餐开关约束） ================= */

export interface OrgMenuNode {
  key: string
  title: string
  enabled: boolean
  platformLocked?: boolean
  children?: Array<{ key: string; title: string; enabled: boolean; platformLocked?: boolean }>
}

export const orgMenuTree: OrgMenuNode[] = [
  {
    key: 'question',
    title: '题目管理',
    enabled: true,
    children: [
      { key: 'question/bank', title: '题库管理', enabled: true },
      { key: 'question/manual', title: '手动录题', enabled: true },
      { key: 'question/ai', title: 'AI 智能出题', enabled: true },
      { key: 'question/photo', title: 'AI 拍照识题', enabled: true },
      { key: 'question/review', title: '题目审核中心', enabled: true },
    ],
  },
  {
    key: 'paper',
    title: '试卷管理',
    enabled: true,
    children: [
      { key: 'paper/list', title: '试卷库', enabled: true },
      { key: 'paper/collab', title: '协同组卷', enabled: true },
      { key: 'paper/review', title: '试卷审核中心', enabled: true },
    ],
  },
  {
    key: 'material',
    title: '教辅管理',
    enabled: true,
    children: [
      { key: 'material/list', title: '教辅资料', enabled: true },
      { key: 'material/media/image', title: '图片', enabled: true },
      { key: 'material/media/animation', title: '小程序动画', enabled: true },
      { key: 'material/media/video', title: '视频', enabled: true },
    ],
  },
  { key: 'file', title: '我的文件', enabled: true },
  {
    key: 'formula',
    title: '公式中心',
    enabled: true,
    children: [
      { key: 'formula/standard', title: '标准公式库', enabled: true },
      { key: 'formula/mine', title: '我的公式', enabled: true },
      { key: 'formula/shared', title: '机构共享公式', enabled: true },
    ],
  },
  {
    key: 'prompt',
    title: '提示词模板',
    enabled: true,
    platformLocked: true,
  },
  { key: 'square', title: '知识广场', enabled: true },
]

export function saveOrgMenus(items: OrgMenuNode[]): void {
  orgMenuTree.length = 0
  orgMenuTree.push(...items)
}
