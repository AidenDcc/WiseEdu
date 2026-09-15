<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { AppIcon, showToast } from '@aiteach/shared'
import type { OrgMessage } from '@aiteach/shared'
import AppDrawer from '@/components/ui/AppDrawer.vue'
import {
  deleteOrgMessage,
  fetchOrgMessages,
  markAllOrgMessagesRead,
  markOrgMessageRead,
} from '@/api/org'

type TabKey = 'todo' | 'review' | 'collab' | 'system'
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'todo', label: '审核待办' },
  { key: 'review', label: '审核结果' },
  { key: 'collab', label: '协同' },
  { key: 'system', label: '系统' },
]

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; refresh: [] }>()

const router = useRouter()
const tab = ref<TabKey>('todo')
const messages = ref<OrgMessage[]>([])
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    messages.value = await fetchOrgMessages(tab.value)
  } finally {
    loading.value = false
  }
}

function pick(value: TabKey) {
  tab.value = value
  load()
}

const unread = computed(() => messages.value.filter((row) => !row.read).length)

/** 点击消息：已读 + 跳转（FR-GN-017） */
async function onMessage(row: OrgMessage) {
  if (!row.read) {
    await markOrgMessageRead(row.id)
    row.read = true
    emit('refresh')
  }
  emit('close')
  router.push(row.link || '/dashboard')
}

async function onMarkAll() {
  await markAllOrgMessagesRead(tab.value)
  await load()
  emit('refresh')
  showToast('已全部标记为已读', 'success')
}

async function onDelete(row: OrgMessage, event: MouseEvent) {
  event.stopPropagation()
  await deleteOrgMessage(row.id)
  messages.value = messages.value.filter((item) => item.id !== row.id)
  emit('refresh')
}

/** 组件以 v-if 挂载，打开即加载 */
onMounted(load)
</script>

<template>
  <AppDrawer
    v-if="open"
    title="消息中心"
    subtitle="审核待办 / 审核结果 / 协同邀请 / 系统通知（FR-GN-015 ~ 019）"
    :width="460"
    @close="emit('close')"
  >
    <div class="nc-tabs">
      <button
        v-for="t in TABS"
        :key="t.key"
        class="nc-tab"
        :class="{ on: tab === t.key }"
        type="button"
        @click="pick(t.key)"
      >
        {{ t.label }}
      </button>
    </div>

    <div class="nc-list">
      <p v-if="loading" class="nc-hint">加载中…</p>
      <p v-else-if="messages.length === 0" class="nc-hint">该分类下暂无消息</p>
      <div
        v-for="row in messages"
        :key="row.id"
        class="nc-item"
        :class="{ unread: !row.read }"
        role="button"
        @click="onMessage(row)"
      >
        <i class="nc-dot" />
        <div class="nc-body">
          <p class="nc-title">{{ row.title }}</p>
          <p class="nc-summary">{{ row.summary }}</p>
          <p class="nc-meta">{{ row.module }} · {{ row.time }} · 点击前往处理</p>
        </div>
        <button class="nc-del" type="button" title="删除" @click="onDelete(row, $event)">
          <AppIcon name="close" :size="13" />
        </button>
      </div>
    </div>

    <template #footer>
      <span class="f-hint">未读 {{ unread }} 条</span>
      <button class="btn btn-ghost btn-sm" style="margin-left: auto" :disabled="unread === 0" @click="onMarkAll">
        全部已读
      </button>
    </template>
  </AppDrawer>
</template>

<style scoped>
.nc-tabs { display: flex; gap: 6px; margin-bottom: 14px; }
.nc-tab {
  flex: 1; border: 1.5px solid var(--border); border-radius: 9px; background: #fff;
  font-size: 12.5px; color: var(--sub); padding: 7px 0;
}
.nc-tab.on { border-color: var(--brand); background: var(--brand-soft); color: var(--brand-deep); font-weight: 600; }

.nc-list { display: flex; flex-direction: column; gap: 10px; }
.nc-hint { font-size: 13px; color: var(--sub); padding: 20px 0; text-align: center; }

.nc-item {
  display: flex; gap: 10px; align-items: flex-start;
  border: 1.5px solid var(--border); border-radius: 11px;
  padding: 11px 13px; cursor: pointer; background: #fff;
  transition: border-color 0.15s;
}
.nc-item:hover { border-color: var(--brand); }
.nc-item.unread { background: #f6fbfa; border-color: #bfe8e4; }
.nc-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--border); margin-top: 6px; flex-shrink: 0; }
.nc-item.unread .nc-dot { background: var(--danger); }
.nc-body { flex: 1; min-width: 0; }
.nc-title { font-size: 13.5px; font-weight: 600; color: var(--ink); margin-bottom: 3px; }
.nc-summary { font-size: 12.5px; color: var(--ink-2); line-height: 1.6; margin-bottom: 4px; }
.nc-meta { font-size: 11.5px; color: var(--sub); }
.nc-del {
  border: none; background: transparent; color: var(--sub);
  width: 24px; height: 24px; border-radius: 7px; display: flex;
  align-items: center; justify-content: center; flex-shrink: 0;
}
.nc-del:hover { background: var(--danger-soft); color: var(--danger); }
</style>
