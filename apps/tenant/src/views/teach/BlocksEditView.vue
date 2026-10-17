<script setup lang="ts">
/**
 * 学案 / 讲义的全屏编辑页（同一份实现，靠路由的 `meta.kind` 区分）。
 *
 * ## 为什么合成一个页面
 *
 * 这两者的数据模型逐字相同：都是 `blocks` 段落流（预习导学 / 课堂探究…与学习目标 / 知识点讲解…
 * 只是字典不同），结构化编辑、关联题目、保存发布全一样。分成两个文件的话，下一次改「关联题目」
 * 就得记得改两处 —— 这类页面最怕的就是这种「看起来一样、其实差一行」。
 *
 * ## 页面骨架交给 DocWorkbench
 *
 * 顶栏 / 工具带 / 三栏 / 右栏五块面板 / 底栏 / 整篇预览都在共用工作台里（教案也是同一套），
 * 本页只做四件它做不到的事：
 * 1. 按 id 取文档（深拷贝进编辑态）；
 * 2. 保存 / 发布（工作台只发事件，不碰接口）；
 * 3. 结构化编辑的**中栏表单**（当前段落的标题 + 富文本 + 关联题目）；
 * 4. 预览里的**版式那一版** —— 答案只存在于题库，纸面正文里没有，所以这一份只能按
 *    blocks + questions 现场排，不能走文档预览。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AppSegmented,
  GUIDE_BLOCK_TEXT,
  LECTURE_BLOCK_TEXT,
  RichTextViewer,
  appConfirm,
  showToast,
  truncateRich,
} from '@aiteach/shared'
import type { BlockKind, LectureBlock, OrgQuestion, TeachDoc } from '@aiteach/shared'
import { QuestionOptions, optionColumnsOf } from '@aiteach/business-common'

import DocWorkbench from '@/components/doc/DocWorkbench.vue'
import RichTextEditor from '@/components/ui/RichTextEditor.vue'
import type { StructOutlineAction, StructOutlineRow } from '@/components/doc/workbench-types'
import { fetchQuestions, fetchTeachDocs, saveTeachDoc, toggleTeachDocPublish } from '@/api/org'

const route = useRoute()
const router = useRouter()

/** `guide` / `lecture`：由路由决定，页面内不再判断 */
const kind = computed<'guide' | 'lecture'>(() => (String(route.meta.kind ?? '') === 'lecture' ? 'lecture' : 'guide'))
const kindText = computed(() => (kind.value === 'guide' ? '学案' : '讲义'))
const listHref = computed(() => `/teach/${kind.value}`)

/** 段落字典：两种文档各一套（学案留给学生写，讲义写给老师看） */
const blockText = computed<Record<string, string>>(() =>
  kind.value === 'guide' ? (GUIDE_BLOCK_TEXT as Record<string, string>) : (LECTURE_BLOCK_TEXT as Record<string, string>),
)

/* ================= 文档 ================= */

const doc = ref<TeachDoc | null>(null)
const loading = ref(true)
const saving = ref(false)
const publishing = ref(false)
const dirty = ref(false)
const mode = ref<'doc' | 'struct'>('doc')
const questions = ref<OrgQuestion[]>([])

/** 当前选中的段落（key 是段落 id 的字符串形式，见 workbench-types 的 StructOutlineRow） */
const activeKey = ref('')
const activeBlock = computed<LectureBlock | null>(
  () => doc.value?.blocks.find((row) => String(row.id) === activeKey.value) ?? null,
)

const structStat = computed(() => {
  const blocks = doc.value?.blocks ?? []
  const linked = blocks.reduce((sum, row) => sum + row.questionIds.length, 0)
  return `${blocks.length} 个段落 · ${linked} 道关联题`
})
const structTarget = computed(() =>
  activeBlock.value ? activeBlock.value.title || blockText.value[activeBlock.value.kind] || '当前段落' : '',
)

/** 「新增」按钮的清单：字典顺序即工具栏顺序 */
const structKinds = computed(() => Object.entries(blockText.value).map(([key, label]) => ({ key, label })))

/** 左栏大纲：由段落生成（行结构留在工作台，见 workbench-types 的说明） */
const structOutline = computed<StructOutlineRow[]>(() =>
  (doc.value?.blocks ?? []).map((block, index) => ({
    key: String(block.id),
    no: String(index + 1),
    title: block.title || blockText.value[block.kind] || '正文',
    meta: [blockText.value[block.kind] ?? '段落', block.questionIds.length ? `${block.questionIds.length} 题` : '']
      .filter(Boolean)
      .join(' · '),
    movable: true,
  })),
)

async function loadDoc() {
  const id = Number(route.query.id ?? 0)
  if (!id) {
    showToast(`缺少${kindText.value} id，已返回列表`, 'error')
    router.replace(listHref.value)
    return
  }
  const rows = await fetchTeachDocs(kind.value)
  const found = rows.find((row) => row.id === id)
  if (!found) {
    showToast(`${kindText.value}不存在或已删除`, 'error')
    router.replace(listHref.value)
    return
  }
  /* 深拷贝进编辑态：直接改列表里的对象会让「取消」无从实现，也污染列表展示 */
  doc.value = JSON.parse(JSON.stringify(found)) as TeachDoc
  activeKey.value = doc.value.blocks[0] ? String(doc.value.blocks[0].id) : ''
  document.title = `${doc.value.name} · ${kindText.value}编辑 · 机构端 · AI教学云平台`
}

onMounted(async () => {
  loading.value = true
  try {
    await Promise.all([loadDoc(), fetchQuestions().then((rows) => (questions.value = rows))])
  } finally {
    loading.value = false
  }
})

/* 同一页签里换 id（少见，但演示脚本会这么点）时重新载入 */
watch(
  () => route.query.id,
  async (next, prev) => {
    if (next && next !== prev) await loadDoc()
  },
)

/* ================= 保存 / 发布 ================= */

const workbench = ref<InstanceType<typeof DocWorkbench> | null>(null)

async function save() {
  const current = doc.value
  if (!current) return
  if (current.name.trim().length < 2) {
    showToast(`${kindText.value}名称须为 2-50 字`, 'error')
    return
  }
  saving.value = true
  try {
    const saved = await saveTeachDoc({
      id: current.id,
      kind: kind.value,
      name: current.name.trim(),
      subject: current.subject,
      grade: current.grade,
      textbook: current.textbook,
      chapter: current.chapter,
      knowledge: current.knowledge,
      blocks: current.blocks,
      slides: [],
      page: current.page,
      content: current.content,
      status: current.status,
    })
    current.id = saved.id
    dirty.value = false
    workbench.value?.pushSnapshot('手动保存')
    showToast(`${kindText.value}已保存`, 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '保存失败', 'error')
  } finally {
    saving.value = false
  }
}

async function publish() {
  const current = doc.value
  if (!current) return
  if (!current.id) {
    await save()
    if (!current.id) return
  }
  publishing.value = true
  try {
    const next = await toggleTeachDocPublish(current.id)
    current.status = next.status
    showToast(next.status === 'published' ? '已发布，校内教师可直接取用' : '已下架', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '操作失败', 'error')
  } finally {
    publishing.value = false
  }
}

/** 全局设置里改的元数据 / 页面设置直接写回编辑态文档，最终由 `save()` 落库 */
function onPatch(value: Partial<TeachDoc>) {
  if (!doc.value) return
  Object.assign(doc.value, value)
  dirty.value = true
}

/* ================= 结构化编辑（段落） ================= */

function addStruct(key: string) {
  const current = doc.value
  if (!current) return
  const block: LectureBlock = {
    id: Date.now(),
    kind: key as BlockKind,
    title: blockText.value[key] ?? '正文',
    body: '<p></p>',
    questionIds: [],
  }
  current.blocks.push(block)
  activeKey.value = String(block.id)
  dirty.value = true
}

function removeBlock(id: number) {
  const current = doc.value
  if (!current) return
  const index = current.blocks.findIndex((row) => row.id === id)
  if (index < 0) return
  current.blocks.splice(index, 1)
  if (activeKey.value === String(id)) {
    const next = current.blocks[Math.max(0, index - 1)]
    activeKey.value = next ? String(next.id) : ''
  }
  dirty.value = true
}

function moveBlock(id: number, delta: number) {
  const current = doc.value
  if (!current) return
  const index = current.blocks.findIndex((row) => row.id === id)
  const target = index + delta
  if (index < 0 || target < 0 || target >= current.blocks.length) return
  const [row] = current.blocks.splice(index, 1)
  current.blocks.splice(target, 0, row)
  dirty.value = true
}

/** 大纲行上的上移 / 下移 / 删除：key 是字符串，转回段落 id 再落到 blocks 上 */
function onOutlineAction(key: string, action: StructOutlineAction) {
  const id = Number(key)
  if (!Number.isFinite(id)) return
  if (action === 'remove') removeBlock(id)
  else moveBlock(id, action === 'up' ? -1 : 1)
}

function linkQuestion(questionId: number) {
  const block = activeBlock.value
  if (!block) {
    showToast('请先选中一个段落，再关联题目', 'error')
    return
  }
  if (block.questionIds.includes(questionId)) {
    showToast('该题已在当前段落中', 'error')
    return
  }
  block.questionIds.push(questionId)
  dirty.value = true
}

function unlinkQuestion(questionId: number) {
  const block = activeBlock.value
  if (!block) return
  block.questionIds = block.questionIds.filter((row) => row !== questionId)
  dirty.value = true
}

const itemOf = (id: number) => questions.value.find((row) => row.id === id)

/* ================= 版式那一版（学生版 / 教师版） ================= */

/**
 * 预览里的「版式」页签：按 `blocks` + 关联题目现场排版。
 *
 * 答案只存在于题库里，纸面正文里根本没有 —— 学生版要隐去、教师版要带上，
 * 只能在排版的时候决定，所以这一版不是「正文的另一个样子」，而是一份独立生成的稿子。
 */
const withAnswer = ref(false)

const layoutLabel = computed(() => (kind.value === 'guide' ? '学案稿' : '讲义稿'))
const layoutHint = computed(() =>
  kind.value === 'guide'
    ? '按段落 + 关联题目现排的那一份：学生版隐去答案，教师版带答案与解析'
    : '按段落 + 关联题目现排的那一份：默认可切到学生版隐去答案',
)

/* ================= 未保存提示 ================= */

async function leaveToList() {
  if (dirty.value && !(await appConfirm('有改动还没保存，确定离开？', { type: 'warning' }))) return
  router.push(listHref.value)
}
</script>

<template>
  <DocWorkbench
    v-if="doc"
    ref="workbench"
    v-model:mode="mode"
    v-model:dirty="dirty"
    v-model:active-key="activeKey"
    :doc="doc"
    :kind="kind"
    :saving="saving"
    :publishing="publishing"
    :questions="questions"
    :struct-kinds="structKinds"
    :struct-outline="structOutline"
    :struct-target="structTarget"
    :struct-stat="structStat"
    :layout-label="layoutLabel"
    :layout-hint="layoutHint"
    :list-href="listHref"
    @save="save"
    @publish="publish"
    @patch="onPatch"
    @add-struct="addStruct"
    @outline-action="onOutlineAction"
    @link-question="linkQuestion"
  >
    <!-- 预览 → 版式：学生版 / 教师版就在这里切，切换时纸不跳位（控制条固定在这一行） -->
    <template #preview-toolbar>
      <span class="bs-switch-label">这一版</span>
      <AppSegmented
        :model-value="withAnswer ? 'teacher' : 'student'"
        :options="[
          { value: 'student', label: '学生版（隐去答案）' },
          { value: 'teacher', label: '教师版（含答案）' },
        ]"
        @update:model-value="withAnswer = $event === 'teacher'"
      />
    </template>

    <!-- 预览 → 版式：发下去的那一份（.dl-* 的样式在 doc-layout.ts 里，预览与打印共用） -->
    <template #layout>
      <div class="dl">
        <div class="dl-head">
          <h1 class="dl-title">{{ doc.name }}</h1>
          <p class="dl-sub">
            {{ doc.subject }} · {{ doc.grade }}<template v-if="doc.textbook"> · {{ doc.textbook }}</template>
            · {{ withAnswer ? '教师版' : '学生版' }}
          </p>
          <p v-if="kind === 'guide' && !withAnswer" class="dl-note">姓名 __________ 班级 __________ 学号 __________</p>
        </div>

        <section v-for="(block, i) in doc.blocks" :key="block.id" class="dl-sec">
          <h2 class="dl-sec-h"><span class="dl-sec-no">{{ i + 1 }}.</span>{{ block.title || blockText[block.kind] }}</h2>
          <RichTextViewer v-if="block.body" :content="block.body" />
          <div v-for="(qid, qi) in block.questionIds" :key="qid" class="dl-q">
            <p class="dl-q-head">
              {{ qi + 1 }}．
              <RichTextViewer v-if="itemOf(qid)" :content="itemOf(qid)!.stem" tag="span" />
            </p>
            <!-- 题干里的正确项一律不标：学生版标出来等于给答案，教师版有专门的「答案」区 -->
            <QuestionOptions
              v-if="itemOf(qid)"
              variant="doc"
              :options="itemOf(qid)!.options"
              :columns="optionColumnsOf(itemOf(qid)!)"
            />
            <p v-if="!withAnswer" class="dl-ans-line">答：______________________</p>
            <div v-else-if="itemOf(qid)" class="dl-ans">
              <p><b>答案：</b>{{ itemOf(qid)!.answer }}</p>
              <p><b>解析：</b><RichTextViewer :content="itemOf(qid)!.analysis" tag="span" /></p>
            </div>
          </div>
        </section>

        <p v-if="!doc.blocks.length" class="dl-blank">
          这份{{ kindText }}还没有段落。<br />在「结构化编辑」里逐段写，或在「文案编辑」里写整篇稿子。
        </p>
      </div>
    </template>

    <!-- 结构化编辑：中栏是「当前段落」的表单 -->
    <template #struct-main>
      <section v-if="activeBlock" class="bs-card">
        <div class="bs-card-head">
          <span class="tag tag-blue">{{ blockText[activeBlock.kind] || '段落' }}</span>
          <input v-model="activeBlock.title" class="bs-title" maxlength="40" placeholder="段落标题" @input="dirty = true" />
        </div>
        <RichTextEditor
          v-model="activeBlock.body"
          :subject="doc.subject"
          :min-height="260"
          :placeholder="
            kind === 'guide'
              ? '在此撰写学案内容，学生作答处用 ______ 留白'
              : '在此撰写讲解内容，可插入公式与配图'
          "
        />

        <div class="bs-linked">
          <div class="bs-linked-head">
            <b>关联题目</b>
            <span class="f-hint">
              右侧「题库选题」加入本段；{{ kind === 'guide' ? '学生版预览会隐去答案' : '讲义默认带答案解析' }}
            </span>
          </div>
          <p v-if="!activeBlock.questionIds.length" class="f-hint">本段尚未关联题目</p>
          <div v-for="qid in activeBlock.questionIds" :key="qid" class="bs-linked-row">
            <span class="tag tag-gray">{{ itemOf(qid)?.type ?? '题目' }}</span>
            <span class="bs-linked-stem">{{ truncateRich(itemOf(qid)?.stem ?? `题目 #${qid}`, 60) }}</span>
            <button class="mini-btn danger" @click="unlinkQuestion(qid)">移除</button>
          </div>
        </div>
      </section>
      <section v-else class="bs-card bs-empty">
        左侧还没有段落。点上方「新增」，或在文案编辑里直接写整篇稿子。
        <button class="btn btn-ghost btn-sm" type="button" @click="mode = 'doc'">切到文案编辑</button>
      </section>
    </template>
  </DocWorkbench>

  <!-- 载入中 / 找不到：都不该是一片空白 -->
  <div v-else class="bs-blank">
    <p v-if="loading">正在载入{{ kindText }}…</p>
    <template v-else>
      <p>没有找到这份{{ kindText }}（可能已被删除，或链接里的 id 不对）。</p>
      <button class="btn btn-primary" type="button" @click="leaveToList">回到{{ kindText }}列表</button>
    </template>
  </div>
</template>

<style scoped>
/* 结构化编辑的段落表单：一列铺开、限宽居中（与教案的结构化卡片同一个观感） */
.bs-card {
  max-width: 980px;
  margin: 0 auto 16px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 18px 20px;
}
.bs-card-head { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.bs-title {
  flex: 1;
  min-width: 0;
  height: 34px;
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 0 11px;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
  background: #fff;
}
.bs-title:focus { outline: none; border-color: var(--brand); box-shadow: 0 0 0 3px var(--brand-soft); }
.bs-empty { display: flex; align-items: center; justify-content: center; gap: 12px; flex-direction: column; color: var(--sub); font-size: 13px; padding: 40px; }

.bs-linked { margin-top: 16px; padding-top: 14px; border-top: 1px dashed var(--border); }
.bs-linked-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; font-size: 13px; flex-wrap: wrap; }
.bs-linked-row {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 8px 10px;
  margin-bottom: 6px;
  background: #fbfdfd;
}
.bs-linked-stem { flex: 1; min-width: 0; font-size: 12.5px; color: var(--ink-2); }

.bs-blank {
  height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  font-size: 13px;
  color: var(--sub);
  background: var(--bg);
}

/* 预览弹窗顶部那条「这一版」：与分段控件同一行 */
.bs-switch-label { font-size: 12px; color: var(--sub); }
</style>
