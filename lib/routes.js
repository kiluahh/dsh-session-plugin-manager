import { fail, readJsonBody, sendJson } from './http.js'
import { resolveLocalized } from './catalog.js'

const SESSION_ID = /^session-[A-Za-z0-9-]+$/

/**
 * 三个面板接口；只做校验、状态读写与门控重放，不碰 HTTP 连接。
 * @param {{ config: { routePrefix: string }, catalog: any, state: any, restrictor: any, agents: any, tools: any, logger?: any }} options
 */
export function createRoutes(options) {
  const { catalog, state, restrictor, agents, tools, logger } = options

  const toolNames = () => tools.definitions().map((definition) => definition.name)

  async function buildState(sessionId, locale) {
    const rows = await catalog.ensure(toolNames())
    const disabled = new Set(state.get(sessionId).disabled)
    const bundles = rows.map((row) => ({
      name: row.name,
      title: resolveLocalized(row.meta?.title, locale) ?? row.name,
      description: resolveLocalized(row.meta?.description, locale) ?? row.description ?? '',
      modules: row.modules,
      tools: row.tools,
      sections: row.sections,
      skills: row.skills,
      globalEnabled: row.globalEnabled,
      hideable: row.hideable,
      unavailableReason: row.unavailableReason,
      disabled: row.globalEnabled ? disabled.has(row.name) : true,
    }))
    return {
      ok: true,
      sessionId,
      live: agents.get(sessionId) !== undefined,
      applied: restrictor.applied.has(sessionId),
      bundles,
      disabled: [...disabled],
    }
  }

  async function handleState(request, response, url) {
    const sessionId = url.searchParams.get('sessionId') ?? ''
    if (!SESSION_ID.test(sessionId)) return fail(response, 400, 'bad-request', 'invalid sessionId')
    const locale = url.searchParams.get('locale') || 'zh-CN'
    sendJson(response, 200, await buildState(sessionId, locale))
  }

  async function handleToggle(request, response) {
    const body = await readJsonBody(request)
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    const plugin = typeof body.plugin === 'string' ? body.plugin : ''
    if (!SESSION_ID.test(sessionId) || plugin === '' || plugin.length > 200 || typeof body.enabled !== 'boolean') {
      return fail(response, 400, 'bad-request', 'sessionId, plugin and boolean enabled are required')
    }
    await catalog.ensure(toolNames())
    const row = catalog.byName().get(plugin)
    if (row === undefined) return fail(response, 404, 'unknown-plugin', `unknown plugin: ${plugin}`)
    if (!row.globalEnabled || !row.hideable) {
      return fail(response, 409, 'not-hideable', `plugin ${plugin} cannot be toggled (${row.unavailableReason ?? 'unavailable'})`)
    }
    const before = state.get(sessionId).disabled
    const next = new Set(before)
    if (body.enabled === false) next.add(plugin)
    else next.delete(plugin)
    await state.set(sessionId, [...next])
    try {
      restrictor.reapply(sessionId)
    } catch (error) {
      await state.set(sessionId, before)
      logger?.warn?.(`[session-plugin-manager] 切换 ${plugin} 失败：${String(error)}`)
      return fail(response, 500, 'apply-failed', String(error?.message ?? error))
    }
    const locale = typeof body.locale === 'string' && body.locale !== '' ? body.locale : 'zh-CN'
    sendJson(response, 200, await buildState(sessionId, locale))
  }

  async function handleReset(request, response) {
    const body = await readJsonBody(request)
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    if (!SESSION_ID.test(sessionId)) return fail(response, 400, 'bad-request', 'invalid sessionId')
    await state.reset(sessionId)
    try {
      restrictor.reapply(sessionId)
    } catch (error) {
      logger?.warn?.(`[session-plugin-manager] 重置 ${sessionId} 失败：${String(error)}`)
      return fail(response, 500, 'apply-failed', String(error?.message ?? error))
    }
    const locale = typeof body.locale === 'string' && body.locale !== '' ? body.locale : 'zh-CN'
    sendJson(response, 200, await buildState(sessionId, locale))
  }

  return { buildState, handleState, handleToggle, handleReset }
}
