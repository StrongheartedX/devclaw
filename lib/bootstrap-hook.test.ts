/**
 * Tests for bootstrap hook session key parsing and instruction loading.
 * Run with: npx tsx --test lib/bootstrap-hook.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { parseDevClawSessionKey, loadRoleInstructions } from "./bootstrap-hook.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

describe("parseDevClawSessionKey", () => {
  it("should parse a standard developer session key", () => {
    const result = parseDevClawSessionKey("agent:devclaw:subagent:my-project-developer-medior");
    assert.deepStrictEqual(result, { projectName: "my-project", role: "developer" });
  });

  it("should parse a tester session key", () => {
    const result = parseDevClawSessionKey("agent:devclaw:subagent:webapp-tester-medior");
    assert.deepStrictEqual(result, { projectName: "webapp", role: "tester" });
  });

  it("should handle project names with hyphens", () => {
    const result = parseDevClawSessionKey("agent:devclaw:subagent:my-cool-project-developer-junior");
    assert.deepStrictEqual(result, { projectName: "my-cool-project", role: "developer" });
  });

  it("should handle project names with multiple hyphens and tester role", () => {
    const result = parseDevClawSessionKey("agent:devclaw:subagent:a-b-c-d-tester-junior");
    assert.deepStrictEqual(result, { projectName: "a-b-c-d", role: "tester" });
  });

  it("should return null for non-subagent session keys", () => {
    const result = parseDevClawSessionKey("agent:devclaw:main");
    assert.strictEqual(result, null);
  });

  it("should return null for session keys without role", () => {
    const result = parseDevClawSessionKey("agent:devclaw:subagent:project-unknown-level");
    assert.strictEqual(result, null);
  });

  it("should return null for empty string", () => {
    const result = parseDevClawSessionKey("");
    assert.strictEqual(result, null);
  });

  it("should parse senior developer level", () => {
    const result = parseDevClawSessionKey("agent:devclaw:subagent:devclaw-developer-senior");
    assert.deepStrictEqual(result, { projectName: "devclaw", role: "developer" });
  });

  it("should parse simple project name", () => {
    const result = parseDevClawSessionKey("agent:devclaw:subagent:api-developer-junior");
    assert.deepStrictEqual(result, { projectName: "api", role: "developer" });
  });
});

describe("loadRoleInstructions", () => {
  it("should load project-specific instructions", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-test-"));
    const projectDir = path.join(tmpDir, "projects", "roles", "test-project");
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(path.join(projectDir, "developer.md"), "# Developer Instructions\nDo the thing.");

    const result = await loadRoleInstructions(tmpDir, "test-project", "developer");
    assert.strictEqual(result, "# Developer Instructions\nDo the thing.");

    await fs.rm(tmpDir, { recursive: true });
  });

  it("should fall back to default instructions", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-test-"));
    const defaultDir = path.join(tmpDir, "projects", "roles", "default");
    await fs.mkdir(defaultDir, { recursive: true });
    await fs.writeFile(path.join(defaultDir, "tester.md"), "# Tester Default\nReview carefully.");

    const result = await loadRoleInstructions(tmpDir, "nonexistent-project", "tester");
    assert.strictEqual(result, "# Tester Default\nReview carefully.");

    await fs.rm(tmpDir, { recursive: true });
  });

  it("should return empty string when no instructions exist", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-test-"));

    const result = await loadRoleInstructions(tmpDir, "missing", "developer");
    assert.strictEqual(result, "");

    await fs.rm(tmpDir, { recursive: true });
  });

  it("should prefer project-specific over default", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-test-"));
    const projectDir = path.join(tmpDir, "projects", "roles", "my-project");
    const defaultDir = path.join(tmpDir, "projects", "roles", "default");
    await fs.mkdir(projectDir, { recursive: true });
    await fs.mkdir(defaultDir, { recursive: true });
    await fs.writeFile(path.join(projectDir, "developer.md"), "Project-specific instructions");
    await fs.writeFile(path.join(defaultDir, "developer.md"), "Default instructions");

    const result = await loadRoleInstructions(tmpDir, "my-project", "developer");
    assert.strictEqual(result, "Project-specific instructions");

    await fs.rm(tmpDir, { recursive: true });
  });
});
