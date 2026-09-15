/** 业务/网络错误统一模型，供 UI 层 toast 展示 message */
export class ApiError extends Error {
  readonly code: number
  readonly cause?: unknown

  constructor(code: number, message: string, cause?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.cause = cause
  }
}
