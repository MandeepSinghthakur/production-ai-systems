// Open-loop load generator. Arrival rate is fixed regardless of how
// slow responses get — which is the whole point, since a closed-loop
// generator masks brownouts by naturally backing off.

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 1) {
  const a = process.argv[i];
  if (a.startsWith('--')) args.set(a.slice(2), process.argv[i + 1] ?? 'true');
}

const rps = Number(args.get('rps') ?? 20);
const durationS = Number((args.get('duration') ?? '60s').replace('s', ''));
const abortAfterMs = args.has('abort-after')
  ? Number((args.get('abort-after') ?? '2s').replace('s', '')) * 1000
  : 0;
const tenant = args.get('tenant') ?? 'acme';
const workload = args.get('workload') ?? 'support-assistant';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:8080';

let sent = 0;
let ok = 0;
let failed = 0;
let aborted = 0;

async function fire(): Promise<void> {
  sent += 1;
  const controller = new AbortController();
  if (abortAfterMs > 0) {
    setTimeout(() => controller.abort(), abortAfterMs);
  }

  try {
    const res = await fetch(`${GATEWAY}/v1/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tenant,
        workload,
        model: 'mid',
        maxTokens: 40,
        messages: [{ role: 'user', content: 'explain gateways' }],
      }),
    });

    if (!res.ok || !res.body) {
      failed += 1;
      return;
    }

    const reader = res.body.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
    ok += 1;
  } catch {
    if (controller.signal.aborted) aborted += 1;
    else failed += 1;
  }
}

const intervalMs = 1000 / rps;
const stop = Date.now() + durationS * 1000;

const timer = setInterval(() => {
  if (Date.now() >= stop) {
    clearInterval(timer);
    setTimeout(report, 2000);
    return;
  }
  void fire();
}, intervalMs);

async function report(): Promise<void> {
  const m = await (await fetch(`${GATEWAY}/metrics`)).json();
  console.log(
    JSON.stringify(
      {
        client: { sent, ok, failed, aborted },
        gateway_requests: m.gateway_requests,
        provider_requests: m.provider_requests,
        amplification: m.amplification,
        retries: m.retries ?? 0,
        rejected_breaker: m.rejected_breaker ?? 0,
        breaker: m.breaker,
        time_to_first_token: m.time_to_first_token,
        total_duration: m.total_duration,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
