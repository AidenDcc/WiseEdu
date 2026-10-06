<script setup lang="ts">
/**
 * AI 生成结果列表：按题库管理「详细」列表的卡片样式逐题展示
 * （标签行 / 题干 / 选项 / 答案与解析 / 操作行）。
 *
 * 为什么复用题库那套卡片外观、而不是抽成一个公共组件：题库卡片里的编号、状态标签、组卷篮、
 * 解析折叠都依赖 OrgQuestion（status / useCount / updatedAt / variantOf），而生成结果只有
 * GeneratedQuestion（stem / options / answer / analysis / knowledge / difficulty），
 * 另外还多了质检结论与「已保存到题库」这类对方没有的状态 —— 抽成公共组件要挂一堆可选字段与插槽，
 * 两边都更难读。所以**共用的是逻辑与样式规则，不是组件**：
 * - 判定逻辑（difficultyClass / needsFigure）收敛在 `@/utils/question-card`，
 *   与 BankView 同一份实现，改一处两边都生效；
 * - 卡片外观沿用题库列表的 `.q-card` / `.qc-*` 类（同一套设计令牌，两端一致）；
 * - 页面骨架（筛选面板 / 工具条 / 分段控件 / 分页）一律用 `@aiteach/shared` 的
 *   AppFilterPanel / AppListToolbar / AppSegmented / 各页自己的 AppPagination，
 *   不再各页 scoped 复制（原先 `.opt-chip` 在 BankView、`.p-chip` 在 CreateView 各写一份）。
 *
 * 与题库卡片的两点不同：
 * - 答案与解析默认展开：本列表的主任务是「看答案 → 决定采纳」，折起来等于多一次点击；
 * - 不搬题库的 `.detail-list`（flex:1 + overflow-y:auto，那是给固定高度的 .table-panel 用的）：
 *   这里是页面流式布局，滚动交给 AppLayout 的 .content。
 *
 * 采纳态 / 已入库态 / 质检结论一律按**题目 id** 索引，不用下标 —— 丢弃中间一题时下标会整体错位，
 * 采纳标记与质检标签就会挂到别的题上。
 */
import { AppIcon, RichTextViewer } from '@aiteach/shared'
import type { GeneratedQuestion, OrgQuestion } from '@aiteach/shared'
import type { VerifyIssue } from '@/api/ai-verify'
import QuestionOptions from '@/components/question/QuestionOptions.vue'
import { difficultyClass, needsFigure } from '@/utils/question-card'

const props = defineProps<{
  list: GeneratedQuestion[]
  /** 已采纳进题库的题目 id */
  adopted: Set<string>
  /** 已「编辑入库」保存进题库的题目 id（不能再直接采纳，否则题库会出现重复题） */
  saved: Set<string>
  /**
   * 已入库的题，按**生成结果 id** 索引。
   * 有值时卡片正文改用它渲染 —— 编辑过再存，卡片上还挂着旧题干会让人以为没存上。
   * 生成结果与入库题在卡片用到的字段上同形（stem / options / answer / analysis / knowledge /
   * difficulty），故这里按「带这几项」的最小结构取用。
   */
  savedById?: Record<string, Pick<OrgQuestion, 'stem' | 'options' | 'answer' | 'analysis' | 'knowledge' | 'difficulty'>>
  /** 最后一轮的质检结论，按题目 id 索引 */
  issues: Record<string, VerifyIssue>
  /** 实际执行的质检轮数（0 = 未开启检查，此时不打质检标） */
  verifyRounds: number
  /** 请求的出题题型：无选项的主观题拿它显示题型（生成结果本身不带题型字段） */
  requestedType: string
}>()

const emit = defineEmits<{
  adopt: [item: GeneratedQuestion]
  /** 编辑入库：开「题目编辑」弹窗，确认后由父组件存进题库 */
  edit: [item: GeneratedQuestion]
  discard: [id: string]
}>()

/** 卡片正文的取值来源：已入库的看入库版，其余看生成结果 */
type CardBody = Pick<OrgQuestion, 'stem' | 'options' | 'answer' | 'analysis' | 'knowledge' | 'difficulty'>

function bodyOf(item: GeneratedQuestion): CardBody {
  return props.savedById?.[item.id] ?? item
}

/* difficultyClass / needsFigure 见 @/utils/question-card
   （与题库管理 BankView 共用同一份实现） */

function issueOf(id: string): VerifyIssue | null {
  return props.issues[id] ?? null
}
</script>

<template>
  <div class="result-list">
    <article
      v-for="(item, index) in list"
      :key="item.id"
      class="q-card"
      :class="{ adopted: adopted.has(item.id) || saved.has(item.id) }"
    >
      <div class="qc-meta">
        <span class="qc-id">第 {{ index + 1 }} 题</span>
        <span class="tag tag-blue">{{ bodyOf(item).options.length > 0 ? '客观题' : requestedType }}</span>
        <span class="tag" :class="difficultyClass(bodyOf(item).difficulty)">{{ bodyOf(item).difficulty }}</span>
        <span class="qc-kp">{{ bodyOf(item).knowledge.join('、') }}</span>
        <!-- 质检结论打标：error 红（需人工），warn 橙，通过绿 -->
        <span v-if="issueOf(item.id)?.level === 'error'" class="tag tag-red" :title="issueOf(item.id)?.message">
          质检异常 · {{ issueOf(item.id)?.aspect }}
        </span>
        <span v-else-if="issueOf(item.id)?.level === 'warn'" class="tag tag-orange" :title="issueOf(item.id)?.message">
          质检提醒 · {{ issueOf(item.id)?.aspect }}
        </span>
        <span v-else-if="verifyRounds" class="tag tag-green">质检通过</span>
        <span v-if="adopted.has(item.id)" class="tag tag-green">已采纳</span>
        <span v-else-if="saved.has(item.id)" class="tag tag-green">已保存到题库</span>
      </div>

      <RichTextViewer class="qc-stem" :content="bodyOf(item).stem" />
      <!-- 配图（含图形描述的题展示图位；题内已嵌图的不再占位） -->
      <div v-if="needsFigure(bodyOf(item))" class="qc-figure">
        <AppIcon name="image" :size="26" />
        <span>题目配图（演示占位）</span>
      </div>

      <!-- 不传 answer：结果列表要选题 / 采纳，选项里不标正确项（答案在下方答案区） -->
      <QuestionOptions class="qc-options" :options="bodyOf(item).options" />

      <div class="qc-answer">
        <p>
          <b>答案：</b>
          <!-- 客观题答案是字母用强调色纯文本；问答题答案是富文本（公式/插图） -->
          <span v-if="bodyOf(item).options.length" class="qc-answer-text">{{ bodyOf(item).answer || '—' }}</span>
          <RichTextViewer v-else :content="bodyOf(item).answer" tag="span" empty="—" />
        </p>
        <p><b>解析：</b><RichTextViewer :content="bodyOf(item).analysis" tag="span" empty="—" /></p>
      </div>

      <div class="qc-ops">
        <template v-if="adopted.has(item.id)">
          <span class="f-hint">已进入题库待终审</span>
        </template>
        <template v-else-if="saved.has(item.id)">
          <span class="f-hint">已保存到题库，可在「题库管理」查看</span>
          <button class="mini-btn" type="button" @click="emit('edit', item)">重新编辑</button>
        </template>
        <template v-else>
          <button class="mini-btn success" type="button" @click="emit('adopt', item)">采纳</button>
          <button class="mini-btn" type="button" @click="emit('edit', item)">编辑入库</button>
          <button class="mini-btn danger" type="button" @click="emit('discard', item.id)">丢弃</button>
        </template>
      </div>
    </article>
  </div>
</template>

<style scoped>
/* 一排一题：生成结果的主任务是「逐题读 → 决定采纳」，一屏并排两题会把题干、选项、解析都挤成
   窄行（富文本里的公式与配图尤其经不起窄列），且视线要左右来回跳。单列后每题占满整行宽度，
   与「编辑入库」进去的编辑弹窗也是同一种自上而下的读法。 */
.result-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.q-card { border: 1px solid var(--border); border-radius: 14px; background: #fff; padding: 14px 18px; }
.q-card.adopted { border-color: var(--success); }
.qc-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.qc-id { font-size: 13px; font-weight: 700; color: var(--ink); }
.qc-kp { font-size: 12px; color: var(--sub); }
.qc-stem { font-size: 13.5px; color: var(--ink); line-height: 1.8; }
.qc-figure {
  margin-top: 10px;
  height: 110px;
  border: 1px dashed var(--border);
  border-radius: 10px;
  background: repeating-conic-gradient(#f4f7f7 0% 25%, #fff 0% 50%) 50% / 16px 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--sub);
  font-size: 12.5px;
}
/* 选项外观（描边块）由 QuestionOptions 负责，这里只管与题干的间距 */
.qc-options { margin-top: 10px; }
.qc-answer {
  margin-top: 10px;
  border-left: 3px solid var(--brand);
  background: #f7fafa;
  border-radius: 0 10px 10px 0;
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: var(--ink-2);
  line-height: 1.7;
}
.qc-answer b { color: var(--ink); }
.qc-answer-text { color: var(--success); font-weight: 600; }
.qc-ops {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
  border-top: 1px dashed var(--border);
  padding-top: 10px;
}
/* .f-hint 自带 5px 上边距（给纵向表单用的），在横向居中的操作行里会把文字顶歪 */
.qc-ops .f-hint { margin-top: 0; }
</style>
