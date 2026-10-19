/**
 * 试卷导入的**源文件层**：把用户丢进来的图片 / PDF / Word 统一读成「可识别素材」。
 *
 * 三种文件走三条路，但出口统一：
 * - 图片：等比压缩成 dataURL（既做识别入参，也做页面里的原图预览）→ 多模态模型；
 * - PDF：抽纯文本（见 `pdf-text.ts`）→ 文本模型；
 * - Word（.docx）：mammoth 抽纯文本 → 文本模型。
 *
 * 这一层只负责「读得出来 / 读不出来」，**不碰 AI**：识别策略在 `api/ai-paper-import.ts`。
 * 读不出来的原因都要说人话（扫描件、加密、老 .doc），否则用户只会看到「识别失败」。
 */
import { fileToDataUrl } from '@/api/ai-photo'
import { extractPdfText, isReadableText } from './pdf-text'

/** 源文件形态：决定走哪个识别引擎 */
export type PaperSourceKind = 'image' | 'pdf' | 'word'

/** 读好的素材：识别层只认这个结构 */
export interface PaperSourceFile {
  /** 本地唯一 id（同一次导入里区分多页） */
  id: string
  file: File
  kind: PaperSourceKind
  name: string
  sizeMb: number
  /** 图片：压缩后的 dataURL（识别入参 + 预览） */
  dataUrl?: string
  /** PDF / Word：抽取出的纯文本（已截断到提示词可承受的长度） */
  text?: string
  /** PDF 页数（Word 恒为 1，图片为 1） */
  pages?: number
}

/** 单文件大小上限（MB）：视觉模型对超大图无优势，超过只会上传很慢 */
export const MAX_SOURCE_MB = 20
/** 单次导入的文件（页）数上限 */
export const MAX_SOURCE_FILES = 20
/** 交给模型的文本上限：一份 150 分的卷子正文在 3 万字符量级，留一倍余量后截断 */
export const MAX_SOURCE_TEXT = 60_000

/** file input 的 accept：三种格式都摆上，选完再按真实类型校验（浏览器给的 type 常为空） */
export const PAPER_SOURCE_ACCEPT =
  '.jpg,.jpeg,.png,.webp,.pdf,.docx,.doc,image/jpeg,image/png,image/webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword'

const IMAGE_EXT = /\.(jpe?g|png|webp)$/i
const PDF_EXT = /\.pdf$/i
const DOCX_EXT = /\.docx$/i
const DOC_EXT = /\.doc$/i

/**
 * 判定源文件形态。**以扩展名为主、MIME 为辅**：
 * 从资源管理器拖进来的文件常常 `type` 为空（尤其是 .doc / .pdf 在部分系统上），
 * 只看 MIME 会把它们全判成「不支持」。
 */
export function kindOfFile(file: File): PaperSourceKind | null {
  const name = file.name || ''
  if (IMAGE_EXT.test(name) || /^image\/(jpeg|png|webp)$/i.test(file.type)) return 'image'
  if (PDF_EXT.test(name) || file.type === 'application/pdf') return 'pdf'
  if (DOCX_EXT.test(name) || DOC_EXT.test(name) || /wordprocessingml|msword/i.test(file.type)) return 'word'
  return null
}

export function sizeMbOf(file: File): number {
  return Math.round((file.size / 1024 / 1024) * 10) / 10
}

export function sourceKindText(kind: PaperSourceKind): string {
  return kind === 'image' ? '图片' : kind === 'pdf' ? 'PDF' : 'Word'
}

/** 文本超长时截断（保留前段：试卷正文按页顺序，前段信息密度最高） */
function clipText(text: string): string {
  if (text.length <= MAX_SOURCE_TEXT) return text
  return `${text.slice(0, MAX_SOURCE_TEXT)}\n\n（正文过长，已截断）`
}

/**
 * Word 抽文本。`.docx` 走 mammoth（只取纯文本，不需要保留样式 —— 识别要的是字）。
 * `.doc`（97-2003 二进制格式）mammoth 读不了，直接给出可执行的建议，不静默失败。
 */
async function readWordText(file: File): Promise<string> {
  if (DOC_EXT.test(file.name)) {
    throw new Error('暂不支持 Word 97-2003 的 .doc 格式，请用 Word 另存为 .docx 后重新上传')
  }
  /* 动态引入：mammoth 体积不小，只有真的传了 Word 才需要它 */
  const mammoth = (await import('mammoth')).default
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
  const text = (result.value ?? '').trim()
  if (!text) throw new Error(`${file.name}：没有读到文字，可能是空文档或整页图片版 Word`)
  return clipText(text)
}

/**
 * 读取单个源文件。读不出来抛错（错误文案直接给用户看）。
 * 图片不在这里抛 —— 解码失败由 `fileToDataUrl` 抛出「图片解码失败，请换一张清晰的」。
 */
export async function readPaperSource(file: File, index: number): Promise<PaperSourceFile> {
  const kind = kindOfFile(file)
  if (!kind) throw new Error(`${file.name}：不支持的文件格式（仅支持图片 / PDF / Word）`)
  if (file.size > MAX_SOURCE_MB * 1024 * 1024) {
    throw new Error(`${file.name}：超过 ${MAX_SOURCE_MB}MB，请压缩后再上传`)
  }
  const base: PaperSourceFile = {
    id: `src_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`,
    file,
    kind,
    name: file.name || `${sourceKindText(kind)}_${index + 1}`,
    sizeMb: sizeMbOf(file),
  }

  if (kind === 'image') {
    return { ...base, dataUrl: await fileToDataUrl(file), pages: 1 }
  }
  if (kind === 'pdf') {
    const result = await extractPdfText(file)
    if (result.encrypted) throw new Error(`${file.name}：PDF 已加密，无法读取正文`)
    if (!isReadableText(result.text)) {
      throw new Error(
        `${file.name}：没有提取到可读文字（可能是扫描件 / 图片版 PDF 或特殊字体），请把 PDF 各页截图后按图片上传`,
      )
    }
    return { ...base, text: clipText(result.text), pages: result.pages }
  }
  return { ...base, text: await readWordText(file), pages: 1 }
}

/** 已读素材的可识别形态：图片有 dataURL，文本类有 text */
export function isReadableSource(source: PaperSourceFile): boolean {
  return source.kind === 'image' ? !!source.dataUrl : !!source.text
}
