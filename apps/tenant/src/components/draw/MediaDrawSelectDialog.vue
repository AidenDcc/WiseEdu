<script setup lang="ts">
import { AppIcon } from '@aiteach/shared'
import type { DrawEditorType } from '@aiteach/shared'
import AppModal from '@/components/ui/AppModal.vue'

/**
 * 插入理科配图 · 类型选择弹窗（规格模块 1 的 MediaDrawSelectDialog）。
 * 四个选项卡片，各含「手动绘图」（空白画布）与「AI 生成草稿」两个入口。
 */
const emit = defineEmits<{
  close: []
  manual: [type: DrawEditorType]
  ai: [type: DrawEditorType]
}>()

const OPTIONS: Array<{ type: DrawEditorType; icon: string; title: string; desc: string }> = [
  { type: 'jsxgraph', icon: 'shapes', title: '数学几何题图', desc: 'JSXGraph：点线圆、多边形、角度标记、LaTeX 标签' },
  { type: 'fabric-chem', icon: 'flask', title: '化学实验装置图', desc: '预制元件拖拽拼接：试管、酒精灯、集气瓶…' },
  { type: 'ketcher', icon: 'atom', title: '有机分子结构式', desc: 'Ketcher 键线式绘制，导出标准 SVG / molfile' },
  { type: 'fabric-general', icon: 'pen', title: '通用简易 SVG 图', desc: '线条、矩形、箭头、文本、图片自由绘制' },
]
</script>

<template>
  <AppModal title="插入理科配图" :width="640" @close="emit('close')">
    <p class="f-hint" style="margin-bottom: 14px">选择配图类型后手动绘制，或用 AI 依据描述生成草稿（草稿须经人工微调确认后才可保存）</p>
    <div class="ds-grid">
      <div v-for="opt in OPTIONS" :key="opt.type" class="ds-card panel">
        <div class="ds-head">
          <span class="ds-icon"><AppIcon :name="opt.icon" :size="22" /></span>
          <div>
            <p class="ds-title">{{ opt.title }}</p>
            <p class="ds-desc">{{ opt.desc }}</p>
          </div>
        </div>
        <div class="ds-ops">
          <button class="btn btn-primary btn-sm" type="button" @click="emit('manual', opt.type)">手动绘图</button>
          <button class="btn btn-ghost btn-sm" type="button" @click="emit('ai', opt.type)">
            <AppIcon name="sparkles" :size="13" /> AI 生成草稿
          </button>
        </div>
      </div>
    </div>
  </AppModal>
</template>

<style scoped>
.ds-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.ds-card { padding: 14px; display: flex; flex-direction: column; gap: 12px; }
.ds-head { display: flex; gap: 10px; align-items: flex-start; }
.ds-icon {
  width: 40px; height: 40px; flex: none; border-radius: 10px;
  background: var(--brand-soft); color: var(--brand-deep);
  display: flex; align-items: center; justify-content: center;
}
.ds-title { font-size: 14px; font-weight: 700; color: var(--ink); margin: 0 0 3px; }
.ds-desc { font-size: 12px; color: var(--sub); margin: 0; line-height: 1.5; }
.ds-ops { display: flex; gap: 8px; }
.btn-sm { font-size: 12.5px; padding: 6px 12px; }
</style>
