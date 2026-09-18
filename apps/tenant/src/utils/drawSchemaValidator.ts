/**
 * 绘图工程 Schema 校验（规格模块 7）。
 *
 * 硬性约束：AI 构图只产出草稿，原始工程 JSON 不允许直接入库 / 插入编辑器，
 * 必须经过这里的校验清洗；校验失败禁止载入画布。
 *
 * 三个核心函数：
 * - validateJsxGraphProject：递归删除 slider / animation / button 交互字段，只保留静态图元；
 * - validateFabricDeviceProject：过滤不在预制元件白名单内的 element_id（并返回被过滤清单供 toast）；
 * - validateMolfile：校验 Molfile V2000 基础格式（文件头 / 原子块 / 键块 / M END）。
 */

export interface SchemaResult<T = unknown> {
  ok: boolean
  data?: T
  errMsg: string
  /** 被过滤掉的非法内容描述（未知元件 / 未知图元等），供 UI toast 告知用户 */
  dropped: string[]
}

/* ===== 化学装置预制元件白名单（与 chemElements.ts 保持一致） ===== */
export const CHEM_ELEMENT_IDS = [
  'test_tube',
  'alcohol_lamp',
  'beaker',
  'glass_tube',
  'rubber_stopper',
  'gas_collect_bottle',
  'wash_bottle',
] as const

const INTERACTIVE_KEYS = new Set(['slider', 'sliders', 'animation', 'animations', 'button', 'buttons', 'play', 'pause', 'anim'])

/** 递归删除交互配置字段；返回清洗后的新对象与命中的字段路径 */
function deepStripInteractive(input: unknown, path: string, dropped: string[]): unknown {
  if (Array.isArray(input)) {
    return input.map((item, index) => deepStripInteractive(item, `${path}[${index}]`, dropped))
  }
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (INTERACTIVE_KEYS.has(key.toLowerCase())) {
        dropped.push(`${path}.${key}`)
        continue
      }
      out[key] = deepStripInteractive(value, `${path}.${key}`, dropped)
    }
    return out
  }
  return input
}

/** jsxgraph 静态图元白名单 */
const JSXGRAPH_ELEMENT_TYPES = new Set([
  'point',
  'segment',
  'line',
  'circle',
  'polygon',
  'angleMark',
  'rightAngleMark',
  'text',
])

/** 通用工程清洗（通用简易画布等无专属 Schema 的类型）：只剥交互字段，结构原样放行 */
export function stripInteractiveFields(rawProject: unknown): SchemaResult<Record<string, unknown>> {
  const dropped: string[] = []
  let project: unknown = rawProject
  if (typeof project === 'string') {
    try {
      project = JSON.parse(project)
    } catch {
      return { ok: false, errMsg: '工程 JSON 解析失败', dropped }
    }
  }
  if (!project || typeof project !== 'object' || Array.isArray(project)) {
    return { ok: false, errMsg: '工程数据不是合法对象', dropped }
  }
  const cleaned = deepStripInteractive(project, '$', dropped) as Record<string, unknown>
  return { ok: true, data: cleaned, errMsg: '', dropped }
}

export function validateJsxGraphProject(rawProject: unknown): SchemaResult<{ version: number; elements: unknown[] }> {
  const dropped: string[] = []
  let project: unknown = rawProject
  if (typeof project === 'string') {
    try {
      project = JSON.parse(project)
    } catch {
      return { ok: false, errMsg: '工程 JSON 解析失败', dropped }
    }
  }
  if (!project || typeof project !== 'object') {
    return { ok: false, errMsg: '工程数据不是合法对象', dropped }
  }
  const cleaned = deepStripInteractive(project, '$', dropped) as Record<string, unknown>

  const elements = Array.isArray(cleaned.elements) ? cleaned.elements : []
  const kept = elements.filter((el) => {
    const type = el && typeof el === 'object' ? String((el as Record<string, unknown>).type ?? '') : ''
    const known = JSXGRAPH_ELEMENT_TYPES.has(type)
    if (!known) dropped.push(`elements[${type || '?'}]`)
    return known
  })
  if (!kept.length) {
    return { ok: false, errMsg: '草稿中没有可识别的静态图元', dropped }
  }
  return { ok: true, data: { version: 1, elements: kept }, errMsg: '', dropped }
}

export function validateFabricDeviceProject(rawProject: unknown): SchemaResult<{
  version: number
  elements: Array<Record<string, unknown>>
  lines?: unknown[]
  texts?: unknown[]
}> {
  const dropped: string[] = []
  let project: unknown = rawProject
  if (typeof project === 'string') {
    try {
      project = JSON.parse(project)
    } catch {
      return { ok: false, errMsg: '工程 JSON 解析失败', dropped }
    }
  }
  if (!project || typeof project !== 'object') {
    return { ok: false, errMsg: '工程数据不是合法对象', dropped }
  }
  const cleaned = deepStripInteractive(project, '$', dropped) as Record<string, unknown>

  const rawElements = Array.isArray(cleaned.elements) ? cleaned.elements : []
  const elements = rawElements.filter((el): el is Record<string, unknown> => {
    const id = el && typeof el === 'object' ? String((el as Record<string, unknown>).elementId ?? '') : ''
    const known = (CHEM_ELEMENT_IDS as readonly string[]).includes(id)
    if (!known) dropped.push(`element[${id || '?'}]`)
    return known
  })
  if (!elements.length) {
    return { ok: false, errMsg: '草稿中没有可用的预制元件', dropped }
  }
  return {
    ok: true,
    data: {
      version: 1,
      elements,
      lines: Array.isArray(cleaned.lines) ? cleaned.lines : [],
      texts: Array.isArray(cleaned.texts) ? cleaned.texts : [],
    },
    errMsg: '',
    dropped,
  }
}

/** Molfile V2000 基础校验：文件头、原子数/键数行、原子块、键块、M END */
export function validateMolfile(molStr: string): SchemaResult<string> {
  const dropped: string[] = []
  if (typeof molStr !== 'string' || !molStr.trim()) {
    return { ok: false, errMsg: 'molfile 为空', dropped }
  }
  const lines = molStr.replace(/\r\n/g, '\n').split('\n')
  const countsIndex = lines.findIndex((line) => line.includes('V2000'))
  if (countsIndex === -1) {
    return { ok: false, errMsg: '缺少 V2000 标识，不是 Molfile V2000 格式', dropped }
  }
  const counts = lines[countsIndex].trim().split(/\s+/).map(Number)
  const [atoms, bonds] = [counts[0] || 0, counts[1] || 0]
  if (!atoms || Number.isNaN(atoms) || !bonds || Number.isNaN(bonds)) {
    return { ok: false, errMsg: 'counts 行原子数 / 键数非法', dropped }
  }
  const atomLines = lines.slice(countsIndex + 1, countsIndex + 1 + atoms)
  const bondLines = lines.slice(countsIndex + 1 + atoms, countsIndex + 1 + atoms + bonds)
  if (atomLines.length < atoms || atomLines.some((line) => !/^[+-]?\d*\.?\d+\s+[+-]?\d*\.?\d+\s+[+-]?\d*\.?\d+\s+\S/.test(line.trim()))) {
    return { ok: false, errMsg: '原子块格式非法', dropped }
  }
  if (bondLines.length < bonds || bondLines.some((line) => !/^\s*\d+\s+\d+\s+\d+/.test(line))) {
    return { ok: false, errMsg: '键块格式非法', dropped }
  }
  if (!lines.slice(countsIndex + 1 + atoms + bonds).some((line) => line.trim() === 'M  END')) {
    return { ok: false, errMsg: '缺少 M END 结束标记', dropped }
  }
  return { ok: true, data: molStr, errMsg: '', dropped }
}
