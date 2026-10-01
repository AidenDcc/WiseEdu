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

/** 客观题答案字母（选择题高亮正确项）；无选项的主观题返回空数组 */
export function answerLetters(item: { options: readonly unknown[]; answer: string }): string[] {
  return item.options.length > 0 ? [...new Set(item.answer.toUpperCase().replace(/[^A-F]/g, '').split(''))] : []
}

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

/** 图形占位框：题干提到配图、且题内确实没有嵌入图片时才显示 */
export function needsFigure(item: { stem: string }): boolean {
  if (hasImage(item.stem)) return false
  const text = toPlainText(item.stem)
  return text.includes('如图') || text.includes('图）')
}
