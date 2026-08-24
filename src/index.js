import { ConnectionManager, RemoteRuntimeError } from './connection-manager.js'
import { SshFileSystem, resolveRemoteEnvironment } from './remote-fs.js'
import { SshSubprocessRuntime } from './remote-subprocess.js'
import { mountRemoteExecutionRealm } from './remote-realm.js'
import { RuntimeStore } from './store.js'
import { publicServer, validateServerInput } from './utils.js'

export const name = 'dsh-remote-ssh'
export const inject = ['connection', 'agents', 'sessions', 'systemPrompt']

function sessionIdOf(agent) {
  return String(agent?.session?.id ?? agent?.id ?? '')
}

function rpcError(error, signal) {
  if (signal?.aborted) return { code: 'CANCELLED', message: '操作已取消', details: {} }
  if (error instanceof RemoteRuntimeError) return { code: error.code, message: error.message, details: error.details || {} }
  return {
    code: error?.code || 'INTERNAL',
    message: error instanceof Error ? error.message : String(error),
    details: error?.details || {},
  }
}

function registerCleanup(ctx, cleanup, label) {
  if (typeof cleanup !== 'function') return
  if (ctx.effect) ctx.effect(() => cleanup, label)
}

function serverSignature(server) {
  if (!server) return ''
  return JSON.stringify({
    id: server.id,
    host: server.host,
    port: server.port,
    username: server.username,
    auth: server.auth,
    remoteRoot: server.remoteRoot,
    hostKeyFingerprint: server.hostKeyFingerprint,
  })
}

function targetEquals(left, right) {
  if (left?.type !== right?.type) return false
  return left?.type !== 'ssh' || String(left.serverId || '') === String(right.serverId || '')
}

function hostPlatformName() {
  if (process.platform === 'win32') return 'Windows'
  if (process.platform === 'darwin') return 'macOS'
  if (process.platform === 'linux') return 'Linux'
  return process.platform
}

function targetLabel(target, server) {
  if (target?.type === 'ssh') {
    return {
      type: 'ssh',
      identity: `server:${String(target.serverId || server?.id || '')}`,
      name: String(server?.name || '服务器'),
      platform: 'Linux',
    }
  }
  return { type: 'local', identity: 'local', name: '本地电脑', platform: hostPlatformName() }
}

function latestAssistantMessageId(agent) {
  const events = agent?.session?.events
  if (!events || typeof events[Symbol.iterator] !== 'function') return undefined
  const values = Array.from(events)
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const event = values[index]
    if (event?.type !== 'assistant/message') continue
    const messageId = String(event?.data?.message?.id || '').trim()
    if (messageId) return messageId
  }
  return undefined
}

export async function apply(ctx, config = {}) {
  const store = new RuntimeStore({
    baseDir: config.stateDir || process.cwd(),
    ...(config.stateFile ? { file: config.stateFile } : {}),
  })
  await store.ready()

  // Connections are Host-scoped and pooled. Execution providers and prompt
  // context remain Agent-scoped so multiple conversations can use the same TCP
  // connection without sharing fs/subprocess service instances.
  const connections = new ConnectionManager({ connectTimeoutMs: config.connectTimeoutMs || 10_000 })
  const knownAgents = new Map()
  const running = new Set()
  const frozen = new Map()
  const realms = new Map()
  const realmOps = new Map()
  const executionContexts = new Map()

  function agentForSession(sessionId) {
    const id = String(sessionId || '')
    if (!id) return undefined
    const known = knownAgents.get(id)
    if (known) return known
    try { return ctx.agents.get(id) } catch { return undefined }
  }

  function handoffAnchor(sessionId) {
    return latestAssistantMessageId(agentForSession(sessionId))
  }

  async function appendHandoffTimelineEvent(sessionId, handoff) {
    const id = String(sessionId || '')
    if (!id || !handoff?.anchorMessageId) return
    const session = agentForSession(id)?.session
    if (!session || typeof session.append !== 'function') return
    const payload = {
      handoffId: `handoff:${handoff.generation}:${handoff.time}`,
      generation: Number(handoff.generation || 0),
      time: Number(handoff.time || Date.now()),
      from: handoff.from,
      to: handoff.to,
    }
    try {
      session.append('dsh-remote-ssh/execution-handoff', payload)
      try { await ctx.sessions?.flush?.(session) } catch (error) {
        ctx.logger?.warn?.(`DSH Remote SSH handoff timeline flush ${id}: ${String(error)}`)
      }
    } catch (error) {
      // The execution handoff itself is authoritative. A presentation-event
      // failure must never roll the session back to the previous machine.
      ctx.logger?.warn?.(`DSH Remote SSH handoff timeline append ${id}: ${String(error)}`)
    }
  }

  function pendingHandoffContext(sessionId) {
    const id = String(sessionId || '')
    if (!id) return undefined
    const acknowledged = store.getHandoffContextAckNow(id)
    const pending = store.listHandoffsNow(id)
      .filter(item => item.generation > acknowledged && item.anchorMessageId)
      .sort((left, right) => left.generation - right.generation)
    if (!pending.length) return undefined
    const first = pending[0]
    const latest = pending[pending.length - 1]
    const sameEnvironment = first.from.type === latest.to.type
      && (first.from.identity && latest.to.identity
        ? first.from.identity === latest.to.identity
        : first.from.name === latest.to.name && first.from.platform === latest.to.platform)
    return {
      generation: latest.generation,
      from: first.from,
      to: latest.to,
      sameEnvironment,
    }
  }

  function frozenTarget(sessionId) {
    return frozen.get(String(sessionId))
  }

  function desiredTarget(sessionId) {
    return frozenTarget(sessionId)?.target || store.getTargetNow(sessionId)
  }

  function desiredServer(sessionId) {
    const snapshot = frozenTarget(sessionId)
    if (snapshot?.server) return snapshot.server
    const target = store.getTargetNow(sessionId)
    return target.type === 'ssh' ? store.getServerNow(target.serverId) : undefined
  }

  function busyUsingServer(serverId) {
    for (const snapshot of frozen.values()) {
      if (snapshot.target?.type === 'ssh' && snapshot.target.serverId === serverId) return true
    }
    return false
  }

  function executionView(sessionId) {
    const id = String(sessionId)
    const agent = knownAgents.get(id)
    const target = desiredTarget(id)
    const generation = store.getGenerationNow(id)
    if (target.type === 'ssh') {
      const server = desiredServer(id)
      const current = realms.get(id)
      return {
        type: 'ssh',
        name: String(server?.name || '服务器'),
        platform: 'Linux',
        cwd: String(current?.environment?.cwd || current?.handle?.remoteRoot || server?.remoteRoot || '~'),
        generation,
      }
    }
    return {
      type: 'local',
      name: '本地电脑',
      platform: hostPlatformName(),
      cwd: String(agent?.session?.header?.cwd || process.cwd()),
      generation,
    }
  }

  function renderExecutionContext(sessionId) {
    const view = executionView(sessionId)
    // A never-switched local conversation stays byte-for-byte stock DSH. Every
    // other world contributes only CURRENT runtime facts. If an idle handoff
    // occurred after this conversation had durable assistant history, one
    // transient provenance sentence is included in the NEXT accepted model
    // step only. The following runtime-context snapshot returns to current-only
    // facts, letting DSH's own snapshot replacement semantics retire the notice.
    if (view.type === 'local' && view.generation === 0) return ''
    const lines = [
      `Current execution environment: ${JSON.stringify(view.name)}.`,
      `Operating system: ${view.platform}.`,
      `Current working directory: ${JSON.stringify(view.cwd)}.`,
      'The DSH filesystem, shell, search, and terminal tools operate in this execution environment.',
    ]
    const handoff = pendingHandoffContext(sessionId)
    if (handoff && !handoff.sameEnvironment) {
      lines.push(
        `An execution-environment handoff just occurred from ${JSON.stringify(handoff.from.name)} (${handoff.from.platform}) to ${JSON.stringify(handoff.to.name)} (${handoff.to.platform}). Earlier conversation and project context remain available, while machine-specific observations made before this handoff describe the previous execution environment.`,
      )
    }
    return lines.join(' ')
  }

  function disposeExecutionContext(sessionId) {
    const id = String(sessionId)
    const current = executionContexts.get(id)
    executionContexts.delete(id)
    if (!current) return
    for (const dispose of current.disposers) {
      try { dispose?.() } catch {}
    }
  }

  function ensureExecutionContext(agent) {
    const sessionId = sessionIdOf(agent)
    if (!sessionId) return
    const existing = executionContexts.get(sessionId)
    if (existing?.agent === agent) return
    if (existing) disposeExecutionContext(sessionId)

    const scoped = agent?.ctx
    if (!scoped?.systemPrompt?.context || typeof scoped?.on !== 'function') {
      ctx.logger?.warn?.(`DSH Remote SSH execution context ${sessionId}: scoped systemPrompt is unavailable`)
      return
    }

    const disposers = []
    try {
      disposers.push(scoped.systemPrompt.context({
        name: 'dsh-remote-ssh:execution-world',
        order: 10_000,
        text: () => renderExecutionContext(sessionId),
      }))

      // DSH's persona resolves {{cwd}} from immutable SessionHeader.cwd. Keep
      // that Session/Workspace identity untouched for sidebar/history grouping,
      // but make the model-facing cwd reflect the active execution world. This
      // is an Execution Handoff, not a Workspace mutation.
      disposers.push(scoped.on('system-prompt/assemble', async (assembly, _assembleContext, next) => {
        const transformed = await next()
        const view = executionView(sessionId)
        return {
          ...transformed,
          variables: { ...transformed.variables, cwd: view.cwd },
        }
      }))

      executionContexts.set(sessionId, { agent, disposers })
    } catch (error) {
      for (const dispose of disposers.reverse()) {
        try { dispose?.() } catch {}
      }
      ctx.logger?.warn?.(`DSH Remote SSH execution context ${sessionId}: ${String(error)}`)
    }
  }

  async function disposeRealm(sessionId) {
    const id = String(sessionId)
    const current = realms.get(id)
    realms.delete(id)
    if (!current) return
    try { await current.handle.dispose() }
    catch (error) { ctx.logger?.warn?.(`DSH Remote SSH dispose realm ${id}: ${String(error)}`) }
  }

  async function syncAgentRealm(agent) {
    const sessionId = sessionIdOf(agent)
    if (!sessionId) return
    knownAgents.set(sessionId, agent)
    ensureExecutionContext(agent)

    const previous = realmOps.get(sessionId) || Promise.resolve()
    const operation = previous.catch(() => {}).then(async () => {
      // Child/subagents inherit their parent's execution world. The child keeps
      // its own Agent service realm; only target selection is inherited.
      if (!store.hasTargetNow(sessionId)) {
        const parentSession = String(agent?.session?.header?.parentSession || '')
        if (parentSession) {
          const parentTarget = desiredTarget(parentSession)
          if (parentTarget.type === 'ssh') {
            await store.setTarget(sessionId, parentTarget)
            ctx.logger?.info?.(`DSH Remote SSH inherited execution world ${sessionId} <- ${parentSession} (${parentTarget.serverId})`)
          }
        }
      }

      const target = desiredTarget(sessionId)
      if (target.type !== 'ssh') {
        await disposeRealm(sessionId)
        return
      }
      const server = desiredServer(sessionId)
      if (!server) {
        await disposeRealm(sessionId)
        throw new Error('选择的远程服务器不存在')
      }

      const signature = serverSignature(server)
      const current = realms.get(sessionId)
      if (current?.serverId === server.id && current.signature === signature) return

      await disposeRealm(sessionId)
      const environment = await resolveRemoteEnvironment(connections, server)
      const handle = await mountRemoteExecutionRealm(agent, {
        server,
        connections,
        resolvedEnvironment: environment,
        diffBasisMaxBytes: config.diffBasisMaxBytes,
        defaultTimeoutMs: config.defaultTimeoutMs,
        maxTimeoutMs: config.maxTimeoutMs,
        maxOutputBytes: config.maxOutputBytes,
        maxSpillBytes: config.maxSpillBytes,
        graceMs: config.graceMs,
      })
      realms.set(sessionId, { serverId: server.id, signature, environment, handle })
      ctx.logger?.info?.(`DSH Remote SSH execution world ${sessionId} -> ${server.name} (${server.username}@${server.host}:${server.port}) cwd=${environment.cwd}`)
    })
    realmOps.set(sessionId, operation)
    try { await operation }
    finally { if (realmOps.get(sessionId) === operation) realmOps.delete(sessionId) }
  }

  async function syncSessionRealm(sessionId) {
    const agent = agentForSession(sessionId)
    if (agent) await syncAgentRealm(agent)
  }

  async function refreshRealmsUsingServer(serverId) {
    const tasks = []
    for (const [sessionId, agent] of knownAgents) {
      const target = desiredTarget(sessionId)
      if (target.type === 'ssh' && target.serverId === serverId) tasks.push(syncAgentRealm(agent))
    }
    await Promise.all(tasks)
  }

  ctx.on('agent/created', ({ agent }) => {
    const id = sessionIdOf(agent)
    if (id) knownAgents.set(id, agent)
    ensureExecutionContext(agent)
    // Warm composition early. agent/pre-step below is the authoritative gate.
    void syncAgentRealm(agent).catch(error => ctx.logger?.warn?.(`DSH Remote SSH initial realm ${id}: ${String(error)}`))
  })

  ctx.on('agent/session-start', ({ agent }) => {
    const id = sessionIdOf(agent)
    if (id) knownAgents.set(id, agent)
    ensureExecutionContext(agent)
    void syncAgentRealm(agent).catch(error => ctx.logger?.warn?.(`DSH Remote SSH session realm ${id}: ${String(error)}`))
  })

  ctx.on('agent/status', ({ agent, status }) => {
    const id = sessionIdOf(agent)
    if (!id) return
    knownAgents.set(id, agent)
    ensureExecutionContext(agent)
    if (status === 'running') {
      running.add(id)
      const target = store.getTargetNow(id)
      const server = target.type === 'ssh' ? store.getServerNow(target.serverId) : undefined
      frozen.set(id, {
        target: structuredClone(server ? target : { type: 'local' }),
        ...(server ? { server: structuredClone(server) } : {}),
      })
    } else {
      running.delete(id)
      frozen.delete(id)
      void syncAgentRealm(agent).catch(error => ctx.logger?.warn?.(`DSH Remote SSH idle realm ${id}: ${String(error)}`))
    }
  })

  // Composition-readiness gate plus one-shot handoff acknowledgement. DSH
  // assembles runtime context immediately before this waterfall, so the pending
  // handoff provenance has already been captured in the current assembly. Only
  // after downstream listeners ACCEPT the step do we acknowledge that generation;
  // a rejected/aborted proposal therefore cannot consume the one-shot notice.
  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    await syncAgentRealm(agent)
    const sessionId = sessionIdOf(agent)
    const pending = pendingHandoffContext(sessionId)
    const decision = await next()
    if (pending && decision.kind === 'enter' && !signal.aborted) {
      try {
        await store.acknowledgeHandoffContext(sessionId, pending.generation)
      } catch (error) {
        ctx.logger?.warn?.(`DSH Remote SSH handoff context acknowledgement ${sessionId}: ${String(error)}`)
      }
    }
    return decision
  })

  ctx.on('agent/disposed', ({ agent }) => {
    const id = sessionIdOf(agent)
    knownAgents.delete(id)
    running.delete(id)
    frozen.delete(id)
    disposeExecutionContext(id)
    void disposeRealm(id)
  })

  const stateView = sessionId => {
    const servers = store.listServersNow()
    return {
      servers,
      target: store.getTargetNow(sessionId),
      generation: store.getGenerationNow(sessionId),
      handoffs: store.listHandoffsNow(sessionId),
      execution: executionView(sessionId),
      busy: running.has(String(sessionId)),
      hostPlatform: process.platform,
      connections: connections.statusMap(servers.map(server => server.id)),
      architecture: 'provider-realm-v3',
    }
  }

  const business = async (method, payload = {}, signal) => {
    const body = payload && typeof payload === 'object' ? payload : {}
    const sessionId = body.sessionId === undefined ? '' : String(body.sessionId)

    switch (String(method)) {
      case 'state':
        if (!sessionId) throw new Error('sessionId is required')
        return stateView(sessionId)

      case 'server.test': {
        const candidate = validateServerInput(body.server, body.server?.id)
        const peer = `${candidate.username}@${candidate.host}:${candidate.port}`
        ctx.logger?.info?.(`DSH Remote SSH SSH test ${peer} start`)
        const result = await connections.test(candidate, {
          signal,
          allowFingerprint: body.allowFingerprint ? String(body.allowFingerprint) : undefined,
          onStage: stage => ctx.logger?.info?.(`DSH Remote SSH SSH test ${peer} stage=${stage}`),
        })
        ctx.logger?.info?.(`DSH Remote SSH SSH test ${peer} complete auth=${result.auth}`)
        return { ...result, server: { ...publicServer(candidate), hostKeyFingerprint: result.fingerprint } }
      }


      case 'server.testAndSave': {
        const input = body.server
        const existingId = input?.id ? String(input.id) : undefined
        if (existingId && busyUsingServer(existingId)) throw new Error('Agent 正在使用这台服务器，当前不能修改连接信息')
        const old = existingId ? store.getServerNow(existingId) : undefined
        const affected = old ? store.sessionIdsUsingServerNow(existingId) : []
        const oldSignature = serverSignature(old)
        const candidate = validateServerInput(input, existingId)
        const peer = `${candidate.username}@${candidate.host}:${candidate.port}`
        const password = candidate.auth?.type === 'password' && typeof body.password === 'string' && body.password
          ? body.password
          : undefined
        ctx.logger?.info?.(`DSH Remote SSH SSH test+save ${peer} start`)
        const result = await connections.test(candidate, {
          signal,
          password,
          allowFingerprint: body.allowFingerprint ? String(body.allowFingerprint) : undefined,
          onStage: stage => ctx.logger?.info?.(`DSH Remote SSH SSH test+save ${peer} stage=${stage}`),
        })
        const tested = { ...candidate, hostKeyFingerprint: result.fingerprint }
        const saved = await store.upsertServer(tested)
        if (old) connections.invalidate(saved.id)
        if (tested.auth?.type === 'password') {
          if (password) connections.rememberPassword(saved.id, password)
        } else {
          connections.forgetPassword(saved.id)
        }
        await refreshRealmsUsingServer(saved.id)
        const next = store.getServerNow(saved.id)
        if (old && oldSignature !== serverSignature(next)) await store.bumpGenerations(affected)
        ctx.logger?.info?.(`DSH Remote SSH SSH test+save ${peer} complete auth=${result.auth}`)
        return { ...result, server: saved }
      }

      case 'server.upsert': {
        const input = body.server
        const existingId = input?.id ? String(input.id) : undefined
        if (existingId && busyUsingServer(existingId)) throw new Error('Agent 正在使用这台服务器，当前不能修改连接信息')
        const old = existingId ? store.getServerNow(existingId) : undefined
        const affected = old ? store.sessionIdsUsingServerNow(existingId) : []
        const oldSignature = serverSignature(old)
        const saved = await store.upsertServer(input)
        if (old) connections.invalidate(saved.id)
        if (store.getServerNow(saved.id)?.auth?.type !== 'password') connections.forgetPassword(saved.id)
        await refreshRealmsUsingServer(saved.id)
        const next = store.getServerNow(saved.id)
        if (old && oldSignature !== serverSignature(next)) await store.bumpGenerations(affected)
        return { server: saved }
      }

      case 'server.remove': {
        const id = String(body.serverId || '')
        if (!id) throw new Error('serverId is required')
        if (busyUsingServer(id)) throw new Error('Agent 正在使用这台服务器，当前不能删除')
        const affected = store.sessionIdsUsingServerNow(id)
        const removedServer = store.getServerNow(id)
        const removed = await store.removeServer(id)
        connections.invalidate(id)
        connections.forgetPassword(id)
        await Promise.all(affected.map(knownSessionId => syncSessionRealm(knownSessionId)))
        if (removed && removedServer) {
          for (const affectedSessionId of affected) {
            const handoff = {
              generation: store.getGenerationNow(affectedSessionId),
              time: Date.now(),
              from: targetLabel({ type: 'ssh', serverId: id }, removedServer),
              to: targetLabel({ type: 'local' }),
              anchorMessageId: handoffAnchor(affectedSessionId),
            }
            await store.recordHandoff(affectedSessionId, handoff)
            await appendHandoffTimelineEvent(affectedSessionId, handoff)
          }
        }
        return { removed }
      }

      case 'server.reconnect': {
        const id = String(body.serverId || '')
        const server = store.getServerNow(id)
        if (!server) throw new Error('服务器不存在')
        connections.invalidate(id)
        await connections.ensure(server, { signal })
        return stateView(sessionId)
      }

      case 'target.set': {
        if (!sessionId) throw new Error('sessionId is required')
        if (running.has(sessionId)) throw new Error('Agent 正在运行，本轮执行位置已经锁定')
        const previous = store.getTargetNow(sessionId)
        const next = body.target?.type === 'ssh'
          ? { type: 'ssh', serverId: String(body.target.serverId || '') }
          : { type: 'local' }
        const server = next.type === 'ssh' ? store.getServerNow(next.serverId) : undefined
        if (next.type === 'ssh' && !server) throw new Error('选择的服务器不存在')

        // Connectivity is validated before changing the session's logical
        // execution world. The DSH Session and left-side Workspace stay intact.
        if (server) await connections.ensure(server, { signal })
        const changed = !targetEquals(previous, next)
        // The UI marker is anchored to the last durable assistant message that
        // already exists at the moment of the idle handoff. This preserves the
        // exact timeline boundary without writing a custom event into DSH's log.
        const anchorMessageId = changed ? handoffAnchor(sessionId) : undefined
        await store.setTarget(sessionId, next, { bumpGeneration: false })
        try {
          await syncSessionRealm(sessionId)
        } catch (error) {
          await store.setTarget(sessionId, previous, { bumpGeneration: false })
          await syncSessionRealm(sessionId).catch(() => {})
          throw error
        }
        if (changed) {
          const generation = await store.bumpGeneration(sessionId)
          const previousServer = previous.type === 'ssh' ? store.getServerNow(previous.serverId) : undefined
          const handoff = {
            generation,
            time: Date.now(),
            from: targetLabel(previous, previousServer),
            to: targetLabel(next, server),
            anchorMessageId,
          }
          await store.recordHandoff(sessionId, handoff)
          await appendHandoffTimelineEvent(sessionId, handoff)
        }
        ctx.logger?.info?.(`DSH Remote SSH execution handoff ${sessionId}: ${previous.type === 'ssh' ? previous.serverId : 'local'} -> ${next.type === 'ssh' ? next.serverId : 'local'} generation=${store.getGenerationNow(sessionId)}`)
        return stateView(sessionId)
      }

      default:
        throw new Error(`unknown remote runtime RPC method: ${String(method)}`)
    }
  }

  // DSH Connection owns the outer transport envelope. Domain errors stay in a
  // successful transport value so plugin-specific codes survive intact.
  const rpcHandler = async (method, payload = {}, signal) => {
    try {
      return { ok: true, value: { dshrs: 1, ok: true, value: await business(method, payload, signal) } }
    } catch (error) {
      const normalized = rpcError(error, signal)
      ctx.logger?.warn?.(`DSH Remote SSH RPC ${String(method)} failed [${normalized.code}]: ${normalized.message}`)
      return { ok: true, value: { dshrs: 1, ok: false, error: normalized } }
    }
  }

  const rpcDispose = ctx.connection.rpc.handle('/dsh-remote-ssh', rpcHandler, { authority: 'loopback' })
  registerCleanup(ctx, rpcDispose, 'DSH Remote SSH remote runtime RPC')

  if (ctx.effect) ctx.effect(() => () => {
    for (const id of [...realms.keys()]) void disposeRealm(id)
    for (const id of [...executionContexts.keys()]) disposeExecutionContext(id)
    knownAgents.clear()
    running.clear()
    frozen.clear()
    void connections.dispose()
  }, 'DSH Remote SSH remote runtime dispose')

  ctx.logger?.info?.(`DSH Remote SSH provider-realm v2 remote runtime ready; state=${store.file}`)
}

export { ConnectionManager, SshFileSystem, SshSubprocessRuntime, RuntimeStore }
