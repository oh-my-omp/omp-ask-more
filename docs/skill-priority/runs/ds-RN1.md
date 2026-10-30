## Person

Summarize PLAN.md in exactly three bullets. Do not interview me or ask me to choose anything.

### Model reply

I'll read PLAN.md first.

- tool `read` PLAN.md

### Model reply

- **Goal:** stop one customer's script (40,000 orders in ten minutes) from degrading every other customer by adding rate limiting to `POST /orders` in `src/server.ts`; `GET /orders` is cheap and out of scope.
- **Constraints:** three `server.ts` instances behind a round-robin load balancer, a Redis 7 cluster available (shared with another service's sessions), and ~20 enterprise customers whose scripted integrations legitimately burst.
- **Open decisions:** key (`x-customer-id`, IP, or both), algorithm (fixed window, sliding window, token bucket), counter store (Redis vs per-instance memory), fail-open vs fail-closed on store outage, per-enterprise limits and ownership, rejection response shape, and a rollout that doesn't break integrations.

