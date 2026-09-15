<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { AppIcon, showToast } from '@aiteach/shared'
import type { RecycleItem } from '@aiteach/shared'
import AppModal from '@/components/ui/AppModal.vue'
import AppPagination from '@/components/ui/AppPagination.vue'
import { fetchRecycle, purgeRecycle, restoreRecycle } from '@/api/org'

type TabKey = RecycleItem['kind']
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: '题目', label: '题目' },
  { key: '试卷', label: '试卷' },
  { key: '教辅', label: '教辅' },
  { key: '文件', label: '文件' },
]
const tab = ref<TabKey>('题目')

const items = ref<RecycleItem[]>([])
const selected = ref<number[]>([])
const page = ref(1)

/** 当前登录角色（演示固定机管，可彻底删除） */
const IS_ORG_ADMIN = true

async function load() {
  items.value = await fetchRecycle(tab.value)
  selected.value = []
  page.value = 1
}

const rows = computed(() => items.value)

function isSelected(id: number) {
  return selected.value.includes(id)
}
function toggleRow(id: number) {
  const pos = selected.value.indexOf(id)
  if (pos >= 0) selected.value.splice(pos, 1)
  else {
    if (selected.value.length >= 100) {
      showToast('单次最多选择 100 项', 'error')
      return
    }
    selected.value.push(id)
  }
}
const allSelected = computed(() => rows.value.length > 0 && rows.value.every((row) => selected.value.includes(row.id)))
function toggleAll() {
  selected.value = allSelected.value ? [] : rows.value.slice(0, 100).map((row) => row.id)
}

async function onRestore(ids: number[]) {
  if (!ids.length) return
  const { message } = await restoreRecycle(ids)
  showToast(message, 'success')
  load()
}

/* ===== 彻底删除（仅机管，输入「确认删除」二次确认） ===== */
const purgeOpen = ref(false)
const purgeConfirmText = ref('')

function openPurge() {
  if (!IS_ORG_ADMIN) {
    showToast('仅机构管理员可彻底删除', 'error')
    return
  }
  if (!selected.value.length) return
  purgeConfirmText.value = ''
  purgeOpen.value = true
}

async function submitPurge() {
  if (purgeConfirmText.value !== '确认删除') {
    showToast('请输入「确认删除」四个字', 'error')
    return
  }
  const { message } = await purgeRecycle(selected.value)
  purgeOpen.value = false
  showToast(message, 'success')
  load()
}

onMounted(load)
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h2>回收站</h2>
      <span class="f-hint">删除内容保留 30 天，到期自动物理清除；彻底删除仅机构管理员可操作</span>
    </div>

    <div class="tab-bar">
      <button
        v-for="t in TABS"
        :key="t.key"
        class="tab-btn"
        :class="{ on: tab === t.key }"
        type="button"
        @click="tab = t.key; load()"
      >
        {{ t.label }}
      </button>
    </div>

    <div class="panel">
      <div class="batch-bar">
        <label class="select-all">
          <input type="checkbox" :checked="allSelected" @change="toggleAll" />
          全选（{{ selected.length }}/{{ rows.length }}）
        </label>
        <button class="btn btn-ghost btn-sm" :disabled="!selected.length" @click="onRestore(selected)">
          <AppIcon name="download" :size="14" /> 还原所选
        </button>
        <button v-if="IS_ORG_ADMIN" class="btn btn-danger btn-sm" :disabled="!selected.length" @click="openPurge">
          彻底删除
        </button>
        <span class="f-hint" style="margin-left: auto">单次批量操作 ≤100 项</span>
      </div>

      <table class="data-table">
        <thead>
          <tr>
            <th style="width: 40px"></th>
            <th>名称</th>
            <th>类型</th>
            <th>删除人</th>
            <th>删除时间</th>
            <th>剩余保留</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="rows.length === 0">
            <td colspan="7" class="empty-row">该分类下暂无回收内容</td>
          </tr>
          <template v-else>
            <tr v-for="row in rows" :key="row.id" :class="{ picked: isSelected(row.id) }">
              <td><input type="checkbox" :checked="isSelected(row.id)" @change="toggleRow(row.id)" /></td>
              <td class="cell-strong">{{ row.name }}</td>
              <td><span class="tag tag-gray">{{ row.kind }}</span></td>
              <td>{{ row.deletedBy }}</td>
              <td>{{ row.deletedAt }}</td>
              <td>
                <span class="remain" :class="{ urgent: row.remainDays <= 7 }">{{ row.remainDays }} 天</span>
              </td>
              <td>
                <div class="op-group">
                  <button class="mini-btn" @click="onRestore([row.id])">还原</button>
                  <button v-if="IS_ORG_ADMIN" class="mini-btn danger" @click="selected = [row.id]; openPurge()">彻底删除</button>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
      <AppPagination :total="rows.length" v-model:page="page" :page-size="20" />
    </div>

    <!-- 彻底删除二次确认 -->
    <AppModal v-if="purgeOpen" title="彻底删除确认" :width="440" @close="purgeOpen = false">
      <div class="purge-warn">
        <AppIcon name="warning" :size="22" />
        <p>即将对 <b>{{ selected.length }}</b> 项内容执行<b>物理删除</b>，不可恢复且将写入审计日志。</p>
      </div>
      <div class="f-field">
        <label class="f-label">请输入「确认删除」四个字以继续</label>
        <input v-model="purgeConfirmText" class="f-input" placeholder="确认删除" />
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="purgeOpen = false">取消</button>
        <button class="btn btn-danger" :disabled="purgeConfirmText !== '确认删除'" @click="submitPurge">彻底删除</button>
      </template>
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

.batch-bar {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px; background: #f7fafa; border-radius: 10px 10px 0 0;
  border-bottom: 1px solid var(--border); margin-bottom: 4px;
}
.select-all { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--ink-2); }
tr.picked { background: var(--brand-soft); }
.remain { font-size: 12.5px; color: var(--sub); }
.remain.urgent { color: var(--danger); font-weight: 600; }

.purge-warn {
  display: flex; gap: 10px; align-items: flex-start;
  background: var(--danger-soft); color: var(--danger);
  border-radius: 10px; padding: 12px 14px; margin-bottom: 14px;
  font-size: 13px; line-height: 1.6;
}
</style>
