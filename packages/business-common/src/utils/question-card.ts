/**
 * 题目卡片（题库管理的「详细」列表 / AI 生成结果列表）共用的展示逻辑。
 *
 * 这两处卡片此前各自 scoped 抄了一份：QuestionResultList 的文件头注释写着「仓库既有做法就是
 * 各页 scoped 复制（见 BankView 的 .opt-chip、CreateView 的 .p-chip 注释）」。
 * 两者的数据形状不同（OrgQuestion + 状态 / 组卷篮 vs GeneratedQuestion + 质检结论），
 * 硬抽成一个组件要挂一堆可选字段与插槽，两边都更难读；但**判定逻辑可以共用**，
 * 于是收敛到这里，两个列表共同 import。
 *
 * 只放纯函数：不碰接口、不碰状态。
 */
import { hasImage, toPlainText } from '@aiteach/shared'
import type { OrgSubQuestion } from '@aiteach/shared'

/**
 * 「无选项判断题」：判断题不带「正确 / 错误」选项，学生直接在题干前的「（　　）」里写对错。
 *
 * 不设独立字段 —— 用 题型 + 选项是否为空 就地判定，存量数据不会误判，
 * 判分 / 排版 / 展示各处只要问这一个函数，口径就不会分叉。
 */
export function isJudgeNoOptions(item: { type: string; options: readonly unknown[] }): boolean {
  return item.type === '判断' && item.options.length === 0
}

/** 判断题答案归一到「对 / 错」，供无选项判断题展示（存量题存的是 A/B，也有存对/错/√/× 的） */
export function judgeAnswerText(answer: string): string {
  const text = answer.trim()
  if (!text) return ''
  return /^(A|T|√|对|正确|是|TRUE)/i.test(text) ? '对' : '错'
}

/**
 * 选项排布列数：题目自身配置优先，缺省回落到调用方给的默认（试卷侧即纸张预设）。
 * 非选择题（无选项）恒为 1，避免判断题 / 解答题拿到残留的列数。
 */
export function optionColumnsOf(
  item: { options: readonly unknown[]; optionColumns?: 1 | 2 | 4 },
  fallback: 1 | 2 | 4 = 1,
): 1 | 2 | 4 {
  if (item.options.length === 0) return 1
  return item.optionColumns ?? fallback
}

/** 难度标签配色（对应全局 .tag-* 类） */
export function difficultyClass(difficulty: string): string {
  if (difficulty === '困难' || difficulty === '较难') return 'tag-red'
  return difficulty === '中等' ? 'tag-orange' : 'tag-green'
}

/**
 * 大型考试：只有这些考试类型的题目才在题号后标注考试名。
 * 课后作业 / 单元测试 / 期中期末属于日常校考，逐题挂标签反而没有信息量。
 * 取值要跟着平台「考试类型」树的叶子名走（旧名「模拟考试」已并入「一模」）。
 */
const MAJOR_EXAMS = new Set(['一模', '学业水平考试', '高考真题', '中考真题'])

/**
 * 题号后随的来源标注：「名校 / 竞赛 / 大型考试」三类题目标出具体名称，供教师选题时判断题目分量。
 *
 * 优先级 杯赛 > 名校考试 > 大型考试 —— 一道题既是杯赛题又摘自名校卷时，杯赛名的信息量更大。
 * 只有 `source` 是「名校考试」时才看 `sourceRemark`：它记的就是「摘自哪份卷」，正是名校题要标的那句。
 */
export function questionSourceBadge(item: {
  source: string
  competition?: string
  examType?: string
  sourceRemark?: string
}): string {
  if (item.competition) return item.competition
  if (item.source === '名校考试') return item.sourceRemark || '名校考试'
  if (item.examType && MAJOR_EXAMS.has(item.examType)) return item.examType
  return ''
}

/** 图形占位框：题干提到配图、且题内确实没有嵌入图片时才显示 */
export function needsFigure(item: { stem: string }): boolean {
  if (hasImage(item.stem)) return false
  const text = toPlainText(item.stem)
  return text.includes('如图') || text.includes('图）')
}

/** 材料组合题：`stem` 是共用题干 / 材料，作答单位在 `subQuestions` 里 */
export function isCompositeQuestion(item: { questionCategory?: string }): boolean {
  return item.questionCategory === '材料组合题'
}

/**
 * 题目在列表里的**可检索文本**：题干 + （组合题的）各子题题干，拼成一段纯文本。
 *
 * 组合题的关键信息常常只在子题里（共用材料往往只有一句情境描述），
 * 搜索只匹配 `row.stem` 的话，「求 a 的取值范围」这类关键词搜不到任何东西。
 * 两端题库的关键词过滤共用这一份，避免一边改了另一边没改。
 */
export function questionSearchText(item: { stem: string; subQuestions?: Array<{ stem: string }> }): string {
  const parts = [toPlainText(item.stem)]
  for (const sub of item.subQuestions ?? []) parts.push(toPlainText(sub.stem))
  return parts.join(' ')
}

/**
 * 子题在预览 / 列表里的富文本占位：子题未填题干时给一句提示，
 * 免得卡片上出现一片空白（列表渲染不经过 QuestionBodyFields 的校验）。
 */
export function subStemText(stem: string): string {
  return toPlainText(stem).trim() || '（未填写题干）'
}

/**
 * 取材料的子题列表 —— 非组合题**恒为空数组**。
 *
 * 各渲染端一律走这个函数而不是直接读 `subQuestions`：组合题的身份只在
 * `questionCategory === '材料组合题'` 时成立，直接读字段会让「切回独立单题后残留的
 * 子题数组」也画出子题来（录题页切换类别时就可能出现这种残值）。
 */
export function subQuestionsOf(item: {
  questionCategory?: string
  subQuestions?: OrgSubQuestion[]
}): OrgSubQuestion[] {
  return isCompositeQuestion(item) ? item.subQuestions ?? [] : []
}

/** 组合题的小问数：列表徽标、卷面题量、答题卡说明都用这一个口径 */
export function subQuestionCount(item: {
  questionCategory?: string
  subQuestions?: readonly unknown[]
}): number {
  return isCompositeQuestion(item) ? item.subQuestions?.length ?? 0 : 0
}

/**
 * 子题答案是否为纯文本（客观题字母、无选项判断题的「对 / 错」，可直接展示）；
 * 主观题答案是富文本（含公式 / 插图），要走 RichTextViewer。
 *
 * 与母题侧 `isJudgeNoOptions` 同一口径：判断题不带选项时，「正确 / 错误」两个字
 * 写在题干前的括号里，答案就不是选项字母。
 */
export function subAnswerIsPlain(sub: { type: string; options: readonly unknown[] }): boolean {
  return sub.options.length > 0 || isJudgeNoOptions(sub)
}

/** 子题的卷面答案文本：无选项判断题把库里的 A/B 归一到「对 / 错」，其余原样 */
export function subAnswerText(sub: { type: string; options: readonly unknown[]; answer: string }): string {
  return isJudgeNoOptions(sub) ? judgeAnswerText(sub.answer) : sub.answer
}

/**
 * 材料组合题的「整体」徽标文案（按小问数）。
 *
 * 带上小问数是必要的：组合题在列表里只能露出共用材料那一段文字，
 * 光看材料认不出里面还有几道小题（也没法从题干里看出该给多少分）。
 */
export function compositeBadgeLabel(count: number): string {
  return count > 0 ? `材料组合题 · ${count} 小问` : '材料组合题'
}

/** 由题目数据直接取徽标文案（列表/卡片两侧同一口径） */
export function compositeBadgeText(item: {
  questionCategory?: string
  subQuestions?: readonly unknown[]
}): string {
  return compositeBadgeLabel(subQuestionCount(item))
}

/**
 * 紧凑文案（窄列专用）：`组合题 · N`。
 *
 * 题库列表的「题型」列只有 92px，完整文案「材料组合题 · 3 小问」会折行把行高顶起来，
 * 而这一列要跟题型文字一起竖排两行 —— 所以在这里另给一份短文案，而不是让页面各自截断。
 */
export function compositeBadgeShort(count: number): string {
  return count > 0 ? `组合题 · ${count}` : '组合题'
}
