/**
 * 题目收藏（组卷工作台内）。
 *
 * 与组卷车的区别：组卷车是「这一卷要用哪些题」，收藏夹是「这个老师长期觉得好用哪些题」，
 * 生命周期长得多，因此存 localStorage 且不随生成试卷清空。
 *
 * 模块级单例：试题页签、知识点组卷、相似题弹窗里点星标，状态必须立刻一致。
 */
import { computed, ref, watch } from 'vue'
import { showToast } from '@aiteach/shared'

const STORAGE_KEY = 'aiteach.question-favorites'

function read(): number[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((id): id is number => typeof id === 'number') : []
  } catch {
    return []
  }
}

const ids = ref<number[]>(read())

watch(
  ids,
  (rows) => {
    if (rows.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(rows))
    else localStorage.removeItem(STORAGE_KEY)
  },
  { deep: true },
)

/* 另一个标签页改了收藏，本页跟着更新（同源同 localStorage） */
window.addEventListener('storage', (event) => {
  if (event.key === STORAGE_KEY) ids.value = read()
})

const set = computed(() => new Set(ids.value))

export function useQuestionFavorites() {
  function has(questionId: number): boolean {
    return set.value.has(questionId)
  }

  function toggle(questionId: number): boolean {
    if (has(questionId)) {
      ids.value = ids.value.filter((id) => id !== questionId)
      showToast('已取消收藏')
      return false
    }
    ids.value = [...ids.value, questionId]
    showToast('已收藏，可在「只看收藏」里快速找到')
    return true
  }

  function clear() {
    ids.value = []
  }

  return { ids, set, count: computed(() => ids.value.length), has, toggle, clear }
}
