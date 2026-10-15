export function isLocalDemoRequest(
  host: string | null,
  origin: string | null,
  method: string,
  nodeEnvironment: string,
) {
  if (nodeEnvironment === 'production' || !host || host.includes(',')) return false

  let hostUrl: URL
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (
    hostUrl.username ||
    hostUrl.password ||
    !['localhost', '127.0.0.1', '[::1]'].includes(hostUrl.hostname)
  ) {
    return false
  }
  if (!origin) return method === 'GET'

  try {
    const originUrl = new URL(origin)
    return (
      (originUrl.protocol === 'http:' || originUrl.protocol === 'https:') &&
      ['localhost', '127.0.0.1', '[::1]'].includes(originUrl.hostname) &&
      originUrl.host.toLowerCase() === host.toLowerCase()
    )
  } catch {
    return false
  }
}
