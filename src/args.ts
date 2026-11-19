export type BragiAction =
	| "add"
	| "del"
	| "list"
	| "status"
	| "pick"
	| "setup"
	| "import"
	| "help"
	| "unknown";

export type TargetKind = "skill" | "group" | "any";

export interface TargetSpec {
	kind: TargetKind;
	name: string;
	raw: string;
}

export interface ParsedArgs {
	action: BragiAction;
	global: boolean;
	targets: TargetSpec[];
	unknownAction?: string;
}

const ACTION_ALIASES: Record<string, Exclude<BragiAction, "unknown">> = {
	add: "add",
	del: "del",
	rm: "del",
	remove: "del",
	list: "list",
	ls: "list",
	status: "status",
	pick: "pick",
	setup: "setup",
	import: "import",
	help: "help",
	"-h": "help",
	"--help": "help",
};

export function parseTargetToken(rawToken: string): TargetSpec | null {
	const token = rawToken.trim();
	if (!token) {
		return null;
	}

	if (token.startsWith("@")) {
		const groupName = token.slice(1).trim().toLowerCase();
		if (!groupName) {
			return null;
		}
		return {
			kind: "group",
			name: groupName,
			raw: token,
		};
	}

	const normalizedSlashes = token.replace(/\\/g, "/").replace(/\/+$/, "");
	const lower = normalizedSlashes.toLowerCase();

	if (lower.endsWith("/skill.md")) {
		const withoutFile = normalizedSlashes.slice(0, -"/skill.md".length);
		const parts = withoutFile.split("/").filter(Boolean);
		const name = parts[parts.length - 1] ?? "";
		if (!name) {
			return null;
		}
		return {
			kind: "skill",
			name,
			raw: token,
		};
	}

	if (lower.endsWith(".md")) {
		const withoutExt = normalizedSlashes.slice(0, -".md".length);
		const parts = withoutExt.split("/").filter(Boolean);
		const name = parts[parts.length - 1] ?? "";
		if (!name) {
			return null;
		}
		return {
			kind: "skill",
			name,
			raw: token,
		};
	}

	return {
		kind: "any",
		name: token,
		raw: token,
	};
}

export function parseArgs(input: string): ParsedArgs {
	const rawTokens = input
		.trim()
		.split(/\s+/)
		.filter((t) => t.length > 0);

	let global = false;
	const nonFlagTokens: string[] = [];

	for (const token of rawTokens) {
		if (token === "-g" || token === "--global") {
			global = true;
			continue;
		}
		nonFlagTokens.push(token);
	}

	if (nonFlagTokens.length === 0) {
		return {
			action: "pick",
			global,
			targets: [],
		};
	}

	const first = nonFlagTokens[0].toLowerCase();
	const mappedAction = ACTION_ALIASES[first];
	if (!mappedAction) {
		return {
			action: "unknown",
			global,
			targets: [],
			unknownAction: nonFlagTokens[0],
		};
	}

	const rest = nonFlagTokens.slice(1);
	const targets: TargetSpec[] = [];
	for (const item of rest) {
		if (item === "-h" || item === "--help") {
			return {
				action: "help",
				global,
				targets: [],
			};
		}
		const spec = parseTargetToken(item);
		if (spec) {
			targets.push(spec);
		}
	}

	return {
		action: mappedAction,
		global,
		targets,
	};
}
