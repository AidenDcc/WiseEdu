<script setup lang="ts">
/**
 * 章节选择弹框（按「年级 + 学科 + 教材版本」拉知识点树）。
 *
 * ## 为什么是树，而不是一个下拉
 *
 * 教材目录是**三级**的：章 → 节 → 知识点。下拉列表把它压平之后，「3.2 函数的单调性」
 * 与另外三十条同级项长得一模一样，找起来只能靠滚动 + 眼力。树保留了「它在哪一章下面」，
 * 这正是备课选章节时最需要的那点上下文。
 *
 * ## 选章节顺手带出知识点
 *
 * 选中一个节点，就把**它子树下所有叶子**（叶子的 `tag`，没有 `tag` 时用名字）作为
 * 这一节的知识点范围回给调用方。教材里每个小节的叶子本来就是「本节要讲的知识点」，
 * 让老师从零敲一遍既慢又容易漏。带出来的只是**默认值**，改不改由老师决定
 * （见 TeachKnowledgeField：它负责把「哪些是默认、哪些是自己加的」标出来）。
 *
 * 节点 id 的命名空间是「年级-学科-版本」（见 mock 的 listKnowledgeTree），
 * 换了教材版本就是另一棵树 —— 所以本组件不做任何缓存，每次打开按当前条件重新拉。
 */
import { computed, onMounted, ref } from 'vue'
import { AppIcon, AppModal } from '@aiteach/shared'
import type { OrgKnowledgeNode } from '@aiteach/shared'
import { fetchKnowledgeTree } from '@/api/org'

const props = defineProps<{
  grade: string
  subject: string
  /** 教材版本（知识点树的第三维；为空时无法定位章节树） */
  textbook: string
  /** 当前已选章节名（用来预先高亮） */
  chapter?: string
}>()

const emit = defineEmits<{
  close: []
  /** 确认选择：章节名 + 该章节默认带出的知识点 */
  pick: [{ chapter: string; knowledge: string[] }]
}>()

const loading = ref(false)
const failed = ref('')
const nodes = ref<OrgKnowledgeNode[]>([])

/** 父 → 子索引（原接口是扁平数组，这里换成树才排得出层级） */
const byParent = computed(() => {
  const map = new Map<string | null, OrgKnowledgeNode[]>()
  nodes.value.forEach((node) => {
    const list = map.get(node.parentId)
    if (list) list.push(node)
    else map.set(node.parentId, [node])
  })
  return map
})

const byId = computed(() => new Map(nodes.value.map((node) => [node.id, node])))

async function load() {
  if (!props.grade || !props.subject || !props.textbook) {
    failed.value = '请先在表单里选好年级、学科与教材版本，章节树按这三项定位。'
    return
  }
  loading.value = true
  failed.value = ''
  try {
    nodes.value = await fetchKnowledgeTree(props.grade, props.subject, props.textbook)
    if (!nodes.value.length) failed.value = '这套教材下还没有维护章节，可直接手填章节名与知识点。'
    else if (props.chapter) pickedId.value = nodes.value.find((node) => node.name === props.chapter)?.id ?? ''
  } catch {
    failed.value = '章节树加载失败，请稍后重试。'
  } finally {
    loading.value = false
  }
}
onMounted(load)

/* ================= 展开 / 收起 ================= */

/**
 * 存**收起**的那些节点而不是展开的：默认全展开时集合是空的，
 * 而默认全展开是对的 —— 一次备课只看一棵小树，先展开比先点开十几次省事。
 */
const collapsed = ref<Set<string>>(new Set())

function toggle(id: string) {
  const next = new Set(collapsed.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  collapsed.value = next
}

/* ================= 搜索 ================= */

const keyword = ref('')

/**
 * 命中节点的**祖先链**都要留下：只留命中项的话，搜到的「单调性」会孤零零挂在根上下文中，
 * 看不出它是「函数」那章的。
 */
const matched = computed(() => {
  const kw = keyword.value.trim()
  if (!kw) return null
  const keep = new Set<string>()
  nodes.value.forEach((node) => {
    if (!node.name.includes(kw)) return
    let current: OrgKnowledgeNode | undefined = node
    while (current) {
      keep.add(current.id)
      current = current.parentId ? byId.value.get(current.parentId) : undefined
    }
  })
  return keep
})

interface TreeRow {
  id: string
  name: string
  depth: number
  hasChildren: boolean
  isCollapsed: boolean
  /** 叶子节点：选它带出的知识点就是它自己 */
  isLeaf: boolean
}

/** 拍平成可见行（用 v-for 渲染，避免为这棵浅树写一个递归组件） */
const rows = computed<TreeRow[]>(() => {
  const out: TreeRow[] = []
  const searching = !!keyword.value.trim()
  const walk = (parentId: string | null, depth: number) => {
    for (const node of byParent.value.get(parentId) ?? []) {
      if (matched.value && !matched.value.has(node.id)) continue
      const kids = byParent.value.get(node.id) ?? []
      /* 搜索时一律展开：命中项藏在一个收起的父节点下面等于没搜到 */
      const isCollapsed = !searching && collapsed.value.has(node.id)
      out.push({ id: node.id, name: node.name, depth, hasChildren: kids.length > 0, isCollapsed, isLeaf: kids.length === 0 })
      if (kids.length && !isCollapsed) walk(node.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
})

/* ================= 选中 ================= */

const pickedId = ref('')

const pickedNode = computed(() => (pickedId.value ? byId.value.get(pickedId.value) ?? null : null))

/** 面包屑：让老师确认「选的是哪一章下面的那一节」 */
const pickedPath = computed(() => {
  const path: string[] = []
  let current = pickedNode.value
  while (current) {
    path.unshift(current.name)
    current = current.parentId ? byId.value.get(current.parentId) ?? null : null
  }
  return path
})

/**
 * 章节默认带出的知识点：整棵子树里的叶子。
 *
 * 叶子的 `tag` 才是「与题目知识点对齐的那个名字」，没有 `tag` 的叶子用节点名兜底 ——
 * 直接取全部节点名会把「函数」这种章节标题也当成知识点，学情分析里就会出现空口径的标签。
 */
function knowledgeOf(id: string): string[] {
  const out: string[] = []
  const walk = (node: OrgKnowledgeNode) => {
    const kids = byParent.value.get(node.id) ?? []
    if (!kids.length) {
      out.push(node.tag ?? node.name)
      return
    }
    kids.forEach(walk)
  }
  const start = byId.value.get(id)
  if (start) walk(start)
  return Array.from(new Set(out.map((row) => row.trim()).filter(Boolean)))
}

/** 选中项的默认知识点（预览给老师看「选完会带出什么」） */
const previewKnowledge = computed(() => (pickedId.value ? knowledgeOf(pickedId.value) : []))

function confirm() {
  const node = pickedNode.value
  if (!node) return
  emit('pick', { chapter: node.name, knowledge: knowledgeOf(node.id) })
  emit('close')
}

/** 清空章节：知识点也一并交回空数组，由调用方决定要不要保留已有内容 */
function clear() {
  emit('pick', { chapter: '', knowledge: [] })
  emit('close')
}
</script>

<template>
  <AppModal :title="`选择章节 · ${subject}`" :width="560" @close="emit('close')">
    <p class="cp-lead">
      章节按「{{ grade }} · {{ subject }} · {{ textbook }}」这套教材的目录列出，选中后会把该节的
      知识点一并带出，可在表单里再改。
    </p>

    <div class="cp-search">
      <AppIcon name="search" :size="14" />
      <input v-model="keyword" type="search" placeholder="搜索章节 / 知识点名称" />
      <button v-if="keyword" class="cp-search-clear" type="button" @click="keyword = ''">
        <AppIcon name="close" :size="12" />
      </button>
    </div>

    <p v-if="loading" class="cp-state">章节树加载中…</p>
    <p v-else-if="failed" class="cp-state">{{ failed }}</p>
    <p v-else-if="!rows.length" class="cp-state">没有匹配「{{ keyword }}」的章节。</p>

    <div v-else class="cp-tree">
      <div
        v-for="row in rows"
        :key="row.id"
        class="cp-row"
        :class="{ on: pickedId === row.id }"
        :style="{ paddingLeft: `${8 + row.depth * 16}px` }"
        @click="pickedId = row.id"
      >
        <button
          v-if="row.hasChildren"
          class="cp-caret"
          type="button"
          :title="row.isCollapsed ? '展开' : '收起'"
          @click.stop="toggle(row.id)"
        >
          <AppIcon :name="row.isCollapsed ? 'chevron-right' : 'chevron-down'" :size="12" />
        </button>
        <span v-else class="cp-caret-space" />
        <AppIcon :name="row.isLeaf ? 'file' : 'folder'" :size="14" class="cp-icon" />
        <span class="cp-name">{{ row.name }}</span>
        <AppIcon v-if="pickedId === row.id" name="check" :size="13" class="cp-check" />
      </div>
    </div>

    <!-- 已选 + 会带出的知识点：确认之前先让老师看到「选完会发生什么」 -->
    <div v-if="pickedNode" class="cp-summary">
      <p class="cp-path">
        <AppIcon name="folder" :size="13" />
        {{ pickedPath.join(' / ') }}
      </p>
      <div v-if="previewKnowledge.length" class="cp-km">
        <span class="cp-km-label">将带出 {{ previewKnowledge.length }} 个知识点</span>
        <span v-for="k in previewKnowledge" :key="k" class="cp-km-chip">{{ k }}</span>
      </div>
      <p v-else class="cp-km-empty">这一节还没有维护叶子知识点，选完只填章节名。</p>
    </div>

    <template #footer>
      <button class="btn btn-ghost btn-sm" type="button" @click="clear">清空章节</button>
      <button class="btn btn-ghost btn-sm" type="button" @click="emit('close')">取消</button>
      <button class="btn btn-primary btn-sm" type="button" :disabled="!pickedNode" @click="confirm">
        <AppIcon name="check" :size="14" /> 用这一节
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.cp-lead { font-size: 12.5px; color: var(--sub); line-height: 1.7; margin-bottom: 12px; }

.cp-search {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 10px;
  height: 34px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #fff;
  color: var(--sub);
}
.cp-search:focus-within { border-color: var(--brand); box-shadow: 0 0 0 3px var(--brand-soft); }
.cp-search input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-family: inherit;
  font-size: 12.5px;
  color: var(--ink);
}
.cp-search-clear {
  border: none;
  background: transparent;
  color: var(--sub);
  padding: 2px;
  border-radius: 5px;
  display: flex;
}
.cp-search-clear:hover { background: #f2f4fa; color: var(--ink); }

.cp-state {
  margin-top: 12px;
  padding: 14px;
  border-radius: 10px;
  background: #f7f9fc;
  color: var(--sub);
  font-size: 12.5px;
  line-height: 1.7;
}

.cp-tree {
  margin-top: 10px;
  /* 236px ≈ 8 行。再高的话「将带出哪几个知识点」会被挤到滚动区外面，
     而那正是确认前最该看的一行 */
  max-height: 236px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 4px 0;
}
.cp-row {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 10px 6px 0;
  cursor: pointer;
  font-size: 12.5px;
  color: var(--ink-2);
  border-left: 2px solid transparent;
}
.cp-row:hover { background: #f6f9fd; }
.cp-row.on { background: var(--brand-soft); border-left-color: var(--brand); color: var(--brand-deep); font-weight: 600; }
.cp-caret {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: var(--sub);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}
.cp-caret:hover { background: #e8edf6; }
.cp-caret-space { width: 18px; flex-shrink: 0; }
.cp-icon { flex-shrink: 0; color: var(--sub); }
.cp-row.on .cp-icon { color: var(--brand); }
.cp-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cp-check { flex-shrink: 0; color: var(--brand); }

.cp-summary {
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px dashed var(--border);
  border-radius: 10px;
  background: #fbfcfe;
}
.cp-path {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--ink-2);
  font-weight: 600;
  margin-bottom: 7px;
}
.cp-km { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.cp-km-label { font-size: 11.5px; color: var(--sub); }
.cp-km-chip {
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--brand-soft);
  color: var(--brand-deep);
  font-size: 11.5px;
}
.cp-km-empty { font-size: 11.5px; color: var(--sub); }
</style>
