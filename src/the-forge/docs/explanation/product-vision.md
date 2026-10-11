# Product vision

[Documentation](../index.md) · Explanation

The Forge is a terminal project companion. It provides the tools for AI-assisted project and product development, and it keeps everything it produces in plain files that are fully compatible with Obsidian.

## Two interfaces, one vault

The user lives in Obsidian. Design, concepts, specifications, documentation, the backlog and the code are all managed, read and edited there.

The agent has its own interface: this CLI. It can do anything the user can do with the vault in Obsidian, from the terminal, without Obsidian running or even installed. Both interfaces read and write the same files, so each side sees the other's work immediately and nothing needs syncing between them.

Everything is stored in native formats:
- Markdown with frontmatter properties
- JSON Canvas
- Obsidian Bases

Notes stay readable and editable in Obsidian's Source mode. Canvas and Bases files open as native views. Git provides history, review and collaboration.

## What The Forge is for

- **A file-based, Git-backed, multi-project toolkit.**
  - One workspace holds several independent, self-contained projects under `src/`.
  - Each project has its own toolchain, tests and CI workflows.
  - The agent selects a project explicitly, and every response reports the scope it acted on.
- **Safe and verifiable changes.**
  - Every write is previewed with a dry run and guarded by a revision check.
  - Responses are a single machine-readable JSON envelope with stable error codes and actionable hints.
  - Output can be checked deterministically. Drift checks, structural validation and link integrity let an agent prove a change instead of asserting it.
- **An interconnected knowledge graph.**
  - Documentation, design, specifications, backlog items and code link to each other through wikilinks and frontmatter properties.
  - The Forge maintains that graph automatically: it indexes links, rewrites them on rename and refuses deletions that would break them. It also exposes backlinks and unresolved references so the graph can be verified.
- **Design to production for web user interfaces.**
  - A web UI goes from concept to prototype to production through declarative, deterministic definitions.
  - Those definitions generate components, interactions, stories, forms and data adapters for the major web frameworks.
  - The generated output stays ordinary project code that the agent and the user continue to evolve.
- **Reliably high-quality projects.**
  - Bundled agent skills, acceptance-first workflows and enforced quality gates.
  - Explicit project context, so an AI agent produces work a team can trust and review.

## Extensibility: a small core and plugins

The application is a small core with plugins on top:
- The core keeps the CLI shell, configuration, project scope, guarded vault operations, the metadata index, the event bus and the plugin host.
- Features are delivered as **core plugins**. They are bundled and enabled by default, and can be disabled, much like Obsidian's core plugins.
- Users and their agents add capabilities as their own plugins, through the same contract.

A plugin bundles everything an agent needs to use a capability well:
- commands with machine-readable contracts;
- events;
- configuration;
- localized guidance;
- skills;
- documentation.

The Forge emits the same vault and metadata events as Obsidian, and plugins can use an Obsidian-shaped API.

## Where it stands

The vision is delivered incrementally; the installed executable's `schema` and `help` remain the authority on what exists. The first iteration shipped:

- **A small core with core plugins:** every feature beyond the kernel is a bundled core plugin on the versioned plugin contract, enabled by default and disabled with `plugins.disabled`. See [plugins](../reference/plugins.md).
- **Obsidian event parity:** the host emits Obsidian-style `vault.*`, `metadataCache.*` and `workspace.*` events, and plugins use an Obsidian-shaped `app` facade.
- **Backlog management** compatible with the [backlog-view](https://github.com/Luis85/backlog-view) Obsidian plugin. See [backlog](../reference/backlog.md).
- **Backlog connectors:** two-way sync of base views with Azure DevOps Boards, with explicit conflicts. See [connectors](../reference/connectors.md).
- **Agent definitions** authored as [docker-agent](https://github.com/docker/docker-agent) compatible YAML, from which Claude Code agents are generated and drift-checked. See [agents](../reference/agents.md).
- **Vault knowledge tools:** search, link reports and vault checks over the metadata cache.
- **The showcase project,** which exercises the capabilities together, regenerated deterministically and checked for drift. See [explore the showcase](../how-to/explore-the-showcase.md).

## Direction

The next capabilities extend the same principles. They are planned and not part of the installed version:

- **More backlog connectors:** GitHub and Jira after Azure DevOps.
- **Complete localization:** every message an agent acts on in the response language; see the known gaps in [CLI language](../reference/language.md#known-gaps).

See the [architecture](architecture.md) for how the current boundaries realize these principles.
