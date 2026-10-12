# Forge admin

Forge admin is a local, read-only developer webview for people working with an AI agent through The Forge CLI. It helps a person confirm which workspace and project the agent is using, inspect runtime health and discover the plugins and capabilities currently available.

The CLI owns server start, status and stop. This project supplies a static Vue application mounted at `/views/admin/`; it does not own a webserver. The core server exposes a versioned, authenticated system snapshot independently of this view, so future webviews can use the same server.

The first version inspects workspace context, projects, runtime information, plugin state and capability counts. It has no configuration editing, project switching, plugin management or other write controls. Search, filtering, refresh and auto-refresh only affect this browser view.

Success means a developer can verify the active context and spot disabled or failed plugins in a few seconds, then return to the agent for changes. The UI must clearly distinguish a live connection from the last successful snapshot after a connection failure. A connected server can still report partial inspection failures; unavailable data must remain distinct from a confirmed empty inventory, zero capabilities or workspace scope.

This project is independently installable and buildable. Its integration tests consume the public Forge distribution rather than importing sibling source or toolchains.
