## Person: `/skill:grilling Grill me on the unresolved decisions in PLAN.md. Do not implement the plan.`

omp injected the skill as a user-attributed message: its first line, then the 25 lines of `grilling/SKILL.md`.

```text
[IMPORTANT: User invoked the "grilling" skill; follow its instructions. Full skill below.]
```

### Model reasoning

```text
The user invoked the "grilling" skill and wants me to grill them on unresolved decisions in PLAN.md. I need to:

1. Read the grilling skill first (required by workflow)
2. Read PLAN.md
3. Interview relentlessly about unresolved decisions
4. Map as design tree
5. Work in rounds
6. Don't implement

Let me start by reading the skill and PLAN.md.
```

- tool `read` skill://grilling

- tool `read` PLAN.md

### Model reasoning

```text
I have the skill and the plan. Now I need to identify the unresolved decisions from PLAN.md and form a design tree. The "Not decided yet" list gives me clear decision nodes:

1. What to key the limit on: `x-customer-id`, client IP, or both.
2. Algorithm: fixed window, sliding window, or token bucket.
3. Where counters live: Redis, or in each instance's memory.
4. What happens if counter store unreachable: let through or reject.
5. How enterprise customers get higher limits, and who owns those numbers.
6. What a rejected client sees.
7. How to roll out without breaking enterprise integrations.

The frontier is all 7 since they can all be asked now — but wait, some have dependencies. Let me think about the design tree:

- Rate limit key (customer id / IP / both) - root decision, no deps
- Counter store (Redis / in-memory) - root decision, no deps
- Algorithm (fixed / sliding / token) - depends on store? Not necessarily, but token bucket is easier with Redis. Actually algorithm can be asked independently.
- Store unreachable behavior - depends on counter store decision
- Enterprise higher limits / ownership - depends on rate limit key (need customer identification), and maybe algorithm
- Rejected client response - root decision, no deps
- Rollout strategy - depends on multiple decisions above

So the frontier (questions with no prereqs) should be:
- Q1: Key the limit on
- Q2: Counter store
- Q3: Algorithm
- Q4: Rejected client response

Wait, actually algorithm doesn't strictly depend on store. Token bucket can be implemented in-memory too. Fixed/sliding in Redis are all possible. So algorithm can be asked now.

Store-unreachable behavior depends on store decision → later round.
Enterprise higher limits depends on key decision → later round.
Rollout depends on multiple → later round.

But actually, the enterprise higher limits question also touches "who owns those numbers" which is partly independent of key. However, you can't define how they get higher limits without knowing if you can identify them. So it depends on key.

The rejected client response can be asked now since it's independent.

Let me craft the questions following the format. Each should have a recommended answer and word so "yes" accepts it.

I should give my recommended answer with reasoning. The format requires "➡️ <your recommended answer>".

Let me draft:

Q1 - Rate limit key
The plan says POST /orders is expensive and 20 enterprise customers burst legitimately. Key options: x-customer-id, client IP, or both. Customer-ID lets you set per-customer limits and protect enterprise bursts. IP is brittle behind NAT/proxies and punishes shared egress. Both adds complexity.
Recommended: key on `x-customer-id` only.

Q2 - Counter store
3 instances behind LB, Redis 7 cluster available. In-memory counters fail with multiple instances (limits reset per instance, 3x effective capacity). Redis cluster gives shared state.
Recommended: Redis cluster.

Q3 - Algorithm
Fixed window is simple but allows burst at window boundary. Sliding window is accurate but more Redis ops. Token bucket allows controlled bursts, fits enterprise use case, and is natural with Redis.
Recommended: token bucket.

Q4 - Rejected client response
Options: 429 Too Many Requests with Retry-After, 503, drop silently, queue/defer. Standard is 429 with Retry-After header.
Recommended: 429 Too Many Requests with Retry-After header.

Now I should consider whether store-unreachable behavior is independent enough. It depends on store=Redis. Since we haven't decided store yet, it belongs in a later round. Same for enterprise limits (depends on key), rollout (depends on all).

Wait — but what if I ask store-unreachable as "assuming Redis"? The skill says don't guess at answers you haven't heard yet. So I should wait.

However, I could phrase Q4 rejected response independent of store. Yes.

I think the frontier is Q1-Q4. Let me make sure each question has clear options and recommended answer.

Actually, I realize algorithm might be seen as depending on store for token bucket implementation simplicity, but it's not a hard dependency. I can ask it. If user picks in-memory store, token bucket still works per-instance.

Let me format the output as required by the skill. The skill says "Format a round like so" with the exact format. I should use that.

I need to wait for user answers before next round.
```

### Model reply

I read `PLAN.md`. The unresolved decisions form a tree; the current frontier (no unmade prerequisites) is the key, the counter store, the algorithm, and the rejection response. Store-unreachable behavior, enterprise-limit ownership, and rollout all branch from these, so they wait.

❓ **Q1 - **Rate-limit key****: `POST /orders` is the expensive call, and about 20 enterprise customers script legitimate bursts. The key options are `x-customer-id`, client IP, or both. `x-customer-id` lets you set per-customer limits and protect enterprise bursts; IP is brittle behind NAT/proxies and punishes shared egress; both adds complexity and edge cases. Should we key the limit on `x-customer-id` only?

➡️ **Recommended**: Yes — key on `x-customer-id` only. It matches your customer-typed limits and enterprise-burst requirement.

---

❓ **Q2 - **Counter store****: You run 3 instances of `src/server.ts` behind a round-robin load balancer, and a Redis 7 cluster is already available. In-memory counters would reset per instance and give each customer 3× the intended budget under round-robin. Should the counters live in the existing Redis cluster?

➡️ **Recommended**: Yes — use the existing Redis 7 cluster for shared counters.

---

❓ **Q3 - **Algorithm****: The choices are fixed window, sliding window, or token bucket. Fixed window is simplest but allows burst attacks at window boundaries. Sliding window is accurate but heavier on Redis. Token bucket naturally supports legitimate bursts, which matches your enterprise scripting case. Should we use a token-bucket algorithm?

➡️ **Recommended**: Yes — use token bucket.

---

❓ **Q4 - **Rejected-client response****: When a request is over limit, the server can return 429 Too Many Requests with a `Retry-After` header, 503 Service Unavailable, or drop/queue the request. 429 is the standard semantic and lets clients back off. Should rejected clients see HTTP 429 with a `Retry-After` header?

➡️ **Recommended**: Yes — return 429 with `Retry-After`.

## Person

Yes to all your recommendations.

### Model reasoning

```text
User accepted all 4 recommendations. Now I need to recompute the frontier.

Settled decisions:
- Key: x-customer-id only
- Store: Redis cluster
- Algorithm: token bucket
- Rejected response: 429 with Retry-After

Now the frontier (decisions whose prerequisites are settled):
1. Store unreachable behavior (depends on store = Redis) — now can ask
2. Enterprise higher limits and ownership (depends on key = x-customer-id) — now can ask
3. Rollout (depends on key, store, algorithm, rejection response, enterprise limits, unreachable behavior) — cannot ask yet because depends on enterprise limits and unreachable behavior

Wait, rollout actually depends on knowing the limit mechanism fully, including enterprise limits and unreachable behavior. But does rollout strictly need unreachable behavior? Possibly yes, because the rollout might need to account for failure mode. And definitely needs enterprise limits because rollout must not break them.

So the new frontier is:
- Q5: Store unreachable behavior
- Q6: Enterprise higher limits and ownership

For Q5: options are let requests through (fail open) or reject them (fail closed). Given the goal is to prevent abuse that slowed everyone down, fail closed protects the system. But fail open preserves availability if Redis is down. Tradeoff. I need to recommend one. Given the original incident was 40,000 orders in 10 minutes causing slowdown, the primary goal is protection. If Redis is down, fail open means an attacker could still abuse. However, fail closed means Redis outage = all order creation blocked, which is a serious availability risk.

Recommendation? This is a tough one. For an orders API, availability is usually critical. But the plan says "ship it this week" because the abuse slowed everyone down. If Redis is already used for sessions, it's presumably reliable. But sessions and rate limits have different failure modes.

I think fail closed (reject) is the safer choice for the stated goal, but I should note the availability tradeoff. Actually, a common pattern is: if the rate-limiter store is unreachable, reject writes but allow reads. But the plan only mentions rate limiting orders API. And `POST /orders` is the expensive call. So maybe fail closed for POST, fail open for GET? But GET is cheap and maybe not even rate limited.

Let me recommend fail closed for `POST /orders` because that's the abuse vector. But I should present the question carefully.

Actually, the question is "What happens if the counter store is unreachable: let requests through or reject them?" Since we decided on Redis and the key is customer-id and algorithm token bucket. I can ask: should we fail closed (reject with 429/503) or fail open (let through)?

Recommended: fail closed (reject) to preserve the protection guarantee, with the risk that Redis outage blocks order creation.

But wait — is there a middle ground? Could do a circuit breaker where after some Redis failures you fail open? Or log/monitor? The plan's options are binary. I should stick to the binary but maybe mention it.

For Q6: "How enterprise customers get higher limits, and who owns those numbers."
Now that we key on x-customer-id, we need a mapping of customer-id → limit/bucket params. Options:
- Hard-coded config file / env vars owned by engineering
- Database table owned by customer success/support
- Derived from existing customer tier/contract data
- Self-serve portal

Recommended: database table owned by customer success/support (or ops), because hard-coding requires deploys for changes and doesn't scale; self-serve is too much for "ship this week"; existing tier data may not have rate-limit fields.

So Q6: Should enterprise limits live in a database table owned by customer success/support, populated from contract tiers?

Wait, the question has two parts: "How enterprise customers get higher limits, and who owns those numbers." I need to ask it as one decision or split? The design tree treats it as one node in PLAN.md. But it really has two sub-questions:
1. Mechanism: how do they get higher limits (config, DB, contract field, etc.)
2. Ownership: who owns the numbers

These are somewhat coupled. I can ask them together as one question with options, or split if they have different prerequisites. Since they both depend only on key=x-customer-id, they can be asked now. But splitting might be cleaner. However, the skill says "every decision branches into the decisions that hang off it" and the plan lists it as one item. I'll treat it as one decision node with a combined answer.

Let me formulate Q6 carefully:
"With x-customer-id as the key, we need a customer-id → rate-limit mapping for enterprise customers. Options: hard-code in config/env (engineering owns), store in a database table (customer success/support owns), pull from an existing contract/billing tier field, or build a self-serve portal. A DB table is fastest to ship and separates limit changes from code deploys."

Recommended: DB table owned by customer success/support.

Now, do I need to ask about the actual numbers? The plan says "who owns those numbers" not "what are the numbers". So we don't need to decide specific limits now, just the mechanism and ownership.

Frontier: Q5 and Q6.

Let me write the round.
```

### Model reply

Round 1 settled: key = `x-customer-id`, store = Redis cluster, algorithm = token bucket, rejection = 429 + `Retry-After`.

The new frontier covers Redis-failure behavior and enterprise-limit ownership. Rollout waits until both are settled.

❓ **Q5 - **Redis-unreachable behavior****: Since counters live in Redis, a cluster partition or outage creates a choice. Fail open (let `POST /orders` through) preserves availability but re-opens the 40,000-order abuse vector. Fail closed (reject) protects the system but means Redis downtime blocks all order creation. Should `POST /orders` fail closed with HTTP 429 when the Redis counter store is unreachable?

➡️ **Recommended**: Yes — fail closed. The plan exists because uncontrolled `POST /orders` caused an outage; preserving that protection during a Redis failure is the higher priority.

---

❓ **Q6 - **Enterprise limit configuration and ownership****: With `x-customer-id` as the key, enterprise customers need a higher limit than the default. The mapping can be hard-coded in config/env (engineering owns), stored in a database table (customer success or support owns), pulled from an existing contract/tier field, or exposed through a self-serve portal. A database table is shippable this week and decouples limit changes from deploys. Should enterprise limits live in a database table owned by customer success/support?

➡️ **Recommended**: Yes — a DB table owned by customer success/support, seeded from known contract tiers.

