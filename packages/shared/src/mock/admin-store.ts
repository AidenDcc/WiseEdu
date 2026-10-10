/**
 * 平台端其余模块 Mock 仓库：全局字典 / AI 服务配置 / 数据审计 / 系统管理 / 消息中心。
 * 与 tenant-store 相同：模块级可变状态，操作在会话内保持。
 */
import type {
  AdminAccount,
  AdminMenuItem,
  AdminRoleRecord,
  AgentCheckItem,
  AgentConfig,
  AiCallLog,
  AiModel,
  AiModelType,
  AuditRecord,
  DictItem,
  DictTypeKey,
  ErrorLog,
  ExamTypeNode,
  ExamTypeNodeKind,
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
import { PAPER_CATEGORIES } from '../api/models'

function nowStr(offsetHours = 0): string {
  return new Date(Date.now() + offsetHours * 3600_000).toISOString().slice(0, 19).replace('T', ' ')
}

function dateAfter(days: number): string {
  return new Date(Date.now() + days * 86400_000).toISOString().slice(0, 19).replace('T', ' ')
}

/* ================= 全局字典（FR-PT-015 / 016） ================= */

export const DICT_TYPES: Array<{ key: DictTypeKey; title: string; hint: string }> = [
  { key: 'subject', title: '学科', hint: '编码唯一，创建后不可修改；可限定适配年级' },
  { key: 'grade', title: '年级 / 学段', hint: '年级挂靠学段；编码唯一' },
  { key: 'term', title: '学期', hint: '起止日期不可交叉重叠' },
  { key: 'questionType', title: '题型', hint: '编码唯一；已被题目使用的题型不可修改作答类型，可限定适用学科' },
  { key: 'difficulty', title: '难度等级', hint: '系数 0-1.0，越小越难；保留 1 位小数且不可重复' },
  /* 这两项的维护入口已移到「考试类型」树（见 `examTypeNodes`），基础字典里不再展示；
     hint 保留给机构端与平台端的说明用，不再出现在管理端左栏 */
  { key: 'examType', title: '考试类型', hint: '题目筛选与组卷场景使用；含试卷分类与适配学段 / 学科，由「考试类型」树维护' },
  { key: 'competition', title: '杯赛', hint: '题目筛选维度，非杯赛题留空；由「考试类型」树维护' },
  { key: 'region', title: '地区', hint: '题目来源地区，用于筛名校真题；编码为省级行政区划代码' },
  { key: 'copyright', title: '版权信息', hint: '机构端首页页脚文案，一行一条，按排序展示' },
]

/**
 * 管理端「基础字典」左栏可见的类型：业务字典。
 *
 * examType / competition 已由「考试类型」树接管维护（见 `examTypeNodes`），
 * copyright 已迁到「系统数据字典」（见 `SYSTEM_DICT_TYPES`），都不再平铺在这里。
 *
 * **但 `DICT_TYPES` 不能跟着删** —— 机构端仍通过 `/tenant/dict?type=examType|competition`
 * 读它们（`listDict` → `dictStore`），那两条数据由树的投影函数持续刷新；
 * copyright 也仍由机构端首页页脚读同一份 `dictStore`。
 */
export const BASE_DICT_TYPES = DICT_TYPES.filter(
  (item) => item.key !== 'examType' && item.key !== 'competition' && item.key !== 'copyright',
)

/** 管理端「系统数据字典」的类型：系统级、随平台统一展示，机构端只读 */
export const SYSTEM_DICT_TYPES = DICT_TYPES.filter((item) => item.key === 'copyright')

/**
 * 杯赛 / 地区的取值。字典项与题目种子共用这一份 —— 题目侧按题号轮转取值（见
 * seedQuestionMeta），若两处各写一份字符串，必然出现「筛选项在、却没题命中」。
 *
 * 地区铺满 34 个省级行政区，`'全国'` 只是「不分地区」的哨兵、排在最前。
 * 题库的题量（一百多道）远多于地区数，轮转能保证每个取值都有题命中；试卷只有十几份，
 * 铺不满 34 个地区，冷门省份点下去仍可能是空列表 —— 所以筛选面板把这一行做成了
 * 「默认只显示一行 + 展开 / 收起」（见 FilterRowDef.collapsible）。
 */
export const COMPETITIONS = ['华罗庚金杯', '希望杯', '全国高中数学联赛', '全国初中数学联赛', '全国中学生英语能力竞赛']
export const REGIONS = [
  '全国',
  '北京', '天津', '河北', '山西', '内蒙古',
  '辽宁', '吉林', '黑龙江',
  '上海', '江苏', '浙江', '安徽', '福建', '江西', '山东',
  '河南', '湖北', '湖南', '广东', '广西', '海南',
  '重庆', '四川', '贵州', '云南', '西藏',
  '陕西', '甘肃', '青海', '宁夏', '新疆',
  '香港', '澳门', '台湾',
]

/**
 * 地区 → 省级行政区划代码（GB/T 2260 前两位）。
 *
 * 与 `REGIONS` 分开放而不是改成 `{ name, code }` 数组：`REGIONS` 还被 `seedQuestionMeta`
 * 按名字轮转取题（那边只要字符串），换成对象会波及题目种子与筛选值域。
 * 字典侧（`dictStore.region`）从这里取 code —— 两份数据放一起，加地区时不会漏。
 * `全国` 不是行政区划，给 `00` 作「不分地区」哨兵的占位码。
 */
export const REGION_CODES: Record<string, string> = {
  全国: '00',
  北京: '11', 天津: '12', 河北: '13', 山西: '14', 内蒙古: '15',
  辽宁: '21', 吉林: '22', 黑龙江: '23',
  上海: '31', 江苏: '32', 浙江: '33', 安徽: '34', 福建: '35', 江西: '36', 山东: '37',
  河南: '41', 湖北: '42', 湖南: '43', 广东: '44', 广西: '45', 海南: '46',
  重庆: '50', 四川: '51', 贵州: '52', 云南: '53', 西藏: '54',
  陕西: '61', 甘肃: '62', 青海: '63', 宁夏: '64', 新疆: '65',
  台湾: '71', 香港: '81', 澳门: '82',
}

/** 杯赛只挂理科题：文科题挂着「华罗庚金杯」在演示里一眼假 */
const COMPETITION_SUBJECTS = new Set(['数学', '物理', '化学'])

/**
 * 题目种子的地区 / 杯赛默认值，按题号轮转。演示数据必须保证每个字典取值都有样本，
 * 否则新加的筛选项点哪个都是空列表。
 */
export function seedQuestionMeta(id: number, subject: string): { region: string; competition?: string } {
  return {
    region: REGIONS[id % REGIONS.length],
    competition: id % 3 === 0 && COMPETITION_SUBJECTS.has(subject) ? COMPETITIONS[id % COMPETITIONS.length] : undefined,
  }
}

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
    { id: 11, name: '一年级', code: 'G01', stage: '小学', sort: 1, enabled: true, refCount: 6 },
    { id: 12, name: '二年级', code: 'G02', stage: '小学', sort: 2, enabled: true, refCount: 5 },
    { id: 17, name: '三年级', code: 'G03', stage: '小学', sort: 3, enabled: true, refCount: 2 },
    { id: 18, name: '四年级', code: 'G04', stage: '小学', sort: 4, enabled: true, refCount: 2 },
    { id: 19, name: '五年级', code: 'G05', stage: '小学', sort: 5, enabled: true, refCount: 2 },
    { id: 20, name: '六年级', code: 'G06', stage: '小学', sort: 6, enabled: true, refCount: 2 },
    { id: 13, name: '七年级', code: 'G07', stage: '初中', sort: 7, enabled: true, refCount: 6 },
    { id: 14, name: '八年级', code: 'G08', stage: '初中', sort: 8, enabled: true, refCount: 7 },
    { id: 21, name: '九年级', code: 'G09', stage: '初中', sort: 9, enabled: true, refCount: 7 },
    { id: 15, name: '高一', code: 'G10', stage: '高中', sort: 10, enabled: true, refCount: 9 },
    { id: 22, name: '高二', code: 'G11', stage: '高中', sort: 11, enabled: true, refCount: 7 },
    { id: 16, name: '高三', code: 'G12', stage: '高中', sort: 12, enabled: true, refCount: 5 },
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
    { id: 31, name: '单选', code: 'QT01', answerType: '选择', sort: 1, enabled: true, refCount: 9 },
    { id: 32, name: '多选', code: 'QT02', answerType: '选择', sort: 2, enabled: true, refCount: 7 },
    { id: 36, name: '判断', code: 'QT03', answerType: '选择', sort: 3, enabled: true, refCount: 3 },
    { id: 33, name: '填空', code: 'QT04', answerType: '填空', sort: 4, enabled: true, refCount: 8 },
    { id: 34, name: '解答', code: 'QT05', answerType: '解答', sort: 5, enabled: true, refCount: 9 },
    { id: 37, name: '计算', code: 'QT06', answerType: '解答', sort: 6, enabled: true, refCount: 1 },
    { id: 38, name: '证明', code: 'QT07', answerType: '解答', sort: 7, enabled: true, refCount: 1 },
    { id: 39, name: '连线', code: 'QT08', answerType: '连线', sort: 8, enabled: true, refCount: 1 },
    { id: 40, name: '作文', code: 'QT09', answerType: '解答', sort: 9, enabled: true, refCount: 1 },
    /* 英语专属题型（subjects 限定）：录题 / 筛选题型时先选学科，选到英语才多出这三项 */
    { id: 42, name: '完形填空', code: 'QT10', answerType: '填空', sort: 10, enabled: true, refCount: 1, subjects: ['英语'] },
    { id: 43, name: '七选五', code: 'QT11', answerType: '填空', sort: 11, enabled: true, refCount: 1, subjects: ['英语'] },
    { id: 44, name: '短文改错', code: 'QT12', answerType: '解答', sort: 12, enabled: true, refCount: 1, subjects: ['英语'] },
    { id: 35, name: '作图', code: 'QT13', answerType: '解答', sort: 13, enabled: false, refCount: 1 },
  ],
  /* 难度系数：**越小越难**（0 = 最难，1 = 最容易），保留 1 位小数。sort 仍是「容易 → 困难」的展示顺序。 */
  difficulty: [
    { id: 41, name: '容易', coefficient: 1.0, sort: 1, enabled: true, refCount: 9 },
    { id: 42, name: '较易', coefficient: 0.8, sort: 2, enabled: true, refCount: 8 },
    { id: 43, name: '中等', coefficient: 0.6, sort: 3, enabled: true, refCount: 9 },
    { id: 44, name: '较难', coefficient: 0.4, sort: 4, enabled: true, refCount: 6 },
    { id: 45, name: '困难', coefficient: 0.2, sort: 5, enabled: true, refCount: 3 },
  ],
  /* 试卷分类（paperCategory）= 组卷工作台试卷页签左树的一级分组；见 models.PAPER_CATEGORIES。
     存量这 10 条**刻意不设 stage / subjects**：它们的名字（期中考试、学业水平考试…）本身就跨学段，
     锁死在一个学段上反而会让「高一用不了期中考试」这种假限制出现。留空 = 全学段全学科通用。 */
  examType: [
    { id: 51, name: '随堂练习', sort: 1, enabled: true, refCount: 8, paperCategory: '同步教学' },
    { id: 52, name: '单元测试', sort: 2, enabled: true, refCount: 8, paperCategory: '同步教学' },
    { id: 53, name: '期中考试', sort: 3, enabled: true, refCount: 9, paperCategory: '阶段测试' },
    { id: 54, name: '期末考试', sort: 4, enabled: true, refCount: 9, paperCategory: '阶段测试' },
    { id: 55, name: '模拟考试', sort: 5, enabled: true, refCount: 5, paperCategory: '阶段测试' },
    { id: 56, name: '月考', sort: 6, enabled: true, refCount: 5, paperCategory: '阶段测试' },
    { id: 57, name: '开学考', sort: 7, enabled: true, refCount: 3, paperCategory: '阶段测试' },
    { id: 58, name: '学业水平考试', sort: 8, enabled: true, refCount: 2, paperCategory: '阶段测试' },
    { id: 59, name: '高考真题', sort: 9, enabled: true, refCount: 4, paperCategory: '阶段测试' },
    { id: 60, name: '专题训练', sort: 10, enabled: true, refCount: 3, paperCategory: '同步教学' },
    /* 小升初 / 竞赛两类的样本：没有它们，树上的这两个分组就永远是空的。
       学段 / 学科限定正是这两个分组的意义所在 —— 小学的「小升初真题」不该出现在高一树里。 */
    { id: 61, name: '小升初真题', sort: 11, enabled: true, refCount: 2, paperCategory: '小升初', stage: '小学' },
    { id: 62, name: '分班考试', sort: 12, enabled: true, refCount: 2, paperCategory: '小升初', stage: '小学' },
    { id: 63, name: '数学竞赛', sort: 13, enabled: true, refCount: 3, paperCategory: '竞赛', subjects: ['数学'] },
    { id: 64, name: '物理竞赛', sort: 14, enabled: true, refCount: 2, paperCategory: '竞赛', subjects: ['物理'] },
  ],
  /* 题库筛选维度。refCount 沿用本文件其余字典的「静态演示值」口径（>0 时仅可停用、不可删除），
     故用递减值填出「每一项都被题引用过」的样子 */
  competition: COMPETITIONS.map((name, i) => ({ id: 81 + i, name, sort: i + 1, enabled: true, refCount: 6 - i })),
  /* refCount 取 `Math.max(1, …)` 而不是裸的递减式：地区有 35 项，越界会算出负数，
     字典管理页会显示成负的引用数 */
  region: REGIONS.map((name, i) => ({ id: 91 + i, name, code: REGION_CODES[name], sort: i + 1, enabled: true, refCount: Math.max(1, 12 - i) })),
  /* 页脚文案：refCount 为该文案覆盖的机构数（平台统一展示，停用后机构端页脚不再出现该条） */
  copyright: [
    { id: 71, name: '© 2024-2026 星辰教育科技（杭州）有限公司 版权所有', sort: 1, enabled: true, refCount: 12 },
    { id: 72, name: '浙ICP备 2026001234 号-1', sort: 2, enabled: true, refCount: 12 },
    { id: 73, name: '浙公网安备 33010602001234 号', sort: 3, enabled: true, refCount: 12 },
    { id: 74, name: '客服热线 400-800-1234 · support@aiteach.cn', sort: 4, enabled: true, refCount: 12 },
    { id: 75, name: '本平台部分试题资源来自公开渠道，仅供教学研究使用', sort: 5, enabled: false, refCount: 0 },
  ],
}

function nextId(items: Array<{ id: number }>): number {
  return Math.max(0, ...items.map((item) => item.id)) + 1
}

/** 需要编码的字典类型；除 `EDITABLE_CODE_TYPES` 外，编码创建后不可改（编辑时被 strip 掉），故种子必须自带。 */
const CODE_TYPES: DictTypeKey[] = ['subject', 'grade', 'questionType', 'region']
/**
 * 编码**允许在编辑时修改**的类型（与上面 `CODE_TYPES` 里的「创建后锁定」区分开）。
 *
 * 只有地区：行政区划代码是现实值，录错了得能订正；学科 / 年级 / 题型的编码是库内约定，
 * 一改就会让历史数据对不上，仍锁死。前端 `DictBaseView` 侧同口径（改一处要改两处）。
 */
const EDITABLE_CODE_TYPES: DictTypeKey[] = ['region']
const CODE_TYPE_LABEL: Partial<Record<DictTypeKey, string>> = {
  subject: '学科',
  grade: '年级',
  questionType: '题型',
  region: '地区',
}

export function listDict(type: DictTypeKey): DictItem[] {
  return [...dictStore[type]].sort((a, b) => a.sort - b.sort)
}

export function saveDictItem(type: DictTypeKey, input: Partial<DictItem>): DictItem {
  const items = dictStore[type]
  /* 序号：列表按它升序展示，越小越靠前。允许与已有项并列（并列时保持稳定序），
     但不能是 0 / 负数 / 小数 —— 界面上的「序号」就是这一列。 */
  if (input.sort !== undefined) {
    const sort = Number(input.sort)
    if (!Number.isInteger(sort) || sort < 1) throw new Error('序号须为不小于 1 的整数')
    input.sort = sort
  }
  if (type === 'difficulty' && input.coefficient !== undefined) {
    const coefficient = Math.round(Number(input.coefficient) * 10) / 10
    if (!Number.isFinite(coefficient) || coefficient < 0 || coefficient > 1) {
      throw new Error('难度系数须在 0-1 之间（保留 1 位小数，越小越难）')
    }
    input.coefficient = coefficient
  }
  if (input.id) {
    const item = items.find((row) => row.id === input.id)
    if (!item) throw new Error('字典项不存在')
    /* 同级重名校验。分组键取 `input.stage` 本身而不是 `?? item.stage`：
       调用方把 stage 显式传成 undefined 表示「改成不限学段」，回退到旧值会让这次修改
       按旧分组查重（漏判重名），写完却已落到「不限」组里。 */
    if (
      input.name !== undefined &&
      items.some((row) => row.id !== item.id && row.name === input.name && row.stage === input.stage)
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
    /* 编码：只有地区允许改（校验唯一后写回），其余类型创建后锁定 —— 下面的解构会把
       `code` 摘出去，`EDITABLE_CODE_TYPES` 之外的类型改不动它。 */
    if (input.code !== undefined && EDITABLE_CODE_TYPES.includes(type)) {
      const label = CODE_TYPE_LABEL[type] ?? '字典项'
      const code = input.code.trim().toUpperCase()
      if (!code) throw new Error(`${label}编码不能为空`)
      if (items.some((row) => row.id !== item.id && row.code === code)) {
        throw new Error(`${label}编码已存在`)
      }
      input.code = code
    }
    const { id: _id, code, ...rest } = input
    Object.assign(item, rest)
    if (code !== undefined && EDITABLE_CODE_TYPES.includes(type)) item.code = code
    return item
  }
  /* 新增：编码唯一 / 学期日期重叠 / 系数重复校验 */
  if (CODE_TYPES.includes(type)) {
    const label = CODE_TYPE_LABEL[type] ?? '字典项'
    const code = (input.code ?? '').trim().toUpperCase()
    if (!code) throw new Error(`${label}编码不能为空`)
    if (items.some((row) => row.code === code)) throw new Error(`${label}编码已存在`)
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
    /* 兜底序号取「现有最大 + 1」而不是 `length + 1`：序号可被改成任意 ≥1 的整数，
       用条数当序号会撞号（10 条里把序号改成 1~10 之外的数，第 11 条就与某条并列） */
    sort: input.sort ?? Math.max(0, ...items.map((row) => row.sort)) + 1,
    enabled: input.enabled ?? true,
    refCount: 0,
    stage: input.stage,
    year: input.year,
    termHalf: input.termHalf,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    answerType: input.answerType,
    coefficient: input.coefficient,
    subjects: input.subjects?.length ? [...input.subjects] : undefined,
    grades: input.grades?.length ? [...input.grades] : undefined,
    paperCategory: input.paperCategory,
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

/* ================= 考试类型树（合并原「考试类型」+「杯赛」字典） ================= */

/**
 * 合并后的考试类型树，最多 5 级。**它是唯一事实源**：`dictStore.examType` 与
 * `dictStore.competition` 退化为它的投影（见 `syncExamTypeDict`）。机构端读字典
 * 仍走 `GET /tenant/dict` → `listDict` → `dictStore`，因此那边一行都不用改。
 *
 * 四个一级节点固定为 `PAPER_CATEGORIES`：机构端组卷「试卷类型树」正是按这四个名字
 * 分组的（见 tenant 的 PapersTab / ListView），根节点改名或删除会让其子节点在机构端
 * 树上失联，所以根不允许改名与删除。
 */
export const MAX_EXAM_TYPE_DEPTH = 5

/** 根节点 id 基数：与字典项 id（51~85）拉开，避免混淆 */
const CATEGORY_ROOT_BASE = 100

/**
 * 树的种子：把原先平铺的两份字典折成树。
 * - 四个分类根（id 100~103）来自 `PAPER_CATEGORIES`
 * - examType 各条按 `paperCategory` 挂到对应根下，**原样带上 stage / subjects / refCount**
 *   （少了 stage / subjects，机构端「小升初真题只在小学生效」「数学竞赛只在数学生效」就废了）
 * - `COMPETITIONS` 5 条挂到「竞赛」根下，kind = 'competition'
 */
function seedExamTypeNodes(): ExamTypeNode[] {
  const rootIdOf = (category: string | undefined): number | null => {
    const index = PAPER_CATEGORIES.findIndex((item) => item === category)
    return index < 0 ? null : CATEGORY_ROOT_BASE + index
  }
  const roots: ExamTypeNode[] = PAPER_CATEGORIES.map((name, index) => ({
    id: CATEGORY_ROOT_BASE + index,
    parentId: null,
    name,
    kind: 'category',
    enabled: true,
    refCount: 0,
  }))
  const examTypes: ExamTypeNode[] = dictStore.examType
    .filter((item) => rootIdOf(item.paperCategory) !== null)
    .map((item) => ({
      id: item.id,
      parentId: rootIdOf(item.paperCategory),
      name: item.name,
      kind: 'examType',
      enabled: item.enabled,
      refCount: item.refCount,
      stage: item.stage,
      subjects: item.subjects?.length ? [...item.subjects] : undefined,
    }))
  const cups: ExamTypeNode[] = dictStore.competition.map((item) => ({
    id: item.id,
    parentId: rootIdOf('竞赛'),
    name: item.name,
    kind: 'competition',
    enabled: item.enabled,
    refCount: item.refCount,
  }))
  return [...roots, ...examTypes, ...cups]
}

export const examTypeNodes: ExamTypeNode[] = seedExamTypeNodes()

/** 节点所属的试卷分类根名（不在任何分类根之下时返回 null） */
function rootCategoryOf(id: number): string | null {
  let cursor = examTypeNodes.find((node) => node.id === id)
  const seen = new Set<number>()
  while (cursor && cursor.parentId !== null) {
    if (seen.has(cursor.id)) return null
    seen.add(cursor.id)
    const parentId = cursor.parentId
    cursor = examTypeNodes.find((node) => node.id === parentId)
  }
  return cursor && cursor.kind === 'category' ? cursor.name : null
}

/** 节点深度（根 = 1） */
function examTypeDepthOf(id: number): number {
  let depth = 1
  let cursor = examTypeNodes.find((node) => node.id === id)
  const seen = new Set<number>()
  while (cursor && cursor.parentId !== null) {
    if (seen.has(cursor.id)) break
    seen.add(cursor.id)
    const parentId = cursor.parentId
    cursor = examTypeNodes.find((node) => node.id === parentId)
    depth += 1
  }
  return depth
}

/** 前序遍历：树上的展示顺序就是机构端筛选 / 试卷类型树里的顺序 */
function preorderExamTypeNodes(): ExamTypeNode[] {
  const out: ExamTypeNode[] = []
  const walk = (parentId: number | null) => {
    for (const node of examTypeNodes.filter((item) => item.parentId === parentId)) {
      out.push(node)
      walk(node.id)
    }
  }
  walk(null)
  return out
}

/**
 * 把树投影回两份只读字典（`dictStore.examType` / `dictStore.competition`）。
 *
 * 用 `splice` 原地替换而不是重新赋值：`dictStore` 是个 `const` 对象字面量，
 * 且机构端接口持有的是 `dictStore[type]` 的引用路径，换掉数组会让引用对不上。
 * 每次增删改后都调一次，两边就不会漂移。
 */
function syncExamTypeDict(): void {
  const ordered = preorderExamTypeNodes()
  const examType: DictItem[] = ordered
    .filter((node) => node.kind === 'examType')
    .map((node, index) => ({
      id: node.id,
      name: node.name,
      sort: index + 1,
      enabled: node.enabled,
      refCount: node.refCount,
      stage: node.stage,
      subjects: node.subjects?.length ? [...node.subjects] : undefined,
      paperCategory: rootCategoryOf(node.id) ?? undefined,
    }))
  const competition: DictItem[] = ordered
    .filter((node) => node.kind === 'competition')
    .map((node, index) => ({
      id: node.id,
      name: node.name,
      sort: index + 1,
      enabled: node.enabled,
      refCount: node.refCount,
    }))
  dictStore.examType.splice(0, dictStore.examType.length, ...examType)
  dictStore.competition.splice(0, dictStore.competition.length, ...competition)
}

/* 启动时先归一一次：种子是照 dictStore 反推的，命中同构数据；归一后树的顺序即机构端顺序，
   不会出现「启动是旧顺序、改一次才变成树顺序」的分裂 */
syncExamTypeDict()

export function listExamTypeNodes(): ExamTypeNode[] {
  return examTypeNodes.map((node) => ({
    ...node,
    subjects: node.subjects ? [...node.subjects] : undefined,
  }))
}

export function saveExamTypeNode(input: Partial<ExamTypeNode>): ExamTypeNode {
  const name = (input.name ?? '').trim()
  if (!name) throw new Error('名称不能为空')

  if (input.id) {
    const node = examTypeNodes.find((item) => item.id === input.id)
    if (!node) throw new Error('节点不存在')
    /* 分类根是机构端分组口径的锚点，改名 / 改类型都会让子节点在机构端失联 */
    if (node.kind === 'category') throw new Error('试卷分类根节点不可修改')
    if (
      examTypeNodes.some(
        (item) => item.id !== node.id && item.parentId === node.parentId && item.name === name,
      )
    ) {
      throw new Error('同级下已存在同名项')
    }
    node.name = name
    if (input.kind === 'examType' || input.kind === 'competition') node.kind = input.kind
    if (node.kind === 'competition') {
      node.stage = undefined
      node.subjects = undefined
    } else {
      /* 显式传空串表示「改成不限」，所以用 `||` 而不是 `??` */
      node.stage = input.stage || undefined
      node.subjects = input.subjects?.length ? [...input.subjects] : undefined
    }
    syncExamTypeDict()
    return node
  }

  const parentId = input.parentId ?? null
  if (parentId === null) throw new Error('试卷分类根节点由系统固定，不能新增根节点')
  const parent = examTypeNodes.find((item) => item.id === parentId)
  if (!parent) throw new Error('父节点不存在')
  if (examTypeDepthOf(parentId) >= MAX_EXAM_TYPE_DEPTH) {
    throw new Error(`考试类型树最多 ${MAX_EXAM_TYPE_DEPTH} 级，无法再添加子节点`)
  }
  if (examTypeNodes.some((item) => item.parentId === parentId && item.name === name)) {
    throw new Error('同级下已存在同名项')
  }
  const kind: ExamTypeNodeKind = input.kind === 'competition' ? 'competition' : 'examType'
  const node: ExamTypeNode = {
    id: nextId(examTypeNodes),
    parentId,
    name,
    kind,
    enabled: true,
    refCount: 0,
    stage: kind === 'examType' ? input.stage || undefined : undefined,
    subjects: kind === 'examType' && input.subjects?.length ? [...input.subjects] : undefined,
  }
  examTypeNodes.push(node)
  syncExamTypeDict()
  return node
}

export function toggleExamTypeNode(id: number): boolean {
  const node = examTypeNodes.find((item) => item.id === id)
  if (!node) throw new Error('节点不存在')
  const next = !node.enabled
  /* 整棵子树同步启停：父节点停用而子节点仍启用，机构端会拿到悬空项 */
  const stack = [node.id]
  while (stack.length) {
    const currentId = stack.pop()!
    const current = examTypeNodes.find((item) => item.id === currentId)
    if (!current) continue
    current.enabled = next
    examTypeNodes.filter((item) => item.parentId === currentId).forEach((child) => stack.push(child.id))
  }
  syncExamTypeDict()
  return next
}

export function deleteExamTypeNode(id: number): void {
  const node = examTypeNodes.find((item) => item.id === id)
  if (!node) throw new Error('节点不存在')
  if (node.kind === 'category') throw new Error('试卷分类根节点不可删除')
  if (examTypeNodes.some((item) => item.parentId === id)) throw new Error('请先删除或移走子节点')
  if (node.refCount > 0) throw new Error(`该项已被 ${node.refCount} 道题目引用，仅可停用`)
  examTypeNodes.splice(examTypeNodes.indexOf(node), 1)
  syncExamTypeDict()
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
    knowledge: '二次函数图像与性质', type: '解答', difficulty: '中等', orgMasked: '机构 A',
    variantCount: 3, aiStatus: '全部通过', createdAt: dateAfter(-9),
    options: [], answer: '(-1, 0) 与 (3, 0)', analysis: '令 f(x)=0 即 x²-2x-3=0，解得 x₁=-1，x₂=3。',
    report: '语义完整性✓ 计算验算✓ LaTeX✓ 知识点匹配✓ 难度匹配✓ 查重(8%)✓',
    variants: ['变式1：求与 y 轴交点', '变式2：求顶点坐标', '变式3：区间内最值'],
  },
  {
    id: 2, stem: '下列关于牛顿第三定律的说法正确的是（ ）…', subject: '物理',
    knowledge: '牛顿运动定律', type: '单选', difficulty: '较易', orgMasked: '机构 C',
    variantCount: 1, aiStatus: '人工终审通过', createdAt: dateAfter(-6),
    options: ['A. 作用力与反作用力作用在同一物体上', 'B. 作用力与反作用力大小相等、方向相反', 'C. 先有作用力后有反作用力', 'D. 作用力与反作用力性质可以不同'],
    answer: 'B', analysis: '作用力与反作用力等大反向、作用在两个物体上、同时产生同时消失、性质相同。',
    report: '语义完整性✓ 计算验算✓ 图形描述✓ 知识点匹配✓ 难度匹配✓ 查重(22%)→人工终审通过',
    variants: ['变式1：牛顿第二定律情境'],
  },
  {
    id: 3, stem: '阅读下面的文言文，完成后面题目：邹忌修八尺有余……', subject: '语文',
    knowledge: '文言文阅读', type: '解答', difficulty: '较难', orgMasked: '机构 A',
    variantCount: 0, aiStatus: '全部通过', createdAt: dateAfter(-4),
    options: [], answer: '（示例）纳谏、自知之明', analysis: '考查对文意的理解概括与实词推断。',
    report: '语义完整性✓ 知识点匹配✓ 难度匹配✓ 查重(5%)✓',
    variants: [],
  },
  {
    id: 4, stem: '设集合 A = {x | x² - 3x + 2 = 0}，B = {x | 0 < x < 3}，则 A ∩ B = …', subject: '数学',
    knowledge: '集合运算', type: '填空', difficulty: '容易', orgMasked: '机构 D',
    variantCount: 2, aiStatus: '自动修复 2 处后通过', createdAt: dateAfter(-2),
    options: [], answer: '{1, 2}', analysis: 'A = {1,2}，B 为开区间，交集为 {1,2}。',
    report: '数值笔误×2 → 自动修复（置信度 96%/93%）其余项通过',
    variants: ['变式1：求 A ∪ B', '变式2：求 ∁ᵤB（补集）'],
  },
  {
    id: 5, stem: 'As is known to all, the Great Wall ___ (stretch) across northern China…', subject: '英语',
    knowledge: '时态语态', type: '填空', difficulty: '中等', orgMasked: '机构 B',
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
    id: 1, objectType: '题目', objectName: '二次函数与 x 轴交点（解答）', agentPassed: 7, agentTotal: 8,
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
    id: 2, objectType: '题目', objectName: '牛顿第三定律（单选）', agentPassed: 7, agentTotal: 8,
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
    id: 4, objectType: '题目', objectName: '集合交集（填空）', agentPassed: 6, agentTotal: 8,
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
  { id: 9, account: 'ops_wang', module: '全局字典', action: '删除字典项', target: '题型-判断', ok: false, time: nowStr(-80) },
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

/* ---------------- 管理端菜单树（菜单管理） ----------------
 *
 * 扁平节点 + parentId，与考试类型树同模型。它是左侧边栏的唯一事实源 —— 早先菜单写死在
 * `apps/admin/src/menu.ts`，改不动也看不见。
 *
 * **层级上限 2 级**（顶级分组 + 子菜单），另有「顶级叶子」这一形态（平台工作台）：
 * 侧边栏（AppLayout）就只渲染这两层，放开第三层会出现「配了却看不到」的节点。
 */
export const MAX_ADMIN_MENU_DEPTH = 2

/** 顶级叶子节点（无子节点）自带 icon；分组节点的 icon 也在此给 */
export const adminMenus: AdminMenuItem[] = [
  { id: 1, parentId: null, title: '平台工作台', path: '/dashboard', icon: 'dashboard', sort: 1, enabled: true, builtin: true },

  { id: 10, parentId: null, title: '租户管理', path: '/tenant', icon: 'building', sort: 2, enabled: true, builtin: true },
  { id: 11, parentId: 10, title: '机构列表', path: '/tenant/list', sort: 1, enabled: true, builtin: true },
  { id: 12, parentId: 10, title: '机构入驻审核', path: '/tenant/apply', sort: 2, enabled: true, builtin: true },
  { id: 13, parentId: 10, title: '套餐管理', path: '/tenant/package', sort: 3, enabled: true, builtin: true },

  { id: 20, parentId: null, title: '全局字典', path: '/dict', icon: 'book', sort: 3, enabled: true, builtin: true },
  { id: 21, parentId: 20, title: '基础字典', path: '/dict/base', sort: 1, enabled: true, builtin: true },
  { id: 22, parentId: 20, title: '知识点树', path: '/dict/knowledge', sort: 2, enabled: true, builtin: true },
  { id: 23, parentId: 20, title: '教材版本', path: '/dict/textbook', sort: 3, enabled: true, builtin: true },
  { id: 24, parentId: 20, title: '考试类型', path: '/dict/exam-type', sort: 4, enabled: true, builtin: true },

  { id: 30, parentId: null, title: '内容运营', path: '/content', icon: 'book', sort: 4, enabled: true, builtin: true },
  { id: 31, parentId: 30, title: '公共题库', path: '/content/questions', sort: 1, enabled: true, builtin: true },
  { id: 32, parentId: 30, title: '公共试卷库', path: '/content/papers', sort: 2, enabled: true, builtin: true },
  { id: 33, parentId: 30, title: '内容分发', path: '/content/distribution', sort: 3, enabled: true, builtin: true },
  { id: 34, parentId: 30, title: '合规抽检', path: '/content/compliance', sort: 4, enabled: true, builtin: true },
  { id: 35, parentId: 30, title: '反馈工单', path: '/content/feedback', sort: 5, enabled: true, builtin: true },

  { id: 40, parentId: null, title: 'AI 服务配置', path: '/ai', icon: 'cpu', sort: 5, enabled: true, builtin: true },
  { id: 41, parentId: 40, title: '模型接入管理', path: '/ai/models', sort: 1, enabled: true, builtin: true },
  { id: 42, parentId: 40, title: '多智能体编排', path: '/ai/agents', sort: 2, enabled: true, builtin: true },
  { id: 43, parentId: 40, title: '全局 Prompt 模板', path: '/ai/prompts', sort: 3, enabled: true, builtin: true },
  { id: 44, parentId: 40, title: 'AI 安全治理', path: '/ai/safety', sort: 4, enabled: true, builtin: true },
  { id: 45, parentId: 40, title: 'AI 计费与能力开关', path: '/ai/billing', sort: 5, enabled: true, builtin: true },

  { id: 50, parentId: null, title: '数据审计', path: '/audit', icon: 'chart', sort: 6, enabled: true, builtin: true },
  { id: 51, parentId: 50, title: 'AI 调用日志', path: '/audit/ai-logs', sort: 1, enabled: true, builtin: true },
  { id: 52, parentId: 50, title: '平台资源总库', path: '/audit/resources', sort: 2, enabled: true, builtin: true },
  { id: 53, parentId: 50, title: '日志审计', path: '/audit/logs', sort: 3, enabled: true, builtin: true },
  { id: 54, parentId: 50, title: '服务健康监控', path: '/audit/health', sort: 4, enabled: true, builtin: true },

  { id: 60, parentId: null, title: '系统管理', path: '/system', icon: 'sliders', sort: 7, enabled: true, builtin: true },
  { id: 61, parentId: 60, title: '管理员账号', path: '/system/accounts', sort: 1, enabled: true, builtin: true },
  { id: 62, parentId: 60, title: '角色权限', path: '/system/roles', sort: 2, enabled: true, builtin: true },
  { id: 63, parentId: 60, title: '菜单管理', path: '/system/menus', sort: 3, enabled: true, builtin: true },
  { id: 64, parentId: 60, title: '机构菜单权限', path: '/system/tenant-menus', sort: 4, enabled: true, builtin: true },
  { id: 65, parentId: 60, title: '系统数据字典', path: '/system/dict', sort: 5, enabled: true, builtin: true },
  { id: 66, parentId: 60, title: '系统参数', path: '/system/params', sort: 6, enabled: true, builtin: true },
  { id: 67, parentId: 60, title: '消息模板', path: '/system/messages', sort: 7, enabled: true, builtin: true },
  { id: 68, parentId: 60, title: '存储与备份', path: '/system/storage', sort: 8, enabled: true, builtin: true },
]

export function listAdminMenus(): AdminMenuItem[] {
  return adminMenus.map((item) => ({ ...item })).sort((a, b) => a.sort - b.sort)
}

/** 节点所在层级（顶级 = 1） */
function adminMenuDepthOf(id: number): number {
  let depth = 1
  let current = adminMenus.find((item) => item.id === id)
  while (current?.parentId != null) {
    depth += 1
    current = adminMenus.find((item) => item.id === current!.parentId)
  }
  return depth
}

/** 是否把 id 挂到 parentId 下会形成环（parentId 是 id 自身或其后代） */
function wouldCycle(id: number, parentId: number): boolean {
  let current: number | null = parentId
  while (current != null) {
    if (current === id) return true
    current = adminMenus.find((item) => item.id === current)?.parentId ?? null
  }
  return false
}

export function saveAdminMenuItem(input: Partial<AdminMenuItem>): AdminMenuItem {
  const title = (input.title ?? '').trim()
  if (!title) throw new Error('菜单名称不能为空')
  const path = (input.path ?? '').trim()
  if (!path) throw new Error('菜单路径不能为空')
  if (!path.startsWith('/')) throw new Error('菜单路径须以 / 开头')

  if (input.id) {
    const node = adminMenus.find((item) => item.id === input.id)
    if (!node) throw new Error('菜单不存在')
    if (adminMenus.some((item) => item.id !== node.id && item.title === title && item.parentId === node.parentId)) {
      throw new Error('同级下已存在同名菜单')
    }
    if (adminMenus.some((item) => item.id !== node.id && item.path === path)) {
      throw new Error('菜单路径已存在')
    }
    const parentId = input.parentId !== undefined ? input.parentId : node.parentId
    if (parentId != null) {
      if (!adminMenus.some((item) => item.id === parentId)) throw new Error('上级菜单不存在')
      if (wouldCycle(node.id, parentId)) throw new Error('不能把菜单移动到它自己或它的子菜单下')
      /* 移动后新位置的层级：新父层级 + 1，不能超过上限 */
      if (adminMenuDepthOf(parentId) + 1 > MAX_ADMIN_MENU_DEPTH) {
        throw new Error(`菜单最多 ${MAX_ADMIN_MENU_DEPTH} 级，无法移到该上级下`)
      }
    }
    node.title = title
    node.path = path
    node.icon = input.icon?.trim() || undefined
    if (input.sort !== undefined) {
      const sort = Number(input.sort)
      if (!Number.isInteger(sort) || sort < 1) throw new Error('排序须为不小于 1 的整数')
      node.sort = sort
    }
    if (input.enabled !== undefined) node.enabled = input.enabled
    node.parentId = parentId
    return node
  }

  const parentId = input.parentId ?? null
  if (parentId !== null) {
    const parent = adminMenus.find((item) => item.id === parentId)
    if (!parent) throw new Error('上级菜单不存在')
    if (adminMenuDepthOf(parentId) >= MAX_ADMIN_MENU_DEPTH) {
      throw new Error(`菜单最多 ${MAX_ADMIN_MENU_DEPTH} 级，无法再添加子菜单`)
    }
  }
  if (adminMenus.some((item) => item.title === title && item.parentId === parentId)) {
    throw new Error('同级下已存在同名菜单')
  }
  if (adminMenus.some((item) => item.path === path)) throw new Error('菜单路径已存在')
  const sort = input.sort !== undefined ? Number(input.sort) : undefined
  if (sort !== undefined && (!Number.isInteger(sort) || sort < 1)) throw new Error('排序须为不小于 1 的整数')
  const siblings = adminMenus.filter((item) => item.parentId === parentId)
  const node: AdminMenuItem = {
    id: nextId(adminMenus),
    parentId,
    title,
    path,
    icon: input.icon?.trim() || undefined,
    sort: sort ?? Math.max(0, ...siblings.map((item) => item.sort)) + 1,
    enabled: input.enabled ?? true,
    builtin: false,
  }
  adminMenus.push(node)
  return node
}

export function toggleAdminMenuItem(id: number): boolean {
  const node = adminMenus.find((item) => item.id === id)
  if (!node) throw new Error('菜单不存在')
  const next = !node.enabled
  /* 整棵子树同步启停：父节点隐藏而子节点仍启用，侧边栏会落下一个悬空分组 */
  const stack = [node.id]
  while (stack.length) {
    const currentId = stack.pop()!
    const current = adminMenus.find((item) => item.id === currentId)
    if (!current) continue
    current.enabled = next
    adminMenus.filter((item) => item.parentId === currentId).forEach((child) => stack.push(child.id))
  }
  return next
}

export function deleteAdminMenuItem(id: number): void {
  const node = adminMenus.find((item) => item.id === id)
  if (!node) throw new Error('菜单不存在')
  if (adminMenus.some((item) => item.parentId === id)) throw new Error('请先删除或移走子菜单')
  adminMenus.splice(adminMenus.indexOf(node), 1)
}

/* ---------------- 管理端角色（角色权限） ----------------
 *
 * `permissions` 存可见菜单的 path；`['*']` = 全部。分组不登记（是否显示分组由组内是否有
 * 可见叶子推导），所以 `ops` 的种子只列叶子。
 */

/** 内置超级管理员的 code：账号 `admin` 用它，权限恒为全部且不可编辑（避免把唯一演示账号锁死） */
export const ADMIN_SUPER_ROLE_CODE = 'super'

/** 「系统管理」分组节点的 id：`ops` 角色的默认权限 = 全部叶子减去它下面的叶子 */
const SYSTEM_MENU_ID = 60

const adminRoleSeeds: Array<Omit<AdminRoleRecord, 'memberCount'>> = [
  {
    id: 1,
    code: ADMIN_SUPER_ROLE_CODE,
    name: '超级管理员',
    desc: '平台全部权限，含系统管理；不可删除、不可停用，权限不可修改。',
    builtin: true,
    enabled: true,
    permissions: ['*'],
  },
  {
    id: 2,
    code: 'ops',
    name: '运营专员',
    desc: '除系统管理外的全部权限，负责租户、内容与 AI 服务日常运营。',
    builtin: true,
    enabled: true,
    /* 除「系统管理」分组下的叶子外的全部叶子。判「叶子」用有无子节点，而不是 `parentId != null`
       —— 后者会把「平台工作台」这个顶级叶子一起漏掉。 */
    permissions: adminMenus
      .filter(
        (item) =>
          !adminMenus.some((child) => child.parentId === item.id) && item.parentId !== SYSTEM_MENU_ID,
      )
      .map((item) => item.path),
  },
]

export function listAdminRoles(): AdminRoleRecord[] {
  return adminRoleSeeds.map((role) => ({
    ...role,
    permissions: [...role.permissions],
    memberCount: adminAccounts.filter((account) => account.role === role.code).length,
  }))
}

export function saveAdminRole(input: Partial<AdminRoleRecord>): AdminRoleRecord {
  const name = (input.name ?? '').trim()
  if (!name) throw new Error('角色名称不能为空')
  /* 权限：内置超级管理员恒为 ['*']，忽略传入值 */
  const permissions = input.permissions?.length ? [...new Set(input.permissions)] : []

  if (input.id) {
    const role = adminRoleSeeds.find((item) => item.id === input.id)
    if (!role) throw new Error('角色不存在')
    if (adminRoleSeeds.some((item) => item.id !== role.id && item.name === name)) {
      throw new Error('角色名称已存在')
    }
    role.name = name
    role.desc = (input.desc ?? '').trim()
    if (input.enabled !== undefined && role.code !== ADMIN_SUPER_ROLE_CODE) role.enabled = input.enabled
    if (role.code !== ADMIN_SUPER_ROLE_CODE) role.permissions = permissions
    return { ...role, permissions: [...role.permissions], memberCount: 0 }
  }

  const code = (input.code ?? '').trim().toLowerCase()
  if (!/^[a-z][a-z0-9_]{1,19}$/.test(code)) {
    throw new Error('角色编码须为 2-20 位小写字母 / 数字 / 下划线，且以字母开头')
  }
  if (adminRoleSeeds.some((item) => item.code === code)) throw new Error('角色编码已存在')
  if (!permissions.length) throw new Error('请至少勾选一项菜单权限')
  const role: Omit<AdminRoleRecord, 'memberCount'> = {
    id: nextId(adminRoleSeeds),
    code,
    name,
    desc: (input.desc ?? '').trim(),
    builtin: false,
    enabled: input.enabled ?? true,
    permissions,
  }
  adminRoleSeeds.push(role)
  return { ...role, permissions: [...role.permissions], memberCount: 0 }
}

export function toggleAdminRole(id: number): boolean {
  const role = adminRoleSeeds.find((item) => item.id === id)
  if (!role) throw new Error('角色不存在')
  if (role.code === ADMIN_SUPER_ROLE_CODE) throw new Error('内置超级管理员角色不可停用')
  role.enabled = !role.enabled
  return role.enabled
}

export function deleteAdminRole(id: number): void {
  const role = adminRoleSeeds.find((item) => item.id === id)
  if (!role) throw new Error('角色不存在')
  if (role.builtin) throw new Error('内置角色不可删除')
  const memberCount = adminAccounts.filter((account) => account.role === role.code).length
  if (memberCount > 0) throw new Error(`该角色下仍有 ${memberCount} 个管理员，请先调整归属`)
  adminRoleSeeds.splice(adminRoleSeeds.indexOf(role), 1)
}

export const adminAccounts: AdminAccount[] = [
  { id: 1, account: 'admin', name: '系统管理员', role: 'super', enabled: true, lastLoginAt: nowStr(-0.5) },
  { id: 2, account: 'ops_wang', name: '王运营', role: 'ops', enabled: true, lastLoginAt: nowStr(-20) },
  { id: 3, account: 'ops_liu', name: '刘运营', role: 'ops', enabled: true, lastLoginAt: nowStr(-74) },
  { id: 4, account: 'ops_chen', name: '陈运营', role: 'ops', enabled: false, lastLoginAt: dateAfter(-60) },
]

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
