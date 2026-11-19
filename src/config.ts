import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { configFile, DEFAULT_REPO_PATH } from "./paths.ts";

export interface ProjectEntry {
	skills: string[];
	disabled: string[];
}

export interface BragiConfig {
	repo: string;
	folderGroups: boolean;
	global: string[];
	projects: Record<string, ProjectEntry>;
}

export class BragiConfigError extends Error {
	readonly filePath: string;

	constructor(filePath: string, message: string) {
		super(`Invalid Bragi config at ${filePath}: ${message}`);
		this.name = "BragiConfigError";
		this.filePath = filePath;
	}
}

export function defaultConfig(): BragiConfig {
	return {
		repo: DEFAULT_REPO_PATH,
		folderGroups: false,
		global: [],
		projects: {},
	};
}

function sanitizeSkillNames(input: unknown): string[] {
	if (!Array.isArray(input)) {
		return [];
	}
	const seen = new Set<string>();
	const result: string[] = [];
	for (const item of input) {
		if (typeof item !== "string") continue;
		const trimmed = item.trim();
		if (!trimmed || trimmed.includes("/") || trimmed.includes("\\") || trimmed === "." || trimmed === "..") {
			continue;
		}
		if (!seen.has(trimmed)) {
			seen.add(trimmed);
			result.push(trimmed);
		}
	}
	return result;
}

export function normalizeConfig(raw: unknown): BragiConfig {
	const base = defaultConfig();
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return base;
	}
	const obj = raw as Record<string, unknown>;
	const repo = typeof obj.repo === "string" && obj.repo.trim() !== "" ? obj.repo.trim() : base.repo;
	const folderGroups = typeof obj.folderGroups === "boolean" ? obj.folderGroups : base.folderGroups;
	const global = sanitizeSkillNames(obj.global);
	const projects: Record<string, ProjectEntry> = {};

	if (typeof obj.projects === "object" && obj.projects !== null && !Array.isArray(obj.projects)) {
		for (const [key, value] of Object.entries(obj.projects as Record<string, unknown>)) {
			const trimmedKey = key.trim();
			if (!trimmedKey || typeof value !== "object" || value === null || Array.isArray(value)) {
				continue;
			}
			const entryObj = value as Record<string, unknown>;
			const skills = sanitizeSkillNames(entryObj.skills);
			const disabled = sanitizeSkillNames(entryObj.disabled);
			if (skills.length > 0 || disabled.length > 0) {
				projects[trimmedKey] = { skills, disabled };
			}
		}
	}

	return {
		repo,
		folderGroups,
		global,
		projects,
	};
}

export function readConfigOrThrow(file: string = configFile()): BragiConfig {
	if (!existsSync(file)) {
		return defaultConfig();
	}
	let rawText: string;
	try {
		rawText = readFileSync(file, "utf-8");
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new BragiConfigError(file, msg);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(rawText);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new BragiConfigError(file, msg);
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new BragiConfigError(file, "root JSON value must be an object");
	}
	return normalizeConfig(parsed);
}

export function readConfig(file: string = configFile()): { config: BragiConfig; error?: string } {
	try {
		return { config: readConfigOrThrow(file) };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { config: defaultConfig(), error: msg };
	}
}

export function writeConfig(cfg: BragiConfig, file: string = configFile()): BragiConfig {
	const normalized = normalizeConfig(cfg);
	const dir = dirname(file);
	mkdirSync(dir, { recursive: true });
	const tmpFile = `${file}.${process.pid}.${Date.now()}.tmp`;
	try {
		writeFileSync(tmpFile, `${JSON.stringify(normalized, null, 2)}\n`, "utf-8");
		renameSync(tmpFile, file);
	} catch (err) {
		try {
			if (existsSync(tmpFile)) {
				rmSync(tmpFile, { force: true });
			}
		} catch {
			// Ignore cleanup failures
		}
		throw err;
	}
	return normalized;
}

export function updateConfig(
	mutator: (cfg: BragiConfig) => void,
	file: string = configFile(),
): BragiConfig {
	const current = readConfigOrThrow(file);
	mutator(current);
	return writeConfig(current, file);
}
