<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import type { Ketcher } from 'ketcher-core'
import { showToast } from '@aiteach/shared'
import { mountKetcher } from './ReactKetcher'
import { cleanSvg } from '@/utils/svgClean'

/**
 * Ketcher 有机分子结构式编辑器（规格模块 5）。
 *
 * 两种打开模式：空白新建 / 传入 molfile_text 加载已有分子二次编辑。
 * AI 草稿的 molfile 在载入前已经 validateMolfile 校验，非法文本进不了这里。
 * 导出：标准 SVG（Indigo 渲染，再经 cleanSvg 清洗）+ molfile 文本。
 */
const props = defineProps<{ initialMolfile?: string }>()

const hostEl = ref<HTMLElement | null>(null)
const loading = ref(true)
const error = ref('')
/* 必须用 shallowRef：Ketcher 实例内部用 #私有字段，被 Vue 深层响应式 Proxy 包裹后
   访问私有字段会抛 "Private element is not present on this object"（导出即失败）。 */
const ketcherRef = shallowRef<Ketcher | null>(null)
const dirty = ref(false)

let unmount: (() => void) | null = null
/** 结构变化回调：卸载时需从 subscription 移除 */
let onStructureChange: (() => void) | null = null

onMounted(() => {
  if (!hostEl.value) return
  try {
    unmount = mountKetcher(hostEl.value, (ketcher) => {
      ketcherRef.value = ketcher
      loading.value = false
      /* Ketcher 的 changeEvent 是 subscription 包的对象，注册用 add（非 subscribe） */
      onStructureChange = () => {
        dirty.value = true
      }
      ketcher.changeEvent.add(onStructureChange)
      if (props.initialMolfile) {
        ketcher.setMolecule(props.initialMolfile).catch(() => {
          showToast('分子工程载入失败，已打开空白画布', 'error')
        })
      }
    })
  } catch {
    error.value = '分子编辑器初始化失败，请刷新重试'
    loading.value = false
  }
})

onBeforeUnmount(() => {
  if (ketcherRef.value && onStructureChange) ketcherRef.value.changeEvent.remove(onStructureChange)
  onStructureChange = null
  unmount?.()
  ketcherRef.value = null
})

/** 工程数据：molfile V2000 文本（存入 media 表的 molfile_text） */
async function getMolfile(): Promise<string> {
  if (!ketcherRef.value) throw new Error('编辑器未就绪')
  return ketcherRef.value.getMolfile()
}

/** 标准 SVG：经 Indigo 渲染 + 私有属性清洗 */
async function getSvg(): Promise<string> {
  if (!ketcherRef.value) throw new Error('编辑器未就绪')
  const molfile = await ketcherRef.value.getMolfile()
  const blob = await ketcherRef.value.generateImage(molfile, { outputFormat: 'svg' })
  return cleanSvg(await blob.text())
}

defineExpose({
  getMolfile,
  getSvg,
  isDirty: () => dirty.value,
  markClean: () => {
    dirty.value = false
  },
})
</script>

<template>
  <div class="ketcher-editor">
    <p v-if="loading" class="ketcher-tip">分子编辑器初始化中（首次加载需解析 WASM）…</p>
    <p v-if="error" class="ketcher-tip error">{{ error }}</p>
    <div ref="hostEl" class="ketcher-host" />
  </div>
</template>

<style scoped>
.ketcher-editor { position: relative; }
.ketcher-host {
  width: 100%; height: 520px;
  border: 1px solid var(--border); border-radius: 10px; overflow: hidden;
}
.ketcher-tip {
  position: absolute; inset: 0; z-index: 2;
  display: flex; align-items: center; justify-content: center;
  background: rgb(255 255 255 / 82%);
  font-size: 13px; color: var(--sub);
}
.ketcher-tip.error { color: #d64545; }
</style>
