/**
 * 机构端基础数据单例：全局字典（学科 / 年级 / 题型 / 难度 / 考试类型）+ 教材级联矩阵。
 *
 * 模块级单例（非 per-component）—— 无论多少个视图调用，全站只请求一轮。
 * 刻意不加载 term：题目 question.term 使用「上学期 / 下学期」短名，与字典里的
 * 「2025-2026 上学期」全名不同名，纳入会诱导误回填，因此排除在外。
 *
 * 用法：在 <script setup> 顶层解构（不可 `const base = useBaseData()` 再在模板写
 * `base.subjects` —— 那样渲染出的是 ComputedRef 对象），并在既有 load() 首行 await ensure()。
 */
import { computed, ref } from 'vue'
import type { TextbookOption } from '@aiteach/shared'
import { fetchTenantDict, fetchTextbookMatrix, type TenantDictItem } from '@/api/org'

export type BaseDictKey = 'subject' | 'grade' | 'questionType' | 'difficulty' | 'examType'

const DICT_KEYS: BaseDictKey[] = ['subject', 'grade', 'questionType', 'difficulty', 'examType']

const dict = ref<Record<BaseDictKey, TenantDictItem[]>>({
  subject: [],
  grade: [],
  questionType: [],
  difficulty: [],
  examType: [],
})
const matrix = ref<TextbookOption[]>([])
const loading = ref(false)
let inflight: Promise<void> | null = null

const namesOf = (key: BaseDictKey) => dict.value[key].map((item) => item.name)

const subjects = computed(() => namesOf('subject'))
const grades = computed(() => namesOf('grade'))
const questionTypes = computed(() => namesOf('questionType'))
const difficulties = computed(() => namesOf('difficulty'))
const examTypes = computed(() => namesOf('examType'))

/** 教材级联（学科随年级动态、版本随学科动态），唯一权威来源是机构端教材矩阵 */
function subjectsForGrade(grade: string): string[] {
  return matrix.value.find((row) => row.grade === grade)?.subjects.map((row) => row.name) ?? []
}

/** 指定年级下的可选学科：教材矩阵缺该年级时退回全量学科，避免选项为空（顶部栏与录题表单共用此规则） */
function optionsForGrade(grade: string): string[] {
  const list = subjectsForGrade(grade)
  return list.length > 0 ? list : subjects.value
}

function versionsFor(grade: string, subject: string): string[] {
  return matrix.value.find((row) => row.grade === grade)?.subjects.find((row) => row.name === subject)?.versions ?? []
}

/** 默认教材：优先 高一-数学-人教A版（题库种子题范围），否则取矩阵首项 */
function defaultTextbook(): { grade: string; subject: string; version: string } {
  const row =
    matrix.value.find((row) => row.grade === '高一' && row.subjects.some((s) => s.name === '数学')) ?? matrix.value[0]
  if (!row) return { grade: '', subject: '', version: '' }
  const subject = row.subjects.find((s) => s.name === '数学')?.name ?? row.subjects[0]?.name ?? ''
  const versions = row.subjects.find((s) => s.name === subject)?.versions ?? []
  return { grade: row.grade, subject, version: versions.find((v) => v === '人教A版') ?? versions[0] ?? '' }
}

/**
 * 编辑历史数据时，其取值可能已停用 —— 并入选项，避免下拉无匹配项而被静默改写。
 * 展示文案须再过一道 optionLabel，否则停用值看起来仍可选。
 */
function withCurrent(options: string[], current: string): string[] {
  return current && !options.includes(current) ? [current, ...options] : options
}

/** 选项文案：不在启用列表中的历史值标注「（已停用）」，值本身不变 */
function optionLabel(options: string[], value: string): string {
  return options.includes(value) ? value : `${value}（已停用）`
}

/** 兜底取列表首项（不写死 '数学' / '高一'），用于新建场景的默认值归一 */
function pick(options: string[], current: string): string {
  return options.includes(current) ? current : (options[0] ?? current)
}

async function ensure(): Promise<void> {
  if (dict.value.subject.length > 0) return
  if (inflight) return inflight
  inflight = (async () => {
    loading.value = true
    try {
      const [rows, textbooks] = await Promise.all([
        Promise.all(DICT_KEYS.map((key) => fetchTenantDict(key))),
        fetchTextbookMatrix(),
      ])
      DICT_KEYS.forEach((key, index) => {
        dict.value[key] = rows[index]
      })
      matrix.value = textbooks
    } finally {
      loading.value = false
      inflight = null
    }
  })()
  return inflight
}

export function useBaseData() {
  return {
    loading,
    ensure,
    subjects,
    grades,
    questionTypes,
    difficulties,
    examTypes,
    subjectsForGrade,
    optionsForGrade,
    versionsFor,
    defaultTextbook,
    withCurrent,
    optionLabel,
    pick,
  }
}
