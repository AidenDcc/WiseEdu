/**
 * 教案 / 学案 / 讲义编辑器的打开方式：**一律新页签**。
 *
 * 三者的地址不一样（见 `teachEditHref`）：各有一张全屏工作台页
 * （`/teach/plan/edit`、`/teach/guide/edit`、`/teach/lecture/edit`）。
 * **打开方式**是同一套，所以收在同一个文件里 —— 三处若各写一份，必然慢慢长成不一样的手感。
 *
 * 与试卷编辑页（见 utils/paper-edit.ts）同一条理由：编辑入口全在**列表**上，
 * 老师点「编辑」多半只想把这份顺手改掉，改完还要回那张列表接着处理下一份；
 * 在当前页签里 `router.push` 过去等于把来路弄丢（返回要重新筛选、重新翻页）。
 *
 * 点击类入口优先用 `<a target="_blank" rel="noopener">`：锚点导航不会被浏览器当成弹窗拦截，
 * 还白得中键 / Ctrl+点击与悬停可见的地址。只有两类入口拿不到锚点，才走下面的函数：
 * - **新建**：要先弹一个「名称 / 学科 / 年级 / 模板」的表单，保存成功才知道 id；
 * - 列表里的「复制并编辑」这类异步流程。
 * 这两处必须在**点击那一刻**先把空白页占下来 —— 浏览器只认点击时的用户手势，
 * `await` 之后手势已过期，那时的 `window.open` 会被当成弹窗拦掉，流程就静默断在
 * 「点了按钮什么都没发生」上（同 ComposePaperDialog 的做法）。
 */

/** 备课文档的编辑页地址（`<a href>` 直接用这一份，别各处手拼） */
export function teachEditHref(kind: 'plan' | 'guide' | 'lecture', id: number | string): string {
  /* 三种都是**独立全屏页**（见 router/index.ts）—— 与试卷编辑同构：
     满宽画布 + 左目录 + 右工具条，套在 AppLayout 里 A4 纸展不开。 */
  return `/teach/${kind}/edit?id=${id}`
}

/** 先占一个空白页签，交给异步流程稍后落位（失败时由调用方 `tab?.close()`） */
export function openBlankTab(): Window | null {
  return window.open('about:blank', '_blank')
}

/**
 * 就地打开一份备课文档的编辑页。
 *
 * @param tab `openBlankTab()` 的结果（异步流程先占位、后落位）；不传就当场开一个
 * @returns false 表示没开成（被拦截，或那个空白页已被关掉）—— **调用方应退回同页签跳转**，
 *          宁可跳走，也别让流程断在这里
 */
export function openTeachEdit(kind: 'plan' | 'guide' | 'lecture', id: number | string, tab?: Window | null): boolean {
  const win = tab ?? window.open('about:blank', '_blank')
  if (!win || win.closed) return false
  /* 此刻目标页还是 about:blank，相对地址在它那儿解析不出正确结果，所以拼绝对地址 */
  win.location.href = new URL(teachEditHref(kind, id), window.location.origin).href
  return true
}
