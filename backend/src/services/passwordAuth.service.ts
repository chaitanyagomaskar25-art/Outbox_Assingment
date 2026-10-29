import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'crypto';

const KEY_LENGTH = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1 };
const DUMMY_SALT = 'reachinbox-invalid-password-user-check';

const deriveKey = (password: string, salt: string): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scryptCallback(password, salt, KEY_LENGTH, SCRYPT_OPTIONS, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });

export const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(16).toString('base64url');
  const derivedKey = await deriveKey(password, salt);
  return `scrypt$${salt}$${derivedKey.toString('base64url')}`;
};

export const verifyPassword = async (
  password: string,
  storedHash: string | null | undefined
): Promise<boolean> => {
  if (!storedHash) {
    await deriveKey(password, DUMMY_SALT);
    return false;
  }

  const [algorithm, salt, expectedHash, ...extraParts] = storedHash.split('$');
  if (algorithm !== 'scrypt' || !salt || !expectedHash || extraParts.length > 0) {
    throw new Error('Stored password hash has an unsupported format');
  }

  const expected = Buffer.from(expectedHash, 'base64url');
  const actual = await deriveKey(password, salt);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};
