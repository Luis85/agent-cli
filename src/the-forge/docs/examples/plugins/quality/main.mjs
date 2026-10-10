const encode = text => new TextEncoder().encode(text);
export default {
  commands: [{
    id: 'quality.check', description: 'Report the number of Markdown notes', usage: 'quality.check',
    async run(args, flags, context) {
      if (args.length) throw new Error('quality.check takes no arguments');
      const paths = await context.app.vault.getMarkdownFiles();
      await context.events.emit('quality.checked', { count: paths.length });
      return { notes: paths.length };
    },
  }, {
    id: 'quality.mark-reviewed', description: 'Mark a note as reviewed in its frontmatter', usage: 'quality.mark-reviewed <note.md>',
    async run(args, flags, context) {
      if (args.length !== 1) throw new Error('quality.mark-reviewed takes one note path');
      // An atomic, revision-guarded frontmatter edit that keeps the body and honours --dry-run.
      return context.app.fileManager.processFrontMatter(args[0], frontmatter => {
        frontmatter.reviewed = true;
        delete frontmatter.draft;
      });
    },
  }],
  generators: [{
    id: 'quality.checklist', description: 'Create an engineering review checklist',
    generate(name, directory) {
      if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) throw new Error('Use a PascalCase name');
      return [{ path: `${directory}/${name}.md`, bytes: encode(`# ${name}\n\n- [ ] Acceptance criteria\n- [ ] Domain invariants\n- [ ] Tests pass\n- [ ] Documentation updated\n`) }];
    },
  }],
  events: [{ id: 'quality.checked', description: 'The quality command counted Markdown notes.', validate: value => value !== null && typeof value === 'object' && Number.isInteger(value.count) }],
  skills: [{ id: 'quality.review', content: '---\nname: quality-review\ndescription: Review an engineering change against a checklist.\n---\n\nRead the acceptance criteria, inspect the diff, test invariants and record the evidence.\n' }],
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
      if (kind === 'file') context.events.warn(`Quality noticed ${oldPath} moved to ${path}; review notes that describe it.`);
    });
  },
  onunload() { this.unsubscribe?.(); this.unsubscribeAll?.(); this.unsubscribeRename?.(); },
};
