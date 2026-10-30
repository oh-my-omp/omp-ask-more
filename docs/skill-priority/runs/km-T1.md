## Person: `/skill:grilling Grill me on the unresolved decisions in PLAN.md. Do not implement the plan.`

omp injected the skill as a user-attributed message: its first line, then the 25 lines of `grilling/SKILL.md`.

```text
[IMPORTANT: User invoked the "grilling" skill; follow its instructions. Full skill below.]
```

### Model reasoning

```text
The user wants me to grill them on unresolved decisions in PLAN.md. I need to first read the PLAN.md file and any relevant skill files to understand the context. Let me start by reading the skill directory and the PLAN.md.
```

- tool `read` /tmp/askmore-grill/PLAN.md

- tool `read` /tmp/askmore-grill/.omp/skills/grilling

### Model reasoning

```text
I read PLAN.md and see the skill directory contains SKILL.md. I should read SKILL.md to follow the grilling skill instructions correctly. Then I'll formulate the first round of questions based on the unsettled decisions listed in PLAN.md.
```

- tool `read` /tmp/askmore-grill/.omp/skills/grilling/SKILL.md

### Model reasoning

```text
Now I understand both the plan and the grilling skill. I need to work through the design tree. The PLAN.md lists 7 unresolved decisions. These are mostly independent at the first level, so I can ask them all in round 1.

Wait - some decisions do depend on others. Let me think about dependencies:
- "Where counters live" (Redis vs memory) affects "What happens if counter store is unreachable" - if in memory, this question changes. So the failure mode question depends on where counters live.
- "Algorithm" and "Where counters live" might interact, but the decision can be made somewhat independently.
- "What to key on" is independent.
- "Enterprise higher limits" is independent.
- "What a rejected client sees" is independent.
- "Rollout" depends on what the limits are and how enterprise gets higher limits.

So round 1 frontier should include the independent decisions: key, algorithm, counter location, enterprise limits, rejected client response. The failure mode question depends on counter location, and rollout depends on enterprise limits/algorithm/key. So I should hold those for round 2.

Actually, let me reconsider. The skill says "Ask the whole frontier in one round". The frontier is every decision whose prerequisites are already settled. So I should ask all currently-unblocked decisions now.

Round 1 questions:
1. What to key the limit on?
2. Algorithm?
3. Where counters live?
4. How enterprise customers get higher limits, and who owns those numbers?
5. What a rejected client sees?

Round 2 will likely include:
- What happens if counter store is unreachable (depends on counter location)
- How to roll out without breaking enterprise integrations (depends on enterprise limits, key choice, algorithm)

Let me formulate each question per the format. Need to include recommended answer and word so "yes" accepts it.

Also need to consider whether I should explore the repo to find facts. The plan is only PLAN.md. I should check if src/server.ts exists to ground my recommendations. Let me dispatch a sub-agent or read it myself. Actually the skill says "Finding facts is your job, never the user's" and "When a frontier question needs a fact from the environment... dispatch a sub-agent". But I can also read files directly. Let me check src/server.ts exists.
```

- tool `read` /tmp/askmore-grill

### Model reasoning

```text
I should read the source files to ground my recommendations. Let me read src/server.ts, src/orders.ts, and src/db.ts.
```

- tool `read` /tmp/askmore-grill/src/server.ts

- tool `read` /tmp/askmore-grill/src/orders.ts

- tool `read` /tmp/askmore-grill/src/db.ts

### Model reasoning

```text
Good, I now have the facts. The server already requires `x-customer-id`, so keying on that is natural. Client IP could be spoofed or shared behind NAT. Since enterprise customers have scripted integrations, they likely send x-customer-id.

Now I can formulate Round 1 questions. Let me think about recommendations:

1. Key: `x-customer-id` (already required header, identifies customer not connection, enterprise scripts already send it; IP is unreliable behind NAT/load balancer and would split one customer's bursts across keys). Word so "yes" = x-customer-id only.

2. Algorithm: token bucket for POST /orders (allows bursts up to bucket size, replenishes over time; good for enterprise bursts; sliding window is more precise but more Redis ops; fixed window has thundering herd at window boundary). But the plan says enterprise legitimately bursts, so token bucket. Word so "yes" = token bucket.

3. Counter location: Redis cluster (3 instances behind LB means in-memory counters would be per-instance and allow 3x the intended rate; Redis is already there for sessions, so reuse). Word so "yes" = Redis.

4. Enterprise higher limits: config map/table keyed by customer ID with override limits, owned by customer success / account management (not engineering on-call). Need to decide if in code, env var, DB table, or Redis. I'd recommend a Postgres `customer_rate_limits` table or Redis config. Since engineering shouldn't own the numbers, a table with an admin UI or at least a config process owned by account management. Word so "yes" = DB config table owned by customer success.

5. Rejected client sees: 429 Too Many Requests with `Retry-After` header (seconds until next allowed request) and a JSON body with `error`, `retry_after`, maybe `limit`. Word so "yes" = 429 with Retry-After.

Then Round 2 will ask:
- Failure mode when Redis unreachable: fail open (allow requests) vs fail closed. Given this protects against abuse, failing closed could break all customers if Redis hiccups; but failing open lets abuse through. With Redis cluster and sessions already using it, availability is tied. I'd recommend fail closed for POST /orders (the expensive path) with a circuit breaker? Actually if Redis is the sessions store, and it's down, sessions might already be broken. But rate limit counter failure shouldn't take down order creation. Fail open is safer for business continuity. Hmm. Let me think... The plan says "What happens if the counter store is unreachable: let requests through or reject them?" I'd lean fail open with alert/metric, because Redis is shared infra and a session outage shouldn't create a total orders outage. But the whole point is to prevent abuse. If Redis is down, abuse could happen. This is a business decision.

- Rollout: depends on enterprise limits. I'd recommend dark-launch (count but don't reject), per-customer threshold notification, then enforce. Or start with a high global limit + enterprise overrides, then lower. Need to know answers first.

I should also consider if the GET /orders should be limited. The plan says POST is expensive, GET is cheap. So limit POST only. But I should ask? Actually the plan already states this. Maybe I can note it but not ask as unresolved.

Let me now format Round 1. The format requires each question with header, body, and recommended answer. The skill says "Word each question so 'yes' accepts your recommended answer." But some questions have multiple choices, so I should present choices and the recommended one. The user can say "yes" to accept, or pick another, or write their own.

Actually the skill example shows numbered questions with the recommended answer labeled "➡️". The user can answer with the number and choice. "Word each question so 'yes' accepts your recommended answer" means I should phrase the question as a yes/no where possible. For multiple-choice, I can still put the recommended answer with ➡️.

Let me draft:

❓ **Q1** - **Limit key**: Should we key the rate limit on the `x-customer-id` header?

The server already requires `x-customer-id`; every enterprise script must send it. Client IP is unreliable behind NAT/proxies and would split one customer's traffic across multiple keys, while `x-customer-id` lets us set per-customer limits and enterprise overrides. We could combine both, but that adds complexity for little gain.

➡️ **Yes** — key limits on `x-customer-id` only.

---

❓ **Q2** - **Algorithm**: Should we use a token bucket for `POST /orders`?

Token bucket allows controlled bursts (good for scripted enterprise integrations) while enforcing a steady long-term rate. Fixed window is cheapest but creates a thundering-herd problem at window boundaries. Sliding window is more precise but costs more Redis operations per request.

➡️ **Yes** — token bucket with a burst allowance and refill rate we configure per customer.

---

❓ **Q3** - **Counter store**: Should counters live in the existing Redis 7 cluster?

With three server instances behind a round-robin load balancer, per-instance memory counters would let a customer send 3× the intended rate. Redis is already deployed for sessions, so the operational cost is low. An in-memory fallback could be added later for resilience, but it is not the primary store.

➡️ **Yes** — Redis cluster as the primary counter store.

---

❓ **Q4** - **Enterprise limits**: Should higher limits be defined in a config table/entry keyed by `customer_id` and owned by customer success/account management?

Engineering should not be the bottleneck for adjusting enterprise contract limits. A per-customer override (e.g., a Postgres table or Redis hash) lets customer success update limits through an admin flow; default limits apply to everyone else. Ownership of the numbers belongs to account management/customer success, with engineering owning the schema and enforcement.

➡️ **Yes** — per-customer overrides stored in config, owned by customer success.

---

❓ **Q5** - **Rejected response**: Should a rejected request get HTTP `429 Too Many Requests` with a `Retry-After` header?

Scripts need to know when it is safe to retry. `429` is the standard status, and `Retry-After` gives them a concrete backoff. We can include a small JSON body (`{ "error": "rate_limit_exceeded", "retry_after": 12 }`) for debuggability.

➡️ **Yes** — `429` with `Retry-After` and a JSON error body.

---

I think this is good. Round 2 will depend on answers. Let me present it.
```

### Model reply

Round 1 — independent decisions from `PLAN.md`.

❓ **Q1** - **Limit key**: Should we key the rate limit on the `x-customer-id` header?

`src/server.ts` already requires `x-customer-id`; every scripted integration must send it. Client IP is unreliable behind NAT/proxies and would split one customer's traffic across multiple keys, while `x-customer-id` lets us set per-customer limits and enterprise overrides. We could combine both, but that adds complexity for little gain.

➡️ **Yes** — key limits on `x-customer-id` only.

---

❓ **Q2** - **Algorithm**: Should we use a token bucket for `POST /orders`?

Token bucket allows controlled bursts (good for scripted enterprise integrations) while enforcing a steady long-term rate. Fixed window is cheapest but creates a thundering-herd problem at window boundaries. Sliding window is more precise but costs more Redis operations per request.

➡️ **Yes** — token bucket with a burst allowance and refill rate we configure per customer.

---

❓ **Q3** - **Counter store**: Should counters live in the existing Redis 7 cluster?

With three server instances behind a round-robin load balancer, per-instance memory counters would let a customer send 3× the intended rate. Redis is already deployed for sessions, so the operational cost is low. An in-memory fallback could be added later for resilience, but it is not the primary store.

➡️ **Yes** — Redis cluster as the primary counter store.

---

❓ **Q4** - **Enterprise limits**: Should higher limits be defined in a config table/entry keyed by `customer_id` and owned by customer success/account management?

Engineering should not be the bottleneck for adjusting enterprise contract limits. A per-customer override (e.g., a Postgres table or Redis hash) lets customer success update limits through an admin flow; default limits apply to everyone else. Ownership of the numbers belongs to account management/customer success, with engineering owning the schema and enforcement.

➡️ **Yes** — per-customer overrides stored in config, owned by customer success.

---

❓ **Q5** - **Rejected response**: Should a rejected request get HTTP `429 Too Many Requests` with a `Retry-After` header?

Scripts need to know when it is safe to retry. `429` is the standard status, and `Retry-After` gives them a concrete backoff. We can include a small JSON body (`{ "error": "rate_limit_exceeded", "retry_after": 12 }`) for debuggability.

➡️ **Yes** — `429` with `Retry-After` and a JSON error body.

