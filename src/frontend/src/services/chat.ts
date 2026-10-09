export async function sendChatMessage(
  message: string,
  signal: AbortSignal,
): Promise<string> {
  let response: Response
  try {
    response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
      signal,
    })
  } catch (error) {
    if (signal.aborted) throw error
    if (error instanceof TypeError) {
      throw new Error(
        'Could not reach the backend. Start it from the repository root with "uvicorn src.backend.app:app --reload", then try again.',
        { cause: error },
      )
    }
    throw error
  }

  if (!response.ok) {
    throw new Error(`The assistant request failed (${response.status}). Please try again.`)
  }

  const result: unknown = await response.json()
  if (
    typeof result !== 'object' ||
    result === null ||
    !('response' in result) ||
    typeof result.response !== 'string'
  ) {
    throw new Error('The assistant returned an invalid response. Please try again.')
  }

  return result.response
}
