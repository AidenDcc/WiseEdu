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
import { useRouter } from 'vue-router'
import { AppIcon, showToast, AppModal } from '@aiteach/shared'
import type { MediaKind, OrgPaper } from '@aiteach/shared'
import PaperPreviewModal from '@/components/paper/PaperPreviewModal.vue'
import PaperFolderSelect from '@/components/paper/PaperFolderSelect.vue'
import { savePaper } from '@/api/org'
import { useBaseData } from '@/composables/useBaseData'
import { useComposeBasket } from '@/composables/useComposeBasket'
import { useComposeData } from '@/composables/useComposeData'
import { objectiveScoreOfSections, scoreOfSections } from '@/views/paper/paper-sections'

const props = withDefaults(
  defineProps<{
    open: boolean
    /**
     * 弹窗层级，透传给 AppModal（默认 120）。组卷工作台传 340 —— 它由组卷车抽屉里的
     * 「生成试卷」打开，必须压在抽屉（310）之上，见 ComposeView 的层级说明。
     */
    zIndex?: number
  }>(),
  { zIndex: 120 },
)
const emit = defineEmits<{ close: []; saved: [paper: OrgPaper] }>()

const router = useRouter()

const { questions, questionOf, refreshPapers } = useComposeData()
const { subjects, grades, ensure, pick } = useBaseData()
const basket = useComposeBasket()

const built = computed(() => basket.toSections(questions.value))
const totalScore = computed(() => scoreOfSections(built.value.sections))
const objectiveScore = computed(() => objectiveScoreOfSections(built.value.sections, questions.value))

/* 组卷车里的资源（图片 / 视频 / 小程序）随卷存成参考资料。它们不进卷面、不计分，
   但必须在这里就让人看见「会跟着存下去」——否则加了一堆资源、点保存后车被清空，会以为丢了。
   `toAttachments()` 每次返回全新对象，可以直接交给 savePaper，不需要再深拷贝。 */
const attachments = computed(() => basket.toAttachments())

const ATTACHMENT_KINDS: Array<{ kind: MediaKind; text: string }> = [
  { kind: 'image', text: '图片' },
  { kind: 'animation', text: '小程序' },
  { kind: 'video', text: '视频' },
]
/** 「图片 2 · 视频 1」这种按类型归纳的摘要，比单说「3 个资源」更能让人确认加对了没有 */
const attachmentText = computed(() =>
  ATTACHMENT_KINDS.map((item) => ({ ...item, count: basket.resourceCount(item.kind) }))
    .filter((item) => item.count > 0)
    .map((item) => `${item.text} ${item.count}`)
    .join(' · '),
)

const now = new Date()
const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

const form = ref({ name: '', subject: '', grade: '', duration: 90, folderId: null as number | null })
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
    /* 存储位置每次都要显式选：上一次的选择不代表这次也合适 */
    folderId: null,
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
  if (form.value.folderId == null) {
    showToast('请选择试卷在「我的文件」中的存储位置', 'error')
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
      /* 随卷参考资料（图片 / 视频 / 小程序）；本身每次都是新对象，无需拷贝 */
      attachments: attachments.value,
      /* 个人创建的试卷存「我的文件」所选文件夹 */
      folderId: form.value.folderId ?? undefined,
      source: '手动组卷',
      submit,
    })
    basket.markSaved(saved.id)
    await refreshPapers()
    showToast(submit ? '已提交：AI 九项检测通过后推送人工审核' : '草稿已保存到「我的文件」', 'success')
    emit('saved', saved)
    emit('close')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '保存失败', 'error')
  } finally {
    saving.value = false
  }
}

/**
 * 「生成试卷」= 存草稿 + 直接进试卷编辑页。
 *
 * 为什么不是「存完就结束」：组卷车只解决了「选哪些题」，而卷面还要调大题顺序、改分值、
 * 加材料、换版式、打印——这些只能在纸面编辑页做。停在弹窗里等于让老师自己再找一次入口。
 * 组卷车是模块级单例且已持久化，跳到编辑页不会丢，返回工作台后车里的题还在。
 */
async function generate() {
  if (!validate()) return
  saving.value = true
  try {
    const saved = await savePaper({
      name: form.value.name.trim(),
      subject: form.value.subject,
      grade: form.value.grade,
      duration: form.value.duration,
      sections: JSON.parse(JSON.stringify(built.value.sections)),
      attachments: attachments.value,
      folderId: form.value.folderId ?? undefined,
      source: '手动组卷',
      submit: false,
    })
    basket.markSaved(saved.id)
    await refreshPapers()
    emit('saved', saved)
    emit('close')
    router.push(`/paper/edit?id=${saved.id}`)
  } catch (error) {
    showToast(error instanceof Error ? error.message : '生成失败', 'error')
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
  attachments: attachments.value,
  owner: '当前用户',
  updatedAt: stamp,
  sharedSquare: false,
}))
</script>

<template>
  <AppModal v-if="open" title="生成试卷" :width="560" :z-index="zIndex" @close="emit('close')">
    <div class="cp-sum">
      <span>{{ basket.count.value }} 题 · 共 <b>{{ totalScore }}</b> 分</span>
      <span>客观题 {{ objectiveScore }} 分 · {{ built.sections.length }} 个大题</span>
      <span v-if="basket.resourceTotal.value" class="cp-sum-res">
        另附 {{ basket.resourceTotal.value }} 个参考资料（{{ attachmentText }}），随试卷一起保存
      </span>
    </div>

    <div class="f-field">
      <label class="f-label">试卷名称</label>
      <input v-model="form.name" class="f-input" maxlength="50" placeholder="例如：高一数学三角函数单元卷" />
      <p class="f-hint">2-50 字。保存后存入「我的文件」，可随时打开继续编辑。</p>
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

    <div class="f-field">
      <label class="f-label">存储位置（我的文件）<span class="req">*</span></label>
      <!-- 选择弹窗必须比本弹窗高一档：组卷工作台里本弹窗是 340，不传的话选择框会被压在下面 -->
      <PaperFolderSelect v-model="form.folderId" :z-index="zIndex + 10" />
      <p class="f-hint">试卷将保存到该文件夹，之后在「我的文件」中打开继续编辑。</p>
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
      <!-- 主按钮就是「生成试卷」：存草稿 + 进卷面编辑页。提交审核放到编辑页，
           老师总要先把卷面调好再审，弹窗里直接提交等于逼他跳过排版这一步 -->
      <button class="btn btn-primary" type="button" :disabled="saving" @click="generate()">
        {{ saving ? '生成中…' : '生成试卷' }}
      </button>
    </template>
  </AppModal>

  <!-- 草稿预览必须压在本弹窗之上（本弹窗被调用方抬到了 340，预览默认只 130），故一并把层级传下去 -->
  <PaperPreviewModal
    v-if="previewOpen"
    :paper="draftPaper"
    :questions="questions"
    :z-index="zIndex + 10"
    @close="previewOpen = false"
  />
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
/* 参考资料摘要另起一行：它说的是「卷面之外还会存什么」，与上面两段卷面统计不是一回事 */
.cp-sum-res { flex-basis: 100%; color: var(--brand-deep); }

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
