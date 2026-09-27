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
