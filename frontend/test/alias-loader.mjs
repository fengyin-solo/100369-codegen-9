// node 模块解析钩子：把 @/ 别名与无扩展名导入映射到 tsconfig.smoke.json 的编译输出目录。
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export function resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) {
    specifier = '/tmp/smoke-out/src/' + specifier.slice(2)
  }
  if (specifier.startsWith('/')) {
    for (const candidate of [specifier, specifier + '.js', specifier + '.mjs']) {
      if (existsSync(candidate)) {
        return next(pathToFileURL(candidate).href, context)
      }
    }
  }
  if (specifier.startsWith('.')) {
    for (const ext of ['', '.js', '.mjs']) {
      const url = new URL(specifier + ext, context.parentURL)
      if (existsSync(url.pathname)) {
        return next(url.href, context)
      }
    }
  }
  return next(specifier, context)
}
