import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { createRequire } from 'node:module'

const IGNORED_DIRS = new Set(['node_modules', 'test', 'tests', 'vendor', '.git', 'dist', 'build', 'coverage'])
const SOURCE_EXT = new Set(['.js', '.mjs', '.cjs'])
const SECTION_RE =
  /(?:systemPrompt\s*\.\s*section|systemPrompt\s*\.\s*context)\s*\([\s\S]{0,400}?name\s*:\s*['"]([^'"]+)['"]/g

/**
 * 扫描不到的已知贡献（常量形式的 section 名等）。
 * `@local/dsh-superpowers` 用 `BOOTSTRAP_SECTION = 'superpowers:bootstrap'`
 * 注册提示词段，正则抓不到变量，所以在这里兜底。
 */
const KNOWN = {
  '@local/dsh-superpowers': { sections: ['superpowers:bootstrap'] },
}

/**
 * 建一个「模块名 → 工具/段落/上下文」映射器；扫描 + 配置覆盖 + 内存缓存。
 * @param {{ profileDir: string, config: { toolMap: Record<string, {tools?: string[], sections?: string[], contexts?: string[]}>, scan: boolean, scanMaxFiles: number, scanMaxBytes: number, cacheTtlMs: number }, logger?: { warn?: (m: string) => void } }} options
 */
export function createToolMapper(options) {
  const { profileDir, config, logger } = options
  const cache = new Map()
  let scannedAt = 0

  function invalidate() {
    cache.clear()
    scannedAt = 0
  }

  function forModules(modules, toolNames) {
    const now = Date.now()
    if (scannedAt !== 0 && now - scannedAt > config.cacheTtlMs) invalidate()
    const wanted = Array.isArray(toolNames) ? toolNames : []
    const result = {}
    for (const moduleName of modules) {
      const cached = cache.get(moduleName)
      if (cached !== undefined) {
        result[moduleName] = cached
        continue
      }
      const entry = resolveEntry(moduleName, wanted)
      cache.set(moduleName, entry)
      result[moduleName] = entry
    }
    scannedAt = now
    return result
  }

  function resolveEntry(moduleName, toolNames) {
    const override = config.toolMap[moduleName]
    const known = KNOWN[moduleName] ?? {}
    if (override) {
      return {
        tools: [...(override.tools ?? known.tools ?? [])],
        sections: [...(override.sections ?? known.sections ?? [])],
        contexts: [...(override.contexts ?? known.contexts ?? [])],
        reason: 'override',
      }
    }
    if (!config.scan) {
      return {
        tools: [...(known.tools ?? [])],
        sections: [...(known.sections ?? [])],
        contexts: [...(known.contexts ?? [])],
        reason: 'scan-disabled',
      }
    }
    const packageDir = resolvePackageDir(moduleName)
    if (packageDir === null) return { tools: [], sections: [], contexts: [], reason: 'unresolved' }
    try {
      const names = scanPackage(packageDir, toolNames, config.scanMaxFiles, config.scanMaxBytes)
      return {
        tools: unique([...(known.tools ?? []), ...names.tools]),
        sections: unique([...(known.sections ?? []), ...names.sections]),
        contexts: unique([...(known.contexts ?? []), ...names.contexts]),
        reason: 'scanned',
      }
    } catch (error) {
      logger?.warn?.(`[session-plugin-manager] 扫描 ${moduleName} 失败：${String(error)}`)
      return { tools: [], sections: [], contexts: [], reason: 'unresolved' }
    }
  }

  function resolvePackageDir(moduleName) {
    try {
      const requireFromProfile = createRequire(join(profileDir, 'package.json'))
      return dirname(requireFromProfile.resolve(`${moduleName}/package.json`))
    } catch {
      // 包没把 package.json 放进 exports；退回 node_modules 直查。
    }
    try {
      const direct = join(profileDir, 'node_modules', ...moduleName.split('/'))
      statSync(direct)
      return direct
    } catch {
      return null
    }
  }

  return { forModules, invalidate }
}

/**
 * 扫描一个包里的 `.js/.mjs/.cjs`，找 tool 注册与 systemPrompt section/context 的名字。
 * @param {string} packageDir
 * @param {readonly string[]} toolNames
 * @param {number} maxFiles
 * @param {number} maxBytes
 */
export function scanPackage(packageDir, toolNames, maxFiles = 120, maxBytes = 2 * 1024 * 1024) {
  const texts = []
  for (const file of collectFiles(packageDir, maxFiles, maxBytes)) {
    try {
      texts.push(readFileSync(file, 'utf8'))
    } catch {
      // 读不了就跳过，不影响其它文件。
    }
  }
  const tools = []
  for (const name of toolNames) {
    if (typeof name !== 'string' || name === '') continue
    const pattern = new RegExp(`\\bname\\s*:\\s*['"]${escapeRegExp(name)}['"]`)
    if (texts.some((text) => pattern.test(text))) tools.push(name)
  }
  const sections = new Set()
  const contexts = new Set()
  for (const text of texts) {
    for (const match of text.matchAll(SECTION_RE)) {
      const name = match[1]
      if (typeof name !== 'string' || name === '') continue
      const isContext = /systemPrompt\s*\.\s*context/.test(match[0])
      ;(isContext ? contexts : sections).add(name)
    }
  }
  return { tools: [...new Set(tools)], sections: [...sections], contexts: [...contexts] }
}

/**
 * 跨模块合并：同一个名字被 ≥2 个模块命中就视为歧义，不归任何模块；
 * 配置里显式指定的名字保留。
 * @param {readonly string[]} moduleNames
 * @param {Record<string, {tools?: string[], sections?: string[], contexts?: string[]}>} maps
 * @param {Record<string, {tools?: string[], sections?: string[], contexts?: string[]}>} [overrides]
 */
export function mergeModuleMaps(moduleNames, maps, overrides = {}) {
  const counts = new Map()
  for (const moduleName of moduleNames) {
    const entry = maps[moduleName]
    if (!entry) continue
    for (const key of ['tools', 'sections', 'contexts']) {
      for (const name of entry[key] ?? []) {
        const id = key + ':' + name
        counts.set(id, (counts.get(id) ?? 0) + 1)
      }
    }
  }
  const out = {}
  for (const moduleName of moduleNames) {
    const entry = maps[moduleName] ?? { tools: [], sections: [], contexts: [] }
    const clean = { tools: [], sections: [], contexts: [] }
    for (const key of ['tools', 'sections', 'contexts']) {
      for (const name of entry[key] ?? []) {
        const override = overrides[moduleName]
        const trusted = Array.isArray(override?.[key]) && override[key].includes(name)
        if (trusted || (counts.get(key + ':' + name) ?? 0) === 1) clean[key].push(name)
      }
    }
    out[moduleName] = clean
  }
  return out
}

function collectFiles(packageDir, maxFiles, maxBytes) {
  const files = []
  const queue = [packageDir]
  const seen = new Set()
  while (queue.length > 0 && files.length < maxFiles) {
    const dir = queue.shift()
    if (seen.has(dir)) continue
    seen.add(dir)
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) queue.push(full)
        continue
      }
      if (!entry.isFile() || !SOURCE_EXT.has(extname(entry.name))) continue
      try {
        if (statSync(full).size > maxBytes) continue
        files.push(full)
      } catch {
        // 单个文件失败不影响扫描。
      }
      if (files.length >= maxFiles) break
    }
  }
  return files
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function unique(values) {
  return [...new Set(values)]
}
