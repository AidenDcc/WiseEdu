/**
 * 列表展示方式（表格 / 详细）的本地记忆。
 *
 * 同一份列表反复进出、或在页签间来回切时，要停在上次看的那种方式：题库管理选了「详细」，
 * 下次进来仍是详细，不必每次重选。纯前端偏好，**只写浏览器 localStorage**，
 * 不落服务端 —— 登录别的设备时回到默认值，是可接受的取舍，省一套偏好接口。
 *
 * `key` 必须每个列表唯一：试卷库切了「详细」不该把试题页也带成详细；同一列表跨页签
 * （如组卷工作台的试题 / 试卷）则各记各的 —— 它们的列结构本就不同。
 */
import { shallowRef, watch, type Ref } from 'vue'
import { getAppConfig } from '@aiteach/shared'

const prefix = `aiteach:${getAppConfig().appName}:view-mode:`

/**
 * 读取并持续记忆某个列表的展示方式。
 *
 * `allowed` 兼作校验白名单：缓存里可能是旧版本遗留的取值（如已删掉的 `'grid'`），
 * 不在白名单内就回落到 `fallback`，避免页面渲染到一个不存在的分支。
 */
export function useViewMode<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): Ref<T> {
  const storageKey = prefix + key
  let saved: string | null = null
  /* 隐私模式 / 禁用存储时 localStorage 会抛异常：降级为「不记忆」，列表本身照常可用 */
  try {
    saved = localStorage.getItem(storageKey)
  } catch {
    saved = null
  }

  const initial: T = saved !== null && (allowed as readonly string[]).includes(saved) ? (saved as T) : fallback
  /* 取值是字符串字面量，无深层响应式需求；用 shallowRef 才能干净保住泛型 T（ref 会被 UnwrapRef 揉成 string） */
  const mode: Ref<T> = shallowRef(initial)

  watch(mode, (value) => {
    try {
      localStorage.setItem(storageKey, value)
    } catch {
      /* 同上：写不进就算了，不影响本次会话内的切换 */
    }
  })

  return mode
}
