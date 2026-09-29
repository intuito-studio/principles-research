export const meta = {
  name: 'principles-atlas',
  description: 'Deep multi-facet principles research: fan out principles-scout workers per facet, audit every citation, synthesize one cited brief into ~/.claude/research/',
  whenToUse: 'Big or multi-facet research topics where one principles-scout pass is not enough. Args: the topic as a string, or {topic, depth: "standard" | "exhaustive"}.',
  phases: [
    { title: 'Scope', detail: 'decompose the topic into facet research questions' },
    { title: 'Research', detail: 'one principles-scout per facet (model pinned by agent frontmatter)' },
    { title: 'Verify', detail: 'skeptical citation audit per facet, on the session model' },
    { title: 'Synthesize', detail: 'one-shot cited brief from verified findings, on the session model' },
  ],
}

const topic = typeof args === 'string' ? args : (args && args.topic)
if (!topic) throw new Error('Pass a topic: /principles-research:principles-atlas <topic>, or {topic, depth: "exhaustive"}')
const depth = (args && typeof args === 'object' && args.depth) === 'exhaustive' ? 'exhaustive' : 'standard'
const maxFacets = depth === 'exhaustive' ? 8 : 5
const scoutBudget = depth === 'exhaustive' ? 'deep dive: 20-30 tool calls' : 'standard: 10-20 tool calls'

const FACETS_SCHEMA = {
  type: 'object',
  required: ['research_brief', 'facets'],
  properties: {
    research_brief: { type: 'string', description: 'One north-star research question preserving the user intent' },
    facets: {
      type: 'array',
      items: {
        type: 'object',
        required: ['question', 'rationale', 'likely_sources'],
        properties: {
          question: { type: 'string' },
          rationale: { type: 'string' },
          likely_sources: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
}

const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['findings', 'sources_fetched'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['kind', 'claim', 'detail', 'confidence', 'sources'],
        properties: {
          kind: { enum: ['principle', 'anti_pattern', 'pain_point', 'context'] },
          claim: { type: 'string', description: 'One concrete principle/anti-pattern/pain point' },
          detail: { type: 'string', description: 'Why it matters + the supporting evidence' },
          quote: { type: 'string', description: 'Short verbatim quote from a fetched page' },
          confidence: { enum: ['established', 'supported', 'contested'] },
          sources: { type: 'array', items: { type: 'string' }, description: 'URLs actually fetched that support this claim' },
        },
      },
    },
    sources_fetched: {
      type: 'array',
      items: {
        type: 'object',
        required: ['url', 'title'],
        properties: { url: { type: 'string' }, title: { type: 'string' }, note: { type: 'string' } },
      },
    },
    gaps: { type: 'string', description: 'What this facet could not settle' },
  },
}

const AUDIT_SCHEMA = {
  type: 'object',
  required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['claim_index', 'verdict'],
        properties: {
          claim_index: { type: 'integer' },
          verdict: { enum: ['confirmed', 'weak', 'unsupported'] },
          note: { type: 'string' },
        },
      },
    },
  },
}

phase('Scope')
const scope = await agent(
  `Topic: "${topic}"

Plan a principles-research campaign. First write a research_brief: one north-star research question that preserves the user's intent (what should someone know before designing, building, or choosing in this space?). Then decompose it into at most ${maxFacets} facet questions that together cover: core principles and definitions; what distinguishes good from bad (anti-patterns, failure modes); practitioner pain points from real communities; current state of the art; plus facets specific to this topic. For each facet give a rationale and 2-4 likely authoritative starting sources (official docs, standards bodies, recognized authorities). Use WebSearch briefly if needed to identify who the authorities are — do not research the facets themselves.`,
  { label: 'scope', schema: FACETS_SCHEMA },
)

log(`Scoped ${scope.facets.length} facets for "${topic}" (depth: ${depth})`)

// Research + Verify stream per facet: a facet's audit starts as soon as its scout
// finishes, while other scouts are still running. Scouts run on the model pinned in
// principles-scout frontmatter; auditors inherit the session model (no override).
const results = await pipeline(
  scope.facets,
  (f, _item, i) =>
    agent(
      `North-star research brief: ${scope.research_brief}

YOUR FACET (research only this; parallel agents cover the rest):
${f.question}
Why it matters: ${f.rationale}
Start from these likely-authoritative sources, then broaden: ${f.likely_sources.join(', ')}

Overrides for this run: do NOT write any files and do NOT produce a markdown brief — return your findings through the StructuredOutput tool only. Effort budget — ${scoutBudget}. Follow your citation discipline exactly: every finding cites only URLs you actually fetched, each with a short quote.`,
      { agentType: 'principles-research:principles-scout', label: `scout ${i + 1}: ${f.question.slice(0, 50)}`, phase: 'Research', schema: FINDINGS_SCHEMA },
    ),
  (findings, f, i) => {
    if (!findings || !findings.findings.length) return null
    const claims = findings.findings
      .map(
        (c, idx) =>
          `[${idx}] (${c.kind}, ${c.confidence}) ${c.claim}` +
          (c.quote ? `\n    quote: "${c.quote}"` : '') +
          `\n    cites: ${c.sources.join(' , ')}`,
      )
      .join('\n')
    return agent(
      `You are a skeptical citation auditor. For each claim below, fetch the cited URL(s) (WebFetch; Firecrawl via ToolSearch if a fetch fails) and judge whether the page genuinely supports the claim — and the quote, when one is given.

Verdicts: "confirmed" (page clearly supports it), "weak" (page exists but support is thin or indirect), "unsupported" (page unreachable, or it does not say this). Default to "weak" when uncertain; reserve "unsupported" for clear failures. Audit every claim by its [index].

${claims}`,
      { label: `audit ${i + 1}`, phase: 'Verify', schema: AUDIT_SCHEMA },
    ).then((audit) => ({ facet: f, findings, audit }))
  },
)

phase('Synthesize')
const clean = results.filter(Boolean)
const verified = []
let dropped = 0
const sourceTitles = {}
for (const r of clean) {
  const byIdx = new Map(((r.audit && r.audit.verdicts) || []).map((v) => [v.claim_index, v]))
  r.findings.findings.forEach((c, idx) => {
    const v = byIdx.get(idx)
    if (v && v.verdict === 'unsupported') {
      dropped += 1
      return
    }
    verified.push({ facet: r.facet.question, audit: v ? v.verdict : 'unaudited', audit_note: v && v.note, ...c })
  })
  for (const s of r.findings.sources_fetched) sourceTitles[s.url] = s.title
}
log(`${verified.length} claims survived the citation audit (${dropped} dropped) across ${clean.length}/${scope.facets.length} facets`)
if (clean.length < scope.facets.length) log(`Warning: ${scope.facets.length - clean.length} facet(s) returned nothing and are NOT covered in the brief`)
if (!verified.length) throw new Error('No verified findings survived the audit — not writing a brief')

const gaps = clean.map((r) => r.findings.gaps).filter(Boolean)

const brief = await agent(
  `Write the final principles brief for "${topic}" and save it to ~/.claude/research/<topic-slug>.md (lowercase-hyphen slug from the topic; if the file exists, read it first and merge — this deep brief supersedes overlapping content). Today's date is in your environment details.

Write in ONE pass from ONLY the verified findings below. Do not add claims from memory, and do not invent or alter citations — every citation must be one of the URLs in the findings. Treat claims audited "weak" or "unaudited" as at most (supported), never (established), unless multiple independent findings agree.

Structure:
# <Topic> — Principles Brief
> Researched: <date> · Depth: ${depth} (principles-atlas, per-claim citation audit) · <N> sources
## Scope & method — the north-star question, facets covered, and these known gaps: ${JSON.stringify(gaps)}
## Core principles — each: **Principle.** Why it matters + evidence with quote. [n] — confidence
## Anti-patterns
## Practitioner pain points — each with how to avoid it
## Contested & open questions
## Sources — [n] Title — URL, numbered sequentially without gaps, deduplicated

North-star question: ${scope.research_brief}

Verified findings (${verified.length}):
${JSON.stringify(verified, null, 1)}

Source titles: ${JSON.stringify(sourceTitles, null, 1)}

After writing the file, reply with: the file path, an 8-12 bullet digest of the most decision-relevant findings, and counts (principles / anti-patterns / pain points / sources / claims dropped by audit: ${dropped}).`,
  { label: 'synthesize', phase: 'Synthesize' },
)

return brief
