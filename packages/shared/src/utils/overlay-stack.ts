/** 全局浮层栈：AppModal / AppConfirm 共用。
 *
 * 每个浮层实例各自在 document 上监听 keydown，若不仲裁，「弹窗里再开确认框」时
 * 一次 Esc 会先被底层弹窗的监听器吃掉、把整摞一起关掉。所有浮层进同一个栈，
 * 只有栈顶（最后挂载的）实例响应 Esc / Enter —— 嵌套浮层总是后挂载的，栈顶即最上层。
 * 存自增 id 而不是组件实例：实例在 HMR / 复用下不是稳定身份，数组里只关心「谁最后挂载」。
 */
const stack: number[] = []
let seq = 0

/** 浮层挂载时调用，返回该浮层的栈内 id */
export function enterOverlay(): number {
  const id = ++seq
  stack.push(id)
  return id
}

/** 浮层卸载时调用（onBeforeUnmount 里），重复调用安全 */
export function exitOverlay(id: number): void {
  const index = stack.indexOf(id)
  if (index >= 0) stack.splice(index, 1)
}

/** 该浮层是否为当前最上层（keydown 里先判这个再响应） */
export function isTopOverlay(id: number): boolean {
  return stack[stack.length - 1] === id
}
