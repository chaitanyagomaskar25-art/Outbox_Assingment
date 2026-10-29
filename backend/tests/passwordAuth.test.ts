import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/services/passwordAuth.service';

describe('Password authentication', () => {
  it('stores passwords as salted hashes and verifies the correct password', async () => {
    const hash = await hashPassword('a-secure-password');

    expect(hash).toMatch(/^scrypt\$[^$]+\$[^$]+$/);
    expect(hash).not.toContain('a-secure-password');
    await expect(verifyPassword('a-secure-password', hash)).resolves.toBe(true);
  });

  it('rejects incorrect passwords and accounts without a password hash', async () => {
    const hash = await hashPassword('a-secure-password');

    await expect(verifyPassword('incorrect-password', hash)).resolves.toBe(false);
    await expect(verifyPassword('a-secure-password', null)).resolves.toBe(false);
  });
});
