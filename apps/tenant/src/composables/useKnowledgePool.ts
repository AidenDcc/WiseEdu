/**
 * 知识点池：按当前「年级 / 学科 / 版本」实时拉取知识点树，展开为可选标签集合。
 *
 * 取代原先写死的数学知识点数组 —— 学科扩到九科后，硬编码池会让另外八个学科无法录题。
 * 标签收集规则与题库管理页的知识树筛选保持一致：
 * 取全树 node.tag 去重；整棵树都没有 tag 时，退化为「无子节点的节点名」。
 */
import { computed, ref, watch } from 'vue'
import type { OrgKnowledgeNode } from '@aiteach/shared'
import { fetchKnowledgeTree } from '@/api/org'

export function collectTags(nodes: OrgKnowledgeNode[]): string[] {
  const tagged = nodes.map((node) => node.tag).filter((tag): tag is string => Boolean(tag))
  if (tagged.length) return [...new Set(tagged)]
  const parentIds = new Set(nodes.map((node) => node.parentId).filter((id): id is string => id != null))
  return [...new Set(nodes.filter((node) => !parentIds.has(node.id)).map((node) => node.name))]
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
      nodes.value = await fetchKnowledgeTree(grade, subject, version)
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
