# Plan: rate limiting for the orders API

One customer's script created 40,000 orders in ten minutes last week and slowed every other customer down. I want to add rate limiting to `src/server.ts` and ship it this week.

What we have:

- 3 instances of `src/server.ts` behind a round-robin load balancer.
- A Redis 7 cluster already used for sessions by another service; we may use it.
- `POST /orders` writes to Postgres and is the expensive call; `GET /orders` is cheap.
- About 20 enterprise customers have scripted integrations that legitimately burst.

Not decided yet:

- What to key the limit on: `x-customer-id`, client IP, or both.
- Algorithm: fixed window, sliding window, or token bucket.
- Where counters live: Redis, or in each instance's memory.
- What happens if the counter store is unreachable: let requests through or reject them.
- How enterprise customers get higher limits, and who owns those numbers.
- What a rejected client sees.
- How to roll it out without breaking the enterprise integrations.
