/**
 * 用户自定义头像（本地覆盖值，演示阶段用）。
 *
 * **为什么单独存一份、而不是只塞进会话缓存**：会话是固定 30 分钟、到点即清，
 * 头像属于「个人资料」而不是「凭据」，登出后重登不该变回默认的字母头像。
 * 这里按端存成一张映射表（`aiteach:<app>:avatars`），与会话缓存互不影响。
 *
 * **owner 由调用方定义**，两端取的键不同，因为「头像属于谁」这件事两端的口径不同：
 * - 管理端：账号名（`account`）—— 一个账号一个人；
 * - 机构端：演示身份的角色值（`orgAdmin` / `leader` / `teacher`）—— 三个身份共用
 *   `orgadmin` 这一个登录账号，按账号存会让「切到王静还顶着陈明远的照片」。
 *
 * 接真实后端后本模块整体废弃：头像存 `sys_user.avatar`（JeecgBoot 自带字段），
 * 上传走文件服务，不再需要前端本地兜底。
 */
import { getAvatarStoreKey } from '../config'

/** 头像体积上限（data URL 字符串长度）。超过就当存储写坏了，读的时候丢掉 */
const MAX_STORED_LENGTH = 400_000

type AvatarMap = Record<string, string>

function readStore(): AvatarMap {
  const raw = localStorage.getItem(getAvatarStoreKey())
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    /* 逐项校验：localStorage 里的东西可能是上一版写的、也可能是人手改过的，
       混进非字符串会让 <img src> 渲染出一堆看不懂的请求 */
    return Object.fromEntries(
      Object.entries(parsed as AvatarMap).filter(
        ([, value]) => typeof value === 'string' && value.startsWith('data:image/') && value.length <= MAX_STORED_LENGTH,
      ),
    )
  } catch {
    return {}
  }
}

/** 某个归属的自定义头像（data URL）；没设置过返回空串（调用方回落到字母头像） */
export function getAvatarOverride(owner: string): string {
  return readStore()[owner] ?? ''
}

/**
 * 写入 / 清除某个归属的头像（`null` 表示恢复默认字母头像）。
 *
 * 存不下（多半是配额满了）时抛出可直接展示的错误：静默失败会让人以为上传成功了，
 * 刷新后头像却没了。
 */
export function setAvatarOverride(owner: string, dataUrl: string | null): void {
  const map = readStore()
  if (dataUrl) map[owner] = dataUrl
  else delete map[owner]
  try {
    localStorage.setItem(getAvatarStoreKey(), JSON.stringify(map))
  } catch {
    throw new Error('本地存储空间不足，头像未能保存')
  }
}
