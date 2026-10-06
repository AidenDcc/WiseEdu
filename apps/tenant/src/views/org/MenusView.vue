<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { AppIcon, AppPageHeader, appConfirm, showToast } from '@aiteach/shared'
import AppSwitch from '@/components/ui/AppSwitch.vue'
import { fetchOrgMenus, saveOrgMenus } from '@/api/org'
import type { OrgMenuNodeApi } from '@/api/org'
import { useVisibleMenus } from '@/composables/useVisibleMenus'

const { refresh: refreshMenus } = useVisibleMenus()

const menus = ref<OrgMenuNodeApi[]>([])
const dirty = ref(false)
const saving = ref(false)

async function load() {
  menus.value = await fetchOrgMenus()
  dirty.value = false
}

/** 已启用菜单数统计 */
const enabledCount = computed(() =>
  menus.value.reduce((sum, group) => sum + 1 + (group.children ?? []).filter((child) => child.enabled).length, 0),
)
const totalCount = computed(() => menus.value.reduce((sum, group) => sum + 1 + (group.children ?? []).length, 0))

/**
 * 受锁的两种原因，界面上要给不同的说法 —— 都写成「套餐约束」会让用户去问超管，
 * 而「机构管理」其实是自己关不得：
 * - `platformLocked`：平台套餐没开通，得找超管；
 * - `locked`：关掉之后没人能再进来打开（如机构管理），系统强制保持开启。
 */
function lockText(node: { platformLocked?: boolean; locked?: boolean }): string {
  if (node.platformLocked) return '套餐约束'
  if (node.locked) return '系统必需'
  return ''
}

function onGroupChange(group: OrgMenuNodeApi, value: boolean) {
  if (group.platformLocked || group.locked) {
    showToast(
      group.platformLocked
        ? `「${group.title}」受平台套餐约束，需超级管理员在套餐中开通`
        : `「${group.title}」关闭后将无法再进入本页重新开启，系统保持其开启`,
      'error',
    )
    return
  }
  group.enabled = value
  ;(group.children ?? []).forEach((child) => {
    child.enabled = value
  })
  dirty.value = true
}

function onChildChange(
  group: OrgMenuNodeApi,
  child: { key: string; title: string; enabled: boolean; locked?: boolean },
  value: boolean,
) {
  if (child.locked) {
    showToast(`「${child.title}」关闭后将无法再进入本页重新开启，系统保持其开启`, 'error')
    return
  }
  child.enabled = value
  // 任一子项开启 → 父组开启；全部关闭 → 父组保持开启但无子项（演示允许）
  if (value && !group.enabled) group.enabled = true
  dirty.value = true
}

async function onSave() {
  saving.value = true
  try {
    await saveOrgMenus(JSON.parse(JSON.stringify(menus.value)))
    dirty.value = false
    /* 保存完立刻重拉：侧边栏读的是同一份内存树，但**本地这份 draft 和服务端刚做的
       强制修正（锁定分组一律打回开启）可能不一致**，重拉一次让界面与真实生效的一致。 */
    await refreshMenus()
    await load()
    showToast('菜单权限已保存，员工端侧边栏即时生效', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '保存失败', 'error')
  } finally {
    saving.value = false
  }
}

async function onReset() {
  if (dirty.value && !(await appConfirm('放弃未保存的修改？', { type: 'danger' }))) return
  load()
}

onMounted(load)
</script>

<template>
  <div class="page">
    <AppPageHeader desc="控制员工端可见的侧边栏菜单；带锁标记的不可关闭（「套餐约束」需超管开通，「系统必需」关闭后将无法再进入本页）" />

    <div class="panel menu-panel">
      <div class="menu-stats">
        <AppIcon name="menu" :size="16" />
        <span>已启用 {{ enabledCount }} / {{ totalCount }} 个菜单项</span>
        <span class="f-hint">关闭后员工登录将不再显示对应入口，历史数据保留</span>
      </div>

      <div class="menu-list">
        <div v-for="group in menus" :key="group.key" class="menu-group">
          <div class="group-row" :class="{ locked: group.platformLocked || group.locked }">
            <span class="group-title">
              {{ group.title }}
              <span v-if="lockText(group)" class="lock-tag" :title="lockText(group)">
                <AppIcon name="shield" :size="12" /> {{ lockText(group) }}
              </span>
            </span>
            <AppSwitch
              :model-value="group.enabled"
              :disabled="group.platformLocked || group.locked"
              @update:model-value="(v: boolean) => onGroupChange(group, v)"
            />
          </div>
          <div v-if="group.children?.length" class="child-list">
            <div v-for="child in group.children" :key="child.key" class="child-row">
              <AppIcon name="chevron-right" :size="13" />
              <span class="child-title">
                {{ child.title }}
                <span v-if="child.locked" class="lock-tag" title="关闭后将无法再进入本页">系统必需</span>
              </span>
              <!-- 父组关闭时子项无从谈起；受锁的子项自己单独禁（如「菜单权限」本页） -->
              <AppSwitch
                :model-value="child.enabled"
                :disabled="!group.enabled || !!child.locked"
                @update:model-value="(v: boolean) => onChildChange(group, child, v)"
              />
            </div>
          </div>
        </div>
      </div>

      <div class="menu-foot">
        <button class="btn btn-ghost" :disabled="!dirty" @click="onReset">重置</button>
        <button class="btn btn-primary" :disabled="!dirty || saving" @click="onSave">
          {{ saving ? '保存中…' : dirty ? '保存修改' : '无变更' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.menu-panel { padding: 16px 18px; }
.menu-stats {
  display: flex; align-items: center; gap: 8px;
  background: var(--brand-soft); border-radius: 10px;
  padding: 10px 14px; font-size: 13px; color: var(--ink-2); margin-bottom: 16px;
}

.menu-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; }
.menu-group { border: 1.5px solid var(--border); border-radius: 12px; padding: 12px 14px; }
.group-row { display: flex; align-items: center; justify-content: space-between; }
.group-row.locked .group-title { color: var(--sub); }
.group-title { font-size: 14px; font-weight: 600; color: var(--ink); display: flex; align-items: center; gap: 8px; }
.lock-tag {
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 10.5px; color: var(--warn); background: var(--warn-soft);
  border-radius: 999px; padding: 2px 8px; font-weight: 500;
}
.child-list { border-top: 1px dashed var(--border); margin-top: 10px; padding-top: 8px; }
.child-row {
  display: flex; align-items: center; gap: 7px;
  padding: 6px 2px; color: var(--sub);
}
.child-title { flex: 1; font-size: 13px; color: var(--ink-2); }

.menu-foot {
  display: flex; align-items: center; justify-content: flex-end; gap: 10px;
  border-top: 1px solid var(--border); margin-top: 16px; padding-top: 14px;
}
</style>
