/**
 * 可拖拽改尺寸的图片节点。
 *
 * 从 RichTextEditor.vue 里整段搬出来（那里原本是内联定义），因为它现在有**两个使用者**：
 * 录题编辑器与备课文档编辑器。放在组件里就只能复制一份，而这段代码里攒着几条踩过坑的约束
 * （见下），复制出去必然只剩一份被维护。
 *
 * 两个关键点：
 * 1. **地址还原走 NodeView 而不是 renderHTML**。正文里存的是 `/api/tenant/media/12/raw` 这类
 *    规范地址，浏览器直接请求拿不到字节（mock 阶段没有托管服务），编辑器内因此渲染成破图。
 *    换地址这件事只能发生在显示层 —— `getHTML()` 走的就是 renderHTML，在那里换地址会把
 *    data URL 写进存储，正文就不再是「只存 URL」了。
 * 2. **缩放**：四角 + 四边共八个控制点，松手写回节点的 width / height 属性，
 *    存下来是 `<img src="…" width="320" height="180">` —— 只读渲染端（RichTextViewer）靠属性
 *    就能还原尺寸，不需要知道编辑器里发生过什么。
 *
 * 方向语义：四角拖 = 等比缩放（几何图、照片不被拉变形）；四边中点拖 = 单向拉伸 ——
 * 水平边只改宽、垂直边只改高（裁掉 AI 配图多余的留白）。等比锁不是全局开关，
 * 而是每次拖拽开始时按把手方向切换（见下方对 handleResizeStart 的实例级遮蔽）。
 */
import { ResizableNodeView } from '@tiptap/core'
import { Image } from '@tiptap/extension-image'
import { resolveMediaSrc } from '@aiteach/shared'

/** 拖拽的最小边长：再小控制点就糊成一个点，也失去了「缩回去」的手感 */
export const MIN_IMAGE_PX = 40

export const ResizableImage = Image.extend({
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const el = document.createElement('img')

      /** DOM 与节点属性对齐：初始渲染与每次 update 都走这里，撤销 / 重做才带得回旧尺寸 */
      const paint = (attrs: Record<string, unknown>) => {
        const src = String(attrs.src ?? '')
        if (src) el.src = resolveMediaSrc(src)
        if (attrs.alt) el.alt = String(attrs.alt)
        if (attrs.title) el.title = String(attrs.title)
        /* 没有 width 就清掉内联尺寸，退回 CSS 的 max-width: 100% 自适应 */
        el.style.width = attrs.width ? `${attrs.width}px` : ''
        el.style.height = attrs.height ? `${attrs.height}px` : ''
      }
      paint(node.attrs)

      const view = new ResizableNodeView({
        element: el,
        editor,
        node,
        getPos,
        /* 拖拽过程只动 DOM，松手才写节点：逐帧 updateAttributes 会把撤销栈切成几百步 */
        onResize: (width, height) => {
          el.style.width = `${width}px`
          el.style.height = `${height}px`
        },
        onCommit: (width, height) => {
          const pos = getPos()
          if (pos === undefined) return
          /* 先选中再写属性：松手后控制点不消失，可以接着微调 */
          editor.chain().setNodeSelection(pos).updateAttributes(node.type.name, { width, height }).run()
        },
        onUpdate: (updated) => {
          if (updated.type !== node.type) return false
          paint(updated.attrs)
          return true
        },
        options: {
          directions: ['top-left', 'top', 'top-right', 'left', 'right', 'bottom-left', 'bottom', 'bottom-right'],
          min: { width: MIN_IMAGE_PX, height: MIN_IMAGE_PX },
          /* 全局等比锁关闭（否则边中点也变成等比，单向拉伸就失效了）；按下面对
             handleResizeStart 的遮蔽，在每次拖拽开始时按把手方向重新设定 */
          preserveAspectRatio: false,
        },
      })

      /* preserveAspectRatio 是拖拽期间实时读取的实例属性，而方向只有拖拽开始那一刻可知，
         库又没有提供按方向配置的口子 —— 实例级遮蔽私有方法（运行时即普通原型方法，
         赋值成自有属性后库的监听闭包读到的就是这里设定的值）。d.ts 标了 private，故做一次类型断言。 */
      const patch = view as unknown as {
        handleResizeStart: (event: MouseEvent | TouchEvent, direction: string) => void
      }
      const protoStart = patch.handleResizeStart
      patch.handleResizeStart = (event, direction) => {
        view.preserveAspectRatio = direction.includes('-')
        protoStart.call(view, event, direction)
      }

      return view
    }
  },
})
