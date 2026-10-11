# Security, safety and trust

[Research index](README.md) · Researched 2026-10-10

## Summary

- The main threat is an agent misled by instructions in a vault note, template, skill or plugin, using Forge's legitimate commands. Prompt injection is still OWASP's top risk and has no reliable fix. Forge should limit what a misled agent can do, not try to detect the injection.
- Forge's file-integrity core is strong: SHA-256 `--if-match` guards that are checked again just before rename, path containment, symlink rejection, an `O_EXCL` lock, dry runs, and a rollback that won't overwrite newer edits. The gaps are durability (no fsync), an empty lock file, and no record of what changed.
- Claude hooks, `env`, `apiKeyHelper`, enabled plugins and marketplaces are code-execution configuration. Claude Code reloads them in the middle of a session, and public CVEs show repository-controlled Claude config used for RCE and API-key theft. Forge gates these writes like ordinary Markdown edits.
- The skill and plugin supply chain is under active attack. Snyk found 76 confirmed malicious payloads in 3,984 skills, and the ClawHavoc campaign reached more than 1,100 malicious skills. Forge enables plugins by ID without content pinning, so a plugin can change after review.
- No sandbox fits Node in-process plugins. The Node permission model is officially a "seat belt", and Obsidian, Backstage and Raycast all run plugins unsandboxed. Pinning, review and audit records are worth more now than a sandbox.
- Distribution is the weakest link. Users install with `curl` from the `main` branch, with no signature, attestation or SBOM. GitHub attestations (SLSA Build L2 or L3) and a CycloneDX SBOM are cheap to add.
- Recommended differentiators: a policy file, an append-only audit log, an undo journal, and verifiable signed releases.

## Method

I read the brief, the plugin, CLI write-contract and Claude reference docs, `src/the-forge/infrastructure/workspace/files.ts`, the CI workflow and `scripts/release.mjs`. I then reviewed primary sources (OWASP, Node.js, Claude Code, MCP, GitHub, npm, SLSA, Sigstore, CISA, vendor research) and labeled secondary or unverified ones. No penetration testing was done.

## Threat model sketch

**Assets**

- Project and vault files.
- Claude Code configuration at every scope. A user-scope hook means code execution in every session.
- Credentials in settings `env`, `apiKeyHelper`, hook headers or plugin configuration.
- The `bin/` distribution and enabled plugins.
- Agent instructions (skills, `AGENTS.md`, templates): an instruction supply chain.

**Actors**

- A prompt-injected agent driving Forge on the user's behalf. This is the most likely actor.
- A malicious or compromised plugin, skill or marketplace author.
- A compromised upstream dependency bundled at build time.
- A compromised maintainer account or release channel.
- Benign concurrent writers: Obsidian, sync clients, editors.

Local malware running as the same user is out of scope. Forge already says it is not a multi-tenant sandbox.

**Entry points**

- Note, template and component content returned by `read` and acted on by an agent.
- Plugin modules in `bin/plugins`, whose top-level code runs even for discovery commands, and plugin skills installed into `.agents/skills`.
- `claude` hook, agent, plugin and marketplace mutations, and the native `claude` subprocess.
- The install path (`curl …/heads/main.tar.gz`) and `bin/config.json`.

In "lethal trifecta" terms ([Willison](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/)), Forge hands the agent private data and the ability to change state. It can also create outbound channels: `http` hooks with `allowedEnvVars`, `marketplaces add`, and eval report publishing. Vault content provides the untrusted input.

## Findings

### Agent and prompt-injection risk

- OWASP's 2025 LLM Top 10 keeps prompt injection at LLM01, including indirect injection through files humans cannot see. It recommends least privilege, human approval, segregating external content and deterministic output checks, and calls no method "fully foolproof" ([OWASP LLM01](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)). Excessive Agency is LLM06 ([Invicti](https://www.invicti.com/blog/web-security/owasp-top-10-risks-llm-security-2025), secondary).
- The OWASP Agentic Top 10 2026 (published 9 December 2025, [OWASP](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/)) includes ASI02 Tool Misuse, ASI04 Agentic Supply Chain, ASI05 Unexpected Code Execution and ASI06 Memory & Context Poisoning ([Cycode](https://cycode.com/blog/owasp-top-10-agentic-applications/)). These map onto Forge's write, plugin, hook and skill surfaces.
- Meta's "Agents Rule of Two" (October 2025): a session should combine at most two of untrusted input, sensitive data, and state change or external communication; otherwise a human supervises ([Meta AI](https://ai.meta.com/blog/practical-ai-agent-security/)). Willison calls "95%" guardrail detection a failing grade ([Willison](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/)).
- **Tool poisoning.** Hidden instructions in tool descriptions, rug pulls and shadowing were demonstrated in April 2025. Mitigations: show full descriptions, pin versions, verify by hash ([Invariant Labs](https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks)).
- **Local server consent.** MCP clients must show "the exact command that will be executed, without truncation" and flag dangerous patterns ([MCP spec](https://modelcontextprotocol.io/specification/2025-06-18/basic/security_best_practices)). Forge-written Claude hooks have the same shape.
- **Hidden text.** The "Rules File Backdoor" hid instructions in rule files with invisible Unicode, and GitHub now warns on hidden Unicode ([The Hacker News](https://thehackernews.com/2025/03/new-rules-file-backdoor-attack-lets.html), secondary, not fetched). This applies to SKILL.md, templates and notes.

### Claude Code configuration as an execution layer

- Check Point (February 2026) showed repository `.claude/settings.json` hooks, `.mcp.json` auto-approval (CVE-2025-59536) and `ANTHROPIC_BASE_URL` (CVE-2026-21852) running code or leaking API keys before consent. Such files "should get the same review as source code" ([Check Point](https://research.checkpoint.com/2026/rce-and-api-token-exfiltration-through-claude-code-project-files-cve-2025-59536/)). A further bypass, CVE-2026-40068, is unverified ([NVD](https://nvd.nist.gov/vuln/detail/cve-2026-40068) did not render).
- Claude Code reloads `permissions`, `hooks` and `apiKeyHelper` mid-session, so Forge settings writes take effect immediately ([Claude settings](https://code.claude.com/docs/en/settings)). Failing hooks let actions through unless `"onFailure": "block"` is set ([Claude hooks](https://code.claude.com/docs/en/hooks)).
- A Claude plugin "can execute arbitrary code on your machine with your user privileges", outside the sandbox. With auto-update, "the files you reviewed can change on disk". A mismatched `sha256` archive pin is refused ([Claude plugin security](https://code.claude.com/docs/en/plugins/security)). From a shell, `install --marketplace` adds a marketplace without confirmation ([discover plugins](https://code.claude.com/docs/en/discover-plugins)).

### Skill and plugin supply chain

- Snyk's ToxicSkills (February 2026): of 3,984 skills, 13.4% had critical issues and 76 had confirmed malicious payloads, 91% of them using prompt injection ([Snyk](https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/)). One fake-installer skill reached 7,743 downloads ([Snyk advisory](https://snyk.io/articles/clawdhub-malicious-campaign-ai-agent-skills)).
- CSA counts 1,184 malicious ClawHub skills (February–May 2026); scanners missed payload-less semantic attacks. It recommends signing, pinning and re-review on every change ([CSA](https://labs.cloudsecurityalliance.org/research/csa-research-note-ai-skill-supply-chain-attacks-20260624-csa/)).
- Shai-Hulud compromised 500+ npm packages in September 2025 via stolen tokens. CISA advised pinning, credential rotation and phishing-resistant MFA ([CISA](https://www.cisa.gov/news-events/alerts/2025/09/23/widespread-supply-chain-compromise-impacting-npm-ecosystem)); GitHub moved to short-lived tokens and trusted publishing ([GitHub](https://github.blog/security/supply-chain-security/our-plan-for-a-more-secure-npm-supply-chain/)). For Forge, a single bundle avoids install-time attacks but ships a compromised build-time dependency silently unless lockfile changes are reviewed and an SBOM is published.

### Plugin sandboxing options (Node, 2025–2026)

| Option | Status and fit |
| --- | --- |
| Node permission model (`--permission`, `--allow-fs-*`, `--allow-child-process`, `--allow-worker`) | Stable since v22.13/v23.5. Officially a "seat belt" that "does not provide security guarantees in the presence of malicious code". It follows symlinks out of granted paths, and file descriptors bypass it ([Node docs](https://nodejs.org/api/permissions.html)). `--allow-net` arrived in v25 and had a CVSS 10 Unix-socket bypass ([CVE-2026-21636](https://guide.sonatype.com/vulnerability/CVE-2026-21636)). Forge's floor of 22.12 is just below the stable release. |
| `node:vm` | "Not a security mechanism. Do not use it to run untrusted code" ([Node vm](https://nodejs.org/api/vm.html)). |
| isolated-vm | In maintenance mode, and the project advises running it in a separate process ([isolated-vm](https://github.com/laverdet/isolated-vm)). Needs native builds, which conflicts with Forge's no-install promise. |
| QuickJS/Wasm (Extism JS PDK) | Strong isolation, but "no event loop, no I/O", no Node APIs and ES2020 only ([extism/js-pdk](https://github.com/extism/js-pdk)). Would break the existing plugin contract. |
| Hardened JS / SES, LavaMoat | Lockdown and Compartments. Used by MetaMask Snaps. Does not protect availability ([hardenedjs.org](https://hardenedjs.org/), [LavaMoat](https://lavamoat.github.io/)). Requires plugins to be written for it. |
| Deno permissions | A model for flag design: deny overrides allow, and `--allow-run`/`--allow-ffi` are treated as equal to allow-all ([Deno](https://docs.deno.com/runtime/fundamentals/security/)). |

What other hosts do: Obsidian has no sandbox; it relies on restricted mode by default, automated scanning and manual review ([Obsidian](https://obsidian.md/help/plugin-security)). VS Code Workspace Trust "can't stop a malicious extension" ([VS Code](https://code.visualstudio.com/docs/editing/workspaces/workspace-trust)). Raycast uses per-extension isolates behind RPC but is "not further sandboxed" for file and network access ([Raycast](https://developers.raycast.com/information/security)). Backstage does not sandbox plugins ([threat model](https://backstage.io/docs/overview/threat-model), search summary). Figma is the exception: it runs a Wasm-compiled JS VM after a Realms-shim escape ([Figma](https://www.figma.com/blog/how-we-built-the-figma-plugin-system/)).

### Release integrity

- GitHub artifact attestations give SLSA v1.0 Build L2, and Build L3 when built in a reusable workflow. GitHub stresses that generating attestations is useless unless consumers run `gh attestation verify` ([GitHub docs](https://docs.github.com/en/actions/concepts/security/artifact-attestations), [SLSA levels](https://slsa.dev/spec/v1.0/levels)).
- Cosign `sign-blob --bundle` signs tarballs keylessly and records them in Rekor ([Sigstore](https://docs.sigstore.dev/cosign/signing/signing_with_blobs/)).
- npm provenance requires GitHub Actions or GitLab and is verified with `npm audit signatures`. It does not prove the code is benign ([npm](https://docs.npmjs.com/generating-provenance-statements)).
- `npm sbom` emits CycloneDX or SPDX ([npm sbom](https://docs.npmjs.com/cli/v11/commands/npm-sbom), [CycloneDX](https://cyclonedx.org/capabilities/sbom/)).
- Reproducible builds means any party can produce "bit-by-bit identical copies" ([reproducible-builds.org](https://reproducible-builds.org/docs/definition/)).

### Filesystem safety

- **Crash consistency.** Temp-file-plus-rename is not atomic across a crash unless the file and its parent directory are fsynced. Pillai et al. found crash-consistency bugs in most applications they tested, including git ([Dan Luu](https://danluu.com/file-consistency/)). npm's `write-file-atomic` fsyncs by default and serializes concurrent writes to the same file ([write-file-atomic](https://github.com/npm/write-file-atomic)).
- **Check-then-use races.** Node advises against checking before opening because of race conditions ([Node fs](https://nodejs.org/api/fs.html)). Node has no `openat`-style API for operating relative to a directory handle. Symlink races are a real bug class: node-tar's cached-directory check allowed arbitrary file overwrite (CVE-2021-32803, [GHSA-r628-mhmh-qjhw](https://github.com/advisories/GHSA-r628-mhmh-qjhw)).
- **Policy-as-code.** The emerging pattern is a decision point before every tool call: default deny, and a forbid rule beats a permit (vendor and community sources: [tianpan.co](https://tianpan.co/blog/2026-04-25-policy-as-code-agent-permissions-opa-rego); not fetched directly).

## Assessment of The Forge

### Strengths

- **Optimistic concurrency.** Every overwrite or removal needs `--if-match`, even for identical bytes. The revision is rechecked inside `replace()` just before `rename`, and rollback never overwrites newer external edits.
- **Containment.** The root is resolved with `realpath`. Traversal, absolute paths, backslashes, control characters and `.git` are rejected, and every component is checked with `lstat` to reject symlinks.
- **Safe primitives.** Temp files and the lock use `O_EXCL`, and file modes are preserved. Every mutation has a dry run.
- **Careful subprocess handling.** Claude execution uses no shell, bounds output and time, kills the process group, redacts `--config`/`sensitiveArgs` and sends secrets through stdin.
- **Honest plugin trust.** Plugins are enabled only by explicit ID, symlinked modules are rejected and `--no-plugins` exists. The docs admit plugins can bypass guards.
- **CI hygiene.** CI runs with `contents: read`, rebuilds and diffs `bin/` (a reproducibility check), and emits a `.sha256`.

### Gaps

1. **No durability.** `replace()` never fsyncs the file or parent directory, so after power loss a "committed" file can be empty or stale.
2. **Weak recovery.** The lock file records no owner (PID, host, time), and no intent journal exists to recover an interrupted batch.
3. **No hash pinning for plugins or skills.** Once an ID is enabled, any later change to its files runs without review. Plugin skills flow into `.agents/skills` without provenance.
4. **Execution-bearing writes are gated like ordinary edits.** `claude hooks set/add`, user-scope settings, `marketplaces add`, and `plugins install --yes` need only a revision. An injected agent can therefore create persistent RCE or an outbound channel.
5. **Secrets can leak through reads.** `claude hooks inspect` returns the whole settings document, so `env`, `apiKeyHelper` or header values would reach agent transcripts unredacted (inferred from docs, not tested).
6. **No signals about untrusted content.** `read` and `validate` do not flag hidden or bidirectional Unicode. The vault skill does not tell agents to treat note content as data rather than instructions.
7. **Unverified install path.** Users install from the moving `main` branch. Releases have no signature, attestation or SBOM. GitHub Actions are pinned by tag, not by commit SHA.
8. **No persistent record of agent actions.** The event bus lasts only for one invocation.
9. **Small check-then-use windows.** A hostile process could swap a component between `lstat`, `verify` and `rename`. The docs acknowledge this, and it is acceptable for a non-hostile local scope.

## Recommendations

| ID | Recommendation | Priority | Effort | Rationale and evidence |
| --- | --- | --- | --- | --- |
| ST-1 | Make writes durable: fsync the temp file before `rename`, then fsync the parent directory, and do the same on rollback. Write lock metadata (pid, hostname, start time, command, operationId) into `.agent-cli.lock`. Add `lock status`, which reports a stale lock but never deletes it automatically. | P0 | S | Gaps 1–2. Rename is not crash-atomic without fsync ([Dan Luu](https://danluu.com/file-consistency/)). `write-file-atomic` fsyncs by default ([npm](https://github.com/npm/write-file-atomic)). |
| ST-2 | Treat execution-bearing changes as a separate risk class. This covers hooks, `env`, `apiKeyHelper`, `permissions`, `enabledPlugins`, MCP servers, marketplaces, plugin install/enable and user scope. They should require an explicit flag (e.g. `--allow-exec-config`) or a policy permit. Dry runs should show the full, untruncated commands, URLs and env-var names, plus `warnings` for network or `sudo` patterns. | P0 | S | Gap 4. Check Point CVEs ([Check Point](https://research.checkpoint.com/2026/rce-and-api-token-exfiltration-through-claude-code-project-files-cve-2025-59536/)). Settings reload in-session ([Claude settings](https://code.claude.com/docs/en/settings)). The MCP spec requires showing the exact command ([MCP](https://modelcontextprotocol.io/specification/2025-06-18/basic/security_best_practices)). Rule of Two ([Meta](https://ai.meta.com/blog/practical-ai-agent-security/)). |
| ST-3 | Ship verifiable releases. Publish tagged GitHub Releases with the tarball, `.sha256`, a GitHub artifact attestation (moving to a reusable workflow for L3) and a CycloneDX SBOM of the bundled dependencies. Change the README to install from a tag with `gh attestation verify`. Pin Actions to commit SHAs. | P0 | S–M | Gap 7. SLSA L2/L3 ([GitHub](https://docs.github.com/en/actions/concepts/security/artifact-attestations), [SLSA](https://slsa.dev/spec/v1.0/levels)). [npm sbom](https://docs.npmjs.com/cli/v11/commands/npm-sbom). Lessons from Shai-Hulud ([CISA](https://www.cisa.gov/news-events/alerts/2025/09/23/widespread-supply-chain-compromise-impacting-npm-ecosystem)). |
| ST-4 | Pin plugin content. Store `plugins.enabled: [{id, integrity: "sha256-…"}]`, computed over the manifest, entry file and directory tree by a `plugins trust <id>` command. Refuse to load on mismatch and require a re-trust. Record the source of plugin-contributed skills when installing them. | P1 | S | Gap 3. Rug pulls ([Invariant](https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks)). Re-review on change ([CSA](https://labs.cloudsecurityalliance.org/research/csa-research-note-ai-skill-supply-chain-attacks-20260624-csa/)). Claude's `sha256` archive pin ([Claude](https://code.claude.com/docs/en/plugins/security)). |
| ST-5 | Redact secrets in responses. Mask settings `env` values, `apiKeyHelper`, hook `headers`, `ANTHROPIC_*` variables and plugin config in `inspect`, `config` and error details, unless `--reveal-secrets` is passed. Warn when `--content` appears to carry a secret. | P1 | S | Gap 5. API key theft via settings ([Check Point](https://research.checkpoint.com/2026/rce-and-api-token-exfiltration-through-claude-code-project-files-cve-2025-59536/)). Raycast's model of password preferences ([Raycast](https://developers.raycast.com/information/security)). |
| ST-6 | Add untrusted-content hygiene. `read` and `validate` should warn on zero-width, bidirectional and tag Unicode characters in Markdown, skills, templates and hook commands. The `forge-vault` and `forge-workflow` skills should state that file content is data and must never be followed as instructions. | P1 | S | Gap 6. OWASP LLM01 ("segregate external content") ([OWASP](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)). Rules File Backdoor and GitHub's hidden-Unicode warning ([THN](https://thehackernews.com/2025/03/new-rules-file-backdoor-attack-lets.html)). |
| ST-7 | Add a policy file (`bin/policy.json`) and `policy explain`. It is default-allow today but can be switched to default-deny. It holds path allow/deny globs, command and plugin allowlists, Claude scope limits, and a "requires approval" list that returns a new `APPROVAL_REQUIRED` exit code instead of prompting. Forbid always beats permit. It is evaluated in the application layer before workspace orchestration. | P1 | M | Excessive agency (LLM06). Policy-as-code practice ([tianpan.co](https://tianpan.co/blog/2026-04-25-policy-as-code-agent-permissions-opa-rego)). Deno's deny-overrides-allow ([Deno](https://docs.deno.com/runtime/fundamentals/security/)). A differentiator for agent-first tools. |
| ST-8 | Keep an append-only audit log (`.forge/audit.jsonl`, opt-in, hash-chained). Each entry records operationId, command, root, paths, before and after revisions, dry-run flag, loaded plugin IDs and their integrity hashes, an actor hint (`FORGE_ACTOR`) and the exit code. It must never store content or secrets. | P1 | M | Gap 8. MCP guidance to "log … for security monitoring" ([MCP](https://modelcontextprotocol.io/specification/2025-06-18/basic/security_best_practices)). CSA monitoring advice. Forge's own docs disclaim audit use today. |
| ST-9 | Keep an undo and recovery journal. Before committing a batch, write an intent record plus pre-image bytes under `.forge/journal/<opId>/`, fsynced. `undo <opId>` restores the pre-images only if the current revisions still match the post-images. `recover` rolls an interrupted batch back. Use bounded retention. | P1 | M–L | Gaps 1–2. The undo-log protocol ([Dan Luu](https://danluu.com/file-consistency/)). Turns "not crash-atomic" into "recoverable". A strong trust feature for agent edits. |
| ST-10 | Publish `SECURITY.md` with a disclosure contact and a threat-model page that states the trust boundaries above. | P1 | S | A trust signal with no cost. Obsidian and Backstage publish their models ([Obsidian](https://obsidian.md/help/plugin-security)). |
| ST-11 | Make the release tarball reproducible (sorted entries, fixed mtimes, `gzip -n`) and document how to rebuild and compare it. | P2 | S | Extends the existing `git diff -- bin` check ([reproducible-builds.org](https://reproducible-builds.org/docs/definition/)). |
| ST-12 | Offer an optional plugin "seat belt": run plugin commands in a child Node process started with `--permission --allow-fs-read=<root>`, with no write, child-process or worker access, and route writes over RPC to the workspace port. Label it as a seat belt, not a sandbox. | P2 | L | Caveats in the [Node docs](https://nodejs.org/api/permissions.html). Raycast's isolate-plus-RPC model ([Raycast](https://developers.raycast.com/information/security)). Requires raising the Node floor to 22.13 or later. |
| ST-13 | Narrow the check-then-use window. Open the final component with `O_NOFOLLOW` where supported, compare the `realpath` of the parent before rename, and test with hostile-swap fixtures. | P2 | M | Gap 9. The node-tar symlink CVE ([GHSA](https://github.com/advisories/GHSA-r628-mhmh-qjhw)). |

## What not to build

- **A home-grown JS sandbox** using `node:vm`, Realms or Proxies. Node says `vm` is not a security mechanism, and Figma's Realms shim was escaped ([Node vm](https://nodejs.org/api/vm.html), [Figma](https://www.figma.com/blog/how-we-built-the-figma-plugin-system/)).
- **An LLM-based prompt-injection detector,** or any claim to "block" injection. Partial detection gives false assurance ([Willison](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/), [OWASP](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)). Deterministic gates (ST-2, ST-7) are better.
- **A Wasm-only plugin runtime now.** Extism's JS PDK lacks Node APIs and an event loop, so it would break every existing plugin ([js-pdk](https://github.com/extism/js-pdk)).
- **A self-update command before signed releases exist.** It would turn the release channel into a remote-code path.
- **An MCP server before policy and audit exist.** It would expose execution-bearing commands to any connected agent.
- **Cloud telemetry as an audit trail.** A local JSONL log fits the no-telemetry stance.

## Open questions

1. Should the Node floor rise to 22.13 or later so the permission model is stable for ST-12?
2. Should ST-2 be a flag, a policy entry or both, and how does an agent request approval when Forge never prompts?
3. Should the audit log and journal be git-ignored or committed?
4. What does plugin "integrity" cover when plugins read data files at run time?
5. How do lock and rename behave on Windows and macOS, which CI does not cover?
6. Should Forge also publish to npm with trusted publishing to get provenance?

## Sources

- OWASP LLM01 Prompt Injection: https://genai.owasp.org/llmrisk/llm01-prompt-injection/
- OWASP Top 10 for Agentic Applications 2026: https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/
- Cycode, OWASP agentic summary: https://cycode.com/blog/owasp-top-10-agentic-applications/
- Invicti, OWASP LLM 2025 summary (search result, not fetched): https://www.invicti.com/blog/web-security/owasp-top-10-risks-llm-security-2025
- Simon Willison, The lethal trifecta: https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/
- Meta, Agents Rule of Two: https://ai.meta.com/blog/practical-ai-agent-security/
- Invariant Labs, tool poisoning: https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks
- MCP security best practices: https://modelcontextprotocol.io/specification/2025-06-18/basic/security_best_practices
- Check Point Research, Claude Code project files: https://research.checkpoint.com/2026/rce-and-api-token-exfiltration-through-claude-code-project-files-cve-2025-59536/
- NVD CVE-2026-40068 (unverified; page did not render): https://nvd.nist.gov/vuln/detail/cve-2026-40068
- Claude Code settings: https://code.claude.com/docs/en/settings
- Claude Code hooks: https://code.claude.com/docs/en/hooks
- Claude Code plugin security: https://code.claude.com/docs/en/plugins/security
- Claude Code install and manage plugins: https://code.claude.com/docs/en/discover-plugins
- Snyk ToxicSkills: https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/
- Snyk ClawHub malicious skill advisory: https://snyk.io/articles/clawdhub-malicious-campaign-ai-agent-skills
- CSA, AI skill supply-chain attacks: https://labs.cloudsecurityalliance.org/research/csa-research-note-ai-skill-supply-chain-attacks-20260624-csa/
- The Hacker News, Rules File Backdoor (search result, not fetched): https://thehackernews.com/2025/03/new-rules-file-backdoor-attack-lets.html
- CISA, npm supply-chain compromise: https://www.cisa.gov/news-events/alerts/2025/09/23/widespread-supply-chain-compromise-impacting-npm-ecosystem
- GitHub, plan for a more secure npm: https://github.blog/security/supply-chain-security/our-plan-for-a-more-secure-npm-supply-chain/
- npm provenance: https://docs.npmjs.com/generating-provenance-statements
- npm sbom: https://docs.npmjs.com/cli/v11/commands/npm-sbom
- CycloneDX SBOM: https://cyclonedx.org/capabilities/sbom/
- GitHub artifact attestations: https://docs.github.com/en/actions/concepts/security/artifact-attestations
- SLSA v1.0 levels: https://slsa.dev/spec/v1.0/levels
- Sigstore cosign blobs: https://docs.sigstore.dev/cosign/signing/signing_with_blobs/
- Reproducible builds definition: https://reproducible-builds.org/docs/definition/
- Node.js permissions: https://nodejs.org/api/permissions.html
- CVE-2026-21636 (Sonatype): https://guide.sonatype.com/vulnerability/CVE-2026-21636
- Node.js vm: https://nodejs.org/api/vm.html
- Node.js fs: https://nodejs.org/api/fs.html
- isolated-vm: https://github.com/laverdet/isolated-vm
- Extism JS PDK: https://github.com/extism/js-pdk
- Hardened JS: https://hardenedjs.org/
- LavaMoat: https://lavamoat.github.io/
- Deno security: https://docs.deno.com/runtime/fundamentals/security/
- VS Code Workspace Trust: https://code.visualstudio.com/docs/editing/workspaces/workspace-trust
- Obsidian plugin security: https://obsidian.md/help/plugin-security
- Raycast security: https://developers.raycast.com/information/security
- Figma plugin system: https://www.figma.com/blog/how-we-built-the-figma-plugin-system/
- Backstage threat model (search summary, not fetched): https://backstage.io/docs/overview/threat-model
- Dan Luu, file consistency: https://danluu.com/file-consistency/
- write-file-atomic: https://github.com/npm/write-file-atomic
- node-tar advisory GHSA-r628-mhmh-qjhw: https://github.com/advisories/GHSA-r628-mhmh-qjhw
- Policy-as-code for agents (search result, not fetched): https://tianpan.co/blog/2026-04-25-policy-as-code-agent-permissions-opa-rego
