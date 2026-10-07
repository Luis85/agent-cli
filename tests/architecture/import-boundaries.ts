import { dirname, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

/** Inspect syntax rather than matching text, so every module dependency is checked. */
export function boundaryViolations(file: string, source: string): string[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const domain = resolve('src/the-forge/domain'), application = resolve('src/the-forge/application');
  const infrastructure = resolve('src/the-forge/infrastructure'), presentation = resolve('src/the-forge/presentation');
  const within = (directory: string, target: string) => target.startsWith(directory + sep);
  const isInfrastructure = within(infrastructure, file), isPresentation = within(presentation, file);
  const allowed = within(domain, file) ? [domain] : [domain, application, ...(isInfrastructure ? [infrastructure] : isPresentation ? [presentation] : [])];
  const violations: string[] = [];
  const check = (specifier: ts.Node | undefined) => {
    if (!specifier || !ts.isStringLiteralLike(specifier)) {
      if (!isInfrastructure) violations.push('Computed module dependencies cannot prove inward boundaries.');
      return;
    }
    const path = specifier.text;
    const target = resolve(dirname(file), path);
    const external = !path.startsWith('.');
    const approvedExternal = isInfrastructure || (isPresentation && path === 'commander');
    const approvedAsset = (isPresentation && target === resolve('package.json')) || (isInfrastructure && !within(resolve('src'), target));
    if (external ? !approvedExternal : !approvedAsset && !allowed.some(directory => within(directory, target))) {
      violations.push(`${relative(process.cwd(), file)} imports ${path}`);
    }
  };
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
