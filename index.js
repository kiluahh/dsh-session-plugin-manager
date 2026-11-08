import { homedir } from 'node:os'
import { join } from 'node:path'
import { resolveConfig } from './lib/config.js'
import { createStateStore } from './lib/state.js'
import { createToolMapper } from './lib/tool-map.js'
import { createCatalog } from './lib/catalog.js'
import { createRestrictor } from './lib/restrict.js'
import { createRoutes } from './lib/routes.js'
import { fail, isTrustedRequest } from './lib/http.js'

export const name = 'dsh-session-plugin-manager'
export const inject = ['tools', 'agents']

/**
 * 装配：状态、目录、门控、路由、Agent 生命周期。
 * @param {any} ctx
 * @param {any} input
 */
export function apply(ctx, input = {}) {
  const config = resolveConfig(input)
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const stateFile = config.stateFile || join(home, 'session-plugin-manager', 'state.json')
  const profileDir = process.env.DSH_PROFILE_DIR || join(home, 'profiles', process.env.DSH_PROFILE || 'desktop')
  const state = createStateStore(stateFile, { logger: ctx.logger })
  const mapper = createToolMapper({ profileDir, config, logger: ctx.logger })
  const pluginManager = ctx.get('pluginManager')
  const catalog = createCatalog({
    pluginManager,
    mapper,
    config,
    logger: ctx.logger,
    profileDir,
    listSkills: () => {
      const skills = ctx.get('skills')
      return skills && typeof skills.list === 'function' ? skills.list() : []
    },
  })
  const restrictor = createRestrictor({ ctx, state, catalog, logger: ctx.logger })
  const routes = createRoutes({
    config,
    catalog,
    state,
    restrictor,
    agents: ctx.agents,
    tools: ctx.tools,
    logger: ctx.logger,
  })

  const toolNames = () => ctx.tools.definitions().map((definition) => definition.name)

  async function ensureCatalog() {
    try {
      return await catalog.ensure(toolNames())
    } catch (error) {
      ctx.logger?.warn?.(`[session-plugin-manager] 读取插件目录失败：${String(error)}`)
      return []
    }
  }

  ctx.effect(() => () => restrictor.disposeAll(), 'dsh-session-plugin-manager: agent gates')

  ctx.on('agent/created', async ({ agent }) => {
    await ensureCatalog()
    try {
      restrictor.apply(agent)
    } catch (error) {
      ctx.logger?.warn?.(`[session-plugin-manager] 为 ${agent.id} 安装限制失败：${String(error)}`)
    }
  })

  ctx.on('agent/disposed', ({ agent }) => {
    restrictor.lift(agent.id)
  })

  ctx.on('plugin-manager/changed', () => {
    mapper.invalidate()
    catalog.invalidate()
    setTimeout(() => {
      ensureCatalog()
        .then(() => restrictor.applyAll())
        .catch(() => {})
    }, 200)
  })

  ensureCatalog()
    .then(() => {
      try {
        restrictor.applyAll()
      } catch (error) {
        ctx.logger?.warn?.(`[session-plugin-manager] 初始门控失败：${String(error)}`)
      }
    })
    .catch(() => {})

  ctx.inject(['webServer'], (scope) => {
    scope.effect(
      () =>
        scope.webServer.register({
          kind: 'prefix',
          path: config.routePrefix,
          handler: (request, response) => {
            return dispatch(request, response).catch((error) => {
              ctx.logger?.warn?.(`[session-plugin-manager] 请求失败：${String(error)}`)
              if (!response.headersSent) fail(response, 500, 'internal', String(error?.message ?? error))
              else response.end()
            })
          },
        }),
      'dsh-session-plugin-manager: routes',
    )
  })

  async function dispatch(request, response) {
    if (!isTrustedRequest(request)) return fail(response, 403, 'untrusted', '只接受本机同源请求')
    const url = new URL(request.url ?? '/', 'http://localhost')
    const path = url.pathname.slice(config.routePrefix.length) || '/'
    const method = (request.method ?? 'GET').toUpperCase()
    if (method === 'GET' && path === '/state') return routes.handleState(request, response, url)
    if (method === 'POST' && path === '/toggle') return routes.handleToggle(request, response)
    if (method === 'POST' && path === '/reset') return routes.handleReset(request, response)
    if (path === '/state' || path === '/toggle' || path === '/reset') {
      return fail(response, 405, 'method-not-allowed', 'method not allowed')
    }
    return fail(response, 404, 'not-found', 'not found')
  }
}
