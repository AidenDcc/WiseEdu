<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { AppIcon, showToast, ApiError } from '@aiteach/shared'
import type { TenantMenuItem } from '@aiteach/shared'
import AppSwitch from '@/components/ui/AppSwitch.vue'
import { fetchTenantMenus, saveTenantMenus } from '@/api/platform'

const items = ref<TenantMenuItem[]>([])
const loading = ref(false)
const syncExisting = ref(true)
const saving = ref(false)

async function load() {
  loading.value = true
  try {
    items.value = await fetchTenantMenus()
  } finally {
    loading.value = false
  }
}

/** 分组开关：关闭分组时同步关闭其全部子菜单（FR-PT-034） */
function onGroupToggle(group: TenantMenuItem, value: boolean) {
  group.enabled = value
  group.children?.forEach((child) => {
    child.enabled = value
  })
}

const enabledCount = (group: TenantMenuItem) => group.children?.filter((child) => child.enabled).length ?? 0

async function save() {
  if (!window.confirm('保存后机构端侧边栏将即时生效，确认保存？')) return
  saving.value = true
  try {
    await saveTenantMenus(JSON.parse(JSON.stringify(items.value)))
    showToast(
      syncExisting.value ? '已保存，并同步更新了存量机构的菜单可见性' : '已保存，仅对后续新开通机构生效',
      'success',
    )
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : '保存失败，请重试', 'error')
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="panel">
    <div class="filter-bar">
      <span class="filter-label">机构端功能模块可见性总控：关闭分组将连带关闭其全部子菜单</span>
      <button class="btn btn-primary btn-sm" style="margin-left: auto" :disabled="saving" @click="save">
        <AppIcon name="check" :size="14" /> {{ saving ? '保存中…' : '保存配置' }}
      </button>
    </div>

    <div class="menu-grid">
      <div v-if="loading && items.length === 0" class="menu-empty">加载中…</div>
      <div v-for="group in items" v-else :key="group.key" class="menu-card" :class="{ off: !group.enabled }">
        <div class="menu-card-head">
          <span class="menu-title">{{ group.title }}</span>
          <span class="tag tag-blue">{{ enabledCount(group) }}/{{ group.children?.length ?? 0 }} 可见</span>
          <div style="margin-left: auto">
            <AppSwitch :model-value="group.enabled" @update:model-value="(v: boolean) => onGroupToggle(group, v)" />
          </div>
        </div>
        <ul class="child-list">
          <li v-for="child in group.children" :key="child.key">
            <span class="child-title" :class="{ off: !child.enabled }">{{ child.title }}</span>
            <AppSwitch v-model="child.enabled" :disabled="!group.enabled" />
          </li>
        </ul>
      </div>
    </div>

    <label class="sync-row">
      <input v-model="syncExisting" type="checkbox" />
      保存时同步更新存量机构（勾选：已开通机构的菜单可见性随本次配置即时调整；不勾选：仅对后续新开通机构生效）
    </label>
  </div>
</template>

<style scoped>
.menu-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  padding: 0 16px;
}
.menu-empty { grid-column: span 2; text-align: center; color: var(--sub); padding: 40px 0; font-size: 13px; }
.menu-card {
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 14px 16px;
  transition: border-color 0.15s, opacity 0.15s;
}
.menu-card.off { border-style: dashed; opacity: 0.75; }
.menu-card-head { display: flex; align-items: center; gap: 10px; padding-bottom: 10px; border-bottom: 1px solid var(--border); }
.menu-title { font-size: 14px; font-weight: 600; color: var(--ink); }
.child-list { list-style: none; display: flex; flex-direction: column; }
.child-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 2px;
  font-size: 13.5px;
  color: var(--ink-2);
}
.child-list li:not(:last-child) { border-bottom: 1px dashed #eef1f7; }
.child-title.off { color: var(--sub); }

.sync-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 14px 16px 16px;
  font-size: 12.5px;
  color: var(--ink-2);
  line-height: 1.7;
  cursor: pointer;
}
.sync-row input { accent-color: var(--brand); width: 15px; height: 15px; margin-top: 3px; }
</style>
