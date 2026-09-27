<script setup lang="ts">
/**
 * 筛选条件行：标签 + 一组 chip 按钮。
 *
 * 题库管理（BankView）里那套 `.cf-row` / `.opt-chip` 原本写在该文件的 scoped 样式里，
 * 别的页面想用只能自己再写一遍 —— 于是全仓长出了 `.tb-opt`、`.subj-tab`、`.prop-opts`
 * 等一堆同形不同名的东西。这里抽成共享组件，两端（机构端 / 超管端）统一用它。
 *
 * 单选与多选是同一个组件：`multiple=false` 时选中项最多一个，再次点击已选项即取消选中
 * （用来表示「全部」这一档）。
 */
const props = withDefaults(
  defineProps<{
    /** 行首标签，如「题型」「难度」 */
    label: string
    options: string[]
    /** 已选项；单选时长度 0 或 1 */
    modelValue: string[]
    /** false = 单选（点第二项会替换第一项） */
    multiple?: boolean
    /** 标签列宽度，跨组件对齐用 */
    labelWidth?: string
    /** 改写个别选项的显示文案（取值不变），如给已停用的历史值加「（已停用）」后缀 */
    optionLabels?: Record<string, string>
  }>(),
  { multiple: true, labelWidth: '58px' },
)

const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()

function isOn(option: string) {
  return props.modelValue.includes(option)
}

function toggle(option: string) {
  if (props.multiple) {
    const next = [...props.modelValue]
    const index = next.indexOf(option)
    if (index >= 0) next.splice(index, 1)
    else next.push(option)
    emit('update:modelValue', next)
    return
  }
  // 单选：点已选项 = 取消（回到「全部」），点其它项 = 替换
  emit('update:modelValue', isOn(option) ? [] : [option])
}
</script>

<template>
  <div class="chip-row">
    <span class="chip-label" :style="{ width: labelWidth }">{{ label }}</span>
    <div class="chip-opts">
      <button
        v-for="option in options"
        :key="option"
        class="opt-chip"
        :class="{ on: isOn(option) }"
        type="button"
        @click="toggle(option)"
      >
        {{ props.optionLabels?.[option] ?? option }}
      </button>
      <span v-if="options.length === 0" class="chip-empty">暂无可选项</span>
    </div>
  </div>
</template>

<style scoped>
.chip-row { display: flex; align-items: flex-start; gap: 12px; }
.chip-label {
  flex-shrink: 0;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--sub);
  line-height: 26px;
}
.chip-opts { display: flex; flex-wrap: wrap; gap: 7px; flex: 1; min-width: 0; }
.chip-empty { font-size: 12px; color: var(--sub); line-height: 26px; }

.opt-chip {
  border: 1.5px solid var(--border);
  border-radius: 8px;
  background: #fff;
  font-size: 12.5px;
  color: var(--ink-2);
  padding: 3px 12px;
  /* 不写 line-height：题库管理（基准页）的 .opt-chip 本来就没有，
     写死 18px 会让 chip 凭空高 3px，基准页的视觉就跟着漂了。
     尺寸完全按基准页取值（padding 3px 12px + 12.5px 字）。 */
  white-space: nowrap;
  flex-shrink: 0;
  transition: border-color 0.12s, background 0.12s, color 0.12s;
}
.opt-chip:hover { border-color: var(--brand); color: var(--brand-deep); }
.opt-chip.on { background: var(--brand); border-color: var(--brand); color: #fff; font-weight: 600; }
</style>
