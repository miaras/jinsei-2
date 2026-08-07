import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({
    ok: true,
    keyConfigured: Boolean(process.env.OPENROUTER_API_KEY),
    turnProvider: 'openrouter',
    speechConfigured: Boolean(process.env.GOOGLE_TTS_API_KEY),
    storageConfigured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY),
    imagesConfigured: Boolean(process.env.REPLICATE_API_TOKEN),
    billingConfigured: Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET && process.env.STRIPE_PRICE_UNLIMITED && process.env.STRIPE_PRICE_PICTURES)
  });
}
