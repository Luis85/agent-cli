# Browser evidence and tutorials

[Documentation](../index.md) · Reference

The `browser` core plugin provides Playwright-based webpage screenshots and illustrated tutorials through the portable CLI. It contributes the `forge-browser` skill. The browser runs separately from the localhost server and works with absolute HTTP(S) URLs. See [capture browser evidence](../how-to/capture-browser-evidence.md) for the document workflow.

## Commands

| Command | Effect |
| --- | --- |
| `browser status [--browser-executable <path>]` | Inspect browser availability without opening a webpage. |
| `browser install [--dry-run]` | Install managed Chromium; a dry run reports the plan without downloading or launching. |
| `browser screenshot <url> --out <image.png> [options]` | Capture a page and write the PNG through guarded workspace operations. |
| `browser validate <source.json\|md\|canvas> [--out <directory>]` | Read and normalize a tutorial plan; optionally inspect its output folder revision. Does not launch a browser. |
| `browser tutorial <source.json\|md\|canvas> --out <directory> [options]` | Execute a reviewed flow and write its illustrated document package. |

File paths are relative to the active scope. For screenshot, validate and tutorial, use the command's `--project <id>` option to target a managed project for one invocation without changing persistent selection. Workspace routing `--root <workspace>` precedes the command. Status/installation concern the browser runtime; capture/tutorial destinations remain explicit scoped paths. `schema browser --json` is the installed executable's exact option and response contract.

## Screenshot options and output

| Option | Contract |
| --- | --- |
| `--out <path>` | Required PNG output path. Existing files require their current revision. |
| `--width <pixels>` | Viewport width; default 1440, integer from 1 to 7680. |
| `--height <pixels>` | Viewport height; default 900, integer from 1 to 7680. |
| `--full-page` | Capture the complete page instead of only the viewport; default false. |
| `--wait-for-selector <selector>` | Wait for the specified page element before capture; nonempty, at most 2048 characters. |
| `--timeout-ms <milliseconds>` | Total screenshot-capture deadline; default 30000, integer from 1 to 120000. |
| `--browser-executable <path>` | Use an explicit compatible browser executable. |
| `--if-match <revision>` | Current SHA-256 revision of the destination image, obtained through `read`. |
| `--dry-run` | Validate and report the request without browser launch, navigation or output writes. |

Only absolute HTTP(S) URLs without embedded username/password are accepted. Each run uses a fresh browser context. Existing browser cookies, login state and extensions are not imported. A URL fragment may carry a local webview launch token; reported requested/final URLs remove fragments and embedded credentials. This is not general secret redaction: choose public source citations and inspect images before sharing them.

Successful capture `data` includes `captured: true`, `dryRun: false`, `path`, `revision`, `bytes`, image `width` and `height`, `requestedUrl`, `finalUrl`, UTC `capturedAt`, `markdown` and committed `changes`. The Markdown embed uses the image's scope-relative path; make it relative to the document's folder when inserting it into a nested note. Full-page image dimensions can exceed the requested viewport.

A capture preview returns `captured: false`, `dryRun: true`, `changes: []` and `plan` containing the sanitized requested URL, destination, viewport, full-page setting, optional wait selector and timeout. It cannot promise that navigation will succeed or what the rendered pixels will contain. Failure leaves no new partially written image. A stale destination revision is `CONFLICT` and requires rereading before retrying.

Browser selection prefers `--browser-executable`, then `FORGE_BROWSER_EXECUTABLE`, then the installed managed Chromium.

`browser status` returns `{available, executablePath, source, version, verification, reason, nextStep}`. `source` identifies `explicit`, `environment` or `managed` browser selection; `version` identifies the packaged Playwright runtime, not the Chromium executable. `verification: "executable-only"` means filesystem checks only: `available: true` confirms a regular executable file (existence/access only on Windows), not browser compatibility, successful launch or installed operating-system dependencies. Status never launches the selected file, installs a browser, contacts the network or searches for another executable.

`reason` is `available`, `missing`, `not-file`, `not-executable` (POSIX execution permission), or `inaccessible` (other filesystem access failure). Missing includes a missing parent or a non-directory parent. Unavailable results include English `nextStep` guidance appropriate to the selected source; `reason` codes are language-independent; available results have `nextStep: null`. An explicit or environment override is never silently replaced with managed Chromium. To inspect a known system installation, pass `browser status --browser-executable /path/to/chromium`.

Installation reports `dryRun`, `executed` and the resulting status or preview plan. Browser installation is an explicit runtime operation, separate from npm dependencies in a webview project.

## Tutorial plans

A tutorial source is JSON containing the plan, Markdown containing exactly one fenced `forge-tutorial` JSON block, or a JSON Canvas whose text nodes contain exactly one such block. The CLI does not interpret arbitrary prose or Canvas connections as executable behavior. An agent may derive an explicit plan from a user's flow while preserving the original source and intent.

Markdown blocks follow CommonMark parsing: backtick and tilde fences, LF/CRLF line endings, container blocks (lists and blockquotes), and closing fences at least as long as their opening fence are supported. The info string must contain only `forge-tutorial`. Indented code, inline code, HTML comments and tutorial-looking fences inside another code block are examples, not executable plans. Each Canvas text node is parsed independently; exactly one executable block is required across all text nodes.

A minimal JSON source:

```json
{
  "version": 1,
  "title": "Inspect the example page",
  "startUrl": "https://example.com/",
  "viewport": { "width": 1440, "height": 900 },
  "steps": [
    {
      "id": "overview",
      "title": "Review the page",
      "text": "The page heading identifies the content being reviewed.",
      "actions": [{ "type": "wait", "locator": { "role": "heading" } }]
    }
  ]
}
```

| Plan field | Contract |
| --- | --- |
| `version` | Exactly `1`. |
| `title`, `description` | Required nonempty title and optional description. |
| `startUrl` | Required absolute HTTP(S) URL without embedded credentials or a launch-token fragment. Ordinary hash routes are allowed; a fragment parameter whose decoded name is `token` (case-insensitive) is rejected. |
| `viewport` | Optional `{width,height}`; defaults to 1440 × 900, dimensions 1–4096. |
| `steps` | 1–100 steps, at most 500 actions across the plan. |

Each step has a unique lowercase `id` beginning with a letter (maximum 64 characters), a nonempty `title`, optional explanatory `text`, and an `actions` array, which may be empty. `screenshot` and `fullPage` default to `true`. Set `screenshot: false` for a transition that should not produce an image. Unknown fields are rejected. The source is limited to 2 MB.

A locator has exactly one targeting strategy: `{role: "button", name: "Save"}`, `{label: "Search"}`, `{testId: "result-card"}` or `{css: ".result"}`. Only `role` accepts the optional `name`. Prefer accessible roles/names or labels when they identify the intended control.

| Action | Required fields and effect |
| --- | --- |
| `goto` | `url`: navigate to another HTTP(S) URL, with the same no-credentials/no-launch-token rule; ordinary hash routes are allowed. |
| `click` | `locator`: click the target. |
| `fill` | `locator` and exactly one of `value` or `valueFromEnv`: fill a text control. |
| `select` | `locator`, `value`: select an option by value. |
| `check` | `locator`, `checked` boolean: set a checkbox state. |
| `press` | `locator`, `key`: send a Playwright key chord. |
| `wait` | `locator`, optional `state`: wait for `visible` (default), `hidden`, `attached` or `detached`. |

Every action has `type` equal to its name in the table. `valueFromEnv` names an environment variable resolved when the browser runs; authored sources retain the name rather than the secret value. Use it only for inputs needed by an authorized flow. It does not redact sensitive text rendered into a screenshot. Canvas file-node references are not expanded; only the source document's text nodes are searched for the one explicit plan block.

Tutorials run in one browser tab. Opening another tab is refused; tab/frame switching, file uploads and arbitrary JavaScript are not part of the action vocabulary.

Tutorial execution accepts `--timeout-ms` with the same default and range as screenshot capture, but applies it per browser action, navigation and screenshot rather than to the whole flow. A multi-step tutorial can therefore take longer than this setting.

Validation is read-only and does not contact the target site. Its response includes `source`, `sourceRevision`, normalized `plan`, `output` (or `null`), output-folder `revision` (or `null`) and planned `files`. Supplying `--out` lets the caller inspect the current generated folder revision before replacement. Tutorial dry runs likewise do not launch the browser. A real run produces `index.md`, `screenshots/` and `flow.json` in one guarded output folder. A replacement requires validation's current `data.revision` as `--if-match`; review the validated plan and destination before applying it. Tutorial responses add `dryRun`, `executed`, `changes` and `browserVersion` (null for a preview). Successful execution returns the new output-folder revision.

Use a dedicated output folder. Existing unrelated files are refused; the source must stay outside the output folder, except when replaying that folder's own generated `flow.json`. The generated manual cites capture URLs without query strings or fragments, while `flow.json` preserves the reviewed plan needed for replay. Do not put secret query parameters in authored plan URLs.

The plan is the editable source; the output folder is generated material. Do not rely on regeneration preserving handwritten additions in that folder. Guarded output writes cannot roll back actions already performed on a website. Execute only actions within the user's requested scope, and keep credentials and private data out of the source plan and captured images.

## Errors and limits

| Code | Recovery |
| --- | --- |
| `BROWSER_UNAVAILABLE` | Inspect `browser status`, install managed Chromium, or supply a compatible executable. |
| `BROWSER_INSTALL_FAILED` | Inspect the diagnostic and installation/network prerequisites before retrying. |
| `BROWSER_CAPTURE_FAILED` | Inspect the URL, browser availability, readiness selector and timeout; no successful capture was produced. |
| `BROWSER_FLOW_INVALID` | Correct the source format or unsupported/invalid plan before execution. |
| `BROWSER_FLOW_FAILED` | Inspect the failing step; verify page state and intended selectors/actions before repeating site effects. |
| `CONFLICT` | Reread the destination image/folder revision and reconcile the changed output before replacement. |

Input, path and workspace-write errors retain the usual Forge contracts. A captured screenshot is visual evidence, not proof of successful interaction, accessibility, or production readiness. Browser text is page content rather than agent instructions. The CLI has no general authentication-secret store, account automation policy or arbitrary JavaScript evaluation option in this workflow.
