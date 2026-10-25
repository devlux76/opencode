import path from "node:path"
import { OPENCODE_CHANNEL, OPENCODE_VERSION } from "./version"

// Our fork ships compiled builds on the "local" channel (which also disables the updater). Those
// share the release database; running from source (version "local") keeps its own file.
function sharesReleaseDatabase(channel: string, version: string) {
  if (["latest", "dev", "beta", "next", "prod"].includes(channel)) return true
  return channel === "local" && version !== "local"
}

export function databasePath(data: string, channel = OPENCODE_CHANNEL, version = OPENCODE_VERSION) {
  const filename =
    process.env.OPENCODE_DB ??
    (sharesReleaseDatabase(channel, version) ||
    process.env.OPENCODE_DISABLE_CHANNEL_DB === "1" ||
    process.env.OPENCODE_DISABLE_CHANNEL_DB === "true"
      ? "opencode.db"
      : `opencode-${channel.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`)
  return filename === ":memory:" ? filename : path.resolve(data, filename)
}
