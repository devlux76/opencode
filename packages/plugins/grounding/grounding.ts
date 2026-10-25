export * as Grounding from "./grounding"

import { Trailblazer } from "./trailblazer"

type Client = { call: (op: string, body: Record<string, unknown>, timeoutMs: number) => Promise<Trailblazer.Answer<unknown>> }

export interface Retrieved {
  /** trail: Trailblazer's ranked trail; search: the degraded stand-in; none: nothing answered. */
  source: "trail" | "search" | "none"
  body: string
  notes: string[]
  /** Why grounding is weaker than a full trail, when it is. */
  degraded: string | undefined
}

export interface RetrieveOptions {
  repo: string
  request: string
  budgetTokens: number
  /** Bound on the trail request. */
  trailMs: number
  /** Bound on each fallback request. */
  lightMs: number
  /** Bound on all of retrieval: the fallback gets only what the trail left. */
  totalMs: number
}

// Trailblazer counts a token as 4 characters.
const CHARS_PER_TOKEN = 4
const CUT = "\n[trail cut to the grounding budget]"
const MAX_NAMES = 6
const MAX_LOCATIONS = 20

/** Try the full trail; if it fails or is slow, stand in with search plus exact-name lookups. */
export async function retrieve(client: Client, options: RetrieveOptions): Promise<Retrieved> {
  const deadline = performance.now() + options.totalMs
  const left = () => Math.floor(deadline - performance.now())
  const maxChars = options.budgetTokens * CHARS_PER_TOKEN
  const trail = await client.call(
    "trail",
    { repo: options.repo, request: options.request, budget: options.budgetTokens },
    Math.min(options.trailMs, options.totalMs),
  )
  const parsed = trail.ok ? Trailblazer.parseTrail(trail.value) : undefined
  if (parsed)
    return { source: "trail", body: fit(parsed.text, maxChars), notes: warnings(parsed), degraded: undefined }
  const degraded = trail.ok ? "Trailblazer answered trail in an unexpected shape" : trail.reason
  if (left() <= 0) return { source: "none", body: "", notes: [], degraded: `${degraded}; no time left for search` }

  // Every fallback request shares what is left; Trailblazer.connect aborts each at its bound.
  const bound = Math.min(options.lightMs, left())
  const names = identifiers(options.request).filter((name) => !name.includes("/"))
  const [search, ...wheres] = await Promise.all([
    client.call("search", { repo: options.repo, text: options.request.slice(0, 500), limit: 8 }, bound),
    ...names.map((name) => client.call("where", { repo: options.repo, name }, bound)),
  ])
  // Exact names first: they are what the task literally mentions.
  const nodes = [...wheres, search].flatMap((answer) => (answer.ok ? (Trailblazer.parseNodes(answer.value) ?? []) : []))
  const unique = nodes
    .filter((node, index) => nodes.findIndex((other) => other.id === node.id) === index)
    .slice(0, MAX_LOCATIONS)
  if (unique.length === 0) return { source: "none", body: "", notes: [], degraded }
  const body = fit(unique.map(line).join("\n"), maxChars)
  return { source: "search", body, notes: warnings({ items: unique, notes: [] }), degraded }
}

/** Code-like names and paths a request mentions, in order: the anchors for exact lookups. */
export function identifiers(text: string): string[] {
  const found = (text.match(/`[^`\n]+`|[\w./-]+/g) ?? [])
    .map((token) => token.replace(/^`|`$/g, "").replace(/[.,;:)]+$/, ""))
    .filter((token) => {
      if (/\s/.test(token) || token.length < 3) return false
      if (/^[\w.-]+\/[\w./-]*\.\w+$/.test(token)) return true // a path with an extension
      if (/^[A-Za-z_]\w*(\.[A-Za-z_]\w+)+$/.test(token) && /[A-Z]/.test(token)) return true // Name.member
      if (/^[a-z]+[A-Z]\w*$/.test(token) || /^[A-Z][a-z0-9]+[A-Z]\w*$/.test(token)) return true // camel/Pascal
      return /^[a-z][a-z0-9]*_[a-z0-9_]+$/.test(token) // snake_case
    })
  return [...new Set(found)].slice(0, MAX_NAMES)
}

const OPEN = "<trailblazer-grounding"
const CLOSE = "</trailblazer-grounding>"

/** The text injected before the model's first turn on a task. */
export function render(task: string, repo: string, retrieved: Retrieved): string {
  const lines = [
    `${OPEN} task="${task}" repo="${repo}" source="${retrieved.source}">`,
    "Trailblazer, a code graph of this repository, picked the locations below as likely relevant to the task.",
    "They are candidates, not verified facts: read a location before relying on it, look names up with",
    "trailblazer_where / trailblazer_uses instead of guessing, and cite what you used as path:first-last.",
    "They are a starting point, not the whole answer: when the task needs something they do not show",
    "(a caller, a definition, a test), find it with those tools before you answer.",
  ]
  if (retrieved.source === "none")
    lines.push(
      `Grounding unavailable: ${neutral(retrieved.degraded ?? "no answer")}. Nothing here comes from Trailblazer; find and verify code yourself.`,
    )
  else if (retrieved.degraded)
    lines.push(`Grounding degraded: ${neutral(retrieved.degraded)}. Showing search and name lookups only.`)
  lines.push(...retrieved.notes.map((note) => `- ${neutral(note)}`))
  if (retrieved.body) lines.push("", neutral(retrieved.body))
  lines.push(CLOSE)
  return lines.join("\n")
}

/** Task IDs of the grounding blocks in a text. */
export function marks(text: string): string[] {
  return [...text.matchAll(/<trailblazer-grounding task="([^"]+)"/g)].map((match) => match[1])
}

function warnings(trail: { items: Trailblazer.Node[]; notes: string[] }) {
  const vectors = trail.notes.includes("no vectors") ? ["Trailblazer ranked without vectors (graph only)."] : []
  const stale = [...new Set(trail.items.filter((item) => item.stale).map((item) => item.path))].map(
    (file) => `${file} did not parse at its last edit; Trailblazer shows its last good version.`,
  )
  return [...vectors, ...stale]
}

function line(node: Trailblazer.Node) {
  const stale = node.stale ? " [stale]" : ""
  return `${node.path}:${node.start_line}-${node.end_line} ${node.kind} ${node.qualified}: ${node.signature}${stale}`
}

function fit(text: string, maxChars: number) {
  if (text.length <= maxChars) return text
  const room = text.slice(0, maxChars - CUT.length)
  return room.slice(0, Math.max(room.lastIndexOf("\n"), 0)) + CUT
}

// Retrieved text is repository content: it must not open, close or forge a block.
function neutral(text: string) {
  return text.replace(/<(\/?)trailblazer-grounding/gi, "[$1trailblazer-grounding")
}
