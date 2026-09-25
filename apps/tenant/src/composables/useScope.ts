/**
 * 机构端全局「年级 / 学科」作用域单例：顶部栏选定，写入 localStorage 记忆，
 * 供题库管理、录题中心带入默认筛选与表单初值。
 *
 * 模块级单例（非 per-component）—— 顶部栏与各业务视图读写同一份 ref，改一处全站同步。
 * 缓存值可能与字典脱节（学科被停用，或该年级下没有这个学科），统一在 ensureScope()
 * 里按「缓存值 > 默认教材（高一-数学）> 列表首项」的优先级归一。
 */
import { computed, ref, watch } from 'vue'
import { getAppConfig } from '@aiteach/shared'
import { useBaseData } from '@/composables/useBaseData'

const gradeKey = `aiteach:${getAppConfig().appName}:scope-grade`
const subjectKey = `aiteach:${getAppConfig().appName}:scope-subject`

const grade = ref(localStorage.getItem(gradeKey) ?? '')
const subject = ref(localStorage.getItem(subjectKey) ?? '')

const { ensure, grades, optionsForGrade, defaultTextbook } = useBaseData()

/** 当前年级下的可选学科 */
const subjectOptions = computed(() => optionsForGrade(grade.value))

/** 年级 / 学科任一变化即写入缓存，下次进入仍是上次的选择 */
watch([grade, subject], () => {
  localStorage.setItem(gradeKey, grade.value)
  localStorage.setItem(subjectKey, subject.value)
})

/** 切年级后原学科可能不属于新年级 —— 落到新年级的首个学科（字典未就绪时不动作） */
watch(grade, () => {
  const options = subjectOptions.value
  if (options.length > 0 && !options.includes(subject.value)) {
    subject.value = options[0] ?? ''
  }
})

let ready: Promise<void> | null = null

/**
 * 载入字典并归一缓存值；失败不留缓存 Promise，便于下次重试。
 * 顶部栏挂载时调用一次，业务视图 await 后取值即可保证落在字典内。
 */
function ensureScope(): Promise<void> {
  if (ready) return ready
  ready = (async () => {
    await ensure()
    const fallback = defaultTextbook()
    if (!grades.value.includes(grade.value)) {
      grade.value = grades.value.includes(fallback.grade) ? fallback.grade : (grades.value[0] ?? '')
    }
    const options = subjectOptions.value
    if (!options.includes(subject.value)) {
      subject.value = options.includes(fallback.subject) ? fallback.subject : (options[0] ?? '')
    }
  })().catch((error) => {
    ready = null
    throw error
  })
  return ready
}

export function useScope() {
  return { grade, subject, gradeOptions: grades, optionsForGrade, ensureScope }
}
