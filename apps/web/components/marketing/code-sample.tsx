const lines = [
  "await request('/v1/payments', {",
  "  method: 'POST',",
  "  headers: { 'Idempotency-Key': 'demo-1' },",
  '  body: JSON.stringify({',
  "    amount: 1500000, currency: 'NGN',",
  "    customer: { email: 'ada@example.com' }",
  '  })',
  '});',
];
export function CodeSample() {
  return (
    <div className="request-code">
      <div className="code-caption">scripts/demo/walkthrough.mts · request shape</div>
      <pre>
        <code>
          {lines.map((line, index) => (
            <span className={index === 2 ? 'code-line code-highlight' : 'code-line'} key={line}>
              <span className="line-number" aria-hidden="true">
                {index + 1}
              </span>
              {line}
              {'\n'}
            </span>
          ))}
        </code>
      </pre>
      <div className="code-result">
        <span>201 Created</span>
        <span>Same body → replay · Changed body → 409</span>
      </div>
    </div>
  );
}
