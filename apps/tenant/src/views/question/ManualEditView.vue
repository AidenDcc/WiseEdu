<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AppIcon, showToast, ApiError } from '@aiteach/shared'
import type { OrgCategory } from '@aiteach/shared'
import AppModal from '@/components/ui/AppModal.vue'
import { fetchCategories, fetchQuestions, saveQuestion } from '@/api/org'
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

let lastType = '单选题'
function onTypeChange() {
  if (form.stem.trim() || form.options.some((opt) => opt.trim())) {
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
    if (!form.stem.trim()) errors.stem = '题干不能为空'
    if (isChoice.value) {
      if (form.options.some((opt) => !opt.trim())) errors.options = '每项选项必填'
      if (form.answers.length === 0 || (form.type === '多选题' && form.answers.length < 2)) {
        errors.options = errors.options || (form.type === '多选题' ? '多选题须标记 ≥2 个正确答案' : '请设置正确答案')
      }
    }
    if (form.type === '填空题' && form.fillAnswers.some((row) => !row.value.trim())) errors.answer = '每空答案必填'
    if (form.type === '解答题' && !form.essayAnswer.trim()) errors.answer = '解答题答案必填'
    if (!form.analysis.trim() && !window.confirm('解析为空（选填），提交审核时建议补充解析，确认继续提交？')) return false
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
      options: isChoice.value ? form.options.filter((opt) => opt.trim()) : [],
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
      <div class="prop-grid">
        <div class="f-field compact">
          <label class="f-label">学科<span class="req">*</span></label>
          <select v-model="form.subject" class="f-select">
            <option v-for="s in withCurrent(subjects, form.subject)" :key="s" :value="s">{{ optionLabel(subjects, s) }}</option>
          </select>
        </div>
        <div class="f-field compact">
          <label class="f-label">年级<span class="req">*</span></label>
          <select v-model="form.grade" class="f-select">
            <option v-for="g in withCurrent(grades, form.grade)" :key="g" :value="g">{{ optionLabel(grades, g) }}</option>
          </select>
        </div>
        <div class="f-field compact">
          <label class="f-label">题型<span class="req">*</span></label>
          <select v-model="form.type" class="f-select" @change="onTypeChange">
            <option v-for="t in withCurrent(questionTypes, form.type)" :key="t" :value="t">{{ optionLabel(questionTypes, t) }}</option>
          </select>
        </div>
        <div class="f-field compact">
          <label class="f-label">难度<span class="req">*</span></label>
          <select v-model="form.difficulty" class="f-select">
            <option v-for="d in withCurrent(difficulties, form.difficulty)" :key="d" :value="d">{{ optionLabel(difficulties, d) }}</option>
          </select>
        </div>
        <div class="f-field compact">
          <label class="f-label">学期</label>
          <select v-model="form.term" class="f-select">
            <option v-for="t in TERMS" :key="t" :value="t">{{ t }}</option>
          </select>
        </div>
        <div class="f-field compact">
          <label class="f-label">考试类型</label>
          <select v-model="form.examType" class="f-select">
            <option value="">不指定</option>
            <option v-for="e in examTypes" :key="e" :value="e">{{ e }}</option>
          </select>
        </div>
        <div class="f-field compact">
          <label class="f-label">教材版本</label>
          <select v-model="form.textbook" class="f-select">
            <option value="">不绑定</option>
            <option v-for="v in versionOptions" :key="v" :value="v">{{ v }}</option>
          </select>
        </div>
        <div class="f-field compact">
          <label class="f-label">所属库 / 分类</label>
          <div class="lib-row">
            <select v-model="form.library" class="f-select" style="width: 110px">
              <option value="personal">个人题库</option>
              <option value="org">机构公共</option>
            </select>
            <select v-model="form.categoryId" class="f-select" style="flex: 1">
              <option :value="null">默认分类</option>
              <option v-for="c in categories.filter((row) => row.parentId !== null)" :key="c.id" :value="c.id">
                {{ c.name }}
              </option>
            </select>
          </div>
        </div>
      </div>
      <div class="f-field" style="margin-bottom: 0">
        <label class="f-label">知识点（随学科加载，最多 5 个）<span class="req">*</span></label>
        <div class="knowledge-chips">
          <button
            v-for="k in knowledgeOptions"
            :key="k"
            class="k-chip"
            :class="{ on: form.knowledge.includes(k), off: orphanKnowledge.includes(k) }"
            type="button"
            @click="toggleKnowledge(k)"
          >
            {{ k }}
          </button>
        </div>
        <p v-if="errors.knowledge" class="f-err">{{ errors.knowledge }}</p>
      </div>
    </div>

    <!-- 编辑器主体 -->
    <div class="panel editor-panel">
      <div class="f-field">
        <label class="f-label">题干<span class="req">*</span>（富文本 + 公式，支持 LaTeX 源码双向）</label>
        <textarea
          v-model="form.stem"
          class="f-textarea"
          rows="4"
          placeholder="如：已知二次函数 f(x)=x²-2x-3…（支持插入公式 / 图片 / SVG）"
          @input="dirty = true"
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
            <input v-model="form.options[i]" class="f-input" :placeholder="`选项 ${'ABCDEF'[i]} 内容`" @input="dirty = true" />
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
          <textarea v-model="form.essayAnswer" class="f-textarea" rows="3" placeholder="输入解答过程…" />
          <p v-if="errors.answer" class="f-err">{{ errors.answer }}</p>
        </div>
      </template>

      <div class="f-field">
        <label class="f-label">解析（选填，提交审核时为空将给出警告）</label>
        <textarea v-model="form.analysis" class="f-textarea" rows="3" placeholder="输入解析…" />
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
        <p class="pv-stem">{{ form.stem || '（题干预览）' }}</p>
        <ul v-if="isChoice" class="option-list">
          <li v-for="(opt, i) in form.options" :key="i" :class="{ right: form.answers.includes(i) }">
            {{ 'ABCDEF'[i] }}. {{ opt }}
          </li>
        </ul>
        <div v-if="answerText" class="pv-answer">
          <span class="tag tag-green">答案</span>{{ answerText }}
        </div>
        <p v-if="form.analysis" class="pv-analysis"><b>解析：</b>{{ form.analysis }}</p>
      </div>
    </AppModal>
  </div>
</template>

<style scoped>
.edit-layout { display: flex; flex-direction: column; gap: 14px; }

.prop-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 0 14px; }
.f-field.compact { margin-bottom: 14px; }
.lib-row { display: flex; gap: 8px; }

.knowledge-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.k-chip {
  border: 1.5px solid var(--border);
  border-radius: 999px;
  background: #fff;
  color: var(--ink-2);
  font-size: 12.5px;
  padding: 4px 12px;
  transition: all 0.15s;
}
.k-chip.on { border-color: var(--brand); background: var(--brand-soft); color: var(--brand-deep); font-weight: 600; }
/* 已选但已不属于当前学科知识点池的项：虚线提示，仍可点击取消 */
.k-chip.off { border-style: dashed; opacity: 0.7; }

.editor-panel { padding: 18px 20px; }

.opt-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
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
