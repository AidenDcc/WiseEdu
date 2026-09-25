/**
 * 全应用唯一的 KaTeX 入口。
 *
 * mhchem 扩展（`\ce{}` 化学式/化学方程式）是「往 katex 模块实例上注册宏」的副作用式扩展：
 * 只要在应用里被 import 过一次，之后所有 katex.render / renderToString 就都认识 `\ce{}`。
 * 公式面板、公式库、富文本只读渲染、Tiptap 数学节点的 NodeView（它自己 `import katex from 'katex'`
 * 渲染）走的是同一份 pnpm 提升后的 katex，所以统一从这里引入 ——
 * 化学分类的 `\ce{...}` 才能在「面板预览 / 编辑器内 / 只读正文」三处都渲染出来，
 * 而不是在其中一处退化成红字报错。
 */
import katex from 'katex'
/* 副作用导入：注册 \ce{} 等 mhchem 宏，模块本身无导出 */
import 'katex/contrib/mhchem'

export default katex
