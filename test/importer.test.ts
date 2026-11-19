import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { planImport, runImport } from "../src/importer.ts";
import { scanRepo } from "../src/repo.ts";

describe("importer", () => {
	const tempDirs: string[] = [];

	function makeTempDir(): string {
		const dir = mkdtempSync(join(tmpdir(), "bragi-import-"));
		tempDirs.push(dir);
		return dir;
	}

	afterEach(() => {
		while (tempDirs.length > 0) {
			const dir = tempDirs.pop()!;
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("moves valid skills and skips skills that already exist in the repo", () => {
		const root = makeTempDir();
		const srcDir = join(root, "agent-skills");
		const repoDir = join(root, "bragi-repo");

		mkdirSync(join(srcDir, "new-skill"), { recursive: true });
		writeFileSync(
			join(srcDir, "new-skill", "SKILL.md"),
			"---\nname: new-skill\ndescription: A brand new skill\n---\n# New\n",
		);

		mkdirSync(join(srcDir, "existing-skill"), { recursive: true });
		writeFileSync(
			join(srcDir, "existing-skill", "SKILL.md"),
			"---\nname: existing-skill\ndescription: Duplicate skill\n---\n# Dup\n",
		);

		mkdirSync(join(repoDir, "existing-skill"), { recursive: true });
		writeFileSync(
			join(repoDir, "existing-skill", "SKILL.md"),
			"---\nname: existing-skill\ndescription: Already in repo\n---\n# Existing\n",
		);

		const repoIndex = scanRepo(repoDir);
		const plan = planImport(srcDir, repoDir, repoIndex);

		assert.equal(plan.error, undefined);
		assert.deepEqual(
			plan.move.map((m) => m.name),
			["new-skill"],
		);
		assert.deepEqual(
			plan.skipped.map((s) => s.name),
			["existing-skill"],
		);

		const res = runImport(plan);
		assert.deepEqual(res.moved, ["new-skill"]);
		assert.deepEqual(res.failed, []);
		assert.equal(existsSync(join(srcDir, "new-skill")), false);
		assert.equal(existsSync(join(repoDir, "new-skill", "SKILL.md")), true);
		assert.equal(existsSync(join(srcDir, "existing-skill", "SKILL.md")), true);
	});

	it("refuses to import when source and repo directories overlap", () => {
		const root = makeTempDir();
		const repoIndex = scanRepo(root);
		const plan = planImport(root, join(root, "sub"), repoIndex);
		assert.equal(typeof plan.error, "string");
	});
});
