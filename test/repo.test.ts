import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { scanRepo } from "../src/repo.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_REPO = join(__dirname, "fixtures", "repo");

describe("scanRepo", () => {
	it("discovers skills and parses bragi.group (string, comma-separated, YAML list)", () => {
		const repo = scanRepo(FIXTURE_REPO, { folderGroups: false });

		assert.equal(repo.skills.has("rust-review"), true);
		assert.equal(repo.skills.has("ts-lint"), true);
		assert.equal(repo.skills.has("docker-deploy"), true);
		assert.equal(repo.skills.has("coding"), true);
		assert.equal(repo.skills.has("broken-no-desc"), false);

		assert.deepEqual(repo.skills.get("rust-review")?.groups, ["coding", "review"]);
		assert.deepEqual(repo.skills.get("ts-lint")?.groups, ["coding", "quality"]);
		assert.deepEqual(repo.skills.get("docker-deploy")?.groups, []);

		assert.deepEqual(repo.groups.get("coding"), ["rust-review", "ts-lint"]);
		assert.deepEqual(repo.groups.get("review"), ["rust-review"]);
		assert.deepEqual(repo.groups.get("quality"), ["ts-lint"]);
		assert.equal(repo.groups.has("ops"), false);

		assert.equal(
			repo.warnings.some((w) => w.includes("broken-no-desc")),
			true,
		);
	});

	it("adds parent directory names as groups when folderGroups is enabled", () => {
		const repo = scanRepo(FIXTURE_REPO, { folderGroups: true });
		assert.deepEqual(repo.skills.get("docker-deploy")?.groups, ["ops"]);
		assert.deepEqual(repo.groups.get("ops"), ["docker-deploy"]);
	});

	it("warns on duplicate skill names and keeps the first discovered", () => {
		const tmp = mkdtempSync(join(tmpdir(), "bragi-dup-"));
		try {
			const dirA = join(tmp, "a-skill");
			const dirB = join(tmp, "b-skill");
			mkdirSync(dirA, { recursive: true });
			mkdirSync(dirB, { recursive: true });
			writeFileSync(
				join(dirA, "SKILL.md"),
				"---\nname: same-name\ndescription: First skill\n---\n# A\n",
			);
			writeFileSync(
				join(dirB, "SKILL.md"),
				"---\nname: same-name\ndescription: Second skill\n---\n# B\n",
			);

			const repo = scanRepo(tmp);
			assert.equal(repo.skills.size, 1);
			assert.equal(repo.skills.get("same-name")?.description, "First skill");
			assert.equal(
				repo.warnings.some((w) => w.includes('Duplicate skill "same-name"')),
				true,
			);
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});
});
