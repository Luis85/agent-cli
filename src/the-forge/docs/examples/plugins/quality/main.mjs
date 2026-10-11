const encode = text => new TextEncoder().encode(text);
export default {
  // Plugin contract v2: a validated config section at plugins.settings.quality, with defaults.
  settings: {
    type: 'object', additionalProperties: false,
    properties: {
      ownerProperty: { type: 'string', minLength: 1, default: 'owner', description: 'Frontmatter property that names a note\'s owner.' },
    },
  },
  // Registered failure codes carry a category, hint and retryability like built-in ones.
  errors: [{ code: 'QUALITY_UNOWNED', category: 'drift', summary: 'Some notes have no owner.', hint: 'Add the owner property named in error.details.property to each note in error.details.notes.' }],
  strings: {
    en: { messages: { moved: 'Quality noticed {from} moved to {to}; review notes that describe it.', settings: 'Quality settings changed; owner property is now {property}.' } },
    de: {
      commands: {
        'quality.check': 'Die Anzahl der Markdown-Notizen melden',
        'quality.mark-reviewed': 'Eine Notiz in ihrem Frontmatter als geprüft markieren',
        'quality.owners': 'Notizen ohne Verantwortliche finden',
      },
      generators: { 'quality.checklist': 'Eine Checkliste für die technische Prüfung erstellen' },
      events: { 'quality.checked': 'Der Qualitätsbefehl hat Markdown-Notizen gezählt.' },
      errors: { QUALITY_UNOWNED: { summary: 'Einige Notizen haben keine Verantwortlichen.', hint: 'Ergänzen Sie die in error.details.property genannte Eigenschaft in jeder Notiz aus error.details.notes.' } },
      messages: { moved: 'Quality hat bemerkt, dass {from} nach {to} verschoben wurde; prüfen Sie Notizen, die es beschreiben.', settings: 'Die Quality-Einstellungen haben sich geändert; die Eigenschaft für Verantwortliche ist jetzt {property}.' },
    },
  },
  commands: [{
    id: 'quality.check', description: 'Report the number of Markdown notes', usage: 'quality.check', mutating: false,
    async run(args, flags, context) {
      if (args.length) throw new Error('quality.check takes no arguments');
      const paths = await context.app.vault.getMarkdownFiles();
      await context.events.emit('quality.checked', { count: paths.length });
      return { notes: paths.length };
    },
  }, {
    id: 'quality.mark-reviewed', description: 'Mark a note as reviewed in its frontmatter', usage: 'quality.mark-reviewed <note.md>',
    args: [{ name: 'note', description: 'Markdown note to mark as reviewed.', required: true }],
    async run(args, flags, context) {
      if (args.length !== 1) throw new Error('quality.mark-reviewed takes one note path');
      // An atomic, revision-guarded frontmatter edit that keeps the body and honours --dry-run.
      return context.app.fileManager.processFrontMatter(args[0], frontmatter => {
        frontmatter.reviewed = true;
        delete frontmatter.draft;
      });
    },
  }, {
    id: 'quality.owners', description: 'Find Markdown notes without an owner', usage: 'quality.owners', mutating: false, errors: ['QUALITY_UNOWNED'],
    async run(args, flags, context) {
      if (args.length) throw new Error('quality.owners takes no arguments');
      const property = context.settings.ownerProperty, unowned = [];
      for (const path of await context.app.vault.getMarkdownFiles()) {
        const cache = await context.app.metadataCache.getFileCache(path);
        if (cache?.frontmatter?.[property] === undefined) unowned.push(path);
      }
      if (unowned.length) throw Object.assign(new Error(`${unowned.length} notes have no ${property}.`), { code: 'QUALITY_UNOWNED', details: { property, notes: unowned } });
      return { property, unowned };
    },
  }],
  generators: [{
    id: 'quality.checklist', description: 'Create an engineering review checklist', directory: 'notes',
    generate({ name, directory }) {
      if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) throw new Error('Use a PascalCase name');
      return [{ path: `${directory}/${name}.md`, bytes: encode(`# ${name}\n\n- [ ] Acceptance criteria\n- [ ] Domain invariants\n- [ ] Tests pass\n- [ ] Documentation updated\n`) }];
    },
  }],
  events: [{ id: 'quality.checked', description: 'The quality command counted Markdown notes.', validate: value => value !== null && typeof value === 'object' && Number.isInteger(value.count) }],
  skills: [{ id: 'quality-review', content: '---\nname: quality-review\ndescription: Review an engineering change against a checklist. Use when a change is ready for review.\n---\n\nRead the acceptance criteria, inspect the diff, test invariants and record the evidence.\n' }],
  async onload(context) {
    // Replay is an explicit snapshot of this invocation, not persistent history.
    const observe = record => {
      if (record.id === 'operation.failed' || record.id === 'claude.failed') {
        context.events.warn(`Quality observed ${record.id}: ${record.payload.error.code}. Inspect the original error and committed state before retrying.`);
      }
    };
    await context.events.replay(observe);
    this.unsubscribeAll = context.events.onAny(observe);
    this.unsubscribe = context.events.on('quality.checked', payload => {
      if (payload.count === 0) context.events.warn('No Markdown notes found.');
    });
    // Obsidian-style vault listener: `move` and `rename` report each moved file with its old path.
    this.unsubscribeRename = context.app.vault.on('rename', ({ path, oldPath, kind }) => {
      if (kind === 'file') context.events.warn(context.t('moved').replace('{from}', oldPath).replace('{to}', path));
    });
  },
  // Runs on activation when plugins.settings.quality changed since the previous activation.
  onExternalSettingsChange(context) {
    context.events.warn(context.t('settings').replace('{property}', context.settings.ownerProperty));
  },
  onunload() { this.unsubscribe?.(); this.unsubscribeAll?.(); this.unsubscribeRename?.(); },
};
