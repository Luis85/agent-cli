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
 *   its literal union (or single literal) type annotation (inline or a same-file type alias), its default value and every same-file
 *   call of that function.
 * Anything else is reported as unresolved, so a new indirection must stay explainable by these rules.
 * Direct `new AppError(...)` outside the error module is reported because it bypasses the catalog's exit codes.
 *
 * `coded` lists the plugin-style failures, `Object.assign(new Error(message), { code })`, whose `code` resolves by
 * the same rules; a plugin's error helper typed with its code union therefore counts every code of that union.
 * `forwarded` lists the calls, in any file, that pass a literal code to a function whose code parameter (typed as
 * a literal union) reaches one of these sites, such as `generation.check(writes, 'UI_DRIFT')` or
 * `backlogError('SYNC_INTERRUPTED', ...)`: the caller's file raises that code.
 */
export interface ErrorCodeInventory {
  codes: Map<string, string[]>;
  coded: Map<string, string[]>;
  forwarded: Map<string, string[]>;
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

/** The members of a string literal union (or a single string literal type), written inline or as a same-file type alias. */
function literalUnion(type: ts.TypeNode | undefined, source: ts.SourceFile): string[] | undefined {
  if (type && ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)) {
    const name = type.typeName.text;
    const alias = source.statements.find((statement): statement is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(statement) && statement.name.text === name);
    return alias ? literalUnion(alias.type, source) : undefined;
  }
  if (type && ts.isLiteralTypeNode(type) && ts.isStringLiteral(type.literal)) return [type.literal.text];
  if (!type || !ts.isUnionTypeNode(type) || !type.types.every(item => ts.isLiteralTypeNode(item) && ts.isStringLiteral(item.literal))) return undefined;
  return type.types.map(item => ((item as ts.LiteralTypeNode).literal as ts.StringLiteral).text);
}

/** The `code` property of `Object.assign(new Error(...), { code, ... })`, a plugin's coded failure. */
function codedErrorCode(node: ts.Node, source: ts.SourceFile): ts.Expression | undefined {
  if (!ts.isCallExpression(node) || node.expression.getText(source) !== 'Object.assign' || node.arguments.length < 2) return undefined;
  const [target, properties] = node.arguments;
  if (!ts.isNewExpression(target!) || target.expression.getText(source) !== 'Error' || !ts.isObjectLiteralExpression(properties!)) return undefined;
  for (const property of properties.properties) {
    if (ts.isShorthandPropertyAssignment(property) && property.name.text === 'code') return property.name;
    if (ts.isPropertyAssignment(property) && property.name.getText(source) === 'code') return property.initializer;
  }
  return undefined;
}

/** A function that passes its parameter at `index`, typed as the literal union `codes`, to an error site. */
interface Forwarder { name: string; index: number; codes: readonly string[] }

function resolveCode(expression: ts.Expression, source: ts.SourceFile, seen: Set<ts.Node>, forwarders: Forwarder[] = []): string[] | undefined {
  if (seen.has(expression)) return [];
  seen.add(expression);
  if (ts.isStringLiteralLike(expression)) return [expression.text];
  if (ts.isParenthesizedExpression(expression)) return resolveCode(expression.expression, source, seen, forwarders);
  if (ts.isConditionalExpression(expression)) {
    const branches = [resolveCode(expression.whenTrue, source, seen, forwarders), resolveCode(expression.whenFalse, source, seen, forwarders)];
    return branches.every(Boolean) ? branches.flat() as string[] : undefined;
  }
  if (!ts.isIdentifier(expression)) return undefined;
  const declared = declaration(expression);
  if (!declared) return undefined;
  if (ts.isVariableDeclaration(declared)) return declared.initializer ? resolveCode(declared.initializer, source, seen, forwarders) : undefined;
  if (seen.has(declared)) return [];
  seen.add(declared);
  const owner = declared.parent as FunctionLike;
  const name = functionName(owner);
  const index = owner.parameters.indexOf(declared);
  const union = literalUnion(declared.type, source);
  if (union) {
    if (name) forwarders.push({ name, index, codes: union });
    return union;
  }
  const sites = name ? calls(source, name).filter(call => call.arguments[index] !== undefined) : [];
  const candidates = [...(declared.initializer ? [declared.initializer] : []), ...sites.map(call => call.arguments[index]!)];
  if (candidates.length === 0) return undefined;
  const resolved = candidates.map(candidate => resolveCode(candidate, source, seen, forwarders));
  return resolved.every(Boolean) ? resolved.flat() as string[] : undefined;
}

const add = (map: Map<string, string[]>, code: string, location: string) => map.set(code, [...map.get(code) ?? [], location]);

export async function inventoryErrorCodes(root: string): Promise<ErrorCodeInventory> {
  const inventory: ErrorCodeInventory = { codes: new Map(), coded: new Map(), forwarded: new Map(), unresolved: [], directConstructions: [] };
  const forwarders: Forwarder[] = [];
  const sources: Array<{ source: ts.SourceFile; location: (node: ts.Node) => string }> = [];
  for (const path of await sourceFiles(root)) {
    const source = ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true);
    const location = (node: ts.Node) => `${relative(root, path)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;
    // The error module defines the helpers and forwards their typed parameters.
    if (path.endsWith(join('domain', 'shared', 'errors.ts'))) continue;
    sources.push({ source, location });
    const visit = (node: ts.Node): void => {
      if (ts.isNewExpression(node) && node.expression.getText(source) === 'AppError') inventory.directConstructions.push(location(node));
      const callee = ts.isCallExpression(node) ? node.expression.getText(source) : undefined;
      const argument = callee === 'ensure' ? (node as ts.CallExpression).arguments[1] : callee === 'forgeError' ? (node as ts.CallExpression).arguments[0] : undefined;
      for (const [site, map] of [[argument, inventory.codes], [codedErrorCode(node, source), inventory.coded]] as const) {
        if (!site) continue;
        const codes = resolveCode(site, source, new Set(), forwarders);
        if (!codes) inventory.unresolved.push(`${location(node)} ${site.getText(source)}`);
        for (const code of codes ?? []) add(map, code, location(node));
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  // Callers anywhere that pass one of a forwarder's codes as a literal raise it where they call.
  for (const { source, location } of sources) {
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const called = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined;
        for (const forwarder of forwarders.filter(entry => entry.name === called)) {
          const argument = node.arguments[forwarder.index];
          if (argument && ts.isStringLiteralLike(argument) && forwarder.codes.includes(argument.text)) add(inventory.forwarded, argument.text, location(node));
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return inventory;
}
