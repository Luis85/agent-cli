import { dirname, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

const layers = ['domain', 'application', 'infrastructure', 'presentation'] as const;
type Layer = typeof layers[number];
const within = (directory: string, target: string) => target.startsWith(directory + sep);
/** Directories a layer may import within one dependency ring: the kernel or a single core plugin. */
const inward: Record<Layer, readonly Layer[]> = {
  domain: ['domain'], application: ['domain', 'application'],
  infrastructure: ['domain', 'application', 'infrastructure'], presentation: ['domain', 'application', 'presentation'],
};

/**
 * Who `file` is: a kernel layer under `src/<layer>`, a core plugin layer under `src/plugins/<id>/<layer>`, or a
 * core plugin's entry `src/plugins/<id>/plugin.ts`, which wires its own layers like a small composition root.
 */
function classify(file: string): { layer: Layer | 'entry'; plugin?: string } | undefined {
  const parts = relative(resolve('src'), file).split(sep);
  if (parts[0] === 'plugins' && parts.length >= 3) {
    if (parts.length === 3 && parts[2] === 'plugin.ts') return { layer: 'entry', plugin: parts[1]! };
    return (layers as readonly string[]).includes(parts[2]!) ? { layer: parts[2] as Layer, plugin: parts[1]! } : undefined;
  }
  return (layers as readonly string[]).includes(parts[0]!) ? { layer: parts[0] as Layer } : undefined;
}

/** Allowed target directories. Plugins see kernel domain and application, never kernel adapters or other plugins. */
function allowedDirectories(owner: { layer: Layer | 'entry'; plugin?: string }): string[] {
  const kernel = (layer: Layer) => resolve('src', layer);
  if (owner.plugin === undefined) return inward[owner.layer as Layer].map(kernel);
  const own = (layer: Layer) => resolve('src/plugins', owner.plugin!, layer);
  const pluginLayers = owner.layer === 'entry' ? layers : inward[owner.layer];
  // A plugin layer reaches the kernel's contracts at the same depth: plugin domain only kernel domain.
  const kernelLayers = owner.layer === 'domain' ? ['domain' as const] : ['domain' as const, 'application' as const];
  return [...kernelLayers.map(kernel), ...pluginLayers.map(own)];
}

/** Inspect syntax rather than matching text, so every module dependency is checked. */
export function boundaryViolations(file: string, source: string): string[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  // Other entries (the SDK) may reach kernel domain and application only.
  const owner = classify(file) ?? { layer: 'application' as const };
  const isInfrastructure = owner.layer === 'infrastructure', isKernelPresentation = owner.layer === 'presentation' && owner.plugin === undefined;
  const allowed = allowedDirectories(owner);
  const violations: string[] = [];
  const check = (specifier: ts.Node | undefined) => {
    if (!specifier || !ts.isStringLiteralLike(specifier)) {
      if (!isInfrastructure) violations.push('Computed module dependencies cannot prove inward boundaries.');
      return;
    }
    const path = specifier.text;
    const target = resolve(dirname(file), path);
    const external = !path.startsWith('.');
    const approvedExternal = isInfrastructure || (isKernelPresentation && path === 'commander');
    const approvedAsset = (isKernelPresentation && target === resolve('package.json')) || (isInfrastructure && !within(resolve('src'), target));
    if (external ? !approvedExternal : !approvedAsset && !allowed.some(directory => within(directory, target))) {
      violations.push(`${relative(process.cwd(), file)} imports ${path}`);
    }
  };
  visitDependencies(tree, check);
  return violations;
}

function visitDependencies(tree: ts.SourceFile, check: (specifier: ts.Node | undefined) => void): void {
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) check(node.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      check(node.moduleReference.expression);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      check(node.argument.literal);
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      check(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
}

/** The composition root reaches a core plugin only through its `plugin.ts` factory, never its layers. */
export function compositionViolations(file: string, source: string): string[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const violations: string[] = [];
  visitDependencies(tree, specifier => {
    if (!specifier || !ts.isStringLiteralLike(specifier)) return;
    const target = resolve(dirname(file), specifier.text);
    const parts = relative(resolve('src/plugins'), target).split(sep);
    if (within(resolve('src/plugins'), target) && !(parts.length === 2 && parts[1] === 'plugin.ts')) violations.push(`${relative(process.cwd(), file)} imports ${specifier.text}; import src/plugins/<id>/plugin.ts only`);
  });
  return violations;
}

/** SDK consumers receive types only; importing this entry must never start host behavior. */
export function sdkViolations(file: string, source: string): string[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const violations = boundaryViolations(file, source);
  for (const statement of tree.statements) {
    const typeExport = ts.isExportDeclaration(statement) && statement.moduleSpecifier && (
      statement.isTypeOnly || (statement.exportClause && ts.isNamedExports(statement.exportClause) && statement.exportClause.elements.length > 0 && statement.exportClause.elements.every(element => element.isTypeOnly))
    );
    if (!typeExport) violations.push(`${relative(process.cwd(), file)} must contain only type exports from domain or application modules.`);
  }
  return violations;
}
