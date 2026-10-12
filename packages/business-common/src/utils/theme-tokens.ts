/**
 * 设计令牌的运行时读取。
 *
 * 图表类组件（echarts 的 series / axis）只吃 `#rrggbb` 这类字面量，吃不到 CSS 变量，
 * 而两端的品牌色不同色相（机构端青绿 / 平台端靛蓝）—— 公共组件既不能写死任何一端的颜色，
 * 也不能在内部按端判断（本包禁止 admin/tenant 分支）。折中办法就是运行时把令牌读出来：
 * 颜色仍由各端自己的 `styles/main.css` 决定，公共组件只是取用者。
 */
export function themeColor(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

/**
 * 图表常用的三个取色（品牌色 / 副色 / 警示色）。
 *
 * 兜底值刻意用**中性色**：令牌取不到时说明样式还没加载完或宿主没定义这套令牌，
 * 这时给一个「谁家的品牌色都不像」的深灰，比默认成某一端的颜色更容易被发现。
 */
export function chartTheme(fallback = '#1c2434') {
  return {
    brand: themeColor('--brand', fallback),
    brand2: themeColor('--brand-2', fallback),
    warn: themeColor('--warn', fallback),
  }
}
