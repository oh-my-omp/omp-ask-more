## Person: `/skill:grilling Grill me on the unresolved decisions in PLAN.md. Do not implement the plan.`

omp injected the skill as a user-attributed message: its first line, then the 25 lines of `grilling/SKILL.md`.

```text
[IMPORTANT: User invoked the "grilling" skill; follow its instructions. Full skill below.]
```

### Model reasoning

```text
Let me read PLAN.md first.
```

- tool `read` PLAN.md

- tool `read` .

### Model reasoning

```text
Let me read the source files to ground questions in facts: server.ts, orders.ts, db.ts.
```

- tool `read` src/server.ts

- tool `read` src/orders.ts

- tool `read` src/db.ts

### Model reasoning

```text
The task: grill the user on unresolved decisions in PLAN.md. Do not implement.

Key facts from repo:
- Auth is only `x-customer-id` header, no verification — client-supplied identity. No auth middleware. So keying on it is trivially spoofable; also no IP handling currently.
- 3 instances round-robin → in-memory counters give effective 3x limit and inconsistent behavior.
- Redis 7 cluster shared with another service for sessions — adding rate-limit keys is a new consumer; cluster mode matters (sliding window needs atomic Lua across keys; single slot if keys hashed).
- POST /orders → db insert; GET cheap.
- No tests, no package.json, no metrics/logging, no config system.
- No deploy config visible.

Now the design tree. Root decision: what are we actually protecting? Actually the root prerequisite seems: what's the goal/contract — protect Postgres and fairness, or just stop one abusive script? Second root: identity/keying, because algorithm choice depends on whether key is presence-based. Actually let's map prerequisites:

Q that is genuinely frontier (no prerequisites):
1. Enforcement scope & goal: limit what — POST only, or all requests? And the contract goal: fairness vs. capacity protection vs. abuse stop. This underpins everything. Recommended: POST /orders only, protect DB write path; leave GET unlimited.
2. Identity key: x-customer-id vs IP vs both. This is arguably frontier — but "both" has sub-decision ordering. Still can ask now: recommend keying on customer-id (only identity the app has and bills on), since IP is shared behind NAT/proxies and requires trust config (X-Forwarded-For). But spoofability — is x-customer-id authenticated upstream? That's a fact I can't determine from repo (no auth in server). It's a fact about deployment the user knows; but skill says finding facts is my job — can't look up their LB. However asking user for deployment fact is allowed? "Finding facts is your job, never the user's" — dispatch a sub-agent when a frontier question needs a fact from the environment. Here there's no repo evidence of auth; I should note it as a fact: server.ts accepts header with no verification. The decision of whether to trust it is the user's, but there is no subagent tool here other than `ask` and `read`. Actually I have no shell/subagent tool in this environment. So I must note that the repo shows no authentication and ask the decision, flagging the fact.

Wait — do I have terminal? Tool list: ask, read only. So no sub-agents. I'll ground in what I read.

3. Algorithm: fixed window vs sliding window vs token bucket. Depends on desired burst semantics → depends on Q1 goal ("legit burst" requirement from enterprise). Actually burst tolerance is a separate decision: do we allow bursts at all? That's frontier too and it determines algorithm. But question about algorithm can include burst stance. I'd say burst shape is a prerequisite for algorithm; make it one question with recommendation token bucket (burst capacity + refill) since enterprise bursts are legitimate.

Hmm, careful: rounds must be genuinely independent. Frontier: things not dependent on others.

Independent roots:
A. What is the limit protecting / scope (POST only vs all endpoints; per-customer fairness).
B. Identity/keying (depends on A? weakly; could ask now but "both" granularity depends on whether GET is limited... slight. Better: settle scope first, then keying. But keying question is fairly independent — keying on customer id regardless of endpoint. I think keying can be asked in round 1; the "both" combo details belong later.)
C. Burst stance → algorithm (burst stance is a policy decision; algorithm follows). Can ask now: "Do legit bursts need headroom, i.e., pick token bucket?" That's basically algorithm question. Ask now.
D. Where counters live (Redis vs memory): depends on nothing except consistency requirement, which is implied by 3 instances. It's frontier — recommend Redis for shared counters, with the caveat it's shared with another service. But the fail-open/fail-closed decision depends on Redis choice → later round.
E. Rollout approach: shadow vs enforce, observe first. Depends on limit numbers... somewhat independent: rollout strategy depends on keying and store? Mostly independent. Could ask in round 1.
F. Numbers: what's the actual limit value? Depends on algorithm (token bucket has burst+rate) and enterprise tier handling → later.
G. Enterprise limits + ownership: depends on keying and numbers. But "who owns numbers" is independent. Yet it branches into config mechanism which depends on store/config system. Later round.
H. Rejection response shape (429, headers, body, Retry-After): depends on nothing much. Frontier! Recommend 429 + Retry-After + JSON body with limit info. But there's a prerequisite: is there an existing error format? None in repo (plain text errors, 401 "missing x-customer-id", 404 "not found"). So recommend JSON since success responses are JSON.
I. Fail-open vs fail-closed: depends on store choice (D) — if in-memory, question is moot. So later round. Also depends on whether limit is a protection (fail-closed) or fairness (fail-open). Depends on A too.

So round 1 frontier: A (scope/goal), B (keying), C (burst/algorithm — but split? I'd combine burst stance and algorithm recommendation, asking algorithm with recommendation token bucket), D (store), H (rejection response), E (rollout).

Hmm, 5 questions is a decent round. Should rollout be round 1? Rollout plan depends on whether we can observe limits before enforcing (needs metrics — no metrics in repo). The decision "shadow mode first?" is independent enough. But its details (per-customer override path, kill switch) depend on enterprise config and store. I'll include rollout at a high level: shadow then enforce? Recommended yes, given 20 enterprise bursters and no visibility into their rates.

Actually, is "what to key on" dependent on scope? If we limit GET too, per-customer still fine. Keying "both" (customer + IP) matters for spoofing only if limit applies per IP. Independent enough.

Let me also consider a question on the goal: is the 40k-in-10-min script a customer doing something legit-but-fast, or abuse? That shapes numbers. But that's a fact about a specific incident — user may know. It's a decision-relevant fact but not resolvable by me. Hmm, the incident details: 40,000 orders in ten minutes = ~66/s. That's a fact in the plan. Whether it's abuse or a buggy loop is unknown. That affects the limit value, not the structure — later round (numbers).

Also: no package.json/tsconfig/tests. Bun. Implementation detail. Not a decision to grill maybe: "Where does the limiter live — middleware in server.ts or a module?" That's a design decision but low-stakes; could ask. Prefer: separate `src/ratelimit.ts` module. That's implementation, but it's a real decision. The skill asks unresolved decisions in PLAN.md; the plan lists 7 items. My tree should cover those plus prerequisites. Maybe include implementation shape later round if frontier remains. Actually the plan's list is the explicit decision set; grilling should exhaust it and its implications. I'll stick to meaningful decisions; module layout is minor but could be a last-round question. Let's include it in round 1? No — it's dependent on store/algorithm (Redis client choice). Later.

Let me draft round 1 with strong recommendations grounded in repo facts.

Q1 - **Scope and purpose**: what is the limiter for? (a) stop the pathological script only (coarse safety net, high limits, protect Postgres), (b) fair-share between customers (low limits), (c) both. And which routes: POST only vs POST+GET. Repo fact: GET is cheap, POST writes to Postgres. Recommend: POST /orders only; purpose = protect the write path and stop pathological loops, not enforce fair-share. Ask yes/no phrasing.

Q2 - **Key**: customer-id vs IP vs both. Facts: no auth in server.ts — header trusted blindly, so key is only as trustworthy as upstream LB; IP behind LB is the LB's address unless X-Forwarded-For, and enterprise integrations may share egress IPs. Recommend customer-id only (matches billing identity, enterprise limits are per customer, no proxy trust config needed). Note: spoofing risk accepted; if upstream auth exists, fine.

Q3 - **Burst stance / algorithm**: token bucket with burst capacity vs sliding window. Recommend token bucket per customer: sustained rate r, burst B; matches "legitimate burst" enterprise behavior and gives natural Retry-After. Alternative: sliding window counter (simpler, exact, no burst headroom). Yes/no phrasing: "token bucket, sustained rate plus burst capacity?"

Q4 - **Store**: Redis shared vs per-instance memory. Facts: 3 instances round-robin → memory gives 3x effective limit and per-request luck; Redis 7 cluster shared with another service → new keys, cluster slot constraints for atomic Lua. Recommend Redis with a dedicated key prefix and no TTL-less keys; memory only as fail-open fallback? Careful: fallback is the fail-open question (later). Recommend Redis shared counters; not memory.

Q5 - **Rejection response**: status/body/headers. Facts: success responses JSON; current errors plain text. Recommend 429, JSON body `{error:"rate_limited", retryAfterSeconds}`, `Retry-After` header (integer seconds), and `X-RateLimit-*` headers? Keep it minimal: Retry-After + JSON. Ask yes.

Q6 - **Rollout**: shadow/observe first vs enforce immediately with high limits. Facts: no metrics/logging in repo, no per-customer baseline, 20 enterprise bursters, shipping "this week". Recommend log-only shadow for a short window (1-3 days) on POST /orders at candidate thresholds, then enforce; plus env-var kill switch. Hmm — is kill switch dependent on config decision? Env var is fine now.

That's 6 questions in round 1. Is that too many? The frontier genuinely has those. But note dependency: Q6's shadow needs a metric sink — no metrics infra; recommend structured log line to stdout (Bun logs), which is a decision embedded. Fine.

Should Q5 be later because rejection shape depends on whether we're doing shadow? No, independent.

Should Q3 algorithm depend on Q4 store? Token bucket in Redis cluster requires atomic Lua; fixed window can be INCR+EXPIRE. That's an implementation constraint that could make token bucket harder in a cluster. But it doesn't change the policy decision. Keep Q3 now, note the Redis cluster atomicity constraint in Q4.

Also consider "who owns enterprise numbers" — depends on Q2 keying? Only weakly. But it also depends on how overrides are configured (store choice). Round 2.

Also "fail-open/closed" — round 2 (needs store + purpose settled... purpose is Q1, settled after round 1; store Q4 settled).

Also "limit values" — round 2 or 3, after algorithm and burst stance.

Let me write it. Format per skill. Short titles, bodies with facts and choices, then ➡️ recommendation.

I should state facts found in repo briefly? The skill format doesn't include a preamble, but grounding helps. Keep a one-line note maybe. I'll add a compact fact block before Q1? "Format a round like so" — I can include a brief context line. Better keep minimal: I'll put repo facts inside question bodies.

Number of questions: 6. Fine.

Ensure "yes" accepts recommendation.

Let me write.
```

### Model reply

Facts from the repo that shape this round: `src/server.ts` authenticates nothing — it reads `x-customer-id` and trusts it (401 only when absent); there is no proxy/IP handling, no metrics or logging, no config layer, no tests, and no package manifest. `createOrder` does a single unbatched Postgres insert; `listOrders` is one indexed-looking select. So "the limit" has to be built from scratch, and identity trust hinges on infrastructure not visible here.

❓ **Q1** - **Scope and purpose**: Is this a safety net or a fairness regime? Two different products: (a) a coarse circuit breaker that stops pathological loops (66 orders/s was the incident) while leaving normal traffic untouched, with limits set well above any human or sane integration; or (b) fair-share enforcement where limits are a product feature customers feel. These imply different limit values, different error semantics, and different rollout appetite.

Separately, scope: limit only `POST /orders` (the Postgres write), or `POST` and `GET`? `GET` is cheap and unlimited reads keep dashboards and support tooling working during an incident.

➡️ Yes — safety net, not fairness: limit `POST /orders` only, set limits high enough that no legitimate integration notices, and treat this as protecting the write path rather than allocating capacity per customer.

---

❓ **Q2** - **Key** - **Identity to limit on**: `x-customer-id`, client IP, or both?

Ground truth: the header is unauthenticated in this codebase — anyone can send any value, and every request has one because it is required. So the key is only as trustworthy as whatever sits in front of the LB. IP is worse in practice: the 3 instances sit behind a round-robin LB, so you see the LB's address unless you parse `X-Forwarded-For` and trust a hop count, and enterprise scripted integrations frequently egress from shared NAT ranges — one customer's burst would throttle another.

Keying on customer ID also makes the enterprise-override story and the 429 message coherent ("your account is over its limit").

➡️ Yes — key on `x-customer-id` alone, accept that it is spoofable until real auth exists, and do not build IP keying or `X-Forwarded-For` trust now.

---

❓ **Q3** - **Algorithm and burst stance**: Do legitimate bursts get headroom, or is the limit a hard ceiling?

The plan says ~20 enterprise customers "legitimately burst". A fixed or sliding window makes burstiness punishable: 100 requests in the first second of a window then nothing for the rest. A token bucket gives a sustained rate plus a burst capacity, tolerates short spikes by construction, and yields a natural `Retry-After`. Cost: two numbers per customer to own instead of one, and an atomic read-modify-write in Redis (Lua), which is awkward in cluster mode because all keys in one script must hash to the same slot.

Alternatives: sliding-window counter (simple `INCR`-style, exact, no burst allowance), fixed window (cheapest, worst boundary behavior — double rate across a window edge).

➡️ Yes — token bucket per customer: sustained rate `r` and burst capacity `B`, both configurable, so bursts are absorbed and sustained abuse is still capped.

---

❓ **Q4** - **Counter store**: Redis (shared with the sessions service) or per-instance memory?

With 3 instances behind round-robin, in-memory counters mean every customer effectively gets 3× the limit, and whether a request is rejected depends on which instance it lands on — the same client sees intermittent 429s, which is the worst possible support experience. Redis is the only option that gives one number per customer.

Caveats to accept explicitly: it is a shared cluster owned by another service (new key namespace, no unbounded keys, no `KEYS`, watch memory growth and eviction policy — an evicted counter silently resets a limit); Redis 7 cluster needs the token-bucket script to use a single key or hash tags; and every `POST /orders` now pays a Redis round trip before the Postgres write.

➡️ Yes — Redis, with a dedicated key prefix (e.g. `rl:orders:v1:{customerId}`), TTL on every key, and no dependency on the sessions service's keys.

---

❓ **Q5** - **Rejection contract**: What does a throttled client see?

Existing shape: success responses are JSON; errors are plain text (`"missing x-customer-id"`, `"not found"`). A scripted integration needs a machine-readable signal and a hint for when to retry, otherwise it retries immediately and amplifies the problem.

Choices: bare `429` with plain text (consistent with current errors, useless to scripts); `429` + `Retry-After` header; `429` + JSON body `{ "error": "rate_limited", "retryAfterSeconds": N }` + `Retry-After`; or that plus `X-RateLimit-Limit`/`Remaining`/`Reset` on every response.

➡️ Yes — `429` with JSON body `{"error":"rate_limited","retryAfterSeconds":N}` plus a `Retry-After` header, and no `X-RateLimit-*` headers on success responses for now (they leak your capacity numbers and invite clients to sit at the limit).

---

❓ **Q6** - **Rollout**: Enable enforcement immediately behind a high limit, or run log-only first?

There is no metrics or logging layer in this repo, no baseline of per-customer request rates, 20 known bursters, and a one-week ship target. Enforcing blind risks 429-ing a paying integration in week one; a shadow mode costs little because the limiter is already computing the decision — you just log it. Shadow needs an output: a structured stdout line (`customerId`, `allowed`, `remaining`, `limit`) is enough for Bun to capture, no infra required.

Also: an escape hatch for week one. A per-process env-var (`RATELIMIT_MODE=off|shadow|enforce`) is cheaper than a config service and can be flipped by redeploy of 3 instances.

➡️ Yes — build all three modes behind `RATELIMIT_MODE`, run `shadow` on `POST /orders` for 24–48 hours to size `r` and `B` against real traffic, then flip to `enforce`, keeping `off` as the incident switch.

---

Round 2 (limit values, fail-open vs fail-closed, enterprise overrides and ownership, config mechanism) unlocks once these are settled.

