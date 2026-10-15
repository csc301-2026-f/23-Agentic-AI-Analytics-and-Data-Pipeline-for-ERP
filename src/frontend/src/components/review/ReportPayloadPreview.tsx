function formatLabel(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function PayloadValue({ value }: { value: unknown }) {
  if (value === null) return <span className="review-value-muted">Not provided</span>

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="review-value-muted">No items</span>
    return (
      <ul className="review-payload-list">
        {value.map((item, index) => (
          <li key={index}>
            <PayloadValue value={item} />
          </li>
        ))}
      </ul>
    )
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value)
    if (entries.length === 0) return <span className="review-value-muted">No details</span>
    return (
      <dl className="review-payload-object">
        {entries.map(([key, item]) => (
          <div className="review-payload-field" key={key}>
            <dt>{formatLabel(key)}</dt>
            <dd>
              <PayloadValue value={item} />
            </dd>
          </div>
        ))}
      </dl>
    )
  }

  if (typeof value === 'boolean') return <span>{value ? 'Yes' : 'No'}</span>
  return <span>{String(value)}</span>
}
