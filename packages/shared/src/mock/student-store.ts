/**
 * 机构端新模块 Mock 仓库：班级与学生管理（T-08）、AI 学情画像（T-07-08~10）、
 * AI 能力中心（T-10）、机构系统设置（T-11）。
 *
 * 与 org-store 同一套约定：
 * - 种子时间写死（相对时间会让每次刷新数据都在变，老师会以为数据丢了）；
 * - 成绩/掌握度用确定性伪随机（线性同余），同一个人每次进来看到的画像一致；
 * - 学生个人信息最小化（T-08-04）：仓库里存的是全量，列表接口返回前做脱敏。
 */
import type {
  AiArtifactQuery,
  AiArtifactReview,
  AiCapabilityCard,
  AiCenterTask,
  AiRequestLog,
  AiTaskOutput,
  AiTaskQuery,
  AiUsageBucket,
  AiUsageGranularity,
  AiUsageGroupRow,
  AiUsageQuery,
  AiUsageReport,
  ClassFormMeta,
  ClassProfileReport,
  ConsentChannel,
  ConsentRecord,
  MasteryNode,
  OrgClass,
  OrgSettings,
  OrgStudent,
  ReviewFlowConfig,
  StudentImportResult,
  StudentImportRow,
  StudentProfile,
} from '../api/models'
/* 校区 / 员工 / 当前操作人：班级要挂校区、班主任与任课教师要从员工名单里选 */
import { CURRENT, campuses, staff } from './org-store'
/* 基础字典：年级与「学科 + 适配年级」由平台端字典同步，机构端只读 */
import { listDict } from './admin-store'

const UPDATED = '2026-09-26 18:20:00'

/**
 * 写操作的时间戳（真实当前时间）。
 *
 * `UPDATED` 那类写死的时间只给**种子数据**用（相对时间会让每次刷新看到的数据都在变）；
 * 但「谁在什么时候签的同意书」这类留档字段必须是真实时间 —— 否则今天补签的同意书
 * 会显示成上个月签的，等于把审计信息写错。
 */
function nowStamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/* ================= 确定性伪随机（与 org-store 同思路） ================= */

let seed = 20260926
function rand(): number {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648
}
function pickOne<T>(list: T[]): T {
  return list[Math.floor(rand() * list.length)]
}

/* ================= 班级与花名册（与阅卷 ROSTER 同一套名单，保证跨模块一致） ================= */

/**
 * 班级种子：校区 / 班号 / 任课教师是「班级管理」这一版新增的字段，其余沿用原名单。
 *
 * 花名册与 org-store 的阅卷 ROSTER 必须同名同班 —— 阅卷、作业、学情都按班级名归集，
 * 两边一错位就会出现「班级管理里有 4 个班，布置作业只能选 3 个」。
 */
const ROSTER: Array<{
  className: string
  classNo: string
  campus: string
  grade: string
  headTeacher: string
  assistant: string
  teachers: string[]
  subjects: string[]
  room: string
  names: Array<[string, '男' | '女']>
}> = [
  {
    className: '高一(1)班',
    classNo: '1',
    campus: '本部校区',
    grade: '高一',
    headTeacher: '李文博',
    assistant: '孙悦',
    teachers: ['李文博', '孙悦', '王静', '沈丽华'],
    subjects: ['数学', '语文', '英语', '物理'],
    room: '教学楼 A301',
    names: [
      ['张一鸣', '男'], ['李思远', '男'], ['王梓涵', '女'], ['陈亦帆', '男'], ['刘梦琪', '女'],
      ['赵子谦', '男'], ['孙嘉悦', '女'], ['周浩然', '男'], ['吴欣怡', '女'], ['郑天宇', '男'],
      ['冯语彤', '女'], ['蒋泽楷', '男'], ['韩雨薇', '女'], ['杨博文', '男'], ['何佳宁', '女'],
    ],
  },
  {
    className: '高一(2)班',
    classNo: '2',
    campus: '本部校区',
    grade: '高一',
    headTeacher: '孙悦',
    assistant: '沈丽华',
    teachers: ['李文博', '孙悦', '王静', '沈丽华'],
    subjects: ['数学', '语文', '英语', '物理'],
    room: '教学楼 A302',
    names: [
      ['曹峻熙', '男'], ['彭思睿', '男'], ['董一诺', '女'], ['袁子墨', '男'], ['于书瑶', '女'],
      ['余泽楷', '男'], ['叶知秋', '女'], ['程思远', '男'], ['苏子航', '男'], ['魏灵犀', '女'],
      ['吕明轩', '男'], ['丁若曦', '女'], ['任嘉树', '男'], ['沈亦舟', '男'], ['姚静姝', '女'],
    ],
  },
  {
    className: '高一(3)班',
    classNo: '3',
    campus: '东湖校区',
    grade: '高一',
    headTeacher: '王静',
    assistant: '周正',
    teachers: ['王静', '孙悦', '沈丽华'],
    subjects: ['数学', '语文', '英语', '物理'],
    room: '东湖楼 B201',
    names: [
      ['卢俊熙', '男'], ['傅诗涵', '女'], ['钟子昂', '男'], ['姜雨泽', '男'], ['崔艺萌', '女'],
      ['谭博衍', '男'], ['陆思彤', '女'], ['汪子睿', '男'], ['范晓萱', '女'], ['金昊然', '男'],
      ['石佳怡', '女'], ['廖晨曦', '女'], ['贾一凡', '男'], ['韦思远', '男'], ['樊悦然', '女'],
    ],
  },
  {
    /* 第二个年级 + 另一校区：让「年级 / 校区」两个筛选条件都有真实可筛的数据 */
    className: '高二(1)班',
    classNo: '1',
    campus: '东湖校区',
    grade: '高二',
    headTeacher: '赵鹏',
    assistant: '周正',
    teachers: ['赵鹏', '李文博', '王静'],
    subjects: ['数学', '语文', '英语', '物理', '化学'],
    room: '东湖楼 B305',
    names: [
      ['何思远', '男'], ['许清和', '女'], ['邓雅涵', '女'], ['蒋文博', '男'], ['曹欣然', '女'],
      ['刘佳琪', '女'], ['范志远', '男'], ['沈逸凡', '男'], ['宋婉清', '女'], ['唐子墨', '男'],
      ['薛晨曦', '女'], ['汤雨桐', '女'],
    ],
  },
]

let classSeq = 100
let studentSeq = 5000
let consentSeq = 300
let pushSeq = 900
let taskSeq = 4000
let artifactSeq = 5000

/* ================= 班级 ================= */

export const classes: OrgClass[] = ROSTER.map((row) => ({
  id: ++classSeq,
  campus: row.campus,
  name: row.className,
  classNo: row.classNo,
  grade: row.grade,
  headTeacher: row.headTeacher,
  assistant: row.assistant,
  teachers: [...row.teachers],
  studentCount: row.names.length,
  subjects: [...row.subjects],
  room: row.room,
  enabled: true,
  createdAt: '2026-09-01 09:00:00',
}))

/* ================= 学生档案 ================= */

const GUARDIANS = ['张先生', '李女士', '王先生', '刘女士', '陈先生', '赵女士', '周先生', '吴女士']
const TAG_POOL = ['基础扎实', '思维活跃', '粗心易错', '表达优秀', '进步明显', '需关注', '压轴题弱', '计算速度慢']

export const students: OrgStudent[] = ROSTER.flatMap((row, classIndex) =>
  row.names.map(([name, gender], index) => {
    const roll = rand()
    const warning: OrgStudent['warning'] = roll < 0.12 ? 'risk' : roll < 0.3 ? 'watch' : 'none'
    const percentile = 5 + Math.round(rand() * 90)
    return {
      id: ++studentSeq,
      name,
      studentNo: `2026${String(classIndex + 1).padStart(2, '0')}${String(index + 1).padStart(2, '0')}`,
      /* 校区跟着班级走：学生档案的校区不是独立字段，而是「所读班级的校区」 */
      campus: row.campus,
      className: row.className,
      grade: row.grade,
      gender,
      guardianPhone: `138${String(Math.floor(rand() * 100000000)).padStart(8, '0')}`,
      guardianName: pickOne(GUARDIANS),
      consentStatus: (rand() < 0.78 ? 'granted' : rand() < 0.85 ? 'pending' : 'withdrawn') as OrgStudent['consentStatus'],
      tags: Array.from(new Set([pickOne(TAG_POOL), ...(rand() < 0.4 ? [pickOne(TAG_POOL)] : [])])),
      warning,
      lastScore: 62 + Math.round(rand() * 82),
      lastPercentile: percentile,
      enrolledAt: '2026-09-01',
      status: rand() < 0.94 ? '在读' : pickOne(['休学', '转班']),
    }
  }),
)

/** 学生列表的筛选条件：真实后端对应同一组 query 参数 */
export interface StudentQuery {
  keyword?: string
  campus?: string
  grade?: string
  className?: string
  consentStatus?: string
  warning?: string
}

/**
 * 学生列表（T-08-03）。
 *
 * 关键字同时命中姓名 / 学号 / 监护人姓名：老师手上通常只有一个线索，
 * 三个字段合成一个搜索框比让他先想「我要按哪个字段搜」更接近真实用法。
 */
export function listStudents(query: StudentQuery = {}): OrgStudent[] {
  /* 最小化收集（T-08-04）：列表侧 guardianPhone 一律脱敏后返回 */
  const mask = (phone: string) => (phone.length >= 7 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : phone)
  const keyword = (query.keyword ?? '').trim().toLowerCase()
  return students
    .filter((row) => {
      if (query.campus && row.campus !== query.campus) return false
      if (query.grade && row.grade !== query.grade) return false
      if (query.className && row.className !== query.className) return false
      if (query.consentStatus && row.consentStatus !== query.consentStatus) return false
      if (query.warning && row.warning !== query.warning) return false
      if (keyword) {
        return (
          row.name.toLowerCase().includes(keyword) ||
          row.studentNo.includes(keyword) ||
          row.guardianName.toLowerCase().includes(keyword)
        )
      }
      return true
    })
    .map((row) => ({ ...row, guardianPhone: mask(row.guardianPhone) }))
}

export function getStudent(id: number): OrgStudent {
  const student = students.find((row) => row.id === id)
  if (!student) throw new Error('学生不存在')
  return student
}

/**
 * 学号自动生成（新增学生时前端只展示、不允许改）。
 *
 * 口径：入学年份(4) + 班级序号(2) + 班内序号(2)，与种子数据同构，肉眼可读：
 * 「2026 03 07」= 2026 年入学、第 3 个班、班内第 7 人。班内序号先按现有在读人数 +1 猜，
 * 撞号就往后顺延 —— 删除过学生之后人数会回落，直接取人数+1 必然撞号。
 */
export function nextStudentNo(className: string): string {
  const index = classes.findIndex((row) => row.name === className)
  if (index < 0) throw new Error('班级不存在')
  let seq = students.filter((row) => row.className === className).length + 1
  let no = `2026${String(index + 1).padStart(2, '0')}${String(seq).padStart(2, '0')}`
  while (students.some((row) => row.studentNo === no)) {
    seq += 1
    no = `2026${String(index + 1).padStart(2, '0')}${String(seq).padStart(2, '0')}`
  }
  return no
}

/** 学号唯一性校验（新增 / 编辑 / 批量导入共用，错误文案也统一） */
function assertStudentNoFree(studentNo: string, selfId?: number): void {
  if (students.some((row) => row.studentNo === studentNo && row.id !== selfId)) throw new Error(`学号 ${studentNo} 已存在`)
}

/** 落一条学生记录（新增学生与批量导入共用，保证两条入口的字段口径完全一致） */
function createStudent(input: {
  name: string
  gender: '男' | '女'
  cls: OrgClass
  studentNo?: string
  guardianName?: string
  guardianPhone?: string
}): OrgStudent {
  const studentNo = input.studentNo?.trim() || nextStudentNo(input.cls.name)
  assertStudentNoFree(studentNo)
  const student: OrgStudent = {
    id: ++studentSeq,
    name: input.name.trim(),
    studentNo,
    campus: input.cls.campus,
    className: input.cls.name,
    grade: input.cls.grade,
    gender: input.gender,
    guardianPhone: input.guardianPhone || '13800000000',
    guardianName: input.guardianName || '家长',
    consentStatus: 'pending',
    tags: [],
    warning: 'none',
    enrolledAt: '2026-09-27',
    status: '在读',
  }
  students.push(student)
  input.cls.studentCount += 1
  /* 新学生必须自带一条「待签署」同意记录：知情同意已并入学生档案详情，
     没有记录的话详情里那块是空的，老师会以为漏填了 */
  consents.push({
    id: ++consentSeq,
    studentId: student.id,
    studentName: student.name,
    studentNo: student.studentNo,
    guardianName: student.guardianName,
    relation: '父亲',
    docVersion: CONSENT_DOC_VERSION,
    status: 'pending',
    scopes: [],
  })
  return student
}

export function saveStudent(input: Partial<OrgStudent> & { name: string; className: string }): OrgStudent {
  if (!input.name.trim()) throw new Error('学生姓名必填')
  const cls = classes.find((row) => row.name === input.className)
  if (!cls) throw new Error('班级不存在')
  if (input.id != null) {
    const student = students.find((row) => row.id === input.id)
    if (!student) throw new Error('学生不存在')
    if (input.studentNo) assertStudentNoFree(input.studentNo, student.id)
    const oldClass = student.className
    Object.assign(student, input)
    student.className = cls.name
    student.grade = cls.grade
    /* 校区不由前端传：跟着班级走，避免「班级在 A 校区、学生档案写着 B 校区」 */
    student.campus = cls.campus
    student.studentNo = input.studentNo || student.studentNo
    if (oldClass !== cls.name) {
      student.status = '转班'
      /* 转班要把人数统计一起搬：班级列表的「学生数」直接读这个字段 */
      const old = classes.find((row) => row.name === oldClass)
      if (old) old.studentCount = Math.max(0, old.studentCount - 1)
      cls.studentCount += 1
    }
    const consent = consents.find((row) => row.studentId === student.id)
    if (consent) {
      consent.studentName = student.name
      consent.guardianName = student.guardianName
      consent.studentNo = student.studentNo
    }
    return student
  }
  return createStudent({
    name: input.name,
    gender: input.gender ?? '男',
    cls,
    studentNo: input.studentNo,
    guardianName: input.guardianName,
    guardianPhone: input.guardianPhone,
  })
}

export function deleteStudent(id: number): void {
  const index = students.findIndex((row) => row.id === id)
  if (index < 0) throw new Error('学生不存在')
  const student = students[index]
  const cls = classes.find((row) => row.name === student.className)
  if (cls) cls.studentCount = Math.max(0, cls.studentCount - 1)
  students.splice(index, 1)
  /* 同意记录随档案一起清：留着会变成查不到学生的孤儿记录 */
  const consentIndex = consents.findIndex((row) => row.studentId === id)
  if (consentIndex >= 0) consents.splice(consentIndex, 1)
}

/**
 * 班级新增 / 编辑。
 *
 * 三条校验都对应真实会被踩到的场景：
 * 1. 同校区同年级重名 —— 排课、作业下发、学情统计都按班级名归集，重名必然串数据；
 * 2. 停用 / 已有学生的班级改校区或年级 —— 学生档案、成绩、作业全挂在原班级上，
 *    改了等于把一届学生的历史数据挪走，只能先转班；
 * 3. 学科必选 —— 班级不设学科，作业与组卷的下拉里就没有可选项。
 */
export function saveClass(
  input: Partial<OrgClass> & { name: string; campus?: string; grade?: string; subjects?: string[] },
): OrgClass {
  const name = (input.name ?? '').trim()
  if (!name) throw new Error('班级名称必填')
  const campus = input.campus ?? ''
  if (!campus) throw new Error('请选择校区')
  if (!input.grade) throw new Error('请选择年级')
  if (!input.subjects?.length) throw new Error('请至少选择一个学科')
  const duplicated = classes.some(
    (row) => row.id !== input.id && row.campus === campus && row.grade === input.grade && row.name === name,
  )
  if (duplicated) throw new Error('同校区同年级下已存在同名班级，请调整班级名称')

  if (input.id != null) {
    const cls = classes.find((row) => row.id === input.id)
    if (!cls) throw new Error('班级不存在')
    if (cls.studentCount > 0 && (cls.campus !== campus || cls.grade !== input.grade)) {
      throw new Error(`该班级下仍有 ${cls.studentCount} 名学生，不能改校区 / 年级，请先转班`)
    }
    Object.assign(cls, {
      name,
      campus,
      grade: input.grade,
      classNo: input.classNo ?? cls.classNo,
      headTeacher: input.headTeacher ?? cls.headTeacher,
      assistant: input.assistant,
      teachers: input.teachers ?? cls.teachers,
      subjects: input.subjects,
      room: input.room,
    })
    return cls
  }
  const cls: OrgClass = {
    id: ++classSeq,
    campus,
    name,
    classNo: input.classNo,
    grade: input.grade,
    headTeacher: input.headTeacher ?? '',
    assistant: input.assistant,
    teachers: input.teachers ?? [],
    studentCount: 0,
    subjects: input.subjects,
    room: input.room,
    enabled: true,
    createdAt: nowStamp(),
  }
  classes.push(cls)
  return cls
}

export function toggleClass(id: number): OrgClass {
  const cls = classes.find((row) => row.id === id)
  if (!cls) throw new Error('班级不存在')
  /* 停用前必须转出学生：否则该班会出现在作业/考试/学情的下拉里却点不动，留下脏数据 */
  if (cls.enabled && cls.studentCount > 0) throw new Error('班级下仍有学生，不能停用')
  cls.enabled = !cls.enabled
  return cls
}

/**
 * 班级 / 学生表单的基础数据。
 *
 * 学科**从基础字典同步**（平台端「数据字典 → 学科」维护，机构端只读），并带上每科的
 * 适配年级：表单里年级一换，学科 chip 立刻收窄（小学班级不会出现化学）。
 * 教师候选来自员工名单 —— 班主任 / 助教 / 任课教师三处共用一份，不做二次维护。
 */
export function classFormMeta(): ClassFormMeta {
  const enabledCampuses = campuses.filter((row) => row.enabled)
  const selfCampus = staff.find((row) => row.name === CURRENT.name)?.campus
  return {
    campuses: enabledCampuses.map((row) => ({ name: row.name, code: row.code, enabled: row.enabled })),
    defaultCampus: selfCampus && enabledCampuses.some((row) => row.name === selfCampus)
      ? selfCampus
      : (enabledCampuses[0]?.name ?? ''),
    grades: listDict('grade')
      .filter((row) => row.enabled)
      .map((row) => ({ name: row.name, stage: row.stage ?? '' })),
    subjects: listDict('subject')
      .filter((row) => row.enabled)
      .map((row) => ({ name: row.name, grades: row.grades ?? [] })),
    teachers: staff
      .filter((row) => row.enabled)
      .map((row) => ({ name: row.name, role: row.role, campus: row.campus })),
  }
}

/**
 * 学生 Excel 批量导入（逐行校验、部分成功）。
 *
 * 真实后端会把这份校验原样搬过去并落任务表（导入 500 行不可能全部回滚）；
 * 这里保持同一套「部分成功 + 逐行原因」的返回结构，前端才有地方展示明细。
 */
export function importStudents(rows: StudentImportRow[]): StudentImportResult {
  if (!rows.length) throw new Error('没有可导入的数据')
  const meta = classFormMeta()
  const result: StudentImportResult = { successCount: 0, failCount: 0, failures: [], created: [] }

  rows.forEach((row, index) => {
    /* 行号按 Excel 的可见行号给（表头占第 1 行），文件里对不上就没法修 */
    const rowNo = index + 2
    const name = (row.name ?? '').trim()
    try {
      if (!name) throw new Error('姓名不能为空')
      const campusName = (row.campus ?? '').trim() || meta.defaultCampus
      if (!meta.campuses.some((item) => item.name === campusName)) throw new Error(`校区「${campusName}」不存在`)
      const grade = (row.grade ?? '').trim()
      if (!grade) throw new Error('年级不能为空')
      if (!meta.grades.some((item) => item.name === grade)) throw new Error(`年级「${grade}」不在字典中`)

      const cls = resolveClassForImport(campusName, grade, (row.className ?? '').trim())
      if (!cls) throw new Error(`校区「${campusName}」下没有「${grade}」的班级「${(row.className ?? '').trim()}」`)

      const genderRaw = (row.gender ?? '').trim()
      const gender: '男' | '女' = genderRaw === '女' ? '女' : '男'
      if (genderRaw && genderRaw !== '男' && genderRaw !== '女') throw new Error('性别只能是「男」或「女」')

      const phone = (row.guardianPhone ?? '').trim()
      if (phone && !/^1\d{10}$/.test(phone)) throw new Error('监护人手机号格式不正确')

      const student = createStudent({
        name,
        gender,
        cls,
        studentNo: (row.studentNo ?? '').trim(),
        guardianName: (row.guardianName ?? '').trim(),
        guardianPhone: phone,
      })
      result.successCount += 1
      result.created.push({ row: rowNo, name: student.name, studentNo: student.studentNo, className: student.className })
    } catch (error) {
      result.failCount += 1
      result.failures.push({ row: rowNo, name, message: error instanceof Error ? error.message : '导入失败' })
    }
  })
  return result
}

/**
 * 导入时把「班级」这一列解析成班级对象。
 *
 * 允许老师按三种写法填（模板说明里写的是第一种）：
 * - 完整班级名：`高一(1)班`；
 * - 只有班号：`1` / `1班`（年级列已经单独填了，不该逼老师再抄一遍年级）；
 * - 括号省略：`高一1班`。
 */
function resolveClassForImport(campus: string, grade: string, raw: string): OrgClass | undefined {
  const pool = classes.filter((row) => row.campus === campus && row.grade === grade)
  if (!raw) return undefined
  if (!pool.length) return undefined
  const direct = pool.find((row) => row.name === raw)
  if (direct) return direct
  const num = raw.replace(/[^0-9]/g, '')
  if (!num) return undefined
  return (
    pool.find((row) => row.classNo === num) ??
    pool.find((row) => row.name.replace(/[^0-9]/g, '') === num)
  )
}

/* ================= 监护人知情同意（T-08-06） ================= */

const CONSENT_SCOPES = ['学情分析', '个性化练习推送', '错题本生成', 'AI 问答记录']

/** 当前生效的同意书版本（PDF 与页面共用一份，避免两处版本号对不上） */
export const CONSENT_DOC_VERSION = 'V2026.2'

export const consents: ConsentRecord[] = students.map((student) => {
  const status = student.consentStatus
  const channel: ConsentChannel = status === 'granted' ? (rand() < 0.75 ? '家长端 H5' : '纸质签署') : '机构代录'
  return {
    id: ++consentSeq,
    studentId: student.id,
    studentName: student.name,
    studentNo: student.studentNo,
    guardianName: student.guardianName,
    relation: student.gender === '男' ? '父亲' : '母亲',
    docVersion: CONSENT_DOC_VERSION,
    status,
    scopes: status === 'granted' ? CONSENT_SCOPES.slice(0, 2 + Math.floor(rand() * 3)) : [],
    signature: status === 'granted' ? student.guardianName.replace(/先生|女士/, '') : undefined,
    channel,
    signedAt: status === 'granted' ? '2026-09-05 10:24:00' : undefined,
    withdrawnAt: status === 'withdrawn' ? '2026-09-18 15:40:00' : undefined,
  }
})

export function listConsents(keyword: string): ConsentRecord[] {
  return consents.filter((row) => !keyword || row.studentName.includes(keyword) || row.guardianName.includes(keyword))
}

/** 按学生取同意记录：知情同意并入学生档案详情后，详情抽屉只认学生 id */
export function getConsentByStudent(studentId: number): ConsentRecord | null {
  return consents.find((row) => row.studentId === studentId) ?? null
}

/**
 * 补签：勾选授权范围 + 记录签名文字。
 *
 * 签名文字必填 —— 同意书的留档价值就在于「谁签的」，只有状态没有签名等于没签。
 */
export function signConsent(id: number, scopes: string[], signature?: string): ConsentRecord {
  const record = consents.find((row) => row.id === id)
  if (!record) throw new Error('同意记录不存在')
  if (!scopes.length) throw new Error('请至少勾选一项授权范围')
  const signer = (signature ?? '').trim()
  if (!signer) throw new Error('请填写监护人签名')
  record.status = 'granted'
  record.scopes = [...scopes]
  record.signature = signer
  record.channel = '机构代录'
  record.signedAt = nowStamp()
  record.withdrawnAt = undefined
  const student = students.find((row) => row.id === record.studentId)
  if (student) student.consentStatus = 'granted'
  return record
}

export function withdrawConsent(id: number): ConsentRecord {
  const record = consents.find((row) => row.id === id)
  if (!record) throw new Error('同意记录不存在')
  record.status = 'withdrawn'
  record.scopes = []
  record.signature = undefined
  record.channel = '机构代录'
  record.withdrawnAt = nowStamp()
  record.signedAt = undefined
  const student = students.find((row) => row.id === record.studentId)
  if (student) student.consentStatus = 'withdrawn'
  return record
}

/* ================= AI 学情画像（T-07-08 ~ 10） ================= */

const KNOWLEDGE: Record<string, string[]> = {
  数学: ['集合与逻辑', '函数概念与性质', '指数与对数', '三角函数', '平面向量', '数列', '不等式'],
  语文: ['文言文阅读', '现代文阅读', '古诗词鉴赏', '语言文字运用', '写作'],
  英语: ['阅读理解', '完形填空', '语法填空', '应用文写作', '听力'],
  物理: ['运动学', '相互作用', '牛顿运动定律', '机械能', '曲线运动'],
}

const TRENDS: Array<MasteryNode['trend']> = ['up', 'flat', 'down']

/** 按学生生成画像（确定性：同一学生每次进来相同） */
function buildProfile(student: OrgStudent): StudentProfile {
  const base = student.lastPercentile ?? 50
  const subjects = Object.entries(KNOWLEDGE).map(([subject, nodes]) => {
    const list = nodes.map((knowledge) => {
      /* 百分位越高整体掌握度越高，个体知识点上下浮动 */
      const mastery = Math.max(18, Math.min(98, Math.round(base * 0.7 + 18 + rand() * 34)))
      return {
        knowledge,
        mastery,
        trend: pickOne(TRENDS),
        practices: 2 + Math.floor(rand() * 14),
        weak: mastery < 60,
      }
    })
    return { subject, mastery: Math.round(list.reduce((sum, row) => sum + row.mastery, 0) / list.length), nodes: list }
  })
  const overall = Math.round(subjects.reduce((sum, row) => sum + row.mastery, 0) / subjects.length)
  const weakest = subjects
    .flatMap((row) => row.nodes)
    .filter((row) => row.weak)
    .slice(0, 3)
    .map((row) => row.knowledge)
  return {
    studentId: student.id,
    studentName: student.name,
    className: student.className,
    overall,
    percentile: base,
    subjects,
    diagnosis: weakest.length
      ? `薄弱点集中在「${weakest.join('、')}」，结合近期作业正确率与错题归因，主要失分来自概念理解不牢与综合题迁移不足（AI 归因，仅供参考）。`
      : '各知识点掌握度均衡，无显著薄弱点，可适当增加压轴题与综合应用训练（AI 归因，仅供参考）。',
    suggestion: weakest.length
      ? `建议推送「${weakest[0]}」专项练习 8 题（含 2 道变式），两周后复测掌握度。`
      : '建议参加拓展练习，保持综合题手感。',
    pushes: [
      {
        id: ++pushSeq,
        title: weakest.length ? `「${weakest[0]}」专项巩固（AI 推送）` : '综合应用拓展卷（AI 推送）',
        questionCount: 8,
        weakPoints: weakest.length ? weakest.slice(0, 2) : ['综合应用'],
        pushedAt: '2026-09-24 08:30:00',
        done: Math.floor(rand() * 9),
      },
    ],
  }
}

export function getStudentProfile(studentId: number): StudentProfile {
  const student = students.find((row) => row.id === studentId)
  if (!student) throw new Error('学生不存在')
  seed = student.id * 7919
  return buildProfile(student)
}

export function getClassProfileReport(className: string): ClassProfileReport {
  const roster = students.filter((row) => row.className === className && row.status === '在读')
  if (!roster.length) throw new Error('班级暂无在读学生')
  seed = roster.reduce((sum, row) => sum + row.id, 0)
  const subjectMastery = Object.keys(KNOWLEDGE).map((subject) => ({
    subject,
    mastery: Math.round(55 + rand() * 30),
    lastTerm: Math.round(50 + rand() * 32),
  }))
  const weakNodes = Object.entries(KNOWLEDGE)
    .flatMap(([subject, nodes]) => nodes.map((knowledge) => ({ subject, knowledge, mastery: Math.round(30 + rand() * 50) })))
    .sort((a, b) => a.mastery - b.mastery)
    .slice(0, 6)
    .map((row) => ({
      knowledge: `${row.subject} · ${row.knowledge}`,
      mastery: row.mastery,
      trend: pickOne(TRENDS),
      practices: 10 + Math.floor(rand() * 30),
      weak: row.mastery < 60,
    }))
  const bands = ['90+', '80-89', '70-79', '60-69', '<60']
  const scoreBands = bands.map((band, index) => ({
    band,
    count: index === 0 ? 1 + Math.floor(rand() * 4) : index === 4 ? 1 + Math.floor(rand() * 3) : 3 + Math.floor(rand() * 6),
  }))
  const advice = [
    `「${weakNodes[0]?.knowledge ?? '综合应用'}」为全班共性薄弱点，建议安排一节专题复习课并配套课后变式练习。`,
    '分数段呈中间大、两头小分布；按成长型激励要求不做公开排名，建议在讲评时只呈现分布与自身区间。',
    `较上学期，${subjectMastery.filter((row) => row.mastery > row.lastTerm).map((row) => row.subject).join('、') || '各学科'}平均掌握度上升，注意保持训练强度。`,
  ]
  return {
    className,
    studentCount: roster.length,
    subjectMastery,
    weakNodes,
    scoreBands,
    advice,
  }
}

/** 个性化练习推送（T-07-10）：给指定学生按薄弱点生成一份练习 */
export function pushPractice(studentId: number, knowledge: string, count: number): StudentProfile['pushes'][number] {
  const student = students.find((row) => row.id === studentId)
  if (!student) throw new Error('学生不存在')
  if (!knowledge) throw new Error('请选择薄弱知识点')
  const push = {
    id: ++pushSeq,
    title: `「${knowledge}」个性化练习（AI 推送）`,
    questionCount: count,
    weakPoints: [knowledge],
    pushedAt: UPDATED,
    done: 0,
  }
  /* 推送记录写回画像（演示：直接挂在内存 push 池） */
  pushPool.push({ studentId, push })
  return push
}

const pushPool: Array<{ studentId: number; push: StudentProfile['pushes'][number] }> = []

export function listPushes(studentId: number): StudentProfile['pushes'] {
  return pushPool.filter((row) => row.studentId === studentId).map((row) => row.push)
}

/* ================= AI 能力中心（T-10） ================= */

export const AI_CAPABILITIES: AiCapabilityCard[] = [
  { key: 'gen-question', title: 'AI 出题', desc: '按学科、知识点、难度批量生成题目，自动质检后入库', scene: '出题', monthUses: 128, icon: 'edit', link: '/question/create?mode=ai' },
  { key: 'gen-paper', title: 'AI 组卷', desc: '输入考试场景与范围，一键生成完整试卷与质量报告', scene: '组卷', monthUses: 46, icon: 'file', link: '/paper/compose' },
  { key: 'gen-lecture', title: 'AI 讲义', desc: '按课题生成讲义初稿：知识梳理、例题、变式练习', scene: '讲义', monthUses: 32, icon: 'book', link: '/teach/lecture' },
  { key: 'gen-courseware', title: 'AI 课件', desc: '按教学目标生成课件页面结构与互动环节设计', scene: '课件', monthUses: 28, icon: 'presentation', link: '/teach/courseware' },
  { key: 'photo-question', title: 'AI 拍照识题', desc: '拍照或截图识别单题，结构化为可编辑题目', scene: '识题', monthUses: 96, icon: 'image', link: '/question/photo' },
  { key: 'ai-grading', title: 'AI 阅卷', desc: '主观题与作文按评分标准分步给分，教师复核生效', scene: '阅卷', monthUses: 18, icon: 'clipboard', link: '/exam/grading' },
  { key: 'ai-profile', title: 'AI 学情分析', desc: '知识点掌握画像、薄弱归因与个性化练习推送', scene: '学情', monthUses: 54, icon: 'chart', link: '/exam/profile' },
  { key: 'ai-assistant', title: '教师 AI 助手', desc: '教学问答、素材检索、思路启发', scene: '问答', monthUses: 210, icon: 'sparkles', link: '/ai-center/workbench' },
]

/* ===== 任务中心 =====
   任务时间取「相对今天」：AI 用量本来就是滚动窗口，写死日期的任务在「近 7 天」里永远查不到，
   而任务中心恰恰是按「最近发生的」顺序看的。 */

/** 相对今天的某个时刻（先归零时分秒再退天数，跨月也算得对） */
function stampDaysAgo(daysAgo: number, hour = 10, minute = 0): string {
  const d = new Date()
  d.setHours(hour, minute, 0, 0)
  d.setDate(d.getDate() - daysAgo)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(hour)}:${pad(minute)}:00`
}

/** 在时间戳上加分钟：一次任务的多次调用要排在发起之后，不能都挤在同一秒 */
function addMinutes(stamp: string, minutes: number): string {
  const d = new Date(`${stamp.slice(0, 10)}T${stamp.slice(11)}`)
  d.setMinutes(d.getMinutes() + minutes)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`
}

const TASK_SEEDS: Array<{
  scene: string
  title: string
  status: AiCenterTask['status']
  elapsed: number
  tokens: number
  outputCount: number
  creator: string
  daysAgo: number
}> = [
  /* 16 条覆盖近 14 天：任务中心要能按场景 / 状态 / 发起人筛出有意义的子集，
     只有 8 条时任何两条件叠加都只剩一行，筛完看不出对不对 */
  { scene: '出题', title: '「三角函数」专项出题 · 10 题', status: 'success', elapsed: 42, tokens: 18600, outputCount: 10, creator: '李文博', daysAgo: 0 },
  { scene: '组卷', title: '高一数学期中卷（AI 生成）', status: 'reviewing', elapsed: 76, tokens: 32400, outputCount: 1, creator: '孙悦', daysAgo: 0 },
  { scene: '出题', title: '「概率统计」专项出题 · 12 题', status: 'running', elapsed: 8, tokens: 4200, outputCount: 0, creator: '孙悦', daysAgo: 0 },
  { scene: '讲义', title: '《函数概念与性质》讲义初稿', status: 'success', elapsed: 55, tokens: 24800, outputCount: 1, creator: '王静宜', daysAgo: 1 },
  { scene: '识题', title: '批量拍照识题 · 6 张', status: 'success', elapsed: 38, tokens: 15800, outputCount: 6, creator: '周敏', daysAgo: 1 },
  { scene: '学情', title: '高一(1)班 9 月学情报告', status: 'success', elapsed: 64, tokens: 41200, outputCount: 1, creator: '陈明远', daysAgo: 2 },
  { scene: '阅卷', title: '期中考试解答 AI 批改', status: 'reviewing', elapsed: 118, tokens: 66800, outputCount: 45, creator: '李文博', daysAgo: 2 },
  { scene: '课件', title: '《平面向量》课件生成', status: 'failed', elapsed: 12, tokens: 2100, outputCount: 0, creator: '孙悦', daysAgo: 3 },
  { scene: '出题', title: '「文言文阅读」出题 · 8 题', status: 'success', elapsed: 46, tokens: 20400, outputCount: 8, creator: '王静宜', daysAgo: 3 },
  { scene: '组卷', title: '高二物理单元测（AI 组卷）', status: 'reviewing', elapsed: 71, tokens: 30100, outputCount: 1, creator: '周敏', daysAgo: 4 },
  { scene: '问答', title: '《荷塘月色》教学设计思路咨询', status: 'success', elapsed: 9, tokens: 3200, outputCount: 1, creator: '陈明远', daysAgo: 5 },
  { scene: '出题', title: '「立体几何」专项出题 · 12 题', status: 'success', elapsed: 51, tokens: 22300, outputCount: 12, creator: '李文博', daysAgo: 6 },
  { scene: '讲义', title: '《指数与对数》讲义初稿', status: 'success', elapsed: 49, tokens: 21600, outputCount: 1, creator: '孙悦', daysAgo: 7 },
  { scene: '识题', title: '整页试卷识别（3 页）', status: 'failed', elapsed: 21, tokens: 4800, outputCount: 0, creator: '周敏', daysAgo: 8 },
  { scene: '学情', title: '高一(2)班学情报告', status: 'success', elapsed: 58, tokens: 38700, outputCount: 1, creator: '王静宜', daysAgo: 9 },
  { scene: '阅卷', title: '月考主观题 AI 批改', status: 'success', elapsed: 96, tokens: 52400, outputCount: 38, creator: '陈明远', daysAgo: 10 },
]

export const aiTasks: AiCenterTask[] = TASK_SEEDS.map((row, index) => ({
  id: ++taskSeq,
  scene: row.scene,
  title: row.title,
  creator: row.creator,
  status: row.status,
  elapsed: row.elapsed,
  tokens: row.tokens,
  outputCount: row.outputCount,
  createdAt: stampDaysAgo(row.daysAgo, 9 + (index % 8), (index * 7) % 60),
}))

/** 任务列表查询（关键词认任务名与发起人：老师找任务时记的多半是这两样） */
export function listAiTasks(query: AiTaskQuery = {}): AiCenterTask[] {
  const kw = (query.keyword ?? '').trim()
  return aiTasks.filter((row) => {
    if (kw && !row.title.includes(kw) && !row.creator.includes(kw)) return false
    if (query.scene && row.scene !== query.scene) return false
    if (query.status && row.status !== query.status) return false
    if (query.creator && row.creator !== query.creator) return false
    return true
  })
}

export function cancelAiTask(id: number): void {
  const task = aiTasks.find((row) => row.id === id)
  if (!task) throw new Error('任务不存在')
  if (task.status !== 'running') throw new Error('仅进行中的任务可取消')
  task.status = 'failed'
}

/* ===== AI 请求明细（用量统计与任务「请求明细」的共同数据源） ===== */

/** 单价（元 / 百万 token），与平台端计费规则同一口径 */
const INPUT_PRICE = 2
const OUTPUT_PRICE = 8

const USAGE_USERS = ['陈明远', '李文博', '孙悦', '王静宜', '周敏']
const USAGE_SCENES = ['出题', '组卷', '讲义', '课件', '识题', '阅卷', '学情', '问答']

/**
 * 加权取样：用量分布不能是均匀的。
 *
 * 按步长取模的写法会让每个人恰好 22 次、「出题」和「问答」一样多 —— 一张每人数字都相同的
 * 分布表，看的人第一反应是「这数据是假的」，而不是「用量很均衡」。
 */
function pickWeighted(list: string[], weights: number[], score: number): string {
  const point = score % 100
  let acc = 0
  for (let i = 0; i < list.length; i++) {
    acc += weights[i]
    if (point < acc) return list[i]
  }
  return list[list.length - 1]
}

/** 使用人权重：主讲老师用得最多，管理员只是偶尔用 */
const USER_WEIGHTS = [16, 32, 24, 18, 10]
/** 功能权重：出题 / 识题是高频刚需，问答偏低频 */
const SCENE_WEIGHTS = [24, 14, 12, 6, 20, 9, 11, 4]

let requestSeq = 6000

/**
 * 生成近 90 天的调用明细。
 *
 * 用「下标公式」而不是 `rand()`：这里的伪随机发生器是全文件共享的，多抽一次就会让后面
 * 的学情画像、同意书种子跟着变 —— 明细本身只要每次刷新一致即可。
 */
function buildRequestLogs(): AiRequestLog[] {
  const rows: AiRequestLog[] = []
  const TOTAL_DAYS = 90
  for (let day = TOTAL_DAYS - 1; day >= 0; day--) {
    /* 工作日 4 次、周末 3 次：真实的机构用量就是周末明显低 */
    const weekday = new Date(Date.now() - day * 86400000).getDay()
    const perDay = weekday === 0 || weekday === 6 ? 3 : 4
    for (let i = 0; i < perDay; i++) {
      const idx = day * 7 + i
      const scene = pickWeighted(USAGE_SCENES, SCENE_WEIGHTS, idx * 37 + day * 11)
      const promptTokens = 12000 + ((idx * 977) % 18000)
      const completionTokens = 4000 + ((idx * 613) % 8000)
      const totalTokens = promptTokens + completionTokens
      rows.push({
        id: ++requestSeq,
        /* 刻意**不绑任务**：日志按天生成、任务只覆盖最近 10 天，硬绑会出现「请求时间早于
           任务发起时间」这种一眼假的倒挂。任务明细改由 taskRequests() 按任务自身数据合成，
           时间稳定落在发起之后（真实后端按 taskId 直查，两边天然一致）。 */
        scene,
        userName: pickWeighted(USAGE_USERS, USER_WEIGHTS, idx * 53 + day * 7),
        promptTokens,
        completionTokens,
        totalTokens,
        cost: Math.round(((promptTokens * INPUT_PRICE + completionTokens * OUTPUT_PRICE) / 1_000_000) * 1000) / 1000,
        elapsed: 6 + ((idx * 13) % 88),
        status: idx % 37 === 0 ? 'failed' : 'success',
        createdAt: stampDaysAgo(day, 8 + (idx % 11), (idx * 7) % 60),
      })
    }
  }
  return rows
}

export const aiRequestLogs: AiRequestLog[] = buildRequestLogs()

/** 额度：按自然月一个周期，token 与金额两套口径一起给 */
const TOKEN_QUOTA = 6_000_000
const COST_QUOTA = 20

function monthStartStr(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01 00:00:00`
}

function nextMonthStartStr(): string {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() + 1)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/** 金额保留到分 */
function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function dayKeyOf(daysAgo: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * 趋势桶。
 *
 * 按日给满 `days` 个桶（含没有调用的那天显示 0，否则「中间断了三天」和「一直没人用」
 * 在图上长得一样）；按周 7 天一段；按月固定最近 3 个月 —— 月度用量是账单口径，
 * 给 12 个空月份没有意义。
 */
function buildBuckets(logs: AiRequestLog[], granularity: AiUsageGranularity, days: number): AiUsageBucket[] {
  if (granularity === 'day') {
    return Array.from({ length: days }, (_, offset) => {
      const daysAgo = days - 1 - offset
      const key = dayKeyOf(daysAgo)
      const hit = logs.filter((row) => row.createdAt.slice(5, 10) === key)
      return {
        label: key,
        requests: hit.length,
        tokens: hit.reduce((sum, row) => sum + row.totalTokens, 0),
        cost: round2(hit.reduce((sum, row) => sum + row.cost, 0)),
      }
    })
  }

  if (granularity === 'week') {
    const weeks = Math.max(1, Math.round(days / 7))
    return Array.from({ length: weeks }, (_, offset) => {
      const endAgo = (weeks - 1 - offset) * 7
      const startAgo = endAgo + 6
      const startKey = dayKeyOf(startAgo)
      const endKey = dayKeyOf(endAgo)
      const hit = logs.filter((row) => {
        const day = row.createdAt.slice(5, 10)
        return day >= startKey && day <= endKey
      })
      return {
        label: `${startKey} ~ ${endKey}`,
        requests: hit.length,
        tokens: hit.reduce((sum, row) => sum + row.totalTokens, 0),
        cost: round2(hit.reduce((sum, row) => sum + row.cost, 0)),
      }
    })
  }

  return Array.from({ length: 3 }, (_, offset) => {
    const d = new Date()
    d.setDate(1)
    d.setMonth(d.getMonth() - (2 - offset))
    const pad = (n: number) => String(n).padStart(2, '0')
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
    const hit = logs.filter((row) => row.createdAt.slice(0, 7) === key)
    return {
      label: key,
      requests: hit.length,
      tokens: hit.reduce((sum, row) => sum + row.totalTokens, 0),
      cost: round2(hit.reduce((sum, row) => sum + row.cost, 0)),
    }
  })
}

function groupUsage(logs: AiRequestLog[], field: 'userName' | 'scene'): AiUsageGroupRow[] {
  const totalTokens = logs.reduce((sum, row) => sum + row.totalTokens, 0)
  const map = new Map<string, { requests: number; tokens: number; cost: number }>()
  logs.forEach((row) => {
    const key = row[field]
    const hit = map.get(key) ?? { requests: 0, tokens: 0, cost: 0 }
    hit.requests += 1
    hit.tokens += row.totalTokens
    hit.cost += row.cost
    map.set(key, hit)
  })
  return [...map.entries()]
    .map(([name, hit]) => ({
      key: name,
      name,
      requests: hit.requests,
      tokens: hit.tokens,
      cost: Math.round(hit.cost * 100) / 100,
      share: totalTokens ? round1((hit.tokens / totalTokens) * 100) : 0,
    }))
    .sort((a, b) => b.tokens - a.tokens)
}

/** AI 用量报表：额度 + 当前窗口汇总 + 趋势 + 按人/按功能分组 + 明细 */
export function aiUsageReport(query: AiUsageQuery = {}): AiUsageReport {
  const granularity = query.granularity ?? 'day'
  const days = Math.max(7, Math.min(90, query.days ?? 30))

  /* 月度口径不受「近 N 天」影响：额度是按自然月结算的，两个窗口混用会算出
     「用了 30 天的量、却挂在 18 天的额度上」这种对不上的百分比 */
  const monthStart = monthStartStr()
  const monthLogs = aiRequestLogs.filter((row) => row.createdAt >= monthStart)
  const monthTokens = monthLogs.reduce((sum, row) => sum + row.totalTokens, 0)
  const monthCost = Math.round(monthLogs.reduce((sum, row) => sum + row.cost, 0) * 100) / 100

  const from = stampDaysAgo(days - 1, 0, 0)
  const logs = aiRequestLogs
    .filter((row) => row.createdAt >= from)
    .filter((row) => (query.userName ? row.userName === query.userName : true))
    .filter((row) => (query.scene ? row.scene === query.scene : true))

  const tokens = logs.reduce((sum, row) => sum + row.totalTokens, 0)
  const cost = Math.round(logs.reduce((sum, row) => sum + row.cost, 0) * 100) / 100
  const failed = logs.filter((row) => row.status === 'failed').length

  return {
    quota: {
      tokenQuota: TOKEN_QUOTA,
      tokenUsed: monthTokens,
      tokenLeft: Math.max(0, TOKEN_QUOTA - monthTokens),
      costQuota: COST_QUOTA,
      costUsed: monthCost,
      costLeft: Math.round(Math.max(0, COST_QUOTA - monthCost) * 100) / 100,
      resetAt: nextMonthStartStr(),
    },
    summary: {
      requests: logs.length,
      tokens,
      cost,
      failRate: logs.length ? round1((failed / logs.length) * 100) : 0,
    },
    granularity,
    buckets: buildBuckets(logs, granularity, days),
    byUser: groupUsage(logs, 'userName'),
    byScene: groupUsage(logs, 'scene'),
    /* 明细最多给 200 条：这是「看最近发生了什么」的视图，不是账单导出 */
    logs: [...logs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200),
  }
}

/** 一条任务的请求明细（没有绑定日志的旧任务按总消耗拆几条，明细页不能空着） */
export function taskRequests(taskId: number): AiRequestLog[] {
  const bound = aiRequestLogs.filter((row) => row.taskId === taskId)
  if (bound.length) return [...bound].sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  const task = aiTasks.find((row) => row.id === taskId)
  if (!task) return []
  const parts = task.tokens > 0 ? Math.min(4, Math.max(1, Math.ceil(task.tokens / 12000))) : 1
  const base = Math.max(1, Math.round(task.tokens / parts))
  return Array.from({ length: parts }, (_, index) => {
    /* 每条上下浮动 ±10%：真实调用里输入是题目上下文、输出是生成结果，每轮长度本来就不同。
       完全等分的明细一眼就是造的，对账时反而会让人怀疑整页数据 */
    const drift = 0.9 + ((index * 7) % 5) * 0.05
    const promptTokens = Math.max(1, Math.round(base * 0.7 * drift))
    const completionTokens = Math.max(1, Math.round(base * 0.3 * (2 - drift)))
    return {
      id: task.id * 100 + index,
      taskId: task.id,
      scene: task.scene,
      userName: task.creator,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      cost: Math.round(((promptTokens * INPUT_PRICE + completionTokens * OUTPUT_PRICE) / 1_000_000) * 1000) / 1000,
      elapsed: Math.max(1, Math.round((task.elapsed / parts) * (0.85 + ((index * 3) % 4) * 0.1))),
      status: task.status === 'failed' ? 'failed' : 'success',
      createdAt: addMinutes(task.createdAt, index * 3 + 1),
    }
  })
}

/** 任务产出明细：按产物类型给落点，老师看完能直接跳过去用 */
const OUTPUT_KIND: Record<string, string> = {
  出题: '题目',
  组卷: '试卷',
  讲义: '讲义',
  课件: '课件',
  识题: '题目',
  阅卷: '批改',
  学情: '画像',
  问答: '问答',
}

const OUTPUT_LINK: Record<string, string> = {
  出题: '/question/bank',
  组卷: '/paper/list',
  讲义: '/teach/lecture',
  课件: '/teach/courseware',
  识题: '/question/bank',
  阅卷: '/exam/grading',
  学情: '/exam/profile',
  问答: '/ai-center/workbench',
}

export function taskOutputs(taskId: number): AiTaskOutput[] {
  const task = aiTasks.find((row) => row.id === taskId)
  if (!task || task.outputCount <= 0) return []
  const kind = OUTPUT_KIND[task.scene] ?? '产物'
  /* 一份「产物」可能是一批题（10 题）或一份文件（1 份试卷）：批量题最多列 12 条，
     再多就该去题库看了，明细页不是题集 */
  const count = Math.min(task.outputCount, 12)
  const perTokens = Math.round(task.tokens / Math.max(1, task.outputCount))
  const status: AiTaskOutput['status'] =
    task.status === 'failed' ? 'rejected' : task.status === 'reviewing' ? 'reviewing' : 'ok'
  return Array.from({ length: count }, (_, index) => ({
    id: task.id * 1000 + index,
    title: count === 1 ? task.title : `${task.title.replace(/·.*$/, '').trim()} · 第 ${index + 1} 项`,
    kind,
    status,
    tokens: perTokens,
    createdAt: task.createdAt,
    link: OUTPUT_LINK[task.scene],
  }))
}

/* AI 生成内容复核（T-10-08：治理红线 —— AI 内容须教师复核后才能发布） */

const ARTIFACT_SEEDS: Array<{
  kind: AiArtifactReview['kind']
  title: string
  scene: string
  status: AiArtifactReview['status']
  autoCheck: AiArtifactReview['autoCheck']
  autoCheckNote: string
}> = [
  { kind: '题目', title: '「数列」AI 生成题 ×10', scene: '出题', status: 'pending', autoCheck: 'pass', autoCheckNote: '答案自洽、解析完整、年级适配' },
  { kind: '试卷', title: '高一物理 9 月月考卷（AI 生成）', scene: '组卷', status: 'pending', autoCheck: 'warn', autoCheckNote: '第 14 题解析与答案存在轻微不一致，建议人工确认' },
  { kind: '讲义', title: '《指数与对数》讲义初稿', scene: '讲义', status: 'approved', autoCheck: 'pass', autoCheckNote: '自动质检通过' },
  { kind: '课件', title: '《曲线运动》互动课件', scene: '课件', status: 'pending', autoCheck: 'pass', autoCheckNote: '自动质检通过' },
  { kind: '批改', title: '期中作文 AI 批改 · 张一鸣', scene: '阅卷', status: 'pending', autoCheck: 'error', autoCheckNote: '评分理由与分值不匹配，必须人工复核' },
  { kind: '题目', title: '「文言文」AI 生成题 ×8', scene: '出题', status: 'rejected', autoCheck: 'warn', autoCheckNote: '超纲词句较多，建议驳回重生成' },
  { kind: '画像', title: '高一(2)班学情报告（AI）', scene: '学情', status: 'approved', autoCheck: 'pass', autoCheckNote: '自动质检通过' },
  /* 补到 14 条：复核页加了类型 / 场景 / 状态 / 质检四组条件，样本太少时两两叠加就只剩一行，
     看不出筛选是否真的生效 */
  { kind: '题目', title: '「立体几何」AI 生成题 ×12', scene: '出题', status: 'pending', autoCheck: 'pass', autoCheckNote: '图形描述与题干一致' },
  { kind: '试卷', title: '高二物理单元测（AI 组卷）', scene: '组卷', status: 'pending', autoCheck: 'error', autoCheckNote: '第 9 题答案缺失，必须人工复核' },
  { kind: '题目', title: '「概率统计」AI 生成题 ×8', scene: '出题', status: 'approved', autoCheck: 'pass', autoCheckNote: '自动质检通过' },
  { kind: '批改', title: '月考主观题 AI 批改 · 陈思远', scene: '阅卷', status: 'approved', autoCheck: 'warn', autoCheckNote: '解题步骤给分偏松，已由教师下调 2 分' },
  { kind: '讲义', title: '《平面向量》讲义初稿', scene: '讲义', status: 'pending', autoCheck: 'warn', autoCheckNote: '例题难度跨度偏大，建议人工确认' },
  { kind: '课件', title: '《电磁感应》互动课件', scene: '课件', status: 'approved', autoCheck: 'pass', autoCheckNote: '自动质检通过' },
  { kind: '画像', title: '高一(2)班学情报告（AI）· 更新版', scene: '学情', status: 'rejected', autoCheck: 'error', autoCheckNote: '归因结论与原始数据不符，建议重新生成' },
]

export const aiArtifacts: AiArtifactReview[] = ARTIFACT_SEEDS.map((row, index) => ({
  id: ++artifactSeq,
  kind: row.kind,
  title: row.title,
  scene: row.scene,
  status: row.status,
  autoCheck: row.autoCheck,
  autoCheckNote: row.autoCheckNote,
  aiLabeled: true,
  createdAt: stampDaysAgo(index, 10 + (index % 6), (index * 11) % 60),
  reviewer: row.status === 'pending' ? undefined : '李文博',
  reviewedAt: row.status === 'pending' ? undefined : nowStamp(),
}))

export function listAiArtifacts(query: AiArtifactQuery = {}): AiArtifactReview[] {
  const kw = (query.keyword ?? '').trim()
  return aiArtifacts.filter((row) => {
    if (kw && !row.title.includes(kw)) return false
    if (query.kind && row.kind !== query.kind) return false
    if (query.scene && row.scene !== query.scene) return false
    if (query.status && row.status !== query.status) return false
    if (query.autoCheck && row.autoCheck !== query.autoCheck) return false
    return true
  })
}

export function reviewAiArtifact(id: number, pass: boolean): AiArtifactReview {
  const artifact = aiArtifacts.find((row) => row.id === id)
  if (!artifact) throw new Error('复核条目不存在')
  if (artifact.status !== 'pending') throw new Error('该条目已复核')
  artifact.status = pass ? 'approved' : 'rejected'
  artifact.reviewer = '当前用户'
  /* 复核时间是留档字段，必须是真实时间（种子里那条写死的时间只给种子数据用） */
  artifact.reviewedAt = nowStamp()
  return artifact
}

/* ================= 机构系统设置（T-11） ================= */

export const orgSettings: OrgSettings = {
  name: '星辰教育培训学校',
  shortName: '星辰教育',
  contact: '李文博',
  phone: '021-6688-1000',
  address: '上海市浦东新区锦绣路 200 号',
  intro: '专注高中学科培优与 AI 精准教学的示范机构。',
  subjects: ['数学', '语文', '英语', '物理'],
  grades: ['高一', '高二', '高三'],
  preferredTextbooks: ['人教 A 版', '沪教版'],
}

export const reviewFlows: ReviewFlowConfig[] = [
  {
    key: 'question',
    label: '题目入库审核',
    enabled: true,
    levels: 1,
    level1Reviewers: ['李文博', '孙悦'],
    level2Reviewers: [],
    aiPrecheck: true,
  },
  {
    key: 'paper',
    label: '试卷发布审核',
    enabled: true,
    levels: 2,
    level1Reviewers: ['孙悦'],
    level2Reviewers: ['王静宜'],
    aiPrecheck: true,
  },
  {
    key: 'resource',
    label: '校本资源上架审核',
    enabled: false,
    levels: 1,
    level1Reviewers: ['李文博'],
    level2Reviewers: [],
    aiPrecheck: false,
  },
]

export function saveOrgSettings(input: Partial<OrgSettings>): OrgSettings {
  if (input.name != null && !input.name.trim()) throw new Error('机构名称必填')
  Object.assign(orgSettings, input)
  return orgSettings
}

export function saveReviewFlow(key: ReviewFlowConfig['key'], input: Partial<ReviewFlowConfig>): ReviewFlowConfig {
  const flow = reviewFlows.find((row) => row.key === key)
  if (!flow) throw new Error('审核流程不存在')
  if (input.levels === 2 && (!input.level2Reviewers || input.level2Reviewers.length === 0)) {
    throw new Error('双级审核必须指定二级审核人')
  }
  Object.assign(flow, input)
  return flow
}

/* ================= 供工作台汇总 ================= */

export function studentOverview(): { classCount: number; studentCount: number; consentRate: number; riskCount: number } {
  const granted = students.filter((row) => row.consentStatus === 'granted').length
  return {
    classCount: classes.length,
    studentCount: students.length,
    consentRate: Math.round((granted / Math.max(1, students.length)) * 100),
    riskCount: students.filter((row) => row.warning === 'risk').length,
  }
}

/* ================= 跨刷新持久化 =================
 *
 * 班级、学生、同意记录都是老师**当场录入**的数据：新增一个班、导一批学生、给某个学生补签，
 * 刷新一下就回到种子数据，演示时会被当成「保存没成功」。持久化机制本身见 persist.ts，
 * 这里只提供本仓库的抓取 / 灌回。
 *
 * 只涉及这三张表 + 三个自增水位：AI 能力中心那些卡片、审核流程是平台侧配置，
 * 不属于机构端录入的数据，不跨刷新保留（与改动前一致）。
 */

export const STUDENT_STATE_VERSION = 1

export function captureStudentState(): Record<string, unknown> {
  return {
    classes,
    students,
    consents,
    seqs: { classSeq, studentSeq, consentSeq },
  }
}

/**
 * 灌回快照。集合一律**原地替换**（`splice`）—— 它们是 `export const`，
 * 换成新数组的话，别处 `import { classes }` 拿到的还是旧数组。
 */
export function restoreStudentState(data: Record<string, unknown>): void {
  const nextClasses = data.classes
  if (Array.isArray(nextClasses)) classes.splice(0, classes.length, ...(nextClasses as OrgClass[]))
  const nextStudents = data.students
  if (Array.isArray(nextStudents)) students.splice(0, students.length, ...(nextStudents as OrgStudent[]))
  const nextConsents = data.consents
  if (Array.isArray(nextConsents)) consents.splice(0, consents.length, ...(nextConsents as ConsentRecord[]))

  const seqs = data.seqs as Record<string, number> | undefined
  if (!seqs) return
  /* 取 max：种子里新增了 id 更大的数据时，以水位高的那个为准，避免新数据撞号 */
  if (typeof seqs.classSeq === 'number') classSeq = Math.max(classSeq, seqs.classSeq)
  if (typeof seqs.studentSeq === 'number') studentSeq = Math.max(studentSeq, seqs.studentSeq)
  if (typeof seqs.consentSeq === 'number') consentSeq = Math.max(consentSeq, seqs.consentSeq)
}
