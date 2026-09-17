<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AppIcon, RichTextViewer, showToast, toPlainText, truncateRich } from '@aiteach/shared'
import type { OrgQuestion } from '@aiteach/shared'
import AppModal from '@/components/ui/AppModal.vue'
import AppDrawer from '@/components/ui/AppDrawer.vue'
import { fetchPapers, fetchQuestions, savePaper, swapPaperQuestion } from '@/api/org'
import { useBaseData } from '@/composables/useBaseData'

const route = useRoute()
const router = useRouter()

const { subjects, grades, questionTypes, difficulties, ensure, pick, withCurrent, optionLabel } = useBaseData()

/* ===== 卷面草稿（新建 / 编辑） ===== */
const draft = reactive({
  id: 0,
  name: '',
  subject: '数学',
  grade: '高一',
  duration: 90,
  sections: [] as Array<{ id: number; title: string; questions: Array<{ questionId: number; score: number }> }>,
})
const collaborators = ref<Array<{ name: string; perms: string[]; online: boolean }>>([])
const dynamics = ref<Array<{ time: string; actor: string; action: string }>>([])
let sectionSeqLocal = 1

const questions = ref<OrgQuestion[]>([])

async function load() {
  await ensure()
  draft.subject = pick(subjects.value, draft.subject)
  draft.grade = pick(grades.value, draft.grade)
  questions.value = await fetchQuestions()
  const id = Number(route.query.id ?? 0)
  if (id) {
    const papers = await fetchPapers()
    const source = papers.find((row) => row.id === id)
    if (source) {
      draft.id = source.id
      draft.name = source.name
      draft.subject = source.subject
      draft.grade = source.grade
      draft.duration = source.duration
      draft.sections = JSON.parse(JSON.stringify(source.sections))
      collaborators.value = source.collaborators ?? []
      dynamics.value = source.dynamics ?? []
      sectionSeqLocal = Math.max(...draft.sections.map((row) => row.id), 0) + 1
      return
    }
  }
  draft.sections = [{ id: sectionSeqLocal++, title: '一、单项选择题', questions: [] }]
  applyBasket()
}

/** 题库「加入组卷库」带入的题目：逐题按题型自动归入对应大题（没有则新建） */
function applyBasket() {
  if (route.query.basket !== '1') return
  let ids: number[] = []
  try {
    ids = JSON.parse(sessionStorage.getItem('aiteach.paper-basket') ?? '[]') as number[]
  } catch {
    ids = []
  }
  if (!ids.length) return
  const rows = questions.value.filter((row) => ids.includes(row.id))
  const fresh = rows.filter((row) => !inPaperIds.value.has(row.id))
  fresh.forEach((row) => {
    const si = ensureSection(row.type)
    draft.sections[si].questions.push({ questionId: row.id, score: defaultScore(row.type) })
  })
  sessionStorage.removeItem('aiteach.paper-basket')
  showToast(`已从组卷库带入 ${fresh.length} 题（按题型自动归入大题，跳过已在卷中 ${rows.length - fresh.length} 题）`, 'success')
  if (fresh.length) logAction(`从组卷库带入 ${fresh.length} 道题目（自动归类大题）`)
}

/* ===== 左侧选题池（仅已入库题目可入卷，FR-PP-003） =====
   默认按试卷学科过滤：选题池跟随卷头学科，切换学科即切换题源（可选看全部学科） */
const poolFilter = reactive({ type: '', difficulty: '', keyword: '', subjectScope: 'paper' as 'paper' | 'all' })
const pool = computed(() =>
  questions.value.filter(
    (row) =>
      row.status === 'approved' &&
      (poolFilter.subjectScope === 'all' || row.subject === draft.subject) &&
      (!poolFilter.type || row.type === poolFilter.type) &&
      (!poolFilter.difficulty || row.difficulty === poolFilter.difficulty) &&
      (!poolFilter.keyword || toPlainText(row.stem).includes(poolFilter.keyword)),
  ),
)
/** 已在卷中的题目不可重复加入 */
const inPaperIds = computed(() => new Set(draft.sections.flatMap((section) => section.questions.map((q) => q.questionId))))

/* ===== 卷面试题渲染：与真实试卷一致（完整题干 + 选项 / 判断样式） ===== */

/** 客观题正确答案字母（用于高亮正确选项；判断题 answer 为 A/B） */
function answerLettersOf(id: number): string[] {
  const item = questionOf(id)
  if (!item || !item.options.length) return []
  return [...new Set(item.answer.toUpperCase().replace(/[^A-F]/g, '').split(''))]
}

/** 判断题选项按试卷样式渲染 √ / ×，其余题型渲染 A/B/C… */
function optionMark(id: number, index: number): string {
  const item = questionOf(id)
  if (item?.type === '判断题') return index === 0 ? '√' : '×'
  return 'ABCDEF'[index]
}

/** 题干前展示来源；手动录入与 AI 生成（出题/变式）不展示 */
const HIDDEN_SOURCE = new Set(['手动录入', 'AI 出题', 'AI 变式'])
function sourceOf(id: number): string {
  const item = questionOf(id)
  return item && !HIDDEN_SOURCE.has(item.source) ? item.source : ''
}

/* ===== 大题自动归类：加入题目时按题型匹配/新建大题（FR：自动识别大题类型） ===== */

/** 题型 → 大题标准名（新建大题时用它命名） */
const SECTION_LABEL: Record<string, string> = {
  单选题: '单项选择题',
  多选题: '多项选择题',
  判断题: '判断题',
  填空题: '填空题',
  解答题: '解答题',
}
/** 题型 → 大题标题匹配关键词（兼容「选择题」「一、单选题」等用户自定义标题） */
const SECTION_KEYWORDS: Record<string, string[]> = {
  单选题: ['单选', '选择'],
  多选题: ['多选'],
  判断题: ['判断'],
  填空题: ['填空'],
  解答题: ['解答', '问答'],
}
const NUMBERS = '一二三四五六七八'

/** 去掉标题编号前缀（「一、」），只留大题名用于题型匹配 */
function sectionTypeKey(title: string): string {
  return title.replace(/^[一二三四五六七八九十]+、/, '').trim()
}

/** 找到容纳该题型的大题下标；没有则新建一个（大题满员时退回最后一个大题并提示） */
function ensureSection(type: string): number {
  const keywords = SECTION_KEYWORDS[type] ?? [type.replace(/题$/, '')]
  const hit = draft.sections.findIndex((section) => keywords.some((kw) => sectionTypeKey(section.title).includes(kw)))
  if (hit >= 0) return hit
  if (draft.sections.length >= 8) {
    showToast('大题已达 8 个上限，题目已加入最后一个大题（可手动调整归类）', 'error')
    return draft.sections.length - 1
  }
  const label = SECTION_LABEL[type] ?? `${type}大题`
  draft.sections.push({ id: sectionSeqLocal++, title: `${NUMBERS[draft.sections.length]}、${label}`, questions: [] })
  logAction(`自动新建大题「${label}」`)
  return draft.sections.length - 1
}

function defaultScore(type: string): number {
  return type === '解答题' ? 12 : 5
}

function addQuestion(row: OrgQuestion) {
  if (inPaperIds.value.has(row.id)) {
    showToast('该题已在卷中', 'error')
    return
  }
  const si = ensureSection(row.type)
  draft.sections[si].questions.push({ questionId: row.id, score: defaultScore(row.type) })
  logAction(`将「${truncateRich(row.stem, 14)}…」自动归入${draft.sections[si].title}`)
}

function removeQuestion(si: number, qi: number) {
  const section = draft.sections[si]
  const [removed] = section.questions.splice(qi, 1)
  logAction(`移除题目 #${removed.questionId}`)
}

function logAction(action: string) {
  dynamics.value = [{ time: new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-'), actor: '陈明远', action }, ...dynamics.value]
}

function addSection() {
  if (draft.sections.length >= 8) {
    showToast('大题最多 8 个', 'error')
    return
  }
  draft.sections.push({ id: sectionSeqLocal++, title: `${'一二三四五六七八'[draft.sections.length]}、新大题`, questions: [] })
}
function removeSection(si: number) {
  if (draft.sections.length <= 1) {
    showToast('至少保留 1 个大题', 'error')
    return
  }
  if (!window.confirm('删除该大题及其全部题目？')) return
  draft.sections.splice(si, 1)
}

function questionOf(id: number) {
  return questions.value.find((row) => row.id === id)
}

/* ===== 统计 ===== */
const totalCount = computed(() => draft.sections.reduce((sum, s) => sum + s.questions.length, 0))
const totalScore = computed(() => draft.sections.reduce((sum, s) => sum + s.questions.reduce((t, q) => t + (Number(q.score) || 0), 0), 0))
const objectiveScore = computed(() =>
  draft.sections.reduce((sum, s) => {
    return sum + s.questions.reduce((t, q) => {
      const item = questionOf(q.questionId)
      return t + (item && (item.type === '单选题' || item.type === '多选题' || item.type === '判断题') ? Number(q.score) || 0 : 0)
    }, 0)
  }, 0),
)

/* ===== 换一题（FR-PP-009：同构替换，消耗额度） ===== */
async function onSwap(si: number, qi: number) {
  if (!draft.id) {
    showToast('请先保存试卷草稿后再使用「换一题」', 'error')
    return
  }
  const entry = draft.sections[si].questions[qi]
  try {
    const { paper, newId } = await swapPaperQuestion(draft.id, entry.questionId)
    entry.questionId = newId
    dynamics.value = paper.dynamics ?? dynamics.value
    showToast(`已替换为同构题 #${newId}（消耗 1 次额度）`, 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '替换失败', 'error')
  }
}

/* ===== 邀请协作（FR-PP-004 ~ 007） ===== */
const inviteOpen = ref(false)
const inviteForm = reactive({ picked: [] as string[], perms: ['选题'] as string[] })
const PERM_OPTIONS = ['选题', '改分值', '编辑卷头', '只读']
const CANDIDATES = ['李文博', '沈丽华', '赵小兰', '王志强']

function openInvite() {
  inviteForm.picked = []
  inviteForm.perms = ['选题']
  inviteOpen.value = true
}
function submitInvite() {
  if (!inviteForm.picked.length) {
    showToast('请选择至少 1 位协作者', 'error')
    return
  }
  if (!inviteForm.perms.length) {
    showToast('请勾选授予的权限', 'error')
    return
  }
  inviteForm.picked.forEach((name) => {
    if (!collaborators.value.some((row) => row.name === name)) {
      collaborators.value.push({ name, perms: [...inviteForm.perms], online: false })
    }
  })
  inviteOpen.value = false
  showToast(`协作邀请已发送给 ${inviteForm.picked.join('、')}，对方接受后可同步编辑`, 'success')
}

const dynamicOpen = ref(false)

/* ===== 保存（FR-PP-010：分值 0.5-100 / 总分校验） ===== */
const saving = ref(false)

function validate(): boolean {
  if (draft.name.trim().length < 2 || draft.name.trim().length > 50) {
    showToast('试卷名称须为 2-50 字', 'error')
    return false
  }
  if (totalCount.value === 0) {
    showToast('试卷至少需要 1 道题目', 'error')
    return false
  }
  const bad = draft.sections.some((s) =>
    s.questions.some((q) => !(Number(q.score) >= 0.5 && Number(q.score) <= 100)),
  )
  if (bad) {
    showToast('单题分值须在 0.5 ~ 100 之间', 'error')
    return false
  }
  return true
}

async function save(submit: boolean) {
  if (!validate()) return
  saving.value = true
  try {
    const saved = await savePaper({
      id: draft.id || undefined,
      name: draft.name.trim(),
      subject: draft.subject,
      grade: draft.grade,
      duration: draft.duration,
      sections: JSON.parse(JSON.stringify(draft.sections)),
      submit,
    })
    draft.id = saved.id
    showToast(submit ? '已提交：AI 九项检测通过后推送人工审核' : '草稿已保存', 'success')
    if (submit) router.push('/paper/list')
    else load()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '保存失败', 'error')
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="collab-layout">
    <!-- 左：选题池 -->
    <div class="panel pool-panel">
      <div class="section-title">选题池（仅「已入库」题目可入卷）</div>
      <div class="pool-filter">
        <select v-model="poolFilter.subjectScope" class="f-select" style="grid-column: span 2">
          <option value="paper">学科：跟随试卷（{{ draft.subject }}）</option>
          <option value="all">学科：全部</option>
        </select>
        <select v-model="poolFilter.type" class="f-select">
          <option value="">全部题型</option>
          <option v-for="t in questionTypes" :key="t" :value="t">{{ t }}</option>
        </select>
        <select v-model="poolFilter.difficulty" class="f-select">
          <option value="">全部难度</option>
          <option v-for="d in difficulties" :key="d" :value="d">{{ d }}</option>
        </select>
      </div>
      <input v-model="poolFilter.keyword" class="f-input" placeholder="搜索题干关键词" style="margin: 10px 0" />
      <div class="pool-list">
        <p v-if="pool.length === 0" class="f-hint">无符合条件的已入库题目</p>
        <div v-for="row in pool" :key="row.id" class="pool-card">
          <div class="pc-meta">
            <span class="tag tag-gray">{{ row.type }}</span>
            <span class="tag tag-gray">{{ row.difficulty }}</span>
            <span class="tag tag-blue">{{ row.useCount }} 次组卷</span>
          </div>
          <p class="pc-stem">{{ truncateRich(row.stem, 64) }}</p>
          <div class="pc-foot">
            <span class="f-hint">{{ row.knowledge[0] ?? '' }}</span>
            <button class="mini-btn" :disabled="inPaperIds.has(row.id)" @click="addQuestion(row)">
              {{ inPaperIds.has(row.id) ? '已在卷中' : '+ 加入试卷' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 右：卷面编辑 -->
    <div class="paper-panel">
      <!-- 卷头 -->
      <div class="panel head-panel">
        <div class="head-grid">
          <div class="f-field compact" style="grid-column: span 2">
            <label class="f-label">试卷名称<span class="req">*</span></label>
            <input v-model="draft.name" class="f-input" placeholder="2-50 字" />
          </div>
          <div class="f-field compact">
            <label class="f-label">学科</label>
            <select v-model="draft.subject" class="f-select">
              <option v-for="s in withCurrent(subjects, draft.subject)" :key="s" :value="s">{{ optionLabel(subjects, s) }}</option>
            </select>
          </div>
          <div class="f-field compact">
            <label class="f-label">年级</label>
            <select v-model="draft.grade" class="f-select">
              <option v-for="g in withCurrent(grades, draft.grade)" :key="g" :value="g">{{ optionLabel(grades, g) }}</option>
            </select>
          </div>
          <div class="f-field compact">
            <label class="f-label">时长（分钟）</label>
            <input v-model.number="draft.duration" type="number" min="10" max="240" class="f-input" />
          </div>
        </div>
        <!-- 协作者 -->
        <div class="collab-row">
          <div class="collab-avatars">
            <span v-for="c in collaborators" :key="c.name" class="collab-chip" :class="{ online: c.online }">
              <i class="dot" />
              {{ c.name }} · {{ c.perms.join('/') }}
            </span>
            <span v-if="collaborators.length === 0" class="f-hint">暂无协作者</span>
          </div>
          <div class="op-group">
            <button class="btn btn-ghost btn-sm" @click="openInvite"><AppIcon name="users" :size="14" /> 邀请协作</button>
            <button class="btn btn-ghost btn-sm" @click="dynamicOpen = true"><AppIcon name="clock" :size="14" /> 协作动态</button>
          </div>
        </div>
      </div>

      <!-- 大题分区 -->
      <div v-for="(section, si) in draft.sections" :key="section.id" class="panel section-block">
        <div class="section-bar">
          <input v-model="section.title" class="section-title-input" />
          <span class="f-hint">{{ section.questions.length }} 题 · {{ section.questions.reduce((s, q) => s + (Number(q.score) || 0), 0) }} 分</span>
          <button class="mini-btn danger" style="margin-left: auto" @click="removeSection(si)">删除大题</button>
        </div>
        <p v-if="section.questions.length === 0" class="f-hint" style="padding: 8px 0">从左侧选题池加入题目</p>
        <div v-for="(entry, qi) in section.questions" :key="`${entry.questionId}-${qi}`" class="q-row">
          <span class="q-no">{{ qi + 1 }}</span>
          <!-- 完整题目：与真实试卷样式一致（题干 + 选项/判断），题干前标注来源 -->
          <div class="q-body">
            <p class="q-stem">
              <span v-if="sourceOf(entry.questionId)" class="q-source">【{{ sourceOf(entry.questionId) }}】</span>
              <RichTextViewer
                v-if="questionOf(entry.questionId)"
                :content="questionOf(entry.questionId)!.stem"
                tag="span"
              />
              <template v-else>题目 #{{ entry.questionId }}</template>
            </p>
            <ul v-if="questionOf(entry.questionId)?.options.length" class="q-options">
              <li
                v-for="(opt, oi) in questionOf(entry.questionId)!.options"
                :key="oi"
                :class="{ right: answerLettersOf(entry.questionId).includes('ABCDEF'[oi]) }"
              >
                <span class="qo-letter">{{ optionMark(entry.questionId, oi) }}</span>
                <RichTextViewer :content="opt" tag="span" />
              </li>
            </ul>
          </div>
          <div class="q-ops">
            <input v-model.number="entry.score" type="number" min="0.5" max="100" step="0.5" class="f-input score-input" />
            <span class="f-hint">分</span>
            <button class="mini-btn" title="同知识点/题型/难度替换" @click="onSwap(si, qi)">换一题</button>
            <button class="mini-btn danger" @click="removeQuestion(si, qi)">移除</button>
          </div>
        </div>
      </div>

      <button class="btn btn-ghost add-section" @click="addSection"><AppIcon name="plus" :size="15" /> 添加大题</button>

      <!-- 底部统计 + 保存 -->
      <div class="panel stat-bar">
        <div class="stats">
          <span><b>{{ totalCount }}</b> 题</span>
          <span>总分 <b>{{ totalScore }}</b></span>
          <span class="f-hint">客观题 {{ objectiveScore }} 分</span>
        </div>
        <div class="op-group">
          <button class="btn btn-ghost" :disabled="saving" @click="router.push('/paper/list')">取消</button>
          <button class="btn btn-ghost" :disabled="saving" @click="save(false)">{{ saving ? '保存中…' : '保存草稿' }}</button>
          <button class="btn btn-primary" :disabled="saving" @click="save(true)">保存并提交审核</button>
        </div>
      </div>
    </div>

    <!-- 邀请协作 -->
    <AppModal v-if="inviteOpen" title="邀请协作" :width="480" @close="inviteOpen = false">
      <div class="f-field">
        <label class="f-label">选择协作者（本机构员工）</label>
        <div class="chips">
          <button
            v-for="name in CANDIDATES"
            :key="name"
            class="k-chip"
            :class="{ on: inviteForm.picked.includes(name) }"
            type="button"
            @click="inviteForm.picked.includes(name) ? inviteForm.picked.splice(inviteForm.picked.indexOf(name), 1) : inviteForm.picked.push(name)"
          >
            {{ name }}
          </button>
        </div>
      </div>
      <div class="f-field">
        <label class="f-label">授予权限（可多选）</label>
        <div class="chips">
          <button
            v-for="p in PERM_OPTIONS"
            :key="p"
            class="k-chip"
            :class="{ on: inviteForm.perms.includes(p) }"
            type="button"
            @click="inviteForm.perms.includes(p) ? inviteForm.perms.splice(inviteForm.perms.indexOf(p), 1) : inviteForm.perms.push(p)"
          >
            {{ p }}
          </button>
        </div>
        <p class="f-hint">协作者可在自己终端同步看到试卷变更，冲突以先保存者为准并提示</p>
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="inviteOpen = false">取消</button>
        <button class="btn btn-primary" @click="submitInvite">发送邀请</button>
      </template>
    </AppModal>

    <!-- 协作动态 -->
    <AppDrawer v-if="dynamicOpen" title="协作动态" subtitle="所有协作者的编辑行为实时留痕" :width="420" @close="dynamicOpen = false">
      <div class="dyn-list">
        <p v-if="dynamics.length === 0" class="f-hint">暂无动态</p>
        <div v-for="(item, i) in dynamics" :key="i" class="dyn-row">
          <span class="dyn-actor">{{ item.actor }}</span>
          <span class="dyn-action">{{ item.action }}</span>
          <span class="dyn-time">{{ item.time }}</span>
        </div>
      </div>
    </AppDrawer>
  </div>
</template>

<style scoped>
.collab-layout { display: grid; grid-template-columns: 340px 1fr; gap: 14px; align-items: start; }

.pool-panel { padding: 14px; position: sticky; top: 0; max-height: calc(100vh - 130px); display: flex; flex-direction: column; }
.pool-filter { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.pool-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
.pool-card { border: 1.5px solid var(--border); border-radius: 10px; padding: 10px 12px; background: #fff; }
.pc-meta { display: flex; gap: 6px; margin-bottom: 6px; }
.pc-stem { font-size: 12.5px; color: var(--ink-2); line-height: 1.6; margin-bottom: 8px; }
.pc-foot { display: flex; align-items: center; justify-content: space-between; }

.paper-panel { display: flex; flex-direction: column; gap: 12px; }
.head-panel { padding: 14px 16px; }
.head-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0 12px; }
.collab-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.collab-avatars { display: flex; flex-wrap: wrap; gap: 6px; }
.collab-chip {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12px; color: var(--sub); background: #f5f8f8;
  border-radius: 999px; padding: 3px 10px;
}
.collab-chip .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--border); }
.collab-chip.online { color: var(--brand-deep); background: var(--brand-soft); }
.collab-chip.online .dot { background: var(--brand); }

.section-block { padding: 12px 16px; }
.section-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.section-title-input {
  border: none; border-bottom: 1.5px dashed var(--border);
  font-size: 14.5px; font-weight: 700; color: var(--ink);
  padding: 2px 4px; background: transparent; width: 260px;
}
.section-title-input:focus { outline: none; border-bottom-color: var(--brand); }
.q-row {
  display: flex; align-items: flex-start; gap: 10px;
  border: 1px solid var(--border); border-radius: 10px;
  padding: 10px 12px; margin-bottom: 8px; background: #fbfdfd;
}
.q-no {
  width: 24px; height: 24px; flex-shrink: 0; border-radius: 7px;
  background: var(--brand-soft); color: var(--brand-deep);
  font-size: 12px; font-weight: 700; margin-top: 1px;
  display: flex; align-items: center; justify-content: center;
}
.q-body { flex: 1; min-width: 0; }
.q-stem { font-size: 13px; color: var(--ink-2); line-height: 1.6; }
.q-source { color: var(--sub); font-size: 12px; margin-right: 2px; }
/* 选项与真实试卷样式一致：字母（判断题为 √/×）+ 内容；正确项绿框高亮便于教师核对 */
.q-options { margin-top: 6px; display: flex; flex-direction: column; gap: 4px; }
.q-options li {
  display: flex; align-items: baseline; gap: 8px;
  font-size: 13px; color: var(--ink-2); line-height: 1.5;
  padding: 4px 8px; border-radius: 7px; border: 1px solid transparent;
}
.q-options li.right { border-color: var(--success); background: var(--success-soft, #ecfaf4); }
.qo-letter { font-weight: 700; color: var(--sub); flex-shrink: 0; }
.q-options li.right .qo-letter { color: var(--success); }
.q-ops { display: flex; align-items: center; gap: 6px; flex-shrink: 0; padding-top: 1px; }
.score-input { width: 70px; text-align: right; }
.add-section { border-style: dashed; }
.stat-bar { display: flex; align-items: center; justify-content: space-between; position: sticky; bottom: 0; padding: 12px 16px; }
.stats { display: flex; gap: 16px; font-size: 13px; color: var(--sub); }
.stats b { color: var(--brand-deep); font-size: 15px; }

.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.k-chip { border: 1.5px solid var(--border); border-radius: 999px; background: #fff; color: var(--ink-2); font-size: 12.5px; padding: 4px 12px; }
.k-chip.on { border-color: var(--brand); background: var(--brand-soft); color: var(--brand-deep); font-weight: 600; }

.dyn-list { display: flex; flex-direction: column; gap: 0; }
.dyn-row { display: flex; flex-direction: column; gap: 3px; padding: 10px 0; border-bottom: 1px dashed var(--border); }
.dyn-actor { font-size: 13px; font-weight: 600; color: var(--ink-2); }
.dyn-action { font-size: 12.5px; color: var(--sub); }
.dyn-time { font-size: 11.5px; color: var(--sub); }
</style>
