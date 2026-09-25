<script setup lang="ts">
import { AppIcon } from '@aiteach/shared'

/** 首页板块容器：模块大标题 + 右侧插槽（筛选器/更多入口） */
withDefaults(defineProps<{ title: string; more?: string; moreText?: string }>(), {
  moreText: '查看更多',
})
</script>

<template>
  <section class="home-sec panel">
    <header class="sec-head">
      <h2 class="sec-title">{{ title }}</h2>
      <div class="sec-right">
        <slot name="extra" />
        <RouterLink v-if="more" class="sec-more" :to="more">
          {{ moreText }}<AppIcon name="chevron-right" :size="13" />
        </RouterLink>
      </div>
    </header>
    <div class="sec-body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.home-sec { padding: 22px 26px 26px; }
.sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}
.sec-title {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0.2px;
}
.sec-right { display: flex; align-items: center; gap: 14px; }
.sec-more {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 13px;
  color: var(--sub);
  transition: color 0.15s;
}
.sec-more:hover { color: var(--brand-deep); }
</style>
