# Install agent skills

[Documentation](../index.md) · How-to

The Forge ships its working knowledge as [Agent Skills](https://agentskills.io/specification): folders with a `SKILL.md` whose YAML frontmatter names the skill and says what it does and when to use it. Agents load only the name and description up front and read the body when a task matches. Install them into a project so Claude Code and other agents find them.

## Install into both skill roots

```sh
node bin/forge.js project open my-app
node bin/forge.js skills install --dry-run
node bin/forge.js skills install
```

`skills install` writes every registered skill twice in the active scope:

| Root | Read by |
| --- | --- |
| `.claude/skills/<id>/SKILL.md` | Claude Code |
| `.agents/skills/<id>/SKILL.md` | Agents that read the cross-agent `.agents/skills` root |

`setup` installs the same files at workspace scope. Existing files are never overwritten: `skills install` fails with `CONFLICT` and `setup` reports them as skipped, so edited skills stay yours. To refresh a skill, read it, then replace it with `write <path> --from ... --if-match <revision>` or delete it and install again.

## Install into one root or a custom folder

```sh
node bin/forge.js skills install --target claude
node bin/forge.js skills install --target agents
node bin/forge.js skills install --out tools/skills
```

`--target` selects `claude`, `agents` or `both` (the default). `--out` installs into one custom directory instead; it cannot be combined with `--target`.

## Inspect the skills

```sh
node bin/forge.js skills list
node bin/forge.js skills show forge-vault
```

| Skill | Use when |
| --- | --- |
| `forge-workflow` | Starting any Forge task: discovery with `schema`, project selection, dry runs, revision guards and error recovery |
| `forge-vault` | Reading, searching, linking and editing notes, properties, Canvas, Bases and attachments |
| `forge-development` | Generating and verifying TypeScript code with scaffolds and quality gates |
| `forge-agents` | Maintaining docker-agent definitions and generating Claude Code agents |
| `forge-backlog` | Planning, ranking, releasing and syncing a product backlog |

The authored sources live in the Forge project's `skills/<id>/SKILL.md` and are packaged into the workspace `bin/skills`. Plugins contribute skills in the same shape; a user plugin's skill ids start with `<plugin-id>-`. See [plugin contributions](../reference/plugins.md#contract) and the [CLI reference](../reference/cli.md#commands).

To measure whether agents complete tasks with these skills, see [evaluate agents](evaluate-agents.md).
