import { Service } from '@deepseek-ai/cordis'
import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local'
import * as FsObservationPolicy from '@deepseek-ai/dsh-fs-observation-policy'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import * as ToolFsSearch from '@deepseek-ai/dsh-tool-fs-search'
import * as ToolBash from '@deepseek-ai/dsh-tool-bash'
import { TerminalSessionService } from '@deepseek-ai/dsh-terminal'
import * as TerminalBash from '@deepseek-ai/dsh-terminal-bash'
import * as ToolTerminal from '@deepseek-ai/dsh-tool-terminal'
import { SshFileSystem } from './remote-fs.js'
import { SshSubprocessRuntime } from './remote-subprocess.js'

/**
 * Minimal policy service for a zero-install remote execution world.
 *
 * DSH's Host OS sandbox cannot confine another kernel. The current execution
 * environment's account permissions are therefore the real authority boundary.
 * We expose that fact to the official terminal stack without pretending the
 * Host workspace sandbox protects paths in this execution world.
 */
class RemoteSandboxPolicy extends Service {
  constructor(ctx, config) {
    super(ctx, 'sandboxPolicy')
    this.defaultMode = 'danger-full-access'
    this.workspaceRoot = String(config.remoteRoot || '/')
  }

  resolve(request = {}) {
    return {
      mode: request.mode || 'danger-full-access',
      workspaceRoot: this.workspaceRoot,
      ...(request.session?.id ? { sessionId: request.session.id } : {}),
    }
  }

  overrideOf() { return undefined }
}

async function mount(ctx, plugin, config) {
  const fiber = config === undefined ? ctx.plugin(plugin) : ctx.plugin(plugin, config)
  if (typeof fiber?.await === 'function') await fiber.await()
  return fiber
}

/**
 * One agent-scoped, isolated DSH execution world.
 *
 * Model-facing tools are all official DSH packages. DSH Remote SSH owns only the
 * provider seams (filesystem/subprocess) plus the policy adapter needed by the
 * official terminal stack. Transport details are intentionally absent here.
 */
export const RemoteExecutionRealm = {
  name: 'dsh-remote-ssh-execution-realm',
  inject: ['tools'],
  async apply(ctx, config) {
    const { server, connections } = config
    const environment = config.resolvedEnvironment || { home: String(server.remoteRoot || '/'), cwd: String(server.remoteRoot || '/') }
    const defaultCwd = String(environment.cwd || '/')

    // Each mounted Agent gets fresh service realm symbols. A deterministic label
    // would JOIN realms across conversations and make the second provider mount
    // collide with the first one ("service fs has been registered").
    const realm = ctx
      .isolate('fs')
      .isolate('subprocess')
      .isolate('shell')
      .isolate('terminals')
      .isolate('sandboxPolicy')

    // A Windows Host preset can inherit pwsh. A Linux execution world should
    // expose the normal official bash stack instead; this restriction changes
    // only visibility in this agent scope and does not reimplement any tool.
    if (process.platform === 'win32') {
      try {
        const disposeRestriction = realm.tools.restrict({ deny: ['pwsh'] })
        if (typeof disposeRestriction === 'function' && realm.effect) {
          realm.effect(() => disposeRestriction, 'DSH Remote SSH hide Host pwsh in Linux execution world')
        }
      } catch (error) {
        realm.logger?.debug?.(`DSH Remote SSH execution realm: inherited pwsh not present: ${String(error)}`)
      }
    }

    // Providers first.
    await mount(realm, SshFileSystem, {
      connections,
      server,
      resolvedEnvironment: environment,
      diffBasisMaxBytes: config.diffBasisMaxBytes,
    })
    await mount(realm, SshSubprocessRuntime, { connections, server })
    await mount(realm, RemoteSandboxPolicy, { remoteRoot: defaultCwd })

    // Do not add remote-specific model guidance here. The execution-world
    // providers must preserve normal DSH behavior; model context is limited to
    // the minimal handoff facts owned by src/index.js.

    // Official DSH consumers own schemas, argument validation, policy events,
    // rendering and Tool UI semantics exactly as on a normal deployment.
    await mount(realm, FsObservationPolicy)
    await mount(realm, ToolFs)
    await mount(realm, LocalBashExecutor, {
      cwd: defaultCwd,
      timeoutMs: config.defaultTimeoutMs || 120_000,
      maxTimeoutMs: config.maxTimeoutMs || 600_000,
      maxOutputBytes: config.maxOutputBytes || 64_000,
      maxSpillBytes: config.maxSpillBytes || 8 * 1024 * 1024,
      graceMs: config.graceMs || 2_000,
    })
    await mount(realm, ToolBash)
    await mount(realm, ToolFsSearch, { sampleOverCapGlobResults: true })

    // Persistent terminal is still the official DSH terminal stack. Its PTY is
    // allocated by SshSubprocessRuntime.spawnTerminal() in this same realm.
    await mount(realm, TerminalSessionService)
    await mount(realm, TerminalBash, {
      backendType: 'shell',
      shellPath: '/bin/bash',
      shellArgs: ['--noprofile', '--norc', '-i'],
    })
    await mount(realm, ToolTerminal)
  },
}

export async function mountRemoteExecutionRealm(agent, config) {
  const fiber = agent.ctx.plugin(RemoteExecutionRealm, config)
  if (typeof fiber?.await === 'function') await fiber.await()
  return {
    serverId: String(config.server.id),
    remoteRoot: String(config.resolvedEnvironment?.cwd || config.server.remoteRoot || '/'),
    remoteHome: String(config.resolvedEnvironment?.home || config.resolvedEnvironment?.cwd || config.server.remoteRoot || '/'),
    fiber,
    async dispose() {
      if (typeof fiber?.dispose === 'function') await fiber.dispose()
    },
  }
}

export const __test = { RemoteSandboxPolicy }
