## Person: `/skill:grilling Grill me on the unresolved decisions in PLAN.md. Do not implement the plan.`

omp injected the skill as a user-attributed message: its first line, then the 25 lines of `grilling/SKILL.md`.

```text
[IMPORTANT: User invoked the "grilling" skill; follow its instructions. Full skill below.]
```

### Model reasoning

```text
I'm starting by reviewing the plan and understanding what the skill entails.
```

- tool `read` PLAN.md

- tool `read` skill://grilling

### Model reasoning

```text
Let's check the repository context — files like src/server.ts, the load balancer configuration, etc. Shouldn't ask the user things that I can look up myself. Let's list the directory and read src/server.ts.

```

- tool `read` .

### Model reasoning

```text
This is a pure coding question. Files: server.ts, db.ts, orders.ts. Let's read all three, gather facts, and build a foundation for questions.

```

- tool `read` src/server.ts

- tool `read` src/orders.ts

- tool `read` src/db.ts

### Model reasoning

```text
Alright, let me map out the design tree. PLAN.md has 7 open items:

1. Key: x-customer-id, IP, or both?
2. Algorithm: fixed window, sliding window, token bucket?
3. Counter storage location: Redis or in-memory?
4. Behavior when Redis is unavailable: fail-open or fail-closed?
5. Enterprise-facing higher limits + who owns the values.
6. What a rejected client sees (429, Retry-After, rate-limit headers?)
7. Rollout without breaking enterprise integrations.

Facts discovered from the codebase: all requests already require `x-customer-id` and return 401 if missing — so unauthenticated/IP-only traffic cannot reach the handler. This is a relevant fact for Q1: keying on IP is almost pointless since every request must have a customer ID. But can customers spoof x-customer-id? There's no auth mechanism visible in this snippet beyond header presence. This raises a sub-question: is x-customer-id trusted (i.e., is there auth somewhere upstream)? That's a fact about their infra… not in code. Can't look it up, so I ask the user. Hmm — but per skill, fact-finding is my job, decisions are theirs. Whether the header is authenticated is an infra fact not in the repo; the repo just checks presence. I could ask but should note that the code only checks header presence.

Also runtime is Bun.serve. Redis is "Redis 7 cluster" — being a cluster matters for multi-key atomic ops (Lua scripts in cluster mode need keys in same slot / hash tags). Another fact: which client (bun has redis support — Bun uses `Bun.redis`? Actually Bun doesn't have built-in Redis; there's the ioredis npm package). Not needed for interview.

Also 3 instances behind round-robin LB: in-memory counters divide effective limit by instance (each instance counts its own share) unless sticky; bursty clients on round-robin would get ~limit/3… Actually with in-memory fixed windows, effective limit becomes 3× configured if you apply full limit per-instance, or if you divide you undercount. That's an argument for Redis for global correctness.

Design tree, root: what do we need to protect? Incident: one customer's script creating 40k orders in 10 min slowed others → resource exhaustion on Postgres via POST /orders. So scope: limit POST only? Or GET too? The plan says POST expensive, GET cheap — sub-decision: do we limit GET at all? That hangs off "what are we limiting" — actually the PLAN doesn't list this as open but it's implicitly needed. The user said "grill me on the open items in PLAN.md" — so focus on the 7 open items and decisions hanging off them. The scope question (limit GET too?) is a prerequisite for algorithm / limit values… could be considered part of the tree. Since it's an implicit assumption ("nothing silently assumed"), include it in round 1.

Dependency analysis for round 1 frontier:

- Key (Q1) depends on: is x-customer-id trustworthy? (an infra fact the user knows). And whether we care about unauthenticated flood (current code returns 401 so handler already gates; flood protection at LB level is out of scope).
- Algorithm (Q2) depends on scope (which endpoints), whether burst is allowed (enterprise bursts legitimately) — burst-tolerance is a requirement that shapes algorithm choice. Actually enterprise burst tolerance is a direct argument for token bucket. But algorithm choice is mostly independent of key.
- Counter storage (Q3) depends on: do we need global correctness across instances? That depends on… whether limits are per-customer global (yes, probably) → Redis. Q3 depends on accuracy requirement: is "customer gets exactly N orders per minute across all instances" required vs "roughly N"? That's a user decision I can ask now as part of Q3's framing.
- Fail behavior (Q4) depends on Q3 (fail-open matters only if Redis is on the hot path; if in-memory, failure mode is different). So Q4 is slightly downstream. But even if we chose in-memory… Redis failure mode doesn't exist. So Q4 belongs to later round if Q3 goes memory. But realistically I could ask Q4 as "if Redis is on path…" — no, a frontier rule says: Q4 depends on Q3 which is open this round → later round. Hmm but that's overly rigid: Q4's dependency is really "counter store = Redis", and PLAN.md already frames "counter storage unreachable" as an open item assuming remote store. I think it's fine to ask it conditional on Redis, but the skill explicitly says: questions whose answers depend on an open question in the round belong to a later round. I'll follow: Q4 (fail-open/closed) waits for Q3.
- Enterprise tiers (Q5): depends on key (Q1) somewhat (limits are keyed per customer) and on algorithm (burst parameters). Sub-decision: config source (env, DB, file) and who owns numbers (product vs support vs SRE). The "who owns numbers" part is independent. But mechanism (static config vs per-customer overrides) is… keying is per customer either way. Can I ask ownership now and defer mechanism? Ownership + burst tolerance now, mechanism in a later round.
- Rejection response (Q6): mostly independent: 429 + Retry-After + headers. Can hang off algorithm (Retry-After accuracy depends on window type). But I can ask about shape: status code + headers yes/no, whether we care about client compatibility. Q6 depends on algorithm on the details (can we compute Retry-After). Still I could ask about the basics: "will you return 429 with standard headers?" — enterprise integrations' expectations (do their clients handle 429? do they need headers?) is a fact/decision I could ask now. Include Q6 now at the level of status code and header policy; details of Retry-After later after algorithm settled. Hmm, simpler: ask the whole thing now with recommendation 429 + Retry-After + rate-limit headers; note some details depend on algorithm. But the rule… Retry-After works with any algorithm. Include it.
- Rollout (Q7): depends on almost everything (limits, tiers, behavior). Later round: shadow mode vs warn-only, canary, notification timeline. Rollout also depends on "does rollout require customer notification?" Rollout sub-questions depend on Q5/Q6 answers. Push to round 2/3.
- Scope: apply rate limit to GET too? Round 1.
- Trust in x-customer-id: a fact user knows (no auth layer in repo beyond header presence). Ask as part of Q1 framing, or as standalone Q. The key decision depends on it, so standalone frontier question: "is x-customer-id authenticated anywhere, or trusted?" Actually if it's spoofable, keying on it lets attacker spoof to evade limit — but attacker could also spoof to hit other customer's limit, and POST needs the header anyway. Make it Q1a: header trust.

- Current volume/limit values: what are the limit values themselves? PLAN doesn't list "what is the limit value" as open — implicitly assumed. "Nothing silently assumed" → ask: do we have a number? Per-endpoint limit values are a decision. Include: "what's the normal legitimate POST rate per customer (orders/min)?" — that's a fact only user has. Ask as a Q.

Round 1 frontier:
1. Scope: POST only, or both GET/POST (different budgets)?
2. Header trust: is x-customer-id authenticated upstream or just trusted?
3. Key decision (partly depends on Q2… hmm). Key decision depends on trust answer. But I can frame Q3 as "if header is trusted → key on customer ID; if not → IP as secondary signal?" — that depends on open Q2. Per rules, defer? Trust answer is probably "trusted" and key answer would be customer ID… but to be safe I fold trust into the key question: "key on x-customer-id — note current code requires it for all requests so IP-based limiting adds nothing unless you want to throttle spoofed/missing-ID floods before the 401. Do you have any auth upstream that makes this header trustworthy?" That's two asks in one. Better: Q2 = decision to key on customer ID; body mentions the trust fact; if header is not authenticated and they want IP too, they'll say so. Also 401 responses already return unthrottled — attacker hammering without header hits cheap path (Postgres not touched) — probably fine. OK, fold it in.
4. Algorithm: token bucket vs sliding-window log vs fixed window. Body: enterprise legitimately bursts (favor token bucket), Redis atomicity (fixed window easy via INCR; sliding log heavier; token bucket doable via Lua or Redis-time). Recommendation: token bucket.
5. Counter storage: global accuracy requirement: per-customer limit across the 3 instances, or per-instance acceptable? Redis 7 cluster caveat: Lua needs same-slot keys → hash tags per customer. Recommend Redis.
6. Enterprise: burst-tolerance requirement + who owns the numbers (per-customer override, config where). Two parts; keep as one Q: "How much headroom does enterprise need — uniform higher tier or per-customer overrides? Who owns/approves the numbers?" Recommendation: per-customer override table (Redis hash or Postgres row), owned by support/CS.
7. Rejection contract: 429 + Retry-After + rate-limit headers? Recommendation yes standard headers.
8. Limit values: what are the values / what data do we have? E.g., median/p99 enterprise legit POST rates. That's a fact they might know or derive from logs. Ask: do you have traffic distribution so we can set numbers, or do we pick initial conservative values?
9. Scope for which endpoints (above #1).

Also: 401 path — requests missing x-customer-id are currently not limited; do we care about cheap 401 floods? Fold into key question.

Dependencies to defer to later rounds:
- Fail-open vs fail-closed → depends on counter storage (round 2).
- Retry-After exact semantics → depends on algorithm (round 2 if details matter; basic headers now).
- Rollout plan details → depends on tiers, response contract, values (round 2/3).
- Config mechanism for overrides → partly depends on tier decision (round 2).
- Client notification policy → rollout (round 3).
- Metrics/observability: how do we know limit values are right, who gets paged on Redis failure — hmm, PLAN doesn't list; a legit branch (e.g., logging rejections, shadow-mode counting). Could be its own node in round 2 ("do we log/emit metrics on rejections?").

Also, the "this week" ship timeline is a constraint on rollout — rollout question.

Let me format round 1 in the skill's format. Word questions so "yes" accepts my recommendation. Then use the `ask` tool — wait, skill formats the round as chat text ("❓ Q1 -"). But system prompt says all questions must go through `ask`. Conflict? The skill's format guidance says "format the round like this…" — the ask tool description says to inherit content, order, recommendation and follow the skill's interview instructions via ask. So I should use `ask` with each question as a tab, header = short title, question body, options, brief (where/what/how), recommended index. The text format shown by the skill is how it'd be presented in chat if there were no dialog. ask tool is explicit: "If any skill… instructs you to ask or interview, you MUST use it."

So I build an ask call with ~7 questions. Each: id, header, question, options (≥2), brief {where, what, how}, recommended, optional evidence.

Let me draft questions:

Q1 scope — "Which endpoints do we budget?" Options:
- POST /orders only (recommended): protects Postgres, GET is cheap; leave GET unthrottled for now.
- Separate budget for both POST and GET.
Body: incident was POST-driven, GET is cheap but listOrders does unbounded SELECT * … actually GET per customer scans orders — a fast GET loop could also load Postgres (indexed? unknown). Hmm, listOrders' `select * from orders where customerId` — unbounded rows per customer, grows over time; GET flood also hits DB. Still recommend POST-only for now? Recommend: separate tighter budget for both POST only… keep recommendation "POST only" but note GET also hits Postgres; ask if GET budget is wanted. Options: (a) POST only (b) POST + GET with separate budgets (c) single combined budget. Recommend (a)? Given listOrders also hits Postgres and a customer's script could hammer GET, (b) is defensible. Recommendation (b)? Skill says word so "yes" = recommended. Let me think: cheapest correct: limit POST (expensive writes) now, GET… but incident was writes. Keep recommendation (a), note if GET also reaches Postgres, a generous GET-only budget is a later branch. Hmm — this "generous GET budget" detail is… make it (b) and settle it now. Go with (b) with recommendation: separate budget per endpoint class, generous limit for GET. No wait — don't overcomplicate; the tree: scope is a prerequisite for values and algorithm state count (two buckets per customer = two Redis keys, cluster hash tags same slot fine). Either way it's my call to present. Go with (b) with recommendation: separate budget per endpoint class, GET generous.

Q2 key — "Key on x-customer-id?" Body: server already 401s missing header, so all traffic reaching handler has ID; IP adds nothing for authenticated traffic but would throttle headerless 401 floods which are cheap anyway (no DB touch… actually just header check, cheap). Also: is the header authenticated upstream? Missing auth = spoofable = limit evasion (attacker rotates fake customer IDs — but creating a fake ID doesn't create orders? createOrder works with any x-customer-id! So spoofing is already a bigger issue than rate limiting). Options: (a) x-customer-id only (recommended), (b) both with per-customer + per-IP, (c) IP only. Recommend (a).

Q3 algorithm — options: token bucket (recommended), sliding window log, sliding window counter, fixed window. Body: enterprise bursts legitimately → bucket with burst capacity handles it; fixed window punishes bursts and allows 2x at boundaries; sliding log accurate but heavier; token bucket in Redis via Lua, refill rate continuous. Recommend token bucket with configurable rate + burst.

Q4 counter storage — options: Redis (recommended), per-instance in-memory, hybrid (local + Redis sync). Body: 3 instances round-robin; in-memory ⇒ effective global limit is up to 3x configured, bursty client gets unfair per-instance allowance; correctness demand: is limit per-customer global? Redis 7 cluster note: Lua scripts need keys in same hash slot → `{customerId}` tag. Also: this Redis is another service's session store — sharing = ownership / noisy-neighbor / blast radius question. Add option (c) "another Redis we own". Recommend Redis with hash tag + dedicated key prefix and short TTLs.

Q5 enterprise tiers — sub-question: mechanism (uniform "enterprise tier" vs per-customer override) and ownership. Options: (a) per-customer override, owned by CS/support and stored in Postgres config table, cached (recommended), (b) uniform enterprise multiplier, (c) config file edited by SRE. Body: PLAN leaves "who owns numbers" open. Recommendation: per-customer overrides, support owns, change via PR/ticket.

Q6 rejection response — options: (a) 429 + Retry-After + RateLimit-* headers (recommended), (b) bare 429 no headers, (c) 202 queue / delay… Body: do enterprise clients handle 429 today? Retry-After + standard draft headers let well-behaved scripts back off. JSON error body shape consistent? Recommend (a) with JSON body {error:"rate_limited"}.

Q7 limit values — "Do we have data to set numbers, or do we pick safe initial values?" Options: (a) start with generous observed-safe values and tune via metrics before enforcement (recommended), (b) derive p99 from logs first, (c) … actually this pairs with rollout (shadow mode). Maybe fold into rollout? Rollout depends on Q4, Q6 answers, so defer. But data availability is a fact I can ask about now… better ask now: "what legitimate peak does an enterprise integration do (orders/min)?" — that's a fact only user has. Include as Q7: enterprise legitimate burst magnitude — what's the peak orders/min we must not break? This is a fact not a decision — skill says fact-finding is my job for things discoverable by tools; user-only knowledge is fine to ask ("facts only they know" is listed under what ask is for). OK: Q7 fact: typical enterprise legitimate POST peak (orders/min). And 40k/10min offender: any abuse vs bug consideration… keep Q7 simple.

That's the round 1 frontier: 7 questions. Deferred: fail mode (needs Q4), rollout (needs Q5/Q6/Q7), Retry-After exactness (Q3, minor — mostly settled in Q6 now), key/namespace + TTL details maybe (implementation choice mine), metrics/logging (rollout needs). Client notification too.

ask tool: up to 5 options each; each needs label + tradeoff; recommended is index. Brief needs where/what/how. Evidence: PLAN.md line, can cite server.ts line.

Round structure: send 7 questions in one ask call? Skill: "ask all frontier questions in one round." One ask call = one dialog with tabs — good.

Write it tight. Working dir /tmp/askmore-grill.

Header (short): "Scope", "Limit key", "Algorithm", "Counter store", "Enterprise tiers", "Rejection shape", "Burst facts".

Now let me draft each question JSON.

Q1 scope:
id "scope", header "Endpoint scope"
question: "PLAN.md only names POST /orders as expensive, but GET /orders also hits Postgres — `listOrders` does an unbounded `select *` per customer. Do we rate-limit both endpoints, each with its own budget?"
options:
1. label "POST + GET, separate budgets", tradeoff "One extra bucket per customer; protects Postgres from read floods.", description "Generous GET budget, tight POST budget.", recommended.
2. label "POST only", tradeoff "Simpler; GET floods still hit Postgres directly."
3. label "Shared budget for both", tradeoff "One bucket; a customer's normal GET polling eats POST headroom."
brief: where: "src/server.ts:10-16 both POST and GET reach Postgres; src/orders.ts:16-18 listOrders does an unbounded select * per customer." what: "Which endpoints get budgets, and whether one or two counters per customer (changes Redis key count and rollout checks)." how: "Two budgets: token-bucket params x2, 2 keys per customer (same hash slot). POST-only: leave read path unprotected — revisit if GET shows up in incident."

Q2 key:
question: "Server already 401s every request without x-customer-id, so all traffic reaching the handler has an ID. Do we key on x-customer-id alone? (Aside: nothing in this code authenticates the header — if it's spoofable upstream, fake IDs already let a caller insert orders for any customer; rate limiting can't fix that. Note if there's an auth layer in front.)"
options:
1. "Key on x-customer-id only" — tradeoff "Exact per-customer fairness; 401 flood isn't limited but doesn't touch Postgres." recommended
2. "Both customer and IP" — "IP bucket catches headerless/bursty sources; extra complexity, and IP behind LB may be wrong (needs LB to pass real client IP — does round-robin LB pass it?)"
3. "IP only" — "Penalizes shared-office customers; pointless since header is required."
brief: where "src/server.ts:7-8 header presence check, 401 on missing." what … how …

Q3 algorithm:
question: "20 enterprise customers burst legitimately; boundaries of fixed window double-allow and punish bursty-but-fair clients. Sliding window logs keep per-request timestamps; token bucket refills continuously and natively allows a burst up to bucket capacity. Token bucket with per-customer configurable rate + burst?"
options:
1. "Token bucket" — "Matches burst-allowed requirement; needs atomic Lua / script against Redis, but one round trip per decision." recommended
2. "Sliding window counter (approximate)" — "Simple INCRs on two buckets; allows some overshoot, no burst control beyond the window."
3. "Fixed window" — "Simplest but 2x-at-boundary and kills legitimate bursts."
… max 5 options, fine.

Q4 counter store:
question: "3 instances round-robin: an in-memory counter means each instance grants the full allowance, effectively up to 3x configured limit globally, unless you divide by instance count — which under-throttles when a customer's traffic skews to one instance. Do we keep the bucket in the shared Redis with `{customerId}` hash tag for atomic Lua, and request a separate logical DB / prefix rather than the session keys?"
Hmm Redis cluster: no multiple DBs in cluster. Prefix + ownership conversation. Option "ask owning team for a dedicated Redis / confirm we can use theirs" as third option.
options:
1. "Redis, hash-tagged keys" — "Globally exact limits; adds Redis to request path (failure mode is next round). Cluster Lua needs `rl:{customerId}` tag." recommended
2. "Per-instance memory" — "No network hop, fail-local; global limit is fuzzy up to 3x."
3. "Dedicated Redis we own" — "Clean blast radius; procurement may not fit 'this week'."
brief where: PLAN.md:8 "Redis 7 cluster used by another service's sessions".

Q5 enterprise tiers:
question: "Do we do per-customer override (stored in Postgres, loaded/cached at startup, owned by CS/support, changed via ticket/PR) rather than a uniform 'enterprise multiplier' or SRE-edited config files?"
options:
1. Per-customer overrides, CS/support owned — "Handles 20 known bursts precisely; needs an approval path and a review cadence." recommended
2. Uniform enterprise tier — "One number, fast to ship; over- or under-provisions individual customers."
3. Config file owned by SRE — "No new table; every adjustment is a redeploy / LB-adjacent change."
brief where: PLAN.md:10,18.

Q6 rejection response:
question: "429, Retry-After (seconds), and draft RateLimit limit/remaining/reset headers, plus a JSON body `{error: "rate_limited", ...}`, or bare 429?"
options:
1. "429 + Retry-After + RateLimit headers" — "Well-behaved scripts back off automatically; small extra work." recommended
2. "Bare 429" — "Minimum; enterprise scripts busy-retry, making Postgres load worse."
3. "429 + Retry-After only" — "Backoff without full quota visibility."
brief: where server.ts: response is plain text / Response.json; PLAN.md:19.

Q7 burst fact:
question: "I need one number from you: what's the legitimate peak from the biggest enterprise integration (orders/min or orders/sec)? The offender did ~67/s. If we don't know, what's our upper-bound estimate?"
Options: give as ranges? Question with options as possible answers is weird but fine:
1. "I don't have the data yet — pick a generous value and shadow-measure" (recommended) tradeoff "Rollout has to start in shadow mode to get numbers."
2. "Roughly 10 orders/s or less"
3. "More than that; I'll write the exact value." — hmm, options are 2+; user can type their own answer. Keep: (a) unknown → measure in shadow mode, (b) known: enter value. Recommend (a)? Recommendation should be concrete. Recommend (a).

OK. Then per system prompt round text format? Skill format block shows chat Markdown, but ask tool takes over presentation ("all questions needing user answer MUST use ask"). So I use ask, and I may briefly state that I've mapped the tree + what's deferred (fail mode, rollout) pending these.

Build the ask call. Ensure unique ids. Evidence paths relative: "src/server.ts", "PLAN.md".

Round structure: one ask call with 7 questions. Each needs label + tradeoff; recommended is index; brief needs where/what/how. Working directory /tmp/askmore-grill.

Now compose. Each brief: where = current facts, what = decision + why can't resolve in code, how = consequences.
```

### Model reply

Repo facts gathered: `server.ts` 401s anything without `x-customer-id` (header presence is the only gate — no auth in this code), `GET /orders` also hits Postgres via unbounded `select *`, runtime is Bun, 3 round-robin instances, shared Redis 7 **cluster** (Lua there needs same-hash-slot keys).

Design tree mapped. Round 1 = the frontier: endpoint scope, key, algorithm, counter store, tier mechanism + ownership, rejection shape, one fact only you have (enterprise burst size). Deferred to later rounds until these settle: fail-open/fail-closed (depends on counter store), rollout + shadow mode + notification (depends on tiers, rejection shape, burst fact), exact `Retry-After` semantics.



### ask call

```json
{"questions":[{"id":"scope","question":"PLAN.md calls POST expensive, but GET /orders also hits Postgres — listOrders is an unbounded `select *` per customer, and customers today poll it. Do we set separate budgets on both endpoints (generous GET, tight POST)?","header":"Endpoint scope","brief":{"where":"src/server.ts:10-16 — both routes reach Postgres; src/orders.ts:16-18 — listOrders does an unbounded per-customer SELECT *.","what":"Which endpoint classes get budgets, and whether there is one or two counters per customer. Not answerable from code: whether GET flood is a risk you accept.","how":"Separate budgets: two token buckets per customer, both keys under one `{customerId}` hash slot. POST-only: read path stays unprotected — a GET flood becomes next week's incident."},"options":[{"label":"Both endpoints, separate budgets","tradeoff":"Two buckets per customer; protects Postgres from read floods too.","description":"Generous GET limit, tight POST limit","holds_when":"listOrders' unbounded SELECT makes GET a real Postgres cost.","cost":"2 Redis keys + 2 bucket configs per customer"},{"label":"POST only","tradeoff":"Simplest; GET floods still reach Postgres unthrottled."},{"label":"One shared budget","tradeoff":"One counter; normal GET polling eats the customer's POST headroom — wrong shape for enterprise scripts."}]},{"id":"key","question":"Every request reaching the handler already carries x-customer-id (missing → 401, cheap, never touches Postgres). Do we key the limit on x-customer-id alone? One aside to correct if wrong: nothing in this code authenticates the header — if callers can forge it today, they can already insert orders for any customer, and rate limiting won't fix that. Is there an authn layer upstream?","header":"Limit key","brief":{"where":"src/server.ts:7-8 — presence check only, no authn. PLAN.md:14.","what":"Key granularity and whether IP adds protection. Depends on whether the header is trusted, which only you know.","how":"Customer-only: exact per-customer fairness. Customer+IP: needs the round-robin LB to actually forward real client IP — if it doesn't, IP buckets group whole customer offices."},"options":[{"label":"x-customer-id only","tradeoff":"Exact per-customer fairness; unauthenticated 401 floods stay unlimited but never reach Postgres.","description":"Header is authenticated upstream (or trust it for now)","holds_when":"All handler traffic has an ID anyway; 401 path is a no-op check."},{"label":"Customer and IP","tradeoff":"Catches ID-rotating floods; doubles state, and is wrong unless the LB forwards real client IPs."},{"label":"IP only","tradeoff":"Punishes shared-office customers; pointless since the ID is required on every call."}]},{"id":"algorithm","question":"You have 20 enterprise customers who legitimately burst. Fixed window double-allows at boundaries and punishes exactly those bursty-but-fine clients; sliding-window-log is precise but stores per-request timestamps. Token bucket with per-customer refill rate + burst capacity matches 'legitimate bursts' natively. Token bucket?","header":"Algorithm","brief":{"where":"PLAN.md:15; PLAN.md:10 says enterprise integrations legitimately burst.","what":"Which counter math; decides burst behavior, Redis cost per request, and what Retry-After can even mean.","how":"Token bucket: one atomic Lua eval per request, burst = bucket capacity, tunable per customer. Fixed window: cheapest to write, but boundary bursts of 2×N will break enterprise scripts on the hour."},"options":[{"label":"Token bucket","tradeoff":"Native burst allowance, continuous refill, one Redis round-trip per check; needs Lua in cluster with hash-tagged keys.","holds_when":"Burst-friendly behavior is a requirement, not a nice-to-have."},{"label":"Sliding window counter","tradeoff":"Approximate, two INCRs, no real burst semantics."},{"label":"Fixed window","tradeoff":"Simplest code; 2× at boundaries and throttles legitimate bursts."}]},{"id":"store","question":"With 3 round-robin instances, in-memory counters mean each instance grants the full allowance → effective global limit up to 3× config, and dividing by 3 under-throttles any customer whose traffic skews to one instance. Do we keep buckets in the existing shared Redis, keys hash-tagged like `rl:{customerId}` so the Lua is cluster-legal, with a dedicated `rl:` prefix and short TTLs? And have you actually asked the session-store team whether you may write there?","header":"Counter store","brief":{"where":"PLAN.md:7-8 — Redis 7 cluster, round-robin across 3 instances; it belongs to another service (sessions).","what":"Global correctness vs zero-dependency fuzziness, and blast-radius ownership of a shared cluster. A rate-limiter evicting session keys would be worse than the original incident.","how":"Redis: exact global limits, and this choice makes 'what if Redis is down' a live question next round. Memory: no new failure mode on the hot path, limits stay fuzzy within ~3×."},"options":[{"label":"Shared Redis, hash-tagged","tradeoff":"Exact global limits; adds Redis to every request's hot path and shares a cluster with sessions — needs the owning team's OK.","holds_when":"Session team agrees to the extra load and an eviction-policy check."},{"label":"Per-instance memory","tradeoff":"No network hop, no new failure mode; global limit fuzzy up to 3×, per-customer tuning divides by 3."},{"label":"New dedicated Redis","tradeoff":"Clean ownership and blast radius; procurement/may not fit 'this week'.","cost":"Infra lead time"}]},{"id":"tiers","question":"For the 20 enterprise customers: per-customer overrides — a small Postgres table (or same-source config) read into cache at startup, numbers owned by support/CS, changed via ticket — rather than a uniform 'enterprise multiplier' or an SRE-edited config file? And confirm: is support/CS actually the right owner of those numbers, or you?","header":"Enterprise tiers","brief":{"where":"PLAN.md:10, PLAN.md:18 — higher limits and ownership both undecided.","what":"Override granularity, storage mechanism, and who signs off on numbers. Ownership is organizational; code can't answer it.","how":"Per-customer overrides absorb the spread between a 10/s script and a 60/s script; a uniform multiplier mis-sizes most of them. Ownership decides whether limit changes need a deploy or a ticket."},"options":[{"label":"Per-customer overrides, CS-owned","tradeoff":"Precise, no deploys to adjust; requires an approval path so numbers don't drift per-request.","cost":"config table + cache refresh"},{"label":"Uniform enterprise tier","tradeoff":"One number, shippable today; over-provisions some, breaks others."},{"label":"Config file, SRE-owned","tradeoff":"No new table; every adjustment is a redeploy of all 3 instances."}]},{"id":"rejection","question":"What does a rejected request return: 429 with Retry-After (seconds), the draft RateLimit limit/remaining/reset headers, and a JSON body like `{\"error\":\"rate_limited\"}` — or a bare 429?","header":"Rejection shape","brief":{"where":"PLAN.md:19; server.ts currently returns Response.json for success, plain text for errors.","what":"The public contract. Enterprise scripts may treat non-2xx as hard failure, or busy-retry a bare 429 and make Postgres load worse than the original incident.","how":"Retry-After + RateLimit headers let well-behaved scripts back off automatically. Bare 429 assumes their retry logic copes — unverified. If you know any enterprise client crashes on 429, say so now."},"options":[{"label":"429 + Retry-After + RateLimit headers","tradeoff":"Auto-backoff for good clients, debuggable; tiny extra work.","description":"JSON error body too","holds_when":"You can't audit 20 integrations' 429 handling before Friday."},{"label":"Bare 429","tradeoff":"Minimal surface; busy-retry loops likely, amplifying load."},{"label":"429 + Retry-After only","tradeoff":"Backoff without exposing quota numbers you haven't finalized."}]},{"id":"burst","question":"One number only you has: what peak legitimate orders/second does the biggest enterprise integration actually hit today? The offender did ~67/s. If nobody knows, is your answer 'pick generous defaults and measure in shadow mode before enforcing'?","header":"Burst size fact","brief":{"where":"PLAN.md:3 — incident at 40,000 orders/10 min ≈ 67/s; PLAN.md:10 — enterprise bursts unquantified.","what":"The default rate/burst numbers, or whether we must measure first. No log access here; only you or shadow mode can answer.","how":"Known peak → defaults sized ~2× above it, enforce sooner. Unknown → limits start in shadow mode (count, don't reject) purely to collect this fact; that pushes shadow mode into the rollout round."},"options":[{"label":"Unknown — measure in shadow","tradeoff":"Correct numbers eventually; enforcement slips by the shadow window (days).","recommended-":null}],"recommended":0}]}
```

### ask result

```text
Validation failed for tool "ask":
  - questions/6/options: questions[6].options must be at least length 2 (was 1)

Received arguments:
{
  "original": {
    "questions": [
      {
        "id": "scope",
        "question": "PLAN.md calls POST expensive, but GET /orders also hits Postgres — listOrders is an unbounded `select *` per customer, and customers today poll it. Do we set separate budgets on both endpoints (generous GET, tight POST)?",
        "header": "Endpoint scope",
        "brief": {
          "where": "src/server.ts:10-16 — both routes reach Postgres; src/orders.ts:16-18 — listOrders does an unbounded per-customer SELECT *.",
          "what": "Which endpoint classes get budgets, and whether there is one or two counters per customer. Not answerable from code: whether GET flood is a risk you accept.",
          "how": "Separate budgets: two token buckets per customer, both keys under one `{customerId}` hash slot. POST-only: read path stays unprotected — a GET flood becomes next week's incident."
        },
        "options": [
          {
            "label": "Both endpoints, separate budgets",
            "tradeoff": "Two buckets per customer; protects Postgres from read floods too.",
            "description": "Generous GET limit, tight POST limit",
            "holds_when": "listOrders' unbounded SELECT makes GET a real Postgres cost.",
            "cost": "2 Redis keys + 2 bucket configs per customer"
          },
          {
            "label": "POST only",
            "tradeoff": "Simplest; GET floods still reach Postgres unthrottled."
          },
          {
            "label": "One shared budget",
            "tradeoff": "One counter; normal GET polling eats the customer's POST headroom — wrong shape for enterprise scripts."
          }
        ]
      },
      {
        "id": "key",
        "question": "Every request reaching the handler already carries x-customer-id (missing → 401, cheap, never touches Postgres). Do we key the limit on x-customer-id alone? One aside to correct if wrong: nothing in this code authenticates the header — if callers can forge… [truncated 127 chars]",
        "header": "Limit key",
        "brief": {
          "where": "src/server.ts:7-8 — presence check only, no authn. PLAN.md:14.",
          "what": "Key granularity and whether IP adds protection. Depends on whether the header is trusted, which only you know.",
          "how": "Customer-only: exact per-customer fairness. Customer+IP: needs the round-robin LB to actually forward real client IP — if it doesn't, IP buckets group whole customer offices."
        },
        "options": [
          {
            "label": "x-customer-id only",
            "tradeoff": "Exact per-customer fairness; unauthenticated 401 floods stay unlimited but never reach Postgres.",
            "description": "Header is authenticated upstream (or trust it for now)",
            "holds_when": "All handler traffic has an ID anyway; 401 path is a no-op check."
          },
          {
            "label": "Customer and IP",
            "tradeoff": "Catches ID-rotating floods; doubles state, and is wrong unless the LB forwards real client IPs."
          },
          {
            "label": "IP only",
            "tradeoff": "Punishes shared-office customers; pointless since the ID is required on every call."
          }
        ]
      },
      {
        "id": "algorithm",
        "question": "You have 20 enterprise customers who legitimately burst. Fixed window double-allows at boundaries and punishes exactly those bursty-but-fine clients; sliding-window-log is precise but stores per-request timestamps. Token bucket with per-customer refill rat… [truncated 70 chars]",
        "header": "Algorithm",
        "brief": {
          "where": "PLAN.md:15; PLAN.md:10 says enterprise integrations legitimately burst.",
          "what": "Which counter math; decides burst behavior, Redis cost per request, and what Retry-After can even mean.",
          "how": "Token bucket: one atomic Lua eval per request, burst = bucket capacity, tunable per customer. Fixed window: cheapest to write, but boundary bursts of 2×N will break enterprise scripts on the hour."
        },
        "options": [
          {
            "label": "Token bucket",
            "tradeoff": "Native burst allowance, continuous refill, one Redis round-trip per check; needs Lua in cluster with hash-tagged keys.",
            "holds_when": "Burst-friendly behavior is a requirement, not a nice-to-have."
          },
          {
            "label": "Sliding window counter",
            "tradeoff": "Approximate, two INCRs, no real burst semantics."
          },
          {
            "label": "Fixed window",
            "tradeoff": "Simplest code; 2× at boundaries and throttles legitimate bursts."
          }
        ]
      },
      {
        "id": "store",
        "question": "With 3 round-robin instances, in-memory counters mean each instance grants the full allowance → effective global limit up to 3× config, and dividing by 3 under-throttles any customer whose traffic skews to one instance. Do we keep buckets in the existing s… [truncated 207 chars]",
        "header": "Counter store",
        "brief": {
          "where": "PLAN.md:7-8 — Redis 7 cluster, round-robin across 3 instances; it belongs to another service (sessions).",
          "what": "Global correctness vs zero-dependency fuzziness, and blast-radius ownership of a shared cluster. A rate-limiter evicting session keys would be worse than the original incident.",
          "how": "Redis: exact global limits, and this choice makes 'what if Redis is down' a live question next round. Memory: no new failure mode on the hot path, limits stay fuzzy within ~3×."
        },
        "options": [
          {
            "label": "Shared Redis, hash-tagged",
            "tradeoff": "Exact global limits; adds Redis to every request's hot path and shares a cluster with sessions — needs the owning team's OK.",
            "holds_when": "Session team agrees to the extra load and an eviction-policy check."
          },
          {
            "label": "Per-instance memory",
            "tradeoff": "No network hop, no new failure mode; global limit fuzzy up to 3×, per-customer tuning divides by 3."
          },
          {
            "label": "New dedicated Redis",
            "tradeoff": "Clean ownership and blast radius; procurement/may not fit 'this week'.",
            "cost": "Infra lead time"
          }
        ]
      },
      {
        "id": "tiers",
        "question": "For the 20 enterprise customers: per-customer overrides — a small Postgres table (or same-source config) read into cache at startup, numbers owned by support/CS, changed via ticket — rather than a uniform 'enterprise multiplier' or an SRE-edited config fil… [truncated 80 chars]",
        "header": "Enterprise tiers",
        "brief": {
          "where": "PLAN.md:10, PLAN.md:18 — higher limits and ownership both undecided.",
          "what": "Override granularity, storage mechanism, and who signs off on numbers. Ownership is organizational; code can't answer it.",
          "how": "Per-customer overrides absorb the spread between a 10/s script and a 60/s script; a uniform multiplier mis-sizes most of them. Ownership decides whether limit changes need a deploy or a ticket."
        },
        "options": [
          {
            "label": "Per-customer overrides, CS-owned",
            "tradeoff": "Precise, no deploys to adjust; requires an approval path so numbers don't drift per-request.",
            "cost": "config table + cache refresh"
          },
          {
            "label": "Uniform enterprise tier",
            "tradeoff": "One number, shippable today; over-provisions some, breaks others."
          },
          {
            "label": "Config file, SRE-owned",
            "tradeoff": "No new table; every adjustment is a redeploy of all 3 instances."
          }
        ]
      },
      {
        "id": "rejection",
        "question": "What does a rejected request return: 429 with Retry-After (seconds), the draft RateLimit limit/remaining/reset headers, and a JSON body like `{\"error\":\"rate_limited\"}` — or a bare 429?",
        "header": "Rejection shape",
        "brief": {
          "where": "PLAN.md:19; server.ts currently returns Response.json for success, plain text for errors.",
          "what": "The public contract. Enterprise scripts may treat non-2xx as hard failure, or busy-retry a bare 429 and make Postgres load worse than the original incident.",
          "how": "Retry-After + RateLimit headers let well-behaved scripts back off automatically. Bare 429 assumes their retry logic copes — unverified. If you know any enterprise client crashes on 429, say so now."
        },
        "options": [
          {
            "label": "429 + Retry-After + RateLimit headers",
            "tradeoff": "Auto-backoff for good clients, debuggable; tiny extra work.",
            "description": "JSON error body too",
            "holds_when": "You can't audit 20 integrations' 429 handling before Friday."
          },
          {
            "label": "Bare 429",
            "tradeoff": "Minimal surface; busy-retry loops likely, amplifying load."
          },
          {
            "label": "429 + Retry-After only",
            "tradeoff": "Backoff without exposing quota numbers you haven't finalized."
          }
        ]
      },
      {
        "id": "burst",
        "question": "One number only you has: what peak legitimate orders/second does the biggest enterprise integration actually hit today? The offender did ~67/s. If nobody knows, is your answer 'pick generous defaults and measure in shadow mode before enforcing'?",
        "header": "Burst size fact",
        "brief": {
          "where": "PLAN.md:3 — incident at 40,000 orders/10 min ≈ 67/s; PLAN.md:10 — enterprise bursts unquantified.",
          "what": "The default rate/burst numbers, or whether we must measure first. No log access here; only you or shadow mode can answer.",
          "how": "Known peak → defaults sized ~2× above it, enforce sooner. Unknown → limits start in shadow mode (count, don't reject) purely to collect this fact; that pushes shadow mode into the rollout round."
        },
        "options": [
          {
            "label": "Unknown — measure in shadow",
            "tradeoff": "Correct numbers eventually; enforcement slips by the shadow window (days).",
            "recommended-": null
          }
        ],
        "recommended": 0
      }
    ]
  },
  "normalized": {
    "questions": [
      {
        "id": "scope",
        "question": "PLAN.md calls POST expensive, but GET /orders also hits Postgres — listOrders is an unbounded `select *` per customer, and customers today poll it. Do we set separate budgets on both endpoints (generous GET, tight POST)?",
        "header": "Endpoint scope",
        "brief": {
          "where": "src/server.ts:10-16 — both routes reach Postgres; src/orders.ts:16-18 — listOrders does an unbounded per-customer SELECT *.",
          "what": "Which endpoint classes get budgets, and whether there is one or two counters per customer. Not answerable from code: whether GET flood is a risk you accept.",
          "how": "Separate budgets: two token buckets per customer, both keys under one `{customerId}` hash slot. POST-only: read path stays unprotected — a GET flood becomes next week's incident."
        },
        "options": [
          {
            "label": "Both endpoints, separate budgets",
            "tradeoff": "Two buckets per customer; protects Postgres from read floods too.",
            "description": "Generous GET limit, tight POST limit",
            "holds_when": "listOrders' unbounded SELECT makes GET a real Postgres cost.",
            "cost": "2 Redis keys + 2 bucket configs per customer"
          },
          {
            "label": "POST only",
            "tradeoff": "Simplest; GET floods still reach Postgres unthrottled."
          },
          {
            "label": "One shared budget",
            "tradeoff": "One counter; normal GET polling eats the customer's POST headroom — wrong shape for enterprise scripts."
          }
        ]
      },
      {
        "id": "key",
        "question": "Every request reaching the handler already carries x-customer-id (missing → 401, cheap, never touches Postgres). Do we key the limit on x-customer-id alone? One aside to correct if wrong: nothing in this code authenticates the header — if callers can forge… [truncated 127 chars]",
        "header": "Limit key",
        "brief": {
          "where": "src/server.ts:7-8 — presence check only, no authn. PLAN.md:14.",
          "what": "Key granularity and whether IP adds protection. Depends on whether the header is trusted, which only you know.",
          "how": "Customer-only: exact per-customer fairness. Customer+IP: needs the round-robin LB to actually forward real client IP — if it doesn't, IP buckets group whole customer offices."
        },
        "options": [
          {
            "label": "x-customer-id only",
            "tradeoff": "Exact per-customer fairness; unauthenticated 401 floods stay unlimited but never reach Postgres.",
            "description": "Header is authenticated upstream (or trust it for now)",
            "holds_when": "All handler traffic has an ID anyway; 401 path is a no-op check."
          },
          {
            "label": "Customer and IP",
            "tradeoff": "Catches ID-rotating floods; doubles state, and is wrong unless the LB forwards real client IPs."
          },
          {
            "label": "IP only",
            "tradeoff": "Punishes shared-office customers; pointless since the ID is required on every call."
          }
        ]
      },
      {
        "id": "algorithm",
        "question": "You have 20 enterprise customers who legitimately burst. Fixed window double-allows at boundaries and punishes exactly those bursty-but-fine clients; sliding-window-log is precise but stores per-request timestamps. Token bucket with per-customer refill rat… [truncated 70 chars]",
        "header": "Algorithm",
        "brief": {
          "where": "PLAN.md:15; PLAN.md:10 says enterprise integrations legitimately burst.",
          "what": "Which counter math; decides burst behavior, Redis cost per request, and what Retry-After can even mean.",
          "how": "Token bucket: one atomic Lua eval per request, burst = bucket capacity, tunable per customer. Fixed window: cheapest to write, but boundary bursts of 2×N will break enterprise scripts on the hour."
        },
        "options": [
          {
            "label": "Token bucket",
            "tradeoff": "Native burst allowance, continuous refill, one Redis round-trip per check; needs Lua in cluster with hash-tagged keys.",
            "holds_when": "Burst-friendly behavior is a requirement, not a nice-to-have."
          },
          {
            "label": "Sliding window counter",
            "tradeoff": "Approximate, two INCRs, no real burst semantics."
          },
          {
            "label": "Fixed window",
            "tradeoff": "Simplest code; 2× at boundaries and throttles legitimate bursts."
          }
        ]
      },
      {
        "id": "store",
        "question": "With 3 round-robin instances, in-memory counters mean each instance grants the full allowance → effective global limit up to 3× config, and dividing by 3 under-throttles any customer whose traffic skews to one instance. Do we keep buckets in the existing s… [truncated 207 chars]",
        "header": "Counter store",
        "brief": {
          "where": "PLAN.md:7-8 — Redis 7 cluster, round-robin across 3 instances; it belongs to another service (sessions).",
          "what": "Global correctness vs zero-dependency fuzziness, and blast-radius ownership of a shared cluster. A rate-limiter evicting session keys would be worse than the original incident.",
          "how": "Redis: exact global limits, and this choice makes 'what if Redis is down' a live question next round. Memory: no new failure mode on the hot path, limits stay fuzzy within ~3×."
        },
        "options": [
          {
            "label": "Shared Redis, hash-tagged",
            "tradeoff": "Exact global limits; adds Redis to every request's hot path and shares a cluster with sessions — needs the owning team's OK.",
            "holds_when": "Session team agrees to the extra load and an eviction-policy check."
          },
          {
            "label": "Per-instance memory",
            "tradeoff": "No network hop, no new failure mode; global limit fuzzy up to 3×, per-customer tuning divides by 3."
          },
          {
            "label": "New dedicated Redis",
            "tradeoff": "Clean ownership and blast radius; procurement/may not fit 'this week'.",
            "cost": "Infra lead time"
          }
        ]
      },
      {
        "id": "tiers",
        "question": "For the 20 enterprise customers: per-customer overrides — a small Postgres table (or same-source config) read into cache at startup, numbers owned by support/CS, changed via ticket — rather than a uniform 'enterprise multiplier' or an SRE-edited config fil… [truncated 80 chars]",
        "header": "Enterprise tiers",
        "brief": {
          "where": "PLAN.md:10, PLAN.md:18 — higher limits and ownership both undecided.",
          "what": "Override granularity, storage mechanism, and who signs off on numbers. Ownership is organizational; code can't answer it.",
          "how": "Per-customer overrides absorb the spread between a 10/s script and a 60/s script; a uniform multiplier mis-sizes most of them. Ownership decides whether limit changes need a deploy or a ticket."
        },
        "options": [
          {
            "label": "Per-customer overrides, CS-owned",
            "tradeoff": "Precise, no deploys to adjust; requires an approval path so numbers don't drift per-request.",
            "cost": "config table + cache refresh"
          },
          {
            "label": "Uniform enterprise tier",
            "tradeoff": "One number, shippable today; over-provisions some, breaks others."
          },
          {
            "label": "Config file, SRE-owned",
            "tradeoff": "No new table; every adjustment is a redeploy of all 3 instances."
          }
        ]
      },
      {
        "id": "rejection",
        "question": "What does a rejected request return: 429 with Retry-After (seconds), the draft RateLimit limit/remaining/reset headers, and a JSON body like `{\"error\":\"rate_limited\"}` — or a bare 429?",
        "header": "Rejection shape",
        "brief": {
          "where": "PLAN.md:19; server.ts currently returns Response.json for success, plain text for errors.",
          "what": "The public contract. Enterprise scripts may treat non-2xx as hard failure, or busy-retry a bare 429 and make Postgres load worse than the original incident.",
          "how": "Retry-After + RateLimit headers let well-behaved scripts back off automatically. Bare 429 assumes their retry logic copes — unverified. If you know any enterprise client crashes on 429, say so now."
        },
        "options": [
          {
            "label": "429 + Retry-After + RateLimit headers",
            "tradeoff": "Auto-backoff for good clients, debuggable; tiny extra work.",
            "description": "JSON error body too",
            "holds_when": "You can't audit 20 integrations' 429 handling before Friday."
          },
          {
            "label": "Bare 429",
            "tradeoff": "Minimal surface; busy-retry loops likely, amplifying load."
          },
          {
            "label": "429 + Retry-After only",
            "tradeoff": "Backoff without exposing quota numbers you haven't finalized."
          }
        ]
      },
      {
        "id": "burst",
        "question": "One number only you has: what peak legitimate orders/second does the biggest enterprise integration actually hit today? The offender did ~67/s. If nobody knows, is your answer 'pick generous defaults and measure in shadow mode before enforcing'?",
        "header": "Burst size fact",
        "brief": {
          "where": "PLAN.md:3 — incident at 40,000 orders/10 min ≈ 67/s; PLAN.md:10 — enterprise bursts unquantified.",
          "what": "The default rate/burst numbers, or whether we must measure first. No log access here; only you or shadow mode can answer.",
          "how": "Known peak → defaults sized ~2× above it, enforce sooner. Unknown → limits start in shadow mode (count, don't reject) purely to collect this fact; that pushes shadow mode into the rollout round."
        },
        "options": [
          {
            "label": "Unknown — measure in shadow",
            "tradeoff": "Correct numbers eventually; enforcement slips by the shadow window (days)."
          }
        ],
        "recommended": 0
      }
    ]
  }
}
```

### Model reasoning

```text
Fixing Q7: the choices need to be at least 2 items. Add a choice for "there's a known upper bound — I'll fill in the value."
```

### ask call

```json
{"questions":[{"brief":{"how":"Separate budgets: two token buckets per customer, both keys under one `{customerId}` hash slot. POST-only: read path stays unprotected — a GET flood becomes next week's incident.","what":"Which endpoint classes get budgets, and whether there is one or two counters per customer. Not answerable from code: whether GET flood is a risk you accept.","where":"src/server.ts:10-16 — both routes reach Postgres; src/orders.ts:16-18 — listOrders does an unbounded per-customer SELECT *."},"header":"Endpoint scope","id":"scope","options":[{"cost":"2 Redis keys + 2 bucket configs per customer","description":"Generous GET limit, tight POST limit","holds_when":"listOrders' unbounded SELECT makes GET a real Postgres cost.","label":"Both endpoints, separate budgets","tradeoff":"Two buckets per customer; protects Postgres from read floods too."},{"label":"POST only","tradeoff":"Simplest; GET floods still reach Postgres unthrottled."},{"label":"One shared budget","tradeoff":"One counter; normal GET polling eats the customer's POST headroom — wrong shape for enterprise scripts."}],"question":"PLAN.md calls POST expensive, but GET /orders also hits Postgres — listOrders is an unbounded `select *` per customer, and customers today poll it. Do we set separate budgets on both endpoints (generous GET, tight POST)?"},{"brief":{"how":"Customer-only: exact per-customer fairness. Customer+IP: needs the round-robin LB to actually forward real client IP — if it doesn't, IP buckets group whole customer offices.","what":"Key granularity and whether IP adds protection. Depends on whether the header is trusted, which only you know.","where":"src/server.ts:7-8 — presence check only, no authn. PLAN.md:14."},"header":"Limit key","id":"key","options":[{"description":"Header is authenticated upstream (or trust it for now)","holds_when":"All handler traffic has an ID anyway; 401 path is a no-op check.","label":"x-customer-id only","tradeoff":"Exact per-customer fairness; unauthenticated 401 floods stay unlimited but never reach Postgres."},{"label":"Customer and IP","tradeoff":"Catches ID-rotating floods; doubles state, and is wrong unless the LB forwards real client IPs."},{"label":"IP only","tradeoff":"Punishes shared-office customers; pointless since the ID is required on every call."}],"question":"Every request reaching the handler already carries x-customer-id (missing → 401, cheap, never touches Postgres). Do we key the limit on x-customer-id alone? One aside to correct if wrong: nothing in this code authenticates the header — if callers can forge it today, they can already insert orders for any customer, and rate limiting won't fix that. Is there an authn layer upstream?"},{"brief":{"how":"Token bucket: one atomic Lua eval per request, burst = bucket capacity, tunable per customer. Fixed window: cheapest to write, but boundary bursts of 2×N will break enterprise scripts on the hour.","what":"Which counter math; decides burst behavior, Redis cost per request, and what Retry-After can even mean.","where":"PLAN.md:15; PLAN.md:10 says enterprise integrations legitimately burst."},"header":"Algorithm","id":"algorithm","options":[{"holds_when":"Burst-friendly behavior is a requirement, not a nice-to-have.","label":"Token bucket","tradeoff":"Native burst allowance, continuous refill, one Redis round-trip per check; needs Lua in cluster with hash-tagged keys."},{"label":"Sliding window counter","tradeoff":"Approximate, two INCRs, no real burst semantics."},{"label":"Fixed window","tradeoff":"Simplest code; 2× at boundaries and throttles legitimate bursts."}],"question":"You have 20 enterprise customers who legitimately burst. Fixed window double-allows at boundaries and punishes exactly those bursty-but-fine clients; sliding-window-log is precise but stores per-request timestamps. Token bucket with per-customer refill rate + burst capacity matches 'legitimate bursts' natively. Token bucket?"},{"brief":{"how":"Redis: exact global limits, and this choice makes 'what if Redis is down' a live question next round. Memory: no new failure mode on the hot path, limits stay fuzzy within ~3×.","what":"Global correctness vs zero-dependency fuzziness, and blast-radius ownership of a shared cluster. A rate-limiter evicting session keys would be worse than the original incident.","where":"PLAN.md:7-8 — Redis 7 cluster, round-robin across 3 instances; it belongs to another service (sessions)."},"header":"Counter store","id":"store","options":[{"holds_when":"Session team agrees to the extra load and an eviction-policy check.","label":"Shared Redis, hash-tagged","tradeoff":"Exact global limits; adds Redis to every request's hot path and shares a cluster with sessions — needs the owning team's OK."},{"label":"Per-instance memory","tradeoff":"No network hop, no new failure mode; global limit fuzzy up to 3×, per-customer tuning divides by 3."},{"cost":"Infra lead time","label":"New dedicated Redis","tradeoff":"Clean ownership and blast radius; may not fit 'ship this week'."}],"question":"With 3 round-robin instances, in-memory counters mean each instance grants the full allowance → effective global limit up to 3× config, and dividing by 3 under-throttles any customer whose traffic skews to one instance. Do we keep buckets in the existing shared Redis, keys hash-tagged like `rl:{customerId}` so the Lua is cluster-legal, with a dedicated `rl:` prefix and short TTLs? And have you actually asked the session-store team whether you may write there?"},{"brief":{"how":"Per-customer overrides absorb the spread between a 10/s script and a 60/s script; a uniform multiplier mis-sizes most of them. Ownership decides whether limit changes need a deploy or a ticket.","what":"Override granularity, storage mechanism, and who signs off on numbers. Ownership is organizational; code can't answer it.","where":"PLAN.md:10, PLAN.md:18 — higher limits and ownership both undecided."},"header":"Enterprise tiers","id":"tiers","options":[{"cost":"config table + cache refresh","label":"Per-customer overrides, CS-owned","tradeoff":"Precise, no deploys to adjust; requires an approval path so numbers don't drift per-request."},{"label":"Uniform enterprise tier","tradeoff":"One number, shippable today; over-provisions some, breaks others."},{"label":"Config file, SRE-owned","tradeoff":"No new table; every adjustment is a redeploy of all 3 instances."}],"question":"For the 20 enterprise customers: per-customer overrides — a small Postgres table read into cache at startup, numbers owned by support/CS, changed via ticket — rather than a uniform 'enterprise multiplier' or an SRE-edited config file? And confirm: is support/CS actually the right owner of those numbers, or you?"},{"brief":{"how":"Retry-After + RateLimit headers let well-behaved scripts back off automatically. Bare 429 assumes their retry logic copes — unverified. If you know any enterprise client crashes on 429, say so now.","what":"The public contract. Enterprise scripts may treat non-2xx as hard failure, or busy-retry a bare 429 and make Postgres load worse than the original incident.","where":"PLAN.md:19; server.ts currently returns Response.json for success, plain text for errors."},"header":"Rejection shape","id":"rejection","options":[{"description":"JSON error body too","holds_when":"You can't audit 20 integrations' 429 handling before Friday.","label":"429 + Retry-After + RateLimit headers","tradeoff":"Auto-backoff for good clients, debuggable; tiny extra work."},{"label":"Bare 429","tradeoff":"Minimal surface; busy-retry loops likely, amplifying load."},{"label":"429 + Retry-After only","tradeoff":"Backoff without exposing quota numbers you haven't finalized."}],"question":"What does a rejected request return: 429 with Retry-After (seconds), the draft RateLimit limit/remaining/reset headers, and a JSON body like `{\"error\":\"rate_limited\"}` — or a bare 429?"},{"brief":{"how":"Known peak → defaults sized ~2× above it, enforce sooner. Unknown → limits start in shadow mode (count, don't reject) purely to collect this fact; that pushes shadow mode into the rollout round.","what":"The default rate/burst numbers, or whether we must measure first. No log access here; only you or shadow mode can answer.","where":"PLAN.md:3 — incident at 40,000 orders/10 min ≈ 67/s; PLAN.md:10 — enterprise bursts unquantified."},"header":"Burst size fact","id":"burst","options":[{"label":"Unknown — measure in shadow","tradeoff":"Correct numbers eventually; enforcement slips by the shadow window (days)."},{"description":"Type the number in the answer box","label":"Known — I'll give the peak","tradeoff":"Defaults sized immediately; risk of wrong number from a stale memory."}],"question":"One number only you has: what peak legitimate orders/second does the biggest enterprise integration actually hit today? The offender did ~67/s. If nobody knows, is your answer 'pick generous defaults and measure in shadow mode before enforcing'?"}]}
```

### ask result

```text
User answers:
scope: (cancelled)
key: (cancelled)
algorithm: (cancelled)
store: (cancelled)
tiers: (cancelled)
rejection: (cancelled)
burst: (cancelled)
```

