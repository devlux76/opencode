import { expect, test } from "bun:test"
import { Message } from "@opencode/ai"
import type { Plugin } from "@opencode/plugin"
import { plugin, type Check } from "../index"
import type { Trailblazer } from "../trailblazer"

// The plugin touches only these parts of its context, so the test supplies just them.
type Hook = (event: any) => Promise<void> | void
interface Harness {
  hooks: Map<string, Hook>
  tools: Array<{ name: string; execute: (input: any, context: any) => Promise<{ content?: unknown }> }>
  persisted: Array<{ sessionID: string; text: string; description?: string; resume?: boolean }>
  calls: Array<{ op: string; body: Record<string, unknown> }>
  emit: (event: { type: string; data: Record<string, unknown> }) => void
  subscribed: () => boolean
  cleanup: (() => void | Promise<void>) | void
}

async function start(options: {
  repo?: string | undefined
  answers?: Record<string, Trailblazer.Answer<unknown>>
  check?: Check
}): Promise<Harness> {
  const hooks = new Map<string, Hook>()
  const tools: Harness["tools"] = []
  const persisted: Harness["persisted"] = []
  const calls: Harness["calls"] = []
  const queue: Array<{ type: string; data: Record<string, unknown> }> = []
  let wake: (() => void) | undefined
  let subscribed = false
  const ctx = {
    options: {},
    location: { directory: "/work/dir" },
    session: {
      hook: async (name: string, callback: Hook) => {
        hooks.set(name, callback)
        return { dispose: async () => {} }
      },
      synthetic: async (input: Harness["persisted"][number]) => {
        persisted.push(input)
        return { data: {} }
      },
    },
    tool: {
      transform: async (callback: (editor: { add: (tool: any) => void }) => void) => {
        callback({ add: (tool) => tools.push(tool) })
        return { dispose: async () => {} }
      },
    },
    event: {
      subscribe: (requestOptions?: { signal?: AbortSignal }) => {
        subscribed = true
        return (async function* () {
          while (!requestOptions?.signal?.aborted) {
            const next = queue.shift()
            if (next) yield next
            else await new Promise<void>((resolve) => (wake = resolve))
          }
        })()
      },
    },
  } as unknown as Plugin.Context
  const client = {
    call: async (op: string, body: Record<string, unknown>) => {
      calls.push({ op, body })
      return options.answers?.[op] ?? { ok: false as const, reason: `no ${op}` }
    },
  }
  const cleanup = await plugin({
    client,
    repoRoot: async () => ("repo" in options ? options.repo : "/work"),
    check: options.check,
  }).setup(ctx)
  return {
    hooks,
    tools,
    persisted,
    calls,
    emit: (event) => {
      queue.push(event)
      wake?.()
    },
    subscribed: () => subscribed,
    cleanup,
  }
}

const trail = (text: string): Trailblazer.Answer<unknown> => ({ ok: true, value: { text, items: [], notes: [] } })

const request = (messages: Message[]) => ({
  sessionID: "ses_1",
  agent: "build",
  model: { providerID: "test", id: "m" },
  system: [],
  messages,
  tools: {},
  options: {},
})

const prompt = (messageID: string, text: string) => ({
  sessionID: "ses_1",
  messageID,
  prompt: { text },
  delivery: "queue",
})

const textOf = (message: Message) => message.content.map((part) => (part.type === "text" ? part.text : "")).join("")

test("grounds a task just before its prompt, as a host message, and persists nothing", async () => {
  const h = await start({ answers: { trail: trail("packages/a.ts:1-3\nsource") } })
  await h.hooks.get("prompt")!(prompt("msg_1", "fix `authDisabled`"))
  const event = request([Message.user("fix `authDisabled`")])
  await h.hooks.get("context")!(event)

  expect(event.messages).toHaveLength(2)
  const block = event.messages[0]
  expect(block).toBeInstanceOf(Message)
  expect(textOf(block).startsWith('<trailblazer-grounding task="msg_1" repo="/work" source="trail">')).toBe(true)
  expect(textOf(block)).toContain("packages/a.ts:1-3\nsource")
  expect(textOf(event.messages[1])).toBe("fix `authDisabled`")
  expect(h.calls).toEqual([{ op: "trail", body: { repo: "/work", request: "fix `authDisabled`", budget: 3000 } }])
  // A stored message would be replayed as new input and cost a model turn.
  expect(h.persisted).toEqual([])
})

test("every turn of a task gets the same block in the same place, from one retrieval", async () => {
  const h = await start({ answers: { trail: trail("t") } })
  await h.hooks.get("prompt")!(prompt("msg_1", "task one"))
  const first = request([Message.user("system note"), Message.user("task one")])
  await h.hooks.get("context")!(first)
  const later = request([Message.user("system note"), Message.user("task one"), Message.assistant("working")])
  await h.hooks.get("context")!(later)
  expect(textOf(later.messages[1])).toBe(textOf(first.messages[1]))
  expect(textOf(later.messages[2])).toBe("task one")
  expect(h.calls).toHaveLength(1)
})

test("a new task is grounded afresh, and only the current task's block is sent", async () => {
  const h = await start({ answers: { trail: trail("t") } })
  await h.hooks.get("prompt")!(prompt("msg_1", "task one"))
  await h.hooks.get("context")!(request([Message.user("task one")]))
  await h.hooks.get("prompt")!(prompt("msg_2", "task two"))
  const second = request([Message.user("task one"), Message.assistant("done"), Message.user("task two")])
  await h.hooks.get("context")!(second)
  expect(h.calls.map((call) => call.body.request)).toEqual(["task one", "task two"])
  expect(second.messages.map(textOf).flatMap((text) => [...text.matchAll(/task="([^"]+)"/g)].map((m) => m[1]))).toEqual([
    "msg_2",
  ])
  expect(textOf(second.messages.at(-1)!)).toBe("task two")
})

test("a prompt still queued behind the running task is not grounded early", async () => {
  const h = await start({ answers: { trail: trail("t") } })
  await h.hooks.get("prompt")!(prompt("msg_1", "task one"))
  await h.hooks.get("prompt")!(prompt("msg_2", "task two"))
  const event = request([Message.user("task one"), Message.assistant("step")])
  await h.hooks.get("context")!(event)
  expect(h.calls.map((call) => call.body.request)).toEqual(["task one"])
  expect(textOf(event.messages[0])).toContain('task="msg_1"')
})

test("a compacted history that ends in another user message is grounded afresh", async () => {
  const h = await start({ answers: { trail: trail("t") } })
  await h.hooks.get("prompt")!(prompt("msg_1", "task one"))
  await h.hooks.get("context")!(request([Message.user("task one")]))
  const compacted = request([Message.user("summary of earlier work")])
  await h.hooks.get("context")!(compacted)
  expect(h.calls.map((call) => call.body.request)).toEqual(["task one", "summary of earlier work"])
  expect(textOf(compacted.messages[0])).toMatch(/^<trailblazer-grounding task="text_/)
})

test("a prompt that other plugins wrapped in tagged blocks is still found", async () => {
  // superpowers puts <EXTREMELY_IMPORTANT>…</EXTREMELY_IMPORTANT> into the user's message on the live
  // server: as its own part, or in the same text as the prompt.
  const tag = "<EXTREMELY_IMPORTANT>\nYou have superpowers.\n</EXTREMELY_IMPORTANT>"
  for (const content of [
    [Message.text(tag), Message.text("fix `authDisabled`")],
    [Message.text(`${tag}fix \`authDisabled\``)],
  ]) {
    const h = await start({ answers: { trail: trail("t") } })
    await h.hooks.get("prompt")!(prompt("msg_1", "fix `authDisabled`"))
    const event = request([Message.user(content)])
    await h.hooks.get("context")!(event)
    expect(h.calls.map((call) => call.body.request)).toEqual(["fix `authDisabled`"])
    expect(textOf(event.messages[0])).toContain('<trailblazer-grounding task="msg_1"')
  }
})

test("a user message made only of tagged blocks is not a prompt", async () => {
  const h = await start({ answers: { trail: trail("t") } })
  const event = request([Message.user("task one"), Message.user("<system-reminder>be careful</system-reminder>")])
  await h.hooks.get("context")!(event)
  expect(h.calls.map((call) => call.body.request)).toEqual(["task one"])
})

test("outside a git repository the block says so and Trailblazer is not asked", async () => {
  const h = await start({ repo: undefined })
  await h.hooks.get("prompt")!(prompt("msg_1", "task"))
  const event = request([Message.user("task")])
  await h.hooks.get("context")!(event)
  expect(h.calls).toEqual([])
  expect(textOf(event.messages[0])).toContain("Grounding unavailable: /work/dir is not inside a git repository.")
})

test("a prompt that predates the plugin is keyed by its text", async () => {
  const h = await start({ answers: { trail: trail("t") } })
  const event = request([Message.user("old task")])
  await h.hooks.get("context")!(event)
  expect(h.calls).toHaveLength(1)
  expect(textOf(event.messages[0])).toMatch(/^<trailblazer-grounding task="text_[0-9a-z]+"/)
})

test("registers the four lookups, scoped to the repository", async () => {
  const h = await start({ answers: { where: { ok: true, value: [{ id: 1 }] } } })
  expect(h.tools.map((tool) => tool.name)).toEqual([
    "trailblazer_where",
    "trailblazer_uses",
    "trailblazer_impact",
    "trailblazer_read",
  ])
  const where = await h.tools[0].execute({ name: "authDisabled" }, {})
  expect(where.content).toBe(JSON.stringify([{ id: 1 }], null, 1))
  expect(h.calls).toEqual([{ op: "where", body: { repo: "/work", name: "authDisabled" } }])
  const uses = await h.tools[1].execute({ name: "x" }, {})
  expect(uses.content).toBe("Trailblazer uses unavailable: no uses")
})

test("with no checker, nothing follows the event stream", async () => {
  const h = await start({})
  expect(h.subscribed()).toBe(false)
})

test("after a grounded run succeeds, the checker's note goes before the next task's prompt, unpersisted", async () => {
  const checked: Array<{ repo: string; sessionID: string; text: string }> = []
  const done = Promise.withResolvers<void>()
  const h = await start({
    answers: { trail: trail("t") },
    check: async (input) => {
      checked.push(input)
      done.resolve()
      return "<trailblazer-evidence-check>1 missing</trailblazer-evidence-check>"
    },
  })
  await h.hooks.get("prompt")!(prompt("msg_1", "task one"))
  await h.hooks.get("context")!(request([Message.user("task one")]))
  h.emit({ type: "session.text.ended", data: { sessionID: "ses_other", text: "not grounded" } })
  h.emit({ type: "session.execution.succeeded", data: { sessionID: "ses_other" } })
  h.emit({ type: "session.text.ended", data: { sessionID: "ses_1", text: "draft" } })
  h.emit({ type: "session.text.ended", data: { sessionID: "ses_1", text: "final answer, see a.ts:1-3" } })
  h.emit({ type: "session.execution.succeeded", data: { sessionID: "ses_1" } })
  await done.promise
  await Bun.sleep(0)
  expect(checked).toEqual([{ repo: "/work", sessionID: "ses_1", text: "final answer, see a.ts:1-3" }])
  // A stored message posted as a run ends is drained as new input and costs a model turn.
  expect(h.persisted).toEqual([])

  const history = [Message.user("task one"), Message.assistant("final answer, see a.ts:1-3")]
  await h.hooks.get("prompt")!(prompt("msg_2", "task two"))
  const next = request([...history, Message.user("task two")])
  await h.hooks.get("context")!(next)
  expect(next.messages.map(textOf).slice(2)).toEqual([
    "<trailblazer-evidence-check>1 missing</trailblazer-evidence-check>",
    expect.stringContaining('<trailblazer-grounding task="msg_2"'),
    "task two",
  ])

  // It concerns the task right after it; the one after that no longer sees it.
  await h.hooks.get("prompt")!(prompt("msg_3", "task three"))
  const later = request([...history, Message.user("task two"), Message.assistant("ok"), Message.user("task three")])
  await h.hooks.get("context")!(later)
  expect(later.messages.map(textOf).some((text) => text.includes("evidence-check"))).toBe(false)
  await h.cleanup?.()
})
