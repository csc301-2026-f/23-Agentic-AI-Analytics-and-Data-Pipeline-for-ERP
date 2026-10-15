import { NextResponse } from 'next/server'

export function GET() {
  const enabled =
    process.env.NODE_ENV !== 'production' &&
    process.env.REVIEW_DEMO_MODE === 'real'
  return NextResponse.json(
    { mode: enabled ? 'real' : 'mock' },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
