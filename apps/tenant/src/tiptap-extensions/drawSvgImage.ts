/**
 * Tiptap 自定义节点 draw-svg-image（规格模块 9）。
 *
 * 静态 SVG 配图节点：属性携带 media_id 与 svg_oss_url，渲染为图片；
 * 双击节点 → 通过 editor.storage 上的回调交回 RichTextEditor，
 * 由它按 media_id 取 media 记录（editor_type + project_json / molfile_text）
 * 唤起对应绘图编辑器二次编辑 —— 不从 SVG 反解析工程。
 *
 * 正文序列化形态：<img data-draw-media-id="12" src="…" alt="…">，
 * RichTextViewer 等只读端按普通 img 渲染即可。
 */
import { Node, mergeAttributes } from '@tiptap/core'
import { resolveMediaSrc } from '@aiteach/shared'

export const DrawSvgImage = Node.create({
  name: 'drawSvgImage',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      mediaId: { default: null },
      svgUrl: { default: '' },
      alt: { default: '' },
      width: { default: null },
    }
  },

  parseHTML() {
    return [{ tag: 'img[data-draw-media-id]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'img',
      mergeAttributes(HTMLAttributes, {
        'data-draw-media-id': HTMLAttributes.mediaId,
        src: HTMLAttributes.svgUrl,
      }),
    ]
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const el = document.createElement('img')
      el.setAttribute('data-draw-media-id', String(node.attrs.mediaId ?? ''))
      el.style.maxWidth = '100%'
      el.style.borderRadius = '8px'
      el.title = '双击可重新编辑配图'

      const paint = (attrs: Record<string, unknown>) => {
        const src = String(attrs.svgUrl ?? '')
        if (src) el.src = resolveMediaSrc(src)
        el.alt = String(attrs.alt ?? '理科配图')
        el.style.width = attrs.width ? `${attrs.width}px` : ''
      }
      paint(node.attrs)

      el.addEventListener('dblclick', () => {
        const pos = getPos?.()
        const mediaId = Number(node.attrs.mediaId)
        if (pos != null && mediaId) {
          /* RichTextEditor 在 editor.storage 上挂的回调（见该组件内的挂载点） */
          const onEdit = (editor.storage as unknown as Record<string, unknown>).drawSvgImageOnEdit as
            | ((mediaId: number, pos: number) => void)
            | undefined
          onEdit?.(mediaId, pos)
        }
      })

      return {
        dom: el,
        update(updated) {
          if (updated.type.name !== 'drawSvgImage') return false
          paint(updated.attrs)
          return true
        },
      }
    }
  },
})
