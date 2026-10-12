/**
 * 组卷工作台里「搜索框」与 `filter.keyword` 的双向同步。
 *
 * 工作台有两处搜索框改的是**同一个值**：页签条上方的 `ComposeSearchBar`（文本 / 图片 / AI 三种
 * 输入方式都落在这里）与列表工具条里的那个。两处必须互相同步 —— 在顶栏搜完再切页签，
 * 列表里的输入框得显示同一个词，在列表里改词，顶栏也要跟着变。
 *
 * 同步的细节全在下面两个 watch 里（防抖、trim、回填时不打断光标），每个页签各抄一份必然漂移，
 * 所以抽出来共用：`get` 读当前关键词，`set` 把新值写回筛选。
 *
 * `get` 传取值函数而不是值本身：筛选对象由 shell 持有并在页签之间共享，本组合式只在这一个
 * 页签存活期间同步它，没必要（也不该）缓存一份副本。
 */
import { onBeforeUnmount, ref, watch, type Ref } from 'vue'

/** 输入 → 写回筛选的防抖时长：逐字符写回会让每敲一下都重筛整屏
 * （题量、卷量都在千级，260ms 是人手连打时感受不到、又能挡掉一大半重算的折中） */
const DEBOUNCE_MS = 260

export function useComposeKeyword(get: () => string, set: (value: string) => void): Ref<string> {
  const keyword = ref(get())
  let timer: number | undefined

  watch(keyword, (value) => {
    window.clearTimeout(timer)
    const next = value.trim()
    if (next === get()) return
    timer = window.setTimeout(() => set(next), DEBOUNCE_MS)
  })

  /* 外部改了关键词（顶栏搜索 / AI 解读 / 图片识别 / 重置筛选）时回填输入框；
     用户正在输入、值只差尾随空格时不动，免得光标跳到最后 */
  watch(get, (value) => {
    if (value !== keyword.value.trim()) keyword.value = value
  })

  /* 卸载时清掉待触发的防抖：否则离开页签后还会写一次筛选（切页签时条件本该保持不动） */
  onBeforeUnmount(() => window.clearTimeout(timer))

  return keyword
}
