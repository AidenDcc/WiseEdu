/**
 * 知识点池：按当前「年级 / 学科 / 版本」实时拉取知识点树，展开为可选标签集合。
 *
 * 取代原先写死的数学知识点数组 —— 学科扩到九科后，硬编码池会让另外八个学科无法录题。
 *
 * ## 一个节点能贡献什么标签（`nodeKnowledgeLabel`，全站唯一一份规则）
 *
 * 取 `node.tag`，没有 tag 的分类节点退化为**节点名**。此前的规则是「取全树 node.tag 去重；
 * 整棵树都没有 tag 时，退化为叶子节点名」—— 分类节点因此完全不在池里。那是建立在
 * 「只有叶子可被选中」的前提上的；录题页的知识点弹窗改成**任意层级都可选**之后，
 * 分类节点名也会被存进题目的 `knowledge`，池里不收它就会连锁出三种毛病：
 * 录完在题库里筛不出来、AI 纠错对齐时被当作脏值丢掉、试卷分析里落进「未知」档。
 *
 * 于是把规则统一成「每个节点贡献它自己的标签」，并且由 `nodeKnowledgeLabel` 一处导出，
 * 供 `knowledgeLevels` 等同源实现引用，避免两处各推一套。
 */
import { computed, ref, watch } from 'vue'
import type { OrgKnowledgeNode } from '@aiteach/shared'
import { useBusinessApi } from '../api/business-api'

/** 一个知识点节点贡献的标签：有 tag 用 tag，没有（分类节点）用节点名 */
export function nodeKnowledgeLabel(node: OrgKnowledgeNode): string {
  return node.tag || node.name
}

export function collectTags(nodes: OrgKnowledgeNode[]): string[] {
  return [...new Set(nodes.map(nodeKnowledgeLabel).filter(Boolean))]
}

export function useKnowledgePool(ctx: () => { grade?: string; subject: string; version?: string }) {
  const nodes = ref<OrgKnowledgeNode[]>([])
  const loading = ref(false)
  const pool = computed(() => collectTags(nodes.value))

  async function refresh() {
    const { grade = '', subject, version = '' } = ctx()
    if (!subject) {
      nodes.value = []
      return
    }
    loading.value = true
    try {
      /* grade / version 只参与节点 id 前缀拼接，知识点树按学科（+学段）取，
         因此没有年级的场景（如多媒体素材）传空串是安全的。 */
      nodes.value = await useBusinessApi().fetchKnowledgeTree(grade, subject, version)
    } finally {
      loading.value = false
    }
  }

  watch(
    () => {
      const current = ctx()
      return `${current.grade ?? ''}|${current.subject}|${current.version ?? ''}`
    },
    refresh,
    { immediate: true },
  )

  return { nodes, pool, loading, refresh }
}
