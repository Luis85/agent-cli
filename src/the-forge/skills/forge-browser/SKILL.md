---
name: forge-browser
description: Capture webpage evidence and create illustrated walkthroughs with Forge browser commands, then explain observations in guarded Markdown documents. Use when documenting a UI problem or situation, taking on-demand screenshots, or turning a reviewed flow into a screenshot tutorial from JSON, Markdown or Canvas.
license: MIT
compatibility: Requires Node.js 22.12 or newer, the complete Forge bin distribution and Chromium. Run browser status to inspect browser availability; browser install downloads the managed browser.
metadata:
  author: The Forge
  version: "0.1.0"
---

Screenshots are evidence for a document, not proof that a UI works. Guarded document edits follow the `forge-vault` skill.

## Prepare
- Identify the question, situation or flow the document should explain. Read AGENTS.md, check `project current` and `context.root`, and read `schema browser` for the exact options.
- Pass `--project <id>` to `screenshot`, `validate` and `tutorial` instead of changing the shared selection.
- `browser status` checks the selected executable without launching it, so `available: true` does not prove Chromium works. Read `reason` and `nextStep` when it is unavailable.
- Selection order: `--browser-executable <path>`, then `FORGE_BROWSER_EXECUTABLE`, then the managed Chromium. `browser install --dry-run`, then `browser install`, downloads the managed one.
- Every result reports `sandbox`: `enabled`, `disabled-root` (Linux as root) or `disabled-option`. Pass `--no-browser-sandbox` only on hosts that cannot sandbox, and only for trusted pages.

## One screenshot
- Preview `browser screenshot <url> --out docs/assets/problem.png --project <id> --dry-run`, then run it with the same options. A dry run never launches a browser or visits the URL.
- Add `--full-page` for the whole page and `--wait-for-selector <selector>` when a known element signals readiness.
- Each capture uses a fresh browser context without saved logins or cookies. Never put credentials in URLs.
- Replacing an existing image needs its current revision from `read` as `--if-match`, in the preview and the capture.
- Open the saved image and check it shows the intended state, not a login, error, consent or loading screen. State what is visible and keep hypotheses separate.

## Tutorials
- Turn the user's flow into an explicit plan and keep the original brief. Markdown needs exactly one fenced `forge-tutorial` JSON block; Canvas exactly one such block in a text node.
- Use clear step titles, explicit screenshots and semantic locators.
- `browser validate <source> --out docs/manual` returns the normalized plan and destination state. Review every navigation, input and click, especially those that submit data or change the site.
- Secret input: a `fill` action with `valueFromEnv` naming a `FORGE_TUTORIAL_*` variable (other names are rejected). The filled control is masked; check the rest of the image.
- Preview `browser tutorial <source> --out docs/manual --dry-run`, then run it. An existing output folder needs the validation's `data.revision` as `--if-match`.
- Running a tutorial operates the real site, and those effects cannot be rolled back. Run it only within the user's authorization; never infer permission for purchases, uploads or account changes.
- Review `index.md`, `screenshots/` and `flow.json` together. Rerunning replaces the generated output, so keep authored analysis in a separate note.

## Document
- Write or edit a Markdown note with `--dry-run` and revisions. Embed the image relative to the note (`![Save stays disabled](assets/problem.png)`); the returned `markdown` is scope-relative.
- Cite the clean URL, the capture's UTC time and viewport, the observed and expected result, and the next useful check. Remove launch fragments and private parameters.
- Read back, validate, and check links and embeds. Deliver the document and screenshots as links or attachments: a path in a tool log is not a delivered picture.
- See `bin/data/docs/how-to/capture-browser-evidence.md` and `bin/data/docs/reference/browser.md`.
