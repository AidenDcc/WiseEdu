/**
 * 「我的文件」目录的共用纯函数：路径拼装与新建目录的自动编号。
 *
 * 只放纯函数：不碰接口、不碰状态。
 *
 * 为什么不连「展平成树」一起收进来：树的形状在各处不一样（FileView 的移动弹窗要屏蔽
 * 被移动目录及其子孙，FolderPickerDialog 要往选中行下面插输入框和文件行），
 * 收成一个通用数组反而每处都要再过滤一遍。但「目录 id → 一串名字」和
 * 「同级重名怎么编号」是无参数的，写第二遍就是纯复制。
 */
import type { FileFolder } from '@aiteach/shared'

/**
 * 目录的可读路径，如「全部文件 / 期末备考 / 2025 真题」；id 为空或查不到时返回空串。
 *
 * 用全路径而不是单个目录名：同名文件夹出现在不同层级太常见（「新建文件夹1」尤其），
 * 只显示末级名字的话，用户根本看不出存到了哪一个。
 */
export function folderPathOf(folders: FileFolder[], id: number | null): string {
  if (id == null) return ''
  const byId = new Map(folders.map((row) => [row.id, row]))
  const names: string[] = []
  /* seen 防环：parentId 一旦成环，不设防的 while 会一直转下去 */
  const seen = new Set<number>()
  let cursor = byId.get(id)
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id)
    names.unshift(cursor.name)
    cursor = cursor.parentId === null ? undefined : byId.get(cursor.parentId)
  }
  return names.join(' / ')
}

/**
 * 新建目录的同级去重命名：新建文件夹 → 新建文件夹1 → 新建文件夹2 …
 *
 * 必须在客户端算：mock 的 `saveFolder` 碰到同级重名是**直接抛错**的，没有自动编号。
 * 数字后缀不加括号，与 mock 给重名文件加的「（2）」区分开——目录名带括号在路径里很难看。
 */
export function nextFolderName(folders: FileFolder[], parentId: number | null, base = '新建文件夹'): string {
  const taken = new Set(folders.filter((row) => row.parentId === parentId).map((row) => row.name))
  if (!taken.has(base)) return base
  for (let n = 1; ; n += 1) {
    if (!taken.has(`${base}${n}`)) return `${base}${n}`
  }
}
