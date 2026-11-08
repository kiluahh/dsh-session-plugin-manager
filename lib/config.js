/** 配置默认值；所有字段都可被 profile patch 覆盖。 */
export const DEFAULTS = Object.freeze({
  stateFile: '',
  includeOfficial: false,
  toolMap: {},
  skillProviders: { '@local/dsh-superpowers': ['superpowers'] },
  scan: true,
  scanMaxFiles: 120,
  scanMaxBytes: 2 * 1024 * 1024,
  cacheTtlMs: 30000,
  routePrefix: '/dsh-session-plugin-manager',
})

/**
 * 归一化 apply(ctx, config) 收到的原始配置。
 * @param {unknown} input
 */
export function resolveConfig(input = {}) {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  return {
    stateFile: typeof raw.stateFile === 'string' ? raw.stateFile.trim() : '',
    includeOfficial: raw.includeOfficial === true,
    toolMap: normalizeToolMap(raw.toolMap),
    skillProviders: normalizeStringMap({
      ...DEFAULTS.skillProviders,
      ...(raw.skillProviders && typeof raw.skillProviders === 'object' && !Array.isArray(raw.skillProviders)
        ? raw.skillProviders
        : {}),
    }),
    scan: raw.scan !== false,
    scanMaxFiles: clamp(raw.scanMaxFiles, 1, 2000, DEFAULTS.scanMaxFiles),
    scanMaxBytes: clamp(raw.scanMaxBytes, 1024, 64 * 1024 * 1024, DEFAULTS.scanMaxBytes),
    cacheTtlMs: clamp(raw.cacheTtlMs, 0, 10 * 60 * 1000, DEFAULTS.cacheTtlMs),
    routePrefix: normalizeRoutePrefix(raw.routePrefix),
  }
}

/**
 * 只保留 module -> { tools/sections/contexts } 的形状，去重、丢掉非字符串。
 * @param {unknown} value
 */
export function normalizeToolMap(value) {
  const out = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out
  for (const [moduleName, entry] of Object.entries(value)) {
    if (typeof moduleName !== 'string' || moduleName === '') continue
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const normalized = {}
    for (const key of ['tools', 'sections', 'contexts']) {
      if (!Array.isArray(entry[key])) continue
      const names = entry[key].filter((name) => typeof name === 'string' && name !== '')
      if (names.length > 0) normalized[key] = [...new Set(names)]
    }
    if (Object.keys(normalized).length > 0) out[moduleName] = normalized
  }
  return out
}

/**
 * 路由前缀：保证前导斜杠、去掉尾部斜杠、空值回默认。
 * @param {unknown} value
 */
export function normalizeRoutePrefix(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  const base = text === '' ? DEFAULTS.routePrefix : text
  const withSlash = base.startsWith('/') ? base : '/' + base
  const trimmed = withSlash.replace(/\/+$/, '')
  return trimmed === '' ? DEFAULTS.routePrefix : trimmed
}

/**
 * 归一化「bundle 名 → 字符串数组」的映射（如 skill 提供者名）。
 * @param {unknown} value
 */
export function normalizeStringMap(value) {
  const out = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out
  for (const [key, list] of Object.entries(value)) {
    if (typeof key !== 'string' || key === '' || !Array.isArray(list)) continue
    const names = list.filter((name) => typeof name === 'string' && name !== '')
    if (names.length > 0) out[key] = [...new Set(names)]
  }
  return out
}

function clamp(value, min, max, fallback) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.floor(number)))
}
