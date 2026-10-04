import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
export const digest = (value) => createHash('sha256').update(value).digest('hex');
export const secret = () => randomBytes(32).toString('hex');
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await derive(password, salt, 64);
  return `${salt}:${hash.toString('hex')}`;
}
export async function verifyPassword(password, stored) {
  const [salt, hash] = (stored ?? `${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
  const actual = await derive(password, salt, 64);
  return timingSafeEqual(Buffer.from(hash, 'hex'), actual);
}
export function sessionCookie(req) {
  const value = (req.headers.cookie ?? '')
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith('menumind_session='));
  return value?.slice('menumind_session='.length);
}
export function publicUser(user) {
  return { id: user.id, email: user.email, name: user.name, createdAt: user.created_at };
}
