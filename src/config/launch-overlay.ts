import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * Shape of `--launch-overlay`: everything an external orchestrator needs to
 * customize a single launch, composed into one value instead of a separate
 * flag (and a file written into some directory) per concern. Mirrors why
 * Claude's own `--settings` takes inline-or-file JSON rather than requiring
 * a `--permissions-file`/`--hooks-file`/etc. per concept.
 *
 * `permissions`/`mcp` are wired in this PR by reusing the existing
 * `--permissions-config`/`--mcp-config` file-based loaders verbatim (see
 * `resolveLaunchOverlayOptions`) — no new enforcement logic. `hooks`/
 * `classifier` are reserved for a follow-up: no CLI surface exists yet for
 * per-launch hook registration or auto-mode classifier steering.
 */
export interface LaunchOverlay {
	permissions?: unknown
	mcp?: unknown
}

/**
 * Parses `--launch-overlay`'s value: inline JSON (starts with `{`) or a path
 * to a JSON file, mirroring Claude's own `--settings` inline-or-file split.
 */
export function parseLaunchOverlayValue(value: string): LaunchOverlay {
	const raw = value.trimStart().startsWith("{") ? value : readFileSync(value, "utf-8")
	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch (err) {
		throw new Error(`Invalid --launch-overlay JSON: ${err instanceof Error ? err.message : String(err)}`)
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error("--launch-overlay must be a JSON object")
	}
	return parsed as LaunchOverlay
}

/**
 * Writes one overlay field to a private (0600) temp file so an existing
 * file-based loader (`--permissions-config`, `--mcp-config`) can read it
 * unchanged — mirrors Claude's own content-addressed 0600 `--settings` file
 * form. A fresh temp dir per call; the OS reclaims it, same as any other
 * kimchi-session temp file.
 */
export function materializeOverlayField(field: unknown, label: string): string {
	const dir = mkdtempSync(join(tmpdir(), `kimchi-launch-overlay-${label}-`))
	const path = join(dir, `${label}.json`)
	writeFileSync(path, JSON.stringify(field), { mode: 0o600 })
	return path
}

/**
 * Backfills `permissions-config`/`mcp-config` from `launch-overlay`'s
 * `permissions`/`mcp` fields, materialized to temp files the existing
 * loaders already read. An explicit `--permissions-config`/`--mcp-config`
 * always wins — the overlay only fills in what wasn't passed directly.
 */
export function resolveLaunchOverlayOptions<
	T extends { "launch-overlay"?: string; "permissions-config"?: string; "mcp-config"?: string },
>(options: T): T {
	const overlayValue = options["launch-overlay"]
	if (!overlayValue) return options
	const overlay = parseLaunchOverlayValue(overlayValue)
	const resolved = { ...options }
	if (overlay.permissions !== undefined && resolved["permissions-config"] === undefined) {
		resolved["permissions-config"] = materializeOverlayField(overlay.permissions, "permissions")
	}
	if (overlay.mcp !== undefined && resolved["mcp-config"] === undefined) {
		resolved["mcp-config"] = materializeOverlayField(overlay.mcp, "mcp")
	}
	return resolved
}
