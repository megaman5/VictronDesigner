import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Encryption for user-supplied provider API keys.
 *
 * Threat model - be honest about what this does and does not protect against:
 *
 *   PROTECTS against a database compromise. A dump of user_api_keys is
 *   useless on its own: the ciphertext is AES-256-GCM and the master key
 *   lives in the process environment, not in the database.
 *
 *   DOES NOT protect against full server compromise. An attacker who can read
 *   the environment can decrypt everything. Moving the master key into a KMS
 *   (AWS KMS, GCP KMS, Vault) so the app can request decryption without ever
 *   holding the key is the upgrade path, and the format below is versioned so
 *   that migration does not need a schema change.
 *
 * Design notes:
 * - AES-256-GCM, so tampering is detected rather than silently decrypting to
 *   garbage that then gets sent to a provider as a bearer token.
 * - The user id and provider are bound in as additional authenticated data.
 *   A row copied from one user to another fails to decrypt, so DB write access
 *   cannot be used to make someone else's key run under your account.
 * - Fresh 96-bit IV per encryption; never reused.
 * - The plaintext key is never returned to any client. Only the last four
 *   characters are stored separately, for display.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // 96-bit nonce, the GCM standard
const KEY_BYTES = 32; // AES-256
const FORMAT_VERSION = "v1";

export class KeyVaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyVaultError";
  }
}

/**
 * Master key from the environment. Fails loudly rather than falling back to a
 * default - a hardcoded fallback would silently make every stored key
 * decryptable by anyone with the source.
 */
function masterKey(): Buffer {
  const raw = process.env.API_KEY_ENCRYPTION_KEY;
  if (!raw) {
    throw new KeyVaultError(
      "API_KEY_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32"
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new KeyVaultError(
      `API_KEY_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${key.length}). Generate with: openssl rand -base64 32`
    );
  }
  return key;
}

export function isVaultConfigured(): boolean {
  try {
    masterKey();
    return true;
  } catch {
    return false;
  }
}

/** Context bound into the ciphertext so it cannot be replayed elsewhere. */
export interface KeyContext {
  userId: string;
  provider: string;
}

function aad(ctx: KeyContext): Buffer {
  return Buffer.from(`${ctx.userId}:${ctx.provider}`, "utf8");
}

export interface EncryptedKey {
  /** Opaque, safe to store. Format: v1.<iv>.<tag>.<ciphertext>, base64url. */
  ciphertext: string;
  /** For display only - never enough to reconstruct the key. */
  lastFour: string;
}

export function encryptApiKey(plaintext: string, ctx: KeyContext): EncryptedKey {
  const trimmed = plaintext.trim();
  if (!trimmed) throw new KeyVaultError("API key is empty");
  if (trimmed.length < 8) throw new KeyVaultError("API key is implausibly short");

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, masterKey(), iv, { authTagLength: 16 });
  cipher.setAAD(aad(ctx));

  const encrypted = Buffer.concat([cipher.update(trimmed, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: [
      FORMAT_VERSION,
      iv.toString("base64url"),
      tag.toString("base64url"),
      encrypted.toString("base64url"),
    ].join("."),
    lastFour: trimmed.slice(-4),
  };
}

export function decryptApiKey(ciphertext: string, ctx: KeyContext): string {
  const parts = ciphertext.split(".");
  if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) {
    throw new KeyVaultError("Stored key is not in a recognised format");
  }
  const [, ivB64, tagB64, dataB64] = parts;

  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      masterKey(),
      Buffer.from(ivB64, "base64url"),
      { authTagLength: 16 }
    );
    decipher.setAAD(aad(ctx));
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));

    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch (err) {
    // A GCM tag mismatch means tampering, a wrong master key, or a row moved
    // between users. Never leak which - and never return partial plaintext.
    throw new KeyVaultError(
      "Could not decrypt the stored API key. It may have been tampered with, or the encryption key has changed."
    );
  }
}

/**
 * Remove anything that looks like an API key from text before it reaches a log
 * or an HTTP response. Providers habitually echo the key back in error
 * messages, which is how secrets end up in log aggregators.
 */
const KEY_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}/g,        // OpenAI / OpenRouter
  /\bsk-ant-[A-Za-z0-9_-]{16,}/g,    // Anthropic
  /\bAIza[A-Za-z0-9_-]{20,}/g,       // Google
  /\bBearer\s+[A-Za-z0-9._-]{20,}/gi,
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const pattern of KEY_PATTERNS) {
    out = out.replace(pattern, match => {
      const tail = match.slice(-4);
      return `***redacted***${tail}`;
    });
  }
  return out;
}

/** Constant-time comparison, for anywhere a secret is checked for equality. */
export function secretsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
