<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { AppIcon, showToast } from '@aiteach/shared'
import type { DrawEditorType, OrgMedia } from '@aiteach/shared'
import AppModal from '@/components/ui/AppModal.vue'
import DrawDialogFooter from './DrawDialogFooter.vue'
import JsxGraphDraw from './JsxGraphDraw.vue'
import FabricChemDeviceDraw from './FabricChemDeviceDraw.vue'
import KetcherMoleculeDraw from './KetcherMoleculeDraw.vue'
import FabricGeneralDraw from './FabricGeneralDraw.vue'
import { fetchMediaDetail, saveDrawMedia } from '@/api/org'
import { svgToDataUrl } from '@/utils/svgClean'
import { useBaseData } from '@/composables/useBaseData'

/**
 * 绘图编辑器宿主（模块 3~6 的编排层）。
 *
 * 两种用途：
 * - library：从「教辅管理 - 图片」打开，导出 SVG 保存进图片资源库；
 * - insert：从题目 / 教辅富文本编辑器打开，导出后把 draw-svg-image 节点插入光标处。
 *
 * 保存草稿只落工程数据（project_json / molfile_text）；确认导出才生成 SVG 字节。
 * 二次编辑传 mediaId，宿主先取 media 记录再唤起对应编辑器（不从 SVG 反解析）。
 */
const props = withDefaults(
  defineProps<{
    purpose: 'library' | 'insert'
    editorType: DrawEditorType
    /** 二次编辑的 media 记录 id（与 initialProjectJson / initialMolfile 二选一） */
    mediaId?: number
    initialProjectJson?: string
    initialMolfile?: string
    subject?: string
  }>(),
  { mediaId: undefined, initialProjectJson: '', initialMolfile: '', subject: '数学' },
)

const emit = defineEmits<{
  close: []
  /** 确认导出并保存成功后回传 media 记录（插入 / 刷新由调用方决定） */
  saved: [media: OrgMedia]
}>()

const { subjects, ensure, pick } = useBaseData()

const EDITOR_META: Record<DrawEditorType, { title: string; desc: string }> = {
  jsxgraph: { title: '数学几何题图', desc: '点 / 线 / 圆 / 多边形 / 角度与直角标记 / LaTeX 标签' },
  'fabric-chem': { title: '化学实验装置图', desc: '预制元件拖拽拼接，导管连线 + 文本标注' },
  ketcher: { title: '有机分子结构式', desc: '键线式绘制，导出标准 SVG 与 molfile' },
  'fabric-general': { title: '通用简易 SVG 图', desc: '线条 / 矩形 / 箭头 / 文本 / 图片自由组合' },
}

const loading = ref(Boolean(props.mediaId))
const editorType = ref<DrawEditorType>(props.editorType)
const projectJson = ref(props.initialProjectJson)
const molfileText = ref(props.initialMolfile)
const recordId = ref<number | undefined>(props.mediaId)

const name = ref('')
const subject = ref(props.subject)
const knowledge = ref<string[]>([])
const saving = ref(false)

const editorRef = shallowRef<{
  getProjectJson?: () => string
  getMolfile?: () => Promise<string>
  getSvg: () => string | Promise<string>
  isDirty?: () => boolean
  markClean?: () => void
} | null>(null)

const EDITOR_COMPONENTS = {
  jsxgraph: JsxGraphDraw,
  'fabric-chem': FabricChemDeviceDraw,
  ketcher: KetcherMoleculeDraw,
  'fabric-general': FabricGeneralDraw,
} as const

onMounted(async () => {
  await ensure()
  subject.value = pick(subjects.value, subject.value)
  if (props.mediaId) {
    try {
      const media = await fetchMediaDetail(props.mediaId)
      editorType.value = media.editorType ?? props.editorType
      name.value = media.name
      subject.value = pick(subjects.value, media.subject)
      knowledge.value = [...media.knowledge]
      projectJson.value = media.projectJson ?? ''
      molfileText.value = media.molfileText ?? ''
      recordId.value = media.id
    } catch {
      showToast('绘图工程读取失败', 'error')
    } finally {
      loading.value = false
    }
  }
  if (!name.value) name.value = `${EDITOR_META[editorType.value].title}-${new Date().toLocaleDateString('zh-CN')}`
})

function editorProps() {
  switch (editorType.value) {
    case 'ketcher':
      return { initialMolfile: molfileText.value }
    default:
      return { initialProjectJson: projectJson.value }
  }
}

async function collectProject(): Promise<{ projectJson?: string; molfileText?: string }> {
  const editor = editorRef.value
  if (!editor) return {}
  if (editorType.value === 'ketcher') {
    return { molfileText: await editor.getMolfile!() }
  }
  return { projectJson: editor.getProjectJson!() }
}

async function doSave(withSvg: boolean): Promise<OrgMedia | null> {
  const editor = editorRef.value
  if (!editor) return null
  if (name.value.trim().length < 2) {
    showToast('请填写配图名称', 'error')
    return null
  }
  saving.value = true
  try {
    const project = await collectProject()
    const svg = withSvg ? await editor.getSvg() : ''
    const media = await saveDrawMedia({
      id: recordId.value,
      name: name.value.trim(),
      subject: subject.value,
      knowledge: [...knowledge.value],
      editorType: editorType.value,
      ...project,
      svgDataUrl: withSvg ? svgToDataUrl(svg) : undefined,
    })
    recordId.value = media.id
    if (editor.isDirty?.()) editor.markClean?.()
    return media
  } catch (error) {
    console.error('[draw] 保存失败', error)
    showToast(withSvg ? '导出保存失败，请重试' : '草稿保存失败，请重试', 'error')
    return null
  } finally {
    saving.value = false
  }
}

/** 保存草稿：只落工程数据，不导出 SVG */
async function onSaveDraft() {
  const media = await doSave(false)
  if (media) showToast('草稿已保存，可在图片资源中再次打开编辑', 'success')
}

/** 确认导出：纯净 SVG → 落 media 记录 → 交回调用方 */
async function onConfirm() {
  const media = await doSave(true)
  if (!media) return
  showToast('配图已导出保存', 'success')
  emit('saved', media)
  emit('close')
}

function onCancel() {
  const editor = editorRef.value
  if (editor?.isDirty?.() && !window.confirm('放弃当前未保存的绘图修改？')) return
  emit('close')
}

const meta = computed(() => EDITOR_META[editorType.value])
</script>

<template>
  <AppModal :title="`在线画图 · ${meta.title}`" :width="1080" @close="onCancel">
    <p class="f-hint" style="margin-bottom: 10px">{{ meta.desc }}。AI 生成内容仅为草稿，需人工微调确认后才可保存 / 插入。</p>

    <div class="host-meta">
      <div class="f-field" style="flex: 1 1 200px; margin-bottom: 0">
        <label class="f-label">配图名称<span class="req">*</span></label>
        <input v-model="name" class="f-input" placeholder="如：等腰三角形三线合一示意图" />
      </div>
      <div class="f-field" style="flex: 0 0 130px; margin-bottom: 0">
        <label class="f-label">学科</label>
        <select v-model="subject" class="f-select">
          <option v-for="s in subjects" :key="s" :value="s">{{ s }}</option>
        </select>
      </div>
      <div class="f-field" style="flex: 1 1 160px; margin-bottom: 0">
        <label class="f-label">知识点（逗号分隔，选填）</label>
        <input
          :value="knowledge.join('，')"
          class="f-input"
          placeholder="如：全等三角形"
          @input="knowledge = ($event.target as HTMLInputElement).value.split(/[,，\s]+/).filter(Boolean)"
        />
      </div>
    </div>

    <div class="host-stage">
      <p v-if="loading" class="host-loading"><AppIcon name="clock" :size="20" /> 绘图工程加载中…</p>
      <component
        :is="EDITOR_COMPONENTS[editorType]"
        v-else
        ref="editorRef"
        v-bind="editorProps()"
      />
    </div>

    <template #footer>
      <DrawDialogFooter :purpose="purpose" :busy="saving || loading" @save-draft="onSaveDraft" @confirm="onConfirm" @cancel="onCancel" />
    </template>
  </AppModal>
</template>

<style scoped>
.host-meta { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 12px; }
.host-stage { min-height: 300px; }
.host-loading {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  height: 300px; color: var(--sub); font-size: 13px;
}
</style>
