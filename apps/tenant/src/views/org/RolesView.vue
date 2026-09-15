<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { AppIcon, showToast } from '@aiteach/shared'
import type { OrgRole } from '@aiteach/shared'
import { deleteRole, fetchRoles, saveRole } from '@/api/org'

const roles = ref<OrgRole[]>([])
const modules = ref<Array<{ key: string; title: string; ops: string[] }>>([])

const activeId = ref(0)
const active = computed(() => roles.value.find((row) => row.id === activeId.value) ?? roles.value[0] ?? null)

/** 本地编辑副本（未保存不落库） */
const permDraft = reactive<Record<string, string[]>>({})

async function load() {
  const data = await fetchRoles()
  roles.value = data.roles
  modules.value = data.modules
  if (!roles.value.some((row) => row.id === activeId.value)) activeId.value = roles.value[0]?.id ?? 0
  syncDraft()
}

function pick(row: OrgRole) {
  activeId.value = row.id
  syncDraft()
}

function syncDraft() {
  Object.keys(permDraft).forEach((key) => delete permDraft[key])
  if (active.value) Object.assign(permDraft, JSON.parse(JSON.stringify(active.value.perms)))
}

function togglePerm(moduleKey: string, op: string) {
  const list = permDraft[moduleKey] ?? []
  const pos = list.indexOf(op)
  if (pos >= 0) list.splice(pos, 1)
  else list.push(op)
  permDraft[moduleKey] = list
}

function toggleModuleAll(moduleKey: string, ops: string[]) {
  const list = permDraft[moduleKey] ?? []
  permDraft[moduleKey] = list.length === ops.length ? [] : [...ops]
}

/** 权限变化检测（保存按钮高亮提示） */
const dirty = computed(() => {
  if (!active.value) return false
  return modules.value.some(
    (m) => (permDraft[m.key] ?? []).join(',') !== (active.value.perms[m.key] ?? []).join(','),
  )
})

async function onSave() {
  if (!active.value) return
  try {
    await saveRole({ id: active.value.id, name: active.value.name, perms: JSON.parse(JSON.stringify(permDraft)) })
    await load()
    showToast('权限已保存，实时生效', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '保存失败', 'error')
  }
}

/* ===== 新增自定义角色 ===== */
const creating = ref('')
const newRoleName = ref('')

function openCreate() {
  newRoleName.value = ''
  creating.value = '新建自定义角色'
  // 以「老师」为模板初始化草稿
  const teacher = roles.value.find((row) => row.name === '老师')
  Object.keys(permDraft).forEach((key) => delete permDraft[key])
  if (teacher) Object.assign(permDraft, JSON.parse(JSON.stringify(teacher.perms)))
}

async function submitCreate() {
  if (newRoleName.value.trim().length < 2) {
    showToast('角色名称至少 2 个字', 'error')
    return
  }
  try {
    const created = await saveRole({ name: newRoleName.value.trim(), perms: JSON.parse(JSON.stringify(permDraft)) })
    creating.value = ''
    await load()
    activeId.value = created.id
    syncDraft()
    showToast('角色已创建', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '创建失败', 'error')
  }
}

async function onDelete() {
  if (!active.value) return
  if (!window.confirm(`删除角色「${active.value.name}」？`)) return
  try {
    await deleteRole(active.value.id)
    activeId.value = 0
    await load()
    showToast('已删除', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '删除失败', 'error')
  }
}

onMounted(load)
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h2>角色权限</h2>
      <span class="f-hint">预置角色可改权限不可删；「管理员」锁定防自锁；自定义角色可增删</span>
    </div>

    <div class="roles-layout">
      <!-- 左：角色列表 -->
      <div class="panel role-panel">
        <div class="section-title">
          角色（{{ roles.length }}）
          <button class="mini-btn" type="button" @click="openCreate"><AppIcon name="plus" :size="12" /> 新建</button>
        </div>
        <div class="role-list">
          <button
            v-for="row in roles"
            :key="row.id"
            class="role-item"
            :class="{ on: active?.id === row.id }"
            type="button"
            @click="pick(row)"
          >
            <span class="role-name">{{ row.name }}</span>
            <span v-if="row.builtin" class="tag tag-gray">预置</span>
            <span v-if="row.locked" class="tag tag-orange" title="防止失去管理权限，权限矩阵锁定">锁定</span>
          </button>
        </div>
      </div>

      <!-- 右：权限矩阵 -->
      <div class="panel matrix-panel">
        <template v-if="active">
          <div class="matrix-head">
            <h3>{{ active.name }}</h3>
            <div class="op-group">
              <button
                v-if="!active.builtin"
                class="mini-btn danger"
                @click="onDelete"
              >
                删除角色
              </button>
              <button class="btn btn-primary btn-sm" :disabled="active.locked || !dirty" @click="onSave">
                {{ active.locked ? '锁定不可修改' : dirty ? '保存修改' : '已保存' }}
              </button>
            </div>
          </div>
          <p v-if="active.locked" class="f-hint" style="margin-bottom: 12px">
            管理员角色拥有全部权限且锁定，避免误操作导致机构失去管理入口
          </p>
          <p v-else class="f-hint" style="margin-bottom: 12px">勾选各功能模块的操作权限，保存后对名下账号实时生效</p>

          <table class="data-table matrix-table">
            <thead>
              <tr>
                <th style="width: 160px">功能模块</th>
                <th>操作权限（点击勾选 / 取消）</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in modules" :key="m.key">
                <td class="cell-strong">{{ m.title }}</td>
                <td>
                  <div class="perm-row" :class="{ locked: active.locked }">
                    <button
                      v-for="op in m.ops"
                      :key="op"
                      class="perm-chip"
                      :class="{ on: (permDraft[m.key] ?? []).includes(op) }"
                      type="button"
                      :disabled="active.locked"
                      @click="togglePerm(m.key, op)"
                    >
                      <AppIcon name="check" :size="12" /> {{ op }}
                    </button>
                    <button
                      v-if="!active.locked"
                      class="mini-btn"
                      type="button"
                      style="margin-left: auto"
                      @click="toggleModuleAll(m.key, m.ops)"
                    >
                      全选/清空
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </template>
        <p v-else class="f-hint" style="padding: 30px">选择左侧角色</p>
      </div>
    </div>

    <!-- 新建角色 -->
    <div v-if="creating" class="modal-mask" @click.self="creating = ''">
      <div class="panel modal-box">
        <h3 class="modal-title">新建自定义角色</h3>
        <div class="f-field">
          <label class="f-label">角色名称<span class="req">*</span>（2-20 字，机构内唯一）</label>
          <input v-model="newRoleName" class="f-input" placeholder="如：教研组长" maxlength="20" />
        </div>
        <p class="f-hint" style="margin-bottom: 8px">初始权限已复制「老师」角色，创建后可在右侧矩阵调整：</p>
        <div class="perm-preview">
          <span v-for="m in modules" :key="m.key" class="f-hint">
            {{ m.title }}（{{ (permDraft[m.key] ?? []).length }}/{{ m.ops.length }}）
          </span>
        </div>
        <div class="modal-ops">
          <button class="btn btn-ghost" @click="creating = ''">取消</button>
          <button class="btn btn-primary" @click="submitCreate">创建</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.roles-layout { display: grid; grid-template-columns: 240px 1fr; gap: 14px; align-items: start; }

.role-panel { padding: 12px; }
.role-list { display: flex; flex-direction: column; gap: 6px; }
.role-item {
  display: flex; align-items: center; gap: 8px;
  border: 1.5px solid var(--border); border-radius: 10px; background: #fff;
  padding: 9px 12px; cursor: pointer; font-size: 13.5px; color: var(--ink-2);
}
.role-item:hover { border-color: var(--brand); }
.role-item.on { border-color: var(--brand); background: var(--brand-soft); color: var(--brand-deep); font-weight: 600; }
.role-name { flex: 1; text-align: left; }

.matrix-panel { padding: 16px 18px; }
.matrix-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
.matrix-head h3 { font-size: 16px; }
.matrix-table .perm-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.perm-row.locked { opacity: 0.75; }
.perm-chip {
  display: inline-flex; align-items: center; gap: 4px;
  border: 1.5px solid var(--border); border-radius: 999px; background: #fff;
  color: var(--sub); font-size: 12px; padding: 3px 11px;
}
.perm-chip.on { border-color: var(--brand); background: var(--brand-soft); color: var(--brand-deep); font-weight: 600; }
.perm-chip:disabled { cursor: not-allowed; }

.modal-mask {
  position: fixed; inset: 0; z-index: 120; background: rgba(20, 26, 40, 0.42);
  display: flex; align-items: center; justify-content: center;
}
.modal-box { width: 480px; padding: 20px 22px; }
.modal-title { font-size: 16px; margin-bottom: 14px; }
.perm-preview { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
.modal-ops { display: flex; justify-content: flex-end; gap: 10px; }
</style>
