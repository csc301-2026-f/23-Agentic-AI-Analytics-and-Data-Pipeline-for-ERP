import { NextResponse } from 'next/server'
import { demoRequestDenied, forwardBackendRequest } from '../../../../../../server/demoApi'

type RouteParams = {
  params: Promise<{ draftId: string; decision: string }>
}

export async function POST(request: Request, { params }: RouteParams) {
  const denied = demoRequestDenied(request, 'reviewer')
  if (denied) return denied

  const { draftId, decision } = await params
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      draftId,
    ) ||
    (decision !== 'approve' && decision !== 'reject')
  ) {
    return NextResponse.json(
      { detail: 'Invalid draft decision request.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  return forwardBackendRequest(
    request,
    `review/drafts/${encodeURIComponent(draftId)}/${decision}`,
    true,
  )
}
