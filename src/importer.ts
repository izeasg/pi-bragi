import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
} from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { defaultParseFrontmatter, type FrontmatterParser } from "./frontmatter.ts";
import type { RepoIndex } from "./repo.ts";

export interface ImportMoveItem {
	name: string;
	from: string;
	to: string;
}

export interface ImportSkipItem {
	name: string;
	from: string;
	reason: string;
}

export interface ImportPlan {
	move: ImportMoveItem[];
	skipped: ImportSkipItem[];
	error?: string;
}

export interface ImportResult {
	moved: string[];
	failed: { name: string; error: string }[];
}

function safeRealpath(target: string): string {
	const resolved = resolve(target);
	try {
		return realpathSync(resolved);
	} catch {
		const parent = dirname(resolved);
		if (parent === resolved) {
			return resolved;
		}
		return join(safeRealpath(parent), basename(resolved));
	}
}

function pathsOverlap(a: string, b: string): boolean {
	const realA = safeRealpath(a);
	const realB = safeRealpath(b);
	if (realA === realB) return true;
	const prefixA = realA.endsWith(sep) ? realA : `${realA}${sep}`;
	const prefixB = realB.endsWith(sep) ? realB : `${realB}${sep}`;
	return realB.startsWith(prefixA) || realA.startsWith(prefixB);
}

function detectSkillName(
	skillFile: string,
	fallbackName: string,
	parser: FrontmatterParser,
): string | null {
	try {
		const raw = readFileSync(skillFile, "utf-8");
		const { frontmatter } = parser(raw);
		const description =
			typeof frontmatter.description === "string" ? frontmatter.description.trim() : "";
		if (!description) {
			return null;
		}
		const name =
			typeof frontmatter.name === "string" && frontmatter.name.trim() !== ""
				? frontmatter.name.trim()
				: fallbackName;
		return name;
	} catch {
		return null;
	}
}

export function planImport(
	srcDir: string,
	repoRoot: string,
	repo: RepoIndex,
	parser: FrontmatterParser = defaultParseFrontmatter,
): ImportPlan {
	const move: ImportMoveItem[] = [];
	const skipped: ImportSkipItem[] = [];

	const resolvedSrc = resolve(srcDir);
	const resolvedRepo = resolve(repoRoot);

	if (!existsSync(resolvedSrc)) {
		return { move, skipped };
	}

	if (pathsOverlap(resolvedSrc, resolvedRepo)) {
		return {
			move,
			skipped,
			error: `Source skills directory (${resolvedSrc}) overlaps with repository path (${resolvedRepo}).`,
		};
	}

	let entries;
	try {
		entries = readdirSync(resolvedSrc, { withFileTypes: true }).sort((a, b) =>
			a.name.localeCompare(b.name),
		);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { move, skipped, error: `Failed to read ${resolvedSrc}: ${msg}` };
	}

	const plannedNames = new Set<string>();

	for (const entry of entries) {
		if (entry.name.startsWith(".")) {
			continue;
		}
		const entryPath = join(resolvedSrc, entry.name);
		let isDir = entry.isDirectory();
		let isFile = entry.isFile();
		if (entry.isSymbolicLink()) {
			try {
				const st = statSync(entryPath);
				isDir = st.isDirectory();
				isFile = st.isFile();
			} catch {
				continue;
			}
		}

		if (isDir) {
			const skillMd = join(entryPath, "SKILL.md");
			if (!existsSync(skillMd)) {
				continue;
			}
			const skillName = detectSkillName(skillMd, entry.name, parser);
			if (!skillName) {
				skipped.push({
					name: entry.name,
					from: entryPath,
					reason: "missing valid description in SKILL.md",
				});
				continue;
			}
			const destPath = join(resolvedRepo, entry.name);
			if (repo.skills.has(skillName) || plannedNames.has(skillName) || existsSync(destPath)) {
				skipped.push({
					name: skillName,
					from: entryPath,
					reason: "already exists in repository",
				});
				continue;
			}
			plannedNames.add(skillName);
			move.push({
				name: skillName,
				from: entryPath,
				to: destPath,
			});
		} else if (isFile && entry.name.toLowerCase().endsWith(".md")) {
			const fallback = basename(entry.name, ".md");
			const skillName = detectSkillName(entryPath, fallback, parser);
			if (!skillName) {
				continue;
			}
			const destPath = join(resolvedRepo, entry.name);
			if (repo.skills.has(skillName) || plannedNames.has(skillName) || existsSync(destPath)) {
				skipped.push({
					name: skillName,
					from: entryPath,
					reason: "already exists in repository",
				});
				continue;
			}
			plannedNames.add(skillName);
			move.push({
				name: skillName,
				from: entryPath,
				to: destPath,
			});
		}
	}

	return { move, skipped };
}

export function runImport(plan: ImportPlan): ImportResult {
	const moved: string[] = [];
	const failed: { name: string; error: string }[] = [];

	for (const item of plan.move) {
		try {
			mkdirSync(dirname(item.to), { recursive: true });
			try {
				renameSync(item.from, item.to);
			} catch (err) {
				const code = (err as NodeJS.ErrnoException)?.code;
				if (code === "EXDEV") {
					cpSync(item.from, item.to, { recursive: true });
					rmSync(item.from, { recursive: true, force: true });
				} else {
					throw err;
				}
			}
			moved.push(item.name);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			failed.push({ name: item.name, error: msg });
		}
	}

	return { moved, failed };
}
