/**
 * 题库 / 试卷 / 组卷三块业务的**公共类型**。
 *
 * 这些类型两端同义（平台管理端与机构端说的是同一件事），所以放公共层；
 * 只在一端用的类型（如平台端的内容审核状态、机构端的协同组卷任务）留在各自 apps 里。
 */

/**
 * 租户字典项：机构端 `GET /tenant/dict?type=` 的返回项。
 *
 * 是平台端「字典管理」那张表在机构端的投影 —— 只带机构端要用的字段，
 * 不含 `code` / `refCount` 这类管理属性（那是平台端的 `DictItem`）。
 */
export interface TenantDictItem {
  id: number
  name: string
  sort: number
  enabled: boolean
  /** 学科专属项（如「完形填空」只属于英语）；留空即全学科通用 */
  subjects?: string[]
  /** grade = 该年级所属学段（单值）。留空/缺省 = 不限 */
  stage?: string
  /** 仅 examType / competition：适配学段（多选）。留空/缺省 = 不限 */
  stages?: string[]
  /** 仅 examType：试卷分类（= 管理端「考试类型」树一级节点的名字） */
  paperCategory?: string
}

/** 试卷类型树的一片叶子（一个考试类型 + 当前卷数） */
export type { PaperTypeLeaf, PaperTypeGroup } from '../components/compose/PaperTypeTree.vue'

/** 题目预览需要的最小字段集（题库列表、审核中心、录题草稿共用） */
export type { PreviewQuestion } from '../components/question/QuestionPreviewBody.vue'

/** 试卷导出：卷面版本与导出选项 */
export type { ExportVersion, ExportOptions } from '../utils/paper-export'

/** 组卷筛选条可显示的维度 */
export type { FilterField } from '../components/compose/ComposeFilterBar.vue'

/* 组卷工作台的筛选模型：`ComposeFilter` 与各命中谓词（筛选条、试题 / 试卷页签、
   shell 的页签角标共用同一份，定义在 compose/filter-model.ts）。
   放在这里统一出口，避免 index.ts 里两处 `export *` 撞名。 */
export * from '../compose/filter-model'
