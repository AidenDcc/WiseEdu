/**
 * 试卷编辑页（`/paper/edit`）的打开方式：**一律新标签页**。
 *
 * 它是一个「全屏工作台」页（自带顶栏、不经 AppLayout 的侧边栏框架，见 router/index.ts），
 * 而通向它的入口全在**列表**上 —— 试卷库 / 协同组卷 / 我的文件 / 组卷完成后的自动跳转。
 * 用户点「编辑卷面」多半只是想把这一份顺手改掉，改完还要回到原来那张列表接着处理下一份；
 * 在当前页签里 `router.push` 过去等于把来路弄丢（返回要重新筛选、重新翻页）。
 * 侧边栏的「题库组卷」用的是同一做法（见 menu.ts 的 `newTab`），两处口径保持一致。
 *
 * 点击类入口优先用 `<a target="_blank" rel="noopener">` 而不是 `window.open`：锚点导航
 * 不会被浏览器当成弹窗拦截，还白得中键 / Ctrl+点击与悬停可见的地址。只有拿不到锚点的入口
 * —— 下拉菜单项、以及「保存完再跳」的异步流程 —— 才走下面两个函数。
 */

/** 试卷编辑页地址（`<a href>` 直接用这一份，别各处手拼） */
export function paperEditHref(id: number | string): string {
  return `/paper/edit?id=${id}`
}

/**
 * 点击时先占下一个空白标签页，交给异步流程稍后落位（见 `openPaperEdit` 的 `tab` 参数）。
 *
 * 为什么不能等结果回来再开：浏览器只认**点击那一刻**的用户手势，`await` 之后手势已过期，
 * 那时的 `window.open` 会被当成弹窗拦掉，流程就静默断在「点了按钮什么都没发生」上。
 * 中途失败由调用方 `tab?.close()`，不留一个空白页给用户。
 */
export function openBlankTab(): Window | null {
  return window.open('about:blank', '_blank')
}

/**
 * 就地把试卷编辑页开在新标签页。
 *
 * - `tab` 传 `openBlankTab()` 的结果时复用它（异步流程先占位、后落位），不传就当场开一个；
 * - 返回 `false` 表示没开成（被拦截，或那个空白页已被用户关掉），**调用方应退回
 *   `router.push` 同页签跳转** —— 宁可跳走，也别让流程断在这里。
 */
export function openPaperEdit(id: number | string, tab?: Window | null): boolean {
  const win = tab ?? window.open('about:blank', '_blank')
  if (!win || win.closed) return false
  /* 此刻目标页还是 about:blank，相对地址在它那儿解析不出正确结果，所以拼绝对地址 */
  win.location.href = new URL(paperEditHref(id), window.location.origin).href
  return true
}
