/**
 * 备课文档编辑器的**扩展清单**（纸张画布 DocCanvas 与模板编辑器共用一份）。
 *
 * 抽成工厂函数而不是导出一个常量数组，只有一个原因：公式扩展的 `onClick` 必须绑定到
 * 「谁来开输入框」。这个回调属于画布实例（它持有媒体通路），不是模块级的常量 ——
 * 写成常量数组就只能让某个组件独占它，另一个组件再把整份清单抄一遍。
 *
 * 清单里的每一项都有理由，改动前先读一遍：
 * - **StarterKit**：关掉代码块与分割线（一份教案里用不到，只会让工具栏与内容模型变复杂）；
 *   有序列表与下划线换成本仓库的扩展版（多一个序号样式属性 / 修掉波浪线被解析成单下划线），
 *   同名扩展不能注册两次，所以必须在 kit 里关掉；标题开到 5 级 —— 它是左侧目录的层级来源
 *   （教案里的「一、/（一）/ 1. / (1)」四层嵌套很常见，4 级不够用）。
 * - **ResizableImage / DrawSvgImage**：与录题编辑器同一份图片与理科配图节点。
 * - **Mathematics**：公式走 Tiptap 官方扩展（KaTeX），节点内只存 data-latex，可反复回改。
 * - **TextStyle / FontFamily / FontSize / HexColor / HexBackgroundColor**：字体、字号、字色、
 *   高亮都落在**同一个** textStyle span 上（Tiptap 的 setMark 会合并 attrs）。
 *   字色与高亮换成扩展版的原因见 tiptap-extensions/color.ts（官方版读回来的是浏览器归一化的
 *   rgb(...)，与工具栏色板的 #hex 对不上，色板会永远不高亮）。
 * - **PlainUnderline**：官方 underline 会把 `text-decoration: underline wavy` 一起解析成单下划线。
 * - **DocTextAlign / DocLineHeight / SuperScript / SubScript / DocPageBreak**：Word 式排版补齐
 *   （见 tiptap-extensions/docFormat.ts）。
 * - **ListMarker / Indent**：序号样式、缩进与首行缩进。
 * - **表格四件套**：与试卷编辑用同一套扩展版 —— 整表宽度、行高、单元格底纹都要能拖能设。
 *   同名扩展不能注册两次，所以 TableKit 里对应的四项必须关掉。
 */
import StarterKit from '@tiptap/starter-kit'
import { Mathematics } from '@tiptap/extension-mathematics'
import { FontFamily, FontSize, TextStyle } from '@tiptap/extension-text-style'
import { TableKit } from '@tiptap/extension-table'
import type { Extensions } from '@tiptap/core'

import { ResizableImage } from '@/components/ui/rte/resizableImage'
import { DrawSvgImage } from '@/tiptap-extensions/drawSvgImage'
import { PlainUnderline } from '@/tiptap-extensions/underline'
import { HexColor } from '@/tiptap-extensions/color'
import { ListMarker } from '@/tiptap-extensions/listMarker'
import { Indent } from '@/tiptap-extensions/indent'
import { PaperTable, RowHeight } from '@/tiptap-extensions/tableSizing'
import { PaperTableCell, PaperTableHeader } from '@/tiptap-extensions/tableCellStyle'
import {
  DocLineHeight,
  DocPageBreak,
  DocTextAlign,
  HexBackgroundColor,
  SubScript,
  SuperScript,
} from '@/tiptap-extensions/docFormat'

/** 公式节点被点击时的回调签名（与 `Mathematics` 的 `inlineOptions.onClick` 一致） */
export type MathClickHandler = (node: { attrs: { latex?: string } }, pos: number, block: boolean) => void

/**
 * 生成备课文档编辑器的扩展数组。
 *
 * @param onMathClick 点正文里已有公式节点时开输入框（就地改）；新插入走工具栏那条通路，不经过它
 */
export function createDocExtensions(onMathClick: MathClickHandler): Extensions {
  return [
    StarterKit.configure({
      codeBlock: false,
      horizontalRule: false,
      orderedList: false,
      underline: false,
      heading: { levels: [1, 2, 3, 4, 5] },
      link: {
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
      },
    }),
    /* allowBase64: false —— 在写入侧就堵死内联 base64，保证正文只存 URL */
    ResizableImage.configure({ inline: false, allowBase64: false }),
    DrawSvgImage,
    Mathematics.configure({
      katexOptions: { throwOnError: false },
      inlineOptions: { onClick: (node, pos) => onMathClick(node, pos, false) },
      blockOptions: { onClick: (node, pos) => onMathClick(node, pos, true) },
    }),

    /* ===== Word 式排版 ===== */
    TextStyle,
    FontFamily,
    FontSize,
    HexColor,
    HexBackgroundColor,
    PlainUnderline,
    DocTextAlign,
    DocLineHeight,
    SuperScript,
    SubScript,
    DocPageBreak,
    ListMarker,
    Indent,

    /* ===== 表格 ===== */
    TableKit.configure({ table: false, tableRow: false, tableCell: false, tableHeader: false }),
    /* resizable 开列宽拖拽；最后一列不给拖（拖它只改变整表宽度，与整表手柄撞车，容易误操作） */
    PaperTable.configure({ resizable: true, lastColumnResizable: false }),
    RowHeight,
    PaperTableCell,
    PaperTableHeader,
  ]
}
