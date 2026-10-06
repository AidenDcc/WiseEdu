<script setup lang="ts">
/**
 * AI 智能组卷独立页（FR-PP-008/009）：从试卷库头部的弹窗迁出成独立菜单入口。
 *
 * 与旧弹窗的两点差异：
 * 1. 必选「存储位置」—— 个人创建的试卷一律存「我的文件」，建卷前先选文件夹；
 * 2. 出卷后直接进试卷编辑页（对齐题库组卷「生成试卷」的行为），停在表单页没有下一步可走。
 */
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { AppIcon, AppPageHeader, showToast } from '@aiteach/shared'
import { aiComposePaper } from '@/api/org'
import { useBaseData } from '@/composables/useBaseData'
import PaperFolderSelect from '@/components/paper/PaperFolderSelect.vue'

const router = useRouter()
const { subjects, grades, questionTypesFor, ensure, pick, withCurrent } = useBaseData()

const form = reactive({
  name: '',
  subject: '数学',
  grade: '高一',
  structure: [
    { type: '单选', count: 8, score: 5 },
    { type: '填空', count: 4, score: 5 },
    { type: '解答', count: 2, score: 12 },
  ],
  folderId: null as number | null,
})
const running = ref(false)

onMounted(async () => {
  await ensure()
  form.subject = pick(subjects.value, form.subject)
  form.grade = pick(grades.value, form.grade)
})

async function runAiCompose() {
  if (form.name.trim().length < 2) {
    showToast('请填写试卷名称（2-50 字）', 'error')
    return
  }
  if (form.folderId == null) {
    showToast('请选择试卷在「我的文件」中的存储位置', 'error')
    return
  }
  if (form.structure.some((row) => row.count < 1 || row.score <= 0)) {
    showToast('每个大题的题数 ≥1、单题分值 >0', 'error')
    return
  }
  running.value = true
  try {
    /* folderId 已在上方判空，这里断言为非空 */
    const { paper, aiPicked } = await aiComposePaper({ ...form, folderId: form.folderId!, name: form.name.trim() })
    const count = paper.sections.reduce((sum, section) => sum + section.questions.length, 0)
    showToast(
      aiPicked > 0
        ? `AI 组卷完成：${count} 题入卷，${aiPicked} 题因题量不足由 AI 新生成补足，已存入「我的文件」`
        : `AI 组卷完成：${count} 题，已存入「我的文件」`,
      'success',
    )
    router.push(`/paper/edit?id=${paper.id}`)
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'AI 组卷失败', 'error')
  } finally {
    running.value = false
  }
}
</script>

<template>
  <div class="page">
    <AppPageHeader
      desc="AI 按卷面结构自动组卷：优先从已入库题目抽取，题量不足时智能生成补齐；产出的试卷存入「我的文件」所选文件夹，编辑并送审通过后进入试卷库。"
    />

    <div class="panel form-panel">
      <div class="f-field">
        <label class="f-label">试卷名称<span class="req">*</span>（2-50 字）</label>
        <input v-model="form.name" class="f-input" maxlength="50" placeholder="如：高一数学第三章随堂测" />
      </div>
      <div class="f-field row2">
        <div>
          <label class="f-label">学科</label>
          <select v-model="form.subject" class="f-select">
            <option v-for="s in subjects" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
        <div>
          <label class="f-label">年级</label>
          <select v-model="form.grade" class="f-select">
            <option v-for="g in grades" :key="g" :value="g">{{ g }}</option>
          </select>
        </div>
      </div>
      <div class="f-field">
        <label class="f-label">卷面结构（按题型设置题数与单题分值）</label>
        <div v-for="(row, i) in form.structure" :key="i" class="struct-row">
          <select v-model="row.type" class="f-select" style="width: 110px">
            <!-- 题型随学科收窄（英语才有完形填空 / 七选五 / 短文改错）；已选值并入，换学科不会渲染成空白 -->
            <option v-for="t in withCurrent(questionTypesFor(form.subject), row.type)" :key="t" :value="t">{{ t }}</option>
          </select>
          <input v-model.number="row.count" type="number" min="1" class="f-input" style="width: 84px" />
          <span class="f-hint">题 ×</span>
          <input v-model.number="row.score" type="number" min="0.5" step="0.5" class="f-input" style="width: 84px" />
          <span class="f-hint">分/题</span>
          <button class="mini-btn danger" type="button" :disabled="form.structure.length <= 1" @click="form.structure.splice(i, 1)">删除</button>
        </div>
        <button class="btn btn-ghost btn-sm" type="button" :disabled="form.structure.length >= 8" @click="form.structure.push({ type: '单选', count: 4, score: 5 })">
          <AppIcon name="plus" :size="14" /> 添加大题
        </button>
        <p class="f-hint">预计总分：{{ form.structure.reduce((s, r) => s + r.count * r.score, 0) }} 分</p>
      </div>
      <div class="f-field">
        <label class="f-label">存储位置（我的文件）<span class="req">*</span></label>
        <PaperFolderSelect v-model="form.folderId" />
        <p class="f-hint">试卷将保存到该文件夹；需要新目录可在选择弹窗里直接新建。</p>
      </div>

      <div class="form-actions">
        <button class="btn btn-primary" :disabled="running" @click="runAiCompose">
          <AppIcon name="sparkles" :size="15" />
          {{ running ? '组卷中…' : '开始组卷（消耗 1 次额度）' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.form-panel { max-width: 720px; padding: 22px 24px; }
.struct-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
/* 横向居中的行里，f-hint 自带的 5px 上边距会把文字顶歪 */
.struct-row .f-hint { margin-top: 0; }
.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.form-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px; }
</style>
