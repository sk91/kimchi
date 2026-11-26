import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

/**
 * Registers `--agent-dir` with pi purely so pi's own flag validation
 * (`createAgentSessionServices` → `applyExtensionFlagValues`) doesn't reject
 * it as unknown once a real session starts — it's never read here.
 * `--agent-dir` is consumed entirely in `entry.ts`'s raw-argv scan, before
 * any extension loads, which means pi's own parser never recognizes it
 * natively (unlike `--mode`/`--session-id`) and no extension's setup reads
 * its value via `pi.getFlag()` the way `--mcp-config`/`--permissions-config`
 * do — so without this registration, pi treats it as an unrecognized
 * "extension flag" and fails every session with "Unknown option: --agent-dir",
 * unconditionally, regardless of the agent dir's contents.
 */
export default function agentDirFlagExtension(pi: ExtensionAPI): void {
	pi.registerFlag("agent-dir", {
		description: "Override the agent dir (skills, agents, auth, settings) for this run",
		type: "string",
	})
}
