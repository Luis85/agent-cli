import type { InteractionDefinition, InteractionEvent } from '../domain/interaction.ts';

export const defaultInteractionIds = ['toggle-expanded', 'input-value', 'save', 'upload', 'download'] as const;

/** Default browser workflows have explicit storage destinations and no invented upload endpoint. */
export function starterInteraction(directory: string, id: string, event?: InteractionEvent): InteractionDefinition {
  const base = { schemaVersion: 1 as const, id, sourcePath: `${directory}/${id}.md` };
  if (id === 'save') return {
    ...base, event: event ?? 'submit', preventDefault: true, actions: [{ type: 'save-form', key: 'forge-form' }],
    description: '# Save form locally\n\nAttach to a form submit. Stores named fields as JSON in this browser origin\'s localStorage under forge-form. Change key to namespace drafts. File fields store metadata, not file contents. Listen for forge:save or forge:interaction-error.\n',
  };
  if (id === 'upload') return {
    ...base, event: event ?? 'submit', preventDefault: true, actions: [{ type: 'upload-form', url: '{{uploadUrl}}' }],
    description: '# Upload form\n\nAttach to a form submit and declare a required string uploadUrl component prop pointing to your endpoint. POSTs FormData including file bytes; no endpoint is invented. Listen for forge:upload or forge:interaction-error.\n',
  };
  if (id === 'download') return {
    ...base, event: event ?? 'click', preventDefault: true, actions: [{ type: 'download-form', filename: 'form-data.json' }],
    description: '# Download form JSON\n\nAttach to a button associated with a form. Downloads named fields as form-data.json; repeated names become arrays and file fields include metadata only. Listen for forge:download or forge:interaction-error.\n',
  };
  const selected = event ?? (id === 'input-value' ? 'input' : 'click');
  const input = selected === 'input' || selected === 'change';
  return { ...base, event: selected,
    description: `# ${id}\n\n${input ? 'Copies the input value into string state named value.' : 'Toggles boolean state named expanded.'} Declare that state on each consuming component.\n`,
    actions: input ? [{ type: 'set-state', state: 'value', fromEvent: 'value' }] : [{ type: 'toggle-state', state: 'expanded' }],
  };
}
