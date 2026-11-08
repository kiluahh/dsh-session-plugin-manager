/**
 * 浏览器半的语言选择单测：不需要真实浏览器，只需要把模块工厂拿出来。
 * 规则：zh* → 中文；其余语言（含未翻译的 ja/fr/de/ru/pt）→ 英文。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

let captured
globalThis.window = {
  __ModuleLoader__: {
    load(options) {
      captured = options
    },
  },
}
await import('../client.js')

const ReactStub = {
  createElement: () => null,
  useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
}
const mod = captured.factory((id) => (id === 'react' ? ReactStub : {}))
const internals = mod._internal

test('normalizeLocale: 中文保留，其它语言一律英文', () => {
  assert.equal(internals.normalizeLocale('zh'), 'zh')
  assert.equal(internals.normalizeLocale('zh-CN'), 'zh')
  assert.equal(internals.normalizeLocale('zh-TW'), 'zh')
  assert.equal(internals.normalizeLocale('ZH'), 'zh')
  assert.equal(internals.normalizeLocale('en-US'), 'en')
  assert.equal(internals.normalizeLocale('ja'), 'en')
  assert.equal(internals.normalizeLocale('fr'), 'en')
  assert.equal(internals.normalizeLocale('de'), 'en')
  assert.equal(internals.normalizeLocale('ru'), 'en')
  assert.equal(internals.normalizeLocale('pt-BR'), 'en')
  assert.equal(internals.normalizeLocale(''), 'en')
  assert.equal(internals.normalizeLocale(undefined), 'en')
})

test('pickDict: 未翻译语言回退英文词典', () => {
  assert.equal(internals.pickDict('zh-CN').tab, '插件')
  assert.equal(internals.pickDict('en').tab, 'Plugins')
  assert.equal(internals.pickDict('ja').tab, 'Plugins')
  assert.equal(internals.pickDict('fr').tab, 'Plugins')
  assert.equal(internals.pickDict(undefined).tab, 'Plugins')
})

test('readLocale: 读取 DSH locale 快照的 active 字段', () => {
  function ctxWith(snapshot, method) {
    return {
      get(name) {
        if (name !== 'locale') return undefined
        return { [method]: () => snapshot }
      },
    }
  }
  assert.equal(internals.readLocale(ctxWith({ active: 'zh-CN' }, 'getSnapshot')), 'zh')
  assert.equal(internals.readLocale(ctxWith({ active: 'en' }, 'getSnapshot')), 'en')
  assert.equal(internals.readLocale(ctxWith({ active: 'ja' }, 'getSnapshot')), 'en')
  assert.equal(internals.readLocale(ctxWith({ id: 'zh-CN' }, 'getLocale')), 'zh')
  assert.equal(internals.readLocale(ctxWith({ id: 'fr' }, 'getLocale')), 'en')
})

test('readLocale: 没有 locale 服务时用浏览器语言，再退回英文', () => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { languages: ['en-US'] },
  })
  assert.equal(internals.readLocale({ get: () => undefined }), 'en')
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { languages: ['zh-CN', 'ja'] },
  })
  assert.equal(internals.readLocale({ get: () => undefined }), 'zh')
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { languages: ['ja', 'zh-CN'] },
  })
  assert.equal(internals.readLocale({ get: () => undefined }), 'en')
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { languages: ['fr-FR'] },
  })
  assert.equal(internals.readLocale({ get: () => undefined }), 'en')
})

test('publishLocale: 只广播最终的两档语言', () => {
  internals.publishLocale('zh-CN')
  assert.equal(internals.currentLocale(), 'zh')
  internals.publishLocale('de')
  assert.equal(internals.currentLocale(), 'en')
  internals.publishLocale('pt-BR')
  assert.equal(internals.currentLocale(), 'en')
})
