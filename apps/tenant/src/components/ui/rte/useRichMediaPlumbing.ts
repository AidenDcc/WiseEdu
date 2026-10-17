/**
 * 富文本编辑器「公式 / 图片 / 理科配图」三条媒体通路的公共实现。
 *
 * 录题编辑器（RichTextEditor）与备课文档编辑器（doc/DocEditor）在这三件事上**行为必须完全一致**：
 * 公式都走「贴光标的轻量输入框 → 需要符号库再跳大弹窗」两级通路，图片都先落 Mock 媒体库再插 URL
 * （正文里不内联 base64），配图都是「选类型 → 画布 → 导出 SVG 节点」。过去这三段只存在于录题编辑器里，
 * 文档编辑器要再用一遍就只能复制 —— 复制的结果是「两个编辑器里同一个按钮的手感慢慢不一样」，
 * 所以抽到这里，由两个编辑器共用一份。
 *
 * 组件宿主不在这里：这些通路要开的五个弹窗由 `RichMediaDialogs.vue` 统一渲染（本文件只产出状态），
 * 于是「谁在用」与「用了什么形状的弹窗」互不牵制。
 *
 * 两处刻意用 getter 而不是 Ref：
 * - `getEditor`：Tiptap 的扩展 options 必须**先于实例创建**传进去（公式节点的 onClick 就写在里面），
 *   而实例要到 `useEditor()` 之后才有值。传 getter，事件触发时再取值，初始化顺序就不成问题了。
 * - `getSubject`：学科在父组件里是可变的 prop（切科目重挂），传函数才拿得到当前值。
 */
import { ref } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import { Selection } from '@tiptap/pm/state'
import { showToast } from '@aiteach/shared'
import type { DrawEditorType, OrgMedia } from '@aiteach/shared'
import { fetchMediaDetail, uploadMedia } from '@/api/org'

export interface RichMediaPlumbingOptions {
  /** 取编辑器实例（见文件头注释：必须用 getter，不能用 Ref） */
  getEditor: () => Editor | undefined
  /** 当前学科（图片入库 / 公式库筛选） */
  getSubject: () => string
  /** 根元素是否含有焦点。录题编辑器的工具栏在根容器内、点按钮时 ProseMirror 已失焦，需要这一条兜住 */
  isFocused?: () => boolean
  /** 上传本地图片时的兜底文件名（各编辑器的语义不同：「题目插图」/「文档插图」） */
  imageName?: string
}

/**
 * 内联输入框的一次会话（浮层自己不带文档状态，这里记「贴哪个位置、初始源码、什么模式」）。
 * `editPos` 非 null 表示在改已有的公式节点 —— 同一个浮层既要能新插，也要能就地改。
 */
export interface InlineMathAnchor {
  /** 浮层贴哪个文档位置：新插入时是落点，编辑已有节点时是节点位置 */
  pos: number
  latex: string
  block: boolean
  /** 非 null = 在改这个位置的已有公式节点；null = 新插入 */
  editPos: number | null
}

/** 理科配图画布的宿主状态 */
export interface DrawHostState {
  editorType: DrawEditorType
  mediaId?: number
  projectJson?: string
  molfileText?: string
  /** 非空表示在二次编辑既有节点（值为节点位置），保存后更新节点而不是新插 */
  editPos?: number
}

export function useRichMediaPlumbing(options: RichMediaPlumbingOptions) {
  const { getEditor, getSubject, isFocused, imageName = '插图.png' } = options

  /* ================= 公式落点：内联输入框与公式编辑器弹窗共用的唯一出口 ================= */

  /** 插入锚点：编辑器里有光标就用当前选区起点；没有光标（从未聚焦过）就追加到文档末尾 */
  function resolveInsertPos(): number {
    const instance = getEditor()
    if (!instance) return 1
    if (!instance.isFocused && !isFocused?.()) return Selection.atEnd(instance.state.doc).from
    return instance.state.selection.from
  }

  /** 锚点用前夹一次：浮层开着时若文档被别处改短（AI 回填等），原位置可能已越界 */
  function clampPos(pos: number): number {
    const instance = getEditor()
    if (!instance) return pos
    const max = Math.max(1, instance.state.doc.content.size - 1)
    return Math.max(1, Math.min(pos, max))
  }

  /**
   * 落公式的唯一出口 —— 内联输入框和公式编辑器弹窗都走这里，不各写一份。
   *
   * @param editPos   非 null 时改这个位置的已有公式节点
   * @param insertPos 新插入时的落点；null 表示交给当前选区
   */
  function placeMath(latex: string, block: boolean, editPos: number | null, insertPos: number | null) {
    const instance = getEditor()
    if (!instance) return

    if (editPos !== null) {
      const node = instance.state.doc.nodeAt(editPos)
      if (!node) {
        showToast('公式已不在原位置，请重新编辑', 'error')
        return
      }
      /* 模式没变：原地改 attrs 就够（扩展的 update* 会自己校验节点类型，pos 必须显式给 ——
         不给的话它回退到 selection.$from.pos，而此刻焦点在浮层里，选区已不代表用户看着的位置） */
      if (block === (node.type.name === 'blockMath')) {
        const ok = block
          ? instance.chain().focus().updateBlockMath({ latex, pos: editPos }).run()
          : instance.chain().focus().updateInlineMath({ latex, pos: editPos }).run()
        if (!ok) showToast('公式更新失败，请删除后重新插入', 'error')
        return
      }
      /* 行内 ↔ 独立：节点类型都换了，update* 改不了，只能把这个节点整个换掉 */
      const chain = instance.chain().focus().deleteRange({ from: editPos, to: editPos + node.nodeSize })
      const swapped = block
        ? chain.insertBlockMath({ latex, pos: editPos }).run()
        : chain.insertInlineMath({ latex, pos: editPos }).run()
      if (!swapped) showToast('公式更新失败，请删除后重新插入', 'error')
      return
    }

    const target = insertPos === null ? null : clampPos(insertPos)
    const chain = instance.chain().focus()
    const ok =
      target === null
        ? (block ? chain.insertBlockMath({ latex }) : chain.insertInlineMath({ latex })).run()
        : (block ? chain.insertBlockMath({ latex, pos: target }) : chain.insertInlineMath({ latex, pos: target })).run()
    if (!ok) showToast('公式插入失败，请重试', 'error')
  }

  /* ===== 内联公式输入框（「插入公式」与「改已有公式」的默认通路） =====
     贴光标开一个轻量输入框：敲 LaTeX → 失焦 / 回车即落成正文里的公式节点。
     浮层本身不落文档（见 FormulaInlineInput 的注释），所以这里只保管「会话 + 开闭」。 */
  const inlineMath = ref<InlineMathAnchor | null>(null)
  /** 作为子组件的 key：每开一次自增，强制重挂以重新定位 */
  const inlineMathSession = ref(0)

  /** 工具栏「插入公式」：贴光标开一个空的轻量输入框 */
  function openMathInsert() {
    const instance = getEditor()
    if (!instance) return
    inlineMath.value = null
    /* 每次自增 → 子组件按 key 重挂：再点一次「公式」是「重新贴当前光标开一个」，而不是沿用旧锚点 */
    inlineMathSession.value += 1
    inlineMath.value = { pos: resolveInsertPos(), latex: '', block: false, editPos: null }
  }

  /**
   * 点正文里已有的公式节点：就地开内联输入框改。
   * 以前这里是直接弹公式编辑器面板，可「改个系数也要过一遍 920px 的大弹窗」太重了；
   * 确实需要符号库 / 公式库时，再从输入框下拉里点「公式编辑器」，源码会一起带过去。
   */
  function openMathEdit(node: { attrs: { latex?: string } }, pos: number, block: boolean) {
    inlineMath.value = null
    inlineMathSession.value += 1
    inlineMath.value = { pos, latex: node.attrs.latex ?? '', block, editPos: pos }
  }

  function onInlineInsert(latex: string, block: boolean) {
    const anchor = inlineMath.value
    inlineMath.value = null
    if (!anchor) return
    /* 编辑已有节点时落点就是节点位置，不能再夹取 —— 一夹就可能贴到隔壁节点上 */
    placeMath(latex, block, anchor.editPos, anchor.editPos === null ? anchor.pos : null)
  }

  /* ===== 公式编辑器弹窗 =====
     工具栏的「插入公式」和点正文里已有的公式，默认都是**就地**开内联输入框；
     这个大弹窗只在「内联输入框 → 下拉 → 公式编辑器」这条回跳里出现。 */
  const mathOpen = ref(false)
  /** 弹窗在改哪个已有公式节点（null = 新插入） */
  const mathEditingPos = ref<number | null>(null)
  /** 打开弹窗时公式原本是块级还是行内 —— 决定弹窗里插入方式的初始态 */
  const mathEditingBlock = ref(false)
  const mathInitialLatex = ref('')
  /** 弹窗路径的新插入落点（null 表示退回当前选区） */
  const mathInsertPos = ref<number | null>(null)
  /** 弹窗若由内联输入框跳来，记下那个会话：取消时把草稿原样还原回内联框（见 onMathClose） */
  const mathInlineAnchor = ref<InlineMathAnchor | null>(null)

  /**
   * 下拉里的「公式编辑器」：关掉轻量输入框，交给弹窗接管。
   * 已敲的源码、锚点、以及「是不是在改已有节点」一并带过去 ——
   * 写了一半再开面板，不该从头开始，也不该从「就地改」变成「旁边又插一个」。
   */
  function onInlineOpenEditor(latex: string, block: boolean) {
    const anchor = inlineMath.value
    inlineMath.value = null
    mathEditingPos.value = anchor?.editPos ?? null
    mathEditingBlock.value = block
    mathInitialLatex.value = latex
    mathInsertPos.value = anchor && anchor.editPos === null ? anchor.pos : null
    /* 记住这一趟是从内联输入框来的：弹窗被取消时好把草稿还回去 */
    mathInlineAnchor.value = anchor ? { ...anchor, block } : null
    mathOpen.value = true
  }

  function onMathConfirm(latex: string, block: boolean) {
    const editPos = mathEditingPos.value
    const insertPos = mathInsertPos.value
    mathOpen.value = false
    mathEditingPos.value = null
    mathInsertPos.value = null
    mathInlineAnchor.value = null
    placeMath(latex, block, editPos, editPos === null ? insertPos : null)
  }

  /**
   * 关掉公式编辑器弹窗。
   * 若这趟是从内联输入框跳过来的（mathInlineAnchor 有值），把弹窗里的草稿原样装回内联框：
   * 用户在面板里改过源码又反悔，不该连原来敲的一半也一起丢掉。
   */
  function onMathClose(draft?: { latex: string; block: boolean }) {
    mathOpen.value = false
    mathEditingPos.value = null
    mathInsertPos.value = null
    const anchor = mathInlineAnchor.value
    mathInlineAnchor.value = null
    if (!anchor) return
    inlineMathSession.value += 1
    inlineMath.value = {
      ...anchor,
      latex: draft?.latex ?? mathInitialLatex.value,
      block: draft?.block ?? anchor.block,
    }
  }

  /* ================= 图片：选库 / 传本地 / 粘贴 / 拖拽四条入口，统一走 uploadImage ================= */
  const imageOpen = ref(false)
  const MAX_IMAGE_MB = 2

  function readAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error('读取图片失败'))
      reader.readAsDataURL(file)
    })
  }

  /** 四条入口（工具栏 / 媒体库 / 粘贴 / 拖入）共用的唯一落库实现，校验只此一份 */
  async function uploadImage(file: File) {
    const instance = getEditor()
    if (!instance) return
    if (!file.type.startsWith('image/')) {
      showToast('仅支持插入图片文件', 'error')
      return
    }
    if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
      showToast(`图片需小于 ${MAX_IMAGE_MB}MB，请压缩后重试`, 'error')
      return
    }
    try {
      const dataUrl = await readAsDataUrl(file)
      /* 落到 Mock 媒体库：正文里只引用返回的 URL，「多媒体资源」同时多出一条 image 记录 */
      const media = await uploadMedia({
        name: file.name || imageName,
        kind: 'image',
        subject: getSubject() || '通用',
        knowledge: [],
        dataUrl,
        mime: file.type,
        sizeMb: Math.round((file.size / 1024 / 1024) * 100) / 100,
      })
      if (!media.url) {
        showToast('图片已上传但未取得地址，请重试', 'error')
        return
      }
      instance.chain().focus().setImage({ src: media.url, alt: media.name, title: media.name }).run()
      showToast('图片已插入，并存入图片资源', 'success')
    } catch {
      showToast('图片上传失败', 'error')
    }
  }

  function pickImage() {
    imageOpen.value = true
  }

  /** 从系统图片库选中一张：地址已由媒体库给出，直接落节点 */
  function onPickMedia(media: OrgMedia) {
    imageOpen.value = false
    const instance = getEditor()
    if (!instance || !media.url) return
    instance.chain().focus().setImage({ src: media.url, alt: media.name, title: media.name }).run()
    showToast('已插入图片', 'success')
  }

  /** 弹窗里选了本地文件：上传仍由 uploadImage 独家负责，避免第二份大小 / 类型校验 */
  function onPickFile(file: File) {
    imageOpen.value = false
    void uploadImage(file)
  }

  /** 从剪贴板 / 拖拽事件里取图片文件 */
  function imageFromDataTransfer(dt: DataTransfer | null): File | null {
    if (!dt) return null
    for (const file of Array.from(dt.files)) {
      if (file.type.startsWith('image/')) return file
    }
    return null
  }

  /* ================= 理科配图：选择类型 → 编辑器；AI 草稿先校验再进画布；双击节点二次编辑 ================= */
  const drawSelectOpen = ref(false)
  const aiDrawOpen = ref<DrawEditorType | null>(null)
  const drawHost = ref<DrawHostState | null>(null)

  function openDrawSelect() {
    drawSelectOpen.value = true
  }

  function onDrawManual(type: DrawEditorType) {
    drawSelectOpen.value = false
    drawHost.value = { editorType: type }
  }

  function onDrawAi(type: DrawEditorType) {
    drawSelectOpen.value = false
    aiDrawOpen.value = type
  }

  function onDrawDraft(payload: { editorType: DrawEditorType; projectJson?: string; molfileText?: string }) {
    aiDrawOpen.value = null
    drawHost.value = { ...payload }
  }

  /** 宿主确认导出后：新图插入光标处；二次编辑则原位更新节点的 SVG */
  function onDrawSaved(media: OrgMedia) {
    const instance = getEditor()
    const host = drawHost.value
    drawHost.value = null
    if (!instance || !media.url) return
    if (host?.editPos != null) {
      instance
        .chain()
        .setNodeSelection(host.editPos)
        .updateAttributes('drawSvgImage', { svgUrl: media.url, alt: media.name })
        .run()
      showToast('配图已更新', 'success')
    } else {
      instance
        .chain()
        .focus()
        .insertContent({
          type: 'drawSvgImage',
          attrs: { mediaId: media.id, svgUrl: media.url, alt: media.name },
        })
        .run()
      showToast('理科配图已插入', 'success')
    }
  }

  /** draw-svg-image 节点双击：读 media 记录唤起对应编辑器（工程数据重开，不从 SVG 反解析） */
  async function onDrawNodeEdit(mediaId: number, pos: number) {
    try {
      const media = await fetchMediaDetail(mediaId)
      drawHost.value = {
        editorType: media.editorType ?? 'fabric-general',
        mediaId: media.id,
        editPos: pos,
      }
    } catch {
      showToast('配图工程读取失败，无法二次编辑', 'error')
    }
  }

  /**
   * 把「双击配图节点 → 二次编辑」挂到编辑器实例上。
   *
   * `draw-svg-image` 的 NodeView 不能直接 import 到编辑器里（会形成循环依赖），
   * 所以它经 `editor.storage` 取这个回调 —— 消费方在实例就绪后调一次本方法即可。
   */
  function attachEditor(instance: Editor | undefined) {
    if (!instance) return
    ;(instance.storage as unknown as Record<string, unknown>).drawSvgImageOnEdit = (mediaId: number, pos: number) => {
      void onDrawNodeEdit(mediaId, pos)
    }
  }

  return {
    /* 公式 */
    inlineMath,
    inlineMathSession,
    mathOpen,
    mathEditingPos,
    mathEditingBlock,
    mathInitialLatex,
    openMathInsert,
    openMathEdit,
    onInlineInsert,
    onInlineOpenEditor,
    onMathConfirm,
    onMathClose,
    resolveInsertPos,
    placeMath,
    /* 图片 */
    imageOpen,
    pickImage,
    uploadImage,
    onPickMedia,
    onPickFile,
    imageFromDataTransfer,
    /* 理科配图 */
    drawSelectOpen,
    aiDrawOpen,
    drawHost,
    openDrawSelect,
    onDrawManual,
    onDrawAi,
    onDrawDraft,
    onDrawSaved,
    onDrawNodeEdit,
    /* 实例挂钩 */
    attachEditor,
  }
}

export type RichMediaPlumbing = ReturnType<typeof useRichMediaPlumbing>
