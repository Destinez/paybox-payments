import { readFile, writeFile } from 'node:fs/promises';
import { demonstrateX402, prepareX402Demo } from '../../apps/api/src/x402/demo';

const base = process.env.API_PUBLIC_URL ?? 'http://localhost:4000';
const receiver = process.env.DEMO_RECEIVER_PUBLIC_URL ?? 'http://127.0.0.1:4100';
const credentials = JSON.parse(await readFile('.local/demo.json', 'utf8'));
const headers = { Authorization: `Bearer ${credentials.api_key}`, 'Content-Type': 'application/json' };
const stateFile = '.local/walkthrough.json';
let state: {
  first?: { id: string; reference: string };
  second?: { id: string; reference: string };
  job?: string;
  run?: string;
  refund?: string;
} = {};
try {
  state = JSON.parse(await readFile(stateFile, 'utf8'));
} catch {}
const save = () => writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
function check(value: unknown, detail: string): asserts value {
  if (!value) throw new Error(detail);
}
async function request(path: string, options: RequestInit = {}) {
  const response = await fetch(`${base}${path}`, { ...options, headers: { ...headers, ...options.headers } });
  const body = await response.text();
  return { response, data: body.startsWith('{') ? JSON.parse(body) : body };
}
async function waitFor<T>(
  read: () => Promise<T>,
  ready: (value: T) => boolean,
  description: string,
  timeout = 45000,
): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await read();
    if (ready(value)) return value;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for ${description}; ensure the worker runs with DEMO_MODE=true`);
}
async function adminHeaders() {
  const { response, data } = await request('/v1/session/login', {
    method: 'POST',
    body: JSON.stringify({ email: credentials.email, password: credentials.password }),
  });
  check(response.status === 200, 'Dashboard login failed');
  return {
    Cookie: response.headers.get('set-cookie')!.split(';')[0]!,
    'X-CSRF-Token': data.csrf_token,
    'Content-Type': 'application/json',
  };
}
async function control(body: unknown) {
  const result = await request('/fake/control', { method: 'POST', body: JSON.stringify(body) });
  check(result.response.ok, 'Fake processor control failed');
}
async function receiverControl(fail: boolean) {
  const response = await fetch(`${receiver}/control`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fail }),
  });
  check(response.ok, 'Receiver control failed');
}
async function createFirst() {
  await prepareX402Demo();
  const key = `demo-${Date.now()}`;
  const body = { amount: 1500000, currency: 'NGN', customer: { email: 'ada@example.com' } };
  const options = { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(body) };
  const first = await request('/v1/payments', options),
    replay = await request('/v1/payments', options);
  const conflict = await request('/v1/payments', {
    ...options,
    body: JSON.stringify({ ...body, amount: 1600000 }),
  });
  check(
    first.response.status === 201 &&
      replay.response.status === 201 &&
      first.data.id === replay.data.id &&
      replay.response.headers.get('Idempotent-Replayed') === 'true',
    'Idempotency replay failed',
  );
  check(
    conflict.response.status === 409 && conflict.data.code === 'idempotency_key_reuse',
    'Idempotency conflict failed',
  );
  state = { first: { id: first.data.id, reference: first.data.reference } };
  await save();
  await request(`/fake/checkout/${state.first!.reference}/succeed`, { method: 'POST' });
  await waitFor(
    async () => (await request(`/v1/payments/${state.first!.id}`)).data,
    (p) => p.status === 'succeeded',
    'verified payment',
  );
  console.info('01: 201 → replayed 201 → conflicting 409; checkout verified and ledger posted');
}
async function replayWebhook() {
  check(state.first, 'Run step 01 first');
  const before = (await request(`/v1/payments/${state.first.id}`)).data;
  await control({ reference: state.first.reference, duplicate: 3 });
  await new Promise((r) => setTimeout(r, 600));
  const after = (await request(`/v1/payments/${state.first.id}`)).data;
  check(after.ledger_entries.length === before.ledger_entries.length, 'Webhook replay changed the ledger');
  console.info('02: three signed webhook replays; ledger unchanged');
}
async function breakReceiver() {
  check(state.first, 'Run step 01 first');
  await waitFor(
    async () => (await fetch(`${receiver}/status`)).json(),
    (r: { events: { type: string }[] }) => r.events.some((e) => e.type === 'payment.succeeded'),
    'first merchant notification',
  );
  await receiverControl(true);
  const second = await request('/v1/payments', {
    method: 'POST',
    headers: { 'Idempotency-Key': `demo-second-${Date.now()}` },
    body: JSON.stringify({ amount: 1500000, customer: { email: 'tunde@example.com' } }),
  });
  check(second.response.status === 201, 'Second payment could not be created');
  state.second = { id: second.data.id, reference: second.data.reference };
  await save();
  await request(`/fake/checkout/${state.second.reference}/succeed`, { method: 'POST' });
  const auth = await adminHeaders();
  const result = await waitFor(
    async () => (await request('/v1/admin/dlq', { headers: auth })).data,
    (r) => r.data.some((job: { aggregateId: string }) => job.aggregateId === state.second!.id),
    'eight retries and dead-letter state',
  );
  const job = result.data.find((job: { aggregateId: string }) => job.aggregateId === state.second!.id);
  check(job.history.length === 8, 'Expected eight preserved attempts');
  state.job = job.id;
  await save();
  console.info('03: merchant outage exhausted eight attempts; notification is in the DLQ');
}
async function replayJob() {
  check(state.job && state.second, 'Run step 03 first');
  await receiverControl(false);
  const auth = await adminHeaders();
  const result = await request(`/v1/admin/dlq/${state.job}/replay`, { method: 'POST', headers: auth });
  check([202, 409].includes(result.response.status), 'Replay failed');
  await waitFor(
    async () => (await request(`/v1/admin/payments/${state.second!.id}`, { headers: auth })).data,
    (p) =>
      p.timeline.some(
        (event: { job_id: string; detail: { outcome: string } }) =>
          event.job_id === state.job && event.detail.outcome === 'succeeded',
      ),
    'replayed delivery',
  );
  console.info('Replay: notification delivered; attempt history and operator audit retained');
}
async function driftAndRefund() {
  check(state.second, 'Run step 03 first');
  await control({ reference: state.second.reference, drift: -50000 });
  const auth = await adminHeaders();
  const started = await request('/v1/admin/reconciliation/runs', { method: 'POST', headers: auth });
  check(started.response.status === 202, 'Reconciliation did not start');
  state.run = started.data.id;
  await save();
  const report = await waitFor(
    async () => (await request(`/v1/admin/reconciliation/runs/${state.run}`, { headers: auth })).data,
    (r) => r.status === 'completed',
    'reconciliation',
    60000,
  );
  check(
    report.items.some(
      (item: { kind: string; paymentId: string }) =>
        item.kind === 'amount_mismatch' && item.paymentId === state.second!.id,
    ),
    'Amount drift was not flagged',
  );
  const refund = await request(`/v1/payments/${state.second.id}/refunds`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `demo-refund-${Date.now()}` },
    body: JSON.stringify({ amount: 500000, reason: 'Partial refund demonstration' }),
  });
  check(refund.response.status === 202, 'Partial refund was not accepted');
  state.refund = refund.data.id;
  await save();
  const excess = await request(`/v1/payments/${state.second.id}/refunds`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `demo-excess-${Date.now()}` },
    body: JSON.stringify({ amount: 2000000, reason: 'Exceeds remaining balance' }),
  });
  check(
    excess.response.status === 422 && excess.data.code === 'refund_exceeds_refundable',
    'Excess refund was not rejected',
  );
  await waitFor(
    async () => (await request(`/v1/refunds/${state.refund}`)).data,
    (r) => r.status === 'processed',
    'processed partial refund',
  );
  console.info('04: ₦15,000 vs ₦14,500 drift flagged; ₦5,000 refund processed; excessive refund rejected');
}
const step = process.argv[2] ?? 'all';
check(
  (await request('/fake/info')).response.ok,
  'This deterministic walkthrough requires PAYSTACK_MODE=fake',
);
if (step === 'all' || step === '01') await createFirst();
if (step === 'all' || step === '02') await replayWebhook();
if (step === 'all' || step === '03') await breakReceiver();
if (step === 'all' || step === 'replay') await replayJob();
if (step === 'all' || step === '04') await driftAndRefund();
if (step === 'all') {
  await prepareX402Demo();
  await demonstrateX402();
  console.info('Demo complete. Inspect the dashboard timeline, reconciliation report and paid endpoints.');
}
