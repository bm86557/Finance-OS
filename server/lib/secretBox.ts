/**
 * Cryptographic Secret Box for Organization AI Credentials
 * - AES-256-GCM with 12-byte IV and 16-byte Authentication Tag
 * - AAD (Additional Authenticated Data) bound to organizationId (prevents tenant ciphertext transplanting)
 * - Safe key derivation using scrypt
 */

import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const TAG_LENGTH = 16; // 128-bit authentication tag

function getMasterKey(): Buffer {
  const secret =
    process.env.AI_KEY_ENCRYPTION_SECRET ||
    process.env.ENCRYPTION_KEY ||
    process.env.JWT_SECRET ||
    'finance-os-32-byte-secret-key-!';
  return crypto.scryptSync(secret, 'finance-os-byok-salt-v1', 32);
}

/**
 * Encrypt a plaintext API key bound to an organizationId
 */
export function encryptSecret(plaintext: string, organizationId: string): string {
  if (!plaintext || !plaintext.trim()) return '';
  const cleanKey = plaintext.trim();
  const masterKey = getMasterKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, masterKey, iv, { authTagLength: TAG_LENGTH });
  cipher.setAAD(Buffer.from(organizationId, 'utf8'));

  const encrypted = Buffer.concat([cipher.update(cleanKey, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Format: base64([12-byte IV][16-byte Tag][Encrypted bytes])
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

/**
 * Decrypt a ciphertext string bound to an organizationId.
 * Throws or returns empty if corrupted, tampered with, or belonging to another org.
 */
export function decryptSecret(ciphertextBase64: string, organizationId: string): string {
  if (!ciphertextBase64 || !ciphertextBase64.trim()) return '';
  try {
    const raw = Buffer.from(ciphertextBase64.trim(), 'base64');
    if (raw.length < IV_LENGTH + TAG_LENGTH + 1) {
      return '';
    }

    const iv = raw.subarray(0, IV_LENGTH);
    const tag = raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const encrypted = raw.subarray(IV_LENGTH + TAG_LENGTH);

    const masterKey = getMasterKey();
    const decipher = crypto.createDecipheriv(ALGORITHM, masterKey, iv, { authTagLength: TAG_LENGTH });
    decipher.setAAD(Buffer.from(organizationId, 'utf8'));
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (err) {
    console.error(`[secretBox] Decryption failed for organization ${organizationId}:`, (err as Error).message);
    return '';
  }
}

/**
 * Generate a SHA-256 fingerprint of the key for comparison without storing the key
 */
export function fingerprintKey(key: string): string {
  if (!key) return '';
  return crypto.createHash('sha256').update(key.trim()).digest('hex');
}

/**
 * Extract the last 4 characters for safe display (e.g., 'a9F2')
 */
export function extractLast4(key: string): string {
  if (!key) return '';
  const clean = key.trim();
  return clean.slice(-4);
}

/**
 * Mask an API key for safe UI display (e.g., 'sk-••••••••a9F2')
 */
export function maskApiKey(key: string): string {
  if (!key) return '';
  const clean = key.trim();
  if (clean.length <= 8) return '••••••••';
  const prefix = clean.startsWith('sk-') ? 'sk-••••••••' : '••••••••';
  return `${prefix}${clean.slice(-4)}`;
}

