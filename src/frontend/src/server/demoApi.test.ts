import { describe, expect, it } from 'vitest'
import { isLocalDemoRequest } from './demoApiPolicy'

describe('isLocalDemoRequest', () => {
  it('allows same-origin loopback requests in development', () => {
    expect(
      isLocalDemoRequest(
        '127.0.0.1:3000',
        'http://127.0.0.1:3000',
        'POST',
        'development',
      ),
    ).toBe(true)
  })

  it('rejects non-loopback hosts and mismatched origins', () => {
    expect(
      isLocalDemoRequest(
        '192.0.2.1:3000',
        'http://192.0.2.1:3000',
        'POST',
        'development',
      ),
    ).toBe(false)
    expect(
      isLocalDemoRequest(
        'localhost:3000',
        'http://127.0.0.1:3000',
        'POST',
        'development',
      ),
    ).toBe(false)
  })

  it('requires an origin for mutations and disables the gate in production', () => {
    expect(isLocalDemoRequest('localhost:3000', null, 'POST', 'development')).toBe(
      false,
    )
    expect(
      isLocalDemoRequest(
        'localhost:3000',
        'http://localhost:3000',
        'POST',
        'production',
      ),
    ).toBe(false)
  })
})
