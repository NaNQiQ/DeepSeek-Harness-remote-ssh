import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { publicServer, validateServerInput } from './utils.js'

const SCHEMA_VERSION = 8
const localTarget = () => ({ type: 'local' })

function normalizeTarget(target) {
  if (target?.type === 'ssh' && typeof target.serverId === 'string' && target.serverId) {
    return { type: 'ssh', serverId: target.serverId }
  }
  return localTarget()
}

function targetsEqual(left, right) {
  const a = normalizeTarget(left)
  const b = normalizeTarget(right)
  return a.type === b.type && (a.type !== 'ssh' || a.serverId === b.serverId)
}

function normalizeGeneration(value) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= 0 ? number : 0
}

function normalizeHandoff(value) {
  if (!value || typeof value !== 'object') return undefined
  const generation = normalizeGeneration(value.generation)
  const time = Number(value.time)
  const normalizeSide = side => {
    if (!side || typeof side !== 'object') return undefined
    const type = side.type === 'ssh' ? 'ssh' : 'local'
    const identity = String(side.identity || '').trim()
    const name = String(side.name || (type === 'local' ? '本地电脑' : '')).trim()
    const platform = String(side.platform || '').trim()
    if (!name || !platform) return undefined
    return { type, ...(identity ? { identity } : {}), name, platform }
  }
  const from = normalizeSide(value.from)
  const to = normalizeSide(value.to)
  const anchorMessageId = String(value.anchorMessageId || '').trim()
  if (!generation || !Number.isFinite(time) || !from || !to) return undefined
  return { generation, time, from, to, ...(anchorMessageId ? { anchorMessageId } : {}) }
}

export class RuntimeStore {
  #file
  #legacyFiles
  #state = { version: SCHEMA_VERSION, servers: [], selectedBySession: {}, generationBySession: {}, handoffsBySession: {}, handoffContextAckBySession: {} }
  #ready
  #writeChain = Promise.resolve()

  constructor(options = {}) {
    const base = resolve(options.baseDir || process.cwd())
    this.#file = options.file || join(base, '.dsh-remote-ssh', 'state.json')
    this.#legacyFiles = options.legacyFiles || [
      join(base, '.ywmanager', 'remote-runtime.json'),
      join(base, '.ywmanager', 'remote-ssh.json'),
    ]
    this.#ready = this.#load()
  }

  get file() { return this.#file }
  async ready() { await this.#ready }

  async #readJson(path) {
    try { return JSON.parse(await readFile(path, 'utf8')) }
    catch (error) { if (error?.code === 'ENOENT') return undefined; throw error }
  }

  async #load() {
    let raw = await this.#readJson(this.#file)
    let migrated = false
    if (!raw) {
      for (const file of this.#legacyFiles) {
        raw = await this.#readJson(file)
        if (raw) { migrated = true; break }
      }
    }
    if (!raw) return
    const servers = Array.isArray(raw.servers)
      ? raw.servers.flatMap(server => { try { return [validateServerInput(server, server.id)] } catch { return [] } })
      : []
    const ids = new Set(servers.map(server => server.id))
    const selectedBySession = {}
    for (const [sessionId, value] of Object.entries(raw.selectedBySession || {})) {
      const target = normalizeTarget(value)
      if (target.type === 'local' || ids.has(target.serverId)) selectedBySession[sessionId] = target
    }
    const generationBySession = {}
    for (const [sessionId, value] of Object.entries(raw.generationBySession || {})) {
      const generation = normalizeGeneration(value)
      if (generation > 0) generationBySession[sessionId] = generation
    }
    const handoffsBySession = {}
    for (const [sessionId, values] of Object.entries(raw.handoffsBySession || {})) {
      if (!Array.isArray(values)) continue
      const normalized = values.flatMap(value => {
        const handoff = normalizeHandoff(value)
        return handoff ? [handoff] : []
      }).slice(-100)
      if (normalized.length) handoffsBySession[sessionId] = normalized
    }
    const handoffContextAckBySession = {}
    for (const [sessionId, value] of Object.entries(raw.handoffContextAckBySession || {})) {
      const generation = normalizeGeneration(value)
      if (generation > 0) handoffContextAckBySession[sessionId] = generation
    }
    this.#state = { version: SCHEMA_VERSION, servers, selectedBySession, generationBySession, handoffsBySession, handoffContextAckBySession }
    if (migrated || raw.version !== SCHEMA_VERSION) await this.#persist()
  }

  async #persist() {
    const snapshot = JSON.stringify(this.#state, null, 2) + '\n'
    this.#writeChain = this.#writeChain.then(async () => {
      await mkdir(dirname(this.#file), { recursive: true })
      const temp = `${this.#file}.${process.pid}.${Date.now()}.tmp`
      await writeFile(temp, snapshot, { encoding: 'utf8', mode: 0o600 })
      await rename(temp, this.#file)
    })
    await this.#writeChain
  }

  #bumpGenerationNow(sessionId) {
    const id = String(sessionId || '')
    if (!id) return 0
    const next = normalizeGeneration(this.#state.generationBySession[id]) + 1
    this.#state.generationBySession[id] = next
    return next
  }

  listServersNow() { return this.#state.servers.map(publicServer) }
  getServerNow(id) { return this.#state.servers.find(server => server.id === id) }
  hasTargetNow(sessionId) {
    return Object.prototype.hasOwnProperty.call(this.#state.selectedBySession, String(sessionId))
  }
  getTargetNow(sessionId) { return normalizeTarget(this.#state.selectedBySession[String(sessionId)]) }
  getGenerationNow(sessionId) { return normalizeGeneration(this.#state.generationBySession[String(sessionId)]) }
  listHandoffsNow(sessionId) {
    return (this.#state.handoffsBySession[String(sessionId)] || []).map(value => structuredClone(value))
  }
  getHandoffContextAckNow(sessionId) {
    return normalizeGeneration(this.#state.handoffContextAckBySession[String(sessionId)])
  }
  sessionIdsUsingServerNow(serverId) {
    const id = String(serverId || '')
    return Object.entries(this.#state.selectedBySession)
      .filter(([, target]) => target?.type === 'ssh' && target.serverId === id)
      .map(([sessionId]) => sessionId)
  }

  async upsertServer(input) {
    await this.ready()
    const existing = input?.id ? this.getServerNow(String(input.id)) : undefined
    const next = validateServerInput({ ...existing, ...input }, existing?.id)
    if (existing) this.#state.servers[this.#state.servers.indexOf(existing)] = next
    else this.#state.servers.push(next)
    await this.#persist()
    return publicServer(next)
  }

  async removeServer(id) {
    await this.ready()
    const before = this.#state.servers.length
    this.#state.servers = this.#state.servers.filter(server => server.id !== id)
    if (this.#state.servers.length === before) return false
    for (const [sessionId, target] of Object.entries(this.#state.selectedBySession)) {
      if (target.type === 'ssh' && target.serverId === id) {
        delete this.#state.selectedBySession[sessionId]
        this.#bumpGenerationNow(sessionId)
      }
    }
    await this.#persist()
    return true
  }

  async setTarget(sessionId, target, options = {}) {
    await this.ready()
    const id = String(sessionId || '')
    if (!id) throw new Error('sessionId is required')
    const normalized = normalizeTarget(target)
    if (normalized.type === 'ssh' && !this.getServerNow(normalized.serverId)) throw new Error('选择的服务器不存在')
    const previous = this.getTargetNow(id)
    const changed = !targetsEqual(previous, normalized)
    this.#state.selectedBySession[id] = normalized
    if (changed && options.bumpGeneration !== false) this.#bumpGenerationNow(id)
    await this.#persist()
    return { target: normalized, changed, generation: this.getGenerationNow(id) }
  }

  async recordHandoff(sessionId, value) {
    await this.ready()
    const id = String(sessionId || '')
    if (!id) throw new Error('sessionId is required')
    const normalized = normalizeHandoff(value)
    if (!normalized) throw new Error('invalid execution handoff')
    const values = this.#state.handoffsBySession[id] || []
    values.push(normalized)
    this.#state.handoffsBySession[id] = values.slice(-100)
    await this.#persist()
    return structuredClone(normalized)
  }

  async acknowledgeHandoffContext(sessionId, generation) {
    await this.ready()
    const id = String(sessionId || '')
    if (!id) throw new Error('sessionId is required')
    const next = normalizeGeneration(generation)
    if (!next) return this.getHandoffContextAckNow(id)
    const current = this.getHandoffContextAckNow(id)
    if (next <= current) return current
    this.#state.handoffContextAckBySession[id] = next
    await this.#persist()
    return next
  }

  async bumpGeneration(sessionId) {
    await this.ready()
    const generation = this.#bumpGenerationNow(sessionId)
    await this.#persist()
    return generation
  }

  async bumpGenerations(sessionIds) {
    await this.ready()
    const unique = [...new Set((sessionIds || []).map(value => String(value || '')).filter(Boolean))]
    for (const sessionId of unique) this.#bumpGenerationNow(sessionId)
    if (unique.length) await this.#persist()
    return Object.fromEntries(unique.map(sessionId => [sessionId, this.getGenerationNow(sessionId)]))
  }
}
