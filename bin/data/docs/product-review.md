# The Forge product review

Reviewed on 2026-10-07. This pass improves the existing portable CLI, generated forms and documentation without adding commands, generators or product features. The strongest foundations are explicit execution scope, guarded writes, discoverable JSON contracts and a small distribution. The highest-impact improvements protect those contracts in edge cases and make the existing form showcase clearer on small screens.

## Product perspectives

| Perspective | Assessment and resulting action |
| --- | --- |
| Purpose and scope | The agent-first, noninteractive interface is coherent. Preserve JSON output, explicit project context and schema discovery. Human-oriented CLI advice should not introduce prompts into automated workflows. |
| Onboarding and discovery | README examples cover setup, project selection, generation and safe edits. Full distribution, Node requirements and generated-project installation are documented. Added a visible route to interrupted-write recovery from the README. |
| Data integrity and trust | Revisions, preflight checks and rollback protections are strong. Fixed selection silently moving to a same-named project when the projects directory changes, and literal edits accepting overlapping matches. |
| Command and plugin usability | Help/schema expose command capabilities and plugin activation is explicit. Fixed string options beginning with `no-` losing their value; boolean negation remains intact. |
| Format compatibility | Existing docs distinguish structural validation from Obsidian rendering. Fixed Canvas file subpaths missing the required `#` prefix and extensionless basenames being mistaken for document extensions. |
| Form clarity and accessibility | Native labels, linked errors, first-invalid focus and local-only result preview already work. Error-summary links now name their fields, and the empty showcase gives consistent guidance. |
| Responsive layout | Normal desktop/mobile screens worked. Long valid titles and help text expanded a 320px page to 1,237px. The adjusted wrapping and grid constraints retain a 320px page width. |
| Reliability and performance | Existing event isolation and plugin cleanup behavior remain covered. Changes add no runtime packages or background work. No performance benchmark or large-file memory claim is made; the CLI still retains file inputs in memory. |
| Portability and maintenance | The bundle and generated-project gates exercise the shipped contract. Clarified that native filesystem naming rules still apply; CI covers Ubuntu on Node 22.12 and 24. |

## Findings resolved

| Priority | Trigger and previous behavior | Result and acceptance evidence |
| --- | --- | --- |
| P1 | Open project `alpha`, change `paths.projects`, then create another `alpha`. File commands silently targeted the new directory. | Selection records its workspace-relative directory. A mismatch fails with `STALE_PROJECT_CONTEXT` before a write; explicit open/close recovers. Integration and portable workflow coverage verify both roots remain unchanged on failure. |
| P2 | Edit `banana` using `--find ana`. Overlapping occurrences were counted as one. | `AMBIGUOUS_EDIT` preserves the file and emits no events in real and dry-run modes. Unique literal replacement still works. |
| P2 | Plugin declares a string option such as `--no-label`. Commander negation handling discarded its value. | String options preserve literal values independently of positive names; boolean negation and bootstrap routing remain covered. |
| P2 | A file node uses `subpath: "Heading"`. Canvas validation accepted it despite JSON Canvas 1.0 requiring `#`. | Validation and pointer edits reject invalid subpaths. Heading and block anchors survive edits. |
| P2 | An extensionless file is named `md`, `canvas` or `png`. Classification treated its whole name as an extension. | Classification uses the basename's actual extension, preserving opaque attachment handling, case-insensitive extensions and existing dotfile behavior. |
| P2 | A long form title/help string is viewed at 320 CSS pixels. The page scrolls horizontally. | Content wraps and form/grid controls shrink within their container; browser measurement confirms viewport and document width both remain 320px. |
| P3 | Multiple fields return the same validation message. Summary links are indistinguishable. | Each link includes the associated field label; inline errors remain concise. A regression checks repeated messages and link targets. |
| P3 | No form definitions exist. The result pane still asks the user to complete a form. | Disabled selector and result guidance agree with the empty state. |
| P3 | A writer was interrupted, leaving its lock. The error assumes another writer is still running. | The message distinguishes active and interrupted writers and explains the inspection needed before removing a lock. No automatic removal or retry was introduced. |

## Form walkthrough

1. **Choose and read a form — healthy.** Labels, required markers and help text are visible at desktop, tablet and mobile widths.
2. **Submit invalid values — improved.** Focus moves to the first invalid field; summary links identify each field and focus their targets.
3. **Submit valid values — healthy.** Normalized values appear in the local preview. The interface explains that values are not sent or saved.
4. **Edit or reset — healthy.** Changing values clears stale results; reset clears validation and result state.
5. **View long content — improved.** The 320px layout wraps long titles and help text without horizontal page expansion.
6. **Open an empty showcase — improved.** The disabled form selector and status explain that a form must be added before values can be inspected.

Chromium interaction checks covered 1440px, 768px and 320px viewports, keyboard navigation, invalid/valid submission, summary links, stale-result clearing, reset and the empty state, with no browser errors. Screen-reader announcements and other browser engines remain outside this evidence; these checks do not establish complete accessibility compliance.

## Research grounding

- [Command Line Interface Guidelines](https://clig.dev/): predictable composition, discoverable help, errors and previews support the existing CLI approach. The Forge deliberately keeps machine-readable stdout and does not adopt interactive defaults intended for human-first tools.
- [W3C form notifications](https://www.w3.org/WAI/tutorials/forms/notifications/): identify invalid fields, describe problems and help users reach the affected controls. This supports field names in summary links while preserving existing label/error associations.
- [WCAG reflow technique C33](https://www.w3.org/WAI/WCAG22/Techniques/css/C33): long strings should wrap where needed to avoid horizontal page scrolling. This directly grounds the mobile overflow fix.
- [WCAG status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html): communicate operation status without forcing unnecessary focus changes. The existing result status behavior remains intact.
- [JSON Canvas 1.0](https://jsoncanvas.org/spec/1.0/): file-node subpaths must begin with `#`. Validation now enforces this requirement.
- [Obsidian Bases syntax](https://help.obsidian.md/bases/syntax): formulas and filters have application semantics beyond YAML structure. The Forge continues to preserve expressions without claiming to evaluate them.
- [Microsoft filename rules](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file): reserved names and trailing periods/spaces impose platform limits. The command reference now explains portable filename considerations.

## Upgrade and remaining limits

Saved project selections from before this change lack the directory binding. Run `project open <name>` to select the intended project again, or `project close` to return to workspace scope. Existing project files, configuration, templates and plugins are preserved.

Plugin code remains trusted Node code. Writer locks do not coordinate external editors, batches are not crash-atomic, and Obsidian rendering/expression evaluation still require the host application. No native Windows/macOS run, assistive-technology session, user study or production usage analysis was performed. These are evidence limits, not reasons to expand the feature set in this polishing pass.
