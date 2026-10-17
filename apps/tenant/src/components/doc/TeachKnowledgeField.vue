<script setup lang="ts">
/**
 * 知识点编辑（芯片式），带「章节预设 vs 自己改的」差异高亮。
 *
 * ## 为什么要标差异，而不是一个普通输入框
 *
 * 知识点一半来自教材：选了「3.2 函数的单调性」，系统就带出「增函数 / 减函数 / 单调区间 / 定义法证明」。
 * 老师往往会在这个范围上**增删几个**（本校学生基础弱，砍掉「定义法证明」；或者加一条校本要求）。
 * 如果界面上看不出哪几个是教材给的、哪几个是自己加的，下次打开这份教案就分不清
 * 「这是我特意去掉了，还是当初选错章节了」。
 *
 * 于是：默认项是浅色芯片，自己加的是描边 + 「+」的芯片，被删掉的默认项在下面以划线的
 * 「已移除」列出 —— 三种状态一眼可辨，且被删的随时能点回来。
 *
 * ## 修改前提示
 *
 * 第一次增删默认范围时弹一次确认（原话是产品定的：学情分析会基于**自定义**的知识点跑）。
 * 只在**第一次**弹：每次增删都弹会让人干脆点「确定」了事，提示就失去意义了。
 */
import { computed, ref } from 'vue'
import { AppIcon, appConfirm } from '@aiteach/shared'

const props = defineProps<{
  /** 当前生效的知识点 */
  modelValue: string[]
  /** 章节带出的默认知识点（为空表示没有章节，或者这一节没维护知识点） */
  baseline: string[]
  /** 章节名（提示文案里要用） */
  chapter?: string
  /**
   * 章节预设还在按章节名回树上取（打开已有文档时的一小段异步）。
   *
   * 取的过程中 baseline 天然是空的，此时若照常渲染「没找到同名章节」的提示，
   * 打开面板会先闪一句红字再消失 —— 老师会以为出了问题。所以查的时候先不说。
   */
  checking?: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()

const draft = ref('')

/** 只提示一次：重复提示等于训练用户闭眼点确定 */
const warned = ref(false)

/**
 * 修改前的提示。
 *
 * 只在**确实动了章节预设**时才问：没有章节、或知识点与预设完全一致时，
 * 「你已修改了预设范围」这句话本身就不成立。
 */
async function confirmChange(action: string): Promise<boolean> {
  if (warned.value) return true
  if (!props.baseline.length) return true
  const ok = await appConfirm(
    `您已修改了当前章节的预设知识点范围，该教案的学情分析将基于您自定义的知识点进行。\n\n（本次要${action}，确定继续？）`,
    { type: 'warning' },
  )
  if (ok) warned.value = true
  return ok
}

async function add() {
  const value = draft.value.trim()
  if (!value || props.disabled) return
  if (props.modelValue.includes(value)) {
    draft.value = ''
    return
  }
  if (!(await confirmChange(`新增「${value}」`))) return
  emit('update:modelValue', [...props.modelValue, value])
  draft.value = ''
}

/** 输入框里连续敲「、」「，」也能拆成多个（中文输入法下很常见） */
async function addMany() {
  const parts = draft.value
    .split(/[、,，;；\s]+/)
    .map((row) => row.trim())
    .filter(Boolean)
  if (!parts.length || props.disabled) return
  const next = Array.from(new Set([...props.modelValue, ...parts]))
  if (next.length === props.modelValue.length) {
    draft.value = ''
    return
  }
  if (!(await confirmChange(`新增 ${parts.length} 个知识点`))) return
  emit('update:modelValue', next)
  draft.value = ''
}

async function remove(value: string) {
  if (props.disabled) return
  if (!(await confirmChange(`移除「${value}」`))) return
  emit(
    'update:modelValue',
    props.modelValue.filter((row) => row !== value),
  )
}

function restore(value: string) {
  if (props.disabled) return
  if (props.modelValue.includes(value)) return
  emit('update:modelValue', [...props.modelValue, value])
}

function restoreAll() {
  if (props.disabled) return
  emit('update:modelValue', [...props.baseline])
}

/** 回车：带分隔符就一次拆成多个，否则只加一条 */
function commit() {
  if (/[、,，;；\s]/.test(draft.value)) void addMany()
  else void add()
}

/** 输入框已空时按退格删掉最后一个芯片（芯片输入框的常规手感） */
function onBackspace() {
  if (draft.value || !props.modelValue.length) return
  void remove(props.modelValue[props.modelValue.length - 1])
}

/** 被删掉的章节预设项（按 baseline 的顺序，不是删除顺序 —— 恢复后位置才稳定） */
const removed = computed(() => props.baseline.filter((row) => !props.modelValue.includes(row)))

/**
 * 有「预设」才谈得上差异。
 *
 * 打开一份已有教案时 baseline 是空的（上次选章节时教材给了什么，现在无从得知），
 * 此时把每个 chip 都标成「自定义」纯属噪音 —— 没有参照物的「不同」不是信息。
 */
const hasBaseline = computed(() => props.baseline.length > 0)

/** 某个知识点是否是「自己加的」（只有存在预设时才有意义） */
const isCustom = (row: string) => hasBaseline.value && !props.baseline.includes(row)
</script>

<template>
  <div class="kf">
    <div class="kf-box" :class="{ 'is-disabled': disabled }">
      <span
        v-for="row in modelValue"
        :key="row"
        class="kf-chip"
        :class="{ 'is-custom': isCustom(row) }"
        :title="hasBaseline ? (isCustom(row) ? '自定义添加（不在章节预设里）' : '来自章节预设') : ''"
      >
        <span v-if="isCustom(row)" class="kf-plus">+</span>{{ row }}
        <button v-if="!disabled" class="kf-x" type="button" :title="`移除「${row}」`" @click="remove(row)">
          <AppIcon name="close" :size="10" />
        </button>
      </span>

      <input
        v-model="draft"
        class="kf-input"
        :disabled="disabled"
        :placeholder="modelValue.length ? '继续添加…' : '输入知识点后回车（多个用「、」分隔）'"
        @keydown.enter.prevent="commit"
        @keydown.delete="onBackspace"
      />
    </div>

    <!-- 差异说明：一行为「哪些是预设、哪些是自己加的」给个明话，
         否则芯片的颜色差异要靠猜 -->
    <p v-if="baseline.length" class="kf-legend">
      <span class="kf-dot is-base" />章节预设 {{ baseline.length }} 项
      <span class="kf-dot is-custom" />自定义 {{ Math.max(0, modelValue.filter((row) => !baseline.includes(row)).length) }} 项
      <template v-if="removed.length">
        · 已移除 {{ removed.length }} 项
      </template>
      <button v-if="!disabled" class="kf-reset" type="button" @click="restoreAll">恢复章节默认</button>
    </p>

    <div v-if="removed.length" class="kf-removed">
      <span class="kf-removed-label">已移除：</span>
      <button
        v-for="row in removed"
        :key="row"
        class="kf-removed-chip"
        type="button"
        :disabled="disabled"
        :title="`点一下恢复「${row}」`"
        @click="restore(row)"
      >
        {{ row }}
      </button>
    </div>

    <p v-if="!baseline.length && chapter && !checking" class="kf-hint">
      「{{ chapter }}」在教材目录里没有找到同名章节（章节名是手填的，或这套书的这一节还没维护），
      预设知识点无从比对，下面按自定义处理。用「选择」按目录选一次即可带出预设。
    </p>
  </div>
</template>

<style scoped>
.kf-box {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
  min-height: 38px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #fff;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.kf-box:focus-within { border-color: var(--brand); box-shadow: 0 0 0 3px var(--brand-soft); }
.kf-box.is-disabled { background: #f7f9fc; }

.kf-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 4px 2px 8px;
  border-radius: 999px;
  background: var(--brand-soft);
  color: var(--brand-deep);
  font-size: 12px;
  line-height: 1.6;
  border: 1px solid transparent;
}
/* 自己加的：描边 + 虚线 —— 不靠颜色深浅区分（浅色系里两个蓝几乎看不出差别） */
.kf-chip.is-custom {
  background: #fff;
  border: 1px dashed var(--brand);
  color: var(--brand-deep);
}
.kf-plus { font-weight: 700; margin-right: 1px; }
.kf-x {
  width: 16px;
  height: 16px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  opacity: 0.55;
  display: flex;
  align-items: center;
  justify-content: center;
}
.kf-x:hover { opacity: 1; background: rgba(0, 0, 0, 0.06); }

.kf-input {
  flex: 1;
  min-width: 96px;
  border: none;
  outline: none;
  background: transparent;
  font-family: inherit;
  font-size: 12.5px;
  color: var(--ink);
  padding: 2px 2px;
}

.kf-legend {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  margin-top: 6px;
  font-size: 11.5px;
  color: var(--sub);
}
.kf-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  margin-left: 4px;
}
.kf-dot.is-base { background: var(--brand); }
.kf-dot.is-custom { background: #fff; border: 1px dashed var(--brand); }
.kf-reset {
  margin-left: auto;
  border: none;
  background: transparent;
  color: var(--brand-deep);
  font-size: 11.5px;
  font-family: inherit;
  padding: 1px 4px;
  border-radius: 5px;
}
.kf-reset:hover { background: var(--brand-soft); }

.kf-removed {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
  margin-top: 6px;
}
.kf-removed-label { font-size: 11.5px; color: var(--sub); }
.kf-removed-chip {
  border: none;
  background: #f2f4f8;
  color: var(--sub);
  font-family: inherit;
  font-size: 11.5px;
  padding: 1px 7px;
  border-radius: 999px;
  text-decoration: line-through;
}
.kf-removed-chip:hover:not(:disabled) { background: #e8edf6; color: var(--ink-2); text-decoration: none; }
.kf-hint { margin-top: 6px; font-size: 11.5px; color: var(--sub); }
</style>
