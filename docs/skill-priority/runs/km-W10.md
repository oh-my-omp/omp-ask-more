## Person: `/skill:grilling Help me settle the parts of PLAN.md that are still undecided.`

omp injected the skill as a user-attributed message: its first line, then the 25 lines of `grilling/SKILL.md`.

```text
[IMPORTANT: User invoked the "grilling" skill; follow its instructions. Full skill below.]
```

### Model reasoning

```text
The user invoked the "grilling" skill and wants help settling undecided parts of PLAN.md. I need to:
1. Read the skill first (per workflow)
2. Read PLAN.md
3. Map decisions as a design tree
4. Ask frontier questions in rounds
5. Use ask() tool for questions

Let me start by reading the skill and PLAN.md.
```

- tool `read` /tmp/askmore-grill/.omp/skills/grilling

- tool `read` /tmp/askmore-grill/PLAN.md

### Model reasoning

```text
I have the plan. Now I need to map the undecided items as a design tree and ask the frontier. Since none of these depend on each other in a strict prerequisite sense (they're somewhat independent design choices), I can ask them all in one round. However, the skill says to map as a design tree where decisions branch. Let me think about dependencies:

1. Key (customer-id, IP, or both) - foundational choice
2. Algorithm (fixed, sliding, token bucket) - somewhat independent
3. Counter store (Redis or in-memory) - depends on whether you need cross-instance consistency
4. Store unreachable behavior (fail-open or fail-closed) - depends on store choice
5. Enterprise limits ownership - independent
6. Rejected client response - independent
7. Rollout - depends on several above

Frontier (no prerequisites among these): Q1 key, Q2 algorithm, Q3 counter store, Q5 enterprise limits, Q6 rejected client response. Q4 depends on Q3. Q7 depends on multiple.

I should ask Q1, Q2, Q3, Q5, Q6 in round 1. Q4 and Q7 come later.

Let me read the skill file first to ensure I follow it.
```

- tool `read` /tmp/askmore-grill/.omp/skills/grilling/SKILL.md

### Model reasoning

```text
I need to use the ask() tool. The format example shows markdown output, but the skill says to put questions through ask(). The instructions: "MUST put every question that needs the user's answer through ask". So I should use the ask tool.

I need to design the questions. For each question:
- id
- header (short tab label)
- question (non-empty text)
- brief: {what, where, how}
- options: 2-5 options
- recommended: index

Frontier questions:
1. What to key the limit on: x-customer-id, client IP, or both?
2. Algorithm: fixed window, sliding window, or token bucket?
3. Where counters live: Redis or in each instance's memory?
4. What happens if counter store unreachable: depends on #3
5. How enterprise customers get higher limits, and who owns those numbers?
6. What a rejected client sees?
7. Rollout: depends on multiple

So Round 1: Q1, Q2, Q3, Q5, Q6.

Let me formulate these carefully.

Q1: Key on x-customer-id?
- Recommended: x-customer-id only
- Why: IP can be shared/NAT, doesn't identify the paying customer; both adds complexity with two limits
- Options:
  1. x-customer-id only (recommended)
  2. client IP only
  3. both: per-customer + per-IP
  4. x-customer-id primary, IP as fallback

Q2: Algorithm - token bucket?
- Recommended: token bucket
- Why: allows enterprise bursts, simple-ish
- Options:
  1. token bucket (recommended)
  2. fixed window
  3. sliding window

Q3: Counters in Redis?
- Recommended: Redis
- Why: 3 instances behind LB, need global consistency
- Options:
  1. Redis (recommended)
  2. per-instance memory
  3. Redis with local cache fallback

Q5: Enterprise limits - own via config/env?
- Recommended: config file/env, owned by ops/SRE
- Options:
  1. Static config/env, ops owns (recommended)
  2. Database table, support owns
  3. Customer self-service portal
  4. Existing billing/entitlement system

Q6: Rejected client - 429 Too Many Requests with Retry-After?
- Recommended: 429 with Retry-After header and JSON body
- Options:
  1. HTTP 429 with Retry-After + JSON error (recommended)
  2. HTTP 429 plain text only
  3. HTTP 503 Service Unavailable
  4. Queue/trottle accept but slow down

Wait, for Q6, "What a rejected client sees" - maybe include rate limit headers? X-RateLimit-*?

Let me also check if there's any existing code I should look at. The skill says finding facts is my job. I should probably look at src/server.ts to ground questions. Let me dispatch a sub-agent or read it. Actually I can read it directly. The skill says "When a frontier question needs a fact from the environment... dispatch a sub-agent with a fresh context window". But I can also read directly. Since this is simple, I'll read src/server.ts to inform my recommendations. But this doesn't block the frontier - I can ask now and read in parallel or read first. Let me read it to make better recommendations.
```

- tool `read` /tmp/askmore-grill/src/server.ts

### Model reasoning

```text
Good, I have the server code. Now I can make better recommendations:
- x-customer-id is already required, so keying on it is natural.
- GET is cheap, POST is expensive - we may want to limit only POST or have different limits.

I should probably add a question about whether GET /orders should also be rate limited, or only POST. But the plan says "POST /orders writes to Postgres and is the expensive call; GET /orders is cheap" - it doesn't explicitly list "should we rate limit GET?" as undecided, but it's a relevant design decision. However, the user asked to settle the parts of PLAN.md that are still undecided, so I should stick to the listed items. I can include scope (GET vs POST) as part of the algorithm/key questions though.

Actually, re-reading the plan: the "Not decided yet" section lists exactly 7 items. I should address those. But I might discover related decisions. The skill says to map a design tree. I'll focus on the 7 listed.

Now let me construct the ask() call with Round 1 questions. I need to follow the tool format.

Each question needs:
- id
- header
- question
- brief: {what, where, how}
- options (2-5)
- recommended (optional)

Let me draft:

Q1 - Rate-limit key
header: "Rate-limit key"
question: Should we key the POST /orders rate limit on x-customer-id, rather than client IP or a combination?
brief:
- where: server.ts already requires x-customer-id header; 3 instances behind LB; one customer's script caused the incident.
- what: Decide which identifier tracks consumption.
- how: Redis counter key will be built from this; affects fairness, spoofability, and multi-instance behavior.

options:
1. x-customer-id only - recommended
2. client IP only
3. both: per-customer limit plus per-IP limit
4. x-customer-id with IP as fallback

Q2 - Algorithm
header: "Algorithm"
question: Should we use a token bucket for POST /orders, rather than fixed or sliding window?
brief:
- where: enterprise customers burst legitimately; fixed windows can allow 2x burst at boundaries; sliding windows are precise but more Redis ops.
- what: Pick the rate-limiting algorithm.
- how: Determines burst behavior, Redis Lua/script complexity, and fairness.

options:
1. token bucket - recommended
2. fixed window
3. sliding window

Q3 - Counter store
header: "Counter store"
question: Should counters live in the existing Redis 7 cluster, rather than in each instance's memory?
brief:
- where: 3 instances behind round-robin LB; Redis cluster already exists for sessions.
- what: Decide where rate-limit counters are stored.
- how: In-memory is fast but lets a client do 3x the limit by rotating instances; Redis adds latency and a dependency.

options:
1. Redis 7 cluster - recommended
2. each instance's memory
3. Redis with small local cache/burst buffer

Q5 - Enterprise limits ownership
header: "Enterprise limits"
question: Should higher enterprise limits be owned by ops/SRE in static config or environment variables, rather than in a self-service portal or billing system?
brief:
- where: ~20 enterprise customers have scripted integrations that legitimately burst.
- what: Decide who sets higher limits and where those numbers live.
- how: Affects rollout speed, support burden, and auditability.

options:
1. Static config/env, ops/SRE owns - recommended
2. Database table owned by support/success
3. Customer self-service portal
4. Existing billing/entitlement system

Q6 - Rejected response
header: "Rejected response"
question: Should rejected clients receive HTTP 429 Too Many Requests with a Retry-After header and JSON body?
brief:
- where: current error responses are plain text; enterprise scripts likely parse status codes and headers.
- what: Decide the observable behavior on rate limit rejection.
- how: Affects client retry logic, monitoring, and support load.

options:
1. 429 + Retry-After + JSON error body - recommended
2. 429 plain text only
3. 503 Service Unavailable
4. Accept request but queue/delay (throttle)

I think these are good. Let me use the ask tool. Note the tool wants `i` parameter too (intent).
```

### ask call

```json
{"questions":[{"id":"key","question":"Should we key the POST /orders rate limit on `x-customer-id`, rather than client IP or a combination?","options":[{"label":"`x-customer-id` only","tradeoff":"Fair per-customer billing identity, simple Redis keys, no NAT sharing issues.","description":"Use the existing required header as the sole rate-limit key."},{"label":"Client IP only","tradeoff":"Customers behind shared egress/NAT collide; a malicious customer can rotate IPs or spoof if LB doesn't validate."},{"label":"Both: per-customer AND per-IP limits","tradeoff":"Catches more abuse shapes but doubles Redis ops and you must decide which limit wins when they differ."},{"label":"`x-customer-id` with IP fallback","tradeoff":"Hybrid complexity; the fallback case (missing customer id) already returns 401, so it rarely triggers."}],"brief":{"where":"src/server.ts already requires `x-customer-id`; the incident was caused by one customer's script; 3 instances sit behind a round-robin LB.","what":"Decide which identifier tracks consumption for the limiter.","how":"This becomes the Redis counter key prefix and determines fairness, spoofability, and cross-instance consistency."},"recommended":0,"header":"Rate-limit key"},{"id":"algorithm","question":"Should we use a token bucket for POST /orders, rather than fixed or sliding window?","options":[{"label":"Token bucket","tradeoff":"Allows legitimate enterprise bursts while bounding sustained rate; slightly more state than fixed window.","description":"Bucket fills at a fixed rate; each POST consumes one token."},{"label":"Fixed window","tradeoff":"Simple and few Redis ops, but allows 2x burst at window boundaries and can starve a customer right after a window reset."},{"label":"Sliding window","tradeoff":"Most precise and fairest, but more Redis commands/Lua and slightly higher latency per request."}],"brief":{"where":"Enterprise customers legitimately burst; POST /orders is the expensive call; GET /orders is cheap.","what":"Pick the rate-limiting algorithm.","how":"Determines burst tolerance, Redis script complexity, and the exact unfairness customers can observe."},"recommended":0,"header":"Algorithm"},{"id":"store","question":"Should rate-limit counters live in the existing Redis 7 cluster, rather than in each instance's memory?","options":[{"label":"Redis 7 cluster","tradeoff":"Global consistency across the 3 LB-backed instances; adds a network round-trip and a hard dependency.","description":"Reuse the cluster already used for sessions."},{"label":"Each instance's memory","tradeoff":"Fast and no dependency, but a customer rotating across 3 instances gets 3x the intended budget."},{"label":"Redis with small local burst cache","tradeoff":"Mitigates Redis latency for allowed traffic, but adds complexity and stale-window risk."}],"brief":{"where":"3 instances behind round-robin load balancer; Redis 7 cluster already exists for sessions.","what":"Decide where the counters are stored.","how":"In-memory defeats global limits; Redis is required for correct enforcement but creates a runtime dependency to fail-open or closed on."},"recommended":0,"header":"Counter store"},{"id":"enterprise","question":"Should higher limits for enterprise customers be owned by ops/SRE in static config or environment variables, rather than a self-service portal or billing integration?","options":[{"label":"Static config / env vars owned by ops/SRE","tradeoff":"Fast to ship this week, simple to audit, but requires a deploy to change limits.","description":"Map customer IDs to limit tiers in config."},{"label":"Database table owned by support/success","tradeoff":"No deploy needed for changes, but adds a new table, UI, and approval workflow this week.","description":"Support edits tier assignments in an internal table."},{"label":"Customer self-service portal","tradeoff":"Scales best long-term, but is a new product surface and out of scope for a one-week ship.","description":"Customers choose/purchase their own tiers."},{"label":"Existing billing/entitlement system","tradeoff":"Cleanest if one exists and is reachable, but requires integration work and ownership clarity."}],"brief":{"where":"About 20 enterprise customers have scripted integrations that legitimately burst.","what":"Decide who sets higher limits and where those numbers live.","how":"Affects rollout speed, support burden, auditability, and whether a deploy is required to tune limits."},"recommended":0,"header":"Enterprise limits"},{"id":"rejected","question":"Should rejected clients receive HTTP 429 Too Many Requests with a `Retry-After` header and a JSON error body?","options":[{"label":"429 + Retry-After + JSON body","tradeoff":"Gives clients the information they need to back off; matches modern API conventions.","description":"Return structured error with retry timing."},{"label":"429 plain text only","tradeoff":"Matches current error style in server.ts, but scripts must parse the body to decide retry timing."},{"label":"503 Service Unavailable","tradeoff":"Incorrect semantics; clients may treat it as a server outage rather than a client quota issue."},{"label":"Accept and queue/delay (throttle)","tradeoff":"No explicit rejections, but keeps expensive requests in flight and does not bound total load."}],"brief":{"where":"Current server.ts returns plain-text errors; enterprise scripts will need to handle rate-limit responses.","what":"Decide the observable behavior on rejection.","how":"Determines client retry logic, monitoring, and support load when a customer hits the limit."},"recommended":0,"header":"Rejected response"}]}
```

### ask result

```text
User answers:
key: (cancelled)
algorithm: (cancelled)
store: (cancelled)
enterprise: (cancelled)
rejected: (cancelled)
```

