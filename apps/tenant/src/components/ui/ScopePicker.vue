<script setup lang="ts">
/**
 * 顶部全局「年级 / 学科」选择器：交互同题库左侧的教材级联（年级 → 学科 两行横向平铺），
 * 只是不含教材版本这一级，确定后写回全局作用域（useScope 负责缓存与业务视图跟随）。
 *
 * 按钮显示的是已生效的「年级 / 学科」，面板内是待确认的选择，
 * 点确定才落库 —— 中途切换年级导致学科失效时不会把半截状态推给其他页面。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { AppIcon } from '@aiteach/shared'
import { useScope } from '@/composables/useScope'

const { grade, subject, gradeOptions, optionsForGrade, ensureScope } = useScope()

const rootEl = ref<HTMLElement | null>(null)
const open = ref(false)
/** 面板内的待确认选择 */
const pick = ref({ grade: '', subject: '' })

const label = computed(() => (grade.value ? `${grade.value} / ${subject.value}` : '选择年级 / 学科'))
/** 面板内学科随面板内年级联动 */
const pickSubjectOptions = computed(() => optionsForGrade(pick.value.grade))

function toggle() {
  open.value = !open.value
  if (open.value) pick.value = { grade: grade.value, subject: subject.value }
}

function pickGrade(value: string) {
  pick.value.grade = value
  // 学科随年级动态变化，原选择不在新列表时清空，由用户重新选
  if (!pickSubjectOptions.value.includes(pick.value.subject)) pick.value.subject = ''
}

function pickSubject(value: string) {
  pick.value.subject = value
}

function apply() {
  grade.value = pick.value.grade
  subject.value = pick.value.subject
  open.value = false
}

function onDocClick(event: MouseEvent) {
  if (open.value && rootEl.value && !rootEl.value.contains(event.target as Node)) open.value = false
}

onMounted(() => {
  document.addEventListener('click', onDocClick)
  void ensureScope()
})
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <div ref="rootEl" class="scope-picker">
    <button class="sp-btn" :class="{ open }" type="button" :title="label" @click.stop="toggle">
      <AppIcon name="book" :size="15" />
      <span class="sp-label">{{ label }}</span>
      <AppIcon name="chevron-down" :size="15" class="sp-caret" :class="{ up: open }" />
    </button>

    <!-- 年级 / 学科：每个维度一行，选项横向平铺 -->
    <div v-if="open" class="sp-pop" @click.stop>
      <div class="sp-row">
        <span class="sp-row-label">年级</span>
        <div class="sp-opts">
          <button
            v-for="item in gradeOptions"
            :key="item"
            class="sp-opt"
            :class="{ on: pick.grade === item }"
            type="button"
            @click="pickGrade(item)"
          >
            {{ item }}
          </button>
          <span v-if="gradeOptions.length === 0" class="sp-empty">暂无年级</span>
        </div>
      </div>
      <div class="sp-row">
        <span class="sp-row-label">学科</span>
        <div class="sp-opts">
          <template v-if="pick.grade">
            <button
              v-for="item in pickSubjectOptions"
              :key="item"
              class="sp-opt"
              :class="{ on: pick.subject === item }"
              type="button"
              @click="pickSubject(item)"
            >
              {{ item }}
            </button>
          </template>
          <span v-else class="sp-empty">请先选择年级</span>
        </div>
      </div>
      <div class="sp-foot">
        <button class="sp-apply" type="button" :disabled="!pick.grade || !pick.subject" @click="apply">
          确定
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scope-picker { position: relative; flex-shrink: 0; }
.sp-btn {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 36px;
  max-width: 220px;
  border: 1.5px solid var(--border);
  border-radius: 10px;
  background: #f7fafa;
  padding: 0 10px;
  font-size: 13px;
  color: var(--ink-2);
  transition: border-color 0.15s, background 0.15s;
}
.sp-btn:hover, .sp-btn.open { border-color: var(--brand); background: #fff; }
.sp-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; font-weight: 600; }
.sp-caret { color: var(--sub); transition: transform 0.18s; }
.sp-caret.up { transform: rotate(180deg); }

.sp-pop {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 70;
  width: 440px;
  max-width: calc(100vw - 48px);
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--shadow-lg);
  padding: 10px 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
/* 单个维度：标签 + 横向平铺的选项 */
.sp-row { display: flex; align-items: flex-start; gap: 10px; }
.sp-row-label {
  width: 40px;
  flex-shrink: 0;
  font-size: 11.5px;
  font-weight: 700;
  color: var(--sub);
  line-height: 26px;
  text-align: left;
}
.sp-opts {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 118px;
  overflow-y: auto;
}
.sp-opt {
  border: 1.5px solid var(--border);
  border-radius: 8px;
  background: #fff;
  font-size: 12.5px;
  color: var(--ink-2);
  padding: 3px 11px;
  line-height: 18px;
  transition: all 0.12s;
}
.sp-opt:hover { border-color: var(--brand); color: var(--brand-deep); }
.sp-opt.on { background: var(--brand); border-color: var(--brand); color: #fff; font-weight: 600; }
.sp-empty { font-size: 12px; color: var(--sub); line-height: 26px; }
.sp-foot { display: flex; justify-content: flex-end; border-top: 1px dashed var(--border); padding-top: 8px; }
.sp-apply {
  border: none;
  border-radius: 8px;
  background: var(--brand);
  color: #fff;
  font-size: 12.5px;
  font-weight: 600;
  padding: 6px 20px;
}
.sp-apply:hover:not(:disabled) { background: var(--brand-deep); }
.sp-apply:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
