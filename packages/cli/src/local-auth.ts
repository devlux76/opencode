// Our fork: OPENCODE_SERVER_AUTH=disabled runs the server without a password. We are
// entirely local, so only a loopback-bound server may do that; anything else refuses to start.
const loopback = ["127.0.0.1", "localhost", "::1", "[::1]"]

export function authDisabled(env: Record<string, string | undefined>, hostname: string) {
  if (env.OPENCODE_SERVER_AUTH !== "disabled") return false
  if (!loopback.includes(hostname))
    throw new Error(`OPENCODE_SERVER_AUTH=disabled requires a loopback hostname, not ${hostname}`)
  return true
}
