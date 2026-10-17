/**
 * 章节 → 该节的**预设知识点**（教材树里的那套叶子）。
 *
 * ## 为什么需要它
 *
 * 「章节预设 / 自定义 / 已移除」这三档差异高亮（见 TeachKnowledgeField）靠一个 baseline：
 * 选章节那一刻教材给了哪几条。这个值原先只存在内存里，页面一刷新就没了 ——
 * 于是重新打开一份已经选过章节的稿子，**所有知识点都被标成「自定义」**，
 * 而它们其实一条没改。差异高亮一旦在刷新后失真，就等于没有。
 *
 * 所以这里按「年级 + 学科 + 教材版本 + 章节名」把那份预设重新算一遍。
 * 算不出来是正常的（章节是老师手打的，树上没有同名节点），此时返回空数组 ——
 * 调用方保持 baseline 为空，界面退回「全部自定义」，不硬凑。
 *
 * 叶子取 `tag`（与题目知识点对齐的那个名字），没有 `tag` 时用节点名兜底：
 * 直接取全部节点名会把「函数」这种章节标题也算成知识点。
 */
import type { OrgKnowledgeNode } from '@aiteach/shared'
import { fetchKnowledgeTree } from '@/api/org'

export async function knowledgeOfChapter(input: {
  grade: string
  subject: string
  textbook: string
  chapter: string
}): Promise<string[]> {
  const chapter = input.chapter.trim()
  if (!chapter || !input.grade || !input.subject || !input.textbook) return []
  let nodes: OrgKnowledgeNode[] = []
  try {
    nodes = await fetchKnowledgeTree(input.grade, input.subject, input.textbook)
  } catch {
    return []
  }
  const node = nodes.find((row) => row.name.trim() === chapter)
  if (!node) return []
  const byParent = new Map<string | null, OrgKnowledgeNode[]>()
  nodes.forEach((row) => {
    const list = byParent.get(row.parentId)
    if (list) list.push(row)
    else byParent.set(row.parentId, [row])
  })
  const out: string[] = []
  const walk = (current: OrgKnowledgeNode) => {
    const kids = byParent.get(current.id) ?? []
    if (!kids.length) {
      out.push(current.tag ?? current.name)
      return
    }
    kids.forEach(walk)
  }
  walk(node)
  return Array.from(new Set(out.map((row) => row.trim()).filter(Boolean)))
}
