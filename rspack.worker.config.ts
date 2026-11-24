import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@rspack/cli'

/**
 * 单独产出 markdown 解析 worker。
 *
 * 不走主配置里的 `new Worker(new URL(...))`：那条路会生成带运行时 chunk 加载的产物，
 * 实测在本项目的构建目标下 worker 脚本根本不执行（连启动探针都收不到）。
 * 这里单独打成**一个自包含的经典脚本**，worker 内部不再有 importScripts / 动态 chunk。
 */

const root = path.dirname(fileURLToPath(import.meta.url))
// 兼容基线：Chromium 66 ≈ Android 9 及更早机型的 WebView 下限。
// 降到这个目标后 lightningcss 会自动降级 :is() / color-mix() / dvh 等新语法，
// swc 也会按 targets 注入 core-js 补丁——比逐个文件手写回退更不容易漏。
const targets = ['chrome >= 66', 'edge >= 79', 'safari >= 12', 'firefox >= 60']

export default defineConfig({
  mode: 'production',
  target: 'webworker',
  devtool: false,
  entry: {
    'parse-worker': './src/services/markdown/parse.worker.ts',
    // 解压 worker 也必须单独打出来：主配置里的 new Worker(new URL(...)) 在本项目不产出脚本，
    // 页面拿到的是 404，于是任何 DEFLATE 归档（含官方导出的 zip）都会导入失败。
    'inflate-worker': './src/services/chat/history/inflate.worker.ts',
    // 会话解析（JSON.parse + 校验 + 映射）下沉到后台线程，导入时不阻塞界面
    'chat-parse-worker': './src/services/chat/history/parse.worker.ts',
  },
  output: {
    // 不能 clean：主配置刚把整个 dist 产出来
    clean: false,
    path: path.resolve(root, 'dist/static/js'),
    filename: '[name].js',
    chunkFormat: 'commonjs',
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
    // 将 .js 导入路径解析到同名 .ts、.tsx 或 .js 文件
    extensionAlias: { '.js': ['.ts', '.tsx', '.js'] },
  },
  module: {
    rules: [
      {
        test: /\.(?:[cm]?js|jsx|tsx?)$/,
        exclude: /[\\/]node_modules[\\/]core-js[\\/]/,
        loader: 'builtin:swc-loader',
        options: {
          detectSyntax: 'auto',
          isModule: 'unknown',
          jsc: { externalHelpers: true },
          env: { targets, mode: 'usage', coreJs: '3.51' },
        },
        type: 'javascript/auto',
      },
    ],
  },
  optimization: {
    // 单文件：worker 里不允许再拆 chunk
    splitChunks: false,
    runtimeChunk: false,
    minimize: true,
  },
  performance: { hints: false },
})
