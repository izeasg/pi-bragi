import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { completeBragiArgs } from "../src/complete.ts";
import { defaultConfig } from "../src/config.ts";
import { scanRepo } from "../src/repo.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_REPO = join(__dirname, "fixtures", "repo");

describe("completeBragiArgs", () => {
	const repo = scanRepo(FIXTURE_REPO, { folderGroups: true });

	it("completes subcommands when typing the first token", () => {
		const items = completeBragiArgs("ad", repo);
		assert.equal(items?.length, 1);
		assert.equal(items?.[0].value, "add ");
		assert.equal(items?.[0].label, "add");
	});

	it("completes skills, @groups, and -g while preserving head prefix", () => {
		const items = completeBragiArgs("add -g @co", repo);
		assert.equal(
			items?.some((i) => i.value === "add -g @coding " && i.label === "@coding"),
			true,
		);

		const multi = completeBragiArgs("add rust-review ts-", repo);
		assert.equal(
			multi?.some((i) => i.value === "add rust-review ts-lint " && i.label === "ts-lint"),
			true,
		);
	});

	it("filters del and add completions by active state in project and global scopes", () => {
		const cfg = defaultConfig();
		cfg.global = ["rust-review"];
		cfg.projects["~/work/app"] = {
			skills: ["docker-deploy"],
			disabled: [],
		};
		const scopeCtx = {
			config: cfg,
			cwd: "/Users/tester/work/app",
			home: "/Users/tester",
		};

		// Project del: only rust-review (from global) and docker-deploy (from project) are active
		const projDel = completeBragiArgs("del ", repo, scopeCtx) ?? [];
		const projDelLabels = projDel.map((i) => i.label);
		assert.equal(projDelLabels.includes("rust-review"), true);
		assert.equal(projDelLabels.includes("docker-deploy"), true);
		assert.equal(projDelLabels.includes("ts-lint"), false);
		assert.equal(projDelLabels.includes("@coding"), true);
		assert.equal(projDelLabels.includes("@quality"), false);

		// Global del (-g): only rust-review is active globally
		const globalDel = completeBragiArgs("del -g ", repo, scopeCtx) ?? [];
		const globalDelLabels = globalDel.map((i) => i.label);
		assert.equal(globalDelLabels.includes("rust-review"), true);
		assert.equal(globalDelLabels.includes("docker-deploy"), false);
		assert.equal(globalDelLabels.includes("@ops"), false);

		// Project add: rust-review and docker-deploy are already active, so only inactive ones appear
		const projAdd = completeBragiArgs("add ", repo, scopeCtx) ?? [];
		const projAddLabels = projAdd.map((i) => i.label);
		assert.equal(projAddLabels.includes("rust-review"), false);
		assert.equal(projAddLabels.includes("docker-deploy"), false);
		assert.equal(projAddLabels.includes("ts-lint"), true);
		// @coding still has 1 inactive member (ts-lint), so @coding is suggested
		assert.equal(projAddLabels.includes("@coding"), true);
		// @review only has rust-review (already active), so @review is hidden
		assert.equal(projAddLabels.includes("@review"), false);
	});
});
