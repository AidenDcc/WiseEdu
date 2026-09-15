/**
 * 题目正文里的图片以 URL 形式存储（如 `/api/tenant/media/604/raw`），不内联 base64。
 *
 * Mock 阶段没有真实后端可托管这些字节，故由 mock 媒体库在上传时把「URL → 可显示地址」注册到
 * 这里，渲染时再换回来。真实后端接入后不会有任何注册项，resolveMediaSrc 原样返回 URL，
 * 由服务端直接提供字节 —— 这条路径无需改动调用方。
 */
const registry = new Map<string, string>()

/** 注册 URL 对应的可显示地址（mock 阶段即 data URL） */
export function registerMediaSrc(url: string, src: string): void {
  registry.set(url, src)
}

/** 解析为可显示地址；未注册时原样返回（真实后端即走此分支） */
export function resolveMediaSrc(url: string): string {
  return registry.get(url) ?? url
}

/** 删除媒体时一并清理，避免 Map 无限增长 */
export function unregisterMediaSrc(url: string): void {
  registry.delete(url)
}

/**
 * 在 HTML 写入 DOM **之前**把 `<img src>` 换成可显示地址。
 *
 * 必须在写 DOM 之前做：v-html 一旦插入，浏览器会立刻按原地址发起一次图片请求，
 * 等 onMounted 再改 src 已经晚了一步 —— 会多出一次注定失败的请求（开发期还会刷 404）。
 * 无图片的正文直接跳过，不额外付一次 DOM 解析。
 */
export function resolveMediaIn(html: string): string {
  if (!html || !html.includes('<img')) return html
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll<HTMLImageElement>('img[src]').forEach((img) => {
    const raw = img.getAttribute('src') ?? ''
    const resolved = resolveMediaSrc(raw)
    if (resolved !== raw) img.setAttribute('src', resolved)
  })
  return doc.body.innerHTML
}
