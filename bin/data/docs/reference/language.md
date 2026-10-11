# CLI language

[Documentation](../index.md) · Reference

The CLI supports English (`en`, the default) and German (`de`). Select a language for one invocation:

```sh
node bin/forge.js --lang de help
node bin/forge.js help make --lang de
node bin/forge.js --lang en schema --json
```

For a persistent workspace preference, set `settings.language` in `bin/config.json`:

```json
{"settings":{"language":"de"}}
```

Missing settings use English. The explicit `--lang` option overrides the configuration. `config` reports effective settings, including this override; `setup --lang de` writes German as the preference when it creates a missing configuration. Neither command updates an existing configuration. Unsupported values fail with `INVALID_LANGUAGE` for the flag or `INVALID_CONFIG` for configuration. A flag does not bypass invalid configuration: correct the file before retrying.

## Localization policy

One rule decides what changes with the language: **every text a person or an agent reads to decide what to do next is localized; every value a script matches on stays stable.**

Localized, in the response language:

| What | Where it appears |
| --- | --- |
| Command, action and generator descriptions | `help`, `schema` (`description`, `annotations.actions`, the `inputSchema` branch descriptions), `make` |
| Option, argument and global option descriptions | `help`, `schema` (`options`, `args`, `annotations.actions.*.options`, `globalOptions` and the `inputSchema` property descriptions) |
| Event descriptions and the delivery explanation | `events`, `schema` (`eventOutput`) |
| Format and setup guidance, empty-library guidance | `formats`, `setup` (`nextSteps[].purpose`), library commands (`nextStep`) |
| Error summaries and hints | `error.message`, `error.hint`, `schema` (`data.errors[].summary`) |
| Host warnings | `warnings`, such as the `plugins.disabled`, `plugins.settings`, missing-plugin and setup warnings, failed listeners after a committed write, a metadata cache that could not be saved, a stale write or sync lock that was removed, and a lock that could not be released cleanly |
| Plugin names, descriptions and state reasons | `plugins` (`name`, `description`, `reason`) |
| Settings descriptions | `config` (`data.sections[].schema`) |
| Result findings and problems that carry a `code` | `vault check` findings and hints, `backlog check` problems, Bases index warnings (`bases query`, `backlog check`), the mapping diagnostics of `agents` (`diagnostics[].message` of `generate`, `import`, `inspect` and `validate`), connection warnings and the platform description (`connectors list`, `connectors inspect`), the skip reasons and the Forge's own failure messages of `backlog sync` (`views[].skipped[].reason`, `views[].failed[].message`), and the check diagnostics, limitations, notes and capability descriptions of `claude`; also where a failure carries them in `error.details` (`vault check --strict`, `agents`) |

Stable in both languages: command names, actions, option flags, argument names, `usage` strings, ids, paths, error codes, finding and problem codes, status and enum values, exit codes, JSON keys, the envelope and the structure of every schema, the `title` of `inputSchema` branches (`skills install`), the descriptions inside `outputSchema` and `envelope` (the developer contract), event ids and payloads, and the content of generated code, fixture data, definitions, Markdown documents and templates. Error details otherwise stay as raised: `error.details` keeps its structured fields, and the original diagnostic of a localized error moves to `error.details.localization.originalMessage`, including precise paths, invalid fields and third-party parser messages. Validation issues and third-party diagnostics stay in their original language: the issue lists in `error.details.issues` (configuration, settings and definition validation), a YAML parser's message inside a localized sentence, output of the Claude Code CLI, the diagnostic of a remote failure in `backlog sync` (`failed[].message` with the failure's own code), and the semantic diagnostics of docker-agent definitions, which reproduce docker-agent's own validation messages. If an error already contains a `localization` detail, its value is retained as `error.details.localization.originalDetails`. English retains the original message and detail shape. Scripts should match codes and structured details rather than translated text.

The documentation (`docs/`, also packaged as `bin/data/docs`) and the authored agent skills (`skills/`, installed by `skills install` and `setup`) are English only by design: they are long-lived reference material for agents and maintainers, and a single language keeps them consistent with the stable command names and codes they cite.

## How texts are translated

Kernel catalogs live in `src/presentation/localization/`: command, action, event and guidance descriptions (`catalog.ts`), error summaries and hints by code (`errors.ts`), option, argument and global option descriptions by their English text (`descriptions.ts`), and the host's warnings and plugin state reasons by stable code (`messages.ts`, over the English templates in `src/domain/shared/kernel-messages.ts`). Kernel code, adapters included, never emits warning text: it records a coded message, and the response renders every warning in its language. This one catalog covers configuration, plugin, setup, lock, metadata cache and post-commit warnings alike. Every bundled core plugin contributes its own strings: its manifest name and description, its command, action, generator and event descriptions, its option, argument and settings descriptions, its error codes and its result messages; see [strings and error codes](plugins.md#strings-and-error-codes). The test `tests/cli/localization-parity.integration.test.ts` fails when any of these declared texts lacks a German translation.

User plugins localize the same way through their `strings` (`en`, `de`). Plugin text without a German entry, unregistered plugin error codes and the warnings a plugin sends with `context.events.warn` stay in the plugin's language; a plugin renders its warnings and results in `context.language` itself, for example with `context.t(key)`. Built-in error codes raised by plugins receive the same translated summary while retaining their original diagnostic.

## Known gaps

These texts are not yet localized and remain English with `--lang de`:

- A finding whose parameter is itself a sentence fragment containing a space-separated value (for example an `agents` permission pattern with spaces) may keep that fragment in English: the presentation recognizes coded findings by matching their English templates.

## Errors during discovery

The CLI establishes a language after successfully parsing global prefix options, then reads configuration, then parses the command. Put `--lang de` before the command when German guidance is needed for command-discovery or argument-parsing errors. A language placed after the command applies once command parsing succeeds. A malformed global prefix fails before language selection and uses English. Invalid configuration can be diagnosed in German with a valid prefix `--lang de`; configuration validation still fails normally.

Locale selection does not consult operating-system locale variables, so invocations remain reproducible across machines.
