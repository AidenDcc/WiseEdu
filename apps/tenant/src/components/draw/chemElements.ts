/**
 * 化学实验预制元件库（规格模块 4）。
 *
 * 元件 SVG 全部内联在本文件（私有化部署要求：不引用任何外部 / CDN 资源），
 * id 白名单与 utils/drawSchemaValidator.ts 的 CHEM_ELEMENT_IDS 保持一致 ——
 * AI 草稿里的未知元件 id 会在校验层被过滤。
 */

export interface ChemElement {
  id: (typeof CHEM_ELEMENT_IDS)[number]
  name: string
  /** 内联 SVG（viewBox 统一 0 0 100 120，插入画布时按高度 90px 等比缩放） */
  svg: string
}

/* 白名单唯一来源在 Schema 校验器里（AI 草稿过滤与它共用同一份） */
export { CHEM_ELEMENT_IDS }
import { CHEM_ELEMENT_IDS } from '@/utils/drawSchemaValidator'

const WRAP = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 120">${body}</svg>`

export const CHEM_ELEMENTS: ChemElement[] = [
  {
    id: 'test_tube',
    name: '试管',
    svg: WRAP(
      '<path d="M40 12v78a10 10 0 0 0 20 0V12" fill="none" stroke="#475069" stroke-width="3"/>' +
        '<path d="M34 12h32" stroke="#475069" stroke-width="4" stroke-linecap="round"/>' +
        '<path d="M43 66h14v24a7 7 0 0 1-14 0z" fill="#9fd8f0" opacity="0.8"/>',
    ),
  },
  {
    id: 'alcohol_lamp',
    name: '酒精灯',
    svg: WRAP(
      '<path d="M38 46h24l6 52a8 8 0 0 1-8 8H40a8 8 0 0 1-8-8z" fill="none" stroke="#475069" stroke-width="3"/>' +
        '<path d="M46 46V30a4 4 0 0 1 4-4h0a4 4 0 0 1 4 4v16" fill="none" stroke="#475069" stroke-width="3"/>' +
        '<path d="M50 26v-8" stroke="#475069" stroke-width="3"/>' +
        '<path d="M50 18c4-3 3-7 0-9-3 2-4 6 0 9z" fill="#f0a23c" stroke="#e07b1f" stroke-width="1.5"/>',
    ),
  },
  {
    id: 'beaker',
    name: '烧杯',
    svg: WRAP(
      '<path d="M30 22v72a8 8 0 0 0 8 8h24a8 8 0 0 0 8-8V22" fill="none" stroke="#475069" stroke-width="3"/>' +
        '<path d="M26 22h48" stroke="#475069" stroke-width="4" stroke-linecap="round"/>' +
        '<path d="M36 62h28v32a4 4 0 0 1-4 4H40a4 4 0 0 1-4-4z" fill="#9fd8f0" opacity="0.8"/>',
    ),
  },
  {
    id: 'glass_tube',
    name: '导管',
    svg: WRAP(
      '<path d="M20 30h40a14 14 0 0 1 14 14v46" fill="none" stroke="#7f9bb3" stroke-width="5" stroke-linecap="round"/>' +
        '<path d="M74 90v14" stroke="#7f9bb3" stroke-width="5" stroke-linecap="round"/>',
    ),
  },
  {
    id: 'rubber_stopper',
    name: '橡胶塞',
    svg: WRAP(
      '<path d="M34 34h32l-5 26a6 6 0 0 1-6 5H45a6 6 0 0 1-6-5z" fill="#8a5a3b" stroke="#6e452c" stroke-width="2.5"/>' +
        '<path d="M42 40h16" stroke="#6e452c" stroke-width="2"/>',
    ),
  },
  {
    id: 'gas_collect_bottle',
    name: '集气瓶',
    svg: WRAP(
      '<path d="M32 26v64a8 8 0 0 0 8 8h20a8 8 0 0 0 8-8V26" fill="none" stroke="#475069" stroke-width="3"/>' +
        '<path d="M32 66h36" stroke="#475069" stroke-width="2.5"/>' +
        '<rect x="30" y="12" width="40" height="12" rx="3" fill="none" stroke="#475069" stroke-width="3"/>',
    ),
  },
  {
    id: 'wash_bottle',
    name: '洗气瓶',
    svg: WRAP(
      '<path d="M28 34h44v58a8 8 0 0 1-8 8H36a8 8 0 0 1-8-8z" fill="none" stroke="#475069" stroke-width="3"/>' +
        '<path d="M42 34V18h8v16" fill="none" stroke="#475069" stroke-width="3"/>' +
        '<path d="M64 34V52h-8" fill="none" stroke="#475069" stroke-width="3"/>' +
        '<path d="M32 70h36v22a4 4 0 0 1-4 4H36a4 4 0 0 1-4-4z" fill="#9fd8f0" opacity="0.8"/>',
    ),
  },
]

export const CHEM_ELEMENT_MAP = new Map(CHEM_ELEMENTS.map((el) => [el.id, el]))
