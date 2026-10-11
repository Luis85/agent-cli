import type { PluginStringTable } from '../../../application/plugins/plugin-catalog.ts';

/** The library actions of `components` and `interactions`, for one German noun (genitive plural). */
function libraryActions(command: string, noun: string): Record<string, string> {
  return {
    [`${command} list`]: `Die ${noun}definitionen der Bibliothek auflisten.`,
    [`${command} init`]: `Die Bibliothek mit ${noun}definitionen als Ausgangspunkt anlegen.`,
    [`${command} inspect`]: `Eine geparste ${noun}definition zurückgeben.`,
    [`${command} validate`]: `Jede ${noun}definition prüfen.`,
    [`${command} create`]: `Eine neue ${noun}definition anlegen.`,
    [`${command} import`]: `${noun}definitionen aus dem Importverzeichnis in die Bibliothek kopieren.`,
    [`${command} export`]: `Die ${noun}definitionen der Bibliothek in das Exportverzeichnis kopieren.`,
  };
}

/** German descriptions of the ui plugin's commands, actions and generators, and its empty-library guidance. */
export const de: PluginStringTable = {
  commands: {
    components: 'Markdown-Komponenten verwalten, prüfen, importieren und exportieren.',
    interactions: 'Wiederverwendbare Markdown-Interaktionen für ausführbares UI-Verhalten verwalten.',
  },
  actions: { ...libraryActions('components', 'Komponenten'), ...libraryActions('interactions', 'Interaktions') },
  generators: {
    ui: 'Deterministischen UI-Code aus Markdown-Komponentendefinitionen generieren.',
    stories: 'Native Storybook-CSF-Stories für vorhandene UI-Komponenten generieren.',
  },
  messages: { emptyLibrary: 'Führen Sie {command} init --library {directory} aus oder fügen Sie eine Markdown-Definition hinzu.' },
};
