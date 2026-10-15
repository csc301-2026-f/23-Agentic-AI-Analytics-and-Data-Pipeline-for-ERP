import { NextResponse } from 'next/server'
import { demoRequestDenied, forwardBackendRequest } from '../../../../../server/demoApi'

type RouteParams = {
  params: Promise<{ draftId: string }>
}

export async function GET(request: Request, { params }: RouteParams) {
  const denied = demoRequestDenied(request, 'business')
  if (denied) return denied

  const { draftId } = await params
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      draftId,
    )
  ) {
    return NextResponse.json(
      { detail: 'Invalid draft identifier.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  return forwardBackendRequest(
    request,
    `reports/${encodeURIComponent(draftId)}/approved`,
  )
}
