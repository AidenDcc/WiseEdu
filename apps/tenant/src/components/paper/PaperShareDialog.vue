<script setup lang="ts">
/**
 * 分享试卷：选有效期 → 拿到对外链接与二维码，可复制链接、可把二维码存成图片。
 *
 * 只在**阅读式预览**（组卷工作台「试卷」页签）里开，且是从预览弹窗里开出来的，所以要
 * 压在预览之上（预览默认 130，故这里默认 140）；预览自己被人为抬高时由调用方传 `zIndex`
 * 一并推上去 —— 详见 AppModal 的 zIndex 说明。
 *
 * 链接与二维码**都是推导值**（`origin` + 卷 id + 有效期），不是「点一下生成、之后一直不变」的
 * 一次性结果：换一个有效期档位就一起重算，不会出现「链接写着 7 天、档位却停在 30 天」的陈旧状态。
 */
import { computed, ref } from 'vue'
import qrcode from 'qrcode-generator'
import { AppIcon, AppModal, copyText, showToast } from '@aiteach/shared'
import type { OrgPaper } from '@aiteach/shared'
import { downloadBlob } from '@/utils/file'

const props = defineProps<{
  paper: OrgPaper
  /** 遮罩层级，透传给 AppModal：从试卷预览（默认 130）里打开时传 140 才压得住 */
  zIndex?: number
}>()
const emit = defineEmits<{ close: [] }>()

/** 分享有效期（天），单选，默认 7 天 */
const days = ref(7)
const EXPIRY_OPTIONS = [1, 3, 7, 30, 90].map((value) => ({ value, label: `${value} 天` }))

/**
 * 演示环境的分享链接：`/s/p{id}`，与「我的文件」的 `/s/f{id}` 同一口径
 * （那个页面在演示环境并没有真正接出来）。有效期写进 query，让「有效期」这个选择
 * 在链接上看得见、也对得上 —— 正因为链接是从 `days` 推导的，换档位才会连二维码一起重算。
 */
const link = computed(() => `${window.location.origin}/s/p${props.paper.id}?e=${days.value}`)

/** 静区（模块数）：四周留白是二维码规范的一部分，缺了它不少扫码器直接读不出 */
const QUIET = 4
/** 下载图片时每个模块的像素边长 */
const CELL = 8
/** 深色模块的颜色：白底深码的对比度最稳 */
const INK = '#1f2937'

const code = computed(() => {
  /* typeNumber 0 = 按内容自动选版本；纠错档 M 是链接这类短文本的常规选择 */
  const qr = qrcode(0, 'M')
  qr.addData(link.value)
  qr.make()
  return qr
})

/** 画布/视图边长（含静区） */
const qrBox = computed(() => code.value.getModuleCount() + QUIET * 2)

/** 二维码画成一条 path（一个深色模块一个 1×1 方块）：比 N² 个 <rect> 少几百个 DOM 节点 */
const qrPath = computed(() => {
  const size = code.value.getModuleCount()
  const parts: string[] = []
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (code.value.isDark(row, col)) parts.push(`M${col + QUIET} ${row + QUIET}h1v1h-1z`)
    }
  }
  return parts.join('')
})

async function onCopy() {
  const ok = await copyText(link.value)
  showToast(
    ok ? `已复制分享链接（演示环境未接入对外公开页）：${link.value}` : `分享链接：${link.value}`,
    ok ? 'success' : 'info',
  )
}

/**
 * 存成 PNG。
 *
 * 不用库自带的 `createDataURL` —— 它吐的是 GIF，存成 `.png` 是名不副实。
 * 自己画到 canvas 再 `toBlob('image/png')`，顺带把静区也画上
 * （`renderTo2dContext` 没有边距参数，静区得自己平移出来）。
 */
function onDownloadQr() {
  const canvas = document.createElement('canvas')
  canvas.width = qrBox.value * CELL
  canvas.height = qrBox.value * CELL
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    showToast('当前浏览器不支持导出二维码图片', 'error')
    return
  }
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = INK
  ctx.translate(QUIET * CELL, QUIET * CELL)
  code.value.renderTo2dContext(ctx, CELL)
  canvas.toBlob((blob) => {
    if (!blob) {
      showToast('二维码图片生成失败', 'error')
      return
    }
    /* 文件名带卷名：下载目录里几份卷的二维码才分得清 */
    downloadBlob(blob, `${props.paper.name}-分享二维码.png`)
    showToast('已保存二维码图片')
  }, 'image/png')
}
</script>

<template>
  <AppModal title="分享试卷" :width="520" :z-index="zIndex ?? 140" @close="emit('close')">
    <div class="ps">
      <div class="f-field">
        <label class="f-label">试卷名称</label>
        <!-- 只读：分享的是「已经存在的这份卷」，名字要改去编辑页改 -->
        <div class="ps-name" :title="paper.name">{{ paper.name }}</div>
      </div>

      <div class="f-field">
        <label class="f-label">分享有效期</label>
        <!-- 单选 chip：档位就五个，下拉要点两下才看全选项 -->
        <div class="ps-chips">
          <button
            v-for="row in EXPIRY_OPTIONS"
            :key="row.value"
            type="button"
            class="ps-chip"
            :class="{ on: days === row.value }"
            @click="days = row.value"
          >
            {{ row.label }}
          </button>
        </div>
      </div>

      <div class="f-field">
        <label class="f-label">分享链接</label>
        <div class="ps-link">
          <input class="f-input" :value="link" readonly @focus="($event.target as HTMLInputElement).select()" />
          <button class="btn btn-ghost btn-sm" type="button" @click="onCopy">
            <AppIcon name="copy" :size="14" /> 复制
          </button>
        </div>
      </div>

      <div class="ps-qr-block">
        <svg
          class="ps-qr"
          :viewBox="`0 0 ${qrBox} ${qrBox}`"
          shape-rendering="crispEdges"
          role="img"
          :aria-label="`分享二维码：${link}`"
        >
          <rect :width="qrBox" :height="qrBox" fill="#fff" />
          <path :d="qrPath" :fill="INK" />
        </svg>
        <button class="btn btn-ghost btn-sm" type="button" @click="onDownloadQr">
          <AppIcon name="download" :size="14" /> 下载二维码图片
        </button>
      </div>

      <p class="ps-note">
        扫二维码或打开链接即可查看这份试卷。链接 {{ days }} 天内有效。演示环境未接入对外公开页，链接仅作演示。
      </p>
    </div>

    <template #footer>
      <button class="btn btn-ghost" type="button" @click="emit('close')">关闭</button>
    </template>
  </AppModal>
</template>

<style scoped>
.ps { display: flex; flex-direction: column; }
/* f-field 自带 margin-bottom，最后一段说明前不再叠加留白 */
.ps .f-field:last-of-type { margin-bottom: 10px; }

.ps-name {
  font-size: 13.5px;
  color: var(--ink);
  background: #f5f7fb;
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 9px 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 有效期档位 chip：与顶栏分段控件同一套配色（选中描主色 + 浅底），只是各自独立成胶囊 */
.ps-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.ps-chip {
  border: 1.5px solid var(--border);
  border-radius: 999px;
  background: #fff;
  color: var(--ink-2);
  font-size: 12.5px;
  padding: 5px 14px;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}
.ps-chip:hover { border-color: var(--brand); color: var(--brand-deep); }
.ps-chip.on { border-color: var(--brand); background: var(--brand-soft); color: var(--brand-deep); font-weight: 600; }

/* 链接框 + 复制按钮同一行：输入框吃剩余宽度（链接很长，不能被按钮挤成省略号） */
.ps-link { display: flex; align-items: center; gap: 8px; }
.ps-link .f-input { flex: 1; min-width: 0; margin: 0; }

.ps-qr-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 14px 0 4px;
}
.ps-qr { width: 168px; height: 168px; border: 1px solid var(--border); border-radius: 10px; }

.ps-note { font-size: 12px; color: var(--sub); line-height: 1.7; }
</style>
