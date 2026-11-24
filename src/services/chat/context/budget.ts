import type { ChatModel } from '../../api/types.js'
import type { AssistantMessage, Message, UserMessage } from '../types.js'
import { getContextRounds } from '../reply.js'
import { buildReplyView } from '../view.js'
import { rustBudget } from '../../../rust-core/budget.js'

/**
 * 上下文预算
 *
 * 目标不是"塞更多"，而是让每轮请求的 token 数稳定：前缀越稳，命中服务端前缀缓存的比例越高。
 * 因此这里只在「超出触发线」时才裁剪，而且一次裁到目标线以下，
 * 中间几十轮都不再动 —— 裁剪点之间前缀完全一致。
 */

/** 各模型的窗口大小（token） */
export const MODEL_WINDOWS: Record<ChatModel, number> = {
  // V4.1 Flash-1017：100 万上下文
  'deepseek-flash': 1_000_000,
  // V4.1 Pro 的窗口尚未核对，先保守按 128K
  'deepseek-v4-pro': 128_000,
}

/** 界面上展示用的模型名 */
export const MODEL_LABELS: Record<ChatModel, string> = {
  'deepseek-flash': 'DeepSeek V4.1Flash-1017',
  'deepseek-v4-pro': 'DeepSeek V4.1Pro-1017',
}

/** 给输出留的余量 */
export const OUTPUT_RESERVE = 8_000
/** 超过「窗口 - 预留」的这个比例就触发一次压缩 */
export const TRIGGER_RATIO = 0.75
/** 压缩后落到这个比例，留出尽量长的追加空间以减少压缩次数 */
export const TARGET_RATIO = 0.36

/** 粗略估算 token：中日韩字符约 1 字 1 token，拉丁文约 4 字符 1 token。 */
export const estimateTokens = (text: string): number => {
  // 先保持原实现的短路语义：空/未定义一律 0，不能先去读 `.length`（那会在 undefined 上抛错）。
  if (!text) {
    return 0
  }
  // 阈值来自设备实测（rust/cdp-budget.mjs，Android WebView 113，ratio = ts/rust，>1 表示 Rust 更快）：
  //   16 → 0.82、64 → 0.66、128 → 1.08、256 → 0.85、512 → 1.50、1 KB → 1.56、4 KB → 1.64、100 KB → 2.14
  // 交叉点在 512 附近，256 反而更慢，所以门槛取 512：低于它用下面的原实现，永远不会亏。
  const rust = text.length >= 512 ? rustBudget.estimateTokens(text) : undefined
  if (rust !== undefined) {
    return rust
  }
  // 按码位分档估算：不同文字的分词密度差得很远，用一个统一除数（原来是窄字符/3.6）会同时
  // 高估标点密集的代码、低估 emoji。权重取常见分词器的经验值：
  //   ASCII 字母/数字/空白 0.25（约 4 字符/token，英文常态）
  //   ASCII 标点/符号      0.4 （代码与标点明显更费 token）
  //   Latin-1/希腊/西里尔  0.5
  //   CJK/假名/谚文/全角   1.0
  //   增补平面罕见字       1.2
  //   emoji 等象形         2.0 （原来按 1 算，是明确的低估）
  //
  // 分档写成内联分支而不是每字符调一次函数：实测 500KB 文本 7.63ms → 6.99ms（1.09×），
  // 结果逐例一致。这笔开销只落在 <512 字符的短文本上，长文本已交给 wasm。
  let total = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code < 0x2e80) {
      if (code <= 0x7f) {
        const plain =
          (code >= 0x30 && code <= 0x39) ||
          (code >= 0x41 && code <= 0x5a) ||
          (code >= 0x61 && code <= 0x7a) ||
          code === 0x20 ||
          code === 0x09 ||
          code === 0x0a ||
          code === 0x0d
        total += plain ? 0.25 : 0.4
      } else {
        total += code <= 0x3ff ? 0.5 : 0.34
      }
    } else if (code < 0x10000) {
      total += 1
    } else if (code < 0x1f000) {
      total += 1.2
    } else {
      total += 2
    }
  }
  return Math.ceil(total)
}

/** 附件按固定预算估算，避免为一两个图片反复解析 */
const FILE_TOKENS = 900

const userTokens = (message: UserMessage) =>
  estimateTokens(message.content) + (message.files?.length ?? 0) * FILE_TOKENS

const replyTokens = (message: AssistantMessage) => {
  try {
    return estimateTokens(buildReplyView(message, false).answer?.text ?? '')
  } catch {
    return 0
  }
}

export type BudgetPlan = {
  /** 实际要发的历史（可能被裁剪） */
  history: Message[]
  /** 估算的输入 token */
  estimate: number
  /** 本轮是否发生压缩 */
  compacted: boolean
  /** 被裁掉的轮数 */
  droppedRounds: number
  /** 触发线 / 目标线，供 UI 展示 */
  trigger: number
  target: number
}

export const planContext = (
  history: Message[],
  model: ChatModel,
  lastInputTokens?: number
): BudgetPlan => {
  const window = MODEL_WINDOWS[model] ?? 128_000
  const usable = window - OUTPUT_RESERVE
  const trigger = Math.floor(usable * TRIGGER_RATIO)
  const target = Math.floor(usable * TARGET_RATIO)

  // 上一轮的真实输入 token 是最可信的基线：本轮多出来的只有新的一问一答
  const rounds = getContextRounds(history)
  const measured = lastInputTokens ?? 0
  const estimate =
    measured > 0
      ? measured + rounds.slice(-1).reduce((sum, [user, reply]) => sum + userTokens(user) + replyTokens(reply), 0)
      : rounds.reduce((sum, [user, reply]) => sum + userTokens(user) + replyTokens(reply), 0)

  if (estimate <= trigger || rounds.length <= 2) {
    return { history, estimate, compacted: false, droppedRounds: 0, trigger, target }
  }

  // 压缩：保留首轮（意图锚点）+ 从尾部往回收，直到落到目标线以内
  const keep: Message[] = []
  let total = 0
  const [firstRound] = rounds
  const firstTokens = userTokens(firstRound[0]) + replyTokens(firstRound[1])
  keep.push(firstRound[0], firstRound[1])
  total += firstTokens

  for (let index = rounds.length - 1; index >= 1; index -= 1) {
    const [user, reply] = rounds[index]
    const cost = userTokens(user) + replyTokens(reply)
    if (total + cost > target) {
      break
    }
    keep.splice(2, 0, user, reply)
    total += cost
  }

  return {
    history: keep,
    estimate: total,
    compacted: true,
    droppedRounds: rounds.length - keep.length / 2,
    trigger,
    target,
  }
}
