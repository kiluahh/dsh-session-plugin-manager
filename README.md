# dsh-session-plugin-manager

Per-session plugin switches in the **DeepSeek Harness** right sidebar. Turn a plugin's model-facing surface off for **the current session only** — its tools, prompt sections, and skills disappear from that session, while other sessions and the global plugin settings stay untouched.

[中文说明](#中文说明) · MIT License · tested with DSH `0.2.2-rc.1` · [![npm version](https://img.shields.io/npm/v/dsh-session-plugin-manager.svg)](https://www.npmjs.com/package/dsh-session-plugin-manager)

---

## What it does

- Adds a **Plugins** tab to the right sidebar (and a matching card on the Start page).
- Lists plugins from `pluginManager.listBundles()`, the same source as Settings → Plugins.
- Toggling a plugin **off for this session**:
  - hides its tools from the model with `agent.ctx.tools.restrict({ deny })` — they are absent from the next request's tool definitions, so the model cannot see or call them;
  - shadows any registered prompt section/context with an empty same-name section (scoped system-prompt shadowing);
  - for skill providers declared in `skillProviders`, registers each skill as a same-name runtime skill with `modelInvocable: false, userInvocable: false` — the skill catalog omits them and `skill` refuses to load them.
- State is stored per `sessionId` at `$DSH_HOME/session-plugin-manager/state.json` and restored when the session reopens or DSH restarts.

## What it does not do

- It does **not** uninstall or stop the plugin. Background services and UI panels keep running; only the model-visible surface is removed.
- It is **not** a global switch — Settings → Plugins still owns that.
- Skill gating is per **provider**, not per individual skill.
- Plugins that contribute no tools or skills (sound effects, chat bridges, model providers) are shown greyed out.

## Requirements

- DSH with the `sidebarRightTabs` client service and the `pluginManager` host service (tested on `0.2.2-rc.1`).
- No runtime dependencies outside DSH; the code uses Node built-ins only.

## Install

### From npm

```js
plugin_manager({ action: 'install_bundle', target: 'dsh-session-plugin-manager' })
```

Published as [`dsh-session-plugin-manager`](https://www.npmjs.com/package/dsh-session-plugin-manager) on the public npm registry.

### From a local checkout

```js
plugin_manager({ action: 'install_bundle', target: 'D:\\path\\to\\dsh-session-plugin-manager' })
```

### From GitHub

```js
plugin_manager({ action: 'install_bundle', target: 'https://github.com/kiluahh/dsh-session-plugin-manager' })
```

Confirm `application: applied`, restart DSH (the host half needs it), then refresh the page so the browser half is reloaded.

## Usage

1. Open the right sidebar and click **Plugins**.
2. Flip a switch off. The row shows how many tools/skills are hidden.
3. **Restore all** clears every per-session override for the current session.

Rows under **Globally off** are disabled in Settings; enable them there first if you want per-session control.

## Languages

The panel follows the DSH language setting:

- any `zh*` locale → Chinese;
- every other language (Japanese, French, German, Russian, Portuguese, …) → English.

Resolution order is the `locale` service snapshot (`active`) → browser language → English, and the panel re-renders live when the language changes. Plugin row titles come from `dsh.meta` in `package.json` and resolve through the same language chain.

To add a translation, add a dictionary to `DICTS` in `client.js` and extend `normalizeLocale`.

## Configuration

The row `config` in `cordis.patch.yml` accepts:

| Key | Default | Meaning |
|---|---|---|
| `stateFile` | `$DSH_HOME/session-plugin-manager/state.json` | Per-session state file |
| `includeOfficial` | `false` | Also list optional official bundles |
| `toolMap` | `{}` | Module → `{ tools, sections, contexts }`, overrides source scanning |
| `skillProviders` | `{ "@local/dsh-superpowers": ["superpowers"] }` | Bundle → skill provider names; toggling the bundle shadows that whole provider |
| `scan` | `true` | Scan package sources to fill missing tool maps |
| `scanMaxFiles` | `120` | Files read per package |
| `scanMaxBytes` | `2097152` | Max bytes per file |
| `cacheTtlMs` | `30000` | Catalog cache TTL |

If a plugin shows **Tools not mapped**, add its module and tool names to `toolMap`.

## Development

```bash
node test/smoke-test.mjs
node test/client-locale.mjs
node --check index.js
node --check client.js
```

The test suite has no dependencies and runs on plain Node.

## License

MIT — see [LICENSE](LICENSE).

---

## 中文说明

在 DeepSeek Harness 的**右侧栏**加一个「插件」页签：按**当前会话**开关插件贡献的模型工具、提示词段和技能，不影响全局插件设置，也不影响其它会话。

### 它做什么

- 列表来自 `pluginManager.listBundles()`，和设置页插件列表同源。
- 关掉一个插件 = 在**当前会话**的 `agent.ctx` 上调用 `ctx.tools.restrict({ deny })`：下一轮请求的工具定义里不再出现这些工具，模型不知道它们存在，也调不到。
- 扫描到该插件注册的提示词段/上下文时，用同名空段遮蔽（DSH 支持的 scoped shadow）。
- 插件在 `skillProviders` 里登记了技能提供者时（默认 `@local/dsh-superpowers` → `superpowers`），关闭会把该 provider 名下的每个技能在当前会话注册成**同名、`modelInvocable:false`** 的 runtime skill：技能目录不再列出它们，`skill` 工具加载返回 `not available for model invocation`。
- 状态按 `sessionId` 存到 `$DSH_HOME/session-plugin-manager/state.json`；重开会话、重启 DSH 后恢复。

### 它不做什么

- 不真正卸载插件：插件进程、后台服务、UI 面板仍然存在；只摘掉模型可见的工具/段落/技能。
- 不做全局开关（设置页继续负责）。
- 技能只按 **provider 整组**遮蔽，不做单个技能勾选。
- 没有工具/技能贡献的插件（音效、机器人、模型供应商）行会置灰。

### 安装

```js
plugin_manager({ action: 'install_bundle', target: 'dsh-session-plugin-manager' }) // npm
// 或
plugin_manager({ action: 'install_bundle', target: 'D:\\path\\to\\dsh-session-plugin-manager' })
// 或
plugin_manager({ action: 'install_bundle', target: 'https://github.com/kiluahh/dsh-session-plugin-manager' })
```

npm 包名：[`dsh-session-plugin-manager`](https://www.npmjs.com/package/dsh-session-plugin-manager)。

确认 `application: applied`，重启 DSH（Host 半需要重启），刷新页面（Client bundle 需要重新取）。

### 语言

面板跟随 DSH 语言设置：`zh*` → 中文；其它语言（日/法/德/俄/葡等）→ 英文。语言切换后面板立即重渲染。插件行标题来自 `package.json` 的 `dsh.meta`。

### 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `stateFile` | `$DSH_HOME/session-plugin-manager/state.json` | 状态文件 |
| `includeOfficial` | `false` | 是否列官方可选 bundle |
| `toolMap` | `{}` | 模块名 → `{ tools, sections, contexts }`，覆盖目录扫描 |
| `skillProviders` | `{ "@local/dsh-superpowers": ["superpowers"] }` | bundle 名 → 该 bundle 的 skill provider 名；关闭时整组遮蔽这些技能 |
| `scan` | `true` | 是否扫描包源码补映射 |
| `scanMaxFiles` | `120` | 单包最多读文件数 |
| `scanMaxBytes` | `2097152` | 单文件上限 |
| `cacheTtlMs` | `30000` | 目录缓存 |

### 验证

1. 右栏出现「Plugins / 插件」页签；开始页出现对应卡片。
2. 关掉「网页工具集」→ 本会话工具列表里没有 `web_search_bing` / `web_fetch_markdown`；新会话仍有。
3. 关掉 Superpowers → 技能目录不再列出 `brainstorming` / `test-driven-development` 等；`skill` 工具返回 `not available for model invocation`。
4. 重开本会话 / 重启 DSH 后仍关闭。
5. 点「全部恢复」→ 工具和技能都回来。
6. 在设置里把语言切到 English / 日本語 / Français，右栏页签与面板文字随之变为英文。

### 开发

```bash
node test/smoke-test.mjs
node test/client-locale.mjs
```

### 许可

MIT，见 [LICENSE](LICENSE)。
