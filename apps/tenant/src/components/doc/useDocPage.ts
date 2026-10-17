/**
 * 「页面设置」→ 实际排版值 的解析。
 *
 * `TeachDocPage` 里存的是**档位 key**（`a4` / `normal` / `song` / `xiaosi` / `1.5`），不是展开后的
 * CSS 值；要把 key 变成画布上的 mm、pt、倍数，还要处理「旧 key 在新档位表里已不存在」的情况。
 * 这段解析同时被三处需要 —— 纸张画布（渲染）、文档编辑器（打印）、模板编辑器（预览），
 * 于是提成一个 composable，避免三份口径各算各的（纸张塌成 `undefinedmm` 这类问题极难查）。
 *
 * 入参用 getter 而不是 Ref：调用方的来源各不相同（文档的 `doc.page`、模板草稿的本地对象），
 * 传函数最省事，也跟着响应式走。
 */
import { computed } from 'vue'
import type { TeachDocPage } from '@aiteach/shared'
import {
  DOC_BODY_FONTS,
  DOC_BODY_LINE_HEIGHTS,
  DOC_BODY_SIZES,
  DOC_HEADER_POS,
  DOC_MARGINS,
  DOC_PAGE_NO_FORMATS,
  DOC_PAGE_NO_POS,
  DOC_PAPERS,
  type DocValueOption,
} from './doc-options'

export function useDocPage(getPage: () => TeachDocPage | undefined) {
  /**
   * 从档位表里取「当前档位的值」，取不到就退回默认档。
   *
   * 一定要带这个兜底：`page` 里存的是历史档位 key，档位表改过之后旧 key 可能已不存在，
   * 直接查表会得到 undefined 并让纸张宽度变成 `undefinedmm`（整张纸塌掉）。
   */
  function pick(key: keyof TeachDocPage, list: DocValueOption[], fallbackKey: string): string {
    const current = getPage()?.[key]
    const hit = list.find((row) => row.key === (current ?? fallbackKey))
    return hit?.key ?? fallbackKey
  }

  /** 纸张与页边距的档位表结构不同（不是 `DocValueOption`），各自单独兜底 */
  const paper = computed(() => {
    const current = getPage()?.paper
    return DOC_PAPERS.find((row) => row.key === current) ?? DOC_PAPERS[0]
  })
  const margin = computed(() => {
    const current = getPage()?.margin
    return DOC_MARGINS.find((row) => row.key === current) ?? DOC_MARGINS[1]
  })

  const bodyFont = computed(() => DOC_BODY_FONTS.find((row) => row.key === pick('font', DOC_BODY_FONTS, DOC_BODY_FONTS[0].key)) ?? DOC_BODY_FONTS[0])
  const bodySize = computed(
    () => DOC_BODY_SIZES.find((row) => row.key === pick('size', DOC_BODY_SIZES, DOC_BODY_SIZES[2].key)) ?? DOC_BODY_SIZES[2],
  )
  const bodyLine = computed(
    () =>
      DOC_BODY_LINE_HEIGHTS.find((row) => row.key === pick('lineHeight', DOC_BODY_LINE_HEIGHTS, DOC_BODY_LINE_HEIGHTS[2].key)) ??
      DOC_BODY_LINE_HEIGHTS[2],
  )

  /** 页边距的毫米数（用在纸张内边距与打印的 `@page margin` 上，两处必须是同一个数） */
  const marginMm = computed(() => margin.value.value)

  /**
   * 每页可放内容的毫米数（页心高）。
   *
   * 分页引擎（doc-paginate.ts）按它决定「一个块还塞不塞得下」，界面上的纸张尺寸也按它排 ——
   * 两个数必须是同一个来源，否则会出现「屏幕上是 4 页、打印出来是 5 页」。
   */
  const contentHeightMm = computed(() => Math.max(0, paper.value.height - marginMm.value * 2))

  /* ===== 页眉 / 页脚 / 页码 =====
     都从 `page` 里读，缺省值就是「Word 默认」：无页眉、无页脚文字、显示页码、页眉带分隔线。
     页眉文字为空时不显示 —— 「空字符串」与「没设过」在观感上是同一件事，不必区分。 */
  const header = computed(() => (getPage()?.header ?? '').trim())
  const footer = computed(() => (getPage()?.footer ?? '').trim())
  const showPageNo = computed(() => getPage()?.pageNo ?? true)
  const headerRule = computed(() => getPage()?.headerRule ?? true)

  /* ===== 页码的格式与位置 =====
     两个都存档位 key，取不到时退回第一档 / 右侧 —— 与其余页面设置同一套兜底方式
     （旧文档没有这两个字段，一律按「第 n 页 / 共 m 页」印在页脚右侧，与改造前完全一致）。 */
  const pageNoFormat = computed(() => {
    const current = getPage()?.pageNoFormat
    return (DOC_PAGE_NO_FORMATS.find((row) => row.key === current) ?? DOC_PAGE_NO_FORMATS[0]).key
  })
  const pageNoPos = computed(() => {
    const current = getPage()?.pageNoPos
    return (DOC_PAGE_NO_POS.find((row) => row.key === current) ?? DOC_PAGE_NO_POS[2]).key
  })

  /**
   * 页眉位置：缺省居中。
   *
   * 改造前页眉是写死的 `text-align: center`，老文档没有这个字段，一律按居中渲染 ——
   * 不能让「加了一个位置选项」把存量文档的页眉挪到左边去。
   */
  const headerPos = computed(() => {
    const current = getPage()?.headerPos
    return (DOC_HEADER_POS.find((row) => row.key === current) ?? DOC_HEADER_POS[1]).key
  })

  /**
   * 页码文字。**屏幕与打印必须同一份实现** —— 页码是最容易被「两处各写一遍」写歪的东西，
   * 所以展开规则只放在这里。
   */
  function pageNoText(page: number, total: number): string {
    switch (pageNoFormat.value) {
      case 'zh-simple':
        return `第 ${page} 页`
      case 'num-total':
        return `${page} / ${total}`
      case 'dash':
        return `- ${page} -`
      case 'num':
        return `${page}`
      default:
        return `第 ${page} 页 / 共 ${total} 页`
    }
  }

  /**
   * 纸张样式。
   *
   * 正文基线（字体 / 字号 / 行距）写在纸张上而不是正文节点上：这几个属性都是继承的，挂在纸张上
   * 即成为**整篇的默认值**，而段落上单独设过的内联样式优先级更高、自动覆盖它 —— 这正是 Word 里
   * 「正文样式 + 局部改格式」的同一套层级关系，不必自己写覆盖逻辑。
   *
   * @param zoomPercent 屏幕缩放百分比（只影响屏幕，不影响打印）
   */
  function paperStyle(zoomPercent = 100) {
    return {
      width: `${paper.value.width}mm`,
      minHeight: `${paper.value.height}mm`,
      padding: `${marginMm.value}mm`,
      fontFamily: bodyFont.value.value ?? undefined,
      fontSize: bodySize.value.value ?? undefined,
      lineHeight: bodyLine.value.value ?? undefined,
      zoom: zoomPercent / 100,
    }
  }

  /**
   * 打印用的样式表。
   *
   * 打印走的是「临时 iframe 里写一份独立 HTML」，所以这里要给出完整的正文样式，
   * 而不是依赖页面上的那份 —— 顺带把纸张参数（`@page size / margin`）与正文基线抄进去，
   * 让打印结果与屏幕上看到的一致。
   */
  function printCss(): string {
    return `
    @page { size: ${paper.value.key === 'b5' ? 'B5' : 'A4'}; margin: ${marginMm.value}mm; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: ${bodyFont.value.value ?? 'serif'}; font-size: ${bodySize.value.value ?? '12pt'}; line-height: ${bodyLine.value.value ?? '1.5'}; color: #000; }
    .rte-content { text-underline-offset: 0.2em; }
    .rte-content p { margin: 0 0 6px; }
    .rte-content h1 { font-size: 1.7em; text-align: center; margin: 0 0 14px; }
    .rte-content h2 { font-size: 1.35em; margin: 16px 0 8px; }
    .rte-content h3 { font-size: 1.15em; margin: 12px 0 6px; }
    .rte-content h4 { font-size: 1.05em; margin: 10px 0 6px; }
    .rte-content h5 { font-size: 1em; font-weight: 700; margin: 8px 0 5px; }
    /* 屏幕上的分页垫片是视图层的记号，打印时要整段消失 —— 打印由 @page 自己分页 */
    .doc-page-gap { display: none !important; }
    .rte-content ul, .rte-content ol { padding-left: 24px; margin: 0 0 6px; }
    .rte-content img { max-width: 100%; height: auto; }
    .rte-content table { border-collapse: collapse; width: 100%; table-layout: fixed; }
    .rte-content td, .rte-content th { border: 1px solid #999; padding: 4px 8px; vertical-align: top; }
    .rte-content th { background: #f2f2f2; }
    .rte-content blockquote { border-left: 3px solid #ccc; padding-left: 10px; margin: 0 0 6px; }
    /* 分页符在纸面上是一条虚线记号，打印时必须换成真正的换页，且记号本身不能印出来 */
    .rte-content [data-type='page-break'] { break-after: page; page-break-after: always; border: 0; height: 0; margin: 0; }
    .rte-content [data-type='page-break']::after { content: none; }
    .rte-content [data-type='inline-math'] { display: inline-block; }
    .rte-content [data-type='block-math'] { display: block; text-align: center; margin: 8px 0; }
  `
  }

  return {
    paper,
    margin,
    marginMm,
    contentHeightMm,
    header,
    footer,
    showPageNo,
    pageNoFormat,
    pageNoPos,
    pageNoText,
    headerPos,
    headerRule,
    bodyFont,
    bodySize,
    bodyLine,
    paperStyle,
    printCss,
  }
}
