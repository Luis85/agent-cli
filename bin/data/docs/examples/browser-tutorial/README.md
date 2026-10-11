# A captured prototype walkthrough

[Open the generated manual](index.md) · [Reviewed Markdown source](source.md) · [Replay plan](flow.json) · [On-demand mobile screenshot](mobile.png)

The Forge CLI generated this manual, replay plan and three screenshots by opening the Vue/Nuxt UI webview starter, filtering its sample ideas and saving one result. `mobile.png` came from a separate `browser screenshot` invocation. The images are actual browser captures; the manual content comes from the reviewed flow's step titles and descriptions.

The localhost address and capture timestamps in the generated files describe a temporary demonstration session, which has stopped. They are historical evidence, not a hosted service. Replace `startUrl` with your own running view's URL before replaying; omit the launch-token fragment because this sample uses local data and does not call the system API.

## Replay in your own project

Create a starter with `project create launch-preview --type webview`, install its dependencies, build it and publish it as described in [create a webview](../../how-to/prototype-webviews.md). Start the shared server with `server start --webview launch-preview`. Copy `source.md` into that project's `docs/tutorial-source.md` and update the fenced plan's `startUrl` to the returned view URL without its `#token=...` fragment.

Select the project, install Chromium once if needed, then validate and replay the reviewed flow:

```sh
node bin/forge.js project open launch-preview
node bin/forge.js browser install
node bin/forge.js browser validate docs/tutorial-source.md --out docs/tutorial
node bin/forge.js browser tutorial docs/tutorial-source.md --out docs/tutorial --dry-run
node bin/forge.js browser tutorial docs/tutorial-source.md --out docs/tutorial
```

Run these commands from the containing workspace. If Chromium is already installed, pass `--browser-executable` or set `FORGE_BROWSER_EXECUTABLE` instead of downloading it. Keep the output directory dedicated to generated artifacts. On a later run, obtain its current `revision` with `browser validate ... --out docs/tutorial` and supply that revision as `--if-match REVISION` to both preview and apply.

For a single mobile capture, replace `VIEW_URL` with your view URL:

```sh
node bin/forge.js browser screenshot VIEW_URL --out docs/mobile.png --width 390 --height 844 --full-page --wait-for-selector h1
```

Review the resulting images and provide visible links when handing the prototype to a user. A successful test or capture response does not itself display an image.
