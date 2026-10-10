# Maintain, transfer and regenerate components

[Documentation](../index.md) · How-to guide

Use this guide for an existing component library. To create your first definitions, follow [your first UI](../tutorials/first-ui.md); for allowed fields and target dependencies, see the [component reference](../reference/ui-components.md).

## Choose source and output paths

All feature paths are configurable; the executable's fixed `bin` layout remains unchanged:

| Purpose | Configuration | Override | Relative to |
| --- | --- | --- | --- |
| Definitions | `paths.components` | `--library` | Workspace |
| Generated UI | `paths.ui` | `--out` on `make ui/stories` | Selected project, otherwise workspace |
| Stories | `paths.stories` | `--stories-out` | Selected project, otherwise workspace |
| Import source | `paths.componentImports` | `components import --from` | Workspace |
| Export destination | `paths.componentExports` | `components export --out` | Workspace |
| Managed projects | `paths.projects` | Project selection with `--project` on UI generation | Workspace |

See [configuration](../reference/configuration.md) for defaults. Source and destination paths must remain contained in the workspace/selected scope. Both explicit output overrides and configured defaults follow the same project scope; check response `context.root`.

```sh
node bin/forge.js components export --out exchange/ui --dry-run
node bin/forge.js components export --out exchange/ui
node bin/forge.js components import --from exchange/ui --library imported-ui --dry-run
node bin/forge.js components import --from exchange/ui --library imported-ui
```

Transfers preserve Markdown bytes and nested paths and validate the combined destination library. They do not copy Storybook extension modules, images, styles or other assets; manage those files separately and keep extension paths valid. An import must not duplicate IDs already in its destination library.

Generated destinations are create-only by default. Import/export destinations are always create-only. Existing files cause a conflict even when identical. To compare regenerated code with handwritten changes, generate into a new output directory and reconcile explicitly.

To inspect drift before deciding to replace files, compare the generated plan with current output:

```sh
node bin/forge.js make ui page --framework react --plan
node bin/forge.js make ui page --framework react --check
```

Planning is read-only and reports each output as `missing`, `unchanged` or `changed`, with proposed text and existing content/revision where available. `--check` exits successfully when every output matches, or exits 5 with `UI_DRIFT` and structured path/status details. This is useful in CI after generation; it does not compile code or validate browser behavior.

Save the current revision map to a new file after reviewing the plan:

```sh
node bin/forge.js make ui page --framework react --plan-out ui-revisions.json --dry-run
node bin/forge.js make ui page --framework react --plan-out ui-revisions.json
```

Only the revision-map file is written; generated UI is untouched. The map destination is relative to the active project or workspace, and existing map files are not overwritten. Use the same framework, output paths and `--stories` options for planning and regeneration so the output set agrees. `--plan-out` implies planning; do not combine plan/check modes with `--revisions-from`.

For intentional regeneration, `make ui` and `make stories` accept `--revisions-from <file.json>`. The plan can create this map for you; alternatively, read every existing destination, review its current contents, and create a JSON object mapping generated `change.path` values to their current SHA-256 revisions. For project output, keys include the workspace-relative project directory, such as `projects/portal/src/ui/page.tsx`; the revision-map file itself is read relative to the active output scope. New files omit keys. Unknown output keys, missing revisions for existing outputs and stale revisions are rejected. No force flag bypasses revision checks.

For example, after reading and reviewing an existing workspace `src/ui/page.tsx`, write its actual revision into `ui-revisions.json`:

```json
{
  "src/ui/page.tsx": "REPLACE_WITH_CURRENT_SHA256_REVISION"
}
```

```sh
node bin/forge.js make ui page --framework react --revisions-from ui-revisions.json --dry-run
node bin/forge.js make ui page --framework react --revisions-from ui-revisions.json
```

When generating stories or referenced components in the same batch, include revisions for every existing output in that batch. A map is permission to replace exactly those inspected versions; reconcile handwritten changes before applying. Existing definitions can be maintained with revision-guarded `read`, `properties`, `edit` or `write`. These generic commands follow the active project, so close it before editing the shared workspace library:

```sh
node bin/forge.js project close
node bin/forge.js read components/dashboard.md --json
node bin/forge.js properties components/dashboard.md --set '{"name":"Dashboard"}' --if-match YOUR_REVISION --dry-run
```

Dry runs perform validation and collision checks and return planned paths, hashes and generated text without writes or file events. A real generation validates destinations before committing and emits file events only after successful persistence; lifecycle phase events also describe validation and previews. Multi-file writes use the workspace's rollback contract, not crash-atomic transactions. Determinism covers Forge-generated bytes; custom modules and downstream compilers have their own behavior. Compile and exercise the generated UI and stories in the target application before relying on their interaction or accessibility behavior.
