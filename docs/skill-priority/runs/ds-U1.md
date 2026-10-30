## Person: `/skill:grilling Grill me on the unresolved decisions in PLAN.md. Do not implement the plan.`

omp injected the skill as a user-attributed message: its first line, then the 25 lines of `grilling/SKILL.md`.

```text
[IMPORTANT: User invoked the "grilling" skill; follow its instructions. Full skill below.]
```

- tool `read` PLAN.md

### Model reasoning

```text
The plan is short. I should look at the repo to find facts: server.ts, headers, existing config, tests, deployment. Let me list the directory.
```

- tool `read` .

- tool `read` src/server.ts

- tool `read` src/orders.ts

- tool `read` src/db.ts

### Model reasoning

```text
The plan is tiny. The grilling skill says: find facts via sub-agents. There's no sub-agent tool here, only ask and read. So I'll interrogate the environment with read (limited). No .env, no package.json, no tests, no deployment config. Facts established:

- `x-customer-id` header is unauthenticated client-supplied → keying on it alone allows trivial evasion by rotating IDs. Fact: no auth layer in the repo. So the key decision has an evidence basis.
- No existing middleware structure; single fetch handler, 673B.
- Redis client dependency absent (no package.json); Bun has no built-in Redis client (Bun.redis exists in newer versions — actually Bun 1.2.9 has Bun.redis? Bun added Redis client `Bun.redis` in v1.2.9). Careful: I should not assert. Let me note as inference rather than fabricate. I can state: repo has no package.json and no Redis dependency, so adding one is a new dependency. That's a fact from directory listing.
- `GET /orders` cheap, POST expensive.
- 3 instances round-robin → in-memory counters give 3x effective limit and uneven enforcement. Fact from plan.
- Postgres already available — could use it for counters, but write amplification per request.

The skill demands: round 1 = full frontier (questions with no unsettled prerequisites), each with recommended answer, formatted as specified, and wait. Also "Do not act on it until user confirms."

But my runtime says questions needing user answers MUST go through `ask` tool, and NEVER write questions in the reply. The skill's format is chat-based; the runtime instructs to carry over content/order/recommendations into `ask` calls. Tension: the meta system prompt says "Such instructions assume there is no dialog; with `ask` available, calling it is how you follow them." So I should use `ask` with all frontier questions in one call, headers as titles, briefs carrying context, recommended index.

Max 5 options per question, min 2. Frontier questions — I need to decide which are truly independent.

Decisions in PLAN.md:
1. Key: header vs IP vs both.
2. Algorithm: fixed/sliding/token bucket.
3. Store: Redis vs memory.
4. Fail-open vs fail-closed.
5. Enterprise higher limits + ownership of numbers.
6. Rejection response.
7. Rollout.

Prerequisites: algorithm depends on key? Not really — token bucket vs sliding window is independent of key choice, though per-key storage depends on store choice (Redis sorted sets vs memory). Hmm. Algorithm and store interact: sliding-window log in Redis needs sorted sets; token bucket needs a script. But you can still decide algorithm independent of store, mostly. However the skill says a question whose answer depends on another open question belongs to a later round.

Honest dependency analysis:
- Key choice is root; nothing depends on it except burst policy per key... Actually the identity/evasion question (unauthenticated header, spoofable) is upstream of key choice — but it's a fact I've established, so I fold the risk into the key question.
- Store choice (Redis vs memory) is root-ish: it constrains fail-mode question (fail-open/closed only matters if remote store) and algorithm implementation. Fail-behavior is only meaningful for a shared store; if memory is chosen, question 4 is moot. So Q4 depends on Q3. But asking it in the same round as a conditional is fine? The skill says later round. However fail-mode only exists under a remote store; I can ask it conditioned on Redis since I recommend Redis. Better: put fail-mode in round 1 only if Redis is settled. It isn't. Strictly, defer.
- Enterprise limits: root. Ownership (who owns numbers) too.
- Rejection shape: depends on nothing except what clients expect; independent. But depends on whether limits are per-key... no.
- Rollout: depends on key/store/limits? Rollout strategy (shadow mode, dry-run logging, then enforce) is largely independent, but "how to roll it out without breaking enterprise integrations" depends on the enterprise-limit decision (if enterprises get a high ceiling from day one, rollout risk is lower). So rollout → later round.
- Algorithm: independent of key/store? Store choice affects implementability but algorithm decision is policy-level: burst tolerance matters because 20 enterprise customers legitimately burst. Algorithm is independent → round 1.
- Also unlisted but critical: what's the actual numeric limit / budget basis (per second? per minute?), and which endpoints are limited (POST only? all?). PLAM says POST expensive — but rogue script also hammers GET? Limit scope is independent → round 1.
- Also: is `x-customer-id` spoofable — no auth in code. Key question must confront this. That's the key question itself.
- Also: rejection semantics — 429 with Retry-After, headers, JSON body. Independent.
- Also: should the limiter count rejected requests? That's downstream of algorithm/store. Later round.
- Observability/metrics? Downstream-ish but nearly independent. Could be round 1, but it depends on store? No. But it can wait; the plan doesn't mention it. I should include the important ones. Frontier should be complete for what can be asked now.

Let me choose round-1 frontier (max 5 questions per ask? No — maxItems 5 applies to options, not questions). Questions: I'll do 5: key, algorithm, store, limit scope/budget shape, rejection response. Hmm, enterprise policy (who owns numbers + how higher limits are granted) is independent and central to "without breaking enterprise integrations". That makes 6. Is that too many? The skill says ask the whole frontier. Frontier items I consider independent:

A. Key identity (header/IP/both, plus spoofing).
B. Algorithm (fixed window / sliding window / token bucket).
C. Counter store (Redis vs per-instance memory).
D. Scope of limiting (POST /orders only vs all endpoints) + budget units. Maybe split: scope vs numbers. Numbers (what's the default limit) is independent and essential — 40k in 10 min = ~66/s. Recommend e.g. 10 req/s sustained with burst 50 for POST. Should ask.
E. Rejection response shape.
F. Enterprise override mechanism & ownership of the numbers.

That's 6 questions. F is two things? "How enterprise customers get higher limits" (mechanism: static config map keyed by customer id vs Redis-stored per-customer policy vs header/token claim) and "who owns numbers" (support/sales/ops). I can combine mechanism+owner into one question with options being mechanisms, and note ownership inside. Better: keep one question about override mechanism and ownership, since both are "how enterprises get higher limits".

Round 2 then: fail mode (after store), rollout strategy (after enterprise override), counter accounting of rejected requests, metrics/alerting, per-key burst interaction with LB, config location, rollout of Redis outage plan, testing/verification, rollback.

I should present the round in the required format? The runtime says NEVER write questions in reply, they MUST go through `ask`. The skill format conflicts, but the system prompt resolves it explicitly: carry content into `ask`. So I'll make one `ask` call with the 6 frontier questions, each with brief (where/what/how), evidence paths, options with recommended index, and a short pre-ask message? The ask tool call itself is the round. After answers return, I continue in the same turn with the next round. Since it blocks, I'll get answers and then compute round 2.

Wait — "Then wait for the user's answers before the next round." The ask tool blocks and returns answers, so I get them in the same turn and can ask round 2. That's consistent.

Now craft questions with real evidence.

Evidence I can cite:
- src/server.ts:5-8 — customerId from header, 401 if missing; no auth/verification.
- src/server.ts:10-13 — POST path only expensive write.
- src/orders.ts:10-14 — insert per call.
- src/db.ts:4 — DATABASE_URL single Postgres, shared by every instance.
- PLAN.md:5-18.

Question 1: Key.
Options:
1. Default key = `x-customer-id` (single header), IP only as a fallback for missing/invalid, plus per-IP ceiling to stop header rotation. (recommended)
2. Customer id only.
3. IP only.
4. Both: require both to pass (customer limit AND IP limit) — separate buckets each must be under.
5. Hash of customer id + IP (pairs).

Recommended: dual enforcement — per-customer bucket as the contractual limit, plus a higher per-IP safety ceiling to blunt spoofed-header rotation. Note: x-customer-id is unauthenticated, so customer key alone is bypassable; IP-only breaks NAT'd enterprises and shared proxies, and can't express per-customer entitlements.

Question 2: Algorithm.
Options: token bucket (burst-friendly, amortized refill), fixed window (cheap, boundary burst 2x), sliding window log (precise, memory heavy), sliding window counter (interpolated; needs Redis hashes; precise-ish, cheap).
Recommended: token bucket, burst capacity sized for scripted integrations, refill = sustained rate. Enterprise bursts are legitimate → token bucket is the only one with explicit burst parameter. Fixed window allows 2x at boundary. Sliding log too costly at 66 req/s.

Question 3: Store.
Options:
1. Redis, single Lua/atomic script, shared `orders-rl:` namespace in existing Redis 7 cluster (recommended).
2. Per-instance in-memory.
3. Postgres.
4. Hybrid: memory local limiter + Redis authoritative.
Recommended Redis with key prefix and TTL; memory yields 3x effective limit and uneven round-robin enforcement, plus no global visibility. Postgres adds a write per request on the hot path of the exact call you're protecting.

Question 4: Scope + which budget. Maybe combine scope and default numbers? They're separable but tightly coupled; separate questions would be 7. I'll do: Q4 scope (which endpoints limited), Q5 default numbers. Both independent. Hmm, is the number question dependent on algorithm (refill vs window)? Somewhat — expressing "10 rps, burst 50" presumes token bucket. So numbers depend on algorithm → later round per the skill's rule. Good, defer Q5. So:

Round 1 questions:
1. Key identity.
2. Algorithm.
3. Counter store.
4. Limit scope (POST only vs POST+GET vs all).
5. Enterprise override mechanism/ownership.
6. Rejection response.

Deps: 5 (enterprise) — mechanism "header claim" depends on auth; is enterprise override independent? Mostly. But the "who owns numbers" part depends on... nothing. However override representation (static map vs Redis policy store vs JWT claim) interacts with store choice? If they pick memory, a Redis-stored policy is impossible; static config is the only option. So mechanism depends on store → arguably later. Alternative: ask the *policy* side now: entitlement tiers + ownership, independent of storage mechanism. Framing: "How do enterprise customers get higher limits, and who owns the numbers?" Ask: explicit per-customer override list (ops-owned, checked in config) vs implicit via customer tier from database vs self-serve. Hmm, that's mechanism again.

I'll frame Q5 as: override *authority and shape* — who decides the numbers and where they're recorded as source of truth (checked-in config map owned by ops vs Postgres customers table owned by billing/sales vs Redis policy). That's a policy decision with a storage implication; if they choose config map, mechanism is settled regardless of store. Good enough; keep it in round 1 because it's central to not breaking enterprises. Actually the skill's rule: "A question whose answer depends on another question still open in this round belongs to a later round." I'll ensure the framing doesn't depend.

Hmm, but careful: Q5 options include "Redis policy store", whose viability depends on Q3. I'll avoid offering that; offer config map (checked in), Postgres column, or per-customer token issued to the integration (depends on auth...). Let me offer: (a) checked-in static map, ops-owned; (b) DB table `customer_limits` in Postgres, sales/support-owned via internal tool; (c) header/claim provided by customer — reject as spoofable. Recommended (b)? For 20 enterprise customers with contractual numbers, sales owns them → DB table is the boring fit, but adds a DB read. Cache in memory/Redis with TTL. Hmm, adding DB read per request is bad; cache with 60s TTL. Recommend (b) with cached lookup, owner = whichever team signs contracts (revenue/ops). Actually simpler & boring: checked-in config map in repo, ops-owned PRs, 20 customers is trivially small. Rollout fast, no DB read, auditable in git. Recommend (a). But then support can't change limits quickly. For this week ship, (a) wins.

7th possible question: rejection response. Independent. Include.

That's 6 questions in one ask call. Good.

Also I should include in the brief the facts, especially the unauthenticated header — that's the sharpest finding and it changes Q1.

Also note nothing in the repo authenticates: 401 only for absent header.

For each option: label, tradeoff (one line), description, holds_when, cost.

Recommended indexes:
Q1 key: index 0 (dual: customer bucket + per-IP ceiling).
Q2 algo: token bucket index 0.
Q3 store: Redis index 0.
Q4 scope: POST only index 0? Consider: rogue script created 40k orders — that's POST. GET cheap but still could be hammered. Recommend limiter applied to both but with separate budgets — that's an option, and the plan says GET cheap. Recommend: apply to POST /orders now, with GET unlimited (cheap, and list endpoints matter for scripted polling). Hmm, scripted integrations may poll GET aggressively. A cheap read flood still costs. Recommend: one limiter, separate budgets per endpoint class (POST strict, GET generous), enforced today on POST, GET wired but with a high ceiling. I'll make that option 0 with the note that it's ~5 lines more.
Q5 ownership: config map index 0.
Q6 rejection: 429 + Retry-After (seconds, ceil) + JSON body with error code + limit headers (RateLimit-Limit/Remaining/Reset or RFC 9331 draft). Recommend 429 JSON `{error:"rate_limited", retryAfterMs}` + `Retry-After`, plus `RateLimit-*` on successful responses too? Keep it: option 0 = 429, Retry-After header, JSON body, and rate-limit headers on every response.

Let me write briefs concisely but with substance. Also risks array per question.

Then the reply text: since ask carries the questions, my message shouldn't restate them. System says visuals: no need. I'll give a brief framing (facts found) plus the ask call. Actually the ask call is a tool; the reply should be short. But the tool call happens in the same turn — I'll do the ask call first, get answers, then proceed to round 2 in the same turn.

Let me do it.
```

### ask call

```json
{"questions":[{"id":"key","header":"Limit key","question":"What do we key the limit on: x-customer-id, client IP, or both?","brief":{"where":"src/server.ts:5-8 reads `x-customer-id` off the request and 401s only when it is absent. Nothing verifies it: no signature, no auth middleware, no lookup. 3 instances sit behind a round-robin LB, so the observed client IP is the LB's, not the caller's, unless the LB sets X-Forwarded-For. PLAN.md line 14 lists the key as undecided.","what":"The header is client-controlled, so a customer-id-only limiter is one loop away from being bypassed by rotating IDs; an IP-only limiter cannot express per-customer entitlements, collapses shared NAT/proxy egress, and — behind the LB — may key every request to the same address. Which identity is authoritative, and what stops a spoofed identity from buying a fresh bucket?","how":"Determines the counter key, who can evade, and whether limits survive a header change. Choosing 'customer id only' is only defensible if something upstream authenticates it; nothing in this repo does.","evidence":[{"path":"src/server.ts","start":5,"end":8,"note":"Header read, no verification"},{"path":"PLAN.md","start":5,"end":8,"note":"LB topology and existing Redis"}]},"options":[{"label":"Customer id as the contractual limit, plus a looser per-IP ceiling","description":"Two buckets per request: `cc:{customerId}` at the entitlement rate, `ip:{addr}` at a high abuse rate that only catches header rotation.","tradeoff":"Costs one extra Redis round trip (both in the same Lua script, so one RTT); blocks both spoofing and read floods from one host.","holds_when":"The LB forwards a trustworthy client address.","cost":"Needs X-Forwarded-For handling and one documented constant for the IP ceiling."},{"label":"Customer id only","description":"Single bucket on `x-customer-id`.","tradeoff":"Simplest and matches the entitlement model, but any client can mint unlimited buckets by changing one header value.","holds_when":"You accept spoofing risk this week and close it when auth lands."},{"label":"Client IP only","description":"Single bucket on the socket/forwarded address.","tradeoff":"Not spoofable by header, but breaks scripted enterprise integrations behind shared egress and cannot express per-customer contracts.","holds_when":"All real traffic comes from distinct, stable addresses."},{"label":"Both must pass","description":"Customer bucket and IP bucket enforced at the same severity.","tradeoff":"Hardest to evade, but one noisy customer behind a shared NAT throttles its neighbours at that NAT's IP.","holds_when":"Customers do not share egress addresses."}],"recommended":0,"risks":["If the LB does not set X-Forwarded-For, the IP bucket keys all traffic to one address and takes the whole API down."]},{"id":"algorithm","header":"Algorithm","question":"Which algorithm: fixed window, sliding window, or token bucket?","brief":{"where":"PLAN.md:10 says ~20 enterprise customers run scripted integrations that legitimately burst; PLAN.md:3 says the incident was 40,000 POSTs in 10 minutes (~66/s sustained). No limiter code exists yet.","what":"Fixed window permits 2x the limit across a boundary and punishes a burst that straddles it. Sliding-window log is exact but stores one entry per request — at 66/s per abuser that is ~4k entries per customer per minute. Token bucket is the only one with an explicit burst parameter separate from the sustained rate, which is exactly the enterprise shape: high burst, moderate average.","how":"Sets what the numbers mean later (rate + burst vs rate per window), and how much state Redis holds per key."},"options":[{"label":"Token bucket","description":"Capacity = burst, refill = sustained rate, one hash per key (`tokens`, `ts`).","tradeoff":"Two numbers per tier instead of one, but bursts pass and sustained abuse is still capped.","holds_when":"You want scripted integrations to burst without raising their average rate.","cost":"Lua script arithmetic; clock is Redis TIME, not the app's."},{"label":"Sliding window counter","description":"Weighted interpolation of the current and previous fixed window.","tradeoff":"One number per tier and smooth at the boundary, but no separate burst allowance.","holds_when":"A single `N per minute` number is all you want to publish."},{"label":"Fixed window","description":"`INCR` + `EXPIRE` on `key:{window}`.","tradeoff":"Cheapest possible script, but an attacker gets 2x per boundary and a legit burst can trip it.","holds_when":"Precision does not matter and you want the smallest code path."},{"label":"Sliding window log","description":"Sorted set of timestamps per key, trimmed on read.","tradeoff":"Exact, but per-request state grows with traffic and the hot path gets heavier under exactly the load you are defending against.","holds_when":"Limits are tiny (single-digit per minute)."}],"recommended":0,"risks":["Burst capacity set too high just relocates the incident; the burst number needs the same review as the rate."]},{"id":"store","header":"Counter store","question":"Where do counters live: Redis or each instance's memory?","brief":{"where":"src/db.ts:4 holds one Postgres connection shared by every instance. PLAN.md:8 says a Redis 7 cluster already serves sessions for another service and may be used. There is no package.json, no Redis client, and no config file in the repo.","what":"With 3 instances behind round-robin, an in-memory counter enforces 3x the intended limit and enforces it unevenly as the LB rotates; it also makes the limit invisible from outside the process. Redis gives one authoritative number and one place to inspect, but adds a network dependency on the path of every POST.","how":"Fixes whether the limit is a real ceiling, and whether the fail-mode question exists at all."},"options":[{"label":"Redis, existing cluster, dedicated key prefix","description":"`orders-rl:*` keys, single Lua script, TTL-bounded, no reuse of session keys or DB index if avoidable.","tradeoff":"One authoritative limit and global visibility; adds a per-request RTT and a new dependency on shared infrastructure you do not own.","holds_when":"The cluster tolerates a new workload and you can get a namespace/quota agreed.","cost":"New client dependency, connection handling, key-prefix and eviction policy review."},{"label":"Per-instance memory","description":"Module-level Map, swept on an interval.","tradeoff":"No new dependency and no network hop, but the effective limit is 3x and users see inconsistent 429s as the LB rotates.","holds_when":"You can set instance count to 1 or divide every limit by 3."},{"label":"Postgres","description":"Counter table with an upsert per request.","tradeoff":"Reuses existing infrastructure, but puts a write on the same database as the expensive call you are protecting.","holds_when":"Write volume is negligible."},{"label":"Memory at the edge, Redis as source of truth","description":"Local pre-check to shed obvious abuse, Redis for the authoritative count.","tradeoff":"Best latency under attack, two code paths to keep consistent and test.","holds_when":"You have time to build and test both paths this week."}],"recommended":0,"risks":["Sharing a Redis cluster owned by another service means their eviction or failover policy becomes your outage."]},{"id":"scope","header":"Limit scope","question":"Which endpoints does the limiter cover: POST /orders only, or GET /orders too?","brief":{"where":"src/server.ts:10-16 handles POST (write, src/orders.ts:10-14 does an insert) and GET (src/orders.ts:16-18 does a select). PLAN.md:9 calls POST expensive and GET cheap; PLAN.md:3's incident was a POST flood.","what":"Limiting only POST leaves a polling integration free to hammer GET, which still costs a Postgres query per call and shares the connection pool with the writes you are trying to protect. Limiting both with one budget would make a read-heavy integration look like an abuser.","how":"Determines how many buckets per key and whether the entitlement table needs one number or two."},"options":[{"label":"Both, separate budgets per class","description":"POST strict; GET generous but finite; one limiter, two tier entries.","tradeoff":"Closes the read-flood hole; needs two numbers per customer instead of one.","holds_when":"You want the API capped as a whole this week.","cost":"Roughly one extra config field and one extra bucket key per request."},{"label":"POST /orders only","description":"Match the incident exactly.","tradeoff":"Smallest change and zero risk to read-only integrations, but GET remains an unbounded amplifier against Postgres.","holds_when":"Read traffic is genuinely off the critical path."},{"label":"All endpoints, one shared budget","description":"Every request consumes the same bucket.","tradeoff":"Simplest mental model, but a chatty GET integration burns the budget it needs for writes.","holds_when":"Clients do not mix read and write traffic."}],"recommended":0,"risks":["Adding GET to the limiter is a new way to 429 an integration that has never been limited before."]},{"id":"enterprise","header":"Enterprise overrides","question":"How do enterprise customers get higher limits, and who owns those numbers?","brief":{"where":"PLAN.md:10 says ~20 enterprise customers burst legitimately; PLAN.md:18 asks exactly this. Nothing in the repo reads customer tier, contract, or config — there is no config file at all.","what":"Twenty is small enough that a checked-in map is auditable and ships this week. A database column is the right long-term home for a contractual number, but it puts a read on the hot path unless cached, and it needs a tool for the owning team. A value supplied by the client in a header is not a decision, it is a vulnerability. The ownership half matters as much as the mechanism: whichever team signs the contract must be able to change the number without a deploy.","how":"Decides the lookup on every request, who can raise a limit at 2am, and whether a limit change needs a release."},"options":[{"label":"Checked-in config map, ops-owned","description":"`LIMITS` map in a config module: default tier plus ~20 explicit overrides, reviewed in PR.","tradeoff":"Ships today, fully auditable in git, no hot-path lookup; a limit change needs a deploy and the numbers live away from the contract.","holds_when":"Volume is 20 customers and changes are rare.","cost":"One config file; a documented PR process."},{"label":"Postgres table, support/sales-owned","description":"`customer_limits(customer_id, tier, rate, burst)` read once per request or cached 60s.","tradeoff":"Right ownership and no deploy to change a number; adds a lookup and an internal tool you do not have yet.","holds_when":"Limits change often or are negotiated per deal.","cost":"Migration, cache with TTL and invalidation, internal editing surface."},{"label":"Tier column only, no per-customer rows","description":"Free/pro/enterprise tiers; enterprise is one generous number for all 20.","tradeoff":"No per-customer bookkeeping, but the loudest enterprise customer sets the tier's practical ceiling.","holds_when":"All 20 contracts specify comparable volume."},{"label":"Client-supplied limit header","description":"Integrations declare their own budget.","tradeoff":"Trivial to implement and trivially bypassed.","holds_when":"Never."}],"recommended":0,"risks":["A silent default tier that is lower than today's unthrottled behaviour breaks integrations before any override list is complete."]},{"id":"rejection","header":"Rejection shape","question":"What does a rejected client see?","brief":{"where":"src/server.ts currently returns plain-text bodies with 401/404 and `Response.json` for success. No error envelope, no rate-limit headers, no client SDK in the repo.","what":"A 429 without a machine-readable retry hint makes a scripted integration retry immediately and amplifies the incident. A 429 with `Retry-After` plus a JSON error code lets well-behaved scripts back off; limit headers on success let them self-pace before they ever get rejected. The alternative — connection drop or 503 — is indistinguishable from an outage and triggers client-side alerting.","how":"Sets the contract the 20 scripted integrations consume, and whether a retry loop can be written against it."},"options":[{"label":"429 + Retry-After + JSON error + RateLimit headers on every response","description":"`{error:\"rate_limited\", retryAfterMs}` body, integer `Retry-After`, `RateLimit-Limit/Remaining/Reset` on success and rejection.","tradeoff":"Best client behaviour and cheap to emit; adds a few headers to a hot path and a published contract to support.","holds_when":"Clients can be told about the header (they can: 20 integrations, direct contact).","cost":"Header arithmetic on every response; docs update."},{"label":"429 + Retry-After only","description":"Bare text body, no JSON envelope, no success headers.","tradeoff":"Enough for backoff, no new success-path cost, but scripts must parse status alone.","holds_when":"You want the smallest surface this week."},{"label":"503 Service Unavailable","description":"Reuse the status clients already treat as 'try later'.","tradeoff":"May route into existing retry logic, but collides with real outages and skews error-rate dashboards.","holds_when":"Clients already retry 503 with jitter."},{"label":"429 with no retry hint, close keep-alive","description":"Reject and drop.","tradeoff":"Cheapest to write and the most likely to cause a retry storm.","holds_when":"Never for scripted enterprise clients."}],"recommended":0,"risks":["RateLimit headers on success cost a lookup; if the counter is only read on rejection, the header lies."]}]}
```

### ask result

```text
User answers:
key: (cancelled)
algorithm: (cancelled)
store: (cancelled)
scope: (cancelled)
enterprise: (cancelled)
rejection: (cancelled)
```

