<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { AppIcon, showToast } from '@aiteach/shared'
import type { OrgFormula } from '@aiteach/shared'
import AppModal from '@/components/ui/AppModal.vue'
import FormulaPickerModal from '@/components/ui/FormulaPickerModal.vue'
import { deleteFormula, fetchFormulas, fetchTenantDict, saveFormula, shareFormula } from '@/api/org'

const formulas = ref<OrgFormula[]>([])
const subjects = ref<string[]>([])
const subject = ref('')

async function load() {
  formulas.value = await fetchFormulas()
}

onMounted(async () => {
  const [rows, dict] = await Promise.all([fetchFormulas(), fetchTenantDict('subject')])
  formulas.value = rows
  subjects.value = dict.map((item) => item.name)
})

/** 我的公式（scope === 'mine'，未分享），按学科学页签过滤 */
const mine = computed(() =>
  formulas.value.filter((row) => row.scope === 'mine' && (!subject.value || row.subject === subject.value)),
)

/* ===== 新建 / 编辑（FR-FX-002：LaTeX 语法校验由服务端执行） ===== */
const editing = ref<null | { id: number | null; name: string; subject: string; latex: string }>(null)
/** 是否打开公式编辑器（叠放在表单弹窗之上，确认后写回表单） */
const editorOpen = ref(false)

function openCreate() {
  editing.value = { id: null, name: '', subject: '', latex: '' }
}
function openEdit(row: OrgFormula) {
  editing.value = { id: row.id, name: row.name, subject: row.subject, latex: row.latex }
}

/** 行内公式预览：KaTeX 渲染，靠长相认公式 */
function renderPreview(source: string): string {
  try {
    return katex.renderToString(source, { throwOnError: false })
  } catch {
    return source
  }
}

function onEditorConfirm(latex: string) {
  if (editing.value) editing.value.latex = latex
  editorOpen.value = false
}

async function submit() {
  if (!editing.value) return
  if (!editing.value.subject) {
    showToast('请选择学科', 'error')
    return
  }
  try {
    await saveFormula({
      id: editing.value.id ?? undefined,
      name: editing.value.name,
      subject: editing.value.subject,
      latex: editing.value.latex,
    })
    editing.value = null
    showToast('已保存（LaTeX 校验通过）', 'success')
    load()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '保存失败', 'error')
  }
}

async function onShare(row: OrgFormula) {
  if (!window.confirm(`将「${row.name}」分享到机构共享库？提交后将进入审核`)) return
  const updated = await shareFormula(row.id)
  await load()
  showToast(
    updated.status === 'approved' ? '已直接上架（机构管理员身份免审）' : '已提交，等待机构管理员审核',
    'success',
  )
}

async function onDelete(row: OrgFormula) {
  if (!window.confirm(`删除公式「${row.name}」？`)) return
  await deleteFormula(row.id)
  showToast('已删除', 'success')
  load()
}

function onCopy(row: OrgFormula) {
  navigator.clipboard?.writeText(row.latex).catch(() => undefined)
  showToast('LaTeX 源码已复制', 'success')
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h2>我的公式</h2>
      <span class="f-hint">个人常用公式，用公式编辑器录入、经 LaTeX 校验后保存；分享需机构审核</span>
      <button class="btn btn-primary" style="margin-left: auto" @click="openCreate">
        <AppIcon name="plus" :size="15" /> 新建公式
      </button>
    </div>

    <div class="panel">
      <div class="subject-tabs">
        <button class="subj-tab" :class="{ on: subject === '' }" type="button" @click="subject = ''">
          全部
        </button>
        <button
          v-for="name in subjects"
          :key="name"
          class="subj-tab"
          :class="{ on: subject === name }"
          type="button"
          @click="subject = name"
        >
          {{ name }}
        </button>
      </div>

      <table class="data-table">
        <thead>
          <tr>
            <th>公式名称</th>
            <th style="width: 76px">学科</th>
            <th class="th-preview">公式</th>
            <th style="width: 100px">更新时间</th>
            <th style="width: 260px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="mine.length === 0">
            <td colspan="5" class="empty-row">{{ subject ? `「${subject}」暂无个人公式` : '暂无个人公式，点击右上角新建' }}</td>
          </tr>
          <template v-else>
            <tr v-for="row in mine" :key="row.id">
              <td class="cell-strong">{{ row.name }}</td>
              <td><span class="tag tag-gray">{{ row.subject }}</span></td>
              <td><span class="cell-preview" v-html="renderPreview(row.latex)" /></td>
              <td>{{ row.updatedAt }}</td>
              <td>
                <div class="op-group">
                  <button class="mini-btn" @click="onCopy(row)">复制</button>
                  <button class="mini-btn" @click="openEdit(row)">编辑</button>
                  <button class="mini-btn success" @click="onShare(row)">分享到机构</button>
                  <button class="mini-btn danger" @click="onDelete(row)">删除</button>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <!-- 新建 / 编辑表单 -->
    <AppModal v-if="editing" :title="editing.id ? '编辑公式' : '新建公式'" :width="560" @close="editing = null">
      <div class="f-field row2">
        <div>
          <label class="f-label">公式名称<span class="req">*</span>（2-20 字）</label>
          <input v-model="editing.name" class="f-input" maxlength="20" />
        </div>
        <div>
          <label class="f-label">学科<span class="req">*</span></label>
          <select v-model="editing.subject" class="f-select">
            <option value="" disabled>请选择学科</option>
            <option v-for="name in subjects" :key="name">{{ name }}</option>
          </select>
        </div>
      </div>
      <div class="f-field">
        <label class="f-label">公式<span class="req">*</span></label>
        <div v-if="editing.latex" class="form-preview" v-html="renderPreview(editing.latex)" />
        <p v-else class="f-hint" style="margin-bottom: 8px">尚未录入公式</p>
        <button class="btn btn-ghost" type="button" @click="editorOpen = true">
          <AppIcon name="formula" :size="15" />
          {{ editing.latex ? '重新打开公式编辑器' : '打开公式编辑器' }}
        </button>
        <p class="f-hint">公式编辑器支持分类符号面板（分数、根式、积分、矩阵等）与公式库插入，保存时自动校验花括号 / 定界符配对</p>
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="editing = null">取消</button>
        <button class="btn btn-primary" @click="submit">保存</button>
      </template>
    </AppModal>

    <!-- 公式编辑器（叠放在表单弹窗之上，确认后写回表单） -->
    <FormulaPickerModal
      v-if="editing && editorOpen"
      :subject="editing.subject"
      :initial-latex="editing.latex"
      editing
      @close="editorOpen = false"
      @confirm="onEditorConfirm"
    />
  </div>
</template>

<style scoped>
.subject-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.subj-tab {
  border: 1.5px solid var(--border);
  border-radius: 9px;
  background: #fff;
  color: var(--ink-2);
  font-size: 13px;
  font-weight: 600;
  padding: 6px 14px;
  transition: all 0.15s;
}
.subj-tab:hover { border-color: var(--brand); color: var(--brand-deep); }
.subj-tab.on { border-color: var(--brand); background: var(--brand-soft); color: var(--brand-deep); }

.th-preview { min-width: 260px; }
.cell-preview {
  display: inline-flex;
  align-items: center;
  max-width: 420px;
  overflow-x: auto;
  font-size: 15px;
  color: var(--ink);
}
.form-preview {
  min-height: 46px;
  display: flex;
  align-items: center;
  overflow-x: auto;
  background: #f7fafa;
  border-radius: 10px;
  padding: 8px 12px;
  margin-bottom: 10px;
  font-size: 15px;
  color: var(--ink);
}
.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
</style>
