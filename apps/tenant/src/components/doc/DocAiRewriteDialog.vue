<script setup lang="ts">
/**
 * 划词「AI 改这段」的**结果确认弹窗**。
 *
 * 为什么要有这一步，而不是像早先那样「点一下动作、正文当场被换掉」：
 * AI 改出来的是一整段文字，改得好不好、有没有把学科术语改跑，**必须先看一眼**。
 * 直接落进正文的话，老师要么当场撤销（撤销栈里混进一次 AI 调用，很难解释），
 * 要么就得自己比对。所以这里把流程拆成：调用 → 看结果 → 三选一。
 *
 * 三个动作与它们的语义（与需求一致）：
 * - **重写**：把当前结果再交给同一个动作调一遍 —— 「继续让 AI 调整」，想再试一版就点它；
 * - **弃用**：关掉弹窗，AI 的结果不落进正文（正文从头到尾没被动过）；
 * - **替换**：把结果写回原来的选区。
 *
 * 边界：本组件只负责「调 AI + 展示 + 让用户选」，**不碰编辑器内容** ——
 * 替换走 `emit('apply', text)`，由画布（DocCanvas）决定怎么落进文档。
 */
import { onMounted, ref } from 'vue'
import { AppIcon, AppModal, TEACH_AI_TEXT_HINT, TEACH_AI_TEXT_TEXT, showToast } from '@aiteach/shared'
import type { TeachAiTextAction } from '@aiteach/shared'

import { polishText } from '@/api/org'

const props = defineProps<{
  action: TeachAiTextAction
  /** 选区的原文（AI 的输入；也是弹窗里「原文」那一栏） */
  source: string
  subject?: string
}>()

const emit = defineEmits<{
  close: []
  /** 把 AI 版本写回选区 */
  apply: [text: string]
}>()

/** 正在等 AI 返回（首次进入、以及每次「重写」） */
const busy = ref(false)
const result = ref('')
/** 第几次生成：1 是首次，「重写」后累加 —— 让老师知道「这是第几版」 */
const round = ref(0)

async function run(input: string) {
  busy.value = true
  try {
    const response = await polishText({ action: props.action, text: input, subject: props.subject })
    const text = response.text?.trim() ?? ''
    if (!text) {
      showToast('AI 没有返回内容，请重试', 'error')
      return
    }
    result.value = text
    round.value += 1
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'AI 处理失败，请重试', 'error')
  } finally {
    busy.value = false
  }
}

onMounted(() => void run(props.source))

/** 重写：拿**当前结果**再跑一遍同一个动作。连着不满意时，老师不必重新选一次文字。 */
function rewrite() {
  if (busy.value || !result.value) return
  void run(result.value)
}

function apply() {
  if (!result.value) return
  emit('apply', result.value)
  emit('close')
}
</script>

<template>
  <AppModal :title="`AI ${TEACH_AI_TEXT_TEXT[action]}`" :width="720" @close="emit('close')">
    <div class="ar">
      <p class="ar-lead">
        {{ TEACH_AI_TEXT_HINT[action] }}
      </p>

      <!-- 原文 -->
      <section class="ar-block">
        <div class="ar-block-head">
          <AppIcon name="file" :size="14" />
          <span>原文（选中的内容）</span>
        </div>
        <p class="ar-text is-source">{{ source }}</p>
      </section>

      <!-- 结果：先转圈，再显示 AI 写的内容 -->
      <section class="ar-block">
        <div class="ar-block-head">
          <AppIcon name="sparkles" :size="14" />
          <span>AI 版本</span>
          <span v-if="round > 1 && !busy" class="ar-round">第 {{ round }} 版</span>
          <span v-if="busy" class="ar-busy">正在调用 AI…</span>
        </div>
        <div v-if="busy" class="ar-loading">
          <span class="ar-spinner" />
          <span>正在按「{{ TEACH_AI_TEXT_TEXT[action] }}」处理这段文字，稍等几秒…</span>
        </div>
        <p v-else class="ar-text is-result">{{ result || '（AI 没有返回内容）' }}</p>
      </section>

      <p class="ar-tip">
        「替换」只改选中的这一段，其余内容不受影响，并且只占一步撤销；「弃用」则什么都不动。
      </p>
    </div>

    <template #footer>
      <button class="btn btn-ghost" type="button" :disabled="busy" @click="rewrite">
        <AppIcon name="refresh" :size="15" /> 重写
      </button>
      <button class="btn btn-ghost" type="button" @click="emit('close')">弃用</button>
      <button class="btn btn-primary" type="button" :disabled="busy || !result" @click="apply">
        <AppIcon name="check" :size="15" /> 替换
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.ar { display: flex; flex-direction: column; gap: 12px; }
.ar-lead { font-size: 12.5px; color: var(--sub); line-height: 1.7; }

.ar-block { border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
.ar-block-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 11px;
  background: #f7f9fc;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-2);
}
.ar-round { margin-left: auto; font-weight: 500; color: var(--brand-deep); }
.ar-busy { margin-left: auto; font-weight: 500; color: var(--sub); }
.ar-text {
  margin: 0;
  padding: 12px 14px;
  font-size: 13.5px;
  line-height: 1.9;
  color: var(--ink);
  max-height: 260px;
  overflow-y: auto;
  white-space: pre-wrap;
}
.ar-text.is-source { background: #fcfdfe; color: var(--ink-2); }
.ar-text.is-result { background: #fff; }

.ar-loading {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 22px 14px;
  font-size: 12.5px;
  color: var(--sub);
}
.ar-spinner {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  border: 2px solid var(--brand-soft);
  border-top-color: var(--brand);
  border-radius: 50%;
  animation: ar-spin 0.7s linear infinite;
}
@keyframes ar-spin {
  to { transform: rotate(360deg); }
}

.ar-tip { font-size: 11.5px; color: var(--sub); line-height: 1.7; }
</style>
