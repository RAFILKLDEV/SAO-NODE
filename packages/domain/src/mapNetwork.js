import { z } from 'zod';

const EPS = 1e-8;
const pointSchema = z.object({ x: z.number().finite().min(0).max(1), y: z.number().finite().min(0).max(1) });
export const roadNetworkSchema = z.object({
  imageWidth: z.number().int().positive().max(100000000),
  imageHeight: z.number().int().positive().max(100000000),
  nodes: z.array(pointSchema.extend({ id: z.string().min(1).max(128) }).strict()).max(4000),
  edges: z.array(z.object({ id: z.string().min(1).max(256), from: z.string().min(1).max(128), to: z.string().min(1).max(128) }).strict()).max(4000)
}).strict().superRefine((network, context) => {
  const nodes = new Set(network.nodes.map((node) => node.id));
  if (nodes.size !== network.nodes.length || new Set(network.edges.map((edge) => edge.id)).size !== network.edges.length) context.addIssue({ code: 'custom', message: 'IDs duplicados na rede' });
  if (network.edges.some((edge) => !nodes.has(edge.from) || !nodes.has(edge.to))) context.addIssue({ code: 'custom', message: 'Trecho aponta para um ponto inexistente' });
});

export const emptyRoadNetwork = (imageWidth = 1, imageHeight = 1) => ({ imageWidth, imageHeight, nodes: [], edges: [] });
const coordinates = ({ x, y }) => ({ x, y });
const pointKey = ({ x, y }) => `${x.toFixed(8)}:${y.toFixed(8)}`;
const cross = (a, b) => a.x * b.y - a.y * b.x;
const minus = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const at = (a, b, t) => t === 0 ? coordinates(a) : t === 1 ? coordinates(b) : ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const clamp = (t) => Math.max(0, Math.min(1, t));
const edgeKey = (a, b) => [a, b].sort().join('~');
const distance = (a, b, dimensions) => Math.hypot((a.x - b.x) * dimensions.imageWidth, (a.y - b.y) * dimensions.imageHeight);

// Adjacent rounding buckets can contain the same computed intersection.
function roadPointIndex() {
  const buckets = new Map(), key = (x, y) => `${x}:${y}`;
  return {
    find(point) {
      const x = Math.floor(point.x / EPS), y = Math.floor(point.y / EPS);
      for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) {
        const match = buckets.get(key(x + dx, y + dy))?.find(node => Math.hypot(node.x - point.x, node.y - point.y) <= EPS);
        if (match) return match;
      }
      return null;
    },
    add(node) {
      const cell = key(Math.floor(node.x / EPS), Math.floor(node.y / EPS));
      if (!buckets.has(cell)) buckets.set(cell, []);
      buckets.get(cell).push(node);
    }
  };
}

function projection(point, a, b, dimensions) {
  const dx = (b.x - a.x) * dimensions.imageWidth, dy = (b.y - a.y) * dimensions.imageHeight;
  const length = dx * dx + dy * dy;
  const t = length ? clamp(((point.x - a.x) * dimensions.imageWidth * dx + (point.y - a.y) * dimensions.imageHeight * dy) / length) : 0;
  const projected = at(a, b, t);
  return { point: projected, t, distance: distance(point, projected, dimensions) };
}

// Split crossings and collinear overlaps; unchanged geometry keeps its IDs.
export function normalizeRoadNetwork(network, { sourceEdges, maxElements = Infinity } = {}) {
  const original = new Map(network.nodes.map((node) => [node.id, node]));
  const segments = network.edges.map((edge) => ({ ...edge, a: original.get(edge.from), b: original.get(edge.to), cuts: [0, 1] }))
    .filter(({ a, b }) => a && b && Math.hypot(a.x - b.x, a.y - b.y) > EPS)
    .map((segment) => ({ ...segment, minX: Math.min(segment.a.x, segment.b.x), maxX: Math.max(segment.a.x, segment.b.x), minY: Math.min(segment.a.y, segment.b.y), maxY: Math.max(segment.a.y, segment.b.y) }));
  const sorted = [...segments].sort((a, b) => a.minX - b.minX || a.id.localeCompare(b.id));
  for (let i = 0; i < sorted.length; i += 1) {
    const a = sorted[i], r = minus(a.b, a.a);
    for (let j = i + 1; j < sorted.length && sorted[j].minX <= a.maxX + EPS; j += 1) {
      const b = sorted[j];
      if (b.minY > a.maxY + EPS || b.maxY < a.minY - EPS) continue;
      const s = minus(b.b, b.a), q = minus(b.a, a.a), denominator = cross(r, s);
      if (Math.abs(denominator) > EPS * Math.hypot(r.x, r.y) * Math.hypot(s.x, s.y)) {
        const t = cross(q, s) / denominator, u = cross(q, r) / denominator;
        if (t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS) { a.cuts.push(clamp(t)); b.cuts.push(clamp(u)); }
      } else if (Math.abs(cross(q, r)) <= EPS * Math.hypot(r.x, r.y)) {
        for (const point of [b.a, b.b]) {
          const t = ((point.x - a.a.x) * r.x + (point.y - a.a.y) * r.y) / (r.x * r.x + r.y * r.y);
          if (t >= -EPS && t <= 1 + EPS) a.cuts.push(clamp(t));
        }
        for (const point of [a.a, a.b]) {
          const u = ((point.x - b.a.x) * s.x + (point.y - b.a.y) * s.y) / (s.x * s.x + s.y * s.y);
          if (u >= -EPS && u <= 1 + EPS) b.cuts.push(clamp(u));
        }
      }
    }
  }
  const known = roadPointIndex(), located = roadPointIndex();
  for (const node of network.nodes) if (!known.find(node)) known.add(node);
  const nodes = new Map(), edges = new Map(), usedIds = new Set(), usedNodeIds = new Set(network.nodes.map((node) => node.id));
  const nodeAt = (point) => {
    const existing = located.find(point);
    if (existing) return existing.id;
    const originalNode = known.find(point);
    let id = originalNode?.id;
    if (!id) { id = `node.${pointKey(point)}`; while (usedNodeIds.has(id)) id += '.'; }
    const node = { id, ...coordinates(originalNode ?? point) };
    usedNodeIds.add(id); nodes.set(id, node); located.add(node);
    if (nodes.size > maxElements) throw Object.assign(new Error('A rede tem pontos ou trechos demais.'), { code: 'NETWORK_TOO_LARGE' });
    return id;
  };
  for (const segment of segments) {
    const cuts = segment.cuts.sort((a, b) => a - b).filter((value, index, values) => !index || value - values[index - 1] > EPS);
    for (let index = 1; index < cuts.length; index += 1) {
      const from = nodeAt(at(segment.a, segment.b, cuts[index - 1])), to = nodeAt(at(segment.a, segment.b, cuts[index]));
      if (from === to) continue;
      const key = edgeKey(from, to);
      if (edges.has(key)) {
        if (sourceEdges) sourceEdges.get(edges.get(key).id).add(segment.id);
        continue;
      }
      let id = index === 1 && !usedIds.has(segment.id) ? segment.id : `edge.${pointKey(at(segment.a, segment.b, cuts[index - 1]))}~${pointKey(at(segment.a, segment.b, cuts[index]))}`;
      while (usedIds.has(id)) id += '.';
      usedIds.add(id); edges.set(key, { id, from, to });
      sourceEdges?.set(id, new Set([segment.id]));
      if (edges.size > maxElements) throw Object.assign(new Error('A rede tem pontos ou trechos demais.'), { code: 'NETWORK_TOO_LARGE' });
    }
  }
  const referenced = new Set([...edges.values()].flatMap((edge) => [edge.from, edge.to]));
  return { imageWidth: network.imageWidth, imageHeight: network.imageHeight, nodes: [...nodes.values()].filter((node) => referenced.has(node.id)), edges: [...edges.values()] };
}

// Query preparation never changes the saved network or publishes generated edge IDs.
export function prepareRoadNetwork(network) {
  const sourceEdges = new Map();
  if (network.nodes.length > 4000 || network.edges.length > 4000) return { network, sourceEdges, tooLarge: true };
  try { return { network: normalizeRoadNetwork(network, { sourceEdges, maxElements: 4000 }), sourceEdges, tooLarge: false }; }
  catch (error) {
    if (error.code !== 'NETWORK_TOO_LARGE') throw error;
    return { network, sourceEdges: new Map(), tooLarge: true };
  }
}

export function findRoadConnectionSuggestions(network, dimensions = network, tolerance = 12) {
  const prepared = prepareRoadNetwork(network);
  if (prepared.tooLarge) return [];
  const roads = prepared.network, nodes = new Map(roads.nodes.map(node => [node.id, node])), adjacent = new Map(), components = new Map();
  for (const edge of roads.edges) for (const [from, to] of [[edge.from, edge.to], [edge.to, edge.from]]) {
    if (!adjacent.has(from)) adjacent.set(from, []);
    adjacent.get(from).push(to);
  }
  for (const node of roads.nodes) {
    if (components.has(node.id)) continue;
    const queue = [node.id]; components.set(node.id, node.id);
    for (let index = 0; index < queue.length; index += 1) for (const next of adjacent.get(queue[index]) ?? []) {
      if (!components.has(next)) { components.set(next, node.id); queue.push(next); }
    }
  }
  const suggestions = new Map(), sortedEdges = [...roads.edges].sort((a, b) => a.id.localeCompare(b.id));
  for (const node of roads.nodes) {
    if (adjacent.get(node.id)?.length !== 1) continue;
    let best;
    for (const edge of sortedEdges) {
      if (components.get(node.id) === components.get(edge.from)) continue;
      const a = nodes.get(edge.from), b = nodes.get(edge.to), projected = projection(node, a, b, dimensions);
      if (projected.distance > tolerance + EPS) continue;
      const endpoint = [a, b].map(target => ({ target, distance: distance(node, target, dimensions) })).sort((x, y) => x.distance - y.distance || x.target.id.localeCompare(y.target.id))[0];
      const target = endpoint.distance <= tolerance + EPS ? endpoint.target : projected.point;
      const gap = distance(node, target, dimensions);
      if (gap <= EPS || (best && gap >= best.distancePixels - EPS)) continue;
      const id = target.id ? JSON.stringify([node.id, target.id].sort()) : JSON.stringify([node.id, edge.id, pointKey(target)]);
      best = { id, sourceNodeId: node.id, targetEdgeId: edge.id, ...(target.id ? { targetNodeId: target.id } : {}), from: coordinates(node), to: coordinates(target), distancePixels: gap };
    }
    if (best && !suggestions.has(best.id)) suggestions.set(best.id, best);
  }
  return [...suggestions.values()].sort((a, b) => a.distancePixels - b.distancePixels || a.id.localeCompare(b.id));
}

export function joinRoadConnection(network, suggestion, dimensions = network) {
  const current = findRoadConnectionSuggestions(network, dimensions).find(entry => entry.id === suggestion.id);
  if (!current) return network;
  const prepared = prepareRoadNetwork(network).network;
  const next = current.targetNodeId ? {
    ...prepared,
    nodes: prepared.nodes.filter(node => node.id !== current.sourceNodeId),
    edges: prepared.edges.map(edge => ({ ...edge, from: edge.from === current.sourceNodeId ? current.targetNodeId : edge.from, to: edge.to === current.sourceNodeId ? current.targetNodeId : edge.to }))
  } : { ...prepared, nodes: prepared.nodes.map(node => node.id === current.sourceNodeId ? { ...node, ...current.to } : node) };
  const repaired = prepareRoadNetwork(next);
  if (repaired.tooLarge) throw Object.assign(new Error('A rede tem pontos ou trechos demais.'), { code: 'NETWORK_TOO_LARGE' });
  return repaired.network;
}

export function nearestRoadPoint(network, point, dimensions = network) {
  const nodes = new Map(network.nodes.map((node) => [node.id, node]));
  let best = null;
  for (const edge of [...network.edges].sort((a, b) => a.id.localeCompare(b.id))) {
    const a = nodes.get(edge.from), b = nodes.get(edge.to);
    if (!a || !b) continue;
    const candidate = { ...projection(point, a, b, dimensions), edge };
    if (!best || candidate.distance < best.distance - EPS) best = candidate;
  }
  return best;
}

export function snapRoadPoint(network, point, dimensions = network, snapPixels = 8) {
  const nearest = nearestRoadPoint(network, point, dimensions);
  if (!nearest || nearest.distance > snapPixels) return coordinates(point);
  // Prefer nearby junctions to avoid tiny new edges just beside existing nodes.
  const endpoints = network.nodes.filter((node) => node.id === nearest.edge.from || node.id === nearest.edge.to)
    .map((node) => ({ node, distance: distance(point, node, dimensions) })).sort((a, b) => a.distance - b.distance);
  return coordinates(endpoints[0]?.distance <= snapPixels ? endpoints[0].node : nearest.point);
}

class MinHeap {
  items = [];
  push(item) {
    let index = this.items.length; this.items.push(item);
    while (index) {
      const parent = (index - 1) >> 1;
      if (this.items[parent].cost <= item.cost) break;
      this.items[index] = this.items[parent]; index = parent;
    }
    this.items[index] = item;
  }
  pop() {
    const first = this.items[0], last = this.items.pop();
    if (!this.items.length) return first;
    let index = 0;
    while (index * 2 + 1 < this.items.length) {
      let child = index * 2 + 1;
      if (child + 1 < this.items.length && this.items[child + 1].cost < this.items[child].cost) child += 1;
      if (this.items[child].cost >= last.cost) break;
      this.items[index] = this.items[child]; index = child;
    }
    this.items[index] = last; return first;
  }
}

function insideTerritory(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i], offset = minus(point, a), direction = minus(b, a);
    if (Math.abs(cross(offset, direction)) <= EPS * Math.max(Math.hypot(direction.x, direction.y), EPS)
      && point.x >= Math.min(a.x, b.x) - EPS && point.x <= Math.max(a.x, b.x) + EPS
      && point.y >= Math.min(a.y, b.y) - EPS && point.y <= Math.max(a.y, b.y) + EPS) return true;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// A region may access every road inside its boundary, including a road whose
// endpoints both lie outside. These projections belong only to this query.
function roadAccesses(network, point, territory) {
  if (!Array.isArray(territory) || territory.length < 3) return [nearestRoadPoint(network, point)].filter(Boolean);
  const nodes = new Map(network.nodes.map((node) => [node.id, node])), candidates = new Map();
  for (const edge of [...network.edges].sort((a, b) => a.id.localeCompare(b.id))) {
    const a = nodes.get(edge.from), b = nodes.get(edge.to);
    if (!a || !b) continue;
    const direction = minus(b, a), squaredLength = direction.x ** 2 + direction.y ** 2;
    if (!squaredLength) continue;
    const cuts = [0, 1];
    for (let i = 0; i < territory.length; i += 1) {
      const c = territory[i], d = territory[(i + 1) % territory.length], side = minus(d, c), offset = minus(c, a), denominator = cross(direction, side);
      if (Math.abs(denominator) > EPS * Math.hypot(direction.x, direction.y) * Math.hypot(side.x, side.y)) {
        const t = cross(offset, side) / denominator, u = cross(offset, direction) / denominator;
        if (t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS) cuts.push(clamp(t));
      } else if (Math.abs(cross(offset, direction)) <= EPS * Math.hypot(direction.x, direction.y)) {
        for (const vertex of [c, d]) {
          const t = ((vertex.x - a.x) * direction.x + (vertex.y - a.y) * direction.y) / squaredLength;
          if (t >= -EPS && t <= 1 + EPS) cuts.push(clamp(t));
        }
      }
    }
    const values = cuts.sort((x, y) => x - y).filter((value, index, all) => !index || value - all[index - 1] > EPS);
    const add = (t) => {
      const projected = at(a, b, t);
      candidates.set(`${edge.id}:${t.toFixed(8)}`, { edge, t, point: projected, distance: distance(point, projected, network) });
    };
    for (const t of values) if (insideTerritory(at(a, b, t), territory)) add(t);
    const nearest = projection(point, a, b, network);
    for (let i = 1; i < values.length; i += 1) {
      if (insideTerritory(at(a, b, (values[i - 1] + values[i]) / 2), territory)) add(Math.max(values[i - 1], Math.min(values[i], nearest.t)));
    }
  }
  return candidates.size ? [...candidates.values()] : [nearestRoadPoint(network, point)].filter(Boolean);
}

function queryGraph(network, from, to, options, sourceEdges) {
  const starts = roadAccesses(network, from, options.fromTerritory), ends = roadAccesses(network, to, options.toTerritory);
  const nodes = new Map(), aliases = new Map(), virtualNodes = roadPointIndex();
  for (const node of network.nodes) {
    const existing = virtualNodes.find(node);
    aliases.set(node.id, existing?.id ?? node.id);
    if (!existing) { nodes.set(node.id, coordinates(node)); virtualNodes.add(node); }
  }
  const addVirtual = (candidate) => {
    const existing = virtualNodes.find(candidate.point);
    if (existing) return existing.id;
    let id = `access.${pointKey(candidate.point)}`; while (nodes.has(id)) id += '.';
    virtualNodes.add({ id, ...candidate.point }); nodes.set(id, coordinates(candidate.point));
    return id;
  };
  const cuts = new Map();
  for (const candidate of [...starts, ...ends]) {
    candidate.id = addVirtual(candidate);
    if (!cuts.has(candidate.edge.id)) cuts.set(candidate.edge.id, []);
    cuts.get(candidate.edge.id).push({ t: candidate.t, id: candidate.id });
  }
  const uniqueId = (base) => { let id = base; while (nodes.has(id)) id += '.'; nodes.set(id, null); return id; };
  const fromId = uniqueId('query.from'), toId = uniqueId('query.to'), adjacency = new Map();
  const connect = (a, b, cost, edgeId = null) => {
    if (a === b) return;
    if (!adjacency.has(a)) adjacency.set(a, []);
    adjacency.get(a).push({ id: b, cost, edgeId, sourceEdgeIds: edgeId == null ? [] : [...(sourceEdges.get(edgeId) ?? [edgeId])].sort(), key: JSON.stringify([a, b, edgeId]) });
  };
  for (const edge of [...network.edges].sort((a, b) => a.id.localeCompare(b.id))) {
    const splits = [{ t: 0, id: aliases.get(edge.from) }, ...(cuts.get(edge.id) ?? []), { t: 1, id: aliases.get(edge.to) }].sort((a, b) => a.t - b.t);
    for (let i = 1; i < splits.length; i += 1) {
      const a = splits[i - 1].id, b = splits[i].id;
      if (a === b) continue;
      const cost = distance(nodes.get(a), nodes.get(b), network);
      connect(a, b, cost, edge.id); connect(b, a, cost, edge.id);
    }
  }
  for (const candidate of new Map(starts.map((candidate) => [candidate.id, candidate])).values()) connect(fromId, candidate.id, candidate.distance);
  for (const candidate of new Map(ends.map((candidate) => [candidate.id, candidate])).values()) connect(candidate.id, toId, candidate.distance);
  return { nodes, adjacency, fromId, toId, imageWidth: network.imageWidth, imageHeight: network.imageHeight, fromTerritory: options.fromTerritory, toTerritory: options.toTerritory };
}

function shortestQueryPath(graph, fromId = graph.fromId, bannedNodes = new Set(), bannedSteps = new Set()) {
  const costs = new Map([[fromId, 0]]), previous = new Map(), heap = new MinHeap(); heap.push({ id: fromId, cost: 0 });
  while (heap.items.length) {
    const current = heap.pop();
    if (current.cost !== costs.get(current.id)) continue;
    if (current.id === graph.toId) break;
    for (const next of graph.adjacency.get(current.id) ?? []) {
      if (bannedNodes.has(next.id) || bannedSteps.has(next.key)) continue;
      const cost = current.cost + next.cost;
      if (cost < (costs.get(next.id) ?? Infinity) - EPS) { costs.set(next.id, cost); previous.set(next.id, { ...next, from: current.id }); heap.push({ id: next.id, cost }); }
    }
  }
  if (!costs.has(graph.toId)) return null;
  const ids = [graph.toId], steps = [];
  while (ids[0] !== fromId) { const step = previous.get(ids[0]); steps.unshift(step); ids.unshift(step.from); }
  return { ids, steps, cost: costs.get(graph.toId) };
}

function territoryContainsStep(graph, step, territory) {
  if (!Array.isArray(territory) || territory.length < 3) return false;
  const from = graph.nodes.get(step.from), to = graph.nodes.get(step.id);
  return insideTerritory(from, territory) && insideTerritory(to, territory) && insideTerritory(at(from, to, .5), territory);
}

// Choices describe the roads highlighted on the map. Different accesses within
// the same endpoint territory and opposite tours of the same circuit need only
// one representative. Keep geometric portions, not original road IDs: different
// parts of a subdivided road can still represent genuinely different routes.
function roadPathKey(path, graph) {
  const steps = path.steps.filter(step => step.edgeId != null);
  let start = 0, end = steps.length;
  while (start < end && territoryContainsStep(graph, steps[start], graph.fromTerritory)) start += 1;
  while (end > start && territoryContainsStep(graph, steps[end - 1], graph.toTerritory)) end -= 1;
  if (start === end) return '[]';
  const points = [graph.nodes.get(steps[start].from), ...steps.slice(start, end).map(step => graph.nodes.get(step.id))];
  // Subpixel drawing artifacts and extra collinear cuts must not manufacture
  // another choice. This affects comparisons only, never stored road geometry.
  const simplified = simplifyRoadStroke(points, graph, 1);
  const key = point => `${Math.round(point.x * graph.imageWidth)}:${Math.round(point.y * graph.imageHeight)}`;
  const segments = simplified.slice(1).map((point, index) => [key(simplified[index]), key(point)].sort()).filter(([a, b]) => a !== b).map(segment => segment.join('|'));
  return JSON.stringify([...new Set(segments)].sort());
}
const passageMask = (bits, step) => step.sourceEdgeIds.reduce((mask, id) => mask | (bits.get(id) ?? 0), 0);

// Yen's algorithm offers distinct, shortest simple paths rather than walks
// that manufacture an alternative by going around a loop and coming back.
function queryAlternatives(graph, limit) {
  const first = shortestQueryPath(graph);
  if (!first) return { paths: [], limited: false };
  const accepted = [first], results = [first], routeKeys = new Set([roadPathKey(first, graph)]), candidates = new MinHeap(), seen = new Set([JSON.stringify(first.ids)]);
  const budget = Math.max(32, limit * 12);
  let round = 0;
  for (; results.length < limit && round < budget; round += 1) {
    const previous = accepted.at(-1);
    let rootCost = 0;
    for (let i = 0; i < previous.ids.length - 1; i += 1) {
      const root = previous.ids.slice(0, i + 1), bannedNodes = new Set(root.slice(0, -1)), bannedSteps = new Set();
      for (const path of accepted) if (root.every((id, index) => path.ids[index] === id)) bannedSteps.add(path.steps[i].key);
      if ((graph.adjacency.get(root.at(-1)) ?? []).some((step) => !bannedNodes.has(step.id) && !bannedSteps.has(step.key))) {
        const spur = shortestQueryPath(graph, root.at(-1), bannedNodes, bannedSteps);
        if (spur) {
          const candidate = { ids: [...root.slice(0, -1), ...spur.ids], steps: [...previous.steps.slice(0, i), ...spur.steps], cost: rootCost + spur.cost }, key = JSON.stringify(candidate.ids);
          if (!seen.has(key)) { seen.add(key); candidates.push(candidate); }
        }
      }
      rootCost += previous.steps[i].cost;
    }
    if (!candidates.items.length) break;
    const next = candidates.pop(); accepted.push(next);
    const key = roadPathKey(next, graph);
    if (!routeKeys.has(key)) { routeKeys.add(key); results.push(next); }
  }
  return { paths: results, limited: round === budget && results.length < limit };
}

// An admissible distance for the remaining requested edges keeps the search
// practical. The actual search never revisits a node, so a dead-end road is
// not offered as a detour that merely returns along the same road.
function preferredAlternatives(graph, edgeIds, limit) {
  const bits = new Map(edgeIds.map((id, index) => [id, 1 << index])), complete = (1 << edgeIds.length) - 1, reversed = new Map();
  for (const [from, steps] of graph.adjacency) for (const step of steps) {
    if (!reversed.has(step.id)) reversed.set(step.id, []);
    reversed.get(step.id).push({ ...step, id: from });
  }
  const stateKey = (id, mask) => JSON.stringify([id, mask]), estimates = new Map([[stateKey(graph.toId, complete), 0]]), heap = new MinHeap();
  heap.push({ id: graph.toId, mask: complete, cost: 0 });
  while (heap.items.length) {
    const current = heap.pop();
    if (current.cost !== estimates.get(stateKey(current.id, current.mask))) continue;
    for (const step of reversed.get(current.id) ?? []) {
      const bit = passageMask(bits, step);
      if ((current.mask & bit) !== bit) continue;
      const masks = [];
      for (let subset = bit;; subset = (subset - 1) & bit) { masks.push(current.mask & ~subset); if (!subset) break; }
      for (const mask of masks) {
        const key = stateKey(step.id, mask), cost = current.cost + step.cost;
        if (cost < (estimates.get(key) ?? Infinity) - EPS) { estimates.set(key, cost); heap.push({ id: step.id, mask, cost }); }
      }
    }
  }
  const estimate = estimates.get(stateKey(graph.fromId, 0));
  if (estimate == null) return { paths: [], limited: false };
  const open = new MinHeap(), results = [], routeKeys = new Set();
  open.push({ ids: [graph.fromId], steps: [], mask: 0, travelled: 0, cost: estimate });
  let expanded = 0, limited = false;
  for (; open.items.length && results.length < limit && expanded < 20000; expanded += 1) {
    const current = open.pop(), id = current.ids.at(-1);
    if (id === graph.toId) {
      const key = roadPathKey(current, graph);
      if (!routeKeys.has(key)) { routeKeys.add(key); results.push({ ...current, cost: current.travelled }); }
      continue;
    }
    for (const step of graph.adjacency.get(id) ?? []) {
      if (current.ids.includes(step.id)) continue;
      const mask = current.mask | passageMask(bits, step), remaining = estimates.get(stateKey(step.id, mask));
      if (remaining == null || (step.id === graph.toId && mask !== complete)) continue;
      const travelled = current.travelled + step.cost;
      if (open.items.length < 20000) open.push({ ids: [...current.ids, step.id], steps: [...current.steps, { ...step, from: id }], mask, travelled, cost: travelled + remaining });
      else limited = true;
    }
  }
  return { paths: results, limited: limited || (expanded === 20000 && open.items.length > 0 && results.length < limit) };
}

// An explicitly chosen passage may require returning through a junction.
// Dijkstra over (node, visited passages) finds the shortest such walk without
// inventing links between disconnected components or accumulating cycles.
function preferredWalk(graph, edgeIds) {
  const bits = new Map(edgeIds.map((id, index) => [id, 1 << index])), complete = (1 << edgeIds.length) - 1;
  const keyOf = (id, mask) => JSON.stringify([id, mask]), initial = keyOf(graph.fromId, 0);
  const costs = new Map([[initial, 0]]), previous = new Map(), heap = new MinHeap();
  heap.push({ id: graph.fromId, mask: 0, cost: 0, key: initial });
  let last;
  while (heap.items.length) {
    const current = heap.pop();
    if (current.cost !== costs.get(current.key)) continue;
    if (current.id === graph.toId && current.mask === complete) { last = current; break; }
    for (const step of graph.adjacency.get(current.id) ?? []) {
      const mask = current.mask | passageMask(bits, step);
      if (step.id === graph.toId && mask !== complete) continue;
      const key = keyOf(step.id, mask), cost = current.cost + step.cost;
      if (cost < (costs.get(key) ?? Infinity) - EPS) {
        costs.set(key, cost); previous.set(key, { previousKey: current.key, step: { ...step, from: current.id } });
        heap.push({ id: step.id, mask, key, cost });
      }
    }
  }
  if (!last) return null;
  const ids = [last.id], steps = [];
  for (let key = last.key; key !== initial;) {
    const entry = previous.get(key); steps.unshift(entry.step); ids.unshift(entry.step.from); key = entry.previousKey;
  }
  return { ids, steps, cost: last.cost, preferredEdgeIds: edgeIds };
}

function shortestQueryTree(adjacency, fromId) {
  const costs = new Map([[fromId, 0]]), previous = new Map(), heap = new MinHeap();
  heap.push({ id: fromId, cost: 0 });
  while (heap.items.length) {
    const current = heap.pop();
    if (current.cost !== costs.get(current.id)) continue;
    for (const step of adjacency.get(current.id) ?? []) {
      const cost = current.cost + step.cost;
      if (cost < (costs.get(step.id) ?? Infinity) - EPS) {
        costs.set(step.id, cost); previous.set(step.id, { ...step, from: current.id }); heap.push({ id: step.id, cost });
      }
    }
  }
  const stepsTo = (id) => {
    const steps = [];
    while (id !== fromId) { const step = previous.get(id); steps.unshift(step); id = step.from; }
    return steps;
  };
  return { costs, stepsTo };
}

// Complete the choices with other useful through routes. Visiting an unused
// passage is not a reason to offer a side trip: reject every repeated junction.
function passageAlternatives(graph, existing, limit) {
  const edgesOf = path => path.steps.map(step => step.edgeId).filter(id => id != null);
  const used = new Set(existing.flatMap(edgesOf)), routeKeys = new Set(existing.map(path => roadPathKey(path, graph))), reversed = new Map();
  for (const [from, steps] of graph.adjacency) for (const step of steps) {
    if (!reversed.has(step.id)) reversed.set(step.id, []);
    reversed.get(step.id).push({ ...step, id: from });
  }
  const starts = shortestQueryTree(graph.adjacency, graph.fromId), ends = shortestQueryTree(reversed, graph.toId), candidates = new Map();
  for (const [from, steps] of graph.adjacency) for (const step of steps) {
    if (step.edgeId == null || used.has(step.edgeId) || territoryContainsStep(graph, { ...step, from }, graph.fromTerritory) || territoryContainsStep(graph, { ...step, from }, graph.toTerritory)) continue;
    const cost = (starts.costs.get(from) ?? Infinity) + step.cost + (ends.costs.get(step.id) ?? Infinity);
    if (Number.isFinite(cost) && cost < (candidates.get(step.edgeId)?.cost ?? Infinity) - EPS) candidates.set(step.edgeId, { from, step, cost });
  }
  const paths = [];
  for (const candidate of [...candidates.values()].sort((a, b) => a.cost - b.cost)) {
    if (used.has(candidate.step.edgeId)) continue;
    const tail = ends.stepsTo(candidate.step.id).reverse().map(step => ({ ...step, from: step.id, id: step.from }));
    const steps = [...starts.stepsTo(candidate.from), { ...candidate.step, from: candidate.from }, ...tail];
    const path = { ids: [graph.fromId, ...steps.map(step => step.id)], steps, cost: candidate.cost };
    if (new Set(path.ids).size !== path.ids.length) continue;
    for (const edgeId of edgesOf(path)) used.add(edgeId);
    const key = roadPathKey(path, graph);
    if (routeKeys.has(key)) continue;
    if (paths.length >= limit) return { paths, limited: true };
    routeKeys.add(key); paths.push(path);
  }
  return { paths, limited: false };
}

function pathResult(graph, path, from, to, kmPerPixel) {
  const points = path.ids.slice(1, -1).map((id) => coordinates(graph.nodes.get(id))), sourceIds = path.steps.flatMap(step => step.sourceEdgeIds);
  const edgeIds = sourceIds.filter((id, index) => !index || id !== sourceIds[index - 1]);
  let hash = 2166136261;
  for (const character of roadPathKey(path, graph)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  const requiresReturn = new Set(path.ids).size < path.ids.length;
  const preferredEdgeIds = path.preferredEdgeIds?.flatMap(id => path.steps.find(step => step.edgeId === id)?.sourceEdgeIds ?? [id]);
  return { id: `path.${hash.toString(36)}`, status: 'found', edgeIds, points, accessFrom: [coordinates(from), points[0]], accessTo: [points.at(-1), coordinates(to)], distancePixels: path.cost, distanceKm: kmPerPixel == null ? null : path.cost * kmPerPixel, ...(requiresReturn ? { requiresReturn: true } : {}), ...(preferredEdgeIds ? { preferredEdgeIds: [...new Set(preferredEdgeIds)] } : {}) };
}

export function findRoadPaths(network, from, to, kmPerPixel = null, options = {}) {
  const missing = (reason) => ({ status: 'no_path', reason, points: [], distanceKm: null, paths: [] });
  if (!network?.edges?.length) return missing('empty_network');
  const limit = Math.max(1, Math.min(8, Math.trunc(options.limit || 5))), preferred = [...new Set(options.preferredEdgeIds ?? [])];
  const coverageLimit = Math.max(limit, Math.min(32, Math.trunc(options.coverageLimit || limit)));
  if (preferred.length > 5 || preferred.some((id) => !network.edges.some((edge) => edge.id === id))) return missing('invalid_preference');
  const prepared = prepareRoadNetwork(network);
  if (prepared.tooLarge) return missing('network_too_large');
  const graph = queryGraph(prepared.network, from, to, options, prepared.sourceEdges), search = preferred.length ? preferredAlternatives(graph, preferred, limit + 1) : queryAlternatives(graph, limit + 1);
  if (options.allowReturns && preferred.length && !search.paths.length) {
    const walk = preferredWalk(graph, preferred);
    if (walk) { search.paths.push(walk); search.limited = false; }
  }
  if (search.paths.length > limit) { search.paths.length = limit; search.limited = true; }
  if (!preferred.length && search.paths.length) {
    const passages = passageAlternatives(graph, search.paths, coverageLimit - search.paths.length);
    search.paths.push(...passages.paths); search.limited ||= passages.limited;
    search.paths.sort((a, b) => a.cost - b.cost);
  }
  if (!search.paths.length) return missing(search.limited ? 'search_limit' : preferred.length ? 'preference_unavailable' : 'disconnected');
  const paths = search.paths.map((path) => pathResult(graph, path, from, to, kmPerPixel));
  return { ...paths[0], paths, ...(search.limited ? { truncated: true } : {}) };
}

export function findRoadPath(network, from, to, kmPerPixel = null, options = {}) {
  const result = findRoadPaths(network, from, to, kmPerPixel, { ...options, limit: 1 });
  delete result.paths;
  return result;
}

export function simplifyRoadStroke(points, dimensions, tolerance = 2) {
  if (points.length < 3) return points.map(coordinates);
  const keep = new Set([0, points.length - 1]), stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop(); let farthest = -1, max = tolerance;
    for (let i = first + 1; i < last; i += 1) {
      const value = projection(points[i], points[first], points[last], dimensions).distance;
      if (value > max) { max = value; farthest = i; }
    }
    if (farthest !== -1) { keep.add(farthest); stack.push([first, farthest], [farthest, last]); }
  }
  return [...keep].sort((a, b) => a - b).map((index) => coordinates(points[index]));
}

export function addRoadStroke(network, points, dimensions = network, snapPixels = 8) {
  const simplified = simplifyRoadStroke(points, dimensions);
  const snapped = simplified.map((point) => snapRoadPoint(network, point, dimensions, snapPixels));
  const trace = [];
  for (const point of snapped) {
    const last = trace.at(-1);
    if (last && network.edges.length) {
      const path = findRoadPath(network, last, point);
      const access = path.status === 'found' ? distance(last, path.points[0], dimensions) + distance(point, path.points.at(-1), dimensions) : Infinity;
      const pathLength = path.status === 'found' ? path.points.slice(1).reduce((sum, next, index) => sum + distance(path.points[index], next, dimensions), 0) : Infinity;
      if (access < EPS && pathLength <= distance(last, point, dimensions) + snapPixels * 2) trace.push(...path.points.slice(1, -1));
    }
    trace.push(point);
  }
  const nodes = [...network.nodes], edges = [...network.edges], used = new Set(nodes.map((node) => node.id));
  const traceNodes = trace.map((point, index) => {
    let id = `draw.${pointKey(point)}.${index}`; while (used.has(id)) id += '.';
    used.add(id); const node = { id, ...coordinates(point) }; nodes.push(node); return node;
  });
  traceNodes.slice(1).forEach((node, index) => {
    let id = `draw.edge.${node.id}`; while (edges.some((edge) => edge.id === id)) id += '.';
    edges.push({ id, from: traceNodes[index].id, to: node.id });
  });
  return normalizeRoadNetwork({ ...network, nodes, edges });
}
