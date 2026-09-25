/**
 * 全局搜索的图片检索编排（FR-GN-026）：本地图片 → 检索关键词。
 *
 * 引擎切换与拍照识题一致（见 ai-photo.ts）：
 * - 已配置 VITE_VISION_API_KEY + VITE_VISION_MODEL → 真实多模态模型识图取关键词；
 * - 未配置 → 回退本地 mock 关键词（org.recognizeSearchImage）。
 *
 * 只取关键词、不落库：图片搜索与文本搜索共用同一条检索链路，识别结果仅作为输入回填。
 */
import { isVisionConfigured, visionChat } from './deepseek'
import { buildSearchImageUserPrompt, SEARCH_IMAGE_SYSTEM_PROMPT } from './ai-prompts'
import { fileToDataUrl } from './ai-photo'
import { recognizeSearchImage } from './org'

export type SearchImageEngine = 'vision' | 'mock'

/** 当前图片搜索引擎（搜索面板用来标注「真实 AI / 本地演示」） */
export function searchImageEngine(): SearchImageEngine {
  return isVisionConfigured() ? 'vision' : 'mock'
}

/** 从模型输出里取 keyword：容忍 ```json 包裹与前后说明文字 */
function pickKeyword(content: string): string {
  const match = content.match(/\{[\s\S]*\}/)
  if (!match) return ''
  try {
    const data = JSON.parse(match[0]) as { keyword?: unknown }
    return typeof data.keyword === 'string' ? data.keyword.trim() : ''
  } catch {
    return ''
  }
}

/** 图片 → 检索关键词；返回空字符串表示未能识别出可检索的内容 */
export async function searchKeywordFromImage(file: File): Promise<string> {
  if (!isVisionConfigured()) return (await recognizeSearchImage(file.name)).keyword
  const dataUrl = await fileToDataUrl(file)
  const { content } = await visionChat(
    [
      { role: 'system', content: SEARCH_IMAGE_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: buildSearchImageUserPrompt(file.name) },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
    { json: true, maxTokens: 512 },
  )
  return pickKeyword(content)
}
