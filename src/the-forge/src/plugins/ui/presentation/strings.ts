import type { PluginStrings, PluginStringTable } from '../../../application/plugins/plugin-catalog.ts';

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

/** The ui plugin's German manifest and option, argument and settings descriptions, available while it is disabled. */
export const uiStrings: PluginStrings = {
  de: {
    manifest: { name: 'UI-Bibliotheken', description: 'Markdown-Bibliotheken für Komponenten und Interaktionen mit deterministischer UI- und Storybook-Generierung für sieben Ziele.' },
    descriptions: {
      'Root element tag for create.': 'Tag des Wurzelelements für create.',
      'Interaction library directory used to validate component interactions.': 'Verzeichnis der Interaktionsbibliothek, mit dem Komponenteninteraktionen geprüft werden.',
      'Browser event for create.': 'Browserereignis für create.',
      'UI target; defaults to plugins.settings.ui.framework.': 'UI-Ziel; standardmäßig plugins.settings.ui.framework.',
      'Also generate Storybook stories (make ui).': 'Zusätzlich Storybook-Stories generieren (make ui).',
      'Stories output directory; defaults to plugins.settings.ui.stories.': 'Ausgabeverzeichnis der Stories; standardmäßig plugins.settings.ui.stories.',
      'Interaction library directory; defaults to plugins.settings.ui.interactions.': 'Verzeichnis der Interaktionsbibliothek; standardmäßig plugins.settings.ui.interactions.',
      'Default UI target of make ui and make stories.': 'Standard-UI-Ziel von make ui und make stories.',
      'Workspace-relative component library folder.': 'Ordner der Komponentenbibliothek, relativ zum Workspace.',
      'Workspace-relative folder that components import copies definitions from.': 'Ordner relativ zum Workspace, aus dem components import Definitionen kopiert.',
      'Workspace-relative folder that components export copies definitions to.': 'Ordner relativ zum Workspace, in den components export Definitionen kopiert.',
      'Workspace-relative interaction library folder.': 'Ordner der Interaktionsbibliothek, relativ zum Workspace.',
      'Workspace-relative folder that interactions import copies definitions from.': 'Ordner relativ zum Workspace, aus dem interactions import Definitionen kopiert.',
      'Workspace-relative folder that interactions export copies definitions to.': 'Ordner relativ zum Workspace, in den interactions export Definitionen kopiert.',
      'Generated UI folder, relative to the output project (or the workspace without one); {framework} stands for the UI target.': 'Ordner der generierten UI, relativ zum Ausgabeprojekt (ohne Projekt zum Workspace); {framework} steht für das UI-Ziel.',
      'Generated Storybook story folder, relative to the output project (or the workspace without one); {framework} stands for the UI target.': 'Ordner der generierten Storybook-Stories, relativ zum Ausgabeprojekt (ohne Projekt zum Workspace); {framework} steht für das UI-Ziel.',
    },
  },
};
