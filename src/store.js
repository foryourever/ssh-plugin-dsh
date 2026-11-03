import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

// All connection fields, including nested jump-host secrets, are encrypted together.
// The local wrapping key and data directory must be backed up together.
export class Store {
  constructor(directory) { this.directory = path.resolve(directory); this.tail = Promise.resolve(); }
  async init() {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    await fs.chmod(this.directory, 0o700);
    const keyFile = path.join(this.directory, 'connections.key');
    try { this.key = await fs.readFile(keyFile); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const key = randomBytes(32);
      try { await fs.writeFile(keyFile, key, { flag: 'wx', mode: 0o600 }); this.key = key; }
      catch (race) { if (race.code !== 'EEXIST') throw race; this.key = await fs.readFile(keyFile); }
    }
    if (this.key.length !== 32) throw new Error('Invalid connections.key; restore the original key from backup.');
    await fs.chmod(keyFile, 0o600);
    return this;
  }
  async read(name, fallback = {}) {
    try { return JSON.parse(await fs.readFile(path.join(this.directory, name), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return structuredClone(fallback); throw error; }
  }
  async write(name, value) {
    const destination = path.join(this.directory, name);
    const temporary = `${destination}.${randomBytes(8).toString('hex')}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
    // Both paths are fixed children of the explicitly resolved plugin directory.
    await fs.rename(temporary, destination);
  }
  update(name, fallback, modify) {
    const work = this.tail.then(async () => { const value = await this.read(name, fallback); const result = await modify(value); await this.write(name, value); return result; });
    this.tail = work.catch(() => {}); return work;
  }
  encrypt(value) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from('dsh-plugin-ssh/connections/v1'));
    const bytes = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return { version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: bytes.toString('base64') };
  }
  decrypt(value) {
    if (value.version !== 1) throw new Error('Unsupported encrypted connection version.');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(value.iv, 'base64'));
    decipher.setAAD(Buffer.from('dsh-plugin-ssh/connections/v1'));
    decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()]).toString('utf8'));
  }
  async connections() { return this.decryptConnections(await this.read('connections.json', { records: {} })); }
  decryptConnections(store) { return Object.fromEntries(Object.entries(store.records).map(([id, sealed]) => [id, this.decrypt(sealed)])); }
  async saveConnection(value) {
    return this.update('connections.json', { records: {} }, (store) => {
      const old = store.records[value.id] ? this.decrypt(store.records[value.id]) : {};
      const merged = mergePreservingSecrets(old, value);
      store.records[value.id] = this.encrypt(merged); return merged;
    });
  }
  async deleteConnection(id) { return this.update('connections.json', { records: {} }, store => { delete store.records[id]; return { success: true }; }); }
}

const secretKey = /password|passphrase|private_key$|totp_secret|secret_slots|connection_secrets|token|credential/i;
export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !secretKey.test(key) || /_(?:command|source|prompt_hint|enabled|only)$/.test(key)).map(([key, value]) => [key, redact(value)]));
}
export function mergePreservingSecrets(old, value) {
  if (Array.isArray(value)) return value.map((item, index) => {
    const prior = Array.isArray(old) ? old[index] : undefined;
    const sameEndpoint = item && typeof item === 'object' && prior && ['host', 'port', 'username'].every(key => item[key] === prior[key]);
    return sameEndpoint ? mergePreservingSecrets(prior, item) : structuredClone(item);
  });
  if (!value || typeof value !== 'object') return structuredClone(value);
  const merged = { ...old };
  for (const [key, item] of Object.entries(value)) {
    merged[key] = item && typeof item === 'object' ? mergePreservingSecrets(old?.[key] ?? (Array.isArray(item) ? [] : {}), item) : structuredClone(item);
  }
  return merged;
}
