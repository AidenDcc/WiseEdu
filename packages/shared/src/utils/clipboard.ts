/**
 * 复制文本到剪贴板。
 *
 * 原先只在「我的文件」页里（`FileView.vue` 的行内更多），试卷预览的分享也要复制链接，
 * 抄第二份就会出现「一处修了另一处还是老的」—— 故提到共享层。
 */
export function copyText(text: string): Promise<boolean> {
  /* 非安全上下文（http 访问局域网 IP）没有 navigator.clipboard，退回 execCommand */
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).then(() => true, () => false)
  const area = document.createElement('textarea')
  area.value = text
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  const ok = document.execCommand('copy')
  document.body.removeChild(area)
  return Promise.resolve(ok)
}
