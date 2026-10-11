<script setup lang="ts">
/**
 * chip 选择组（表单场景）：一组可点选 chip，支持单选 / 多选。
 *
 * 与搜索条件（AppFilterChips）共用同一个 `AppChip`，所以选中 / 未选中样式天然一致，
 * 不会出现「筛选栏一种 chip、表单里另一种 chip」。
 *
 * - 多选（默认）：点一下加入、再点移出；
 * - 单选（`multiple=false`）：点其它项替换当前项；点已选项时，`clearable` 为真则清空
 *   （用来回到「不限定」这一档），为假则不动（必填项不允许清空）。
 *
 * 单选时的 `modelValue` 是长度 0 或 1 的数组：宿主用 `[xxx]` / `value[0]` 与标量互转，
 * 这样多选 / 单选共用一个受控签名，不必为单选再造一个组件。
 */
import AppChip from './AppChip.vue'

const props = withDefaults(
  defineProps<{
    modelValue: string[]
    options: string[]
    /** false = 单选 */
    multiple?: boolean
    /** 单选下是否允许点已选项清空 */
    clearable?: boolean
    /** 无候选项时的占位文案 */
    placeholder?: string
  }>(),
  { multiple: true, clearable: true, placeholder: '暂无可选项' },
)

const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()

function isOn(option: string) {
  return props.modelValue.includes(option)
}

function toggle(option: string) {
  if (props.multiple) {
    emit(
      'update:modelValue',
      isOn(option) ? props.modelValue.filter((item) => item !== option) : [...props.modelValue, option],
    )
    return
  }
  if (isOn(option)) {
    if (props.clearable) emit('update:modelValue', [])
    return
  }
  emit('update:modelValue', [option])
}
</script>

<template>
  <div class="chip-group">
    <template v-if="options.length">
      <AppChip
        v-for="option in options"
        :key="option"
        :label="option"
        :active="isOn(option)"
        @click="toggle(option)"
      />
    </template>
    <span v-else class="chip-empty">{{ placeholder }}</span>
  </div>
</template>

<style scoped>
/* 间距与筛选面板的 chip 行（AppFilterChips `.chip-opts`）保持一致 */
.chip-group { display: flex; flex-wrap: wrap; gap: 7px; }
.chip-empty { font-size: 12.5px; color: var(--sub); }
</style>
