import type { AutocompleteItem } from "@earendil-works/pi-tui";
import type { BragiConfig } from "./config.ts";
import type { RepoIndex } from "./repo.ts";
import { effective } from "./state.ts";

export interface CompletionScopeContext {
	config: BragiConfig;
	cwd: string;
	home?: string;
}

export const SUBCOMMANDS: Array<{ name: string; description: string }> = [
	{ name: "add", description: "Activate skills or @groups (project or -g global)" },
	{ name: "del", description: "Deactivate skills or @groups (project or -g global)" },
	{ name: "list", description: "List all repository skills, groups, and status" },
	{ name: "status", description: "Show active skills and configuration diagnostics" },
	{ name: "pick", description: "Interactive checkbox selector (-g for global)" },
	{ name: "setup", description: "Configure Bragi repository path and options" },
	{
		name: "import",
		description: "Move skills from ~/.pi/agent/skills into Bragi repo (-g to enable globally)",
	},
	{ name: "help", description: "Show Bragi command usage" },
];

export function completeBragiArgs(
	prefix: string,
	repo: RepoIndex,
	scopeCtx?: CompletionScopeContext,
): AutocompleteItem[] | null {
	const trimmedStart = prefix.replace(/^\s+/, "");
	const firstSpaceIdx = trimmedStart.search(/\s/);

	if (firstSpaceIdx === -1) {
		const token = trimmedStart.toLowerCase();
		const items = SUBCOMMANDS.filter((cmd) => cmd.name.startsWith(token)).map((cmd) => ({
			value: `${cmd.name} `,
			label: cmd.name,
			description: cmd.description,
		}));
		return items.length > 0 ? items : null;
	}

	const lastSpaceMatch = prefix.match(/^(.*\s)(\S*)$/);
	if (!lastSpaceMatch) {
		return null;
	}
	const headPrefix = lastSpaceMatch[1];
	const currentToken = lastSpaceMatch[2];
	const priorTokens = headPrefix
		.trim()
		.split(/\s+/)
		.filter((t) => t.length > 0);

	if (priorTokens.length === 0) {
		return null;
	}

	const action = priorTokens[0].toLowerCase();
	const hasGlobalFlag = priorTokens.includes("-g") || priorTokens.includes("--global");
	const usedTokens = new Set(priorTokens.slice(1).map((t) => t.toLowerCase()));

	if (action === "pick" || action === "import") {
		if (!hasGlobalFlag && "-g".startsWith(currentToken.toLowerCase())) {
			return [
				{
					value: `${headPrefix}-g `,
					label: "-g",
					description: "Apply to global scope",
				},
			];
		}
		return null;
	}

	const isAdd = action === "add";
	const isDel = action === "del" || action === "rm" || action === "remove";
	if (!isAdd && !isDel) {
		return null;
	}

	let activeSet: Set<string> | null = null;
	if (scopeCtx) {
		const activeList = hasGlobalFlag
			? scopeCtx.config.global
			: effective(scopeCtx.config, scopeCtx.cwd, scopeCtx.home);
		activeSet = new Set(activeList);
	}

	const isSkillEligible = (skillName: string): boolean => {
		const lower = skillName.toLowerCase();
		if (usedTokens.has(lower) || usedTokens.has(`${lower}.md`)) {
			return false;
		}
		if (!activeSet) {
			return true;
		}
		return isDel ? activeSet.has(skillName) : !activeSet.has(skillName);
	};

	const candidates: AutocompleteItem[] = [];
	const lowerCurrent = currentToken.toLowerCase();

	if (!hasGlobalFlag && "-g".startsWith(lowerCurrent)) {
		candidates.push({
			value: `${headPrefix}-g `,
			label: "-g",
			description: "Global scope",
		});
	}

	const sortedGroups = Array.from(repo.groups.entries()).sort(([a], [b]) => a.localeCompare(b));
	for (const [groupName, members] of sortedGroups) {
		const tag = `@${groupName}`;
		if (usedTokens.has(tag) || usedTokens.has(groupName)) {
			continue;
		}
		const eligibleMembers = members.filter((m) => isSkillEligible(m));
		if (eligibleMembers.length === 0) {
			continue;
		}
		if (
			tag.startsWith(lowerCurrent) ||
			(!lowerCurrent.startsWith("@") && groupName.startsWith(lowerCurrent))
		) {
			candidates.push({
				value: `${headPrefix}${tag} `,
				label: tag,
				description: `Group (${eligibleMembers.length}/${members.length}): ${eligibleMembers.join(", ")}`,
			});
		}
	}

	const sortedSkills = Array.from(repo.skills.values()).sort((a, b) =>
		a.name.localeCompare(b.name),
	);
	for (const skill of sortedSkills) {
		if (!isSkillEligible(skill.name)) {
			continue;
		}
		const lowerName = skill.name.toLowerCase();
		if (lowerName.startsWith(lowerCurrent)) {
			const groupHint = skill.groups.length > 0 ? `[${skill.groups.join(", ")}] ` : "";
			candidates.push({
				value: `${headPrefix}${skill.name} `,
				label: skill.name,
				description: `${groupHint}${skill.description}`,
			});
		}
	}

	return candidates.length > 0 ? candidates : null;
}
