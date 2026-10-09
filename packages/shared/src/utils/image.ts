/**
 * 本地图片 → data URL 的通用处理（纯浏览器 API，不引图片库）。
 *
 * 目前唯一的调用方是两端个人中心的头像上传。与机构端 `api/ai-photo.ts` 的
 * `fileToDataUrl` 的区别：那个是给多模态模型看的（长边 1568px、铺白底、一律 JPEG），
 * 这里是给人看的头像（**居中裁正方形**、256px、原格式有透明就保透明）。
 * 两者目标不同，不合并 —— 合并后必然要给「是否裁切」「是否铺底」加开关。
 */

/** 头像可接受的文件体积上限（MB）。再大就不是头像了，解码也白等 */
export const MAX_AVATAR_FILE_MB = 8

/** 头像落盘边长（px）。256 在高分屏上放到 56px 的框里仍然清晰 */
export const AVATAR_SIZE = 256

/* 只收静止位图：GIF 截首帧做头像没有意义，SVG 则要防外部实体，一律挡在门外。
   提示语里的格式清单就是这一行，改这里记得跟着改那句中文。 */
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

/** 选中的文件是不是可用的图片（类型判断，不看扩展名 —— 扩展名是可以随便改的） */
export function isAvatarFile(file: File): boolean {
  return ACCEPTED_TYPES.includes(file.type)
}

/**
 * 图片文件 → 正方形 data URL：**居中裁切**后缩放到 `size × size`。
 *
 * 居中裁切而不是拉伸：头像框是正方形，拉成正方形会把脸压扁；居中裁至少保住主体
 * （演示阶段够用，真要做拖拽取景得另配一个裁剪弹层）。
 *
 * 输出格式跟着源格式走：源图是 PNG / WebP 就出 PNG（保住透明底，平台 Logo 这类图
 * 不能铺白底），JPEG 源出 JPEG —— 照片用 PNG 编码体积会翻好几倍。
 */
export async function fileToSquareDataUrl(file: File, size: number = AVATAR_SIZE): Promise<string> {
  if (!isAvatarFile(file)) throw new Error('请选择 JPG / PNG / WebP 格式的图片')
  if (file.size > MAX_AVATAR_FILE_MB * 1024 * 1024) {
    throw new Error(`图片体积不能超过 ${MAX_AVATAR_FILE_MB}MB`)
  }

  const objectUrl = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('图片解码失败，请换一张'))
      img.src = objectUrl
    })

    const side = Math.min(image.width, image.height)
    if (!side) throw new Error('图片尺寸异常，请换一张')
    /* 小图不放大：放大只是在插值，不会多出细节，还白白撑大 data URL */
    const target = Math.min(size, side)

    const canvas = document.createElement('canvas')
    canvas.width = target
    canvas.height = target
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('当前浏览器不支持图片处理')
    ctx.imageSmoothingQuality = 'high'
    /* 从原图中心取一个 side×side 的方框，再画满整块画布 */
    ctx.drawImage(
      image,
      Math.round((image.width - side) / 2),
      Math.round((image.height - side) / 2),
      side,
      side,
      0,
      0,
      target,
      target,
    )
    return file.type === 'image/jpeg' ? canvas.toDataURL('image/jpeg', 0.9) : canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
