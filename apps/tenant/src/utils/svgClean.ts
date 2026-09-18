/**
 * SVG 私有属性清洗（规格硬性约束 4：导出必须是纯净标准 SVG）。
 *
 * JSXGraph 会在每个节点上写 jxg* / data-jxg-* 属性，Fabric 的 toSVG 会带
 * data-fabric / data-namespaceUrl 等私有字段。这些扩展字段在 Tiptap / PDF 导出
 * 等只读渲染端没有意义，还可能导致解析问题，统一在这里剥掉。
 */

const PRIVATE_ATTR = /^(jxg|data-jxg-|data-fabric|data-namespaceUrl)/i

export function cleanSvg(svgText: string): string {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  if (doc.querySelector('parsererror')) {
    /* 解析失败时原样返回：宁可见到原图，也不要静默丢内容 */
    return svgText
  }
  const root = doc.documentElement as unknown as SVGSVGElement
  root.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  root.removeAttribute('xmlns:xlink')

  const walk = (el: Element) => {
    for (const attr of Array.from(el.attributes)) {
      if (PRIVATE_ATTR.test(attr.name)) el.removeAttribute(attr.name)
    }
    if (el.tagName.toLowerCase() === 'script') {
      el.remove()
      return
    }
    for (const child of Array.from(el.children)) walk(child)
  }
  walk(root)

  /* JSXGraph 导出的 svg 常带 100% 宽高：作为 <img> 插入时必须有确定尺寸，换成像素值 */
  const width = root.getAttribute('width')
  const height = root.getAttribute('height')
  if (width === '100%' || !width) root.setAttribute('width', root.viewBox.baseVal.width ? String(root.viewBox.baseVal.width) : '640')
  if (height === '100%' || !height) root.setAttribute('height', root.viewBox.baseVal.height ? String(root.viewBox.baseVal.height) : '400')

  return new XMLSerializer().serializeToString(root)
}

/** 纯 SVG 字符串 → data URL（mock 媒体库以 data URL 留存字节） */
export function svgToDataUrl(svgText: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svgText)}`
}
