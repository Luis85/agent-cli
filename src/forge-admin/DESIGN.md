# Developer admin design

Mode: Operate. The view supports fast inspection during local engineering work. Preserve the product's read-only scope and show only actual server data.

## Visual system

Use a restrained light interface with slate neutrals and emerald connection/enabled states. The system sans-serif stack stays legible and offline; monospace is reserved for filesystem paths, plugin IDs and commands. Background `#f8fafc`, content `#ffffff`, primary text `#172333`, secondary text `#526176`, dividers `#dce3eb`, connected state `#047857`. Nuxt UI supplies accessible buttons, badges, search, select and switch controls using this palette.

The header identifies The Forge and the read-only admin surface. The page title and refresh controls lead, followed by connection state and last-update time. A narrow context column holds workspace selection, runtime details and capability counts. A wider inventory column groups projects and plugins into two bordered sections. At widths of 760px or less the columns stack; context details use compact two-column groups and plugin filters stack to full width. Paths and metadata wrap rather than clipping or forcing horizontal scrolling.

Page maximum width: 1240px, desktop side padding: 28px, mobile: 20px. Section separation: 24–32px, desktop column gap: 48px. Section containers use 12px radii and a single 1px border; no shadows or decorative charts. Heading sizes: 30px page title, 15px section and plugin headings; body 13–15px, supporting metadata 11–12px. Counts use tabular numerals.

## Behavior and accessibility

The first focusable control is a visible-on-focus skip link. Semantic headings, lists and definition lists describe inventory and runtime data. Inputs carry explicit accessible names. Connection changes use a polite live status; authentication and connection errors use actionable alerts. Focus rings use emerald with a visible offset. Colors supplement state text.

Manual refresh preserves the last good snapshot while loading. Optional auto-refresh runs every 15 seconds and pauses while the tab is hidden. Authentication failures stop polling and clear the expired session token. Missing access, empty inventories, no search results, malformed responses and server disconnects each have explicit states and recovery text. The token is removed from the URL fragment before requesting data and retained only in tab session storage (or memory when browser storage is unavailable).

Partial inspection failures show explicit unavailable labels per section, alongside the server warning; they never imply an empty inventory, zero capabilities or workspace scope.

No external fonts, decorative imagery or remote icon requests are needed. Nuxt UI icons are bundled locally. Reduced-motion preferences disable component transitions and animation.
