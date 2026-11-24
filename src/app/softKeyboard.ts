import { android } from './android.js'

/**
 * 输入框获得焦点时，让原生再请求一次输入法。
 *
 * WebView 通常自己会把键盘叫出来，但部分 ROM（ColorOS / EMUI 这类）会把这次请求吞掉：光标在闪、
 * 键盘就是不出来。这里在 focusin 时调一次原生的 showSoftInput 作为兜底——它对已经弹出的键盘是
 * 空操作，所以不会出现"弹两次"。
 *
 * 只对真正可编辑的元素触发：抽屉里那个只读的假搜索框、以及 readOnly 字段都不该弹键盘。
 */
const isEditable = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return !target.readOnly && !target.disabled
  }
  return target.isContentEditable
}

export const installSoftKeyboardNudge = (): void => {
  const device = android
  if (!device?.showKeyboard) {
    return
  }
  // 捕获阶段监听：组件里 stopPropagation 也拦不住
  document.addEventListener(
    'focusin',
    (event) => {
      if (isEditable(event.target)) {
        device.showKeyboard?.()
      }
    },
    true,
  )
}
