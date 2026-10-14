<script setup lang="ts">
/**
 * 材料组合题的编辑区：「共用题干 / 材料」面板 + 「子题列表」面板（左目录 / 右详情）。
 *
 * 位置就在「题目基本信息」下面（见 QuestionEditor），顺序即产品定义的录入顺序：
 * 先写材料 → 再一道一道写子题 → 最后是来源备注与底部按钮。
 *
 * 目录项与右侧表单共用一份 `draft.subQuestions`：**数组顺序就是卷面 (1)(2)(3) 的顺序**，
 * 所以「拖拽排序」直接改数组，不额外存序号 —— 删掉中间一题也不会串号。
 *
 * ## 目录项的取值与排布（对齐题库管理的「详细」列表）
 *
 * 上排「序号 / 题型 / 难度 / 知识点」+ 下排题干（最多两行）。这与题库详细卡片 `.qb-meta`
 * 是同一套信息、同一套标签配色（`difficultyClass`）—— 录题时扫一眼目录就知道这题长什么样，
 * 不必逐条点开右侧详情。
 *
 * 拖拽把手的图标与删除按钮**悬浮覆盖**在卡片上（`position: absolute`）、鼠标移入才显形：
 * 它们不是目录项的信息，占着版面就把「知识点」挤成省略号了。
 *
 * `draft` 是父级持有的同一个 reactive 对象，这里就地改（同 QuestionEditor 的约定）。
 */
import { computed, ref, watch } from 'vue'
import { AppIcon, showToast, truncateRich } from '@aiteach/shared'
import { difficultyClass } from '@aiteach/business-common'
import RichTextEditor from '@/components/ui/RichTextEditor.vue'
import SubQuestionFields from './SubQuestionFields.vue'
import { MAX_SUB_QUESTIONS, emptySubQuestionDraft, nextSubQuestionId } from '@/utils/question-draft'
import type { QuestionDraft } from '@/utils/question-draft'

const props = withDefaults(
  defineProps<{
    draft: QuestionDraft
    errors?: Record<string, string>
    /** 子题红字，按子题 id 分组（由 collectDraftErrors 给出） */
    subErrors?: Record<number, Record<string, string>>
    /** 子题可选题型：只含「独立单题」类别 */
    typeOptions: string[]
    difficultyOptions: string[]
  }>(),
  { errors: () => ({}), subErrors: () => ({}) },
)

const emit = defineEmits<{ change: [] }>()

/** 还能不能再加一道：到上限就把按钮禁掉，并说明原因（不是静默失效） */
const atLimit = computed(() => props.draft.subQuestions.length >= MAX_SUB_QUESTIONS)

/** 当前正在编辑哪一道子题（右侧表单）；默认第一道 */
const activeId = ref<number>(props.draft.subQuestions[0]?.id ?? 0)

/* 载入存量组合题 / 删空重建时，把选中项拉回有效值，否则右侧会空着 */
watch(
  () => props.draft.subQuestions.map((row) => row.id).join(','),
  () => {
    if (props.draft.subQuestions.some((row) => row.id === activeId.value)) return
    activeId.value = props.draft.subQuestions[0]?.id ?? 0
  },
)

const activeIndex = computed(() => props.draft.subQuestions.findIndex((row) => row.id === activeId.value))
const activeSub = computed(() => props.draft.subQuestions.find((row) => row.id === activeId.value) ?? null)

function addSubQuestion() {
  if (atLimit.value) {
    showToast(`一道材料组合题最多 ${MAX_SUB_QUESTIONS} 道子题`, 'error')
    return
  }
  const sub = emptySubQuestionDraft(nextSubQuestionId(props.draft.subQuestions), {
    /* 难度与知识点默认继承母题，进去之后可以改 */
    difficulty: props.draft.difficulty,
    knowledge: props.draft.knowledge,
  })
  props.draft.subQuestions.push(sub)
  activeId.value = sub.id
  emit('change')
}

function removeSubQuestion(id: number) {
  const index = props.draft.subQuestions.findIndex((row) => row.id === id)
  if (index < 0) return
  props.draft.subQuestions.splice(index, 1)
  /* 选中项本身没被删就不动，免得删完一题又跳回第一题 */
  if (activeId.value === id) {
    const next = props.draft.subQuestions[index] ?? props.draft.subQuestions[index - 1]
    activeId.value = next?.id ?? 0
  }
  emit('change')
}

/** 目录项是否还有未通过校验的红字（红点提示，不用逐个点开才发现） */
function hasError(id: number): boolean {
  return Object.keys(props.subErrors[id] ?? {}).length > 0
}

/* ===== 拖拽排序 =====
   用 HTML5 原生拖拽（`draggable` + dragover 时就地换位），不引第三方库：
   拖动过程中直接看到顺序变化，比「拖到某处松手才插入」更直观，也不需要落点指示线。
   把手图标只是「这里可以拖」的视觉提示 —— 真正可拖的是整张卡片，不必瞄准图标。 */
const dragId = ref<number | null>(null)

function onDragStart(id: number) {
  dragId.value = id
}

function onDragOver(index: number) {
  if (dragId.value == null) return
  const from = props.draft.subQuestions.findIndex((row) => row.id === dragId.value)
  if (from < 0 || from === index) return
  const [row] = props.draft.subQuestions.splice(from, 1)
  props.draft.subQuestions.splice(index, 0, row)
  emit('change')
}

function onDragEnd() {
  dragId.value = null
}
</script>

<template>
  <div class="mc">
    <!-- 共用题干 / 材料：材料组合题的正文入口，与独立单题的题干同为富文本 -->
    <div class="panel mc-panel">
      <div class="mc-head">
        <span class="mc-title">共用题干 / 材料</span>
        <span class="f-hint" style="margin: 0">所有子题共用这一段材料，卷面上只出现一次</span>
      </div>
      <RichTextEditor
        v-model="draft.material"
        compact
        :subject="draft.subject"
        :min-height="150"
        placeholder="请输入材料 / 情境描述（可插入公式、图片、表格）"
        @change="emit('change')"
      />
      <p v-if="errors.material" class="f-err">{{ errors.material }}</p>
    </div>

    <!-- 子题列表：左目录 / 右详情 -->
    <div class="panel mc-panel">
      <div class="mc-head">
        <span class="mc-title">子题列表（{{ draft.subQuestions.length }}/{{ MAX_SUB_QUESTIONS }}）</span>
        <span class="f-hint" style="margin: 0">拖动左侧目录可调整顺序，卷面按此顺序编号</span>
        <button
          class="btn btn-primary btn-sm"
          style="margin-left: auto"
          type="button"
          :disabled="atLimit"
          :title="atLimit ? `最多 ${MAX_SUB_QUESTIONS} 道子题` : '新增一道子题'"
          @click="addSubQuestion"
        >
          <AppIcon name="plus" :size="14" /> 添加子题
        </button>
      </div>
      <p v-if="errors.subQuestions" class="f-err">{{ errors.subQuestions }}</p>

      <div v-if="draft.subQuestions.length" class="mc-body">
        <!-- 左：子题目录（上排 序号 / 题型 / 难度 / 知识点，下排题干两行）。
             外面这层 `.mc-dir-wrap` 承担宽度与最小高度，里面的列表绝对定位铺满它 —— 见样式里的说明。 -->
        <div class="mc-dir-wrap">
          <ul class="mc-dir">
            <li
              v-for="(sub, i) in draft.subQuestions"
              :key="sub.id"
              class="dir-item"
              :class="{ on: sub.id === activeId, dragging: dragId === sub.id, invalid: hasError(sub.id) }"
              draggable="true"
              :title="hasError(sub.id) ? '这道子题还有未通过的校验项' : '拖动可调整顺序'"
              @click="activeId = sub.id"
              @dragstart="onDragStart(sub.id)"
              @dragover.prevent="onDragOver(i)"
              @dragend="onDragEnd"
              @drop.prevent="onDragEnd"
            >
              <div class="dir-top">
                <span class="dir-no">{{ i + 1 }}</span>
                <span class="tag tag-blue">{{ sub.type }}</span>
                <span class="tag" :class="difficultyClass(sub.difficulty)">{{ sub.difficulty }}</span>
                <span class="dir-kp" :title="sub.knowledge.join('、')">
                  {{ sub.knowledge.join('、') || '未选知识点' }}
                </span>
              </div>
              <p class="dir-stem">{{ truncateRich(sub.stem, 80) || '未填写题干' }}</p>
              <span v-if="hasError(sub.id)" class="dir-err">待修正</span>

              <!-- 拖拽把手 + 删除：悬浮覆盖，鼠标移入（或键盘聚焦）才显形，不占版面 -->
              <span class="dir-tools">
                <span class="dir-grip" title="按住拖动可调整顺序"><AppIcon name="menu" :size="14" /></span>
                <button class="dir-del" type="button" title="删除子题" @click.stop="removeSubQuestion(sub.id)">
                  <AppIcon name="trash" :size="13" />
                </button>
              </span>
            </li>
          </ul>
        </div>

        <!-- 右：子题信息录入 -->
        <div class="mc-form">
          <SubQuestionFields
            v-if="activeSub"
            :draft="activeSub"
            :index="activeIndex + 1"
            :subject="draft.subject"
            :grade="draft.grade"
            :version="draft.textbook"
            :type-options="typeOptions"
            :difficulty-options="difficultyOptions"
            :errors="subErrors[activeSub.id]"
            @change="emit('change')"
            @remove="removeSubQuestion(activeSub.id)"
          />
        </div>
      </div>

      <p v-else class="mc-empty">还没有子题：点右上「添加子题」开始录入，子题的难度与知识点会默认继承母题。</p>

      <!-- 来源备注（录题页从这一槽位塞进来）：位置仍在整页最下面，与独立单题一致 -->
      <slot name="footer" />
    </div>
  </div>
</template>

<style scoped>
.mc { display: flex; flex-direction: column; gap: 14px; }
.mc-panel { padding: 16px 20px; }
.mc-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
.mc-title { font-size: 15px; font-weight: 700; color: var(--ink); }

/* 左目录 / 右详情：两个平级的边框面板，`stretch` 让两者等高（高度由内容高的一侧决定） */
.mc-body { display: flex; gap: 14px; align-items: stretch; }

/* ===== 左侧目录 =====
   高度：与右侧详情**恒等高**。做法是把列表绝对定位铺满外层 `.mc-dir-wrap`，
   让列表**不参与这一行的行高计算** —— 行高因此只由右侧详情（与外层的 min-height）决定：
   - 若直接给列表 `align-items: stretch`，它的内容高度（50 道子题 ≈ 3400px）会把整行撑起来，
     右侧详情被一起拉成 3400px 的长边框，里面大半是空白；加 `max-height` 封顶又会在
     「右侧详情比封顶值还高」时让两栏对不齐。绝对定位两个问题一起没有。
   - 外层的 min-height = 10 个目录项（项 62px + 间距 6px，按单行题干计；两行题干的实际项
     略高，那只会让左栏更宽裕）。刚切过来只有一两道子题时左栏不会缩成一条，
     面板高度也不会随子题增减跳来跳去。
   列表超出这个高度时自己滚动（`overflow-y: auto`）。 */
.mc-dir-wrap {
  --dir-item-h: 62px;
  --dir-gap: 6px;
  position: relative;
  width: 320px;
  flex-shrink: 0;
  min-height: calc(10 * (var(--dir-item-h) + var(--dir-gap)));
}
.mc-dir {
  position: absolute;
  inset: 0;
  list-style: none;
  margin: 0;
  padding: 8px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--dir-gap);
  border: 1px solid var(--border);
  border-radius: 12px;
  background: #fafcfc;
}

.dir-item {
  position: relative;
  min-height: var(--dir-item-h);
  border: 1.5px solid var(--border);
  border-radius: 10px;
  background: #fff;
  padding: 8px 10px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.dir-item:hover { border-color: var(--brand); }
/* 选中态只改边框与底色（序号不做高亮，它和题型 / 难度一样是信息，不是状态） */
.dir-item.on { border-color: var(--brand); background: var(--brand-soft); }
.dir-item.dragging { opacity: 0.5; }
/* 有未通过校验的子题：左边一道红条，目录上一眼能看出是哪一题 */
.dir-item.invalid { border-left: 3px solid var(--danger); }

/* 上排：序号 / 题型 / 难度 / 知识点（知识点吃掉剩余宽度，超出省略号） */
.dir-top { display: flex; align-items: center; gap: 5px; }
.dir-no {
  width: 20px;
  height: 20px;
  border-radius: 6px;
  background: var(--bg);
  color: var(--sub);
  font-size: 11.5px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.dir-top .tag { flex-shrink: 0; font-size: 11px; padding: 0 6px; line-height: 17px; }
.dir-kp {
  flex: 1;
  min-width: 0;
  font-size: 11.5px;
  color: var(--sub);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 下排：题干，最多两行，超出省略号 */
.dir-stem {
  margin: 5px 0 0;
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--ink-2);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

.dir-err {
  position: absolute;
  top: 8px;
  right: 10px;
  font-size: 11px;
  font-weight: 600;
  color: var(--danger);
}
/* 有待修正标识时给它让出位置，否则红字会盖住知识点 */
.dir-item.invalid .dir-top { padding-right: 52px; }

/* 把手 + 删除：绝对定位盖在卡片右上，鼠标移入 / 键盘聚焦才出现 —— 不挤占知识点那一行 */
.dir-tools {
  position: absolute;
  top: 5px;
  right: 6px;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px 4px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 1px 4px rgba(15, 40, 40, 0.12);
  opacity: 0;
  transition: opacity 0.14s;
}
.dir-item:hover .dir-tools,
.dir-item:focus-within .dir-tools { opacity: 1; }
.dir-grip { display: flex; color: var(--sub); cursor: grab; }
.dir-del {
  display: flex;
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: var(--sub);
  padding: 2px;
  border-radius: 6px;
  transition: color 0.12s, background 0.12s;
}
.dir-del:hover { color: var(--danger); background: var(--danger-soft); }

/* ===== 右侧详情 =====
   不设高度上限：它自己按内容撑开，滚动交给整页（录题页本来就是长表单）。
   左栏 `stretch` 跟着它走，于是「左列表高度 = 右详情高度」。 */
.mc-form {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: #fff;
  padding: 14px 16px;
}
.mc-empty { margin: 0; font-size: 12.5px; color: var(--sub); }
</style>
