<script setup lang="ts">
/**
 * 「生成试卷」弹窗：这一步只问一件事 —— 试卷存进「我的文件」的哪个文件夹。
 *
 * 为什么弹窗里不再填名称 / 年级 / 学科 / 时长：这几项**试卷编辑页里本来就有**（顶栏卷名 +
 * 卷面设置那一排），在这里问一遍、进去再问一遍，同一份信息填两次；更要紧的是填的时候卷面
 * 还没露过面，年级学科只能凭记忆挑，填完了也看不出对不对。现在弹窗退化成「选存哪儿」，
 * 选完直接落到编辑页，对着卷面改这些参数才说得通 —— 与平行卷弹窗（ParallelPaperDialog）
 * 同一做法：这一步要回答的问题只有一个「存哪儿」，就不该再问第二个。
 *
 * 卷名仍要给一份默认值（`savePaper` 没有名字建不了卷）：按组卷车第一道题的年级学科 + 当天
 * 日期生成「高一数学试卷 2026-10-06」，编辑页顶栏随手可改。
 *
 * 弹窗本体直接用 FolderPickerDialog，不再套一层 AppModal：目录树、目录里已有什么、
 * 就地新建文件夹一次看全，选位置这一件事一次做完（理由见该组件头部注释）。
 *
 * 保存时**深拷贝 sections**（与 `CollabView.vue` 同一处理）。`savePaper` 按**引用**存入
 * papers 列表，不拷贝的话保存后再改组卷车，会连带篡改已落库的试卷。
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showToast } from '@aiteach/shared'
import type { MediaKind, OrgPaper } from '@aiteach/shared'
import FolderPickerDialog from '@/components/file/FolderPickerDialog.vue'
import { savePaper } from '@/api/org'
import { openBlankTab, openPaperEdit, paperEditHref } from '@/utils/paper-edit'
import { useComposeBasket } from '@/composables/useComposeBasket'
import { useComposeData } from '@/composables/useComposeData'
import { objectiveScoreOfSections, scoreOfSections } from '@/views/paper/paper-sections'

withDefaults(
  defineProps<{
    open: boolean
    /**
     * 弹窗层级，透传给 FolderPickerDialog（默认 130）。组卷工作台传 340 —— 它由组卷车抽屉里的
     * 「生成试卷」打开，必须压在抽屉（310）之上，见 ComposeView 的层级说明。
     */
    zIndex?: number
  }>(),
  { zIndex: 120 },
)
const emit = defineEmits<{ close: []; saved: [paper: OrgPaper] }>()

const router = useRouter()

const { questions, questionOf, refreshPapers } = useComposeData()
const basket = useComposeBasket()

const built = computed(() => basket.toSections(questions.value))
const totalScore = computed(() => scoreOfSections(built.value.sections))
const objectiveScore = computed(() => objectiveScoreOfSections(built.value.sections, questions.value))

/* 组卷车里的资源（图片 / 视频 / 小程序）随卷存成参考资料。它们不进卷面、不计分，
   但必须在这里就让人看见「会跟着存下去」——否则加了一堆资源、点完生成车被清空，会以为丢了。
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

/**
 * 默认卷名 / 年级学科：取组卷车里**第一道题**的年级学科。
 *
 * 组卷车通常是一个年级一个学科的一整卷（跨年级混组本就少见），拿第一道题足够准；
 * 真组了混合卷，编辑页顶栏改一下就行 —— 这里不为了少数情况多问一次。
 */
const seed = computed(() => {
  const first = basket.entries.value.length ? questionOf(basket.entries.value[0].questionId) : undefined
  return { grade: first?.grade ?? '', subject: first?.subject ?? '' }
})

const now = new Date()
const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
const defaultName = computed(() => `${seed.value.grade}${seed.value.subject}试卷 ${stamp}`.trim())

/** 已选目录：选择弹窗在确认时回传，这里只作 `v-model` 的落点（每次打开都从根目录重新选） */
const folderId = ref<number | null>(null)
const saving = ref(false)

/**
 * 建卷前只拦「建出来就是残卷」的几种情况，口径与协同组卷一致。
 * 名称 / 年级 / 学科已不在弹窗里，故不再校验它们 —— 编辑页保存时自会校验。
 */
function validate(): boolean {
  if (basket.count.value === 0) {
    showToast('试卷至少需要 1 道题目', 'error')
    return false
  }
  if (built.value.missing.length) {
    showToast(`有 ${built.value.missing.length} 道题在题库中已不存在，请先在组卷车中移除`, 'error')
    return false
  }
  const bad = built.value.sections.some((section) =>
    section.questions.some((item) => !(Number(item.score) >= 0.5 && Number(item.score) <= 100)),
  )
  if (bad) {
    showToast('单题分值须在 0.5 ~ 100 之间', 'error')
    return false
  }
  return true
}

/**
 * 「生成试卷」= 存草稿 + 直接进试卷编辑页（**新标签页**，见 utils/paper-edit.ts）。
 *
 * 为什么不是「存完就结束」：组卷车只解决了「选哪些题」，而卷面还要调大题顺序、改分值、
 * 加材料、换版式、打印——这些只能在纸面编辑页做。停在原地等于让老师自己再找一次入口。
 * 组卷车是模块级单例且已持久化，跳到编辑页不会丢，返回工作台后车里的题还在。
 *
 * 编辑页开在新标签页，是为了让这个组卷工作台留在原地 —— 改完那份卷还要回来接着组下一份，
 * 尤其这里本身就是从侧边栏新开的页签，再叠一层跳转等于把组卷现场弄丢了。
 */
async function generate(id: number, path: string) {
  if (!validate()) return
  /* 点「生成试卷」的这一刻就把新标签页占下来：保存是异步的，等 `savePaper` 回来再开，
     用户手势已经过期，浏览器会当成弹窗拦掉。校验不过的早退在上面，不会白留一个空白页。 */
  const tab = openBlankTab()
  saving.value = true
  try {
    const saved = await savePaper({
      name: defaultName.value,
      subject: seed.value.subject,
      grade: seed.value.grade,
      /* 时长给个常见值 90 分钟，进编辑页后按需改（那时才知道要考多久） */
      duration: 90,
      /* 必须深拷贝：savePaper 按引用存 sections，见文件头注释 */
      sections: JSON.parse(JSON.stringify(built.value.sections)),
      /* 随卷参考资料（图片 / 视频 / 小程序）；本身每次都是新对象，无需拷贝 */
      attachments: attachments.value,
      /* 个人创建的试卷存「我的文件」所选文件夹；这里已由选择弹窗保证非空 */
      folderId: id,
      source: '手动组卷',
      submit: false,
    })
    basket.markSaved(saved.id)
    await refreshPapers()
    /* 提示里带上落点全路径：「我的文件」下同名目录很常见，只说「已存入我的文件」等于没说存哪儿 */
    showToast(`已生成《${saved.name}》，存入「${path || '我的文件'}」，正在打开试卷编辑页`, 'success')
    emit('saved', saved)
    emit('close')
    /* 万一新标签页还是被拦了，退回同页签跳转 —— 宁可跳走，也不能让老师点了没反应 */
    if (!openPaperEdit(saved.id, tab)) router.push(paperEditHref(saved.id))
  } catch (error) {
    /* 存失败了就把那个空白页关掉，不留个白板给用户 */
    tab?.close()
    showToast(error instanceof Error ? error.message : '生成失败', 'error')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <FolderPickerDialog
    v-if="open"
    v-model="folderId"
    title="生成试卷"
    confirm-text="生成试卷"
    :z-index="zIndex"
    :busy="saving"
    @confirm="generate"
    @close="emit('close')"
  >
    <div class="cp-sum">
      <span>{{ basket.count.value }} 题 · 共 <b>{{ totalScore }}</b> 分</span>
      <span>客观题 {{ objectiveScore }} 分 · {{ built.sections.length }} 个大题</span>
      <span v-if="basket.resourceTotal.value" class="cp-sum-res">
        另附 {{ basket.resourceTotal.value }} 个参考资料（{{ attachmentText }}），随试卷一起保存
      </span>
    </div>

    <p class="cp-tip">
      将生成《{{ defaultName }}》，存入上面所选的文件夹；点「生成试卷」后直接进入试卷编辑页，
      卷名 / 年级 / 学科 / 时长与卷面排版都在那里继续改。
    </p>

    <div v-if="built.missing.length" class="cp-warn">
      有 {{ built.missing.length }} 道题在题库中已不存在，请先在组卷车中移除后再生成。
    </div>
  </FolderPickerDialog>
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
  margin-bottom: 12px;
}
.cp-sum b { color: var(--brand-deep); font-size: 15px; }
/* 参考资料摘要另起一行：它说的是「卷面之外还会存什么」，与上面两段卷面统计不是一回事 */
.cp-sum-res { flex-basis: 100%; color: var(--brand-deep); }

.cp-tip {
  margin: 0 0 12px;
  font-size: 12.5px;
  color: var(--sub);
  line-height: 1.7;
}

.cp-warn {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
  padding: 8px 11px;
  border-radius: 9px;
  background: var(--danger-soft);
  color: var(--danger);
  font-size: 12px;
}
</style>
