<script setup lang="ts">
/** 开关（功能开关 FR-PT-012） */
const props = withDefaults(
  defineProps<{
    modelValue: boolean
    disabled?: boolean
  }>(),
  { disabled: false },
)

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

function toggle() {
  if (!props.disabled) emit('update:modelValue', !props.modelValue)
}
</script>

<template>
  <button
    type="button"
    class="switch"
    role="switch"
    :aria-checked="modelValue"
    :class="{ on: modelValue, disabled }"
    @click="toggle"
  >
    <i class="knob" />
  </button>
</template>

<style scoped>
.switch {
  width: 40px;
  height: 22px;
  flex-shrink: 0;
  border: none;
  border-radius: 999px;
  background: #d7deea;
  position: relative;
  transition: background 0.2s;
  padding: 0;
}
.switch .knob {
  position: absolute;
  top: 2.5px;
  left: 2.5px;
  width: 17px;
  height: 17px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 4px rgba(28, 36, 52, 0.25);
  transition: transform 0.2s;
}
.switch.on { background: var(--brand); }
.switch.on .knob { transform: translateX(18px); }
.switch.disabled { opacity: 0.5; cursor: not-allowed; }
</style>
