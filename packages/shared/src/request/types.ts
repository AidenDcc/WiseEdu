/** 后端统一响应包装（与 Java 网关约定：code=0 成功） */
export interface ApiResponse<T = unknown> {
  code: number
  message: string
  data: T
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

export interface RequestOptions {
  method?: HttpMethod
  /** 请求体（JSON） */
  data?: unknown
  /** URL 查询参数 */
  params?: Record<string, string | number | boolean | undefined | null>
}
