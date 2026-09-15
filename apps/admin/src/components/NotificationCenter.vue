<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { AppIcon, showToast, ApiError } from '@aiteach/shared'
import type { PlatformNotification } from '@aiteach/shared'
import AppDrawer from '@/components/ui/AppDrawer.vue'
import { fetchNotifications, markAllNotificationsRead, markNotificationRead } from '@/api/platform'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'unread', count: number): void }>()

const TYPE_META: Record<PlatformNotification['type'], { label: string; tag: string; icon: string }> = {
  apply: { label: '入驻审核', tag: 'tag-blue', icon: 'building' },
  quota: { label: '配额预警', tag: 'tag-orange', icon: 'chart' },
  system: { label: '系统通知', tag: 'tag-gray', icon: 'cpu' },
}

const list = ref<PlatformNotification[]>([])
const filter = ref<'all' | 'unread'>('all')
const loading = ref(false)

const unread = computed(() => list.value.filter((item) => !item.read).length)
const shown = computed(() =>
  filter.value === 'unread' ? list.value.filter((item) => !item.read) : list.value,
)

async function load() {
  loading.value = true
  try {
    const data = await fetchNotifications()
    list.value = data.list
    emit('unread', data.unread)
  } finally {
    loading.value = false
  }
}

async function onRead(item: PlatformNotification) {
  if (item.read) return
  try {
    const result = await markNotificationRead(item.id)
    item.read = true
    emit('unread', result.unread)
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : '操作失败', 'error')
  }
}

async function onReadAll() {
  if (unread.value === 0) return
  const result = await markAllNotificationsRead()
  list.value.forEach((item) => (item.read = true))
  emit('unread', result.unread)
  showToast('已全部标记为已读', 'success')
}

/** 相对时间（x 分钟前 / 小时前 / 天前） */
function relativeTime(time: string) {
  const then = new Date(time.replace(/-/g, '/')).getTime()
  const diff = Date.now() - then
  if (Number.isNaN(then) || diff < 0) return time
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} 天前`
  return time.slice(5, 16)
}

watch(
  () => props.open,
  (open) => {
    if (open) load()
  },
)
onMounted(load)
</script>

<template>
  <AppDrawer
    v-if="open"
    title="消息中心"
    :subtitle="unread > 0 ? `${unread} 条未读` : '全部已读'"
    @close="emit('close')"
  >
    <div class="nc-toolbar">
      <div class="seg">
        <button class="seg-btn" :class="{ active: filter === 'all' }" type="button" @click="filter = 'all'">
          全部 {{ list.length }}
        </button>
        <button class="seg-btn" :class="{ active: filter === 'unread' }" type="button" @click="filter = 'unread'">
          未读 {{ unread }}
        </button>
      </div>
      <button class="mini-btn" type="button" :disabled="unread === 0" @click="onReadAll">全部已读</button>
    </div>

    <div v-if="loading && list.length === 0" class="nc-empty">加载中…</div>
    <div v-else-if="shown.length === 0" class="nc-empty">
      <AppIcon name="check" :size="22" />
      {{ filter === 'unread' ? '没有未读消息' : '暂无消息' }}
    </div>

    <ul v-else class="nc-list">
      <li
        v-for="item in shown"
        :key="item.id"
        :class="{ unread: !item.read }"
        @click="onRead(item)"
      >
        <span class="nc-icon" :class="item.type">
          <AppIcon :name="TYPE_META[item.type].icon" :size="16" />
        </span>
        <div class="nc-body">
          <div class="nc-head">
            <span class="nc-title">{{ item.title }}</span>
            <i v-if="!item.read" class="nc-dot" />
          </div>
          <p class="nc-content">{{ item.content }}</p>
          <div class="nc-foot">
            <span class="tag" :class="TYPE_META[item.type].tag">{{ TYPE_META[item.type].label }}</span>
            <span class="nc-time">{{ relativeTime(item.time) }}</span>
          </div>
        </div>
      </li>
    </ul>
  </AppDrawer>
</template>

<style scoped>
.nc-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}
.seg {
  display: inline-flex;
  background: #f1f3f9;
  border-radius: 10px;
  padding: 3px;
}
.seg-btn {
  border: none;
  background: transparent;
  border-radius: 8px;
  color: var(--sub);
  font-size: 12.5px;
  font-weight: 500;
  padding: 5px 14px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.seg-btn.active { background: #fff; color: var(--brand); font-weight: 600; box-shadow: 0 2px 6px rgba(28, 36, 52, 0.08); }

.nc-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  color: var(--sub);
  font-size: 13px;
  padding: 60px 0;
}

.nc-list { list-style: none; display: flex; flex-direction: column; gap: 10px; }
.nc-list li {
  display: flex;
  gap: 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px 14px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.nc-list li:hover { border-color: var(--brand); }
.nc-list li.unread { background: var(--brand-soft); border-color: transparent; }

.nc-icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.nc-icon.apply { background: rgba(79, 110, 247, 0.12); color: var(--brand); }
.nc-icon.quota { background: rgba(234, 155, 27, 0.14); color: var(--warn); }
.nc-icon.system { background: #f1f3f9; color: var(--ink-2); }

.nc-body { flex: 1; min-width: 0; }
.nc-head { display: flex; align-items: center; gap: 8px; }
.nc-title { font-size: 13.5px; font-weight: 600; color: var(--ink); }
.nc-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--danger); flex-shrink: 0; }
.nc-content {
  font-size: 12.5px;
  color: var(--ink-2);
  line-height: 1.7;
  margin: 5px 0 8px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.nc-foot { display: flex; align-items: center; gap: 10px; }
.nc-time { font-size: 11.5px; color: var(--sub); margin-left: auto; }
</style>
