/**
 * Discover context files (AGENTS.md, CLAUDE.md): global ones, then project
 * ones found by walking up from cwd to root.
 *
 * This replicates the discovery logic from Pi's internal
 * `loadProjectContextFiles()` (resource-loader.ts) which is not exported
 * as a standalone function. We need it to inject user-provided project
 * guidelines into our custom system prompts.
 *
 * Per directory, the first match wins: AGENTS.md is checked before CLAUDE.md.
 * When a primary file is found, its `.local.md` variant (e.g. CLAUDE.local.md)
 * is appended if present. A `.local.md` file without a primary file is also
 * loaded standalone. `.local.md` files are intended for user-specific,
 * gitignored overrides.
 *
 * The agent dir's `context/` subdirectory is scanned separately and isn't
 * subject to the first-match-wins rule: every `*.md` file in it becomes its
 * own global-tier {@link ContextFile}, labeled by filename stem, so an
 * orchestrator can hand the model several independently-named documents
 * (e.g. `context/role.md`, `context/culture.md`).
 *
 * Files are returned in root → cwd order (ancestors first).
 */

import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { getAgentDir } from "@earendil-works/pi-coding-agent"

/** Which discovery pass produced a {@link ContextFile} — the global agent dir
 *  (+ the Claude Code instructions file) vs. the cwd-to-root project walk. */
export type ContextFileTier = "global" | "project"

export interface ContextFile {
	path: string
	content: string
	tier: ContextFileTier
	/** For files discovered under the agent dir's `context/` directory: the
	 *  filename stem (e.g. "role" for "role.md"). A deliberate, orchestrator-chosen
	 *  tag, not incidental path structure, so it's safe to show the model directly
	 *  instead of hashing it like {@link contextFileLabel} does for AGENTS.md/CLAUDE.md. */
	label?: string
}

/** First 8 hex chars of a SHA-256 of `value` — enough to disambiguate
 *  same-tier files from different directories without exposing the path
 *  itself (home directory, project names) in a label the model reads. */
function shortHash(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 8)
}

/**
 * Label for a {@link ContextFile}'s own rendered section, e.g.
 * `"Global (a3f9c21b)"` or `"Project (5e21ffd0)"`. The hash disambiguates
 * multiple same-tier files (several project-ancestor directories) without
 * leaking the path itself into the model's context.
 */
export function contextFileLabel(file: ContextFile): string {
	const tierLabel = file.tier === "global" ? "Global" : "Project"
	if (file.label) return `${tierLabel}: ${file.label}`
	return `${tierLabel} (${shortHash(file.path)})`
}

const CONTEXT_FILE_NAMES = ["AGENTS.md", "CLAUDE.md"]

/** Subdirectory of the agent dir scanned for additional named context files
 *  (e.g. `context/role.md`, `context/culture.md`). Unlike AGENTS.md/CLAUDE.md,
 *  these support more than one file per tier. */
const CONTEXT_SUBDIR_NAME = "context"

function tryReadFile(filePath: string): string | null {
	if (!existsSync(filePath)) return null
	try {
		return readFileSync(filePath, "utf-8")
	} catch {
		return null
	}
}

/** Derive the `.local.md` variant for a context filename, e.g. "CLAUDE.md" → "CLAUDE.local.md". */
function localVariant(filename: string): string {
	return filename.replace(/\.md$/, ".local.md")
}

/** Same real path or same trimmed text. */
function isAlreadyLoaded(filePath: string, content: string, alreadyLoaded: readonly ContextFile[]): boolean {
	const trimmed = content.trim()
	return alreadyLoaded.some((file) => sameRealPath(file.path, filePath) || file.content.trim() === trimmed)
}

function loadContextFileFromDir(dir: string, alreadyLoaded: readonly ContextFile[]): ContextFile | null {
	for (const filename of CONTEXT_FILE_NAMES) {
		const filePath = join(dir, filename)
		const localPath = join(dir, localVariant(filename))
		const primary = tryReadFile(filePath)
		const local = tryReadFile(localPath)

		if (primary !== null) {
			// Check before the merge so .local.md survives. The duplicate still claims the dir.
			if (isAlreadyLoaded(filePath, primary, alreadyLoaded)) {
				return local !== null ? { path: localPath, content: local, tier: "project" } : null
			}
			const content = local !== null ? `${primary}\n\n${local}` : primary
			return { path: filePath, content, tier: "project" }
		}
		if (local !== null) {
			return { path: localPath, content: local, tier: "project" }
		}
	}
	return null
}

/**
 * Walk from `cwd` up to the filesystem root, collecting one context file
 * per directory. Returns them in ancestor-first order (root → cwd).
 * Primary files that repeat one of `alreadyLoaded` are skipped.
 */
export function loadProjectContextFiles(cwd: string, alreadyLoaded: readonly ContextFile[] = []): ContextFile[] {
	const files: ContextFile[] = []

	let dir = resolve(cwd)
	const root = resolve("/")

	while (true) {
		const found = loadContextFileFromDir(dir, alreadyLoaded)
		if (found) {
			files.unshift(found)
		}

		if (dir === root) break
		const parent = resolve(dir, "..")
		if (parent === dir) break
		dir = parent
	}

	return files
}

/**
 * Scan `<agentDir>/context/*.md` for additional named context files, one
 * {@link ContextFile} per file, labeled by filename stem (e.g. "role" for
 * "role.md"). Unlike AGENTS.md/CLAUDE.md, this supports any number of files.
 * Returns them sorted by filename for a deterministic prompt order.
 */
function loadContextDirectoryFiles(agentDir: string): ContextFile[] {
	const contextDir = join(agentDir, CONTEXT_SUBDIR_NAME)
	let entries: string[]
	try {
		// A symlinked file (e.g. a culture.md shared across seats, pointing at one
		// canonical path) reports as isSymbolicLink(), not isFile() — readdir's
		// Dirent type reflects the directory entry itself, never the link target.
		// tryReadFile below already handles a broken link or a symlink-to-directory.
		entries = readdirSync(contextDir, { withFileTypes: true })
			.filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith(".md"))
			.map((entry) => entry.name)
			.sort()
	} catch {
		return []
	}

	const files: ContextFile[] = []
	for (const name of entries) {
		const filePath = join(contextDir, name)
		const content = tryReadFile(filePath)
		if (content === null) continue
		files.push({ path: filePath, content, tier: "global", label: name.slice(0, -".md".length) })
	}
	return files
}

export interface GlobalContextFileOptions {
	includeClaudeCodeInstructions: boolean
}

/** Matches Claude Code, which honors CLAUDE_CONFIG_DIR. */
export function claudeCodeInstructionsPath(): string {
	return join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "CLAUDE.md")
}

function sameRealPath(a: string, b: string): boolean {
	try {
		return realpathSync(a) === realpathSync(b)
	} catch {
		return false
	}
}

/**
 * Global context files, in prompt order:
 * 1. `~/.claude/CLAUDE.md` (or `$CLAUDE_CONFIG_DIR`), if enabled. Skipped when it repeats AGENTS.md.
 * 2. Kimchi's AGENTS.md (+ AGENTS.local.md).
 */
export function loadGlobalContextFiles(options: GlobalContextFileOptions): ContextFile[] {
	return readGlobalContextFiles(options).files
}

/**
 * `sources` holds each global file before the .local.md merge. Project files
 * are compared against it, so a project copy of AGENTS.md still matches when
 * a global AGENTS.local.md exists.
 */
function readGlobalContextFiles(options: GlobalContextFileOptions): { files: ContextFile[]; sources: ContextFile[] } {
	const files: ContextFile[] = []
	const dir = getAgentDir()
	const agentsPath = dir ? join(dir, "AGENTS.md") : undefined
	const agentsPrimary = agentsPath ? tryReadFile(agentsPath) : null

	if (options.includeClaudeCodeInstructions) {
		const claudePath = claudeCodeInstructionsPath()
		const claude = tryReadFile(claudePath)
		const duplicate =
			claude !== null &&
			agentsPath !== undefined &&
			agentsPrimary !== null &&
			(sameRealPath(claudePath, agentsPath) || claude.trim() === agentsPrimary.trim())
		if (claude !== null && !duplicate) files.push({ path: claudePath, content: claude, tier: "global" })
	}

	const sources = [...files]
	if (!dir || !agentsPath) return { files, sources }
	const localPath = join(dir, localVariant("AGENTS.md"))
	const local = tryReadFile(localPath)
	if (agentsPrimary !== null) {
		const content = local !== null ? `${agentsPrimary}\n\n${local}` : agentsPrimary
		files.push({ path: agentsPath, content, tier: "global" })
		sources.push({ path: agentsPath, content: agentsPrimary, tier: "global" })
	} else if (local !== null) {
		files.push({ path: localPath, content: local, tier: "global" })
		sources.push({ path: localPath, content: local, tier: "global" })
	}

	const contextDirFiles = loadContextDirectoryFiles(dir)
	files.push(...contextDirFiles)
	sources.push(...contextDirFiles)
	return { files, sources }
}

/** Global files, then project files that do not repeat them. */
export function loadContextFiles(cwd: string, options: GlobalContextFileOptions): ContextFile[] {
	const { files, sources } = readGlobalContextFiles(options)
	return [...files, ...loadProjectContextFiles(cwd, sources)]
}
