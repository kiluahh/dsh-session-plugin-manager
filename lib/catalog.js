import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mergeModuleMaps } from './tool-map.js'

export const SELF_NAME = 'dsh-session-plugin-manager'

/**
 * 插件目录：把 listBundles() 变成面板行；缓存到 invalidate()/TTL。
 * @param {{ pluginManager?: { listBundles?: () => Promise<unknown> }, mapper: { forModules: Function }, config: { includeOfficial: boolean, toolMap: Record<string, unknown>, cacheTtlMs?: number }, logger?: { warn?: (m: string) => void }, profileDir: string }} options
 */
export function createCatalog(options) {
  const { pluginManager, mapper, config, logger, profileDir, listSkills } = options
  let last = { at: 0, rows: [], byName: new Map() }
  const ttl = typeof config.cacheTtlMs === 'number' ? config.cacheTtlMs : 30000

  async function ensure(toolNames) {
    if (last.at !== 0 && Date.now() - last.at < ttl) return last.rows
    return build(toolNames)
  }

  async function build(toolNames) {
    const bundles = await listBundles()
    const allSkills = await readSkills(listSkills)
    const included = bundles.filter((bundle) => include(bundle, config))
    const modulesByBundle = new Map()
    for (const bundle of included) modulesByBundle.set(bundle.name, modulesOf(bundle))
    const modules = [...new Set([...modulesByBundle.values()].flat())]
    const raw = mapper.forModules(modules, toolNames)
    const merged = mergeModuleMaps(modules, raw, config.toolMap)
    const rows = []
    for (const bundle of included) {
      const own = modulesByBundle.get(bundle.name) ?? []
      const tools = unique(own.flatMap((moduleName) => merged[moduleName]?.tools ?? []))
      const sections = unique(own.flatMap((moduleName) => merged[moduleName]?.sections ?? []))
      const contexts = unique(own.flatMap((moduleName) => merged[moduleName]?.contexts ?? []))
      const providers = Array.isArray(config.skillProviders?.[bundle.name]) ? config.skillProviders[bundle.name] : []
      const skills =
        providers.length === 0
          ? []
          : unique(
              allSkills
                .filter((skill) => skill && providers.includes(skill.provider))
                .map((skill) => skill.name)
                .filter((name) => typeof name === 'string' && name !== ''),
            )
      const globalEnabled = bundle.enabled !== false
      const readOnly = typeof bundle.readOnlyReason === 'string' && bundle.readOnlyReason !== ''
      const hasEffects = tools.length > 0 || skills.length > 0
      const unavailableReason = readOnly
        ? 'readonly'
        : !globalEnabled
          ? 'global-disabled'
          : hasEffects
            ? null
            : own.some((moduleName) => raw[moduleName]?.reason === 'unresolved')
              ? 'unmapped'
              : 'no-tools'
      rows.push({
        name: bundle.name,
        modules: own,
        tools,
        sections,
        contexts,
        skills,
        globalEnabled,
        hideable: hasEffects && !readOnly,
        unavailableReason,
        meta: bundle.meta,
        description: bundle.description,
      })
    }
    rows.sort((left, right) => {
      if (left.globalEnabled !== right.globalEnabled) return left.globalEnabled ? -1 : 1
      return left.name.localeCompare(right.name)
    })
    last = { at: Date.now(), rows, byName: new Map(rows.map((row) => [row.name, row])) }
    return rows
  }

  async function listBundles() {
    if (pluginManager && typeof pluginManager.listBundles === 'function') {
      const value = await pluginManager.listBundles()
      if (Array.isArray(value)) return value
      throw new Error('pluginManager.listBundles() did not return an array')
    }
    return fallbackBundles(profileDir, logger)
  }

  function invalidate() {
    last = { at: 0, rows: [], byName: new Map() }
  }

  return { ensure, build, byName: () => last.byName, rows: () => last.rows, invalidate }
}

/**
 * 解析 LocalizedText：string 或 { en, 'zh-CN', ... }。
 * @param {unknown} value
 * @param {string} locale
 */
export function resolveLocalized(value, locale = 'zh-CN') {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return undefined
  const tag = String(locale || '')
  const keys = [tag, ...tag.split('-')]
  for (const key of keys) {
    const text = value[key]
    if (typeof text === 'string' && text !== '') return text
  }
  // 'zh' 也要能命中 'zh-CN' / 'zh-Hans' 这类带地区的键。
  const language = tag.toLowerCase().split('-')[0]
  if (language !== '') {
    for (const [key, text] of Object.entries(value)) {
      if (typeof text !== 'string' || text === '') continue
      if (key.toLowerCase().split('-')[0] === language) return text
    }
  }
  const english = value.en
  if (typeof english === 'string' && english !== '') return english
  for (const text of Object.values(value)) {
    if (typeof text === 'string' && text !== '') return text
  }
  return undefined
}

function include(bundle, config) {
  if (!bundle || typeof bundle !== 'object') return false
  if (bundle.installed !== true) return false
  if (bundle.name === SELF_NAME) return false
  if (!config.includeOfficial && bundle.official === true) return false
  return Array.isArray(bundle.rows) && bundle.rows.length > 0
}

function modulesOf(bundle) {
  return unique(
    bundle.rows
      .map((row) => (row && typeof row.moduleName === 'string' ? row.moduleName : ''))
      .filter((name) => name !== ''),
  )
}

function unique(values) {
  return [...new Set(values)]
}

async function readSkills(listSkills) {
  if (typeof listSkills !== 'function') return []
  try {
    const value = await listSkills()
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

function fallbackBundles(profileDir, logger) {
  try {
    const profile = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
    const names = Array.isArray(profile?.dsh?.profile?.bundles) ? profile.dsh.profile.bundles : []
    return names
      .filter((name) => typeof name === 'string' && name !== SELF_NAME)
      .map((name) => {
        let manifest = {}
        try {
          manifest = JSON.parse(readFileSync(join(profileDir, 'node_modules', ...name.split('/'), 'package.json'), 'utf8'))
        } catch {
          // 包不在 profile 里就只留名字。
        }
        return {
          name,
          installed: true,
          enabled: true,
          official: false,
          description: typeof manifest.description === 'string' ? manifest.description : undefined,
          rows: [{ moduleName: name }],
        }
      })
  } catch (error) {
    logger?.warn?.(`[session-plugin-manager] 读取 profile 插件列表失败：${String(error)}`)
    return []
  }
}
