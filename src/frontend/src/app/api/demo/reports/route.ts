import { demoRequestDenied, forwardBackendRequest } from '../../../../server/demoApi'

export async function POST(request: Request) {
  const denied = demoRequestDenied(request, 'business')
  if (denied) return denied
  return forwardBackendRequest(request, 'demo/reports')
}
