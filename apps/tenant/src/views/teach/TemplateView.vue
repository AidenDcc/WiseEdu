<script setup lang="ts">
/**
 * 备课中心 · 教案 / 学案 / 讲义**模板维护**。
 *
 * 三类模板共用一页，用顶部的分段切换换类型 —— 它们的字段与操作完全一致（名称、说明、适用范围、
 * 正文骨架、默认项、启停），分成三个页面只会让「切过去看一眼」变成「在侧边栏里找另一个菜单」。
 *
 * 几个刻意的产品取舍：
 * - **默认模板同类型只能有一条**（后端保证），列表上以「默认」标签标出，且默认模板不能停用 ——
 *   否则「新建文档时预选哪一份」就没有答案了。
 * - **系统预置模板可改正文、可停用，但不能删也不能改名**：它们是「每类至少有一套骨架」的兜底。
 * - 「复制」是把当前正文带进新建对话框，而不是直接落库 —— 从某份模板派生时，名字通常也要改。
 */
import { computed, onMounted, ref, watch } from 'vue'
import {
  AppIcon,
  AppModal,
  AppPageHeader,
  RichTextViewer,
  TEACH_TEMPLATE_KIND_TEXT,
  appConfirm,
  showToast,
} from '@aiteach/shared'
import type { TeachTemplate, TeachTemplateKind } from '@aiteach/shared'
import {
  deleteTeachTemplate,
  fetchTeachTemplates,
  setDefaultTeachTemplate,
  toggleTeachTemplate,
} from '@/api/org'
import TemplateEditDialog from '@/components/doc/TemplateEditDialog.vue'

const KINDS: TeachTemplateKind[] = ['plan', 'guide', 'lecture']

/** 每类模板的用途提示：切类型时页面上的说明随之变化，不必让用户自己去猜这一页在管什么 */
const KIND_HINT: Record<TeachTemplateKind, string> = {
  plan: '教案模板决定「教学目标 → 重难点 → 教学过程 → 板书 → 反思」的骨架，教学过程按环节预置。',
  guide: '学案模板决定「预习导学 → 课堂探究 → 达标检测 → 拓展提升」的骨架，学生按它自学与当堂检测。',
  lecture: '讲义模板决定「目标 → 讲解 → 例题 → 练习 → 小结 → 作业」的骨架，是发给学生看的讲解稿。',
}

const kind = ref<TeachTemplateKind>('plan')
const templates = ref<TeachTemplate[]>([])
const loading = ref(true)

async function load() {
  loading.value = true
  try {
    templates.value = await fetchTeachTemplates(kind.value)
  } catch {
    showToast('模板加载失败', 'error')
  } finally {
    loading.value = false
  }
}

onMounted(load)
/* 切类型就重新拉：模板按类型分别取，一次拿全部再前端筛会多传三类正文（每份都不小） */
watch(kind, load)

/* ================= 新建 / 编辑 ================= */

const editOpen = ref(false)
const editing = ref<TeachTemplate | null>(null)
const presetContent = ref<string | undefined>(undefined)

function openCreate() {
  editing.value = null
  presetContent.value = undefined
  editOpen.value = true
}

/** 从某份模板派生：把它的正文带进新建对话框（名字也补一个「（副本）」提示） */
function openCopy(row: TeachTemplate) {
  editing.value = null
  presetContent.value = row.content
  copyFrom.value = row
  editOpen.value = true
}
const copyFrom = ref<TeachTemplate | null>(null)

function openEdit(row: TeachTemplate) {
  editing.value = row
  presetContent.value = undefined
  copyFrom.value = null
  editOpen.value = true
}

/** 新建时若带了一份「派生源」，就把名字填成「XX（副本）」——用户通常第一件事就是改名 */
function initialName(): string {
  if (editing.value) return editing.value.name
  if (copyFrom.value) return `${copyFrom.value.name}（副本）`.slice(0, 30)
  return ''
}

async function onSaved() {
  editOpen.value = false
  copyFrom.value = null
  await load()
}

/* ================= 行操作 ================= */

async function onSetDefault(row: TeachTemplate) {
  try {
    await setDefaultTeachTemplate(row.id)
    await load()
    showToast(`已将「${row.name}」设为${TEACH_TEMPLATE_KIND_TEXT[kind.value]}默认模板`, 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '操作失败', 'error')
  }
}

async function onToggle(row: TeachTemplate) {
  try {
    const next = await toggleTeachTemplate(row.id)
    await load()
    showToast(next.enabled ? '模板已启用' : '模板已停用（新建时不再出现）', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '操作失败', 'error')
  }
}

async function onDelete(row: TeachTemplate) {
  if (!(await appConfirm(`删除模板「${row.name}」？已用它的文档不受影响。`, { type: 'danger' }))) return
  try {
    await deleteTeachTemplate(row.id)
    await load()
    showToast('模板已删除', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '删除失败', 'error')
  }
}

/* ================= 预览 ================= */

const previewOpen = ref(false)
const previewing = ref<TeachTemplate | null>(null)

function openPreview(row: TeachTemplate) {
  previewing.value = row
  previewOpen.value = true
}

const defaultName = computed(() => templates.value.find((row) => row.isDefault)?.name ?? '未设置')
</script>

<template>
  <div class="page">
    <AppPageHeader :desc="KIND_HINT[kind]">
      <template #actions>
        <button class="btn btn-primary" @click="openCreate">
          <AppIcon name="plus" :size="15" /> 新建{{ TEACH_TEMPLATE_KIND_TEXT[kind] }}模板
        </button>
      </template>
    </AppPageHeader>

    <!-- 类型切换：三段分段控件（读作「现在在管哪一类模板」） -->
    <div class="tv-switch">
      <button
        v-for="row in KINDS"
        :key="row"
        class="tv-seg"
        :class="{ on: kind === row }"
        type="button"
        @click="kind = row"
      >
        {{ TEACH_TEMPLATE_KIND_TEXT[row] }}模板
      </button>
      <span class="tv-default">当前默认：<b>{{ defaultName }}</b></span>
    </div>

    <div class="panel">
      <div class="tv-grid">
        <article v-for="row in templates" :key="row.id" class="tv-card" :class="{ off: !row.enabled }">
          <div class="tv-card-top">
            <h3>{{ row.name }}</h3>
            <div class="tv-tags">
              <span v-if="row.isDefault" class="tag tag-blue">默认</span>
              <span v-if="row.builtin" class="tag tag-gray">预置</span>
              <span v-if="row.scope === 'org'" class="tag tag-green">机构</span>
              <span v-else class="tag tag-gray">个人</span>
              <span v-if="!row.enabled" class="tag tag-orange">已停用</span>
            </div>
          </div>

          <p class="tv-desc">{{ row.desc || '（无用途说明）' }}</p>

          <p class="tv-meta">
            <template v-if="row.subject || row.grade">
              {{ [row.grade, row.subject].filter(Boolean).join(' · ') }}
              <template v-if="row.periods"> · 建议 {{ row.periods }} 课时</template>
              ·
            </template>
            {{ row.owner }} · {{ row.updatedAt }}
          </p>

          <div class="op-group tv-ops">
            <button class="mini-btn" @click="openEdit(row)">编辑</button>
            <button class="mini-btn" @click="openPreview(row)">预览</button>
            <button class="mini-btn" @click="openCopy(row)">复制</button>
            <button v-if="!row.isDefault" class="mini-btn" @click="onSetDefault(row)">设为默认</button>
            <button class="mini-btn" @click="onToggle(row)">{{ row.enabled ? '停用' : '启用' }}</button>
            <button class="mini-btn danger" :disabled="row.builtin" @click="onDelete(row)">删除</button>
          </div>
        </article>
      </div>

      <p v-if="!templates.length" class="empty-row">
        {{ loading ? '正在载入…' : `暂无${TEACH_TEMPLATE_KIND_TEXT[kind]}模板，点击右上角新建` }}
      </p>
    </div>

    <!-- ================= 模板编辑器 ================= -->
    <TemplateEditDialog
      v-if="editOpen"
      :key="editing?.id ?? `new-${copyFrom?.id ?? 0}`"
      :kind="kind"
      :template="editing"
      :preset-content="presetContent"
      :preset-name="initialName()"
      @close="editOpen = false"
      @saved="onSaved"
    />

    <!-- ================= 骨架预览 ================= -->
    <AppModal v-if="previewOpen && previewing" :title="`骨架预览 · ${previewing.name}`" :width="760" @close="previewOpen = false">
      <p class="tv-preview-lead">
        新建{{ TEACH_TEMPLATE_KIND_TEXT[kind] }}时会把下面这份正文填进去，标题层级即为左侧目录的层级。
      </p>
      <article class="tv-preview rte-content">
        <RichTextViewer :content="previewing.content" empty="（该模板正文为空）" />
      </article>
    </AppModal>
  </div>
</template>

<style scoped>
.tv-switch {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 14px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 11px;
  background: var(--card);
  width: fit-content;
}
.tv-seg {
  height: 32px;
  padding: 0 16px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--ink-2);
  font-size: 13px;
  transition: background 0.15s, color 0.15s;
}
.tv-seg:hover { background: #f2f4fa; }
.tv-seg.on { background: var(--brand-grad); color: #fff; font-weight: 600; }
.tv-default { margin-left: 8px; font-size: 12.5px; color: var(--sub); }
.tv-default b { color: var(--brand-deep); }

.tv-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; padding: 18px; }
.tv-card {
  border: 1.5px solid var(--border);
  border-radius: 12px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.tv-card:hover { border-color: var(--brand); box-shadow: var(--shadow); }
/* 停用的模板压暗而不是隐藏 —— 管理员要看得见「有哪几份被停用了」 */
.tv-card.off { background: #fafbfd; }
.tv-card.off h3 { color: var(--sub); }

.tv-card-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.tv-card-top h3 { font-size: 14px; font-weight: 700; line-height: 1.5; }
.tv-tags { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 4px; flex-shrink: 0; }
.tv-desc { font-size: 12.5px; color: var(--ink-2); line-height: 1.7; }
.tv-meta { font-size: 11.5px; color: var(--sub); }
.tv-ops { flex-wrap: wrap; margin-top: auto; }
.tv-ops .mini-btn:disabled { opacity: 0.45; cursor: not-allowed; }

.tv-preview-lead { font-size: 12.5px; color: var(--sub); line-height: 1.75; margin-bottom: 12px; }
.tv-preview {
  padding: 4px 2px;
  font-size: 13.5px;
  line-height: 1.9;
  color: var(--ink);
  max-height: 62vh;
  overflow-y: auto;
}
.tv-preview :deep(h1) { font-size: 19px; text-align: center; margin: 6px 0 14px; }
.tv-preview :deep(h2) { font-size: 16px; margin: 16px 0 7px; }
.tv-preview :deep(h3) { font-size: 14.5px; margin: 12px 0 6px; }
</style>
