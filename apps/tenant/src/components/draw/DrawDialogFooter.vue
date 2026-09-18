<script setup lang="ts">
/**
 * 绘图编辑器统一底部操作栏（规格模块 8）。
 * - 保存草稿：只存工程数据，不导出 SVG，可后续再次打开编辑；
 * - 确认导出并插入 / 保存：导出纯净 SVG → 上传 → 落 media 记录；
 * - 取消：宿主负责未保存改动的二次确认。
 */
withDefaults(defineProps<{ purpose: 'library' | 'insert'; busy?: boolean }>(), { busy: false })

const emit = defineEmits<{
  'save-draft': []
  confirm: []
  cancel: []
}>()
</script>

<template>
  <div class="draw-footer">
    <button class="btn btn-ghost" :disabled="busy" @click="emit('save-draft')">保存草稿</button>
    <div class="draw-footer-right">
      <button class="btn btn-ghost" :disabled="busy" @click="emit('cancel')">取消</button>
      <button class="btn btn-primary" :disabled="busy" @click="emit('confirm')">
        {{ busy ? '导出保存中…' : purpose === 'insert' ? '确认导出并插入' : '确认导出并保存' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.draw-footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.draw-footer-right { display: flex; gap: 10px; }
</style>
