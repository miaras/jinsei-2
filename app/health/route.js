import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({
    ok: true,
    keyConfigured: Boolean(process.env.OPENAI_API_KEY),
    imagesConfigured: false
  });
}
