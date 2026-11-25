import { useEffect, useRef, type RefObject } from 'react'

export type BackGestureState = 'start' | 'progress' | 'cancel' | 'invoked'

type Listener = (state: BackGestureState, progress: number) => void

/**
 * Android 14 起的预测性返回：手势进行中系统持续回调进度，前端据此实时位移当前界面；
 * 只有最后的 invoked 才真正执行返回。多层界面用栈注册，最上层（最后挂载）消费手势，
 * 关闭后自动回退到下一层。
 */
const stack: Listener[] = []
let installed = false

/** 提交手势后留给"滑出去"的时间：太短看着像闪一下就没了，太长又拖泥带水 */
const COMMIT_MS = 110

/** 原生在 invoked 之后会读这个标记，决定还要不要把返回交给页面自己处理。 */
const markConsumed = () => {
  ;(window as Window & { __dshConsumedBack?: boolean }).__dshConsumedBack = true
  window.setTimeout(() => {
    ;(window as Window & { __dshConsumedBack?: boolean }).__dshConsumedBack = false
  }, 0)
}

/** 进度同时写到根元素：下层元素要靠它做景深，样式里读的是同一个 --back-progress */
const publish = (progress: number) => {
  const root = document.documentElement
  root.style.setProperty('--back-progress', String(progress))
}

const clearRoot = () => {
  const root = document.documentElement
  delete root.dataset.backActive
  root.style.setProperty('--back-progress', '0')
}

const install = () => {
  if (installed || typeof window === 'undefined') {
    return
  }
  installed = true
  window.addEventListener('android-back-gesture', (event) => {
    const detail = (event as CustomEvent<{ state?: BackGestureState; progress?: number }>).detail
    if (!detail?.state) {
      return
    }
    const listener = stack[stack.length - 1]
    if (!listener) {
      return
    }
    if (detail.state === 'invoked') {
      markConsumed()
    }
    listener(detail.state, detail.progress ?? 0)
  })
}

export const claimBackGesture = (listener: Listener) => {
  install()
  stack.push(listener)
  return () => {
    const index = stack.lastIndexOf(listener)
    if (index >= 0) {
      stack.splice(index, 1)
    }
  }
}

/**
 * 把预测性返回进度写到元素的 --back-progress 上，位移/缩放/圆角/投影交给 motion-kit.css 的
 * `[data-back-stage]` 统一决定 —— 各页面不再各写一套 transform，手感才会一致。
 * 手势取消时弹簧归位，手势完成时先滑出去再执行返回。
 */
export const usePredictiveBack = (
  ref: RefObject<HTMLElement | null>,
  onBack: () => void,
  active = true
) => {
  const handler = useRef(onBack)
  handler.current = onBack

  useEffect(() => {
    if (!active) {
      return
    }
    const element = ref.current
    if (!element) {
      return
    }
    element.setAttribute('data-back-stage', '')
    const setProgress = (progress: number) => {
      const value = Math.min(1, Math.max(0, progress))
      element.style.setProperty('--back-progress', String(value))
      publish(value)
    }
    const reset = () => {
      element.removeAttribute('data-back')
      setProgress(0)
      clearRoot()
    }
    // 上一次手势如果被系统打断，偏移会留在元素上：先复位，避免整页偏着导致点击错位
    reset()
    let commitTimer = 0
    const dispose = claimBackGesture((state, progress) => {
      if (state === 'start') {
        element.setAttribute('data-back', 'active')
        document.documentElement.dataset.backActive = ''
        setProgress(0)
      } else if (state === 'progress') {
        element.setAttribute('data-back', 'active')
        document.documentElement.dataset.backActive = ''
        setProgress(progress)
      } else if (state === 'cancel') {
        reset()
      } else {
        // 提交：保持当前进度滑出去，再真正关闭，避免"手一松界面就没了"
        window.clearTimeout(commitTimer)
        commitTimer = window.setTimeout(() => {
          reset()
          handler.current()
        }, COMMIT_MS)
      }
    })
    return () => {
      window.clearTimeout(commitTimer)
      dispose()
      element.removeAttribute('data-back')
      element.removeAttribute('data-back-stage')
      element.style.removeProperty('--back-progress')
      clearRoot()
    }
  }, [active, ref])
}
