import styles from './JumpToBottomButton.module.css'

/**
 * 回到底部：内容滚上去之后浮在列表右下角。
 *
 * 只负责"看得见/看不见"的过渡与点击回调，滚动本身由 MessageList 处理（它才知道 sticky 状态）。
 * 用主题的动效 token，系统开启"减少动态效果"时会自动变成瞬时。
 */
export const JumpToBottomButton = ({
  visible,
  onClick,
}: {
  visible: boolean
  onClick: () => void
}) => (
  <button
    type="button"
    className={styles.jump}
    data-visible={visible ? '' : undefined}
    tabIndex={visible ? 0 : -1}
    aria-hidden={!visible}
    onClick={onClick}
  >
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 10l6 6 6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  </button>
)
