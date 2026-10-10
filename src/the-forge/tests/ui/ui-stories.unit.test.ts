import { describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { uiFrameworks, type UiDefinition, type UiFramework } from '../../src/domain/ui/definition.ts';
import { renderUiStories } from '../../src/infrastructure/ui/stories.ts';

const button: UiDefinition = {
  schemaVersion: 1, id: 'action-button', name: 'ActionButton', sourcePath: 'library/action-button.md',
  description: '# Action button\n\nUse **one** primary action.',
  props: {
    label: { type: 'string', default: 'Save', description: 'Accessible label' },
    disabled: { type: 'boolean', default: false },
    count: { type: 'number', required: true },
  },
  root: { tag: 'button', attrs: { disabled: '{{disabled}}' }, text: '{{label}}' },
};

function source(definition = button, framework: UiFramework = 'html', ui = 'apps/client/src/components', stories = 'docs/stories'): string {
  const [file] = renderUiStories([definition], framework, ui, stories);
  return new TextDecoder().decode(file!.bytes);
}

function evaluate(code: string, extensions: Record<string, unknown> = {}) {
  const rendered = (args: unknown) => ({ rendered: args });
  const exported: Record<string, any> = {};
  const compiled = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true,
  });
  expect(compiled.diagnostics).toEqual([]);
  runInNewContext(compiled.outputText, {
    exports: exported,
    require: (path: string) => path.includes('extensions') ? extensions : { default: rendered, ActionButtonComponent: rendered },
  });
  return exported;
}

describe('native CSF3 Storybook generation', () => {
  it.each(uiFrameworks)('emits valid TypeScript and native %s metadata using relative component imports', framework => {
    const code = source(button, framework);
    const packageName = ({ html: 'html', htmx: 'html', vanilla: 'html', react: 'react', vue: 'vue3', svelte: 'svelte', angular: 'angular' })[framework];
    expect(code).toContain(`from "@storybook/${packageName}"`);
    const extension = ({ html: '.js', htmx: '.js', vanilla: '.js', react: '', vue: '.vue', svelte: '.svelte', angular: '' })[framework];
    expect(code).toContain(`from "../../apps/client/src/components/action-button${extension}"`);
    const emitted = evaluate(code);
    expect(emitted.default.title).toBe('Components/ActionButton');
    expect(emitted.default.args).toEqual({ count: 0, disabled: false, label: 'Save' });
    expect(emitted.Default).toEqual({});
    if (['html', 'htmx', 'vanilla'].includes(framework)) {
      expect(emitted.default.render({ label: 'Changed' })).toEqual({ rendered: { label: 'Changed' } });
      expect(emitted.default.component).toBeUndefined();
    } else {
      expect(typeof emitted.default.component).toBe('function');
      expect(emitted.default.render).toBeUndefined();
    }
  });

  it('merges Markdown docs, default controls, and declarative CSF metadata', () => {
    const definition: UiDefinition = { ...button, storybook: {
      title: 'Actions/Save', tags: ['autodocs', 'test'], args: { label: 'Submit' },
      argTypes: { label: { control: 'select', options: ['Submit', 'Send'] } },
      parameters: { layout: 'centered', docs: { toc: true, description: { story: 'A story note' } } },
      stories: [
        { name: 'Primary', args: { disabled: false }, parameters: { viewport: { defaultViewport: 'mobile1' } }, tags: ['!test'] },
        { name: 'Disabled', args: { disabled: true } },
      ],
    } };
    const emitted = evaluate(source(definition));
    expect(emitted.default).toMatchObject({
      title: 'Actions/Save', tags: ['autodocs', 'test'],
      args: { count: 0, disabled: false, label: 'Submit' },
      argTypes: { label: { control: 'select' }, disabled: { control: 'boolean' }, count: { control: 'number', type: { name: 'number', required: true } } },
      parameters: { layout: 'centered', docs: { toc: true, description: { component: button.description, story: 'A story note' } } },
    });
    expect(emitted.Primary).toEqual({
      args: { disabled: false }, parameters: { viewport: { defaultViewport: 'mobile1' } }, tags: ['!test'],
    });
    expect(emitted.Disabled).toEqual({ args: { disabled: true } });
    expect(emitted.Default).toBeUndefined();
    expect(evaluate(source()).default.argTypes.label.description).toBe('Accessible label');
  });

  it('keeps title and tags statically indexable and uses each renderer’s StoryObj contract', () => {
    const syntax = ts.createSourceFile('button.stories.ts', source(), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const declaration = syntax.statements.filter(ts.isVariableStatement).flatMap(statement => [...statement.declarationList.declarations])
      .find(item => ts.isIdentifier(item.name) && item.name.text === 'meta')!;
    expect(ts.isSatisfiesExpression(declaration.initializer!)).toBe(true);
    const expression = (declaration.initializer as ts.SatisfiesExpression).expression as ts.ObjectLiteralExpression;
    const title = expression.properties.find(property => property.name && ts.isIdentifier(property.name) && property.name.text === 'title') as ts.PropertyAssignment;
    const tags = expression.properties.find(property => property.name && ts.isIdentifier(property.name) && property.name.text === 'tags') as ts.PropertyAssignment;
    expect(ts.isStringLiteral(title.initializer)).toBe(true);
    expect(ts.isArrayLiteralExpression(tags.initializer)).toBe(true);
    expect(source()).toContain('type _Story = _StoryObj<NonNullable<Parameters<typeof component>[0]>>');
    expect(source(button, 'angular')).toContain('type _Story = _StoryObj<InstanceType<typeof component>>');
    for (const framework of ['react', 'vue', 'svelte'] as const) expect(source(button, framework)).toContain('type _Story = _StoryObj<typeof meta>');
  });

  it.each(['html', 'htmx', 'vanilla'] as const)('retains optional props without defaults in %s story args', framework => {
    const definition: UiDefinition = { ...button,
      props: { count: { type: 'number', default: 1 }, label: { type: 'string' }, required: { type: 'boolean', required: true } },
      root: { slot: 'children' },
      storybook: { stories: [{ name: 'Optional', args: { label: 'Optional label' } }] },
    };
    const code = source(definition, framework);
    expect(code).toContain('satisfies _Meta<NonNullable<Parameters<typeof component>[0]>>');
    expect(code).toContain('type _Story = _StoryObj<NonNullable<Parameters<typeof component>[0]>>');
    const emitted = evaluate(code);
    expect(emitted.Optional.args).toEqual({ label: 'Optional label' });
    expect(emitted.default.args).toEqual({ count: 1, required: false });
  });

  it('preserves arbitrary native hooks at meta and individual story scope', () => {
    const play = async () => 'played';
    const beforeEach = () => () => 'cleanup';
    const render = () => 'custom';
    const decorator = () => 'decorated';
    const loader = async () => ({ loaded: true });
    const definition: UiDefinition = { ...button, storybook: {
      extension: 'storybook/extensions/action-button.ts',
      stories: [{ name: 'Default', args: { label: 'Plain' } }, { name: 'Component' }, { name: 'Meta' }],
    } };
    const code = source(definition);
    expect(code).toContain('from "../../storybook/extensions/action-button"');
    const emitted = evaluate(code, {
      meta: { decorators: [decorator], loaders: [loader], beforeEach, render, parameters: { customAddon: { enabled: true } } },
      stories: { Default: { play, loaders: [loader], args: { label: 'Extension' } }, Component: { beforeEach } },
    });
    expect(emitted.default.decorators[0]).toBe(decorator);
    expect(emitted.default.loaders[0]).toBe(loader);
    expect(emitted.default.beforeEach).toBe(beforeEach);
    expect(emitted.default.render).toBe(render);
    expect(emitted.default.parameters).toEqual({ customAddon: { enabled: true } });
    expect(emitted.Default.play).toBe(play);
    expect(emitted.Default.loaders[0]).toBe(loader);
    expect(emitted.Default.args).toEqual({ label: 'Extension' });
    expect(emitted.Component.beforeEach).toBe(beforeEach);
    expect(emitted.Meta).toEqual({});
    expect(evaluate(code).Default.args).toEqual({ label: 'Plain' });
  });

  it('keeps generation deterministic when mapping insertion order or definition order changes', () => {
    const other = { ...button, id: 'another-button', props: Object.fromEntries(Object.entries(button.props).reverse()) };
    const files = renderUiStories([button, other], 'react', 'src/ui', 'stories');
    expect(files).toEqual(renderUiStories([other, button], 'react', 'src/ui', 'stories'));
    expect(source(button)).toBe(source({ ...button, props: other.props }));
    expect(files.map(file => file.path)).toEqual(['stories/action-button.stories.ts', 'stories/another-button.stories.ts']);
  });

  it('keeps data literal strings inert and preserves unusual parameter keys', () => {
    const description = '` ${globalThis.unwanted = true} </script> \\ \u2028';
    const parameters = JSON.parse('{"__proto__":{"enabled":true},"addon":{"text":"${process.exit()}"}}');
    const emitted = evaluate(source({ ...button, description, storybook: { parameters } }));
    expect(emitted.default.parameters.docs.description.component).toBe(description);
    expect(Object.hasOwn(emitted.default.parameters, '__proto__')).toBe(true);
    expect(emitted.default.parameters.__proto__).toEqual({ enabled: true });
  });

  it('supports colocated stories and validates output and extension paths', () => {
    expect(source(button, 'vue', 'ui', 'ui')).toContain('from "./action-button.vue"');
    expect(() => source(button, 'html', '../outside')).toThrow();
    expect(() => source(button, 'html', 'ui', '/tmp/outside')).toThrow();
    expect(() => source({ ...button, storybook: { extension: '../extensions.ts' } })).toThrow();
  });
});
