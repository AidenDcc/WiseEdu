/**
 * 公式识图（编辑器「AI 识图」）编排层：本地图片 → 多模态识别 → LaTeX 源码。
 *
 * 与拍照识题（ai-photo.ts）共用一条视觉通道（visionChat + fileToDataUrl），但提示词与解析各走各的：
 * 拍照识题要的是「一整套结构化题目」，这里只要「一个 LaTeX」，混用会让模型把整道题干倒进公式框。
 *
 * 引擎选择：
 * - 已配置 `VITE_VISION_API_KEY`（或复用 Deepseek 的 Key）→ 走真实多模态模型；
 * - 未配置 → 本地演示数据；
 * - 配了 Key 但真实调用失败 → 也回退演示数据，并把失败原因放进 `note` 由界面明示。
 *   这一步是刻意加的一层兜底：本仓库开发环境通常只配了 `VITE_DEEPSEEK_API_KEY`，
 *   视觉模型名默认回落到 `deepseek-chat`（不支持图片输入），不兜底的话「AI 识图」一按就是报错，
 *   功能等于不可用；兜底时 note 会显示在弹窗里，不会把演示数据冒充成真实识别结果。
 */
import { isVisionConfigured, visionChat } from './deepseek'
import { FORMULA_OCR_SYSTEM_PROMPT, buildFormulaOcrUserPrompt } from './ai-prompts'
import { fileToDataUrl } from './ai-photo'

export type FormulaOcrEngine = 'vision' | 'mock'

/** 当前公式识图引擎（界面用来展示「AI 识别 / 本地演示」标识） */
export function formulaOcrEngine(): FormulaOcrEngine {
  return isVisionConfigured() ? 'vision' : 'mock'
}

/** 本地演示结果：一元二次方程求根公式 —— 一眼能看出是公式识别的产物，也便于核对渲染是否正常 */
const MOCK_LATEX = 'x = \\frac{-b \\pm \\sqrt{b^{2}-4ac}}{2a}'

export interface FormulaOcrResult {
  /** 识别出的 LaTeX 源码（已去掉 $ 包裹、压成单行） */
  latex: string
  engine: FormulaOcrEngine
  /** 真实通道失败后回退演示数据的原因（没有回退时为 undefined） */
  note?: string
}

/**
 * 识别一张图片里的公式。
 *
 * 超时与重试交给 visionChat（120s 超时）；这里不做重试 —— 公式识别是一次交互式操作，
 * 让用户当场看到失败并重新拍一张，比静默重试两次再报错体验好。
 */
export async function recognizeFormulaImage(file: File): Promise<FormulaOcrResult> {
  if (!isVisionConfigured()) return { latex: MOCK_LATEX, engine: 'mock' }

  try {
    const dataUrl = await fileToDataUrl(file)
    const { content } = await visionChat(
      [
        { role: 'system', content: FORMULA_OCR_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: buildFormulaOcrUserPrompt(file.name) },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      { json: true, maxTokens: 1024 },
    )
    return { latex: extractLatex(content), engine: 'vision' }
  } catch (error) {
    return {
      latex: MOCK_LATEX,
      engine: 'mock',
      note: error instanceof Error ? error.message : '识别通道不可用',
    }
  }
}

/**
 * 从模型输出里取 LaTeX。
 *
 * 三级兜底：JSON 的 latex 字段 → markdown 代码块里的裸源码 → 整段文本。
 * 开了 JSON Output 模式仍要留后两级：模型偶尔会把 latex 写成带 ``` 的代码块，
 * 或者直接吐一段源码出来（尤其被截断时），这时报「识别失败」不如把能用的部分捡回来。
 */
export function extractLatex(content: string): string {
  const text = content.trim()

  try {
    const parsed = JSON.parse(text) as { latex?: unknown }
    if (typeof parsed.latex === 'string' && parsed.latex.trim()) return cleanLatex(parsed.latex)
  } catch {
    /* 不是 JSON：走下面的兜底分支 */
  }

  const fenced = /```(?:latex|tex)?\s*([\s\S]*?)```/i.exec(text)
  return cleanLatex(fenced ? fenced[1] : text)
}

/** 归一：去掉外层的 `$` / `$$`，把真实换行压成空格（内联输入框是单行控件，换行会丢） */
function cleanLatex(raw: string): string {
  return raw
    .trim()
    .replace(/^\$\$?/, '')
    .replace(/\$\$?$/, '')
    .replace(/\s*\n\s*/g, ' ')
    .trim()
}
