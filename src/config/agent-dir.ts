import { join } from "node:path"

const AGENT_DIR_FLAG = "--agent-dir"

/**
 * Finds `--agent-dir <path>` or `--agent-dir=<path>` in raw argv, before any
 * flag-parsing library loads — mirrors `ssh-proxy.ts`'s `isProxyMode` scan.
 */
export function findAgentDirFlag(argv: readonly string[]): string | undefined {
	const eqForm = argv.find((arg) => arg.startsWith(`${AGENT_DIR_FLAG}=`))
	if (eqForm) return eqForm.slice(AGENT_DIR_FLAG.length + 1) || undefined
	const idx = argv.indexOf(AGENT_DIR_FLAG)
	if (idx !== -1 && argv[idx + 1] && !argv[idx + 1].startsWith("-")) return argv[idx + 1]
	return undefined
}

/**
 * Resolves the agent dir that `entry.ts` stamps onto `KIMCHI_CODING_AGENT_DIR`
 * / `PI_CODING_AGENT_DIR` before any pi-mono code loads.
 *
 * Always the hardcoded `~/.config/kimchi/harness` default, unless `--agent-dir
 * <path>` is passed on this invocation's own argv. A CLI flag rather than an
 * env var: an env var would be silently re-inherited by a nested/subagent
 * kimchi process the way `KIMCHI_CODING_AGENT_DIR` itself can be, where an
 * explicit argv flag only ever applies to the process it was actually passed
 * to.
 */
export function resolveAgentDir(argv: readonly string[], homeDir: string): string {
	const override = findAgentDirFlag(argv)?.trim()
	return override || join(homeDir, ".config", "kimchi", "harness")
}
