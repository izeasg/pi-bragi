export type FrontmatterParser = (
	content: string,
) => { frontmatter: Record<string, unknown>; body: string };

function unquote(val: string): string {
	const trimmed = val.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function parseInlineArray(raw: string): string[] {
	const inner = raw.trim().slice(1, -1).trim();
	if (!inner) return [];
	return inner
		.split(",")
		.map((item) => unquote(item))
		.filter((item) => item.length > 0);
}

function parseScalarOrInline(raw: string): unknown {
	const trimmed = raw.trim();
	if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
		return parseInlineArray(trimmed);
	}
	if (trimmed === "true") return true;
	if (trimmed === "false") return false;
	return unquote(trimmed);
}

/**
 * Lightweight YAML frontmatter parser used as fallback when running outside Pi.
 * Inside Pi, `@earendil-works/pi-coding-agent`'s `parseFrontmatter` is injected.
 */
export const defaultParseFrontmatter: FrontmatterParser = (content: string) => {
	const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	if (!normalized.startsWith("---")) {
		return { frontmatter: {}, body: normalized };
	}
	const endIndex = normalized.indexOf("\n---", 3);
	if (endIndex === -1) {
		return { frontmatter: {}, body: normalized };
	}

	const yamlBlock = normalized.slice(4, endIndex);
	const body = normalized.slice(endIndex + 4).trim();
	const lines = yamlBlock.split("\n");

	const root: Record<string, unknown> = {};
	let currentSection: Record<string, unknown> | null = null;
	let currentListTarget: { container: Record<string, unknown>; key: string } | null = null;

	for (const rawLine of lines) {
		const commentStripped = rawLine.replace(/\s+#.*$/, "");
		if (!commentStripped.trim() || commentStripped.trimStart().startsWith("#")) {
			continue;
		}

		const indent = commentStripped.length - commentStripped.trimStart().length;
		const trimmed = commentStripped.trim();

		if (trimmed.startsWith("- ")) {
			const itemVal = unquote(trimmed.slice(2));
			if (currentListTarget) {
				const arr = currentListTarget.container[currentListTarget.key];
				if (Array.isArray(arr)) {
					arr.push(itemVal);
				}
			}
			continue;
		}

		const colonIdx = trimmed.indexOf(":");
		if (colonIdx === -1) {
			continue;
		}

		const key = trimmed.slice(0, colonIdx).trim();
		const rest = trimmed.slice(colonIdx + 1).trim();

		if (indent === 0) {
			currentSection = null;
			currentListTarget = null;
			if (rest === "") {
				const nested: Record<string, unknown> = {};
				root[key] = nested;
				currentSection = nested;
				currentListTarget = { container: root, key };
			} else {
				root[key] = parseScalarOrInline(rest);
			}
		} else if (currentSection) {
			if (rest === "") {
				const list: string[] = [];
				currentSection[key] = list;
				currentListTarget = { container: currentSection, key };
			} else {
				currentSection[key] = parseScalarOrInline(rest);
				currentListTarget = null;
			}
		}
	}

	return { frontmatter: root, body };
};
