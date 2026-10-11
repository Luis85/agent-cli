import type { Language } from '../../../application/plugins/plugin-catalog.ts';
import { retranslate } from '../../../domain/shared/messages.ts';
import { checkMessages, type CheckMessage } from '../domain/messages.ts';

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
  unrankedOne: '1 Eintrag hat keinen Rang und steht zuletzt; führen Sie backlog ranks seed aus.',
  unranked: '{count} Einträge haben keinen Rang und stehen zuletzt; führen Sie backlog ranks seed aus.',
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
