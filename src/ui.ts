import { existsSync, mkdirSync } from "node:fs";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { Container, type SettingItem, SettingsList } from "@earendil-works/pi-tui";
import type { BragiConfig } from "./config.ts";
import { collapseHome, expandHome } from "./paths.ts";
import type { RepoIndex, RepoSkill } from "./repo.ts";

export interface PickSkillsOptions {
	scopeLabel: string;
	repo: RepoIndex;
	initialEnabled: Iterable<string>;
}

export interface PickSkillsResult {
	enabled: Set<string>;
	changed: boolean;
}

export interface SetupResult {
	repo: string;
	folderGroups: boolean;
	createdDir: boolean;
}

const GROUP_ID_PREFIX = "group:";
const SKILL_ID_PREFIX = "skill:";

function sortSkillsForDisplay(skills: Iterable<RepoSkill>): RepoSkill[] {
	return Array.from(skills).sort((a, b) => {
		const groupA = a.groups[0] ?? "~";
		const groupB = b.groups[0] ?? "~";
		if (groupA !== groupB) {
			return groupA.localeCompare(groupB);
		}
		return a.name.localeCompare(b.name);
	});
}

export async function pickSkills(
	ctx: ExtensionCommandContext,
	options: PickSkillsOptions,
): Promise<PickSkillsResult | null> {
	if (ctx.mode !== "tui") {
		if (ctx.hasUI) {
			ctx.ui.notify("/bragi pick requires interactive TUI mode.", "error");
		}
		return null;
	}

	const initialSet = new Set(options.initialEnabled);
	const currentSet = new Set(options.initialEnabled);
	const sortedSkills = sortSkillsForDisplay(options.repo.skills.values());
	const sortedGroups = Array.from(options.repo.groups.entries()).sort(([a], [b]) =>
		a.localeCompare(b),
	);

	if (sortedSkills.length === 0) {
		ctx.ui.notify("No skills found in the Bragi repository.", "warning");
		return null;
	}

	const computeGroupState = (members: string[]): "enabled" | "disabled" => {
		return members.length > 0 && members.every((m) => currentSet.has(m)) ? "enabled" : "disabled";
	};

	await ctx.ui.custom((tui, theme, _kb, done) => {
		const items: SettingItem[] = [];

		for (const [groupName, members] of sortedGroups) {
			items.push({
				id: `${GROUP_ID_PREFIX}${groupName}`,
				label: `@${groupName} (${members.length})`,
				description: `Group [${groupName}]: ${members.join(", ")}`,
				currentValue: computeGroupState(members),
				values: ["enabled", "disabled"],
			});
		}

		for (const skill of sortedSkills) {
			const groupSuffix = skill.groups.length > 0 ? ` [${skill.groups.join(", ")}]` : "";
			items.push({
				id: `${SKILL_ID_PREFIX}${skill.name}`,
				label: `${skill.name}${groupSuffix}`,
				description: skill.description,
				currentValue: currentSet.has(skill.name) ? "enabled" : "disabled",
				values: ["enabled", "disabled"],
			});
		}

		const container = new Container();
		container.addChild({
			render(_width: number) {
				return [
					theme.fg("accent", theme.bold(`Bragi Skills (${options.scopeLabel})`)),
					theme.fg("dim", "Space/Enter to toggle · Esc to apply and close"),
					"",
				];
			},
			invalidate() {},
		});

		let settingsList: SettingsList;

		const syncGroupValues = () => {
			for (const [groupName, members] of sortedGroups) {
				settingsList.updateValue(`${GROUP_ID_PREFIX}${groupName}`, computeGroupState(members));
			}
		};

		settingsList = new SettingsList(
			items,
			Math.min(items.length + 2, 16),
			getSettingsListTheme(),
			(id, newValue) => {
				if (id.startsWith(GROUP_ID_PREFIX)) {
					const groupName = id.slice(GROUP_ID_PREFIX.length);
					const members = options.repo.groups.get(groupName) ?? [];
					for (const member of members) {
						if (newValue === "enabled") {
							currentSet.add(member);
						} else {
							currentSet.delete(member);
						}
						settingsList.updateValue(`${SKILL_ID_PREFIX}${member}`, newValue);
					}
					syncGroupValues();
					return;
				}

				if (id.startsWith(SKILL_ID_PREFIX)) {
					const skillName = id.slice(SKILL_ID_PREFIX.length);
					if (newValue === "enabled") {
						currentSet.add(skillName);
					} else {
						currentSet.delete(skillName);
					}
					syncGroupValues();
				}
			},
			() => {
				done(undefined);
			},
			{ enableSearch: true },
		);

		container.addChild(settingsList);

		return {
			capturesViewportInput: settingsList.capturesViewportInput,
			render(width: number) {
				return container.render(width);
			},
			invalidate() {
				container.invalidate();
			},
			handleInput(data: string) {
				settingsList.handleInput(data);
				tui.requestRender();
			},
		};
	});

	let changed = initialSet.size !== currentSet.size;
	if (!changed) {
		for (const item of currentSet) {
			if (!initialSet.has(item)) {
				changed = true;
				break;
			}
		}
	}

	return {
		enabled: currentSet,
		changed,
	};
}

export async function runSetup(
	ctx: ExtensionCommandContext,
	current: BragiConfig,
): Promise<SetupResult | null> {
	if (!ctx.hasUI) {
		return null;
	}

	const rawRepo = await ctx.ui.input(
		`Bragi skills repository path (current: ${current.repo}):`,
		current.repo,
	);
	if (rawRepo === undefined) {
		return null;
	}

	const chosenRepo = rawRepo.trim() !== "" ? rawRepo.trim() : current.repo;
	const expandedRepo = expandHome(chosenRepo);
	const normalizedRepo = collapseHome(expandedRepo);

	const folderChoice = await ctx.ui.select(
		"Include parent folder names as skill groups (folderGroups)?",
		[
			current.folderGroups ? "No (frontmatter only)" : "No (frontmatter only - current)",
			current.folderGroups ? "Yes (frontmatter + folders - current)" : "Yes (frontmatter + folders)",
		],
	);
	if (folderChoice === undefined) {
		return null;
	}
	const folderGroups = folderChoice.startsWith("Yes");

	let createdDir = false;
	if (!existsSync(expandedRepo)) {
		const shouldCreate = await ctx.ui.confirm(
			"Create repository directory?",
			`Directory ${expandedRepo} does not exist yet. Create it now?`,
		);
		if (shouldCreate) {
			mkdirSync(expandedRepo, { recursive: true });
			createdDir = true;
		}
	}

	return {
		repo: normalizedRepo,
		folderGroups,
		createdDir,
	};
}
