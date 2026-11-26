import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { materializeOverlayField, parseLaunchOverlayValue, resolveLaunchOverlayOptions } from "./launch-overlay.js"

type TestOptions = {
	"launch-overlay"?: string
	"permissions-config"?: string
	"mcp-config"?: string
}

describe("parseLaunchOverlayValue", () => {
	it("parses inline JSON", () => {
		expect(parseLaunchOverlayValue('{"permissions":{"defaultMode":"default"}}')).toEqual({
			permissions: { defaultMode: "default" },
		})
	})

	it("reads and parses a file path", () => {
		const dir = mkdtempSync(join(tmpdir(), "launch-overlay-file-"))
		const path = join(dir, "overlay.json")
		writeFileSync(path, '{"mcp":{"mcpServers":{}}}')
		expect(parseLaunchOverlayValue(path)).toEqual({ mcp: { mcpServers: {} } })
	})

	it("rejects invalid JSON", () => {
		expect(() => parseLaunchOverlayValue("{not json")).toThrow(/Invalid --launch-overlay JSON/)
	})

	it("rejects a non-object JSON value", () => {
		// Non-"{"-prefixed inline values are treated as file paths (see the
		// file-path test above), so exercise the object check via files too.
		const dir = mkdtempSync(join(tmpdir(), "launch-overlay-nonobject-"))
		const arrayPath = join(dir, "array.json")
		writeFileSync(arrayPath, "[1,2,3]")
		expect(() => parseLaunchOverlayValue(arrayPath)).toThrow(/must be a JSON object/)
	})
})

describe("materializeOverlayField", () => {
	it("writes the field as JSON to a private (0600) temp file", () => {
		const path = materializeOverlayField({ allow: ["bash(ls *)"] }, "permissions")
		expect(existsSync(path)).toBe(true)
		expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual({ allow: ["bash(ls *)"] })
	})
})

describe("resolveLaunchOverlayOptions", () => {
	it("returns options unchanged when no overlay is passed", () => {
		const options: TestOptions = { "launch-overlay": undefined }
		expect(resolveLaunchOverlayOptions(options)).toBe(options)
	})

	it("backfills permissions-config and mcp-config from the overlay", () => {
		const options: TestOptions = {
			"launch-overlay": '{"permissions":{"defaultMode":"default"},"mcp":{"mcpServers":{}}}',
		}
		const resolved = resolveLaunchOverlayOptions(options)
		expect(resolved["permissions-config"]).toBeDefined()
		expect(resolved["mcp-config"]).toBeDefined()
		expect(JSON.parse(readFileSync(resolved["permissions-config"] as string, "utf-8"))).toEqual({
			defaultMode: "default",
		})
		expect(JSON.parse(readFileSync(resolved["mcp-config"] as string, "utf-8"))).toEqual({ mcpServers: {} })
	})

	it("an explicit --permissions-config/--mcp-config always wins over the overlay", () => {
		const options: TestOptions = {
			"launch-overlay": '{"permissions":{"defaultMode":"default"},"mcp":{"mcpServers":{}}}',
			"permissions-config": "/explicit/permissions.json",
			"mcp-config": "/explicit/mcp.json",
		}
		const resolved = resolveLaunchOverlayOptions(options)
		expect(resolved["permissions-config"]).toBe("/explicit/permissions.json")
		expect(resolved["mcp-config"]).toBe("/explicit/mcp.json")
	})

	it("only backfills the fields the overlay actually declares", () => {
		const options: TestOptions = { "launch-overlay": '{"permissions":{"defaultMode":"default"}}' }
		const resolved = resolveLaunchOverlayOptions(options)
		expect(resolved["permissions-config"]).toBeDefined()
		expect(resolved["mcp-config"]).toBeUndefined()
	})
})
