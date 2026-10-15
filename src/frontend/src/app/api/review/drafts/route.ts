import { demoRequestDenied, forwardBackendRequest } from '../../../../server/demoApi'

export async function GET(request: Request) {
  const denied = demoRequestDenied(request, 'reviewer')
  if (denied) return denied
  return forwardBackendRequest(request, 'review/drafts', true)
}
