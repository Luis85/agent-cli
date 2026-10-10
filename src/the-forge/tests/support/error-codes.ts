import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import ts from 'typescript';

/**
 * Static inventory of the failure codes Forge source can throw.
 *
 * Error sites are `ensure(condition, CODE, ...)` and `forgeError(CODE, ...)`. A code argument resolves to
 * string literals through these rules only:
 * - a string literal is a code;
 * - `a ? b : c` and parentheses resolve each branch;
 * - an identifier resolves through its same-file `const` initializer, or, for a function parameter, through
 *   its literal union type annotation, its default value and every same-file call of that function.
 * Anything else is reported as unresolved, so a new indirection must stay explainable by these rules.
 * Direct `new AppError(...)` outside the error module is reported because it bypasses the catalog's exit codes.
 */
export interface ErrorCodeInventory {
  codes: Map<string, string[]>;
  unresolved: string[];
  directConstructions: string[];
}

type FunctionLike = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression | ts.MethodDeclaration;

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.filter(entry => entry.name !== '.forge').map(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : Promise.resolve(path.endsWith('.ts') ? [path] : []);
  }));
  return nested.flat().sort();
}

function functionName(node: FunctionLike): string | undefined {
  if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name) return node.name.getText();
  if (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) return node.parent.name.text;
  return undefined;
}

function calls(source: ts.SourceFile, name: string): ts.CallExpression[] {
  const found: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const called = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined;
      if (called === name) found.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function declaration(identifier: ts.Identifier): ts.ParameterDeclaration | ts.VariableDeclaration | undefined {
  for (let scope: ts.Node | undefined = identifier.parent; scope; scope = scope.parent) {
    if (ts.isFunctionLike(scope)) {
      const parameter = scope.parameters.find(item => ts.isIdentifier(item.name) && item.name.text === identifier.text);
      if (parameter) return parameter;
    }
    let variable: ts.VariableDeclaration | undefined;
    const visit = (node: ts.Node): void => {
      if (variable || (node !== scope && ts.isFunctionLike(node))) return;
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === identifier.text) variable = node;
      else ts.forEachChild(node, visit);
    };
    if (ts.isBlock(scope) || ts.isSourceFile(scope) || ts.isArrowFunction(scope)) ts.forEachChild(scope, visit);
    if (variable) return variable;
  }
  return undefined;
}

function resolveCode(expression: ts.Expression, source: ts.SourceFile, seen: Set<ts.Node>): string[] | undefined {
  if (seen.has(expression)) return [];
  seen.add(expression);
  if (ts.isStringLiteralLike(expression)) return [expression.text];
  if (ts.isParenthesizedExpression(expression)) return resolveCode(expression.expression, source, seen);
  if (ts.isConditionalExpression(expression)) {
    const branches = [resolveCode(expression.whenTrue, source, seen), resolveCode(expression.whenFalse, source, seen)];
    return branches.every(Boolean) ? branches.flat() as string[] : undefined;
  }
  if (!ts.isIdentifier(expression)) return undefined;
  const declared = declaration(expression);
  if (!declared) return undefined;
  if (ts.isVariableDeclaration(declared)) return declared.initializer ? resolveCode(declared.initializer, source, seen) : undefined;
  if (seen.has(declared)) return [];
  seen.add(declared);
  const type = declared.type;
  if (type && ts.isUnionTypeNode(type) && type.types.every(item => ts.isLiteralTypeNode(item) && ts.isStringLiteral(item.literal))) {
    return type.types.map(item => ((item as ts.LiteralTypeNode).literal as ts.StringLiteral).text);
  }
  const owner = declared.parent as FunctionLike;
  const name = functionName(owner);
  const index = owner.parameters.indexOf(declared);
  const sites = name ? calls(source, name).filter(call => call.arguments[index] !== undefined) : [];
  const candidates = [...(declared.initializer ? [declared.initializer] : []), ...sites.map(call => call.arguments[index]!)];
  if (candidates.length === 0) return undefined;
  const resolved = candidates.map(candidate => resolveCode(candidate, source, seen));
  return resolved.every(Boolean) ? resolved.flat() as string[] : undefined;
}

export async function inventoryErrorCodes(root: string): Promise<ErrorCodeInventory> {
  const inventory: ErrorCodeInventory = { codes: new Map(), unresolved: [], directConstructions: [] };
  for (const path of await sourceFiles(root)) {
    const source = ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true);
    const location = (node: ts.Node) => `${relative(root, path)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;
    // The error module defines the helpers and forwards their typed parameters.
    if (path.endsWith(join('domain', 'shared', 'errors.ts'))) continue;
    const visit = (node: ts.Node): void => {
      if (ts.isNewExpression(node) && node.expression.getText(source) === 'AppError') inventory.directConstructions.push(location(node));
      const callee = ts.isCallExpression(node) ? node.expression.getText(source) : undefined;
      const argument = callee === 'ensure' ? (node as ts.CallExpression).arguments[1] : callee === 'forgeError' ? (node as ts.CallExpression).arguments[0] : undefined;
      if (argument) {
        const codes = resolveCode(argument, source, new Set());
        if (!codes) inventory.unresolved.push(`${location(node)} ${argument.getText(source)}`);
        for (const code of codes ?? []) inventory.codes.set(code, [...inventory.codes.get(code) ?? [], location(node)]);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return inventory;
}
