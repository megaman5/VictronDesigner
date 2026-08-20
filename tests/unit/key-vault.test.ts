import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  encryptApiKey, decryptApiKey, redactSecrets, secretsMatch,
  isVaultConfigured, KeyVaultError,
} from '../../server/ai/key-vault';
import { randomBytes } from 'node:crypto';

const CTX = { userId: 'user-1', provider: 'openai' };
const KEY = 'sk-proj-abcdef1234567890abcdef1234567890';

describe('Key vault', () => {
  const saved = process.env.API_KEY_ENCRYPTION_KEY;
  beforeEach(() => {
    process.env.API_KEY_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.API_KEY_ENCRYPTION_KEY;
    else process.env.API_KEY_ENCRYPTION_KEY = saved;
  });

  it('round-trips a key', () => {
    const { ciphertext } = encryptApiKey(KEY, CTX);
    expect(decryptApiKey(ciphertext, CTX)).toBe(KEY);
  });

  it('never stores the plaintext in the ciphertext', () => {
    const { ciphertext } = encryptApiKey(KEY, CTX);
    expect(ciphertext).not.toContain(KEY);
    expect(ciphertext).not.toContain('abcdef');
  });

  it('exposes only the last four characters', () => {
    const { lastFour } = encryptApiKey(KEY, CTX);
    expect(lastFour).toBe('7890');
    expect(lastFour).toHaveLength(4);
  });

  it('produces different ciphertext each time (fresh IV)', () => {
    const a = encryptApiKey(KEY, CTX).ciphertext;
    const b = encryptApiKey(KEY, CTX).ciphertext;
    expect(a).not.toBe(b);
    expect(decryptApiKey(a, CTX)).toBe(decryptApiKey(b, CTX));
  });

  it('refuses to decrypt a row moved to another user', () => {
    const { ciphertext } = encryptApiKey(KEY, CTX);
    expect(() => decryptApiKey(ciphertext, { ...CTX, userId: 'attacker' })).toThrow(KeyVaultError);
  });

  it('refuses to decrypt a row moved to another provider', () => {
    const { ciphertext } = encryptApiKey(KEY, CTX);
    expect(() => decryptApiKey(ciphertext, { ...CTX, provider: 'anthropic' })).toThrow(KeyVaultError);
  });

  it('detects tampering with the ciphertext', () => {
    const { ciphertext } = encryptApiKey(KEY, CTX);
    const parts = ciphertext.split('.');
    const data = Buffer.from(parts[3], 'base64url');
    data[0] ^= 0xff;
    parts[3] = data.toString('base64url');
    expect(() => decryptApiKey(parts.join('.'), CTX)).toThrow(KeyVaultError);
  });

  it('refuses to decrypt under a different master key', () => {
    const { ciphertext } = encryptApiKey(KEY, CTX);
    process.env.API_KEY_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    expect(() => decryptApiKey(ciphertext, CTX)).toThrow(KeyVaultError);
  });

  it('rejects an unrecognised format', () => {
    expect(() => decryptApiKey('v9.a.b.c', CTX)).toThrow(/recognised format/);
    expect(() => decryptApiKey('garbage', CTX)).toThrow(/recognised format/);
  });

  it('rejects empty and implausibly short keys', () => {
    expect(() => encryptApiKey('', CTX)).toThrow(/empty/);
    expect(() => encryptApiKey('   ', CTX)).toThrow(/empty/);
    expect(() => encryptApiKey('short', CTX)).toThrow(/short/);
  });

  it('fails loudly when no master key is configured', () => {
    delete process.env.API_KEY_ENCRYPTION_KEY;
    expect(isVaultConfigured()).toBe(false);
    expect(() => encryptApiKey(KEY, CTX)).toThrow(/API_KEY_ENCRYPTION_KEY is not set/);
  });

  it('rejects a master key of the wrong length', () => {
    process.env.API_KEY_ENCRYPTION_KEY = Buffer.from('too-short').toString('base64');
    expect(() => encryptApiKey(KEY, CTX)).toThrow(/must decode to 32 bytes/);
  });
});

describe('Secret redaction', () => {
  it('redacts provider keys from text', () => {
    const text = 'Request failed with key sk-proj-abcdef1234567890abcdef and retry';
    const out = redactSecrets(text);
    expect(out).not.toContain('sk-proj-abcdef1234567890abcdef');
    expect(out).toContain('***redacted***');
  });

  it('redacts Anthropic and Google shapes', () => {
    expect(redactSecrets('sk-ant-api03-aaaaaaaaaaaaaaaaaaaa')).toContain('***redacted***');
    expect(redactSecrets('AIzaSyA1234567890abcdefghijklmnop')).toContain('***redacted***');
  });

  it('redacts bearer tokens', () => {
    expect(redactSecrets('Authorization: Bearer abcdefghijklmnopqrstuvwxyz')).toContain('***redacted***');
  });

  it('keeps a tail so support can identify which key failed', () => {
    expect(redactSecrets('sk-proj-abcdef1234567890abcdWXYZ')).toContain('WXYZ');
  });

  it('leaves ordinary text alone', () => {
    const text = 'Wire gauge 10 AWG insufficient for 384.8A';
    expect(redactSecrets(text)).toBe(text);
  });
});

describe('Constant-time comparison', () => {
  it('matches identical secrets', () => {
    expect(secretsMatch('abc123', 'abc123')).toBe(true);
  });
  it('rejects different secrets and lengths', () => {
    expect(secretsMatch('abc123', 'abc124')).toBe(false);
    expect(secretsMatch('abc', 'abcdef')).toBe(false);
  });
});
