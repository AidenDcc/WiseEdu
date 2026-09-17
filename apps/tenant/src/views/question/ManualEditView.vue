<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AppIcon, RichTextViewer, showToast, ApiError, hasImage, toPlainText } from '@aiteach/shared'
import type { OrgCategory } from '@aiteach/shared'
import AppModal from '@/components/ui/AppModal.vue'
import RichTextEditor from '@/components/ui/RichTextEditor.vue'
import { fetchCategories, fetchQuestions, saveQuestion } from '@/api/org'
import { checkQuestionByAi } from '@/api/ai-check'
import type { AiCheckReport } from '@/api/ai-check'
import { alignKnowledgeToPool } from '@/api/ai-photo'
import { useBaseData } from '@/composables/useBaseData'
import { useKnowledgePool } from '@/composables/useKnowledgePool'

const route = useRoute()
const router = useRouter()

const { subjects, grades, questionTypes, difficulties, examTypes, versionsFor, ensure, pick, withCurrent, optionLabel } = useBaseData()

/** 学期保留短名，与题目 question.term 的存储形式一致（字典里的 term 是「2025-2026 上学期」全名） */
const TERMS = ['上学期', '下学期']

/** 判断题固定两项 */
const isChoice = computed(() => form.type === '单选题' || form.type === '多选题' || form.type === '判断题')

/* ===== 表单（FR-TM-008 ~ 012） ===== */
const form = reactive({
  subject: '数学',
  grade: '高一',
  type: '单选题',
  difficulty: '中等',
  knowledge: [] as string[],
  textbook: '',
  term: '上学期',
  examType: '',
  sourceRemark: '',
  stem: '',
  options: ['', '', '', ''],
  answers: [] as number[],
  fillAnswers: [{ value: '', equivalents: '' }],
  essayAnswer: '',
  analysis: '',
  library: 'personal' as 'personal' | 'org' | 'wrong',
  categoryId: null as number | null,
})
const errors = reactive<Record<string, string>>({})
const saving = ref(false)
const dirty = ref(false)

const categories = ref<OrgCategory[]>([])

/* 知识点池按当前「年级 / 学科 / 教材版本」实时取，替代原先写死的数学知识点 */
const { pool: knowledgePool } = useKnowledgePool(() => ({
  grade: form.grade,
  subject: form.subject,
  version: form.textbook,
}))
/** 已选但不在当前池中的知识点（如切换学科前选的）保留可选，避免被静默清空 */
const orphanKnowledge = computed(() => form.knowledge.filter((k) => !knowledgePool.value.includes(k)))
const knowledgeOptions = computed(() => [...knowledgePool.value, ...orphanKnowledge.value])
/** 教材版本随年级 + 学科联动；已绑定但不在新列表中的旧值仍保留 */
const versionOptions = computed(() => withCurrent(versionsFor(form.grade, form.subject), form.textbook))

/** 年级或学科变化后，原教材版本可能已不适用 —— 清空，避免存出无效组合 */
watch([() => form.grade, () => form.subject], () => {
  if (form.textbook && !versionsFor(form.grade, form.subject).includes(form.textbook)) form.textbook = ''
})

async function load() {
  await ensure()
  ;[categories.value] = await Promise.all([fetchCategories()])
  const id = Number(route.query.id ?? 0)
  if (!id) {
    /* 新建：默认值归一为当前启用字典的首项，不写死 '数学' / '高一' */
    form.subject = pick(subjects.value, form.subject)
    form.grade = pick(grades.value, form.grade)
    form.type = pick(questionTypes.value, form.type)
    form.difficulty = pick(difficulties.value, form.difficulty)
    form.examType = pick(examTypes.value, form.examType)
  }
  if (!id && route.query.from === 'ai') {
    // AI 生成结果「编辑后采纳」：读取暂存草稿
    const raw = sessionStorage.getItem('aiteach.ai-draft')
    if (raw) {
      sessionStorage.removeItem('aiteach.ai-draft')
      const draft = JSON.parse(raw) as { stem: string; options: string[]; answer: string; analysis: string; knowledge: string[]; difficulty: string; subject: string; grade: string; type?: string }
      Object.assign(form, {
        subject: draft.subject,
        grade: draft.grade,
        difficulty: draft.difficulty,
        knowledge: [...draft.knowledge],
        stem: draft.stem,
        analysis: draft.analysis,
        sourceRemark: 'AI 智能出题',
      })
      if (draft.options.length > 0) {
        form.type = draft.options.length === 2 && draft.options[0] === '正确' ? '判断题' : draft.answer.length > 1 ? '多选题' : '单选题'
        form.options = [...draft.options]
        form.answers = draft.answer.split('').map((ch) => 'ABCDEF'.indexOf(ch)).filter((i) => i >= 0)
      } else {
        form.type = draft.type && questionTypes.value.includes(draft.type) ? draft.type : '解答题'
        if (form.type === '填空题') form.fillAnswers = [{ value: draft.answer, equivalents: '' }]
        else form.essayAnswer = draft.answer
      }
      lastType = form.type
    }
  }
  if (id) {
    const all = await fetchQuestions()
    const source = all.find((row) => row.id === id)
    if (source) {
      Object.assign(form, {
        subject: source.subject,
        grade: source.grade,
        type: source.type,
        difficulty: source.difficulty,
        knowledge: [...source.knowledge],
        textbook: source.textbook ?? '',
        term: source.term ?? '上学期',
        examType: source.examType ?? '',
        sourceRemark: source.sourceRemark ?? '',
        stem: source.stem,
        library: source.library,
        categoryId: source.categoryId,
        analysis: source.analysis,
      })
      lastType = source.type
      if (source.options.length > 0) {
        form.options = [...source.options]
        form.answers = source.answer.split('').map((ch) => 'ABCDEF'.indexOf(ch)).filter((i) => i >= 0)
      } else if (source.type === '填空题') {
        form.fillAnswers = [{ value: source.answer, equivalents: '' }]
      } else {
        form.essayAnswer = source.answer
      }
    }
  }
}

/** 富文本下 `<p></p>` 的 trim() 非空，判空必须看纯文本；只含图片的内容也算有值 */
function hasContent(value: string): boolean {
  return Boolean(toPlainText(value).trim()) || hasImage(value)
}

let lastType = '单选题'
function onTypeChange() {
  if (hasContent(form.stem) || form.options.some((opt) => hasContent(opt))) {
    if (!window.confirm('切换题型将清空选项结构，确认切换？')) {
      form.type = lastType
      return
    }
  }
  lastType = form.type
  form.answers = []
  form.options = form.type === '判断题' ? ['正确', '错误'] : ['', '', '', '']
  form.fillAnswers = [{ value: '', equivalents: '' }]
}

/** chip 版题型切换：先落值再走上面那套确认逻辑。
    点当前已选中的题型直接返回 —— 下拉的 change 只在真的换值时触发，而 chip 的 click 每次都会触发。 */
function pickType(type: string) {
  if (type === form.type) return
  form.type = type
  onTypeChange()
}

function addOption() {
  if (form.options.length >= 6) {
    showToast('选项最多 6 个', 'error')
    return
  }
  form.options.push('')
}

function removeOption(index: number) {
  if (form.options.length <= 2) {
    showToast('选项至少 2 个', 'error')
    return
  }
  form.options.splice(index, 1)
  form.answers = form.answers.filter((i) => i !== index).map((i) => (i > index ? i - 1 : i))
}

function toggleAnswer(index: number) {
  if (form.type === '单选题' || form.type === '判断题') {
    form.answers = [index]
  } else {
    const pos = form.answers.indexOf(index)
    if (pos >= 0) form.answers.splice(pos, 1)
    else form.answers.push(index)
  }
}

function toggleKnowledge(item: string) {
  const pos = form.knowledge.indexOf(item)
  if (pos >= 0) form.knowledge.splice(pos, 1)
  else {
    if (form.knowledge.length >= 5) {
      showToast('知识点最多 5 个', 'error')
      return
    }
    form.knowledge.push(item)
  }
}

const answerText = computed(() => {
  if (isChoice.value) {
    if (form.answers.length === 0) return ''
    return [...form.answers].sort().map((i) => 'ABCDEF'[i]).join('')
  }
  if (form.type === '填空题') return form.fillAnswers.map((row) => row.value).join('｜')
  return form.essayAnswer
})

/** 校验：draft=true 仅校验必填属性；draft=false 全量校验（FR-TM-012） */
function validate(full: boolean): boolean {
  Object.keys(errors).forEach((key) => delete errors[key])
  if (!form.knowledge.length) errors.knowledge = '请选择知识点（最多 5 个）'
  if (full) {
    if (!hasContent(form.stem)) errors.stem = '题干不能为空'
    if (isChoice.value) {
      if (form.options.some((opt) => !hasContent(opt))) errors.options = '每项选项必填'
      if (form.answers.length === 0 || (form.type === '多选题' && form.answers.length < 2)) {
        errors.options = errors.options || (form.type === '多选题' ? '多选题须标记 ≥2 个正确答案' : '请设置正确答案')
      }
    }
    if (form.type === '填空题' && form.fillAnswers.some((row) => !row.value.trim())) errors.answer = '每空答案必填'
    if (form.type === '解答题' && !hasContent(form.essayAnswer)) errors.answer = '解答题答案必填'
    if (!hasContent(form.analysis) && !window.confirm('解析为空（选填），提交审核时建议补充解析，确认继续提交？')) return false
  }
  if (form.sourceRemark.length > 100) errors.sourceRemark = '来源备注 ≤100 字'
  return Object.keys(errors).length === 0
}

async function save(submit: boolean) {
  if (!validate(submit)) {
    showToast('请按红字提示修正后重试', 'error')
    return
  }
  saving.value = true
  try {
    await saveQuestion({
      id: Number(route.query.id) || undefined,
      stem: form.stem,
      subject: form.subject,
      grade: form.grade,
      type: form.type,
      difficulty: form.difficulty,
      knowledge: form.knowledge,
      textbook: form.textbook || undefined,
      term: form.term,
      examType: form.examType || undefined,
      sourceRemark: form.sourceRemark || undefined,
      options: isChoice.value ? form.options.filter((opt) => hasContent(opt)) : [],
      answer: answerText.value,
      analysis: form.analysis,
      library: form.library,
      categoryId: form.categoryId ?? categories.value.find((row) => row.parentId != null)?.id,
      submit,
    })
    showToast(
      submit ? '已提交：多智能体校验中，完成后推送终审待办' : '草稿已保存',
      'success',
    )
    router.push('/question/bank')
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : '保存失败', 'error')
  } finally {
    saving.value = false
  }
}

/* ===== AI 检测（质检 + 缺失答案/解析补充，结论可回写表单） ===== */
const checkOpen = ref(false)
const checkPhase = ref<'running' | 'done' | 'failed'>('running')
const checkProgress = ref(0)
const checkFailReason = ref('')
const checkReport = ref<AiCheckReport | null>(null)
let checkTimer = 0

const OVERALL_TEXT = { pass: '检测通过', warn: '建议关注', fail: '需修正' } as const
const LEVEL_TEXT = { ok: '正常', warn: '提示', error: '错误' } as const

function checkInput() {
  return {
    subject: form.subject,
    grade: form.grade,
    type: form.type,
    difficulty: form.difficulty,
    knowledge: [...form.knowledge],
    stem: form.stem,
    options: isChoice.value ? form.options.filter((opt) => hasContent(opt)) : [],
    answer: answerText.value,
    analysis: form.analysis,
  }
}

async function runCheck() {
  checkOpen.value = true
  checkPhase.value = 'running'
  checkProgress.value = 0
  checkReport.value = null
  checkFailReason.value = ''
  /* 与 AI 出题页同一套假进度：接口未返回前先走到 97%，完成后补满 */
  window.clearInterval(checkTimer)
  checkTimer = window.setInterval(() => {
    checkProgress.value = Math.min(97, checkProgress.value + 5 + Math.random() * 6)
  }, 260)
  try {
    checkReport.value = await checkQuestionByAi(checkInput())
    checkPhase.value = 'done'
  } catch (error) {
    checkFailReason.value = error instanceof Error ? error.message : '检测失败'
    checkPhase.value = 'failed'
  } finally {
    window.clearInterval(checkTimer)
    checkProgress.value = 100
  }
}

function closeCheck() {
  window.clearInterval(checkTimer)
  checkOpen.value = false
}

/** AI 建议与当前表单是否有实质差异（纯文本比较，忽略 HTML 标签差异） */
function fieldDiffers(current: string, next: string): boolean {
  return toPlainText(current).trim() !== toPlainText(next).trim()
}

const corrected = computed(() => checkReport.value?.corrected)

/** 逐字段修正建议（与当前值有差异才列出）；answer 仅当非选项结构差异时单列 */
const corrections = computed(() => {
  const c = corrected.value
  if (!c) return [] as Array<{ field: string; label: string; value: string }>
  const rows: Array<{ field: string; label: string; value: string }> = []
  if (fieldDiffers(form.stem, c.stem)) rows.push({ field: 'stem', label: '题干', value: c.stem })
  if (isChoice.value && c.options.length) {
    const cur = form.options.map((opt) => toPlainText(opt).trim()).join('｜')
    const next = c.options.map((opt) => toPlainText(opt).trim()).join('｜')
    if (cur !== next) rows.push({ field: 'options', label: '选项与正确项', value: c.options.join('<br>') })
  }
  if (fieldDiffers(answerText.value, c.answer)) rows.push({ field: 'answer', label: '答案', value: c.answer })
  if (fieldDiffers(form.analysis, c.analysis)) rows.push({ field: 'analysis', label: '解析', value: c.analysis })
  return rows
})

/** 基本信息修正建议（学科/年级/难度/知识点与表单不一致时） */
const metaCorrection = computed(() => {
  const c = corrected.value
  if (!c) return null
  const parts: string[] = []
  if (c.subject && c.subject !== form.subject && subjects.value.includes(c.subject)) parts.push(`学科 ${form.subject} → ${c.subject}`)
  if (c.grade && c.grade !== form.grade && grades.value.includes(c.grade)) parts.push(`年级 ${form.grade} → ${c.grade}`)
  if (c.difficulty && c.difficulty !== form.difficulty && difficulties.value.includes(c.difficulty)) {
    parts.push(`难度 ${form.difficulty} → ${c.difficulty}`)
  }
  const aligned = (c.knowledge ?? [])
    .map((name) => alignKnowledgeToPool(name, knowledgePool.value))
    .filter((name) => name && !form.knowledge.includes(name))
  if (aligned.length) parts.push(`知识点建议：${aligned.join('、')}`)
  return parts.length ? { text: parts.join('；'), knowledge: aligned } : null
})

function applyCorrection(field: string) {
  const c = corrected.value
  if (!c) return
  if (field === 'stem') form.stem = c.stem
  else if (field === 'options') {
    form.options = [...c.options]
    form.answers = c.answer
      .toUpperCase()
      .replace(/[^A-F]/g, '')
      .split('')
      .map((ch) => 'ABCDEF'.indexOf(ch))
      .filter((i) => i >= 0)
  } else if (field === 'answer') {
    if (isChoice.value) {
      form.answers = c.answer
        .toUpperCase()
        .replace(/[^A-F]/g, '')
        .split('')
        .map((ch) => 'ABCDEF'.indexOf(ch))
        .filter((i) => i >= 0)
    } else if (form.type === '填空题') {
      form.fillAnswers = c.answer.split('｜').map((value) => ({ value: value.trim(), equivalents: '' }))
    } else {
      form.essayAnswer = c.answer
    }
  } else if (field === 'analysis') {
    form.analysis = c.analysis
  }
  dirty.value = true
  showToast('已回写到表单', 'success')
}

function applyMetaCorrection() {
  const c = corrected.value
  const meta = metaCorrection.value
  if (!c || !meta) return
  if (c.subject && subjects.value.includes(c.subject)) form.subject = c.subject
  if (c.grade && grades.value.includes(c.grade)) form.grade = c.grade
  if (c.difficulty && difficulties.value.includes(c.difficulty)) form.difficulty = c.difficulty
  if (meta.knowledge.length) {
    form.knowledge = [...new Set([...form.knowledge, ...meta.knowledge])].slice(0, 5)
  }
  dirty.value = true
  showToast('基本信息已回写', 'success')
}

function applyAllCorrections() {
  corrections.value.forEach((row) => applyCorrection(row.field))
  applyMetaCorrection()
}

/* ===== 预览 ===== */
const previewOpen = ref(false)

function onCancel() {
  if (dirty.value && !window.confirm('有未保存的改动，确认放弃？')) return
  router.push('/question/bank')
}

onMounted(load)
</script>

<template>
  <div class="edit-layout">
    <!-- 属性条（FR-TM-008） -->
    <div class="panel prop-bar">
      <!-- 每个属性一行：标签左、选项右平铺。候选项都不多（最多 12 个），下拉是多余的一次点击，
           且看不到还有什么可选。顺序一律取数据源现成顺序（字典 sort / 教材矩阵 / TERMS），不重排。 -->
      <div class="prop-row">
        <span class="prop-label">学科<span class="req">*</span></span>
        <div class="prop-opts">
          <button
            v-for="s in withCurrent(subjects, form.subject)"
            :key="s"
            class="p-chip"
            :class="{ on: form.subject === s }"
            type="button"
            @click="form.subject = s"
          >
            {{ optionLabel(subjects, s) }}
          </button>
        </div>
      </div>

      <div class="prop-row">
        <span class="prop-label">年级<span class="req">*</span></span>
        <div class="prop-opts">
          <button
            v-for="g in withCurrent(grades, form.grade)"
            :key="g"
            class="p-chip"
            :class="{ on: form.grade === g }"
            type="button"
            @click="form.grade = g"
          >
            {{ optionLabel(grades, g) }}
          </button>
        </div>
      </div>

      <div class="prop-row">
        <span class="prop-label">题型<span class="req">*</span></span>
        <div class="prop-opts">
          <button
            v-for="t in withCurrent(questionTypes, form.type)"
            :key="t"
            class="p-chip"
            :class="{ on: form.type === t }"
            type="button"
            @click="pickType(t)"
          >
            {{ optionLabel(questionTypes, t) }}
          </button>
        </div>
      </div>

      <div class="prop-row">
        <span class="prop-label">难度<span class="req">*</span></span>
        <div class="prop-opts">
          <button
            v-for="d in withCurrent(difficulties, form.difficulty)"
            :key="d"
            class="p-chip"
            :class="{ on: form.difficulty === d }"
            type="button"
            @click="form.difficulty = d"
          >
            {{ optionLabel(difficulties, d) }}
          </button>
        </div>
      </div>

      <div class="prop-row">
        <span class="prop-label">学期</span>
        <div class="prop-opts">
          <button
            v-for="t in TERMS"
            :key="t"
            class="p-chip"
            :class="{ on: form.term === t }"
            type="button"
            @click="form.term = t"
          >
            {{ t }}
          </button>
        </div>
      </div>

      <div class="prop-row">
        <span class="prop-label">考试类型</span>
        <div class="prop-opts">
          <button class="p-chip" :class="{ on: form.examType === '' }" type="button" @click="form.examType = ''">
            不指定
          </button>
          <button
            v-for="e in examTypes"
            :key="e"
            class="p-chip"
            :class="{ on: form.examType === e }"
            type="button"
            @click="form.examType = e"
          >
            {{ e }}
          </button>
        </div>
      </div>

      <div class="prop-row">
        <span class="prop-label">教材版本</span>
        <div class="prop-opts">
          <button class="p-chip" :class="{ on: form.textbook === '' }" type="button" @click="form.textbook = ''">
            不绑定
          </button>
          <button
            v-for="v in versionOptions"
            :key="v"
            class="p-chip"
            :class="{ on: form.textbook === v }"
            type="button"
            @click="form.textbook = v"
          >
            {{ v }}
          </button>
        </div>
      </div>

      <!-- 这一行留着下拉：它是「库 → 分类」的两级结构选择，不是一列可平铺的枚举值 -->
      <div class="prop-row">
        <span class="prop-label">所属库</span>
        <div class="prop-opts">
          <select v-model="form.library" class="f-select" style="width: 130px">
            <option value="personal">个人题库</option>
            <option value="org">机构公共</option>
          </select>
          <select v-model="form.categoryId" class="f-select" style="width: 220px">
            <option :value="null">默认分类</option>
            <option v-for="c in categories.filter((row) => row.parentId !== null)" :key="c.id" :value="c.id">
              {{ c.name }}
            </option>
          </select>
        </div>
      </div>

      <div class="prop-row">
        <span class="prop-label">知识点<span class="req">*</span></span>
        <div class="prop-opts">
          <button
            v-for="k in knowledgeOptions"
            :key="k"
            class="p-chip"
            :class="{ on: form.knowledge.includes(k), off: orphanKnowledge.includes(k) }"
            type="button"
            @click="toggleKnowledge(k)"
          >
            {{ k }}
          </button>
          <span class="prop-hint">随学科 / 年级 / 教材版本加载，最多 5 个</span>
        </div>
        <p v-if="errors.knowledge" class="f-err">{{ errors.knowledge }}</p>
      </div>
    </div>

    <!-- 编辑器主体 -->
    <div class="panel editor-panel">
      <div class="f-field">
        <label class="f-label">题干<span class="req">*</span>（富文本 + 公式，支持 LaTeX 源码双向）</label>
        <RichTextEditor
          v-model="form.stem"
          :subject="form.subject"
          :min-height="150"
          placeholder="如：已知二次函数 f(x)=x²-2x-3…（工具栏可插入公式、图片，也支持粘贴 / 拖入图片）"
          @change="dirty = true"
        />
        <p v-if="errors.stem" class="f-err">{{ errors.stem }}</p>
      </div>

      <!-- 选项区（FR-TM-010） -->
      <template v-if="isChoice">
        <div class="f-field">
          <label class="f-label">
            选项（{{ form.options.length }}/{{ form.type === '判断题' ? 2 : 6 }}）
            <span class="f-hint" style="display: inline; margin-left: 8px">点击左侧圆点标记正确答案</span>
          </label>
          <div v-for="(opt, i) in form.options" :key="i" class="opt-row">
            <button
              class="answer-dot"
              :class="{ on: form.answers.includes(i), multi: form.type === '多选题' }"
              type="button"
              :title="form.type === '多选题' ? '正确答案（≥2 个）' : '正确答案'"
              @click="toggleAnswer(i)"
            >
              {{ 'ABCDEF'[i] }}
            </button>
            <RichTextEditor
              v-model="form.options[i]"
              class="opt-editor"
              compact
              :subject="form.subject"
              :min-height="40"
              :placeholder="`选项 ${'ABCDEF'[i]} 内容`"
              @change="dirty = true"
            />
            <button
              v-if="form.type !== '判断题'"
              class="mini-btn danger"
              type="button"
              @click="removeOption(i)"
            >
              删除
            </button>
          </div>
          <button v-if="form.type !== '判断题'" class="btn btn-ghost btn-sm" type="button" @click="addOption">
            <AppIcon name="plus" :size="14" /> 添加选项
          </button>
          <p v-if="errors.options" class="f-err">{{ errors.options }}</p>
        </div>
      </template>

      <!-- 填空答案区 -->
      <template v-else-if="form.type === '填空题'">
        <div class="f-field">
          <label class="f-label">填空答案（每空独立，支持等价写法）<span class="req">*</span></label>
          <div v-for="(blank, bi) in form.fillAnswers" :key="bi" class="blank-row">
            <span class="blank-no">第 {{ bi + 1 }} 空</span>
            <input v-model="blank.value" class="f-input" placeholder="答案" />
            <input v-model="blank.equivalents" class="f-input" placeholder="等价答案（逗号分隔，选填）" />
            <button
              v-if="form.fillAnswers.length > 1"
              class="mini-btn danger"
              type="button"
              @click="form.fillAnswers.splice(bi, 1)"
            >
              删除
            </button>
          </div>
          <button class="btn btn-ghost btn-sm" type="button" @click="form.fillAnswers.push({ value: '', equivalents: '' })">
            <AppIcon name="plus" :size="14" /> 添加一空
          </button>
          <p v-if="errors.answer" class="f-err">{{ errors.answer }}</p>
        </div>
      </template>

      <!-- 解答题答案 -->
      <template v-else>
        <div class="f-field">
          <label class="f-label">参考答案（富文本 + 公式）<span class="req">*</span></label>
          <RichTextEditor
            v-model="form.essayAnswer"
            :subject="form.subject"
            :min-height="110"
            placeholder="输入解答过程…（可插入公式与图片）"
            @change="dirty = true"
          />
          <p v-if="errors.answer" class="f-err">{{ errors.answer }}</p>
        </div>
      </template>

      <div class="f-field">
        <label class="f-label">解析（选填，提交审核时为空将给出警告）</label>
        <RichTextEditor
          v-model="form.analysis"
          :subject="form.subject"
          :min-height="110"
          placeholder="输入解析…（可插入公式与图片）"
          @change="dirty = true"
        />
      </div>

      <div class="f-field">
        <label class="f-label">来源备注（选填 ≤100 字）</label>
        <input v-model="form.sourceRemark" class="f-input" placeholder="如：改编自 2025 期中第 12 题" />
        <p v-if="errors.sourceRemark" class="f-err">{{ errors.sourceRemark }}</p>
      </div>
    </div>

    <!-- 底部操作栏 -->
    <div class="panel action-bar">
      <button class="btn btn-ghost" @click="onCancel">取消</button>
      <div style="display: flex; gap: 10px; margin-left: auto">
        <button class="btn btn-ghost" :disabled="saving" @click="runCheck">
          <AppIcon name="sparkles" :size="15" /> AI 检测
        </button>
        <button class="btn btn-ghost" @click="previewOpen = true">
          <AppIcon name="search" :size="15" /> 预览
        </button>
        <button class="btn btn-ghost" :disabled="saving" @click="save(false)">
          {{ saving ? '保存中…' : '保存草稿' }}
        </button>
        <button class="btn btn-primary" :disabled="saving" @click="save(true)">
          保存并提交审核
        </button>
      </div>
    </div>

    <!-- 学生视角预览 -->
    <AppModal v-if="previewOpen" title="学生视角预览" :width="620" @close="previewOpen = false">
      <div class="preview-card">
        <div class="pv-meta">
          <span class="tag tag-blue">{{ form.subject }} · {{ form.grade }}</span>
          <span class="tag tag-gray">{{ form.type }}</span>
          <span class="tag tag-gray">{{ form.difficulty }}</span>
        </div>
        <RichTextViewer class="pv-stem" :content="form.stem" empty="（题干预览）" />
        <ul v-if="isChoice" class="option-list">
          <li v-for="(opt, i) in form.options" :key="i" :class="{ right: form.answers.includes(i) }">
            {{ 'ABCDEF'[i] }}. <RichTextViewer :content="opt" tag="span" />
          </li>
        </ul>
        <div v-if="answerText" class="pv-answer">
          <span class="tag tag-green">答案</span>{{ answerText }}
        </div>
        <p v-if="hasContent(form.analysis)" class="pv-analysis"><b>解析：</b><RichTextViewer :content="form.analysis" tag="span" /></p>
      </div>
    </AppModal>
    <!-- AI 检测：进度 + 审查结论 + 修正回写 -->
    <AppModal v-if="checkOpen" title="AI 检测" :width="660" @close="closeCheck">
      <!-- 进度 -->
      <div v-if="checkPhase === 'running'" class="check-running">
        <div class="run-ring"><AppIcon name="sparkles" :size="30" /></div>
        <p class="run-title">AI 正在检测这道题…</p>
        <div class="run-steps">
          <span>匹配基本信息</span>
          <span>审查题干与选项</span>
          <span>验算答案与解析</span>
        </div>
        <div class="progress-track"><div class="progress-fill" :style="{ width: `${checkProgress}%` }" /></div>
        <p class="f-hint">{{ checkProgress < 100 ? '正在调用大模型…' : '整理检测结论…' }}</p>
      </div>

      <!-- 失败 -->
      <div v-else-if="checkPhase === 'failed'" class="check-failed">
        <AppIcon name="warning" :size="30" />
        <p>{{ checkFailReason }}</p>
        <button class="btn btn-ghost btn-sm" @click="runCheck">重试</button>
      </div>

      <!-- 结论 + 修正回写 -->
      <template v-else-if="checkReport">
        <div class="check-head">
          <span class="tag" :class="checkReport.overall === 'pass' ? 'tag-green' : checkReport.overall === 'warn' ? 'tag-blue' : 'tag-red'">
            {{ OVERALL_TEXT[checkReport.overall] }}
          </span>
          <span class="tag" :class="checkReport.engine === 'deepseek' ? 'tag-green' : 'tag-gray'">
            {{ checkReport.engine === 'deepseek' ? '真实 AI' : '本地演示' }}
          </span>
          <span v-if="checkReport.tokens" class="f-hint" style="margin-left: auto">{{ checkReport.tokens }} tokens</span>
        </div>
        <ul class="check-items">
          <li v-for="(item, i) in checkReport.items" :key="i" :class="`lv-${item.level}`">
            <div class="ci-bar">
              <b>{{ item.aspect }}</b>
              <span class="lv-tag">{{ LEVEL_TEXT[item.level] }}</span>
            </div>
            <p>{{ item.message }}</p>
          </li>
        </ul>

        <template v-if="corrections.length || metaCorrection">
          <div class="corr-title">AI 修正建议（点击「采纳」回写到表单）</div>
          <div v-if="metaCorrection" class="corr-row">
            <div class="corr-label">基本信息</div>
            <div class="corr-value">{{ metaCorrection.text }}</div>
            <button class="mini-btn" type="button" @click="applyMetaCorrection">采纳</button>
          </div>
          <div v-for="row in corrections" :key="row.field" class="corr-row">
            <div class="corr-label">{{ row.label }}</div>
            <div class="corr-value"><RichTextViewer :content="row.value" tag="span" /></div>
            <button class="mini-btn" type="button" @click="applyCorrection(row.field)">采纳</button>
          </div>
          <button class="btn btn-primary btn-sm" style="margin-top: 12px" @click="applyAllCorrections">
            全部采纳并回写
          </button>
        </template>
        <p v-else-if="!checkReport.corrected" class="f-hint" style="margin-top: 10px">AI 未返回可回写的修正版</p>
        <p v-else class="f-hint" style="margin-top: 10px">未发现需要修正的问题</p>
      </template>
      <template #footer>
        <button class="btn btn-ghost" @click="closeCheck">关闭</button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.edit-layout { display: flex; flex-direction: column; gap: 14px; }

/* 全局 .panel 只给了底色 / 边框 / 圆角，没有 padding；属性条此前因此贴着边框。
   补在这一处而不是改 .panel，免得波及全站其它面板。下留 4px：每个 .prop-row 自带 12px 下边距。 */
.prop-bar { padding: 16px 20px 4px; }
.prop-row { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 12px; }
/* 校验红字占满一行，落到 chip 下方而不是被挤在行内 */
.prop-row > .f-err { flex-basis: 100%; margin: 0; }
.prop-label {
  width: 82px;
  flex-shrink: 0;
  padding-top: 5px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-2);
}
.prop-opts { display: flex; flex-wrap: wrap; gap: 8px; flex: 1; min-width: 0; }
.prop-hint { align-self: center; font-size: 12px; color: var(--sub); }

/* 取值枚举统一用 chip：点一下就选中，且不必先展开才知道有什么可选。
   与其它页的 .k-chip 同造型（那是各页各自 scoped 复制的）。 */
.p-chip {
  border: 1.5px solid var(--border);
  border-radius: 999px;
  background: #fff;
  color: var(--ink-2);
  font-size: 12.5px;
  padding: 4px 12px;
  transition: all 0.15s;
}
.p-chip:hover { border-color: var(--brand); color: var(--brand-deep); }
.p-chip.on { border-color: var(--brand); background: var(--brand-soft); color: var(--brand-deep); font-weight: 600; }
/* 已选但已不属于当前知识点池的项：虚线提示，仍可点击取消 */
.p-chip.off { border-style: dashed; opacity: 0.7; }

.editor-panel { padding: 18px 20px; }

.opt-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
/* 选项编辑器占满剩余宽度（删除按钮与答案圆点保持原尺寸） */
.opt-editor { flex: 1; min-width: 0; }
.answer-dot {
  width: 30px;
  height: 34px;
  border-radius: 9px;
  border: 1.5px solid var(--border);
  background: #fff;
  color: var(--sub);
  font-weight: 700;
  flex-shrink: 0;
  transition: all 0.15s;
}
.answer-dot.on { border-color: var(--success); background: var(--success-soft); color: var(--success); }
.answer-dot.multi { border-radius: 999px; }

.blank-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.blank-no { font-size: 12.5px; color: var(--sub); width: 52px; flex-shrink: 0; }

.action-bar {
  display: flex;
  align-items: center;
  padding: 12px 18px;
  position: sticky;
  bottom: 0;
  z-index: 5;
}

.preview-card { background: #f7fafa; border-radius: 12px; padding: 16px 18px; }

/* ===== AI 检测弹窗 ===== */
.check-running { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 18px 0 8px; }
.run-ring {
  width: 64px; height: 64px; border-radius: 50%;
  background: var(--brand-soft); color: var(--brand-deep);
  display: flex; align-items: center; justify-content: center;
  animation: ring-pulse 1.6s ease-in-out infinite;
}
@keyframes ring-pulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(0.92); opacity: 0.75; } }
.run-title { font-size: 14.5px; font-weight: 600; color: var(--ink); }
.run-steps { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
.run-steps span {
  font-size: 12px; color: var(--sub); background: #f5f8f8;
  border-radius: 999px; padding: 3px 10px;
}
.progress-track { width: 100%; height: 7px; border-radius: 999px; background: var(--border); overflow: hidden; }
.progress-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--brand), var(--brand-deep)); transition: width 0.25s; }
.check-failed { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 16px 0; color: var(--ink-2); }

.check-head { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.check-items { list-style: none; margin: 0 0 4px; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.check-items li { border: 1px solid var(--border); border-left-width: 3px; border-radius: 8px; padding: 8px 12px; background: #fbfdfd; }
.check-items li.lv-ok { border-left-color: var(--success); }
.check-items li.lv-warn { border-left-color: #d97706; }
.check-items li.lv-error { border-left-color: var(--danger, #dc2626); }
.ci-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 3px; }
.ci-bar b { font-size: 13px; color: var(--ink); }
.lv-tag { font-size: 11px; border-radius: 999px; padding: 1px 8px; background: #f5f8f8; color: var(--sub); }
.lv-ok .lv-tag { color: var(--success); }
.lv-warn .lv-tag { color: #d97706; }
.lv-error .lv-tag { color: #dc2626; }
.check-items p { margin: 0; font-size: 12.5px; color: var(--ink-2); line-height: 1.6; }

.corr-title { font-size: 13px; font-weight: 700; color: var(--ink); margin: 14px 0 8px; }
.corr-row {
  display: flex; align-items: flex-start; gap: 10px;
  border: 1px dashed var(--border); border-radius: 8px;
  padding: 8px 10px; margin-bottom: 8px; background: #fff;
}
.corr-label { font-size: 12px; font-weight: 600; color: var(--brand-deep); width: 64px; flex-shrink: 0; padding-top: 2px; }
.corr-value { flex: 1; min-width: 0; font-size: 12.5px; color: var(--ink-2); line-height: 1.6; max-height: 110px; overflow-y: auto; }
.pv-meta { display: flex; gap: 8px; margin-bottom: 12px; }
.pv-stem { font-size: 14.5px; color: var(--ink); line-height: 1.8; margin-bottom: 12px; }
.option-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
.option-list li {
  background: #fff;
  border-radius: 8px;
  padding: 9px 12px;
  font-size: 13.5px;
  color: var(--ink-2);
}
.option-list li.right { border-left: 3px solid var(--success); color: var(--success); font-weight: 600; }
.pv-answer { display: flex; align-items: center; gap: 8px; font-size: 13.5px; font-weight: 600; color: var(--success); margin-bottom: 10px; }
.pv-analysis { font-size: 13px; color: var(--ink-2); line-height: 1.7; }
</style>
