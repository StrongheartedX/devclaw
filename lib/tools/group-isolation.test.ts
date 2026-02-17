/**
 * Tests for notify:{groupId} label helpers.
 *
 * Covers:
 * - getNotifyLabel / NOTIFY_LABEL_PREFIX / NOTIFY_LABEL_COLOR
 * - resolveNotifyChannel
 *
 * Run with: npx tsx --test lib/tools/group-isolation.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import {
  getNotifyLabel,
  NOTIFY_LABEL_PREFIX,
  NOTIFY_LABEL_COLOR,
  resolveNotifyChannel,
} from "../workflow.js";

// ---------------------------------------------------------------------------
// getNotifyLabel / constants
// ---------------------------------------------------------------------------

describe("notify label helpers", () => {
  it("should build notify label from groupId", () => {
    assert.strictEqual(getNotifyLabel("-5176490302"), "notify:-5176490302");
    assert.strictEqual(getNotifyLabel("-1003843401024"), "notify:-1003843401024");
  });

  it("NOTIFY_LABEL_PREFIX should be 'notify:'", () => {
    assert.strictEqual(NOTIFY_LABEL_PREFIX, "notify:");
  });

  it("NOTIFY_LABEL_COLOR should be light grey", () => {
    assert.strictEqual(NOTIFY_LABEL_COLOR, "#e4e4e4");
  });

  it("getNotifyLabel output should start with NOTIFY_LABEL_PREFIX", () => {
    const label = getNotifyLabel("-999");
    assert.ok(label.startsWith(NOTIFY_LABEL_PREFIX));
  });
});

// ---------------------------------------------------------------------------
// resolveNotifyChannel
// ---------------------------------------------------------------------------

describe("resolveNotifyChannel", () => {
  const channels = [
    { groupId: "-111", channel: "telegram" },
    { groupId: "-222", channel: "whatsapp" },
  ];

  it("should return channel matching notify label", () => {
    const result = resolveNotifyChannel(["To Do", "notify:-222"], channels);
    assert.ok(result);
    assert.strictEqual(result!.groupId, "-222");
    assert.strictEqual(result!.channel, "whatsapp");
  });

  it("should fall back to first channel when notify label matches unknown groupId", () => {
    const result = resolveNotifyChannel(["To Do", "notify:-999"], channels);
    assert.ok(result);
    assert.strictEqual(result!.groupId, "-111");
  });

  it("should fall back to first channel when no notify label present", () => {
    const result = resolveNotifyChannel(["To Do", "bug"], channels);
    assert.ok(result);
    assert.strictEqual(result!.groupId, "-111");
  });

  it("should return undefined when channels is empty", () => {
    const result = resolveNotifyChannel(["To Do", "notify:-111"], []);
    assert.strictEqual(result, undefined);
  });

  it("should return first channel when no notify label and multiple channels", () => {
    const result = resolveNotifyChannel(["To Do"], channels);
    assert.ok(result);
    assert.strictEqual(result!.groupId, "-111");
  });
});
