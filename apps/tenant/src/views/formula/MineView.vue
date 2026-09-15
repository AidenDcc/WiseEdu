<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { AppIcon, showToast } from '@aiteach/shared'
import type { OrgFormula } from '@aiteach/shared'
import AppModal from '@/components/ui/AppModal.vue'
import { deleteFormula, fetchFormulas, saveFormula, shareFormula } from '@/api/org'

const formulas = ref<OrgFormula[]>([])

async function load() {
  formulas.value = await fetchFormulas()
}

/** 我的公式（scope === 'mine'，未分享） */
const mine = computed(() => formulas.value.filter((row) => row.scope === 'mine'))

/* ===== 新建 / 编辑（FR-FX-002：LaTeX 语法校验由服务端执行） ===== */
const editing = ref<null | { id: number | null; name: string; category: string; latex: string }>(null)
const CATEGORIES = ['函数与导数', '数列', '立体几何', '解析几何', '三角恒等变换', '概率统计', '未分类']

function openCreate() {
  editing.value = { id: null, name: '', category: '未分类', latex: '' }
}
function openEdit(row: OrgFormula) {
  editing.value = { id: row.id, name: row.name, category: row.category, latex: row.latex }
}

async function submit() {
  if (!editing.value) return
  try {
    await saveFormula({
      id: editing.value.id ?? undefined,
      name: editing.value.name,
      category: editing.value.category,
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

onMounted(load)
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h2>我的公式</h2>
      <span class="f-hint">个人常用公式，经 LaTeX 校验后保存；分享需机构审核</span>
      <button class="btn btn-primary" style="margin-left: auto" @click="openCreate">
        <AppIcon name="plus" :size="15" /> 新建公式
      </button>
    </div>

    <div class="panel">
      <table class="data-table">
        <thead>
          <tr>
            <th>公式名称</th>
            <th>分类</th>
            <th>LaTeX 源码</th>
            <th>更新时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="mine.length === 0">
            <td colspan="5" class="empty-row">暂无个人公式，点击右上角新建</td>
          </tr>
          <template v-else>
            <tr v-for="row in mine" :key="row.id">
              <td class="cell-strong">{{ row.name }}</td>
              <td><span class="tag tag-gray">{{ row.category }}</span></td>
              <td><code class="latex-cell">{{ row.latex }}</code></td>
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

    <AppModal v-if="editing" :title="editing.id ? '编辑公式' : '新建公式'" :width="520" @close="editing = null">
      <div class="f-field row2">
        <div>
          <label class="f-label">公式名称<span class="req">*</span>（2-20 字）</label>
          <input v-model="editing.name" class="f-input" maxlength="20" />
        </div>
        <div>
          <label class="f-label">分类</label>
          <select v-model="editing.category" class="f-select">
            <option v-for="c in CATEGORIES" :key="c">{{ c }}</option>
          </select>
        </div>
      </div>
      <div class="f-field">
        <label class="f-label">LaTeX 源码<span class="req">*</span></label>
        <textarea
          v-model="editing.latex"
          class="f-textarea mono"
          rows="3"
          placeholder="如：a_n = a_1 + (n-1)d（保存时自动校验花括号 / 定界符配对）"
        />
        <p class="f-hint">保存时执行语法校验（括号配对等），录题 / 组卷时可快速插入</p>
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="editing = null">取消</button>
        <button class="btn btn-primary" @click="submit">保存</button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.latex-cell {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px; color: var(--brand-deep);
}
.mono { font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 12.5px; }
</style>
