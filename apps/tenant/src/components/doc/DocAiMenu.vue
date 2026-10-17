<script setup lang="ts">
/**
 * 划词 AI 浮动菜单：在正文里选中一段话即浮出，给出「改写 / 扩写 / 缩写 / 润色 / 纠错」。
 *
 * 为什么入口是「划词」而不是顶栏一个「AI 写作」按钮：备课的真实动作是**改某一段**，
 * 不是重写整篇。整篇生成是另一个入口（教案在右侧图标栏的「AI 教案」，学案 / 讲义在顶栏），
 * 两者失败的代价也不同 —— 改一段失败了重选一次就行，整篇生成失败要扔掉一整份稿子。
 *
 * 定位用 `coordsAtPos` 取选区的视口坐标，菜单用 `position: fixed` 钉在上面：
 * 纸张画布自带滚动、还套着 `zoom`，把菜单放在编辑器内部会跟着一起缩放与裁切，
 * 挂在 body 坐标系（fixed）反而最稳。
 *
 * 组件本身**不碰编辑器内容**：只把动作 emit 出去，由画布（DocCanvas）负责取选区文本、
 * 调接口、把结果替换回选区 —— 与「工具栏只碰内容的动作留在自己能做的范围内」同一条边界。
 */
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import { AppIcon, TEACH_AI_TEXT_HINT, TEACH_AI_TEXT_TEXT } from '@aiteach/shared'
import type { TeachAiTextAction } from '@aiteach/shared'

const props = defineProps<{
  editor: Editor
}>()

const emit = defineEmits<{ action: [action: TeachAiTextAction] }>()

const ACTIONS: TeachAiTextAction[] = ['rewrite', 'expand', 'shorten', 'polish', 'proofread']

const visible = ref(false)
const pos = reactive({ left: 0, top: 0, above: true })

const elRef = ref<HTMLElement | null>(null)

/**
 * 菜单宽度（px）：五个动作**排成一行不换行**，所以这个值必须放得下它们
 * （5 个两字按钮 ≈ 5×60 + 间距 ≈ 330）。靠边选中时也靠它把菜单夹在视口内。
 */
const MENU_WIDTH = 348
/** 菜单高度兜底：首次渲染前量不到真实高度，用一个接近真实值（标题行 + 一行按钮）的数 */
const MENU_FALLBACK_HEIGHT = 78

/**
 * 定位。
 *
 * 早先的写法是「锚点在上方，永远用 translate(-50%, -100%) 向上展开」，滚动到顶部附近时
 * `Math.max(48, …)` 那个下限会把菜单钉在 y=48，再往上翻 100% 就翻到了视口外面 ——
 * 屏幕上剩下半张白块（就是滚动时看到的那块）。现在按「上方放得下就向上、放不下就向下」
 * 显式定位，并给一个「选区已经滚出视口就收起」的兜底。
 */
function update() {
  const editor = props.editor
  const view = editor.view
  const { from, to } = view.state.selection
  /* 没选区、失焦、或正在用输入法组字时不浮出：组字过程中的临时选区会让菜单乱跳 */
  if (from === to || !view.hasFocus() || view.composing) {
    visible.value = false
    return
  }
  const start = view.coordsAtPos(from)
  const end = view.coordsAtPos(to)
  /* 选区整个滚出视口时没有「贴着它」的位置可言，收起来比飘在别处好 */
  const anchorTop = Math.min(start.top, end.top)
  const anchorBottom = Math.max(start.bottom, end.bottom)
  if (anchorBottom < 0 || anchorTop > window.innerHeight) {
    visible.value = false
    return
  }

  const height = elRef.value?.offsetHeight || MENU_FALLBACK_HEIGHT
  const above = anchorTop - 10 - height >= 8
  const half = MENU_WIDTH / 2
  pos.left = Math.min(Math.max((start.left + end.left) / 2, half + 8), window.innerWidth - half - 8)
  pos.top = above ? anchorTop - 10 : anchorBottom + 10
  pos.above = above
  visible.value = true
}

watch(
  () => props.editor,
  (instance, _old, onCleanup) => {
    const handler = () => update()
    instance.on('selectionUpdate', handler)
    instance.on('blur', handler)
    onCleanup(() => {
      instance.off('selectionUpdate', handler)
      instance.off('blur', handler)
    })
  },
  { immediate: true },
)

/* 滚动与缩放会改变选区的视口坐标，但不会触发 selectionUpdate —— 得自己监听。
   重算之后菜单跟着选区走（而不是一边滚一边留一个错位的框）。 */
function onViewportChange() {
  if (visible.value) update()
}
window.addEventListener('scroll', onViewportChange, true)
window.addEventListener('resize', onViewportChange)
onBeforeUnmount(() => {
  window.removeEventListener('scroll', onViewportChange, true)
  window.removeEventListener('resize', onViewportChange)
})

/** 首次显示时量不到真实高度，渲染完再校一次位置，免得刚好卡在视口边缘 */
watch(visible, (value) => {
  if (value) void nextTick(update)
})

const style = computed(() => ({
  left: `${pos.left}px`,
  top: `${pos.top}px`,
  width: `${MENU_WIDTH}px`,
  transform: `translate(-50%, ${pos.above ? '-100%' : '0'})`,
}))

function run(action: TeachAiTextAction) {
  /* 先收起菜单再发动作：结果弹窗会盖在这里，菜单留着反而挡在它上面 */
  visible.value = false
  emit('action', action)
}
</script>

<template>
  <div v-if="visible" ref="elRef" class="da" :style="style" @mousedown.prevent>
    <div class="da-head">
      <AppIcon name="sparkles" :size="13" />
      <span>AI 改这段</span>
    </div>
    <div class="da-actions">
      <button
        v-for="action in ACTIONS"
        :key="action"
        class="da-btn"
        type="button"
        :title="TEACH_AI_TEXT_HINT[action]"
        @click="run(action)"
      >
        {{ TEACH_AI_TEXT_TEXT[action] }}
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 定位由 style 里的 left / top / transform 决定（贴着选区上方或下方） */
.da {
  position: fixed;
  z-index: 60;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--card);
  box-shadow: 0 10px 30px rgba(28, 36, 52, 0.18);
}
.da-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  font-weight: 700;
  color: var(--brand-deep);
  margin-bottom: 6px;
}
/* 五个动作一行排开：换行会把菜单撑成两行、也跟着更容易贴到视口边缘 */
.da-actions { display: flex; flex-wrap: nowrap; gap: 5px; }
.da-btn {
  flex: 1;
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  color: var(--ink-2);
  font-size: 12.5px;
  white-space: nowrap;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}
.da-btn:hover { border-color: var(--brand); color: var(--brand-deep); background: var(--brand-soft); }
</style>
