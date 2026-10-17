<script setup lang="ts">
/**
 * 「段落」对话框（Word 的「段落」面板同义）：段落样式、对齐、缩进、间距、行距一次设完。
 *
 * 为什么要有这个弹窗，而不是把这些项全塞进工具栏：工具栏是**高频、单手**的动作（加粗、对齐、
 * 缩进两格），而「左缩进 4 字符 / 段前 9px / 行距 1.75」是一组**成组出现**的排版决定，
 * 一边调一边对照才调得准。挤进工具栏的结果是每个控件只剩一个窄下拉，反而更慢。
 *
 * 取值口径与 Word 一致：**多段选中时以第一段为准**显示（读者据此判断「现在是几字符」），
 * 而**应用时是逐段设置**（见 indent.ts 的 patchBlocks / docFormat.ts 的 mapBlocks）——
 * 这与「把三段合成一个值」是两件事，后者会把本来不一致的段落压平。
 */
import { computed, ref } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import { AppModal, showToast } from '@aiteach/shared'

import { DOC_INDENT_CHARS, DOC_LINE_HEIGHTS, DOC_PARAGRAPH_STYLES, DOC_SPACING_PX } from './doc-options'
import { DOC_ALIGN_TEXT, type DocAlign } from '@/tiptap-extensions/docFormat'
import { INDENT_CHARS_MAX, SPACING_PX_MAX } from '@/tiptap-extensions/indent'

const props = defineProps<{ editor: Editor }>()
const emit = defineEmits<{ close: [] }>()

/** 段落与标题的盒模型属性都挂在节点上；取的时候两者都要问一次（光标在哪一类上由 doc 决定） */
function blockAttr(name: string): unknown {
  const fromParagraph = (props.editor.getAttributes('paragraph') as Record<string, unknown>)[name]
  const fromHeading = (props.editor.getAttributes('heading') as Record<string, unknown>)[name]
  return fromParagraph ?? fromHeading ?? null
}

const currentStyle = computed(() => {
  const level = [1, 2, 3, 4, 5].find((n) => props.editor.isActive('heading', { level: n }))
  return level ? `h${level}` : 'body'
})
const currentAlign = computed<DocAlign>(() => (blockAttr('textAlign') as DocAlign) ?? 'left')
const currentLineHeight = computed(() => (blockAttr('lineHeight') as string | null) ?? '')
const currentFirstLine = computed(() => Number(blockAttr('firstLineChars') ?? 0))
const currentLeft = computed(() => Number(blockAttr('indentLeftChars') ?? 0))
const currentRight = computed(() => Number(blockAttr('indentRightChars') ?? 0))
const currentBefore = computed(() => Number(blockAttr('spaceBefore') ?? 0))
const currentAfter = computed(() => Number(blockAttr('spaceAfter') ?? 0))

/* ===== 本地草稿：弹窗里改的是这份，点「应用」才落到正文 =====
   不直接写正文的原因：段落对话框是「一次设一组值」的场景，边改边落会让每一步都进撤销栈，
   撤销一次只退一个下拉，用户想回到「打开弹窗之前」得按十几次。 */
const draft = ref({
  style: currentStyle.value,
  align: currentAlign.value,
  lineHeight: currentLineHeight.value,
  firstLine: currentFirstLine.value,
  left: currentLeft.value,
  right: currentRight.value,
  before: currentBefore.value,
  after: currentAfter.value,
})

/** 允许手填：档位表只给了常用值，但老师可能有自己的习惯（比如段前 5px） */
function clamp(value: number, max: number) {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.min(Math.round(value * 10) / 10, max)
}
function onNumberInput(key: 'firstLine' | 'left' | 'right' | 'before' | 'after', event: Event) {
  const target = event.target as HTMLInputElement
  draft.value[key] = clamp(Number(target.value), key === 'before' || key === 'after' ? SPACING_PX_MAX : INDENT_CHARS_MAX)
}

function apply() {
  const { editor } = props
  const chain = editor.chain().focus()

  /* 段落样式：先切样式再改其余属性 —— 切样式会替换节点，属性要在新节点上设 */
  const style = DOC_PARAGRAPH_STYLES.find((row) => row.key === draft.value.style)
  if (style) {
    if (style.level === 0) chain.setParagraph().run()
    else chain.setHeading({ level: style.level as 1 | 2 | 3 | 4 | 5 }).run()
  }

  editor
    .chain()
    .focus()
    .setBlockAlign(draft.value.align)
    .setBlockLineHeight(draft.value.lineHeight || null)
    .setFirstLineChars(draft.value.firstLine)
    .setParagraphIndent({ left: draft.value.left, right: draft.value.right })
    .setParagraphSpacing({ before: draft.value.before, after: draft.value.after })
    .run()

  showToast('段落格式已应用', 'success')
  emit('close')
}
</script>

<template>
  <AppModal title="段落" :width="640" @close="emit('close')">
    <div class="dp">
      <!-- 段落样式 + 对齐 -->
      <div class="dp-row">
        <label class="dp-label">段落样式</label>
        <select v-model="draft.style" class="dp-select">
          <option v-for="row in DOC_PARAGRAPH_STYLES" :key="row.key" :value="row.key">{{ row.label }}</option>
        </select>

        <label class="dp-label">对齐</label>
        <div class="dp-seg">
          <button
            v-for="align in (['left', 'center', 'right', 'justify'] as DocAlign[])"
            :key="align"
            class="dp-segbtn"
            :class="{ on: draft.align === align }"
            type="button"
            :title="DOC_ALIGN_TEXT[align]"
            @click="draft.align = align"
          >
            {{ DOC_ALIGN_TEXT[align] }}
          </button>
        </div>
      </div>

      <div class="dp-sep" />

      <!-- 缩进 -->
      <div class="dp-title">缩进</div>
      <div class="dp-row">
        <label class="dp-label">左缩进</label>
        <select v-model.number="draft.left" class="dp-select">
          <option v-for="n in DOC_INDENT_CHARS" :key="n" :value="n">{{ n }} 字符</option>
        </select>
        <input class="dp-num" type="number" min="0" :max="INDENT_CHARS_MAX" step="0.5" :value="draft.left" @input="onNumberInput('left', $event)" />
        <span class="dp-unit">字符</span>
      </div>
      <div class="dp-row">
        <label class="dp-label">右缩进</label>
        <select v-model.number="draft.right" class="dp-select">
          <option v-for="n in DOC_INDENT_CHARS" :key="n" :value="n">{{ n }} 字符</option>
        </select>
        <input class="dp-num" type="number" min="0" :max="INDENT_CHARS_MAX" step="0.5" :value="draft.right" @input="onNumberInput('right', $event)" />
        <span class="dp-unit">字符</span>
      </div>
      <div class="dp-row">
        <label class="dp-label">特殊格式</label>
        <div class="dp-seg">
          <button class="dp-segbtn" :class="{ on: draft.firstLine === 0 }" type="button" @click="draft.firstLine = 0">无</button>
          <button class="dp-segbtn" :class="{ on: draft.firstLine > 0 }" type="button" @click="draft.firstLine = draft.firstLine > 0 ? draft.firstLine : 2">
            首行缩进
          </button>
        </div>
        <input
          class="dp-num"
          type="number"
          min="0"
          :max="INDENT_CHARS_MAX"
          step="0.5"
          :disabled="draft.firstLine === 0"
          :value="draft.firstLine"
          @input="onNumberInput('firstLine', $event)"
        />
        <span class="dp-unit">字符</span>
      </div>

      <div class="dp-sep" />

      <!-- 间距 -->
      <div class="dp-title">间距</div>
      <div class="dp-row">
        <label class="dp-label">段前</label>
        <select v-model.number="draft.before" class="dp-select">
          <option v-for="n in DOC_SPACING_PX" :key="n" :value="n">{{ n }} px</option>
        </select>
        <input class="dp-num" type="number" min="0" :max="SPACING_PX_MAX" step="1" :value="draft.before" @input="onNumberInput('before', $event)" />
        <span class="dp-unit">px</span>
      </div>
      <div class="dp-row">
        <label class="dp-label">段后</label>
        <select v-model.number="draft.after" class="dp-select">
          <option v-for="n in DOC_SPACING_PX" :key="n" :value="n">{{ n }} px</option>
        </select>
        <input class="dp-num" type="number" min="0" :max="SPACING_PX_MAX" step="1" :value="draft.after" @input="onNumberInput('after', $event)" />
        <span class="dp-unit">px</span>
      </div>
      <div class="dp-row">
        <label class="dp-label">行距</label>
        <select v-model="draft.lineHeight" class="dp-select wide">
          <option value="">默认（跟随正文样式）</option>
          <option v-for="row in DOC_LINE_HEIGHTS.filter((r) => r.value)" :key="row.key" :value="row.value as string">
            {{ row.label }}
          </option>
        </select>
      </div>

      <p class="dp-tip">
        多段一起选中时，这里显示的是<b>第一段</b>的值；点「应用」会把上面这组设置<b>逐段</b>落到选中的每个段落上
        （与 Word 的段落对话框一致）。
      </p>
    </div>

    <template #footer>
      <button class="btn btn-ghost" @click="emit('close')">取消</button>
      <button class="btn btn-primary" @click="apply">应用</button>
    </template>
  </AppModal>
</template>

<style scoped>
.dp { display: flex; flex-direction: column; gap: 10px; }
.dp-title { font-size: 12px; font-weight: 700; color: var(--sub); letter-spacing: 0.4px; }
.dp-sep { height: 1px; background: var(--border); margin: 2px 0; }
.dp-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dp-label { width: 62px; flex-shrink: 0; font-size: 12.5px; color: var(--ink-2); }
.dp-select {
  height: 30px;
  min-width: 118px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: #fff;
  color: var(--ink);
  font-size: 12.5px;
  font-family: inherit;
}
.dp-select.wide { min-width: 220px; }
.dp-select:focus { outline: none; border-color: var(--brand); box-shadow: 0 0 0 3px var(--brand-soft); }
.dp-num {
  width: 74px;
  height: 30px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: #fff;
  color: var(--ink);
  font-size: 12.5px;
  font-family: inherit;
}
.dp-num:focus { outline: none; border-color: var(--brand); box-shadow: 0 0 0 3px var(--brand-soft); }
.dp-num:disabled { background: #f5f7fa; color: #a7b0c0; }
.dp-unit { font-size: 12px; color: var(--sub); }
.dp-seg { display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.dp-segbtn {
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: #fff;
  color: var(--ink-2);
  font-size: 12.5px;
  white-space: nowrap;
}
.dp-segbtn.on { border-color: var(--brand); background: var(--brand-soft); color: var(--brand-deep); }
.dp-tip { font-size: 11.5px; color: var(--sub); line-height: 1.7; margin-top: 2px; }
.dp-tip b { color: var(--ink-2); }
</style>
