import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
	type ExtensionAPI,
	type ExtensionCommandContext,
	getAgentDir,
	parseFrontmatter,
} from "@earendil-works/pi-coding-agent";
import { parseArgs } from "./args.ts";
import { completeBragiArgs } from "./complete.ts";
import {
	type BragiConfig,
	readConfig,
	readConfigOrThrow,
	updateConfig,
} from "./config.ts";
import { planImport, runImport } from "./importer.ts";
import {
	agentSkillsDir,
	configFile,
	expandHome,
	projectKey,
	resolveWriteProjectKey,
} from "./paths.ts";
import { type RepoIndex, scanRepo } from "./repo.ts";
import { resolveTargets } from "./resolve.ts";
import {
	add,
	type Change,
	del,
	effective,
	getProjectForCwd,
	inspectSkill,
	type Scope,
} from "./state.ts";
import { pickSkills, runSetup } from "./ui.ts";

export { completeBragiArgs } from "./complete.ts";

export const BRAGI_HELP = [
	"Bragi skill manager commands:",
	"  /bragi                       Interactive skill selector (project scope)",
	"  /bragi pick [-g]             Interactive skill selector (-g for global)",
	"  /bragi add [-g] <items...>   Activate skills (name, name.md) or groups (@group)",
	"  /bragi del [-g] <items...>   Deactivate skills or groups",
	"  /bragi list                  List all skills and groups in the repository",
	"  /bragi status                Show active skills and diagnostics for current project",
	"  /bragi setup                 Configure repository path and folderGroups option",
	"  /bragi import [-g]           Move skills from ~/.pi/agent/skills to Bragi repo",
	"  /bragi help                  Show this help message",
].join("\n");

function formatListOutput(cfg: BragiConfig, repo: RepoIndex, cwd: string): string {
	const lines: string[] = [];
	lines.push(`Bragi repository: ${cfg.repo}`);

	if (repo.groups.size > 0) {
		const groupSummary = Array.from(repo.groups.entries())
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([g, members]) => `@${g} (${members.length})`)
			.join(", ");
		lines.push(`Groups: ${groupSummary}`);
	}

	if (repo.skills.size === 0) {
		lines.push("No skills found in repository.");
		return lines.join("\n");
	}

	lines.push("");
	const sorted = Array.from(repo.skills.values()).sort((a, b) => a.name.localeCompare(b.name));
	for (const skill of sorted) {
		const st = inspectSkill(cfg, cwd, skill.name);
		const groupTag = skill.groups.length > 0 ? ` [${skill.groups.join(", ")}]` : "";
		lines.push(`  [${st.badge.padEnd(3, " ")}] ${skill.name}${groupTag} - ${skill.description}`);
	}

	lines.push("");
	lines.push("Legend: G = global, P = project, G+P = both, × = disabled in project, - = inactive");
	return lines.join("\n");
}

function formatStatusOutput(
	pi: ExtensionAPI,
	cfg: BragiConfig,
	repo: RepoIndex,
	cwd: string,
): string {
	const lines: string[] = [];
	const expandedRepo = expandHome(cfg.repo);
	const repoExists = existsSync(expandedRepo);
	const projInfo = getProjectForCwd(cfg, cwd);
	const currentProjKey = projInfo.key ?? projectKey(cwd);

	lines.push(`Repository: ${cfg.repo}${repoExists ? "" : " (missing directory)"}`);
	lines.push(`Project key: ${currentProjKey}`);

	const activeNames = effective(cfg, cwd);
	if (activeNames.length === 0) {
		lines.push("Active skills (0): none");
	} else {
		lines.push(`Active skills (${activeNames.length}):`);
		for (const name of activeNames) {
			const st = inspectSkill(cfg, cwd, name);
			const skill = repo.skills.get(name);
			const groupTag = skill && skill.groups.length > 0 ? ` [${skill.groups.join(", ")}]` : "";
			const origin =
				st.inGlobal && st.inProject ? "global + project" : st.inGlobal ? "global" : "project";
			const missingTag = skill ? "" : " [missing in repo]";
			lines.push(`  - ${name}${groupTag} (${origin})${missingTag}`);
		}
	}

	if (projInfo.entry.disabled.length > 0) {
		lines.push(`Disabled in this project: ${projInfo.entry.disabled.join(", ")}`);
	}

	const referenced = new Set([...cfg.global, ...projInfo.entry.skills]);
	const missingSkills = Array.from(referenced).filter((name) => !repo.skills.has(name));
	if (missingSkills.length > 0) {
		lines.push(`Warning - configured skills not found in repo: ${missingSkills.join(", ")}`);
	}

	try {
		const commands = pi.getCommands();
		const normalizedRepoPrefix = resolve(expandedRepo);
		const duplicateSkills: string[] = [];
		for (const cmd of commands) {
			if (cmd.source !== "skill" || !cmd.name.startsWith("skill:")) continue;
			const skillName = cmd.name.slice("skill:".length);
			if (!repo.skills.has(skillName)) continue;
			const cmdPath = resolve(cmd.sourceInfo.path);
			if (!cmdPath.startsWith(normalizedRepoPrefix)) {
				duplicateSkills.push(`${skillName} (${cmd.sourceInfo.path})`);
			}
		}
		if (duplicateSkills.length > 0) {
			lines.push(`Warning - duplicate skills outside Bragi repo: ${duplicateSkills.join(", ")}`);
		}
	} catch {
		// Ignore if getCommands is unavailable
	}

	const orphanedProjects = Object.keys(cfg.projects).filter(
		(key) => !existsSync(expandHome(key)),
	);
	if (orphanedProjects.length > 0) {
		lines.push(`Warning - project paths no longer exist on disk: ${orphanedProjects.join(", ")}`);
	}

	if (repo.warnings.length > 0) {
		for (const w of repo.warnings) {
			lines.push(`Repo warning: ${w}`);
		}
	}

	return lines.join("\n");
}

async function reloadOrNotify(ctx: ExtensionCommandContext): Promise<void> {
	if (ctx.isIdle()) {
		await ctx.reload();
		return;
	}
	if (ctx.hasUI) {
		ctx.ui.notify("Bragi config saved. Run /reload when the agent finishes to apply.", "info");
	}
}

export default function bragiExtension(pi: ExtensionAPI) {
	let currentCwd = process.cwd();
	const getCfgPath = () => configFile(getAgentDir());
	const scanWithPiParser = (cfg: BragiConfig) =>
		scanRepo(expandHome(cfg.repo), {
			folderGroups: cfg.folderGroups,
			parseFrontmatter: (content) => parseFrontmatter<Record<string, unknown>>(content),
		});

	pi.on("session_start", (_event, ctx) => {
		currentCwd = ctx.cwd;
	});

	pi.on("resources_discover", async (event) => {
		currentCwd = event.cwd;
		const { config } = readConfig(getCfgPath());
		const repo = scanWithPiParser(config);
		const skillPaths = effective(config, event.cwd)
			.map((name) => repo.skills.get(name)?.filePath)
			.filter((filePath): filePath is string => Boolean(filePath));

		return { skillPaths };
	});

	pi.registerCommand("bragi", {
		description: "Manage skills from the Bragi repository",
		getArgumentCompletions: (prefix) => {
			const { config } = readConfig(getCfgPath());
			const repo = scanWithPiParser(config);
			return completeBragiArgs(prefix, repo, { config, cwd: currentCwd });
		},
		handler: async (args, ctx) => {
			currentCwd = ctx.cwd;
			const parsed = parseArgs(args);
			const cfgPath = getCfgPath();

			if (parsed.action === "help") {
				ctx.ui.notify(BRAGI_HELP, "info");
				return;
			}

			if (parsed.action === "unknown") {
				ctx.ui.notify(
					`Unknown subcommand "${parsed.unknownAction}".\n\n${BRAGI_HELP}`,
					"warning",
				);
				return;
			}

			let cfg: BragiConfig;
			try {
				cfg = readConfigOrThrow(cfgPath);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				ctx.ui.notify(msg, "error");
				return;
			}

			if (parsed.action === "setup") {
				if (!ctx.hasUI) {
					ctx.ui.notify("/bragi setup requires an interactive UI.", "error");
					return;
				}
				const setupResult = await runSetup(ctx, cfg);
				if (!setupResult) {
					return;
				}
				updateConfig((c) => {
					c.repo = setupResult.repo;
					c.folderGroups = setupResult.folderGroups;
				}, cfgPath);
				const dirMsg = setupResult.createdDir ? " (directory created)" : "";
				ctx.ui.notify(
					`Bragi configured: repo=${setupResult.repo}${dirMsg}, folderGroups=${setupResult.folderGroups}`,
					"info",
				);
				await reloadOrNotify(ctx);
				return;
			}

			const repo = scanWithPiParser(cfg);

			if (parsed.action === "list") {
				ctx.ui.notify(formatListOutput(cfg, repo, ctx.cwd), "info");
				return;
			}

			if (parsed.action === "status") {
				ctx.ui.notify(formatStatusOutput(pi, cfg, repo, ctx.cwd), "info");
				return;
			}

			if (parsed.action === "import") {
				if (!ctx.hasUI) {
					ctx.ui.notify("/bragi import requires an interactive UI.", "error");
					return;
				}
				const srcDir = agentSkillsDir(getAgentDir());
				const plan = planImport(
					srcDir,
					expandHome(cfg.repo),
					repo,
					(content) => parseFrontmatter<Record<string, unknown>>(content),
				);
				if (plan.error) {
					ctx.ui.notify(plan.error, "error");
					return;
				}
				if (plan.move.length === 0) {
					const skipNote =
						plan.skipped.length > 0
							? ` Skipped (${plan.skipped.length}): ${plan.skipped.map((s) => `${s.name} (${s.reason})`).join(", ")}.`
							: "";
					ctx.ui.notify(`No skills to import from ${srcDir}.${skipNote}`, "info");
					return;
				}

				const moveNames = plan.move.map((m) => m.name).join(", ");
				const skipSummary =
					plan.skipped.length > 0
						? `\nSkipped (${plan.skipped.length}): ${plan.skipped.map((s) => s.name).join(", ")}`
						: "";
				const globalNote = parsed.global
					? "\nThey will also be activated globally (-g)."
					: "";

				const confirmed = await ctx.ui.confirm(
					"Import skills into Bragi repository?",
					`Move ${plan.move.length} skill(s) from ${srcDir} to ${cfg.repo}?\nSkills: ${moveNames}${globalNote}${skipSummary}`,
				);
				if (!confirmed) {
					return;
				}

				const result = runImport(plan);
				if (parsed.global && result.moved.length > 0) {
					updateConfig((c) => {
						add(c, { kind: "global" }, result.moved);
					}, cfgPath);
				}

				const parts: string[] = [];
				if (result.moved.length > 0) {
					parts.push(`Moved (${result.moved.length}): ${result.moved.join(", ")}`);
				}
				if (result.failed.length > 0) {
					parts.push(
						`Failed (${result.failed.length}): ${result.failed.map((f) => `${f.name} (${f.error})`).join(", ")}`,
					);
				}
				ctx.ui.notify(parts.join("\n"), result.failed.length > 0 ? "warning" : "info");
				if (result.moved.length > 0) {
					await reloadOrNotify(ctx);
				}
				return;
			}

			if (parsed.action === "pick") {
				const scope: Scope = parsed.global
					? { kind: "global" }
					: { kind: "project", key: resolveWriteProjectKey(cfg.projects, ctx.cwd) };
				const scopeLabel =
					scope.kind === "global" ? "global" : `project: ${scope.key}`;
				const initialEnabled =
					scope.kind === "global" ? new Set(cfg.global) : new Set(effective(cfg, ctx.cwd));

				const pickResult = await pickSkills(ctx, {
					scopeLabel,
					repo,
					initialEnabled,
				});
				if (!pickResult || !pickResult.changed) {
					return;
				}

				const toAdd: string[] = [];
				const toDel: string[] = [];
				for (const name of pickResult.enabled) {
					if (!initialEnabled.has(name)) {
						toAdd.push(name);
					}
				}
				for (const name of initialEnabled) {
					if (!pickResult.enabled.has(name)) {
						toDel.push(name);
					}
				}

				updateConfig((c) => {
					if (toAdd.length > 0) add(c, scope, toAdd);
					if (toDel.length > 0) del(c, scope, toDel);
				}, cfgPath);

				const summary: string[] = [];
				if (toAdd.length > 0) summary.push(`activated: ${toAdd.join(", ")}`);
				if (toDel.length > 0) summary.push(`deactivated: ${toDel.join(", ")}`);
				ctx.ui.notify(`Bragi (${scopeLabel}) — ${summary.join(" · ")}`, "info");
				await reloadOrNotify(ctx);
				return;
			}

			if (parsed.targets.length === 0) {
				ctx.ui.notify(
					`Usage: /bragi ${parsed.action} [-g] <skill | skill.md | @group>...`,
					"warning",
				);
				return;
			}

			const resolved = resolveTargets(parsed.targets, repo);
			if (resolved.skills.length === 0) {
				ctx.ui.notify(
					`Not found in Bragi repository: ${resolved.unknown.join(", ")}`,
					"warning",
				);
				return;
			}

			const scope: Scope = parsed.global
				? { kind: "global" }
				: { kind: "project", key: resolveWriteProjectKey(cfg.projects, ctx.cwd) };
			const scopeLabel = scope.kind === "global" ? "global" : `project ${scope.key}`;

			let change: Change = { changed: [], unchanged: [] };
			updateConfig((c) => {
				change =
					parsed.action === "add"
						? add(c, scope, resolved.skills)
						: del(c, scope, resolved.skills);
			}, cfgPath);

			const verb = parsed.action === "add" ? "activated" : "deactivated";
			const parts: string[] = [];
			if (change.changed.length > 0) {
				parts.push(`${verb} (${scopeLabel}): ${change.changed.join(", ")}`);
			}
			if (change.unchanged.length > 0) {
				parts.push(`already ${verb}: ${change.unchanged.join(", ")}`);
			}
			if (resolved.unknown.length > 0) {
				parts.push(`not found: ${resolved.unknown.join(", ")}`);
			}

			ctx.ui.notify(
				parts.join(" · "),
				resolved.unknown.length > 0 ? "warning" : "info",
			);

			if (change.changed.length > 0) {
				await reloadOrNotify(ctx);
			}
		},
	});
}
