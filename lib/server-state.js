import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';

export { bcrypt };
export const COOKIE_NAME = 'jinsei_session';
export const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

const globalState = globalThis;

export function supabaseAdmin() {
  if (!globalState.__jinseiSupabase) {
    globalState.__jinseiSupabase = createClient(
      requireEnv('SUPABASE_URL'),
      requireEnv('SUPABASE_SECRET_KEY'),
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );
  }
  return globalState.__jinseiSupabase;
}

export async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const { error } = await supabaseAdmin().from('jinsei_sessions').insert({
    token,
    user_id: userId,
    created_at: now.toISOString(),
    expires_at: expires.toISOString()
  });
  if (error) throw error;
  return { token, expires };
}

export function sessionCookie(token, expires) {
  return {
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    expires,
    path: '/'
  };
}

export async function currentUser(request) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const client = supabaseAdmin();
  const { data: session, error: sessionError } = await client
    .from('jinsei_sessions')
    .select('user_id, expires_at')
    .eq('token', token)
    .maybeSingle();
  if (sessionError) throw sessionError;
  if (!session || new Date(session.expires_at) < new Date()) {
    if (session) await client.from('jinsei_sessions').delete().eq('token', token);
    return null;
  }

  const { data: user, error: userError } = await client
    .from('jinsei_users')
    .select('id, username')
    .eq('id', session.user_id)
    .maybeSingle();
  if (userError) throw userError;
  return user;
}
