import type { CSSProperties } from 'react'
import { android } from './android.js'

/**
 * 密码输入框在 Android 上的变体。
 *
 * ColorOS 这类 ROM 只要看到 `type="password"`，就会强制换成它自带的「安全键盘」——用户选中的
 * 第三方输入法（微信输入法、讯飞…）根本没有机会出现，表现就是"只能唤起安全键盘"。
 * 改成普通文本框 + CSS 遮字后，系统不再判定为密码场景，输入法恢复正常；
 * 桌面浏览器仍然用真正的 `type="password"`，不牺牲那里的安全性。
 */
export const secretInput = (): { type: 'text' | 'password'; style?: CSSProperties } =>
  android
    ? { type: 'text', style: { WebkitTextSecurity: 'disc' } as unknown as CSSProperties }
    : { type: 'password' }
