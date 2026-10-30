## Person: `/skill:grilling Stress-test the rate limiting plan in PLAN.md.`

omp injected the skill as a user-attributed message: its first line, then the 25 lines of `grilling/SKILL.md`.

```text
[IMPORTANT: User invoked the "grilling" skill; follow its instructions. Full skill below.]
```

### Model reasoning

```text
The user wants me to stress-test a rate limiting plan in PLAN.md. First, I need to read the skill directory and the PLAN.md file. Let me start by reading the skill and the plan.
```

- tool `read` /tmp/askmore-grill/.omp/skills/grilling

- tool `read` /tmp/askmore-grill/PLAN.md

### Model reasoning

```text
I need to read the SKILL.md to understand the grilling skill instructions fully.
```

- tool `read` /tmp/askmore-grill/.omp/skills/grilling/SKILL.md

### Model reasoning

```text
Good. Now I need to stress-test the rate limiting plan by interviewing the user. I need to map decisions as a design tree and ask the frontier questions in rounds.

Let me analyze PLAN.md to identify the decisions:

1. What to key the limit on: `x-customer-id`, client IP, or both.
2. Algorithm: fixed window, sliding window, or token bucket.
3. Where counters live: Redis, or in each instance's memory.
4. What happens if the counter store is unreachable: let requests through or reject them.
5. How enterprise customers get higher limits, and who owns those numbers.
6. What a rejected client sees.
7. How to roll it out without breaking the enterprise integrations.

But there are dependencies. For example:
- Algorithm choice depends on where counters live? Not necessarily, but token bucket with in-memory counters across 3 instances won't share state well.
- Enterprise higher limits depends on key choice (if keyed by customer ID, easier).
- What rejected client sees depends on whether we reject at all.

I should also look for any existing code or env facts I can find. The user said "src/server.ts" - I can read that. But the skill says finding facts is my job. Let me dispatch a sub-agent or read the repo to find facts. Actually I can just read files directly with read tool.

Let me explore the repo structure first.
```

- tool `read` /tmp/askmore-grill

### Model reasoning

```text
I should read the source files to gather facts about the current implementation. This will help me ask informed questions.
```

### Model reply

.

- tool `read` /tmp/askmore-grill/src/server.ts

- tool `read` /tmp/askmore-grill/src/orders.ts

- tool `read` /tmp/askmore-grill/src/db.ts

### Model reasoning

```text
Good. I now have the facts. Let me build the design tree and identify the frontier questions for round 1.

Key facts:
- Bun.serve, requires x-customer-id header
- Only POST /orders is expensive; GET /orders is cheap
- 3 instances behind round-robin LB
- Redis 7 cluster available
- 20 enterprise customers with scripted integrations that legitimately burst
- Current incident: one customer created 40,000 orders in 10 minutes

Decisions (from plan):
1. Key: x-customer-id, client IP, or both
2. Algorithm: fixed window, sliding window, or token bucket
3. Counter store: Redis or in-memory
4. Store unreachable behavior: fail-open or fail-closed
5. Enterprise limits: how and who owns numbers
6. Rejected client response
7. Rollout strategy

But there are also decisions not listed:
8. Scope: limit only POST /orders or all routes?
9. Default rate limit values
10. Observability/monitoring
11. Whether to allow bursts and how much

Frontier for round 1 (independent decisions):
- Q1: Scope - should we limit only POST /orders as the expensive call, or all routes?
- Q2: Key - what to key on?
- Q3: Counter store - Redis or in-memory? (This is somewhat independent)
- Q4: Rollout - how to roll out?

Wait, algorithm depends partly on key and store. If keyed by IP, in-memory won't work across instances. But Q2 and Q3 are independent enough.

Actually, let me think more carefully. The skill says "frontier is every decision whose prerequisites are already settled". The known facts are settled. So all top-level decisions are in the frontier.

Top-level decisions:
1. Scope (limit only POST /orders or also GET /orders)
2. Key dimension (customer ID, IP, both)
3. Store (Redis, in-memory)
4. Fail-open vs fail-closed when store unreachable
5. Enterprise customer tiering mechanism
6. Rejection response
7. Rollout strategy

But some of these can be combined. And I want to be relentless - ask hard questions.

Actually I should also consider:
- Is 40,000/10min = 66.6 req/s per customer. With 3 instances, that's ~22 req/s per instance. This is relevant for in-memory.
- Round-robin means in-memory counters don't share state unless sticky sessions.
- x-customer-id is already required; IP is not currently used.

Let me craft round 1 questions. I should make them pointed.

Q1: Scope
Should we rate-limit only `POST /orders` (the expensive write), or should `GET /orders` also count toward the same customer limit to prevent cheap-read abuse?

Q2: Key dimension
Should we key the limit on `x-customer-id` only, since that's already authenticated and the problem is one customer going wild? Or do we also need client IP to catch customers sharing one ID across many hosts?

Q3: Counter store
Should we keep counters in the shared Redis cluster so all 3 instances see the same budget, or in each instance's memory and accept that a customer gets 3x the budget under round-robin?

Q4: Algorithm
Should we use a token bucket to allow scripted bursts, a sliding window for strict fairness, or a fixed window for simplicity?

Q5: Failure mode
If Redis becomes unreachable, should we fail open (allow traffic, risk overload) or fail closed (reject with 503, protect the database)?

Q6: Enterprise tiering
Should enterprise limits be configured in code, in a database table, or in Redis, and who approves/changes those numbers?

Q7: Rejection contract
Should rejected requests get HTTP 429 with a `Retry-After` header, or 503, and do we need a structured error body that scripted clients can parse?

Q8: Rollout
Should we roll out in monitor-only mode first, then enforce, or start enforcing immediately; and do we pre-notify enterprise customers?

Hmm, that's 8 questions. The skill says "Ask the whole frontier in one round". Is 8 too many? Maybe. But they are all independent given current facts. Let me group/combine where sensible.

Actually Q4 (algorithm) and Q3 (store) have interaction: token bucket in Redis is common; token bucket in-memory is also possible but needs sync. But they are independent decisions. The user can choose algorithm and store separately, and I can note the implications.

Q5 depends on Q3 only if store is Redis; if in-memory, "store unreachable" might mean something different. But the failure mode question is relevant regardless.

Let me reduce to 5-6 questions to keep it manageable.

Round 1 frontier:
Q1. Scope: limit POST only or include GET?
Q2. Key: x-customer-id, IP, or both?
Q3. Store: Redis or in-memory?
Q4. Failure mode when store unreachable: fail-open or fail-closed?
Q5. Enterprise tiering: where do limit numbers live and who owns them?
Q6. Rollout: monitor-first or enforce-first; customer communication?

Q7 (rejection contract) and Q8 (algorithm) can wait? No, algorithm is fairly independent and important. Let me include it.

Actually, algorithm might depend on the key. If keyed by IP, token bucket is fine. Fixed window has stampede issues. Sliding window is more accurate but complex. These are all compatible.

I think algorithm is frontier. Let me include it.

Final round 1 questions:
Q1. Scope
Q2. Key
Q3. Algorithm
Q4. Store
Q5. Failure mode
Q6. Enterprise tiering
Q7. Rejection contract
Q8. Rollout

8 questions is a lot. The skill doesn't forbid it. The user asked to "stress-test" so being thorough is appropriate. But maybe I can combine rejection contract with rollout? No, they're independent.

Actually let me think about whether rejection contract truly depends on nothing. It depends on the decision to reject, which is already decided (rate limiting will reject). So it's frontier.

OK, I'll ask 7-8 questions. But the `ask` tool has max 5 options per question, not limit on questions. There's no stated max on number of questions, but practical. Let me aim for 6 strong ones.

Hmm, but the skill says "the whole frontier". I should include all frontier decisions. Let me include 6 and maybe mention there will be more rounds.

Wait, I also need to give recommended answers. And format with ❓ **Q1** etc. But the `ask` tool uses a different format. The skill example shows plain text format, but the tool `ask` creates a dialog. Since we have the `ask` tool available, I should use it. But the skill says "Format a round like so" with the ❓ format. The `ask` tool's output is different. Let me use the `ask` tool since it's available and this is explicitly for asking questions. The skill also says "with ask available, calling it is how you follow them".

So I should use `ask`. The `ask` tool takes an array of questions. Each question has header, brief, options, recommended. I can map my round to this.

For each question, I need:
- header: short tab label
- question: text
- brief.what: decision
- brief.where: current state
- brief.how: consequences
- options: 2-5 options with labels, tradeoffs, descriptions
- recommended: index

Let me prepare 6 questions.

Q1: Scope
Header: Limit scope
Question: Should rate limiting apply only to POST /orders, or should GET /orders also consume budget?
Brief:
- what: Decide which routes count against the rate limit.
- where: PLAN.md says POST /orders is expensive; GET /orders is cheap. Current server.ts handles both with no limits.
- how: Limiting only POST protects the DB from the recent incident while leaving cheap reads unrestricted. Including GET prevents a customer from abusing list endpoints but may break scripts that poll heavily.
Options:
1. POST /orders only - protects the expensive write path; minimal breakage risk
2. Both POST and GET /orders under one shared budget - prevents any single customer from dominating instance resources
3. Separate budgets for POST and GET - granular protection, more complex config
Recommended: 0

Q2: Key dimension
Header: Rate-limit key
Question: Should we key the limit on x-customer-id, client IP, or both?
Brief:
- what: Choose the dimension that identifies a "user" for rate-limit accounting.
- where: server.ts already requires x-customer-id. Client IP is available from Bun request but not used. The incident was one customer ID creating 40k orders.
- how: Customer ID matches your authenticated tenant model and lets enterprise customers burst from one host. IP keying catches a customer spawning many hosts but breaks customers behind NATs or proxies.
Options:
1. x-customer-id only - matches existing auth; simple; allows enterprise bursts from one host
2. x-customer-id + IP combined - catches distributed abuse but over-limits NAT/proxy users
3. Client IP only - ignores customer identity; wrong model since IDs are authenticated
Recommended: 0

Q3: Algorithm
Header: Limiting algorithm
Question: Which algorithm should we use?
Brief:
- what: Pick the counter algorithm that enforces the rate limit.
- where: PLAN.md lists fixed window, sliding window, or token bucket.
- how: Token bucket allows scripted bursts and is familiar. Fixed window has stampede at window boundaries. Sliding window is fairest but more Redis operations/memory.
Options:
1. Token bucket - supports bursts; simple Lua script on Redis; good for scripted integrations
2. Sliding window log - accurate fairness; higher Redis memory/CPU cost
3. Fixed window - simplest; boundary stampede risk
Recommended: 0

Q4: Counter store
Header: Counter location
Question: Where should rate-limit counters live?
Brief:
- what: Decide whether counters are centralized in Redis or local per instance.
- where: 3 Bun server instances behind round-robin LB. Redis 7 cluster exists and is used by another service.
- how: Redis gives consistent global budget across instances. In-memory is faster and simpler but a customer under round-robin gets 3x the effective budget.
Options:
1. Redis cluster - consistent global limits; adds dependency and latency
2. In-memory per instance - fast/simple; effective budget triples under round-robin
3. Redis with in-memory short-cache - hybrid; more complex, slight inconsistency
Recommended: 0

Q5: Store failure mode
Header: Redis unreachable
Question: What happens when the counter store is unreachable?
Brief:
- what: Decide fail-open vs fail-closed when Redis (or memory) is down.
- where: PLAN.md flags this as undecided. Redis is shared with another service, so its outages would affect rate limiting too.
- how: Fail-open keeps APIs available but risks the overload you're trying to prevent. Fail-closed protects the database but breaks all enterprise integrations during a Redis outage.
Options:
1. Fail open with alert - allow traffic; page on outage; accept overload risk
2. Fail closed (reject 503) - protect database; breaks integrations during outage
3. Fail open only for reads, closed for writes - partial protection
Recommended: 0

Q6: Enterprise limits
Header: Enterprise tiering
Question: How do enterprise customers get higher limits, and who owns those numbers?
Brief:
- what: Decide where per-customer limits live and who can change them.
- where: PLAN.md says ~20 enterprise customers have legitimate scripted bursts. No configuration system is described.
- how: Hard-coded limits require a deploy to change. A database table lets support/sales own it. Redis config is fast but lacks audit trail.
Options:
1. Database table with admin UI - sales/support owns numbers; audit trail; needs migration
2. Redis key per customer - ops can tune instantly; no deploy; no audit trail
3. Hard-coded tier map in source - simple now; requires engineer + deploy for changes
Recommended: 0

Q7: Rejection contract
Header: Rejected response
Question: What should a throttled client receive?
Brief:
- what: Define the HTTP response when a request exceeds the limit.
- where: server.ts currently returns 401 for missing header, 201/200 for success, 404 otherwise. No 429 handling exists.
- how: 429 Retry-After is the HTTP standard and lets scripts back off. 503 signals server-side trouble. A structured body helps automated clients.
Options:
1. HTTP 429 with Retry-After and JSON error - standard; scripts can back off
2. HTTP 503 Service Unavailable - signals overload but confuses clients
3. Plain text 429 - simple but harder for scripts to parse
Recommended: 0

Q8: Rollout
Header: Rollout strategy
Question: How do we roll this out without breaking enterprise integrations?
Brief:
- what: Choose the deployment and communication plan.
- where: PLAN.md wants to ship this week. Enterprise customers currently burst legitimately; breaking them is a churn risk.
- how: Monitor-only mode lets you measure what limits to set. Enforcing immediately protects the DB fastest but may reject valid enterprise traffic.
Options:
1. Shadow/monitor mode first, then enforce after setting limits - safe; identifies actual burst patterns
2. Enforce immediately with high default limit - fast protection; may still break outliers
3. Enterprise opt-out initially, then tighten - protects most customers; creates two classes
Recommended: 0

OK that's 8 questions. Maybe too many for one ask call? The tool doesn't specify max. But it's a lot. I think 6 is more digestible. Let me drop Q7 and Q8? No, all are frontier. Let me include them. The user asked to stress-test, so thoroughness is expected.

Actually, I realize Q3 (algorithm) and Q4 (store) interact with Q5 (failure mode). But they're still independent decisions - user can pick token bucket + Redis + fail-open, for example. So all are frontier.

Let me use the `ask` tool with 8 questions. I'll write them concisely but with enough detail.

Wait, I should double-check the skill instruction: "A question whose answer depends on another question still open in this round belongs to a later round, not this round." So I need to ensure no question depends on another in this round. My 8 questions are all independent given the facts. Good.

One concern: Q7 (rejection contract) might depend on Q5 if fail-open means no rejections. But even with fail-open, Redis-up rejections happen. So Q7 is still relevant. It's independent.

Q8 rollout depends on enterprise limits (Q6) somewhat, because you can't set limits without knowing the tiering mechanism. But you can still decide rollout strategy independently: e.g., monitor-first regardless of where limits live. It's independent enough.

Actually, Q8 might depend on Q6 because if enterprise limits are in a DB table, rollout needs that table populated first. But the strategy decision (monitor vs enforce) is independent of the mechanism. I'll keep it.

Let me also include a brief intro in the ask call? The ask tool just takes questions. The user will see the dialog.

I need to provide recommended answer index for each. I already did.

Now let me also think about whether there are other frontier questions I should include:
- Default limit values? This is a decision. Where do default numbers come from? 40k/10min = 4000/min = 66/sec. Should default be lower? This depends on enterprise tiering (Q6) but you can decide a default independent of tiering. It's somewhat independent. But maybe it's a detail that can wait until after key/algorithm/store. I'll leave it for round 2.
- Observability? Also can wait.
- Whether to exempt internal/admin? Not mentioned. Could ask but maybe too speculative.

OK, 8 questions for round 1.

Let me format the ask call. Each question needs `brief` with what, where, how; options array; recommended index; id; question text; header.

I should ensure options have label, tradeoff, description. I have those mostly. Let me refine.

One more thing: the skill says "Word each question so 'yes' accepts your recommended answer." Since I'm using the ask tool with multiple choice, this is less relevant, but I should still phrase so the recommended is the natural default. The ask tool has recommended index, so that's handled.

Let me construct the ask call now.
```

### ask call

```json
{"questions":[{"id":"scope","question":"Should rate limiting apply only to POST /orders, or should GET /orders also count toward the limit?","options":[{"label":"POST /orders only","tradeoff":"Protects the expensive write path with minimal breakage risk, but leaves cheap reads unbounded.","description":"Matches the incident (40k writes) and keeps list endpoints unrestricted.","preview":"`POST /orders` → rate-limited; `GET /orders` → unlimited"},{"label":"Both POST and GET under one shared budget","tradeoff":"Prevents any customer from dominating the instance, but may break polling scripts.","description":"A single budget consumed by both routes; cheapest reads can starve writes."},{"label":"Separate budgets for POST and GET","tradeoff":"Granular protection at the cost of more configuration and mental overhead.","description":"Two independent limits; e.g., 100 POST/min and 1000 GET/min."}],"brief":{"where":"PLAN.md says POST /orders writes to Postgres and is expensive; GET /orders is cheap. Current server.ts handles both with no limits.","what":"Decide which routes consume rate-limit budget.","how":"Limiting only POST directly prevents the recent 40k-orders incident. Including GET protects against read abuse but may throttle legitimate polling and complicates the limit story for enterprise customers."},"header":"Limit scope","recommended":0},{"id":"key","question":"Should we key the rate limit on x-customer-id, client IP, or both?","options":[{"label":"x-customer-id only","tradeoff":"Matches existing auth and is simple, but a customer can distribute requests across many hosts under one ID.","description":"Uses the header server.ts already requires. Enterprise bursts from a single host are naturally allowed."},{"label":"x-customer-id + client IP combined","tradeoff":"Catches distributed abuse but over-limits customers behind NATs or proxies.","description":"A customer with 10 servers gets 10x the aggregate budget of a customer with one server."},{"label":"Client IP only","tradeoff":"Ignores the authenticated tenant model and is easy to evade via proxies.","description":"Wrong fit because x-customer-id is already the trusted customer identity."}],"brief":{"where":"server.ts already requires x-customer-id. The incident was one customer ID creating 40k orders. Client IP is available from Bun's request but unused.","what":"Choose the dimension that identifies a 'user' for rate-limit accounting.","how":"Customer ID aligns with the existing tenant model. IP keying catches multi-host abuse but breaks NAT/proxy scenarios and misattributes shared egress points."},"header":"Rate-limit key","recommended":0},{"id":"algorithm","question":"Which rate-limiting algorithm should we use?","options":[{"label":"Token bucket","tradeoff":"Supports scripted bursts and is simple to implement, but allows short spikes up to bucket capacity.","description":"Good fit for enterprise scripts that legitimately burst and then go idle."},{"label":"Sliding window log","tradeoff":"Fair and accurate, but higher Redis memory and operation cost.","description":"Stores a timestamp per request; precise but expensive at high throughput."},{"label":"Fixed window","tradeoff":"Simplest and lowest resource use, but causes stampedes at window boundaries.","description":"A customer can do 2x the intended rate by straddling a window edge."}],"brief":{"where":"PLAN.md lists fixed window, sliding window, or token bucket as undecided. Enterprise customers legitimately burst.","what":"Pick the counter algorithm that enforces the limit.","how":"Token bucket naturally accommodates bursts; fixed window has boundary-stampede risk that could recreate overload; sliding window is fairest but costs more per request."},"header":"Algorithm","recommended":0},{"id":"store","question":"Where should rate-limit counters live?","options":[{"label":"Redis cluster","tradeoff":"Consistent global limits across all instances, but adds a dependency and small latency.","description":"Uses the existing Redis 7 cluster already shared with another service."},{"label":"In-memory per instance","tradeoff":"Fast and simple, but a customer under round-robin gets 3x the effective budget.","description":"Each of the 3 instances maintains its own counters with no cross-instance coordination."},{"label":"Redis with local short-lived cache","tradeoff":"Reduces Redis load, but counters can be slightly stale and inconsistent.","description":"Hybrid approach; more complex and harder to reason about under edge cases."}],"brief":{"where":"There are 3 Bun server instances behind a round-robin load balancer. Redis 7 cluster exists and is used by another service.","what":"Decide whether counters are centralized or local.","how":"Redis gives a single source of truth, which matters when a customer can hit any instance. In-memory under round-robin effectively triples budgets and lets one customer still overload Postgres."},"header":"Counter store","recommended":0},{"id":"failure_mode","question":"When the counter store is unreachable, should we fail open or fail closed?","options":[{"label":"Fail open with alert","tradeoff":"Keeps APIs available, but loses rate-limit protection during the outage.","description":"Log/metric the failure and page on-call; accept risk of overload to preserve business continuity."},{"label":"Fail closed (reject requests)","tradeoff":"Protects Postgres from overload, but breaks all enterprise integrations during the outage.","description":"Return 503 until Redis recovers; safest for the database, harshest for customers."},{"label":"Fail open for GET, closed for POST","tradeoff":"Partial protection with inconsistent semantics.","description":"Allows reads during outage but rejects order creation; harder to document and test."}],"brief":{"where":"PLAN.md flags this as undecided. Redis is shared with another service, so its outages would affect rate limiting too.","what":"Decide behavior when Redis (or memory subsystem) cannot be reached.","how":"Fail-open avoids breaking customers when the protection layer is sick. Fail-closed honors the safety goal but makes Redis a hard dependency of all API traffic."},"header":"Store failure mode","recommended":0},{"id":"enterprise_tiering","question":"How do enterprise customers get higher limits, and who owns those numbers?","options":[{"label":"Database table with admin UI","tradeoff":"Gives sales/support ownership and an audit trail, but requires a migration and UI work.","description":"Per-customer overrides live next to other customer data; changes are logged and reversible."},{"label":"Redis key per customer","tradeoff":"Instantly tunable by ops, but no audit trail and can be lost or mis-typed.","description":"Engineers/SRE can change limits without deploy; risk of untracked config drift."},{"label":"Hard-coded tier map in source","tradeoff":"Simplest today, but requires an engineer and deploy for every change.","description":"Limits live in a TypeScript map; easy to start, painful to maintain at scale."}],"brief":{"where":"PLAN.md says ~20 enterprise customers have legitimate scripted bursts. No configuration system is described.","what":"Decide where per-customer limit overrides live and who can change them.","how":"The mechanism determines how quickly you can respond to a new enterprise customer's burst needs and how you audit who changed what."},"header":"Enterprise tiering","recommended":0},{"id":"rejection_contract","question":"What response should a throttled client receive?","options":[{"label":"HTTP 429 with Retry-After and JSON error body","tradeoff":"Standard and script-friendly, but requires a small response-format change.","description":"`{ error: 'rate_limit_exceeded', retry_after: 12 }` with RFC-compliant header."},{"label":"Plain-text HTTP 429","tradeoff":"Simple to implement, but harder for automated clients to parse.","description":"Just `429 Too Many Requests` with a text body."},{"label":"HTTP 503 Service Unavailable","tradeoff":"Signals overload but is semantically wrong and breaks client retry expectations.","description":"Clients may treat it as server fault rather than a self-imposed limit."}],"brief":{"where":"server.ts currently returns 401 for missing header, 201/200 for success, 404 otherwise. No 429 handling exists.","what":"Define the HTTP contract when a request exceeds the rate limit.","how":"A 429 with Retry-After lets scripted clients back off correctly. 503 implies server error and can trigger the wrong client behavior."},"header":"Rejection response","recommended":0},{"id":"rollout","question":"How should we roll this out without breaking enterprise integrations?","options":[{"label":"Shadow/monitor mode first, then enforce","tradeoff":"Safest path but delays protection by days/weeks while you gather burst data.","description":"Log what would be rejected; set limits based on observed enterprise patterns; then flip to enforce."},{"label":"Enforce immediately with a high default limit","tradeoff":"Fast protection, but outliers above the high limit still break.","description":"Set a generous ceiling (e.g., derived from last week's peak) and lower it over time."},{"label":"Enterprise opt-out initially, then tighten","tradeoff":"Protects the database quickly but creates two classes of customers.","description":"Enterprise customers bypass limits at first; remove opt-out after negotiating per-customer limits."}],"brief":{"where":"PLAN.md wants to ship this week. Enterprise customers currently burst legitimately; breaking them is a churn risk.","what":"Choose the deployment sequence and customer communication.","how":"Monitor-first lets you set evidence-based limits. Enforce-first protects the DB sooner but risks rejecting valid enterprise traffic before you know what those traffic patterns are."},"header":"Rollout strategy","recommended":0}]}
```

### ask result

```text
User answers:
scope: (cancelled)
key: (cancelled)
algorithm: (cancelled)
store: (cancelled)
failure_mode: (cancelled)
enterprise_tiering: (cancelled)
rejection_contract: (cancelled)
rollout: (cancelled)
```

