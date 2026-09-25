/**
 * 题库组卷工作台的数据源：题目 / 试卷 / 教辅 / 媒体一次加载，8 个资源页签共用。
 *
 * 为什么提到 shell 层：每个页签都要按 id 反查题目（组卷车预览、试卷预览都依赖它），
 * 也都要在同一份数据上做筛选。若各页签自己 `fetchQuestions()`，切一次页签就多一轮
 * mock 往返（200-600ms），且各页签拿到的可能是不同快照。
 *
 * 模块级单例，与 `useBaseData` 同一口径：单个标签页内所有调用方共享一份数据与一个在途请求。
 */
import { computed, ref } from 'vue'
import type { OrgMaterial, OrgMedia, OrgPaper, OrgQuestion } from '@aiteach/shared'
import { fetchMaterials, fetchMedia, fetchPapers, fetchQuestions } from '@/api/org'

const questions = ref<OrgQuestion[]>([])
const papers = ref<OrgPaper[]>([])
const materials = ref<OrgMaterial[]>([])
const media = ref<OrgMedia[]>([])
const loading = ref(false)
const loaded = ref(false)
let inflight: Promise<void> | null = null

async function loadAll(): Promise<void> {
  loading.value = true
  try {
    const [questionRows, paperRows, materialRows, mediaRows] = await Promise.all([
      fetchQuestions(),
      fetchPapers(),
      fetchMaterials(),
      fetchMedia(),
    ])
    questions.value = questionRows
    papers.value = paperRows
    materials.value = materialRows
    media.value = mediaRows
    loaded.value = true
  } finally {
    loading.value = false
    inflight = null
  }
}

/** 首次进入工作台时加载全部数据；重复调用复用同一在途请求 */
function ensure(): Promise<void> {
  if (loaded.value) return Promise.resolve()
  if (inflight) return inflight
  inflight = loadAll()
  return inflight
}

/** 生成试卷后重新拉取，让「试卷」页签立刻出现新卷 */
async function refreshPapers(): Promise<void> {
  papers.value = await fetchPapers()
}

/** 题目 id → 题目（组卷车与试卷预览反复按 id 反查，用 Map 避免 O(n) 扫描） */
const questionMap = computed(() => new Map(questions.value.map((row) => [row.id, row])))
function questionOf(id: number): OrgQuestion | undefined {
  return questionMap.value.get(id)
}

/** 仅「已入库」题目可入卷（FR-PP-003），与协同组卷选题池同一口径 */
const approvedQuestions = computed(() => questions.value.filter((row) => row.status === 'approved'))

const mediaOfKind = (kind: OrgMedia['kind']) => computed(() => media.value.filter((row) => row.kind === kind))
const videos = mediaOfKind('video')
const animations = mediaOfKind('animation')
const images = mediaOfKind('image')

export function useComposeData() {
  return {
    loading,
    loaded,
    ensure,
    refreshPapers,
    questions,
    papers,
    materials,
    media,
    questionOf,
    approvedQuestions,
    videos,
    animations,
    images,
  }
}
