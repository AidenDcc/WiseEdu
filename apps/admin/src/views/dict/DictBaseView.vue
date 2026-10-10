<script setup lang="ts">
/**
 * 基础字典：学科 / 年级 / 学期 / 题型 / 难度 / 地区等业务字典。
 *
 * 维护界面在共享组件 `DictManager` 里（与「系统数据字典」共用），本页只负责给类型清单。
 * 其中地区带行政区划编码；考试类型与杯赛已移到「考试类型」树维护，版权信息已移到
 * 「系统管理 → 系统数据字典」—— 都不在本页左栏。
 */
import { BASE_DICT_TYPES, AppPageHeader } from '@aiteach/shared'
import DictManager from '@/components/DictManager.vue'
</script>

<template>
  <div>
    <AppPageHeader desc="平台级业务字典；机构端下拉项与筛选项读的就是这份数据，改动即时生效。" />
    <DictManager :types="BASE_DICT_TYPES" />
  </div>
</template>
