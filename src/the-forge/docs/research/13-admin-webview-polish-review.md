# Developer admin polishing review

Reviewed on 2026-10-11 against PR #20 (`d51bf21`), building on the agent-first CLI pass in PR #19. This pass refines the existing localhost server and read-only Vue/Nuxt UI application; it adds no commands, configuration editor, remote access, or new product surface.

## Method and scope

Six parallel reviews covered process lifecycle and snapshot accuracy; HTTP/static transport; frontend interaction and accessibility; real browser workflows; distribution and attribution; and CLI contracts/documentation. A separate finish reviewer checked the combined changes. The baseline six Playwright scenarios passed, and committed desktop/mobile screenshots provided the visual baseline. Additional browser cases reproduced fresh-link recovery and touch-size failures before the fixes.

The retained product goal is quick, trustworthy inspection of the agent's workspace context, available capabilities and runtime state. The CLI owns lifecycle and mutations. The core remains independent of Vue and of a specific webview. Independent projects share the portable executable and public HTTP contract, not sibling source or dependencies.

## Findings closed

| Perspective | Observed gap | Result |
| --- | --- | --- |
| User recovery | A fresh access fragment opened in the same tab was ignored after initial mount; an older in-flight unauthorized response could invalidate the replacement session. | Fresh links are consumed after mount, obsolete requests cannot overwrite the new session, expired sessions stop polling, and stalled body reads report disconnection. |
| Trustworthy state | Malformed successful discovery responses could masquerade as empty inventory; CLI warnings were dropped. The browser accepted invalid counts, ports and timestamps. | Each inspection response is validated before marking its section available; safe diagnostic summaries preserve successful data without exposing raw plugin messages. The frontend rejects invalid numeric/date fields and retains the last good snapshot. |
| Accessibility and mobile | Primary mobile controls were below 44px; keyboard coverage bypassed the actual tab order. Long metadata could overflow. | Primary mobile controls have larger hit areas, real keyboard navigation is exercised, and long plugin/project metadata wraps. Disabled-plugin explanations use neutral styling, with error styling reserved for failures. |
| Agent discovery | Stopped server status hid the installed webview catalog despite the documented discovery contract. Lifecycle schema omitted guaranteed `changed` semantics. | Status lists installed views without starting a server or writing state; lifecycle outputs and field descriptions are explicit. Help explains port reuse and view-specific launch links. |
| Runtime reliability | Named pipes or other special files in private state or optional manifests could block reads. Existing Git ignore negations could expose newly created token state. | Non-regular files are refused before use, state reads defend against replacement races, invalid optional manifests are skipped, and private-state ignore rules remain effective after prior negations. |
| HTTP and asset updates | Ambiguous separators and platform-specific path aliases were accepted; manifest exclusion was case-sensitive. Filename heuristics could cache replaced scripts for a year. | Invalid path aliases are refused, manifest exclusion is case-insensitive, and scripts/styles revalidate while HTML remains uncached. |
| Distribution and maintenance | Publication/check could read through linked directories before refusal; invalid manifests were insufficiently checked. Attribution could stop at nested type-only metadata or silently omit license text. | Preflight verifies distribution boundaries and manifests before access/replacement. Attribution resolves the actual project/package roots and fails when required license notices are absent. Regression coverage includes rollback and deterministic notices. |

## Verification

The core quality/build/test gate passed 2,613 tests across 247 files. The admin application passed type checking, build, 42 unit/packaging tests and 11 Playwright scenarios. Distribution drift, showcase drift, generated workflow synchronization and whitespace checks passed. The showcase follow-up changes only its generated README; its independent 27-test gate passed in the preceding implementation pass.

Browser tests use the real CLI-managed server in disposable workspaces. They exercise fresh-link recovery, blocked storage, malformed responses, polling, real keyboard navigation, stale snapshots, 320px wrapping and a click at the edge of the actual 44px switch label. Final desktop (1440px) and mobile (390px) screenshots are committed under `src/forge-admin/docs/screenshots/`, linked in PR #20, and independently visually reviewed.

Local validation ran on Linux with Node 24.19.0 and installed Chromium 151 because browser downloads were unavailable. Other configured platform/Node combinations remain CI coverage.

## Boundaries retained

The view is read-only. Installed plugins and webview code remain trusted local code. The service binds only to IPv4 loopback, and authenticated API access remains separate from public static assets. Inspection is a cached snapshot rather than an event stream; the UI labels unavailable and stale data. A running process keeps its original port and view mounts until restarted. No product usage data or user interviews informed this pass; the findings are reproducible behavior and code review evidence.
