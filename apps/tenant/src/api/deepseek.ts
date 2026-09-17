/**
 * Deepseek OpenAI 兼容接口客户端（FR-TM-013 真实 AI 通道）。
 *
 * - Key 只从 VITE_DEEPSEEK_API_KEY 读取（放在 .env.local，已被根目录 .gitignore 的
 *   `*.local` 规则排除，不会提交到 gitee）；代码库中不硬编码任何密钥。
 * - 浏览器直连 api.deepseek.com 会被 CORS 拦截，故默认走同源相对路径 `/deepseek`：
 *   本地由 vite dev proxy 转发（vite.config.ts）；Cloudflare Pages 线上由
 *   functions/deepseek/[[path]].ts 边缘代理转发（Pages Functions，随部署自动生效）。
 *   生产也可通过 VITE_DEEPSEEK_BASE_URL 指向自建网关。
 */
const BASE_URL = import.meta.env.VITE_DEEPSEEK_BASE_URL || '/deepseek'
const API_KEY = import.meta.env.VITE_DEEPSEEK_API_KEY || ''
const MODEL = import.meta.env.VITE_DEEPSEEK_MODEL || 'deepseek-chat'

/* ===== 视觉（多模态）识别通道：拍照识题用，OpenAI 兼容协议 =====
 * 默认复用 Deepseek 通道的地址与 Key（VITE_DEEPSEEK_*），即「请求 Deepseek 分析图片」；
 * 仅模型名单独取 VITE_VISION_MODEL（Deepseek 官方模型不支持图片输入，若走官方接口
 * 需通过支持视觉的网关/代理，或在 .env.local 用 VITE_VISION_BASE_URL / VITE_VISION_API_KEY
 * 指向任意 OpenAI 兼容的多模态端点，如 DashScope 兼容模式）。 */
const VISION_BASE_URL = import.meta.env.VITE_VISION_BASE_URL || BASE_URL
const VISION_API_KEY = import.meta.env.VITE_VISION_API_KEY || API_KEY
const VISION_MODEL = import.meta.env.VITE_VISION_MODEL || MODEL

/** 是否已配置视觉识别（未配置时拍照识题自动回退本地 mock 演示数据） */
export function isVisionConfigured(): boolean {
  return VISION_API_KEY.startsWith('sk-')
}

/** 当前视觉模型名（页面展示用） */
export function visionModel(): string {
  return VISION_MODEL
}

/** 多模态消息内容块：文本或图片（base64 data URL / http URL） */
export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

/** 是否已配置 Deepseek（未配置时 AI 出题自动回退到本地 mock 演示数据） */
export function isDeepseekConfigured(): boolean {
  return API_KEY.startsWith('sk-')
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | ChatContentPart[]
}

export interface ChatUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface ChatResult {
  content: string
  usage: ChatUsage
  /** finish_reason：length 表示输出被 token 预算截断（调用方按失败处理、自动重试） */
  finishReason: string
}

/** Deepseek 错误响应体：{ error: { message, type, code } } */
interface DeepseekErrorBody {
  error?: { message?: string; code?: string }
}

/**
 * 调用 /chat/completions。json=true 时启用 JSON Output 模式
 * （response_format=json_object），模型被约束只产出合法 JSON —— 这是「固定输出格式」
 * 要求能稳定落地的关键，比事后用正则从散文里抠 JSON 可靠得多。
 */
export async function chatCompletion(
  messages: ChatMessage[],
  options: { json?: boolean; temperature?: number; maxTokens?: number; timeoutMs?: number } = {},
): Promise<ChatResult> {
  return chatWithEndpoint({ baseUrl: BASE_URL, apiKey: API_KEY, model: MODEL }, messages, options)
}

/**
 * 视觉识别调用：消息可携带 image_url 内容块，超时放宽到 120s
 * （图片 token 多，首 token 延迟显著高于纯文本对话）。
 */
export async function visionChat(
  messages: ChatMessage[],
  options: { json?: boolean; maxTokens?: number } = {},
): Promise<ChatResult> {
  return chatWithEndpoint(
    { baseUrl: VISION_BASE_URL, apiKey: VISION_API_KEY, model: VISION_MODEL },
    messages,
    { ...options, temperature: 0.2, timeoutMs: 120_000 },
  )
}

interface EndpointConfig {
  baseUrl: string
  apiKey: string
  model: string
}

async function chatWithEndpoint(
  endpoint: EndpointConfig,
  messages: ChatMessage[],
  options: { json?: boolean; temperature?: number; maxTokens?: number; timeoutMs?: number },
): Promise<ChatResult> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), options.timeoutMs ?? 60_000)
  try {
    const resp = await fetch(`${endpoint.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${endpoint.apiKey}`,
      },
      body: JSON.stringify({
        model: endpoint.model,
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 4096,
        stream: false,
        ...(options.json ? { response_format: { type: 'json_object' } } : {}),
      }),
    })
    if (!resp.ok) {
      let message = `AI 请求失败（HTTP ${resp.status}）`
      try {
        const body = (await resp.json()) as DeepseekErrorBody
        if (body.error?.message) message = `AI 服务：${body.error.message}`
      } catch {
        /* 非 JSON 错误体（如网关 502），保留默认提示 */
      }
      throw new Error(message)
    }
    const data = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
    }
    const content = data.choices?.[0]?.message?.content ?? ''
    if (!content.trim()) throw new Error('AI 返回了空内容，请重试')
    const finishReason = data.choices?.[0]?.finish_reason ?? ''
    /* finish_reason=length：输出在解析写到一半时被 token 预算截断，JSON 可能碰巧可解析
       但内容残缺（典型症状：解析中途断掉）。按失败处理走重试，避免半截解析入库 */
    if (finishReason === 'length') throw new Error('AI 输出内容过长被截断，已自动重试')
    return {
      content,
      finishReason,
      usage: {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
      },
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('AI 请求超时，请稍后重试')
    }
    throw error
  } finally {
    window.clearTimeout(timer)
  }
}
