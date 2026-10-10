<script setup lang="ts">
/**
 * 系统数据字典：系统级、随平台统一展示的配置文案。
 *
 * 目前只有版权信息（机构端首页页脚）。它原先挂在「全局字典 → 基础字典」下，与学科 / 年级
 * 这类业务字典并列，位置不对 —— 业务字典是机构的选项来源，这份是平台自己的展示内容。
 * 维护界面复用共享组件 `DictManager`，与基础字典同一套交互（含批量导入 / 导出）。
 */
import { SYSTEM_DICT_TYPES, AppPageHeader } from '@aiteach/shared'
import DictManager from '@/components/DictManager.vue'
</script>

<template>
  <div>
    <AppPageHeader desc="平台级展示文案；随平台统一展示，机构端只读。目前含机构端首页页脚的版权信息。" />
    <DictManager :types="SYSTEM_DICT_TYPES" />
  </div>
</template>
