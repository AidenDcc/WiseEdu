<script setup lang="ts">
/**
 * 协同组卷 · 组卷界面（任务处理人的工作台）。
 *
 * 本页要同时成立三件事，缺一件这个功能就不成立：
 * 1. **只能加自己负责的题型**：题目池与 AI 抽题都按 `myTypes` 过滤，入卷再由服务端复核
 *    （见 `collabAddQuestions`）——只在界面上置灰是拦不住越权的。
 * 2. **但要看得到整张试卷**：卷面区把全部大题、全部题目都画出来，别人的题型标出负责人；
 *    试卷的题型要求、难点要求、考察知识点要求、年级学科分值常驻在顶部，随时可对照。
 * 3. **要看得见别人和过去**：右侧「进度」列出每位处理人的负责题型与完成度，
 *    「版本」给出可撤销 / 可替换的版本线。
 *
 * 当前身份：演示用下拉切换（真实场景由登录态决定），这样才能直观看到题型约束在不同人身上生效。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AppIcon, COLLAB_MEMBER_TEXT, COLLAB_STATUS_TEXT, RichTextViewer, showToast, toPlainText, truncateRich, AppModal } from '@aiteach/shared'
import type { CollabMember, OrgCollabTask, OrgPaper, OrgQuestion, PaperSection } from '@aiteach/shared'
import PaperPreviewModal from '@/components/paper/PaperPreviewModal.vue'
import {
  collabAddQuestions,
  collabAiCompose,
  collabRemoveQuestion,
  collabReopenMember,
  collabSubmitMember,
  fetchCollabTask,
  fetchQuestions,
  replacePaperVersion,
  restorePaperVersion,
} from '@/api/org'
import { useBaseData } from '@/composables/useBaseData'
import { typeOfSectionTitle } from './paper-sections'

const route = useRoute()
const router = useRouter()
const { difficulties, ensure } = useBaseData()

const task = ref<OrgCollabTask | null>(null)
const paper = ref<OrgPaper | null>(null)
const questions = ref<OrgQuestion[]>([])
const loading = ref(true)
const busy = ref(false)

const taskId = computed(() => Number(route.query.id ?? 0))

/** 当前身份：默认取「我」（陈明远），不在名单里时退到第一位处理人 */
const activeName = ref('陈明远')
const me = computed<CollabMember | null>(() => task.value?.members.find((row) => row.name === activeName.value) ?? null)
/** 我负责的题型：入卷与抽题的硬约束 */
const myTypes = computed(() => me.value?.questionTypes ?? [])
const canPick = computed(() => !!me.value && !(me.value.perms.length === 1 && me.value.perms.includes('只读')))
const canScore = computed(() => !!me.value && me.value.perms.includes('改分值'))

const sections = computed(() => paper.value?.sections ?? [])
const totalCount = computed(() => sections.value.reduce((sum, row) => sum + row.questions.length, 0))
const totalScore = computed(() =>
  sections.value.reduce((sum, row) => sum + row.questions.reduce((t, q) => t + (Number(q.score) || 0), 0), 0),
)

/** 知识点要求：模板里做 `task.requirement...` 会因 `task` 可空而在嵌套作用域丢失类型收窄，故在此兜住 */
const reqKnowledge = computed(() => task.value?.requirement.knowledge ?? [])

const itemOf = (id: number) => questions.value.find((row) => row.id === id)

/** 大题标题 → 题型标签（至多一个）。看不出题型的自定义标题不挂标签，空大题也能标出归属 */
function sectionTypeTags(section: PaperSection): string[] {
  const type = typeOfSectionTitle(section.title)
  return type ? [type] : []
}

/** 题型的负责人（卷面上每一道题都要标出来，否则看不出「这道题是谁的」） */
function ownerOfType(type: string): string {
  return task.value?.members.find((row) => row.questionTypes.includes(type))?.name ?? '未分配'
}

function isMineType(type: string): boolean {
  return myTypes.value.includes(type)
}

/** 某题型的收题进度（要求题数 / 已在卷题数 / 负责成员状态） */
function progressOfType(type: string) {
  const want = task.value?.requirement.structure.find((row) => row.type === type)?.count ?? 0
  const have = sections.value.reduce(
    (count, section) => count + section.questions.filter((entry) => itemOf(entry.questionId)?.type === type).length,
    0,
  )
  const member = task.value?.members.find((row) => row.questionTypes.includes(type))
  return { want, have, member, percent: want ? Math.min(100, Math.round((have / want) * 100)) : 0 }
}

const myProgress = computed(() => {
  const want = myTypes.value.reduce(
    (sum, type) => sum + (task.value?.requirement.structure.find((row) => row.type === type)?.count ?? 0),
    0,
  )
  const have = myTypes.value.reduce((sum, type) => sum + progressOfType(type).have, 0)
  return { want, have, percent: want ? Math.min(100, Math.round((have / want) * 100)) : 0 }
})

/** 某位处理人的整体完成度（按他负责的全部题型汇总） */
function memberProgress(member: CollabMember): { have: number; want: number; percent: number } {
  const want = member.questionTypes.reduce((sum, type) => sum + progressOfType(type).want, 0)
  const have = member.questionTypes.reduce((sum, type) => sum + progressOfType(type).have, 0)
  return { want, have, percent: want ? Math.min(100, Math.round((have / want) * 100)) : 0 }
}

/* ================= 题目池（只列我负责的题型） ================= */

const poolFilter = reactive({ type: '', difficulty: '', knowledge: '', keyword: '', hidePicked: false })
const pickedIds = ref<number[]>([])

const poolTypes = computed(() => myTypes.value)
const pool = computed(() =>
  questions.value.filter(
    (row) =>
      row.status === 'approved' &&
      myTypes.value.includes(row.type) &&
      (!poolFilter.type || row.type === poolFilter.type) &&
      (!poolFilter.difficulty || row.difficulty === poolFilter.difficulty) &&
      (!poolFilter.knowledge || row.knowledge.includes(poolFilter.knowledge)) &&
      (!poolFilter.keyword || toPlainText(row.stem).includes(poolFilter.keyword)) &&
      (!poolFilter.hidePicked || !inPaperIds.value.has(row.id)),
  ),
)

const inPaperIds = computed(() => new Set(sections.value.flatMap((row) => row.questions.map((q) => q.questionId))))

function togglePick(id: number) {
  pickedIds.value = pickedIds.value.includes(id) ? pickedIds.value.filter((row) => row !== id) : [...pickedIds.value, id]
}

async function addPicked() {
  if (!pickedIds.value.length) {
    showToast('请先勾选要加入的题目', 'error')
    return
  }
  await addQuestions(pickedIds.value.map((questionId) => ({ questionId })))
  pickedIds.value = []
}

async function addQuestions(rows: Array<{ questionId: number; score?: number }>) {
  if (!task.value || !me.value) return
  if (!canPick.value) {
    showToast('你在本任务中只有只读权限', 'error')
    return
  }
  busy.value = true
  try {
    const { paper: next, added } = await collabAddQuestions({
      taskId: task.value.id,
      memberName: me.value.name,
      questions: rows,
    })
    paper.value = next
    await refreshTask()
    showToast(`已加入 ${added} 道题`, 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '加入失败', 'error')
  } finally {
    busy.value = false
  }
}

async function removeQuestion(questionId: number) {
  if (!task.value || !me.value) return
  busy.value = true
  try {
    paper.value = await collabRemoveQuestion({ taskId: task.value.id, memberName: me.value.name, questionId })
    await refreshTask()
    showToast('已从试卷移除', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '移除失败', 'error')
  } finally {
    busy.value = false
  }
}

/* ================= AI 辅助组卷 ================= */

const aiOpen = ref(false)
const aiForm = reactive({ type: '', count: 0, difficulty: '', allowGenerate: true })
const aiRunning = ref(false)

function openAi() {
  if (!myTypes.value.length) {
    showToast('你还没有被分配题型', 'error')
    return
  }
  aiForm.type = myTypes.value[0]
  aiForm.count = 0
  aiForm.difficulty = ''
  aiForm.allowGenerate = true
  aiOpen.value = true
}

async function runAi() {
  if (!task.value || !me.value) return
  aiRunning.value = true
  try {
    const { picked, generated } = await collabAiCompose({
      taskId: task.value.id,
      memberName: me.value.name,
      type: aiForm.type,
      count: aiForm.count || undefined,
      difficulty: aiForm.difficulty || undefined,
      allowGenerate: aiForm.allowGenerate,
    })
    aiOpen.value = false
    await reload()
    showToast(
      `AI 为「${aiForm.type}」抽取 ${picked.length} 题${generated ? `，另新生成 ${generated} 题（均为草稿，请复核）` : ''}`,
      'success',
    )
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'AI 抽题失败', 'error')
  } finally {
    aiRunning.value = false
  }
}

/* ================= 提交 / 预览 / 修订 ================= */

async function submitMine() {
  if (!task.value || !me.value) return
  busy.value = true
  try {
    await collabSubmitMember({ taskId: task.value.id, memberName: me.value.name })
    await reload()
    showToast('已提交你负责的题型，发起人可开始审校', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '提交失败', 'error')
  } finally {
    busy.value = false
  }
}

async function reopenMine() {
  if (!task.value || !me.value) return
  busy.value = true
  try {
    await collabReopenMember({ taskId: task.value.id, memberName: me.value.name })
    await reload()
    showToast('已撤销提交，可继续修订', 'success')
  } finally {
    busy.value = false
  }
}

const previewOpen = ref(false)

/* ================= 版本 ================= */

const sideTab = ref<'progress' | 'versions'>('progress')
const replaceTarget = ref<number | null>(null)
const replaceNote = ref('')

async function onRestore(versionId: number) {
  if (!paper.value) return
  try {
    const { paper: next, versions } = await restorePaperVersion({ paperId: paper.value.id, versionId })
    paper.value = next
    if (task.value) task.value.versions = versions
    showToast('已撤销到所选版本', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '撤销失败', 'error')
  }
}

async function onReplace() {
  if (!paper.value || replaceTarget.value == null) return
  try {
    const { paper: next, versions } = await replacePaperVersion({
      paperId: paper.value.id,
      versionId: replaceTarget.value,
      note: replaceNote.value,
    })
    paper.value = next
    if (task.value) task.value.versions = versions
    replaceTarget.value = null
    replaceNote.value = ''
    showToast('已用所选版本替换当前卷面', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '替换失败', 'error')
  }
}

/* ================= 数据 ================= */

async function refreshTask() {
  if (!taskId.value) return
  const { task: next } = await fetchCollabTask(taskId.value)
  task.value = next
}

async function reload() {
  if (!taskId.value) return
  const [{ task: next, paper: current }, questionRows] = await Promise.all([fetchCollabTask(taskId.value), fetchQuestions()])
  task.value = next
  paper.value = current
  questions.value = questionRows
  if (!next.members.some((row) => row.name === activeName.value)) {
    activeName.value = next.members[0]?.name ?? ''
  }
}

onMounted(async () => {
  loading.value = true
  try {
    await ensure()
    if (!taskId.value) {
      router.replace('/paper/collab')
      return
    }
    await reload()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '任务载入失败', 'error')
    router.replace('/paper/collab')
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div v-if="task && paper" class="ct-page">
    <!-- 顶栏 -->
    <div class="ct-head panel">
      <button class="ct-back" type="button" @click="router.push('/paper/collab')">
        <AppIcon name="chevron-left" :size="15" />
      </button>
      <div class="ct-head-main">
        <h2>{{ task.name }}</h2>
        <p class="f-hint">
          {{ task.requirement.grade }} · {{ task.requirement.subject }} · {{ task.requirement.duration }} 分钟 ·
          满分 {{ totalScore }} 分 · 共 {{ totalCount }} 题 · 发起人 {{ task.owner }} · 创建于 {{ task.createdAt }}
        </p>
      </div>
      <div class="ct-head-ops">
        <span class="tag" :class="task.status === 'done' ? 'tag-green' : task.status === 'reviewing' ? 'tag-orange' : 'tag-blue'">
          {{ COLLAB_STATUS_TEXT[task.status] }}
        </span>
        <span class="ct-identity">
          <span class="f-hint">当前身份</span>
          <select v-model="activeName" class="f-select">
            <option v-for="member in task.members" :key="member.name" :value="member.name">
              {{ member.name }}
            </option>
          </select>
        </span>
        <button class="btn btn-ghost btn-sm" @click="router.push(`/paper/edit?id=${paper.id}`)">
          <AppIcon name="edit" :size="14" /> 编辑卷面格式
        </button>
        <button class="btn btn-ghost btn-sm" @click="previewOpen = true">
          <AppIcon name="eye" :size="14" /> 预览试卷
        </button>
        <button
          v-if="me && me.status !== 'submitted'"
          class="btn btn-primary btn-sm"
          :disabled="busy"
          @click="submitMine"
        >
          <AppIcon name="check" :size="14" /> 提交我的部分
        </button>
        <button v-else-if="me" class="btn btn-ghost btn-sm" :disabled="busy" @click="reopenMine">撤销提交</button>
      </div>
    </div>

    <!-- 试卷基本要求（所有人可见，AI 抽题也读这一份） -->
    <div class="ct-req panel">
      <div class="ct-req-block">
        <div class="ct-req-title"><AppIcon name="list-ol" :size="14" /> 题型要求</div>
        <div class="ct-req-chips">
          <span
            v-for="row in task.requirement.structure"
            :key="row.type"
            class="ct-req-chip"
            :class="{ mine: isMineType(row.type) }"
          >
            <b>{{ row.type }}</b>
            {{ progressOfType(row.type).have }} / {{ row.count }} 题 · {{ row.score }} 分/题
            <em>{{ ownerOfType(row.type) }}</em>
          </span>
        </div>
      </div>

      <div class="ct-req-row">
        <div class="ct-req-block">
          <div class="ct-req-title"><AppIcon name="chart" :size="14" /> 难点要求</div>
          <div class="ct-req-chips">
            <span v-for="row in task.requirement.difficulty" :key="row.level" class="ct-req-chip plain">
              {{ row.level }} {{ row.ratio }}%
            </span>
          </div>
        </div>
        <div class="ct-req-block">
          <div class="ct-req-title"><AppIcon name="star" :size="14" /> 考察知识点要求</div>
          <div class="ct-req-chips">
            <span v-if="!task.requirement.knowledge.length" class="f-hint">未指定</span>
            <span v-for="row in task.requirement.knowledge" :key="row" class="ct-req-chip plain">{{ row }}</span>
          </div>
        </div>
      </div>

      <p v-if="task.requirement.remark" class="ct-req-remark">
        <b>命题说明：</b>{{ task.requirement.remark }}
      </p>
    </div>

    <div class="ct-body">
      <!-- 左：题目池（仅我负责的题型） -->
      <aside class="panel ct-pool">
        <div class="ct-pool-head">
          <div class="section-title" style="margin-bottom: 8px">选题（我负责：{{ myTypes.join('、') || '未分配' }}）</div>
          <div class="ct-my-progress">
            <span class="f-hint">{{ myProgress.have }} / {{ myProgress.want }} 题</span>
            <div class="usage" style="flex: 1">
              <div class="bar"><i :style="{ width: `${myProgress.percent}%` }" /></div>
            </div>
          </div>
        </div>

        <div class="ct-pool-filters">
          <select v-model="poolFilter.type" class="f-select">
            <option value="">全部我的题型</option>
            <option v-for="t in poolTypes" :key="t" :value="t">{{ t }}</option>
          </select>
          <select v-model="poolFilter.difficulty" class="f-select">
            <option value="">全部难度</option>
            <option v-for="d in difficulties" :key="d" :value="d">{{ d }}</option>
          </select>
        </div>
        <select v-model="poolFilter.knowledge" class="f-select" style="margin-bottom: 8px">
          <option value="">全部知识点</option>
          <option v-for="k in task.requirement.knowledge" :key="k" :value="k">{{ k }}</option>
        </select>
        <input v-model="poolFilter.keyword" class="f-input" placeholder="搜索题干关键词" />
        <label class="ct-check">
          <input v-model="poolFilter.hidePicked" type="checkbox" />
          隐藏已在卷中的题
        </label>

        <div class="ct-pool-ops">
          <button class="btn btn-primary btn-sm" style="flex: 1" :disabled="busy || !pickedIds.length" @click="addPicked">
            <AppIcon name="plus" :size="14" /> 加入所选（{{ pickedIds.length }}）
          </button>
          <button class="btn btn-ghost btn-sm" @click="openAi"><AppIcon name="sparkles" :size="14" /> AI 抽题</button>
        </div>

        <div class="ct-pool-list">
          <p v-if="!myTypes.length" class="f-hint">你还没有被分配题型，请联系发起人。</p>
          <p v-else-if="!pool.length" class="f-hint">没有符合条件的已入库题目，可用「AI 抽题」按试卷要求生成。</p>
          <div
            v-for="row in pool"
            :key="row.id"
            class="ct-pool-card"
            :class="{ on: pickedIds.includes(row.id), picked: inPaperIds.has(row.id) }"
            @click="inPaperIds.has(row.id) ? null : togglePick(row.id)"
          >
            <div class="ct-pool-meta">
              <i class="ct-tick">{{ pickedIds.includes(row.id) || inPaperIds.has(row.id) ? '✓' : '' }}</i>
              <span class="tag tag-gray">{{ row.type }}</span>
              <span class="tag tag-gray">{{ row.difficulty }}</span>
              <span v-if="inPaperIds.has(row.id)" class="tag tag-blue">已在卷中</span>
            </div>
            <p class="ct-pool-stem">{{ truncateRich(row.stem, 68) }}</p>
            <div class="ct-pool-foot">
              <span class="f-hint">{{ row.knowledge.slice(0, 2).join('、') }}</span>
              <span class="f-hint">引用 {{ row.useCount }} 次</span>
            </div>
          </div>
        </div>
      </aside>

      <!-- 中：整卷（别人的题型也看得到，但不可改） -->
      <main class="ct-main">
        <div class="panel ct-paper">
          <div class="ct-paper-head">
            <div>
              <h3>{{ paper.name }}</h3>
              <p class="f-hint">整卷视图：所有题型的题目都在这里，你只能修改自己负责的题型</p>
            </div>
            <div class="op-group">
              <span class="f-hint">共 {{ totalCount }} 题 · {{ totalScore }} 分</span>
            </div>
          </div>

          <div v-for="(section, si) in sections" :key="section.id" class="ct-section">
            <div class="ct-section-head">
              <b>{{ section.title }}</b>
              <span class="f-hint">
                {{ section.questions.length }} 题 ·
                {{ section.questions.reduce((s, q) => s + (Number(q.score) || 0), 0) }} 分
              </span>
              <span
                v-for="type in sectionTypeTags(section)"
                :key="type"
                class="tag"
                :class="isMineType(type) ? 'tag-blue' : 'tag-gray'"
                style="margin-left: 4px"
              >
                {{ isMineType(type) ? '我负责' : `负责人 ${ownerOfType(type)}` }}
              </span>
            </div>

            <p v-if="!section.questions.length" class="f-hint" style="padding: 6px 0">该大题还没有题目</p>

            <div v-for="(entry, qi) in section.questions" :key="`${entry.questionId}-${qi}`" class="ct-q">
              <span class="ct-q-no">{{ qi + 1 }}</span>
              <div class="ct-q-body">
                <p class="ct-q-stem">
                  <RichTextViewer v-if="itemOf(entry.questionId)" :content="itemOf(entry.questionId)!.stem" tag="span" />
                  <template v-else>题目 #{{ entry.questionId }}</template>
                </p>
                <div class="ct-q-meta">
                  <span class="tag tag-gray">{{ itemOf(entry.questionId)?.type }}</span>
                  <span class="tag tag-gray">{{ itemOf(entry.questionId)?.difficulty }}</span>
                  <span
                    v-for="k in itemOf(entry.questionId)?.knowledge ?? []"
                    :key="k"
                    class="tag"
                    :class="reqKnowledge.includes(k) ? 'tag-blue' : 'tag-gray'"
                  >
                    {{ k }}
                  </span>
                  <span v-if="itemOf(entry.questionId)?.knowledge.some((k) => reqKnowledge.includes(k))" class="f-hint">
                    命中知识点要求
                  </span>
                </div>
              </div>
              <div class="ct-q-ops">
                <span class="f-hint">{{ entry.score }} 分</span>
                <button
                  v-if="me && isMineType(itemOf(entry.questionId)?.type ?? '')"
                  class="mini-btn danger"
                  :disabled="busy"
                  @click="removeQuestion(entry.questionId)"
                >
                  移除
                </button>
                <span v-else class="f-hint">仅 {{ ownerOfType(itemOf(entry.questionId)?.type ?? '') }} 可改</span>
              </div>
            </div>
          </div>

          <p v-if="!sections.length" class="f-hint">试卷还没有大题，请发起人先在「修改要求」里设置题型结构。</p>
        </div>
      </main>

      <!-- 右：进度 / 版本 -->
      <aside class="panel ct-side">
        <div class="ct-tabs">
          <button type="button" :class="{ on: sideTab === 'progress' }" @click="sideTab = 'progress'">进度与状态</button>
          <button type="button" :class="{ on: sideTab === 'versions' }" @click="sideTab = 'versions'">
            版本（{{ task.versions.length }}）
          </button>
        </div>

        <div v-if="sideTab === 'progress'" class="ct-side-body">
          <div v-for="member in task.members" :key="member.name" class="ct-member">
            <div class="ct-member-top">
              <b>{{ member.name }}</b>
              <span v-if="member.name === activeName" class="tag tag-blue">当前身份</span>
              <span class="tag" :class="member.status === 'submitted' ? 'tag-green' : member.status === 'working' ? 'tag-blue' : 'tag-gray'">
                {{ COLLAB_MEMBER_TEXT[member.status] }}
              </span>
              <i v-if="member.online" class="online-dot" title="在线" />
            </div>
            <div class="usage" style="margin: 6px 0">
              <div class="num">{{ memberProgress(member).have }} / {{ memberProgress(member).want }} 题</div>
              <div class="bar"><i :style="{ width: `${memberProgress(member).percent}%` }" /></div>
            </div>
            <p class="f-hint">负责题型：{{ member.questionTypes.join('、') || '未分配' }}</p>
            <p class="f-hint">权限：{{ member.perms.join('/') }} · 最近动作 {{ member.lastActiveAt }}</p>
          </div>
        </div>

        <div v-else class="ct-side-body">
          <div v-for="row in task.versions.slice().reverse()" :key="row.id" class="ct-ver" :class="{ replaced: row.replaced }">
            <div class="ct-ver-head">
              <b>v{{ row.no }}</b>
              <span>{{ row.actor }}</span>
              <em>{{ row.time }}</em>
            </div>
            <p class="f-hint">{{ row.summary }}</p>
            <p class="f-hint">{{ row.questionCount }} 题 · {{ row.totalScore }} 分<template v-if="row.note"> · 备注：{{ row.note }}</template></p>
            <div class="op-group" style="margin-top: 4px">
              <button class="mini-btn" @click="onRestore(row.id)">撤销到此版</button>
              <button class="mini-btn" @click="replaceTarget = row.id">替换当前</button>
            </div>
          </div>
        </div>
      </aside>
    </div>

    <!-- AI 抽题 -->
    <AppModal v-if="aiOpen" title="AI 按试卷要求抽题" :width="520" @close="aiOpen = false">
      <p class="f-hint" style="margin-bottom: 12px">
        AI 会读这份试卷的题型要求、难点要求、考察知识点要求以及本卷已有题目，从题库中抽取「{{ aiForm.type }}」补足；
        题库不足时可让它新生成（草稿状态，需命题人复核）。
      </p>
      <div class="f-field row2">
        <div>
          <label class="f-label">题型（仅我负责的题型）</label>
          <select v-model="aiForm.type" class="f-select">
            <option v-for="t in myTypes" :key="t" :value="t">{{ t }}</option>
          </select>
        </div>
        <div>
          <label class="f-label">难度偏好</label>
          <select v-model="aiForm.difficulty" class="f-select">
            <option value="">按试卷难点要求</option>
            <option v-for="d in difficulties" :key="d" :value="d">{{ d }}</option>
          </select>
        </div>
      </div>
      <div class="f-field">
        <label class="f-label">抽取题数（0 = 按题数缺口自动补齐）</label>
        <input v-model.number="aiForm.count" type="number" min="0" class="f-input" />
        <p class="f-hint">
          「{{ aiForm.type }}」当前缺口：
          {{ Math.max(0, progressOfType(aiForm.type).want - progressOfType(aiForm.type).have) }} 道
        </p>
      </div>
      <label class="ct-check">
        <input v-model="aiForm.allowGenerate" type="checkbox" />
        题库不足时允许 AI 新生成题目补足
      </label>
      <template #footer>
        <button class="btn btn-ghost" @click="aiOpen = false">取消</button>
        <button class="btn btn-primary" :disabled="aiRunning" @click="runAi">
          {{ aiRunning ? '抽取中…' : '开始抽取（消耗 1 次额度）' }}
        </button>
      </template>
    </AppModal>

    <!-- 替换版本 -->
    <AppModal v-if="replaceTarget != null" title="以所选版本替换当前卷面" :width="460" @close="replaceTarget = null">
      <p class="f-hint" style="margin-bottom: 12px">
        替换后当前卷面会被该版本覆盖，原卷面仍保留在版本线里（标记为「已被替换」），可再次撤销回来。
      </p>
      <div class="f-field">
        <label class="f-label">替换说明（可选）</label>
        <input v-model="replaceNote" class="f-input" placeholder="如：改用 v3 的分值方案" />
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="replaceTarget = null">取消</button>
        <button class="btn btn-primary" @click="onReplace">确认替换</button>
      </template>
    </AppModal>

    <PaperPreviewModal
      v-if="previewOpen"
      :paper="paper"
      :questions="questions"
      initial-mode="both"
      @close="previewOpen = false"
    />
  </div>

  <div v-else-if="loading" class="panel" style="padding: 40px; text-align: center; color: var(--sub)">正在载入任务…</div>
</template>

<style scoped>
.ct-page { display: flex; flex-direction: column; gap: 12px; }

.ct-head { display: flex; align-items: center; gap: 12px; padding: 14px 16px; }
.ct-back {
  width: 34px; height: 34px; flex-shrink: 0;
  border: 1px solid var(--border); border-radius: 9px;
  background: #fff; color: var(--ink-2);
  display: flex; align-items: center; justify-content: center;
}
.ct-back:hover { border-color: var(--brand); color: var(--brand-deep); }
.ct-head-main { flex: 1; min-width: 0; }
.ct-head-main h2 { font-size: 16.5px; font-weight: 700; }
.ct-head-ops { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; flex-shrink: 0; }
.ct-identity { display: inline-flex; align-items: center; gap: 6px; }
/* 自写横向工具条里的下拉：全局 .f-select 是 width:100%，会把这一行撑满（见规范第 4 条） */
.ct-identity .f-select { width: auto; min-width: 132px; height: var(--ctrl-h); flex-shrink: 0; }

.ct-req { padding: 14px 16px; }
.ct-req-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 12px; }
.ct-req-title { display: flex; align-items: center; gap: 5px; font-size: 12.5px; font-weight: 700; color: var(--ink); margin-bottom: 7px; }
.ct-req-chips { display: flex; flex-wrap: wrap; gap: 7px; }
.ct-req-chip {
  display: inline-flex; align-items: center; gap: 6px;
  border: 1.5px solid var(--border); border-radius: 999px;
  padding: 4px 12px; font-size: 12.5px; color: var(--ink-2); background: #fff;
}
.ct-req-chip b { color: var(--ink); }
.ct-req-chip em { font-style: normal; color: var(--sub); font-size: 11.5px; }
.ct-req-chip.mine { border-color: var(--brand); background: var(--brand-soft); }
.ct-req-chip.mine b { color: var(--brand-deep); }
.ct-req-chip.plain { background: #f7fafc; border-style: dashed; }
.ct-req-remark {
  margin-top: 12px; padding-top: 10px; border-top: 1px dashed var(--border);
  font-size: 12.5px; color: var(--ink-2); line-height: 1.7;
}
.ct-req-remark b { color: var(--ink); }

.ct-body { display: grid; grid-template-columns: 300px minmax(0, 1fr) 292px; gap: 12px; align-items: start; }

/* 左侧题目池 */
.ct-pool { padding: 14px; display: flex; flex-direction: column; position: sticky; top: 0; max-height: calc(100vh - 150px); }
.ct-pool-head { margin-bottom: 10px; }
.ct-my-progress { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
/* 横向居中的行里，f-hint 自带的 5px 上边距会把文字顶歪 */
.ct-my-progress .f-hint,
.ct-section-head .f-hint,
.ct-q-ops .f-hint,
.ct-pool-foot .f-hint,
.ct-paper-head .f-hint { margin-top: 0; }
.ct-pool-filters { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px; }
.ct-check { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--ink-2); margin: 8px 0; }
.ct-check input { accent-color: var(--brand); }
.ct-pool-ops { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.ct-pool-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
.ct-pool-card {
  border: 1.5px solid var(--border); border-radius: 10px; padding: 9px 11px;
  background: #fff; cursor: pointer; transition: border-color 0.12s, background 0.12s;
}
.ct-pool-card:hover { border-color: var(--brand); }
.ct-pool-card.on { border-color: var(--brand); background: var(--brand-soft); }
.ct-pool-card.picked { opacity: 0.6; cursor: default; }
.ct-pool-meta { display: flex; align-items: center; gap: 5px; margin-bottom: 5px; flex-wrap: wrap; }
.ct-tick {
  width: 15px; height: 15px; border-radius: 4px; border: 1.5px solid var(--border);
  font-style: normal; font-size: 11px;
  color: var(--brand-deep); flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
}
.ct-pool-card.on .ct-tick { border-color: var(--brand); background: var(--brand); color: #fff; }
.ct-pool-stem { font-size: 12.5px; color: var(--ink-2); line-height: 1.6; }
.ct-pool-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 5px; }

/* 中间整卷 */
.ct-main { min-width: 0; }
.ct-paper { padding: 16px; }
.ct-paper-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
.ct-paper-head h3 { font-size: 14.5px; font-weight: 700; }
.ct-section { border-top: 1px dashed var(--border); padding-top: 12px; margin-top: 12px; }
.ct-section:first-of-type { border-top: none; margin-top: 0; padding-top: 0; }
.ct-section-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.ct-section-head b { font-size: 13.5px; }
.ct-q {
  display: flex; align-items: flex-start; gap: 10px;
  border: 1px solid var(--border); border-radius: 10px;
  padding: 10px 12px; margin-bottom: 8px; background: #fbfdfd;
}
.ct-q-no {
  width: 22px; height: 22px; flex-shrink: 0; border-radius: 7px;
  background: var(--brand-soft); color: var(--brand-deep);
  font-size: 12px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
}
.ct-q-body { flex: 1; min-width: 0; }
.ct-q-stem { font-size: 13px; color: var(--ink-2); line-height: 1.65; }
.ct-q-meta { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; align-items: center; }
.ct-q-ops { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }

/* 右侧 */
.ct-side { display: flex; flex-direction: column; position: sticky; top: 0; max-height: calc(100vh - 150px); }
/* 标签条：横向容器必须有 align-items，否则文字与下划线不居中（见规范第 4 条） */
.ct-tabs { display: flex; align-items: center; border-bottom: 1px solid var(--border); }
.ct-tabs button {
  display: inline-flex; align-items: center; justify-content: center;
  flex: 1; border: none; background: transparent; font-size: 12.5px; color: var(--ink-2);
  padding: 11px 6px; border-bottom: 2px solid transparent;
}
.ct-tabs button.on { color: var(--brand-deep); font-weight: 600; border-bottom-color: var(--brand); }
.ct-side-body { flex: 1; overflow-y: auto; padding: 12px 14px; }
.ct-member { border-bottom: 1px dashed var(--border); padding-bottom: 12px; margin-bottom: 12px; }
.ct-member-top { display: flex; align-items: center; gap: 7px; font-size: 13px; }
.online-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--success); }
.ct-ver { border-left: 2px solid var(--border); padding: 0 0 12px 12px; }
.ct-ver.replaced { opacity: 0.6; }
.ct-ver-head { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--ink-2); }
.ct-ver-head b { color: var(--ink); }
.ct-ver-head em { margin-left: auto; font-style: normal; font-size: 11px; color: var(--sub); }
</style>
