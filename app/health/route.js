import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({
    ok: true,
    keyConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    storageConfigured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY),
    imagesConfigured: false
  });
}
