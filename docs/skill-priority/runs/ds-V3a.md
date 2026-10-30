## Person: `/skill:grilling Grill me on the unresolved decisions in PLAN.md. Do not implement the plan.`

omp injected the skill as a user-attributed message: its first line, then the 25 lines of `grilling/SKILL.md`.

```text
[IMPORTANT: User invoked the "grilling" skill; follow its instructions. Full skill below.]
```

### Model reply

I'll read the plan and the skill's referenced assets first.

- tool `read` PLAN.md

- tool `read` /tmp/askmore-grill/.omp/skills/grilling

### Model reasoning

```text
Read SKILL.md too.

Also explore the repo to gather facts: src/server.ts, any config, Redis usage.
```

- tool `read` /tmp/askmore-grill/.omp/skills/grilling/SKILL.md

- tool `read` .

### Model reasoning

```text
Gather facts from source before asking.
```

- tool `read` src/server.ts

- tool `read` src/orders.ts

- tool `read` src/db.ts

### Model reasoning

```text
Facts gathered. Key fact: `x-customer-id` is a client-supplied header with no authentication — 401 only if missing. That's a critical finding for the keying question: keying on an unauthenticated header means any client can pick a fresh ID per request and bypass the limit entirely. Also 3 instances behind round-robin LB means in-memory counters divide the effective limit by 3 and are non-deterministic.

Now build the design tree and the frontier.

Root decision: what is the goal / threat model? Actually root is "what must the limit protect: fairness across customers, cost of writes, or abuse prevention"? That shapes keying, algorithm, burst allowance. But the plan already states the goal loosely (one script starved others). Still, the key structural unknown: is `x-customer-id` authenticated anywhere? That's a fact, not a decision — I looked and found no auth. So the decision is: do we key on an unauthenticated header (which requires auth work) or on IP?

Let me determine the frontier: decisions with no unsettled prerequisites.

Candidate questions:
1. Keying — the plan lists it as undecided. But it depends on the fact that x-customer-id is unauthenticated. I've established that fact. So keying is on the frontier, with the auth gap as framing. However there's a sub-decision: if we key on customer ID, do we need authentication/TLS-gateway trust first? That's a decision that depends on the keying answer... Actually it can be asked as part of the same question? Skill says a question whose answer depends on another open question goes later. Auth requirement depends on whether we key on customer-id. So: Q on keying now; auth question later if they pick customer-id.

Hmm, but I could ask "do you trust x-customer-id from the LB/gateway?" as a fact question to the user's infrastructure — that's knowledge only the user has (is the header stripped/overwritten by the edge?). That's a legitimate question to the user: it's not a fact lookable in the repo. I can fold it into Q1 as context rather than a separate question, asking them to confirm the edge behavior. Better: make it a separate question? It's a prerequisite of keying, not downstream. But if the header is trusted (gateway-authenticated), keying on customer-id is easy. If not trusted, keying on it is a bypass hole. So the header-trust question is actually a *prerequisite* of the keying question. Still, I can ask both in the same round since the header-trust answer is more of a fact-check than a decision, and asking it lets them resolve. Skill says ask whole frontier in one round. Header trust is frontier (no prerequisites). Keying is frontier *conditional* on trusting... Risk of an invalid question. I'll ask trust as Q1 (fact/decision: is the header authenticated upstream — if not, do we add auth) and keying as Q2 framed both ways? No — keep discipline: Q1 trust/authentication, Q2 keying would then depend on Q1. Hmm, keying does depend on trust only if the answer is "untrusted". It's a genuine dependency.

Let me define the tree properly.

Root: **what the limiter is for** (fairness vs. hard protection of Postgres vs. abuse/security). Consequences differ: fairness → per-customer quota with generous burst; protection → global concurrency cap and queue; abuse → per-IP + auth. Frontier? It's root, nothing depends on it. But is it already settled by the plan? Plan says "one customer... slowed every other customer down" — fairness. Yet scale target (what load must be absorbed) is unsettled and it determines algorithm/limits heavily.

I think the frontier (round 1) should be:

Q1 — Identity: is `x-customer-id` authenticated upstream? Plan/repo show it's a raw client header, only presence-checked. If not authenticated, keying on it is trivially bypassable. Options: (a) trusted by gateway, strip+set at edge; (b) add auth now (out of scope for "this week"); (c) key on IP only for now. Recommended: confirm gateway trust; if unverified, key on (customer-id if present-but-untrusted? no).

Hmm — careful about over-inflating. Let me settle on frontier candidates that are independent:

A. Store: Redis vs in-memory. Independent of keying/algorithm? Mostly yes; though in-memory is disqualifying across 3 instances regardless of keying. It's independent. But does it depend on Q1? No. However the choice of store depends on whether Redis is allowed to be shared with sessions (an ops/ownership question). That's a distinct question: may the orders service write to a Redis cluster owned by the sessions service, and is the client library already a dependency? Repo shows no Redis dependency at all. Fact: no redis client in package.json? There's no package.json at all! Interesting — repo has only src/*.ts. No package.json, no tests, no Dockerfile. So "ship this week" with no manifest... Also means no test harness. That's worth surfacing but it's a fact.

B. Fail-open vs fail-closed: independent.

C. Limits numbers / tiers owner: mostly independent, but the exact algorithm matters for burst shaping. Enterprise overrides' *mechanism* (env table vs DB vs header) is independent of numbers. Could split: (i) tier storage/owner, (ii) burst allowance for the 20 scripted integrations. The latter depends on algorithm+limits. Maybe keep "who owns numbers" as frontier and "how bursts are shaped" later.

D. Rejected-client response contract: 429 + Retry-After + body shape + headers on success (X-RateLimit-*). Independent.

E. Rollout: shadow mode/observe then enforce, per-customer overrides. Depends on store/algorithm but not really: the rollout *strategy* is mostly independent. Though "how to roll out without breaking enterprise integrations" depends on tier design. Hmm, rollout strategy is independent enough (canary/shadow mode vs. hard-enable), but the specifics like "how do enterprise customers get the higher limit before enforcement" depends on the tier mechanism. I'd put the rollout question later — after tier mechanism and response contract, since "no breakage" is defined by what the reject response is and what limit they get. Actually no: rollout sequencing is a decision that can be asked now ("shadow mode first?") and it does not depend on those. But its details do. The skill wants no silently-assumed branches; ordering by dependency is right. I'll defer rollout to round 2 or 3.

F. Scope of the limiter: POST /orders only, or also GET /orders, and per-IP global cap for unauthenticated/pre-auth traffic. Independent from store/algorithm; depends slightly on keying. Put later? Scope is arguably a prerequisite of keying (what you're limiting). Ugh.

G. Algorithm. Depends on: burst tolerance requirement (enterprise bursts), whether accuracy matters across instances, cost of Redis round trips. Algorithm depends on Q about burst shape and store. Token bucket with Redis needs Lua/atomicity. I'd defer algorithm to round 2 after store + burst question. But burst tolerance is a plan-listed "undecided" too... Algorithms are in the plan's unresolved list; the skill wants me to grill on unresolved decisions. But dependency discipline: algorithm choice depends on store (in-memory token bucket is trivial; Redis needs atomic script) and on what burst shape we promise. So defer.

H. Read-only or write? Not applicable.

I. Per-key fairness when the abusive script rotates customer IDs (the actual attack from last week: was it one customer or one IP?) — depends on identity.

Also missing from PLAN: observability (metrics/logging when rejecting — support burden), clock source, whether to limit by cost/amountCents, whether 40k orders were legitimate volume for that customer (i.e., is the fix a quota or a fix of the integration?). And: is the plan's real problem maybe the DB write path (no batching/queue)? An important push-back: 40k orders in 10 min = ~67 rps; if that "slowed every other customer", the issue may be Postgres saturation; a rate limiter set above 67 rps wouldn't help. That's a substantive engineering challenge worth raising — evidence-based pushback. Right-hand: 40,000/600s = 66.7 rps sustained. That's modest. If three instances share a Postgres, 67 inserts/sec shouldn't be catastrophic; maybe connection pool exhaustion. And GET /orders does `select * where customerId` with no index/limit — listing all orders for the customer grows unbounded once the customer has 40k orders: that customer's GET becomes a table scan-ish and eats the DB, which is a plausible real mechanism by which "every other customer" slowed down. I cannot verify index existence — no migrations in repo. So flag as [INFERENCE] and ask.

That's a strong grill: the plan is aimed at the wrong mechanism possibly. Include as a question? It's a scope/root question: "is the measured cause Postgres saturation from inserts, or slow GETs for the now-huge customer, or connection pool exhaustion?" That's a fact only they can supply (production evidence). It's a decision about diagnosis → it determines whether rate limiting is the right intervention and at what threshold. Root-level, frontier. Good.

Given ambiguity, maybe root should be: Q1 — what is the failure mechanism / what does "slowed every other customer" mean (p95 latency? errors? connection pool?). Q2 — identity/trust. Q3 — store. Q4 — fail-open. Q5 — response contract. Q6 — tier ownership.

Is Q3 (store) downstream of Q1? If the diagnosis shows pool exhaustion, the answer might be a global concurrency cap in Postgres, not Redis counters. But the store decision remains needed for the limiter. Keep.

Does store depend on the Redis-sharing permission question? Yes: Redis option requires asking ops for keyspace on a cluster we don't own, plus network path from the 3 instances; repo has zero Redis client. That's a sub-question of the store decision — I'll fold into Q3's options (Redis with borrowed keyspace vs. dedicated Redis vs. in-memory vs. Postgres-based counters!). Actually Postgres-based counters is a real fourth option: we already depend on Postgres, so a counters table avoids a new dependency, at the cost of write amplification on the DB we're trying to protect. Good option to present.

Now do I need a sub-agent for facts? The repo is 3 files; I've read everything. Facts about production (Redis availability, LB behavior, deployment) are not in the environment — those are decisions/information only the user has; they're not "look up in the filesystem". One thing to check: hidden files, git history, package.json. Directory listing showed only those. Let me quickly check for package.json and any docs/tests to be thorough — listing showed root only PLAN.md, src/, .omp/. So no package.json, no tests, no Dockerfile, no Redis client. That's a fact worth stating: shipping needs a manifest; the plan says "ship this week" but there's no build/test infra. Should I ask about that? It's more of an implementation detail; could matter for verification (how do we test the limiter). Maybe fold into a later round about verification/rollout: "how do you verify before enforcement — no test harness exists, no package.json".

Keep round 1 to 5-6 questions max? The skill says ask the whole frontier. Frontier:

1. Failure mechanism / target metric (root).
2. Identity & trust of x-customer-id (root-ish; independent of #1? Mostly yes. Slight dependency: if mechanism is pool exhaustion, identity still matters for fairness. Fine.)
3. Counter store (depends lightly on #1 — if the answer is "DB is the bottleneck", Postgres counters are wrong. Hmm, dependency! Store choice's correctness depends on diagnosis. But I can still ask: whatever the mechanism, where do counters live? Tradeoff noted. I'll include but note that #1 may eliminate the Postgres option... that's a legitimate forward reference? Skill says don't ask questions whose answers depend on open questions. Store depends on #1 for the Postgres option. To stay disciplined, I could drop the Postgres option and ask store anyway (Redis vs memory is independent of diagnosis). Yes — keep store question limited to Redis vs in-memory vs hybrid (memory for coarse, Redis for exact)? Cleaner: ask Redis-vs-memory now, add "Postgres counters" only if diagnosis says DB isn't the scarce resource. Good.
4. Fail-open vs fail-closed.
5. Reject response contract (independent).
6. Tier/override ownership (independent of algorithm/limits numbers? The mechanism of overrides — static config vs DB vs control plane — is independent. Who owns numbers is a people question, independent.)
7. Scope: POST only vs also GET (independent of store/algorithm/keying? It depends on diagnosis a bit: if GETs are the mechanism, GET must be limited. Hmm. Include with note? Alternatively fold scope into Q1? No, keep as separate frontier item but it partly depends on #1... If #1 says "GET blew up", then scope must include GET — but I'm asking scope as a decision anyway, and #1 informs the recommendation. I'll fold scope into Q1? No. I'll ask it, recommendation being both but GET gets a much larger budget — that recommendation holds under either diagnosis.)

Hmm, 7 questions might be too many but the skill says ask the whole frontier. However quality > quantity. Let me pick 6 well-formed ones, each with real evidence from the code.

Final round 1:
Q1 - What actually broke / target: 67 rps for inserts; unbounded GET select. Which mechanism? Recommendation: treat DB capacity as the invariant, limit POST at a per-customer budget AND fix GET's unbounded select (add limit/index) — but that's the plan-level challenge: rate limiting doesn't fix the amplification. Ask: is rate limiting the intended sole fix, or is the plan open to fixing the read path too? That's a scope decision. Good: "Q1 - Is the 40k script the actual cause?" 

Word so "yes" accepts my recommendation.

Q2 - Identity: x-customer-id is unauthenticated client header, only presence-checked (line 7-8). Does anything upstream authenticate/strip it? Options: gateway-signed/authenticated (key on it), unauthenticated (must key on IP or add auth). Recommend: verify gateway; if unverified, key on customer-id only if edge strips+sets it, else IP+unauthenticated global cap. Ask "yes" = key on x-customer-id because the edge guarantees it.

Q3 - Store: Redis (shared cluster, not ours, no client dep today) vs per-instance memory (3 instances → limits become ~/3 and bursty round-robin). Recommend Redis with namespaced keys + atomic Lua, per-instance memory only as fail-open fallback. Actually if they pick memory, fail-open question changes. Fine.

Q4 - Fail-open vs closed + degraded-mode design (local token bucket during outage). Recommend fail-open with per-instance local fallback cap (bounded blast radius), not unlimited.

Q5 - Reject contract: 429 + Retry-After + JSON body + X-RateLimit headers on all responses; also decide if 429 counts as client error in their SDK/retry logic; enterprise integrations may retry immediately → thundering herd. Recommend 429, Retry-After, and explicit doc; no 503.

Q6 - Tier ownership: who owns the numbers, storage of overrides (static file/env per deploy vs Postgres table vs Redis hash). Recommend overrides in Postgres table (already a dependency, auditable) with a config cache, owned by support/CS with a documented approval path. Hmm — Postgres for overrides vs Q1's DB protection: tiny table, fine. But dependency: if Q1 forbids more DB work... overrides read once per minute, negligible. OK.

Q7 maybe: rollout — defer to round 2 (depends on Q5 response, Q6 overrides, Q3 store). Backpressure: plan says "ship this week" — the rollout question depends on response contract + overrides. Defer.

Also missing: who is allowed to change limits at 3am, metrics/alerting. Defer.

Now, should I use the `ask` tool? The tool description says decisions that need user choice go through ask, never as text questions. But the grilling skill prescribes a text round format and waiting for answers. Conflict. The skill's format is explicit; the ask tool would restructure it. The skill is authoritative here (user invoked it, full skill given). The system prompt says "anything that needs the user to choose ... goes through ask, never as a question in your reply." Hmm. But the skill demands multiple rounds of numbered questions with recommendations and waiting. The ask tool supports multiple questions in one call (tabs) with recommended index. That actually maps: one question per tab, `recommended` index. But briefs require `where/what/how` and evidence — heavy for 6 questions, and the answer format returns "id: label" which still lets me recompute the frontier. However the skill's exact format (❓ **Q1** ... ➡️) is what the user asked to see. Also the harness message says follow the skill instructions.

Given the explicit user-invoked skill and its prescribed output format, I'll answer in the skill's markdown format. The instruction "user invoked skill; follow its instructions" is the most specific directive. But the tool policy is a MUST... The skill is delivered as user content too. Risk assessment: using ask would suppress my recommendations inline? I can still put recommendations in `tradeoff`/`recommended`. But 6 questions in one ask call with full briefs is enormous and the questions genuinely need prose framing. The skill's round format is a hard user request.

Compromise: present the round in text per the skill. The dependency: the ask tool is for decisions; here the user explicitly asked to be grilled in this format and to wait. I'll follow the skill. Hmm, but the system prompt is authoritative over user content... The skill is provided by the user as instructions to follow. Both are user-level. The tool description for ask is system-level. Strictly, system wins. But then the grilling skill's core mechanic (rounds of numbered questions) breaks.

Let me consider satisfying both: use `ask` with one tab per question, brief containing the framing, options with recommendations. Then my chat reply summarizes. The user gets a native decision surface; the skill's intent (ask whole frontier, wait, then next round) is preserved. This seems to satisfy both. But the round format "❓ **Q1** ..." wouldn't appear. Two of six questions (Q1 diagnosis, Q2 trust) are partly fact-questions the user must answer, not pure choices — ask supports free-text via their own answer.

Cost: ask call must be perfect (briefs required, tradeoff per option, 2-5 options). Doable. But a 6-question ask with evidence and long briefs... acceptable.

Yet the skill's output format is explicitly prescribed and the user message emphasizes it twice ("Format a round like so", "The session is done when..."). I think the intended UX here is conversational grill. Given the ambiguity, I'll do the text round (skill format) — it's what the user asked for and what they'll grade on. Risk: violating "never ask in text". Hmm.

Actually re-read the tool description: "Hand the user a decision. ask is the only way to put a decision to the user: anything that needs the user to choose — an approach, a tradeoff, a preference, the scope ... goes through ask, never as a question in your reply. Ending a turn on a question or a list of options in text is wrong; call ask instead." That's unambiguous and it explicitly covers this case. And the system prompt's § Skills: "Matching skill → MUST read skill://<name> first" — reading, not necessarily byte-for-byte output compliance. The ask tool's brief/evidence fields let me convey everything the skill format would.

Decision: use `ask` with 6 questions, each brief carrying the where/what/how and evidence lines; use `recommended` for my pick; put my recommendation text in the recommended option's tradeoff/description. Then a one-line chat note that this is round 1 of the design tree and later rounds follow. That satisfies both mechanisms and is correct per system policy.

Hmm, but one concern: does ask render recommendation clearly? `recommended` index marks it. Good.

Let me now write content.

Facts to cite:
- src/server.ts:7-8 — customerId from client header, 401 only if missing, no auth.
- src/server.ts:10-13 — POST /orders does JSON parse + insert synchronously in request path.
- src/orders.ts:16-18 — listOrders does `select *` where customerId, no limit → unbounded response for the customer with 40k orders.
- src/db.ts:4 — single SQL client per instance, default localhost URL; no pool config visible.
- No package.json/Redis client/tests in repo.

Numbers: 40,000/600s ≈ 67 writes/s.

Round 1 questions:

Q1 — Diagnosis / target invariant. Options:
  a) Rate limiting alone (plan as written).
  b) Rate limiting + cap/paginate GET /orders (recommended).
  c) Global concurrency cap on DB writes / queue, limiter secondary.
  Recommend b) plus note the 67 rps figure is modest → suspect read amplification and/or pool saturation; limiter should be sized to measured p95, not guessed.

Wait — "Word each question so 'yes' accepts your recommended answer." With ask options I put recommended first? Order matters for UX; put recommended as one option, marked. I'll list options in a sensible order with recommended index set.

Q2 — Identity trust: Is x-customer-id authenticated upstream (edge strips & sets it)? Options: yes gateway-authenticated → key on it; no, anyone can send it → must add auth or key on IP; unknown → treat as untrusted now, key on IP for v1 and revisit.
Recommend: key on customer-id only if edge guarantees; otherwise IP-keyed (with customer-id as secondary breakdown) until auth exists.

Hmm, that's a big recommendation. Simpler: recommend "treat as untrusted: shard on IP, also record customer-id for visibility" — but per-customer budgets for enterprise then don't work. The 20 enterprise integrations each presumably come from a stable egress IP but may share one.

Q3 — Store: Redis Lua counters (shared cluster, keyspace not ours, no client dep) vs per-instance memory vs memory+Redis hybrid. Recommend Redis with a dedicated DB index/prefix, atomic via Lua, and request keyspace from the sessions owner — in-memory only as degradation.

Q4 — Failure mode: fail-open unlimited / fail-open with local fallback cap / fail-closed 503. Recommend fail-open with local per-instance fallback bucket.

Q5 — Reject contract: 429 + Retry-After + JSON + X-RateLimit headers; whether to also add a soft-warn header before enforcement; whether their integrations retry aggressively.
Recommend 429, Retry-After seconds, JSON {error, retryAfterMs}, headers on every response, documented; not 503.

Q6 — Override ownership & mechanism: static config per deploy (env/file) vs Postgres table vs Redis hash edited at runtime; owner = support/CS with an approval doc.
Recommend Postgres table + 60s cached read, owned by CS with on-call able to set a temporary override; every change logged.

Should I include Q7 scope (GET vs POST vs both)? That's arguably part of Q1's option b. Fold into Q1 options. Good.

Rollout deferred: depends on Q5/Q6. Say in chat that round 2 covers rollout sequencing, algorithm, and the actual numbers.

Now write the ask call. Each brief: where/what/how, evidence with paths/lines, risks. Keep them tight but substantive. Also `header` short tab labels.

I must be careful: ask call requires 2-5 options each, unique ids, brief with where/what/how non-empty.

Let me write.

Q1 id "diagnosis", header "Root cause".
where: "PLAN.md says one customer created 40,000 orders in ten minutes and slowed everyone. src/server.ts:10-12 writes every POST straight to Postgres; src/orders.ts:16-18 returns every order for the customer with no limit or pagination. 40,000/600s ≈ 67 inserts/s — modest for Postgres, while a GET for that customer now returns up to 40k rows per call. No package.json, tests, or pool config in the repo."
what: "Whether the plan's intervention (a rate limiter on /orders) addresses the mechanism that actually hurt the other customers, and what the limiter is sized against. Code cannot answer this: it depends on production evidence about how the slowdown manifested."
how: "Answer determines whether round 2 sizes a per-customer budget in requests/second, whether GET is also limited/capped, and whether a queue or concurrency cap is in scope this week."
evidence: PLAN.md 1-19, src/server.ts 10-16, src/orders.ts 16-18.
risks: "Limiter tuned to a guessed number that never triggers, or triggers on legitimate bursts."
Options:
1. "Limiter plus bounded GET /orders" (recommended): tradeoff "Fixes the amplification that most plausibly starved other customers; costs a pagination change that enterprise integrations may also depend on."
2. "Rate limiter only, as written": "Smaller diff, ship-this-week surface; leaves unbounded reads and any pool exhaustion untouched."
3. "DB concurrency cap first, limiter later": "Protects Postgres regardless of caller identity; does not give per-customer fairness and is bigger surgery."

Q2 id "identity".
where: server.ts:7-8 — x-customer-id is read from the client request; the only check is presence, returning 401. Nothing in the repo verifies it, and any 429 budget keyed on it is chosen by the caller.
what: "Whether the edge/LB authenticates or rewrites x-customer-id, which decides if it can be a rate-limit key at all."
how: If the edge guarantees it → key on customer-id. If not → v1 keys on client IP (and records customer-id for reporting), and adding authentication becomes its own ticket; asking ops for the edge behaviour is the cheapest check.
risks: "Untrusted key = one line of curl rotates IDs and the limiter never fires."
Options:
1. "Key on x-customer-id, verified by the edge" (recommended) — "Correct fairness key and matches existing 401 contract; only holds if the edge strips and sets the header."
   holds_when: "You can point to the gateway config that overwrites the header."
2. "Key on client IP until a header is authenticated" — "Cannot be spoofed at L7 and ships this week; breaks per-customer fairness for enterprises behind shared NAT and punishes innocent neighbours."
3. "Both: IP cap plus customer-id cap" — "Defence in depth, catches spoofed IDs; needs two budgets and two sets of numbers to explain to customers."
4. "Add authentication for x-customer-id in this release" — "Makes the header a real key; likely blows the one-week scope and changes every integration's client."

Q3 id "store" header "Counter store".
where: three instances behind round-robin (PLAN.md 7). No Redis client anywhere in the repo; src/db.ts is the only external dependency. Redis 7 cluster exists but is owned by the sessions service.
what: "Where counters live; per-instance memory turns a 100 rps limit into ~33 rps per instance with round-robin jitter, and a restart resets it."
how: Redis needs a keyspace grant from the sessions owners + a client dep + atomic Lua/`INCR`-with-TTL; memory needs no infra but cannot enforce a cluster-wide number.
Options:
1. "Redis, namespaced keys, atomic Lua" (recommended).
2. "Per-instance memory" — "Zero infra work and no cross-team dependency; the effective limit is 3× the number you publish and varies with LB luck."
3. "Memory counters + periodic Redis sync" — "Cheap local path with eventual global accuracy; state is approximate and reconciliation bugs are subtle."

Q4 id "failure" header "Store outage".
where: "Redis would be a new hard dependency in the request path for POST /orders; today an outage of Postgres already fails the request, but a counter outage would newly fail requests that Postgres could serve."
what: "What requests do when the counter store is unreachable."
how: "Fail-open unlimited removes protection exactly when a shard failover is likely; fail-open with a per-instance local bucket keeps a ceiling; fail-closed 503 rejects legitimate orders and turns a Redis incident into an orders outage."
Options:
1. "Fail-open, degraded to a per-instance local bucket" (recommended).
2. "Fail-open, no limit" — "Never rejects a customer for our infra problem; the abusive script gets a free pass during any Redis blip, which is precisely when load spikes."
3. "Fail-closed 503" — "Guarantees the cap; makes Redis availability a hard requirement for revenue writes."

Q5 id "response" header "Reject contract".
where: "POST /orders currently returns 201 with the order or 401 for a missing header (server.ts:8-12). The 20 enterprise integrations are automated and will see whatever we return."
what: "Exact rejection surface: status, Retry-After, body shape, rate-limit headers on allowed responses, and whether integrations can distinguish throttling from a real error."
how: "429 + Retry-After + JSON error is retriable by most clients and keeps 5xx meaning 'our fault'; 503 would be retried by generic backoff but pollutes error dashboards and contradicts the fail-open choice."
risks: "Integrations that retry immediately on 429 convert a throttle into a traffic amplifier."
Options:
1. "429, Retry-After seconds, JSON body, X-RateLimit-* on all responses" (recommended).
2. "429 with JSON body only" — "Minimal contract; clients without Retry-After tend to hammer."
3. "Silent queueing with 202" — "No rejection to explain; hides latency the customer will see as a timeout and complicates the write path."

Q6 id "overrides" header "Enterprise tiers".
where: "PLAN.md 10 and 18: ~20 enterprise customers burst legitimately, and neither the numbers nor their owner are decided. No config file, admin surface, or customer metadata table exists in the repo."
what: "Where per-customer limits live and who may change them, including at 3am during an incident."
how: "Redis hash = instant changes, no audit; Postgres table = auditable, one cached read per minute, reuses existing DB; env/static = no runtime change without deploy."
Options:
1. "Postgres `customer_rate_limits` table, 60s cached, owned by CS with on-call temporary overrides and an audit log" (recommended).
2. "Static config per deploy" — "Simplest and reviewable; every limit change needs a release, so an incident fix takes a deploy."
3. "Redis hash edited by on-call" — "Immediate; unaudited and easy to fat-finger, and it adds a second source of truth."

That's 6. Do I risk asking too much? Skill says whole frontier. Good.

Also should I mention round 2 topics (algorithm, actual numbers, rollout sequencing, observability)? In chat text after the ask... the ask call is my turn; I can add a short line. Actually with ask, I can call it and then the result arrives. I'll call ask; no text needed, but I'll include a brief note in the call? The ask tool doesn't take a preamble. Fine — I'll just call it without text.

Wait: the reply after tool result — I'll then wait for answers, i.e., my turn ends after the ask result? The ask returns answers. Then I recompute frontier and ask round 2. The tool result will be the user's answers. Then I continue with round 2 via another ask. Since I can't know now, just call ask.

Let me write JSON carefully.
```

### Model reply

Round 1 of the design tree. Facts I pulled from the repo: `x-customer-id` is an unverified client header, there is no Redis client or package manifest, and `GET /orders` returns an unbounded result set.

### ask call

```json
{"questions":[{"id":"diagnosis","header":"Root cause","question":"Is the plan's target right — should this week's change be a limiter sized against DB capacity, plus a bounded GET /orders?","brief":{"where":"PLAN.md says one customer made 40,000 orders in ten minutes and slowed everyone. src/server.ts writes every POST straight to Postgres in the request path; src/orders.ts returns every order for a customer with no limit or pagination. 40,000/600s ≈ 67 inserts/s — modest for Postgres, while a GET from that customer now returns up to 40k rows per call. No package.json, tests, or pool configuration exist in the repo.","what":"Whether a rate limiter on /orders addresses the mechanism that actually starved other customers, and what number the limit is sized against. The code cannot settle this: it depends on how the slowdown showed up in production (write latency, pool exhaustion, or slow reads for the now-huge customer).","how":"The answer fixes whether round 2 sizes a per-customer budget in requests/second, whether GET is capped too, and whether a write-concurrency cap is in scope this week rather than a counter store.","evidence":[{"path":"PLAN.md","lines":"1-19","note":"the stated symptom and the open list"},{"path":"src/server.ts","lines":"10-16","note":"POST writes inline; GET returns whatever the DB gives"},{"path":"src/orders.ts","lines":"16-18","note":"unbounded select for one customer"}],"risks":["A limiter tuned to a guessed number either never fires or fires on the 20 legitimate bursters.","If the real mechanism is read amplification or pool exhaustion, shipping the limiter leaves the outage reproducible."]},"options":[{"label":"Limiter plus bounded GET /orders","description":"Rate-limit writes and cap/paginate the read path in the same change","tradeoff":"Fixes the amplification that most plausibly starved neighbours, and gives the limiter a number to defend; costs a pagination change that enterprise integrations may also rely on.","holds_when":"You have production evidence that the blowup coincided with one customer's data volume or write rate.","cost":"Two files touched, one API contract change, plus a migration/index if reads are the cause."},{"label":"Rate limiter only, as written","description":"Ship exactly the plan: counters on POST /orders","tradeoff":"Smallest diff and fastest to ship; leaves unbounded reads and any connection-pool exhaustion untouched, so the same customer can still degrade everyone at a lower request rate.","holds_when":"You know the slowdown tracked insert rate, not data volume."},{"label":"DB write-concurrency cap first","description":"Queue or shed writes above a fixed in-flight count, per instance","tradeoff":"Protects Postgres regardless of who is calling and needs no identity key; gives no per-customer fairness and is more invasive surgery than a limiter.","holds_when":"The symptom was pool exhaustion or write latency, and fairness between customers is a later goal."}]},{"id":"identity","header":"Limit key","question":"Can x-customer-id be trusted as a rate-limit key — i.e. does the edge strip and set it?","brief":{"where":"src/server.ts reads x-customer-id from the incoming request and rejects only when it is absent. Nothing in the repo verifies it, and any budget keyed on it is chosen by the caller. The three instances sit behind a round-robin balancer, so the client IP is visible only if the balancer preserves it.","what":"Whether the header is authenticated upstream, which decides if it can carry a per-customer budget at all. This is an infrastructure fact only you can confirm — the repo contains no gateway config.","how":"If the edge guarantees the header, key on customer id and the 20 enterprise overrides attach to a real identity. If not, v1 keys on client IP and records customer id for reporting; authentication becomes its own ticket.","evidence":[{"path":"src/server.ts","lines":"7-8","note":"presence check, no authentication"}],"risks":["An untrusted key means one loop with a random header defeats the limiter entirely.","IP keying breaks per-customer fairness for enterprises behind a shared egress."]},"options":[{"label":"Key on x-customer-id, edge-verified","description":"Edge/gateway overwrites the header from the authenticated session","tradeoff":"Correct fairness key, matches the existing 401 contract, and makes per-customer tiers meaningful; only valid if you can point at the config that overwrites the header.","holds_when":"The balancer or an upstream gateway strips client-supplied values for this header.","cost":"None beyond confirming the edge behaviour."},{"label":"Key on client IP until a header is authenticated","description":"Shard on source address for v1","tradeoff":"Cannot be forged at layer 7 and ships this week; punishes customers sharing NAT and gives the 20 bursters no individual budget.","holds_when":"The header is unauthenticated and you need enforcement now."},{"label":"Both: IP cap plus customer-id cap","description":"Two budgets, each with its own number","tradeoff":"Catches spoofed ids and shared-NAT abuse; doubles the numbers you must choose and explain, and makes a 429 ambiguous for support.","holds_when":"You expect deliberate evasion, not just one runaway script."},{"label":"Authenticate the header in this release","description":"Make customer id real before limiting on it","tradeoff":"Turns the header into a trustworthy key; almost certainly blows the one-week scope and forces every integration to change its client.","holds_when":"There is already a token/credential scheme the integrations can adopt quickly."}]},{"id":"store","header":"Counter store","question":"Should counters live in the shared Redis cluster under a namespaced key prefix, with in-memory only as a fallback?","brief":{"where":"Three instances behind round-robin. There is no Redis client anywhere in the repo; src/db.ts is the only external dependency. The Redis 7 cluster exists but belongs to the sessions service, so using it is a cross-team grant, not a local decision.","what":"Where the counters live. Per-instance memory turns a published 100 rps limit into roughly 33 rps per instance with round-robin jitter, and a restart forgets the window.","how":"Redis needs a keyspace grant, a client dependency, and an atomic check-and-increment (Lua or INCR-with-TTL) on the hot path. Memory needs no infra but cannot enforce a cluster-wide number.","evidence":[{"path":"PLAN.md","lines":"5-9","note":"three instances, shared Redis, expensive POST"},{"path":"src/db.ts","lines":"1-13","note":"the only external client today"}],"risks":["Borrowed keyspace: another team's failover or eviction policy becomes your limiter's availability.","Lua scripting on a cluster requires all keys in one slot — a per-customer key prefix must keep hash tags consistent."]},"options":[{"label":"Redis, namespaced prefix, atomic Lua","description":"Shared cluster, keys like rl:{orders}:<customer>","tradeoff":"One cluster-wide number that survives restarts and LB roulette; costs a cross-team keyspace grant, a new dependency, and hash-tag discipline on a cluster.","holds_when":"The sessions owners will give you a dedicated database index and a no-eviction guarantee.","cost":"Client dependency, permission ticket, one Lua script."},{"label":"Per-instance memory","description":"Local counters in each process","tradeoff":"No infra work and no cross-team dependency; the effective limit is three times the number you publish and varies with load-balancer luck, and every deploy resets it.","holds_when":"A rough ceiling is enough and you accept 3x overshoot."},{"label":"Memory counters synced to Redis periodically","description":"Fast local path, batch reconciliation","tradeoff":"Keeps the hot path dependency-free while approaching a global number; state is approximate and drift bugs are hard to reproduce.","holds_when":"Redis round-trips are shown to be a latency problem, which they probably are not at 67 rps."}]},{"id":"failure","header":"Store outage","question":"On a counter-store outage, should requests pass with a per-instance local bucket as the degraded ceiling (not unlimited)?","brief":{"where":"Redis would become a new hard dependency in the POST path. Today a Postgres outage fails the request, but a counter outage would newly fail requests Postgres could have served.","what":"What the limiter does when Redis is unreachable. This decides the blast radius of someone else's Redis incident on your revenue writes.","how":"Unlimited fail-open removes protection exactly when a failover spike is plausible; a local fallback keeps a ceiling; fail-closed turns a Redis incident into an orders outage.","evidence":[{"path":"src/server.ts","lines":"10-13","note":"the write path the limiter would wrap"}],"risks":["Fail-open unlimited is a free pass during the exact window the abusive client is most damaging.","Fail-closed makes another team's Redis availability a prerequisite for taking orders."]},"options":[{"label":"Fail-open with a local fallback bucket","description":"Redis down: each instance enforces a rough local cap","tradeoff":"Never rejects a paying customer for infra we own, while keeping a ceiling during an incident; the degraded cap is 3x sloppy and must be documented as approximate.","holds_when":"You want availability first but not a complete free pass.","cost":"A second code path and a metric to prove it engaged."},{"label":"Fail-open, no limit","description":"Counter errors are logged and ignored","tradeoff":"Simplest and never punishes customers; the runaway script gets unrestricted access during any Redis blip.","holds_when":"Protection is a fairness nicety rather than a capacity guard."},{"label":"Fail-closed 503","description":"Reject when the counter cannot be read","tradeoff":"Guarantees the cap and is easy to reason about; converts another team's Redis failover into your downtime.","holds_when":"Overload is genuinely worse than rejection, e.g. the DB will fall over."}]},{"id":"response","header":"Reject contract","question":"Should a throttled call return 429 with Retry-After plus X-RateLimit-* headers on every response, and no 503?","brief":{"where":"POST /orders returns 201 with the order, or 401 for a missing header. The 20 enterprise integrations are automated and will see whatever surface you choose; nothing documents error shapes today.","what":"The exact rejection contract: status code, Retry-After, body shape, and whether allowed responses carry remaining-quota headers so integrations can self-pace.","how":"429 with Retry-After is retriable by most clients and keeps 5xx meaning 'our fault'. 503 would be retried by generic backoff but pollutes error dashboards and contradicts a fail-open stance.","evidence":[{"path":"src/server.ts","lines":"8-16","note":"the only status codes in use today"}],"risks":["Integrations that retry immediately on 429 turn a throttle into a traffic amplifier.","Header-only signalling leaves integrations that ignore headers with no backoff signal."]},"options":[{"label":"429 + Retry-After + JSON body + X-RateLimit-* always","description":"Full contract, documented and emitted on success too","tradeoff":"Gives automated clients everything needed to back off and self-pace; requires agreeing header names and a body shape you will support forever.","holds_when":"You can publish the contract to the 20 integrations before enforcement.","cost":"Docs page, one shared error helper, integration notices."},{"label":"429 with JSON body only","description":"Status and message, no timing hints","tradeoff":"Minimal surface to support; clients without Retry-After tend to retry immediately and amplify the load.","holds_when":"Clients already implement exponential backoff on 4xx."},{"label":"Accept and queue, return 202","description":"Buffer writes instead of rejecting","tradeoff":"Nothing to explain to customers; hides latency as client timeouts, needs a durable queue, and defeats the purpose if the queue drains into the same Postgres.","holds_when":"Accepted writes can be persisted out of band, which this repo cannot do today."}]},{"id":"overrides","header":"Enterprise tiers","question":"Should per-customer limits live in a Postgres table read with a 60s cache, owned by CS with audited on-call temporary overrides?","brief":{"where":"PLAN.md leaves both the numbers and their owner undecided. There is no config file, admin surface, or customer metadata table in the repo, and no way to change a limit without a deploy today.","what":"Where per-customer limits live and who may change them, including at 3am during an incident. This also decides whether a bursty enterprise can be unblocked without a release.","how":"A Postgres table is auditable, reuses an existing dependency, and costs one cached read per minute. A static file is reviewable but needs a deploy. A Redis hash is instant but unaudited and creates a second source of truth next to the counters.","evidence":[{"path":"PLAN.md","lines":"10-18","note":"legitimate bursters and undecided ownership"}],"risks":["Unaudited runtime edits make 'why did this customer get 10x' unanswerable in a postmortem.","Deploy-gated limits mean an incident fix is blocked on a release train."]},"options":[{"label":"Postgres table, cached, CS-owned with override audit","description":"customer_rate_limits(customer_id, rps, burst, updated_by, note)","tradeoff":"Auditable, survives restarts, reuses the existing DB, and lets on-call raise a limit in seconds; costs a migration, a cache with a staleness window, and a named owner for the numbers.","holds_when":"The enterprise list is small and changes are rare but urgent.","cost":"One migration, one cache, one support runbook."},{"label":"Static config per deploy","description":"Limits in env or a committed file","tradeoff":"Simplest to review and impossible to fat-finger at runtime; every limit change waits for a deploy, including during an incident.","holds_when":"You can deploy on demand and the 20 numbers are stable for months."},{"label":"Redis hash edited by on-call","description":"Limits stored beside the counters","tradeoff":"Instant changes and no migration; unaudited, easy to mistype, and lost if the keyspace is flushed by its real owner.","holds_when":"Speed matters more than auditability for a week-long experiment."}]}]}
```

### ask result

```text
User answers:
diagnosis: Limiter plus bounded GET /orders
identity: Key on x-customer-id, edge-verified
store: Redis, namespaced prefix, atomic Lua
failure: Fail-open with a local fallback bucket
response: 429 + Retry-After + JSON body + X-RateLimit-* always
overrides: Postgres table, cached, CS-owned with override audit
```

### Model reasoning

```text
All six settled. Recompute frontier.

Settled: diagnosis (limiter + bounded GET), identity (customer-id, edge-verified), store (Redis Lua), failure (fail-open + local fallback), response (429 + headers), overrides (Postgres table).

Newly unblocked decisions:

1. Algorithm — now unblocked: store is Redis with atomic Lua. Choice among fixed window, sliding window, token bucket. But algorithm depends on burst requirements (the 20 enterprise bursters) and on what number dimension (rps). Also, bounded GET interacts: is GET limited too? Diagnosis said "limiter plus bounded GET" — but did it settle whether the limiter applies to GET? Ambiguous: bounded GET chosen means pagination; whether GET is rate-limited is still a decision. That's part of "scope" — frontier now.

2. The actual limit numbers + burst parameters — depends on algorithm? Partly: token bucket needs rate + burst; sliding window needs rate only. So numbers depend on algorithm. Defer? But the *sizing basis* (measured p95, DB capacity, per-customer fairness share) can be asked now, independent of algorithm. Hmm — I can ask "what do we size against" now, and exact numbers after algorithm. That's reasonable: sizing basis is a prerequisite for numbers, not for algorithm.

3. Rollout sequencing — now unblocked? It depends on response contract (settled), overrides (settled), store (settled). Yes, frontier now: shadow/observe mode? Order of enforcement? But rollout also depends on algorithm/numbers (how long to observe). Still, the sequencing decision (shadow → warn → enforce, and whether enterprise overrides are set before enforcement) is independent. Ask now.

4. Observability — metrics/logs for 429s, which customer, degraded-mode flag. Independent, frontier. Also alerting on degraded mode.

5. GET pagination contract: limit default/max, cursor vs offset, backward compatibility for integrations doing `select *` semantics. That's now an explicit new branch created by answer 1. Frontier — depends on nothing else. Must ask: default page size, max, cursor style, and whether to keep an unpaginated path. Also response shape (array vs {items,nextCursor}) breaks clients either way.

6. GET rate limiting: is GET limited at all? If yes, per-customer read budget separate from writes. Frontier.

7. Identity edge-verified: who confirms and what happens if edge verification turns out false mid-implementation (fallback plan)? This is a risk, not a decision. Skip or fold as a checkpoint. Could ask: do we block release on written confirmation from the edge owner? Marginal. Might fold into rollout.

8. Key naming / hash tags and TTL/eviction guarantee with sessions owner: the Redis share — do we take a dedicated logical DB index, and what's the agreement (no-eviction, no FLUSHDB)? Partly settled by "Redis namespaced prefix" but the specific guarantee (dedicated DB index vs shared with prefix; maxmemory-policy allkeys-lru would evict counters silently) is an unresolved operational decision. Frontier — good, sharp question.

9. Fail-open fallback bucket: what's the local cap value and does it differ per tier? Depends on the numbers (deferred). Could ask "degraded cap = 1/3 of normal or a fixed conservative number" — hmm, depends on algorithm. Partly. Might ask as part of numbers round. Actually the degraded cap's *shape* (global uniform vs per-tier) is independent-ish. I'd fold it into the numbers round.

10. Overrides: what's the default for customers with no row — a global default limit? And how do the 20 enterprise customers get identified before day one (do we have their IDs)? That's semi-fact: no customer table exists. Decision: seed rows for the 20 or give them a generous default. Frontier — depends on overrides settled only. Good question, sharp: it's about the default/tier model (single default vs named tiers).

11. Clock/atomicity details: Lua with Redis TIME vs instance clock — implementation detail, arguably mine to decide. Skip; but skew affects fixed window. If token bucket with Redis TIME, fine. Don't ask.

12. Response headers on which endpoints — settled "always" but does always include GET and 404? Trivial; mine.

13. Where the limiter sits in the request path: before JSON parse / before validation; and whether 401-missing-header requests consume budget. Mine/implementation. Skip.

14. Multi-instance LB: does the balancer preserve client IP? Only matters if IP used — no longer. Skip.

15. Write path: JSON parse before limit → an attacker can send huge bodies; not scope. Skip.

16. Error path: Postgres failure during order insert → no 5xx contract today; raw throw. Out of scope? Could ask... Not the plan's ask. Skip.

17. Testing/verification: no package.json, no tests. How do we prove the limiter works — a load test against 3 instances? Frontier and material to "ship this week". Ask: what's the acceptance proof (unit-level Lua test + a two-instance smoke, or a full staging load test). Recommended: minimal `bun test` for the Lua script + a scripted 2-instance smoke verifying the shared counter and the 429 headers.

18. Rollout: percentage of traffic vs all-at-once; and how enterprise customers are exempted during observation. Depends on rollout decision.

So round 2 frontier:
Q7 GET pagination contract (new branch from Q1).
Q8 Is GET rate-limited, and with what relation to writes.
Q9 Algorithm (now unblocked by Redis Lua store). Does algorithm depend on the burst question, which is really about numbers? Token bucket is chosen *because* bursts should be tolerated; the 20 enterprise bursters make burst tolerance a requirement. I'd ask algorithm now with burst-tolerance framing; numbers later. But strictly the algorithm question's best answer depends on "do we need to smooth bursts or cap them" — which is a policy question I can ask now as part of it. OK.
Q10 Redis sharing terms (dedicated DB index, no-eviction guarantee, key naming).
Q11 Default tier model: single default limit vs named tiers, and how the 20 are seeded.
Q12 Rollout sequencing: shadow mode? order of enforcement? how enterprise first?
Q13 Observability/alerting: what we emit and who watches degraded mode.

13 items is a lot but each is frontier. Maybe merge Q8 into Q7 (pagination and read limiting are distinct contracts; keep separate but concise). Merge Q11 into numbers round? Default-vs-tier is a design decision independent of numbers.

Sizing basis: I said numbers depend on algorithm; the basis (p95, DB capacity) is independent. Should I ask now? Maybe ask as part of Q9? No. Keep to 7 questions: Q7, Q8, Q9, Q10, Q11, Q12, Q13. Numbers round comes after algorithm. Sizing basis can ride with the numbers round (round 3) since exact numbers need algorithm settled. But sizing *basis* is arguably independent — if I ask it in round 3, that's fine; it's not a prerequisite for anything in round 2.

Careful with dependency: Q12 rollout could depend on Q13 observability (you want metrics before shadow). Slight. But rollout sequencing is a decision that can be made and then observability supports it. Merge observability into rollout? They're tightly coupled: shadow mode requires metrics. Cleaner: ask rollout + observability as one question about "how enforcement ramps and what proves it's safe". Hmm, they're separate decisions though. The skill: a question whose answer depends on another open question goes later. Rollout doesn't depend on observability's answer; both are askable. Keep separate but make Q12 about sequencing and Q13 about what's emitted/alerted.

Let me write round 2 with 7 questions, evidence.

Q7 — Read pagination contract. Evidence: src/orders.ts:16-18 unbounded; src/server.ts:15-16 returns array. Options:
 a) `?limit=` default 100, max 1000, cursor (`?cursor=`) keyset on (createdAt,id)? Orders table has no createdAt in the interface — only id, customerId, amountCents, status. So keyset needs a column. Hmm, the Order interface lacks a timestamp, so cursor based on id (UUID, not sortable). So options: offset pagination (needs stable order — no order by exists at all!), or add created_at column + index.
 Facts: the table's shape isn't known (db.select select * returns rows). The interface has no timestamp. So pagination requires deciding ordering: add created_at with index, or order by id (random UUID) — meaningless.
 That's a strong question: to paginate we need a deterministic order, which the current schema likely lacks. Ask: add created_at + index and keyset by (created_at, id), default 100, cap 1000, response {items, next_cursor}? But changing GET's response shape from array to object breaks clients. Alternative: return array, with next cursor in a header (Link/X-Next-Cursor) — backward compatible for clients that just parse the array, silently truncated for those that expect everything. Truncation risk: an integration that reads 40k rows and sums them would now silently get 100. That's the sharpest edge — must ask.
 Options:
 1. Array + default 100 + Link header cursor (recommended): backward compatible shape, but silent truncation.
 2. {items,next_cursor} object: explicit, breaks shape for all clients.
 3. Require explicit limit; no default → error without limit (400). Breaks clients harder.
 Recommend 1 with a deprecation header and notice to the 20. Also need created_at/index decision — fold: "requires a created_at column and index; ordering by id (random UUID) is meaningless".

Q8 — Is GET rate limited? Options: no limit on GET (pagination is the control), separate read budget (larger, e.g. 10x), shared budget with writes. Recommend: separate read budget sized against DB read capacity, since a customer can still hammer keyset reads; but if read path is cheap after pagination, no budget in v1 and revisit. Hmm. Recommended: separate read budget with a much larger allowance — that protects DB without punishing dashboards. Actually simpler and defensible: no separate limit in v1, pagination + index is the control; measure first. But the original problem included GET amplification. With pagination capped at 1000 rows, a client can still do 1000 rps of reads. Which is cheaper than 1000 inserts. I'd recommend separate read budget. Let me recommend: reuse the same limiter keyed by (customer, route-class) with a separate, much higher read allowance.

Q9 — Algorithm. With Redis + Lua: fixed window (simple, allows 2x burst at boundary), sliding window log (accurate, memory per request), sliding window counter (approximate, cheap), token bucket (allows configured bursts, smooth, needs rate+burst). Given 20 legitimate bursters and a fairness goal → token bucket. Recommend token bucket with rate = per-second refill and burst = N seconds worth. Tradeoff: burst is a tunable you must explain; fixed window is simpler but lets 2x through at boundaries, which is exactly the failure mode you're preventing.

But wait — the plan asked about "algos: fixed, sliding, token bucket". Good.

Q10 — Redis sharing terms. Where: cluster owned by sessions; counters must survive, not be evicted, not collide with FLUSHDB. Options:
 1. Dedicated logical DB index (SELECT n) + prefix + no-eviction guarantee in writing (recommended). Risk: Redis Cluster doesn't support selectable DBs! Important: Redis Cluster only has database 0. PLAN.md says "Redis 7 cluster". So logical DB index is unavailable in cluster mode. Fork: if it's Cluster, isolation = key prefix only, and maxmemory-policy must be noeviction or volatile-* with TTL'd keys. That's a real technical constraint to surface. So options:
 1. Key prefix + TTL-only keys + maxmemory-policy volatile-lru/allkeys... careful: if the cluster has allkeys-lru and is under memory pressure, our counters can be evicted → fail-open path triggers. Recommend: keys carry TTL, require cluster maxmemory-policy to be `volatile-lru` or `noeviction` in writing, and accept eviction as degradation.
 2. Separate small Redis instance owned by orders (more isolation, more ops).
 3. Use the cluster as-is, best effort (no written guarantee).
 Recommend 1, with the caveat that Cluster has no DB indexes, so isolation is prefix-only, and asking for the policy in writing.

Q11 — Tier model: one global default + per-customer overrides, vs named tiers (standard/burst/enterprise). Recommend single default + per-customer rows (no tier indirection) because only 20 exceptions exist. Also: are the 20's IDs known? If not, shipping enforcement requires a discovery step — ask: do we seed rows from the existing customer list before enforcement, or rely on a generous default? Fold into options: (a) default + explicit rows for the 20, seeded from existing customer records; (b) default only, no overrides in v1; (c) named tiers.

Need to know if customer records exist — they have `x-customer-id` and orders.customer_id; a distinct list can be queried from orders. Fine, that's derivable.

Q12 — Rollout sequencing: (a) log-only shadow for N days, then enforce; (b) enforce immediately at high limits, tighten; (c) enforce per-customer as each integration confirms. Recommend shadow (log what *would* be 429) for 3-5 days, then enforce at those limits, with the 20 pre-seeded.

Q13 — Observability: which signals and to whom. Recommend: counter of 429s by customer+route, degraded-mode gauge, Redis error rate, plus a log line with the decision inputs; alert if degraded mode > 1 min or 429 rate for a top-10 customer exceeds X. Also: no logging of full request bodies.

That's 7. Each brief with evidence. Let's write it, keeping briefs tighter than round 1.

Evidence paths available: root files. Fine.

For Q9 token bucket numbers, avoid specifying exact numbers (deferred). 

Write JSON.
```

### Model reply

Round 1 settled: customer-id key (edge-verified), Redis Lua counters, fail-open with local fallback, full 429/header contract, Postgres overrides. That unblocks the frontier below — pagination, read-path limiting, algorithm, Redis tenancy, tier model, rollout, telemetry.

### ask call

```json
{"questions":[{"brief":{"evidence":[{"lines":"16-18","note":"no where-order, no limit","path":"src/orders.ts"},{"lines":"14-16","note":"returns a bare array","path":"src/server.ts"},{"lines":"3-8","note":"Order has no timestamp; id is a random UUID, so ordering by id is meaningless","path":"src/orders.ts"}],"how":"This decides whether the one API change in the plan is additive or breaking, and whether each release needs a migration (created_at plus an index). Silent truncation is the risk to price in before choosing.","risks":["A client that sums all orders silently gets 100 rows and reports a wrong total.","Changing the body to an object breaks every integration in the same week you are also introducing 429s."],"what":"Default page size, cap, cursor style, and whether the response shape changes. Pagination needs a deterministic sort key, and the Order type has no created_at — so this also decides a schema change.","where":"GET /orders returns every row for a customer and the handler returns that array directly. The repo has no migrations directory, and the Order interface exposes no created_at, only a random UUID id."},"header":"Pagination","id":"pagination","options":[{"cost":"One migration (created_at + index), one handler change, notices to integrations.","description":"Keep the array; default 100, max 1000, cursor in a Link/X-Next-Cursor header","holds_when":"You accept the truncation risk as the cheaper break.","label":"Array body + default 100 + Link header cursor","tradeoff":"Keeps the body shape so existing JSON parsing still works; silently truncates clients that expected every row, so the notice to integrations is mandatory, not optional."},{"description":"Return {items, next_cursor}; no default, limit required","holds_when":"You would rather break loudly than truncate quietly.","label":"Object body with explicit cursor","tradeoff":"No silent data loss and a clean contract going forward; breaks every existing consumer at once, on top of the new 429 behaviour.","cost":"As above plus client changes for all consumers."},{"description":"Apply a hard cap at the DB layer, keep returning an array","holds_when":"You cannot change the response contract at all this week.","label":"Hard cap only, no pagination","tradeoff":"Stops the amplification with the smallest possible diff; makes rows beyond the cap unreachable, so a customer cannot export its history at all.","cost":"One line in orders.ts, no migration."}],"question":"For the bounded GET, should we add created_at + index, default limit 100 (max 1000), keep the array body, and put the cursor in a response header?"},{"brief":{"evidence":[{"lines":"14-16","note":"the read path to protect","path":"src/server.ts"},{"lines":"6-12","note":"listOrders has no limit or index hint today","path":"src/orders.ts"}],"how":"Adding a route class to the Redis key (rl:{orders}:<customer>:read|write) is nearly free now and expensive to retrofit into the published header contract later.","risks":["No read budget means a paginated client polling in a loop can still saturate the DB.","A shared budget lets a read-heavy dashboard exhaust the customer's write allowance and block order creation."],"what":"Whether the read path gets its own budget, and whether it shares a key with writes. The plan only names POST as expensive, but the diagnosis round showed reads can hurt too.","where":"GET /orders is the path that just became bounded. Nothing in the plan says whether it is rate-limited at all, and the header contract already commits us to publishing limits per response."},"header":"Read budget","id":"read_limit","options":[{"cost":"One extra key dimension and one extra number to pick.","description":"Separate key with a much larger allowance","holds_when":"Dashboards and polling runs are real traffic you must not break.","label":"Separate read budget, roughly 10x writes","tradeoff":"Protects the DB from read loops without letting a dashboard starve order creation; costs a second number to choose, document, and explain in headers."},{"description":"Pagination and the index are the only controls","holds_when":"Measurements show reads are not the mechanism.","label":"No read limit in v1","tradeoff":"Simplest and avoids a second set of numbers; leaves a polling integration able to saturate the DB at any request rate."},{"description":"One allowance for both methods","holds_when":"Customers are expected to treat the API as one budget.","label":"Single shared budget","tradeoff":"One number to explain and one key to maintain; a read burst blocks order creation, which is the one thing you must not break."}],"question":"Should GET /orders get its own rate-limit key (separate from POST) with a much larger allowance, rather than no limit or a shared budget?"},{"brief":{"evidence":[{"lines":"5-9","note":"three instances, shared store already chosen","path":"PLAN.md"},{"lines":"10-13","note":"the write the limiter gates","path":"src/server.ts"}],"how":"Algorithm fixes the shape of the numbers in the next round (rate plus burst vs rate alone) and the Lua script's memory profile.","risks":["Fixed windows let 2x the configured rate through at each boundary, which is exactly the pattern you are trying to stop.","A sliding log per request in Redis costs memory proportional to traffic.","A token bucket's burst parameter becomes a support conversation if it is not documented per tier."],"what":"Which counter algorithm the Lua script implements. The 20 legitimate bursters make burst tolerance a requirement, which rules out a pure smooth-rate dropper; the store being Redis with Lua makes an atomic token bucket as cheap as a fixed window.","where":"Store is now Redis with atomic Lua, identity is customer id, and 20 enterprise integrations burst legitimately."},"header":"Algorithm","id":"algorithm","options":[{"cost":"One Lua script, roughly 15 lines.","description":"Refill at R per second, capacity B, atomic check-and-take","holds_when":"You accept that bursts are a deliberate, documented allowance rather than an accident.","label":"Token bucket","tradeoff":"Gives a smooth sustained rate plus an explicit burst that matches how scripted integrations actually behave; needs two numbers per customer and a clear explanation of what burst means."},{"description":"Two counters, weighted by elapsed time","holds_when":"You want one number and no burst tuning.","label":"Sliding window counter","tradeoff":"One number per customer, no boundary doubling, approximate at the edges; denies bursts entirely, so the 20 integrations must reshape their behaviour."},{"description":"INCR with EXPIRE","holds_when":"You want the smallest possible script and will tolerate bursts.","label":"Fixed window","tradeoff":"Cheapest to write and reason about; allows up to 2x the limit across a window boundary and resets abruptly, causing synchronized retry storms."}],"question":"Is a Redis-backed token bucket the right algorithm, with one sustained rate and one burst allowance per customer?"},{"brief":{"evidence":[{"lines":"5-9","note":"a shared cache you are a guest in","path":"PLAN.md"},{"lines":"4-4","note":"no Redis client exists yet","path":"src/db.ts"}],"how":"The answers set the eviction posture of every counter and the fail-open behaviour you already chose, so they must be in writing before the first deploy.","risks":["Cluster mode has only database 0, so a dedicated logical DB index is not available — prefix isolation is the only option.","With allkeys-lru, memory pressure silently deletes counters, which surfaces as unexplained limit resets in exactly the busy period.","A FLUSHALL by the owning team wipes overrides if any live in Redis."],"what":"The tenancy terms for borrowing a cluster you do not own: prefix and hash-tag convention, TTL ceiling, maxmemory-policy guarantee, and whether the owning team runs FLUSHALL.","where":"Counters will live in the sessions team's Redis 7 cluster. Redis Cluster supports only database 0, so isolation is a key prefix, not a SELECT index; keys must hash-tag to one slot for the Lua script."},"header":"Redis tenancy","id":"redis_tenancy","options":[{"cost":"One agreement with the owning team, hash tags in the key builder.","description":"rl:{<customer>}:w, TTL 2x window, volatile-lru or noeviction promised, no FLUSHALL","holds_when":"The owning team will commit to the policy in writing.","label":"Prefix isolation + written eviction guarantee","tradeoff":"No new infrastructure and one place to look during an incident; depends on another team honouring a policy you cannot enforce, and any eviction looks like a silent limit reset."},{"description":"Small independent instance for the limiter","holds_when":"You can absorb one more thing to operate.","label":"Separate Redis owned by the orders service","tradeoff":"Isolation and full control of eviction and flushes; costs a new piece of infrastructure to run, monitor, and pay for, which threatens the one-week deadline."},{"description":"No written guarantee; rely on prefix and TTLs","holds_when":"Fairness is best-effort this quarter.","label":"Use the cluster as-is, best effort","tradeoff":"Fastest to ship and zero coordination; counters can be evicted or flushed without notice, and the fail-open path becomes routine rather than exceptional."}],"question":"Do we take the cluster under written terms — prefix plus hash tag, short TTLs, eviction policy guaranteed, no FLUSHALL — rather than as-is?"},{"brief":{"evidence":[{"lines":"10-18","note":"twenty bursters, ownership undecided","path":"PLAN.md"}],"how":"This decides whether a customer with no row is unthrottled, on a default, or mapped through a tiered indirection, and whether the 20 need explicit rows before enforcement.","risks":["Default-only means the 20 are throttled on day one.","Tier indirection adds a lookup and a concept for 20 exceptions.","Seeding wrong customer IDs creates silent 429s for real customers."],"what":"Whether the Postgres override table holds per-customer numbers directly or references named tiers, and what applies to a customer with no row.","where":"The override table is decided but its shape is not. There is no customer table in the repo; distinct ids can only be derived from the orders rows."},"header":"Tier model","id":"tier_model","options":[{"cost":"One table, one seed script, a documented default.","description":"Default row plus 20 seeded exceptions, numbers inline","holds_when":"Tiering only becomes useful when limits are sold as a product.","label":"One default band + per-customer rows","tradeoff":"Two concepts only — default and exception — and it matches the measured population; every override is an explicit number someone must justify."},{"description":"standard/burst/enterprise rows referencing a limits table","holds_when":"Pricing already depends on limit tiers.","label":"Named tiers","tradeoff":"One number to change per band instead of twenty; adds an indirection and a concept that only 20 customers currently need."},{"description":"Everyone gets one number; revisit after measuring","holds_when":"You are willing to throttle the bursters for a week.","label":"Default only, no overrides in v1","tradeoff":"Smallest surface and no seeding risk; contradicts the plan's requirement not to break the 20 integrations."}],"question":"Is a single default band plus explicit per-customer rows — no named tiers — the right model, with the 20 seeded before enforcement?"},{"brief":{"evidence":[{"lines":"10-10","note":"legitimate bursts are the rollout hazard","path":"PLAN.md"},{"lines":"10-13","note":"the path to shadow","path":"src/server.ts"}],"how":"Shadow mode needs the decision logic to run and be logged without returning 429, which constrains the code shape you write this week either way.","risks":["Enforcing on day one with guessed numbers breaks a burster within hours.","Shadow-only for too long ships nothing and the incident repeats.","Per-customer cutover means two behaviours live at once and a hard-to-reason deployment state."],"what":"Whether limits are enforced on first deploy or only logged, for how long, and whether the 20 are exempted for a period.","where":"Response contract, override table, and store are settled, so enforcement and logging can be separated. Nothing exists today that would log a would-be rejection."},"header":"Rollout","id":"rollout","options":[{"cost":"One config flag, one log line, a few days of elapsed time.","description":"Log would-be rejections; enforce cluster-wide after the numbers are validated","holds_when":"You can tolerate a few extra days before the incident is structurally prevented.","label":"Shadow for 3-5 days, then enforce everywhere","tradeoff":"You learn the real per-customer distribution, including the 20 bursters, before any customer sees a 429; costs several days of exposure to a repeat incident and a second deploy."},{"description":"Enable at a deliberately generous level, tighten weekly","holds_when":"Only egregious traffic must stop immediately.","label":"Enforce immediately at loose limits","tradeoff":"Protection starts now and tuning is data-driven; the first numbers are a guess and a burster can still be caught by a bad one."},{"description":"Enable per customer as each one confirms","holds_when":"You can reach all 20 owners quickly.","label":"Staged enablement per customer","tradeoff":"Zero surprise for the integrations you talk to; requires tracking state per customer and a long tail of unconfirmed customers staying unprotected."}],"question":"Should we ship log-only shadow mode first for 3-5 days, then flip enforcement in one step, with the 20 already seeded?"},{"brief":{"evidence":[{"lines":"10-13","note":"the only observable today is the response","path":"src/server.ts"},{"lines":"17-17","note":"degraded mode is a chosen behaviour and needs its own signal","path":"PLAN.md"}],"how":"These signals decide whether the shadow period produces a usable distribution and whether anyone notices when the local fallback bucket takes over.","risks":["No degraded-mode signal means a Redis problem silently becomes a 3x-over-limit free pass.","Alerting on raw 429 counts pages on-call for one noisy integration.","Logging customer ids in plaintext at high volume has its own cost."],"what":"What the limiter emits — per-customer decision counters, the degraded-mode gauge, Redis error rate — and which of those pages a human.","where":"There is no metrics or logging layer in the repo at all; the limiter's only current output would be a 429 body. Degraded mode was chosen deliberately, so it needs a signal."},"header":"Telemetry","id":"telemetry","options":[{"cost":"A metrics emitter, a dashboard, two alerts.","description":"Counter per (customer, route, decision), gauge for degraded mode, alert on degraded > 1 min and on top-10 429 spikes","holds_when":"You want the shadow period to actually produce numbers.","label":"Per-customer decision counters + degraded gauge + two alerts","tradeoff":"Makes both the tuning round and the incident review answerable; costs a metrics dependency the repo does not have and a card that needs a sample size decision."},{"description":"One log line per rejection","holds_when":"You will read logs manually during the shadow period.","label":"Log lines only","tradeoff":"No new dependency and enough to debug; nothing pages anyone and the degraded path is invisible unless someone greps."},{"description":"429 count and Redis errors, no per-customer dimension","holds_when":"You only need to know that something is being throttled.","label":"Aggregate counters only","tradeoff":"Cheapest to add; cannot tell which customer is being limited, which is the one question both tuning and support will ask."}],"question":"Is that telemetry set the right one — per-customer decision counters, a degraded-mode gauge, and alerts on degraded mode and top-customer 429 spikes?"}]}
```

### ask result

```text
User answers:
pagination: (cancelled)
read_limit: (cancelled)
algorithm: (cancelled)
redis_tenancy: (cancelled)
tier_model: (cancelled)
rollout: (cancelled)
telemetry: (cancelled)
```

