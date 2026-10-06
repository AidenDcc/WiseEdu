/**
 * 协同组卷的标签配色表 —— 任务列表（CollabView）与组卷页（CollabTaskView）共用一份。
 *
 * 为什么单独抽一个文件：两个页面各自画一遍状态标签，早先就是各写一串三元表达式，
 * 加了「待送审 / 已送审 / 已驳回」之后必然对不上（同一状态在两个页面两个颜色）。
 * 配色不是样式细节，而是这套状态机对用户的说法，必须只有一处。
 *
 * **颜色语言：蓝=球在别人手里，橙=球在组长手里，绿=走完了，红=被退回。**
 * 所以「收题中 / 已送审」同为蓝、「待验收 / 待送审」同为橙并非偷懒 —— 它们说的是同一件事：
 * 现在该谁动。新增状态时按这个口径挑颜色，别按「看起来好不好看」挑。
 *
 * 这里只映射到全局 `main.css` 里已有的 tag 变体，不新增颜色：状态多达 6 个，
 * 再自造色会与既有语义（成功/警告/危险）打架，用户反而读不出轻重。
 */
import type { CollabMemberStatus, CollabTaskStatus } from '@aiteach/shared'

export const COLLAB_STATUS_CLASS: Record<CollabTaskStatus, string> = {
  collecting: 'tag-blue',
  reviewing: 'tag-orange',
  ready: 'tag-orange',
  submitted: 'tag-blue',
  done: 'tag-green',
  rejected: 'tag-red',
}

/** 成员状态：已提交=橙（等组长验收），已验收=绿（组长认了） */
export const COLLAB_MEMBER_CLASS: Record<CollabMemberStatus, string> = {
  invited: 'tag-gray',
  working: 'tag-blue',
  submitted: 'tag-orange',
  accepted: 'tag-green',
}
