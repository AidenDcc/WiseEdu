<script setup lang="ts">
/**
 * 知情同意书 PDF 预览。
 *
 * 用真实 PDF（`utils/consent-pdf.ts` 现场生成）而不是「照着同意书做一页 HTML」：
 * 留档场景里，老师要看到的就是**要归档的那份文件**，预览与下载必须是同一个字节流，
 * 否则「预览看着没问题、下载下来排版错位」这类事没人能提前发现。
 *
 * iframe 里交给浏览器自带的 PDF 阅读器（Chrome / Edge / Safari 都支持 blob URL）——
 * 不引 pdf.js：为了看一页自己生成的 PDF 再拉 2MB 渲染库不划算。个别环境不让内嵌时，
 * 空白区下面一直有「下载查看」的兜底提示。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { AppIcon, AppModal } from '@aiteach/shared'
import type { ConsentRecord, OrgStudent } from '@aiteach/shared'
import { buildConsentPdf, CONSENT_SCOPE_DETAILS } from '@/utils/consent-pdf'
import { downloadBlob, safeFileName } from '@/utils/doc-io'

const props = defineProps<{
  record: ConsentRecord
  student: OrgStudent
  /** 机构名称（页眉 + 印章） */
  orgName: string
}>()

const emit = defineEmits<{ close: [] }>()

const pdfUrl = ref('')
const pdfBlob = ref<Blob | null>(null)
const loading = ref(true)
const error = ref('')

const signed = computed(() => props.record.status === 'granted' && !!props.record.signature)

async function generate() {
  loading.value = true
  error.value = ''
  try {
    const blob = await buildConsentPdf({
      record: props.record,
      student: {
        name: props.student.name,
        studentNo: props.student.studentNo,
        className: props.student.className,
        grade: props.student.grade,
        campus: props.student.campus,
        guardianName: props.student.guardianName,
        guardianPhone: props.student.guardianPhone,
      },
      orgName: props.orgName || 'AI 教学云平台',
    })
    pdfBlob.value = blob
    pdfUrl.value = URL.createObjectURL(blob)
  } catch (err) {
    error.value = err instanceof Error ? err.message : '同意书生成失败'
  } finally {
    loading.value = false
  }
}

function download() {
  if (!pdfBlob.value) return
  downloadBlob(pdfBlob.value, safeFileName(`知情同意书_${props.student.name}_${props.record.docVersion}`, 'pdf'))
}

onMounted(generate)
onBeforeUnmount(() => {
  if (pdfUrl.value) URL.revokeObjectURL(pdfUrl.value)
})
</script>

<template>
  <AppModal :title="`知情同意书 · ${student.name}`" :width="960" @close="emit('close')">
    <!-- 签名文字单独露出：PDF 里是「文档形态」，这里给出可直接核对的签名与授权范围 -->
    <div class="sign-strip">
      <div class="sign-main">
        <span class="sign-label">监护人签名</span>
        <span v-if="signed" class="sign-text">{{ record.signature }}</span>
        <span v-else class="sign-empty">未签署</span>
        <span class="sign-meta">
          {{ record.guardianName }}（{{ record.relation }}）
          <template v-if="record.signedAt"> · {{ record.signedAt }}</template>
          <template v-if="record.channel"> · {{ record.channel }}</template>
        </span>
      </div>
      <div class="sign-scopes">
        <span class="sign-label">授权范围</span>
        <span v-for="scope in record.scopes" :key="scope" class="tag tag-green">{{ scope }}</span>
        <span v-if="!record.scopes.length" class="tag tag-gray">未授权任何范围</span>
      </div>
    </div>

    <p class="doc-hint">
      版本 {{ record.docVersion }} · 共 {{ CONSENT_SCOPE_DETAILS.length }} 项可选授权范围 · 下方为归档 PDF 原件预览
    </p>

    <div class="pdf-frame">
      <p v-if="loading" class="pdf-state">正在生成同意书…</p>
      <p v-else-if="error" class="pdf-state error">{{ error }}</p>
      <iframe v-else :src="pdfUrl" class="pdf-view" title="知情同意书 PDF 预览" />
    </div>
    <p v-if="!loading && !error" class="f-hint">预览区空白时，请点击「下载 PDF」用本地阅读器查看。</p>

    <template #footer>
      <button class="btn btn-ghost" @click="emit('close')">关闭</button>
      <button class="btn btn-primary" :disabled="!pdfBlob" @click="download">
        <AppIcon name="download" :size="15" /> 下载 PDF
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.sign-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px 24px;
  padding: 12px 16px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: #f8fafd;
  margin-bottom: 12px;
}
.sign-main { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.sign-label { font-size: 12px; color: var(--sub); }
.sign-text {
  font-family: 'Kaiti SC', 'STKaiti', 'KaiTi', serif;
  font-size: 24px;
  font-weight: 700;
  color: #0b3d91;
  line-height: 1;
  padding: 0 8px 2px;
  border-bottom: 2px solid rgba(11, 61, 145, 0.35);
}
.sign-empty { font-size: 13px; color: var(--sub); }
.sign-meta { font-size: 12px; color: var(--sub); }
.sign-scopes { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

.doc-hint { font-size: 12px; color: var(--sub); margin-bottom: 8px; }

.pdf-frame {
  height: 560px;
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
  background: #eef1f7;
}
.pdf-view { width: 100%; height: 100%; border: none; display: block; }
.pdf-state {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: var(--sub);
}
.pdf-state.error { color: var(--danger); }
</style>
