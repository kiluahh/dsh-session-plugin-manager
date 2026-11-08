import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export const STATE_VERSION = 1

/**
 * 按会话保存关闭集合的 JSON 存储（原子写、进程内串行）。
 * @param {string} filePath
 * @param {{ logger?: { warn?: (message: string) => void } }} [options]
 */
export function createStateStore(filePath, options = {}) {
  const logger = options.logger
  let cache = null
  let queue = Promise.resolve()

  function load() {
    if (cache !== null) return cache
    cache = readState(filePath, logger)
    return cache
  }

  function get(sessionId) {
    const state = load()
    const entry = state.sessions[sessionId]
    if (!entry || !Array.isArray(entry.disabled)) return { disabled: [], updatedAt: 0 }
    return {
      disabled: entry.disabled.filter((name) => typeof name === 'string' && name !== ''),
      updatedAt: typeof entry.updatedAt === 'number' ? entry.updatedAt : 0,
    }
  }

  async function save() {
    const text = JSON.stringify(cache, null, 2)
    mkdirSync(dirname(filePath), { recursive: true })
    const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
    writeFileSync(tmp, text, 'utf8')
    renameSync(tmp, filePath)
  }

  function set(sessionId, disabled) {
    const state = load()
    const unique = [
      ...new Set((Array.isArray(disabled) ? disabled : []).filter((name) => typeof name === 'string' && name !== '')),
    ]
    if (unique.length === 0) delete state.sessions[sessionId]
    else state.sessions[sessionId] = { disabled: unique, updatedAt: Date.now() }
    queue = queue.then(save, save)
    return queue
  }

  function reset(sessionId) {
    return set(sessionId, [])
  }

  return { file: filePath, get, set, reset, load }
}

function readState(filePath, logger) {
  const empty = { version: STATE_VERSION, sessions: {} }
  let text
  try {
    text = readFileSync(filePath, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return empty
    logger?.warn?.(`[session-plugin-manager] 读状态失败：${String(error)}`)
    return empty
  }
  try {
    const parsed = JSON.parse(text)
    if (
      !parsed ||
      parsed.version !== STATE_VERSION ||
      !parsed.sessions ||
      typeof parsed.sessions !== 'object' ||
      Array.isArray(parsed.sessions)
    ) {
      return empty
    }
    return { version: STATE_VERSION, sessions: parsed.sessions }
  } catch {
    const quarantine = `${filePath}.corrupt-${Date.now()}`
    try {
      renameSync(filePath, quarantine)
      logger?.warn?.(`[session-plugin-manager] 状态文件损坏，已隔离到 ${quarantine}`)
    } catch (error) {
      logger?.warn?.(`[session-plugin-manager] 状态文件损坏且无法隔离：${String(error)}`)
    }
    return empty
  }
}
