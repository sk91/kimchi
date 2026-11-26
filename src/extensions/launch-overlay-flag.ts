import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

/**
 * Registers `--launch-overlay` with pi purely so pi's own flag validation
 * (`createAgentSessionServices` → `applyExtensionFlagValues`) doesn't reject
 * it as unknown once a real session starts — it's never read here.
 * `--launch-overlay` is resolved entirely in `cli-args.ts`'s
 * `populateCliArgs()`, which backfills `permissions-config`/`mcp-config`
 * from it; no extension reads its own value via `pi.getFlag()`, so without
 * this registration pi treats it as an unrecognized "extension flag" and
 * fails every session with "Unknown option: --launch-overlay".
 */
export default function launchOverlayFlagExtension(pi: ExtensionAPI): void {
	pi.registerFlag("launch-overlay", {
		description: "Per-launch permissions/mcp overlay as inline JSON or a file path",
		type: "string",
	})
}
