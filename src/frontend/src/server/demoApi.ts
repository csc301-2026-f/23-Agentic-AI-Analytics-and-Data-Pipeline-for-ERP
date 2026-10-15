import 'server-only'
import { NextResponse } from 'next/server'
import { isLocalDemoRequest } from './demoApiPolicy'

type DemoRequestKind = 'reviewer' | 'business'

export function demoRequestDenied(
  request: Request,
  kind: DemoRequestKind,
): NextResponse | null {
  if (
    process.env.NODE_ENV === 'production' ||
    process.env.REVIEW_DEMO_MODE !== 'real' ||
    (kind === 'business' && process.env.GENLEDGE_DEMO_MODE !== '1')
  ) {
    return NextResponse.json(
      { detail: 'The local review demo is not enabled.' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  if (
    !isLocalDemoRequest(
      request.headers.get('host'),
      request.headers.get('origin'),
      request.method,
      process.env.NODE_ENV,
    )
  ) {
    return NextResponse.json(
      { detail: 'The local review demo is only available on this machine.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  if (kind === 'reviewer' && !process.env.REVIEWER_DEMO_SECRET) {
    return NextResponse.json(
      { detail: 'Reviewer access is not configured on the server.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  return null
}

export async function forwardBackendRequest(
  request: Request,
  backendPath: string,
  reviewer = false,
): Promise<NextResponse> {
  const backendUrl = (process.env.BACKEND_URL ?? 'http://127.0.0.1:8000').replace(
    /\/+$/,
    '',
  )
  const headers = new Headers()
  headers.set('Accept', 'application/json')
  if (reviewer) {
    headers.set('X-Reviewer-Secret', process.env.REVIEWER_DEMO_SECRET ?? '')
  }

  let body: string | undefined
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const rawBody = await request.text()
    if (rawBody) {
      headers.set('Content-Type', 'application/json')
      body = rawBody
    }
  }

  try {
    const upstream = await fetch(`${backendUrl}/api/${backendPath}`, {
      method: request.method,
      headers,
      body,
      cache: 'no-store',
    })
    const responseBody = await upstream.text()
    return new NextResponse(responseBody, {
      status: upstream.status,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type':
          upstream.headers.get('content-type') ?? 'application/json',
      },
    })
  } catch {
    return NextResponse.json(
      { detail: 'The local API could not be reached.' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
