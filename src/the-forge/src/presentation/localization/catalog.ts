import { germanServerActions, germanServerCommands } from '../server/messages.ts';

export const germanCommands = {
  'read-many': 'Bis zu 32 Dateien nacheinander mit Revisionen lesen; jede Datei trägt höchstens --max-bytes zu einer Gesamtgrenze von 8 MiB bei.',
  ...germanServerCommands,
  stat: 'Die Revision einer Datei oder eines Ordners mit Größe oder Anzahl der enthaltenen Einträge ohne Inhalt prüfen.',
  help: 'Befehle und ihre Verwendung ohne interaktive Abfragen entdecken.',
  schema: 'Maschinenlesbarer Vertrag: JSON-Schema-2020-12-Eingabe- und -Ausgabeschemas, Annotationen und Fehlercodes eines Befehls oder mit --all aller Befehle; ohne beides ein Verzeichnis der Befehls-, Generator- und Skill-IDs.',
  config: 'Die geprüfte wirksame Konfiguration und ihren Quellpfad anzeigen.',
  setup: 'The Forge installieren und fehlende Konfiguration, Skills, Vorlagen und Projektanleitungen anlegen.',
  project: 'Eigenständige Bibliotheks- und Webview-Projekte verwalten und getestete Domain- oder Anwendungskomponenten hinzufügen.',
  workflows: 'Projekteigene CI-Workflows entdecken und ihre generierten GitHub-Einstiegspunkte synchronisieren; --check meldet Abweichungen.',
  formats: 'Native Obsidian-Formate und unterstützte Vorgänge anzeigen.',
  list: 'Dateien in stabiler Pfadreihenfolge auflisten; symbolische Verknüpfungen, Git, node_modules und .trash überspringen.',
  read: 'Ein Dokument, UTF-8-Text oder einen Base64-Anhang mit seiner SHA-256-Revision lesen; langer Inhalt wird gekürzt, und --lines liest einen Zeilenbereich.',
  validate: 'Markdown-Frontmatter, Canvas-Graphen, Base-Strukturen oder UTF-8-Text prüfen.',
  create: 'Eine Notiz, ein Canvas, eine Base oder eine Datei erstellen. Vorhandene Dateien werden nicht überschrieben.',
  write: 'Eine Datei erstellen oder ersetzen; Ersetzen erfordert die aktuelle Revision.',
  edit: 'Markdown oder UTF-8-Text gezielt bearbeiten: wörtliche Ersetzungen, Anhängen am Ende oder Bearbeiten eines Abschnitts oder Blocks.',
  apply: 'Einen JSON-Plan aus Schreib-, Bearbeitungs-, Frontmatter-, Verschiebe- und Löschvorgängen als einen geschützten Stapel ausführen.',
  properties: 'YAML-Frontmatter-Eigenschaften setzen oder entfernen und dabei den Markdown-Inhalt und unberührtes YAML erhalten.',
  patch: 'Einen Canvas-/Base-Wert über JSON Pointer setzen; - hängt an ein vorhandenes Array an.',
  delete: 'Eine Datei oder einen Ordner nach .trash verschieben oder mit --permanent entfernen; verweigert, solange andere Dateien darauf verlinken.',
  move: 'Eine Datei oder einen Ordner verschieben oder umbenennen und alle Links darauf in einem geschützten Stapel umschreiben.',
  rename: 'Eine Datei oder einen Ordner am selben Ort umbenennen und alle Links darauf umschreiben; eine Datei behält ihre Erweiterung.',
  make: 'Einen registrierten Generator ausführen oder die Generatoren auflisten.',
  events: 'Ereignisverträge des Aufrufs auflisten.',
  plugins: 'Kern- und Benutzer-Plugins mit Zustand und Beiträgen auflisten.',
} satisfies Record<string, string>;

/** German descriptions of kernel command actions, keyed `<command> <action>`; `make` actions use the generator catalog. */
export const germanActions: Record<string, string> = {
  ...germanServerActions,
  'project list': 'Die verwalteten Projekte auflisten.',
  'project create': 'Eine eigenständige TypeScript-Bibliothek oder ein Vue-Webview-Projekt erstellen.',
  'project open': 'Ein Projekt für Dateibefehle und Generatoren auswählen.',
  'project current': 'Das ausgewählte Projekt melden.',
  'project close': 'Die Projektauswahl aufheben.',
  'project inspect': 'Ein Projekt oder das ausgewählte Projekt beschreiben.',
  'project component': 'Einem Projekt eine getestete Domain- oder Anwendungskomponente hinzufügen.',
  'workflows list': 'Die erstellten Workflows jedes verwalteten Projekts und ihre generierten Einstiegspunkte auflisten.',
  'workflows sync': 'Die generierten .github/workflows-Einstiegspunkte schreiben; mit --check Abweichungen melden, ohne zu schreiben.',
};

/**
 * German guidance texts of the kernel's discovery results, keyed by their English text: the result fields that a
 * command's `localizedOutput` marks `text` read in German wherever they hold one of these texts.
 */
export const germanGuidance: Record<string, string> = {
  'Run help <command> for its usage, options, arguments, errors and examples, or schema <command> for its JSON Schemas. make lists generators; skills lists agent skills.':
    'Verwendung, Optionen, Argumente, Fehler und Beispiele eines Befehls zeigt help <command>, seine JSON-Schemas schema <command>. make listet die Generatoren, skills die Agent-Skills.',
  'Run schema <command> for one command\'s contract, or schema --all for every command.':
    'Führen Sie schema <Befehl> für den Vertrag eines Befehls oder schema --all für alle Befehle aus.',
  'Only committed vault.* records: vault.create, vault.modify, vault.delete and vault.rename, for files and folders.':
    'Nur erfolgreich geschriebene vault.*-Ereignisse: vault.create, vault.modify, vault.delete und vault.rename für Dateien und Ordner.',
  'textFilenames match case-insensitively, including dot suffixes that start with a non-dot character; native extensions take precedence. UTF-8 read, literal edit, append and full replacement with unified dry-run diffs; files that are not valid UTF-8 or contain NUL characters read as base64 attachments.':
    'textFilenames gelten ohne Beachtung der Groß- und Kleinschreibung, auch mit Punkt-Suffixen, die mit einem anderen Zeichen als einem Punkt beginnen; native Erweiterungen haben Vorrang. UTF-8 lesen, wörtlich bearbeiten, ergänzen und vollständig ersetzen, mit Unified-Diffs im Probelauf; ungültiges UTF-8 und Inhalte mit NUL-Zeichen werden als Base64-Anhang gelesen.',
  'Lossless byte read, copy, replace and embed; no built-in transcoding, rendering or PDF content editing.':
    'Dateien verlustfrei als Bytes lesen, kopieren, ersetzen und einbetten; keine integrierte Konvertierung, Darstellung oder PDF-Inhaltsbearbeitung.',
  'Opaque bytes; plugins can provide additional processing.':
    'Uninterpretierte Bytes; Plugins können weitere Verarbeitung bereitstellen.',
  'Ordered, awaited, per-listener snapshots; failures become warnings. Obsidian-style vault.* records follow each committed write (new folders first, parent before child, then files in batch order); dry runs emit workspace.quick-preview instead. Once the metadata cache is loaded in the invocation, the vault.* records of each batch are followed by metadataCache.changed, metadataCache.deleted, metadataCache.resolve and one metadataCache.resolved. operation.*, command.* and plugin.* records are host lifecycle phases, and the claude core plugin\'s claude.* records are the phases of each Claude invocation; workspace.* records are Obsidian workspace analogues (file-open, quick-preview, layout-ready, quit, project-change). Host namespaces are host-owned: plugins observe them but emit only their own events. onAny observes all events; replay reads bounded invocation history. No persistent replay. Responses include only vault.* records by default; --events none|changes|all or settings.events selects the output without changing delivery or replay.':
    'Geordnet, abgewartet und mit separaten Snapshots je Behandler; Fehler werden zu Warnungen. Obsidian-artige vault.*-Ereignisse folgen jedem erfolgreichen Schreibvorgang (zuerst neue Ordner, übergeordnete vor untergeordneten, dann Dateien in Stapelreihenfolge); Probeläufe senden stattdessen workspace.quick-preview. Nach den vault.*-Ereignissen eines Stapels folgen metadataCache.changed, metadataCache.deleted, metadataCache.resolve und ein metadataCache.resolved, sobald der Metadaten-Cache in diesem Aufruf geladen wurde. operation.*-, command.*- und plugin.*-Ereignisse sind Lebenszyklusphasen des Hosts, die claude.*-Ereignisse des claude-Kern-Plugins Phasen jedes Claude-Aufrufs; workspace.*-Ereignisse entsprechen Obsidians Workspace (file-open, quick-preview, layout-ready, quit, project-change). Host-Namensräume gehören dem Host: Plugins beobachten sie, senden aber nur eigene Ereignisse. onAny beobachtet alle Ereignisse; replay liest den begrenzten Verlauf dieses Aufrufs. Keine dauerhafte Wiederholung. Die Antwort enthält standardmäßig nur vault.*-Ereignisse; --events none|changes|all oder settings.events wählt die Ausgabe, ohne Zustellung oder replay zu ändern.',
  'Discover the installed editable planning templates.':
    'Die installierten, bearbeitbaren Planungsvorlagen entdecken.',
  'Inspect planning inputs before generating a requirements document.':
    'Planungseingaben vor dem Generieren eines Anforderungsdokuments prüfen.',
  'Find a project, then explicitly open it before generating project files.':
    'Ein Projekt suchen und vor dem Generieren von Projektdateien ausdrücklich öffnen.',
};

/** German descriptions of host event contracts; plugin-defined events keep their own descriptions. */
export const germanEvents = {
  'command.started': 'Ein weitergeleiteter Befehl aktiviert gleich Plugins und läuft an.',
  'command.succeeded': 'Ein weitergeleiteter Befehl wurde erfolgreich beendet.',
  'command.failed': 'Ein weitergeleiteter Befehl ist fehlgeschlagen; Fehlercodes enthalten keine Befehlseingaben.',
  'operation.started': 'Ein geschützter Workspace-Vorgang hat begonnen, auch bei Probeläufen.',
  'operation.succeeded': 'Ein geschützter Workspace-Vorgang wurde abgeschlossen, auch bei Probeläufen.',
  'operation.failed': 'Ein geschützter Workspace-Vorgang ist fehlgeschlagen.',
  'vault.create': 'Ein erfolgreicher Schreibvorgang hat eine Datei oder einen Ordner angelegt.',
  'vault.modify': 'Ein erfolgreicher Schreibvorgang hat eine vorhandene Datei ersetzt.',
  'vault.delete': 'Eine Datei oder ein Ordner wurde entfernt; Revision und Bytes einer Datei beschreiben ihren vorherigen Inhalt.',
  'vault.rename': 'Eine Datei oder ein Ordner wurde in einem erfolgreichen Stapel von oldPath nach path verschoben.',
  'metadataCache.changed': 'Eine geschriebene Markdown- oder Canvas-Datei wurde indexiert; cache enthält ihre JSON-Metadaten.',
  'metadataCache.deleted': 'Eine gelöschte Datei hat den Index verlassen; prevCache enthält ihre letzten bekannten Metadaten oder null.',
  'metadataCache.resolve': 'Die aufgelösten und nicht aufgelösten Links einer Datei wurden aktualisiert.',
  'metadataCache.resolved': 'Die Linkauflösung für einen geschriebenen Stapel ist abgeschlossen.',
  'workspace.file-open': 'Ein Befehl hat eine Datei über den Workspace-Lesepfad gelesen.',
  'workspace.quick-preview': 'Ein Probelauf hat eine geplante Dateiänderung angezeigt, ohne sie zu schreiben.',
  'workspace.layout-ready': 'Plugins sind aktiv und der Befehl läuft gleich an.',
  'workspace.quit': 'Der Aufruf endet; danach laufen bestmöglich Beendigungsaufgaben, bevor Plugins entladen werden.',
  'workspace.project-change': 'project open oder project close hat eine andere Projektauswahl gespeichert.',
  'plugin.registered': 'Ein Plugin hat die atomare Registrierung seiner Beiträge bestanden.',
  'plugin.activating': 'Ein registriertes Plugin führt gleich seinen Aktivierungs-Hook aus.',
  'plugin.activated': 'Der Aktivierungs-Hook eines Plugins wurde erfolgreich abgeschlossen.',
  'plugin.activation-failed': 'Die Aktivierung eines Plugins ist fehlgeschlagen; die erfasste Bereinigung bleibt geplant.',
  'plugin.unloading': 'Ein gestartetes Plugin gibt gleich seine Ressourcen für diesen Aufruf frei.',
  'plugin.unloaded': 'Die Bereinigung eines Plugins wurde erfolgreich abgeschlossen.',
  'plugin.unload-failed': 'Die Bereinigung eines Plugins ist fehlgeschlagen; die übrige Bereinigung läuft weiter.',
} satisfies Record<string, string>;
