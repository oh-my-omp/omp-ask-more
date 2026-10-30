## Person: `/skill:grilling Grill me on the unresolved decisions in PLAN.md. Do not implement the plan.`

omp injected the skill as a user-attributed message: its first line, then the 25 lines of `grilling/SKILL.md`.

```text
[IMPORTANT: User invoked the "grilling" skill; follow its instructions. Full skill below.]
```

### Model reply

I'll start by reading the plan and the skill directory.

- tool `read` PLAN.md

- tool `read` /tmp/askmore-grill/.omp/skills/grilling

### Model reasoning

```text
Let me read the SKILL.md and explore the repo for facts: src/server.ts, tests, config, deploy, etc.
```

- tool `read` /tmp/askmore-grill/.omp/skills/grilling/SKILL.md

- tool `read` .

### Model reasoning

```text
No package.json, no tests. Let me read the source files. Tiny repo.
```

- tool `read` src/server.ts

- tool `read` src/orders.ts

- tool `read` src/db.ts

### Model reasoning

```text
Facts: Bun server, x-customer-id header unauthenticated (!) — 401 only if missing; any string accepted. This is critical: keying on x-customer-id is spoofable. Client IP behind LB: need X-Forwarded-For trust decision → depends on keying decision. Actually "key on both" and "IP" both need LB header facts. That's a fact I can note: round-robin LB, so we need to know if LB sets XFF. That's environment fact — but no deploy config in repo. I should dispatch sub-agent? The skill says dispatch a sub-agent for facts. But there's no agent tool available except `ask`. Tools available: read, ask. No terminal/bash. So exploration is limited to read. I've read the whole repo: 3 files, no package.json, no tests, no deploy config, no config for customers. I can state the absence as a fact.

No sub-agent tool available. Fine — I'll note repo has no LB/deploy/auth/config artifacts, so some facts are genuinely unknowable from repo and are decisions or facts only user knows (e.g., is there an auth layer upstream?). The skill says never ask user for facts I could look up — these I can't look up; and whether an auth layer exists upstream is a fact the user knows but also a decision input. I'll frame as decision where possible.

Frontier for round 1: decisions with no unsettled prerequisites.

1. Scope of limiting: only POST /orders, or GET too? PLAN says POST expensive, GET cheap. Question: is the limit per-route or global per customer? This is foundational, no prereq. Recommended: count POST /orders only (expensive writes), leave GET unlimited.

2. Keying: x-customer-id vs IP vs both. Prereq: none? Keying on customer-id is settled-ish given auth? But authenticity is a separate issue: header is client-asserted. So a sub-decision: do we trust the header as-is (with an auth layer upstream)? That is a fact about the deployment, but effectively a decision: do we rate-limit on unauthenticated header (spoofable → limiter defeated by rotating header) — recommended: key on x-customer-id, but require an upstream auth fact; if no auth exists, IP becomes the only enforceable key. Hmm, this is a genuine fork. I can ask it as Q: "Do we key on x-customer-id alone, accepting it's client-asserted?" with options. That's the frontier item, and it must be asked now since every other question (Redis key schema, enterprise limits) hangs off it.

Actually keying question depends on the spoofing decision. Merge into one question: "Key: customer-id / IP / both" with body noting spoofability. But also need: which IP source (XFF trust) — depends on keying choice, so later round.

3. Storage: Redis vs in-memory. Prereq: none? 3 instances behind round-robin → in-memory gives 3× effective limit and non-deterministic. Recommended: Redis. But depends on nothing. Ask now.

4. Fail-open vs fail-closed. Prereq: none? Depends on storage choice? If Redis, unreachable is meaningful; if memory, no store. So this depends on Q3. Skill: a question whose answer depends on another open question belongs to a later round. Fail-open only makes sense if Redis chosen. Hmm, but it can be asked conditionally... Strictly, it depends. Put later.

5. Algorithm choice: fixed/sliding/token bucket. Depends on: whether bursts must be allowed (enterprise bursty) and whether Redis chosen (in-memory algorithms differ slightly but all work). Algorithm is independent of keying and storage mostly. But the burst tolerance depends on enterprise limits decision. Algorithm can be asked now with recommendation: token bucket (smooths + allows bursts, single atomic Lua per key). But sliding window requires more Redis ops. I'd say algorithm is frontier now — no prereq strictly, though burst requirement is a settled input from PLAN (20 enterprise customers legitimately burst). Yes ask now.

6. Rejected client response: status code, headers, body. Independent of everything? Almost — Retry-After depends on algorithm (window reset vs token refill time). Strictly it depends on algorithm. Hmm. But the shape of response (429 vs 503, error body format, headers) doesn't depend on algorithm; Retry-After value computation does. I could ask response shape now and leave Retry-After semantics to later. But careful: skill says don't ask downstream questions early. Response format is upstream of nothing; it's a leaf-ish decision. Asking it now is fine, with Retry-After noted as derived. Actually to be conservative and rigorous, I could still ask it now because the decision "what does a rejected client see" doesn't require knowing the algorithm — only the header's exact value does. I'll ask now, leaving the computation to a later round? That fragments. Alternative: ask response contract now including "429 + Retry-After + JSON body matching existing error format" — the "matching existing format" is a fact: current errors are plain text "missing x-customer-id", status 401. So concrete.

7. Enterprise tier mechanism + ownership of numbers: depends on keying (per-customer override keyed by customer id) — yes depends on Q2? If key by IP, per-customer tiers are hard. So later round. Hmm but if the plan says 20 enterprise customers with high limits, tiers only make sense with customer identity. I'd put enterprise tiers in round 2, after keying. Yes.

8. Rollout: shadow/monitor-only mode, canary per instance, config flag. Depends on: storage & response decisions (need a mode that logs instead of rejects). Mostly independent though — rollout strategy is a deployment decision. But "shadow mode" implementation depends on where config lives. Config source (env var vs Redis vs code) is a separate frontier decision! Config: how limits are configured (env vars, code constants, Redis-backed dynamic). That's foundational and independent. And enterprise tier ownership depends on config mechanism. So Q: where do limits live.

Let me structure round 1 frontier:

Q1 Route scope: which requests are counted (POST only vs all), and is it per-customer global bucket or per-route.
Q2 Key: customer id vs IP vs both (+ spoofing reality).
Q3 Counter store: Redis vs in-memory.
Q4 Algorithm: token bucket vs sliding window vs fixed window.
Q5 Rejection contract: 429 shape/headers/body.
Q6 Config placement: where limits and overrides live (env/code/Redis), and hot reload.
Q7 Rollout: observe-only first? per-instance canary? feature flag.
Q8 Limit numbers themselves: default rate/burst values, derived from observed traffic — do we have traffic data? That's a fact question; repo has none. The value decision depends on algorithm (burst) and keying. Later round. But the *method* of choosing numbers (measure first vs pick 10/min) could be asked now? Depends on algorithm. Later.

Also: does the limiter apply to missing x-customer-id (401 path) — trivial, covered by route scope.

Also failure mode: Redis down. Depends on Q3 → round 2.

Also: shared Redis cluster with sessions from another service → key namespace/prefix, separate DB, blast radius. Depends on Q3 → round 2.

Is Q7 rollout dependent on Q5/Q6? Loosely. Rollout "without breaking enterprise integrations" — the mechanism (observe-only mode, canary, per-customer overrides) depends on config mechanism (Q6). Strictly, Q7 depends on Q6. Hmm. I could ask a narrower rollout question now: "First deploy runs in observe-only (log-only) mode, then enforce" — that's a strategy decision independent of config plumbing details. And later ask canary/percentage details. I think asking the strategy now is legitimate: it doesn't presume config storage.

But careful about over-asking: 8 questions is a lot but this is grilling. Frontier should be all questions answerable now. Let me prune dependencies properly.

Truly independent roots:
A. What is protected (route scope + dimension).
B. Identity/key for the limit.
C. State store.
D. Algorithm.
E. Config/ownership of limit values (mechanism).
F. Rejection contract.
G. Rollout strategy.
H. Limit magnitudes (depends on D, B, and traffic evidence).

I'll ask A–G now; H later. Wait — G "rollout" also includes enterprise grandfathering which depends on E. I'll frame G as staged enforcement strategy only.

Should I include a question about whether Redis use is acceptable at all given it's shared with sessions (blast radius)? That's part of C.

Also Q: does the plan include tests / where does this live (module src/ratelimit.ts)? That's implementation detail — the user said don't implement. Probably out of scope for grilling decisions but could be relevant: no test infrastructure exists (fact: no package.json, no test files). Worth noting but not a decision to grill? Maybe fold into verification: "how do we prove it works before enabling" — part of rollout. I'll fold a smoke/verification requirement into G.

Now recommendations:

A: Count only POST /orders; GET unlimited; single per-customer bucket across POST endpoints (only one exists). Recommend POST-only, per-customer global.

B: Key on x-customer-id only — because tiers, fairness, and 20 enterprise customers are identity-based; IP is shared by NATed customers and meaningless behind LB without XFF trust. But spoofing: header is client-asserted; any script can rotate it. Recommend customer-id **provided** an auth layer validates it — and require verification. Options: customer-id (recommended), IP, both (max of two limits: enforce customer bucket + a coarse IP bucket to catch header rotation).

Hmm, "both" is actually defensible: customer id for fairness + IP as anti-spoof backstop. But IP behind round-robin LB needs XFF, and NAT collisions hurt enterprises. Recommend customer-id alone, plus note that spoofing is an auth problem not a limiter problem; if no auth layer exists, that's a blocker to flag. Actually the honest recommendation: key on customer-id; treat unauthenticated spoofing as separate finding requiring confirmation of upstream auth. Since it's a decision, recommend customer-id and require the user confirm auth exists (that's a fact I can't read from repo — allowed since I can't look it up; embed in question body).

C: Redis shared with sessions — recommend Redis, dedicated logical DB or key prefix on the existing cluster, not in-memory, because 3 instances round-robin make per-instance limits 3× and non-deterministic. Alternative: dedicated small Redis instance to avoid blast radius. Recommend: use existing cluster but with distinct key prefix + separate DB index; ask about blast radius tolerance.

D: Token bucket, atomic Lua, single key per customer, allows the legitimate bursts while capping sustained rate; sliding window log is memory-heavy; fixed window has boundary doubling.

E: Config: per-customer overrides in a table (Postgres) read through a cached layer, defaults in env; ownership: support/account team edits the table, code owns defaults, no deploy needed to change a customer's limit. Alternative: env vars per tier (requires deploy), Redis hash (fast, but another store), hardcoded constants. Recommend Postgres table + cache TTL 30-60s, because limits change per customer and shouldn't need deploys. Note: if store is Redis and cache is fine.

F: 429 with JSON body {error:"rate_limited", retryAfterMs}, Retry-After header in seconds (HTTP spec requires integer seconds), plus X-RateLimit-Limit/Remaining/Reset headers always? Recommend: 429 + Retry-After + `X-RateLimit-*` on all POST /orders responses so integrations can self-throttle. Note current errors are plain text; consistency tradeoff.

G: Rollout: ship in observe-only mode first (compute + log would-be rejections, never reject), 24–48h, verify the 20 enterprise customers and the abuser's actual rates from logs, then enable enforcement per-instance canary (1 of 3), then all. Also notify enterprise customers. Recommend that.

Should I ask about whether the limiter should also protect Postgres/system-wide capacity (global limit) vs only per-customer fairness? That's a real design question: per-customer limits alone don't protect against aggregate overload from many customers; the incident was one customer, so per-customer suffices. Could ask now — independent. But maybe over-asking. I think it's a legitimate branch: "is the goal fairness (per-customer cap) or capacity protection (global concurrency cap)?" It determines whether we need a second mechanism. Include as a question? The plan says "one customer's script slowed every other customer" → fairness. I'll include it as Q1 maybe, merged with scope: "What is the limiter protecting: per-customer fairness only, or also global capacity?" That's genuinely root. Hmm, 8 questions. Keep it as part of Q1 (scope) to avoid bloat? It's a distinct decision with distinct consequences (global cap needs different keying/algo). I'd rather ask it separately and drop... no, keep 8. Grilling wants thoroughness. But each question should be crisp.

Let me consolidate: Q1 = objective/scope (per-customer fairness vs global capacity + which routes). Combining two decisions in one question is bad for "yes" answers. Make Q1 = protected surface (POST only, per-customer), Q2 = key, Q3 = store, Q4 = algorithm, Q5 = rejection contract, Q6 = config & ownership, Q7 = rollout. Seven. Global capacity can be a sub-clause... I'll add Q8: "Do we also need a global capacity cap?" Recommended: no in v1; per-customer only, because incident was a single customer. That's a real decision with risk if wrong.

Hmm, but is Q8 dependent on Q3/Q4? A global cap is just another key with the same store/algorithm. The decision "do we add one" doesn't depend on those. Fine, ask now.

That's 8 in one round. Reasonable for grilling. But the tool `ask` — questions become tabs with options. The skill says format the round with ❓ Q1 ... ➡️ recommendation in reply. The system prompt says: never write such questions in your reply, use ask; template describes order, not location. So I must put all questions into ask, and my reply can state findings + which round. So the round is delivered through `ask` with header "Q1 ...", options with recommended index.

Need 2–5 options per question, each with label + tradeoff, recommended index. Brief with where/what/how. Include evidence citations where code decisions turn on it. Evidence paths must be files in repo: src/server.ts lines 7-8 (header trust), PLAN lines 7-9, maybe src/orders.ts 10-13.

Keep briefs concise but concrete. 8 questions each with where/what/how/evidence/risks — that's a lot of tokens but fine.

Do I need `recommended` for all? For questions with a defensible pick, yes.

Let me write the ask call.

Q1 header "Q1 Protected surface".
question: "Which requests does the limiter count — only POST /orders, or every request carrying x-customer-id?"
options:
1. "POST /orders only, one bucket per customer" tradeoff: matches the expensive call and the incident; GET stays unlimited so dashboards/pollers never get 429. recommended.
2. "All routes, one bucket per customer" — simpler mental model, but cheap GET polling consumes the same budget as writes and will surprise integrations.
3. "Per-route buckets (POST and GET separate)" — precise, but needs key schema per route and doubles config surface for one real endpoint.
4. "POST /orders only, plus a separate high GET cap" — protects Postgres reads too; adds a second number nobody asked for.

Q2 header "Q2 Limit key".
Body: header is client-asserted; server.ts:7 only checks presence. Behind round-robin LB the client IP is the LB's unless XFF is trusted.
options:
1. "x-customer-id only" rec — correct fairness unit and the only thing enterprise tiers can key on; relies on auth upstream validating the header, so spoofing is an auth gap not a limiter gap.
2. "Client IP only" — unspoofable-ish, but NAT collapses offices, XFF trust must be configured, and enterprise tiers become impossible.
3. "Both: customer bucket + coarse IP bucket" — backstops header rotation; costs a second counter per request and can 429 legitimate NATed bursters.
4. "Customer id, with header rotation detected later" — hmm filler. Use 3 options max? 2-5 allowed. Add "x-customer-id + require signed/HMAC header" — that adds auth work outside plan scope. Good 4th option: "customer id, but first add header verification" — cost: blocks ship-this-week.

Q3 store: options Redis shared, Redis dedicated, in-memory, hybrid (memory + Redis periodically)? 
1. "Redis, existing cluster, dedicated key prefix + own DB index" rec.
2. "New dedicated Redis instance" — isolation, blast radius zero, but new infra this week.
3. "In-memory per instance" — no infra, but 3× limit and uneven enforcement across round-robin; only works as observe-only.
Note: key TTLs are small; memory is tiny.

Q4 algorithm:
1. Token bucket (atomic Lua, 2 fields per key) rec.
2. Sliding window counter (two fixed windows weighted) — smooth boundary, cheap, but Retry-After murky.
3. Fixed window — simplest, but allows 2× at boundary.
4. Sliding window log — exact, memory grows with limit (enterprise limits huge).

Q5 rejection contract:
1. "429 + Retry-After (integer seconds) + JSON {error, retryAfterMs} + X-RateLimit-* on all responses" rec.
2. "429 + Retry-After, plain text body matching current 401 style" — consistent with existing errors, less useful to integrations.
3. "429 JSON body only, no X-RateLimit headers" — minimal.
4. "503 instead of 429"? No. Better: "429 + Retry-After + JSON, no headers until enforcement phase" — hmm. Use 3.

Q6 config & ownership:
1. "Postgres table for per-customer overrides + env defaults, 30s cache" rec — no deploy to change a customer, audit trail.
2. "Env vars per tier" — simplest, needs deploy/restart per change.
3. "Redis hash" — fast, dynamic, but limits live in ephemeral store and get lost.
4. "Hardcoded constants, tiers only" — ship fastest, every enterprise change is a deploy.

Q7 rollout:
1. "Observe-only 24–48h → canary 1 instance → all 3, plus notify the 20 accounts" rec.
2. "Enforce on all 3 immediately with generous enterprise limits" — fastest protection, highest breakage risk.
3. "Per-customer opt-in enforcement" — safest for enterprises, but the abuser may be an enterprise too.
4. "Canary only, no observe phase".

Q8 global capacity:
1. "No global cap in v1; per-customer only" rec — incident was one customer; global cap needs a second mechanism and can fail the whole API.
2. "Add a global cap as a circuit breaker" — protects Postgres from many-customer aggregate load; risks mass 429s and needs its own tuning.
3. "Global cap only" — protects the DB but doesn't stop one customer starving others.

Also should I ask about burst allowance for enterprise (the tier numbers)? Depends on Q4/Q6 → later.

Also failure mode depends on Q3 → later. Redis namespace depends on Q3 → later.

Now write briefs. Keep concise. Add evidence for Q1 (PLAN 7-9), Q2 (server.ts 7-8), Q3 (PLAN 7), Q5 (server.ts 8 existing error style).

The system prompt says reply may say what I found and which round. I'll produce a short findings note in reply after ask returns? The ask returns answers, then I'd need to ask round 2... but the user must answer round 1 first; ask blocks and returns answers. So flow: call ask, get answers, then ask round 2, etc. Hmm — ask waits for the user's answers. So I call ask with round 1, it returns answers, then I produce round 2 etc. But the skill says state findings and round number in reply; the ask surface shows the questions.

Note: the user said "Do not implement the plan." Fine.

Let me make the call. Keep brief text tight.

One consideration: `recommended` index and "yes accepts".

Write it.
```

### ask call

```json
{"questions":[{"id":"surface","header":"Q1 Protected surface","question":"Which requests does the limiter count — only POST /orders, or every request carrying x-customer-id?","options":[{"label":"POST /orders only, one bucket per customer","tradeoff":"Targets the expensive write and the actual incident; GET stays unlimited so pollers and dashboards never see 429.","holds_when":"The overload risk is write amplification, as the incident suggests."},{"label":"All routes, one bucket per customer","tradeoff":"One number to reason about, but cheap GET polling spends the same budget as writes and will surprise integrations."},{"label":"Per-route buckets (separate POST and GET limits)","tradeoff":"Most precise, but doubles key space and config surface for a single real endpoint."},{"label":"POST /orders with a separate generous GET cap","tradeoff":"Also shields Postgres reads, at the cost of a second limit nobody has asked to tune."}],"recommended":0,"brief":{"where":"PLAN.md:9 says POST /orders writes to Postgres and is the expensive call; GET /orders is cheap. src/server.ts:10-16 routes exactly these two.","what":"The counting dimension decides the key schema, the config shape and what a 429 means to a client. Code cannot decide it: both routes share one customer header today, but only one is expensive.","how":"Pick one; it fixes the key schema and the numbers asked for in the next round.","evidence":[{"path":"PLAN.md","lines":"7-9","note":"Three instances, Redis availability, expensive POST vs cheap GET."},{"path":"src/server.ts","lines":"10-16","note":"Only two routes exist; both key off the same header."}],"risks":["Counting GET lets a polling integration burn the write budget.","Counting POST only leaves read amplification unaddressed."]}},{"id":"key","header":"Q2 Limit key","question":"Do we key the limit on x-customer-id alone, and do we accept that the header is currently client-asserted?","options":[{"label":"x-customer-id only","tradeoff":"Correct fairness unit and the only key enterprise tiers can hang off; assumes an auth layer upstream validates the header.","holds_when":"Something upstream (gateway or auth service) proves the header, so a customer cannot rotate it freely."},{"label":"Client IP only","tradeoff":"Harder to rotate, but NAT collapses whole offices, X-Forwarded-For trust must be configured, and per-customer tiers become impossible."},{"label":"Both: customer bucket plus a coarse IP bucket","tradeoff":"Backstops header rotation, at the cost of a second counter per request and false 429s for legitimately NATed bursters."},{"label":"Customer id plus real header verification first","tradeoff":"Closes the spoofing hole properly, but pulls auth work into a plan that is meant to ship this week."}],"recommended":0,"brief":{"where":"src/server.ts:7-8 only checks that x-customer-id is present; any string is accepted. There is no auth middleware, no gateway config and no package.json in the repo — I cannot verify from the tree whether something upstream validates the header.","what":"Every other decision (Redis key schema, tier overrides, 429 semantics) inherits this choice, and the choice is only sound if the header is trustworthy. The repo cannot answer that; you can.","how":"Confirm customer id alone; state in the answer whether an upstream auth layer signs or verifies the header. If neither exists, IP or header verification becomes a real branch and I will grill it next.","evidence":[{"path":"src/server.ts","lines":"7-8","note":"Presence check only — the header is a claim, not a credential."}],"risks":["A script rotating x-customer-id defeats a customer-keyed limiter entirely.","An IP-keyed limiter misfires on enterprise NAT and cannot support tiers."]}},{"id":"store","header":"Q3 Counter store","question":"Do counters live in Redis (the existing cluster, or a dedicated one) or in each instance's memory?","options":[{"label":"Redis, existing cluster, dedicated prefix and DB index","tradeoff":"One consistent limit across all 3 instances; reuses live infra. Costs coupling: sessions from another service share the cluster, so an eviction or outage hits both.","holds_when":"The sessions workload is small enough that limiter keys cannot push the cluster into eviction."},{"label":"Dedicated new Redis instance","tradeoff":"Zero blast radius and clean isolation; costs new infra and provisioning inside a one-week ship.","cost":"New instance, credentials, monitoring."},{"label":"In-memory per instance","tradeoff":"No infra and no failure mode, but round-robin gives each customer 3 independent buckets — the effective limit is 3x and enforcement is uneven.","holds_when":"Only as an observe-only phase, or as a coarse emergency fallback."}],"recommended":0,"brief":{"where":"PLAN.md:7 three instances behind a round-robin load balancer; PLAN.md:8 a Redis 7 cluster already used for sessions by another service. src/server.ts holds no shared state at all.","what":"Per-instance memory cannot enforce one limit across 3 round-robin instances: each request lands on a different counter. Redis fixes that but imports the sessions cluster's failure and eviction behaviour.","how":"Pick the store; it unblocks the failure-mode question (fail open or closed) and the namespace/eviction question in round 2.","evidence":[{"path":"PLAN.md","lines":"7-8","note":"Round-robin plus a shared Redis cluster."}],"risks":["Sharing the sessions cluster means limiter load can evict sessions.","Two services on one cluster need a namespace convention nobody owns yet."]}},{"id":"algorithm","header":"Q4 Algorithm","question":"Fixed window, sliding window, or token bucket — and does it have to tolerate legitimate bursts?","options":[{"label":"Token bucket, atomic Lua, one key per customer","tradeoff":"Caps sustained rate while allowing a burst up to bucket depth, which is exactly the enterprise shape; costs one Lua script and two fields per key.","holds_when":"Bursts are legitimate and sustained rate is the thing to cap."},{"label":"Sliding window counter (two weighted fixed windows)","tradeoff":"Smooths the boundary doubling of fixed windows at low cost, but Retry-After becomes fuzzy and burst tolerance is implicit.","cost":"Two counters per key, weighted read."},{"label":"Fixed window","tradeoff":"Simplest and cheapest to reason about, but a client can send 2x the limit across a window boundary.","holds_when":"Rough protection is enough and simplicity wins."},{"label":"Sliding window log","tradeoff":"Exact accounting, but memory grows with the limit — painful for enterprise limits in the thousands per minute.","cost":"One sorted set per customer."}],"recommended":0,"brief":{"where":"PLAN.md:10 about 20 enterprise customers have scripted integrations that legitimately burst. No limiter code exists yet; nothing constrains the choice.","what":"The algorithm fixes what the limit numbers mean (rate vs count per window), what Retry-After can honestly report, and how much Redis memory per customer. Those are compound decisions, not preferences.","how":"Pick the algorithm; the limit magnitudes and the Retry-After computation hang off it and move to round 2.","risks":["Fixed windows let a determined burster double the limit at boundaries.","A log-based window at enterprise limits is the memory hog in a cluster shared with sessions."]}},{"id":"rejection","header":"Q5 Rejection contract","question":"What exactly does a rejected client receive — status, headers, body?","options":[{"label":"429 + Retry-After (integer seconds) + JSON error body, plus X-RateLimit-* on every counted response","tradeoff":"Integrations can self-throttle before they are cut off; costs a small contract to document and keep stable.","holds_when":"Scripted enterprise clients can be asked to read headers."},{"label":"429 + Retry-After, plain-text body matching the current 401 style","tradeoff":"Consistent with src/server.ts:8 and the least new surface, but clients get no budget visibility and must guess.","cost":"One string, no schema."},{"label":"429 with JSON body only, no rate-limit headers","tradeoff":"Minimal and unversioned; clients learn nothing until they are already rejected."}],"recommended":0,"brief":{"where":"src/server.ts:8 answers a bad request with plain text and status 401; there is no JSON error envelope anywhere in the repo. No 429 exists yet.","what":"The response is the only part of the limiter that customers see. It also decides whether integrations can back off proactively or only after failures, which is the difference between a smooth rollout and a support queue.","how":"Pick the contract now; the exact Retry-After value depends on the algorithm chosen in Q4 and follows in round 2.","evidence":[{"path":"src/server.ts","lines":"8","note":"Existing error style is plain text, not JSON."}],"risks":["A precedent of plain-text errors means JSON 429s are a new inconsistency.","Header names become a public contract the moment they ship."]}},{"id":"config","header":"Q6 Limits and ownership","question":"Where do default limits and per-customer overrides live, and who is allowed to change them?","options":[{"label":"Postgres table for overrides, env defaults, short-TTL cache in each instance","tradeoff":"Changing one enterprise customer needs no deploy and leaves an audit trail; costs a table, a cache and a TTL-lag window.","holds_when":"Limits will be tuned per customer, which the 20 bursting accounts imply."},{"label":"Env vars per tier","tradeoff":"Simplest to ship and review, but every per-customer tweak is a deploy and a restart of 3 instances.","cost":"Three env values, redeploy per change."},{"label":"Redis hash alongside the counters","tradeoff":"Fast and dynamic, but limits then live in an ephemeral store and vanish on flush; ownership gets murky.","cost":"No migration, no audit trail."},{"label":"Hardcoded constants with a tier map","tradeoff":"Fastest possible ship; every enterprise adjustment is a code change and a release."}],"recommended":0,"brief":{"where":"PLAN.md:18 asks how enterprise customers get higher limits and who owns those numbers. The repo has no config file, no migrations, no admin surface — only env access at src/db.ts:4.","what":"This decides who can raise a limit at 2am, whether a change needs a deploy, and whether the numbers are auditable. It also gates the rollout plan: grandfathering the 20 accounts is impossible without per-customer overrides.","how":"Pick the mechanism and name the owner. Round 2 then asks for the actual default and enterprise numbers and the cache TTL.","evidence":[{"path":"src/db.ts","lines":"4","note":"The only configuration mechanism in the repo is an env var for the DSN."}],"risks":["Env-only limits make the first enterprise complaint a 20-minute deploy.","A Redis-hosted config with no audit trail makes limit disputes unanswerable."]}},{"id":"rollout","header":"Q7 Rollout","question":"Do we ship in observe-only mode first, and how do the 20 bursting integrations get through the switch?","options":[{"label":"Observe-only for 24–48h, then canary on 1 instance, then all 3; notify the 20 accounts beforehand","tradeoff":"Logs give real per-customer rates to set numbers from, and a canary contains a bad limit; costs two extra days against a this-week ship.","holds_when":"You do not already have per-customer request-rate data."},{"label":"Enforce on all 3 immediately with generous enterprise limits","tradeoff":"Protection today, but the first numbers are guesses and every false positive is an enterprise incident.","cost":"No extra phase."},{"label":"Per-customer opt-in enforcement","tradeoff":"Enterprises only get limited when they agree; costs the ability to stop an abusive enterprise at all."},{"label":"Canary only, no observe phase","tradeoff":"Half the safety for none of the delay; the numbers are still guesses but only one instance enforces them."}],"recommended":0,"brief":{"where":"Nothing in the repo records traffic rates, and PLAN.md:10 says 20 enterprise customers burst legitimately. The abuser's 40,000 orders in ten minutes is the only number in the plan.","what":"The plan says ship this week and also says do not break enterprise integrations; those pull in opposite directions unless enforcement is staged. Observe-only is also the only cheap way to get the real rate distribution.","how":"Pick the staging. It determines what the observe phase must log and whether round 2 needs a data-collection question at all.","risks":["Shipping straight to enforcement turns a guess into an outage for a paying customer.","An observe-only phase that logs nothing usable just costs two days."]}},{"id":"capacity","header":"Q8 Global capacity","question":"Is this limiter for per-customer fairness only, or does it also need a global cap so aggregate load cannot sink Postgres?","options":[{"label":"Per-customer only in v1","tradeoff":"Matches the incident (one script, other customers slowed) and keeps one mechanism; leaves the API exposed if many customers burst at once.","holds_when":"The observed failure mode is a single noisy customer."},{"label":"Add a global cap as a circuit breaker","tradeoff":"Protects Postgres from aggregate load, but a global cap fails everyone at once and needs its own tuning and its own owner."},{"label":"Global cap only","tradeoff":"Protects the database but does nothing to stop one customer starving the other 19 — the problem in the plan."}],"recommended":0,"brief":{"where":"PLAN.md:3 the incident is one customer's script at 40,000 orders in ten minutes slowing every other customer. PLAN.md:9 identifies Postgres writes as the expense.","what":"Per-customer fairness and system capacity are different mechanisms with different failure semantics. Adding a global cap is a second project with its own numbers.","how":"Answer now; a yes adds a whole branch (global key, tuning, what customers see when it trips) to later rounds.","risks":["A per-customer-only limiter still lets 20 simultaneous bursts saturate Postgres.","A global cap turns one customer's abuse into an outage for everyone."]}}]}
```

### ask result

```text
User answers:
surface: POST /orders only, one bucket per customer
key: x-customer-id only
store: Redis, existing cluster, dedicated prefix and DB index
algorithm: Token bucket, atomic Lua, one key per customer
rejection: 429 + Retry-After (integer seconds) + JSON error body, plus X-RateLimit-* on every counted response
config: Postgres table for overrides, env defaults, short-TTL cache in each instance
rollout: Observe-only for 24–48h, then canary on 1 instance, then all 3; notify the 20 accounts beforehand
capacity: Per-customer only in v1
```

### Model reasoning

```text
Round 1 settled. Now recompute the frontier: what's now unblocked?

Settled: POST /orders only, per-customer token bucket; key x-customer-id; Redis shared cluster + dedicated prefix and DB index; token bucket Lua; 429 + Retry-After int seconds + JSON body + X-RateLimit-*; Postgres override table + env defaults + short TTL cache; observe→canary→all; no global cap.

New frontier (depend on these):

1. Actual numbers: default limit (rate per minute, burst depth) and enterprise values. Depends on algorithm (settled) and key (settled) and rollout observe phase (needs starting numbers to log). But wait: the observe phase could compute with placeholder numbers. Still, numbers decision is now on the frontier. But do numbers need traffic data? The plan has one number: 40k orders/10min = 4000/min for the abuser. Default for normal customers unknown. Ask: what default rate/burst, and how derived (measure vs guess). Recommendation: default 60 orders/min, burst 30; enterprise 600/min burst 300; revisit from observe logs. That's a concrete recommendation. Maybe ask "should the observe phase ship placeholder numbers you'll replace after 48h, or derive from existing Postgres/log data first?" That's a legit branch: is there historical traffic data available (fact: DB has orders table → can query per-customer timestamps! orders table has no timestamps in the interface — id, customerId, amountCents, status. So no created_at → cannot derive history from orders. That's a fact worth noting: the orders table exposes no timestamp, so historical rates cannot be derived from it; logs would be the source. This makes the observe phase essential. Good evidence: src/orders.ts:3-8.)

So Q: default numbers + enterprise numbers + how derived.

2. Redis failure mode: fail-open vs fail-closed. Now unblocked (store settled). Also: what counts as failure — timeout budget (ms), which errors (connection refused, timeout, eviction)? Add sub-decision: per-request Redis timeout. Recommend fail-open for POST? Tradeoff: fail-open lets the abuser through when Redis is down; fail-closed rejects paying customers. Recommended: fail-open with a bounded local emergency limiter? That's a compound. In v1: fail-open, log, alert. With token bucket Lua: if Redis errors, allow. Alternative: fail-closed 503. Ask.

3. Eviction / namespace in shared cluster: dedicated DB index + prefix settled, but still need: maxmemory policy requirement, key TTL, and whether limiter keys count against sessions eviction. Actually "dedicated DB index" chosen, so now the question is: do we require the Redis cluster's maxmemory-policy to be noeviction/volatile-* and who changes it; and TTL for bucket keys (idle expiry). This is a fact+decision. Recommend: keys get TTL = burst/rate (time to refill) + margin, 1h idle expiry; require `volatile-lru` or `noeviction`... Careful: sessions service owns the cluster. The decision: who owns the cluster config change and is it in scope this week? Recommend: no cluster config change; rely on TTL and small footprint; escalate only if memory pressure observed. Hmm, that's genuinely a decision.

4. Config cache specifics: TTL duration, and behavior when Postgres override lookup fails or the table row is missing (fall back to env default). Also: negative caching, and whether override lookup is on the request path (adds Postgres latency to every POST) — recommend 60s in-memory cache with stale-on-error, default fallback. Also who owns editing (support vs on-call) — partially answered? Q6 said "who is allowed to change them" in the question body but the chosen option doesn't specify the owner. Need a follow-up: owner + audit (who writes the table, is there an admin UI or psql). That's a real unresolved decision.

5. Retry-After computation: with token bucket, Retry-After = time until one token (or until enough for the request) = ceil((1 - tokens)/rate). Also X-RateLimit-Reset semantics (epoch seconds? ms until full?). Depends on algorithm (settled). Also: should Retry-After be clamped/min 1s. This is now frontier. Recommend: ceil((1-tokens)/rate) seconds, min 1; Reset = epoch seconds when bucket is full; Remaining = floor(tokens).

6. Observe-only implementation semantics: what gets logged (customer id, would-be 429, tokens remaining, rate config version), where (stdout JSON / metrics), retention, and how the 48h review decides numbers. Also: does observe mode set X-RateLimit-* headers? Recommend no headers in observe mode (don't publish a contract you may change) or yes? I'd say emit headers only in canary/enforce. Also rollout: canary kill switch mechanism (env var? config row?).

7. Notification to the 20 enterprise accounts: who sends it, what it says (expected limits, headers, 429 behavior, contact), and deadline before enforcement. Also grandfathering: does the abuser get a limit too (yes, everyone limited).

8. Does the limiter apply before or after body parse / before DB write? Ordering: check rate limit before `await req.json()` (cheap rejection, avoids parsing cost). Depends on nothing now. Also: 401-first (missing header) then limiter. That's an implementation ordering decision — arguably a decision worth confirming: limit check before JSON parse and before DB. Recommend yes. Maybe fold into failure-mode/ordering question.

9. Testing/verification: what proves it works before canary — concurrency test hitting 429 with exact counts, Redis-down test, Lua atomicity under parallel load. No test infra exists (no package.json). Decision: is writing a test harness in scope this week, or a throwaway script? This is a real decision given repo has no test setup. Recommend throwaway Bun script + one permanent test of the Lua boundary.

10. Key encoding: customer id raw in Redis key (untrusted string, could contain braces/colons, huge) → prefix `rl:orders:{sha256(customerId)}` or hash tag. Depends on key settled. Recommend hash tag `rl:orders:{<hash>}` to keep cluster slot stable. Also Redis Cluster: Lua script touching one key is fine.

11. Enterprise identification: is "enterprise" a flag in the override table, i.e., tier = row presence? Yes, that's the override table. But sub-decision: what about customers with no row — env default; and do we need a "tier" column vs per-customer explicit numbers? Recommend explicit rate+burst columns per row, no tier enum (simpler, no code change for a new tier).

12. 429 on missing header vs limiter: already 401 before limiter — fine.

13. Burst semantics: allow burst up to N tokens but also cap per-second? token bucket naturally.

14. What about the abuser identified? Do we block them specifically now (manual) while limiter ships? Decision: emergency mitigation before ship — e.g., block that customer id at LB. Worth asking: is there an immediate stopgap, or is 3 days of observe-mode acceptable while the abuse continues? Big one! The plan says ship this week, observe 24-48h. Meanwhile the abuser keeps going. Recommend: ask whether a temporary manual block/limit for the offending customer is applied now. This depends on rollout (settled). Good question.

Frontier round 2 could be large; need to avoid asking things that depend on other open questions. Let's check dependencies among candidates:

- Numbers (default/enterprise) depends on: observe data? Rollout settled. Independent. Ask.
- Emergency stopgap: independent. Ask.
- Fail-open/closed: independent now. Ask.
- Redis key encoding/TTL/eviction policy: independent. Ask (maybe combine key encoding + TTL into one? They're separate decisions; keep two or combine as "Redis key hygiene": prefix, hash tag, TTL, maxmemory policy). Combining into one question with options is awkward. I'll ask: (a) key encoding/hash tag, (b) TTL & eviction stance. Hmm, maybe combine into one "Redis key layout and lifetime" question with compound options — risky for clean yes. I'd rather ask TTL/eviction as one and hash-tag-only as another. Total question count is growing.

Priority: keep round 2 to ~8 focused questions where each is a genuine fork.

Round 2 candidate list (8):
Q1 Emergency stopgap before enforcement.
Q2 Default + enterprise numbers (and derivation).
Q3 Store failure behavior (fail-open/closed, timeout budget, error classes).
Q4 Redis key layout & lifetime (hash tag, TTL, maxmemory policy, cluster slot).
Q5 Retry-After / X-RateLimit semantics (exact values, reset meaning, min 1s, headers in observe mode?). Hmm headers-in-observe depends on rollout (settled) → can include here? It's a distinct decision but related to the contract. I'll fold "headers only from canary onward" into Q5 options? Better: separate small question "do observe-mode responses carry X-RateLimit headers?" Actually that's a rollout-detail decision, independent. Could be Q6.
Q6 Config cache details: TTL, stale-on-error, fallback, and owner/audit path (who edits, psql vs admin endpoint).
Q7 Observe-mode instrumentation: what to log, where, retention, decision rule for numbers, kill switch.
Q8 Verification scope: test harness (permanent test vs throwaway), and what must be proven (exact 429 counts, atomicity, Redis-down path, header math).
Q9 Enterprise comms content/deadline/who sends.

That's 9. Frontier is legitimately this wide. But some are downstream of Q2 (numbers) or Q4? Q7 log fields depend on nothing open. Q8 depends on nothing open. Q9 depends on numbers (need to tell customers their limits) — depends on Q2 open → later round. Good catch: enterprise comms carries the numbers, so it goes to round 3.

Q5 Retry-After semantics depends on algorithm (settled) and headers on contract (settled). Independent. Include.
Q6 config owner: depends on nothing open (table settled). Include.
Q7 observe instrumentation: depends on rollout (settled) and numbers question? The log fields don't depend on numbers; the decision rule does. Keep the "what to log + kill switch" part now, and the "how we choose final numbers" is Q2. Slight overlap: Q2 asks numbers and derivation; Q7 asks instrumentation. Fine, distinct.

Also: does rate limit check happen before JSON parse and DB? Implementation ordering — is that a "decision"? It's a design decision but almost forced (before parse). I'd add as a small question? Might be filler. I'll fold into Q3? No. Skip; state as an assumption later? The skill says nothing left silently assumed. Hmm — ordering matters for what a 429 costs. I could add as Q8 and move verification to Q9... Let's see: I can add "placement of the check in the request path" as a question with options: before body parse (recommended), after parse before DB, inside orders.createOrder. It's a legit fork and cheap to answer. But 10 questions per round is heavy. Grilling is supposed to be relentless; the ask surface handles tabs. I'll include it — it has a real consequence (invalid JSON costs parse; 429 vs 400 precedence).

Hmm, but is it dependent on anything? No.

Also worth asking: what happens to requests that lack x-customer-id (already 401) — settled by existing code.

Also: enterprise overrides — does the table key on customerId only, or customerId+tier with defaults? Covered in Q2/Q6? Let me make Q2 include "override row schema: explicit rate+burst vs tier enum" — that's a schema decision, distinct from numbers. Could combine: "How are limits expressed and where do the numbers come from?" Options: (a) explicit rate+burst per row with env defaults, numbers picked from the 4000/min evidence and tuned after observe; (b) tier enum with env values; etc. That mixes two axes. Better: Q2 numbers only; Q6 config includes schema & owner. Q6 becomes big. Alternatively split: Q6a config schema/ownership, Q6b cache behavior. Ugh.

Let me settle on 9 questions, each single-axis:

Q1 Stopgap before enforcement (independent).
Q2 Numbers: default and enterprise values + derivation.
Q3 Redis failure behavior (fail-open/closed + timeout).
Q4 Key layout (hash-tagged hashed customer id; prefix; DB index already chosen → cluster slot concern) + TTL. Combine as "Redis key layout and lifetime" with options bundling both? Options: (a) `rl:orders:{sha256(id)}` with TTL = full-refill time (rec), (b) raw customer id as key, (c) hash tag + TTL 24h, (d) sorted-set log... no. I'll frame options as key-safety choices and include TTL in briefs/how. Hmm, better to make Q4 = key encoding, Q5 = TTL + maxmemory stance. That's 10 questions. 

Maybe drop Q4 key encoding? No — raw untrusted header in a Redis key is a real bug class (spaces, huge values, cluster slot pinning). It's worth its own question. But could be answered as a forced engineering detail... The skill: decisions are the user's; but key encoding is an engineering detail I could decide. However grilling = no silent assumptions. I'll include it but make it a quick one.

Let me cap at 9 by merging TTL+eviction into Q4 (key layout & lifetime) with clear options:
(a) hashed key with hash tag `rl:orders:{sha256}` + TTL = refill time + 1h, no cluster config change (rec)
(b) raw customer id + TTL 24h
(c) hashed key + no TTL, manual cleanup
Hmm the options mix axes but each is a coherent package. Acceptable? It's a bundle; user says yes to package. I think it's OK but muddy. Alternative: Q4 = "Redis key: hash the untrusted id?" with 3 options; TTL/eviction ride in options. Fine.

Q5 Retry-After/X-RateLimit exact semantics.
Q6 Config schema + owner + audit path.
Q7 Config cache behavior (TTL, stale-on-error, missing row).
Q8 Observe-mode logging + kill switch + header emission in observe.
Q9 Check placement in request path.
Q10 Verification scope.

10 questions. Too many? The frontier really is wide. But I can drop Q7 (cache behavior) — cache TTL was part of the settled option "short-TTL cache"; the specific TTL is an engineering parameter, not a user decision. Missing-row/fallback is also mostly forced. I'll drop Q7 and note assumptions in the brief of Q6? No — silently assuming violates. Hmm. Missing-row → env default is obvious and implied by "env defaults". Stale-on-error → depends on failure stance Q3. So Q7 depends on Q3! Good: later round. Drop from round 2, return in round 3.

Q9 check placement: keep, it's cheap.
Q10 verification: keep.

So round 2 = 9 questions: stopgap, numbers, failure mode, key layout, response header math, config schema/owner, observe instrumentation/kill switch, check placement, verification.

Hmm Q5 (header math) vs Q3? Independent? Retry-After = (1-tokens)/rate; independent of fail-open. Yes.

Is Q5 too fine-grained? It defines a public contract; keep.

Now recommendations for each:

Q1 Stopgap: recommend yes — immediately block/throttle the offending customer id at the load balancer (or temporarily with a 10/min cap once canary is up), because observe-only leaves the abuser running for up to 72h. Options: LB rule now (rec); ship observe and nothing else; emergency deploy of limiter in enforce mode for one customer (config row).

Q2 Numbers: evidence: 4000 orders/min abuser. Default: what's plausible? Unknown. Recommend: default 120 orders/min sustained, burst 60; enterprise 1200/min, burst 600; explicitly provisional, replaced after observe. Ask about enterprise count 20 → 20*1200 = 24000/min aggregate, vs abuser 4000/min. Fine. Options: (a) provisional defaults 120/60, enterprise 1200/600, re-tune after observe (rec); (b) derive from nothing, start generous: default 600/min, enterprise 6000/min, first breach is the signal; (c) block only the outlier in v1: default effectively unlimited, cap only at 4000/min... that's not a limit. (c) default 60/min burst 20, enterprise 300/min — conservative protect-DB. Add (d) ask for customer traffic percentiles first (needs data we don't have). Include 3 options + maybe "use the plan's own number: cap everyone at 4000/min".

Q3 Failure: (a) fail-open + log + alert, 20ms timeout, only on connection/timeout errors (rec); (b) fail-closed 429/503 — protects DB, but a Redis blip becomes a full outage; (c) per-instance in-memory fallback bucket during outage — degrades to 3x limits but keeps protection; complexity. Rec: (a)? Hmm. For an orders API where Redis down would otherwise take down ordering — fail-open is standard. But the sessions service shares the cluster, so correlated failures likely. Rec (a) with alert. Note: fail-closed would turn Redis maintenance into order outage.

Q4 Key layout: (a) `rl:orders:{sha256(customerId)}`, TTL = bucket-refill time (burst/rate) + 1h grace, no cluster reconfiguration (rec); (b) raw header value in key, TTL 24h — simpler to inspect, but untrusted input into key space and unbounded length; (c) hash tag + no TTL, rely on maxmemory — risks unbounded growth. Also mention hash tag braces to keep script in one slot.

Q5 Header math: (a) Retry-After = ceil(max(0, (1 - tokens)) / rate) seconds clamped to ≥1, Remaining = floor(tokens), Limit = burst, Reset = epoch seconds at full refill (rec); (b) Retry-After always 1s (useless-ish); (c) Reset = ms until next token. Recommend (a).

Q6 Config schema/owner: (a) table `customer_rate_limits(customer_id pk, rate_per_min, burst, updated_by, updated_at, note)`; no tier enum; support/on-call edit via SQL with review; code owns env defaults (rec); (b) tier enum column + env per tier; (c) admin HTTP endpoint in server.ts; (d) values in Postgres but owned by account managers with a UI (out of scope). Recommended (a).

Q7 Observe instrumentation/kill switch: (a) structured JSON log line per would-be rejection with customerId hash, tokens, configured rate/burst, config source (default|override), plus counters; no X-RateLimit headers during observe; kill switch = env var `RATE_LIMIT_MODE=observe|enforce` per instance (rec); (b) emit headers during observe too so integrations can adapt early; (c) log every POST (verbose) instead of only near-limit. Hmm the "log every POST" is actually needed to compute rates! To tune numbers, you need the distribution of per-customer rates, not just would-be rejections at the provisional threshold. Better: record per-customer request counts per minute (the limiter already computes them) — log a periodic snapshot. So the recommendation should include rate snapshot logging. Let me structure Q7 as "what does the observe phase record, and how is it switched off?" options: (a) per-minute would-be-rejection log + hourly per-customer rate snapshot + env mode flag (rec); (b) only would-be 429s; (c) full request log with body size/timing.

Hmm, does (a)'s "per-minute rate snapshot" depend on numbers? No.

Q8 Check placement: (a) in fetch() before `await req.json()`, after the 401 check (rec); (b) after JSON parse/validation; (c) inside createOrder. Recommend (a) — a 429 must not cost a body parse or a DB round trip.

Q9 Verification: (a) throwaway Bun script hammering a local instance + one permanent test on the Lua boundary (exact 429 counts, atomicity under parallel requests, Redis-down path), plus a manual canary checklist (rec); (b) full test suite (no test infra exists; adds a package.json/test runner); (c) manual curl only. Recommended (a). Note fact: no package.json, no test files in repo.

Now, does Q9 depend on anything open? Q8? Not really. Q3 (Redis-down path) is open — so "Redis-down test" depends on Q3's decision but the test-scope decision itself doesn't. Fine, phrase generally.

Let me now write the ask call with 9 questions. Keep briefs tighter this time. Each needs where/what/how + evidence + 2-5 options.

Evidence paths: PLAN.md lines 3,10; src/server.ts 5-13; src/orders.ts 3-8; src/db.ts 4.

I should also mention in reply the finding: orders table has no timestamp → no historical rate data in DB, so observe phase is the only source. Good.

Write it.
```

### Model reply

Round 1 settled the four roots: surface, key, store, algorithm. That unblocks nine downstream decisions.

One fact that changed the shape: `Order` (`src/orders.ts:3-8`) carries no timestamp, so per-customer historical rates cannot be recovered from Postgres — the observe phase is the only source of real numbers. Everything about values is therefore provisional.

### ask call

```json
{"questions":[{"brief":{"evidence":[{"lines":"3","note":"The abuse is live and ongoing; observe-only leaves it running.","path":"PLAN.md"},{"lines":"10-11","note":"Bursting integrations and the debatable abuse pattern."}],"how":"A yes means the limiter's first deploy is not the first mitigation; the plan gains a step 0.","risks":["A manual LB block becomes permanent folklore nobody removes.","Blocking the wrong identity (shared NAT or a reseller) repeats the incident in reverse."],"what":"Whatever we ship, enforcement begins at least 24h after deploy. The decision is whether there is a stopgap now, and whether it can be removed.","where":"Rollout is observe 24–48h, then canary, then all 3. The abuser created 40,000 orders in ten minutes last week and nothing in the repo blocks it."},"header":"Q1 Stopgap","id":"stopgap","options":[{"label":"Block that customer id at the load balancer now, with a ticket to remove it once enforcement lands","tradeoff":"Stops the bleeding during observe without a deploy; costs an out-of-band rule nobody will find later unless it is ticketed.","holds_when":"The offending identity is known and is a paying customer you are willing to tell."},{"label":"Nothing until enforcement; accept 24–48h more of the abuse","tradeoff":"No out-of-band steps to undo, but the incident the plan exists to stop continues for three more days."},{"label":"Emergency enforce-mode deploy scoped to that one customer id","tradeoff":"Uses the real mechanism, so it is removed by the same config, but it ships enforcement code before observe has run."}],"question":"Do we apply a manual stopgap to the offending customer now, rather than waiting 24–48h for observe mode to finish?","recommended":0},{"brief":{"evidence":[{"lines":"10","note":"Twenty accounts legitimately burst; their real rates are unknown.","path":"PLAN.md"},{"lines":"3","note":"40,000 orders in ten minutes = ~4,000/min, the only measured rate.","path":"PLAN.md"},{"lines":"3-8","note":"No timestamp field, so history cannot be reconstructed from the orders table.","path":"src/orders.ts"}],"how":"The chosen values become the env defaults and the credential numbers in the customer notice. Q2 in the previous round fixed the override table, so a wrong enterprise number is editable, not a redeploy.","risks":["Too low: the canary 429s a paying integration on day one.","Too high: the abuser's 4,000/min fits comfortably and nothing changes.","Provisional numbers demoted to permanent because nobody owns the review."],"what":"A token bucket needs a sustained rate and a burst depth per tier. Nothing in the repo gives a normal customer's rate; the only measured point is the abuser at ~4,000/min.","where":"Token bucket per customer, overrides in Postgres, env defaults. No traffic data exists in the repo or the orders schema."},"header":"Q2 Numbers","id":"numbers","options":[{"description":"120/min sustained, burst 60; enterprise 1,200/min, burst 600.","label":"Provisional: default 120/min with burst 60, enterprise 1,200/min with burst 600, explicitly re-tuned after observe","tradeoff":"Caps the abuser at a third of their observed rate while leaving headroom for scripted writes; costs a stated commitment to revisit within a week.","holds_when":"Order writes are human- or workflow-paced, not batch-paced."},{"description":"600/min default, 6,000/min enterprise.","label":"Generous: default 600/min with burst 300, enterprise 6,000/min with burst 3,000","tradeoff":"Almost nobody notices on day one and the abuser is only half-throttled; the 40k/10min pattern would still pass at enterprise tier."},{"description":"60/min default, 300/min enterprise.","label":"Conservative: default 60/min with burst 20, enterprise 300/min with burst 100","tradeoff":"Strong database protection, but batch reconciliation scripts that write orders will break and you will hear about it."},{"label":"Pick only after the observe phase, starting from a deliberately high sentinel","tradeoff":"No guessing in production, but the first 48h protect nothing and the sentinel itself is a number you are guessing."}],"question":"Do we ship provisional numbers now — 120 orders/min sustained with burst 60, and 1,200/min with burst 600 for the 20 enterprise accounts — and re-tune from observe data?","recommended":0},{"brief":{"evidence":[{"lines":"8","note":"The cluster is shared with sessions owned by another service.","path":"PLAN.md"},{"lines":"10-16","note":"Every POST reaches Postgres synchronously; there is no queue or fallback path.","path":"src/server.ts"}],"how":"The answer sets the limiter's error path and the alert that must exist before canary. Stale-on-error config caching returns in a later round, because it must match this stance.","risks":["Fail-open: Redis maintenance night becomes an unbounded order flood.","Fail-closed: a shared-cluster blip stops every customer's ordering, worse than the original incident.","Silent fail-open with no alert is the worst of both."],"what":"The shared cluster is the likely correlated-failure point: if sessions are evicted or Redis restarts, the limiter sees the same outage. The choice decides whether that outage becomes an order outage.","where":"Counters in the sessions Redis cluster. src/server.ts has no error handling for infrastructure failures at all."},"header":"Q3 Store failure","id":"failmode","options":[{"label":"Fail open: allow the request, log and alert, 20ms timeout budget","tradeoff":"Redis trouble never becomes an order outage; during the outage the abuser is unlimited, which is exactly today's status quo.","holds_when":"Availability of ordering outranks enforcement during an infrastructure fault."},{"label":"Fail closed: reject with 429 (or 503) when the store cannot answer","tradeoff":"Never loses protection, but a Redis blip or a maxmemory eviction incident becomes a total API outage for all 20 customers."},{"label":"Fail open with a per-instance in-memory bucket as emergency protection","tradeoff":"Keeps rough protection during the outage at 3x the intended limit; costs a second code path and a second set of numbers to reason about."}],"question":"When Redis is unreachable or times out, do requests through — fail open with a log and alert — or get rejected?","recommended":0},{"brief":{"evidence":[{"lines":"7-8","note":"The customer id is an unvalidated, unbounded request header.","path":"src/server.ts"}],"how":"This fixes the exact key format the Lua script and the ops runbook use; TTL is derived from burst/rate, so it follows Q2.","risks":["Raw header values let a client pin a hot slot or poison the key space.","Keys with no TTL accumulate and become the eviction pressure that hits sessions."],"what":"The header is untrusted and unbounded, and Redis Cluster distributes by slot. The key format and lifetime decide both blast radius and whether stale buckets leak memory into the shared cluster.","where":"Redis Cluster with a dedicated prefix and DB index. The customer id arrives as an arbitrary string from the client."},"header":"Q4 Key layout","id":"keyformat","options":[{"label":"Hash the id into a hash-tagged key: rl:orders:{sha256(customerId)}, TTL = full-refill time plus one hour","tradeoff":"Bounded, slot-stable, and self-cleaning; costs debuggability — an ops engineer cannot read the customer id from the key.","holds_when":"The id is untrusted or long, which it is."},{"label":"Raw customer id as the key with a 24h TTL","tradeoff":"Trivially inspectable with redis-cli; exposes unbounded key length and lets a crafted id land wherever the client likes."},{"label":"Hash the id but let keys live until maxmemory evicts them","tradeoff":"No TTL bookkeeping; guarantees the limiter contributes to the eviction pressure that could kill sessions."}],"question":"Do we key on the hashed customer id inside a Redis hash tag with a TTL derived from the bucket's refill time, rather than storing the raw header?","recommended":0},{"brief":{"evidence":[{"lines":"8","note":"Existing error responses are plain text with no headers; the new headers are a fresh contract.","path":"src/server.ts"}],"how":"This fixes the exact header semantics the integration docs and the notify-20 email will state. The notify email itself waits for the numbers.","risks":["Reset meaning epoch-ms vs seconds is the classic integration bug.","Retry-After 0 or missing invites immediate retry storms."],"what":"The contract said 429 + Retry-After + X-RateLimit-*. Their exact values are still open, and a token bucket has no natural window boundary to point at, so Reset needs a defined meaning.","where":"Token bucket emits tokens at rate/60 per second up to burst. The rejection contract is settled but its numbers are not."},"header":"Q5 Header math","id":"headers","options":[{"label":"Retry-After = ceil((1 - tokens) / rate) clamped to at least 1s; Remaining = floor(tokens); Limit = burst; Reset = epoch seconds when the bucket would be full","tradeoff":"Honest and immediately actionable; costs a definition someone must keep stable forever.","holds_when":"Clients can read headers and retry on their own schedule."},{"label":"Retry-After always 1s, Remaining only, no Reset","tradeoff":"Trivial to implement and impossible to get wrong; clients retry too early and generate avoidable 429s."},{"label":"Retry-After in milliseconds as a custom header, standard header omitted","tradeoff":"Precise for scripted clients; violates the HTTP contract and forces every integration to special-case it."}],"question":"Do we define Retry-After as time until one token is available (integer seconds, minimum 1), with Reset meaning the epoch second the bucket is full?","recommended":0},{"brief":{"evidence":[{"lines":"4","note":"Only env-based config exists today, owned by deployers.","path":"src/db.ts"},{"lines":"7-8","note":"The customer id is a free-form string, so the override table's key is not a constrained id space.","path":"src/server.ts"}],"how":"This fixes the table columns and the operational runbook: who runs the UPDATE, and where the audit lives. The actual numbers were settled separately.","risks":["No updated_by column means the first limit dispute has no answer.","A tier enum makes every new commercial arrangement a code change.","An in-app admin endpoint is a new authenticated surface to secure this week."],"what":"An override table needs a schema and an owner. Support changing limits by hand in psql and an account manager editing them through a UI are very different products, with different audit and security needs.","where":"Postgres override table plus env defaults, cached in each instance. No admin surface and no audit convention exist in the repo."},"header":"Q6 Config schema","id":"configschema","options":[{"label":"Columns customer_id (pk), rate_per_min, burst, updated_by, updated_at, note; no tier enum; support edits via SQL; defaults in env","tradeoff":"One row per exception, fully audited, no new endpoint; costs the editor needing database access and SQL.","holds_when":"Limit changes are a handful per week, which 20 enterprise accounts implies."},{"label":"Tier enum column (standard, enterprise, custom) with the numbers held in env per tier","tradeoff":"Fewer moving numbers to reason about; every bespoke commercial arrangement becomes a code change."},{"label":"Same table, but managed through an authenticated admin HTTP endpoint in this service","tradeoff":"No database access needed to change a limit; adds an auth surface and a second API to a service meant to ship this week."},{"label":"Table only, written by account managers through an existing internal tool","tradeoff":"Cleanest ownership; depends on a tool I cannot see in this repo and may not exist."}],"question":"Do we use an explicit per-customer override table with audit columns and no tier enum, edited by support via SQL, while env owns the defaults?","recommended":0},{"brief":{"evidence":[{"lines":"5-13","note":"The handler is the only place a limit check can sit today.","path":"src/server.ts"},{"lines":"3-8","note":"Order rows carry no timestamp, so rates cannot be reconstructed from the database afterwards.","path":"src/orders.ts"}],"how":"The answer defines the log schema the review depends on and the mechanism that ends enforcement instantly if the canary goes wrong.","risks":["Only logging would-be 429s tells you nothing about how close normal customers sit to the limit.","Emitted headers during observe become a contract before the numbers are final.","A kill switch that needs a redeploy is not a kill switch."],"what":"Tuning requires the per-customer rate distribution, which the limiter can compute but must be told to record. And there must be a switch that ends enforcement without a deploy.","where":"Enforcement is staged observe → canary → all. There is no logging, metrics or feature-flag convention in the repo; src/server.ts logs nothing."},"header":"Q7 Observe mode","id":"observe","options":[{"label":"Per-minute per-customer rate snapshot for all POSTs, plus a would-be-429 line; no X-RateLimit headers during observe; env RATE_LIMIT_MODE=observe|enforce per instance","tradeoff":"Gives the distribution needed to set numbers and a deploy-free kill switch; costs structured logging code and log volume from 20 customers.","holds_when":"You want numbers grounded in real traffic rather than guesses."},{"label":"Log only would-be rejections at the provisional thresholds, and emit X-RateLimit headers immediately","tradeoff":"Small and lets integrations adapt early; reveals nothing about customers below the line and publishes a contract you may still change."},{"label":"Full request log with timing and body size, plus a Postgres-backed mode flag","tradeoff":"Richest data for later capacity work; heavy volume and ties the kill switch to the database that the incident is stressing."}],"question":"Does the observe phase record a per-minute per-customer rate snapshot plus would-be rejections, withhold X-RateLimit headers until enforcement, and use an env-var mode switch as the kill switch?","recommended":0},{"brief":{"evidence":[{"lines":"5-13","note":"Order of operations today: header check, then body parse, then the write.","path":"src/server.ts"},{"lines":"10-13","note":"The write is the expensive, serializing step worth protecting.","path":"src/orders.ts"}],"how":"This fixes where the Lua call sits relative to parsing and the database, and therefore what a 429 costs and which error wins when both apply.","risks":["Checking after the parse means a flood still burns CPU and memory on JSON.","Checking inside createOrder makes the limiter invisible to callers and untestable in isolation."],"what":"A section check costs nothing, a JSON parse costs memory, and a Postgres write costs the thing the plan exists to protect. The position also decides 429-vs-400 precedence for malformed bodies.","where":"src/server.ts:5-13 handles a POST by reading the header, awaiting req.json(), then writing to Postgres."},"header":"Q8 Check placement","id":"placement","options":[{"label":"In fetch(), after the missing-header 401 and before req.json()","tradeoff":"A rejected flood costs one Redis round trip and no parse or database work; the 429 wins over a malformed body, which is defensible since the client is over budget.","holds_when":"Parsing is the second-cheapest thing after the check, which it is."},{"label":"After parsing and validating the body","tradeoff":"Only well-formed requests are counted, so malformed spam is unlimited; costs CPU and memory per rejected request."},{"label":"Inside createOrder, before the insert","tradeoff":"Keeps the limiter with the protected resource and covers future callers; hides it from the HTTP layer and repeats the parse cost."}],"question":"Does the limiter run in the fetch handler before the body is parsed, so a 429 costs only one Redis round trip and malformed floods are rejected too?","recommended":0},{"brief":{"evidence":[{"lines":"1-18","note":"Single file, no test setup, no package.json in the repo root.","path":"src/server.ts"},{"lines":"4","note":"Configuration already flows through process.env, so a test instance is easy to point at.","path":"src/db.ts"}],"how":"This sets how much verification exists before the canary and whether the repo gains test infrastructure it has never had.","risks":["Concurrency bugs in a Lua token bucket only appear under parallel load.","A permanent test that needs a live Redis will flake and be deleted, taking the coverage with it."],"what":"Token bucket correctness under concurrency, the exact 429 count at the boundary, and the fail-open path are all testable, but the repo has no test runner, no package.json and no tests at all.","where":"Three source files, no test infrastructure, no CI configuration visible in the repo."},"header":"Q9 Verification","id":"verification","options":[{"label":"Throwaway Bun script against a local instance plus one permanent test on the Lua boundary, and a written canary checklist","tradeoff":"Proves the real 429 behaviour and leaves one regression net; costs a day of scripting before canary.","holds_when":"There is no time or appetite to stand up a full test suite this week."},{"label":"Stand up a proper test suite with a package.json, unit tests and an integration test against a containerised Redis","tradeoff":"Best long-term foundation; costs infrastructure work that competes directly with the this-week ship."},{"label":"Manual curl and redis-cli checks per instance, no scripts","tradeoff":"Fastest to start; cannot produce the parallel-load evidence that the atomicity claim rests on."}],"question":"Is verification a throwaway load script plus one permanent Lua-boundary test and a canary checklist, rather than a new test suite this week?","recommended":0}]}
```

### ask result

```text
Validation failed for tool "ask":
  - questions/0/brief/evidence/1/path: questions[0].brief.evidence[1].path must be file, directory path, relative to the working directory or absolute (was missing)

Received arguments:
{
  "questions": [
    {
      "brief": {
        "evidence": [
          {
            "lines": "3",
            "note": "The abuse is live and ongoing; observe-only leaves it running.",
            "path": "PLAN.md"
          },
          {
            "lines": "10-11",
            "note": "Bursting integrations and the debatable abuse pattern."
          }
        ],
        "how": "A yes means the limiter's first deploy is not the first mitigation; the plan gains a step 0.",
        "risks": [
          "A manual LB block becomes permanent folklore nobody removes.",
          "Blocking the wrong identity (shared NAT or a reseller) repeats the incident in reverse."
        ],
        "what": "Whatever we ship, enforcement begins at least 24h after deploy. The decision is whether there is a stopgap now, and whether it can be removed.",
        "where": "Rollout is observe 24–48h, then canary, then all 3. The abuser created 40,000 orders in ten minutes last week and nothing in the repo blocks it."
      },
      "header": "Q1 Stopgap",
      "id": "stopgap",
      "options": [
        {
          "label": "Block that customer id at the load balancer now, with a ticket to remove it once enforcement lands",
          "tradeoff": "Stops the bleeding during observe without a deploy; costs an out-of-band rule nobody will find later unless it is ticketed.",
          "holds_when": "The offending identity is known and is a paying customer you are willing to tell."
        },
        {
          "label": "Nothing until enforcement; accept 24–48h more of the abuse",
          "tradeoff": "No out-of-band steps to undo, but the incident the plan exists to stop continues for three more days."
        },
        {
          "label": "Emergency enforce-mode deploy scoped to that one customer id",
          "tradeoff": "Uses the real mechanism, so it is removed by the same config, but it ships enforcement code before observe has run."
        }
      ],
      "question": "Do we apply a manual stopgap to the offending customer now, rather than waiting 24–48h for observe mode to finish?",
      "recommended": 0
    },
    {
      "brief": {
        "evidence": [
          {
            "lines": "10",
            "note": "Twenty accounts legitimately burst; their real rates are unknown.",
            "path": "PLAN.md"
          },
          {
            "lines": "3",
            "note": "40,000 orders in ten minutes = ~4,000/min, the only measured rate.",
            "path": "PLAN.md"
          },
          {
            "lines": "3-8",
            "note": "No timestamp field, so history cannot be reconstructed from the orders table.",
            "path": "src/orders.ts"
          }
        ],
        "how": "The chosen values become the env defaults and the credential numbers in the customer notice. Q2 in the previous round fixed the override table, so a wrong enterprise number is editable, not a redeploy.",
        "risks": [
          "Too low: the canary 429s a paying integration on day one.",
          "Too high: the abuser's 4,000/min fits comfortably and nothing changes.",
          "Provisional numbers demoted to permanent because nobody owns the review."
        ],
        "what": "A token bucket needs a sustained rate and a burst depth per tier. Nothing in the repo gives a normal customer's rate; the only measured point is the abuser at ~4,000/min.",
        "where": "Token bucket per customer, overrides in Postgres, env defaults. No traffic data exists in the repo or the orders schema."
      },
      "header": "Q2 Numbers",
      "id": "numbers",
      "options": [
        {
          "description": "120/min sustained, burst 60; enterprise 1,200/min, burst 600.",
          "label": "Provisional: default 120/min with burst 60, enterprise 1,200/min with burst 600, explicitly re-tuned after observe",
          "tradeoff": "Caps the abuser at a third of their observed rate while leaving headroom for scripted writes; costs a stated commitment to revisit within a week.",
          "holds_when": "Order writes are human- or workflow-paced, not batch-paced."
        },
        {
          "description": "600/min default, 6,000/min enterprise.",
          "label": "Generous: default 600/min with burst 300, enterprise 6,000/min with burst 3,000",
          "tradeoff": "Almost nobody notices on day one and the abuser is only half-throttled; the 40k/10min pattern would still pass at enterprise tier."
        },
        {
          "description": "60/min default, 300/min enterprise.",
          "label": "Conservative: default 60/min with burst 20, enterprise 300/min with burst 100",
          "tradeoff": "Strong database protection, but batch reconciliation scripts that write orders will break and you will hear about it."
        },
        {
          "label": "Pick only after the observe phase, starting from a deliberately high sentinel",
          "tradeoff": "No guessing in production, but the first 48h protect nothing and the sentinel itself is a number you are guessing."
        }
      ],
      "question": "Do we ship provisional numbers now — 120 orders/min sustained with burst 60, and 1,200/min with burst 600 for the 20 enterprise accounts — and re-tune from observe data?",
      "recommended": 0
    },
    {
      "brief": {
        "evidence": [
          {
            "lines": "8",
            "note": "The cluster is shared with sessions owned by another service.",
            "path": "PLAN.md"
          },
          {
            "lines": "10-16",
            "note": "Every POST reaches Postgres synchronously; there is no queue or fallback path.",
            "path": "src/server.ts"
          }
        ],
        "how": "The answer sets the limiter's error path and the alert that must exist before canary. Stale-on-error config caching returns in a later round, because it must match this stance.",
        "risks": [
          "Fail-open: Redis maintenance night becomes an unbounded order flood.",
          "Fail-closed: a shared-cluster blip stops every customer's ordering, worse than the original incident.",
          "Silent fail-open with no alert is the worst of both."
        ],
        "what": "The shared cluster is the likely correlated-failure point: if sessions are evicted or Redis restarts, the limiter sees the same outage. The choice decides whether that outage becomes an order outage.",
        "where": "Counters in the sessions Redis cluster. src/server.ts has no error handling for infrastructure failures at all."
      },
      "header": "Q3 Store failure",
      "id": "failmode",
      "options": [
        {
          "label": "Fail open: allow the request, log and alert, 20ms timeout budget",
          "tradeoff": "Redis trouble never becomes an order outage; during the outage the abuser is unlimited, which is exactly today's status quo.",
          "holds_when": "Availability of ordering outranks enforcement during an infrastructure fault."
        },
        {
          "label": "Fail closed: reject with 429 (or 503) when the store cannot answer",
          "tradeoff": "Never loses protection, but a Redis blip or a maxmemory eviction incident becomes a total API outage for all 20 customers."
        },
        {
          "label": "Fail open with a per-instance in-memory bucket as emergency protection",
          "tradeoff": "Keeps rough protection during the outage at 3x the intended limit; costs a second code path and a second set of numbers to reason about."
        }
      ],
      "question": "When Redis is unreachable or times out, do requests through — fail open with a log and alert — or get rejected?",
      "recommended": 0
    },
    {
      "brief": {
        "evidence": [
          {
            "lines": "7-8",
            "note": "The customer id is an unvalidated, unbounded request header.",
            "path": "src/server.ts"
          }
        ],
        "how": "This fixes the exact key format the Lua script and the ops runbook use; TTL is derived from burst/rate, so it follows Q2.",
        "risks": [
          "Raw header values let a client pin a hot slot or poison the key space.",
          "Keys with no TTL accumulate and become the eviction pressure that hits sessions."
        ],
        "what": "The header is untrusted and unbounded, and Redis Cluster distributes by slot. The key format and lifetime decide both blast radius and whether stale buckets leak memory into the shared cluster.",
        "where": "Redis Cluster with a dedicated prefix and DB index. The customer id arrives as an arbitrary string from the client."
      },
      "header": "Q4 Key layout",
      "id": "keyformat",
      "options": [
        {
          "label": "Hash the id into a hash-tagged key: rl:orders:{sha256(customerId)}, TTL = full-refill time plus one hour",
          "tradeoff": "Bounded, slot-stable, and self-cleaning; costs debuggability — an ops engineer cannot read the customer id from the key.",
          "holds_when": "The id is untrusted or long, which it is."
        },
        {
          "label": "Raw customer id as the key with a 24h TTL",
          "tradeoff": "Trivially inspectable with redis-cli; exposes unbounded key length and lets a crafted id land wherever the client likes."
        },
        {
          "label": "Hash the id but let keys live until maxmemory evicts them",
          "tradeoff": "No TTL bookkeeping; guarantees the limiter contributes to the eviction pressure that could kill sessions."
        }
      ],
      "question": "Do we key on the hashed customer id inside a Redis hash tag with a TTL derived from the bucket's refill time, rather than storing the raw header?",
      "recommended": 0
    },
    {
      "brief": {
        "evidence": [
          {
            "lines": "8",
            "note": "Existing error responses are plain text with no headers; the new headers are a fresh contract.",
            "path": "src/server.ts"
          }
        ],
        "how": "This fixes the exact header semantics the integration docs and the notify-20 email will state. The notify email itself waits for the numbers.",
        "risks": [
          "Reset meaning epoch-ms vs seconds is the classic integration bug.",
          "Retry-After 0 or missing invites immediate retry storms."
        ],
        "what": "The contract said 429 + Retry-After + X-RateLimit-*. Their exact values are still open, and a token bucket has no natural window boundary to point at, so Reset needs a defined meaning.",
        "where": "Token bucket emits tokens at rate/60 per second up to burst. The rejection contract is settled but its numbers are not."
      },
      "header": "Q5 Header math",
      "id": "headers",
      "options": [
        {
          "label": "Retry-After = ceil((1 - tokens) / rate) clamped to at least 1s; Remaining = floor(tokens); Limit = burst; Reset = epoch seconds when the bucket would be full",
          "tradeoff": "Honest and immediately actionable; costs a definition someone must keep stable forever.",
          "holds_when": "Clients can read headers and retry on their own schedule."
        },
        {
          "label": "Retry-After always 1s, Remaining only, no Reset",
          "tradeoff": "Trivial to implement and impossible to get wrong; clients retry too early and generate avoidable 429s."
        },
        {
          "label": "Retry-After in milliseconds as a custom header, standard header omitted",
          "tradeoff": "Precise for scripted clients; violates the HTTP contract and forces every integration to special-case it."
        }
      ],
      "question": "Do we define Retry-After as time until one token is available (integer seconds, minimum 1), with Reset meaning the epoch second the bucket is full?",
      "recommended": 0
    },
    {
      "brief": {
        "evidence": [
          {
            "lines": "4",
            "note": "Only env-based config exists today, owned by deployers.",
            "path": "src/db.ts"
          },
          {
            "lines": "7-8",
            "note": "The customer id is a free-form string, so the override table's key is not a constrained id space.",
            "path": "src/server.ts"
          }
        ],
        "how": "This fixes the table columns and the operational runbook: who runs the UPDATE, and where the audit lives. The actual numbers were settled separately.",
        "risks": [
          "No updated_by column means the first limit dispute has no answer.",
          "A tier enum makes every new commercial arrangement a code change.",
          "An in-app admin endpoint is a new authenticated surface to secure this week."
        ],
        "what": "An override table needs a schema and an owner. Support changing limits by hand in psql and an account manager editing them through a UI are very different products, with different audit and security needs.",
        "where": "Postgres override table plus env defaults, cached in each instance. No admin surface and no audit convention exist in the repo."
      },
      "header": "Q6 Config schema",
      "id": "configschema",
      "options": [
        {
          "label": "Columns customer_id (pk), rate_per_min, burst, updated_by, updated_at, note; no tier enum; support edits via SQL; defaults in env",
          "tradeoff": "One row per exception, fully audited, no new endpoint; costs the editor needing database access and SQL.",
          "holds_when": "Limit changes are a handful per week, which 20 enterprise accounts implies."
        },
        {
          "label": "Tier enum column (standard, enterprise, custom) with the numbers held in env per tier",
          "tradeoff": "Fewer moving numbers to reason about; every bespoke commercial arrangement becomes a code change."
        },
        {
          "label": "Same table, but managed through an authenticated admin HTTP endpoint in this service",
          "tradeoff": "No database access needed to change a limit; adds an auth surface and a second API to a service meant to ship this week."
        },
        {
          "label": "Table only, written by account managers through an existing internal tool",
          "tradeoff": "Cleanest ownership; depends on a tool I cannot see in this repo and may not exist."
        }
      ],
      "question": "Do we use an explicit per-customer override table with audit columns and no tier enum, edited by support via SQL, while env owns the defaults?",
      "recommended": 0
    },
    {
      "brief": {
        "evidence": [
          {
            "lines": "5-13",
            "note": "The handler is the only place a limit check can sit today.",
            "path": "src/server.ts"
          },
          {
            "lines": "3-8",
            "note": "Order rows carry no timestamp, so rates cannot be reconstructed from the database afterwards.",
            "path": "src/orders.ts"
          }
        ],
        "how": "The answer defines the log schema the review depends on and the mechanism that ends enforcement instantly if the canary goes wrong.",
        "risks": [
          "Only logging would-be 429s tells you nothing about how close normal customers sit to the limit.",
          "Emitted headers during observe become a contract before the numbers are final.",
          "A kill switch that needs a redeploy is not a kill switch."
        ],
        "what": "Tuning requires the per-customer rate distribution, which the limiter can compute but must be told to record. And there must be a switch that ends enforcement without a deploy.",
        "where": "Enforcement is staged observe → canary → all. There is no logging, metrics or feature-flag convention in the repo; src/server.ts logs nothing."
      },
      "header": "Q7 Observe mode",
      "id": "observe",
      "options": [
        {
          "label": "Per-minute per-customer rate snapshot for all POSTs, plus a would-be-429 line; no X-RateLimit headers during observe; env RATE_LIMIT_MODE=observe|enforce per instance",
          "tradeoff": "Gives the distribution needed to set numbers and a deploy-free kill switch; costs structured logging code and log volume from 20 customers.",
          "holds_when": "You want numbers grounded in real traffic rather than guesses."
        },
        {
          "label": "Log only would-be rejections at the provisional thresholds, and emit X-RateLimit headers immediately",
          "tradeoff": "Small and lets integrations adapt early; reveals nothing about customers below the line and publishes a contract you may still change."
        },
        {
          "label": "Full request log with timing and body size, plus a Postgres-backed mode flag",
          "tradeoff": "Richest data for later capacity work; heavy volume and ties the kill switch to the database that the incident is stressing."
        }
      ],
      "question": "Does the observe phase record a per-minute per-customer rate snapshot plus would-be rejections, withhold X-RateLimit headers until enforcement, and use an env-var mode switch as the kill switch?",
      "recommended": 0
    },
    {
      "brief": {
        "evidence": [
          {
            "lines": "5-13",
            "note": "Order of operations today: header check, then body parse, then the write.",
            "path": "src/server.ts"
          },
          {
            "lines": "10-13",
            "note": "The write is the expensive, serializing step worth protecting.",
            "path": "src/orders.ts"
          }
        ],
        "how": "This fixes where the Lua call sits relative to parsing and the database, and therefore what a 429 costs and which error wins when both apply.",
        "risks": [
          "Checking after the parse means a flood still burns CPU and memory on JSON.",
          "Checking inside createOrder makes the limiter invisible to callers and untestable in isolation."
        ],
        "what": "A section check costs nothing, a JSON parse costs memory, and a Postgres write costs the thing the plan exists to protect. The position also decides 429-vs-400 precedence for malformed bodies.",
        "where": "src/server.ts:5-13 handles a POST by reading the header, awaiting req.json(), then writing to Postgres."
      },
      "header": "Q8 Check placement",
      "id": "placement",
      "options": [
        {
          "label": "In fetch(), after the missing-header 401 and before req.json()",
          "tradeoff": "A rejected flood costs one Redis round trip and no parse or database work; the 429 wins over a malformed body, which is defensible since the client is over budget.",
          "holds_when": "Parsing is the second-cheapest thing after the check, which it is."
        },
        {
          "label": "After parsing and validating the body",
          "tradeoff": "Only well-formed requests are counted, so malformed spam is unlimited; costs CPU and memory per rejected request."
        },
        {
          "label": "Inside createOrder, before the insert",
          "tradeoff": "Keeps the limiter with the protected resource and covers future callers; hides it from the HTTP layer and repeats the parse cost."
        }
      ],
      "question": "Does the limiter run in the fetch handler before the body is parsed, so a 429 costs only one Redis round trip and malformed floods are rejected too?",
      "recommended": 0
    },
    {
      "brief": {
        "evidence": [
          {
            "lines": "1-18",
            "note": "Single file, no test setup, no package.json in the repo root.",
            "path": "src/server.ts"
          },
          {
            "lines": "4",
            "note": "Configuration already flows through process.env, so a test instance is easy to point at.",
            "path": "src/db.ts"
          }
        ],
        "how": "This sets how much verification exists before the canary and whether the repo gains test infrastructure it has never had.",
        "risks": [
          "Concurrency bugs in a Lua token bucket only appear under parallel load.",
          "A permanent test that needs a live Redis will flake and be deleted, taking the coverage with it."
        ],
        "what": "Token bucket correctness under concurrency, the exact 429 count at the boundary, and the fail-open path are all testable, but the repo has no test runner, no package.json and no tests at all.",
        "where": "Three source files, no test infrastructure, no CI configuration visible in the repo."
      },
      "header": "Q9 Verification",
      "id": "verification",
      "options": [
        {
          "label": "Throwaway Bun script against a local instance plus one permanent test on the Lua boundary, and a written canary checklist",
          "tradeoff": "Proves the real 429 behaviour and leaves one regression net; costs a day of scripting before canary.",
          "holds_when": "There is no time or appetite to stand up a full test suite this week."
        },
        {
          "label": "Stand up a proper test suite with a package.json, unit tests and an integration test against a containerised Redis",
          "tradeoff": "Best long-term foundation; costs infrastructure work that competes directly with the this-week ship."
        },
        {
          "label": "Manual curl and redis-cli checks per instance, no scripts",
          "tradeoff": "Fastest to start; cannot produce the parallel-load evidence that the atomicity claim rests on."
        }
      ],
      "question": "Is verification a throwaway load script plus one permanent Lua-boundary test and a canary checklist, rather than a new test suite this week?",
      "recommended": 0
    }
  ]
}
```

### Model reasoning

```text
Fix evidence path for Q1 second item.
```

### ask call

```json
{"questions":[{"brief":{"evidence":[{"lines":"3","note":"The abuse is live and ongoing; observe-only leaves it running.","path":"PLAN.md"},{"lines":"10-11","note":"Bursting integrations and the incident's framing.","path":"PLAN.md"}],"how":"A yes means the limiter's first deploy is not the first mitigation; the plan gains a step 0.","risks":["A manual LB block becomes permanent folklore nobody removes.","Blocking the wrong identity (shared NAT or a reseller) repeats the incident in reverse."],"what":"Whatever we ship, enforcement begins at least 24h after deploy. The decision is whether there is a stopgap now, and whether it can be removed.","where":"Rollout is observe 24–48h, then canary, then all 3. The abuser created 40,000 orders in ten minutes last week and nothing in the repo blocks it."},"header":"Q1 Stopgap","id":"stopgap","options":[{"label":"Block that customer id at the load balancer now, with a ticket to remove it once enforcement lands","tradeoff":"Stops the bleeding during observe without a deploy; costs an out-of-band rule nobody will find later unless it is ticketed.","holds_when":"The offending identity is known and is a paying customer you are willing to tell."},{"label":"Nothing until enforcement; accept 24–48h more of the abuse","tradeoff":"No out-of-band steps to undo, but the incident the plan exists to stop continues for three more days."},{"label":"Emergency enforce-mode deploy scoped to that one customer id","tradeoff":"Uses the real mechanism, so it is removed by the same config, but it ships enforcement code before observe has run."}],"question":"Do we apply a manual stopgap to the offending customer now, rather than waiting 24–48h for observe mode to finish?","recommended":0},{"brief":{"evidence":[{"lines":"10","note":"Twenty accounts legitimately burst; their real rates are unknown.","path":"PLAN.md"},{"lines":"3","note":"40,000 orders in ten minutes = ~4,000/min, the only measured rate.","path":"PLAN.md"},{"lines":"3-8","note":"No timestamp field, so history cannot be reconstructed from the orders table.","path":"src/orders.ts"}],"how":"The chosen values become the env defaults and the numbers in the customer notice. Per-customer overrides are editable, so a wrong enterprise number is not a redeploy.","risks":["Too low: the canary 429s a paying integration on day one.","Too high: the abuser's 4,000/min fits comfortably and nothing changes.","Provisional numbers become permanent because nobody owns the review."],"what":"A token bucket needs a sustained rate and a burst depth per tier. Nothing in the repo gives a normal customer's rate; the only measured point is the abuser at ~4,000/min.","where":"Token bucket per customer, overrides in Postgres, env defaults. No traffic data exists in the repo or the orders schema."},"header":"Q2 Numbers","id":"numbers","options":[{"description":"120/min sustained, burst 60; enterprise 1,200/min, burst 600.","label":"Provisional: default 120/min with burst 60, enterprise 1,200/min with burst 600, explicitly re-tuned after observe","tradeoff":"Caps the abuser at a third of their observed rate while leaving headroom for scripted writes; costs a stated commitment to revisit within a week.","holds_when":"Order writes are human- or workflow-paced, not batch-paced."},{"description":"600/min default, 6,000/min enterprise.","label":"Generous: default 600/min with burst 300, enterprise 6,000/min with burst 3,000","tradeoff":"Almost nobody notices on day one and the abuser is only half-throttled; their 40k/10min pattern would still pass at enterprise tier."},{"description":"60/min default, 300/min enterprise.","label":"Conservative: default 60/min with burst 20, enterprise 300/min with burst 100","tradeoff":"Strong database protection, but batch reconciliation scripts that write orders will break and you will hear about it."},{"label":"Pick only after the observe phase, starting from a deliberately high sentinel","tradeoff":"No guessing in production, but the first 48h protect nothing and the sentinel itself is a number you are guessing."}],"question":"Do we ship provisional numbers now — 120 orders/min sustained with burst 60, and 1,200/min with burst 600 for the 20 enterprise accounts — and re-tune from observe data?","recommended":0},{"brief":{"evidence":[{"lines":"8","note":"The cluster is shared with sessions owned by another service.","path":"PLAN.md"},{"lines":"10-16","note":"Every POST reaches Postgres synchronously; there is no queue or fallback path.","path":"src/server.ts"}],"how":"The answer sets the limiter's error path and the alert that must exist before canary. Stale-on-error config caching returns in a later round, because it must match this stance.","risks":["Fail-open: Redis maintenance night becomes an unbounded order flood.","Fail-closed: a shared-cluster blip stops every customer's ordering, worse than the original incident.","Silent fail-open with no alert is the worst of both."],"what":"The shared cluster is the likely correlated-failure point: if sessions are evicted or Redis restarts, the limiter sees the same outage. The choice decides whether that outage becomes an order outage.","where":"Counters in the sessions Redis cluster. src/server.ts has no error handling for infrastructure failures at all."},"header":"Q3 Store failure","id":"failmode","options":[{"label":"Fail open: allow the request, log and alert, 20ms timeout budget","tradeoff":"Redis trouble never becomes an order outage; during the outage the abuser is unlimited, which is exactly today's status quo.","holds_when":"Availability of ordering outranks enforcement during an infrastructure fault."},{"label":"Fail closed: reject with 429 (or 503) when the store cannot answer","tradeoff":"Never loses protection, but a Redis blip or a maxmemory eviction incident becomes a total API outage for all 20 customers."},{"label":"Fail open with a per-instance in-memory bucket as emergency protection","tradeoff":"Keeps rough protection during the outage at 3x the intended limit; costs a second code path and a second set of numbers to reason about."}],"question":"When Redis is unreachable or times out, do requests through — fail open with a log and alert — or get rejected?","recommended":0},{"brief":{"evidence":[{"lines":"7-8","note":"The customer id is an unvalidated, unbounded request header.","path":"src/server.ts"}],"how":"This fixes the exact key format the Lua script and the ops runbook use; TTL is derived from burst/rate, so it follows Q2.","risks":["Raw header values let a client pin a hot slot or poison the key space.","Keys with no TTL accumulate and become the eviction pressure that hits sessions."],"what":"The header is untrusted and unbounded, and Redis Cluster distributes by slot. The key format and lifetime decide both blast radius and whether stale buckets leak memory into the shared cluster.","where":"Redis Cluster with a dedicated prefix and DB index. The customer id arrives as an arbitrary string from the client."},"header":"Q4 Key layout","id":"keyformat","options":[{"label":"Hash the id into a hash-tagged key: rl:orders:{sha256(customerId)}, TTL = full-refill time plus one hour","tradeoff":"Bounded, slot-stable, and self-cleaning; costs debuggability — an ops engineer cannot read the customer id from the key.","holds_when":"The id is untrusted or long, which it is."},{"label":"Raw customer id as the key with a 24h TTL","tradeoff":"Trivially inspectable with redis-cli; exposes unbounded key length and lets a crafted id land wherever the client likes."},{"label":"Hash the id but let keys live until maxmemory evicts them","tradeoff":"No TTL bookkeeping; guarantees the limiter contributes to the eviction pressure that could kill sessions."}],"question":"Do we key on the hashed customer id inside a Redis hash tag with a TTL derived from the bucket's refill time, rather than storing the raw header?","recommended":0},{"brief":{"evidence":[{"lines":"8","note":"Existing error responses are plain text with no headers; the new headers are a fresh contract.","path":"src/server.ts"}],"how":"This fixes exact header semantics for the integration docs and the customer notice. The notice itself waits for the numbers.","risks":["Reset meaning epoch-ms vs seconds is the classic integration bug.","Retry-After 0 or missing invites immediate retry storms."],"what":"The contract said 429 + Retry-After + X-RateLimit-*. Their exact values are still open, and a token bucket has no natural window boundary to point at, so Reset needs a defined meaning.","where":"Token bucket emits tokens at rate/60 per second up to burst. The rejection contract is settled but its numbers are not."},"header":"Q5 Header math","id":"headers","options":[{"label":"Retry-After = ceil((1 - tokens) / rate) clamped to at least 1s; Remaining = floor(tokens); Limit = burst; Reset = epoch seconds when the bucket would be full","tradeoff":"Honest and immediately actionable; costs a definition someone must keep stable forever.","holds_when":"Clients can read headers and retry on their own schedule."},{"label":"Retry-After always 1s, Remaining only, no Reset","tradeoff":"Trivial to implement and impossible to get wrong; clients retry too early and generate avoidable 429s."},{"label":"Retry-After in milliseconds as a custom header, standard header omitted","tradeoff":"Precise for scripted clients; violates the HTTP contract and forces every integration to special-case it."}],"question":"Do we define Retry-After as time until one token is available (integer seconds, minimum 1), with Reset meaning the epoch second the bucket is full?","recommended":0},{"brief":{"evidence":[{"lines":"4","note":"Only env-based config exists today, owned by deployers.","path":"src/db.ts"},{"lines":"7-8","note":"The customer id is a free-form string, so the override table's key is not a constrained id space.","path":"src/server.ts"}],"how":"This fixes the table columns and the operational runbook: who runs the UPDATE, and where the audit lives. The actual numbers were settled separately.","risks":["No updated_by column means the first limit dispute has no answer.","A tier enum makes every new commercial arrangement a code change.","An in-app admin endpoint is a new authenticated surface to secure this week."],"what":"An override table needs a schema and an owner. Support changing limits by hand in psql and account managers editing them through a UI are different products with different audit and security needs.","where":"Postgres override table plus env defaults, cached in each instance. No admin surface and no audit convention exist in the repo."},"header":"Q6 Config schema","id":"configschema","options":[{"label":"Columns customer_id (pk), rate_per_min, burst, updated_by, updated_at, note; no tier enum; support edits via SQL; defaults in env","tradeoff":"One row per exception, fully audited, no new endpoint; costs the editor needing database access and SQL.","holds_when":"Limit changes are a handful per week, which 20 enterprise accounts implies."},{"label":"Tier enum column (standard, enterprise, custom) with the numbers held in env per tier","tradeoff":"Fewer moving numbers to reason about; every bespoke commercial arrangement becomes a code change."},{"label":"Same table, but managed through an authenticated admin HTTP endpoint in this service","tradeoff":"No database access needed to change a limit; adds an auth surface and a second API to a service meant to ship this week."},{"label":"Table only, written by account managers through an existing internal tool","tradeoff":"Cleanest ownership; depends on a tool I cannot see in this repo and may not exist."}],"question":"Do we use an explicit per-customer override table with audit columns and no tier enum, edited by support via SQL, while env owns the defaults?","recommended":0},{"brief":{"evidence":[{"lines":"5-13","note":"The handler is the only place a limit check can sit today.","path":"src/server.ts"},{"lines":"3-8","note":"Order rows carry no timestamp, so rates cannot be reconstructed from the database afterwards.","path":"src/orders.ts"}],"how":"The answer defines the log schema the review depends on and the mechanism that ends enforcement instantly if the canary goes wrong.","risks":["Only logging would-be 429s tells you nothing about how close normal customers sit to the limit.","Emitted headers during observe become a contract before the numbers are final.","A kill switch that needs a redeploy is not a kill switch."],"what":"Tuning requires the per-customer rate distribution, which the limiter can compute but must be told to record. And there must be a switch that ends enforcement without a deploy.","where":"Enforcement is staged observe → canary → all. There is no logging, metrics or feature-flag convention in the repo; src/server.ts logs nothing."},"header":"Q7 Observe mode","id":"observe","options":[{"label":"Per-minute per-customer rate snapshot for all POSTs, plus a would-be-429 line; no X-RateLimit headers during observe; env RATE_LIMIT_MODE=observe|enforce per instance","tradeoff":"Gives the distribution needed to set numbers and a deploy-free kill switch; costs structured logging code and log volume from 20 customers.","holds_when":"You want numbers grounded in real traffic rather than guesses."},{"label":"Log only would-be rejections at the provisional thresholds, and emit X-RateLimit headers immediately","tradeoff":"Small and lets integrations adapt early; reveals nothing about customers below the line and publishes a contract you may still change."},{"label":"Full request log with timing and body size, plus a Postgres-backed mode flag","tradeoff":"Richest data for later capacity work; heavy volume and ties the kill switch to the database that the incident is stressing."}],"question":"Does the observe phase record a per-minute per-customer rate snapshot plus would-be rejections, withhold X-RateLimit headers until enforcement, and use an env-var mode switch as the kill switch?","recommended":0},{"brief":{"evidence":[{"lines":"5-13","note":"Order of operations today: header check, then body parse, then the write.","path":"src/server.ts"},{"lines":"10-13","note":"The write is the expensive, serializing step worth protecting.","path":"src/orders.ts"}],"how":"This fixes where the Lua call sits relative to parsing and the database, and therefore what a 429 costs and which error wins when both apply.","risks":["Checking after the parse means a flood still burns CPU and memory on JSON.","Checking inside createOrder makes the limiter invisible to callers and untestable in isolation."],"what":"A header check costs nothing, a JSON parse costs memory, and a Postgres write costs the thing the plan exists to protect. The position also decides 429-vs-400 precedence for malformed bodies.","where":"src/server.ts:5-13 handles a POST by reading the header, awaiting req.json(), then writing to Postgres."},"header":"Q8 Check placement","id":"placement","options":[{"label":"In fetch(), after the missing-header 401 and before req.json()","tradeoff":"A rejected flood costs one Redis round trip and no parse or database work; the 429 wins over a malformed body, which is defensible since the client is over budget.","holds_when":"Parsing is the second-cheapest thing after the check, which it is."},{"label":"After parsing and validating the body","tradeoff":"Only well-formed requests are counted, so malformed spam is unlimited; costs CPU and memory per rejected request."},{"label":"Inside createOrder, before the insert","tradeoff":"Keeps the limiter with the protected resource and covers future callers; hides it from the HTTP layer and repeats the parse cost."}],"question":"Does the limiter run in the fetch handler before the body is parsed, so a 429 costs only one Redis round trip and malformed floods are rejected too?","recommended":0},{"brief":{"evidence":[{"lines":"1-18","note":"Single file, no test setup, no package.json in the repo root.","path":"src/server.ts"},{"lines":"4","note":"Configuration already flows through process.env, so a test instance is easy to point at.","path":"src/db.ts"}],"how":"This sets how much verification exists before the canary and whether the repo gains test infrastructure it has never had.","risks":["Concurrency bugs in a Lua token bucket only appear under parallel load.","A permanent test that needs a live Redis will flake and be deleted, taking the coverage with it."],"what":"Token bucket correctness under concurrency, the exact 429 count at the boundary, and the fail-open path are all testable, but the repo has no test runner, no package.json and no tests at all.","where":"Three source files, no test infrastructure, no CI configuration visible in the repo."},"header":"Q9 Verification","id":"verification","options":[{"label":"Throwaway Bun script against a local instance plus one permanent test on the Lua boundary, and a written canary checklist","tradeoff":"Proves the real 429 behaviour and leaves one regression net; costs a day of scripting before canary.","holds_when":"There is no time or appetite to stand up a full test suite this week."},{"label":"Stand up a proper test suite with a package.json, unit tests and an integration test against a containerised Redis","tradeoff":"Best long-term foundation; costs infrastructure work that competes directly with the this-week ship."},{"label":"Manual curl and redis-cli checks per instance, no scripts","tradeoff":"Fastest to start; cannot produce the parallel-load evidence that the atomicity claim rests on."}],"question":"Is verification a throwaway load script plus one permanent Lua-boundary test and a canary checklist, rather than a new test suite this week?","recommended":0}]}
```

### ask result

```text
User answers:
stopgap: (cancelled)
numbers: (cancelled)
failmode: (cancelled)
keyformat: (cancelled)
headers: (cancelled)
configschema: (cancelled)
observe: (cancelled)
placement: (cancelled)
verification: (cancelled)
```

