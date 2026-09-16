/**
 * Cloudflare Pages Function：视觉（多模态）识别通道的边缘代理，对应 dev 环境的
 * `/vision` proxy（vite.config.ts，默认目标 dashscope 兼容模式）。
 *
 * 与 deepseek 代理同一套逻辑；未配 VISION_API_KEY 密钥时透传请求 Authorization 头。
 * 若生产环境已通过 VITE_VISION_BASE_URL 指向自建网关，则本函数不会被请求到，留着无妨。
 */

const UPSTREAM = 'https://dashscope.aliyuncs.com'
const PREFIX = '/compatible-mode/v1' // 与 vite proxy 的 rewrite 前缀保持一致

type Env = { VISION_API_KEY?: string }

export async function onRequest(context: {
  request: Request
  env: Env
  params: { path?: string | string[] }
}): Promise<Response> {
  const { request, env, params } = context
  const segments = Array.isArray(params.path) ? params.path.join('/') : (params.path ?? '')

  const upstreamUrl = new URL(`${UPSTREAM}${PREFIX}/${segments}`)
  upstreamUrl.search = new URL(request.url).search

  const headers = new Headers(request.headers)
  headers.delete('host')
  headers.delete('content-length')
  if (env.VISION_API_KEY) headers.set('Authorization', `Bearer ${env.VISION_API_KEY}`)

  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer()

  const resp = await fetch(upstreamUrl.toString(), { method: request.method, headers, body })

  const out = new Headers(resp.headers)
  out.delete('content-encoding')
  out.delete('transfer-encoding')
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: out })
}
