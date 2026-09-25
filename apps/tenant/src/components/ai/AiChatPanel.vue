<script setup lang="ts">
/**
 * AI 问答面板（纯展示：会话状态由 AiAssistant.vue 持有）。
 *
 * 之所以做成展示组件：面板与悬浮球共用一个 v-if 生命周期，若会话状态放在这里，
 * 关闭面板会把对话和**在途的回答**一起丢掉。状态上提到常驻的 AiAssistant 后，
 * 关掉面板再打开，对话与刚生成的回答都还在，也就不需要往 localStorage 落一份
 * （机构端常是共用机房电脑，把师生问答长期留在浏览器里不合适）。
 *
 * 几个关键处理：
 * - 助手消息是 richField() 产出的富文本，统一交给 RichTextViewer 渲染（公式才会显示成公式）；
 *   用户消息是纯文本，走插值渲染（自动转义，不解析 HTML）。
 * - 中文输入法：keydown 里判断 isComposing / keyCode 229，否则用回车确认候选词会直接把半截话发出去。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { AppIcon, RichTextViewer } from '@aiteach/shared'
import type { ChatEngine, ChatSource, ChatTurn } from '@/api/ai-chat'

const props = defineProps<{
  /** 整段对话（含失败气泡，失败气泡里带 error 字段） */
  turns: ChatTurn[]
  busy: boolean
  /** 阶段文案：正在检索资源 / AI 正在思考… */
  status: string
  engine: ChatEngine
  suggestions: string[]
}>()

const emit = defineEmits<{
  close: []
  send: [question: string]
  retry: []
  reset: []
  /** 点击来源卡片：跳转与「跳转时收起面板」都交给父组件决定 */
  navigate: [source: ChatSource]
}>()

const input = ref('')
const listRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLTextAreaElement | null>(null)

const engineLabel = computed(() => (props.engine === 'deepseek' ? '真实 AI' : '本地演示'))

function scrollToBottom(): void {
  const node = listRef.value
  if (node) node.scrollTop = node.scrollHeight
}

/**
 * 新内容出现后滚到底部。
 * 必须夹一层 requestAnimationFrame：RichTextViewer 是在 flush:'post' 的 watcher 里跑 KaTeX 的，
 * 只 nextTick 的话滚动发生在公式节点撑开之前，最后几行会被压在可视区外。
 */
function scrollToBottomAfterRender(): void {
  void nextTick(() => requestAnimationFrame(scrollToBottom))
}

watch(() => [props.turns.length, props.busy, props.status], scrollToBottomAfterRender)

function submit(): void {
  const text = input.value.trim()
  if (!text || props.busy) return
  emit('send', text)
  input.value = ''
}

/** Enter 发送 / Shift+Enter 换行；中文输入法组词阶段的回车不算发送 */
function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.shiftKey) return
  /* isComposing 是标准信号；keyCode 229 兜住部分浏览器在组词结束瞬间的边界情况 */
  if (event.isComposing || event.keyCode === 229) return
  event.preventDefault()
  submit()
}

/** 输入框按内容长高（上限由 CSS 的 max-height 兜住），避免长问题只看到一行 */
function autoGrow(): void {
  const node = inputRef.value
  if (!node) return
  node.style.height = 'auto'
  node.style.height = `${node.scrollHeight}px`
}

/* 发送后输入框被清空，但要手动把内联高度收回去 —— 否则会停在上一问撑开的高度上 */
watch(input, (value) => {
  if (!value) inputRef.value?.style.removeProperty('height')
})

function openSource(source: ChatSource): void {
  emit('navigate', source)
}

onMounted(() => inputRef.value?.focus())
</script>

<template>
  <aside class="chat-panel panel" role="dialog" aria-label="AI 教学助手">
    <header class="chat-head">
      <span class="chat-logo"><AppIcon name="sparkles" :size="16" /></span>
      <div class="chat-titles">
        <h3 class="chat-title">AI 教学助手</h3>
        <p class="chat-sub">结合机构题库与资料作答</p>
      </div>
      <span
        class="engine-badge"
        :class="{ real: engine === 'deepseek' }"
        :title="engine === 'deepseek' ? '已配置 AI 通道，回答由真实模型生成' : '未配置 AI Key，回答为本地演示数据'"
      >
        {{ engineLabel }}
      </span>
      <button class="head-btn" type="button" title="新会话" @click="emit('reset')">
        <AppIcon name="plus" :size="15" />
      </button>
      <button class="head-btn" type="button" title="收起" @click="emit('close')">
        <AppIcon name="close" :size="15" />
      </button>
    </header>

    <div ref="listRef" class="chat-body">
      <!-- 空态：说明能问什么，并给几个可直接点的推荐问题 -->
      <div v-if="!turns.length && !busy" class="chat-empty">
        <span class="empty-logo"><AppIcon name="sparkles" :size="22" /></span>
        <p class="empty-title">有什么可以帮你的？</p>
        <p class="empty-desc">
          可以问知识点讲解、解题思路、命题与备课建议；也可以直接问机构题库、试卷、资料里有哪些相关内容，
          回答会带上出处。
        </p>
        <div class="suggests">
          <button
            v-for="item in suggestions"
            :key="item"
            class="suggest"
            type="button"
            @click="emit('send', item)"
          >
            {{ item }}
          </button>
        </div>
      </div>

      <div v-for="turn in turns" :key="turn.id" class="turn" :class="turn.role">
        <!-- 失败气泡：就地给错误与重试，不打断已有对话 -->
        <div v-if="turn.error" class="bubble bubble-error">
          <p class="error-text">{{ turn.error }}</p>
          <button class="retry" type="button" :disabled="busy" @click="emit('retry')">
            <AppIcon name="arrow-right" :size="13" /> 重试
          </button>
        </div>

        <template v-else>
          <div class="bubble">
            <RichTextViewer v-if="turn.role === 'assistant'" :content="turn.content" />
            <p v-else class="user-text">{{ turn.content }}</p>
          </div>
          <!-- 来源卡片：点开直接跳到对应资源所在页面 -->
          <div v-if="turn.sources?.length" class="sources">
            <span class="sources-label">参考</span>
            <button
              v-for="source in turn.sources"
              :key="source.key"
              class="source"
              type="button"
              :title="`打开${source.kind}：${source.title}`"
              @click="openSource(source)"
            >
              <span class="source-kind">{{ source.kind }}</span>
              <span class="source-title">{{ source.title }}</span>
            </button>
          </div>
          <p v-if="turn.tokens" class="turn-meta">本次消耗 {{ turn.tokens }} tokens</p>
        </template>
      </div>

      <!-- 等待中：打字指示器 + 阶段文案（让「检索资源」这一步可见） -->
      <div v-if="busy" class="turn assistant">
        <div class="bubble typing">
          <span class="dots"><i /><i /><i /></span>
          <span class="status">{{ status || '正在思考…' }}</span>
        </div>
      </div>
    </div>

    <footer class="chat-foot">
      <textarea
        ref="inputRef"
        v-model="input"
        class="chat-input"
        rows="1"
        placeholder="问知识点、解题思路，或机构题库里的资源…"
        @input="autoGrow"
        @keydown="onKeydown"
      />
      <button
        class="send-btn"
        type="button"
        :disabled="!input.trim() || busy"
        :title="busy ? '正在回答…' : '发送（Enter）'"
        @click="submit"
      >
        <AppIcon name="arrow-right" :size="17" />
      </button>
    </footer>
  </aside>
</template>

<style scoped>
/* 从右向左推出 / 收回。过渡类由 AiAssistant 的 <Transition name="panel"> 加在根元素上，
   而组件自己的 scoped 样式必定命中自己的根元素 —— 比写在父组件里依赖「父 scope 会落到子根元素」
   这条规则更稳，故把过渡规则放在这里。translateX(100% + 24px) 让面板完全滑出视口右侧。 */
.panel-enter-active,
.panel-leave-active {
  transition: transform 0.28s cubic-bezier(0.3, 1, 0.4, 1), opacity 0.22s ease;
}
.panel-enter-from,
.panel-leave-to {
  transform: translateX(calc(100% + 24px));
  opacity: 0;
}

/* 面板尺寸与消息中心（AppDrawer，消息中心传 :width="460"）保持一致：
   右侧贴边、撑满剩余高度、直角、只留左边框做分界 —— 也就是抽屉的盒子，只是没有遮罩。
   唯一差别是**顶部不覆盖**：从顶栏下方开始，顶栏及其下拉（用户菜单 / 年级学科选择器）保持可用。

   top 取 62px = AppLayout 里 `.topbar` 的高度。全局 box-sizing 是 border-box，
   所以那 1px 下边框算在 62px 之内，62px 正好贴住顶栏下沿、也不会盖掉这条线。

   高度用 top + bottom 同时定位而不是 height:100vh：移动端浏览器地址栏收放时 100vh 会超出
   可视区，两端都定位则由视口定高，等价于抽屉那边「inset:0 的 flex 容器拉伸」的效果。 */
.chat-panel {
  position: fixed;
  top: 62px;
  right: 0;
  bottom: 0;
  /* 必须低于顶栏的两个下拉（用户菜单 50 / 年级学科 70），否则它们从顶栏展开时会落在面板底下
     而「点了没反应」；又要高于页面内元素（题库底部批量条 40 及以下）。抽屉 110 / 弹窗 120 /
     全局搜索 200 仍高过它，遮罩照旧能压住面板。 */
  z-index: 45;
  width: 460px;
  max-width: calc(100vw - 40px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  /* 贴边面板不留圆角与上/右/下边框（与抽屉一致），左边框保留作为与页面的分界 */
  border-radius: 0;
  border-top: none;
  border-right: none;
  border-bottom: none;
  box-shadow: var(--shadow-lg);
}

/* ---- 头部 ---- */
.chat-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 14px 12px 16px;
  border-bottom: 1px solid var(--border);
}
.chat-logo {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border-radius: 10px;
  background: var(--brand-grad);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 6px 14px rgba(0, 180, 166, 0.28);
}
.chat-titles { flex: 1; min-width: 0; }
.chat-title { font-size: 14.5px; font-weight: 700; }
.chat-sub { font-size: 11.5px; color: var(--sub); margin-top: 2px; }
.engine-badge {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  background: var(--warn-soft);
  color: var(--warn);
}
.engine-badge.real { background: var(--brand-soft); color: var(--brand); }
.head-btn {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--sub);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
}
.head-btn:hover { background: #f2f4fa; color: var(--ink); }

/* ---- 消息区 ---- */
.chat-body {
  flex: 1;
  overflow-y: auto;
  /* 滚到对话末尾后继续滚轮不该带动下层页面（AppLayout 的 .content 也是可滚动的） */
  overscroll-behavior: contain;
  padding: 16px;
  background: var(--bg);
}

.chat-empty { text-align: center; padding: 18px 4px 8px; }
.empty-logo {
  width: 48px;
  height: 48px;
  margin: 0 auto 12px;
  border-radius: 14px;
  background: var(--brand-soft);
  color: var(--brand);
  display: flex;
  align-items: center;
  justify-content: center;
}
.empty-title { font-size: 14.5px; font-weight: 700; }
.empty-desc {
  font-size: 12.5px;
  color: var(--sub);
  line-height: 1.7;
  margin: 8px auto 16px;
  max-width: 300px;
}
.suggests { display: flex; flex-direction: column; gap: 8px; }
.suggest {
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--card);
  color: var(--ink-2);
  font-size: 13px;
  text-align: left;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}
.suggest:hover { border-color: var(--brand); color: var(--brand); background: #fff; }

.turn { display: flex; flex-direction: column; margin-bottom: 14px; }
.turn.user { align-items: flex-end; }
.turn.assistant { align-items: flex-start; }
.bubble {
  max-width: 88%;
  padding: 10px 13px;
  border-radius: 12px;
  font-size: 13.5px;
  line-height: 1.75;
  word-break: break-word;
}
.turn.assistant .bubble {
  background: var(--card);
  border: 1px solid var(--border);
  border-top-left-radius: 4px;
  color: var(--ink);
}
.turn.user .bubble {
  background: var(--brand-grad);
  color: #fff;
  border-top-right-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 180, 166, 0.24);
}
.user-text { white-space: pre-wrap; }
/* 回答按行分段后段落偏多，段间距收紧一点，读起来更连贯 */
.turn.assistant .bubble :deep(p) { margin-bottom: 6px; }
.turn-meta { font-size: 11px; color: var(--sub); margin-top: 6px; }

/* 打字指示器 + 阶段文案 */
.typing { display: flex; align-items: center; gap: 8px; padding: 12px 14px; }
.dots { display: flex; align-items: center; gap: 4px; }
.dots i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--sub);
  animation: typing-bounce 1.1s infinite ease-in-out;
}
.dots i:nth-child(2) { animation-delay: 0.16s; }
.dots i:nth-child(3) { animation-delay: 0.32s; }
@keyframes typing-bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.45; }
  30% { transform: translateY(-4px); opacity: 1; }
}
.status { font-size: 12px; color: var(--sub); }

.bubble-error { background: var(--danger-soft); }
.error-text { color: var(--danger); font-size: 13px; }
.retry {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
  padding: 5px 10px;
  border: 1px solid var(--danger);
  border-radius: 8px;
  background: transparent;
  color: var(--danger);
  font-size: 12.5px;
  font-weight: 600;
}
.retry:hover:not(:disabled) { background: #fff; }
.retry:disabled { opacity: 0.5; cursor: not-allowed; }

/* 来源卡片 */
.sources {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  max-width: 100%;
}
.sources-label { font-size: 11.5px; color: var(--sub); }
.source {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  padding: 4px 9px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--card);
  font-size: 12px;
  color: var(--ink-2);
  transition: border-color 0.15s, color 0.15s;
}
.source:hover { border-color: var(--brand); color: var(--brand); }
.source-kind {
  flex-shrink: 0;
  padding: 0 5px;
  border-radius: 4px;
  background: var(--brand-soft);
  color: var(--brand);
  font-size: 10.5px;
  font-weight: 600;
}
.source-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 170px; }

/* ---- 输入区 ---- */
.chat-foot {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 12px 14px;
  border-top: 1px solid var(--border);
  background: var(--card);
}
.chat-input {
  flex: 1;
  min-height: 38px;
  max-height: 110px;
  padding: 9px 12px;
  border: 1.5px solid var(--border);
  border-radius: 10px;
  background: #f7fafa;
  color: var(--ink);
  font-size: 13.5px;
  line-height: 1.5;
  resize: none;
  overflow-y: auto;
  transition: border-color 0.15s, background 0.15s;
}
.chat-input:focus { outline: none; border-color: var(--brand); background: #fff; }
.send-btn {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  border: none;
  border-radius: 10px;
  background: var(--brand-grad);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 6px 14px rgba(0, 180, 166, 0.3);
  transition: opacity 0.15s;
}
.send-btn:disabled { opacity: 0.45; cursor: not-allowed; box-shadow: none; }
</style>
