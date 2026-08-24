import { readFile } from 'node:fs/promises'
import { posix } from 'node:path'
import { PassThrough } from 'node:stream'
import { commandFromArgv, envPrefix, isPackagedRipgrepExecutable, routeRemoteCwd, shellQuote } from './utils.js'
import { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'

class Collector {
  constructor(config = {}) {
    this.maxBytes = Math.max(1, Number(config.maxBytes || 64 * 1024))
    this.total = 0
    this.baseOffset = 0
    this.buffer = Buffer.alloc(0)
    this.spillPath = undefined
  }
  push(chunk) {
    const bytes = Buffer.from(chunk)
    this.total += bytes.length
    this.buffer = Buffer.concat([this.buffer, bytes])
    if (this.buffer.length > this.maxBytes) {
      const drop = this.buffer.length - this.maxBytes
      this.buffer = this.buffer.subarray(drop)
      this.baseOffset += drop
    }
  }
  readFrom(fromByte = 0) {
    const requested = Math.max(0, Number(fromByte) || 0)
    const lossy = requested < this.baseOffset
    const effective = Math.max(requested, this.baseOffset)
    const start = Math.max(0, effective - this.baseOffset)
    return {
      text: this.buffer.subarray(start).toString('utf8'),
      nextOffset: this.total,
      lossy,
      ...(this.spillPath ? { spillPath: this.spillPath } : {}),
    }
  }
}

function outputWiring(mode) {
  if (mode === 'pipe') return { pipe: new PassThrough(), collector: undefined }
  if (mode && typeof mode === 'object') return { pipe: undefined, collector: new Collector(mode) }
  return { pipe: undefined, collector: undefined }
}

function sendOutput(kind, bytes, mode, wiring) {
  if (!bytes?.length) return
  wiring.collector?.push(bytes)
  if (mode === 'pipe') wiring.pipe.write(bytes)
  else if (mode === 'inherit') (kind === 'stdout' ? process.stdout : process.stderr).write(bytes)
}

function endOutput(wiring) { try { wiring.pipe?.end() } catch {} }

async function waitForPromise(promise, signal) {
  if (!signal) { await promise; return true }
  if (signal.aborted) return false
  return await Promise.race([
    promise.then(() => true, () => true),
    new Promise(resolve => signal.addEventListener('abort', () => resolve(false), { once: true })),
  ])
}

function normalizeSignal(value) {
  if (!value) return null
  const text = String(value).toUpperCase()
  return text.startsWith('SIG') ? text : `SIG${text}`
}

const REMOTE_RG_VERSION = '1.18.0'

function nodeArchForLinuxMachine(machine) {
  const value = String(machine || '').trim().toLowerCase()
  if (value === 'x86_64' || value === 'amd64') return 'x64'
  if (value === 'aarch64' || value === 'arm64') return 'arm64'
  if (value === 'armv7l' || value === 'armv6l' || value === 'arm') return 'arm'
  if (value === 'i386' || value === 'i486' || value === 'i586' || value === 'i686') return 'ia32'
  if (value === 'ppc64' || value === 'ppc64le') return 'ppc64'
  if (value === 'riscv64') return 'riscv64'
  if (value === 's390x') return 's390x'
  return undefined
}

function sftpStat(sftp, path) {
  return new Promise((resolve, reject) => sftp.stat(path, (error, attrs) => error ? reject(error) : resolve(attrs)))
}

function sftpWriteFile(sftp, path, bytes, signal) {
  const stream = sftp.createWriteStream(path, { flags: 'w', mode: 0o700 })
  return new Promise((resolve, reject) => {
    const abort = () => stream.destroy(new Error('aborted'))
    if (signal) {
      if (signal.aborted) abort()
      else signal.addEventListener('abort', abort, { once: true })
    }
    const cleanup = () => signal?.removeEventListener('abort', abort)
    stream.on('error', error => { cleanup(); reject(error) })
    stream.on('close', () => { cleanup(); resolve() })
    stream.end(bytes)
  })
}

async function localRipgrepAsset(arch) {
  let universal
  try { universal = await import('@vscode/ripgrep-universal') }
  catch (error) {
    throw new Error(`execution-world ripgrep asset is unavailable: @vscode/ripgrep-universal could not be loaded (${error?.message || error})`)
  }
  if (typeof universal.binPathFor !== 'function') throw new Error('execution-world ripgrep asset is unavailable: binPathFor() is missing')
  const path = universal.binPathFor({ os: 'linux', arch })
  const bytes = await readFile(path)
  return { path, bytes }
}

async function provisionRemoteRipgrep({ connections, server, environment, signal }) {
  const platform = await connections.exec(server, `uname -s 2>/dev/null || true; uname -m 2>/dev/null || true`, { signal })
  const lines = String(platform.stdout || '').split(/\r?\n/u).map(value => value.trim()).filter(Boolean)
  if (String(lines[0] || '').toLowerCase() !== 'linux') {
    throw new Error(`execution-world ripgrep asset supports Linux only (reported: ${lines[0] || 'unknown'})`)
  }
  const arch = nodeArchForLinuxMachine(lines[1])
  if (!arch) throw new Error(`execution-world ripgrep asset does not support architecture: ${lines[1] || 'unknown'}`)

  const asset = await localRipgrepAsset(arch)
  const cacheDir = posix.join(environment.home, '.cache', 'dsh-remote-ssh', 'dsh-tools', `ripgrep-${REMOTE_RG_VERSION}-${arch}`)
  const remotePath = posix.join(cacheDir, 'rg')
  const sftp = await connections.sftp(server, { signal })

  try {
    const attrs = await sftpStat(sftp, remotePath)
    if (Number(attrs?.size || -1) === asset.bytes.length && (Number(attrs?.mode || 0) & 0o111)) return remotePath
  } catch {}

  const mkdir = await connections.exec(server, `umask 077; mkdir -p -- ${shellQuote(cacheDir)}`, { signal })
  if (mkdir.exitCode !== 0) throw new Error(`failed to prepare remote DSH tool cache: ${mkdir.stderr || mkdir.stdout || 'mkdir failed'}`)

  const tempPath = `${remotePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  try {
    await sftpWriteFile(sftp, tempPath, asset.bytes, signal)
    const install = await connections.exec(server, `chmod 700 -- ${shellQuote(tempPath)} && mv -f -- ${shellQuote(tempPath)} ${shellQuote(remotePath)}`, { signal })
    if (install.exitCode !== 0) throw new Error(install.stderr || install.stdout || 'install failed')
  } catch (error) {
    await connections.exec(server, `rm -f -- ${shellQuote(tempPath)}`).catch(() => {})
    throw new Error(`failed to install execution-world ripgrep asset: ${error?.message || error}`)
  }

  const verify = await connections.exec(server, `${shellQuote(remotePath)} --version`, { signal })
  if (verify.exitCode !== 0) throw new Error(`execution-world ripgrep asset failed verification: ${verify.stderr || verify.stdout || 'unknown error'}`)
  return remotePath
}

// Packaged executables are Host coordinates until a subprocess Provider maps
// them into its own execution world. Keep that adaptation in one generic seam:
// Tool code and argv semantics stay untouched, while each managed asset only
// describes how its platform-equivalent executable is materialized.
const EXECUTION_WORLD_EXECUTABLE_RESOLVERS = [
  {
    id: 'dsh-packaged-ripgrep',
    matches: isPackagedRipgrepExecutable,
    resolve: (runtime, environment, signal) => runtime._ripgrep(environment, signal),
  },
]

function matchingExecutionWorldResolver(command) {
  return EXECUTION_WORLD_EXECUTABLE_RESOLVERS.find(resolver => resolver.matches(command))
}

function makeEnvScript(env = {}) {
  const lines = []
  for (const [key, value] of Object.entries(env || {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) continue
    if (value === undefined) lines.push(`unset ${key}`)
    else lines.push(`export ${key}=${shellQuote(String(value))}`)
  }
  return lines.join('; ')
}

function makeProcessScript(spec, cwd) {
  const env = makeEnvScript(spec.env)
  const command = commandFromArgv(spec.argv)
  return [
    'set +e',
    `cd -- ${shellQuote(cwd)} || exit 127`,
    env,
    'if command -v setsid >/dev/null 2>&1; then',
    `  setsid sh -c ${shellQuote(`exec ${command}`)} &`,
    'else',
    `  sh -c ${shellQuote(`exec ${command}`)} &`,
    'fi',
    'p=$!',
    "printf '__YWM_PID:%s\\n' \"$p\" >&2",
    'wait "$p"',
    'exit $?',
  ].filter(Boolean).join('\n')
}

export class SshSubprocessRuntime extends SubprocessRuntime {
  static inject = ['fs']

  constructor(ctx, config) {
    super(ctx)
    this.connections = config.connections
    this.remoteFs = ctx.fs
    this.server = structuredClone(config.server)
    this.runtimeState = { ripgrepPromise: undefined }
  }

  async _environment(signal) {
    return await this.remoteFs.resolvedEnvironment(signal)
  }

  async _ripgrep(environment, signal) {
    const state = this.runtimeState
    if (!state.ripgrepPromise) {
      state.ripgrepPromise = provisionRemoteRipgrep({
        connections: this.connections,
        server: this.server,
        environment,
        signal,
      }).catch(error => {
        state.ripgrepPromise = undefined
        throw error
      })
    }
    return await state.ripgrepPromise
  }

  async _executionWorldExecutable(command, environment, signal) {
    const resolver = matchingExecutionWorldResolver(command)
    if (!resolver) return undefined
    return await resolver.resolve(this, environment, signal)
  }

  async resolveExecutable(command, env, signal) {
    const environment = await this._environment(signal)
    const managed = await this._executionWorldExecutable(command, environment, signal)
    if (managed) return managed
    const raw = String(command || '')
    if (raw.includes('/') && !raw.startsWith('/')) throw new Error(`relative executable paths are unsupported in remote runtime: ${raw}`)
    // Host-owned absolute executable paths are not meaningful on a remote Linux
    // execution world. Packaged ripgrep is handled above; all other absolute
    // paths must exist on the remote server itself.
    const script = raw.startsWith('/')
      ? `test -x ${shellQuote(raw)} && printf '%s\\n' ${shellQuote(raw)}`
      : `${envPrefix(env)}command -v -- ${shellQuote(raw)}`
    const result = await this.connections.exec(this.server, script, { signal })
    if (result.exitCode !== 0) throw new Error(`remote executable not found: ${raw}`)
    return result.stdout.trim().split(/\r?\n/u).at(-1)
  }

  spawn(spec) {
    const server = this.server
    const stdout = outputWiring(spec.stdio?.stdout)
    const stderr = outputWiring(spec.stdio?.stderr)
    const stdinPipe = spec.stdio?.stdin === 'pipe' ? new PassThrough() : undefined
    let remoteStream
    let remotePid = -1
    let terminated = false
    let settled = false
    let doneResolve
    let doneReject
    const done = new Promise((resolve, reject) => { doneResolve = resolve; doneReject = reject })

    const finish = outcome => {
      if (settled) return
      settled = true
      endOutput(stdout); endOutput(stderr)
      doneResolve(outcome)
    }
    const fail = error => {
      if (settled) return
      settled = true
      endOutput(stdout); endOutput(stderr)
      doneReject(error)
    }

    const start = async () => {
      try {
        const environment = await this._environment(spec.signal)
        const argv = [...(spec.argv || [])]
        const managed = await this._executionWorldExecutable(argv[0], environment, spec.signal)
        if (managed) argv[0] = managed
        const routedSpec = { ...spec, argv }
        const entry = await this.connections.ensure(server, { signal: spec.signal })
        const cwd = routeRemoteCwd(spec.cwd, environment.cwd, environment.home)
        const script = makeProcessScript(routedSpec, cwd)
        entry.client.exec(`sh -c ${shellQuote(script)}`, (error, stream) => {
          if (error) return fail(error)
          remoteStream = stream
          let markerBuffer = ''
          stream.on('data', chunk => sendOutput('stdout', Buffer.from(chunk), spec.stdio.stdout, stdout))
          stream.stderr?.on('data', chunk => {
            const text = markerBuffer + Buffer.from(chunk).toString('utf8')
            const lines = text.split('\n')
            markerBuffer = lines.pop() || ''
            for (const line of lines) {
              const match = line.match(/^__YWM_PID:(\d+)$/u)
              if (match) remotePid = Number(match[1])
              else sendOutput('stderr', Buffer.from(`${line}\n`), spec.stdio.stderr, stderr)
            }
          })
          let exitCode = null
          let exitSignal = null
          stream.on('exit', (code, signal) => { exitCode = code === undefined ? null : code; exitSignal = normalizeSignal(signal) })
          stream.on('error', fail)
          stream.on('close', () => {
            if (markerBuffer) sendOutput('stderr', Buffer.from(markerBuffer), spec.stdio.stderr, stderr)
            finish({ exitCode, signal: exitSignal })
          })
          if (stdinPipe) stdinPipe.pipe(stream)
          else if (spec.stdio?.stdin && typeof spec.stdio.stdin === 'object') stream.end(String(spec.stdio.stdin.data ?? ''))
          else stream.end()
          if (terminated) this._terminateRemote(server, remotePid, Number(spec.graceMs || 1000)).catch(() => { try { stream.close() } catch {} })
        })
      } catch (error) { fail(error) }
    }
    void start()

    const terminate = () => {
      if (terminated || settled) return
      terminated = true
      if (remotePid > 0) this._terminateRemote(server, remotePid, Number(spec.graceMs || 1000)).catch(() => { try { remoteStream?.close?.() } catch {} })
      else { try { remoteStream?.close?.() } catch {} }
    }
    if (spec.signal) {
      if (spec.signal.aborted) terminate()
      else spec.signal.addEventListener('abort', terminate, { once: true })
      done.finally(() => spec.signal?.removeEventListener('abort', terminate)).catch(() => {})
    }

    return {
      get pid() { return remotePid },
      stdin: stdinPipe,
      stdout: spec.stdio?.stdout === 'pipe' ? stdout.pipe : undefined,
      stderr: spec.stdio?.stderr === 'pipe' ? stderr.pipe : undefined,
      collected: {
        ...(stdout.collector ? { stdout: stdout.collector } : {}),
        ...(stderr.collector ? { stderr: stderr.collector } : {}),
      },
      done,
      terminate,
      waitForExit: signal => waitForPromise(done, signal),
    }
  }

  async _terminateRemote(server, pid, graceMs) {
    if (!pid || pid < 1) return
    const graceSeconds = Math.max(1, Math.ceil(graceMs / 1000))
    const script = `kill -TERM -- -${pid} 2>/dev/null || kill -TERM ${pid} 2>/dev/null || true; i=0; while kill -0 ${pid} 2>/dev/null && [ $i -lt ${graceSeconds * 10} ]; do sleep 0.1; i=$((i+1)); done; kill -KILL -- -${pid} 2>/dev/null || kill -KILL ${pid} 2>/dev/null || true`
    await this.connections.exec(server, script).catch(() => {})
  }

  async spawnTerminal(spec) {
    const server = this.server
    const environment = await this._environment(spec.signal)
    const entry = await this.connections.ensure(server, { signal: spec.signal })
    const cwd = routeRemoteCwd(spec.cwd, environment.cwd, environment.home)
    const env = makeEnvScript(spec.env)
    const command = commandFromArgv(spec.argv)
    const marker = `__YWM_TTY_PID_${Math.random().toString(36).slice(2)}__:`
    const inner = [`cd -- ${shellQuote(cwd)} || exit 127`, env, `printf '${marker}%s\\n' "$$"`, `exec ${command}`].filter(Boolean).join('; ')

    return await new Promise((resolve, reject) => {
      const pty = {
        term: spec.term || 'xterm-256color',
        rows: Number(spec.rows || 24),
        cols: Number(spec.cols || 80),
        width: Number(spec.width || 0),
        height: Number(spec.height || 0),
      }
      entry.client.exec(`sh -c ${shellQuote(inner)}`, { pty }, (error, stream) => {
        if (error) return reject(error)
        const output = new PassThrough()
        let exitCode = null
        let exitSignal = null
        let topPid = -1
        let initial = ''
        let markerDone = false
        let terminating

        const emit = chunk => {
          if (markerDone) { output.write(Buffer.from(chunk)); return }
          initial += Buffer.from(chunk).toString('utf8')
          const index = initial.indexOf(marker)
          if (index < 0) {
            if (initial.length > 8192) { markerDone = true; output.write(Buffer.from(initial)); initial = '' }
            return
          }
          const afterMarker = initial.slice(index + marker.length)
          const end = afterMarker.indexOf('\n')
          if (end < 0) return
          topPid = Number(afterMarker.slice(0, end).replace(/\r$/u, '').trim()) || -1
          const before = initial.slice(0, index)
          const rest = afterMarker.slice(end + 1)
          markerDone = true
          initial = ''
          if (before) output.write(Buffer.from(before))
          if (rest) output.write(Buffer.from(rest))
        }

        stream.on('data', emit)
        stream.stderr?.on('data', emit)
        stream.on('exit', (code, signal) => { exitCode = code === undefined ? null : code; exitSignal = normalizeSignal(signal) })
        const done = new Promise((doneResolve, doneReject) => {
          stream.on('error', doneReject)
          stream.on('close', () => {
            if (!markerDone && initial) output.write(Buffer.from(initial))
            output.end()
            doneResolve({ exitCode, signal: exitSignal })
          })
        })

        const queryForeground = async () => {
          if (topPid < 1) return undefined
          const result = await this.connections.exec(server, `ps -o tpgid= -p ${topPid} 2>/dev/null | tr -d ' '`, { signal: undefined }).catch(() => undefined)
          const id = Number(result?.stdout?.trim())
          if (!Number.isInteger(id) || id < 1) return undefined
          return { id, inputWaiting: false }
        }

        const terminate = async () => {
          if (terminating) return terminating
          terminating = (async () => {
            const fg = await queryForeground().catch(() => undefined)
            if (fg?.id) await this.connections.exec(server, `kill -TERM -- -${fg.id} 2>/dev/null || kill -TERM ${fg.id} 2>/dev/null || true`).catch(() => {})
            if (topPid > 0) await this.connections.exec(server, `kill -TERM -- -${topPid} 2>/dev/null || kill -TERM ${topPid} 2>/dev/null || true`).catch(() => {})
            await new Promise(r => setTimeout(r, Math.min(1000, Number(spec.graceMs || 1000))))
            try { stream.close() } catch {}
            await done.catch(() => {})
          })()
          return terminating
        }

        resolve({
          get pid() { return topPid },
          output,
          done,
          async write(data) { if (!stream.destroyed) stream.write(String(data)) },
          resize: (cols, rows) => { try { stream.setWindow(Number(rows), Number(cols), 0, 0) } catch {} },
          inspectForeground: queryForeground,
          async signalForeground(signal) {
            const fg = await queryForeground()
            if (!fg) throw new Error('remote terminal foreground process group is unavailable')
            const normalized = String(signal).replace(/^SIG/u, '')
            const result = await this.connections.exec(server, `kill -${shellQuote(normalized)} -- -${fg.id}`, { signal: undefined })
            if (result.exitCode !== 0) throw new Error(`failed to signal remote foreground process group ${fg.id}`)
            return fg.id
          },
          terminate,
        })
      })
    })
  }
}

export const __test = { Collector, nodeArchForLinuxMachine, makeProcessScript }
