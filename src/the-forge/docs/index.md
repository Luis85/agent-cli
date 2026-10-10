# The Forge documentation

The Forge is a terminal project companion for AI-assisted project and product development. The user works in Obsidian; the agent uses this CLI to create, edit and verify the same vault from the terminal. The [product vision](explanation/product-vision.md) explains the goals. Start with the task you need to complete. These docs follow [Diátaxis](https://diataxis.fr/): tutorials teach through a concrete exercise, how-to guides solve a task, references define exact contracts, and explanations describe the reasoning behind the design.

## Tutorials — learn by doing

For first-time users and agents learning the workflow. Follow each tutorial in order; each has a concrete outcome.

| Tutorial | What you will build |
| --- | --- |
| [Getting started](tutorials/getting-started.md) | A workspace, managed project and safely created planning note |
| [Your first Markdown-defined UI](tutorials/first-ui.md) | A reusable surface component and composed dashboard generated from Markdown |
| [An interactive form](tutorials/interactive-form.md) | Component state, reusable event/action definitions and browser behavior |
| [From idea to production](tutorials/idea-to-production.md) | A worked path through discovery, requirements, design, implementation, testing and production readiness |

The [idea-to-production example pack](examples/idea-to-production/README.md) supplies editable stage artifacts, prompts and component definitions used by the longer tutorial.

## How-to guides — complete a task

For users who already know their goal. Each guide states the needed context and gives the relevant commands.

| Goal | Guide |
| --- | --- |
| Select a project and control file scope | [Set up and manage projects](how-to/manage-projects.md) |
| Change paths, transfer definitions or update generated UI | [Maintain and regenerate components](how-to/manage-components.md) |
| Add and maintain reusable browser behavior | [Manage interaction definitions](how-to/manage-interactions.md) |
| Generate editable discovery and delivery documents | [Use workflow templates](how-to/use-workflow-templates.md) |
| Define REST or local JSON sources and generate adapters | [Manage data sources](how-to/manage-data-sources.md) |
| Create and inspect a native HTML form | [Generate and preview forms](how-to/generate-forms.md) |
| Extend the CLI with trusted Node modules | [Enable or disable plugins](how-to/enable-plugins.md) |
| Maintain native Claude agents, hooks and plugin installations | [Manage Claude Code](how-to/manage-claude.md) |
| Keep agents as docker-agent YAML and generate Claude Code agents from them | [Manage agent definitions](how-to/manage-agents.md) |
| Plan, rank, track and release work in an Obsidian Product Backlog | [Plan and release work in a product backlog](how-to/manage-backlog.md) |
| Keep backlog notes and Azure DevOps Boards work items in sync | [Sync a backlog with Azure DevOps](how-to/sync-backlog-with-azure-devops.md) |
| Browse the committed example project, regenerate it and check drift | [Explore the showcase](how-to/explore-the-showcase.md) |
| Diagnose checks and deliver a verified repository change | [Develop and test](how-to/develop-and-test.md) |
| Package or upgrade the portable executable | [Build a release](how-to/release.md) |

## Reference — look up the contract

For developers integrating the CLI, agents checking an option, and authors writing definitions or plugins. These pages specify formats, API behavior and supported boundaries.

| Reference | Contents |
| --- | --- |
| [CLI and agent protocol](reference/cli.md) | Commands, arguments, JSON responses, errors and writes |
| [Error catalog](reference/errors.md) | Every error code with its exit status, hint, retryability and recovery details |
| [CLI language](reference/language.md) | English/German selection, translated guidance and stable machine output |
| [Configuration](reference/configuration.md) | Defaults, precedence, paths and workspace/project scope |
| [Component definitions and targets](reference/ui-components.md) | YAML fields, composition, bindings, output artifacts and target dependencies |
| [Interactions](reference/interactions.md) | Events, ordered actions, component state and executable generated handlers |
| [Storybook](reference/storybook.md) | CSF generation, metadata and native extension modules |
| [Data sources](reference/data-sources.md) | Declarative source schemas, generated adapters and configuration |
| [Forms](reference/forms.md) | Typed form model, validation and HTML renderer APIs |
| [Markdown templates](reference/templates.md) | Variables, typed substitutions and date formatting |
| [Files and formats](reference/formats.md) | Markdown, Canvas, Bases and attachment guarantees |
| [Plugins and events](reference/plugins.md) | Manifests, contributions, lifecycle and delivery semantics |
| [Claude Code management](reference/claude.md) | Native agents, hooks, authored plugin assets and installed CLI operations |
| [Search](reference/search.md) | Literal and regular-expression search with path, kind, tag and property filters and paging |
| [Links](reference/links.md) | Outgoing links, backlinks, unresolved links, orphans and dead ends from the metadata index |
| [Agents](reference/agents.md) | docker-agent definitions: validation, diagnostics, creation, import, and the mapping to generated Claude Code agents |
| [Backlog](reference/backlog.md) | backlog-view compatible product backlogs: configuration, model, commands, refusals, sync and conformance |
| [Connectors](reference/connectors.md) | Connection profiles, the `connectors` command, the connector contract and the sync model |
| [Azure DevOps connector](reference/connector-azure-devops.md) | Azure DevOps Boards profiles, authentication, process mappings and the REST API it uses |
| [Bases queries](reference/bases.md) | Standalone native `.base` views as file repositories |
| [Workflows](reference/workflows.md) | Project-owned CI workflows, generated GitHub entrypoints and drift checks |

Run `node bin/forge.js schema --json` for the installed executable's command catalog, and `node bin/forge.js config --json` for its effective settings. The installed version is the authority for available commands.

## Explanation — understand the design

For contributors and teams deciding how to use The Forge within their architecture.

- [Product vision](explanation/product-vision.md): the terminal project companion, the two interfaces to one vault, the knowledge graph, core plugins and the roadmap.
- [Architecture and boundaries](explanation/architecture.md): domain/application ports, storage ownership, project scope and extension lifecycle.
- [Deterministic UI generation](explanation/deterministic-ui.md): why definitions are declarative, what reproducibility means, and where application code begins.
- [Product review](explanation/product-review.md): existing workflow findings, polishing changes, research and verification limits.

Repository contributors should also read `AGENTS.md` and the [development guide](how-to/develop-and-test.md). Agent operators can use the [Forge workflow skill](../skills/forge-workflow.md), [development skill](../skills/forge-development.md), [file-editing skill](../skills/forge-vault.md) and [agent definitions skill](../skills/forge-agents.md).
