const encode = text => new TextEncoder().encode(text);
export default {
  manifest: { id: 'quality', version: '1.0.0', apiVersion: 1 },
  commands: [{
    id: 'quality.check', description: 'Report the number of Markdown notes', usage: 'quality.check',
    async run(args, flags, context) {
      if (args.length) throw new Error('quality.check takes no arguments');
      const paths = (await context.workspace.files.list()).filter(path => path.endsWith('.md'));
      await context.events.emit('quality.checked', { count: paths.length });
      return { notes: paths.length };
    },
  }],
  generators: [{
    id: 'quality.checklist', description: 'Create an engineering review checklist',
    generate(name, directory) {
      if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) throw new Error('Use a PascalCase name');
      return [{ path: `${directory}/${name}.md`, bytes: encode(`# ${name}\n\n- [ ] Acceptance criteria\n- [ ] Domain invariants\n- [ ] Tests pass\n- [ ] Documentation updated\n`) }];
    },
  }],
  events: [{ id: 'quality.checked', validate: value => value !== null && typeof value === 'object' && Number.isInteger(value.count) }],
  skills: [{ id: 'quality.review', content: '---\nname: quality-review\ndescription: Review an engineering change against a checklist.\n---\n\nRead the acceptance criteria, inspect the diff, test invariants and record the evidence.\n' }],
  activate(context) {
    return context.events.on('quality.checked', payload => {
      if (payload.count === 0) context.events.warn('No Markdown notes found.');
    });
  },
};
