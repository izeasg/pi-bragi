import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { defaultParseFrontmatter, type FrontmatterParser } from "./frontmatter.ts";

export interface RepoSkill {
	name: string;
	description: string;
	filePath: string;
	groups: string[];
}

export interface RepoIndex {
	skills: Map<string, RepoSkill>;
	groups: Map<string, string[]>;
	warnings: string[];
}

export interface ScanRepoOptions {
	folderGroups?: boolean;
	parseFrontmatter?: FrontmatterParser;
}

const IGNORED_DIRS = new Set([".git", "node_modules", ".pi", ".DS_Store"]);
const IGNORED_MD_FILES = new Set(["readme.md", "changelog.md", "license.md", "contributing.md"]);

function parseGroupValues(raw: unknown): string[] {
	if (typeof raw === "string") {
		return raw
			.split(",")
			.map((part) => part.trim().replace(/^@+/, "").toLowerCase())
			.filter((part) => part.length > 0);
	}
	if (Array.isArray(raw)) {
		const out: string[] = [];
		for (const item of raw) {
			out.push(...parseGroupValues(item));
		}
		return out;
	}
	return [];
}

function extractFrontmatterGroups(frontmatter: Record<string, unknown>): string[] {
	const groups: string[] = [];
	const bragi = frontmatter.bragi;
	if (typeof bragi === "object" && bragi !== null && !Array.isArray(bragi)) {
		const bragiObj = bragi as Record<string, unknown>;
		groups.push(...parseGroupValues(bragiObj.group));
		groups.push(...parseGroupValues(bragiObj.groups));
	}
	return groups;
}

function extractFolderGroups(rootDir: string, filePath: string, isSkillMd: boolean): string[] {
	const groupContainerDir = isSkillMd ? dirname(dirname(filePath)) : dirname(filePath);
	const rel = relative(rootDir, groupContainerDir);
	if (!rel || rel === "." || rel.startsWith("..")) {
		return [];
	}
	return rel
		.split(sep)
		.map((segment) => segment.trim().toLowerCase())
		.filter((segment) => segment.length > 0 && segment !== ".");
}

function dedupeStrings(items: string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const item of items) {
		if (!seen.has(item)) {
			seen.add(item);
			result.push(item);
		}
	}
	return result;
}

function loadCandidateFile(
	rootDir: string,
	filePath: string,
	isSkillMd: boolean,
	folderGroups: boolean,
	parser: FrontmatterParser,
	warnings: string[],
): RepoSkill | null {
	let content: string;
	try {
		content = readFileSync(filePath, "utf-8");
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		warnings.push(`Failed to read ${filePath}: ${msg}`);
		return null;
	}

	let frontmatter: Record<string, unknown>;
	try {
		({ frontmatter } = parser(content));
	} catch (err) {
		if (isSkillMd) {
			const msg = err instanceof Error ? err.message : String(err);
			warnings.push(`Failed to parse frontmatter in ${filePath}: ${msg}`);
		}
		return null;
	}

	const rawDescription = frontmatter.description;
	const description = typeof rawDescription === "string" ? rawDescription.trim() : "";
	if (!description) {
		if (isSkillMd) {
			warnings.push(`Skipping ${filePath}: missing description in frontmatter`);
		}
		return null;
	}

	const rawName = frontmatter.name;
	const fallbackName = isSkillMd ? basename(dirname(filePath)) : basename(filePath, ".md");
	const name = typeof rawName === "string" && rawName.trim() !== "" ? rawName.trim() : fallbackName;

	const rawGroups = [...extractFrontmatterGroups(frontmatter)];
	if (folderGroups) {
		rawGroups.push(...extractFolderGroups(rootDir, filePath, isSkillMd));
	}
	const groups = dedupeStrings(rawGroups);

	return {
		name,
		description,
		filePath,
		groups,
	};
}

export function scanRepo(root: string, opts: ScanRepoOptions = {}): RepoIndex {
	const skills = new Map<string, RepoSkill>();
	const groups = new Map<string, string[]>();
	const warnings: string[] = [];

	const resolvedRoot = resolve(root);
	if (!existsSync(resolvedRoot)) {
		return { skills, groups, warnings };
	}

	let rootStat;
	try {
		rootStat = statSync(resolvedRoot);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		warnings.push(`Failed to access repo at ${resolvedRoot}: ${msg}`);
		return { skills, groups, warnings };
	}

	if (!rootStat.isDirectory()) {
		warnings.push(`Repo path is not a directory: ${resolvedRoot}`);
		return { skills, groups, warnings };
	}

	const folderGroups = Boolean(opts.folderGroups);
	const parser = opts.parseFrontmatter ?? defaultParseFrontmatter;

	const registerSkill = (skill: RepoSkill) => {
		const existing = skills.get(skill.name);
		if (existing) {
			warnings.push(
				`Duplicate skill "${skill.name}" at ${skill.filePath} (keeping ${existing.filePath})`,
			);
			return;
		}
		skills.set(skill.name, skill);
		for (const group of skill.groups) {
			const list = groups.get(group) ?? [];
			list.push(skill.name);
			groups.set(group, list);
		}
	};

	const walkDir = (dir: string, isRoot: boolean) => {
		if (!isRoot) {
			const skillMdPath = join(dir, "SKILL.md");
			if (existsSync(skillMdPath)) {
				try {
					if (statSync(skillMdPath).isFile()) {
						const loaded = loadCandidateFile(
							resolvedRoot,
							skillMdPath,
							true,
							folderGroups,
							parser,
							warnings,
						);
						if (loaded) {
							registerSkill(loaded);
						}
						return;
					}
				} catch {
					// Continue if stat fails
				}
			}
		}

		let entries;
		try {
			entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
				a.name.localeCompare(b.name),
			);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			warnings.push(`Failed to read directory ${dir}: ${msg}`);
			return;
		}

		for (const entry of entries) {
			if (entry.name.startsWith(".") || IGNORED_DIRS.has(entry.name)) {
				continue;
			}
			const fullPath = join(dir, entry.name);
			let isDir = entry.isDirectory();
			let isFile = entry.isFile();
			if (entry.isSymbolicLink()) {
				try {
					const st = statSync(fullPath);
					isDir = st.isDirectory();
					isFile = st.isFile();
				} catch {
					continue;
				}
			}

			if (isDir) {
				walkDir(fullPath, false);
			} else if (isFile && entry.name.toLowerCase().endsWith(".md")) {
				if (IGNORED_MD_FILES.has(entry.name.toLowerCase())) {
					continue;
				}
				const isSkillMd = entry.name === "SKILL.md";
				const loaded = loadCandidateFile(
					resolvedRoot,
					fullPath,
					isSkillMd,
					folderGroups,
					parser,
					warnings,
				);
				if (loaded) {
					registerSkill(loaded);
				}
			}
		}
	};

	walkDir(resolvedRoot, true);

	return { skills, groups, warnings };
}
