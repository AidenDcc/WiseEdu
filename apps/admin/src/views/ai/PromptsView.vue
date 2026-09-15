<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { AppIcon, showToast, ApiError, PROMPT_SCENES, PROMPT_VARIABLES } from '@aiteach/shared'
import type { PromptTemplate } from '@aiteach/shared'
import AppModal from '@/components/ui/AppModal.vue'
import { fetchPrompts, rollbackPrompt, savePrompt, setDefaultPrompt, testPrompt, togglePrompt } from '@/api/platform'

const STATUS_TEXT: Record<PromptTemplate['status'], string> = {
  draft: '草稿',
  published: '已发布',
  disabled: '已停用',
}
const STATUS_CLASS: Record<PromptTemplate['status'], string> = {
  draft: 'tag-gray',
  published: 'tag-green',
  disabled: 'tag-red',
}

const list = ref<PromptTemplate[]>([])
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    list.value = await fetchPrompts()
  } finally {
    loading.value = false
  }
}

/** 收集模板正文里的未知变量（FR-PT-025） */
function unknownVars(content: string): string[] {
  const found = content.match(/\{\{[^}]+\}\}/g) ?? []
  const valid = PROMPT_VARIABLES.map((item) => item.key)
  return [...new Set(found.filter((token) => !valid.includes(token)))]
}

/* ===== 新增 / 编辑 ===== */
const editing = ref<PromptTemplate | 'new' | null>(null)
const form = reactive({ name: '', scene: PROMPT_SCENES[0], content: '' })
const formError = ref('')
const saving = ref(false)
const contentRef = ref<HTMLTextAreaElement | null>(null)

function openCreate() {
  editing.value = 'new'
  form.name = ''
  form.scene = PROMPT_SCENES[0]
  form.content = '你是一位{{subject}}名师，请为{{grade}}学生命制{{count}}道{{type}}，难度为{{difficulty}}，考查知识点：{{knowledge}}。'
  formError.value = ''
}

function openEdit(item: PromptTemplate) {
  editing.value = item
  form.name = item.name
  form.scene = item.scene
  form.content = item.content
  formError.value = ''
}

/** 点击变量标签插入到光标处 */
function insertVar(token: string) {
  const el = contentRef.value
  if (!el) {
    form.content += token
    return
  }
  const start = el.selectionStart ?? form.content.length
  const end = el.selectionEnd ?? start
  form.content = form.content.slice(0, start) + token + form.content.slice(end)
  requestAnimationFrame(() => {
    el.focus()
    el.setSelectionRange(start + token.length, start + token.length)
  })
}

async function save() {
  if (!form.name.trim()) {
    formError.value = '模板名称不能为空'
    return
  }
  const bad = unknownVars(form.content)
  if (bad.length > 0) {
    formError.value = `存在未知变量：${bad.join('、')}（仅允许 ${PROMPT_VARIABLES.map((v) => v.key).join(' / ')}）`
    return
  }
  saving.value = true
  try {
    await savePrompt({
      id: editing.value instanceof Object ? editing.value.id : undefined,
      name: form.name.trim(),
      scene: form.scene,
      content: form.content,
    })
    showToast('模板已保存，并写入版本历史', 'success')
    editing.value = null
    load()
  } catch (error) {
    formError.value = error instanceof ApiError ? error.message : '保存失败，请重试'
  } finally {
    saving.value = false
  }
}

/* ===== 状态 / 默认模板 ===== */
async function onToggle(item: PromptTemplate) {
  if (item.status === 'published' && !window.confirm(`停用「${item.name}」后机构端该场景将回退到默认模板，确认停用？`)) {
    return
  }
  try {
    await togglePrompt(item.id)
    showToast(item.status === 'draft' ? '已发布' : '已停用', 'success')
    load()
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : '操作失败', 'error')
  }
}

async function onSetDefault(item: PromptTemplate) {
  if (!window.confirm(`将「${item.name}」设为「${item.scene}」场景默认模板？同场景原默认模板将取消默认。`)) return
  try {
    await setDefaultPrompt(item.id)
    showToast('已设为默认模板', 'success')
    load()
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : '操作失败', 'error')
  }
}

/* ===== 测试运行（FR-PT-026） ===== */
const testing = ref<PromptTemplate | null>(null)
const testState = ref<'none' | 'running' | 'done'>('none')
const testResult = ref<{ output: string; costMs: number; tokens: number } | null>(null)

function openTest(item: PromptTemplate | 'new') {
  // 未保存的编辑内容需先保存才能测试：直接给出提示
  if (item === 'new') {
    showToast('请先保存模板后再测试运行', 'info')
    return
  }
  testing.value = item
  testState.value = 'none'
  testResult.value = null
}

async function runTest() {
  testState.value = 'running'
  testResult.value = await testPrompt()
  testState.value = 'done'
}

/* ===== 版本历史 / 回滚（FR-PT-027） ===== */
const historyOpen = ref<PromptTemplate | null>(null)
const rollingBack = ref(false)

async function rollback(version: number) {
  const item = historyOpen.value
  if (!item) return
  if (!window.confirm(`回滚到版本 v${version}？（将生成新版本，不物理覆盖）`)) return
  rollingBack.value = true
  try {
    const updated = await rollbackPrompt(item.id, version)
    Object.assign(item, updated)
    historyOpen.value = updated
    showToast(`已回滚到 v${version} 的内容（当前为 v${updated.versions.length}）`, 'success')
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : '回滚失败', 'error')
  } finally {
    rollingBack.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="panel">
    <div class="filter-bar">
      <span class="filter-label">变量占位符仅允许规定的 7 个；每个场景仅一个默认模板；停用回退默认</span>
      <button class="btn btn-primary btn-sm" style="margin-left: auto" @click="openCreate">
        <AppIcon name="plus" :size="15" /> 新增模板
      </button>
    </div>

    <div class="data-table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>模板名称</th>
            <th>适用场景</th>
            <th>状态</th>
            <th>默认</th>
            <th>最近更新</th>
            <th style="width: 280px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading && list.length === 0">
            <td colspan="6" class="empty-row">加载中…</td>
          </tr>
          <tr v-else-if="list.length === 0">
            <td colspan="6" class="empty-row">暂无模板</td>
          </tr>
          <template v-else>
            <tr v-for="item in list" :key="item.id">
              <td class="cell-strong">{{ item.name }}</td>
              <td><span class="tag tag-blue">{{ item.scene }}</span></td>
              <td><span class="tag" :class="STATUS_CLASS[item.status]">{{ STATUS_TEXT[item.status] }}</span></td>
              <td>
                <span v-if="item.isDefault" class="tag tag-green">默认</span>
                <span v-else style="color: var(--sub)">—</span>
              </td>
              <td class="time-cell">{{ item.updatedAt }}</td>
              <td>
                <div class="op-group">
                  <button class="mini-btn" type="button" @click="openEdit(item)">编辑</button>
                  <button class="mini-btn" type="button" @click="openTest(item)">测试</button>
                  <button
                    v-if="!item.isDefault && item.status !== 'disabled'"
                    class="mini-btn"
                    type="button"
                    @click="onSetDefault(item)"
                  >
                    设默认
                  </button>
                  <button class="mini-btn" type="button" @click="historyOpen = item">版本</button>
                  <button
                    v-if="item.status !== 'disabled'"
                    class="mini-btn danger"
                    type="button"
                    @click="onToggle(item)"
                  >
                    停用
                  </button>
                  <button v-else class="mini-btn" type="button" @click="onToggle(item)">发布</button>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <!-- 新增 / 编辑弹窗 -->
    <AppModal
      v-if="editing"
      :title="editing === 'new' ? '新增 Prompt 模板' : `编辑模板 · ${editing.name}`"
      :width="640"
      :close-on-mask="false"
      @close="editing = null"
    >
      <div class="form-grid">
        <div class="f-field">
          <label class="f-label">模板名称<span class="req">*</span></label>
          <input v-model="form.name" class="f-input" placeholder="如：数学出题-默认模板" />
        </div>
        <div class="f-field">
          <label class="f-label">适用场景<span class="req">*</span></label>
          <select v-model="form.scene" class="f-select">
            <option v-for="scene in PROMPT_SCENES" :key="scene" :value="scene">{{ scene }}</option>
          </select>
        </div>
      </div>
      <div class="f-field">
        <label class="f-label">模板正文<span class="req">*</span>（支持 <code v-pre>{{变量}}</code> 占位符）</label>
        <textarea
          ref="contentRef"
          v-model="form.content"
          class="f-textarea"
          rows="8"
          placeholder="你是一位{{subject}}名师…"
        />
      </div>
      <div class="var-bar">
        <span class="var-title">可用变量（点击插入光标处）：</span>
        <button v-for="v in PROMPT_VARIABLES" :key="v.key" class="var-chip" type="button" @click="insertVar(v.key)">
          {{ v.key }}<span class="var-desc">{{ v.desc }}</span>
        </button>
      </div>
      <p v-if="formError" class="form-err">{{ formError }}</p>
      <template #footer>
        <button class="btn btn-ghost btn-sm" @click="editing = null">取消</button>
        <button class="btn btn-primary btn-sm" :disabled="saving" @click="save">
          {{ saving ? '保存中…' : '保存（生成新版本）' }}
        </button>
      </template>
    </AppModal>

    <!-- 测试运行弹窗 -->
    <AppModal v-if="testing" :title="`测试运行 · ${testing.name}`" :width="620" @close="testing = null">
      <p class="test-meta">场景：{{ testing.scene }} · 使用已保存的最新版本内容与示例变量运行</p>
      <div v-if="testState === 'done' && testResult" class="test-output">
        <pre>{{ testResult.output }}</pre>
      </div>
      <div v-else-if="testState === 'running'" class="test-output running">运行中…</div>
      <div v-else class="test-output idle">点击下方按钮执行测试</div>
      <div v-if="testState === 'done' && testResult" class="test-stats">
        <span>耗时 {{ (testResult.costMs / 1000).toFixed(2) }} s</span>
        <span>消耗 {{ testResult.tokens }} tokens</span>
      </div>
      <template #footer>
        <button class="btn btn-ghost btn-sm" @click="testing = null">关闭</button>
        <button class="btn btn-primary btn-sm" :disabled="testState === 'running'" @click="runTest">
          {{ testState === 'running' ? '运行中…' : '运行测试' }}
        </button>
      </template>
    </AppModal>

    <!-- 版本历史 -->
    <AppModal v-if="historyOpen" :title="`版本历史 · ${historyOpen.name}`" :width="620" @close="historyOpen = null">
      <ul class="ver-list">
        <li v-for="version in [...historyOpen.versions].reverse()" :key="version.version">
          <div class="ver-head">
            <span class="tag tag-blue">v{{ version.version }}</span>
            <span class="ver-time">{{ version.savedAt }}</span>
            <button
              v-if="version.version !== historyOpen.versions.length"
              class="mini-btn"
              type="button"
              :disabled="rollingBack"
              @click="rollback(version.version)"
            >
              回滚到此版本
            </button>
            <span v-else class="tag tag-green">当前</span>
          </div>
          <pre class="ver-content">{{ version.content }}</pre>
        </li>
      </ul>
    </AppModal>
  </div>
</template>

<style scoped>
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 16px; }
.time-cell { font-size: 12.5px; color: var(--sub); white-space: nowrap; }

.var-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  background: #f8fafd;
  border-radius: 10px;
  padding: 8px 12px;
}
.var-title { font-size: 12px; color: var(--sub); }
.var-chip {
  border: 1px solid var(--border);
  border-radius: 999px;
  background: #fff;
  color: var(--brand);
  font-family: 'SF Mono', Menlo, monospace;
  font-size: 12px;
  padding: 3px 10px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.var-chip:hover { border-color: var(--brand); background: var(--brand-soft); }
.var-desc { color: var(--sub); font-family: inherit; margin-left: 5px; }

.form-err { font-size: 12px; color: var(--danger); margin: 10px 0 2px; }

.test-meta { font-size: 12.5px; color: var(--sub); margin-bottom: 10px; }
.test-output {
  background: #0f1729;
  color: #dbe4f5;
  border-radius: 10px;
  padding: 14px 16px;
  min-height: 180px;
  font-size: 12.5px;
  line-height: 1.8;
}
.test-output pre { white-space: pre-wrap; font-family: inherit; margin: 0; }
.test-output.running, .test-output.idle {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #7d8bab;
}
.test-stats {
  display: flex;
  gap: 16px;
  margin-top: 10px;
  font-size: 12.5px;
  color: var(--ink-2);
}

.ver-list { list-style: none; display: flex; flex-direction: column; gap: 10px; }
.ver-list li { border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; }
.ver-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.ver-time { font-size: 12px; color: var(--sub); flex: 1; }
.ver-content {
  background: #f8fafd;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--ink-2);
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
  max-height: 140px;
  overflow: auto;
}
</style>
