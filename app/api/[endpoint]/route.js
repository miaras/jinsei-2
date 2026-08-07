import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
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

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = process.env.OPENROUTER_MODEL || 'deepseek/deepseek-v4-flash';
const anonTurnLog = new Map();
const speechLog = new Map();
const SPEECH_BUCKET = 'jinsei-speech';
const VOICES = {
  japan: { languageCode: 'ja-JP', name: 'ja-JP-Wavenet-B' },
  china: { languageCode: 'cmn-CN', name: 'cmn-CN-Wavenet-A' },
  korea: { languageCode: 'ko-KR', name: 'ko-KR-Wavenet-B' }
};

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

function speechRateLimited(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
  const now = Date.now();
  const recent = (speechLog.get(ip) || []).filter(time => now - time < 60 * 60 * 1000);
  if (recent.length >= 60) return true;
  recent.push(now);
  speechLog.set(ip, recent);
  return false;
}

function audioResponse(audio) {
  return new Response(audio, {
    headers: {
      'Content-Type': 'audio/mpeg',
      // The line and voice are part of the cache key, so a cached response is immutable.
      'Cache-Control': 'private, max-age=31536000, immutable'
    }
  });
}

async function synthesizeSpeech(request) {
  const { text, country } = await request.json().catch(() => ({}));
  const voice = VOICES[country];
  if (!voice) return json({ error: 'Choose a valid destination.' }, 400);
  if (typeof text !== 'string' || !text.trim()) return json({ error: 'Speech text is required.' }, 400);
  const spokenText = text.trim();
  if (spokenText.length > 500) return json({ error: 'Speech text is too long.' }, 413);
  if (speechRateLimited(request)) return json({ error: 'Speech is temporarily limited. Please try again shortly.' }, 429);

  const cacheKey = createHash('sha256')
    .update(`v1:${voice.languageCode}:${voice.name}:${spokenText}`)
    .digest('hex');
  const storagePath = `${cacheKey}.mp3`;
  const client = supabaseAdmin();
  const { data: cached, error: cacheLookupError } = await client
    .from('jinsei_speech_cache')
    .select('storage_path')
    .eq('cache_key', cacheKey)
    .maybeSingle();
  if (cacheLookupError) throw cacheLookupError;

  if (cached) {
    const { data: file, error: downloadError } = await client.storage.from(SPEECH_BUCKET).download(cached.storage_path);
    if (!downloadError && file) return audioResponse(await file.arrayBuffer());
    // A missing object should not permanently poison the cache. Rebuild it below.
    await client.from('jinsei_speech_cache').delete().eq('cache_key', cacheKey);
  }

  if (!process.env.GOOGLE_TTS_API_KEY) return json({ error: 'Server is missing GOOGLE_TTS_API_KEY.' }, 500);
  let upstream;
  try {
    upstream = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(process.env.GOOGLE_TTS_API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text: spokenText },
        voice: { languageCode: voice.languageCode, name: voice.name },
        audioConfig: { audioEncoding: 'MP3', speakingRate: 0.95 }
      }),
      signal: request.signal
    });
  } catch (error) {
    console.error('Could not reach Google Cloud Text-to-Speech:', error);
    return json({ error: 'Could not reach Google Cloud Text-to-Speech.' }, 502);
  }
  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    console.error('Google Cloud Text-to-Speech error:', upstream.status, detail);
    return json({ error: 'Google Cloud Text-to-Speech returned an error.' }, upstream.status);
  }
  const payload = await upstream.json();
  if (typeof payload.audioContent !== 'string') return json({ error: 'Google Cloud Text-to-Speech returned no audio.' }, 502);
  const audio = Buffer.from(payload.audioContent, 'base64');
  if (!audio.length) return json({ error: 'Google Cloud Text-to-Speech returned empty audio.' }, 502);

  const { error: uploadError } = await client.storage.from(SPEECH_BUCKET).upload(storagePath, audio, {
    contentType: 'audio/mpeg',
    cacheControl: '31536000',
    upsert: true
  });
  if (uploadError) throw uploadError;
  const { error: cacheWriteError } = await client.from('jinsei_speech_cache').upsert({
    cache_key: cacheKey,
    language_code: voice.languageCode,
    voice_name: voice.name,
    text_length: spokenText.length,
    storage_path: storagePath
  }, { onConflict: 'cache_key' });
  if (cacheWriteError) throw cacheWriteError;
  return audioResponse(audio);
}

export async function GET(request, context) {
  const name = await endpoint(context);
  const auth = await requireUser(request);
  if (auth.response) return auth.response;

  if (name === 'me') return json({ username: auth.user.username });
  if (name === 'save') {
    const { data: rows, error } = await supabaseAdmin()
      .from('jinsei_lives')
      .select('id, data, created_at, updated_at')
      .eq('user_id', auth.user.id)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return json({ lives: rows.map(row => ({ id: row.id, data: row.data, createdAt: row.created_at, updatedAt: row.updated_at })) });
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

  if (name === 'speech') return synthesizeSpeech(request);

  if (name === 'save') {
    const auth = await requireUser(request);
    if (auth.response) return auth.response;
    const { data } = await request.json().catch(() => ({}));
    if (!data || typeof data !== 'object' || Array.isArray(data)) return json({ error: 'Save payload must be an object.' }, 400);
    if (JSON.stringify(data).length > 2_000_000) return json({ error: 'Save is too large.' }, 413);
    const now = new Date().toISOString();
    const { data: life, error } = await supabaseAdmin().from('jinsei_lives')
      .insert({ user_id: auth.user.id, data, created_at: now, updated_at: now })
      .select('id, created_at, updated_at')
      .single();
    if (error) throw error;
    return json({ id: life.id, createdAt: life.created_at, updatedAt: life.updated_at }, 201);
  }

  if (name === 'turn') {
    const user = await currentUser(request);
    const { system, messages } = await request.json().catch(() => ({}));
    if (typeof system !== 'string' || !Array.isArray(messages)) return json({ error: 'Request must include "system" (string) and "messages" (array).' }, 400);
    if (!process.env.OPENROUTER_API_KEY) return json({ error: 'Server is missing OPENROUTER_API_KEY.' }, 500);
    if (!user && rateLimited(request)) return json({ error: 'Guest play is limited. Sign up to keep going.' }, 429);

    let upstream;
    try {
      upstream = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'X-Title': 'JINSEI'
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: 'system', content: system }, ...messages],
          max_tokens: 1000,
          stream: true
        }),
        signal: request.signal
      });
    } catch (error) {
      console.error('Could not reach OpenRouter:', error);
      return json({ error: 'Could not reach the OpenRouter API.' }, 502);
    }
    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => '');
      console.error('OpenRouter API error:', upstream.status, detail);
      return json({ error: 'OpenRouter API returned an error.', detail }, upstream.status);
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
  const { id, data } = await request.json().catch(() => ({}));
  if (typeof id !== 'string' || !id) return json({ error: 'A life id is required.' }, 400);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return json({ error: 'Save payload must be an object.' }, 400);
  const serialized = JSON.stringify(data);
  if (serialized.length > 2_000_000) return json({ error: 'Save is too large.' }, 413);
  const now = new Date().toISOString();
  const { data: life, error } = await supabaseAdmin().from('jinsei_lives').update({
    data,
    updated_at: now
  }).eq('id', id).eq('user_id', auth.user.id).select('id').maybeSingle();
  if (error) throw error;
  if (!life) return json({ error: 'Life not found.' }, 404);
  return json({ ok: true, updatedAt: now });
}

export async function DELETE(request, context) {
  if (await endpoint(context) !== 'save') return json({ error: 'Not found.' }, 404);
  const auth = await requireUser(request);
  if (auth.response) return auth.response;
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return json({ error: 'A life id is required.' }, 400);
  const { error } = await supabaseAdmin().from('jinsei_lives').delete().eq('id', id).eq('user_id', auth.user.id);
  if (error) throw error;
  return json({ ok: true });
}
