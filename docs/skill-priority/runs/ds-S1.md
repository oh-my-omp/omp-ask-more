## Person: `/skill:grilling Grill me on the unresolved decisions in PLAN.md. Do not implement the plan.`

omp injected the skill as a user-attributed message: its first line, then the 25 lines of `grilling/SKILL.md`.

```text
[IMPORTANT: User invoked the "grilling" skill; follow its instructions. Full skill below.]
```

### Model reply

I'll read the plan and skill assets first.

- tool `read` PLAN.md

- tool `read` /tmp/askmore-grill/.omp/skills/grilling

### Model reasoning

```text
Let me read the SKILL.md and explore the repo to gather facts.
```

- tool `read` /tmp/askmore-grill/.omp/skills/grilling/SKILL.md

- tool `read` /tmp/askmore-grill

### Model reasoning

```text
Small repo. No .github, no tests, no package.json apparently. Let me read the three source files to gather facts (auth header presence, framework, existing session/redis usage).
```

- tool `read` src/server.ts

- tool `read` src/orders.ts

- tool `read` src/db.ts

### Model reasoning

```text
Facts I have:
- Bun.serve, single fetch handler, `x-customer-id` header is already required and trusted as identity (401 if missing). No auth/verification — the header is client-supplied identity. That's relevant to keying: keying on x-customer-id is spoofable; keying on IP is not the customer identity and enterprises may come from a few egress IPs.
- Only two routes, no other middleware. No package.json, no tests, no Redis client anywhere in the repo — "Redis 7 cluster already used for sessions by another service; we may use it" but no dependency present, and no credentials/config in env except DATABASE_URL.
- 3 instances behind round-robin.

The design tree. Root decision: what's the actual objective/threat model (fairness vs abuse vs capacity) — actually the root is arguably settled: one customer's script (a customer, not anonymous) hammered POST /orders and slowed everyone. That is settled in the plan's problem statement.

Frontier round 1 — decisions whose prerequisites are settled now:

1. **Keying** — settled prerequisites: we know x-customer-id exists and is required on every request, and it's client-supplied. But keying depends on: (a) is x-customer-id trustworthy/spoofable? That's a fact-gathering question? Not really, it's a decision about whether to rely on header identity. Hmm, the truly root question: is the limit meant to protect capacity (fairness across customers) or to police abuse (blocking bad actors)? Because if the latter, a spoofable header matters enormously. Actually, keying choice hinges on treat-model. So Round 1 Q: threat model/scope — is this capacity fairness or abuse detection?

Wait, but the plan explicitly says "One customer's script... slowed every other customer down" → goal is fairness/noisy-neighbor protection. That's settled enough. But a risk-hidden item: x-customer-id is unauthenticated, so any script can rotate it. That's a fact I can state, and it makes keying a genuine decision. I could ask keying in round 1 with that in the brief.

What depends on what:

- Key selection → what does "customer" mean when header is spoofable (needs decision: trust the header, or key on IP+customer pair, or fix auth — separate but implies scope).
- Algorithm → depends somewhat on keying? Not really; algorithm depends on desired burst semantics. But algorithm also depends on the rollout decision for enterprises (bursts). Hmm: enterprise bursts: 20 enterprise customers legitimately burst. Algorithm choice (token bucket vs fixed window) determines how bursts are treated. Independent-ish. It's frontier: algorithm can be decided now, since "legitimate burst" is a given requirement? Burst tolerance is a decision that shapes algorithm — so bundle: "What burst semantics do we want?" as the algorithm question.
- Counter store location → depends on algorithm? Distributed counting (sliding window needs shared state; token bucket can be approximated locally with per-instance sharding). Store decision and algorithm decision are somewhat coupled but can be decided independently if we go "Redis since 3 instances round-robin make memory counters divide every limit by 3". Key fact: memory counters with round-robin = limit/3 per client and inconsistent. So in-memory is basically wrong for fairness. That's an engineering fact; Redis is the recommendation. But there's a real question: shared Redis vs Postgres vs local. And risk: Redis is shared with another service (sessions) — blast radius; need separate key namespace / connection / eviction policy (maxmemory eviction could drop session keys if same instance — they share cluster, so maybe separate DB index / logical keyspace). Depends on whether we can use Redis at all — plan says "we may use it" — that's a prerequisite decision (can we depend on another service's Redis? who owns it, ACLs). So Q: counter store.
- Fail-open vs fail-closed → depends on store choice (if memory, no store failure). Mostly independent but the recommended answer depends: fail-open because rate limiting is availability protection, not security; header is untrusted anyway. Frontier after store decided. Actually if store = Redis then this matters; if store = memory, moot. So it belongs to a later round if it depends on store choice. Hmm — skill says question whose answer depends on another open question in this round goes later. Fail-open/closed genuinely depends on the store outcome. So round 1 should ask store, and defer fail behavior.
- Enterprise limits & ownership → depends on keying? Not much. Depends on algorithm (numbers are per algorithm). Defer.
- Rejected client response → depends on client response format; independent-ish but the shape (429 + Retry-After + error body contract) depends on rollout/comms. It's frontier-ish. But there's a dependency: what clients see depends on fail-open decision? No. It depends on whether there's an existing error envelope convention — fact check: repo has plain text 401/404, JSON for success. So a decision.
- Rollout → depends on enterprise limits decision + response format (comms). So later round.

Also missing branches the plan doesn't name but must be decided:
- Scope of routes: does GET /orders get limited too? The plan says GET is cheap. But a script can also hammer GET. Decision: limit only POST, or both with different budgets. Frontier.
- Should the offending request be counted or should we also handle the "40k orders already created" — cleanup/refund? Out of scope probably.
- Idempotency / retry behavior of enterprise scripts — 429 handling client-side.
- Observability: metrics/logs when a client is throttled (you can't tune limits without data). Frontier-ish, cheap.
- Whether the limit counts rejected requests (i.e., token bucket that doesn't consume on reject). That's algorithm detail.
- What happens to a request that is rejected: does it hit Postgres at all (ordering in code). Implementation.

Should I dispatch a sub-agent? Facts I might want: is there a Redis client / config in env? Search repo for redis. Repo is 3 files, already read. No package.json. So no fact needed beyond what I have. I could check for hidden files: `ls -la`. The read of directory showed only src, PLAN.md, .omp. Let me check for hidden/dotfiles? Directory listing shows .omp, so hidden files are shown. Maybe check .omp for config. Not relevant.

Maybe worth a quick read of src to confirm no middleware/test infra — done.

One more fact: "Redis 7 cluster already used for sessions by another service; we may use it" — the word cluster is ambiguous (Redis Cluster sharding vs sentinel). That's a fact question for the environment, not in repo. Can't look it up. But it doesn't need to be resolved before asking "should we use it at all"; and if Redis yes, the client/keyspace question is a later round. Actually I can ask about access/ownership as part of the store decision brief. Hmm — the skill says don't ask facts, dispatch subagents. Repo has no info on Redis deployment. So the decision "use the existing Redis or stand up our own" is a decision that hinges on facts I can't get. I'll present it as a decision with the condition ("if the other team grants us a dedicated logical DB/ACL") — that's legitimate: it's their call on coupling.

Let me plan Round 1 frontier (questions answerable now):

Q1. Trust boundary of x-customer-id / key selection. This is the root of the tree because everything (limits, enterprise overrides, response) keys off it. Prereq settled: header is required but unverified (src/server.ts:7-8). Recommended: key on x-customer-id as primary, plus a per-IP aggregate ceiling as a safety net for spoofing/rotating — but careful: spoofing x-customer-id means rotating IDs bypasses; per-IP cap catches that. But enterprise integrations may share egress IPs → IP ceiling must be well above enterprise limits. Recommend both: customer bucket (primary, what limits are expressed in) + coarse IP ceiling (abuse safety net, high threshold).

Q2. Route scope: POST only or both. Recommend POST only at launch with a shared per-customer budget? Actually recommend: limit POST /orders (expensive write) with the main budget; also apply a much larger ceiling to GET to prevent read-storm, or skip GET? Simpler/boring: apply one per-customer request budget to both routes, but weight POST more? Over-engineering. Recommend: limit POST now; GET unlimited at launch, add later if observed. But "slowed every other customer down" — a GET storm could too. Hmm — GET hits Postgres select too. Boring + honest: one limit per customer covering POST only this week; note GET is unbounded risk. I'd recommend POST only, explicit.

Q3. Algorithm & burst semantics. Recommend token bucket (GCRA) because enterprise bursts are legitimate and fixed window lets 2x through at boundary. Token bucket with capacity = burst, refill = sustained rate. Since 20 enterprises legitimately burst, burst capacity matters.

Q4. Counter store. Recommend Redis (shared), because round-robin across 3 instances makes memory counters mean limit/3 and inconsistent. Use the existing cluster only if a dedicated keyspace/logical DB + ACL + no maxmemory eviction on our keys; otherwise... we don't have another store. Alternative: Postgres already a dependency (db.ts) — could do a counter table but that's more write load on the same Postgres we're trying to protect — bad. So recommend Redis (existing cluster, dedicated DB index + ACL + noeviction concern), fallback if refused: in-memory with per-instance limit = global/3 (a decision they'd need to accept).

Hmm, but Q4's recommendation depends on Q3? Not really — both work in Redis. Note GCRA is a single-key atomic script; sliding window log is heavier. Fine to ask both in parallel; and the algorithm recommendation acknowledges store.

Q5. Fail-open vs fail-closed on store error — depends on Q4? If Redis chosen, this matters; if memory, moot. Per skill, defer. But it's such a core decision, and the answer is fairly obvious (fail-open, because it's a fairness control not an auth control, and header is unverified). Still, it's downstream of store choice → later round. Round 1 shouldn't include it. Hmm, but "the frontier is every decision whose prerequisites are already settled". Fail-open's prerequisite is store choice, which is open now. So defer to round 2. Right.

But is the round too small? Four questions is fine. Also consider adding:

Q. Deployment/rollout risk: 20 enterprise customers bursting — do we know their current peak rates? That's a fact we don't have (no metrics in repo). Without data, any number is a guess. That's a real decision: "how do we set the initial numbers" → shadow mode (log-only) first. But that's the rollout question, which depends on algorithm + limits. Rollout is arguably independent of those in one respect: do we ship in observe-only mode first? That decision itself depends on whether they have metrics/observability. I could ask "ship in shadow mode first?" now — it depends on nothing but the goal. But it does depend on Q3/Q4 in the sense that shadow mode requires the counter infra to exist. Hmm, shadow mode only requires computing decisions, which requires algorithm+store. So its prerequisites are open → later round. Defer.

What about ownership of enterprise limit numbers (who owns)? Depends on: how overrides are configured (config vs DB vs header), which depends on algorithm/store. Defer.

Response body format: depends on rollout/comms + client behavior (do enterprises handle 429?). It's client-facing contract; recommending 429 + Retry-After + structured JSON error with machine-readable code. This is fairly independent — but does it depend on fail-open? No. On algorithm? Retry-After value derivation depends on algorithm (GCRA gives you the exact wait time — nice). Slightly depends. But the decision "what does a rejected client see" can be made now at the contract level. Hmm. The plan lists it as undecided. Is there any open prerequisite? The header trust (Q1) doesn't matter. Algorithm matters for whether Retry-After can be exact. I can ask it now with "Retry-After exact when algorithm allows" — but if they choose fixed window, we compute seconds to window end. Both provide a value. So it's independent enough. I'll include as Q5? That makes 5 questions. The skill says ask the whole frontier. Fine — include response contract now, since it's the client-visible contract that enterprises must code against and it's needed before rollout.

Actually careful — the plan's own list order suggests they think of these as parallel. Let me include:

Q1 key (trust boundary)
Q2 route scope & what counts
Q3 algorithm/burst semantics
Q4 store
Q5 rejected-client contract (status, headers, body, whether rejected requests consume budget)

Defer to round 2: fail-open, enterprise overrides & ownership, rollout/shadow mode, plus new branches discovered: observability/alerting on throttle events, config reload mechanism, per-instance vs global limit math verification, tests, who gets paged.

Hmm, should I include "does a rejected request consume budget" in Q5? Yes as sub-detail of response? It's algorithm behavior. Better in Q3 or Q5. Put in Q5 as part of contract? I'll fold into Q3 briefly... Actually fold into Q5: "rejected requests do not consume budget beyond the one that rejected" — token bucket naturally: reject when insufficient tokens, don't deduct. Fine, mention in Q3 recommendation.

Also a hidden branch worth surfacing in round 1 or noting: the plan says "ship this week" — testing/verification expectations and whether a 429 storm can break the LB health checks. Not a decision per se.

Another hidden decision: does the limit apply per-route or per-customer globally (one budget shared between POST/GET)? Covered in Q2.

I should also verify one fact for Q1: is x-customer-id the only identity? Yes, no auth. Fine.

Let me also check if there's a git history / other branches with metrics. Not needed. There's no package.json — so adding a redis client means adding a dependency; note "no package.json" — actually it's Bun with zero deps. Adding ioredis/bun's built-in RedisClient (Bun has RedisClient built in). That's a fact worth stating in Q4 brief: Bun ships `new RedisClient()`, no dependency needed. Good detail.

I must not implement. Just ask. Use the ask tool? The instructions say every question the user needs to answer goes through `ask`, never into the reply... but the skill explicitly demands the formatted round in the reply. Hmm. System prompt: "Every question you need the user to answer goes through ask". The skill says format a round like the example in the message. Conflict? The system-level tool policy is authoritative-ish ("XML tags inject system content" — the skill was injected by user though; it's a user message containing the skill). The system prompt's ask tool description says: "This holds when a skill, workflow or other instruction tells you to ask the user, confirm with them or let them pick."

So I should use the ask tool. But the skill's format is a numbered round with recommendations and "yes" accepts the recommendation. I can encode each question as an ask question with options including "Yes — recommended" and alternatives. And the reply text should show the round format? The ask tool renders tabs with briefs. The skill format wants question bodies in the reply.

Best approach: use the ask tool with 5 questions, each with options where the recommended one is listed first, and include the brief. Then my chat text... If I call ask, the tool blocks for answers and I get answers back, then I continue in the same turn? The ask tool waits for answers. Hmm, but the skill says "Then wait for the user's answers before the next round" — the ask tool's return gives me the answers, so I can then do round 2 in the same turn, provided dependencies resolve. But the tool result may be cancelled/timed out.

Given the ask tool waits and returns answers, I can run round 1 via ask, then round 2 via ask. That satisfies both: questions go through ask, rounds in sequence.

But the skill's display format — I should still present the round in my reply text so the user sees the numbered questions with recommendations? The ask UI shows each question tab with question + brief + options. Duplicating in chat violates "one form per idea"? Actually the guidance says never the same content twice. But the skill explicitly gives the format. Hmm.

Risk: if I put the questions in chat text AND ask via tool, duplication. If I only use ask, the round format is not followed literally, but the substance is delivered with more structure (tradeoffs, holds_when). I think the pragmatic answer: use ask tool (mandated), and keep chat text to a single short pointer line naming the round scope... but actually the final answer should contain the round in the skill's format since the user asked for grilling and the session ends only when frontier empty.

Hmm, the ask tool blocks and the result comes back; but I "must not end turn on a question in text". If I end my message with the formatted questions in text, that's ending a turn on a question in text — prohibited. So: use ask.

Let me not over-think. Call ask with 5 well-built questions. Then, after answers, ask round 2. Then produce a final synthesis in the skill's format? The skill says "Do not act on it until the user confirms you have reached a shared understanding."

Plan: Round 1 via ask (5 questions). Round 2 via ask (fail behavior, enterprise overrides & ownership, rollout/shadow mode, observability & config source, test/verification bar). Round 3 possibly. Then final: condensed decision record + "confirm shared understanding" — that confirmation itself is a question → ask tool again? That would be asking for confirmation... which the tool says is appropriate ("confirmation before a risky or irreversible step"). The skill says don't act until user confirms. Since I'm not implementing, I can end with the decision record and note "say go if this matches". Hmm, ending on a question in text is prohibited. I could use ask for the final confirmation. Let's see how rounds go.

Now craft the questions with strong briefs.

Q1 key: "What do we key the limit on?" Facts: x-customer-id required, unverified (src/server.ts:7-8). Options:
 a) customer id primary + coarse per-IP ceiling (recommended)
 b) customer id only
 c) IP only
 d) both per-request: min(customer, ip) hard equal
Recommend a. Tradeoff: spoofable header rotation bypass; IP ceiling catches non-enterprise abuse but enterprises behind shared NAT need high ceiling.

Hmm, actually is IP even available? Bun req has `server.requestIP(req)`. Fact: Bun.serve fetch can get IP via `server.requestIP(req)` — needs the server object reference; current code doesn't keep it (`Bun.serve({...})` unnamed). That's an implementation detail, mention. Also behind a load balancer, requestIP returns the LB's IP unless proxy protocol / X-Forwarded-For trusted! Big fact: 3 instances behind a round-robin LB → per-IP keying needs X-Forwarded-For, which is spoofable unless the LB overwrites it. That's a strong argument that IP keying is weak here too. Good grilling point.

Q2 route scope: POST only vs POST+GET. Recommend POST only, per-customer budget; GET unbounded for now, and note read-storm risk unaddressed. Or recommend single global per-customer request budget covering both with POST weighted heavier? Boring: one budget on POST.

Q3 algorithm: token bucket (GCRA) recommended; fixed window cheap but 2x boundary and poor fit to legitimate bursts; sliding window log memory-heavy, sliding counter approximation complex. Burst capacity = per-min burst.

Q4 store: Redis recommended. Options: existing shared cluster dedicated logical DB/ACL; new dedicated Redis; per-instance memory (limits divided by 3, inconsistent — actually with round-robin per-request distribution, each instance sees ~1/3 of a client's traffic, so a per-instance limit L yields effective 3L global and bursty behavior; and it doesn't protect as intended); Postgres counter table (adds write load to the resource we're protecting). Recommend existing cluster with dedicated DB index + ACL + noeviction guarantee, provided the owning team agrees; else in-memory interim. Also Bun has RedisClient built-in (fact — Bun's RedisClient exists, stable since Bun 1.2.x). Careful about accuracy: Bun provides `RedisClient` in Bun 1.2.9+. Repo has no package.json so Bun version unknown. I'll phrase as "Bun ships a Redis client, so no dependency is strictly needed — verify version".

Hmm, careful with unverified claim. I'll say Bun has a built-in Redis client; verify against the deployed Bun version. Mark as [INFERENCE]? It's true as of Bun ≥1.2.9. Fine.

Q5 rejected client contract: 429 + Retry-After (integer seconds) + JSON body {error:{code:"rate_limited", message, retry_after_seconds}} vs plain text. Note existing errors are plain text (401 "missing x-customer-id", 404 "not found"), success is JSON. Recommend JSON envelope for the new error with code, since enterprises will branch programmatically; also headers RateLimit-Limit/Remaining/Reset? Recommend minimal: 429, Retry-After, and `x-ratelimit-*`? IETF draft uses RateLimit headers. Keep boring: 429 + Retry-After + JSON body; skip the IETF headers at launch. Also: don't count rejected requests.

Also include in Q5: should 429 be returned before touching Postgres (i.e., middleware ordering) — that's implementation, skip.

Now briefs must be reasonably terse but substantive. Let me write.

Also each ask question requires options min 2, max 5. Recommended index.

Let me write the calls.

For Q1 options:
1. "Yes — customer id primary + coarse per-IP ceiling" (recommended)
2. "Customer id only"
3. "IP only"
4. "Per-customer only, but fix auth first" — hmm that's a different branch (add verification of x-customer-id). Actually a real option: verify the header (shared secret / mTLS / signed token) before trusting. That's a prerequisite sub-decision: "trust the header as-is vs. require signed identity". That is arguably the true root! Because if the header is unauthenticated, any limiter keyed on it is advisory. But note: the plan accepts the header as identity for data writes already — createOrder uses customerId straight from the header. So the whole API already trusts it. So rate limiting keyed on it is no weaker than the API's existing identity model. Good point — mention. So "fix auth" is out of scope for this week.

I'll present 4 options with that context.

Q2 options:
1. POST only (recommended)
2. POST + GET, one shared customer budget
3. POST + GET with separate budgets

Q3 options:
1. Token bucket / GCRA (recommended)
2. Fixed window
3. Sliding window (log or counter)

Q4 options:
1. Existing Redis cluster, dedicated key prefix/logical DB + ACL (recommended)
2. New dedicated Redis instance
3. Per-instance in-memory
4. Postgres table

Q5 options:
1. 429 + Retry-After + JSON error code (recommended)
2. 429 + plain text (matches existing errors)
3. 429 + JSON + full RateLimit headers

Let me include brief.evidence paths and lines.

Write concise briefs. Then after answers, round 2.

One more consideration: should Round 1 also include "who owns the enterprise numbers"? Its prerequisites: how overrides are stored/served depends on store + keying decision. Defer. Good.

Let me make the calls.
```

### ask call

```json
{"questions":[{"id":"key","header":"Limit key","question":"Key the limit on x-customer-id, client IP, or both?","brief":{"where":"`src/server.ts:7-8` requires `x-customer-id` on every request and it is the only identity in the system — unverified, client-supplied, and already trusted for writes (`createOrder(customerId, …)`). Three instances sit behind a round-robin LB, so per-IP keying needs `X-Forwarded-For` (spoofable unless the LB overwrites it) or Bun's `server.requestIP()` (returns the LB's address unless proxy protocol is on). 20 enterprise customers burst legitimately, and some likely share egress IPs.","what":"The key determines what a 'customer' means to the limiter, and every later number, override and error message hangs off it. The header is unauthenticated, so customer-id-only is advisory for anyone who rotates the header; IP-only collides enterprises behind one NAT and is blind behind an LB.","how":"Pick the recommended pair and the limit is expressed per customer with a coarse anti-rotation ceiling; other answers change the required LB/header plumbing and who gets punished when one script misbehaves.","evidence":[{"path":"src/server.ts","lines":"5-13","note":"header is read and trusted with no verification"},{"path":"src/orders.ts","lines":"10-13","note":"customerId flows straight into the write"}]},"options":[{"label":"Yes — customer id primary + coarse per-IP ceiling","tradeoff":"Limits are meaningful per customer; the IP ceiling catches header rotation, but needs XFF handling at the LB and a ceiling far above enterprise burst so shared NAT never trips it.","description":"Per-customer token bucket as the real limit; a second, much looser IP-level budget purely as a safety net.","holds_when":"The LB can be made to overwrite X-Forwarded-For (or we accept requestIP once it returns the client)."},{"label":"Customer id only","tradeoff":"Simplest and zero LB work; a hostile script rotating x-customer-id is unlimited, so this is fairness, not protection.","description":"One budget per distinct header value."},{"label":"IP only","tradeoff":"Not spoofable at L3 if XFF is trustworthy, but enterprise NATs collapse into one bucket and the customer dimension disappears from the data.","description":"Budget per source address."},{"label":"Customer id now, verify the header before trusting it","tradeoff":"The only option that makes the limiter non-advisory; adds an auth/key-rotation project (shared secret, mTLS or signed token) that cannot ship this week.","description":"Introduce identity verification first, then key everything on the verified id."}],"recommended":0,"brief_diagram":""},{"id":"scope","header":"Route scope","question":"Does the limit cover only POST /orders, or every route per customer?","brief":{"where":"Only two routes exist: `POST /orders` (Postgres insert, the expensive one) and `GET /orders` (Postgres select per the plan's description). The incident was 40,000 POSTs in ten minutes.","what":"A limiter on POST alone leaves a script free to hammer GET and still slow everyone else; a shared budget makes a busy read customer unable to write. This also fixes what the limit's unit is (writes vs requests), which the enterprise numbers depend on.","how":"POST-only keeps the unit 'orders created', which enterprise customers can reason about and which matches the incident; adding GET forces a second unit and doubles the numbers to agree."},"options":[{"label":"Yes — POST /orders only","tradeoff":"Matches the incident and keeps one legible unit; leaves a read-storm hole that nobody has hit yet.","description":"One per-customer budget expressed in order creations."},{"label":"POST + GET under one shared per-customer budget","tradeoff":"Closes the read hole; couples reads and writes so a customer polling GET can exhaust its write budget.","description":"One request budget over both routes."},{"label":"POST + GET with separate budgets","tradeoff":"Correct semantics and closes the hole; requires two sets of numbers per customer tier and more config surface.","description":"Write budget and read budget per customer."}],"recommended":0},{"id":"algorithm","header":"Algorithm","question":"Fixed window, sliding window, or token bucket?","brief":{"where":"The plan's workload is 20 customers that legitimately burst against a baseline, and one script doing 40k in ten minutes (~67/s sustained). No metrics exist in the repo to say what a legitimate peak looks like.","what":"The algorithm decides what 'legitimate burst' means and how precisely a client can be told when to retry. Fixed window allows 2x the limit across a boundary (bad for the exact case we are fixing); sliding-window-log stores one entry per request (40k keys per abuser); token bucket stores two numbers and lets burst capacity be tuned independently of sustained rate — which is exactly the enterprise-burst shape.","how":"Token bucket lets the burst capacity be a policy knob separate from the refill rate, and yields an exact retry delay for Retry-After; fixed window makes the enterprise numbers need a safety factor for the boundary exploit.","evidence":[{"path":"PLAN.md","lines":"3-10","note":"bursty-but-legitimate traffic plus one sustained abuser"}]},"options":[{"label":"Yes — token bucket (GCRA)","tradeoff":"Two-integer state per key, exact retry delay, tunable burst; slightly more code than a counter and needs a small Lua/atomic script in Redis.","description":"Capacity = burst allowance, refill = sustained rate; a rejected request does not consume a token."},{"label":"Fixed window","tradeoff":"Trivial to implement; admits up to 2x the limit at window edges and punishes enterprises that legitimately burst at minute boundaries.","description":"Counter per minute bucket."},{"label":"Sliding window","tradeoff":"Smoothest behaviour, but the log variant is memory-heavy per abuser and the counter variant is extra machinery for a first ship.","description":"Log or weighted-two-bucket moving window."}],"recommended":0},{"id":"store","header":"Counter store","question":"Where do counters live: shared Redis, per-instance memory, or Postgres?","brief":{"where":"Three instances receive round-robin requests, so per-instance memory means each instance sees ~1/3 of a customer's traffic: an in-memory limit of N produces ~3N globally and inconsistent decisions per request. Redis 7 is available but owned by another service (sessions) and 'we may use it'. Postgres is already a dependency but is the resource being protected. The repo has no package.json; Bun ships a Redis client, so no third-party dependency is strictly required (verify against the deployed Bun version).","what":"This is the coupling decision: sharing another team's Redis buys atomic global counts at the cost of blast radius and an eviction/ACL risk; memory buys independence at the cost of the limit meaning nothing; Postgres adds write amplification to the exact bottleneck being defended.","how":"Once the store is chosen, the failure mode question (fail-open vs closed), the counter-key layout and whether limits can be changed without a deploy all follow from it.","evidence":[{"path":"src/db.ts","lines":"1-12","note":"Postgres is the only shared dependency in the code today"},{"path":"PLAN.md","lines":"7-8","note":"3 instances, round-robin"}]},"options":[{"label":"Yes — existing Redis cluster, dedicated keyspace + ACL","tradeoff":"Atomic global counts for free; depends on the owning team granting a separate logical DB/ACL and guaranteeing no eviction of our keys, and puts a new failure mode in the request path.","description":"Reuse the session cluster with a `rl:` prefix, separate credentials, and explicit no-eviction handling.","holds_when":"The owning team agrees to a dedicated logical DB and the cluster's maxmemory policy cannot evict our keys."},{"label":"Dedicated new Redis instance","tradeoff":"No blast radius and no negotiation; one more thing to run, secure and page someone for, likely past this week's ship date.","description":"Own Redis for rate limits only."},{"label":"Per-instance in-memory","tradeoff":"Zero infrastructure; the limit must be divided by 3 and is still wrong under uneven balancing or a rolling deploy that resets counters.","description":"Local token buckets, limit per instance = global/3."},{"label":"Postgres counter table","tradeoff":"Reuses an existing dependency with no new service; adds a write (and row contention) to the database we are trying to protect.","description":"Atomic increment/upsert per customer in Postgres."}],"recommended":0},{"id":"response","header":"Rejection contract","question":"What does a throttled client see?","brief":{"where":"Existing errors are plain text with no code (`401 \"missing x-customer-id\"`, `404 \"not found\"` in `src/server.ts:8,17`); successes are JSON. 20 enterprise scripted integrations will parse whatever we return.","what":"This is a client-visible contract they must code against, so it must be decided before any shadow rollout is announced. It also fixes whether the retry hint is machine-readable (Retry-After, exact second under a token bucket) and whether throttling is distinguishable from a real 4xx bug in their logs.","how":"A JSON envelope with a stable code lets integrations branch on throttling without string matching; Retry-After lets them back off correctly instead of retry-storming the limiter.","evidence":[{"path":"src/server.ts","lines":"8-17","note":"current error shape is plain text"}]},"options":[{"label":"Yes — 429 + Retry-After + JSON body with a code","tradeoff":"Unambiguous and machine-actionable; a new error shape that differs from the existing plain-text 401/404, so it needs a doc/announcement to the 20 integrations.","description":"`429`, `Retry-After: <seconds>`, `{\"error\":{\"code\":\"rate_limited\",\"retry_after_seconds\":N}}`."},{"label":"429 + plain text","tradeoff":"Consistent with today's errors and zero client doc work; clients must string-match or retry blindly.","description":"`429 \"rate limited\"`."},{"label":"429 + JSON + RateLimit-* headers","tradeoff":"Gives clients proactive budget visibility; more surface to get right and to keep consistent under multiple instances.","description":"Standard RateLimit-Limit/Remaining/Reset headers on every response."}],"recommended":0}]}
```

### ask result

```text
User answers:
key: (cancelled)
scope: (cancelled)
algorithm: (cancelled)
store: (cancelled)
response: (cancelled)
```

