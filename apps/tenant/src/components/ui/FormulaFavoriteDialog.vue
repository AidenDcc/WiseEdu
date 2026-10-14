<script setup lang="ts">
/**
 * 收藏公式（内联公式输入框下拉里的「收藏」）。
 *
 * 收藏落地的就是「我的公式库」（FR-FX-001）—— 与公式中心新建是同一条接口、同一套字段，
 * 所以这里只需要补上两个库里必填的信息：公式名称（2-20 字）与学科。
 * 学科默认取当前编辑器所属学科（录题时不用再选一次），课程字典拉不到时也不拦着保存：
 * 让用户手填的风险远大于「字典接口偶发失败导致收藏功能整个不可用」。
 *
 * 保存成功后 emit saved —— 调用方据此提示并把公式输入框的焦点收回去，本组件不自己关闭弹窗。
 */
import { computed, onMounted, ref } from 'vue'
import { AppIcon, AppModal, katex, showToast } from '@aiteach/shared'
import 'katex/dist/katex.min.css'
import { fetchTenantDict, saveFormula } from '@/api/org'

const props = withDefaults(
  defineProps<{
    /** 要收藏的 LaTeX 源码 */
    latex: string
    /** 当前学科：作为学科的默认选项 */
    subject?: string
  }>(),
  { subject: '' },
)

const emit = defineEmits<{ close: []; saved: [] }>()

const name = ref('')
const subject = ref(props.subject)
const subjects = ref<string[]>([])
const saving = ref(false)

const previewHtml = computed(() => {
  try {
    return katex.renderToString(props.latex, { throwOnError: false })
  } catch {
    return ''
  }
})

onMounted(async () => {
  try {
    const dict = await fetchTenantDict('subject')
    subjects.value = dict.map((item) => item.name)
    /* 默认学科不在字典里（或本来就没传）时补进去，避免下拉显示为空 */
    if (subject.value && !subjects.value.includes(subject.value)) subjects.value.unshift(subject.value)
  } catch {
    /* 字典拉取失败不阻塞收藏：学科框退化成自由输入 */
  }
})

async function submit() {
  const title = name.value.trim()
  if (title.length < 2 || title.length > 20) {
    showToast('公式名称须为 2-20 字', 'error')
    return
  }
  if (!subject.value.trim()) {
    showToast('请选择学科', 'error')
    return
  }
  saving.value = true
  try {
    await saveFormula({ name: title, subject: subject.value.trim(), latex: props.latex })
    showToast('已收藏到我的公式库', 'success')
    emit('saved')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '收藏失败', 'error')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <AppModal title="收藏公式" :width="520" @close="emit('close')">
    <div class="f-field">
      <label class="f-label">公式预览</label>
      <div class="ff-preview" v-html="previewHtml" />
      <code class="ff-latex">{{ latex }}</code>
    </div>

    <div class="f-field">
      <label class="f-label">公式名称<span class="req">*</span>（2-20 字）</label>
      <input v-model="name" class="f-input" maxlength="20" placeholder="如：一元二次方程求根公式" @keydown.enter="submit" />
    </div>

    <div class="f-field">
      <label class="f-label">学科<span class="req">*</span></label>
      <template v-if="subjects.length">
        <select v-model="subject" class="f-select">
          <option value="" disabled>请选择学科</option>
          <option v-for="item in subjects" :key="item">{{ item }}</option>
        </select>
      </template>
      <!-- 字典拉取失败时的兜底：不因为一个下拉框拿不到选项就让人收藏不了 -->
      <input v-else v-model="subject" class="f-input" placeholder="请输入学科" />
    </div>

    <p class="f-hint">
      <AppIcon name="star" :size="13" />
      收藏后可在「公式中心 → 我的公式库」里检索、复用与分享到机构
    </p>

    <template #footer>
      <button class="btn btn-ghost" type="button" @click="emit('close')">取消</button>
      <button class="btn btn-primary" type="button" :disabled="saving" @click="submit">
        {{ saving ? '收藏中…' : '收藏' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.ff-preview {
  min-height: 46px;
  display: flex;
  align-items: center;
  padding: 8px 12px;
  background: #f7fafa;
  border-radius: 10px;
  overflow-x: auto;
  font-size: 15px;
  color: var(--ink);
  margin-bottom: 6px;
}
.ff-latex {
  display: block;
  font-size: 11.5px;
  color: var(--sub);
  word-break: break-all;
}
.f-hint { display: flex; align-items: center; gap: 5px; }
</style>
