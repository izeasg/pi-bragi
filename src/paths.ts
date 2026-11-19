import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

export const DEFAULT_REPO_PATH = "~/.pi/agent/bragi/repo";

export function defaultAgentDir(home: string = homedir()): string {
	const envDir = process.env.PI_CODING_AGENT_DIR;
	if (envDir && envDir.trim() !== "") {
		return expandHome(envDir, home);
	}
	return join(home, ".pi", "agent");
}

export function configFile(agentDir: string = defaultAgentDir()): string {
	return join(agentDir, "bragi.json");
}

export function agentSkillsDir(agentDir: string = defaultAgentDir()): string {
	return join(agentDir, "skills");
}

export function expandHome(inputPath: string, home: string = homedir()): string {
	const trimmed = inputPath.trim();
	if (trimmed === "~") {
		return resolve(home);
	}
	if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
		return resolve(home, trimmed.slice(2));
	}
	return resolve(trimmed);
}

export function collapseHome(inputPath: string, home: string = homedir()): string {
	const resolvedHome = resolve(home);
	const resolvedPath = expandHome(inputPath, resolvedHome);
	if (resolvedPath === resolvedHome) {
		return "~";
	}
	const prefix = resolvedHome.endsWith(sep) ? resolvedHome : `${resolvedHome}${sep}`;
	if (resolvedPath.startsWith(prefix)) {
		const relative = resolvedPath.slice(prefix.length).split(sep).join("/");
		return `~/${relative}`;
	}
	return resolvedPath;
}

export function findGitRoot(cwd: string): string | null {
	let current = resolve(cwd);
	while (true) {
		if (existsSync(join(current, ".git"))) {
			return current;
		}
		const parent = dirname(current);
		if (parent === current) {
			return null;
		}
		current = parent;
	}
}

export function projectKey(cwd: string, home: string = homedir()): string {
	const root = findGitRoot(cwd) ?? resolve(cwd);
	return collapseHome(root, home);
}

export function findProjectKey<T>(
	projects: Record<string, T>,
	cwd: string,
	home: string = homedir(),
): string | null {
	const absCwd = expandHome(cwd, home);
	let bestKey: string | null = null;
	let bestLen = -1;

	for (const key of Object.keys(projects)) {
		const absKey = expandHome(key, home);
		const prefix = absKey.endsWith(sep) ? absKey : `${absKey}${sep}`;
		if (absCwd === absKey || absCwd.startsWith(prefix)) {
			if (absKey.length > bestLen) {
				bestLen = absKey.length;
				bestKey = key;
			}
		}
	}

	return bestKey;
}

export function resolveWriteProjectKey<T>(
	projects: Record<string, T>,
	cwd: string,
	home: string = homedir(),
): string {
	const gitRoot = findGitRoot(cwd);
	if (gitRoot) {
		const gitKey = collapseHome(gitRoot, home);
		for (const existingKey of Object.keys(projects)) {
			if (expandHome(existingKey, home) === resolve(gitRoot)) {
				return existingKey;
			}
		}
		return gitKey;
	}
	return findProjectKey(projects, cwd, home) ?? collapseHome(resolve(cwd), home);
}
