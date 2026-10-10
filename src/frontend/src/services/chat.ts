import type { AnalyticsChartSpec } from '../components/charts'

export type ChatReply = {
  response: string
  chart?: AnalyticsChartSpec | null
}

function isLineChartSpec(value: Record<string, unknown>): boolean {
  return value.type === 'line' &&
    'title' in value &&
    typeof value.title === 'string' &&
    'xAxisName' in value &&
    typeof value.xAxisName === 'string' &&
    'yAxisName' in value &&
    typeof value.yAxisName === 'string' &&
    'seriesNames' in value &&
    Array.isArray(value.seriesNames) &&
    value.seriesNames.every((name) => typeof name === 'string') &&
    'data' in value &&
    Array.isArray(value.data) &&
    value.data.every(
      (series) =>
        Array.isArray(series) &&
        series.every(
          (point) =>
            Array.isArray(point) &&
            point.length === 2 &&
            (typeof point[0] === 'number' || typeof point[0] === 'string') &&
            typeof point[1] === 'number',
        ),
    )
}

function isBarChartSpec(value: Record<string, unknown>): boolean {
  return value.type === 'bar' &&
    typeof value.title === 'string' &&
    typeof value.xAxisName === 'string' &&
    typeof value.yAxisName === 'string' &&
    Array.isArray(value.data) &&
    value.data.every(
      (row) =>
        typeof row === 'object' &&
        row !== null &&
        !Array.isArray(row) &&
        'category' in row &&
        typeof row.category === 'string' &&
        Object.entries(row).every(
          ([key, item]) =>
            key === 'category' || typeof item === 'number' || typeof item === 'string',
        ),
    )
}

function isPieChartSpec(value: Record<string, unknown>): boolean {
  return value.type === 'pie' &&
    typeof value.title === 'string' &&
    Array.isArray(value.data) &&
    value.data.every(
      (slice) =>
        typeof slice === 'object' &&
        slice !== null &&
        'label' in slice &&
        typeof slice.label === 'string' &&
        'value' in slice &&
        typeof slice.value === 'number' &&
        (!('color' in slice) || typeof slice.color === 'string' || slice.color === null),
    )
}

function isAnalyticsChartSpec(value: unknown): value is AnalyticsChartSpec {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false
  }

  const chart = value as Record<string, unknown>
  return isLineChartSpec(chart) || isBarChartSpec(chart) || isPieChartSpec(chart)
}

export async function sendChatMessage(
  message: string,
  signal: AbortSignal,
): Promise<ChatReply> {
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

  if (
    'chart' in result &&
    result.chart !== null &&
    result.chart !== undefined &&
    !isAnalyticsChartSpec(result.chart)
  ) {
    throw new Error('The assistant returned an invalid chart. Please try again.')
  }

  return {
    response: result.response,
    chart: 'chart' in result && isAnalyticsChartSpec(result.chart) ? result.chart : undefined,
  }
}
