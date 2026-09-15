/** 数字格式化：12345 → 1.23万 */
export function formatCount(value: number): string {
  if (value >= 100_000) return `${(value / 10_000).toFixed(0)}万`
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)}万`
  return value.toLocaleString('zh-CN')
}

/** 百分比增幅展示：+12.4% */
export function formatDelta(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
}

/** 首字母头像背景色（按色相生成） */
export function hueColor(hue: number): string {
  return `hsl(${hue} 62% 52%)`
}

/** 月份 xx 月用量格式 */
export function formatQuota(used: number, quota: number): string {
  return `${formatCount(used)} / ${formatCount(quota)}`
}
