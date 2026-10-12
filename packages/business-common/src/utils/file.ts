/** 本地文件 → data URL（mock 媒体库以 data URL 留存字节） */
export function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

/** 触发浏览器下载（Blob → 临时 object URL → a[download]），用完延迟回收临时 URL */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** 按原始文件名下载一个已持有的 File（无实体字节的文件不走这里） */
export function downloadFile(file: File): void {
  downloadBlob(file, file.name)
}

/** 文件大小展示：≥1GB 用 GB，≥1MB 用 MB，其余 KB（0 显示「—」，在线文档没有字节） */
export function formatFileSize(mb: number): string {
  if (!mb) return '—'
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(mb * 1024))} KB`
}
