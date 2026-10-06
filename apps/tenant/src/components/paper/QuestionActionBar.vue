<script setup lang="ts">
/**
 * 试卷预览里每道题的悬浮操作条（阅读模式专用）。
 *
 * 六个动作与「试题」页签详细卡片的 `.qc-ops` 完全一致（文案、配色、按钮态照抄，
 * 见 `views/paper/compose/tabs/QuestionsTab.vue`）：预览 / 解析 / 收藏 / 纠错 / 相似 /
 * 加入组卷车。本组件只负责「画 + 开自己的解析浮层」；收藏与组卷车的状态由父级（试卷预览）
 * 从两个模块级单例里读进来传下来 —— 在不在车、收藏没收藏父级本来就知道，不必在这里再取一次。
 *
 * **解析为什么是浮层，而不是纸面上的内联展开**：纸面按真实纸张分版，块高决定分页
 * （隐藏测量层量高 → paginateBlocks），往某道题里插一段答案解析会改块高、触发重新分版 ——
 * 读者眼皮下的页面会当场重排，「打印版式」还会把答案打进纸里。所以解析开在这里：一条绝对
 * 定位在操作条下方（`top: 100%`）的浮层，跟着操作条一起走，不进纸面也不进测量层。
 */
import { computed, ref } from 'vue'
import { RichTextViewer } from '@aiteach/shared'
import type { OrgQuestion } from '@aiteach/shared'
import { isJudgeNoOptions, judgeAnswerText } from '@/utils/question-card'

const props = withDefaults(
  defineProps<{
    item: OrgQuestion
    favorited: boolean
    inBasket: boolean
    /** 本题已有老师提交过纠错（父级拉一次纠错记录后按题判定） */
    corrected: boolean
    /**
     * 解析浮层向上展开。由父级决定：它手里有操作条的落点，只有它知道「下面还剩多少地方」
     * （操作条被翻到题目上方时，或贴着视口下沿时，浮层都必须朝上开，否则会顶出屏幕）。
     */
    popoverUp?: boolean
  }>(),
  { popoverUp: false },
)
const emit = defineEmits<{
  preview: []
  favorite: []
  correct: []
  similar: []
  basket: []
}>()

const analysisOpen = ref(false)

/** 客观题答案是字母、无选项判断题是「对 / 错」，都用纯文本；问答题答案是富文本（含公式 / 插图） */
const answerIsPlain = computed(() => props.item.options.length > 0 || isJudgeNoOptions(props.item))
const answerText = computed(() =>
  isJudgeNoOptions(props.item) ? judgeAnswerText(props.item.answer) : props.item.answer,
)
</script>

<template>
  <!-- 鼠标进出的续命 / 收起由父级的定位壳（`.pp-qbar`）负责：本组件是它的子节点，
       指针从操作条移到解析浮层上时不会触发壳的 mouseleave -->
  <div class="qab" :class="{ 'is-up': popoverUp }">
    <div class="qab-row">
      <button class="mini-btn" type="button" @click="emit('preview')">预览</button>
      <button class="mini-btn" type="button" @click="analysisOpen = !analysisOpen">
        {{ analysisOpen ? '收起解析' : '解析' }}
      </button>
      <button
        class="mini-btn fav"
        :class="{ on: favorited }"
        type="button"
        :title="favorited ? '取消收藏' : '收藏这道题，之后可在「只看收藏」里快速找到'"
        @click="emit('favorite')"
      >
        {{ favorited ? '已收藏' : '收藏' }}
      </button>
      <button
        class="mini-btn"
        type="button"
        :title="corrected ? '这道题已有人提交过纠错反馈，可继续补充' : '提交这道题的问题反馈'"
        @click="emit('correct')"
      >
        {{ corrected ? '已提交纠错' : '纠错' }}
      </button>
      <button class="mini-btn" type="button" @click="emit('similar')">相似</button>
      <button
        class="mini-btn"
        :class="{ success: inBasket }"
        type="button"
        @click="emit('basket')"
      >
        {{ inBasket ? '移出组卷车' : '加入组卷车' }}
      </button>
    </div>

    <!-- 解析浮层：默认贴操作条下沿展开；父级判断下方放不下时加 .is-up 改成朝上（它会同时把
         浮层贴到操作条上沿，所以操作条自己被翻到题目上方时也是这个类） -->
    <div v-if="analysisOpen" class="qab-analysis">
      <p>
        <b>答案：</b>
        <span v-if="answerIsPlain">{{ answerText || '—' }}</span>
        <RichTextViewer v-else :content="item.answer" tag="span" empty="—" />
      </p>
      <p><b>解析：</b><RichTextViewer :content="item.analysis" tag="span" empty="—" /></p>
      <p class="qab-meta">
        #{{ item.id }} · {{ item.type }} · {{ item.difficulty }}
        <template v-if="item.knowledge.length"> · {{ item.knowledge.join('、') }}</template>
      </p>
    </div>
  </div>
</template>

<style scoped>
/* 卡片本体：left / top 与外层层级由父级给（父级把它 Teleport 到 body 再算位置） */
.qab {
  position: relative;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 8px 22px rgba(28, 36, 52, 0.16);
}
.qab-row { display: flex; align-items: center; gap: 2px; padding: 3px 4px; }
.qab-row .mini-btn { padding: 4px 7px; font-size: 12.5px; }
.qab-row .mini-btn.fav.on { color: #b7791f; background: #fdf6e6; }

/* 宽 420 是 `PaperPreviewModal` 判断「从左展开会不会顶出屏幕」的依据（那边的 POPOVER_W），改这里要一起改 */
.qab-analysis {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  width: 420px;
  max-width: calc(100vw - 32px);
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 10px 26px rgba(28, 36, 52, 0.18);
  padding: 10px 12px;
  font-size: 12.5px;
  line-height: 1.75;
  color: var(--ink-2);
}
.qab.is-up .qab-analysis { top: auto; bottom: calc(100% + 6px); }
.qab-analysis b { color: var(--ink); }
.qab-analysis p + p { margin-top: 4px; }
.qab-meta { color: var(--sub); font-size: 11.5px; }
</style>
