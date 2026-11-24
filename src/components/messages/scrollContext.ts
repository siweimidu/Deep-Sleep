import { createContext, useContext } from 'react'

/** 渲染更新后请求滚到底部；用户上滑或展开思考内容时暂停跟随。 */
export const ScrollToBottomContext = createContext({
  scrollToBottom: () => {},
  stopFollowing: () => {},
})

export const useScrollToBottom = () => useContext(ScrollToBottomContext).scrollToBottom

export const useStopFollowing = () => useContext(ScrollToBottomContext).stopFollowing
