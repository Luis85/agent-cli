# Capture browser evidence and explain a situation

[Documentation](../index.md) · How-to

Use the portable CLI to capture a webpage and put visible evidence into a Markdown document. The same browser tools can follow an explicit plan and produce an illustrated tutorial. They work with existing HTTP(S) pages as well as Forge webviews; creating a prototype is not required.

The bundled `forge-browser` skill guides agents through capture, image inspection and document delivery. Inspect it with `skills show forge-browser` or [install the skills](install-agent-skills.md).

## Capture the relevant state

From the workspace root, inspect browser availability:

```sh
node bin/forge.js browser status --json
```

If Chromium is unavailable, install the managed browser with `browser install`; `browser install --dry-run` previews that operation without downloading. An already-installed compatible browser can instead be selected with `--browser-executable <path>`. Browser installation belongs to the browser tooling, separately from any generated project's npm installation.

For a project named `idea-board`, preview and capture a page:

```sh
node bin/forge.js browser screenshot https://example.com --project idea-board --out docs/assets/page-desktop.png --width 1440 --height 900 --dry-run
node bin/forge.js browser screenshot https://example.com --project idea-board --out docs/assets/page-desktop.png --width 1440 --height 900
```

Use the actual page URL and target project. The output is relative to the targeted project; without a selected or explicit project, it is workspace-relative. The dry run validates the request and output without launching Chromium or contacting the page. Check `ok` and the exit status before using the output.

Capture only the viewport by default, or add `--full-page` for the page's full height. For a known loading boundary, add `--wait-for-selector <selector>` and an appropriate `--timeout-ms`; inspect the result rather than assuming that a navigation timeout or a successful image proves readiness. Capture another width when a narrow layout matters.

New destinations are create-only. For a deliberate replacement, read the existing image through Forge and pass its current revision as `--if-match` to the preview and capture. A conflict requires rereading and reviewing the changed file.

## Inspect the image and write the explanation

Open the saved PNG with an image viewer or the agent's image-inspection tool. Confirm that it shows the intended state. A fresh browser context does not inherit a person's login; a capture may show an access prompt, loading screen or error page. Describe those facts honestly and do not infer a successful interaction from an image alone.

The response supplies the saved path and revision, requested/final URLs with fragments removed, UTC capture time, image dimensions and a Markdown image embed. Use the actual capture metadata in the note. Adjust the embed relative to the note's own folder: for `docs/problem.md` and `docs/assets/page-desktop.png`, write:

```md
# Save action remains unavailable

Observed: the Save action is disabled after the required fields are filled.
Expected: completing the required fields should allow the change to be saved.

![Save action remains disabled](assets/page-desktop.png)

Source: [Page under review](https://example.com)
Capture: use the response's capturedAt value; viewport 1440 × 900.

Next check: inspect which validation rule still reports an error.
```

This is an example document shape; replace its claims with what the actual image and task establish. Keep hypotheses separate from observations. Include the final redirected URL when it explains a difference from the requested page. Keep session fragments and private URL parameters out of shared citations; review the pixels for sensitive content before sharing them.

Create the note with `write docs/problem.md --stdin --dry-run`, review the diff, then apply it. Existing notes need the current revision from `read` as `--if-match` on preview and write. Read back the note and check its image links with `links out docs/problem.md`; use `validate` and the relevant vault checks before delivery. See [precise editing](make-precise-edits.md).

## Turn a flow into an illustrated tutorial

A user can describe the desired flow in a message, a Markdown document or an Obsidian Canvas. The agent translates that intent into a reviewable plan with explicit supported browser actions. The CLI executes that plan; it does not guess how prose, arrows or node positions translate into clicks.

Store the plan directly as JSON, or put exactly one fenced `forge-tutorial` JSON block in Markdown. A Canvas source must contain exactly one such block in a text node. Preserve the original brief when creating the executable plan, for example by keeping a separate plan document beside it. See the [tutorial plan reference](../reference/browser.md#tutorial-plans) for the schema and action vocabulary.

```sh
node bin/forge.js browser validate docs/flow.md --project idea-board --out docs/manual
node bin/forge.js browser tutorial docs/flow.md --project idea-board --out docs/manual --dry-run
node bin/forge.js browser tutorial docs/flow.md --project idea-board --out docs/manual
```

Validation returns the normalized plan and, when an output path is supplied, the current destination revision. Review actions and their site effects before execution. A request to inspect or document a page authorizes ordinary inspection; actions that submit data, make purchases, upload files or change an account need to fall within the user's actual request. Do not place credentials in the plan or screenshots. A supported `fill` action can refer to `valueFromEnv` with a `FORGE_TUTORIAL_*` variable for an authorized input without saving its literal value; the filled control is masked in screenshots, but other text the page renders is not redacted. A tutorial uses a fresh browser session rather than silently inheriting saved authentication.

The generated output groups `index.md`, `screenshots/` and `flow.json` in the chosen folder. Inspect its images and narrative, and verify the relative links. To regenerate an existing folder, pass validation's `data.revision` as `--if-match` to both preview and execution. The folder write is guarded as a unit; browser actions may already have affected the target website and cannot be undone by a file conflict.

Keep the plan as the source and treat the output folder as generated material. Put additional authored analysis beside it, or preserve that analysis deliberately before regeneration. Share a link to the rendered Markdown and visible screenshot links or attachments. A successful command or a screenshot path in a log does not by itself show the pictures to the user.

On-demand evidence capture complements a project's Playwright regression suite. Use [webview prototyping](prototype-webviews.md) to implement a prototype and its behavioral checks; use browser evidence to explain what a reviewer should see and why it matters.

See the [CLI-generated example manual](../examples/browser-tutorial/README.md) for a complete reviewed source, replay plan and captured interaction sequence.
