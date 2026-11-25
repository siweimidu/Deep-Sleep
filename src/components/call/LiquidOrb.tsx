import { useEffect, useRef } from 'react'

/**
 * 液态玻璃球。
 *
 * 为什么不用 CSS：官方那颗球的本质是**折射**——球面把周围的暗背景扭成几团缓慢流动的影，
 * 外加一道菲涅尔亮边和一层外发光；纯渐变只能做出"一颗磨砂球"，动不起来也形变不了。
 * 这里用一小块 canvas + 片元着色器画它：只有 180 CSS px 见方，DPR 封顶 2，成本可控。
 *
 * 两个必须遵守的约束（都是真机上踩出来的）：
 *   1. GLSL 源码只能有 ASCII —— 注释里写中文会让 WebView 的 ANGLE 直接拒编译，
 *      而且 `getShaderInfoLog` 返回空字符串，只能靠 `window.__dshOrb` 才能看出来是片元阶段失败；
 *   2. 循环要手动展开、采样次数要少 —— 移动 GPU 对指令数有硬限制，超了同样静默失败。
 *
 * WebGL 不可用时通过 `onFallback` 通知外层退回 CSS 球。
 */

const VERTEX = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`

const FRAGMENT = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uLevel;
uniform float uPhase;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / (0.5 * min(uRes.x, uRes.y));
  float r = length(uv);

  // liquid edge: noise pushes the boundary, level makes it swell
  float wobble = noise(uv * 2.6 + vec2(uTime * 0.11, -uTime * 0.09));
  float radius = 0.94 + (wobble - 0.5) * 0.035 + uLevel * 0.05;
  float breath = sin(uTime * (0.9 + uPhase * 0.45)) * 0.015;
  float d = r / (radius + breath);

  float mask = smoothstep(1.0, 0.978, d);
  float halo = smoothstep(1.40, 0.94, d) * (0.10 + uLevel * 0.22 + uPhase * 0.03);

  // refraction: one wide blob decides where the dark shadow sits, one fine layer adds detail
  vec2 q = uv * 1.3;
  float big = noise(q * 0.9 + vec2(uTime * 0.04, -uTime * 0.03));
  float fine = noise(q * 2.3 + vec2(big * 1.8) + vec2(-uTime * 0.08, uTime * 0.06));
  float bias = smoothstep(0.05, 1.15, length(uv - vec2(-0.10, 0.10)));
  float shadow = clamp((big - 0.40) * 2.7 + (fine - 0.5) * 0.45 + bias * 0.28, 0.0, 1.0);

  vec3 lit = vec3(0.93, 0.96, 1.00);
  vec3 shade = vec3(0.33, 0.44, 0.59);
  vec3 body = mix(lit, shade, shadow * 1.08);

  float spec = max(0.0, 1.0 - length(uv - vec2(-0.32, 0.40)) * 1.65);
  body += vec3(0.17) * spec * spec;

  float edgeLift = clamp(0.55 - uv.x * 0.30 - uv.y * 0.22, 0.0, 1.0);
  float fres = smoothstep(0.76, 0.99, d) * (1.0 - smoothstep(1.0, 1.07, d));
  body = mix(body, vec3(1.0), fres * (0.42 + edgeLift * 0.38));

  vec3 color = body * mask + vec3(0.86, 0.92, 1.0) * halo;
  float alpha = clamp(mask + halo, 0.0, 1.0);

  if (uPhase > 2.5) {
    float g = dot(color, vec3(0.33, 0.5, 0.17));
    color = mix(color, vec3(g), 0.5);
  }

  gl_FragColor = vec4(color, alpha);
}
`

const compile = (gl: WebGLRenderingContext, type: number, source: string) => {
  const shader = gl.createShader(type)
  if (!shader) {
    return null
  }
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    // 调试包把编译日志留在 window 上：着色器错误在真机上只能这么看
    const scope = window as unknown as { __dshOrb?: unknown }
    scope.__dshOrb = {
      stage: type === gl.VERTEX_SHADER ? 'vertex' : 'fragment',
      log: gl.getShaderInfoLog(shader) ?? '',
    }
    gl.deleteShader(shader)
    return null
  }
  return shader
}

export type LiquidOrbProps = {
  level: { readonly current: number }
  phaseCode: number
  /** CSS 像素直径 */
  size: number
  className?: string
  /** WebGL 用不了时通知外层退回 CSS 球 */
  onFallback?: () => void
}

export const LiquidOrb = ({ level, phaseCode, size, className, onFallback }: LiquidOrbProps) => {
  const canvas = useRef<HTMLCanvasElement>(null)
  const phase = useRef(phaseCode)
  phase.current = phaseCode
  // 回调放进 ref：父组件每次重渲染都会生成新闭包，若把它放进 deps，effect 会不停重建，
  // 而重建时 canvas 的 WebGL 上下文已经失了，下一次 getContext 拿到的还是那个丢失的上下文
  // —— 表现就是"着色器编译失败但日志为空"。
  const fallback = useRef(onFallback)
  fallback.current = onFallback

  useEffect(() => {
    const element = canvas.current
    if (!element) {
      return
    }
    const gl = element.getContext('webgl', {
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
      depth: false,
      stencil: false,
    })
    if (!gl) {
      element.dataset.fallback = 'true'
      ;(window as unknown as { __dshOrb?: unknown }).__dshOrb = { stage: 'context' }
      fallback.current?.()
      return
    }
    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX)
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT)
    const program = gl.createProgram()
    if (!vs || !fs || !program) {
      element.dataset.fallback = 'true'
      fallback.current?.()
      return
    }
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      element.dataset.fallback = 'true'
      ;(window as unknown as { __dshOrb?: unknown }).__dshOrb = {
        stage: 'link',
        log: gl.getProgramInfoLog(program) ?? '',
      }
      fallback.current?.()
      return
    }
    gl.useProgram(program)

    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const aPos = gl.getAttribLocation(program, 'aPos')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

    const uRes = gl.getUniformLocation(program, 'uRes')
    const uTime = gl.getUniformLocation(program, 'uTime')
    const uLevel = gl.getUniformLocation(program, 'uLevel')
    const uPhase = gl.getUniformLocation(program, 'uPhase')

    // DPR 封顶 2：这颗球只有 180 CSS px，2 倍已经够细，3 倍纯属浪费填充率
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const pixels = Math.round(size * dpr)
    element.width = pixels
    element.height = pixels
    gl.viewport(0, 0, pixels, pixels)
    gl.clearColor(0, 0, 0, 0)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

    let frame = 0
    const start = performance.now()
    let smooth = 0
    const draw = (now: number) => {
      // 电平再平滑一次：Rust 的包络是给 CSS 用的，着色器需要更黏一点的手感
      smooth += (level.current - smooth) * 0.18
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.uniform2f(uRes, pixels, pixels)
      gl.uniform1f(uTime, (now - start) / 1000)
      gl.uniform1f(uLevel, Math.min(1, Math.max(0, smooth)))
      gl.uniform1f(uPhase, phase.current)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(frame)
      gl.deleteProgram(program)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
      gl.deleteBuffer(buffer)
    }
  }, [level, size])

  return <canvas ref={canvas} className={className} width={size} height={size} aria-hidden="true" />
}
