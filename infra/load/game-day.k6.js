// Burst load test for game-day traffic (spec §16 nonfunctional gate).
// Run ONLY against local or staging:  k6 run -e BASE=https://staging.example.com infra/load/game-day.k6.js
// Report measured p95 latency, error rate, RPS and server CPU/memory. Do not extrapolate to unmeasured scale.
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE || 'http://localhost:5173';
const SLUG = __ENV.SLUG || 'demo-fall-classic';

export const options = {
  scenarios: {
    // Parents refreshing schedules before first pitch, then a rain-delay spike.
    morning: { executor: 'ramping-vus', startVUs: 0, stages: [{ duration: '1m', target: 100 }, { duration: '3m', target: 100 }, { duration: '30s', target: 0 }] },
    rain_delay_spike: { executor: 'constant-arrival-rate', rate: 200, timeUnit: '1s', duration: '1m', preAllocatedVUs: 200, startTime: '2m' },
  },
  thresholds: { http_req_failed: ['rate<0.01'], http_req_duration: ['p(95)<800'] },
};

export default function () {
  const urls = [`/api/game-day`, `/api/tournaments/${SLUG}`, `/api/tournaments/${SLUG}/games`, `/api/tournaments/${SLUG}/announcements`, `/api/tournaments/${SLUG}/brackets`];
  for (const u of urls) {
    const r = http.get(BASE + u);
    check(r, { ok: (res) => res.status === 200 });
  }
  sleep(Math.random() * 3 + 2);
}
