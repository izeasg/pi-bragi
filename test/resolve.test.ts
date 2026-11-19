import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parseArgs } from "../src/args.ts";
import { scanRepo } from "../src/repo.ts";
import { resolveTargets } from "../src/resolve.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_REPO = join(__dirname, "fixtures", "repo");

describe("resolveTargets", () => {
	const repo = scanRepo(FIXTURE_REPO, { folderGroups: true });

	it("prefers skill over group on bare name collision, and @group forces group", () => {
		// "coding" exists both as a skill ("coding") and as a group ("coding" -> rust-review, ts-lint)
		const bare = resolveTargets(parseArgs("add coding").targets, repo);
		assert.deepEqual(bare.skills, ["coding"]);
		assert.deepEqual(bare.unknown, []);

		const forcedGroup = resolveTargets(parseArgs("add @coding").targets, repo);
		assert.deepEqual(forcedGroup.skills, ["rust-review", "ts-lint"]);
		assert.deepEqual(forcedGroup.unknown, []);

		const forcedSkill = resolveTargets(parseArgs("add coding.md").targets, repo);
		assert.deepEqual(forcedSkill.skills, ["coding"]);
		assert.deepEqual(forcedSkill.unknown, []);
	});

	it("falls back to group when bare name does not match a skill", () => {
		// "quality" is only a group, not a skill name
		const res = resolveTargets(parseArgs("add quality").targets, repo);
		assert.deepEqual(res.skills, ["ts-lint"]);
		assert.deepEqual(res.unknown, []);
	});

	it("rejects .md when only a group with that name exists", () => {
		const res = resolveTargets(parseArgs("add quality.md").targets, repo);
		assert.deepEqual(res.skills, []);
		assert.deepEqual(res.unknown, ["quality.md"]);
	});

	it("deduplicates resolved skills and reports unknown items", () => {
		const res = resolveTargets(
			parseArgs("add rust-review.md @coding nonexistent @missing-group").targets,
			repo,
		);
		assert.deepEqual(res.skills, ["rust-review", "ts-lint"]);
		assert.deepEqual(res.unknown, ["nonexistent", "@missing-group"]);
	});
});
