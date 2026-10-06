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
 *
 * `collapsible` 打开后，放不下的行默认只留一行，行尾给「展开 / 收起」。展开与否是**本组件
 * 的内部状态**（不是受控 prop）：它只影响看不看得见，不影响筛选值 —— 收起时被遮住的选项
 * 照样是选中的，选中项也照样染色，跟面板折叠时要把已选项汇总出来是同一个道理。
 */
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from '../AppIcon.vue'

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
    /** 放不下时默认只显示一行 + 「展开 / 收起」。见 FilterRowDef.collapsible */
    collapsible?: boolean
  }>(),
  { multiple: true, labelWidth: '58px', collapsible: false },
)

const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()

/* ===== 收起 / 展开 ===== */

const optsEl = ref<HTMLElement | null>(null)
/**
 * 一行 chip 的实高（量第一个 chip 得到）。收起时的 max-height 与行尾开关的高度都用它 ——
 * 字号 / 内边距改了不必回来同步一个写死的像素值。
 *
 * 初值 26 只是首帧的占位（`.opt-chip` 实测 24）：给得**偏大**才安全，偏小会把只占一行的
 * 选项在首帧误判成溢出、闪一下「展开」。
 */
const lineHeight = ref(26)
/** 内容是否真放不下一行：放得下就不出开关，免得给一行装得下的选项挂一个点了没反应的按钮 */
const overflowing = ref(false)
const expanded = ref(false)

/**
 * 用「一行该有多高」判定溢出，**不用 `clientHeight`**：容器高度正是这里算出来的 max-height 决定的，
 * 拿它比对就是先有鸡还是先有蛋 —— 首帧被裁成 0 时，任何一行都会量成「溢出」。
 * `scrollHeight` 则始终是内容实高（`overflow: hidden` 也照报不误），与裁剪无关。
 */
function measure() {
  const el = optsEl.value
  if (!el || !props.collapsible) return
  const first = el.firstElementChild
  if (!(first instanceof HTMLElement) || first.offsetHeight === 0) return
  lineHeight.value = first.offsetHeight
  overflowing.value = el.scrollHeight > first.offsetHeight + 1
}

let observer: ResizeObserver | null = null

onMounted(() => {
  measure()
  /* 换行是**宽度**决定的：窗口拉窄后原本一行的选项会溢出，而这时容器高度被 max-height
     钉死、高度不变。所以观察的是宽度会变的这个容器（ResizeObserver 在宽度变化时同样触发）。 */
  if (!props.collapsible || typeof ResizeObserver === 'undefined') return
  observer = new ResizeObserver(measure)
  if (optsEl.value) observer.observe(optsEl.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
})

/** 选项换了（字典异步到达、年级学科收窄候选项）要重新量一次 */
watch(
  () => props.options,
  () => {
    void nextTick(measure)
  },
)

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
  <!-- 行高以 CSS 变量下发给子元素：收起时的 max-height 与行尾开关的高度必须是同一个值，
       分别写就迟早对不齐（一个 24px 一个 26px，开关会比 chip 高出一截并顶开行距） -->
  <div class="chip-row" :style="{ '--chip-line': `${lineHeight}px` }">
    <span class="chip-label" :style="{ width: labelWidth }">{{ label }}</span>
    <div ref="optsEl" class="chip-opts" :class="{ clamped: collapsible && !expanded }">
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
    <button v-if="collapsible && overflowing" class="chip-toggle" type="button" @click="expanded = !expanded">
      {{ expanded ? '收起' : '展开' }}
      <AppIcon name="chevron-down" :size="13" class="chip-caret" :class="{ up: expanded }" />
    </button>
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
/* 只留一行：max-height 取实测行高，超出的行连同它的 gap 一起被裁掉
   （写死行高的话，换了字号要么露出半截 chip、要么底下空出一条缝）。
   overflow: hidden 是必需的 —— max-height 只把盒子压扁，不让溢出的行从盒子外面继续画出来 */
.chip-opts.clamped { max-height: var(--chip-line, 26px); overflow: hidden; }
.chip-empty { font-size: 12px; color: var(--sub); line-height: 26px; }

/* 行尾的「展开 / 收起」：与第一行 chip 等高对齐（自己撑高会把整行拉长） */
.chip-toggle {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  height: var(--chip-line, 26px);
  appearance: none;
  border: none;
  background: none;
  padding: 0;
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--brand);
  cursor: pointer;
}
.chip-toggle:hover { color: var(--brand-deep); }
.chip-caret { transition: transform 0.18s; }
.chip-caret.up { transform: rotate(180deg); }

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
