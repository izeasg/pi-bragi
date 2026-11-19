import type { TargetSpec } from "./args.ts";
import type { RepoIndex } from "./repo.ts";

export interface ResolveResult {
	skills: string[];
	unknown: string[];
}

export function resolveTargets(targets: TargetSpec[], repo: RepoIndex): ResolveResult {
	const seenSkills = new Set<string>();
	const skills: string[] = [];
	const seenUnknown = new Set<string>();
	const unknown: string[] = [];

	const addSkill = (name: string) => {
		if (!seenSkills.has(name)) {
			seenSkills.add(name);
			skills.push(name);
		}
	};

	const addUnknown = (raw: string) => {
		if (!seenUnknown.has(raw)) {
			seenUnknown.add(raw);
			unknown.push(raw);
		}
	};

	for (const target of targets) {
		if (target.kind === "skill") {
			if (repo.skills.has(target.name)) {
				addSkill(target.name);
			} else {
				addUnknown(target.raw);
			}
			continue;
		}

		if (target.kind === "group") {
			const groupMembers = repo.groups.get(target.name.toLowerCase());
			if (groupMembers && groupMembers.length > 0) {
				for (const member of groupMembers) {
					addSkill(member);
				}
			} else {
				addUnknown(target.raw);
			}
			continue;
		}

		// kind === "any": skill wins over group
		if (repo.skills.has(target.name)) {
			addSkill(target.name);
			continue;
		}

		const groupMembers = repo.groups.get(target.name.toLowerCase());
		if (groupMembers && groupMembers.length > 0) {
			for (const member of groupMembers) {
				addSkill(member);
			}
			continue;
		}

		addUnknown(target.raw);
	}

	return { skills, unknown };
}
