import { ensure, isRecord } from './errors.ts';

export function validateCanvas(value: unknown): asserts value is Record<string, unknown> {
  ensure(isRecord(value), 'INVALID_CANVAS', 'Canvas must be an object.');
  const nodes = value.nodes ?? [], edges = value.edges ?? [];
  ensure(Array.isArray(nodes) && Array.isArray(edges), 'INVALID_CANVAS', 'nodes and edges must be arrays.');
  const ids = new Set<string>();
  const color = (v: unknown) => v === undefined || (typeof v === 'string' && /^(#[0-9a-fA-F]{6}|[1-6])$/.test(v));
  for (const node of nodes) {
    ensure(isRecord(node) && typeof node.id === 'string' && node.id.length && !ids.has(node.id), 'INVALID_CANVAS', 'Node IDs must be unique nonempty strings.');
    ids.add(node.id);
    ensure(['text', 'file', 'link', 'group'].includes(String(node.type)), 'INVALID_CANVAS', 'Unknown node type.');
    ensure(['x', 'y', 'width', 'height'].every(k => Number.isInteger(node[k])), 'INVALID_CANVAS', 'Node geometry must use integers.');
    ensure(Number(node.width) > 0 && Number(node.height) > 0 && color(node.color), 'INVALID_CANVAS', 'Invalid dimensions or color.');
    const contentKey = { text: 'text', file: 'file', link: 'url' }[String(node.type)];
    ensure(!contentKey || typeof node[contentKey] === 'string', 'INVALID_CANVAS', 'Missing node content.');
    for (const key of ['subpath', 'label', 'background']) ensure(node[key] === undefined || typeof node[key] === 'string', 'INVALID_CANVAS', `Invalid ${key}.`);
    ensure(node.backgroundStyle === undefined || ['cover', 'ratio', 'repeat'].includes(String(node.backgroundStyle)), 'INVALID_CANVAS', 'Invalid background style.');
  }
  const edgeIds = new Set<string>();
  for (const edge of edges) {
    ensure(isRecord(edge) && typeof edge.id === 'string' && edge.id.length && !edgeIds.has(edge.id), 'INVALID_CANVAS', 'Edge IDs must be unique nonempty strings.');
    edgeIds.add(edge.id);
    ensure(ids.has(String(edge.fromNode)) && ids.has(String(edge.toNode)), 'INVALID_CANVAS', 'Edge endpoints must reference existing nodes.');
    for (const key of ['fromSide', 'toSide']) ensure(edge[key] === undefined || ['top', 'right', 'bottom', 'left'].includes(String(edge[key])), 'INVALID_CANVAS', 'Invalid edge side.');
    for (const key of ['fromEnd', 'toEnd']) ensure(edge[key] === undefined || ['none', 'arrow'].includes(String(edge[key])), 'INVALID_CANVAS', 'Invalid edge end.');
    ensure(color(edge.color) && (edge.label === undefined || typeof edge.label === 'string'), 'INVALID_CANVAS', 'Invalid edge color or label.');
  }
}
