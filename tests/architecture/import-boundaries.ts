import { dirname, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

/** Inspect syntax rather than matching text, so every module dependency is checked. */
export function boundaryViolations(file: string, source: string): string[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const domain = resolve('src/domain'), application = resolve('src/application');
  const within = (directory: string, target: string) => target.startsWith(directory + sep);
  const allowed = within(domain, file) ? [domain] : [domain, application];
  const violations: string[] = [];
  const check = (specifier: ts.Node | undefined) => {
    if (!specifier || !ts.isStringLiteralLike(specifier)) {
      violations.push('Computed module dependencies cannot prove inward boundaries.');
      return;
    }
    const path = specifier.text;
    const target = resolve(dirname(file), path);
    if (!path.startsWith('.') || !allowed.some(directory => within(directory, target))) {
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
