import type { CorePlugin } from '../../application/plugins/core-plugins.ts';
import type { EventDefinition } from '../../application/plugins/events.ts';
import type { PluginContext } from '../../application/plugins/registry.ts';
import { isRecord } from '../../domain/shared/errors.ts';
import type { BasesQueryService } from './application/session.ts';
import { stringifyYaml } from './infrastructure/yaml.ts';
import { editFrontmatter } from './infrastructure/frontmatter.ts';
import { backlogSkill } from './infrastructure/skill.ts';
import { backlogCommand } from './presentation/command.ts';

const payload = (keys: readonly string[]) => (value: unknown): value is Record<string, unknown> => isRecord(value) && keys.every(key => typeof value[key] === 'string');
const events: EventDefinition[] = [
  { id: 'backlog.item-created', description: 'A backlog item, iteration or release note was created: {path, title, type, id, parent?, order?}.', validate: payload(['path', 'title', 'type']) },
  { id: 'backlog.item-moved', description: 'An item was reparented or reordered: {path, parent, order, previousParent, previousOrder}.', validate: payload(['path']) },
  { id: 'backlog.state-changed', description: 'An item changed its workflow state: {path, title, from, to, started?, finished?}.', validate: payload(['path', 'title']) },
  { id: 'backlog.released', description: 'A release was marked released: {path, name, status, released}.', validate: payload(['path', 'name', 'status', 'released']) },
];

const today = () => { const now = new Date(); return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() }; };

const de = {
  commands: { backlog: 'Ein Product Backlog kompatibel mit der Obsidian-Ansicht Product Backlog (backlog-view) planen: Hierarchie, Ränge, Status, Iterationen, Releases und Abhängigkeiten.' },
  events: {
    'backlog.item-created': 'Ein Backlog-Eintrag, eine Iteration oder ein Release wurde angelegt.',
    'backlog.item-moved': 'Ein Eintrag wurde umgehängt oder neu eingereiht.',
    'backlog.state-changed': 'Ein Eintrag hat seinen Workflow-Status geändert.',
    'backlog.released': 'Ein Release wurde als veröffentlicht markiert.',
  },
  errors: {
    BACKLOG_NOT_FOUND: { summary: 'Das Backlog oder der Eintrag wurde nicht gefunden.', hint: 'Legen Sie mit backlog init ein Backlog an, übergeben Sie --base und --view oder prüfen Sie den Eintrag mit backlog list.' },
    BACKLOG_AMBIGUOUS: { summary: 'Die Angabe passt auf mehrere Backlogs oder Einträge.', hint: 'Wählen Sie einen der Kandidaten in error.details.candidates über --base und --view oder den vollständigen Pfad.' },
    BACKLOG_CONFIG_PROBLEM: { summary: 'Die Backlog-Konfiguration in der .base-Datei verhindert diesen Vorgang.', hint: 'Beheben Sie das in der Meldung genannte Problem in den Ansichtsoptionen der .base-Datei und wiederholen Sie den Befehl.' },
    BACKLOG_WRITE_REFUSED: { summary: 'Das Backlog-Plugin verweigert diesen Schreibvorgang.', hint: 'error.details.reason nennt die Regel; wählen Sie einen passenden Eintrag, Typ oder Wert oder binden Sie die fehlende Eigenschaft.' },
    BACKLOG_NO_GAP: { summary: 'Zwischen den Nachbarn ist kein Rang mehr frei.', hint: 'Führen Sie backlog ranks respace (oder backlog ranks seed bei fehlenden Rängen) aus und wiederholen Sie die Verschiebung.' },
  },
};

/**
 * The `backlog` core plugin: a product backlog compatible with the Obsidian Product Backlog view (backlog-view
 * 0.10.0 with its global rank). The backlog's `.base` view options are its configuration; results come from the
 * `bases` plugin's `bases.query` service, links from the kernel metadata cache, and every write is a guarded
 * Workspace batch. `plugins.settings.backlog.base`/`view` select the default backlog.
 */
export const backlogPlugin: CorePlugin = {
  manifest: {
    id: 'backlog', name: 'Backlog', version: '0.1.0', minAppVersion: '0.1.0', core: true, author: 'The Forge',
    description: 'Plan a product backlog compatible with the Obsidian Product Backlog view: hierarchy, ranks, states, iterations, releases and dependencies.',
  },
  create: () => ({
    requires: ['bases.query'],
    commands: [backlogCommand(context => ({
      bases: (context as PluginContext).services.get<BasesQueryService>('bases.query'),
      ports: { stringifyYaml, editFrontmatter, today },
    }))],
    events,
    skills: [backlogSkill],
    settings: {
      type: 'object', additionalProperties: false,
      properties: {
        base: { type: 'string', minLength: 1, description: 'The default .base file of the backlog command, relative to the command scope.' },
        view: { type: 'string', minLength: 1, description: 'The default product-backlog view of that base.' },
      },
    },
    errors: [
      { code: 'BACKLOG_NOT_FOUND', category: 'not-found', summary: 'The backlog or the backlog item was not found.', hint: 'Create a backlog with backlog init, pass --base and --view, or check the item with backlog list.' },
      { code: 'BACKLOG_AMBIGUOUS', category: 'input', summary: 'The selection matches several backlogs or items.', hint: 'Pick one of error.details.candidates with --base and --view, or pass the full path.' },
      { code: 'BACKLOG_CONFIG_PROBLEM', category: 'input', summary: 'The backlog configuration in the .base file blocks this operation.', hint: 'Fix the problem named in the message in the .base view options, then rerun the command.' },
      { code: 'BACKLOG_WRITE_REFUSED', category: 'conflict', summary: 'The backlog refuses this write.', hint: 'error.details.reason names the rule; choose a fitting item, type or value, or bind the missing property.' },
      { code: 'BACKLOG_NO_GAP', category: 'conflict', summary: 'No rank is free between the neighbours.', hint: 'Run backlog ranks respace (or backlog ranks seed when ranks are missing), then repeat the move.' },
    ],
    strings: { de },
  }),
};
