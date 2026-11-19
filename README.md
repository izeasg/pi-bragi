# pi-bragi

A [Pi](https://pi.dev) extension that manages a central repository of skills and lets you activate or deactivate skills (individually or by group) at the **project** or **global** level.

All state is stored in a single central file (`~/.pi/agent/bragi.json`) and skills are injected dynamically via Pi's `resources_discover` event without copying or symlinking files into project folders.

## Installation

Install as a local Pi package:

```bash
pi install git:github.com/izeasg/pi-bragi
```

## Commands

| Command | Description |
|---|---|
| `/bragi` or `/bragi pick [-g]` | Open interactive checkbox selector for the current project (or `-g` for global). |
| `/bragi add [-g] <items...>` | Activate one or more skills (`skill`, `skill.md`) or groups (`@group`). |
| `/bragi del [-g] <items...>` | Deactivate one or more skills or groups. |
| `/bragi list` | List all skills in the repository with their groups and status (`G`, `P`, `G+P`, `×`, `-`). |
| `/bragi status` | Show active skills for the current project and configuration diagnostics. |
| `/bragi setup` | Configure the repository path and whether parent folder names act as groups. |
| `/bragi import [-g]` | Move existing skills from `~/.pi/agent/skills` into the Bragi repository (`-g` also activates them globally). |
| `/bragi help` | Show command usage. |

## Defining Groups (`bragi.group`)

Add a `bragi.group` field in a skill's `SKILL.md` frontmatter (as a single string, comma-separated string, or YAML list):

```yaml
---
name: rust-review
description: Review Rust code for safety, ownership, and style.
bragi:
  group: coding, review
---
```

```yaml
---
name: ts-lint
description: Lint TypeScript projects.
bragi:
  group:
    - coding
    - quality
---
```

You can also enable `folderGroups: true` via `/bragi setup` to automatically include parent folder names (relative to the repository root) as groups.

## Name Resolution Rules

- `@name` — resolves **only** as a group.
- `name.md` or `name/SKILL.md` — resolves **only** as a skill.
- `name` — resolves as a **skill first**, falling back to a **group** if no skill has that name.

When a group is added (`/bragi add @coding`), its current member skills are expanded and saved individually.

## Scope & Precedence

Effective active skills for a working directory are computed as:

```text
active = (global - project.disabled) ∪ project.skills
```

- `/bragi add x` activates `x` in the current project (or re-enables it if it was a global skill disabled in this project).
- `/bragi del x` deactivates `x` in the current project only. If `x` is active globally, it is added to the project's `disabled` list while remaining active in all other projects.
- `/bragi add -g x` adds `x` to the global list.
- `/bragi del -g x` removes `x` from the global list without modifying any project's explicit `skills` list.

## Configuration File (`~/.pi/agent/bragi.json`)

```json
{
  "repo": "~/.pi/agent/bragi/repo",
  "folderGroups": false,
  "global": ["caveman-commit", "lean-build"],
  "projects": {
    "~/Developer/pi-bragi": {
      "skills": ["rust-review", "ts-lint"],
      "disabled": ["lean-build"]
    }
  }
}
```
