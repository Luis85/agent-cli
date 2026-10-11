import type { Language } from '../../../application/plugins/plugin-catalog.ts';
import { retranslate } from '../../../domain/shared/messages.ts';
import { checkMessages, syncMessages, type CheckMessage, type SyncMessage } from '../domain/messages.ts';

/** German `backlog check` problems; `{…}` placeholders keep note titles, keys and values as written. */
export const germanCheckMessages: Record<CheckMessage, string> = {
  parentCycle: '{title} schließt eine Schleife über übergeordnete Einträge; die Schleife wird hier aufgetrennt und die Notiz erscheint als Wurzel.',
  unresolvedParent: 'Der übergeordnete Eintrag von {title} verweist auf keine geladene Notiz.',
  dependencyCycle: '{title} hängt von {target} ab, womit sich eine Abhängigkeitsschleife schließt.',
  unresolvedDependency: '{title} hängt von {target} ab, das auf keinen geladenen Eintrag verweist.',
  brokenIteration: 'Die Iteration von {title} ({iteration}) ist keine Iteration-Notiz.',
  brokenAssignee: 'Die Zuweisung von {title} ({assignee}) ist keine Resource-Notiz.',
  fieldNotHeldUntyped: 'Der Eintrag {title} darf mit diesem Typ {key} nicht enthalten.',
  fieldNotHeld: 'Der {type}-Eintrag {title} darf {key} nicht enthalten.',
  unreadableValue: '{title} hat einen unlesbaren Wert in {key}; das Plugin lässt ihn unberücksichtigt.',
  reversedSpan: '{title} beginnt nach seinem Zieldatum.',
  unresolvedMembership: 'Die Release-Zugehörigkeit von {path} verweist nicht auf genau eine Release-Notiz dieser Base.',
  rankTie: '{count} Einträge teilen sich den Rang {rank}; Gleichstände folgen der Ergebnisreihenfolge.',
  unrankedOne: '1 Eintrag hat keinen Rang und steht am Ende; führen Sie backlog ranks seed aus.',
  unranked: '{count} Einträge haben keinen Rang und stehen am Ende; führen Sie backlog ranks seed aus.',
  sharedKey: 'Die Eigenschaften {roles} verwenden alle den Schlüssel "{key}".',
  sharedReleaseKey: 'Die Release-Eigenschaften {roles} verwenden alle den Schlüssel "{key}".',
  releasedDateIsTarget: 'Das Veröffentlichungsdatum und das Zieldatum verwenden denselben Schlüssel "{key}".',
  releasedTransition: 'Der Übergangswert "{value}" für veröffentlichte Releases ist keiner der Statuswerte für veröffentlicht.',
  membershipCollision: 'Der Schlüssel der Release-Zugehörigkeit "{key}" ist auch die Eigenschaft {role}.',
};

/** A `backlog check` result with its problem messages in the response language; Bases warnings arrive localized. */
export function localizedCheck<T extends { problems: ReadonlyArray<{ message: string }> }>(result: T, language: Language): T {
  if (language === 'en') return result;
  return { ...result, problems: result.problems.map(problem => ({ ...problem, message: retranslate(problem.message, checkMessages, germanCheckMessages) })) };
}

/** German `backlog sync` skip reasons and failures; ids, paths, fields and values stay as written. */
export const germanSyncMessages: Record<SyncMessage, string> = {
  duplicateLinkCopy: '{holder} synchronisiert bereits das Remote-Element {id}; entfernen oder ändern Sie {property} in dieser Kopie',
  duplicateLinkNotes: '{count} Notizen verweisen auf das Remote-Element {id}; behalten Sie {property} in nur einer davon',
  duplicateLink: '{holder} synchronisiert bereits das Remote-Element {id}',
  unmappedType: 'der Typ {type} hat keine Zuordnung zu einem Remote-Typ',
  untyped: 'die Notiz hat keinen Typ und damit keine Zuordnung zu einem Remote-Typ',
  foreignLink: '{property} verweist auf ein Element einer anderen Verbindung',
  remoteFormatUnknown: 'die Remote-Beschreibung wurde geändert, ist aber nicht als Markdown bekannt und wird daher nicht übernommen; bearbeiten Sie die Notiz oder führen Sie backlog sync resolve mit --field description aus',
  unexpressible: '{field} der Notiz lässt sich auf dieser Verbindung nicht ausdrücken, daher wird der Remote-Wert nicht darüber übernommen',
  unreadableRemote: 'das Remote-Feld {field} ist nicht lesbar, daher wird der Wert der Notiz nicht darüber übertragen',
  remoteMissing: 'das Remote-Element {id} existiert nicht mehr oder ist nicht lesbar',
  serverKept: 'die Plattform hat {stored} statt {sent} gespeichert; die nächste Synchronisierung überträgt den Wert der Notiz erneut',
  serverApplied: 'die Plattform hat {value} übernommen; ein Pull übernimmt den Wert in die Notiz',
  notCreated: 'noch nicht synchronisiert; ein Push legt das Element an',
  predecessorNotCreated: 'ein Vorgänger wurde in diesem Lauf nicht angelegt; die Verknüpfungen folgen bei der nächsten Synchronisierung',
  unmappedRemoteType: 'der Remote-Typ {type} hat keine lokale Typzuordnung; ergänzen Sie ihn in mappings.types',
  unsyncedParent: 'das übergeordnete Remote-Element {parent} wird auf dieser Verbindung nicht synchronisiert',
  unsyncedDependency: 'der Remote-Vorgänger {ids} wird auf dieser Verbindung nicht synchronisiert',
  missingIteration: 'keine Iteration-Notiz heißt {name}',
  titleTaken: '{path} existiert bereits',
  remoteChanged: 'Das Remote-Element wurde während der Synchronisierung geändert; führen Sie die Synchronisierung erneut aus.',
  linksChanged: 'Die Verknüpfungen des Remote-Elements wurden während der Aktualisierung auf der anderen Seite geändert, sodass möglicherweise eine Verknüpfung anstelle einer anderen entfernt wurde. Die nächste Synchronisierung meldet den übergeordneten Eintrag und die Abhängigkeiten als Konflikte, wo sich beide Seiten unterscheiden; vergleichen Sie sie und führen Sie backlog sync resolve aus.',
};

const syncText = (text: string) => retranslate(text, syncMessages, germanSyncMessages);
type SyncResult = { views: ReadonlyArray<{ skipped: ReadonlyArray<{ reason: string }>; failed: ReadonlyArray<{ message: string }> }> };

/** A `backlog sync` result with its skip reasons and Forge's own failure messages in the response language. */
export function localizedSync<T extends SyncResult>(result: T, language: Language): T {
  if (language === 'en') return result;
  return {
    ...result,
    views: result.views.map(view => ({
      ...view,
      skipped: view.skipped.map(skip => ({ ...skip, reason: syncText(skip.reason) })),
      failed: view.failed.map(failure => ({ ...failure, message: syncText(failure.message) })),
    })),
  };
}
