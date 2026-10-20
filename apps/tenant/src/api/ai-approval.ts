/**
 * 审批详情里的「AI 检测」。
 *
 * 审批人打开一条提审单，最想知道两件事：这份资源本身有没有硬伤、该不该放行。
 * 所以这里把检测结果收敛成**一份可直接使用的审批意见**（`opinion`），而不是只给一堆检查项 ——
 * 审批人点一下就能把意见填进「通过 / 驳回」的输入框，再按需改两笔。
 *
 * ## 两类资源两条路
 *
 * - **题目**：走真正的题库质检引擎（`checkQuestionByAi`，与题目审核中心同一套），
 *   材料组合题会逐子题出报告项；
 * - **其他资源（试卷 / 讲义 / 课件 / 教案 / 学案 / 视频）**：没有逐字正文可查，
 *   按审批真正要看的那几件事做规则预检（信息完整性 / 学段匹配 / 命名与版权 / 附件可读），
 *   口径固定、结论可解释 —— 比硬套题目质检（会报「缺少答案」这种对试卷无意义的项）更贴近实际。
 *
 * 两条路都返回同一种结构，页面不必分支渲染。
 */
import { toPlainText } from '@aiteach/shared'
import type { ApprovalKind, OrgQuestion } from '@aiteach/shared'
import { checkInputOfQuestion, checkQuestionByAi } from './ai-check'

export interface ApprovalCheckItem {
  name: string
  pass: boolean
  note: string
}

export interface ApprovalCheckReport {
  /** 结论来自真实模型还是本地预检（页面只用来标注来源，不影响渲染） */
  engine: 'deepseek' | 'mock'
  items: ApprovalCheckItem[]
  /** 可直接写入审批意见的建议文案 */
  opinion: string
}

export interface ApprovalCheckInput {
  kind: ApprovalKind
  name: string
  subject: string
  grade: string
  /** 已取到的题目正文（仅 kind='题目' 且能在题库里找到时） */
  question?: OrgQuestion | null
  /** 申请人备注 */
  note?: string
  /** 资源规模描述（试卷题量 / 大纲条目数等），用于「内容完整性」一项 */
  scaleText?: string
}

/** 把所有检查项拼成一段意见：首行结论 + 逐条问题；全部通过时给一句「建议通过」 */
export function opinionFromChecks(items: ApprovalCheckItem[], passText: string, failLead: string): string {
  const issues = items.filter((item) => !item.pass)
  if (issues.length === 0) return passText
  const lines = issues.map((item, index) => `${index + 1}）${item.name}：${item.note.replace(/[。；;，,\s]+$/, '')}`)
  return [failLead, ...lines].join('\n')
}

/** 非题目类资源的规则预检 */
function checkResource(input: ApprovalCheckInput): ApprovalCheckItem[] {
  const name = input.name.trim()
  const plain = toPlainText(name).trim()
  const items: ApprovalCheckItem[] = [
    {
      name: '信息完整性',
      pass: Boolean(input.subject && input.grade && plain.length >= 4),
      note:
        input.subject && input.grade && plain.length >= 4
          ? `学科 ${input.subject}、年级 ${input.grade} 已标注，名称可识别`
          : '学科 / 年级 / 名称有缺项，检索与归档会受影响',
    },
    {
      name: '内容规模',
      pass: Boolean(input.scaleText),
      note: input.scaleText ? `已识别到 ${input.scaleText}` : '未识别到可统计的内容规模，建议人工抽查正文',
    },
    {
      name: '命名规范',
      pass: !/副本|未命名|新建|test|临时/i.test(plain),
      note: /副本|未命名|新建|test|临时/i.test(plain)
        ? '名称含「副本 / 未命名 / 临时」等字样，入库后难以检索'
        : '名称规范，含学科与内容主题',
    },
    {
      name: '来源与版权',
      pass: Boolean(input.note?.trim()),
      note: input.note?.trim()
        ? `申请人已说明来源与用途：${input.note.trim()}`
        : '申请人未填写来源说明，公开/跨组共享前建议补充',
    },
  ]
  return items
}

/**
 * 执行检测。
 *
 * 题目走引擎（未配置 Deepseek 时引擎自身回退本地启发式，仍然可用）；
 * 引擎抛错不吞掉 —— 页面据此提示「检测失败，可重试」，比给一份假报告更诚实。
 */
export async function checkApproval(input: ApprovalCheckInput): Promise<ApprovalCheckReport> {
  if (input.kind === '题目' && input.question) {
    const report = await checkQuestionByAi(checkInputOfQuestion(input.question))
    const items: ApprovalCheckItem[] = report.items.map((item) => ({
      name: item.scope ? `${item.scope} · ${item.aspect}` : item.aspect,
      pass: item.level === 'ok',
      note: item.message,
    }))
    return {
      engine: report.engine === 'deepseek' ? 'deepseek' : 'mock',
      items,
      opinion: opinionFromChecks(
        items,
        '经 AI 检测：题干、答案与解析自洽，学段与知识点标注匹配，未发现需要修改的问题，建议通过入校本库。',
        '经 AI 检测发现以下待修改问题，建议修改后再入校本库：',
      ),
    }
  }

  const items = checkResource(input)
  return {
    engine: 'mock',
    items,
    opinion: opinionFromChecks(
      items,
      '经合规预检：资源信息完整、命名规范、来源清晰，未发现风险项，建议通过。',
      '合规预检发现以下问题，建议补充后再提交：',
    ),
  }
}
