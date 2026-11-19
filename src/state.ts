import { homedir } from "node:os";
import type { BragiConfig, ProjectEntry } from "./config.ts";
import { findProjectKey } from "./paths.ts";

export type Scope = { kind: "global" } | { kind: "project"; key: string };

export interface Change {
	changed: string[];
	unchanged: string[];
}

export type SkillBadge = "G" | "P" | "G+P" | "×" | "-";

export interface SkillStatusInfo {
	name: string;
	active: boolean;
	inGlobal: boolean;
	inProject: boolean;
	disabledInProject: boolean;
	badge: SkillBadge;
}

export function getProjectForCwd(
	cfg: BragiConfig,
	cwd: string,
	home: string = homedir(),
): { key: string | null; entry: ProjectEntry } {
	const key = findProjectKey(cfg.projects, cwd, home);
	if (!key || !cfg.projects[key]) {
		return {
			key: null,
			entry: { skills: [], disabled: [] },
		};
	}
	return {
		key,
		entry: cfg.projects[key],
	};
}

export function effective(cfg: BragiConfig, cwd: string, home: string = homedir()): string[] {
	const { entry } = getProjectForCwd(cfg, cwd, home);
	const disabledSet = new Set(entry.disabled);
	const result: string[] = [];
	const seen = new Set<string>();

	for (const name of cfg.global) {
		if (!disabledSet.has(name) && !seen.has(name)) {
			seen.add(name);
			result.push(name);
		}
	}

	for (const name of entry.skills) {
		if (!seen.has(name)) {
			seen.add(name);
			result.push(name);
		}
	}

	return result;
}

export function inspectSkill(
	cfg: BragiConfig,
	cwd: string,
	name: string,
	home: string = homedir(),
): SkillStatusInfo {
	const { entry } = getProjectForCwd(cfg, cwd, home);
	const inGlobal = cfg.global.includes(name);
	const inProject = entry.skills.includes(name);
	const disabledInProject = entry.disabled.includes(name);
	const active = (inGlobal && !disabledInProject) || inProject;

	let badge: SkillBadge = "-";
	if (inGlobal && inProject) {
		badge = "G+P";
	} else if (inGlobal && disabledInProject) {
		badge = "×";
	} else if (inGlobal) {
		badge = "G";
	} else if (inProject) {
		badge = "P";
	}

	return {
		name,
		active,
		inGlobal,
		inProject,
		disabledInProject,
		badge,
	};
}

function ensureProjectEntry(cfg: BragiConfig, key: string): ProjectEntry {
	if (!cfg.projects[key]) {
		cfg.projects[key] = { skills: [], disabled: [] };
	}
	return cfg.projects[key];
}

function cleanupProjectEntry(cfg: BragiConfig, key: string): void {
	const entry = cfg.projects[key];
	if (entry && entry.skills.length === 0 && entry.disabled.length === 0) {
		delete cfg.projects[key];
	}
}

export function add(cfg: BragiConfig, scope: Scope, names: string[]): Change {
	const changed: string[] = [];
	const unchanged: string[] = [];

	if (scope.kind === "global") {
		for (const name of names) {
			if (!cfg.global.includes(name)) {
				cfg.global.push(name);
				changed.push(name);
			} else {
				unchanged.push(name);
			}
		}
		return { changed, unchanged };
	}

	const entry = ensureProjectEntry(cfg, scope.key);
	for (const name of names) {
		let didChange = false;

		const disabledIdx = entry.disabled.indexOf(name);
		if (disabledIdx !== -1) {
			entry.disabled.splice(disabledIdx, 1);
			didChange = true;
		}

		const inGlobal = cfg.global.includes(name);
		const inProject = entry.skills.includes(name);
		if (!inGlobal && !inProject) {
			entry.skills.push(name);
			didChange = true;
		}

		if (didChange) {
			changed.push(name);
		} else {
			unchanged.push(name);
		}
	}

	cleanupProjectEntry(cfg, scope.key);
	return { changed, unchanged };
}

export function del(cfg: BragiConfig, scope: Scope, names: string[]): Change {
	const changed: string[] = [];
	const unchanged: string[] = [];

	if (scope.kind === "global") {
		for (const name of names) {
			const idx = cfg.global.indexOf(name);
			if (idx !== -1) {
				cfg.global.splice(idx, 1);
				changed.push(name);
			} else {
				unchanged.push(name);
			}
		}
		return { changed, unchanged };
	}

	const entry = ensureProjectEntry(cfg, scope.key);
	for (const name of names) {
		let didChange = false;

		const skillIdx = entry.skills.indexOf(name);
		if (skillIdx !== -1) {
			entry.skills.splice(skillIdx, 1);
			didChange = true;
		}

		const inGlobal = cfg.global.includes(name);
		if (inGlobal && !entry.disabled.includes(name)) {
			entry.disabled.push(name);
			didChange = true;
		}

		if (didChange) {
			changed.push(name);
		} else {
			unchanged.push(name);
		}
	}

	cleanupProjectEntry(cfg, scope.key);
	return { changed, unchanged };
}
