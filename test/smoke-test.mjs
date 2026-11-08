import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolveConfig, normalizeToolMap, normalizeRoutePrefix } from '../lib/config.js'
import { isTrustedRequest, readJsonBody } from '../lib/http.js'
import { createStateStore } from '../lib/state.js'
import { createToolMapper, mergeModuleMaps, scanPackage } from '../lib/tool-map.js'
import { createCatalog, resolveLocalized } from '../lib/catalog.js'
import { createRestrictor } from '../lib/restrict.js'
import { createRoutes } from '../lib/routes.js'
import { apply as applyHost, name as hostName, inject as hostInject } from '../index.js'

const tests = []
function test(name, fn) {
  tests.push([name, fn])
}

function tempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix))
}

function fakeRequest({ address = '127.0.0.1', headers = {}, body = '', url = '/' } = {}) {
  const chunks = body === '' ? [] : [Buffer.from(body)]
  return Object.assign(Readable.from(chunks), {
    socket: { remoteAddress: address },
    headers,
    method: 'POST',
    url,
  })
}

function fakeResponse() {
  return {
    status: 0,
    body: null,
    headersSent: false,
    writeHead(status) {
      this.status = status
      this.headersSent = true
    },
    end(text) {
      this.body = JSON.parse(text)
    },
  }
}

function writePackage(root, moduleName, source) {
  const dir = join(root, 'node_modules', ...moduleName.split('/'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: moduleName, main: 'index.js' }), 'utf8')
  writeFileSync(join(dir, 'index.js'), source, 'utf8')
  mkdirSync(join(dir, 'test'), { recursive: true })
  writeFileSync(join(dir, 'test', 'fixture.js'), "const value = { name: 'alpha_tool' }", 'utf8')
  return dir
}

function fakeAgent(id) {
  const log = { restricted: [], lifted: [], sections: [], sectionLifted: [], contexts: [], contextLifted: [] }
  const scope = {
    effect(fn) {
      const cleanup = fn()
      log.effectCleanup = cleanup
      return () => cleanup()
    },
    inject(deps, callback) {
      const injected = {}
      if (deps.includes('systemPrompt')) injected.systemPrompt = scope.systemPrompt
      if (deps.includes('skills')) injected.skills = scope.skills
      callback(injected)
      return () => {}
    },
    tools: {
      restrict(filter) {
        log.restricted.push(filter)
        return () => log.lifted.push(filter)
      },
    },
    systemPrompt: {
      section(value) {
        log.sections.push(value)
        return () => log.sectionLifted.push(value.name)
      },
      context(value) {
        log.contexts.push(value)
        return () => log.contextLifted.push(value.name)
      },
    },
  }
  return { agent: { id, ctx: scope }, log }
}

function fakeCatalogRow(rows) {
  const byName = new Map(rows.map((row) => [row.name, row]))
  return { byName: () => byName }
}

function routeHarness(overrides = {}) {
  const rows = [
    {
      name: '@local/web',
      meta: { title: { 'zh-CN': '网页工具', en: 'Web' } },
      description: 'web tools',
      modules: ['@local/web'],
      tools: ['web_search_bing'],
      sections: [],
      globalEnabled: true,
      hideable: true,
      unavailableReason: null,
    },
    {
      name: '@local/skill',
      meta: {},
      description: '',
      modules: ['@local/skill'],
      tools: [],
      sections: [],
      globalEnabled: true,
      hideable: false,
      unavailableReason: 'no-tools',
    },
  ]
  const saved = new Map()
  const state = {
    get: (id) => ({ disabled: saved.get(id) ?? [] }),
    set: async (id, list) => {
      if (list.length === 0) saved.delete(id)
      else saved.set(id, list)
    },
    reset: async (id) => {
      saved.delete(id)
    },
  }
  const calls = []
  const restrictor = {
    applied: new Map(),
    reapply: (id) => {
      calls.push(id)
      if (overrides.failReapply) throw new Error('boom')
    },
  }
  const catalog = {
    ensure: async () => rows,
    byName: () => new Map(rows.map((row) => [row.name, row])),
  }
  const routes = createRoutes({
    config: { routePrefix: '/dsh-session-plugin-manager' },
    catalog,
    state,
    restrictor,
    agents: { get: (id) => (id === 'session-1' ? { id } : undefined) },
    tools: { definitions: () => [{ name: 'web_search_bing' }] },
    logger: console,
  })
  return { routes, saved, calls }
}

test('config: defaults', () => {
  const config = resolveConfig()
  assert.equal(config.includeOfficial, false)
  assert.equal(config.scan, true)
  assert.equal(config.scanMaxFiles, 120)
  assert.equal(config.scanMaxBytes, 2 * 1024 * 1024)
  assert.equal(config.cacheTtlMs, 30000)
  assert.equal(config.routePrefix, '/dsh-session-plugin-manager')
  assert.deepEqual(config.toolMap, {})
  assert.deepEqual(config.skillProviders, { '@local/dsh-superpowers': ['superpowers'] })
  assert.equal(config.stateFile, '')
})

test('config: explicit values win', () => {
  const config = resolveConfig({
    stateFile: ' C:/tmp/state.json ',
    includeOfficial: true,
    scan: false,
    scanMaxFiles: 5,
    scanMaxBytes: 2048,
    cacheTtlMs: 1000,
    routePrefix: 'plugins/',
    toolMap: { '@local/web-tools': { tools: ['web_search_bing', 'web_search_bing'] } },
    skillProviders: { '@local/other-skills': ['other'] },
  })
  assert.equal(config.stateFile, 'C:/tmp/state.json')
  assert.equal(config.includeOfficial, true)
  assert.equal(config.scan, false)
  assert.equal(config.scanMaxFiles, 5)
  assert.equal(config.routePrefix, '/plugins')
  assert.deepEqual(config.toolMap, { '@local/web-tools': { tools: ['web_search_bing'] } })
  assert.deepEqual(config.skillProviders, {
    '@local/dsh-superpowers': ['superpowers'],
    '@local/other-skills': ['other'],
  })
})

test('config: invalid values fall back', () => {
  const config = resolveConfig({
    scanMaxFiles: 'nope',
    scanMaxBytes: -1,
    cacheTtlMs: Infinity,
    routePrefix: '/',
    toolMap: ['not-an-object'],
    skillProviders: 'not-an-object',
  })
  assert.equal(config.scanMaxFiles, 120)
  assert.equal(config.scanMaxBytes, 1024)
  assert.equal(config.cacheTtlMs, 30000)
  assert.equal(config.routePrefix, '/dsh-session-plugin-manager')
  assert.deepEqual(config.toolMap, {})
  assert.deepEqual(config.skillProviders, { '@local/dsh-superpowers': ['superpowers'] })
})

test('config: normalizeToolMap drops junk', () => {
  const map = normalizeToolMap({
    mod: { tools: ['a', 2, ''], sections: ['s'], contexts: null },
    empty: { tools: [] },
    bad: 'x',
  })
  assert.deepEqual(map, { mod: { tools: ['a'], sections: ['s'] } })
})

test('config: normalizeRoutePrefix', () => {
  assert.equal(normalizeRoutePrefix(''), '/dsh-session-plugin-manager')
  assert.equal(normalizeRoutePrefix('foo'), '/foo')
  assert.equal(normalizeRoutePrefix('/foo///'), '/foo')
  assert.equal(normalizeRoutePrefix('/'), '/dsh-session-plugin-manager')
})

test('http: loopback accepted', () => {
  assert.equal(isTrustedRequest(fakeRequest()), true)
  assert.equal(isTrustedRequest(fakeRequest({ address: '::1' })), true)
  assert.equal(isTrustedRequest(fakeRequest({ address: '10.0.0.2' })), false)
})

test('http: cross-site and origin mismatch rejected', () => {
  assert.equal(
    isTrustedRequest(fakeRequest({ headers: { 'sec-fetch-site': 'cross-site', host: '127.0.0.1:8068' } })),
    false,
  )
  assert.equal(
    isTrustedRequest(fakeRequest({ headers: { origin: 'http://evil.example', host: '127.0.0.1:8068' } })),
    false,
  )
  assert.equal(
    isTrustedRequest(fakeRequest({ headers: { origin: 'http://127.0.0.1:8068', host: '127.0.0.1:8068' } })),
    true,
  )
})

test('http: readJsonBody', async () => {
  assert.deepEqual(await readJsonBody(fakeRequest({ body: '{"a":1}' })), { a: 1 })
  assert.deepEqual(await readJsonBody(fakeRequest()), {})
  await assert.rejects(() => readJsonBody(fakeRequest({ body: 'nope' })), /valid JSON/)
  await assert.rejects(
    () => readJsonBody(fakeRequest({ body: JSON.stringify({ big: 'x'.repeat(20000) }) })),
    /exceeds/,
  )
})

test('state: set/get/reset round-trip', async () => {
  const file = join(tempDir('dspm-state-'), 'state.json')
  const store = createStateStore(file)
  assert.deepEqual(store.get('session-a'), { disabled: [], updatedAt: 0 })
  await store.set('session-a', ['@local/web-tools', '@local/web-tools'])
  assert.deepEqual(store.get('session-a').disabled, ['@local/web-tools'])
  await store.reset('session-a')
  assert.deepEqual(store.get('session-a'), { disabled: [], updatedAt: 0 })

  const reopened = createStateStore(file)
  assert.deepEqual(reopened.get('session-a'), { disabled: [], updatedAt: 0 })
})

test('state: persists across instances', async () => {
  const file = join(tempDir('dspm-state-'), 'state.json')
  const store = createStateStore(file)
  await store.set('session-b', ['a', 'b'])
  const reopened = createStateStore(file)
  assert.deepEqual(reopened.get('session-b').disabled, ['a', 'b'])
})

test('state: corrupt file is quarantined', async () => {
  const dir = tempDir('dspm-state-')
  const file = join(dir, 'state.json')
  writeFileSync(file, '{not json', 'utf8')
  const store = createStateStore(file)
  assert.deepEqual(store.get('session-x'), { disabled: [], updatedAt: 0 })
  const names = readdirSync(dir)
  assert.ok(names.some((name) => name.startsWith('state.json.corrupt-')))
  assert.equal(existsSync(file), false)
})

test('state: concurrent sets serialize', async () => {
  const file = join(tempDir('dspm-state-'), 'state.json')
  const store = createStateStore(file)
  await Promise.all([
    store.set('session-1', ['a']),
    store.set('session-2', ['b']),
    store.set('session-3', ['c']),
  ])
  const parsed = JSON.parse(readFileSync(file, 'utf8'))
  assert.deepEqual(parsed.sessions['session-1'].disabled, ['a'])
  assert.deepEqual(parsed.sessions['session-2'].disabled, ['b'])
  assert.deepEqual(parsed.sessions['session-3'].disabled, ['c'])
})

test('tool-map: scans tools and prompt sections', () => {
  const root = tempDir('dspm-map-')
  writePackage(
    root,
    '@local/alpha',
    [
      "ctx.tools.register({ name: 'alpha_tool', description: 'x' })",
      "ctx.systemPrompt.section({ name: 'alpha:guide', order: 1, text: 'hello' })",
    ].join('\n'),
  )
  const mapper = createToolMapper({
    profileDir: root,
    config: { toolMap: {}, scan: true, scanMaxFiles: 120, scanMaxBytes: 2 * 1024 * 1024, cacheTtlMs: 30000 },
    logger: console,
  })
  const maps = mapper.forModules(['@local/alpha'], ['alpha_tool', 'beta_tool'])
  assert.deepEqual(maps['@local/alpha'].tools, ['alpha_tool'])
  assert.deepEqual(maps['@local/alpha'].sections, ['alpha:guide'])
  assert.equal(maps['@local/alpha'].reason, 'scanned')
})

test('tool-map: unresolved and override', () => {
  const root = tempDir('dspm-map-')
  const mapper = createToolMapper({
    profileDir: root,
    config: {
      toolMap: { '@local/manual': { tools: ['manual_tool'] } },
      scan: true,
      scanMaxFiles: 120,
      scanMaxBytes: 2 * 1024 * 1024,
      cacheTtlMs: 30000,
    },
    logger: console,
  })
  const maps = mapper.forModules(['@local/manual', '@local/missing'], ['manual_tool'])
  assert.equal(maps['@local/manual'].reason, 'override')
  assert.deepEqual(maps['@local/manual'].tools, ['manual_tool'])
  assert.equal(maps['@local/missing'].reason, 'unresolved')
})

test('tool-map: ambiguous names are dropped unless overridden', () => {
  const maps = {
    a: { tools: ['shared_tool'], sections: [], contexts: [] },
    b: { tools: ['shared_tool'], sections: [], contexts: [] },
  }
  const merged = mergeModuleMaps(['a', 'b'], maps)
  assert.deepEqual(merged.a.tools, [])
  assert.deepEqual(merged.b.tools, [])
  const kept = mergeModuleMaps(['a', 'b'], maps, { a: { tools: ['shared_tool'] } })
  assert.deepEqual(kept.a.tools, ['shared_tool'])
  assert.deepEqual(kept.b.tools, [])
})

test('tool-map: scanPackage skips ignored dirs and oversize files', () => {
  const root = tempDir('dspm-map-')
  const dir = writePackage(root, '@local/alpine', "ctx.tools.register({ name: 'alpha_tool' })")
  const names = scanPackage(dir, ['alpha_tool'], 10, 1024)
  assert.deepEqual(names.tools, ['alpha_tool'])
  const empty = scanPackage(dir, ['alpha_tool'], 10, 4)
  assert.deepEqual(empty.tools, [])
})

test('catalog: filter, tools, hideable, reasons', async () => {
  const pluginManager = {
    async listBundles() {
      return [
        {
          name: '@local/web',
          installed: true,
          enabled: true,
          official: false,
          meta: { title: { en: 'Web', 'zh-CN': '网页工具' }, description: { en: 'Web tools' } },
          rows: [{ moduleName: '@local/web' }],
        },
        { name: '@local/off', installed: true, enabled: false, official: false, rows: [{ moduleName: '@local/off' }] },
        { name: '@local/skill', installed: true, enabled: true, official: false, rows: [{ moduleName: '@local/skill' }] },
        {
          name: '@local/superpowers',
          installed: true,
          enabled: true,
          official: false,
          rows: [{ moduleName: '@local/superpowers' }],
        },
        { name: '@deepseek-ai/dsh-official', installed: true, enabled: true, official: true, rows: [{ moduleName: 'x' }] },
        { name: 'dsh-session-plugin-manager', installed: true, enabled: true, official: false, rows: [{ moduleName: 'self' }] },
        { name: '@local/no-rows', installed: true, enabled: true, official: false, rows: [] },
      ]
    },
  }
  const mapper = {
    forModules(modules) {
      const out = {}
      for (const moduleName of modules) {
        out[moduleName] =
          moduleName === '@local/web'
            ? { tools: ['web_search_bing'], sections: [], contexts: [], reason: 'scanned' }
            : { tools: [], sections: [], contexts: [], reason: 'scanned' }
      }
      return out
    },
  }
  const catalog = createCatalog({
    pluginManager,
    mapper,
    config: {
      includeOfficial: false,
      toolMap: {},
      skillProviders: { '@local/superpowers': ['superpowers'] },
    },
    logger: console,
    profileDir: tmpdir(),
    listSkills: async () => [
      { name: 'using-superpowers', provider: 'superpowers' },
      { name: 'other-skill', provider: 'filesystem' },
    ],
  })
  const rows = await catalog.ensure(['web_search_bing'])
  assert.deepEqual(rows.map((row) => row.name), [
    '@local/skill',
    '@local/superpowers',
    '@local/web',
    '@local/off',
  ])
  const web = catalog.byName().get('@local/web')
  assert.equal(web.hideable, true)
  assert.deepEqual(web.tools, ['web_search_bing'])
  const superpowers = catalog.byName().get('@local/superpowers')
  assert.equal(superpowers.hideable, true)
  assert.deepEqual(superpowers.skills, ['using-superpowers'])
  assert.equal(superpowers.unavailableReason, null)
  const off = catalog.byName().get('@local/off')
  assert.equal(off.globalEnabled, false)
  assert.equal(off.unavailableReason, 'global-disabled')
  const skill = catalog.byName().get('@local/skill')
  assert.equal(skill.hideable, false)
  assert.equal(skill.unavailableReason, 'no-tools')
  assert.equal(resolveLocalized({ en: 'Web', 'zh-CN': '网页工具' }, 'zh-CN'), '网页工具')
  assert.equal(resolveLocalized({ en: 'Web', 'zh-CN': '网页工具' }, 'zh'), '网页工具')
  assert.equal(resolveLocalized({ en: 'Web', 'zh-Hans': '网页工具' }, 'zh-CN'), '网页工具')
  assert.equal(resolveLocalized({ en: 'Web', 'zh-CN': '网页工具' }, 'ja'), 'Web')
  assert.equal(resolveLocalized({ en: 'Web', 'zh-CN': '网页工具' }, 'fr-FR'), 'Web')
  assert.equal(resolveLocalized('plain', 'en'), 'plain')
})

test('catalog: unmapped when module cannot be resolved', async () => {
  const pluginManager = {
    async listBundles() {
      return [{ name: '@local/broken', installed: true, enabled: true, official: false, rows: [{ moduleName: '@local/broken' }] }]
    },
  }
  const mapper = {
    forModules: () => ({ '@local/broken': { tools: [], sections: [], contexts: [], reason: 'unresolved' } }),
  }
  const catalog = createCatalog({
    pluginManager,
    mapper,
    config: { includeOfficial: false, toolMap: {} },
    logger: console,
    profileDir: tmpdir(),
  })
  await catalog.ensure([])
  assert.equal(catalog.byName().get('@local/broken').unavailableReason, 'unmapped')
})

test('restrict: applies deny and section shadows, then lifts', () => {
  const { agent, log } = fakeAgent('session-1')
  const state = { get: () => ({ disabled: ['@local/web', '@local/missing'] }) }
  const catalog = fakeCatalogRow([
    {
      name: '@local/web',
      globalEnabled: true,
      hideable: true,
      tools: ['web_search_bing', 'not_registered'],
      sections: ['web:guide'],
      contexts: [],
    },
  ])
  const agents = {
    get: (id) => (id === 'session-1' ? agent : undefined),
    list: () => [agent],
  }
  const restrictor = createRestrictor({
    ctx: { agents, tools: { definitions: () => [{ name: 'web_search_bing' }] } },
    state,
    catalog,
    logger: console,
  })
  restrictor.apply(agent)
  assert.deepEqual(log.restricted, [{ deny: ['web_search_bing'] }])
  assert.deepEqual(log.sections.map((section) => section.name), ['web:guide'])
  assert.equal(log.sections[0].text, '')
  restrictor.lift('session-1')
  assert.equal(log.lifted.length, 1)
  assert.equal(log.sectionLifted.length, 1)
})

test('restrict: reapply lifts previous registration', () => {
  const { agent, log } = fakeAgent('session-1')
  const state = { get: () => ({ disabled: ['@local/web'] }) }
  const catalog = fakeCatalogRow([
    { name: '@local/web', globalEnabled: true, hideable: true, tools: ['web_search_bing'], sections: [], contexts: [] },
  ])
  const restrictor = createRestrictor({
    ctx: { agents: { get: () => agent, list: () => [agent] }, tools: { definitions: () => [{ name: 'web_search_bing' }] } },
    state,
    catalog,
    logger: console,
  })
  restrictor.apply(agent)
  restrictor.apply(agent)
  assert.equal(log.lifted.length, 1)
  assert.equal(log.restricted.length, 2)
})

test('restrict: no disabled plugins registers nothing', () => {
  const { agent, log } = fakeAgent('session-1')
  const restrictor = createRestrictor({
    ctx: { agents: { get: () => agent, list: () => [agent] }, tools: { definitions: () => [] } },
    state: { get: () => ({ disabled: [] }) },
    catalog: fakeCatalogRow([]),
    logger: console,
  })
  restrictor.apply(agent)
  assert.equal(log.restricted.length, 0)
  assert.equal(log.sections.length, 0)
})

test('restrict: shadows skills for a skill-only plugin', () => {
  const { agent, log } = fakeAgent('session-2')
  log.skillRegistrations = []
  log.skillLifted = []
  agent.ctx.skills = {
    register(skill) {
      log.skillRegistrations.push(skill)
      return () => log.skillLifted.push(skill.name)
    },
  }
  const state = { get: () => ({ disabled: ['@local/superpowers'] }) }
  const catalog = fakeCatalogRow([
    {
      name: '@local/superpowers',
      globalEnabled: true,
      hideable: true,
      tools: [],
      sections: [],
      contexts: [],
      skills: ['using-superpowers'],
    },
  ])
  const restrictor = createRestrictor({
    ctx: { agents: { get: () => agent, list: () => [agent] }, tools: { definitions: () => [] } },
    state,
    catalog,
    logger: console,
  })
  restrictor.apply(agent)
  assert.equal(log.skillRegistrations.length, 1)
  assert.equal(log.skillRegistrations[0].name, 'using-superpowers')
  assert.deepEqual(log.skillRegistrations[0].invocation, { modelInvocable: false, userInvocable: false })
  restrictor.lift('session-2')
  assert.deepEqual(log.skillLifted, ['using-superpowers'])
})

test('routes: GET /state validates session and resolves locale', async () => {
  const { routes } = routeHarness()
  const response = fakeResponse()
  await routes.handleState(fakeRequest(), response, new URL('http://x/state?sessionId=session-1&locale=zh-CN'))
  assert.equal(response.status, 200)
  assert.equal(response.body.ok, true)
  assert.equal(response.body.live, true)
  assert.equal(response.body.bundles[0].title, '网页工具')
  assert.equal(response.body.bundles[0].disabled, false)

  const english = fakeResponse()
  await routes.handleState(fakeRequest(), english, new URL('http://x/state?sessionId=session-1&locale=ja'))
  assert.equal(english.body.bundles[0].title, 'Web')

  const shortChinese = fakeResponse()
  await routes.handleState(fakeRequest(), shortChinese, new URL('http://x/state?sessionId=session-1&locale=zh'))
  assert.equal(shortChinese.body.bundles[0].title, '网页工具')

  const bad = fakeResponse()
  await routes.handleState(fakeRequest(), bad, new URL('http://x/state?sessionId=oops'))
  assert.equal(bad.status, 400)
})

test('routes: toggle persists and reapplies', async () => {
  const { routes, saved, calls } = routeHarness()
  const response = fakeResponse()
  await routes.handleToggle(
    fakeRequest({ body: JSON.stringify({ sessionId: 'session-1', plugin: '@local/web', enabled: false }) }),
    response,
  )
  assert.equal(response.status, 200)
  assert.deepEqual(saved.get('session-1'), ['@local/web'])
  assert.deepEqual(calls, ['session-1'])
  assert.equal(response.body.bundles[0].disabled, true)

  const unknown = fakeResponse()
  await routes.handleToggle(
    fakeRequest({ body: JSON.stringify({ sessionId: 'session-1', plugin: '@local/nope', enabled: false }) }),
    unknown,
  )
  assert.equal(unknown.status, 404)
})

test('routes: non-hideable rejected and apply failure rolls back', async () => {
  const { routes } = routeHarness()
  const notHideable = fakeResponse()
  await routes.handleToggle(
    fakeRequest({ body: JSON.stringify({ sessionId: 'session-1', plugin: '@local/skill', enabled: false }) }),
    notHideable,
  )
  assert.equal(notHideable.status, 409)

  const failing = routeHarness({ failReapply: true })
  const response = fakeResponse()
  await failing.routes.handleToggle(
    fakeRequest({ body: JSON.stringify({ sessionId: 'session-1', plugin: '@local/web', enabled: false }) }),
    response,
  )
  assert.equal(response.status, 500)
  assert.equal(failing.saved.get('session-1'), undefined)
})

test('routes: reset clears the session', async () => {
  const { routes, saved } = routeHarness()
  await saved.set('session-1', ['@local/web'])
  const response = fakeResponse()
  await routes.handleReset(fakeRequest({ body: JSON.stringify({ sessionId: 'session-1' }) }), response)
  assert.equal(response.status, 200)
  assert.equal(saved.get('session-1'), undefined)
})

test('index: apply wires agent/created and the routes', async () => {
  const handlers = {}
  const log = { restricted: [], effects: [] }
  const agent = {
    id: 'session-1',
    ctx: {
      effect(fn) {
        const cleanup = fn()
        return () => cleanup()
      },
      tools: {
        restrict(filter) {
          log.restricted.push(filter)
          return () => {}
        },
      },
      systemPrompt: { section: () => () => {}, context: () => () => {} },
    },
  }
  let capturedRoute
  const ctx = {
    tools: { definitions: () => [{ name: 'web_search_bing' }] },
    agents: { get: (id) => (id === 'session-1' ? agent : undefined), list: () => [agent] },
    get: () => ({
      async listBundles() {
        return [
          {
            name: '@local/web',
            installed: true,
            enabled: true,
            official: false,
            meta: { title: { 'zh-CN': '网页工具' } },
            rows: [{ moduleName: '@local/web' }],
          },
        ]
      },
    }),
    effect(fn) {
      const cleanup = fn()
      log.effects.push(cleanup)
      return () => cleanup()
    },
    on(event, fn) {
      handlers[event] = fn
      return () => {}
    },
    inject(names, fn) {
      if (names.includes('webServer')) {
        fn({
          webServer: {
            register(route) {
              capturedRoute = route
              return () => {}
            },
          },
          effect(effectFn) {
            effectFn()
            return () => {}
          },
        })
      }
      return () => {}
    },
    logger: console,
  }
  assert.equal(hostName, 'dsh-session-plugin-manager')
  assert.deepEqual(hostInject, ['tools', 'agents'])
  applyHost(ctx, {
    stateFile: join(tempDir('dspm-index-'), 'state.json'),
    scan: false,
    toolMap: { '@local/web': { tools: ['web_search_bing'] } },
  })
  await new Promise((resolve) => setTimeout(resolve, 20))
  await handlers['agent/created']({ agent })
  assert.deepEqual(log.restricted, [])

  assert.ok(capturedRoute)
  const response = fakeResponse()
  await capturedRoute.handler(
    fakeRequest({
      body: JSON.stringify({ sessionId: 'session-1', plugin: '@local/web', enabled: false }),
      headers: { 'content-type': 'application/json', host: '127.0.0.1:8068' },
      url: '/dsh-session-plugin-manager/toggle',
    }),
    response,
  )
  assert.equal(response.status, 200)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.deepEqual(log.restricted, [{ deny: ['web_search_bing'] }])
})

let failed = 0
for (const [name, fn] of tests) {
  try {
    await fn()
    console.log('ok - ' + name)
  } catch (error) {
    failed += 1
    console.error('not ok - ' + name)
    console.error(error)
  }
}
if (failed > 0) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
}
console.log(`\n${tests.length} test(s) passed`)
