<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { AppIcon } from '@aiteach/shared'

const route = useRoute()
const title = computed(() => (route.meta.title as string) ?? '该功能')

const phases = ['需求评审', '原型设计', '开发实现', '联调测试', '上线发布']
</script>

<template>
  <div class="developing">
    <div class="dev-card panel">
      <div class="dev-icon">🚧</div>
      <h2>「{{ title }}」正在开发中</h2>
      <p class="desc">该模块已列入迭代计划，当前演示版本仅提供入口预览，功能即将上线。</p>

      <div class="phases">
        <div
          v-for="(phase, index) in phases"
          :key="phase"
          class="phase"
          :class="{ done: index === 0, current: index === 1 }"
        >
          <span class="phase-dot">
            <AppIcon v-if="index === 0" name="check" :size="11" />
          </span>
          <span class="phase-name">{{ phase }}</span>
          <span v-if="index < phases.length - 1" class="phase-line" />
        </div>
      </div>

      <RouterLink to="/dashboard" class="btn btn-primary">
        <AppIcon name="dashboard" :size="16" />
        返回工作台
      </RouterLink>
    </div>
  </div>
</template>

<style scoped>
.developing {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: calc(100vh - 62px - 44px);
}
.dev-card {
  text-align: center;
  padding: 52px 64px;
  max-width: 560px;
}
.dev-icon { font-size: 52px; }
.dev-card h2 { font-size: 20px; margin-top: 14px; }
.desc { color: var(--sub); font-size: 13.5px; line-height: 1.8; margin: 10px 0 30px; }

.phases { display: flex; justify-content: center; margin-bottom: 32px; }
.phase { display: flex; align-items: center; }
.phase-dot {
  width: 22px; height: 22px;
  border-radius: 50%;
  background: #eef1f7;
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.phase.done .phase-dot { background: var(--brand); }
.phase.current .phase-dot { background: var(--brand); box-shadow: 0 0 0 5px var(--brand-soft); animation: pulse 1.6s infinite; }
@keyframes pulse {
  0%, 100% { box-shadow: 0 0 0 4px var(--brand-soft); }
  50% { box-shadow: 0 0 0 8px rgba(79, 110, 247, 0.05); }
}
.phase-name { font-size: 12px; color: var(--ink-2); margin-left: 6px; margin-right: 12px; }
.phase-line { width: 34px; height: 2px; background: #e6eaf3; margin-right: 12px; border-radius: 1px; }
</style>
