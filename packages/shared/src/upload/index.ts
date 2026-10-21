import { getAppConfig, getTenantKey, getTokenKey } from '../config'
import { ApiError } from '../request/api-error'
import { resolveApiMode } from '../request/mock-switch'

/**
 * 统一文件上传入口（对象存储）。
 *
 * <p><b>为什么前端要有一层统一封装</b>：教学云里「上传」出现在十几个页面（头像、题目配图、
 * 试卷附件、课件、素材、教辅、学生名单导入、导出文件……）。如果每处自己写 fetch + FormData +
 * token 头 + 错误处理，一是重复，二是必然出现「某处忘了带 token」「某处把 401 当成功」。
 *
 * <p><b>返回值里的两个字段不能混用</b>：
 * <ul>
 *   <li>{@code key} —— 持久化用。业务对象的表单提交应该带上它，后端存这个；</li>
 *   <li>{@code url} —— 渲染用。私有桶下是签名代理地址，直接塞进 {@code <img src>} 即可。</li>
 * </ul>
 * 千万不要把 {@code url} 存进业务字段：签名密钥一换、桶一迁移，库里存量地址全部失效。
 *
 * <p><b>Mock 模式下</b>上传不会真的发请求，而是把文件转成 dataURL 直接返回，
 * 保证离线开发时预览与提交都正常（与接入 OSS 之前的体验一致）。
 */

/** 统一上传接口路径（后端 EduFileController） */
const UPLOAD_PATH = '/sys/edu-file/upload'

/** 后端返回的上传结果 */
export interface UploadedFile {
  /** 记录ID（edu_oss_file.id） */
  id?: string
  /** 对象存储 Key —— 业务表应存这个 */
  key: string
  /** 可直接渲染的地址（私有桶为签名代理地址） */
  url: string
  name: string
  size: number
  mime: string
  ext: string
  biz: string
  uploadTime: number
}

export interface UploadOptions {
  /**
   * 业务分类，决定服务端的准入策略与 Key 目录。
   * 常用值：avatar / image / document / video / audio / paper / courseware / material / import / export
   */
  biz?: string
  /** 上传进度回调（0-100）。大文件（视频、课件）用来驱动进度条 */
  onProgress?: (percent: number) => void
}

/**
 * 上传一个文件。
 *
 * @throws {ApiError} 网络异常、鉴权失败、服务端拒绝（格式/大小）时抛出，message 可直接展示
 */
export async function uploadFile(file: File, options: UploadOptions = {}): Promise<UploadedFile> {
  const biz = options.biz ?? 'common'

  if (resolveApiMode(UPLOAD_PATH) === 'mock') {
    const url = await fileToDataUrl(file)
    options.onProgress?.(100)
    return {
      key: `mock/${Date.now()}-${file.name}`,
      url,
      name: file.name,
      size: file.size,
      mime: file.type || 'application/octet-stream',
      ext: extOf(file.name),
      biz,
      uploadTime: Date.now(),
    }
  }

  return remoteUpload(file, biz, options.onProgress)
}

/** 上传图片的语法糖（biz 默认 image） */
export function uploadImage(file: File, options: Omit<UploadOptions, 'biz'> = {}): Promise<UploadedFile> {
  return uploadFile(file, { ...options, biz: 'image' })
}

/** 上传头像的语法糖（biz = avatar，服务端只接受图片） */
export function uploadAvatar(file: File, options: Omit<UploadOptions, 'biz'> = {}): Promise<UploadedFile> {
  return uploadFile(file, { ...options, biz: 'avatar' })
}

/**
 * 把「后端返回的地址」转换成当前部署下真正可访问的地址。
 *
 * <p>后端配置 {@code edu.oss.proxy-base-url} 时给的是 {@code /api/sys/edu-file/view?...}，
 * 而前端的 apiBaseUrl 在开发态是 {@code /api}、生产可能是 {@code https://api.xxx.com/api}。
 * 统一在这里做一次前缀替换，页面里就不要自己拼了。
 *
 * <p>对 {@code data:} / {@code blob:} / 外部 http 地址原样返回（历史头像、AI 生成的临时图）。
 */
export function resolveFileUrl(url: string): string {
  if (!url) return ''
  if (url.startsWith('data:') || url.startsWith('blob:')) return url

  const { apiBaseUrl } = getAppConfig()
  if (/^https?:\/\//i.test(url)) return url

  // 后端默认前缀 /api；若与当前部署不一致，换成 apiBaseUrl
  if (url.startsWith('/api/')) {
    return `${apiBaseUrl}${url.slice('/api'.length)}`
  }
  if (url.startsWith('/sys/')) {
    return `${apiBaseUrl}${url}`
  }
  return url
}

/**
 * 批量把数组里的 key/url 解析成可访问地址（列表页常用）。
 * 入参里已经是完整地址的会被原样保留。
 */
export function resolveFileUrls(urls: Array<string | null | undefined>): string[] {
  return urls.map((u) => resolveFileUrl(u ?? ''))
}

/* ------------------------------------------------------------------ */

function remoteUpload(
  file: File,
  biz: string,
  onProgress?: (percent: number) => void,
): Promise<UploadedFile> {
  const { apiBaseUrl } = getAppConfig()
  const token = localStorage.getItem(getTokenKey()) ?? ''
  const tenantId = localStorage.getItem(getTenantKey())

  return new Promise<UploadedFile>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${apiBaseUrl}${UPLOAD_PATH}`, true)

    // 不要手动设置 Content-Type —— 浏览器要自己加 multipart boundary
    if (token) xhr.setRequestHeader('X-Access-Token', token)
    if (tenantId) xhr.setRequestHeader('X-Tenant-Id', String(tenantId))

    if (onProgress && xhr.upload) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
      }
    }

    xhr.onload = () => {
      let payload: { code?: number; message?: string; data?: UploadedFile } | null = null
      try {
        payload = JSON.parse(xhr.responseText)
      } catch {
        // 非 JSON（网关 502 的 HTML 页、Nginx 413 等）
      }
      if (xhr.status === 413) {
        reject(new ApiError(413, '文件过大，超出服务器允许的上传大小'))
        return
      }
      if (!payload) {
        reject(new ApiError(xhr.status, `上传失败（HTTP ${xhr.status}）`))
        return
      }
      if (payload.code !== 0 || !payload.data) {
        reject(new ApiError(payload.code ?? xhr.status, payload.message?.trim() || '上传失败'))
        return
      }
      resolve(payload.data)
    }

    xhr.onerror = () => reject(new ApiError(-1, '网络异常，上传失败'))
    xhr.ontimeout = () => reject(new ApiError(-1, '上传超时，请检查网络后重试'))
    xhr.timeout = 10 * 60 * 1000

    const form = new FormData()
    form.append('file', file)
    // biz 放 body 而不是 query：部分网关会丢掉 query，multipart 里最稳
    form.append('biz', biz)
    xhr.send(form)
  })
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new ApiError(-1, '读取本地文件失败'))
    reader.readAsDataURL(file)
  })
}

function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}
