/**
 * 旧 WebView 兼容补丁。
 *
 * 兼容下限取 **Chromium 95**——Android 5/6 上 WebView 能更新到的最高版本量级。
 * 这个版本之上、但上限之下会用到的 API，在这里统一补齐：
 *
 *   AbortSignal.throwIfAborted / reason   需要 100
 *   HTMLElement.inert                     需要 102
 *   Array.prototype.toSorted / toReversed 需要 110
 *
 * 再往下（Object.hasOwn 93、Array.at 92、randomUUID 92）在 95 上本来就可用，
 * 但补上只是几行，能挡住个别厂商裁过内核的机型。
 *
 * 必须在入口最前面 import，保证业务代码运行前就已就位。
 */

type Mutable = Record<string, unknown>

const define = (target: object, name: string, value: unknown): void => {
  if (name in target) {
    return
  }
  Object.defineProperty(target, name, {
    value,
    writable: true,
    configurable: true,
    enumerable: false,
  })
}

const patchAbortSignal = (): void => {
  if (typeof AbortSignal === 'undefined') {
    return
  }
  const proto = AbortSignal.prototype as unknown as Mutable
  define(proto, 'throwIfAborted', function throwIfAborted(this: AbortSignal): void {
    const reason = (this as unknown as { reason?: unknown }).reason
    if (this.aborted) {
      throw reason === undefined ? new DOMException('signal is aborted', 'AbortError') : reason
    }
  })
  if (!('reason' in proto)) {
    Object.defineProperty(proto, 'reason', {
      // 老内核没有 reason：用 aborted 推一个 abort 原因，够 throwIfAborted 用
      get(this: AbortSignal) {
        return this.aborted ? new DOMException('signal is aborted', 'AbortError') : undefined
      },
      configurable: true,
      enumerable: false,
    })
  }
}

const patchArray = (): void => {
  const proto = Array.prototype as unknown as Mutable
  define(proto, 'toSorted', function toSorted<T>(
    this: T[],
    compare?: (a: T, b: T) => number,
  ): T[] {
    return [...this].sort(compare)
  })
  define(proto, 'toReversed', function toReversed<T>(this: T[]): T[] {
    return [...this].reverse()
  })
  define(proto, 'at', function at<T>(this: T[], index: number): T | undefined {
    const length = this.length
    const offset = Math.trunc(index) || 0
    const absolute = offset < 0 ? length + offset : offset
    return absolute < 0 || absolute >= length ? undefined : this[absolute]
  })
}

const patchMisc = (): void => {
  define(Object, 'hasOwn', (target: object, key: PropertyKey): boolean =>
    Object.prototype.hasOwnProperty.call(target, key),
  )
  if (typeof crypto !== 'undefined') {
    define(crypto, 'randomUUID', (): string => {
      const bytes = new Uint8Array(16)
      crypto.getRandomValues(bytes)
      // RFC 4122 v4
      bytes[6] = (bytes[6] & 0x0f) | 0x40
      bytes[8] = (bytes[8] & 0x3f) | 0x80
      const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    })
  }
  if (typeof Blob !== 'undefined') {
    define(Blob.prototype, 'arrayBuffer', function arrayBuffer(this: Blob): Promise<ArrayBuffer> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as ArrayBuffer)
        reader.onerror = () => reject(reader.error ?? new Error('failed to read blob'))
        reader.readAsArrayBuffer(this)
      })
    })
  }
}

/**
 * inert 是"整棵子树不可交互、不可聚焦、对辅助技术隐藏"。
 * 老内核没有原生实现，用属性反射 + pointer-events + tabindex 兜住主要效果。
 */
const patchInert = (): void => {
  if (typeof HTMLElement === 'undefined' || 'inert' in HTMLElement.prototype) {
    return
  }
  const apply = (element: HTMLElement, inert: boolean): void => {
    if (inert) {
      element.setAttribute('inert', '')
      element.setAttribute('aria-hidden', 'true')
      element.style.pointerEvents = 'none'
      const focusable = element.querySelectorAll<HTMLElement>('a,button,input,select,textarea')
      focusable.forEach((node) => {
        if (!node.hasAttribute('data-inert-tabindex')) {
          node.dataset.inertTabindex = node.getAttribute('tabindex') ?? ''
        }
        node.tabIndex = -1
      })
      return
    }
    element.removeAttribute('inert')
    element.removeAttribute('aria-hidden')
    element.style.pointerEvents = ''
    element.querySelectorAll<HTMLElement>('[data-inert-tabindex]').forEach((node) => {
      const saved = node.dataset.inertTabindex ?? ''
      if (saved === '') {
        node.removeAttribute('tabindex')
      } else {
        node.setAttribute('tabindex', saved)
      }
      delete node.dataset.inertTabindex
    })
  }
  Object.defineProperty(HTMLElement.prototype, 'inert', {
    get(this: HTMLElement) {
      return this.hasAttribute('inert')
    },
    set(this: HTMLElement, value: boolean) {
      apply(this, Boolean(value))
    },
    configurable: true,
    enumerable: false,
  })
}

export const installWebViewCompat = (): void => {
  patchAbortSignal()
  patchArray()
  patchMisc()
  patchInert()
}

// 模块体里立刻执行：配合在入口处"第一行 import"，保证任何业务模块求值前补丁已经就位。
installWebViewCompat()