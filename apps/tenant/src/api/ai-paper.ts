/**
 * 试卷审核的「AI 九项检测」。
 *
 * 检测项与试卷自己那份 `aiChecks`（提交审核时由服务端写入）**同名同数**：
 * 试卷结构 / 总分题量 / 题型分布 / 单题完整性 / 公式批量 / 答案验算 / 难度均衡 /
 * 知识点覆盖 / 卷内查重。审核员在不同入口（试卷审核中心、审批管理）看到的必须是同一套项，
 * 否则「审核中心说 9 项全过、审批页说 4 项有风险」就成了两个产品。
 *
 * 两件事分开：
 * - `paperAiChecks()` 只算九项结论（纯函数，可重复调用，幂等）；
 * - `opinionFromPaperChecks()` 把未通过项拼成一段可直接填进「审核意见」的话。
 *
 * 真实引擎未接入时这就是最终口径：全部结论都从**卷面数据**推出来（题量、总分、答案、知识点、
 * 查重），没有随机数 —— 同一份卷反复检测结论一致，审核员不会看到「这次过、下次不过」。
 */
import { paperQuestionCount, paperTotalScore, toPlainText } from '@aiteach/shared'
import type { AiCheckResult, OrgPaper, OrgQuestion } from '@aiteach/shared'

/** 九项检测的名字（顺序固定，页面按这个顺序铺） */
export const PAPER_CHECK_NAMES = [
  '试卷结构',
  '总分题量',
  '题型分布',
  '单题完整性',
  '公式批量',
  '答案验算',
  '难度均衡',
  '知识点覆盖',
  '卷内查重',
] as const

/** 取卷内题目（按 sections 顺序摊平，找不到的题跳过，避免整卷统计被一两条脏数据带崩） */
export function questionsOfPaper(paper: OrgPaper, questions: OrgQuestion[]): OrgQuestion[] {
  const byId = new Map(questions.map((row) => [row.id, row] as const))
  return paper.sections.flatMap((section) =>
    section.questions.map((entry) => byId.get(entry.questionId)).filter((row): row is OrgQuestion => Boolean(row)),
  )
}

/** LaTeX 行内公式的 `$` 是否成对（奇数个说明老师漏了收尾） */
function unbalancedFormula(text: string): boolean {
  const dollars = (text.match(/\$/g) ?? []).length
  return dollars % 2 === 1
}

/**
 * 跑一遍九项检测。
 *
 * 入参 `questions` 是全量题库（卷里只存 questionId）：缺了它就统计不出题型分布与单题完整性，
 * 所以调用方必须把题库一起传进来（试卷审核中心本来就是题目/试卷一起拉的）。
 */
export function paperAiChecks(paper: OrgPaper, questions: OrgQuestion[]): AiCheckResult[] {
  const rows = questionsOfPaper(paper, questions)
  const count = paperQuestionCount(paper)
  const score = paperTotalScore(paper)
  const types = [...new Set(rows.map((row) => row.type))]
  const difficulties = [...new Set(rows.map((row) => row.difficulty).filter(Boolean))]
  const missingBody = rows.filter((row) => !toPlainText(row.answer).trim() || !toPlainText(row.analysis).trim())
  const badFormula = rows.filter((row) => unbalancedFormula(row.stem) || unbalancedFormula(row.analysis))
  const noKnowledge = rows.filter((row) => !row.knowledge.length)
  /* 客观题答案必须是选项字母；问答题给富文本答案，不参与这一项 */
  const badAnswer = rows.filter((row) => {
    if (!row.options.length) return false
    return !/^[A-F]+$/i.test(row.answer.replace(/[\s、,，]/g, ''))
  })
  const ids = paper.sections.flatMap((section) => section.questions.map((entry) => entry.questionId))
  const duplicated = ids.filter((id, index) => ids.indexOf(id) !== index)
  const emptySection = paper.sections.filter((section) => section.questions.length === 0)

  return [
    {
      name: '试卷结构',
      pass: paper.sections.length > 0 && emptySection.length === 0,
      note: !paper.sections.length
        ? '卷面还没有大题，无法入库'
        : emptySection.length
          ? `有 ${emptySection.length} 个大题没有题目（${emptySection.map((row) => row.title).join('、')}）`
          : `共 ${paper.sections.length} 个大题，均有题目`,
    },
    {
      name: '总分题量',
      pass: count > 0 && score > 0,
      note: count > 0 ? `${count} 题，合计 ${score} 分` : '卷内没有题目，分值与题量均为 0',
    },
    {
      name: '题型分布',
      pass: types.length >= 2,
      note:
        types.length >= 2
          ? `覆盖 ${types.length} 种题型：${types.join('、')}`
          : types.length === 1
            ? `只有「${types[0]}」一种题型，建议补充客观题或主观题`
            : '未识别到题型',
    },
    {
      name: '单题完整性',
      pass: missingBody.length === 0,
      note: missingBody.length
        ? `${missingBody.length} 道题缺答案或解析：${missingBody.slice(0, 3).map((row) => `#${row.id}`).join('、')}${missingBody.length > 3 ? ' 等' : ''}`
        : '全部题目含答案与解析',
    },
    {
      name: '公式批量',
      pass: badFormula.length === 0,
      note: badFormula.length
        ? `${badFormula.length} 道题的公式定界符不成对（$ 未闭合），排版会串行`
        : 'LaTeX 定界符成对，批量语法校验通过',
    },
    {
      name: '答案验算',
      pass: badAnswer.length === 0,
      note: badAnswer.length
        ? `${badAnswer.length} 道客观题的答案不是有效选项字母：${badAnswer.slice(0, 3).map((row) => `#${row.id}`).join('、')}`
        : '客观题答案均为有效选项字母',
    },
    {
      name: '难度均衡',
      pass: difficulties.length >= 2,
      note:
        difficulties.length >= 2
          ? `覆盖 ${difficulties.length} 档难度：${difficulties.join('、')}`
          : difficulties.length === 1
            ? `整卷只有「${difficulties[0]}」难度，区分度不足`
            : '题目未标注难度',
    },
    {
      name: '知识点覆盖',
      pass: noKnowledge.length === 0,
      note: noKnowledge.length
        ? `${noKnowledge.length} 道题没有知识点标注：${noKnowledge.slice(0, 3).map((row) => `#${row.id}`).join('、')}`
        : '全部题目都挂了知识点，可按章检索',
    },
    {
      name: '卷内查重',
      pass: duplicated.length === 0,
      note: duplicated.length
        ? `有 ${new Set(duplicated).size} 道题在卷内重复出现：${[...new Set(duplicated)].map((id) => `#${id}`).join('、')}`
        : '无重复题',
    },
  ]
}

/** 未通过的检测项拼成审核意见：首行结论 + 逐条问题（驳回意见 ≥5 字的要求天然满足） */
export function opinionFromPaperChecks(items: AiCheckResult[]): string {
  const issues = items.filter((item) => !item.pass)
  if (!issues.length) {
    return '经 AI 九项检测：试卷结构完整、题量分值与卷面一致，答案与解析齐备，未发现阻断性问题，建议通过入库。'
  }
  const lines = issues.map(
    (item, index) => `${index + 1}）${item.name}：${item.note.replace(/[。；;，,\s]+$/, '')}`,
  )
  return [`AI 九项检测发现 ${issues.length} 处待处理问题，建议修改后再入库：`, ...lines].join('\n')
}
