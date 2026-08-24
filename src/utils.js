import { createHash, createHmac, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { posix } from 'node:path'

export function newId() {
  return `srv_${randomUUID().replaceAll('-', '').slice(0, 20)}`
}

export function looksLikeWindowsPath(value) {
  return typeof value === 'string' && (/^[A-Za-z]:[\\/]/u.test(value) || value.startsWith('\\\\'))
}

export function shellQuote(value) {
  const text = String(value)
  if (text === '') return "''"
  return `'${text.replaceAll("'", `'"'"'`)}'`
}

export function commandFromArgv(argv) {
  if (!Array.isArray(argv) || argv.length === 0) throw new Error('argv must not be empty')
  return argv.map(shellQuote).join(' ')
}

export function envPrefix(env = {}) {
  const values = []
  for (const [key, value] of Object.entries(env || {})) {
    if (value === undefined) continue
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) continue
    values.push(`${key}=${shellQuote(String(value))}`)
  }
  return values.length ? `${values.join(' ')} ` : ''
}

export function normalizeRemotePath(path, cwd, defaultCwd, home = defaultCwd) {
  const raw = String(path ?? '').trim()
  const base = cwd && !looksLikeWindowsPath(cwd) && cwd.startsWith('/')
    ? posix.normalize(cwd)
    : posix.normalize(String(defaultCwd || home || '/'))
  const resolvedHome = posix.normalize(String(home || defaultCwd || '/'))
  if (!raw) return base
  if (raw === '~') return resolvedHome
  if (raw.startsWith('~/')) return posix.join(resolvedHome, raw.slice(2))
  // DSH's immutable SessionHeader.cwd may still be a Host path after an
  // execution handoff. Treat that Host-only identity as "use the current
  // execution world's default cwd"; it is not a remote filesystem path.
  if (looksLikeWindowsPath(raw)) return posix.normalize(String(defaultCwd || resolvedHome || '/'))
  if (raw.startsWith('/')) return posix.normalize(raw)
  return posix.resolve(base, raw)
}

export function routeRemoteCwd(cwd, defaultCwd, home = defaultCwd) {
  const resolvedDefault = posix.normalize(String(defaultCwd || home || '/'))
  const resolvedHome = posix.normalize(String(home || defaultCwd || '/'))
  if (!cwd || looksLikeWindowsPath(cwd)) return resolvedDefault
  if (cwd === '~') return resolvedHome
  if (cwd.startsWith('~/')) return posix.join(resolvedHome, cwd.slice(2))
  if (cwd.startsWith('/')) return posix.normalize(cwd)
  return posix.resolve(resolvedDefault, cwd)
}

export function remoteTargetKey(serverId, path) {
  return `ywssh:${serverId}:${Buffer.from(String(path), 'utf8').toString('base64url')}`
}

export function parseRemoteTargetKey(value) {
  const text = String(value || '')
  if (!text.startsWith('ywssh:')) return undefined
  const first = text.indexOf(':', 6)
  if (first < 0) return undefined
  const serverId = text.slice(6, first)
  try {
    const path = Buffer.from(text.slice(first + 1), 'base64url').toString('utf8')
    return { serverId, path }
  } catch {
    return undefined
  }
}

export function publicServer(server) {
  if (!server) return undefined
  return {
    id: server.id,
    name: server.name,
    host: server.host,
    port: server.port,
    username: server.username,
    auth: server.auth?.type === 'key'
      ? { type: 'key', ...(server.auth.keyPath ? { keyPath: server.auth.keyPath } : {}) }
      : server.auth?.type === 'agent'
        ? { type: 'agent' }
        : server.auth?.type === 'password'
          ? { type: 'password' }
          : { type: 'auto' },
    remoteRoot: server.remoteRoot || '~',
    ...(server.hostKeyFingerprint ? { hostKeyFingerprint: server.hostKeyFingerprint } : {}),
  }
}

export function validateServerInput(input, forcedId) {
  if (!input || typeof input !== 'object') throw new Error('服务器信息无效')
  const host = String(input.host || '').trim()
  const username = String(input.username || '').trim()
  const name = String(input.name || '').trim()
  const port = Number(input.port || 22)
  if (!name) throw new Error('请输入服务器名称')
  if (!host) throw new Error('请输入服务器地址')
  if (!username) throw new Error('请输入 SSH 用户名')
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SSH 端口必须是 1-65535 之间的整数')
  const requestedAuth = String(input.auth?.type || 'auto')
  const authType = requestedAuth === 'key' ? 'key'
    : requestedAuth === 'agent' ? 'agent'
      : requestedAuth === 'password' ? 'password'
        : 'auto'
  const keyPath = authType === 'key' ? String(input.auth?.keyPath || '').trim() : ''
  return {
    id: forcedId || String(input.id || '').trim() || newId(),
    name,
    host,
    port,
    username,
    auth: authType === 'key'
      ? { type: 'key', ...(keyPath ? { keyPath } : {}) }
      : authType === 'agent'
        ? { type: 'agent' }
        : authType === 'password'
          ? { type: 'password' }
          : { type: 'auto' },
    remoteRoot: String(input.remoteRoot || '~').trim() || '~',
    ...(input.hostKeyFingerprint ? { hostKeyFingerprint: String(input.hostKeyFingerprint) } : {}),
  }
}

export function fingerprintSha256(key) {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/u, '')}`
}

export function knownHostCandidates(host, port) {
  const value = String(host)
  return Number(port) === 22 ? [value] : [`[${value}]:${Number(port)}`]
}

export function matchHashedKnownHost(token, candidate) {
  const parts = String(token).split('|')
  if (parts.length !== 4 || parts[1] !== '1') return false
  try {
    const salt = Buffer.from(parts[2], 'base64')
    const expected = Buffer.from(parts[3], 'base64')
    const actual = createHmac('sha1', salt).update(candidate).digest()
    return expected.length === actual.length && expected.equals(actual)
  } catch {
    return false
  }
}

export function defaultKnownHostsPath() {
  return join(homedir(), '.ssh', 'known_hosts')
}

export function defaultPrivateKeyPaths() {
  return ['id_ed25519', 'id_ecdsa', 'id_rsa'].map(name => join(homedir(), '.ssh', name))
}

export function isPackagedRipgrepExecutable(command) {
  const normalized = String(command || '').trim().replaceAll('\\', '/').toLowerCase()
  if (!normalized) return false
  const base = normalized.split('/').at(-1) || ''
  if (base !== 'rg' && base !== 'rg.exe') return false
  // Only adapt DSH/Host packaged coordinates. Bare `rg` and genuine remote
  // paths such as /usr/bin/rg keep normal remote-process semantics.
  return normalized.includes('/node_modules/@vscode/ripgrep')
    || normalized.includes('/node_modules/vscode-ripgrep')
    || normalized.includes('/.pnpm/@vscode+ripgrep')
}
