<script setup lang="ts">
/**
 * 题目悬浮操作条的定位壳 —— 试卷预览与试卷编辑画布共用这一份。
 *
 * **为什么要有「壳」这一层**：操作条不能放进纸面里。纸面 `.pe-sheet` / `.pp-sheet` 既
 * `overflow: hidden` 又 `transform: scale()`，块高还决定分版（隐藏测量层量高 → paginateBlocks），
 * 而「打印版式」打的就是那份 DOM。把操作条放进去会三处同时出问题：每页最后一题被裁掉、
 * 插入节点改变分版、打印件上多出按钮。所以纸面里只做**区块描边**，操作条本身 Teleport 到
 * body 上做 fixed 定位 —— 顺便也绕开了遮罩的 backdrop-filter（它会让 fixed 后代以遮罩为
 * 包含块，那样坐标就全错了）。
 *
 * **触发靠容器级委托**：题块外壳自己带 `data-qbar="<questionId>"`，本组件在 document 上听
 * mouseover / mouseout 再 `closest` 找锚点。这样两个宿主页各自只写一行组件标签 + 一个属性，
 * 不必逐块回传事件、也不必给组件挂 ref 去调方法（编辑页的题块数量随分版变化，逐个绑事件
 * 要跟着分版重绑）。
 *
 * 位置每次都是从题块元素的 `getBoundingClientRect()` 现算的：rect 已含 scale，
 * 所以缩放到 50% 时按钮仍是原尺寸；画布滚动时用 rAF 重算，跟着题目走。
 * 横向**右对齐题块右沿**（见 `placeBar`），不是左对齐 —— 鼠标在题目上时按钮就在右手边。
 *
 * **操作条落在题块之内**（贴题块内右下角），不是贴在题块下面。早先贴下沿，看似更「不挡题」，
 * 实际点不到：题与条之间隔着一道空档，再往下就是**下一道题**的区域 —— 鼠标从这一题挪向按钮，
 * 半路落进下一题的 `[data-qbar]`，`mouseover` 当场把条子改指到下一题，于是「想点这一题的按钮，
 * 手一伸它就没了，反倒是下一题的按钮冒出来」。放进题块里就没有这段路：条子压在这一题自己的
 * 地盘上，指针从头到尾没离开过这一题的事件区。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { CSSProperties } from 'vue'
import { showToast } from '@aiteach/shared'
import type { OrgQuestion } from '@aiteach/shared'
import QuestionActionBar from './QuestionActionBar.vue'
import { useComposeBasket } from '@/composables/useComposeBasket'
import { useQuestionFavorites } from '@/composables/useQuestionFavorites'

const props = withDefaults(
  defineProps<{
    /** 题库 / 卷池：按 id 反查题目（题块外壳上只带了 questionId） */
    questions: OrgQuestion[]
    /** 关掉即整条操作条不出现（试卷预览只有浏览模式才给操作条） */
    enabled?: boolean
    /**
     * 选中的题目 id：鼠标移开后操作条不收起，回落到这道题上。
     *
     * 编辑画布用它兑现「点一下题目就出按钮」—— 点题时页面本来就会选中那道题，
     * 于是悬停与点选两条路都通；预览页不传（纯阅读，跟着鼠标走就够了）。
     */
    pinnedId?: number | null
    /**
     * 每道题的评论条数。**不传（null）表示该宿主不评卷**，「评论」按钮不出现 ——
     * 试卷预览是读一份卷，评论文挂在编辑页的题目上。
     */
    commentCounts?: Record<number, number> | null
    /** 已有老师提交过纠错的题目 id。拉不到就不传，退化成「按钮一律显示纠错」 */
    corrected?: Set<number>
    /** 跟随滚动的容器（预览与编辑页各传自己的画布） */
    scrollHost?: HTMLElement | null
    /** 遮罩层级。默认 130；预览从宿主抽屉里打开时会抬到宿主 + 10 以上 */
    zIndex?: number
  }>(),
  { enabled: true, pinnedId: null, commentCounts: null, scrollHost: null, zIndex: 130 },
)

const emit = defineEmits<{
  preview: [item: OrgQuestion]
  correct: [item: OrgQuestion]
  similar: [item: OrgQuestion]
  comment: [item: OrgQuestion]
}>()

/* 收藏与组卷车都是模块级单例，状态直接在这里读 —— 两个宿主页本来也只是透传，
   放进壳里免去两边各写一份「在不在车 / 收藏没收藏」的取值与回调 */
const basket = useComposeBasket()
const favorites = useQuestionFavorites()

const barItem = ref<OrgQuestion | null>(null)
/** 解析浮层朝上开（操作条被翻到题目上方时，或贴着视口下沿时） */
const barPopUp = ref(false)
/** 解析浮层改右对齐（操作条贴视口右边、浮层比操作条宽、从左展开会顶出屏幕时） */
const barFlipX = ref(false)
/** 首帧还没量到尺寸时先藏起来，免得在旧位置闪一下 */
const barReady = ref(false)
const barPos = ref({ left: 0, top: 0 })
const barEl = ref<HTMLElement | null>(null)
/** 悬停的题块元素：不放进 ref —— DOM 节点被响应式代理包一层没有好处 */
let barAnchor: HTMLElement | null = null
/** 指针是否停在某个题块里（决定「选中项变了」时该不该收掉操作条） */
let hovering = false
let barCloseTimer = 0
let barFollowFrame = 0

/** 操作条落在题块内时的内缩：贴着右下角，但不压住块的描边 */
const BAR_INSET = 4
/** 估解析浮层放不放得下时，它与操作条之间的间隙 */
const BAR_GAP = 8
/** 从题目挪到操作条上的宽限时间（两者是不同的 DOM 子树，离开题目会先触发一次 mouseout） */
const BAR_CLOSE_DELAY = 140
/** 解析浮层的估算高度：只用来判断它该朝上还是朝下开，估小了顶多偶尔贴到屏幕边 */
const POPOVER_MIN_H = 150
/** 解析浮层的宽度（与 `QuestionActionBar` 里 `.qab-analysis` 的 width 一致），判断左右翻边用 */
const POPOVER_W = 420

/* 显式标注 CSSProperties：`visibility` 的三态字面量否则会被推断成宽泛的 string */
const barStyle = computed<CSSProperties>(() => ({
  left: `${barPos.value.left}px`,
  top: `${barPos.value.top}px`,
  zIndex: props.zIndex,
  visibility: barReady.value ? 'visible' : 'hidden',
}))

function placeBar() {
  const anchor = barAnchor
  /* 重新分版会把纸面整个换掉：老锚点脱离文档，操作条没有可依附的题，收掉 */
  if (!anchor || !anchor.isConnected) {
    hideBar()
    return
  }
  const rect = anchor.getBoundingClientRect()
  const width = barEl.value?.offsetWidth ?? 0
  const height = barEl.value?.offsetHeight ?? 0
  /* 题块整个滚出视口（选中题在屏幕外时会出现）：收掉，别把条子夹在屏幕上变成一条孤儿按钮。
     下面「下沿滚出去就贴视口底」那条夹取只对**还看得见**的题块成立，这里先把它挡在外面 */
  if (rect.bottom < 8 || rect.top > window.innerHeight - 8) {
    hideBar()
    return
  }
  /* 操作条**右**对齐题块（`rect.right - width`），不是左对齐：鼠标停在题目上时按钮就在手边，
     不必先横穿整道题去找左边那条。两端仍要夹进视口；题块比操作条还窄时右对齐会越过左沿，
     夹完自然退化成左对齐 —— 好过顶出屏幕。
     （上一版条子也在右上角，得为评论角标留出 `BADGE_RESERVE` 那点宽度；现在条子在右下角，
     角标在右上角，两个角互不相干，那点让位一并撤了。） */
  const left = Math.min(Math.max(rect.right - width - BAR_INSET, 8), Math.max(8, window.innerWidth - width - 8))
  /* 贴题块**内**的下沿（右下角）。题块下沿滚出视口（长题只看得见上半截）时夹到视口下沿 ——
     那一带仍被题块盖着，鼠标在题块里就一定看得见条子。最后再兜一次「不许高过题块上沿」：
     题块比条子还矮时（缩放很小的短题）宁可让条子往下探出块外，也不能探到**上一题**的地盘上去 */
  const top = Math.max(
    Math.min(rect.bottom - height - BAR_INSET, window.innerHeight - height - 8),
    rect.top + BAR_INSET,
  )
  /* 解析浮层默认朝下开；下面放不下浮层（约 150px）而上方的确还有地方时，改朝上 */
  const roomBelow = window.innerHeight - 8 - (top + height + BAR_GAP)
  barPopUp.value = roomBelow < POPOVER_MIN_H && top - BAR_GAP - POPOVER_MIN_H > 8
  /* 浮层比操作条宽，操作条贴右边时从左展开会顶出屏幕：改用它自己的右边对齐操作条右边 */
  barFlipX.value = left + POPOVER_W > window.innerWidth - 8
  barPos.value = { left, top }
  barReady.value = true
}

/** 画布滚动 / 内容变化时操作条要跟着题目走：一帧最多重算一次 */
function scheduleBarPlace() {
  if (barFollowFrame) return
  barFollowFrame = requestAnimationFrame(() => {
    barFollowFrame = 0
    if (barItem.value) placeBar()
  })
}

function cancelBarClose() {
  window.clearTimeout(barCloseTimer)
}

function startBarClose() {
  cancelBarClose()
  barCloseTimer = window.setTimeout(hideBar, BAR_CLOSE_DELAY)
}

function hideBar() {
  cancelBarClose()
  barItem.value = null
  barAnchor = null
  barReady.value = false
}

/** 选中的那道题的元素（分版 / 换页后要靠它重新找回来） */
function pinnedAnchor(): HTMLElement | null {
  if (props.pinnedId == null) return null
  return document.querySelector<HTMLElement>(`[data-qbar="${props.pinnedId}"]`)
}

async function showFor(slot: HTMLElement) {
  cancelBarClose()
  /* 题源缺失的块不给操作条：几个动作里除收藏外都要真实题目，只留一个收藏按钮没有意义 */
  const item = props.questions.find((row) => row.id === Number(slot.dataset.qbar))
  if (!item) {
    hideBar()
    return
  }
  /* 同一道题（双栏版式里指针从一栏挪到另一栏）只续命，不重新定位 —— 免得在题内移动时闪 */
  if (barItem.value?.id === item.id) return
  barItem.value = item
  barAnchor = slot
  barReady.value = false
  await nextTick()
  placeBar()
}

function slotOf(event: Event): HTMLElement | null {
  const target = event.target as HTMLElement | null
  return (target?.closest?.('[data-qbar]') as HTMLElement | null) ?? null
}

function onMouseOver(event: MouseEvent) {
  if (!props.enabled) return
  const slot = slotOf(event)
  if (!slot) return
  hovering = true
  void showFor(slot)
}

function onMouseOut(event: MouseEvent) {
  if (!props.enabled) return
  const slot = slotOf(event)
  if (!slot) return
  const related = event.relatedTarget as Node | null
  /* 在题内进出子元素：仍在同一个题块里，不算离开 */
  if (related && slot.contains(related)) return
  /* 指针落到了操作条自己身上：这仍然是「在这一题上」。操作条浮在题块**内部**的右上角，
     块与条互为对方的「外面」—— 若照「离开题块」处理，要么回落到选中题（不是这一题时条子
     当场跳走），要么起一个 140ms 的收起定时器，鼠标还没落到按钮上条子就没了。
     条子的收起由它自己的 mouseleave 负责，那条路照旧。 */
  if (related && barEl.value?.contains(related)) return
  hovering = false
  /* 有选中的题就落回那道题上（点选出来的操作条不该被一次鼠标划过就收走） */
  const pin = pinnedAnchor()
  if (pin && pin !== slot) {
    void showFor(pin)
    return
  }
  startBarClose()
}

/* 选中项变化：没在悬停就把操作条挪到选中的那道题上，选中的不是题目块（卷首 / 材料 / 附加）则收掉 */
watch(
  () => props.pinnedId,
  () => {
    if (hovering) return
    const pin = pinnedAnchor()
    if (pin) void showFor(pin)
    else hideBar()
  },
)

watch(
  () => props.enabled,
  (on) => {
    if (!on) hideBar()
  },
)

/* 跟随滚动：滚动容器由宿主传进来（本组件不知道哪一块在滚） */
let scrollEl: HTMLElement | null = null
function bindScroll() {
  scrollEl?.removeEventListener('scroll', scheduleBarPlace)
  scrollEl = props.scrollHost ?? null
  scrollEl?.addEventListener('scroll', scheduleBarPlace, { passive: true })
}

watch(() => props.scrollHost, bindScroll)

onMounted(() => {
  document.addEventListener('mouseover', onMouseOver)
  document.addEventListener('mouseout', onMouseOut)
  window.addEventListener('resize', hideBar)
  bindScroll()
})

onBeforeUnmount(() => {
  document.removeEventListener('mouseover', onMouseOver)
  document.removeEventListener('mouseout', onMouseOut)
  window.removeEventListener('resize', hideBar)
  scrollEl?.removeEventListener('scroll', scheduleBarPlace)
  cancelBarClose()
  if (barFollowFrame) cancelAnimationFrame(barFollowFrame)
})

/* ===== 操作条上的动作 ===== */

function onFavorite() {
  if (barItem.value) favorites.toggle(barItem.value.id)
}

/** 与「试题」页签同一条入库校验：未入库的题不能进车（FR-PP-003），拦下并说清原因 */
function onBasket() {
  const item = barItem.value
  if (!item) return
  if (basket.has(item.id)) {
    basket.remove(item.id)
    return
  }
  if (item.status !== 'approved') {
    showToast('该题还未入库（待审 / 驳回），不能加入组卷车', 'error')
    return
  }
  /* 来源记 `paper`：这题是从卷面上取的，组卷车按来源分组时要说得清 */
  basket.add(item, 'paper')
}

/* 宿主重新分版 / 切换内容 / 开子弹窗：全都直接收掉操作条（前两者会让锚点失效，
   后者是「弹窗盖在纸面上时不该还有一条悬停条」）。由宿主调 `hide()`。 */
defineExpose({ hide: hideBar })
</script>

<template>
  <!-- 单独一个 Teleport 直接挂到 body（不能放进遮罩 —— 它的 backdrop-filter 会成为 fixed
       后代的包含块，坐标会整体偏掉）。层级是 zIndex（遮罩 +1，夹在遮罩与子弹窗之间）。
       打印时它作为 body 的直接子元素必须在各页的打印样式里显式隐藏。 -->
  <Teleport to="body">
    <div
      v-if="barItem"
      ref="barEl"
      class="qbar-host"
      :class="{ 'is-flip-x': barFlipX }"
      :style="barStyle"
      @mouseenter="cancelBarClose"
      @mouseleave="startBarClose"
    >
      <QuestionActionBar
        :item="barItem"
        :popover-up="barPopUp"
        :favorited="favorites.has(barItem.id)"
        :in-basket="basket.has(barItem.id)"
        :corrected="corrected?.has(barItem.id) ?? false"
        :comment-count="commentCounts ? (commentCounts[barItem.id] ?? 0) : null"
        @preview="emit('preview', barItem)"
        @favorite="onFavorite"
        @correct="emit('correct', barItem)"
        @similar="emit('similar', barItem)"
        @basket="onBasket"
        @comment="emit('comment', barItem)"
      />
    </div>
  </Teleport>
</template>

<style scoped>
.qbar-host {
  position: fixed;
  animation: fade-in 0.12s ease;
}
.qbar-host.is-flip-x :deep(.qab-analysis) { left: auto; right: 0; }

/* scoped 样式里的 keyframes 会被改名，各组件自备一份（预览页那份仍在用它自己的遮罩动画） */
@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
</style>
