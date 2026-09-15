<script setup lang="ts">
defineProps<{ title: string; subtitle?: string }>()
</script>

<template>
  <section class="panel-card panel">
    <header class="panel-head">
      <div>
        <h3 class="panel-title">{{ title }}</h3>
        <p v-if="subtitle" class="panel-subtitle">{{ subtitle }}</p>
      </div>
      <slot name="extra" />
    </header>
    <div class="panel-body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.panel-card { display: flex; flex-direction: column; }
.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 16px 20px 0;
}
.panel-title { font-size: 15px; font-weight: 700; }
.panel-subtitle { font-size: 12px; color: var(--sub); margin-top: 3px; }
.panel-body { padding: 14px 20px 18px; flex: 1; }
</style>
