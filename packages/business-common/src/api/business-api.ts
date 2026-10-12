/**
 * 业务公共层与宿主应用之间的**基础接口契约**。
 *
 * 这是本包里唯一与「数据从哪来」有关的地方 —— 组件与组合式一律只认这份契约，
 * 不 import 任何 `apps/**` 的代码。各端在启动时把自己的实现注进来：
 *
 * ```ts
 * // apps/tenant/src/main.ts
 * import * as org from './api/org'
 * import { provideBusinessApi } from '@aiteach/business-common'
 * provideBusinessApi(org)
 * ```
 *
 * 由此得到的边界（也是本包的设计约束）：
 * - **数据查询归各端**：真正的 URL、查询参数、`tenant_id` 过滤、权限校验都在
 *   `apps/*\/src/api/*.ts` 里，公共组件只是调用者；
 * - **公共组件不写 admin/tenant 分支**：差异一律由 props 与插槽表达；
 * - 两端读同一份数据时（当前题库 / 试卷就是这么设计的）注入的是同一套函数，
 *   换成各自的接口时只改各自 `api` 目录，公共层不动。
 */
import type {
  FileFolder,
  OrgFile,
  OrgKnowledgeNode,
  OrgMaterial,
  OrgMedia,
  OrgPaper,
  OrgQuestion,
  QuestionCorrection,
  QuestionCorrectionType,
  TextbookOption,
} from '@aiteach/shared'
import type { TenantDictItem } from '../types'

/** 提交纠错的入参（类型多选 + 描述） */
export interface QuestionCorrectionInput {
  questionId: number
  types: QuestionCorrectionType[]
  description: string
}

/** 我的文件列表的返回形状（含容量用量） */
export interface FileListResult {
  list: OrgFile[]
  usage: { usedGb: number; quotaGb: number }
}

export interface FolderInput {
  id?: number
  name: string
  parentId: number | null
}

/**
 * 公共组件 / 公共组合式需要的基础接口。
 *
 * 刻意保持**最小集**：只声明公共层真正调用到的函数。各端 `api` 目录里其余接口
 * （机构端的协同组卷、平台端的审核入库等）与本层无关，不必实现。
 */
export interface BusinessApi {
  /* ===== 字典 / 教材级联 / 知识点树 ===== */
  /** 按类型取租户字典（学科 / 年级 / 题型 / 难度 / 考试类型 / 地区…） */
  fetchTenantDict(type: string): Promise<TenantDictItem[]>
  /** 教材级联矩阵（年级 → 学科 → 版本），知识点面板与作用域归一都用它 */
  fetchTextbookMatrix(): Promise<TextbookOption[]>
  /** 某套教材下的知识点树 */
  fetchKnowledgeTree(grade: string, subject: string, version: string): Promise<OrgKnowledgeNode[]>

  /* ===== 题目 ===== */
  fetchQuestions(): Promise<OrgQuestion[]>
  /** 全部纠错记录（按提交时间倒序），页面本地按 questionId 分组 */
  fetchQuestionCorrections(): Promise<QuestionCorrection[]>
  submitQuestionCorrection(data: QuestionCorrectionInput): Promise<QuestionCorrection>

  /* ===== 试卷 ===== */
  fetchPapers(): Promise<OrgPaper[]>
  /** 生成平行卷（FR-PP-015）：固定产出 1 份 B 卷，落指定文件夹 */
  generateParallels(motherId: number, folderId: number): Promise<OrgPaper[]>

  /* ===== 教辅 / 多媒体：预览里的「相似题」要完整题池 ===== */
  fetchMaterials(): Promise<OrgMaterial[]>
  fetchMedia(): Promise<OrgMedia[]>

  /* ===== 我的文件：平行卷落库要选文件夹 ===== */
  fetchFolders(): Promise<FileFolder[]>
  fetchFiles(): Promise<FileListResult>
  saveFolder(data: FolderInput): Promise<FileFolder>
}

let current: BusinessApi | null = null

/**
 * 注入业务接口实现。各端在 `main.ts` 里调用一次（早于任何页面组件）。
 * 用模块级单例而不是 provide/inject：注入发生在 app 初始化阶段（可能在组件之外），
 * 且 `useBaseData` / `useScope` 这类模块级单例组合式没有组件实例可 inject。
 */
export function provideBusinessApi(api: BusinessApi): void {
  current = api
}

/**
 * 取当前注入的实现。未注入时直接抛错而不是静默返回空实现 ——
 * 那会让页面表现为「空列表」，排查成本远高于一条明确的错误信息。
 */
export function useBusinessApi(): BusinessApi {
  if (!current) {
    throw new Error(
      '[business-common] 尚未注入 BusinessApi：请在应用入口（main.ts）调用 provideBusinessApi(api)。',
    )
  }
  return current
}
