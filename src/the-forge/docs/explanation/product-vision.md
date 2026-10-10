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

## Direction

The vision is delivered incrementally. The capabilities below are planned and may not yet be part of the installed version. The installed executable's `schema` and `help` remain the authority on what exists today.

- **Core plugins:** existing features move into self-contained core plugins on a versioned plugin contract.
- **Backlog management:** compatible with the [backlog-view](https://github.com/Luis85/backlog-view) Obsidian plugin.
- **Backlog connectors:** Azure DevOps Boards first, then GitHub and Jira. Base views define which items stay in two-way sync with each organization and project.
- **Agent definitions:** authored as [docker-agent](https://github.com/docker/docker-agent) compatible YAML, from which Claude Code agents are generated and drift-checked.
- **The showcase project:** demonstrates every capability, regenerated deterministically and checked for drift. See [explore the showcase](../how-to/explore-the-showcase.md).

See the [architecture](architecture.md) for how the current boundaries realize these principles.
