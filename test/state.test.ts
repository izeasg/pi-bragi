import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
	BragiConfigError,
	defaultConfig,
	readConfig,
	updateConfig,
} from "../src/config.ts";
import { add, del, effective, inspectSkill } from "../src/state.ts";

describe("state and config", () => {
	const fakeHome = "/Users/tester";
	const projA = "~/work/proj-a";
	const projACwd = "/Users/tester/work/proj-a/src";
	const projBCwd = "/Users/tester/work/proj-b";

	it("activates and deactivates project and global skills according to rules", () => {
		const cfg = defaultConfig();

		// 1. Add skill globally
		const gAdd = add(cfg, { kind: "global" }, ["caveman-commit", "lean-build"]);
		assert.deepEqual(gAdd.changed, ["caveman-commit", "lean-build"]);
		assert.deepEqual(effective(cfg, projACwd, fakeHome), ["caveman-commit", "lean-build"]);

		// 2. Add project skill in proj-a
		const pAdd = add(cfg, { kind: "project", key: projA }, ["rust-review"]);
		assert.deepEqual(pAdd.changed, ["rust-review"]);
		assert.deepEqual(effective(cfg, projACwd, fakeHome), [
			"caveman-commit",
			"lean-build",
			"rust-review",
		]);
		assert.deepEqual(effective(cfg, projBCwd, fakeHome), ["caveman-commit", "lean-build"]);

		// 3. Delete a global skill at project level -> disables only in proj-a
		const pDelGlobal = del(cfg, { kind: "project", key: projA }, ["lean-build"]);
		assert.deepEqual(pDelGlobal.changed, ["lean-build"]);
		assert.deepEqual(effective(cfg, projACwd, fakeHome), ["caveman-commit", "rust-review"]);
		// Still active in proj-b!
		assert.deepEqual(effective(cfg, projBCwd, fakeHome), ["caveman-commit", "lean-build"]);
		assert.equal(inspectSkill(cfg, projACwd, "lean-build", fakeHome).badge, "×");

		// 4. Re-add disabled global skill in proj-a -> removes from disabled without duplicating
		const pReAdd = add(cfg, { kind: "project", key: projA }, ["lean-build"]);
		assert.deepEqual(pReAdd.changed, ["lean-build"]);
		assert.deepEqual(cfg.projects[projA]?.disabled, []);
		assert.deepEqual(effective(cfg, projACwd, fakeHome), [
			"caveman-commit",
			"lean-build",
			"rust-review",
		]);

		// 5. Skill active in project AND global, then del -g -> stays active in project
		add(cfg, { kind: "global" }, ["rust-review"]);
		assert.equal(inspectSkill(cfg, projACwd, "rust-review", fakeHome).badge, "G+P");

		const gDel = del(cfg, { kind: "global" }, ["rust-review"]);
		assert.deepEqual(gDel.changed, ["rust-review"]);
		// Still active in proj-a because it was in proj-a.skills!
		assert.deepEqual(effective(cfg, projACwd, fakeHome), [
			"caveman-commit",
			"lean-build",
			"rust-review",
		]);
		assert.equal(inspectSkill(cfg, projACwd, "rust-review", fakeHome).badge, "P");

		// 6. Removing last project skill cleans up the project entry
		del(cfg, { kind: "project", key: projA }, ["rust-review"]);
		assert.equal(cfg.projects[projA], undefined);
	});

	it("persists config atomically and refuses to overwrite corrupted JSON", () => {
		const tmp = mkdtempSync(join(tmpdir(), "bragi-cfg-"));
		try {
			const file = join(tmp, "bragi.json");
			updateConfig((c) => {
				c.repo = "~/custom-repo";
				add(c, { kind: "global" }, ["skill-one"]);
			}, file);

			const loaded = readConfig(file);
			assert.equal(loaded.error, undefined);
			assert.equal(loaded.config.repo, "~/custom-repo");
			assert.deepEqual(loaded.config.global, ["skill-one"]);

			// Corrupt the file and verify updateConfig throws BragiConfigError
			writeFileSync(file, "{ broken json", "utf-8");
			assert.throws(() => {
				updateConfig((c) => {
					c.global.push("other");
				}, file);
			}, BragiConfigError);
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});
});
