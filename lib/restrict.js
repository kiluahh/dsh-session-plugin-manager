/**
 * 把「本会话关闭了哪些插件」翻译成 agent.ctx 上的 restrict + 同名空段遮蔽。
 * @param {{ ctx: any, state: { get: (id: string) => { disabled: string[] } }, catalog: { byName: () => Map<string, any> }, logger?: { warn?: (m: string) => void } }} options
 */
export function createRestrictor(options) {
  const { ctx, state, catalog, logger } = options
  const agents = ctx.agents
  const applied = new Map()

  function targetFor(sessionId) {
    const disabled = state.get(sessionId).disabled
    if (disabled.length === 0) return { deny: [], sections: [], contexts: [], skills: [] }
    const byName = catalog.byName()
    const globalTools = new Set(ctx.tools.definitions().map((definition) => definition.name))
    const deny = new Set()
    const sections = new Set()
    const contexts = new Set()
    const skills = new Set()
    for (const name of disabled) {
      const row = byName.get(name)
      if (!row || row.globalEnabled !== true || row.hideable !== true) continue
      for (const tool of row.tools ?? []) if (globalTools.has(tool)) deny.add(tool)
      for (const section of row.sections ?? []) sections.add(section)
      for (const context of row.contexts ?? []) contexts.add(context)
      for (const skill of row.skills ?? []) skills.add(skill)
    }
    return { deny: [...deny], sections: [...sections], contexts: [...contexts], skills: [...skills] }
  }

  function lift(agentId) {
    const current = applied.get(agentId)
    if (current === undefined) return
    applied.delete(agentId)
    try {
      current.dispose()
    } catch (error) {
      logger?.warn?.(`[session-plugin-manager] 释放 ${agentId} 的限制失败：${String(error)}`)
    }
  }

  function apply(agent) {
    if (!agent || typeof agent.id !== 'string') return
    const target = targetFor(agent.id)
    lift(agent.id)
    if (
      target.deny.length === 0 &&
      target.sections.length === 0 &&
      target.contexts.length === 0 &&
      target.skills.length === 0
    ) {
      return
    }
    const scope = agent.ctx
    if (!scope || typeof scope.effect !== 'function') {
      throw new Error('agent.ctx.effect is unavailable; cannot install per-agent restrictions')
    }
    // agent scope 不保证 inject 了 systemPrompt/skills；用 inject 取得绑定到该 scope 的服务。
    const dispose = scope.effect(() => {
      const disposers = []
      if (target.deny.length > 0) {
        disposers.push(scope.tools.restrict({ deny: target.deny }))
      }
      if (typeof scope.inject === 'function') {
        if (target.sections.length > 0 || target.contexts.length > 0) {
          disposers.push(
            scope.inject(['systemPrompt'], (injected) => {
              for (const name of target.sections) {
                try {
                  disposers.push(injected.systemPrompt.section({ name, order: 0, text: '' }))
                } catch (error) {
                  logger?.warn?.(`[session-plugin-manager] 遮蔽提示词段 ${name} 失败：${String(error)}`)
                }
              }
              for (const name of target.contexts) {
                try {
                  disposers.push(injected.systemPrompt.context({ name, order: 0, text: '' }))
                } catch (error) {
                  logger?.warn?.(`[session-plugin-manager] 遮蔽上下文 ${name} 失败：${String(error)}`)
                }
              }
            }),
          )
        }
        if (target.skills.length > 0) {
          disposers.push(
            scope.inject(['skills'], (injected) => {
              for (const name of target.skills) {
                try {
                  disposers.push(
                    injected.skills.register({
                      name,
                      description: 'disabled for this session',
                      content: '',
                      invocation: { modelInvocable: false, userInvocable: false },
                    }),
                  )
                } catch (error) {
                  logger?.warn?.(`[session-plugin-manager] 遮蔽技能 ${name} 失败：${String(error)}`)
                }
              }
            }),
          )
        }
      }
      return () => {
        for (const disposer of disposers) {
          try {
            disposer()
          } catch {
            // 单项释放失败不应阻断其它项。
          }
        }
      }
    })
    applied.set(agent.id, {
      dispose,
      deny: target.deny,
      sections: target.sections,
      contexts: target.contexts,
      skills: target.skills,
      at: Date.now(),
    })
  }

  function reapply(sessionId) {
    const agent = agents.get(sessionId)
    if (agent !== undefined) apply(agent)
  }

  function applyAll() {
    for (const agent of agents.list()) {
      try {
        apply(agent)
      } catch (error) {
        logger?.warn?.(`[session-plugin-manager] 为 ${agent.id} 安装限制失败：${String(error)}`)
      }
    }
  }

  function disposeAll() {
    for (const agentId of [...applied.keys()]) lift(agentId)
  }

  return { apply, lift, reapply, applyAll, disposeAll, applied }
}
