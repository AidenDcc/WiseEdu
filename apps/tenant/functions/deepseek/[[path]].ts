/**
 * Cloudflare Pages Function：Deepseek API 边缘代理。
 *
 * 解决线上 405：本地 `/deepseek` 由 vite dev proxy 转发（vite.config.ts），
 * 而 Cloudflare Pages 是纯静态托管，POST 到不存在的路径会返回 405。
 * 此函数在边缘节点接管 `/deepseek/*`，原样转发到 https://api.deepseek.com,
 * 行为与 dev proxy 完全一致（rewrite 掉 /deepseek 前缀），前端代码零改动。
 *
 * 密钥两种供给方式（按优先级）：
 * 1. Pages 项目 Settings → Environment variables 配 DEEPSEEK_API_KEY（推荐，Key 不落前端）；
 * 2. 未配置时透传请求的 Authorization 头（兼容现状：Key 由 VITE_DEEPSEEK_API_KEY 打进前端包）。
 */

const UPSTREAM = 'https://api.deepseek.com'

type Env = { DEEPSEEK_API_KEY?: string }

/* Pages Functions 约定导出 onRequest；这里不用 @cloudflare/workers-types,
   以结构化类型声明，避免为此引入依赖（构建由 Cloudflare 平台托管，无需本地编译）。 */
export async function onRequest(context: {
  request: Request
  env: Env
  params: { path?: string | string[] }
}): Promise<Response> {
  const { request, env, params } = context
  const segments = Array.isArray(params.path) ? params.path.join('/') : (params.path ?? '')

  const upstreamUrl = new URL(`${UPSTREAM}/${segments}`)
  upstreamUrl.search = new URL(request.url).search

  const headers = new Headers(request.headers)
  headers.delete('host')
  headers.delete('content-length') // body 重读后由 fetch 重新计算
  /* 配置了平台密钥则覆盖（前端包里的 Key 可留空）; 否则透传请求头里的 Authorization */
  if (env.DEEPSEEK_API_KEY) headers.set('Authorization', `Bearer ${env.DEEPSEEK_API_KEY}`)

  /* 读出 body 再转发（Workers 里流式 body 直接传给 fetch 需额外处理，JSON 载荷很小，直接缓冲） */
  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer()

  const resp = await fetch(upstreamUrl.toString(), { method: request.method, headers, body })

  /* 原样回传（含流式 SSE 的 content-type），仅去掉压缩相关头避免双重编码问题 */
  const out = new Headers(resp.headers)
  out.delete('content-encoding')
  out.delete('transfer-encoding')
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: out })
}
