## Person: `/skill:grilling Before I implement PLAN.md, grill me on anything I haven't decided.`

omp injected the skill as a user-attributed message: its first line, then the 25 lines of `grilling/SKILL.md`.

```text
[IMPORTANT: User invoked the "grilling" skill; follow its instructions. Full skill below.]
```

### Model reasoning

```text
We need use grilling skill. User says: Before I implement PLAN.md, grill me on anything I haven't decided. Need read skill directory? The skill instructions are given in user message. We need follow: ask questions via ask tool. First, we need understand PLAN.md and project. We need gather facts via tools. The user wants grilling on plan. We need inspect PLAN.md and repo. Use read directory and PLAN.md. Also maybe read any existing files. Let's explore cwd /tmp/askmore-grill.
```

- tool `read` /tmp/askmore-grill

### Model reasoning

```text
Read PLAN.md and source files.
```

- tool `read` /tmp/askmore-grill/PLAN.md

- tool `read` /tmp/askmore-grill/src/server.ts

- tool `read` /tmp/askmore-grill/src/db.ts

- tool `read` /tmp/askmore-grill/src/orders.ts

### Model reasoning

```text
Need grill user on undecided decisions. We need construct design tree. The plan lists undecided items. Need ask frontier questions: all decisions with prerequisites settled. We can ask all listed undecided decisions, but some depend on each other? Let's map decisions:

1. Key the limit on: x-customer-id, client IP, or both. Independent.
2. Algorithm: fixed window, sliding window, token bucket. Independent but maybe depends on key? Not much.
3. Where counters live: Redis or in-memory. Independent. But if choose memory and 3 instances behind LB, per-instance counters inconsistent. Could ask.
4. Store unreachable behavior: let through or reject. Independent.
5. Enterprise higher limits and ownership. Independent.
6. Rejected client response. Independent.
7. Rollout strategy. Independent.

Also need consider details: rate limit only POST /orders? Plan says POST expensive; GET cheap. Should GET be limited too? Not listed undecided but need decide. Also request validation: amountCents missing? Currently `createOrder` assumes number. Not in plan.

Need formulate questions with recommended answers. Must use ask tool. We need include all frontier questions in one ask call. Each question needs id, question, options, brief, recommended. Need word questions so yes accepts recommended. The ask tool options array has label, tradeoff. Need recommended index. Also brief includes where, what, how. Provide evidence referencing files.

Let's craft questions.

Q1: Key the limit. Options: x-customer-id only; client IP only; both. Recommended: x-customer-id only. Why: enterprise scripts may come from multiple IPs, customer id is already auth/identification. IP can be spoofed/proxied/NAT. But if customer shares key across integrations? The server uses x-customer-id as identity. Round-robin LB doesn't preserve IP necessarily? x-forwarded-for? Not handled.

Q2: Algorithm. Options: fixed window, sliding window, token bucket. Recommended: token bucket for bursts. Enterprise scripts legitimately burst; token bucket allows bursts while controlling sustained rate. Sliding window more accurate but more Redis ops/complex. Fixed window can have thundering herd at window boundaries. Token bucket matches "burst" requirement.

Q3: Where counters live. Options: Redis cluster, in-memory per instance. Recommended: Redis cluster because 3 instances LB round-robin; in-memory gives 3x effective limit and inconsistent. Use existing Redis.

Q4: Store unreachable. Options: fail open (let through), fail closed (reject 503). Recommended: fail open? Need consider safety. If Redis unreachable, rejecting all orders could break business. But if fail open, attacker can DDoS Redis to bypass limit. Since rate limit is protective not auth, fail open likely safer to avoid outage. However enterprise? Need ask. Could recommend fail closed for security? Let's evaluate. The incident was one customer's script created 40k orders in 10 min, slowed others. Rate limit is to protect service. If Redis is down, failing open removes protection. But failing closed denies all legitimate orders, severe. Usually fail-open for rate limiting unless you want hard enforcement. Given existing Redis cluster used for sessions by another service; if shared, outage risk? Redis cluster likely reliable. But still. Need user decide. We can recommend fail open with alert/monitoring, because availability of order API is primary. Could include third option: fail closed with circuit breaker. Simpler binary.

Q5: Enterprise higher limits and ownership. Options: per-customer limit stored in config/DB owned by support/sales; one global tier (e.g., enterprise vs standard) hardcoded; no special limits, same for all. Recommended: per-customer overrides in Postgres config table owned by account team, because about 20 enterprise customers have scripted integrations that legitimately burst. Need higher limits, configurable without deploy. Ownership: account team or support.

Q6: Rejected client response. Options: HTTP 429 with Retry-After header; 429 without header; 503. Recommended: 429 with Retry-After and maybe RateLimit headers. Helps scripts back off.

Q7: Rollout strategy. Options: shadow mode/monitor first, then enforce with high limits, then lower; enable for all immediately; whitelist enterprise initially. Recommended: shadow/monitor -> enforce starting with high limit -> lower gradually to avoid breaking enterprise integrations. Maybe also per-customer allowlist.

Additionally, need decide if GET /orders should be rate limited. Since plan says POST expensive, GET cheap. But should we protect GET from abuse too? Could include Q8: Should GET /orders be covered by same, separate, or no rate limit? Recommended: no rate limit initially or separate lighter limit.

Also need decide counter key granularity per endpoint? Could ask if limit applies per customer globally or per endpoint. Plan says rate limiting for orders API. Server has POST and GET. Limit on POST only? Need decide.

Also need decide limits numerically. User hasn't decided how enterprise higher limits, but also baseline limit numeric? The plan doesn't mention baseline rate. Need ask: baseline requests per second/minute. Could be 100 req/min? Need gather facts: 40k orders in 10 min by one customer = 4000/10min = 400/min = ~6.7/s. If normal maybe lower. But not known. Ask baseline.

Also need decide window size? Depends algorithm. Could ask later after algorithm chosen. Since algorithm not settled, can't ask numeric limit details. But some are independent? We can ask baseline target now: "What should the default per-customer limit be?" It's independent of algorithm (limit expressed as requests per second/min). However if token bucket, need burst capacity and refill rate. Could be decided after algorithm. So maybe leave numeric limits for later round, dependent on algorithm and key.

Also need decide Redis key naming / data structure. Depends on key & algorithm. Later.

Also need decide what happens when x-customer-id header missing? Currently 401. Rate limiting only after auth. Fine.

Also need decide header for client IP? Not implemented.

Need produce ask call with all frontier questions. But the skill says ask the whole frontier in one round. We need ensure each question's options include recommended. Use ask tool. The ask tool schema includes header, brief (where, what, how, evidence, diagram, demo, risks), question, options (label, tradeoff, description, preview, holds_when, cost, demo), recommended.

Need produce JSON for ask. Let's create 8 questions: Q1 key, Q2 algorithm, Q3 counter store, Q4 store unreachable, Q5 enterprise limits, Q6 rejection response, Q7 GET coverage, Q8 rollout. But Q7 GET coverage maybe frontier. Q8 rollout depends on enterprise higher limits? Slightly, but can ask independently. We can ask rollout now with options. It doesn't depend on algorithm.

But we need not overload too many. The skill says whole frontier in one round. It's okay to include multiple. However user said "grill me on anything I haven't decided." The plan lists not decided yet items. We can add derived decisions. Let's include all plus GET coverage and numeric baseline? Numeric baseline independent, but maybe later after algorithm because token bucket uses burst+refill. But baseline can be expressed as "requests per minute per customer". For token bucket, that maps to refill rate, and burst capacity separate. We could ask baseline now and refine algorithm-specific parameters later. It is a frontier decision.

Potential questions:

Q1: Limit key. 
Q2: Algorithm.
Q3: Counter store.
Q4: Store failure mode.
Q5: Default limit value.
Q6: Enterprise differentiation.
Q7: GET /orders coverage.
Q8: Rejected response.
Q9: Rollout.

9 questions maybe many but still okay. We can group? The ask tool takes array of questions. Fine.

Need word each question so "yes" accepts recommended. Since ask tool returns options labels; "yes" not exactly, but recommended cursor. The instructions for round format not needed in reply because we use tool. But within tool, question text can say "Should we key the limit on x-customer-id only?" with recommended option "Yes, key on x-customer-id only". But ask tool options must be distinct. Could frame as yes/no options: "Yes, key on x-customer-id only" vs alternatives. The user's answer via ask picks an option. That's fine.

Need include brief with evidence paths. Use relative paths? Tool says prefer relative path-like fields. Use "PLAN.md", "src/server.ts". Evidence path relative. Note.

Need not put questions in reply text. Just call ask. The user invoked skill, so ask via tool. Then wait for answers. We'll produce only tool call. But before tool call, no text? We can include a brief intro? The instruction: NEVER write such questions in your reply. So we should not include question text in final response, just call ask. However maybe a short greeting? The skill says "Format a round like so" but then "Any question, confirmation or choice the skill above puts to the user MUST go through the ask tool, NEVER into my reply". So I should not include the formatted round in chat. I should just invoke ask tool. But the skill's format maybe for when no ask tool. Since we have ask tool, use it. I can maybe say "Here are the open decisions:"? That includes questions? Better not. Just call ask. The tool will display. The user can answer. In final answer after tool call? We need call tool then wait. The tool call blocks until answers. Then next round. But per the conversation, we call ask; it returns answers. We then process. We can't output nothing? We need call tool. The system expects tool usage. We'll just call ask with no preceding text? The model's response can be tool call only. That's acceptable.

Let's craft ask JSON carefully.

For each option, tradeoff required. Also label. Add description optional. Add holds_when optional. Add cost optional.

Need recommended index per question.

Let's formulate.

Q1 id: key
header: "Rate-limit key"
brief where: "src/server.ts reads x-customer-id and 401s without it. PLAN.md lists key as undecided."
what: "Whether to count requests per customer id, per client IP, or require both to match."
how: "This decides the middleware lookup key and whether we need IP parsing (X-Forwarded-For)."
evidence: paths PLAN.md and src/server.ts.
options:
- label: "Key on x-customer-id only"
  tradeoff: "Matches the existing identity header and avoids NAT/proxy IP problems, but a leaked/shared key lets any caller exhaust the customer's limit."
  holds_when: "Customers are identified reliably by x-customer-id and may call from multiple IPs."
- label: "Key on client IP only"
  tradeoff: "No header dependency, but NAT/proxies collapse multiple customers behind one IP and load balancer IPs hide origin."
  holds_when: "All callers have stable, distinct public IPs."
- label: "Key on both x-customer-id and IP"
  tradeoff: "Tightest binding; a stolen key from a new IP gets its own bucket. More complex and breaks legitimate multi-IP integrations for the same customer."
  holds_when: "You want per-customer-per-source enforcement."
recommended: 0

Q2 id: algorithm
header: "Algorithm"
brief where: PLAN.md lists algorithm undecided. 
what: choose fixed window, sliding window, token bucket.
how: Determines Redis data structure, Lua script, and burst friendliness.
options:
- fixed window: simple, low Redis ops, but allows 2x burst at boundary and penalizes legitimate bursts.
- sliding window: smoother, accurate, more Redis/complex.
- token bucket: allows controlled bursts, fits enterprise scripts, needs bucket state in Redis. Recommended.
recommended: 2

Q3 id: store
header: "Counter store"
brief where: 3 instances behind round-robin LB, existing Redis cluster.
what: Whether counters live in shared Redis or each Bun instance memory.
how: This affects consistency across instances and whether customers can 3x their limit.
options:
- Redis cluster: consistent across instances, uses existing infra, adds network latency and dependency.
- In-memory per instance: fastest, no external dependency, but round-robin gives each instance its own bucket and total limit is 3x/uneven.
recommended: 0

Q4 id: store-failure
header: "Store unreachable"
brief where: rate limiter needs counters in Redis.
what: Behavior if Redis/cluster unreachable.
how: Decides availability vs enforcement tradeoff.
options:
- Fail open (allow requests): keeps orders flowing during Redis outage, but attacker can bypass limits by causing outage.
- Fail closed (reject 503/429): preserves protection, but any Redis blip becomes a site outage for POST /orders.
recommended: 0? Need choose. I think fail open recommended because primary service is order API. Could mention alert. But maybe security wants fail closed. Let's recommend fail open with an alert/circuit breaker. Maybe option could be fail open with metric. The ask tool options can include that. But binary simpler. Let's choose fail open as recommended. Tradeoff.

Q5 id: default-limit
header: "Default per-customer limit"
brief where: Incident: 40k orders/10min. Need default.
what: Baseline allowed rate per customer.
how: Sets the cap before enterprise overrides.
options:
- "100 requests/minute per customer" (recommended?) Based on incident ~400/min. Normal likely lower. But enterprise scripts burst. We need ask user. Could offer options: 60/min, 300/min, 1000/min. The plan doesn't mention. Need user decide. We can recommend 120/min? Let's think. 40k in 10min is 400/min. The limit should be lower than that but accommodate legitimate. If enterprise customers burst, 120/min = 7,200/hour maybe. Token bucket burst maybe 300. We can express as per minute. Provide options:
  - 60/min: conservative, may throttle current scripts.
  - 300/min: around incident average, still high.
  - 1000/min: generous default, relies on enterprise overrides for heavy hitters.
Which recommended? Since we don't know normal volumes, recommend starting high and tightening after monitoring. But initial rollout high limit to avoid breaking. Maybe 300/min default. Hmm. Need make recommendation. Could be 300/min (close to the 40k/10min average) as initial, then lower. But the goal is prevent 40k/10min. 300/min still allows 18k/hour. That's not enough? 300/min * 10min = 3000, far below 40k. So good. But normal maybe less. Let's recommend 300/min initial with monitoring, tighten to 120/min. But options are fixed. Alternatively include "Set initial cap at 300 req/min and tune down from metrics" as an option. Need label and tradeoff.

Options:
- label: "Start at 300 requests/minute per customer"
  tradeoff: "Well below last week's 400/min peak, low breakage risk for normal scripts, but still lets a determined customer send 18k orders/hour."
  holds_when: "You want a safe initial ceiling you can lower after measuring."
- label: "Start at 60 requests/minute per customer"
  tradeoff: "Aggressive protection, likely throttles some legitimate bursts and enterprise scripts."
- label: "No default; require an explicit limit configured for every customer"
  tradeoff: "Maximum control, but adds operational overhead and may reject new customers until configured."
recommended: 0

But user may have better numbers. Let's keep.

Q6 id: enterprise-limits
header: "Enterprise limits and ownership"
brief where: ~20 enterprise customers have scripted integrations that legitimately burst.
what: How higher limits are granted and who maintains the values.
how: Determines config source and approval workflow.
options:
- label: "Per-customer override in a Postgres config table owned by account/support"
  tradeoff: "No deploy needed to raise a limit; requires UI/process to avoid ad-hoc changes."
- label: "A single 'enterprise' tier multiplier (e.g., 10x) hardcoded in code/env"
  tradeoff: "Simple to implement, but all enterprise customers get same cap and changing it needs a deploy."
- label: "No special limits; same cap for everyone"
  tradeoff: "Fair and simple, but will throttle known heavy legitimate integrations."
recommended: 0

Q7 id: get-limit
header: "GET /orders rate limiting"
brief where: GET cheap per plan, but still accessible.
what: Whether to apply the same, a lighter, or no rate limit to GET.
how: Decides whether GET shares the POST counter/key or gets separate protection.
options:
- label: "Limit POST only; leave GET unlimited for now"
  tradeoff: "Matches the stated problem and keeps cheap reads fast; GET can still be abused."
- label: "Share the same customer counter across POST and GET"
  tradeoff: "Protects all endpoints uniformly, but a heavy GET script can consume burst budget needed for orders."
- label: "Apply a separate, lighter limit to GET"
  tradeoff: "Protects GET without affecting POST, but adds a second counter to configure and monitor."
recommended: 0

Q8 id: rejected-response
header: "Rejected client response"
brief where: server currently returns JSON or plain text.
what: What a throttled client sees.
how: Affects retry behavior of scripts.
options:
- label: "HTTP 429 with Retry-After and RateLimit headers"
  tradeoff: "Best client ergonomics; scripts can back off, but requires consistent header format."
- label: "HTTP 429 without extra headers"
  tradeoff: "Standard status, but scripts don't know when to retry."
- label: "HTTP 503 Service Unavailable"
  tradeoff: "May be treated as server error rather than quota; can confuse clients."
recommended: 0

Q9 id: rollout
header: "Rollout strategy"
brief where: Need ship this week without breaking enterprise integrations.
what: How to deploy enforcement.
how: Determines observability and blast radius.
options:
- label: "Shadow mode -> enforce with a high default limit -> lower limit gradually per customer"
  tradeoff: "Safest: observe what would be throttled, then tighten. Takes longer than immediate enforcement."
- label: "Enable enforcement immediately with a high limit"
  tradeoff: "Fast protection, but any miscalculation breaks integrations immediately."
- label: "Whitelist the 20 enterprise customers and enforce only on the rest"
  tradeoff: "Protects non-enterprise quickly, but leaves enterprise unprotected until overrides are set."
recommended: 0

Need include risks maybe. Could include for some.

One issue: The instructions say "Ask the whole frontier in one round: number each question and give your recommended answer. Then wait." Since using ask tool, no numbering in reply, but tool options can include numbers in header. We can set header "Q1 - Rate-limit key" etc. Good.

Also need maybe ask about counter store failure separately. Good.

We must ensure all questions independent enough for current frontier. Q5 default limit may depend on algorithm? For token bucket, default limit can be refill rate + burst capacity. But asking a requests/min baseline is still okay. Q9 rollout independent. Q7 GET independent. Q8 independent.

Let's also consider whether key includes IP if we use Redis. IP extraction with X-Forwarded-For may be needed because Bun sees LB connection IP. That's a design detail. Could ask later after key decision. Not frontier? If user chooses key on IP, need know if LB sets X-Forwarded-For. That's a fact we can find? Not from repo. We could ask user? But facts are our job if environment has them. The load balancer info not in repo. We can ask later. So leave IP detail dependent.

Need perhaps ask about rate limit scope: per endpoint vs global. We included GET coverage.

Potential missing: Should rate limiting happen before or after parsing JSON? For POST, currently parse JSON before createOrder. Rate limit should be early to avoid parsing cost. Could ask later after algorithm. Not now.

Need ask about monitoring/alerting? The plan says ship this week. Not explicitly undecided. But part of rollout. Could include in rollout option. Not separate.

Potential missing: What about the 3-instance round-robin and sessions Redis used by another service: should we share the Redis cluster or provision separate? The plan says may use it. Counter store option covers Redis. If we use Redis cluster, data structure and key namespace separate. Could ask later.

Now construct ask JSON. Must include i intent. Let's do it.

Potential nuance: recommended answer "yes" accepts recommended. In tool options, user can type own answer. We can phrase question body: "Should we key the limit on x-customer-id only?" Then options: Yes..., No key on IP..., Both... This matches. For others, similarly.

Need not include demo. Fine.

Let's assemble.
```

### ask call

```json
{"questions":[{"id":"key","question":"Should we key the per-customer rate limit on `x-customer-id` only?","options":[{"label":"Yes — key on `x-customer-id` only","tradeoff":"Matches the existing identity header and avoids NAT/proxy IP problems, but a leaked or shared key lets any caller exhaust that customer's limit.","holds_when":"Customers are identified reliably by `x-customer-id` and may call from multiple IPs."},{"label":"Key on client IP only","tradeoff":"No header dependency, but NAT/proxies collapse multiple customers behind one IP and the load balancer connection IP may not be the real origin.","holds_when":"All callers have stable, distinct public IPs."},{"label":"Key on both `x-customer-id` and IP","tradeoff":"Tightest binding, but a legitimate customer bursting from multiple IPs gets separate buckets and implementation needs IP parsing.","holds_when":"You want per-customer-per-source enforcement."}],"brief":{"where":"src/server.ts already requires `x-customer-id` and returns 401 when it is missing; PLAN.md lists the key as undecided.","what":"Whether to count requests per customer id, per client IP, or require both to match.","how":"This decides the middleware lookup key and whether we need to parse `X-Forwarded-For` or similar headers.","evidence":[{"path":"PLAN.md","start":12,"end":15,"note":"Lists the key decision among undecided items."},{"path":"src/server.ts","start":1,"end":19,"note":"Shows the existing reliance on x-customer-id."}]},"recommended":0,"header":"Q1 — Rate-limit key"},{"id":"algorithm","question":"Should we use a token-bucket algorithm so enterprise bursts are tolerated while the sustained rate is capped?","options":[{"label":"Yes — token bucket","tradeoff":"Allows controlled bursts (good for scripted integrations) while limiting sustained load, but needs bucket state in Redis and slightly more complex logic.","holds_when":"Enterprise scripts legitimately burst and you want to cap average rate without punishing every spike."},{"label":"Fixed window","tradeoff":"Simple and low Redis overhead, but allows 2x the limit at window boundaries and penalizes legitimate bursts.","holds_when":"You want the simplest possible implementation and can accept boundary spikes."},{"label":"Sliding window","tradeoff":"Smoothest and most accurate, but more Redis operations and more complex to implement correctly.","holds_when":"You need strict, jitter-free enforcement and can pay the implementation cost."}],"brief":{"where":"PLAN.md lists the algorithm as undecided; the incident was a sustained 40,000 orders in ten minutes.","what":"Which rate-limiting algorithm to implement.","how":"This determines the Redis data structure, any Lua scripts, and how enterprise scripts experience throttling.","evidence":[{"path":"PLAN.md","start":12,"end":16,"note":"Algorithm is listed as undecided."},{"path":"PLAN.md","start":1,"end":4,"note":"The motivating incident was a sustained burst."}]},"recommended":0,"header":"Q2 — Algorithm"},{"id":"store","question":"Should the counters live in the existing Redis cluster so all three instances share one limit?","options":[{"label":"Yes — Redis cluster","tradeoff":"Consistent across the three round-robin instances and uses existing infrastructure, but adds network latency and a runtime dependency.","holds_when":"You want a single, accurate per-customer limit across all server instances."},{"label":"In-memory per instance","tradeoff":"Fastest and no external dependency, but round-robin gives each instance its own bucket and the effective limit becomes 3x (or uneven).","holds_when":"You accept approximate limits and want to avoid Redis entirely."}],"brief":{"where":"PLAN.md notes three instances behind a load balancer and an existing Redis 7 cluster used for sessions.","what":"Where request counters are stored.","how":"This decides consistency across instances and whether the limit is per-instance or global.","evidence":[{"path":"PLAN.md","start":5,"end":9,"note":"Three instances and Redis cluster context."},{"path":"PLAN.md","start":12,"end":17,"note":"Counter store is listed as undecided."}]},"recommended":0,"header":"Q3 — Counter store"},{"id":"store-failure","question":"If Redis is unreachable, should the rate limiter fail open and let orders through?","options":[{"label":"Yes — fail open","tradeoff":"Keeps POST /orders available during a Redis outage, but an attacker who causes Redis to become unreachable can bypass limits.","holds_when":"Order-API availability is more important than enforcement during infra failures."},{"label":"No — fail closed (reject requests)","tradeoff":"Preserves rate-limit protection even when Redis is down, but any Redis blip becomes a complete outage for POST /orders.","holds_when":"Enforcing the limit is critical even at the cost of availability."}],"brief":{"where":"PLAN.md lists store-unreachable behavior as undecided; Redis is shared with another service.","what":"What happens when the counter store cannot be reached.","how":"This trades availability against protection and drives error handling in the middleware.","evidence":[{"path":"PLAN.md","start":12,"end":18,"note":"Store-unreachable behavior is listed as undecided."}]},"recommended":0,"header":"Q4 — Store failure mode"},{"id":"default-limit","question":"Should the default per-customer limit start at 300 requests/minute and be tuned down after monitoring?","options":[{"label":"Yes — 300 req/min default, tune later","tradeoff":"Well below last week's 400 req/min peak, low breakage risk for normal scripts, but still lets a determined customer send 18k orders/hour.","holds_when":"You want a safe initial ceiling and plan to tighten per-customer after measuring real traffic."},{"label":"60 req/min default","tradeoff":"Aggressive protection but likely throttles legitimate enterprise bursts and requires immediate overrides.","holds_when":"Normal customer traffic is well under 1 req/s."},{"label":"No default; require an explicit configured limit per customer","tradeoff":"Maximum control, but adds operational overhead and may reject new customers until they are configured.","holds_when":"You want every customer to have an explicit, reviewed limit."}],"brief":{"where":"PLAN.md does not set a numeric limit; the incident averaged ~400 orders/minute for one customer.","what":"Baseline allowed rate per customer before enterprise overrides.","how":"Sets the cap for the default bucket and informs rollout thresholds.","evidence":[{"path":"PLAN.md","start":1,"end":4,"note":"40,000 orders in ten minutes equals ~400 req/min peak."}]},"recommended":0,"header":"Q5 — Default per-customer limit"},{"id":"enterprise-limits","question":"Should enterprise overrides be stored per-customer in Postgres and owned by account/support?","options":[{"label":"Yes — per-customer Postgres overrides owned by account/support","tradeoff":"No deploy needed to raise a limit and each enterprise gets its own number, but requires a UI or process to prevent ad-hoc changes.","holds_when":"The ~20 enterprise customers have materially different legitimate burst profiles."},{"label":"Single hardcoded enterprise tier multiplier (e.g., 10x)","tradeoff":"Simple to implement, but all enterprise customers share the same cap and changing it needs a deploy or env change.","holds_when":"Enterprise traffic is similar enough that one tier is sufficient."},{"label":"No special limits; same cap for everyone","tradeoff":"Fair and minimal, but will throttle known heavy legitimate integrations.","holds_when":"You want uniform policy and are willing to adjust the global limit instead."}],"brief":{"where":"PLAN.md notes ~20 enterprise customers with scripted integrations that legitimately burst and lists enterprise limits as undecided.","what":"How higher limits are granted and who maintains the values.","how":"Determines the config source, approval workflow, and how quickly a limit can change.","evidence":[{"path":"PLAN.md","start":9,"end":12,"note":"Enterprise scripted integrations context."},{"path":"PLAN.md","start":12,"end":19,"note":"Enterprise limits listed as undecided."}]},"recommended":0,"header":"Q6 — Enterprise limits and ownership"},{"id":"get-limit","question":"Should we rate-limit POST /orders only and leave GET /orders unlimited for now?","options":[{"label":"Yes — limit POST only","tradeoff":"Matches the stated problem (expensive writes) and keeps cheap reads fast, but GET can still be abused.","holds_when":"GET traffic is not a concern and you want minimal blast radius."},{"label":"Share the same customer counter across POST and GET","tradeoff":"Protects all endpoints uniformly, but a heavy GET script can consume burst budget needed for orders.","holds_when":"You want one simple global per-customer cap."},{"label":"Apply a separate, lighter limit to GET","tradeoff":"Protects GET without affecting order creation, but adds a second counter to configure and monitor.","holds_when":"GET abuse is plausible and you want read protection."}],"brief":{"where":"PLAN.md says POST /orders is expensive and GET /orders is cheap, but does not decide whether GET is covered.","what":"Whether GET /orders should be rate limited and, if so, how.","how":"Decides if the middleware runs only on POST or on both methods, and whether GET gets its own bucket.","evidence":[{"path":"PLAN.md","start":7,"end":10,"note":"POST expensive, GET cheap."},{"path":"src/server.ts","start":10,"end":17,"note":"Both endpoints use the same customer identity."}]},"recommended":0,"header":"Q7 — GET /orders coverage"},{"id":"rejected-response","question":"Should throttled clients receive HTTP 429 with a `Retry-After` header (and `RateLimit` headers)?","options":[{"label":"Yes — 429 with Retry-After and RateLimit headers","tradeoff":"Best client ergonomics: scripts can back off correctly, but you must keep header values consistent with the chosen algorithm.","holds_when":"Callers are scripted integrations that can interpret standard rate-limit headers."},{"label":"429 without extra headers","tradeoff":"Standard status code, but scripts do not know when to retry and may hammer the API.","holds_when":"You want minimal response work."},{"label":"503 Service Unavailable","tradeoff":"May be treated as a server error rather than quota and can confuse client retry logic.","holds_when":"You want to signal temporary unavailability generically."}],"brief":{"where":"PLAN.md lists the rejected-client experience as undecided; the server currently returns JSON or plain text.","what":"Status code and headers returned when a request exceeds the limit.","how":"Affects how enterprise scripts react and whether they retry immediately.","evidence":[{"path":"PLAN.md","start":12,"end":20,"note":"Rejected-client response listed as undecided."},{"path":"src/server.ts","start":1,"end":19,"note":"Current response patterns."}]},"recommended":0,"header":"Q8 — Rejected client response"},{"id":"rollout","question":"Should we roll out via shadow mode, then enforce with the high default limit, then tune per customer?","options":[{"label":"Yes — shadow → enforce high → tune per customer","tradeoff":"Safest for enterprise integrations but takes the most time and requires metrics/logging.","holds_when":"You cannot afford to break the ~20 enterprise integrations and want data before tightening."},{"label":"Enable enforcement immediately with the chosen default","tradeoff":"Fastest protection, but any wrong default breaks integrations immediately.","holds_when":"You are confident the default limit is above all legitimate traffic."},{"label":"Whitelist the enterprise customers and enforce only on the rest","tradeoff":"Protects non-enterprise quickly, but leaves enterprise unprotected until overrides are configured.","holds_when":"You want immediate protection for most callers and can configure overrides separately."}],"brief":{"where":"PLAN.md says ship this week and lists rollout without breaking enterprise integrations as undecided.","what":"How enforcement is deployed.","how":"Determines observability needs and the blast radius of a bad default.","evidence":[{"path":"PLAN.md","start":1,"end":4,"note":"Ship this week goal."},{"path":"PLAN.md","start":12,"end":21,"note":"Rollout is listed as undecided."}]},"recommended":0,"header":"Q9 — Rollout strategy"}]}
```

### ask result

```text
User answers:
key: (cancelled)
algorithm: (cancelled)
store: (cancelled)
store-failure: (cancelled)
default-limit: (cancelled)
enterprise-limits: (cancelled)
get-limit: (cancelled)
rejected-response: (cancelled)
rollout: (cancelled)
```

