import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
	collapseHome,
	expandHome,
	findGitRoot,
	findProjectKey,
	projectKey,
	resolveWriteProjectKey,
} from "../src/paths.ts";

describe("paths", () => {
	const tempDirs: string[] = [];

	function makeTempDir(): string {
		const dir = mkdtempSync(join(tmpdir(), "bragi-paths-"));
		tempDirs.push(dir);
		return dir;
	}

	afterEach(() => {
		while (tempDirs.length > 0) {
			const dir = tempDirs.pop()!;
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("expands and collapses ~ round-trip", () => {
		const fakeHome = "/Users/tester";
		assert.equal(expandHome("~", fakeHome), "/Users/tester");
		assert.equal(expandHome("~/Developer/pi-bragi", fakeHome), "/Users/tester/Developer/pi-bragi");
		assert.equal(collapseHome("/Users/tester", fakeHome), "~");
		assert.equal(
			collapseHome("/Users/tester/Developer/pi-bragi", fakeHome),
			"~/Developer/pi-bragi",
		);
		assert.equal(collapseHome("/opt/other/project", fakeHome), "/opt/other/project");
	});

	it("resolves git root from a nested subdirectory", () => {
		const home = makeTempDir();
		const repoDir = join(home, "work", "my-repo");
		const nestedDir = join(repoDir, "packages", "app", "src");
		mkdirSync(join(repoDir, ".git"), { recursive: true });
		mkdirSync(nestedDir, { recursive: true });

		assert.equal(findGitRoot(nestedDir), repoDir);
		assert.equal(projectKey(nestedDir, home), "~/work/my-repo");
	});

	it("finds the nearest ancestor project key", () => {
		const home = makeTempDir();
		const projects = {
			"~/work": { skills: ["a"], disabled: [] },
			"~/work/service": { skills: ["b"], disabled: [] },
			"~/other": { skills: ["c"], disabled: [] },
		};

		const subPath = join(home, "work", "service", "src", "components");
		assert.equal(findProjectKey(projects, subPath, home), "~/work/service");

		const workRootChild = join(home, "work", "docs");
		assert.equal(findProjectKey(projects, workRootChild, home), "~/work");

		const outside = join(home, "untracked");
		assert.equal(findProjectKey(projects, outside, home), null);
	});

	it("resolves write project key using git root or existing ancestor", () => {
		const home = makeTempDir();
		const nonGitParent = join(home, "plain-project");
		const nonGitSub = join(nonGitParent, "sub");
		mkdirSync(nonGitSub, { recursive: true });

		const projects = {
			"~/plain-project": { skills: ["a"], disabled: [] },
		};

		assert.equal(resolveWriteProjectKey(projects, nonGitSub, home), "~/plain-project");
	});
});
