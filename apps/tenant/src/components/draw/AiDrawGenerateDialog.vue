<script setup lang="ts">
import { ref } from 'vue'
import { AppIcon, showToast } from '@aiteach/shared'
import type { DrawEditorType } from '@aiteach/shared'
import AppModal from '@/components/ui/AppModal.vue'
import { generateAiDraw } from '@/api/org'
import {
  stripInteractiveFields,
  validateFabricDeviceProject,
  validateJsxGraphProject,
  validateMolfile,
} from '@/utils/drawSchemaValidator'

/**
 * AI 构图草稿弹窗（规格模块 2）。
 *
 * 调用 AI 网关拿到原始工程 JSON 后，必须先过 Schema 校验：
 * - jsxgraph：过滤 slider / animation / button 等交互字段；
 * - fabric 装置：过滤白名单之外的元件 id；
 * - ketcher：校验 Molfile V2000 合法性。
 * 校验通过才发出 draft 事件（宿主打开对应编辑器并把草稿载入画布）；
 * 校验失败 toast 报错、打印明细，绝不把非法数据交给画布。
 */
const props = defineProps<{ initialType?: DrawEditorType }>()

const emit = defineEmits<{
  close: []
  draft: [payload: { editorType: DrawEditorType; projectJson?: string; molfileText?: string }]
}>()

const TYPES: Array<{ value: DrawEditorType; label: string }> = [
  { value: 'jsxgraph', label: '数学几何题图' },
  { value: 'fabric-chem', label: '化学实验装置图' },
  { value: 'ketcher', label: '有机分子结构式' },
  { value: 'fabric-general', label: '通用简易 SVG 图' },
]

const mediaType = ref<DrawEditorType>(props.initialType ?? 'jsxgraph')
const prompt = ref('')
const generating = ref(false)

const PLACEHOLDERS: Record<DrawEditorType, string> = {
  jsxgraph: '如：初中数学，等腰三角形 ABC，AB=AC，D 是 BC 中点，AD 垂直 BC',
  'fabric-chem': '如：加热高锰酸钾制取氧气，试管口略向下倾斜，导管伸入集气瓶',
  ketcher: '如：乙醇分子的结构简式，展示碳碳单键和羟基',
  'fabric-general': '如：画一个带箭头的光路示意图，标注入射光线',
}

async function onGenerate() {
  if (prompt.value.trim().length < 4) {
    showToast('请描述配图内容（至少 4 个字）', 'error')
    return
  }
  generating.value = true
  try {
    const raw = await generateAiDraw({ mediaType: mediaType.value, userPrompt: prompt.value.trim() })

    if (mediaType.value === 'ketcher') {
      const result = validateMolfile(raw.molfileText ?? '')
      if (!result.ok || !result.data) {
        onInvalid(result.errMsg, raw)
        return
      }
      emit('draft', { editorType: 'ketcher', molfileText: result.data })
      return
    }

    const parsed = raw.projectJson ? JSON.parse(raw.projectJson) : null
    const result =
      mediaType.value === 'jsxgraph'
        ? validateJsxGraphProject(parsed)
        : /* 通用简易画布无元件白名单，只清洗交互字段；装置图走元件白名单校验 */
          mediaType.value === 'fabric-chem'
          ? validateFabricDeviceProject(parsed)
          : stripInteractiveFields(parsed)
    if (!result.ok || !result.data) {
      onInvalid(result.errMsg, raw)
      return
    }
    if (result.dropped.length) {
      showToast(`AI 草稿已过滤 ${result.dropped.length} 项非法内容：${result.dropped.slice(0, 3).join('、')}`, 'success')
    }
    emit('draft', { editorType: mediaType.value, projectJson: JSON.stringify(result.data) })
  } catch (err) {
    onInvalid(err instanceof Error ? err.message : 'AI 草稿请求失败', err)
  } finally {
    generating.value = false
  }
}

function onInvalid(errMsg: string, raw: unknown) {
  console.error('[AI 草稿校验失败]', errMsg, raw)
  showToast('AI生成草稿格式异常，请重新生成或者手动绘制', 'error')
}
</script>

<template>
  <AppModal title="AI 生成配图草稿" :width="520" @close="emit('close')">
    <div class="f-field">
      <label class="f-label">配图类型</label>
      <select v-model="mediaType" class="f-select">
        <option v-for="t in TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
      </select>
    </div>
    <div class="f-field">
      <label class="f-label">配图描述<span class="req">*</span></label>
      <textarea
        v-model="prompt"
        class="f-input ai-textarea"
        rows="4"
        :placeholder="PLACEHOLDERS[mediaType]"
      />
    </div>
    <p class="f-hint">AI 只生成草稿：载入画布后请人工微调，确认导出后才保存 / 插入。</p>
    <template #footer>
      <button class="btn btn-ghost" :disabled="generating" @click="emit('close')">取消</button>
      <button class="btn btn-primary" :disabled="generating" @click="onGenerate">
        <AppIcon name="sparkles" :size="14" /> {{ generating ? '生成中…' : '生成 AI 草稿' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.ai-textarea { resize: vertical; min-height: 96px; line-height: 1.6; }
</style>
