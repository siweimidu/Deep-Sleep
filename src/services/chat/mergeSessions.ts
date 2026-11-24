import type { Message, Session } from './types.js'

/**
 * 导入时的**会话深度合并**。
 *
 * 旧的合并是三行：`{...local, ...incoming}` + 按 id 并集。问题很实在——
 *   · `...incoming` 会把本地标题覆盖回归档里的旧标题，用户改过的名字白改；
 *   · createdAt 被改成归档的时间，会话在列表里的位置会跳；
 *   · 用 createdAt 排序会把带分支的消息树顺序打乱（归档里的顺序才是权威的）；
 *   · 本地派生的 anchor / memory / contextUsage 被导入值覆盖，等于把本机的压缩成果丢掉。
 *
 * 这里的策略：
 *   1. **消息顺序以归档为准**，同 id 保留本地对象（本地可能有附件、版本选择等增量），
 *      归档里新增的按原顺序插入；本地独有的（导入之后新聊的）整体接在末尾，保持相对顺序。
 *   2. **标题**：本地非空就用本地的，本地为空才用归档的（避免覆盖用户改名）。
 *   3. **时间**：createdAt 取两者较早的有效值，updatedAt 取较晚的。
 *   4. **rootMessageId** 必须指向合并后真实存在的消息，否则退回"第一条无 parent 的消息"。
 *   5. **本地派生字段**（anchor / memory / contextUsage）本地有就保留。
 */
export type MergeStats = {
  /** 归档里新增的消息数 */
  added: number
  /** 两边都有、保留本地对象的消息数 */
  kept: number
  /** 本地独有、接在末尾的消息数 */
  localOnly: number
}

const earliest = (left: number, right: number): number => {
  if (left > 0 && right > 0) {
    return Math.min(left, right)
  }
  return Math.max(left, right)
}

export const mergeSessionDeep = (
  local: Session,
  incoming: Session
): { session: Session; stats: MergeStats } => {
  const localById = new Map(local.messages.map((message) => [message.id, message]))
  const incomingIds = new Set(incoming.messages.map((message) => message.id))

  const messages: Message[] = []
  let kept = 0
  let added = 0
  for (const message of incoming.messages) {
    const existing = localById.get(message.id)
    if (existing) {
      messages.push(existing)
      kept += 1
    } else {
      messages.push(message)
      added += 1
    }
  }
  const localOnly = local.messages.filter((message) => !incomingIds.has(message.id))
  messages.push(...localOnly)

  const ids = new Set(messages.map((message) => message.id))
  const validRoot = (candidate: string | null | undefined): string | undefined =>
    candidate && ids.has(candidate) ? candidate : undefined
  const fallbackRoot = messages.find((message) => !message.parentId)?.id ?? messages[0]?.id ?? null

  return {
    session: {
      ...incoming,
      ...local,
      id: local.id,
      title: local.title.trim() ? local.title : incoming.title,
      createdAt: earliest(local.createdAt, incoming.createdAt),
      updatedAt: Math.max(local.updatedAt, incoming.updatedAt),
      messages,
      rootMessageId: validRoot(local.rootMessageId) ?? validRoot(incoming.rootMessageId) ?? fallbackRoot,
    },
    stats: { added, kept, localOnly: localOnly.length },
  }
}
