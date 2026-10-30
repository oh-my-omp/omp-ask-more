## Person: `/skill:grilling Grill me on the unresolved decisions in PLAN.md. Do not implement the plan.`

omp injected the skill as a user-attributed message: its first line, then the 25 lines of `grilling/SKILL.md`.

```text
[IMPORTANT: User invoked the "grilling" skill; follow its instructions. Full skill below.]
```

### Model reasoning

```text
The user wants me to grill them on unresolved decisions in PLAN.md. I need to read the skill first, then read PLAN.md, then start asking questions in rounds following the design tree format.
```

- tool `read` skill://grilling

- tool `read` PLAN.md

### Model reasoning

```text
I have the plan. I need to identify the frontier - decisions whose prerequisites are already settled and don't depend on other open questions. From PLAN.md, the unresolved decisions are:

1. What to key the limit on: `x-customer-id`, client IP, or both.
2. Algorithm: fixed window, sliding window, or token bucket.
3. Where counters live: Redis, or in each instance's memory.
4. What happens if the counter store is unreachable: let requests through or reject them.
5. How enterprise customers get higher limits, and who owns those numbers.
6. What a rejected client sees.
7. How to roll out without breaking the enterprise integrations.

These all seem independent given the current context. The facts are mostly given in PLAN.md. I should also check the filesystem for src/server.ts to ground my recommendations, but the skill says finding facts is my job via sub-agent or tools. However, the questions themselves don't strictly depend on reading server.ts - the plan already states what matters. But to give good recommendations, I might want to look. Actually, the skill says dispatch a sub-agent when needed, but I can also read files directly with read. Let me check if there are other files that might constrain decisions.

Actually, the frontier is all 7 questions. They are largely independent. I can ask them all in round 1. I should word each so "yes" accepts the recommended answer.

Let me think about each:

Q1: Key the limit on `x-customer-id` (since enterprise customers are the concern and IP can change/share behind NAT). Recommend x-customer-id only.

Q2: Token bucket for burst-friendly behavior. Enterprise scripts burst.

Q3: Redis cluster since 3 instances behind LB, need shared state.

Q4: If counter store unreachable, fail open (let through) to avoid hard downtime dependency on Redis. But this is a security vs availability tradeoff. Need to ask.

Q5: Higher limits via config/per-customer override; ownership - SRE/platform team sets defaults, account management/sales owns enterprise numbers.

Q6: Rejected client sees 429 Too Many Requests with Retry-After header and JSON error body.

Q7: Roll out via canary + enterprise allowlist/gradual limits; start with monitoring-only mode.

I should present all as frontier. They don't depend on each other. Let me format per the template.

Wait, the skill says "Word each question so 'yes' accepts your recommended answer." So each question should be framed as "Should we..." or "Do you agree to..." with multiple choices. And I provide recommended answer below.

Let me craft:

Q1 - Key on x-customer-id only
Body: The limit key should identify the paying customer. `x-customer-id` is present for authenticated requests and stable across NAT/proxies. Client IP is brittle: enterprise scripts may run from dynamic cloud IPs or share egress NAT, and IPs don't identify the customer account. Using both adds complexity without clear upside.
Choices: A) `x-customer-id` only, B) client IP only, C) both (require both to exceed limit).
Recommended: A

Q2 - Token bucket algorithm
Body: Enterprise scripts legitimately burst, then go idle. Fixed window can allow 2x burst at window boundaries; sliding window is correct but more expensive per request; token bucket allows steady burst capacity and is cheap to implement with Redis. It matches the observed pattern (40K in 10 min suggests sustained, but bursts still matter).
Choices: A) token bucket, B) sliding window, C) fixed window.
Recommended: A

Q3 - Counters in Redis
Body: Three instances behind a round-robin LB means per-instance memory would give clients 3x the intended limit and let them rotate around limits. Redis cluster already exists for sessions, so adding counters is low incremental operational cost.
Choices: A) Redis cluster, B) each instance's memory, C) Redis with local cache fallback.
Recommended: A

Q4 - Fail open if Redis unreachable
Body: Redis is shared infrastructure; if it becomes unreachable, rejecting all orders would be a site-wide outage for `POST /orders`. Rate limiting is a protective feature, not an availability gate. We can alarm and use a circuit breaker; requests proceed when the counter store is down.
Choices: A) let requests through (fail open), B) reject with 503/500 (fail closed).
Recommended: A

Q5 - Per-customer override configured in a config store; ownership split
Body: A default bucket applies to all customers; enterprise customers get an override entry (e.g., higher rate/burst). Platform/SRE owns the default policy and mechanism; account management/sales owns the customer-specific numbers because they are contractual.
Choices: A) per-customer config in DB/file with SRE owning mechanism and sales owning values, B) hard-coded enterprise list in repo, C) self-serve portal.
Recommended: A

Q6 - 429 Too Many Requests with Retry-After
Body: Rejected clients need a standard signal to back off. 429 is the HTTP status; `Retry-After` tells scripts when to resume; JSON body with `error`, `retry_after`, and `limit_type` helps debugging.
Choices: A) 429 with Retry-After and structured JSON, B) 429 plain text only, C) 503 Service Unavailable.
Recommended: A

Q7 - Roll out with shadow/monitor mode, then enforce for non-enterprise, then enforce for enterprise with notice
Body: We don't know exact enterprise burst profiles. Start with counters counted but not enforced (monitoring) to calibrate limits; then enforce for non-enterprise customers; finally enforce for enterprise after notifying them and setting their overrides. This avoids breaking scripts.
Choices: A) monitor → non-enterprise enforce → enterprise enforce with overrides, B) enforce globally immediately with high limits then tighten, C) feature flag per customer.
Recommended: A

Actually Q7 could include feature flags per customer, which might depend on Q5. But it's still independent enough to ask. I'll ask all 7 as round 1.

Let me format correctly with the template.
```

### Model reply

I read `PLAN.md`. The frontier right now is the full list of open decisions, because none of them have prerequisites that depend on each other being settled first.

---

❓ **Q1 - Rate-limit key**: Should the limit key be `x-customer-id` only, rather than client IP or a combination?

`x-customer-id` identifies the paying account and is stable across NAT/proxies. Client IP is brittle: enterprise scripts may run from dynamic cloud egress, share IPs, or rotate instances, so IP-based limiting could block the wrong customers or let the same customer evade limits by rotating IPs. Requiring both adds complexity without a clear benefit given authenticated callers.

Options:
- A) `x-customer-id` only
- B) client IP only
- C) both (`x-customer-id` AND IP must exceed limit)

➡️ **A) `x-customer-id` only**

---

❓ **Q2 - Algorithm**: Should we use a token bucket algorithm instead of fixed or sliding window?

Enterprise integrations legitimately burst, then go idle. Fixed windows allow 2× bursts at window boundaries; sliding windows are more precise but cost more per request; token buckets naturally accommodate bursts, are cheap to implement in Redis, and map well to "sustained rate + burst capacity."

Options:
- A) token bucket
- B) sliding window
- C) fixed window

➡️ **A) token bucket**

---

❓ **Q3 - Counter storage**: Should counters live in the existing Redis cluster rather than per-instance memory?

With three `src/server.ts` instances behind round-robin load balancing, per-instance memory would let a customer consume roughly 3× the intended limit by rotating through instances. Redis is already operational for sessions, so using it for counters adds low incremental operational overhead.

Options:
- A) Redis cluster
- B) each instance's memory
- C) Redis with local in-memory cache fallback

➡️ **A) Redis cluster**

---

❓ **Q4 - Store-failure behavior**: If Redis is unreachable, should we fail open and let orders through rather than reject them?

Rate limiting protects against abuse; it is not the availability gate for order creation. If Redis becomes unreachable, rejecting all `POST /orders` would create a site-wide outage driven by shared infrastructure. We can alarm loudly and use a circuit breaker, but orders should not stop.

Options:
- A) let requests through (fail open)
- B) reject with an error (fail closed)

➡️ **A) let requests through (fail open)**

---

❓ **Q5 - Enterprise limits and ownership**: Should higher enterprise limits be a per-customer override configured outside the repo, with platform owning the mechanism and sales/account management owning the numbers?

A default bucket applies to everyone; enterprise customers get an override (higher rate/burst). Hard-coding the list in the repo couples deploys to contract changes. A self-serve portal is more than needed for this week's ship. Splitting ownership lets engineering enforce invariants while the customer-facing team owns the commercial values.

Options:
- A) per-customer config in DB/file, with SRE owning mechanism and sales owning values
- B) hard-coded enterprise list in source code
- C) self-serve customer portal

➡️ **A) per-customer config in DB/file, with SRE owning mechanism and sales owning values**

---

❓ **Q6 - Rejection response**: Should rejected clients receive HTTP 429 with a `Retry-After` header and a structured JSON error body?

`429 Too Many Requests` is the standard signal for rate limiting. Scripted integrations need a machine-readable back-off hint (`Retry-After`) and context (`error`, `retry_after`, `limit_type`) so they can adjust without human intervention.

Options:
- A) 429 with `Retry-After` and structured JSON body
- B) 429 with plain text only
- C) 503 Service Unavailable

➡️ **A) 429 with `Retry-After` and structured JSON body**

---

❓ **Q7 - Rollout strategy**: Should we roll out in three phases: monitoring-only, then enforce for non-enterprise, then enforce for enterprise after setting their overrides?

We do not yet know the exact burst profiles of the 20 enterprise integrations. Starting in monitoring mode lets us calibrate limits without breaking anything. Then we enforce for non-enterprise customers first, and finally enforce for enterprise customers only after notifying them and applying their higher overrides.

Options:
- A) monitor → enforce non-enterprise → enforce enterprise with overrides
- B) enforce globally immediately with generous limits, then tighten
- C) feature-flag per customer from day one

➡️ **A) monitor → enforce non-enterprise → enforce enterprise with overrides**

