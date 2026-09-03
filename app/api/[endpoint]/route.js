import { after, NextResponse } from 'next/server';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import Replicate from 'replicate';
import { toKana } from 'wanakana';
import {
  bcrypt,
  COOKIE_NAME,
  createSession,
  currentUser,
  sessionCookie,
  supabaseAdmin,
  USERNAME_RE
} from '../../../lib/server-state.js';
import { lookupDictionary } from '../../../lib/dictionary.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const BASE_MODEL = process.env.OPENROUTER_MODEL || 'deepseek/deepseek-v4-flash';
const IMAGE_CHARACTER_FILTER_MODEL = process.env.OPENROUTER_IMAGE_FILTER_MODEL || 'deepseek/deepseek-v4-flash';
// Prefer a quick first token for this interactive UI. OpenRouter's `:nitro`
// variant sorts by generation throughput, which can still have a slow TTFT.
const MODEL = BASE_MODEL.replace(/:nitro$/, '');
const FREE_TURN_LIMIT = 20;
const REPLICATE_IMAGE_MODELS = {
  illustrious: 'aisha-ai-official/wai-nsfw-illustrious-v8:4d3aebd63448c9795a7b55b5e9a2b69433f1fd3437af5ef63b8ac6531ab269c9',
  flux: 'aisha-ai-official/nsfw-flux-dev:fb4f086702d6a301ca32c170d926239324a7b7b2f0afc3d232a9c4be382dc3fa'
};
const REPLICATE_IMAGE_MODEL = REPLICATE_IMAGE_MODELS.illustrious;
const GUEST_USAGE_COOKIE = 'jinsei_guest_usage';
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing']);
const anonTurnLog = new Map();
const speechLog = new Map();
const SPEECH_BUCKET = 'jinsei-speech';
const SUPPORTED_COUNTRIES = new Set([
  'japan', 'china', 'korea', 'hanja',
  'thailand', 'vietnam', 'indonesia', 'india', 'turkey', 'saudi_arabia', 'philippines',
  'france', 'germany', 'italy', 'spain', 'russia', 'greece', 'netherlands', 'sweden', 'poland',
  'egypt', 'kenya', 'nigeria', 'south_africa', 'morocco',
  'usa', 'mexico', 'canada', 'cuba',
  'brazil', 'colombia', 'peru', 'argentina',
  'new_zealand', 'fiji', 'hawaii'
]);

const VOICES = {
  japan: { languageCode: 'ja-JP', name: 'ja-JP-Wavenet-B' },
  china: { languageCode: 'cmn-CN', name: 'cmn-CN-Wavenet-A' },
  korea: { languageCode: 'ko-KR', name: 'ko-KR-Wavenet-B' },
  hanja: { languageCode: 'ko-KR', name: 'ko-KR-Wavenet-B' },
  france: { languageCode: 'fr-FR', name: 'fr-FR-Wavenet-C' },
  germany: { languageCode: 'de-DE', name: 'de-DE-Wavenet-B' },
  italy: { languageCode: 'it-IT', name: 'it-IT-Wavenet-A' },
  spain: { languageCode: 'es-ES', name: 'es-ES-Wavenet-B' },
  russia: { languageCode: 'ru-RU', name: 'ru-RU-Wavenet-C' },
  greece: { languageCode: 'el-GR', name: 'el-GR-Wavenet-A' },
  netherlands: { languageCode: 'nl-NL', name: 'nl-NL-Wavenet-B' },
  sweden: { languageCode: 'sv-SE', name: 'sv-SE-Wavenet-A' },
  poland: { languageCode: 'pl-PL', name: 'pl-PL-Wavenet-B' },
  thailand: { languageCode: 'th-TH', name: 'th-TH-Standard-A' },
  vietnam: { languageCode: 'vi-VN', name: 'vi-VN-Wavenet-B' },
  indonesia: { languageCode: 'id-ID', name: 'id-ID-Wavenet-B' },
  india: { languageCode: 'hi-IN', name: 'hi-IN-Wavenet-B' },
  turkey: { languageCode: 'tr-TR', name: 'tr-TR-Wavenet-B' },
  saudi_arabia: { languageCode: 'ar-XA', name: 'ar-XA-Wavenet-B' },
  philippines: { languageCode: 'fil-PH', name: 'fil-PH-Wavenet-B' },
  egypt: { languageCode: 'ar-XA', name: 'ar-XA-Wavenet-A' },
  kenya: { languageCode: 'sw-TZ', name: 'sw-TZ-Standard-A' },
  south_africa: { languageCode: 'en-ZA', name: 'en-ZA-Wavenet-A' },
  morocco: { languageCode: 'ar-XA', name: 'ar-XA-Wavenet-C' },
  usa: { languageCode: 'en-US', name: 'en-US-Wavenet-D' },
  mexico: { languageCode: 'es-US', name: 'es-US-Wavenet-B' },
  canada: { languageCode: 'fr-CA', name: 'fr-CA-Wavenet-B' },
  cuba: { languageCode: 'es-US', name: 'es-US-Wavenet-A' },
  brazil: { languageCode: 'pt-BR', name: 'pt-BR-Wavenet-B' },
  colombia: { languageCode: 'es-US', name: 'es-US-Wavenet-C' },
  argentina: { languageCode: 'es-US', name: 'es-US-Wavenet-B' },
  new_zealand: { languageCode: 'en-NZ', name: 'en-NZ-Wavenet-B' }
};

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

function formatCharacterAppearance(name, profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return `${name}: ${String(profile || '')}`;
  const clothing = Array.isArray(profile.clothing)
    ? profile.clothing.map(item => typeof item === 'string'
      ? item
      : [item?.article, item?.color, item?.details].filter(Boolean).join(' ')).filter(Boolean).join(', ')
    : String(profile.clothing || '');
  return `${name}: ${[profile.face, profile.hair, profile.height, clothing].filter(Boolean).join('; ')}`;
}

async function relevantCharacterDescriptions(narration, imagePromptForModel, appearances, signal) {
  if (!appearances || typeof appearances !== 'object' || Array.isArray(appearances)) return '';
  const entries = Object.entries(appearances).filter(([name]) => name.trim()).slice(0, 50);
  if (!entries.length || !process.env.OPENROUTER_API_KEY) return '';
  const names = entries.map(([name]) => name);
  const visibleText = `${narration}\n${imagePromptForModel}`.toLowerCase();
  const fallbackNames = names.filter(name => visibleText.includes(name.toLowerCase()));
  let selectedNames = fallbackNames;
  try {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'X-Title': 'JINSEI Image Character Filter'
      },
      body: JSON.stringify({
        model: IMAGE_CHARACTER_FILTER_MODEL,
        messages: [
          { role: 'system', content: 'Select ONE character physically visible in this imagePromptForModel. Return strict JSON: {"name":"exact registry name"}. Use only supplied registry names. Exclude characters who are merely remembered, mentioned, remote, or off-screen.' },
          { role: 'user', content: JSON.stringify({ narration, imagePromptForModel, registryNames: names }) }
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
        max_tokens: 120
      }),
      signal
    });
    if (!response.ok) throw new Error(`Character filter returned HTTP ${response.status}.`);
    const payload = await response.json();
    const parsed = JSON.parse(payload.choices?.[0]?.message?.content || '{}');
    if (Array.isArray(parsed.names)) selectedNames = parsed.names.map(String);
  } catch (error) {
    console.error('Image character filtering failed:', error);
  }
  const selectedSet = new Set(selectedNames.map(name => name.toLowerCase()));
  return entries.filter(([name]) => selectedSet.has(name.toLowerCase()))
    .map(([name, profile]) => formatCharacterAppearance(name, profile)).join('\n').slice(0, 2000);
}

function appOrigin(request) {
  return (process.env.APP_URL || new URL(request.url).origin).replace(/\/$/, '');
}

async function paddleRequest(path, body) {
  if (!process.env.PADDLE_API_KEY) throw new Error('PADDLE_API_KEY is not configured.');
  const response = await fetch(`https://api.paddle.com${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.PADDLE_API_KEY}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error?.detail || payload.error?.message || `Paddle returned HTTP ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return payload.data;
}

function paddlePriceForPlan(plan) {
  if (plan === 'unlimited') return process.env.PADDLE_PRICE_UNLIMITED;
  if (plan === 'pictures') return process.env.PADDLE_PRICE_PICTURES;
  return null;
}

function planForPaddlePrice(priceId) {
  if (priceId && priceId === process.env.PADDLE_PRICE_UNLIMITED) return 'unlimited';
  if (priceId && priceId === process.env.PADDLE_PRICE_PICTURES) return 'pictures';
  return 'free';
}

async function subscriptionRow(userId) {
  const { data, error } = await supabaseAdmin()
    .from('jinsei_subscriptions')
    .select('plan, status, paddle_customer_id, paddle_subscription_id, paddle_price_id, current_period_end, cancel_at_period_end')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function effectiveEntitlement(row) {
  const periodValid = !row?.current_period_end || new Date(row.current_period_end) > new Date();
  const active = Boolean(row && ACTIVE_SUBSCRIPTION_STATUSES.has(row.status) && periodValid);
  const plan = active && (row.plan === 'unlimited' || row.plan === 'pictures') ? row.plan : 'free';
  return {
    plan,
    unlimited: plan !== 'free',
    pictures: plan === 'pictures',
    status: row?.status || 'inactive',
    currentPeriodEnd: row?.current_period_end || null,
    cancelAtPeriodEnd: Boolean(row?.cancel_at_period_end),
    customerId: row?.paddle_customer_id || null,
    subscriptionId: row?.paddle_subscription_id || null
  };
}

async function entitlementForUser(user) {
  if (user?.username?.toLowerCase() === 'miara') {
    return {
      plan: 'pictures',
      unlimited: true,
      pictures: true,
      status: 'active',
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      customerId: null,
      subscriptionId: null
    };
  }
  return effectiveEntitlement(user ? await subscriptionRow(user.id) : null);
}

function usageIdentity(request, user) {
  if (user) return { subjectKey: `user:${user.id}`, newGuestToken: null };
  let token = request.cookies.get(GUEST_USAGE_COOKIE)?.value;
  let newGuestToken = null;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    token = randomBytes(32).toString('hex');
    newGuestToken = token;
  }
  const digest = createHash('sha256').update(token).digest('hex');
  return { subjectKey: `guest:${digest}`, newGuestToken };
}

async function turnUsage(subjectKey) {
  const { data, error } = await supabaseAdmin()
    .from('jinsei_turn_usage')
    .select('turns_used')
    .eq('subject_key', subjectKey)
    .maybeSingle();
  if (error) throw error;
  const used = data?.turns_used || 0;
  return { used, remaining: Math.max(0, FREE_TURN_LIMIT - used) };
}

async function reserveTurn(subjectKey, unlimited) {
  const { data, error } = await supabaseAdmin().rpc('consume_jinsei_turn', {
    p_subject_key: subjectKey,
    p_unlimited: unlimited
  });
  if (error) throw error;
  const result = data?.[0];
  return {
    allowed: Boolean(result?.allowed),
    used: Number(result?.used || 0),
    remaining: unlimited ? null : Number(result?.remaining || 0)
  };
}

async function refundTurn(subjectKey) {
  const { error } = await supabaseAdmin().rpc('refund_jinsei_turn', { p_subject_key: subjectKey });
  if (error) console.error('Could not refund failed turn quota:', error);
}

function setGuestUsageCookie(response, token) {
  if (!token) return;
  response.cookies.set({
    name: GUEST_USAGE_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: 365 * 24 * 60 * 60,
    path: '/'
  });
}

function verifyPaddleSignature(payload, signatureHeader) {
  const secret = process.env.PADDLE_WEBHOOK_SECRET;
  if (!secret || !signatureHeader) return false;
  const parts = signatureHeader.split(';').map(part => part.trim());
  const timestamp = parts.find(part => part.startsWith('ts='))?.slice(3);
  const signatures = parts.filter(part => part.startsWith('h1=')).map(part => part.slice(3));
  if (!timestamp || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}:${payload}`).digest('hex');
  return signatures.some(signature => {
    if (signature.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  });
}

async function syncPaddleSubscription(subscription) {
  const client = supabaseAdmin();
  let userId = Number(subscription.custom_data?.jinsei_user_id);
  if (!Number.isSafeInteger(userId)) {
    const { data, error } = await client.from('jinsei_subscriptions')
      .select('user_id')
      .or(`paddle_subscription_id.eq.${subscription.id},paddle_customer_id.eq.${subscription.customer_id}`)
      .maybeSingle();
    if (error) throw error;
    userId = data?.user_id;
  }
  if (!userId) throw new Error(`No JINSEI user mapping for Paddle subscription ${subscription.id}.`);
  const priceId = subscription.items?.[0]?.price?.id || null;
  const plan = subscription.status === 'canceled' ? 'free' : planForPaddlePrice(priceId);
  const periodEnd = subscription.current_billing_period?.ends_at || subscription.next_billed_at;
  const { error } = await client.from('jinsei_subscriptions').upsert({
    user_id: userId,
    plan,
    status: subscription.status,
    paddle_customer_id: String(subscription.customer_id),
    paddle_subscription_id: subscription.id,
    paddle_price_id: priceId,
    current_period_end: periodEnd || null,
    cancel_at_period_end: Boolean(subscription.scheduled_change?.action === 'cancel'),
    updated_at: new Date().toISOString()
  }, { onConflict: 'user_id' });
  if (error) throw error;
}

async function handlePaddleWebhook(request) {
  const payload = await request.text();
  if (!verifyPaddleSignature(payload, request.headers.get('paddle-signature'))) {
    return json({ error: 'Invalid Paddle signature.' }, 400);
  }
  const event = JSON.parse(payload);
  const client = supabaseAdmin();
  const { data: seen, error: seenError } = await client.from('jinsei_paddle_events')
    .select('event_id').eq('event_id', event.id).maybeSingle();
  if (seenError) throw seenError;
  if (seen) return json({ received: true, duplicate: true });

  if (event.event_type === 'subscription.created' ||
      event.event_type === 'subscription.updated' ||
      event.event_type === 'subscription.canceled' ||
      event.event_type === 'subscription.paused' ||
      event.event_type === 'subscription.resumed') {
    await syncPaddleSubscription(event.data);
  }

  const { error: eventError } = await client.from('jinsei_paddle_events').insert({
    event_id: event.event_id,
    event_type: event.event_type
  });
  if (eventError && eventError.code !== '23505') throw eventError;
  return json({ received: true });
}

async function generateimagePromptForModelImage(request, user) {
  const entitlement = await entitlementForUser(user);
  if (!entitlement.pictures) return json({ error: 'The Pictures plan is required.', code: 'PICTURES_PLAN_REQUIRED' }, 402);
  if (!process.env.REPLICATE_API_TOKEN) return json({ error: 'Server is missing REPLICATE_API_TOKEN.' }, 500);
  const { narration = '', imagePromptForModel = '', scene = '', appearances, country, lifeId, turnNumber, imageModel = 'illustrious', nsfw = false } = await request.json().catch(() => ({}));
  if (narration !== undefined && narration !== null && (typeof narration !== 'string' || narration.length > 1000)) return json({ error: 'Valid narration is required.' }, 400);
  const promptInput = (typeof imagePromptForModel === 'string' && imagePromptForModel.trim()) || (typeof scene === 'string' && scene.trim()) || '';
  if (promptInput.length > 4000) return json({ error: 'A valid scene or prompt is required.' }, 400);
  if (appearances !== undefined && (!appearances || typeof appearances !== 'object' || Array.isArray(appearances) || JSON.stringify(appearances).length > 50_000)) return json({ error: 'Appearances are invalid.' }, 400);
  if (!SUPPORTED_COUNTRIES.has(country)) return json({ error: 'A valid country is required.' }, 400);
  const imagePromptForModelText = promptInput;
  const promptText = imagePromptForModelText || (typeof narration === 'string' ? narration.trim() : '');
  if (!promptText) return json({ error: 'A valid imagePromptForModel or narration prompt is required.' }, 400);
  const selectedModelKey = imageModel === 'flux' ? 'flux' : 'illustrious';
  const selectedModelId = REPLICATE_IMAGE_MODELS[selectedModelKey];
  console.log("Image model is " + selectedModelKey + " (" + selectedModelId + "), prompt: " + promptText);
  //const characterDescriptions = await relevantCharacterDescriptions(narration.trim(), imagePromptForModelText, appearances, request.signal);
  const characterDescriptions = "";
  //const promptDirection = 'NSFW, cleavage, sex, oral sex, anal sex, lesbian, futa, pussy, BDSM, porn, one character';
  //const promptDirection = 'cleavage, sex, anal sex, BDSM, hardcore porn, hentai'
  const isNsfw = nsfw === true || nsfw === 'true' || nsfw === 1 || nsfw === '1';
  let promptDirection = 'cleavage';
  if (isNsfw) promptDirection += ', sex, anal sex, BDSM, hardcore porn, hentai';
  const imagePrompt = [
    narration,
    promptText,
    characterDescriptions ? `${characterDescriptions}` : '',
    `${promptDirection}`
  ].filter(Boolean).join('\n\n');
  if (typeof lifeId !== 'string' || !/^[0-9a-f-]{36}$/i.test(lifeId)) return json({ error: 'A valid life id is required.' }, 400);
  if (!Number.isInteger(turnNumber) || turnNumber < 0) return json({ error: 'A valid turn number is required.' }, 400);

  const client = supabaseAdmin();
  const { data: life, error: lifeError } = await client.from('jinsei_lives')
    .select('id, data').eq('id', lifeId).eq('user_id', user.id).maybeSingle();
  if (lifeError) throw lifeError;
  if (!life) return json({ error: 'Life not found.' }, 404);
  const savedTurn = Number(life.data?.turnCount || 0);
  if (turnNumber !== savedTurn && turnNumber !== savedTurn + 1) return json({ error: 'That image does not match the current turn.' }, 409);

  const promptHash = createHash('sha256').update(`${selectedModelKey}:${imagePrompt}`).digest('hex');
  const { data: generation, error: reserveError } = await client.from('jinsei_image_generations')
    .insert({ user_id: user.id, life_id: lifeId, turn_number: turnNumber, prompt_hash: promptHash })
    .select('id').single();
  if (reserveError?.code === '23505') {
    const { data: existing, error: existingError } = await client.from('jinsei_image_generations')
      .select('id, storage_path').eq('user_id', user.id).eq('life_id', lifeId).eq('turn_number', turnNumber).single();
    if (existingError) throw existingError;
    if (existing.storage_path) return json({ url: `/api/generated-image?id=${existing.id}`, cached: true });
    return json({ error: 'This turn\'s picture is already being generated.' }, 409);
  }
  if (reserveError) throw reserveError;

  try {
    console.info('[jinsei:image-prompt]', {
      lifeId,
      turnNumber,
      model: selectedModelKey,
      prompt: imagePrompt
    });
    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
    const isFlux = selectedModelKey === 'flux';
    const replicateInput = isFlux
      ? {
          prompt: imagePrompt,
          width: 768,
          height: 768,
          steps: 20,
          guidance_scale: 3.5,
          seed: -1
        }
      : {
          vae: 'WAI-NSFW-illustrious-SDXL-v8',
          prompt: imagePrompt,
          negative_prompt: "text",
          seed: -1,
          model: 'WAI-NSFW-illustrious-SDXL-v8',    
          steps: 30,
          width: 768,
          height: 768,
          cfg_scale: 5,
          clip_skip: 2,
          pag_scale: 3,
          scheduler: 'Euler a',
          batch_size: 1,
          guidance_rescale: 0.5,
          prepend_preprompt: true
        };
    const output = await replicate.run(selectedModelId, {
      input: replicateInput,
      wait: { mode: 'block', timeout: 60 },
      signal: request.signal
    });
    const outputFile = Array.isArray(output) ? output[0] : output;
    let imageBlob;
    if (outputFile && typeof outputFile.blob === 'function') {
      imageBlob = await outputFile.blob();
    } else if (typeof outputFile === 'string' && outputFile.startsWith('http')) {
      const resp = await fetch(outputFile);
      if (!resp.ok) throw new Error('Failed to download picture from Replicate URL.');
      imageBlob = await resp.blob();
    } else {
      throw new Error('Replicate did not return a generated picture.');
    }
    const image = Buffer.from(await imageBlob.arrayBuffer());
    if (!image.length || image.length > 10 * 1600 * 900) throw new Error('Generated picture has an invalid size.');
    const imageType = imageBlob.type || 'image/png';
    const extension = imageType.includes('webp') ? 'webp' : imageType.includes('jpeg') ? 'jpg' : 'png';
    const storagePath = `${user.id}/${lifeId}/${turnNumber}-${generation.id}.${extension}`;
    after(async () => {
      try {
        const { error: uploadError } = await client.storage.from('jinsei-images').upload(storagePath, image, {
          contentType: imageType,
          cacheControl: '31536000',
          upsert: false
        });
        if (uploadError) throw uploadError;
        const { error: updateError } = await client.from('jinsei_image_generations')
          .update({ storage_path: storagePath }).eq('id', generation.id);
        if (updateError) throw updateError;
      } catch (error) {
        await client.from('jinsei_image_generations').delete().eq('id', generation.id);
        console.error('imagePromptForModel image persistence failed:', error);
      }
    });
    return new Response(image, {
      headers: {
        'Content-Type': imageType,
        'X-Jinsei-Image-Id': generation.id,
        'Cache-Control': 'no-store'
      }
    });
  } catch (error) {
    await client.from('jinsei_image_generations').delete().eq('id', generation.id);
    console.error('imagePromptForModel image generation failed:', error);
    return json({ error: error.message || 'Image generation failed.' }, 502);
  }
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

  if (name === 'kana') {
    const text = new URL(request.url).searchParams.get('text');
    if (typeof text !== 'string' || !text.trim() || text.length > 500) return json({ error: 'Enter a valid Japanese line.' }, 400);
    const normalizedRomaji = text.trim().toLowerCase()
      .replace(/\bkonnichiwa\b/g, 'konnichiha')
      .replace(/\bkonbanwa\b/g, 'konbanha')
      .replace(/\bwa\b/g, 'ha')
      .replace(/\be\b/g, 'he')
      .replace(/\bo\b/g, 'wo');
    return json({ kana: toKana(normalizedRomaji) });
  }

  if (name === 'dictionary') {
    const url = new URL(request.url);
    const country = url.searchParams.get('country');
    const term = url.searchParams.get('term');
    if (!['japan', 'china', 'korea', 'hanja'].includes(country)) return json({ error: 'Choose a supported dictionary.' }, 400);
    if (typeof term !== 'string' || !term.trim() || term.length > 64) return json({ error: 'Enter a word to look up.' }, 400);
    try {
      return json(lookupDictionary(country, term), 200);
    } catch (error) {
      console.error('Dictionary lookup failed:', error);
      return json({ error: 'The dictionary could not be loaded.' }, 500);
    }
  }

  if (name === 'plan') {
    const user = await currentUser(request);
    const identity = usageIdentity(request, user);
    const [entitlement, usage] = await Promise.all([
      entitlementForUser(user),
      turnUsage(identity.subjectKey)
    ]);
    return json({
      username: user?.username || null,
      plan: entitlement.plan,
      status: entitlement.status,
      unlimited: entitlement.unlimited,
      pictures: entitlement.pictures,
      remaining: entitlement.unlimited ? null : usage.remaining,
      freeTurnLimit: FREE_TURN_LIMIT,
      currentPeriodEnd: entitlement.currentPeriodEnd,
      cancelAtPeriodEnd: entitlement.cancelAtPeriodEnd,
      billingConfigured: Boolean(process.env.PADDLE_API_KEY && process.env.PADDLE_PRICE_UNLIMITED && process.env.PADDLE_PRICE_PICTURES),
      canManageBilling: Boolean(entitlement.customerId)
    });
  }

  const auth = await requireUser(request);
  if (auth.response) return auth.response;

  if (name === 'me') return json({ username: auth.user.username });
  if (name === 'generated-image') {
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return json({ error: 'An image id is required.' }, 400);
    const { data: generation, error } = await supabaseAdmin().from('jinsei_image_generations')
      .select('storage_path').eq('id', id).eq('user_id', auth.user.id).maybeSingle();
    if (error) throw error;
    if (!generation?.storage_path) return json({ error: 'Picture not found.' }, 404);
    const { data: image, error: downloadError } = await supabaseAdmin().storage.from('jinsei-images').download(generation.storage_path);
    if (downloadError || !image) return json({ error: 'Picture not found.' }, 404);
    const extension = generation.storage_path.split('.').pop()?.toLowerCase();
    const storedType = image.type && image.type !== 'application/octet-stream'
      ? image.type
      : extension === 'png' ? 'image/png' : extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : 'image/webp';
    return new Response(await image.arrayBuffer(), {
      headers: {
        'Content-Type': storedType,
        'Cache-Control': 'private, max-age=31536000, immutable'
      }
    });
  }
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

  if (name === 'paddle-webhook') return handlePaddleWebhook(request);

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

  if (name === 'checkout') {
    const auth = await requireUser(request);
    if (auth.response) return auth.response;
    const { plan } = await request.json().catch(() => ({}));
    const price = paddlePriceForPlan(plan);
    if (!price) return json({ error: 'That subscription plan is not configured.' }, 400);
    const existing = await subscriptionRow(auth.user.id);
    const entitlement = effectiveEntitlement(existing);
    if (entitlement.unlimited && entitlement.subscriptionId) {
      return json({ error: 'Manage your existing subscription before changing plans.', code: 'SUBSCRIPTION_EXISTS' }, 409);
    }
    try {
      const transaction = await paddleRequest('/transactions', {
        items: [{ price_id: price, quantity: 1 }],
        collection_mode: 'automatic',
        custom_data: { jinsei_user_id: auth.user.id, plan },
        checkout: { url: appOrigin(request) }
      });
      if (!transaction.checkout?.url) throw new Error('Paddle did not return a checkout URL.');
      return json({ url: transaction.checkout.url });
    } catch (error) {
      console.error('Could not create Paddle checkout:', error);
      return json({ error: error.message || 'Could not start checkout.' }, error.status || 502);
    }
  }

  if (name === 'portal') {
    const auth = await requireUser(request);
    if (auth.response) return auth.response;
    const existing = await subscriptionRow(auth.user.id);
    if (!existing?.paddle_customer_id) return json({ error: 'No billing account exists yet.' }, 404);
    try {
      const portal = await paddleRequest(`/customers/${encodeURIComponent(existing.paddle_customer_id)}/portal-sessions`, {
        subscription_ids: existing.paddle_subscription_id ? [existing.paddle_subscription_id] : []
      });
      return json({ url: portal.urls?.general?.overview });
    } catch (error) {
      console.error('Could not create Paddle customer portal session:', error);
      return json({ error: error.message || 'Could not open billing settings.' }, error.status || 502);
    }
  }

  if (name === 'image') {
    const auth = await requireUser(request);
    if (auth.response) return auth.response;
    return generateimagePromptForModelImage(request, auth.user);
  }

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

    const lastMessage = messages.at(-1)?.content;
    const countTowardLimit = !(typeof lastMessage === 'string' && lastMessage.startsWith('[GAME START]'));
    const identity = usageIdentity(request, user);
    const entitlement = await entitlementForUser(user);
    let reservation = { allowed: true, remaining: entitlement.unlimited ? null : FREE_TURN_LIMIT };
    if (countTowardLimit) {
      reservation = await reserveTurn(identity.subjectKey, entitlement.unlimited);
      if (!reservation.allowed) {
        const response = json({
          error: 'You have used all 20 free turns. Choose a plan to keep playing.',
          code: 'TURN_LIMIT',
          remaining: 0
        }, 402);
        setGuestUsageCookie(response, identity.newGuestToken);
        return response;
      }
    }

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
          max_tokens: 2000,
          stream: true,
          provider: { sort: 'latency' }
        }),
        signal: request.signal
      });
    } catch (error) {
      if (countTowardLimit && !entitlement.unlimited) await refundTurn(identity.subjectKey);
      console.error('Could not reach OpenRouter:', error);
      return json({ error: 'Could not reach the OpenRouter API.' }, 502);
    }
    if (!upstream.ok || !upstream.body) {
      if (countTowardLimit && !entitlement.unlimited) await refundTurn(identity.subjectKey);
      const detail = await upstream.text().catch(() => '');
      console.error('OpenRouter API error:', upstream.status, detail);
      return json({ error: 'OpenRouter API returned an error.', detail }, upstream.status);
    }
    const response = new NextResponse(upstream.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
        'X-Jinsei-Plan': entitlement.plan,
        'X-Jinsei-Remaining': reservation.remaining === null ? 'unlimited' : String(reservation.remaining)
      }
    });
    setGuestUsageCookie(response, identity.newGuestToken);
    return response;
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
