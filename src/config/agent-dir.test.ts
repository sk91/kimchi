import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { findAgentDirFlag, resolveAgentDir } from "./agent-dir.js"

describe("findAgentDirFlag", () => {
	it("finds --agent-dir <path> as two tokens", () => {
		expect(findAgentDirFlag(["--model", "x", "--agent-dir", "/seats/worker-1"])).toBe("/seats/worker-1")
	})

	it("finds --agent-dir=<path> as one token", () => {
		expect(findAgentDirFlag(["--agent-dir=/seats/worker-1"])).toBe("/seats/worker-1")
	})

	it("ignores a bare --agent-dir with no value", () => {
		expect(findAgentDirFlag(["--agent-dir"])).toBeUndefined()
	})

	it("ignores --agent-dir followed by another flag", () => {
		expect(findAgentDirFlag(["--agent-dir", "--model"])).toBeUndefined()
	})

	it("returns undefined when the flag is absent", () => {
		expect(findAgentDirFlag(["--model", "x"])).toBeUndefined()
	})
})

describe("resolveAgentDir", () => {
	it("defaults to ~/.config/kimchi/harness when no flag is passed", () => {
		expect(resolveAgentDir([], "/home/user")).toBe(join("/home/user", ".config", "kimchi", "harness"))
	})

	it("uses --agent-dir when passed", () => {
		expect(resolveAgentDir(["--agent-dir", "/seats/worker-1"], "/home/user")).toBe("/seats/worker-1")
	})

	it("does not react to KIMCHI_CODING_AGENT_DIR / PI_CODING_AGENT_DIR — this is argv-only, not env-based", () => {
		expect(resolveAgentDir(["--agent-dir-typo", "/inherited/from/parent"], "/home/user")).toBe(
			join("/home/user", ".config", "kimchi", "harness"),
		)
	})
})
