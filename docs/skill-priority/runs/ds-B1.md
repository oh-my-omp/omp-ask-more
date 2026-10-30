## Person: `/skill:grilling Grill me on the unresolved decisions in PLAN.md. Do not implement the plan.`

omp injected the skill as a user-attributed message: its first line, then the 25 lines of `grilling/SKILL.md`.

```text
[IMPORTANT: User invoked the "grilling" skill; follow its instructions. Full skill below.]
```

### Model reply

I'll read PLAN.md first, plus the skill directory for any referenced assets.

- tool `read` PLAN.md

- tool `read` /tmp/askmore-grill/.omp/skills/grilling

### Model reasoning

```text
Let me inspect the repo to gather facts: src/server.ts, tests, package.json, any existing Redis config, deployment env, enterprise customer config, load balancer behavior. Let me read the directory.
```

- tool `read` .

- tool `read` /tmp/askmore-grill/.omp/skills/grilling/SKILL.md

### Model reasoning

```text
No sub-agent tool available; only `read`. So I gather facts myself.

Read the three source files.

Note: I can't dispatch sub-agents (no tool). I'll just read.

Let me read src/server.ts, orders.ts, db.ts.
```

- tool `read` src/server.ts

- tool `read` src/orders.ts

- tool `read` src/db.ts

### Model reasoning

```text
Facts gathered. Repo is a toy: no tests, no package.json, no config, no existing rate-limit code, no Redis client. Single file server with x-customer-id header as auth (unauthenticated header!). Key insight: `x-customer-id` is supplied by the client with no authentication — so keying on it is trivially bypassable by the abuser (rotate header values) unless there's a gateway that authenticates and strips/sets it. That's a major fork for the key question.

Also: 3 instances behind round-robin LB — in-memory counters give 3x the limit and per-instance state; that interacts with algorithm and rollout (limits change as instances restart).

The plan's undecided list:
1. Key: x-customer-id, IP, both.
2. Algorithm: fixed window, sliding window, token bucket.
3. Counters: Redis or in-memory.
4. Store unreachable: fail-open or fail-closed.
5. Enterprise higher limits, who owns numbers.
6. Rejected client response.
7. Rollout without breaking enterprise integrations.

Frontier round 1: Which decisions have no unsettled prerequisites?

- Key choice (Q1) — independent. But fact: header is unauthenticated. Need to ask about trust boundary — actually that's part of key decision; I can fold: "key on x-customer-id" presumes the header is trustworthy. This is a decision (do we trust it / is there a gateway?). It's a prerequisite to key choice but can be asked as one question with a recommendation: key on customer-id, and require that identity be authenticated at the edge. Hmm, per skill: a question whose answer depends on another open question belongs to later round. The trust-boundary question determines whether customer-id keying is even viable, and it's independent of others. I could ask them as Q1 (key/identity) with sub-parts. Better: Q1 = identity trust & key, since the decision "what to key on" is inseparable from "is the key forgeable". But careful — asking a compound question muddies "yes accepts recommendation". I'll make Q1 the key/identity question, explicitly noting the header trust finding, recommending key on customer-id + IP fallback... wait, but if header is client-supplied and forgeable, IP fallback matters. Recommendation: key on authenticated customer id; if the edge doesn't authenticate, that must be fixed first because any customer-id key is bypassable. Hmm, but that's a prerequisite fact I can't determine (no gateway config in repo). It's a decision for user: is there an edge that authenticates?

Actually the skill says ask the whole frontier in one round. Candidates with no prereqs:

Q1 — keying / identity trust. Prereq: none.
Q2 — counter store: Redis vs in-memory. Depends partly on key decision? Not really; independent. But algorithm choice depends on store (token bucket needs Redis for atomicity, or Lua). Q2 can be asked now: distributed store needed given 3 instances. Recommendation: Redis (existing cluster). This is independent of key.
Q3 — failure mode when store unreachable. Depends on store choice? If in-memory, the question becomes moot-ish. Hmm. It's conditional on Q2. Per rule, put in later round. But it's on the requested list. I'd argue fail-open vs fail-closed is a decision that only exists if Redis is chosen → later round.
Q4 — algorithm: depends on store? Loosely. Fixed window vs sliding window vs token bucket is fairly independent of store (all implementable in Redis; token bucket in-memory is also possible). But if store = in-memory, sliding window log is cheap; if Redis, all fine. Algorithm also depends on product needs (bursts). I think algorithm can be asked now, with recommendation token bucket — but token bucket's per-customer burst allowance ties into enterprise limits (Q5). Hmm, enterprise limits: "how enterprise customers get higher limits and who owns numbers" — is that dependent on algorithm? Somewhat: token bucket makes burst capacity a separate knob. But the ownership question is independent. I'd defer enterprise limit mechanics one round? No — the enterprise tier question is mostly independent: does it need config/DB, who approves. It's a product/org decision. But its shape (per-customer overrides) depends on keying (Q1 candidate) — if we key on IP, per-customer overrides are impossible. So enterprise limits depend on Q1 → later round.

Q6 — rejection response shape: independent of everything? Status code 429, Retry-After, body, headers. Yes, independent. Can ask now. Though whether we include `X-RateLimit-*` headers is independent too.

Q7 — rollout strategy: depends on algorithm/store/key? Partially — canary/observe-only mode depends on being able to run in shadow (needs counters regardless). Hmm, rollout question "how to roll out without breaking enterprise" has prerequisites: knowing enterprise limits (Q5) and rejection behavior (Q6). Some parts are independent: observability-first shadow mode, per-customer feature flag. But the "don't break enterprise" answer partly depends on whether enterprise allowlist exists. I'd say rollout depends on Q5/Q6 → later round. But maybe I can ask the *scope* question now: is the first ship enforcement or measurement? That's a rollout-strategy question with no prereqs. Hmm, that's arguably the same Q7. I could ask Q7 as "ship in observe-only mode first?" — that's independent of the limit mechanics. That is a good independent sub-question.

So round 1 frontier:
Q1 identity/key (with fact: header unauthenticated, no auth in repo).
Q2 counter store (Redis vs in-memory; fact: 3 instances, Redis cluster exists, no client dependency present yet).
Q3 algorithm (fixed/sliding/token bucket) — independent enough? It's tied to burst semantics; and to whether store is Redis (token bucket atomic refill in Redis requires Lua). But the choice of algorithm itself can be made before store? Actually store choice influences algorithm feasibility: in-memory fixed window across 3 instances gives 3x budget. If they pick Redis, all are feasible. If in-memory, token bucket per instance also gives 3x. Either way, algorithm choice has a constraint interaction but not a hard prerequisite. Hmm. The rule: "A question whose answer depends on another question still open in this round belongs to a later round." Algorithm doesn't strictly *depend* on the store answer; it's a coupled decision. I'll ask it now but scope it to semantics, noting implementation follows from Q2. Risk: user may feel it's out of order. I think it's fine — the semantic choice (smooth vs bursty) is independent.

Hmm, but a cleaner round 1: Q1 key/identity, Q2 store, Q3 rollout mode (observe vs enforce), Q4 rejection contract. Algorithm depends on... nothing? I'll include. Actually, let's think about what's the true root of the tree. Root: what is the goal/threat model? Is this abuse prevention (stop one script) or fair-share SLA enforcement (guarantee enterprise capacity)? That's the root decision and it drives everything: key, algorithm, limits, failure mode. PLAN states the trigger, but not the objective. That's a genuine frontier question with no prereqs, and arguably Q0/Q1.

Yes — Q1 should be the objective/threat model: is the limit a per-customer quota (the abuser's own budget, in which case fail-open is fine and IP keying absent), or a global capacity guard (protect shared Postgres, in which case a global limit and fail-closed matter)? Recommendation: per-customer quota as the primary mechanism, with a global backstop later? Careful not to scope-creep. Hmm.

Let me structure round 1 as root decisions:
Q1 Objective: abuse mitigation per-customer quota vs shared capacity protection. Recommendation: per-customer quota on writes, since the incident was one customer starving others; no global cap in v1.
Q2 Identity/trust: x-customer-id is unauthenticated in this code. Recommendation: require authenticated identity at edge; key on it; IP only as secondary for unauthenticated traffic. But the repo has no auth. Ask: is there an authenticating gateway in front of these 3 instances? That's a fact... not in repo. It's an environment fact I can't look up (no access to infra). Per skill, facts from environment are my job; but this is infra outside the repo. I can ask the user as a decision: "we must decide whether client-supplied x-customer-id is trustworthy". Frame as decision: key on customer-id, accepting that it must be set by a trusted edge; if it isn't, keying on it is useless.

Q3 Store: Redis vs in-memory. Recommendation: Redis (existing cluster), one shared counter namespace, given 3 instances and per-instance resets.
Q4 Algorithm: token bucket vs sliding window. Recommendation: token bucket (smooth + burst allowance for enterprise), or sliding window counter simpler. Given "enterprise customers legitimately burst", token bucket with burst capacity. Hmm, but fixed window with 2x boundary is simpler. I recommend token bucket in Redis via Lua, since it gives both smooth rate and burst.

But Q4's answer interacts with Q3: if in-memory, algorithm must be per-instance. Still askable.

Q5 Rejection contract: 429 + Retry-After + JSON body + rate-limit headers. Recommendation: 429, Retry-After seconds, JSON `{error:"rate_limited", retryAfterSeconds}`, headers `RateLimit-Limit/Remaining/Reset` (draft standard). Independent → ask now.

Q6 Rollout mode: observe-only first then enforce? Depends on Q5? Not really. Recommendation: 3-phase: log-only shadow, then enforce for non-enterprise at generous limits, then tighten. Hmm — "enforce for non-enterprise" depends on enterprise tier mechanics (Q5 in plan's list). But the phase-1 decision (shadow mode) is independent. I could ask "first ship counts and logs but doesn't reject?" — yes independent.

Q7 Enterprise limits: depends on Q2 (identity) — actually strongly: per-customer overrides require customer key. And on objective. → later round.
Q8 Failure mode: depends on Q3 (store). → later round.
Q9 Rollout full plan: depends on enterprise limits + rejection. → later round. But I'm asking the shadow-mode slice now; the rest later.

Hmm, careful: skill wants whole frontier per round, not artificial splitting. I'll ask: objective, identity/key, store, algorithm, failure semantics? Failure semantics depends on store — if they answer "Redis", fail-open/closed is the next round. Fine.

Also worth flagging: no tests, no package.json, no Redis client; "ship this week" scope. And the write path has no auth on POST /orders besides header; limit keyed on header is forgeable → this is the biggest risk in the plan. I should surface as evidence.

Also GET is cheap — plan says POST is expensive; but plan's undecided says "what to key" not "which routes". Route scoping (only POST /orders?) is a frontier decision: limit writes only, or all calls? That's independent, ask it. Recommendation: POST /orders only in v1; GET unbounded (or a much higher separate limit). Hmm, a 40k-orders/min script hammering POST; GET cheap. Yes, ask.

That gives round 1: 7 questions. That's a lot but the frontier is genuinely wide. Let me rank and keep them tight. Maybe fold route scoping into Q1 objective? No — keep separate but short.

Let me define numbering:
Q1 Objective & threat model (per-customer quota vs capacity guard) — root.
Q2 Identity & key (customer-id vs IP vs both) — with the forgeability finding.
Q3 Scope of routes (POST only vs both).
Q4 Counter store (Redis vs in-memory).
Q5 Algorithm (fixed/sliding window/token bucket).
Q6 Rejection contract (429 + headers + body).
Q7 First ship mode (enforce vs shadow).

Hmm, Q7 shadow vs enforce could be considered dependent on Q6 (what rejected clients see)? No, if shadow, nothing is rejected. They're orthogonal.

But wait — is Q7 dependent on Q1? If the objective is "stop the abuse now", shadow week is a delay. Still independent decision.

Should I ask about "who owns numbers"? Depends on enterprise tier decision → later.

One more possible root: success criteria / how much headroom (limits get numbers). Numbers depend on objective and algorithm → later.

Keep round 1 to 7. Format per skill with ❓ / ➡️ / ---. Also brief preamble with facts found (repo evidence). Keep terse.

Recommendations must be decisive and evidence-backed.

For Q2, recommend: key on authenticated customer id from `x-customer-id` set/stripped by the edge; IP as secondary only for requests lacking a valid customer id (currently 401 → so actually no fallback needed; missing header already 401s). So: customer-id only, and require edge authentication; reject IP keying because enterprise NAT means shared IPs would throttle innocent customers, and rotating IPs defeats it. Good argument: 20 enterprise customers behind NAT/proxies ⇒ IP keying collides them. Fine.

For Q4: Redis. But note: session Redis is "another service's" cluster — blast radius / shared cluster risk: rate limiting writes hot keys into a cluster that holds sessions for another service; need to check isolation, cluster mode (redis cluster requires hash tags for multi-key ops), and whether the other team will accept it. That's a real question but it's about implementation risk; recommend asking the other team + separate DB index / key prefix. I'll mention.

For Q5: token bucket vs sliding window. Recommendation: token bucket (Lua in Redis) because enterprise burst legitimately and abuse is sustained volume. Fixed window allows 2x at boundary. Sliding window counter is a good middle ground and simpler than a log. I'll recommend token bucket w/ burst = 1 min worth of tokens. Hmm — for simplicity and the "ship this week", sliding-window-counter (approx) with per-second buckets is simpler and bounded memory. Token bucket needs state per customer (2 fields). Honestly token bucket is simple: hash {tokens, ts}, Lua. I'll recommend token bucket.

For Q6: 429 + Retry-After + JSON. Include `RateLimit-*`? Draft-ietf-httpapi-ratelimit-headers is now RFC? "RateLimit" fields became RFC 9867? Hmm, careful with claims. The IETF draft-ietf-httpapi-ratelimit-headers — I believe it's still a draft, recently. I'll avoid claiming RFC. Say "draft IETF RateLimit headers" and note risk: some clients treat unknown headers fine. Or just recommend standard `Retry-After` + JSON body, and skip the RateLimit-* headers in v1? I'd recommend including them because integrations can self-throttle. Keep hedged: "RateLimit-* (IETF draft)" — that's a factual claim I'm moderately sure about. Safer: "Retry-After plus a small set of x-ratelimit-* headers" without asserting standardization status. I'll phrase as "the widely used x-ratelimit-* convention (IETF draft)".

Q7: recommend shadow/log-only for 48h on one instance? With 3 instances and shared Redis, shadow mode is global. Recommend: deploy counters in log-only mode for 48–72h, inspect per-customer p99 distribution, then enforce with limits set at ~2-3x observed p99. Hmm, that's a "how" — the question is enforce vs shadow. Yes.

Also note plan says "ship this week" — shadow adds days. Call out the tension.

Should I include a question about the 40k/10min number → what limit? That's a number decision, depends on objective/algorithm/enterprise. Later round.

Also: the abuser — did they page anyone / is it still happening? That's fact, not decision. Skip.

Format: short evidence block, then questions. Use markdown. No mermaid needed.

Let me write round 1.

Keep each question body compact, multiple choice where natural.

Note the skill: "Word each question so 'yes' accepts your recommended answer." So end with something answerable by yes.

Also must not implement. Right.

Let me write.

Facts:
- `src/server.ts:7` reads `x-customer-id` straight from the request; 401 if absent. No authentication, no signature, no gateway code in repo → any client can claim any customer id.
- 3 instances, no shared state in repo; `src/db.ts` only Postgres.
- No package.json/tests/Redis client present.
- GET /orders is a select by customerId; POST inserts.

Hmm "no package.json" — Bun.serve, `bun` SQL; repo has only src + PLAN. Yes.

Now questions.

Q1 objective. Options: (a) per-customer quota to stop one tenant starving others; (b) global capacity guard on Postgres; (c) both. Recommend (a) only, v1.

Q2 key. Options: customer-id, IP, both. Recommend customer-id, authenticated at edge. Note if header is client-controlled today, customer-id keying is theatre; must confirm edge sets it. If no edge exists → this becomes prerequisite work.

Q3 route scope. POST only vs all vs separate limits. Recommend POST only, plus maybe a loose cap on GET later.

Hmm, but a script doing 40k POSTs — yes POST.

Q4 store. Recommend Redis.

Q5 algorithm. Recommend token bucket.

Q6 rejection contract. Recommend 429 + Retry-After + JSON + x-ratelimit headers. Also: should rejection happen before parsing body? Yes, order.

Q7 first ship: shadow then enforce, or enforce immediately with high limits? Recommend shadow for 48h.

Also possible Q8: does the LB preserve client IP / does it terminate? Not needed if keying on customer-id.

One more: what counts against the limit — requests or successful inserts? E.g. retries. Meh, later.

Write it.
```

### Model reply

Read `PLAN.md`, `src/server.ts`, `src/orders.ts`, `src/db.ts`. Facts that change the shape of the tree:

- `src/server.ts:7-8`: `x-customer-id` is read straight off the request and never verified. Anyone can send `x-customer-id: <any customer>` per request. Keying on it is only real if a trusted edge sets/strips it — there is no such code in this repo.
- `src/db.ts`: only Postgres. No Redis client, no `package.json`, no tests, no shared counter state anywhere.
- `POST /orders` = one `insert`; `GET /orders` = one `select` by `customerId`. No pagination, no auth beyond the header.
- "Ship this week" + 3 instances + shadow-mode observation are in tension; Q7 forces that trade.

## Round 1

❓ **Q1** - **What is this limiter actually for?**: Two different mechanisms get called "rate limiting". (a) A per-customer quota: each tenant gets a request budget, the abuser hits their own ceiling, everyone else is untouched. (b) A global capacity guard: a ceiling on total `POST /orders` throughput to protect Postgres, regardless of who is calling. They differ in key, in what happens when the store dies, and in whether a 40k-burst by a *legitimate* enterprise customer gets throttled. Which is v1?

➡️ Yes — build (a) only: per-customer quota on `POST /orders`. It directly addresses "one customer slowed everyone else" without needing a global throughput number, and a global cap is a separate decision better made after you have real traffic data.

---

❓ **Q2** - **What do you key on, given the header is currently forgeable?**: `x-customer-id` is client-supplied with zero verification in this repo. If nothing upstream authenticates it, an abuser rotating header values bypasses any per-customer limit, and honest customers behind the same NAT would be hurt by IP keying. Options: (a) key on `x-customer-id`, on the precondition that the load balancer or an auth layer sets it and strips client values; (b) key on client IP; (c) both, e.g. customer-id plus an IP ceiling.

➡️ Yes — key on `x-customer-id` alone, **and treat "the edge authenticates and overwrites this header" as a hard prerequisite, not an assumption**. IP keying is worse here: 20 enterprise integrations plausibly sit behind shared egress IPs, so IP buckets collide innocent tenants while doing nothing against a rotating-IP script.

---

❓ **Q3** - **Which routes are limited?**: `POST /orders` is the expensive call; `GET /orders` is a cheap indexed select. Options: (a) limit `POST /orders` only; (b) limit both with separate budgets; (c) one shared budget across both.

➡️ Yes — `POST /orders` only in v1. A separate, much higher `GET` budget is a follow-up; sharing one budget lets a read-heavy dashboard lock a customer out of writes.

---

❓ **Q4** - **Where do counters live?**: Three instances behind round-robin. In-memory counters mean each instance tracks its own bucket, so the effective limit is 3× the configured number, and every deploy resets everyone's budget. Redis gives one shared view but adds a network hop on the hot path, and the cluster belongs to another service.

➡️ Yes — Redis, one key namespace per limit dimension, with a distinct key prefix (and ideally a separate logical DB) so you never touch the session keyspace. In-memory is only defensible if you accept a 3× fuzzy limit and silent resets on deploy, which makes the whole "who owns the enterprise numbers" question unanswerable.

---

❓ **Q5** - **Which algorithm?**: (a) Fixed window — one counter per minute, trivial, but allows 2× burst at the boundary (40k can land as 20k at :59.9 and 20k at :00.1). (b) Sliding window — smooths the boundary, needs either a log (memory grows with traffic) or a two-bucket weighted approximation. (c) Token bucket — a steady refill rate plus a burst capacity, so an enterprise integration can legitimately spike and then settle.

➡️ Yes — token bucket. It makes "rate" and "burst" two separate knobs, which is exactly the distinction your 20 bursting enterprise customers need, and it is two fields per customer (`tokens`, `last_refill_ts`) atomically updated with a short Lua script.

---

❓ **Q6** - **What does a rejected client see?**: The integrations are scripted, so the response is a contract, not cosmetics. Options: bare `429`; `429` + `Retry-After`; `429` + `Retry-After` + JSON body; plus `x-ratelimit-*` headers on *every* response so clients can self-throttle before they get rejected.

➡️ Yes — `429`, `Retry-After` in whole seconds, JSON body `{"error":"rate_limited","retryAfterSeconds":N}`, and `x-ratelimit-limit/remaining/reset` on all `POST /orders` responses. Check the bucket before `await req.json()` and before touching Postgres, so a rejected request costs one Redis round-trip.

---

❓ **Q7** - **First ship: reject or only observe?**: "Ship this week" argues for enforcing immediately. But you do not yet know the real per-customer request distribution, so any limit you pick is a guess that may 429 a paying enterprise integration on day one.

➡️ Yes — ship in **log-only mode first**: compute and log the would-be decision plus per-customer rates for ~48h, pick limits at roughly 2–3× observed p99, then flip to enforcement behind a per-customer allowlist for the enterprise accounts. Treat "this week" as shipping the *instrumented* limiter, not the enforcing one.

---

Answer Q1–Q7 (or "yes" per question, or override). Round 2 covers what these settle: failure mode when Redis is down, enterprise tier mechanics and number ownership, the actual limit values, Redis cluster/ownership constraints with the other service, and the staged rollout plan.

