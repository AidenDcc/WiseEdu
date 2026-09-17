/**
 * AI 拍照识题编排层（FR-TM-020）：本地图片 → 压缩编码 → 多模态模型识别 → 结构化归一化。
 *
 * 引擎选择：
 * - 已配置 VITE_VISION_API_KEY + VITE_VISION_MODEL → 真实调用多模态模型
 *   （OpenAI 兼容协议，image_url 内容块携带 base64 图片）；
 * - 未配置 → 回退到本地 mock 识别（PhotoView 走 org.uploadPhotos/recognizePhoto）。
 *
 * Deepseek 官方模型不支持图片输入，视觉通道独立配置（见 deepseek.ts 顶部注释），
 * 可指向任意 OpenAI 兼容多模态端点。解析复用 ai-normalize 的归一化管线，
 * 与 AI 出题共用公式/SVG 净化逻辑，解析失败自动重试一次。
 */
import type { PhotoTask } from '@aiteach/shared'
import { isVisionConfigured, visionChat, visionModel } from './deepseek'
import { buildPhotoUserPrompt, PHOTO_SYSTEM_PROMPT } from './ai-prompts'
import { normalizeQuestionList } from './ai-normalize'
import { uploadMedia } from './org'

export type PhotoEngine = 'vision' | 'mock'

/** 当前拍照识题引擎（页面用来展示「真实 AI / 本地演示」标识） */
export function photoEngine(): PhotoEngine {
  return isVisionConfigured() ? 'vision' : 'mock'
}

/** 当前视觉模型名（真实引擎时展示） */
export function photoModelName(): string {
  return visionModel()
}

/** 单张图片识别出的结果题数上限（防御模型无限拆题） */
const MAX_QUESTIONS_PER_PHOTO = 15
/** 识别出的题干文本长度上限，防止异常输出撑爆存储与渲染
 *  （多小问解答题的完整解析可能较长，给到 8000 字符，避免把正常长解析拦腰截断） */
const MAX_FIELD_LENGTH = 8000

/** 本地图片文件 → base64 data URL：等比压缩到长边 ≤1568px（视觉模型性价比最高的区间），JPEG 0.85 */
export async function fileToDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('图片解码失败，请换一张清晰的照片'))
      img.src = url
    })
    const scale = Math.min(1, 1568 / Math.max(image.width, image.height))
    /* 小图不放大，原样重编码即可 */
    const width = Math.max(1, Math.round(image.width * scale))
    const height = Math.max(1, Math.round(image.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('当前浏览器不支持图片处理')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(image, 0, 0, width, height)
    return canvas.toDataURL('image/jpeg', 0.85)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** 截断超长文本字段（识别结果入库前的兜底，不改写正常内容） */
function clip(text: string): string {
  return text.length > MAX_FIELD_LENGTH ? `${text.slice(0, MAX_FIELD_LENGTH)}…` : text
}

/**
 * 调用多模态模型识别一张照片，归一化为 PhotoTask.results 结构。
 * 供 PhotoView 在真实引擎模式下使用；mock 模式请走 org.recognizePhoto。
 */
export async function recognizePhotoFile(file: File, taskId: string): Promise<PhotoTask['results']> {
  const dataUrl = await fileToDataUrl(file)
  const messages = [
    { role: 'system' as const, content: PHOTO_SYSTEM_PROMPT },
    {
      role: 'user' as const,
      content: [
        { type: 'text' as const, text: buildPhotoUserPrompt(file.name) },
        { type: 'image_url' as const, image_url: { url: dataUrl } },
      ],
    },
  ]
  let lastError: unknown = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { content } = await visionChat(messages, { json: true, maxTokens: 8192 })
      /* richAnswer：解答/填空类（无选项）题的答案转富文本，校对区用编辑器承载，
         LaTeX 公式还原为标准公式节点；客观题答案仍是选项字母，不受影响 */
      const list = normalizeQuestionList(content, { maxCount: MAX_QUESTIONS_PER_PHOTO, richAnswer: true })
      return list.map((q, i) => ({
        id: `${taskId}_r${i}`,
        stem: clip(q.stem),
        options: q.options.map(clip),
        answer: clip(q.answer),
        analysis: clip(q.analysis),
        knowledge: q.knowledge.slice(0, 3),
        subject: q.subject,
        grade: q.grade,
        difficulty: q.difficulty,
        decided: null,
      }))
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('AI 识别失败，请稍后重试')
}

/* ==================== 知识点关联 ==================== */

/**
 * 把模型自判的知识点对齐到机构知识点池（按该题 grade + subject 拉取）。
 * 对齐策略：池内精确命中 → 双向包含（子串）命中 → 无法命中保留原名，
 * 保证入库的 knowledge 与题库筛选体系一致，同时不因对齐失败丢信息。
 */
export function alignKnowledgeToPool(name: string, pool: string[]): string {
  const trimmed = name.trim()
  if (!trimmed) return trimmed
  if (pool.includes(trimmed)) return trimmed
  const hit =
    pool.find((tag) => tag.includes(trimmed)) ?? pool.find((tag) => trimmed.includes(tag))
  return hit ?? trimmed
}

/* ==================== 内联图转存媒体库 ==================== */

/**
 * 把富文本字段里内联的 data: 图片（AI 重绘的 SVG 配图）转存 mock 媒体库，
 * 正文改写为媒体 URL —— 编辑器约定「正文只存 URL」且 Image 扩展 allowBase64:false，
 * 校对编辑时 data: 图会被整体剥掉；不转存的话，编辑一次题干图就丢了。
 */
export async function persistEmbeddedImages(html: string, subject: string): Promise<string> {
  if (!html.includes('<img')) return html
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const imgs = [...doc.querySelectorAll<HTMLImageElement>('img[src^="data:"]')]
  for (const img of imgs) {
    const dataUrl = img.getAttribute('src') ?? ''
    const semi = dataUrl.indexOf(';')
    const mime = semi > 5 ? dataUrl.slice(5, semi) : 'image/svg+xml'
    try {
      const media = await uploadMedia({
        name: img.getAttribute('alt') || 'AI 识别配图',
        kind: 'image',
        subject: subject || '通用',
        knowledge: [],
        dataUrl,
        mime,
        sizeMb: Math.round(dataUrl.length / 1024) / 1024,
      })
      if (media.url) img.setAttribute('src', media.url)
    } catch {
      /* 转存失败保留原 data URL：编辑时虽可能被剥掉，但直接采纳不编辑仍可显示 */
    }
  }
  return doc.body.innerHTML
}
