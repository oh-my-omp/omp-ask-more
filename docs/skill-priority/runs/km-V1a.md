## Person: `/skill:grilling Grill me on the unresolved decisions in PLAN.md. Do not implement the plan.`

omp injected the skill as a user-attributed message: its first line, then the 25 lines of `grilling/SKILL.md`.

```text
[IMPORTANT: User invoked the "grilling" skill; follow its instructions. Full skill below.]
```

### Model reasoning

```text
The user wants me to grill them on unresolved decisions in PLAN.md. I need to read the skill first, then read PLAN.md, then identify unresolved decisions and ask them as a design tree frontier.
```

- tool `read` skill://grilling

- tool `read` PLAN.md

### Model reasoning

```text
I have the plan. The "Not decided yet" section lists 7 unresolved decisions. These are mostly independent, so they form the first frontier. I need to ask them all in one round, with recommended answers, worded so "yes" accepts the recommended answer.

Let me think through each:

1. What to key the limit on: x-customer-id, client IP, or both.
   - Recommended: x-customer-id, because enterprise customers have scripts and IP may vary; IP could be fallback but x-customer-id is the identity.
   - Better: x-customer-id primary, client IP fallback for unauthenticated? But plan says POST /orders likely needs auth. Let's recommend x-customer-id.

2. Algorithm: fixed window, sliding window, or token bucket.
   - For burst-friendly enterprise: token bucket. Allows bursting while controlling sustained rate. More complex but fits "legitimately burst". Sliding window log is more accurate but expensive. Fixed window has thundering herd at boundaries.
   - Recommended: token bucket.

3. Where counters live: Redis, or in each instance's memory.
   - 3 instances behind LB; per-instance memory means 3x budget. Redis cluster exists, can use it. Recommended: Redis, with instance memory fallback only if Redis unreachable? But that's another decision. For counters: Redis.

4. What happens if counter store is unreachable: let requests through or reject them.
   - This is fail-open vs fail-closed. Rate limiting is about protecting the system; if Redis is down, maybe fail-open to avoid breaking all orders? But that's risky. For enterprise customers, fail-open preserves revenue but sacrifices protection. The incident was one customer causing damage. Recommended: fail-open with alert/metric, because reject-all is worse outage. But depends on risk appetite. Hmm. Actually for critical order API, failing closed may be safer. Need to think. The plan says "ship this week" and "without breaking enterprise integrations". Fail-open aligns with not breaking things but leaves exposure. Maybe recommended: fail-open with circuit breaker alert.

5. How enterprise customers get higher limits, and who owns those numbers.
   - Options: hardcoded list, config table in DB, self-serve portal, support team. Recommended: a config table keyed by customer with overrides, owned by support/account management. Engineering shouldn't own business numbers.

6. What a rejected client sees.
   - HTTP 429 Too Many Requests, with Retry-After header. Body maybe JSON error. Recommended: 429 with Retry-After header.

7. How to roll it out without breaking the enterprise integrations.
   - Options: dry-run/monitor only mode, gradually lower limits, per-customer opt-in, shadow mode. Recommended: start in dry-run/monitor mode where violations are logged but not rejected, then enforce after measuring traffic patterns; set enterprise limits based on p99 peak.

These are all independent decisions, so I can ask all 7 in Round 1.

I need to format with question title, body, and recommended answer. Word each so "yes" accepts recommended.

I should not ask the user to confirm if they want me to continue; just fire the round.

Let me write Round 1.
```

### Model reply

Round 1 — the seven open decisions from PLAN.md are all independent, so they're the whole frontier.

❓ **Q1** - **Key the limit on `x-customer-id`**: Should the primary rate-limit key be the `x-customer-id` header, with client IP treated as a secondary signal only if the header is missing?

➡️ **Yes** — `x-customer-id` is the business identity; IP is unstable for scripts and shared NAT would cause cross-customer blocking.

---

❓ **Q2** - **Use a token-bucket algorithm**: Should the algorithm be a token bucket so enterprise scripts can burst up to an allowance while the sustained rate stays capped?

➡️ **Yes** — it matches the "legitimately burst" requirement and avoids the boundary spikes of fixed windows.

---

❓ **Q3** - **Store counters in the existing Redis cluster**: Should the counters live in the Redis 7 cluster, not in per-instance memory?

➡️ **Yes** — with three instances behind round-robin, instance-local counters would give each customer 3× the intended budget.

---

❓ **Q4** - **Fail open if Redis is unreachable**: If Redis becomes unreachable, should requests be allowed through while raising an alert, rather than rejecting everything?

➡️ **Yes** — failing closed turns a Redis outage into a total order-taking outage; fail-open preserves revenue with an explicit operational risk.

---

❓ **Q5** - **Enterprise limits in a config table owned by support**: Should higher enterprise limits be stored in a per-customer config table (keyed by `x-customer-id`) and owned by support/account management?

➡️ **Yes** — engineering should not own business contract numbers; a table lets support adjust limits without a deploy.

---

❓ **Q6** - **Return 429 with a Retry-After header**: Should rejected clients receive HTTP `429 Too Many Requests` with a `Retry-After` header and a small JSON error body?

➡️ **Yes** — it's the standard signal and lets scripted integrations back off deterministically.

---

❓ **Q7** - **Roll out in dry-run/monitor mode first**: Should the rollout start in a monitoring-only mode that logs would-be violations, then switch to enforcement after measuring real enterprise burst patterns?

➡️ **Yes** — this avoids guessing enterprise limits and prevents breaking existing integrations while you set thresholds from real data.

---

Answer any with yes/no or override the recommendation, and I'll push the next frontier.

