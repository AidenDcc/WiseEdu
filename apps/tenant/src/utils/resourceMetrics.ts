/**
 * 资源热度指标（浏览 / 收藏 / 评论）的演示取值。
 *
 * 机构端列表接口当前只返回资源本体（名称、学科、知识点、更新时间等），浏览与互动埋点尚未接入。
 * 工作台资源卡需要展示热度，这里按资源 id 稳定派生一组数值：同一资源每次刷新结果一致，
 * 不会出现数字乱跳。后端埋点就绪后，把本文件替换成接口字段即可（调用点都在工作台内）。
 */
export function demoMetric(id: number, salt: number, base: number, span: number): number {
  const noise = Math.sin(id * 12.9898 + salt * 78.233) * 43758.5453
  return base + Math.floor((noise - Math.floor(noise)) * span)
}

/** 浏览量 */
export const viewCountOf = (id: number) => demoMetric(id, 1, 320, 4680)

/** 收藏量 */
export const collectCountOf = (id: number) => demoMetric(id, 2, 6, 240)

/** 评论量 */
export const commentCountOf = (id: number) => demoMetric(id, 3, 0, 48)

/** 发布日期（后端时间为 `YYYY-MM-DD HH:mm:ss`） */
export function dateOf(value: string): string {
  return value.slice(0, 10)
}

/** 秒 → mm:ss */
export function durationText(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
