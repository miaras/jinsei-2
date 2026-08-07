import { NextResponse } from 'next/server';
import {
  bcrypt,
  COOKIE_NAME,
  createSession,
  currentUser,
  sessionCookie,
  supabaseAdmin,
  USERNAME_RE
} from '../../../lib/server-state.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
const anonTurnLog = new Map();

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

async function endpoint(context) {
  return (await context.params).endpoint;
}

async function requireUser(request) {
  const user = await currentUser(request);
  return user ? { user } : { response: json({ error: 'Not logged in.' }, 401) };
}

function rateLimited(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
  const now = Date.now();
  const recent = (anonTurnLog.get(ip) || []).filter(time => now - time < 60 * 60 * 1000);
  if (recent.length >= 30) return true;
  recent.push(now);
  anonTurnLog.set(ip, recent);
  return false;
}

export async function GET(request, context) {
  const name = await endpoint(context);
  const auth = await requireUser(request);
  if (auth.response) return auth.response;

  if (name === 'me') return json({ username: auth.user.username });
  if (name === 'save') {
    const { data: row, error } = await supabaseAdmin()
      .from('jinsei_saves')
      .select('data, updated_at')
      .eq('user_id', auth.user.id)
      .maybeSingle();
    if (error) throw error;
    return row ? json({ data: row.data, updatedAt: row.updated_at }) : json({ error: 'No save found.' }, 404);
  }
  return json({ error: 'Not found.' }, 404);
}

export async function POST(request, context) {
  const name = await endpoint(context);

  if (name === 'logout') {
    const token = request.cookies.get(COOKIE_NAME)?.value;
    if (token) await supabaseAdmin().from('jinsei_sessions').delete().eq('token', token);
    const response = json({ ok: true });
    response.cookies.set({ name: COOKIE_NAME, value: '', expires: new Date(0), path: '/' });
    return response;
  }

  if (name === 'register' || name === 'login') {
    const { username, password } = await request.json().catch(() => ({}));
    if (typeof username !== 'string' || typeof password !== 'string') return json({ error: 'Username and password are required.' }, 400);

    let user;
    if (name === 'register') {
      if (!USERNAME_RE.test(username)) return json({ error: 'Username: 3-20 characters, letters/numbers/underscore only.' }, 400);
      if (password.length < 8) return json({ error: 'Password must be at least 8 characters.' }, 400);
      const client = supabaseAdmin();
      const { data: existing, error: lookupError } = await client
        .from('jinsei_users').select('id').eq('username', username).maybeSingle();
      if (lookupError) throw lookupError;
      if (existing) return json({ error: 'That username is already taken.' }, 409);
      const hash = bcrypt.hashSync(password, 12);
      const { data: created, error: createError } = await client
        .from('jinsei_users')
        .insert({ username, password_hash: hash })
        .select('id, username')
        .single();
      if (createError) {
        if (createError.code === '23505') return json({ error: 'That username is already taken.' }, 409);
        throw createError;
      }
      user = created;
    } else {
      const { data, error } = await supabaseAdmin()
        .from('jinsei_users')
        .select('id, username, password_hash')
        .eq('username', username)
        .maybeSingle();
      if (error) throw error;
      user = data;
      if (!user || !bcrypt.compareSync(password, user.password_hash)) return json({ error: 'Wrong username or password.' }, 401);
    }

    const { token, expires } = await createSession(user.id);
    const response = json({ username: user.username });
    response.cookies.set(sessionCookie(token, expires));
    return response;
  }

  if (name === 'image') return json({ error: 'Image generation is disabled.' }, 503);

  if (name === 'turn') {
    const user = await currentUser(request);
    const { system, messages } = await request.json().catch(() => ({}));
    if (typeof system !== 'string' || !Array.isArray(messages)) return json({ error: 'Request must include "system" (string) and "messages" (array).' }, 400);
    if (!process.env.ANTHROPIC_API_KEY) return json({ error: 'Server is missing ANTHROPIC_API_KEY.' }, 500);
    if (!user && rateLimited(request)) return json({ error: 'Guest play is limited. Sign up to keep going.' }, 429);

    let upstream;
    try {
      upstream = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': ANTHROPIC_VERSION },
        body: JSON.stringify({ model: MODEL, system, messages, max_tokens: 1000, stream: true }),
        signal: request.signal
      });
    } catch (error) {
      console.error('Could not reach Anthropic:', error);
      return json({ error: 'Could not reach the Anthropic API.' }, 502);
    }
    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => '');
      console.error('Anthropic API error:', upstream.status, detail);
      return json({ error: 'Anthropic API returned an error.', detail }, upstream.status);
    }
    return new Response(upstream.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no'
      }
    });
  }

  return json({ error: 'Not found.' }, 404);
}

export async function PUT(request, context) {
  if (await endpoint(context) !== 'save') return json({ error: 'Not found.' }, 404);
  const auth = await requireUser(request);
  if (auth.response) return auth.response;
  const data = await request.json().catch(() => null);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return json({ error: 'Save payload must be an object.' }, 400);
  const serialized = JSON.stringify(data);
  if (serialized.length > 2_000_000) return json({ error: 'Save is too large.' }, 413);
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin().from('jinsei_saves').upsert({
    user_id: auth.user.id,
    data,
    updated_at: now
  });
  if (error) throw error;
  return json({ ok: true, updatedAt: now });
}

export async function DELETE(request, context) {
  if (await endpoint(context) !== 'save') return json({ error: 'Not found.' }, 404);
  const auth = await requireUser(request);
  if (auth.response) return auth.response;
  const { error } = await supabaseAdmin().from('jinsei_saves').delete().eq('user_id', auth.user.id);
  if (error) throw error;
  return json({ ok: true });
}
