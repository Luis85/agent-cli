import type { CorePlugin } from '../../application/plugins/core-plugins.ts';
import type { CommandContext } from '../../application/plugins/registry.ts';
import { templateInstallerService, type TemplateInstallerService } from '../../application/workspace/setup.ts';
import { MarkdownTemplates } from './infrastructure/markdown.ts';
import { setupTemplates, workflowTemplates } from './infrastructure/pack.ts';
import { templatesCommand } from './presentation/command.ts';
import { documentGenerator } from './presentation/document.ts';

const installer: TemplateInstallerService = { setupTemplates: () => setupTemplates };

/**
 * The `templates` core plugin: the shared Markdown templates in the workspace's bin/templates, the `templates`
 * command, the `make document` generator and the planning workflow pack. It provides `templates.installer`, which
 * `setup` uses to install the starter templates; disabling the plugin makes `setup` skip them with a warning.
 * `plugins.settings.templates.dateFormat` and `timeFormat` set the default dayjs formats of date placeholders.
 */
export const templatesPlugin: CorePlugin = {
  manifest: {
    id: 'templates', name: 'Templates', version: '0.1.0', minAppVersion: '0.1.0', core: true, author: 'The Forge',
    description: 'Render Obsidian Markdown templates into documents and install the planning workflow pack.',
  },
  create: () => {
    // Templates split Markdown at its frontmatter with the invocation's document codec.
    const templates = (context: CommandContext) => new MarkdownTemplates(text => context.workspace.codec.markdownParts(text));
    return {
      commands: [templatesCommand(templates, workflowTemplates)],
      generators: [documentGenerator(templates)],
      provides: { [templateInstallerService]: installer },
      settings: {
        type: 'object', additionalProperties: false,
        properties: {
          dateFormat: { type: 'string', minLength: 1, default: 'YYYY-MM-DD', description: 'dayjs format of {{date}} placeholders without their own format.' },
          timeFormat: { type: 'string', minLength: 1, default: 'HH:mm', description: 'dayjs format of {{time}} placeholders without their own format.' },
        },
      },
      strings: {
        de: {
          commands: { templates: 'Markdown-Vorlagen und Pflichtfelder entdecken oder das Planungspaket installieren.' },
          actions: {
            'templates list': 'Die bearbeitbaren Markdown-Vorlagen in bin/templates auflisten.',
            'templates inspect': 'Die erforderlichen und optionalen Werte einer Vorlage melden.',
            'templates install': 'Das Vorlagenpaket für den Planungsablauf in bin/templates installieren.',
          },
          generators: { document: 'Obsidian-Markdown-/Frontmatter-Vorlagen mit typisierten Werten rendern.' },
        },
      },
    };
  },
};
