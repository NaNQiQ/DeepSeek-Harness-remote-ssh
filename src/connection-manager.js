import { Client } from 'ssh2'
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { defaultKnownHostsPath, defaultPrivateKeyPaths, fingerprintSha256, knownHostCandidates, matchHashedKnownHost } from './utils.js'

export class RemoteRuntimeError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'RemoteRuntimeError'
    this.code = code
    this.details = details
  }
}


function expandLocalPath(path) {
  const value = String(path || '')
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(homedir(), value.slice(2))
  return value
}

async function fileExists(path) {
  try { return (await stat(path)).isFile() } catch { return false }
}

async function loadKnownHosts(path) {
  try { return await readFile(path, 'utf8') } catch { return '' }
}

function knownHostMatcher(text, host, port) {
  const candidates = knownHostCandidates(host, port)
  const entries = []
  for (const raw of String(text || '').split(/\r?\n/u)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith('@')) continue
    const parts = line.split(/\s+/u)
    if (parts.length < 3) continue
    const [hosts, algorithm, encoded] = parts
    const match = hosts.split(',').some(token => candidates.some(candidate => token === candidate || matchHashedKnownHost(token, candidate)))
    if (!match) continue
    try { entries.push({ algorithm, key: Buffer.from(encoded, 'base64') }) } catch {}
  }
  return key => entries.some(entry => entry.key.equals(key))
}

function classifyConnectError(error, server) {
  const raw = error instanceof Error ? error.message : String(error)
  const lower = raw.toLowerCase()
  if (error?.code === 'ETIMEDOUT' || lower.includes('timed out')) {
    return new RemoteRuntimeError('NETWORK_TIMEOUT', `连接 ${server.host}:${server.port} 超时`, { raw })
  }
  if (error?.code === 'ECONNREFUSED' || lower.includes('refused')) {
    return new RemoteRuntimeError('NETWORK_REFUSED', `服务器 ${server.host}:${server.port} 拒绝了 SSH 连接`, { raw })
  }
  if (error?.code === 'ENOTFOUND' || lower.includes('getaddrinfo')) {
    return new RemoteRuntimeError('HOST_NOT_FOUND', `无法解析服务器地址 ${server.host}`, { raw })
  }
  if (lower.includes('all configured authentication methods failed') || lower.includes('authentication')) {
    return new RemoteRuntimeError('AUTH_FAILED', `SSH 身份验证失败：${server.username}@${server.host}`, { raw })
  }
  if (lower.includes('encrypted private key')) {
    return new RemoteRuntimeError('KEY_PASSPHRASE_REQUIRED', 'SSH 私钥带有口令，请先把密钥加入系统 ssh-agent', { raw })
  }
  return new RemoteRuntimeError('SSH_CONNECT_FAILED', `SSH 连接失败：${raw}`, { raw })
}

function agentCandidates() {
  const values = []
  const seen = new Set()
  const add = (agent, label) => {
    if (!agent || seen.has(agent)) return
    seen.add(agent)
    values.push({ agent, label })
  }
  add(process.env.SSH_AUTH_SOCK, 'ssh-agent')
  if (process.platform === 'win32') add('\\\\.\\pipe\\openssh-ssh-agent', 'Windows OpenSSH Agent')
  return values
}

async function authCandidates(server, password) {
  if (server.auth?.type === 'password') {
    if (!password) throw new RemoteRuntimeError('PASSWORD_REQUIRED', '这台服务器使用密码认证，请重新输入 SSH 密码')
    return [{ password, label: 'SSH password' }]
  }

  if (server.auth?.type === 'key') {
    const configuredPath = String(server.auth?.keyPath || '').trim()
    if (configuredPath) {
      const keyPath = expandLocalPath(configuredPath)
      try {
        return [{ privateKey: await readFile(keyPath), label: keyPath }]
      } catch (error) {
        throw new RemoteRuntimeError('KEY_NOT_FOUND', `无法读取私钥文件：${configuredPath}`, { raw: error?.message })
      }
    }

    const values = []
    for (const path of defaultPrivateKeyPaths()) {
      if (!await fileExists(path)) continue
      try { values.push({ privateKey: await readFile(path), label: path }) } catch {}
    }
    if (!values.length) throw new RemoteRuntimeError('KEY_NOT_FOUND', '没有找到标准 SSH 私钥（id_ed25519 / id_ecdsa / id_rsa）')
    return values
  }

  const agents = agentCandidates()
  if (server.auth?.type === 'agent') {
    if (!agents.length) throw new RemoteRuntimeError('AGENT_UNAVAILABLE', '当前 DSH Host 没有检测到可用的 SSH Agent')
    return agents
  }

  // Legacy `auto` configurations remain readable for backwards compatibility.
  // The dev.13 UI no longer creates new `auto` entries.
  const values = [...agents]
  for (const path of defaultPrivateKeyPaths()) {
    if (!await fileExists(path)) continue
    try { values.push({ privateKey: await readFile(path), label: path }) } catch {}
  }
  if (!values.length) values.push({ label: 'none' })
  return values
}

function waitAbort(signal) {
  if (!signal) return undefined
  if (signal.aborted) throw signal.reason || new Error('aborted')
}

export class ConnectionManager {
  #entries = new Map()
  #passwords = new Map()
  #knownHostsPath
  #connectTimeoutMs

  constructor(options = {}) {
    this.#knownHostsPath = options.knownHostsPath || defaultKnownHostsPath()
    this.#connectTimeoutMs = Math.max(1000, Number(options.connectTimeoutMs || 10_000))
  }

  status(serverId) {
    const entry = this.#entries.get(String(serverId))
    if (!entry) return { state: 'disconnected' }
    return {
      state: entry.state,
      since: entry.since,
      ...(entry.lastError ? { message: entry.lastError.message, code: entry.lastError.code } : {}),
    }
  }

  statusMap(serverIds) {
    return Object.fromEntries(serverIds.map(id => [id, this.status(id)]))
  }

  invalidate(serverId) {
    const id = String(serverId)
    const entry = this.#entries.get(id)
    if (!entry) return
    this.#entries.delete(id)
    try { entry.sftp?.end?.() } catch {}
    try { entry.client?.end?.() } catch {}
  }

  rememberPassword(serverId, password) {
    const id = String(serverId || '')
    if (!id) return
    const value = String(password || '')
    if (!value) return
    this.forgetPassword(id)
    this.#passwords.set(id, Buffer.from(value, 'utf8'))
  }

  forgetPassword(serverId) {
    const id = String(serverId || '')
    const secret = this.#passwords.get(id)
    if (secret) secret.fill(0)
    this.#passwords.delete(id)
  }

  hasPassword(serverId) {
    return this.#passwords.has(String(serverId || ''))
  }

  #password(serverId) {
    const secret = this.#passwords.get(String(serverId || ''))
    return secret ? secret.toString('utf8') : undefined
  }

  async dispose() {
    for (const id of [...this.#entries.keys()]) this.invalidate(id)
    for (const id of [...this.#passwords.keys()]) this.forgetPassword(id)
  }

  async #hostVerifier(server, allowFingerprint) {
    const knownText = await loadKnownHosts(this.#knownHostsPath)
    const known = knownHostMatcher(knownText, server.host, server.port)
    let observed
    return {
      verify: key => {
        observed = fingerprintSha256(key)
        if (server.hostKeyFingerprint) return observed === server.hostKeyFingerprint
        if (allowFingerprint) return observed === allowFingerprint
        return known(key)
      },
      observed: () => observed,
      knownText,
    }
  }

  async #connectOnce(server, auth, options = {}) {
    waitAbort(options.signal)
    const verifier = await this.#hostVerifier(server, options.allowFingerprint)
    const client = new Client()
    const config = {
      host: server.host,
      port: server.port,
      username: server.username,
      readyTimeout: this.#connectTimeoutMs,
      keepaliveInterval: 15_000,
      keepaliveCountMax: 3,
      hostVerifier: key => verifier.verify(key),
      ...(auth.agent ? { agent: auth.agent } : {}),
      ...(auth.privateKey ? { privateKey: auth.privateKey } : {}),
      ...(auth.password ? { password: auth.password } : {}),
    }

    return await new Promise((resolve, reject) => {
      let settled = false
      const abort = () => {
        if (settled) return
        settled = true
        try { client.end() } catch {}
        reject(new RemoteRuntimeError('CANCELLED', 'SSH 连接已取消'))
      }
      const cleanup = () => options.signal?.removeEventListener('abort', abort)
      if (options.signal) options.signal.addEventListener('abort', abort, { once: true })
      client.once('ready', () => {
        if (settled) return
        settled = true
        cleanup()
        resolve({ client, fingerprint: verifier.observed(), authLabel: auth.label })
      })
      // IMPORTANT: keep this as a persistent listener, not `once('error')`.
      // ssh2 can emit more than one error while an auth method is failing
      // (for example an Agent/socket error followed by the final
      // "All configured authentication methods failed" error). A once
      // listener consumes only the first event and the second one becomes a
      // process-fatal unhandled EventEmitter error, which kills `dsh web`.
      // After the promise has settled this listener intentionally becomes a
      // harmless guard; pooled/test connections attach their own runtime error
      // observers as well.
      client.on('error', error => {
        if (settled) return
        settled = true
        cleanup()
        const fingerprint = verifier.observed()
        if (fingerprint && !server.hostKeyFingerprint && !options.allowFingerprint) {
          reject(new RemoteRuntimeError('HOST_KEY_UNTRUSTED', '这台服务器的 SSH 指纹还没有被信任', { fingerprint, host: server.host, port: server.port }))
          return
        }
        if (fingerprint && server.hostKeyFingerprint && fingerprint !== server.hostKeyFingerprint) {
          reject(new RemoteRuntimeError('HOST_KEY_CHANGED', '服务器 SSH 指纹与已保存的指纹不一致', { expected: server.hostKeyFingerprint, fingerprint }))
          return
        }
        reject(classifyConnectError(error, server))
      })
      try { client.connect(config) } catch (error) { reject(classifyConnectError(error, server)) }
    })
  }

  async #open(server, options = {}) {
    const password = options.password || this.#password(server.id)
    const candidates = await authCandidates(server, password)
    let lastError
    for (const auth of candidates) {
      try { return await this.#connectOnce(server, auth, options) }
      catch (error) {
        lastError = error
        if (error?.code === 'HOST_KEY_UNTRUSTED' || error?.code === 'HOST_KEY_CHANGED' || error?.code === 'NETWORK_TIMEOUT' || error?.code === 'NETWORK_REFUSED' || error?.code === 'HOST_NOT_FOUND' || error?.code === 'CANCELLED') throw error
      }
    }
    if (server.auth?.type === 'agent') {
      throw new RemoteRuntimeError('AGENT_UNAVAILABLE', 'SSH Agent 不可用或 Agent 中没有可用于这台服务器的密钥', { raw: lastError?.message })
    }
    throw lastError || new RemoteRuntimeError('AUTH_FAILED', '没有可用的 SSH 登录方式')
  }

  async ensure(server, options = {}) {
    const id = String(server.id)
    let entry = this.#entries.get(id)
    if (entry?.state === 'connected' && entry.client) return entry
    if (entry?.connectPromise) return entry.connectPromise

    entry = entry || { state: 'disconnected', since: Date.now(), client: undefined, sftp: undefined, connectPromise: undefined, lastError: undefined }
    entry.state = 'connecting'
    entry.since = Date.now()
    entry.lastError = undefined
    this.#entries.set(id, entry)

    entry.connectPromise = this.#open(server, options).then(({ client, fingerprint, authLabel }) => {
      entry.client = client
      entry.state = 'connected'
      entry.since = Date.now()
      entry.fingerprint = fingerprint
      entry.authLabel = authLabel
      entry.connectPromise = undefined
      const disconnected = error => {
        if (this.#entries.get(id) !== entry) return
        entry.client = undefined
        entry.sftp = undefined
        entry.state = 'disconnected'
        entry.since = Date.now()
        if (error) entry.lastError = classifyConnectError(error, server)
      }
      client.on('close', () => disconnected())
      client.on('end', () => disconnected())
      client.on('error', error => disconnected(error))
      return entry
    }).catch(error => {
      entry.state = 'error'
      entry.since = Date.now()
      entry.lastError = error
      entry.connectPromise = undefined
      throw error
    })
    return entry.connectPromise
  }

  async test(server, options = {}) {
    const report = stage => {
      try { options.onStage?.(stage) } catch {}
    }

    report('connect:start')
    const ephemeral = await this.#open(server, { signal: options.signal, allowFingerprint: options.allowFingerprint })
    const client = ephemeral.client
    report('ssh:ready')

    // The probe connection is ephemeral, unlike pooled connections created by
    // ensure(). Keep a runtime error listener attached for the whole probe so
    // a post-ready ssh2 EventEmitter error cannot terminate the DSH Host and
    // surface in the browser only as a generic `Failed to fetch`.
    let active = true
    let rejectRuntime
    const runtimeFailure = new Promise((_, reject) => { rejectRuntime = reject })
    const onClientError = error => {
      if (!active) return
      rejectRuntime(classifyConnectError(error, server))
    }
    client.on('error', onClientError)
    const raceRuntime = promise => Promise.race([promise, runtimeFailure])

    let sftp
    let onSftpError
    try {
      sftp = await raceRuntime(new Promise((resolve, reject) =>
        client.sftp((error, value) => error ? reject(error) : resolve(value))))
      report('sftp:ready')

      // SFTP is also an EventEmitter. Observe its runtime errors explicitly; an
      // unhandled `error` event would otherwise be process-fatal in Node.js.
      onSftpError = error => {
        if (!active) return
        const raw = error instanceof Error ? error.message : String(error)
        rejectRuntime(new RemoteRuntimeError('SFTP_FAILED', `SFTP 通道异常：${raw}`, { raw }))
      }
      sftp.on?.('error', onSftpError)

      const home = await raceRuntime(new Promise((resolve, reject) =>
        sftp.realpath('.', (error, value) => error ? reject(error) : resolve(value))))
      report('sftp:realpath')

      const shell = await raceRuntime(this.#execOn(client, `printf '%s\\n' "$(uname -s 2>/dev/null || echo unknown)"; printf '%s\\n' "${'$'}{SHELL:-/bin/sh}"`, { signal: options.signal }))
      report('exec:ready')

      const result = {
        ok: true,
        fingerprint: ephemeral.fingerprint,
        home,
        os: shell.stdout.split(/\r?\n/u)[0] || 'unknown',
        shell: shell.stdout.split(/\r?\n/u)[1] || '/bin/sh',
        sftp: true,
        auth: ephemeral.authLabel,
      }
      report('success')
      return result
    } finally {
      // Keep the listeners as harmless guards until the transport has actually
      // closed. This also covers errors emitted asynchronously by client.end().
      active = false
      const cleanup = () => {
        client.off('error', onClientError)
        if (sftp && onSftpError) sftp.off?.('error', onSftpError)
      }
      client.once('close', cleanup)
      const timer = setTimeout(cleanup, 2_000)
      timer.unref?.()
      try { client.end() } catch { cleanup() }
    }
  }

  async sftp(server, options = {}) {
    const entry = await this.ensure(server, options)
    if (entry.sftp) return entry.sftp
    const promise = new Promise((resolve, reject) => entry.client.sftp((error, value) => error ? reject(error) : resolve(value)))
    entry.sftp = await promise
    entry.sftp.once?.('close', () => { if (entry.sftp) entry.sftp = undefined })
    entry.sftp.once?.('error', () => { if (entry.sftp) entry.sftp = undefined })
    return entry.sftp
  }

  async #execOn(client, command, options = {}) {
    return await new Promise((resolve, reject) => {
      client.exec(command, (error, stream) => {
        if (error) return reject(error)
        const out = []
        const err = []
        let exitCode = null
        let signal = null
        stream.on('data', chunk => out.push(Buffer.from(chunk)))
        stream.stderr?.on('data', chunk => err.push(Buffer.from(chunk)))
        stream.on('exit', (code, sig) => { exitCode = code === undefined ? null : code; signal = sig || null })
        stream.on('close', () => resolve({ exitCode, signal, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') }))
        stream.on('error', reject)
        if (options.stdin !== undefined) stream.end(options.stdin)
        else stream.end()
        if (options.signal) {
          const abort = () => { try { stream.close() } catch {} }
          if (options.signal.aborted) abort()
          else options.signal.addEventListener('abort', abort, { once: true })
        }
      })
    })
  }

  async exec(server, command, options = {}) {
    const entry = await this.ensure(server, options)
    return this.#execOn(entry.client, command, options)
  }

  async remoteHome(server, options = {}) {
    const sftp = await this.sftp(server, options)
    return await new Promise((resolve, reject) => sftp.realpath('.', (error, value) => error ? reject(error) : resolve(value)))
  }
}
