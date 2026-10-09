/**
 * The Vault's end-to-end encryption. Everything here runs in the browser; the server only ever stores what it
 * can't read.
 *
 * - Each person has a key pair (ECDH P-256). The private key is wrapped with a key made from their vault
 *   passphrase (PBKDF2, 600k rounds) and stored on their user record next to the public key.
 * - Each login has its own random item key (AES-GCM 256). The password, 2FA secret and notes are encrypted with
 *   it. The item key is wrapped once per person who may see the login, using their public key (ECDH with a
 *   throwaway key pair, then HKDF, then AES-GCM), so sharing never reveals anyone's private key.
 * - 2FA codes are worked out here too, from the decrypted secret.
 */
import { t } from './i18n/index';

const te = new TextEncoder();
const td = new TextDecoder();
const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const rnd = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const ECDH: EcKeyGenParams = { name: 'ECDH', namedCurve: 'P-256' };

export interface VaultKeyRecord {
  pub: JsonWebKey; // everyone may see this
  wrapped: string; // the private key, encrypted with the passphrase key
  salt: string;
  iv: string;
}
/** What a wrapped item key looks like inside meta.keys[userId]. */
export interface WrappedKey {
  epk: JsonWebKey; // the throwaway public key used for this person
  iv: string;
  ct: string;
}
export const ENC = 'enc:'; // a secret stored by the browser, not the server

async function passKey(passphrase: string, salt: Uint8Array) {
  const base = await crypto.subtle.importKey('raw', te.encode(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations: 600_000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** A new key pair for this person, locked with their passphrase. */
export async function makeVaultKeys(passphrase: string): Promise<{ record: VaultKeyRecord; priv: CryptoKey }> {
  const pair = await crypto.subtle.generateKey(ECDH, true, ['deriveKey', 'deriveBits']);
  const pub = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const privJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const salt = rnd(16);
  const iv = rnd(12);
  const k = await passKey(passphrase, salt);
  const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, k, te.encode(JSON.stringify(privJwk)));
  return { record: { pub, wrapped: b64(wrapped), salt: b64(salt), iv: b64(iv) }, priv: pair.privateKey };
}

/** Unlocks the private key with the passphrase; throws when it's wrong. */
export async function unlockVaultKey(record: VaultKeyRecord, passphrase: string): Promise<CryptoKey> {
  const k = await passKey(passphrase, unb64(record.salt));
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(record.iv) as BufferSource }, k, unb64(record.wrapped) as BufferSource);
  return crypto.subtle.importKey('jwk', JSON.parse(td.decode(plain)), ECDH, true, ['deriveKey', 'deriveBits']);
}

/** Same private key, locked with a new passphrase. */
export async function rewrapVaultKey(priv: CryptoKey, pub: JsonWebKey, passphrase: string): Promise<VaultKeyRecord> {
  const privJwk = await crypto.subtle.exportKey('jwk', priv);
  const salt = rnd(16);
  const iv = rnd(12);
  const k = await passKey(passphrase, salt);
  const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, k, te.encode(JSON.stringify(privJwk)));
  return { pub, wrapped: b64(wrapped), salt: b64(salt), iv: b64(iv) };
}

/* ---------- item keys ---------- */

const newItemKey = () => crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);

async function sharedKey(priv: CryptoKey, pubJwk: JsonWebKey) {
  const pub = await crypto.subtle.importKey('jwk', pubJwk, ECDH, false, []);
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, priv, 256);
  const hk = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: te.encode('sprint2go-vault-item') }, hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Wraps an item key for one person (by their public key). */
export async function wrapFor(itemKey: CryptoKey, pub: JsonWebKey): Promise<WrappedKey> {
  const eph = await crypto.subtle.generateKey(ECDH, true, ['deriveKey', 'deriveBits']);
  const k = await sharedKey(eph.privateKey, pub);
  const raw = await crypto.subtle.exportKey('raw', itemKey);
  const iv = rnd(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, k, raw);
  return { epk: await crypto.subtle.exportKey('jwk', eph.publicKey), iv: b64(iv), ct: b64(ct) };
}

/** Unwraps an item key with this person's private key. */
export async function unwrapWith(priv: CryptoKey, w: WrappedKey): Promise<CryptoKey> {
  const k = await sharedKey(priv, w.epk);
  const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(w.iv) as BufferSource }, k, unb64(w.ct) as BufferSource);
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

/** A secret, encrypted with the item key, as "enc:<iv>.<ciphertext>". */
export async function encryptSecret(itemKey: CryptoKey, plain: string) {
  const iv = rnd(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, itemKey, te.encode(plain));
  return `${ENC}${b64(iv)}.${b64(ct)}`;
}
export async function decryptSecret(itemKey: CryptoKey, enc: string) {
  const [iv, ct] = enc.slice(ENC.length).split('.');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) as BufferSource }, itemKey, unb64(ct) as BufferSource);
  return td.decode(plain);
}
export const isEncrypted = (v: string | null | undefined) => !!v && v.startsWith(ENC);

/** A fresh item key plus its wrapping for every person given. */
export async function newItemKeys(people: { id: string; pub: JsonWebKey }[]) {
  const key = await newItemKey();
  const keys: Record<string, WrappedKey> = {};
  for (const p of people) keys[p.id] = await wrapFor(key, p.pub);
  return { key, keys };
}

/* ---------- 2FA codes, in the browser ---------- */

function base32(secret: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = secret.replace(/[\s=-]/g, '').toUpperCase();
  let bits = '';
  for (const ch of clean) {
    const v = alphabet.indexOf(ch);
    if (v < 0) throw new Error(t('Not a valid 2FA secret'));
    bits += v.toString(2).padStart(5, '0');
  }
  return Uint8Array.from(bits.match(/.{8}/g) ?? [], (b) => parseInt(b, 2));
}

/** A 6-digit code (RFC 6238, 30 seconds) and how long it's still good for. */
export async function totp(secret: string, now = Date.now()): Promise<{ code: string; secondsLeft: number }> {
  const key = await crypto.subtle.importKey('raw', base32(secret) as BufferSource, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const step = Math.floor(now / 30_000);
  const msg = new Uint8Array(8);
  new DataView(msg.buffer).setUint32(4, step);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const off = mac[mac.length - 1] & 0xf;
  const n = ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  return { code: String(n % 1_000_000).padStart(6, '0'), secondsLeft: 30 - Math.floor((now / 1000) % 30) };
}

/* ---------- the unlocked key for this session ---------- */

let unlocked: { userId: string; priv: CryptoKey } | null = null;
export const vaultUnlocked = (userId: string) => (unlocked?.userId === userId ? unlocked.priv : null);
export const setVaultUnlocked = (userId: string, priv: CryptoKey | null) => {
  unlocked = priv ? { userId, priv } : null;
};
