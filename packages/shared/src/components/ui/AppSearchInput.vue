<script setup lang="ts">
/**
 * 带放大镜图标的搜索输入框。
 *
 * 替代原先散落各处的 `.search-box`：本仓曾把它独立重写 4 遍（4 份规则体各不相同），
 * `file/FileView.vue` 更写了 `class="f-input search-box"` 却从未定义过 `.search-box`。
 *
 * 样式自带，不依赖宿主应用的全局 CSS 类（只取 CSS 变量），因此两端表现一致。
 */
import AppIcon from '../AppIcon.vue'

const props = withDefaults(
  defineProps<{
    modelValue: string
    placeholder?: string
    /** 宽度，数字按 px 处理 */
    width?: string | number
    /** 高度档位：sm=32 / md=34（与筛选栏按钮同高）/ lg=38（与表单一致） */
    size?: 'sm' | 'md' | 'lg'
  }>(),
  { placeholder: '搜索', width: 240, size: 'md' },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

function onInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement).value)
}
</script>

<template>
  <div
    class="search-input"
    :class="`is-${size}`"
    :style="{ width: typeof width === 'number' ? `${width}px` : width }"
  >
    <AppIcon class="si-icon" name="search" :size="15" />
    <input
      class="si-field"
      :value="modelValue"
      :placeholder="placeholder"
      type="text"
      @input="onInput"
    />
    <button v-if="modelValue" class="si-clear" type="button" title="清空" @click="emit('update:modelValue', '')">
      <AppIcon name="close" :size="12" />
    </button>
  </div>
</template>

<style scoped>
.search-input {
  position: relative;
  display: flex;
  align-items: center;
  border: 1.5px solid var(--border);
  border-radius: 10px;
  background: #fff;
  padding: 0 10px;
  flex-shrink: 0;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.search-input:focus-within { border-color: var(--brand); box-shadow: 0 0 0 3px var(--brand-soft); }
.search-input.is-sm { height: 32px; }
.search-input.is-md { height: 34px; }
.search-input.is-lg { height: 38px; }

.si-icon { color: var(--sub); flex-shrink: 0; }

.si-field {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: none;
  outline: none;
  background: transparent;
  font-family: inherit;
  /* 与全局 .f-input 同字号：题库管理的搜索框用的是 .f-input，本来就是 13.5px */
  font-size: 13.5px;
  color: var(--ink);
  padding: 0 8px;
}
.si-field::placeholder { color: var(--sub); }

/* 清空按钮：撑成正方形命中区，图标在其中居中 */
.si-clear {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--sub);
  padding: 0;
  transition: background 0.15s, color 0.15s;
}
.si-clear:hover { background: #f2f4fa; color: var(--ink); }
</style>
