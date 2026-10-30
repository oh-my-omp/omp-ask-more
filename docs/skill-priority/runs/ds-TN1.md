## Person

Summarize PLAN.md in exactly three bullets. Do not interview me or ask me to choose anything.

- tool `read` PLAN.md

### Model reasoning

```text
User wants exactly three bullets summarizing PLAN.md, no interview, no questions. Straightforward. Palm off? No — just do it.

Three bullets: problem/goal; environment/constraints; open decisions.

Keep terse.
```

### Model reply

- **Problem & goal:** one customer's script placed 40,000 orders in ten minutes and degraded latency for everyone; add rate limiting to `src/server.ts` and ship within the week.
- **Environment:** three `src/server.ts` instances behind a round-robin LB; a shared Redis 7 cluster is available; `POST /orders` is the expensive Postgres write, `GET /orders` is cheap; ~20 enterprise customers burst legitimately.
- **Undecided:** key (`x-customer-id` vs IP vs both), algorithm (fixed/sliding window, token bucket), counter store (Redis vs per-instance memory), fail-open vs fail-closed on store outage, higher enterprise limits and their owner, rejection response, and a rollout that doesn't break enterprise integrations.

