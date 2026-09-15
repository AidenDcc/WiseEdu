<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { AppIcon, ORG_PROMPT_SCENES, showToast } from '@aiteach/shared'
import type { OrgPrompt } from '@aiteach/shared'
import AppModal from '@/components/ui/AppModal.vue'
import AppDrawer from '@/components/ui/AppDrawer.vue'
import {
  copyPlatformPrompt,
  deleteOrgPrompt,
  fetchOrgPrompts,
  fetchPlatformPrompts,
  rollbackOrgPrompt,
  saveOrgPrompt,
  setDefaultOrgPrompt,
  testOrgPrompt,
  toggleOrgPrompt,
} from '@/api/org'

type TabKey = 'platform' | 'org'
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'platform', label: '平台标准模板' },
  { key: 'org', label: '机构自定义模板' },
]
const tab = ref<TabKey>('platform')

/** 可用变量（FR-PM-003） */
const VARS = ['{{subject}}', '{{grade}}', '{{type}}', '{{difficulty}}', '{{knowledge}}', '{{stem}}', '{{count}}']

const platform = ref<Array<{ id: number; name: string; scene: string; content: string }>>([])
const orgPrompts = ref<OrgPrompt[]>([])

async function load() {
  ;[platform.value, orgPrompts.value] = await Promise.all([fetchPlatformPrompts(), fetchOrgPrompts()])
}

/* ===== 平台模板：只读 + 复制 ===== */
const viewing = ref<{ name: string; scene: string; content: string } | null>(null)

async function onCopy(id: number) {
  try {
    await copyPlatformPrompt(id)
    await load()
    tab.value = 'org'
    showToast('已复制为机构模板，可自由修改', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '复制失败', 'error')
  }
}

/* ===== 机构模板 ===== */
const editing = ref<null | (Pick<OrgPrompt, 'name' | 'content' | 'scene'> & { id: number | null; remark: string })>(null)

function openCreate() {
  editing.value = { id: null, name: '', scene: ORG_PROMPT_SCENES[0], content: '', remark: '' }
}
function openEdit(row: OrgPrompt) {
  editing.value = { id: row.id, name: row.name, scene: row.scene, content: row.content, remark: row.remark ?? '' }
}

async function submit() {
  if (!editing.value) return
  try {
    await saveOrgPrompt({
      id: editing.value.id ?? undefined,
      name: editing.value.name,
      scene: editing.value.scene,
      content: editing.value.content,
      remark: editing.value.remark,
    })
    editing.value = null
    showToast('已保存（变量校验通过，新版本已入历史）', 'success')
    load()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '保存失败', 'error')
  }
}

async function onToggle(row: OrgPrompt) {
  try {
    await toggleOrgPrompt(row.id)
    await load()
    showToast('状态已切换', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '操作失败', 'error')
  }
}

async function onSetDefault(row: OrgPrompt) {
  await setDefaultOrgPrompt(row.id)
  await load()
  showToast(`「${row.name}」已设为该场景默认（同场景其他模板自动让位）`, 'success')
}

/* ===== 测试运行（消耗额度） ===== */
const testing = ref<OrgPrompt | null>(null)
const testResult = ref<{ output: string; costMs: number; tokens: number } | null>(null)
const testRunning = ref(false)

async function runTest() {
  if (!testing.value) return
  testRunning.value = true
  try {
    testResult.value = await testOrgPrompt()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '测试失败', 'error')
  } finally {
    testRunning.value = false
  }
}

/* ===== 版本历史 ===== */
const versionTarget = ref<OrgPrompt | null>(null)

async function onRollback(version: number) {
  if (!versionTarget.value) return
  if (!window.confirm(`回滚到 v${version}？当前内容将存为新版本`)) return
  await rollbackOrgPrompt(versionTarget.value.id, version)
  versionTarget.value = null
  await load()
  showToast(`已回滚到 v${version}`, 'success')
}

async function onDelete(row: OrgPrompt) {
  if (!window.confirm(`删除模板「${row.name}」？`)) return
  try {
    await deleteOrgPrompt(row.id)
    await load()
    showToast('已删除', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '删除失败', 'error')
  }
}

const orgFiltered = computed(() => orgPrompts.value)

onMounted(load)
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h2>提示词模板</h2>
      <span class="f-hint">平台标准模板只读可复制；机构自定义模板支持版本 / 启停 / 默认 / 测试</span>
    </div>

    <div class="tab-bar">
      <button
        v-for="t in TABS"
        :key="t.key"
        class="tab-btn"
        :class="{ on: tab === t.key }"
        type="button"
        @click="tab = t.key"
      >
        {{ t.label }}
      </button>
    </div>

    <!-- 平台标准模板 -->
    <div v-if="tab === 'platform'" class="panel">
      <table class="data-table">
        <thead>
          <tr>
            <th>模板名称</th>
            <th>适用场景</th>
            <th>内容摘要</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in platform" :key="row.id">
            <td class="cell-strong">{{ row.name }}<span class="tag tag-blue" style="margin-left: 6px">平台</span></td>
            <td>{{ row.scene }}</td>
            <td class="content-cell">{{ row.content.slice(0, 56) }}…</td>
            <td>
              <div class="op-group">
                <button class="mini-btn" @click="viewing = row">查看</button>
                <button class="mini-btn success" @click="onCopy(row.id)">复制为机构模板</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 机构自定义模板 -->
    <div v-else class="panel">
      <div class="filter-bar">
        <span class="f-hint">{{ orgFiltered.length }} 个模板 · 每场景仅一个「默认启用」，供 AI 功能自动调用</span>
        <button class="btn btn-primary btn-sm" style="margin-left: auto" @click="openCreate">
          <AppIcon name="plus" :size="14" /> 新建模板
        </button>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>模板名称</th>
            <th>场景</th>
            <th>状态</th>
            <th>更新时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="orgFiltered.length === 0">
            <td colspan="5" class="empty-row">暂无机构模板，可从平台模板复制或新建</td>
          </tr>
          <template v-else>
            <tr v-for="row in orgFiltered" :key="row.id">
              <td class="cell-strong">
                {{ row.name }}
                <span v-if="row.isDefault" class="tag tag-green" style="margin-left: 6px">默认</span>
              </td>
              <td>{{ row.scene }}</td>
              <td>
                <span class="tag" :class="row.status === 'enabled' ? 'tag-green' : 'tag-gray'">
                  {{ row.status === 'enabled' ? '启用' : '停用' }}
                </span>
              </td>
              <td>{{ row.updatedAt }}</td>
              <td>
                <div class="op-group">
                  <button class="mini-btn" @click="openEdit(row)">编辑</button>
                  <button class="mini-btn" @click="testing = row; testResult = null">测试</button>
                  <button class="mini-btn" @click="versionTarget = row">版本</button>
                  <button class="mini-btn" @click="onToggle(row)">{{ row.status === 'enabled' ? '停用' : '启用' }}</button>
                  <button v-if="!row.isDefault" class="mini-btn success" @click="onSetDefault(row)">设默认</button>
                  <button class="mini-btn danger" @click="onDelete(row)">删除</button>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <!-- 查看平台模板 -->
    <AppDrawer v-if="viewing" :title="viewing.name" :subtitle="`场景：${viewing.scene}（平台标准，只读）`" :width="520" @close="viewing = null">
      <pre class="prompt-pre">{{ viewing.content }}</pre>
    </AppDrawer>

    <!-- 编辑机构模板 -->
    <AppModal v-if="editing" :title="editing.id ? '编辑模板' : '新建模板'" :width="620" @close="editing = null">
      <div class="f-field row2">
        <div>
          <label class="f-label">模板名称<span class="req">*</span></label>
          <input v-model="editing.name" class="f-input" placeholder="机构内唯一" />
        </div>
        <div>
          <label class="f-label">适用场景</label>
          <select v-model="editing.scene" class="f-select" :disabled="!!editing.id">
            <option v-for="s in ORG_PROMPT_SCENES" :key="s">{{ s }}</option>
          </select>
        </div>
      </div>
      <div class="f-field">
        <label class="f-label">提示词内容<span class="req">*</span></label>
        <textarea v-model="editing.content" class="f-textarea mono" rows="6" placeholder="输入提示词，插入下方变量…" />
        <div class="var-bar">
          <span class="f-hint">点击插入变量：</span>
          <button v-for="v in VARS" :key="v" class="var-chip" type="button" @click="editing.content += v">{{ v }}</button>
        </div>
        <p class="f-hint">保存时校验变量合法性（未知变量将拒绝），每次保存生成一个历史版本</p>
      </div>
      <div class="f-field">
        <label class="f-label">备注</label>
        <input v-model="editing.remark" class="f-input" placeholder="如：结合本校命题风格（选填）" />
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="editing = null">取消</button>
        <button class="btn btn-primary" @click="submit">保存</button>
      </template>
    </AppModal>

    <!-- 测试运行 -->
    <AppModal v-if="testing" :title="`测试运行 · ${testing.name}`" :width="560" @close="testing = null">
      <p class="f-hint" style="margin-bottom: 10px">将以当前模板内容 + 示例变量实参调用 AI（消耗 1 次额度）</p>
      <pre class="prompt-pre">{{ testing.content }}</pre>
      <button class="btn btn-primary btn-sm" :disabled="testRunning" style="margin: 10px 0" @click="runTest">
        {{ testRunning ? '运行中…' : '运行测试' }}
      </button>
      <template v-if="testResult">
        <div class="test-meta">
          <span>耗时 {{ testResult.costMs }} ms</span>
          <span>Tokens {{ testResult.tokens }}</span>
        </div>
        <pre class="prompt-pre result">{{ testResult.output }}</pre>
      </template>
    </AppModal>

    <!-- 版本历史 -->
    <AppModal v-if="versionTarget" :title="`版本历史 · ${versionTarget.name}`" :width="560" @close="versionTarget = null">
      <p v-if="!versionTarget.versions.length" class="f-hint">暂无历史版本</p>
      <div v-for="v in [...versionTarget.versions].reverse()" :key="`${v.version}-${v.savedAt}`" class="version-row">
        <span class="tag tag-blue">v{{ v.version }}</span>
        <span class="f-hint">{{ v.savedAt }}</span>
        <code class="version-content">{{ v.content.slice(0, 60) }}…</code>
        <button class="mini-btn" style="margin-left: auto" @click="onRollback(v.version)">回滚到此版</button>
      </div>
    </AppModal>
  </div>
</template>

<style scoped>
.tab-bar { display: flex; gap: 4px; margin-bottom: 14px; border-bottom: 1px solid var(--border); }
.tab-btn {
  border: none; background: transparent; padding: 9px 16px;
  font-size: 13.5px; color: var(--sub); border-bottom: 2.5px solid transparent;
  margin-bottom: -1px;
}
.tab-btn.on { color: var(--brand-deep); font-weight: 600; border-bottom-color: var(--brand); }

.content-cell { max-width: 340px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.prompt-pre {
  background: #f6f9f9; border-radius: 10px; padding: 12px 14px;
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12.5px; color: var(--ink-2); line-height: 1.8; white-space: pre-wrap;
}
.prompt-pre.result { border: 1px solid var(--border); background: #fff; }

.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.mono { font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 12.5px; }

.var-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.var-chip {
  border: 1.5px dashed var(--brand); border-radius: 7px; background: var(--brand-soft);
  color: var(--brand-deep); font-family: 'SF Mono', Menlo, monospace; font-size: 11.5px; padding: 2px 8px;
}

.test-meta { display: flex; gap: 14px; font-size: 12px; color: var(--sub); margin-bottom: 8px; }

.version-row {
  display: flex; align-items: center; gap: 10px;
  border: 1px solid var(--border); border-radius: 10px; padding: 9px 12px; margin-bottom: 8px;
}
.version-content { font-size: 11.5px; color: var(--sub); font-family: 'SF Mono', Menlo, monospace; }
</style>
