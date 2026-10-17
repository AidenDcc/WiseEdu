<script setup lang="ts">
/**
 * 教案 / 学案 / 讲义**模板编辑器**。
 *
 * 模板的正文骨架与一份真实文档是同一种东西（都是文档流 HTML，层级落在 h1~h4 上），所以这里直接用
 * `DocCanvas` —— 和写教案时一模一样的三栏：左边目录（作者因此能当场看到「这份模板会生成哪几节」）、
 * 中间 A4 纸、右边排版工具栏。若另做一个简版编辑器，模板作者就会被迫用两套手感写同一种内容。
 *
 * 外壳没用 `AppModal`：模板编辑需要尽量大的高度（要看到整节骨架），而 `AppModal` 的内容区自带
 * 滚动、与画布内部的滚动会嵌套。这里自己写一个铺满视口的浮层，并把 Esc 关窗登记进全局浮层栈
 * （`overlay-stack`），保证「模板编辑器里再开确认框」时 Esc 只关最上面那层。
 */
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { AppIcon, enterOverlay, exitOverlay, isTopOverlay, showToast } from '@aiteach/shared'
import type { TeachTemplate, TeachTemplateKind } from '@aiteach/shared'
import { saveTeachTemplate } from '@/api/org'
import { useBaseData } from '@aiteach/business-common'
import DocCanvas from './DocCanvas.vue'
import { emptyDocHtml } from '@/views/teach/doc-content'

const props = defineProps<{
  kind: TeachTemplateKind
  /** 被编辑的模板；不传表示新建 */
  template?: TeachTemplate | null
  /** 新建时的初始正文（如「复制一份」或「由某类型骨架派生」） */
  presetContent?: string
  /** 新建时的初始名称（从某份模板派生时通常填「XX（副本）」） */
  presetName?: string
}>()

const emit = defineEmits<{
  close: []
  saved: []
}>()

const { subjects, grades, ensure } = useBaseData()
onMounted(() => {
  void ensure()
  document.addEventListener('keydown', onKeydown)
})
const overlayId = enterOverlay()
onBeforeUnmount(() => {
  exitOverlay(overlayId)
  document.removeEventListener('keydown', onKeydown)
})
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && isTopOverlay(overlayId)) emit('close')
}

const isEdit = !!props.template
/** 系统预置模板不允许改名（后端也拦），但允许改正文与说明 —— 它们是「每类至少有一套骨架」的兜底 */
const isBuiltin = !!props.template?.builtin

const form = reactive({
  name: props.template?.name ?? props.presetName ?? '',
  desc: props.template?.desc ?? '',
  scope: (props.template?.scope ?? 'personal') as 'org' | 'personal',
  subject: props.template?.subject ?? '',
  grade: props.template?.grade ?? '',
  periods: props.template?.periods ?? 1,
})

/** 正文（画布的双向绑定） */
const content = ref(props.template?.content || props.presetContent || emptyDocHtml(props.kind, form.name))
const saving = ref(false)

async function save() {
  const name = form.name.trim()
  if (name.length < 2 || name.length > 30) {
    showToast('模板名称须为 2-30 字', 'error')
    return
  }
  saving.value = true
  try {
    await saveTeachTemplate({
      id: props.template?.id,
      kind: props.kind,
      name,
      desc: form.desc.trim(),
      scope: form.scope,
      subject: form.subject || undefined,
      grade: form.grade || undefined,
      periods: Math.max(1, Math.min(6, Number(form.periods) || 1)),
      content: content.value,
    })
    showToast(isEdit ? '模板已更新' : '模板已创建', 'success')
    emit('saved')
  } catch (error) {
    /* 后端的校验信息（重名、正文为空、预置模板不可改名）比前端的更准，原样透出 */
    showToast(error instanceof Error ? error.message : '保存失败', 'error')
  } finally {
    saving.value = false
  }
}

/** 复制一份当前正文到剪贴板…… 不做。这里只提供「把名称填进正文大标题」这类顺手动作 */
function syncTitleToContent() {
  const name = form.name.trim()
  if (!name) return
  content.value = content.value.replace(/<h1>([^<]*)<\/h1>/, `<h1>${name}</h1>`)
}
</script>

<template>
  <Teleport to="body">
    <div class="tp-mask" @click.self="emit('close')">
      <div class="tp">
        <!-- ================= 头部 ================= -->
        <header class="tp-head">
          <div class="tp-head-main">
            <h3>{{ isEdit ? '编辑模板' : '新建模板' }}</h3>
            <p>模板决定一类文档的骨架：新建时把这份正文填进去，作者可再自由增删改。</p>
          </div>
          <div class="tp-head-actions">
            <button class="btn btn-ghost btn-sm" type="button" @click="emit('close')">取消</button>
            <button class="btn btn-primary btn-sm" type="button" :disabled="saving" @click="save">
              <AppIcon name="save" :size="15" /> {{ saving ? '保存中…' : '保存模板' }}
            </button>
            <button class="tp-x" type="button" title="关闭" @click="emit('close')"><AppIcon name="close" :size="15" /></button>
          </div>
        </header>

        <!-- ================= 主体：左元信息 / 右画布 ================= -->
        <div class="tp-body">
          <aside class="tp-side">
            <div class="f-field">
              <label class="f-label">模板名称<span class="req">*</span></label>
              <input
                v-model="form.name"
                class="f-input"
                maxlength="30"
                :disabled="isBuiltin"
                placeholder="如：新授课教案"
              />
              <p v-if="isBuiltin" class="f-hint">系统预置模板不支持改名，可「新建」一份自己的。</p>
            </div>

            <div class="f-field">
              <label class="f-label">用途说明</label>
              <textarea v-model="form.desc" class="f-textarea" rows="2" placeholder="如：情境导入 → 新知探究 → 巩固应用" />
            </div>

            <div class="f-field">
              <label class="f-label">适用范围</label>
              <div class="tp-radios">
                <label class="tp-radio" :class="{ on: form.scope === 'org' }">
                  <input v-model="form.scope" type="radio" value="org" />
                  <span>机构模板（全员可用）</span>
                </label>
                <label class="tp-radio" :class="{ on: form.scope === 'personal' }">
                  <input v-model="form.scope" type="radio" value="personal" />
                  <span>我的模板（仅自己可见）</span>
                </label>
              </div>
            </div>

            <div class="f-field">
              <label class="f-label">默认学科 / 年级</label>
              <div class="tp-two">
                <select v-model="form.subject" class="f-select">
                  <option value="">不指定</option>
                  <option v-for="s in subjects" :key="s" :value="s">{{ s }}</option>
                </select>
                <select v-model="form.grade" class="f-select">
                  <option value="">不指定</option>
                  <option v-for="g in grades" :key="g" :value="g">{{ g }}</option>
                </select>
              </div>
            </div>

            <div class="f-field">
              <label class="f-label">建议课时</label>
              <input v-model.number="form.periods" class="f-input" type="number" min="1" max="6" />
            </div>

            <button class="btn btn-ghost btn-sm tp-wide" type="button" :disabled="!form.name.trim()" @click="syncTitleToContent">
              <AppIcon name="paragraph" :size="15" /> 用模板名替换正文大标题
            </button>

            <p class="tp-tip">
              正文里的<b>标题 1 / 2 / 3</b> 决定新建文档后左侧目录有几节，用右侧工具栏的「段落样式」设置。
            </p>
          </aside>

          <section class="tp-canvas">
            <DocCanvas
              v-model="content"
              :subject="form.subject"
              :title="form.name || '新模板'"
              image-name="模板插图.png"
            />
          </section>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.tp-mask {
  position: fixed;
  inset: 0;
  z-index: 120;
  background: rgba(20, 26, 40, 0.42);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 18px;
  animation: tp-fade 0.16s ease;
}
.tp {
  width: 1320px;
  max-width: 100%;
  height: 100%;
  max-height: calc(100vh - 36px);
  display: flex;
  flex-direction: column;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  animation: tp-pop 0.2s cubic-bezier(0.34, 1.4, 0.64, 1);
}

.tp-head {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.tp-head-main { flex: 1; min-width: 0; }
.tp-head-main h3 { font-size: 16px; font-weight: 700; }
.tp-head-main p { font-size: 12.5px; color: var(--sub); margin-top: 3px; }
.tp-head-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.tp-x {
  width: 30px; height: 30px;
  border: none; border-radius: 8px;
  background: transparent; color: var(--sub);
  display: flex; align-items: center; justify-content: center;
  transition: background 0.15s, color 0.15s;
}
.tp-x:hover { background: #f2f4fa; color: var(--ink); }

.tp-body { flex: 1; min-height: 0; display: flex; gap: 0; }

.tp-side {
  width: 288px;
  flex-shrink: 0;
  padding: 16px;
  border-right: 1px solid var(--border);
  overflow-y: auto;
  background: #fcfdfe;
}
.tp-side .f-label { display: block; font-size: 13px; font-weight: 600; color: var(--ink-2); margin-bottom: 7px; }
.tp-side .f-label .req { color: var(--danger); margin-left: 2px; }
.tp-two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.tp-radios { display: flex; flex-direction: column; gap: 7px; }
.tp-radio { display: flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--ink-2); cursor: pointer; }
.tp-radio.on { color: var(--brand-deep); font-weight: 600; }
.tp-wide { width: 100%; justify-content: center; margin-top: 2px; }
.tp-tip {
  margin-top: 16px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--brand-soft);
  color: var(--brand-deep);
  font-size: 11.5px;
  line-height: 1.7;
}
.tp-tip b { font-weight: 700; }

.tp-canvas { flex: 1; min-width: 0; padding: 14px 16px 18px; overflow: hidden; }

@keyframes tp-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes tp-pop { from { opacity: 0; transform: translateY(14px) scale(0.98); } to { opacity: 1; transform: none; } }
</style>
