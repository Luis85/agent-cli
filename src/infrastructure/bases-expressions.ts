import { compileExpression, isTruthy, type Expression, type CompiledExpression, type EvaluationContext } from 'obsidian-bases-expression';
import { ensure, isRecord } from '../domain/errors.ts';

const internalContext = '__forge_base_context';
const internalFormula = '__forge_base_formula';
const internalTag = '__forge_base_tag';
const internalGuard = '__forge_base_guard';
export { internalContext, internalFormula, internalTag, internalGuard };

function guarded(expression: Expression, callee = false): Expression {
  let value = expression;
  if (value.type === 'Call') value = { ...value, callee: guarded(value.callee, true), args: value.args.map(item => guarded(item)) };
  else if (value.type === 'Member') value = { ...value, object: guarded(value.object), property: typeof value.property === 'string' ? value.property : guarded(value.property) };
  else if (value.type === 'Binary') value = { ...value, left: guarded(value.left), right: guarded(value.right) };
  else if (value.type === 'Unary') value = { ...value, argument: guarded(value.argument) };
  else if (value.type === 'Array') value = { ...value, elements: value.elements.map(item => guarded(item)) };
  if (callee || ['Literal', 'Identifier', 'Regex'].includes(value.type)) return value;
  return { type: 'Call', callee: { type: 'Identifier', name: internalGuard, span: value.span }, args: [value], span: value.span };
}

// Interpret the established parser's AST; document text is never JavaScript.
function adapt(expression: Expression): Expression {
  const span = expression.span;
  const root: Expression = { type: 'Identifier', name: internalContext, span };
  const member = (object: Expression, property: string): Expression => ({ type: 'Member', object, property, computed: false, span });
  if (expression.type === 'Identifier' && expression.name === 'this') return member(root, 'file');
  if (expression.type === 'Member') {
    if (expression.computed && expression.object.type === 'Identifier' && expression.object.name === 'formula') {
      if (typeof expression.property !== 'string' && expression.property.type === 'Literal' && typeof expression.property.value === 'string') return { ...expression, computed: false, property: expression.property.value };
      ensure(typeof expression.property !== 'string', 'INVALID_BASE_EXPRESSION', 'Computed formula access needs an expression.');
      return { type: 'Call', callee: { type: 'Identifier', name: internalFormula, span }, args: [adapt(expression.property)], span };
    }
    if (expression.object.type === 'Identifier' && expression.object.name === 'this') {
      const file = expression.property === 'file' || (typeof expression.property !== 'string' && expression.property.type === 'Literal' && expression.property.value === 'file');
      return file ? member(root, 'file') : { ...expression, object: member(root, 'note'), property: typeof expression.property === 'string' ? expression.property : adapt(expression.property) };
    }
    return { ...expression, object: adapt(expression.object), property: typeof expression.property === 'string' ? expression.property : adapt(expression.property) };
  }
  if (expression.type === 'Unary') {
    ensure(expression.operator !== '+', 'INVALID_BASE_EXPRESSION', 'Unary plus is rejected by the observed Obsidian Bases parser.');
    return { ...expression, argument: adapt(expression.argument) };
  }
  if (expression.type === 'Binary') return { ...expression, left: adapt(expression.left), right: adapt(expression.right) };
  if (expression.type === 'Call') {
    if (expression.callee.type === 'Member' && expression.callee.property === 'hasTag') return { ...expression, callee: { type: 'Identifier', name: internalTag, span }, args: [adapt(expression.callee.object), ...expression.args.map(adapt)] };
    return { ...expression, callee: adapt(expression.callee), args: expression.args.map(adapt) };
  }
  if (expression.type === 'Array') return { ...expression, elements: expression.elements.map(adapt) };
  return expression;
}

export function baseExpression(source: string): CompiledExpression {
  const parsed = compileExpression(source);
  ensure(parsed.valid && parsed.ast, 'INVALID_BASE_EXPRESSION', parsed.diagnostics.map(item => item.message).join('; ') || 'Invalid Bases expression.');
  const nativeNumericMember = (node: unknown) => {
    if (!isRecord(node)) return;
    if (node.type === 'Member' && isRecord(node.object) && node.object.type === 'Literal' && typeof node.object.value === 'number' && isRecord(node.object.span)) {
      ensure(source.slice(Number(node.object.span.start), Number(node.object.span.end)).trimStart().startsWith('('), 'INVALID_BASE_EXPRESSION', 'Numeric method receivers need parentheses, as in (1).isTruthy().');
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(nativeNumericMember);
      else if (isRecord(value)) nativeNumericMember(value);
    }
  };
  nativeNumericMember(parsed.ast);
  return compileExpression(guarded(adapt(parsed.ast)));
}

export function baseFilter(value: unknown): (context: EvaluationContext) => boolean {
  if (value === undefined) return () => true;
  if (typeof value === 'string') {
    const compiled = baseExpression(value);
    return context => isTruthy(compiled.evaluateValue(context, { throwOnError: true }));
  }
  ensure(isRecord(value) && Object.keys(value).length === 1, 'INVALID_BASE_EXPRESSION', 'Filters require an expression or a single and/or/not list.');
  const [operator, children] = Object.entries(value)[0]!;
  ensure(['and', 'or', 'not'].includes(operator) && Array.isArray(children), 'INVALID_BASE_EXPRESSION', 'Filters require an and/or/not list.');
  const filters = children.map(baseFilter);
  return context => operator === 'and' ? filters.every(filter => filter(context)) : operator === 'or' ? filters.some(filter => filter(context)) : !filters.some(filter => filter(context));
}
