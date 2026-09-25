<script setup lang="ts">
/**
 * 生成试卷弹窗：命名 / 学科 / 年级 / 时长 → 校验 → 保存（草稿或提交审核）。
 *
 * 两处关键做法：
 * 1. **校验逐条对齐协同组卷**（名称 2-50 字、至少 1 题、单题分值 0.5~100）。工作台与
 *    协同组卷是同一张试卷表的两个入口，校验口径不一致会让「这里能存、那里存不了」。
 * 2. **保存时深拷贝 sections**（与 `CollabView.vue` 同一处理）。`savePaper` 按**引用**
 *    存入 papers 列表，不拷贝的话保存后再改组卷车，会连带篡改已落库的试卷。
 *
 * 试卷预览直接复用 `PaperPreviewModal`（试卷库同一个弹窗），拿本地合成的 draftPaper 传入，
 * 零新增代码就得到 A4/8K 分版排版与答题卡——自己再排一遍版既费事又会与试卷库不一致。
 */
import { computed, ref, watch } from 'vue'
import { AppIcon, showToast } from '@aiteach/shared'
import type { OrgPaper } from '@aiteach/shared'
import AppModal from '@/components/ui/AppModal.vue'
import PaperPreviewModal from '@/components/paper/PaperPreviewModal.vue'
import { savePaper } from '@/api/org'
import { useBaseData } from '@/composables/useBaseData'
import { useComposeBasket } from '@/composables/useComposeBasket'
import { useComposeData } from '@/composables/useComposeData'
import { objectiveScoreOfSections, scoreOfSections } from '@/views/paper/paper-sections'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; saved: [paper: OrgPaper] }>()

const { questions, questionOf, refreshPapers } = useComposeData()
const { subjects, grades, ensure, pick } = useBaseData()
const basket = useComposeBasket()

const built = computed(() => basket.toSections(questions.value))
const totalScore = computed(() => scoreOfSections(built.value.sections))
const objectiveScore = computed(() => objectiveScoreOfSections(built.value.sections, questions.value))

const now = new Date()
const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

const form = ref({ name: '', subject: '', grade: '', duration: 90 })
const saving = ref(false)
const previewOpen = ref(false)

/** 打开弹窗时按组卷车内容给一份默认命名，省掉一次输入 */
function reset() {
  const grade = basket.entries.value.length ? questionOf(basket.entries.value[0].questionId)?.grade ?? '' : ''
  const subject = basket.entries.value.length ? questionOf(basket.entries.value[0].questionId)?.subject ?? '' : ''
  form.value = {
    name: `${grade}${subject}试卷 ${stamp}`.trim(),
    subject,
    grade,
    duration: 90,
  }
  void ensure().then(() => {
    /* 字典到位后再归一：'高一' 这类值若不在字典里会让下拉显示空白 */
    form.value.subject = pick(subjects.value, form.value.subject)
    form.value.grade = pick(grades.value, form.value.grade)
  })
}

/* 每次打开都重取默认名：组卷车在两轮生成之间可能已经变了，沿用旧名字会误导 */
watch(() => props.open, (value) => { if (value) reset() }, { immediate: true })

/** 校验口径与 CollabView.validate 逐条一致 */
function validate(): boolean {
  const name = form.value.name.trim()
  if (name.length < 2 || name.length > 50) {
    showToast('试卷名称须为 2-50 字', 'error')
    return false
  }
  if (basket.count.value === 0) {
    showToast('试卷至少需要 1 道题目', 'error')
    return false
  }
  const bad = built.value.sections.some((section) =>
    section.questions.some((item) => !(Number(item.score) >= 0.5 && Number(item.score) <= 100)),
  )
  if (bad) {
    showToast('单题分值须在 0.5 ~ 100 之间', 'error')
    return false
  }
  if (built.value.missing.length) {
    showToast(`有 ${built.value.missing.length} 道题在题库中已不存在，请先在组卷车中移除`, 'error')
    return false
  }
  return true
}

async function save(submit: boolean) {
  if (!validate()) return
  saving.value = true
  try {
    const saved = await savePaper({
      name: form.value.name.trim(),
      subject: form.value.subject,
      grade: form.value.grade,
      duration: form.value.duration,
      /* 必须深拷贝：savePaper 按引用存 sections，见文件头注释 */
      sections: JSON.parse(JSON.stringify(built.value.sections)),
      submit,
    })
    basket.markSaved(saved.id)
    await refreshPapers()
    showToast(submit ? '已提交：AI 九项检测通过后推送人工审核' : '草稿已保存到试卷库', 'success')
    emit('saved', saved)
    emit('close')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '保存失败', 'error')
  } finally {
    saving.value = false
  }
}

/** 预览用的合成试卷：不落库，只借 PaperPreviewModal 的排版能力 */
const draftPaper = computed<OrgPaper>(() => ({
  id: 0,
  name: form.value.name.trim() || '未命名试卷',
  subject: form.value.subject,
  grade: form.value.grade,
  duration: form.value.duration,
  status: 'draft',
  sections: built.value.sections,
  owner: '当前用户',
  updatedAt: stamp,
  sharedSquare: false,
}))
</script>

<template>
  <AppModal v-if="open" title="生成试卷" :width="560" @close="emit('close')">
    <div class="cp-sum">
      <span>{{ basket.count.value }} 题 · 共 <b>{{ totalScore }}</b> 分</span>
      <span>客观题 {{ objectiveScore }} 分 · {{ built.sections.length }} 个大题</span>
    </div>

    <div class="f-field">
      <label class="f-label">试卷名称</label>
      <input v-model="form.name" class="f-input" maxlength="50" placeholder="例如：高一数学三角函数单元卷" />
      <p class="f-hint">2-50 字。保存后可在试卷库继续编辑。</p>
    </div>

    <div class="cp-row">
      <div class="f-field">
        <label class="f-label">年级</label>
        <select v-model="form.grade" class="f-select">
          <option value="">请选择</option>
          <option v-for="grade in grades" :key="grade" :value="grade">{{ grade }}</option>
        </select>
      </div>
      <div class="f-field">
        <label class="f-label">学科</label>
        <select v-model="form.subject" class="f-select">
          <option value="">请选择</option>
          <option v-for="subject in subjects" :key="subject" :value="subject">{{ subject }}</option>
        </select>
      </div>
      <div class="f-field">
        <label class="f-label">考试时长（分钟）</label>
        <input v-model.number="form.duration" class="f-input" type="number" min="10" max="300" step="10" />
      </div>
    </div>

    <div v-if="built.missing.length" class="cp-warn">
      <AppIcon name="warning" :size="14" />
      有 {{ built.missing.length }} 道题在题库中已不存在，请先在组卷车中移除后再保存。
    </div>

    <template #footer>
      <button class="btn btn-ghost" type="button" @click="previewOpen = true">
        <AppIcon name="eye" :size="15" />
        试卷预览
      </button>
      <button class="btn btn-ghost" type="button" :disabled="saving" @click="save(false)">存为草稿</button>
      <button class="btn btn-primary" type="button" :disabled="saving" @click="save(true)">
        {{ saving ? '保存中…' : '保存并提交审核' }}
      </button>
    </template>
  </AppModal>

  <PaperPreviewModal v-if="previewOpen" :paper="draftPaper" :questions="questions" @close="previewOpen = false" />
</template>

<style scoped>
.cp-sum {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  font-size: 12.5px;
  color: var(--sub);
  background: #f7fafa;
  border-radius: 10px;
  padding: 9px 12px;
  margin-bottom: 16px;
}
.cp-sum b { color: var(--brand-deep); font-size: 15px; }

.cp-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }

.cp-warn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 11px;
  border-radius: 9px;
  background: var(--danger-soft);
  color: var(--danger);
  font-size: 12px;
}
</style>
