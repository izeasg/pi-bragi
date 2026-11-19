import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseArgs } from "../src/args.ts";

describe("parseArgs", () => {
	it("defaults to pick when no arguments are passed", () => {
		assert.deepEqual(parseArgs(""), {
			action: "pick",
			global: false,
			targets: [],
		});
		assert.deepEqual(parseArgs("-g"), {
			action: "pick",
			global: true,
			targets: [],
		});
	});

	it("parses -g / --global in any position", () => {
		const res1 = parseArgs("add -g skill-a skill-b");
		assert.equal(res1.action, "add");
		assert.equal(res1.global, true);
		assert.deepEqual(
			res1.targets.map((t) => t.name),
			["skill-a", "skill-b"],
		);

		const res2 = parseArgs("del skill-a --global skill-b");
		assert.equal(res2.action, "del");
		assert.equal(res2.global, true);
		assert.deepEqual(
			res2.targets.map((t) => t.name),
			["skill-a", "skill-b"],
		);
	});

	it("classifies bare names, .md / SKILL.md suffixes, and @groups", () => {
		const res = parseArgs("add rust-review.md coding/ts-lint/SKILL.md @coding bare-item");
		assert.equal(res.action, "add");
		assert.equal(res.global, false);
		assert.deepEqual(res.targets, [
			{ kind: "skill", name: "rust-review", raw: "rust-review.md" },
			{ kind: "skill", name: "ts-lint", raw: "coding/ts-lint/SKILL.md" },
			{ kind: "group", name: "coding", raw: "@coding" },
			{ kind: "any", name: "bare-item", raw: "bare-item" },
		]);
	});

	it("handles unknown actions cleanly", () => {
		const res = parseArgs("explode something");
		assert.equal(res.action, "unknown");
		assert.equal(res.unknownAction, "explode");
	});

	it("supports subcommands list, status, setup, import, help", () => {
		assert.equal(parseArgs("list").action, "list");
		assert.equal(parseArgs("status").action, "status");
		assert.equal(parseArgs("setup").action, "setup");
		assert.deepEqual(parseArgs("import -g"), {
			action: "import",
			global: true,
			targets: [],
		});
		assert.equal(parseArgs("help").action, "help");
		assert.equal(parseArgs("--help").action, "help");
	});
});
