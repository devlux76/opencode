import type { Message } from "@opencode/ai"
import { Plugin } from "@opencode/plugin"
import type { Info as ToolInfo } from "@opencode/plugin/promise/tool"
import type { JsonSchema } from "effect"
import { Grounding } from "./grounding"
import { Trailblazer } from "./trailblazer"
import { Verify } from "./verify"

// Grounds each new task in Trailblazer's code graph before the model's first turn, gives the
// model Trailblazer lookups as tools, and (once a checker is supplied) appends an advisory
// evidence check when a run succeeds. Contract agreed with Codex over VORTEX, 2026-10-24.

type Client = ReturnType<typeof Trailblazer.connect>

/** The evidence check (verify.ts): reads the run's final text and returns an advisory note, or nothing to say. */
export type Check = (input: { repo: string; sessionID: string; text: string }) => Promise<string | undefined>

export interface Deps {
  client?: Client
  repoRoot?: (directory: string) => Promise<string | undefined>
  check?: Check
}

// Small-model sized budget. A trail is worth waiting for (operator, 2026-10-24): the bound only
// catches a hung Trailblazer, and one that is down fails at once (connection refused), not at it.
// Override per install through plugin options.
const DEFAULTS = { budgetTokens: 3000, trailMs: 300_000, lightMs: 3000, totalMs: 310_000 }
const TOOL_OUTPUT_CHARS = 16_000
const RECENT_PROMPTS = 20

export function plugin(deps: Deps = {}) {
  return Plugin.define({
    id: "local.grounding",
    async setup(ctx) {
      const settings = {
        budgetTokens: positive(ctx.options.budgetTokens, DEFAULTS.budgetTokens),
        trailMs: positive(ctx.options.trailMs, DEFAULTS.trailMs),
        lightMs: positive(ctx.options.lightMs, DEFAULTS.lightMs),
        totalMs: positive(ctx.options.totalMs, DEFAULTS.totalMs),
      }
      const endpoint = typeof ctx.options.endpointFile === "string" ? ctx.options.endpointFile : Trailblazer.endpointFile()
      const client = deps.client ?? Trailblazer.connect({ file: endpoint })
      const repo = await (deps.repoRoot ?? gitRoot)(ctx.location.directory)
      // Prompt text -> message ID per session, so a block can name the task it grounds.
      const prompts = new Map<string, Map<string, string>>()
      const blocks = new Map<string, { task: string; text: string }>()
      // The evidence check on a finished task, shown during the session's next task.
      const notes = new Map<string, Note>()

      await ctx.session.hook("prompt", (event) => {
        const known = prompts.get(event.sessionID) ?? new Map<string, string>()
        known.delete(event.prompt.text)
        known.set(event.prompt.text, event.messageID)
        // Only recent prompts can still be a request's latest; keep the server's memory flat.
        for (const old of [...known.keys()].slice(0, -RECENT_PROMPTS)) known.delete(old)
        prompts.set(event.sessionID, known)
      })

      // Awaited before every primary request (not compaction, title or generate). The task is the
      // latest user prompt the request carries, so a prompt still queued is not grounded early.
      // The block is never persisted (a stored message is replayed as new input and costs a model
      // turn); it goes in before the task's prompt on every request, so each turn of a task sends
      // the same prefix. Trailblazer is asked once per task; a compacted history that ends in a
      // different user message is a new task and is grounded afresh.
      await ctx.session.hook("context", async (event) => {
        const at = event.messages.findLastIndex((message) => message.role === "user" && prompt(message) !== undefined)
        const text = at >= 0 ? prompt(event.messages[at]) : undefined
        if (!text) return
        const task = prompts.get(event.sessionID)?.get(text) ?? `text_${Bun.hash(text).toString(36)}`
        if (event.messages.some((message) => texts(message).some((part) => Grounding.marks(part).includes(task)))) return
        let block = blocks.get(event.sessionID)
        if (block?.task !== task) {
          const started = performance.now()
          const retrieved = repo
            ? await Grounding.retrieve(client, { ...settings, repo, request: text })
            : unavailable(`${ctx.location.directory} is not inside a git repository`)
          // The block is not stored in the session, so this line is how anyone can see it happened.
          console.info(
            `grounding: ${event.sessionID} ${task} source=${retrieved.source} ` +
              `${Math.round(performance.now() - started)} ms` +
              (retrieved.degraded ? ` degraded: ${retrieved.degraded}` : ""),
          )
          block = { task, text: Grounding.render(task, repo ?? ctx.location.directory, retrieved) }
          blocks.set(event.sessionID, block)
        }
        const note = noteFor(notes, event.sessionID, task)
        const inserted = [...(note ? [note] : []), block.text]
        event.messages.splice(at, 0, ...inserted.map((text) => userMessage(event.messages, text)))
      })

      await ctx.tool.transform((editor) => {
        for (const tool of tools(client, repo, settings.lightMs)) editor.add(tool)
      })

      if (!deps.check || !repo) return
      const abort = new AbortController()
      void followRuns(ctx, deps.check, repo, blocks, notes, abort.signal)
      return () => abort.abort()
    },
  })
}

export default plugin({ check: Verify.note })

function tools(client: Client, repo: string | undefined, timeoutMs: number): ToolInfo<JsonSchema.JsonSchema>[] {
  // Each tool forwards the named fields of its input to one Trailblazer operation.
  const tool = (
    name: string,
    op: string,
    description: string,
    fields: Record<string, { type: "string" | "integer"; description: string; required: boolean }>,
  ): ToolInfo<JsonSchema.JsonSchema> => ({
    name,
    description,
    // Offered to the model directly, not only inside codemode's `execute`: weak models need them in plain sight.
    options: { codemode: false },
    input: {
      type: "object",
      properties: Object.fromEntries(
        Object.entries(fields).map(([key, field]) => [
          key,
          field.type === "integer"
            ? { type: "integer", minimum: 1, description: field.description }
            : { type: "string", description: field.description },
        ]),
      ),
      required: Object.entries(fields).flatMap(([key, field]) => (field.required ? [key] : [])),
      additionalProperties: false,
    },
    execute: async (input: unknown) => {
      if (!repo) return { content: "Trailblazer lookups need a git repository; this location is not inside one." }
      const body = pick(input, fields)
      if (typeof body === "string") return { content: body }
      const answer = await client.call(op, { repo, ...body }, timeoutMs * 3)
      if (!answer.ok) return { content: `Trailblazer ${op} unavailable: ${answer.reason}` }
      return { content: JSON.stringify(answer.value, null, 1).slice(0, TOOL_OUTPUT_CHARS) }
    },
  })
  const name = (description: string) => ({ type: "string" as const, description, required: true })
  const line = (description: string, required = true) => ({ type: "integer" as const, description, required })
  return [
    tool(
      "trailblazer_where",
      "where",
      "Where a name (function, class, method, `Name.member`) is declared in this repository, from Trailblazer's code graph. Use before guessing a name or path.",
      { name: name("The name to look up") },
    ),
    tool(
      "trailblazer_uses",
      "uses",
      "Every definition that uses a name, with the line; `uncertain: true` means the name is ambiguous. Use to find callers before changing something.",
      { name: name("The name whose users to list") },
    ),
    tool("trailblazer_impact", "impact", "What a change to a name could affect: users, then users of users, breadth first.", {
      name: name("The name to assess"),
      depth: line("How many hops (default 3)", false),
    }),
    tool("trailblazer_read", "read", "Exact lines of a repository file (path relative to the repository root).", {
      path: name("Repository-relative path"),
      first: line("First line"),
      last: line("Last line"),
    }),
  ]
}

// The host validates input against the schema; this keeps the forwarded body to the declared fields.
function pick(
  input: unknown,
  fields: Record<string, { type: "string" | "integer"; required: boolean }>,
): Record<string, unknown> | string {
  const record = typeof input === "object" && input !== null ? input : {}
  const body: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(fields)) {
    const value: unknown = Reflect.get(record, key)
    const valid = field.type === "integer" ? Number.isInteger(value) && Number(value) >= 1 : typeof value === "string"
    if (valid) body[key] = value
    else if (field.required) return `Missing or invalid \`${key}\` (${field.type}).`
  }
  return body
}

interface Note {
  /** The task the note judges. */
  after: string
  text: string
  /** The next task, once the note has been shown to it. */
  shownFor?: string
}

// A note on a task goes in for every turn of the task after it, then is dropped.
function noteFor(notes: Map<string, Note>, sessionID: string, task: string) {
  const note = notes.get(sessionID)
  if (!note || note.after === task) return undefined
  note.shownFor ??= task
  if (note.shownFor === task) return note.text
  notes.delete(sessionID)
  return undefined
}

// Advisory post-check: after a grounded run succeeds, hand its final text to the checker and
// keep what it says for the session's next task. It is not posted into the session: anything
// admitted as a run ends is drained as new input, and the smoke test saw it cost a model turn.
// It is logged, so a supervisor reading the server log sees it at once.
async function followRuns(
  ctx: Plugin.Context,
  check: Check,
  repo: string,
  blocks: Map<string, { task: string }>,
  notes: Map<string, Note>,
  signal: AbortSignal,
) {
  const last = new Map<string, string>()
  try {
    for await (const event of ctx.event.subscribe({ signal })) {
      const data = event.data as { sessionID?: string; text?: string }
      const block = data.sessionID ? blocks.get(data.sessionID) : undefined
      if (!data.sessionID || !block) continue
      if (event.type === "session.text.ended" && typeof data.text === "string") last.set(data.sessionID, data.text)
      if (event.type !== "session.execution.succeeded") continue
      const text = last.get(data.sessionID)
      last.delete(data.sessionID)
      if (!text) continue
      const note = await check({ repo, sessionID: data.sessionID, text }).catch((error) => {
        console.warn("grounding: the evidence check failed", data.sessionID, error)
        return undefined
      })
      if (!note) continue
      notes.set(data.sessionID, { after: block.task, text: note })
      console.warn("grounding: evidence check found problems", data.sessionID, note)
    }
  } catch (error) {
    if (!signal.aborted) console.warn("grounding: event stream ended", error)
  }
}

async function gitRoot(directory: string) {
  const child = Bun.spawn(["git", "-C", directory, "rev-parse", "--show-toplevel"], { stdout: "pipe", stderr: "ignore" })
  const [out, code] = await Promise.all([new Response(child.stdout).text(), child.exited])
  return code === 0 ? out.trim() || undefined : undefined
}

function unavailable(reason: string): Grounding.Retrieved {
  return { source: "none", body: "", notes: [], degraded: reason }
}

function texts(message: Message) {
  return message.content.flatMap((part) => (part.type === "text" && part.text ? [part.text] : []))
}

// A user message's prompt text: what is left once injected tagged blocks (reminders, our own blocks,
// superpowers' <EXTREMELY_IMPORTANT> that the live server puts into the same text) are taken out.
// A message made only of such blocks is not a prompt.
const TAGGED = /<([A-Za-z][\w-]*)\b[^>]*>[\s\S]*?<\/\1>/g
function prompt(message: Message) {
  return texts(message).join("\n").replace(TAGGED, "").trim() || undefined
}

// The host's messages are instances of its own Message class, which plugins cannot import;
// build ours with the same constructor so it encodes like the rest.
function userMessage(messages: ReadonlyArray<Message>, text: string): Message {
  const init = { role: "user" as const, content: [{ type: "text" as const, text }] }
  const sample = messages.find((message) => message.role === "user") ?? messages[0]
  // Every primary request carries the user's prompt, so a sample exists; the fallback is for safety.
  if (!sample) return Object.assign(Object.create(null), init)
  const made: Message = Reflect.construct(sample.constructor, [init])
  return made
}

function positive(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback
}
