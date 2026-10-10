import { ensure, isRecord } from '../shared/errors.ts';

export function validateCanvas(value: unknown): asserts value is Record<string, unknown> {
  ensure(isRecord(value), 'INVALID_CANVAS', 'Canvas must be an object.');
  const nodes = value.nodes === undefined ? [] : value.nodes, edges = value.edges === undefined ? [] : value.edges;
  ensure(Array.isArray(nodes) && Array.isArray(edges), 'INVALID_CANVAS', 'nodes and edges must be arrays.');
  const ids = new Set<string>();
  const color = (v: unknown) => v === undefined || (typeof v === 'string' && /^(#[0-9a-fA-F]{6}|[1-6])$/.test(v));
  for (const node of nodes) {
    ensure(isRecord(node) && typeof node.id === 'string' && node.id.length && !ids.has(node.id), 'INVALID_CANVAS', 'Node IDs must be unique nonempty strings.');
    ids.add(node.id);
    ensure(typeof node.type === 'string' && ['text', 'file', 'link', 'group'].includes(node.type), 'INVALID_CANVAS', 'Unknown node type.');
    ensure(['x', 'y', 'width', 'height'].every(k => Number.isInteger(node[k])), 'INVALID_CANVAS', 'Node geometry must use integers.');
    ensure(Number(node.width) > 0 && Number(node.height) > 0 && color(node.color), 'INVALID_CANVAS', 'Invalid dimensions or color.');
    const contentKey = { text: 'text', file: 'file', link: 'url' }[String(node.type)];
    ensure(!contentKey || typeof node[contentKey] === 'string', 'INVALID_CANVAS', 'Missing node content.');
    for (const key of ['subpath', 'label', 'background']) ensure(node[key] === undefined || typeof node[key] === 'string', 'INVALID_CANVAS', `Invalid ${key}.`);
    if (node.type === 'file' && node.subpath !== undefined) ensure(typeof node.subpath === 'string' && node.subpath.startsWith('#'), 'INVALID_CANVAS', 'File node subpath must start with #.');
    ensure(node.backgroundStyle === undefined || (typeof node.backgroundStyle === 'string' && ['cover', 'ratio', 'repeat'].includes(node.backgroundStyle)), 'INVALID_CANVAS', 'Invalid background style.');
  }
  const edgeIds = new Set<string>();
  for (const edge of edges) {
    ensure(isRecord(edge) && typeof edge.id === 'string' && edge.id.length && !edgeIds.has(edge.id), 'INVALID_CANVAS', 'Edge IDs must be unique nonempty strings.');
    edgeIds.add(edge.id);
    ensure(typeof edge.fromNode === 'string' && typeof edge.toNode === 'string', 'INVALID_CANVAS', `Edge ${edge.id} needs fromNode and toNode ids.`);
    const dangling = [...new Set([edge.fromNode, edge.toNode])].filter(node => !ids.has(node));
    ensure(dangling.length === 0, 'INVALID_CANVAS', `Edge endpoints must reference existing nodes: edge ${edge.id} names missing node ${dangling.join(' and ')}.`);
    for (const key of ['fromSide', 'toSide']) ensure(edge[key] === undefined || (typeof edge[key] === 'string' && ['top', 'right', 'bottom', 'left'].includes(edge[key])), 'INVALID_CANVAS', 'Invalid edge side.');
    for (const key of ['fromEnd', 'toEnd']) ensure(edge[key] === undefined || (typeof edge[key] === 'string' && ['none', 'arrow'].includes(edge[key])), 'INVALID_CANVAS', 'Invalid edge end.');
    ensure(color(edge.color) && (edge.label === undefined || typeof edge.label === 'string'), 'INVALID_CANVAS', 'Invalid edge color or label.');
  }
}
