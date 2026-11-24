/**
 * 运行期 API 地址覆盖的存放点。
 *
 * 单独一个零依赖模块，就是为了打断循环依赖：
 *   settings.ts 需要写入覆盖值，client.ts 需要读取它；
 *   如果让 settings 直接 import client（或反过来），两边会成环。
 * 现在两边都只依赖这个模块，方向是单向的。
 */
let override: string | null = null

export const setOriginOverride = (origin: string | null): void => {
  override = origin
}

export const getOriginOverride = (): string | null => override
