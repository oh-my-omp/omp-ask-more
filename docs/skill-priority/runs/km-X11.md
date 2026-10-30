## Person: `/skill:grilling Review my rate-limiting plan and make me defend it.`

omp injected the skill as a user-attributed message: its first line, then the 25 lines of `grilling/SKILL.md`.

```text
[IMPORTANT: User invoked the "grilling" skill; follow its instructions. Full skill below.]
```

### Model reasoning

```text
The user wants me to review their rate-limiting plan and make them defend it using the grilling skill. I need to interview them relentlessly, mapping decisions as a design tree, working in rounds.

But I don't know what their rate-limiting plan is yet. I should first ask them to present it, or if there's context I should look for. The skill says facts are my job, but decisions are the user's. I should look around the workspace to see if there's an existing plan document.

Let me read the current directory first to see if there's a rate-limiting plan file.
```

- tool `read` /tmp/askmore-grill

### Model reasoning

```text
There's a PLAN.md and some source files. I should read these to understand the plan before asking questions.
```

- tool `read` /tmp/askmore-grill/PLAN.md

- tool `read` /tmp/askmore-grill/src/server.ts

- tool `read` /tmp/askmore-grill/src/orders.ts

- tool `read` /tmp/askmore-grill/src/db.ts

### Model reasoning

```text
Good, I now have the plan. The user wants me to grill them on their rate-limiting plan. I need to ask the frontier questions. Since this is the first round, I need to ask the most foundational decisions whose prerequisites are already settled.

The plan states:
- Problem: one customer's script created 40,000 orders in 10 minutes, slowed everyone down
- Environment: 3 instances behind round-robin LB, Redis 7 cluster available, Postgres backend
- POST /orders is expensive, GET /orders is cheap
- 20 enterprise customers have scripted integrations that legitimately burst
- Not decided: key, algorithm, counter store, failure mode, enterprise limits, rejection response, rollout

Frontier (decisions with no unsettled prerequisites):
1. Scope/target: Should rate limiting apply to POST /orders only, or also GET /orders? (The plan says POST is expensive, GET is cheap, but doesn't decide if GET gets limited)
2. Key: What to key the limit on? x-customer-id, client IP, or both?
3. Algorithm: fixed window, sliding window, or token bucket?
4. Counter store: Redis or in-memory?
5. Failure mode (store unreachable): let through or reject?
6. Enterprise customer limits: how to grant higher limits and who owns those numbers?
7. Rejected client response: what status/body/headers?
8. Rollout: how to deploy without breaking enterprise integrations?

Wait, some of these might have dependencies. But for the first round, these all seem independent given the current plan. Actually, the key decision affects algorithm choice somewhat, and counter store affects failure mode. But they can still be asked independently.

However, the skill says "Ask the whole frontier in one round". I need to use the ask tool. Let me structure this properly.

Actually, looking at the skill more carefully: I should map this as a design tree. The root is the decision to add rate limiting. From there branches are the unsettled decisions.

Round 1 frontier: All the decisions listed as "Not decided yet" plus the scope (whether GET should be limited too, since it's not explicitly decided).

I should use the ask tool with multiple questions. But I need to be careful not to overwhelm. The skill says ask the whole frontier in one round. There are 8 decisions. That's a lot, but they're all independent.

Wait, let me reconsider. The user said "Review my rate-limiting plan and make me defend it." This is about grilling. I should ask tough, probing questions. I should also perhaps ask a meta-question first about whether they want me to focus on any particular aspect, but the skill says interview relentlessly. Maybe I just launch into the frontier.

But actually, I should probably start with the most consequential/fundamental decisions. Let me think about the dependency tree:

Root: Add rate limiting to POST /orders
- Q1: Scope - POST only or POST+GET? (This is somewhat foundational)
- Q2: Key dimension - customer ID vs IP vs both
- Q3: Store - Redis vs in-memory
- Q4: Algorithm - depends somewhat on store? Not really, but Redis makes certain algorithms easier.
- Q5: Failure mode - depends on store choice
- Q6: Enterprise tiering - depends on key choice (if keyed by customer ID, can tier by customer)
- Q7: Rejection contract - mostly independent
- Q8: Rollout strategy - depends on many things

Actually, Q5 (failure mode) depends on Q3 (store) because the failure characteristics differ. If in-memory, "unreachable" is less meaningful. If Redis, it's a real question.

Q6 (enterprise tiering) depends on Q2 (key) because if you key by IP, customer-specific tiers don't work.

Q8 (rollout) might depend on Q6 (enterprise limits) and Q7 (rejection contract).

So round 1 frontier should be the independent decisions: Q1 (scope), Q2 (key), Q3 (store), Q4 (algorithm - actually algorithm can be chosen independently though implementation differs), Q7 (rejection contract).

But if I ask algorithm without store, the user might say "token bucket" and then later choose in-memory, which is fine but implementation differs. It's still a valid decision.

Actually, the algorithm choice and store choice are somewhat coupled. But they can be answered independently. The user might have reasons for one that constrain the other.

Hmm, let me be more rigorous. The skill says "a question whose answer depends on another question still open in this round belongs to a later round, not this one."

So if failure mode depends on store, I should ask store first, then failure mode in round 2.
If enterprise tiering depends on key, I should ask key first, then enterprise tiering in round 2.
If rollout depends on several, it goes in round 2 or 3.

Round 1 frontier:
- Q1: Scope (POST only vs POST+GET) - independent
- Q2: Key (customer ID vs IP vs both) - independent
- Q3: Counter store (Redis vs in-memory) - independent
- Q4: Algorithm (fixed window vs sliding window vs token bucket) - independent? I think so.
- Q5: Rejection contract - independent

That's 5 questions. I think that's a good first round.

Wait, should I include algorithm if it depends on store? Actually no, algorithm is a design choice that can be made independently. The implementation might be constrained by store, but the user can express preference. However, for a thorough design tree, maybe algorithm is downstream of store + key + scope because the choice of algorithm has different tradeoffs depending on those. But the user can still answer it.

Actually, I think algorithm is independent enough. And I should make them defend it.

Let me phrase the questions to be tough and require defense. Also include recommended answers.

Q1 - Scope: Should rate limiting apply only to POST /orders, or also to GET /orders? The plan says GET is cheap, but cheap endpoints can still be abused and share the same infrastructure. My recommendation: limit POST only for now, monitor GET separately.

Q2 - Key dimension: What should the limiter key on? x-customer-id, client IP, or both? Recommendation: x-customer-id, because that's the authenticated identity and avoids penalizing customers behind NAT/shared IPs; IP can be a fallback for missing headers but not the primary key.

Q3 - Counter store: Where should counters live? Redis cluster or per-instance memory? Recommendation: Redis cluster, because with 3 instances behind round-robin LB, in-memory counters would allow 3x the intended rate and one instance could be hit disproportionately.

Q4 - Algorithm: Fixed window, sliding window, or token bucket? Recommendation: token bucket, because it allows legitimate bursts while capping sustained rate, which matches the enterprise scripted integration use case.

Q5 - Rejection contract: What should a rejected client see? Status code, headers, body? Should you include Retry-After? Recommendation: 429 Too Many Requests with Retry-After header and a JSON body explaining the limit, so scripted clients can back off deterministically.

These are all independent. Let me construct the ask call.

I need to use the ask tool. Each question needs:
- id
- question (the actual question text)
- options (2-5)
- brief with what, where, how
- header (optional)
- recommended (index)

Let me craft these carefully.
```

### ask call

```json
{"questions":[{"id":"scope","question":"Should rate limiting apply only to POST /orders, or should GET /orders be limited too?","options":[{"label":"POST /orders only","tradeoff":"Targets the known abuse vector and the expensive operation; leaves GET unprotected against future scraping or accidental tight loops.","holds_when":"You are confident GET abuse will never matter and want the smallest change."},{"label":"Both POST and GET /orders","tradeoff":"Protects all endpoints on the route but adds latency to the cheap path and may surprise clients that poll GET heavily.","holds_when":"You want uniform protection and consider GET abuse plausible."},{"label":"POST now, GET later with separate limits","tradeoff":"Ships the urgent fix but requires a second design decision and instrumentation before GET is covered.","holds_when":"You want to contain blast radius this week and return to GET after measuring."}],"brief":{"where":"PLAN.md says POST /orders writes to Postgres and is expensive; GET /orders is cheap. src/server.ts handles both methods on /orders.","what":"Decide whether the rate limiter covers the whole /orders route or only the expensive write operation.","how":"This decides which code paths need the limiter and what the initial blast-radius guarantee is. It does not depend on key, store, or algorithm."},"recommended":0,"header":"Scope of rate limiting"},{"id":"key","question":"What dimension should the limiter key on: the x-customer-id header, client IP address, or both?","options":[{"label":"x-customer-id only","tradeoff":"Limits the authenticated account, which is what abused the system, and is stable across NATs and load-balanced clients; requires every caller to send the header.","holds_when":"All legitimate callers already send x-customer-id and you want per-account fairness."},{"label":"Client IP only","tradeoff":"Works even if a caller omits x-customer-id, but punishes shared NATs and can be bypassed by rotating IPs; does not limit a customer with distributed scripts.","holds_when":"You cannot trust or require the customer header."},{"label":"x-customer-id with IP fallback","tradeoff":"Covers authenticated traffic and unauthenticated/missing-header traffic, but creates two overlapping rate-limit namespaces with different semantics.","holds_when":"You need both authenticated tiers and a safety net for anonymous traffic."},{"label":"Both together (composite key)","tradeoff":"Most precise but most complex; a customer with scripts in two data centers gets two independent limits.","holds_when":"You want per-credential-per-origin limits and are willing to explain that behavior to customers."}],"brief":{"where":"PLAN.md lists this as undecided. src/server.ts already reads x-customer-id and returns 401 if it is missing.","what":"Choose the identity that the rate limit counts against; this affects fairness, bypass resistance, and enterprise tiering later.","how":"This decision unlocks the enterprise-tiering question. If you key by IP, per-customer limits are impossible."},"recommended":0,"header":"Rate-limit key"},{"id":"store","question":"Where should the rate-limit counters live: in the existing Redis 7 cluster or in each instance's process memory?","options":[{"label":"Redis 7 cluster","tradeoff":"Correctly enforces global limits across all three round-robin instances, but adds a network hop and a new failure mode if Redis is unreachable.","holds_when":"You need accurate global limits and already operate Redis in production."},{"label":"Per-instance memory","tradeoff":"Fastest and no new dependencies, but with three instances behind round-robin a customer can send 3x the intended rate, and a hot instance can still be overloaded.","holds_when":"You can tolerate approximate limits and want zero new infrastructure risk."},{"label":"Hybrid: in-memory with sticky sessions","tradeoff":"Keeps counters local but requires load-balancer configuration changes and still breaks if an instance restarts or a customer rebalances.","holds_when":"Your load balancer supports sticky sessions and you accept operational complexity to avoid Redis."}],"brief":{"where":"PLAN.md says there are 3 instances behind a round-robin load balancer and a Redis 7 cluster is available. src/server.ts is stateless today.","what":"Choose whether the limiter state is centralized or distributed across instances.","how":"This decision determines whether the 40k-in-10-minutes incident can repeat by spreading load across instances, and it gates the failure-mode question."},"recommended":0,"header":"Counter store"},{"id":"algorithm","question":"Which rate-limiting algorithm should you use: fixed window, sliding window, or token bucket?","options":[{"label":"Token bucket","tradeoff":"Allows legitimate bursts up to a bucket size while capping sustained rate; harder to implement correctly and requires deciding burst and refill parameters.","holds_when":"Your enterprise customers burst scripts and you want to accommodate that without allowing sustained abuse."},{"label":"Sliding window","tradeoff":"Smooths out boundary spikes and is fairer, but is more expensive to compute in Redis and harder for clients to reason about.","holds_when":"You want the fairest per-customer allocation and can pay the Redis cost."},{"label":"Fixed window","tradeoff":"Simplest to implement and reason about, but allows twice the intended rate around window boundaries and can still thunder against the window edge.","holds_when":"You want the simplest implementation and can accept boundary bursts."}],"brief":{"where":"PLAN.md lists this as undecided. The incident was 40,000 orders in 10 minutes, which suggests both a high burst and a high sustained rate.","what":"Choose the mathematical model that decides when a request is allowed or rejected.","how":"This shapes the customer-visible behavior during bursts and the implementation complexity."},"recommended":0,"header":"Rate-limit algorithm"},{"id":"rejection","question":"What should a rate-limited client receive: status code, headers, and body?","options":[{"label":"429 Too Many Requests with Retry-After and JSON body","tradeoff":"Best for scripted clients that can back off, but requires computing a trustworthy Retry-After value.","holds_when":"Your customers write scripts that can parse structured errors."},{"label":"429 Too Many Requests with plain text body only","tradeoff":"Standard status but no machine-readable back-off hint; scripts may retry blindly.","holds_when":"You want minimal implementation and rely on clients to use exponential back-off."},{"label":"503 Service Unavailable with Retry-After","tradeoff":"Semantically wrong for a client-specific limit but some proxies and clients already handle 503 back-offs.","holds_when":"You have existing client code that only understands 503."},{"label":"Drop the connection silently","tradeoff":"Harshest signal and confusing for debugging; violates HTTP expectations.","holds_when":"Never recommended; only if you have an extreme security reason."}],"brief":{"where":"PLAN.md lists 'What a rejected client sees' as undecided. src/server.ts currently returns 401 for missing header and 404 for unknown routes.","what":"Define the observable contract when a customer exceeds their limit.","how":"This becomes a customer-facing API promise and affects how enterprise integrations react."},"recommended":0,"header":"Rejection response"}]}
```

### ask result

```text
User answers:
scope: (cancelled)
key: (cancelled)
store: (cancelled)
algorithm: (cancelled)
rejection: (cancelled)
```

