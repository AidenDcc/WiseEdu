<script setup lang="ts">
/**
 * 全局 AI 问答入口（挂在 AppLayout 上，所有已登录页面常驻）：
 * 右下角可拖拽的悬浮球 + 点击后从右向左推出的对话面板。
 *
 * 三个关键取舍：
 *
 * 1. **会话状态放在这里，不放面板里**。本组件始终挂载，面板是 v-if 的。状态上提之后
 *    关闭面板不会丢掉对话与在途回答；又因为 AppLayout 在 /login 时会卸载，
 *    退出登录（AppLayout.onLogout 不刷新页面）会自动把上一轮用户的对话丢掉 ——
 *    所以也不需要往 localStorage 存一份（共用机房电脑上长期留存师生问答并不合适）。
 * 2. **悬浮球在面板打开时淡出**：面板占满顶栏以下的整条右侧（见 AiChatPanel 的尺寸说明），
 *    而悬浮球默认就在右下角、z-index 90 又高于面板的 45，不淡出就会浮在面板上面压住答案。
 * 3. **Escape 关闭绑在面板自身**（@keydown.esc，配合打开时聚焦输入框），不用 document 级监听：
 *    AppDrawer / AppModal 用的是全局 Escape，若这里也全局监听，抽屉开着时按一次会把两者一起关掉。
 */
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AppIcon } from '@aiteach/shared'
import AiChatPanel from './AiChatPanel.vue'
import { askAi, chatEngine, type ChatSource, type ChatTurn } from '@/api/ai-chat'
import { useDraggableFab } from '@/composables/useDraggableFab'
import { useScope } from '@/composables/useScope'

/** 悬浮球边长：与样式里的 width/height 保持一致，供拖拽定位首帧测算用 */
const FAB_SIZE = 56
/** 回传给模型的历史轮数上限：够接住「那第 2 问呢」这类追问，又不至于把上下文撑爆 */
const HISTORY_TURNS = 6

/** 空态推荐问题：后两条会命中演示数据（题库/资料），一打开就能看到「结合机构资源」的效果 */
const SUGGESTS = [
  '一元二次方程的判别式怎么讲？',
  '帮我设计一道函数单调性的例题',
  '机构题库里有哪些三角函数的题？',
  '高一数学备课重点给我列个提纲',
]

const route = useRoute()
const router = useRouter()
/** 顶部栏全局年级 / 学科：作为上下文告诉模型按哪个学段口径作答（发送时才读，避免取到过期值） */
const { grade, subject } = useScope()

const open = ref(false)
const turns = ref<ChatTurn[]>([])
const busy = ref(false)
/** 阶段文案由 askAi 的 onStage 推进：让「先检索机构资源」这一步对用户可见 */
const status = ref('')
/** 最近一次失败的问题，重试时原样再问一次 */
const failedQuestion = ref('')

const engine = computed(() => chatEngine())

const fabRef = ref<HTMLElement | null>(null)
const { style, dragging, consumeDrag, onPointerDown, onPointerMove, onPointerUp } = useDraggableFab(
  fabRef,
  { size: FAB_SIZE },
)

/** 请求序号：只有最新一次请求可以写状态（清空会话 / 连发两条时作废在途回答） */
let seq = 0

function nextId(): string {
  return `chat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

/** 组装回传给模型的历史：助手侧只发 raw 原文，绝不把富文本 HTML 塞进上下文 */
function historyFrom(list: ChatTurn[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  return list
    .filter((turn) => turn.role === 'user' || turn.raw)
    .slice(-HISTORY_TURNS)
    .map((turn) => ({
      role: turn.role,
      content: (turn.role === 'user' ? turn.content : turn.raw) ?? '',
    }))
}

async function request(
  question: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<void> {
  busy.value = true
  status.value = '正在处理…'
  failedQuestion.value = question
  const mine = (seq += 1)
  try {
    const result = await askAi({
      question,
      /* 页面标题与年级学科都在这时读：本组件常驻，setup 里读会在切换路由后过期 */
      page: String(route.meta.title ?? ''),
      grade: grade.value,
      subject: subject.value,
      history,
      onStage: (stage) => {
        if (mine === seq) status.value = stage
      },
    })
    if (mine !== seq) return
    turns.value.push({
      id: nextId(),
      role: 'assistant',
      content: result.content,
      raw: result.raw,
      sources: result.sources,
      engine: result.engine,
      tokens: result.tokens,
    })
  } catch (error) {
    if (mine !== seq) return
    /* 失败也落成一条消息（带 error 字段）：关掉面板再打开，失败态与重试入口都还在 */
    turns.value.push({
      id: nextId(),
      role: 'assistant',
      content: '',
      error: error instanceof Error ? error.message : 'AI 问答失败，请稍后重试',
    })
  } finally {
    if (mine === seq) {
      busy.value = false
      status.value = ''
    }
  }
}

function send(question: string): void {
  const text = question.trim()
  if (!text || busy.value) return
  /* 先取历史再落本次提问，否则本次问题会在历史里重复出现一遍 */
  const history = historyFrom(turns.value)
  turns.value.push({ id: nextId(), role: 'user', content: text })
  void request(text, history)
}

/**
 * 重试：把最后那条失败气泡换成新回答，**不重新插入用户消息** ——
 * 调 send() 的话对话里会出现两条一模一样的问题。
 */
function retry(): void {
  if (busy.value || !failedQuestion.value) return
  const fromEnd = [...turns.value].reverse().findIndex((turn) => turn.error)
  if (fromEnd < 0) return
  const index = turns.value.length - 1 - fromEnd
  const history = historyFrom(turns.value.slice(0, index))
  turns.value.splice(index, 1)
  void request(failedQuestion.value, history)
}

function reset(): void {
  if (turns.value.length && !window.confirm('确定清空当前会话？')) return
  /* 递增序号作废在途请求：否则刚清空又会冒出一条上一轮的迟到回答 */
  seq += 1
  turns.value = []
  busy.value = false
  status.value = ''
  failedQuestion.value = ''
}

function onNavigate(source: ChatSource): void {
  /* 跳转即收起面板：否则面板会正好盖在要去的那一页上 */
  open.value = false
  void router.push(source.path)
}

/** 拖拽之后的 pointerup 也会派发 click，靠 consumeDrag() 区分「拖动」与「点击」 */
function onFabClick(): void {
  if (consumeDrag()) return
  open.value = true
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fab">
      <button
        v-show="!open"
        ref="fabRef"
        class="ai-fab"
        :class="{ dragging }"
        :style="style"
        type="button"
        aria-label="AI 问答"
        title="AI 问答（可拖动调整位置）"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @click="onFabClick"
      >
        <AppIcon name="sparkles" :size="24" />
      </button>
    </Transition>

    <Transition name="panel">
      <AiChatPanel
        v-if="open"
        :turns="turns"
        :busy="busy"
        :status="status"
        :engine="engine"
        :suggestions="SUGGESTS"
        @close="open = false"
        @send="send"
        @retry="retry"
        @reset="reset"
        @navigate="onNavigate"
        @keydown.esc="open = false"
      />
    </Transition>
  </Teleport>
</template>

<style scoped>
.ai-fab {
  position: fixed;
  z-index: 90;
  width: 56px;
  height: 56px;
  border: none;
  border-radius: 50%;
  background: var(--brand-grad);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 10px 24px rgba(0, 180, 166, 0.36);
  /* 移动端拖动时不要连带滚动页面（配合 useDraggableFab 的 pointer 事件） */
  touch-action: none;
  user-select: none;
  cursor: grab;
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}
.ai-fab:hover {
  transform: scale(1.06);
  box-shadow: 0 12px 28px rgba(0, 180, 166, 0.46);
}
.ai-fab:active { transform: scale(0.98); }
/* 拖动中：位置要跟手，不能有过渡；光标切抓取态 */
.ai-fab.dragging {
  cursor: grabbing;
  transition: none;
}

.fab-enter-active,
.fab-leave-active { transition: opacity 0.18s ease, transform 0.18s ease; }
.fab-enter-from,
.fab-leave-to { opacity: 0; transform: scale(0.8); }

/* 面板的滑动过渡规则写在 AiChatPanel.vue 自己的样式里（过渡类会加到它的根元素上） */
</style>
