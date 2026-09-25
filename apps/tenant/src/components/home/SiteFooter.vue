<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { fetchCopyrightNotices } from '@/api/org'
import type { TenantDictItem } from '@/api/org'

/**
 * 首页页脚：版权 / 备案 / 客服信息。
 * 文案与顺序由管理端「数据字典 → 版权信息」维护（一行一条），此处只负责展示启用项。
 *
 * 单独请求且失败静默：页脚属附属信息，不应连带影响首页主体内容，故不并入页面级 Promise.all。
 */
const notices = ref<TenantDictItem[]>([])

onMounted(async () => {
  try {
    notices.value = await fetchCopyrightNotices()
  } catch {
    notices.value = []
  }
})
</script>

<template>
  <footer v-if="notices.length" class="site-footer">
    <p class="foot-line">
      <span v-for="item in notices" :key="item.id">{{ item.name }}</span>
    </p>
  </footer>
</template>

<style scoped>
.site-footer {
  margin-top: 10px;
  padding: 28px 0 6px;
  border-top: 1px solid var(--border);
}

/* 长文案自动换行居中；换行后不残留分隔符，故用间距而不是「·」分隔 */
.foot-line {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px 18px;
  font-size: 12.5px;
  line-height: 1.9;
  color: var(--sub);
}
</style>
