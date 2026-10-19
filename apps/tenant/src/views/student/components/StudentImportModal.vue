<script setup lang="ts">
/**
 * 学生档案 Excel 批量导入。
 *
 * 三步：选文件（含模板下载）→ 解析预览（逐行标出会被跳过的原因）→ 导入结果（成功 / 失败明细）。
 *
 * ## 为什么要「预览」这一步
 *
 * 带 300 行的名单里只要有 5 行班级名写错，直接导入的结果就是「一半进了一半没进，
 * 而且不知道差在哪」。所以先本地解析、把每行的判断结果摊开给人看一遍；确认后再提交，
 * 服务端**仍然逐行校验**（前端只是提前告知，不替代校验）。
 *
 * ## 列名映射
 *
 * 按表头文字认列，不按列序号：老师经常自己调列顺序、加备注列。认不出「姓名」列就直接
 * 拦在预览前，而不是导进去一堆空名字。
 */
import { computed, ref } from 'vue'
import { AppIcon, AppModal, showToast } from '@aiteach/shared'
import type { ClassFormMeta, OrgClass, StudentImportResult, StudentImportRow } from '@aiteach/shared'
import { importStudents } from '@/api/student'
import { buildXlsx, readSpreadsheet } from '@/utils/xlsx-lite'
import { downloadBlob, safeFileName } from '@/utils/doc-io'

const props = defineProps<{
  meta: ClassFormMeta | null
  classes: OrgClass[]
}>()

const emit = defineEmits<{ close: []; imported: [result: StudentImportResult] }>()

/** 模板表头（顺序即模板列序） */
const TEMPLATE_HEADERS = ['姓名', '性别', '校区', '年级', '班级', '学号', '监护人姓名', '监护人手机']

/** 表头别名：同一份数据各家教务系统导出的叫法不一样，认出来就不用手改 */
const HEADER_ALIASES: Record<keyof StudentImportRow, string[]> = {
  name: ['姓名', '学生姓名', '学生'],
  gender: ['性别'],
  campus: ['校区', '所属校区'],
  grade: ['年级'],
  className: ['班级', '班级名称', '所在班级'],
  studentNo: ['学号', '学籍号'],
  guardianName: ['监护人姓名', '家长姓名', '监护人'],
  guardianPhone: ['监护人手机', '监护人手机号', '家长手机', '手机号', '联系电话'],
}

const step = ref<'pick' | 'preview' | 'result'>('pick')
const fileName = ref('')
const parsing = ref(false)
const importing = ref(false)
const dragOver = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

interface PreviewRow {
  /** Excel 里的可见行号（表头是第 1 行） */
  row: number
  data: StudentImportRow
  problems: string[]
}

const preview = ref<PreviewRow[]>([])
const result = ref<StudentImportResult | null>(null)

const validRows = computed(() => preview.value.filter((row) => !row.problems.length))
const invalidRows = computed(() => preview.value.filter((row) => row.problems.length))

/* ==================== 模板 ==================== */

function downloadTemplate() {
  const blob = buildXlsx({
    sheetName: '学生名单',
    rows: [TEMPLATE_HEADERS],
    widths: [14, 8, 14, 10, 16, 14, 14, 16],
  })
  downloadBlob(blob, safeFileName('学生档案导入模板', 'xlsx'))
  showToast('模板已下载：填写后直接拖回本窗口即可', 'success')
}

/* ==================== 解析 ==================== */

function headerIndex(headers: string[], key: keyof StudentImportRow): number {
  const aliases = HEADER_ALIASES[key]
  return headers.findIndex((header) => aliases.some((alias) => header.replace(/\s/g, '') === alias))
}

/**
 * 本地预检（与服务端同一套规则，服务端才是最终判定）。
 *
 * 只查「一定能判死的」：必填缺失、手机号格式、班级能否在本机构匹配上、文件内学号重复。
 * 像「同名校验」「班级已停用」这类要看库里全量数据，交给服务端。
 */
function validate(row: StudentImportRow, seenNos: Set<string>): string[] {
  const problems: string[] = []
  if (!row.name?.trim()) problems.push('姓名为空')

  if (!row.grade?.trim()) problems.push('年级为空')
  else if (props.meta && !props.meta.grades.some((item) => item.name === row.grade!.trim())) {
    problems.push(`年级「${row.grade}」不在字典中`)
  }

  const campus = row.campus?.trim() || props.meta?.defaultCampus || ''
  if (props.meta && !props.meta.campuses.some((item) => item.name === campus)) {
    problems.push(`校区「${campus}」不存在`)
  }

  if (!row.className?.trim()) problems.push('班级为空')
  else if (!matchClass(campus, row.grade?.trim() ?? '', row.className.trim())) {
    problems.push(`该校区年级下没有「${row.className}」`)
  }

  const phone = row.guardianPhone?.trim() ?? ''
  if (phone && !/^1\d{10}$/.test(phone)) problems.push('监护人手机号格式不正确')

  const gender = row.gender?.trim() ?? ''
  if (gender && gender !== '男' && gender !== '女') problems.push('性别只能是男 / 女')

  const no = row.studentNo?.trim() ?? ''
  if (no) {
    if (seenNos.has(no)) problems.push(`学号 ${no} 在本文件内重复`)
    else seenNos.add(no)
  }
  return problems
}

/** 与服务端同一套匹配置信：完整班级名 → 班号 → 只有数字的写法 */
function matchClass(campus: string, grade: string, raw: string): OrgClass | undefined {
  const pool = props.classes.filter((row) => row.campus === campus && row.grade === grade)
  const direct = pool.find((row) => row.name === raw)
  if (direct) return direct
  const num = raw.replace(/[^0-9]/g, '')
  if (!num) return undefined
  return pool.find((row) => row.classNo === num) ?? pool.find((row) => row.name.replace(/[^0-9]/g, '') === num)
}

/** 预览里补一句「解析到的班级名」：写「3」的老师要能确认它对应的是高一(3)班 */
function resolvedLabel(row: StudentImportRow): string | null {
  const raw = row.className?.trim()
  if (!raw) return null
  const campus = row.campus?.trim() || props.meta?.defaultCampus || ''
  const hit = matchClass(campus, row.grade?.trim() ?? '', raw)
  return hit && hit.name !== raw ? hit.name : null
}

async function onPick(file: File | undefined | null) {
  if (!file) return
  if (file.size > 8 * 1024 * 1024) {
    showToast('文件超过 8MB，请拆分后再导入', 'error')
    return
  }
  parsing.value = true
  try {
    const table = await readSpreadsheet(file)
    const index = {
      name: headerIndex(table.headers, 'name'),
      gender: headerIndex(table.headers, 'gender'),
      campus: headerIndex(table.headers, 'campus'),
      grade: headerIndex(table.headers, 'grade'),
      className: headerIndex(table.headers, 'className'),
      studentNo: headerIndex(table.headers, 'studentNo'),
      guardianName: headerIndex(table.headers, 'guardianName'),
      guardianPhone: headerIndex(table.headers, 'guardianPhone'),
    }
    if (index.name < 0) throw new Error(`没有找到「姓名」列，当前表头：${table.headers.join(' / ')}`)

    const seenNos = new Set<string>()
    preview.value = table.rows.map((cells, offset) => {
      const pick = (key: keyof typeof index) => (index[key] >= 0 ? (cells[index[key]] ?? '').trim() : '')
      const data: StudentImportRow = {
        name: pick('name'),
        gender: pick('gender') || undefined,
        campus: pick('campus') || undefined,
        grade: pick('grade') || undefined,
        className: pick('className') || undefined,
        studentNo: pick('studentNo') || undefined,
        guardianName: pick('guardianName') || undefined,
        guardianPhone: pick('guardianPhone') || undefined,
      }
      return { row: offset + 2, data, problems: validate(data, seenNos) }
    })
    fileName.value = file.name
    step.value = 'preview'
  } catch (error) {
    showToast(error instanceof Error ? error.message : '文件解析失败', 'error')
  } finally {
    parsing.value = false
  }
}

function onDrop(event: DragEvent) {
  dragOver.value = false
  const file = event.dataTransfer?.files?.[0]
  void onPick(file)
}

/* ==================== 导入 ==================== */

async function submit() {
  if (!preview.value.length) return
  importing.value = true
  try {
    /* 有问题的行也一起提交：服务端会逐行判定并回传原因，
       这样「本地漏判、服务端拦下」的情况仍然能在结果页看到，不会静默丢数据 */
    const res = await importStudents(preview.value.map((row) => row.data))
    result.value = res
    step.value = 'result'
    emit('imported', res)
  } catch (error) {
    showToast(error instanceof Error ? error.message : '导入失败', 'error')
  } finally {
    importing.value = false
  }
}

function downloadFailures() {
  if (!result.value?.failures.length) return
  const blob = buildXlsx({
    sheetName: '失败明细',
    rows: [['行号', '姓名', '失败原因'], ...result.value.failures.map((row) => [String(row.row), row.name, row.message])],
    widths: [10, 14, 60],
  })
  downloadBlob(blob, safeFileName('学生导入失败明细', 'xlsx'))
}

function reset() {
  step.value = 'pick'
  preview.value = []
  result.value = null
  fileName.value = ''
}
</script>

<template>
  <AppModal title="批量导入学生档案" :width="940" :close-on-mask="false" @close="emit('close')">
    <!-- ① 选文件 -->
    <template v-if="step === 'pick'">
      <div class="tip-box">
        <p class="tip-title"><AppIcon name="info" :size="15" /> 导入前请先确认这几点</p>
        <ul class="tip-list">
          <li>首行必须是表头，至少包含「姓名」「年级」「班级」三列；「性别」「校区」「学号」「监护人」可留空。</li>
          <li>学号留空时按班级顺序自动生成；<b>校区留空默认取当前登录用户所在校区</b>。</li>
          <li>班级可写完整名称（高一(1)班），也可只写班号（1 / 1班），会按「校区 + 年级」自动匹配。</li>
          <li>逐行校验、部分成功：失败的行会在结果页列出原因，可下载明细后修正重传。</li>
        </ul>
        <button class="btn btn-ghost btn-sm" @click="downloadTemplate">
          <AppIcon name="download" :size="14" /> 下载导入模板
        </button>
      </div>

      <div
        class="drop-zone"
        :class="{ over: dragOver }"
        @click="fileInput?.click()"
        @dragover.prevent="dragOver = true"
        @dragleave.prevent="dragOver = false"
        @drop.prevent="onDrop"
      >
        <AppIcon name="upload" :size="26" />
        <p class="dz-title">{{ parsing ? '正在解析…' : '把 Excel 拖到这里，或点击选择文件' }}</p>
        <p class="dz-hint">支持 .xlsx / .csv，单次最多 8MB</p>
      </div>
      <input ref="fileInput" type="file" accept=".xlsx,.csv" hidden @change="onPick(($event.target as HTMLInputElement).files?.[0])" />
    </template>

    <!-- ② 解析预览 -->
    <template v-else-if="step === 'preview'">
      <div class="preview-head">
        <div class="ph-left">
          <AppIcon name="file" :size="15" />
          <span class="ph-name">{{ fileName }}</span>
          <span class="tag tag-blue">共 {{ preview.length }} 行</span>
          <span class="tag tag-green">可导入 {{ validRows.length }}</span>
          <span v-if="invalidRows.length" class="tag tag-red">将跳过 {{ invalidRows.length }}</span>
        </div>
        <button class="mini-btn" @click="reset">重新选择文件</button>
      </div>

      <div class="preview-table">
        <table class="data-table">
          <thead>
            <tr>
              <th>行号</th>
              <th>姓名</th>
              <th>性别</th>
              <th>校区</th>
              <th>年级</th>
              <th>班级</th>
              <th>学号</th>
              <th>监护人</th>
              <th>校验</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in preview" :key="row.row" :class="{ bad: row.problems.length }">
              <td class="muted">{{ row.row }}</td>
              <td class="cell-strong">{{ row.data.name || '—' }}</td>
              <td>{{ row.data.gender || '男' }}</td>
              <td>{{ row.data.campus || '（默认校区）' }}</td>
              <td>{{ row.data.grade || '—' }}</td>
              <td class="cell-sub-cell">
                <span v-if="row.data.className">{{ row.data.className }}</span>
                <span v-else>—</span>
                <!-- 「3」这类班号写法要显示落到了哪个班，否则老师看不出导错没有 -->
                <span v-if="resolvedLabel(row.data)" class="cell-sub">→ {{ resolvedLabel(row.data) }}</span>
              </td>
              <td>{{ row.data.studentNo || '自动生成' }}</td>
              <td>{{ row.data.guardianName || '—' }}</td>
              <td>
                <span v-if="!row.problems.length" class="tag tag-green">可导入</span>
                <span v-else class="bad-reason">{{ row.problems.join('；') }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="f-hint">有问题的行会一并提交，由服务端最终判定并返回原因，不会静默丢弃。</p>
    </template>

    <!-- ③ 结果 -->
    <template v-else>
      <div class="result-cards">
        <div class="res-card ok">
          <span class="res-n">{{ result?.successCount ?? 0 }}</span>
          <span class="res-l">导入成功</span>
        </div>
        <div class="res-card fail">
          <span class="res-n">{{ result?.failCount ?? 0 }}</span>
          <span class="res-l">导入失败</span>
        </div>
      </div>

      <div v-if="result?.failures.length" class="fail-list">
        <div class="fail-head">
          <span class="f-label">失败明细</span>
          <button class="mini-btn" @click="downloadFailures"><AppIcon name="download" :size="14" /> 下载明细</button>
        </div>
        <table class="data-table">
          <thead>
            <tr>
              <th>行号</th>
              <th>姓名</th>
              <th>失败原因</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in result.failures" :key="row.row">
              <td class="muted">{{ row.row }}</td>
              <td class="cell-strong">{{ row.name || '—' }}</td>
              <td class="bad-reason">{{ row.message }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="f-hint">全部导入成功，学生档案已刷新。</p>
    </template>

    <template #footer>
      <template v-if="step === 'preview'">
        <button class="btn btn-ghost" @click="reset">上一步</button>
        <button class="btn btn-primary" :disabled="importing || !preview.length" @click="submit">
          {{ importing ? '导入中…' : `确认导入 ${validRows.length} 条` }}
        </button>
      </template>
      <template v-else-if="step === 'result'">
        <button class="btn btn-ghost" @click="reset">再传一份</button>
        <button class="btn btn-primary" @click="emit('close')">完成</button>
      </template>
      <button v-else class="btn btn-ghost" @click="emit('close')">取消</button>
    </template>
  </AppModal>
</template>

<style scoped>
.tip-box {
  border: 1px solid var(--border);
  border-radius: 12px;
  background: #f8fafd;
  padding: 14px 16px;
  margin-bottom: 14px;
}
.tip-title { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; margin-bottom: 8px; }
.tip-list { margin: 0 0 12px 18px; list-style: disc; font-size: 12.5px; color: var(--sub); line-height: 1.9; }
.tip-list b { color: var(--ink-2); }

.drop-zone {
  border: 1.5px dashed #c9d2e6;
  border-radius: 12px;
  padding: 34px 20px;
  text-align: center;
  color: var(--sub);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.drop-zone:hover, .drop-zone.over { border-color: var(--brand); background: var(--brand-soft); }
.dz-title { font-size: 14px; font-weight: 600; color: var(--ink-2); margin: 10px 0 4px; }
.dz-hint { font-size: 12px; }

.preview-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 10px; margin-bottom: 10px;
}
.ph-left { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ph-name { font-size: 13px; font-weight: 600; color: var(--ink); }

.preview-table { max-height: 380px; overflow: auto; border: 1px solid var(--border); border-radius: 10px; }
/* 单元格副行：解析到的班级名 / 失败原因这类补充信息，比正文小一号 */
.cell-sub { display: block; font-size: 11.5px; color: var(--sub); margin-top: 2px; white-space: nowrap; }
.preview-table .data-table th { position: sticky; top: 0; z-index: 1; }
.preview-table tr.bad { background: #fff7f7; }

.bad-reason { font-size: 12px; color: var(--danger); line-height: 1.6; }
.muted { color: var(--sub); font-size: 12px; }

.result-cards { display: flex; gap: 12px; margin-bottom: 16px; }
.res-card {
  flex: 1; display: flex; flex-direction: column; gap: 4px;
  align-items: center; padding: 16px; border-radius: 12px;
}
.res-card.ok { background: var(--success-soft); }
.res-card.fail { background: var(--danger-soft); }
.res-n { font-size: 26px; font-weight: 700; }
.res-card.ok .res-n { color: var(--success); }
.res-card.fail .res-n { color: var(--danger); }
.res-l { font-size: 12px; color: var(--sub); }

.fail-list { max-height: 320px; overflow: auto; border: 1px solid var(--border); border-radius: 10px; }
.fail-list .data-table th { position: sticky; top: 0; z-index: 1; }
.fail-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
</style>
