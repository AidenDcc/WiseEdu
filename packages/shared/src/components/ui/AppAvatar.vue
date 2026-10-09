<script setup lang="ts">
/**
 * 用户头像：有自定义头像就显示图片，否则回落到「色相底 + 姓名首字」的字母头像。
 *
 * 这套 `.avatar`（顶栏用户区、个人中心、试卷编辑页顶栏）原本在 5 处各写了一份，
 * 尺寸都是 34/10/15 的那一套；换成组件后，头像变了这 5 处一起变 ——
 * 这正是上一版「只有顶栏有头像」问题的成因。
 */
import { computed } from 'vue'
import { hueColor } from '../../utils/format'

const props = withDefaults(
  defineProps<{
    /** 姓名：字母头像取首字，同时作为图片的说明 */
    name?: string
    /** 头像色相（无自定义头像时的底色） */
    hue?: number
    /** 自定义头像（data URL / 图片地址）；空则用字母头像 */
    avatar?: string
    /** 边长（px） */
    size?: number
    /** 圆角（px） */
    radius?: number
  }>(),
  { name: '', hue: 200, avatar: '', size: 34, radius: 10 },
)

const boxStyle = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  borderRadius: `${props.radius}px`,
  /* 字号跟着边长走，免得每换一处尺寸都要重新对一遍（34px → 15px 与原样式一致） */
  fontSize: `${Math.round(props.size * 0.44)}px`,
  background: props.avatar ? undefined : hueColor(props.hue),
}))

/** 首字：中文取第一个字，英文名会得到首字母 */
const letter = computed(() => props.name.trim().charAt(0) || '?')
</script>

<template>
  <span class="app-avatar" :style="boxStyle">
    <!-- alt 留空：头像旁边永远跟着姓名，读屏再念一遍是重复 -->
    <img v-if="avatar" class="app-avatar-img" :src="avatar" alt="" />
    <template v-else>{{ letter }}</template>
  </span>
</template>

<style scoped>
.app-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
  color: #fff;
  font-weight: 700;
  line-height: 1;
  user-select: none;
}
.app-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
</style>
