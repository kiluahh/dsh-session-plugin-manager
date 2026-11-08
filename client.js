/**
 * dsh-session-plugin-manager 的浏览器半：右侧栏「插件」页签。
 * 只读 Host 路由，不直接接触会话日志或工具注册表。
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-plugin-manager',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    'use strict'

    var React = require('react')
    var h = React.createElement

    var PLUGIN_ID = 'dsh-session-plugin-manager'
    var KIND = 'session-plugin-manager'
    var TYPE_ID = PLUGIN_ID + '/panel'
    var ROUTE = '/dsh-session-plugin-manager'
    var STYLE_ID = 'dsh-session-plugin-manager-style'

    var DICTS = {
      zh: {
        tab: '插件',
        guideTitle: '插件',
        guideDesc: '按会话开关插件的模型工具',
        title: '会话插件',
        subtitle: '只影响当前会话的模型工具面；插件本体仍在后台运行。',
        live: '会话中',
        stored: '未打开',
        reset: '全部恢复',
        loading: '加载中…',
        retry: '重试',
        empty: '没有可管理的插件',
        error: '加载失败',
        toggleError: '切换失败',
        tools: function (n) { return n + ' 个工具' },
        off: function (n) { return n > 0 ? '已隐藏 ' + n + ' 个工具' : '已关闭' },
        skills: function (n) { return n + ' 个技能' },
        offSkills: function (n) { return '已隐藏 ' + n + ' 个技能' },
        mixed: function (t, s) { return t + ' 个工具 · ' + s + ' 个技能' },
        offMixed: function (t, s) { return '已隐藏 ' + t + ' 个工具 / ' + s + ' 个技能' },
        noTools: '无工具/技能贡献，无法按会话关闭',
        globalOff: '全局已关闭',
        globalOffSection: '全局已关闭（先在设置页启用，才能按会话开关）',
        unmapped: '未收录工具，无法关闭',
        readonly: '只读插件',
        saved: '状态保存在本机，重开会话自动恢复。',
      },
      en: {
        tab: 'Plugins',
        guideTitle: 'Plugins',
        guideDesc: 'Turn plugin tools on or off per session',
        title: 'Session plugins',
        subtitle: 'Affects this session’s model tool surface only; the plugin itself keeps running.',
        live: 'Live',
        stored: 'Not open',
        reset: 'Restore all',
        loading: 'Loading…',
        retry: 'Retry',
        empty: 'No manageable plugins',
        error: 'Failed to load',
        toggleError: 'Toggle failed',
        tools: function (n) { return n + (n === 1 ? ' tool' : ' tools') },
        off: function (n) { return n > 0 ? n + (n === 1 ? ' tool hidden' : ' tools hidden') : 'Off' },
        skills: function (n) { return n + (n === 1 ? ' skill' : ' skills') },
        offSkills: function (n) { return n + (n === 1 ? ' skill hidden' : ' skills hidden') },
        mixed: function (t, s) { return t + ' tools · ' + s + ' skills' },
        offMixed: function (t, s) { return t + ' tools / ' + s + ' skills hidden' },
        noTools: 'No tools or skills to hide; cannot be scoped to a session',
        globalOff: 'Globally off',
        globalOffSection: 'Globally off (enable in Settings to scope them per session)',
        unmapped: 'Tools not mapped; cannot be toggled',
        readonly: 'Read-only plugin',
        saved: 'Saved on this machine; restored when the session reopens.',
      },
    }

    var CSS = [
      '.dspm-root{display:flex;flex-direction:column;gap:10px;padding:12px;height:100%;overflow:auto;font-size:12px;color:var(--dsw-alias-label-primary,#1f2329);}',
      '.dspm-head{display:flex;align-items:center;justify-content:space-between;gap:8px;}',
      '.dspm-title{font-size:13px;font-weight:600;}',
      '.dspm-chip{font-size:10.5px;padding:1px 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));color:var(--dsw-alias-label-secondary,#646a73);}',
      '.dspm-subtitle{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary,#646a73);}',
      '.dspm-list{display:flex;flex-direction:column;gap:6px;}',
      '.dspm-row{display:flex;align-items:center;gap:10px;padding:8px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:10px;background:var(--dsw-alias-bg-layer-1,#fff);}',
      '.dspm-rowMuted{opacity:.55;}',
      '.dspm-rowMain{flex:1 1 auto;min-width:0;}',
      '.dspm-rowTitle{font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.dspm-rowDesc{margin-top:2px;font-size:11px;color:var(--dsw-alias-label-secondary,#646a73);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}',
      '.dspm-rowMeta{margin-top:3px;font-size:10.5px;color:var(--dsw-alias-label-tertiary,#8f959e);}',
      '.dspm-switch{flex:0 0 auto;width:34px;height:20px;padding:0;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.15));background:var(--dsw-alias-bg-layer-2,#eef0f3);position:relative;cursor:pointer;transition:background .15s,border-color .15s;}',
      '.dspm-switch:disabled{cursor:default;opacity:1;background:var(--dsw-alias-bg-layer-3,#e5e7eb);border-color:var(--dsw-alias-border-l2,rgba(0,0,0,.18));}',
      '.dspm-switch:disabled .dspm-thumb{box-shadow:none;}',
      '.dspm-switch.dspm-switchOn:disabled{background:#c7d2fe;border-color:var(--dsw-alias-border-l2,rgba(0,0,0,.18));}',
      '.dspm-switchOn{background:var(--dsw-alias-button-info-fill,#3964fe);border-color:var(--dsw-alias-button-info-fill,#3964fe);}',
      '.dspm-thumb{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.2);transition:transform .15s;}',
      '.dspm-switchOn .dspm-thumb{transform:translateX(14px);}',
      '.dspm-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:auto;padding-top:6px;border-top:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.08));}',
      '.dspm-section{margin-top:6px;font-size:10.5px;line-height:1.4;color:var(--dsw-alias-label-tertiary,#8f959e);}',
      '.dspm-link{appearance:none;border:none;background:none;padding:0;color:var(--dsw-alias-label-info,#3964fe);font-size:11px;cursor:pointer;}',
      '.dspm-note{font-size:10.5px;color:var(--dsw-alias-label-tertiary,#8f959e);}',
      '.dspm-empty{padding:18px 6px;text-align:center;color:var(--dsw-alias-label-secondary,#646a73);font-size:11.5px;}',
      '.dspm-error{padding:6px 8px;border-radius:8px;background:var(--dsw-alias-bg-error,#fdecec);color:var(--dsw-alias-label-error,#d03050);font-size:11px;}',
    ].join('\n')

    function ensureStyles() {
      if (typeof document === 'undefined') return
      if (document.getElementById(STYLE_ID)) return
      var style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = CSS
      document.head.appendChild(style)
    }

    /**
     * 只分两档：zh* 用中文，其余（含日/法/德/俄/葡等未翻译语言）一律英文。
     * 顺序：DSH locale 快照 → 浏览器语言 → en。
     */
    function normalizeLocale(id) {
      return typeof id === 'string' && id.toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en'
    }

    function snapshotId(value) {
      if (!value || typeof value !== 'object') return ''
      if (typeof value.active === 'string') return value.active
      if (typeof value.id === 'string') return value.id
      return ''
    }

    function browserLocale() {
      try {
        var list = (typeof navigator !== 'undefined' && (navigator.languages || [navigator.language])) || []
        // 只看首选语言：浏览器按顺序回退，而本插件只支持中英两档。
        if (list.length > 0) return normalizeLocale(list[0])
      } catch {
        // 浏览器环境不可用时按英文。
      }
      return 'en'
    }

    var localeListeners = new Set()
    var currentLocale = 'en'

    function publishLocale(id) {
      var next = normalizeLocale(id)
      if (next === currentLocale) return
      currentLocale = next
      localeListeners.forEach(function (listener) {
        listener(next)
      })
    }

    /** 面板与页签标题共用的响应式语言；语言切换后立即重渲染。 */
    function useLocale() {
      var pair = React.useState(currentLocale)
      var locale = pair[0]
      var setLocale = pair[1]
      React.useEffect(function () {
        setLocale(currentLocale)
        function listener(next) {
          setLocale(next)
        }
        localeListeners.add(listener)
        return function () {
          localeListeners.delete(listener)
        }
      }, [])
      return locale
    }

    function pickDict(locale) {
      return normalizeLocale(locale) === 'zh' ? DICTS.zh : DICTS.en
    }

    function readLocale(ctx) {
      try {
        var service = ctx.get('locale')
        var snapshot =
          service && typeof service.getSnapshot === 'function'
            ? service.getSnapshot()
            : service && typeof service.getLocale === 'function'
              ? service.getLocale()
              : null
        var id = snapshotId(snapshot)
        if (id !== '') return normalizeLocale(id)
      } catch {
        // locale 服务不可用，退回浏览器语言。
      }
      return browserLocale()
    }

    function metaText(row, dict) {
      if (!row.globalEnabled) return dict.globalOff
      if (row.unavailableReason === 'readonly') return dict.readonly
      if (row.unavailableReason === 'unmapped') return dict.unmapped
      if (!row.hideable) return dict.noTools
      var tools = Array.isArray(row.tools) ? row.tools.length : 0
      var skills = Array.isArray(row.skills) ? row.skills.length : 0
      if (tools > 0 && skills > 0) return row.disabled ? dict.offMixed(tools, skills) : dict.mixed(tools, skills)
      if (skills > 0) return row.disabled ? dict.offSkills(skills) : dict.skills(skills)
      return row.disabled ? dict.off(tools) : dict.tools(tools)
    }

    function patchBundle(data, name, disabled) {
      return Object.assign({}, data, {
        bundles: (data.bundles || []).map(function (row) {
          return row.name === name ? Object.assign({}, row, { disabled: disabled }) : row
        }),
      })
    }

    function PlugIcon(props) {
      var size = (props && props.size) || 16
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        h('path', { d: 'M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0V8Z' }),
        h('path', { d: 'M12 17v4' }),
      )
    }

    function Row(props) {
      var row = props.row
      var dict = props.dict
      var available = row.globalEnabled === true && row.hideable === true
      var checked = row.globalEnabled === true && (row.hideable === true ? row.disabled !== true : true)
      var reason = metaText(row, dict)
      return h(
        'div',
        { className: 'dspm-row' + (available ? '' : ' dspm-rowMuted') },
        h(
          'div',
          { className: 'dspm-rowMain' },
          h('div', { className: 'dspm-rowTitle' }, row.title || row.name),
          row.description ? h('div', { className: 'dspm-rowDesc' }, row.description) : null,
          h('div', { className: 'dspm-rowMeta' }, reason),
        ),
        h(
          'button',
          {
            type: 'button',
            role: 'switch',
            'aria-checked': checked,
            'aria-label': row.title || row.name,
            title: reason,
            className: 'dspm-switch' + (checked ? ' dspm-switchOn' : ''),
            disabled: !available || props.busy === true,
            onClick: function () {
              if (available && props.busy !== true) props.onToggle(row)
            },
          },
          h('span', { className: 'dspm-thumb' }),
        ),
      )
    }

    function Panel(props) {
      var locale = useLocale()
      var dict = pickDict(locale)
      var sessionId = typeof props.sessionId === 'string' ? props.sessionId : ''
      var store = React.useState({ phase: 'loading', data: null, error: '', busy: {} })
      var snapshot = store[0]
      var setSnapshot = store[1]

      var load = React.useCallback(
        function (signal) {
          return fetch(
            ROUTE + '/state?sessionId=' + encodeURIComponent(sessionId) + '&locale=' + encodeURIComponent(locale),
            { signal: signal },
          )
            .then(function (response) {
              return response.json()
            })
            .then(function (data) {
              if (!data || data.ok !== true) throw new Error((data && data.error && data.error.message) || 'load failed')
              setSnapshot({ phase: 'ready', data: data, error: '', busy: {} })
            })
            .catch(function (error) {
              if (error && error.name === 'AbortError') return
              setSnapshot(function (current) {
                return {
                  phase: current.data ? 'ready' : 'error',
                  data: current.data,
                  error: String((error && error.message) || error),
                  busy: {},
                }
              })
            })
        },
        [sessionId, locale],
      )

      React.useEffect(
        function () {
          var controller = new AbortController()
          load(controller.signal)
          return function () {
            controller.abort()
          }
        },
        [load],
      )

      function toggle(row) {
        if (!row.hideable || !row.globalEnabled || snapshot.busy[row.name]) return
        var nextDisabled = !row.disabled
        setSnapshot(function (current) {
          return {
            phase: 'ready',
            data: current.data ? patchBundle(current.data, row.name, nextDisabled) : current.data,
            error: '',
            busy: Object.assign({}, current.busy, { [row.name]: true }),
          }
        })
        fetch(ROUTE + '/toggle', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: sessionId, plugin: row.name, enabled: !nextDisabled, locale: locale }),
        })
          .then(function (response) {
            return response.json()
          })
          .then(function (data) {
            if (!data || data.ok !== true) throw new Error((data && data.error && data.error.message) || 'toggle failed')
            setSnapshot({ phase: 'ready', data: data, error: '', busy: {} })
          })
          .catch(function (error) {
            setSnapshot(function (current) {
              return {
                phase: 'ready',
                data: current.data ? patchBundle(current.data, row.name, row.disabled) : current.data,
                error: String((error && error.message) || error),
                busy: {},
              }
            })
          })
      }

      function reset() {
        fetch(ROUTE + '/reset', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: sessionId, locale: locale }),
        })
          .then(function (response) {
            return response.json()
          })
          .then(function (data) {
            if (!data || data.ok !== true) throw new Error((data && data.error && data.error.message) || 'reset failed')
            setSnapshot({ phase: 'ready', data: data, error: '', busy: {} })
          })
          .catch(function (error) {
            setSnapshot(function (current) {
              return Object.assign({}, current, { error: String((error && error.message) || error) })
            })
          })
      }

      if (sessionId === '') {
        return h('div', { className: 'dspm-root' }, h('div', { className: 'dspm-empty' }, dict.empty))
      }
      if (snapshot.phase === 'loading') {
        return h('div', { className: 'dspm-root' }, h('div', { className: 'dspm-empty' }, dict.loading))
      }
      if (snapshot.phase === 'error') {
        return h(
          'div',
          { className: 'dspm-root' },
          h('div', { className: 'dspm-error' }, dict.error + ': ' + snapshot.error),
          h(
            'button',
            {
              type: 'button',
              className: 'dspm-link',
              onClick: function () {
                load()
              },
            },
            dict.retry,
          ),
        )
      }
      var data = snapshot.data
      if (!data) return null
      var rows = data.bundles || []
      var enabledRows = rows.filter(function (row) {
        return row.globalEnabled === true
      })
      var disabledRows = rows.filter(function (row) {
        return row.globalEnabled !== true
      })
      function renderRow(row) {
        return h(Row, {
          key: row.name,
          row: row,
          dict: dict,
          busy: snapshot.busy[row.name] === true,
          onToggle: toggle,
        })
      }
      return h(
        'div',
        { className: 'dspm-root' },
        h(
          'div',
          { className: 'dspm-head' },
          h('div', { className: 'dspm-title' }, dict.title),
          h('span', { className: 'dspm-chip' }, data.live ? dict.live : dict.stored),
        ),
        h('div', { className: 'dspm-subtitle' }, dict.subtitle),
        snapshot.error ? h('div', { className: 'dspm-error' }, dict.toggleError + '：' + snapshot.error) : null,
        rows.length === 0
          ? h('div', { className: 'dspm-empty' }, dict.empty)
          : h(
              'div',
              { className: 'dspm-list' },
              enabledRows.map(renderRow),
              disabledRows.length > 0 ? h('div', { className: 'dspm-section' }, dict.globalOffSection) : null,
              disabledRows.map(renderRow),
            ),
        h(
          'div',
          { className: 'dspm-foot' },
          h(
            'button',
            {
              type: 'button',
              className: 'dspm-link',
              onClick: reset,
            },
            dict.reset,
          ),
          h('span', { className: 'dspm-note' }, dict.saved),
        ),
      )
    }

    function TabTitle() {
      var dict = pickDict(useLocale())
      return h('span', null, dict.tab)
    }

    function apply(ctx) {
      ensureStyles()
      publishLocale(readLocale(ctx))
      ctx.inject(['locale'], function (injected) {
        var service = injected.get('locale')
        if (!service || typeof service.subscribe !== 'function') return undefined
        publishLocale(readLocale(ctx))
        return service.subscribe(function () {
          publishLocale(readLocale(ctx))
        })
      })
      ctx.inject(['sidebarRightTabs'], function (injected) {
        var tabs = injected.get('sidebarRightTabs')
        if (!tabs || typeof tabs.register !== 'function') {
          if (ctx.logger && typeof ctx.logger.warn === 'function') {
            ctx.logger.warn('[session-plugin-manager] sidebarRightTabs unavailable; right-sidebar tab not registered')
          }
          return undefined
        }
        var disposeType = tabs.register({
          id: TYPE_ID,
          kind: KIND,
          priority: 'extension',
          keepMounted: true,
          title: function () {
            return pickDict(currentLocale).tab
          },
          guide: [
            {
              id: 'session-plugin-manager',
              order: 41,
              title: function () {
                return pickDict(currentLocale).guideTitle
              },
              description: function () {
                return pickDict(currentLocale).guideDesc
              },
              icon: PlugIcon,
            },
          ],
        })
        var disposeBody = ctx.slots.inject('sidebar.right.pane.tab', function () {
          return ctx.slots.register(
            {
              name: 'sidebar.right.pane.tab',
              key: TYPE_ID,
              inject: function (sessionId) {
                return { sessionId: sessionId }
              },
            },
            Panel,
          )
        })
        var disposeTitle = ctx.slots.inject('sidebar.right.pane.tab.title', function () {
          return ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: TYPE_ID }, TabTitle)
        })
        return function () {
          disposeTitle()
          disposeBody()
          disposeType()
        }
      })
    }

    module.exports = {
      name: PLUGIN_ID,
      inject: ['slots'],
      apply: apply,
      _internal: {
        metaText: metaText,
        pickDict: pickDict,
        patchBundle: patchBundle,
        normalizeLocale: normalizeLocale,
        readLocale: readLocale,
        publishLocale: publishLocale,
        currentLocale: function () {
          return currentLocale
        },
      },
    }

    return module.exports
  },
})
