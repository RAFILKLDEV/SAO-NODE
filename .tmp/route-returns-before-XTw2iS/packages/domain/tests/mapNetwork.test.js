import { describe, expect, it } from 'vitest';
import { addRoadStroke, emptyRoadNetwork, findRoadConnectionSuggestions, findRoadPath, findRoadPaths, joinRoadConnection, normalizeRoadNetwork, prepareRoadNetwork, roadNetworkSchema, simplifyRoadStroke } from '../src/mapNetwork.js';

const graph = (points, pairs, width = 1000, height = 1000) => ({ imageWidth: width, imageHeight: height, nodes: points.map(([x, y], i) => ({ id: `n${i}`, x, y })), edges: pairs.map(([from, to], i) => ({ id: `e${i}`, from: `n${from}`, to: `n${to}` })) });
const p = (x, y) => ({ x, y });

describe('repairing saved road networks', () => {
  it('queries an unsplit crossing both ways without changing saved IDs or data', () => {
    const network = graph([[0, .5], [1, .5], [.5, 0], [.5, 1]], [[0, 1], [2, 3]]), before = structuredClone(network);
    for (const [from, to] of [[p(0, .5), p(.5, 1)], [p(.5, 1), p(0, .5)]]) {
      const path = findRoadPaths(network, from, to, .01, { preferredEdgeIds: ['e1'] });
      expect(path).toMatchObject({ status: 'found', distancePixels: 1000, distanceKm: 10 });
      expect(new Set(path.edgeIds)).toEqual(new Set(['e0', 'e1']));
    }
    expect(network).toEqual(before);
  });

  it('recognizes T junctions and a preference through any subdivided or overlapping portion', () => {
    const tee = graph([[0, .5], [1, .5], [.5, .5], [.5, 1]], [[0, 1], [2, 3]]);
    expect(findRoadPath(tee, p(.9, .5), p(.5, .9))).toMatchObject({ status: 'found', edgeIds: ['e0', 'e1'] });
    const overlap = graph([[.1, .5], [.8, .5], [.4, .5], [1, .5]], [[0, 1], [2, 3]]);
    const path = findRoadPaths(overlap, p(.6, .5), p(.9, .5), null, { preferredEdgeIds: ['e0', 'e1'] });
    expect(path.status).toBe('found');
    expect(new Set(path.edgeIds)).toEqual(new Set(['e0', 'e1']));
    expect(path.distancePixels).toBeCloseTo(300);
  });

  it('keeps different paths distinct even when their reported original road IDs match', () => {
    const network = graph([[0, .5], [1, .5]], [[0, 1]]);
    const options = { fromTerritory: [p(.1, .1), p(.9, .1), p(.9, .9), p(.7, .9), p(.7, .3), p(.3, .3), p(.3, .9), p(.1, .9)] };
    const paths = findRoadPaths(network, p(.5, .2), p(.5, .5), null, options).paths;
    const sameRoad = paths.filter(path => JSON.stringify(path.edgeIds) === '["e0"]');
    expect(sameRoad.length).toBeGreaterThan(1);
    expect(new Set(paths.map(path => path.id)).size).toBe(paths.length);
    expect(findRoadPaths(network, p(.5, .2), p(.5, .5), null, options).paths.map(path => path.id)).toEqual(paths.map(path => path.id));
  });

  it('reports topology exceeding the limit while retaining the original editable network', () => {
    const points = [], pairs = [];
    for (let i = 1; i <= 70; i += 1) {
      const index = points.length; points.push([0, i / 71], [1, i / 71], [i / 71, 0], [i / 71, 1]); pairs.push([index, index + 1], [index + 2, index + 3]);
    }
    const network = graph(points, pairs), before = structuredClone(network), result = prepareRoadNetwork(network);
    expect(result.tooLarge).toBe(true); expect(result.network).toEqual(network);
    expect(findRoadPaths(network, p(0, 1 / 71), p(1, 1 / 71))).toMatchObject({ status: 'no_path', reason: 'network_too_large', paths: [] });
    expect(network).toEqual(before);
  });
});

describe('reviewed road connections', () => {
  it('suggests an endpoint-to-road gap within 12 image pixels and joins only when chosen', () => {
    const network = graph([[0, .5], [1, .5], [.5, .512], [.5, .8]], [[0, 1], [2, 3]]), before = structuredClone(network);
    const suggestions = findRoadConnectionSuggestions(network);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({ sourceNodeId: 'n2', targetEdgeId: 'e0', to: p(.5, .5) });
    expect(findRoadPath(network, p(0, .5), p(.5, .8)).reason).toBe('disconnected');
    const joined = joinRoadConnection(network, suggestions[0]);
    expect(findRoadPath(joined, p(0, .5), p(.5, .8)).status).toBe('found');
    expect(roadNetworkSchema.safeParse(joined).success).toBe(true);
    expect(findRoadConnectionSuggestions(joined)).toEqual([]); expect(network).toEqual(before);
    expect(findRoadConnectionSuggestions({ ...network, nodes: network.nodes.map(node => node.id === 'n2' ? { ...node, y: .5121 } : node) })).toEqual([]);
  });

  it('deduplicates endpoint pairs, preserves the target ID and rejects stale suggestions', () => {
    const network = graph([[0, .5], [.4, .5], [.41, .5], [1, .5]], [[0, 1], [2, 3]]);
    const suggestions = findRoadConnectionSuggestions(network);
    expect(suggestions).toHaveLength(1);
    const joined = joinRoadConnection(network, suggestions[0]);
    expect(joined.nodes.some(node => node.id === suggestions[0].targetNodeId)).toBe(true);
    expect(joined.nodes.some(node => node.id === suggestions[0].sourceNodeId)).toBe(false);
    expect(findRoadPath(joined, p(0, .5), p(1, .5)).status).toBe('found');
    expect(joinRoadConnection(joined, suggestions[0])).toBe(joined);
  });

  it('uses original image dimensions and never suggests a connection inside one component', () => {
    const network = graph([[0, .5], [1, .5], [.5, .51], [.5, .8]], [[0, 1], [2, 3]], 2000, 2000);
    expect(findRoadConnectionSuggestions(network)).toEqual([]);
    expect(findRoadConnectionSuggestions(network, { imageWidth: 1000, imageHeight: 1000 })).toHaveLength(1);
    const connected = normalizeRoadNetwork(graph([[0, .5], [1, .5], [.5, .5], [.5, .8]], [[0, 1], [2, 3]]));
    expect(findRoadConnectionSuggestions(connected)).toEqual([]);
  });
});

describe('shared road geometry', () => {
  it('offers connected branches as explicit detours and counts the return distance', () => {
    const network = graph([[0, .5], [.5, .5], [1, .5], [.5, .2]], [[0, 1], [1, 2], [1, 3]]);
    const before = structuredClone(network), direct = findRoadPaths(network, p(0, .5), p(1, .5));
    expect(direct.paths).toHaveLength(1);
    const choices = findRoadPaths(network, p(0, .5), p(1, .5), .01, { allowReturns: true });
    expect(choices.paths).toHaveLength(2);
    expect(choices.paths[1]).toMatchObject({ requiresReturn: true, preferredEdgeIds: ['e2'], distancePixels: 1600, distanceKm: 16 });
    expect(choices.paths[1].points).toEqual([p(0, .5), p(.5, .5), p(.5, .2), p(.5, .5), p(1, .5)]);
    expect(findRoadPaths(network, p(0, .5), p(1, .5), null, { preferredEdgeIds: ['e2'], allowReturns: true }).paths[0].distancePixels).toBeCloseTo(1600);
    expect(network).toEqual(before);
  });

  it('never connects an isolated passage, even when return trips are allowed', () => {
    const network = graph([[0, .5], [1, .5], [.4, .2], [.6, .2]], [[0, 1], [2, 3]]);
    expect(findRoadPaths(network, p(0, .5), p(1, .5), null, { allowReturns: true }).paths).toHaveLength(1);
    expect(findRoadPaths(network, p(0, .5), p(1, .5), null, { preferredEdgeIds: ['e1'], allowReturns: true })).toMatchObject({ status: 'no_path', reason: 'preference_unavailable' });
  });

  it('includes connected branches even when other simple alternatives already exist', () => {
    const network = graph([[.1, .5], [.9, .5], [.5, .2], [.5, .5], [.5, .8]], [[0, 3], [3, 1], [0, 2], [2, 1], [3, 4]]);
    const choices = findRoadPaths(network, p(.1, .5), p(.9, .5), null, { limit: 8, allowReturns: true });
    expect(choices.paths).toHaveLength(3);
    expect(choices.paths.find(path => path.edgeIds.includes('e4'))).toMatchObject({ requiresReturn: true, edgeIds: ['e0', 'e4', 'e1'], distancePixels: 1400 });
    expect(choices.paths.map(path => path.distancePixels)).toEqual([...choices.paths.map(path => path.distancePixels)].sort((a, b) => a - b));
  });

  it('covers a multi-segment branch with one return to its endpoint', () => {
    const network = graph([[0, .5], [.2, .5], [1, .5], [.2, .4], [.2, .2], [.2, 0]], [[0, 1], [1, 2], [1, 3], [3, 4], [4, 5]]);
    const choices = findRoadPaths(network, p(0, .5), p(1, .5), null, { limit: 2, allowReturns: true });
    expect(choices.paths).toHaveLength(2);
    expect(choices.paths[1].edgeIds).toEqual(['e0', 'e2', 'e3', 'e4', 'e3', 'e2', 'e1']);
    expect(choices.truncated).toBeUndefined();
  });

  it('includes a connected circuit attached through one junction without requiring a dead end', () => {
    const network = graph([[.1, .5], [.9, .5], [.5, .5], [.4, .8], [.6, .8]], [[0, 2], [2, 1], [2, 3], [3, 4], [4, 2]]);
    const choices = findRoadPaths(network, p(.1, .5), p(.9, .5), null, { limit: 8, allowReturns: true });
    expect(new Set(choices.paths.flatMap(path => path.edgeIds))).toEqual(new Set(network.edges.map(edge => edge.id)));
    expect(choices.paths.find(path => path.edgeIds.includes('e3'))).toMatchObject({ requiresReturn: true });
    expect(choices.truncated).toBeUndefined();
  });

  it('offers one complete circuit detour instead of a return at every point of its approach', () => {
    const network = graph([[0, .5], [.2, .5], [1, .5], [.2, .4], [.2, .3], [.2, .2], [.3, .1], [.4, .2]], [[0, 1], [1, 2], [1, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 5]]);
    const choices = findRoadPaths(network, p(0, .5), p(1, .5), null, { limit: 8, coverageLimit: 32, allowReturns: true });
    expect(choices.paths).toHaveLength(2);
    expect(choices.paths[1].requiresReturn).toBe(true);
    expect(new Set(choices.paths.flatMap(path => path.edgeIds))).toEqual(new Set(network.edges.map(edge => edge.id)));
    expect(choices.truncated).toBeUndefined();
    const opposite = findRoadPaths(network, p(1, .5), p(0, .5), null, { limit: 8, coverageLimit: 32, allowReturns: true });
    expect(opposite.paths).toHaveLength(2);
    expect(opposite.paths.map(path => path.distancePixels)).toEqual(choices.paths.map(path => path.distancePixels));
  });

  it('can complete connected passage coverage beyond the initial list of shortest alternatives', () => {
    const points = [[0, .5], [.1, .5], [1, .5], ...Array.from({ length: 12 }, (_, index) => [.15 + index * .06, .1])];
    const network = graph(points, [[0, 1], [1, 2], ...points.slice(3).map((_, index) => [1, index + 3])]);
    const limited = findRoadPaths(network, p(0, .5), p(1, .5), null, { limit: 8, allowReturns: true });
    expect(limited.paths).toHaveLength(8);
    expect(limited.truncated).toBe(true);
    const complete = findRoadPaths(network, p(0, .5), p(1, .5), null, { limit: 8, coverageLimit: 32, allowReturns: true });
    expect(complete.paths).toHaveLength(13);
    expect(new Set(complete.paths.flatMap(path => path.edgeIds))).toEqual(new Set(network.edges.map(edge => edge.id)));
    expect(complete.truncated).toBeUndefined();
    expect(findRoadPaths(network, p(0, .5), p(1, .5), null, { limit: 8, coverageLimit: 10, allowReturns: true }).truncated).toBe(true);
  });

  it('splits a crossing into four edges sharing one junction and preserves stable IDs', () => {
    const result = normalizeRoadNetwork(graph([[0, .5], [1, .5], [.5, 0], [.5, 1]], [[0, 1], [2, 3]]));
    expect(result.nodes).toHaveLength(5);
    expect(result.edges).toHaveLength(4);
    const junction = result.nodes.find((n) => n.x === .5 && n.y === .5);
    expect(result.edges.filter((e) => e.from === junction.id || e.to === junction.id)).toHaveLength(4);
    expect(normalizeRoadNetwork(result)).toEqual(result);
    expect(findRoadPath(result, p(0, .5), p(.5, 1)).distancePixels).toBeCloseTo(1000);
  });

  it('shares computed intersections on opposite sides of a rounding boundary', () => {
    const network = graph([[.01, .01], [.99, .99], [.030000005, .001], [.030000005, .999]], [[0, 1], [2, 3]]);
    const normalized = normalizeRoadNetwork(network);
    expect(normalized.nodes).toHaveLength(5);
    expect(normalized.edges).toHaveLength(4);
    expect(findRoadPath(normalized, p(.01, .01), p(.030000005, .001)).status).toBe('found');
    expect(normalizeRoadNetwork(normalized)).toEqual(normalized);
  });

  it('queries previously split junctions with numerically equivalent coordinates without changing IDs', () => {
    const network = graph([[.01, .01], [.99, .99], [.030000005, .001], [.030000005, .999], [.030000005000000003, .030000005000000003], [.030000005, .030000005000000003]], [[0, 4], [4, 1], [2, 5], [5, 3]]);
    const before = structuredClone(network), choice = findRoadPath(network, p(.01, .01), p(.030000005, .001));
    expect(choice).toMatchObject({ status: 'found', edgeIds: ['e0', 'e2'] });
    expect(network).toEqual(before);
  });

  it('consolidates partial, reversed and identical overlaps and removes zero length segments', () => {
    const result = normalizeRoadNetwork(graph([[0, .5], [.7, .5], [.3, .5], [1, .5], [0, .5]], [[0, 1], [3, 2], [1, 0], [0, 4]]));
    expect(result.nodes).toHaveLength(4);
    expect(result.edges).toHaveLength(3);
    expect(findRoadPath(result, p(0, .5), p(1, .5)).distancePixels).toBeCloseTo(1000);
    expect(roadNetworkSchema.safeParse(result).success).toBe(true);
  });

  it('chooses the shorter branch in a cycle, using natural image dimensions', () => {
    const network = normalizeRoadNetwork(graph([[0, 0], [1, 0], [1, 1], [.5, .2]], [[0, 1], [1, 2], [0, 3], [3, 2]], 2000, 1000));
    const path = findRoadPath(network, p(0, 0), p(1, 1), .01);
    expect(path.points).toEqual([p(0, 0), p(.5, .2), p(1, 1)]);
    expect(path.distancePixels).toBeCloseTo(Math.hypot(1000, 200) + Math.hypot(1000, 800));
    expect(path.distanceKm).toBeCloseTo(path.distancePixels * .01);
    expect(findRoadPath(network, p(1, 1), p(0, 0)).distancePixels).toBeCloseTo(path.distancePixels);
  });

  it('projects both accesses into the middle of the same edge without changing saved geometry', () => {
    const network = graph([[0, .5], [1, .5]], [[0, 1]]), before = structuredClone(network);
    const path = findRoadPath(network, p(.2, .4), p(.8, .7));
    expect(path.points).toEqual([p(.2, .5), p(.8, .5)]);
    expect(path.accessFrom).toEqual([p(.2, .4), p(.2, .5)]);
    expect(path.accessTo).toEqual([p(.8, .5), p(.8, .7)]);
    expect(path.distancePixels).toBeCloseTo(900);
    expect(path.distanceKm).toBeNull();
    expect(network).toEqual(before);
    expect(findRoadPath(network, p(.8, .7), p(.2, .4)).distancePixels).toBeCloseTo(900);
  });

  it('handles bifurcations, identical projections, and disconnected components without direct fallback', () => {
    const network = normalizeRoadNetwork(graph([[0, .5], [1, .5], [.5, .5], [.5, 0], [0, .9], [1, .9]], [[0, 1], [2, 3], [4, 5]]));
    expect(findRoadPath(network, p(.2, .5), p(.5, .1)).distancePixels).toBeCloseTo(700);
    expect(findRoadPath(network, p(.2, .4), p(.2, .6)).distancePixels).toBeCloseTo(200);
    expect(findRoadPath(network, p(.2, .5), p(.2, .9))).toMatchObject({ status: 'no_path', reason: 'disconnected', points: [] });
    expect(findRoadPath(emptyRoadNetwork(), p(0, 0), p(1, 1))).toMatchObject({ status: 'no_path', reason: 'empty_network' });
  });

  it('simplifies a freehand stroke and snaps it to the existing road', () => {
    expect(simplifyRoadStroke([p(0, .5), p(.2, .5001), p(1, .5)], { imageWidth: 1000, imageHeight: 500 })).toEqual([p(0, .5), p(1, .5)]);
    const network = graph([[0, .5], [1, .5]], [[0, 1]]);
    const drawn = addRoadStroke(network, [p(.5, .505), p(.5, 1)], network);
    expect(drawn.edges).toHaveLength(3);
    expect(findRoadPath(drawn, p(0, .5), p(.5, 1)).distancePixels).toBeCloseTo(1000);
    expect(addRoadStroke(network, [p(.2, .504), p(.8, .504)], network).edges).toHaveLength(3);
  });

  it('rejects references, invalid coordinates, dimensions and duplicate IDs', () => {
    const network = graph([[0, 0], [1, 1]], [[0, 1]]);
    expect(roadNetworkSchema.safeParse(network).success).toBe(true);
    for (const bad of [{ ...network, imageWidth: 0 }, { ...network, nodes: [...network.nodes, network.nodes[0]] }, { ...network, edges: [{ id: 'e', from: 'missing', to: 'n0' }] }, { ...network, secretName: 'hidden' }]) expect(roadNetworkSchema.safeParse(bad).success).toBe(false);
  });

  it('reuses the existing curve when a new stroke follows it closely', () => {
    const network = graph([[.1, .5], [.5, .51], [.9, .5]], [[0, 1], [1, 2]]);
    expect(addRoadStroke(network, [p(.1, .503), p(.9, .503)], network)).toEqual(network);
  });

  it('avoids collisions between generated junction IDs and supplied IDs', () => {
    const network = graph([[0, .5], [1, .5], [.5, 0], [.5, 1]], [[0, 1], [2, 3]]);
    network.nodes[0].id = 'node.0.50000000:0.50000000'; network.edges[0].from = network.nodes[0].id;
    const result = normalizeRoadNetwork(network);
    expect(roadNetworkSchema.safeParse(result).success).toBe(true);
    expect(result.nodes.find((node) => node.x === .5 && node.y === .5).id).not.toBe(network.nodes[0].id);
    expect(normalizeRoadNetwork(result)).toEqual(result);
  });
});

describe('road consultations with alternatives and territories', () => {
  it('groups accesses to the same exterior route and keeps the shortest representative both ways', () => {
    const network = graph([[.1, .5], [.9, .5], [.5, .4], [.5, .6]], [[0, 1], [2, 3]]), before = structuredClone(network);
    const territory = [p(.1, .35), p(.7, .35), p(.7, .65), p(.1, .65)], from = p(.2, .45), to = p(.9, .5);
    const forward = findRoadPaths(network, from, to, null, { fromTerritory: territory, allowReturns: true, coverageLimit: 32 });
    const reverse = findRoadPaths(network, to, from, null, { toTerritory: territory, allowReturns: true, coverageLimit: 32 });
    expect(forward.paths).toHaveLength(1); expect(reverse.paths).toHaveLength(1);
    expect(forward.accessFrom[1].x).toBeCloseTo(.7);
    expect(reverse.accessTo[0]).toEqual(forward.accessFrom[1]);
    expect(reverse.distancePixels).toBeCloseTo(forward.distancePixels);
    expect(forward.truncated).toBeUndefined(); expect(reverse.truncated).toBeUndefined();
    const via = findRoadPaths(network, from, to, null, { fromTerritory: territory, preferredEdgeIds: ['e1'], allowReturns: true });
    expect(via.status).toBe('found'); expect(via.edgeIds).toContain('e1');
    expect(via.id).toBe(forward.id);
    expect(network).toEqual(before);
  });

  it('preserves different exterior roads through a territory, including an outside branch on a partly inside road', () => {
    const network = graph([[0, .3], [.8, .3], [0, .7], [.8, .7], [.9, .5], [.2, .5], [.2, 0]], [[0, 1], [1, 4], [2, 3], [3, 4], [5, 6]]);
    const territory = [p(.1, .2), p(.4, .2), p(.4, .8), p(.1, .8)];
    const choices = findRoadPaths(network, p(.2, .5), p(.9, .5), null, { fromTerritory: territory, allowReturns: true, coverageLimit: 32 });
    expect(choices.paths.some(path => path.edgeIds.includes('e0'))).toBe(true);
    expect(choices.paths.some(path => path.edgeIds.includes('e2'))).toBe(true);
    expect(choices.paths.some(path => path.edgeIds.includes('e4'))).toBe(true);
    expect(new Set(choices.paths.map(path => path.id)).size).toBe(choices.paths.length);
  });

  it('groups subpixel variants but preserves a visibly different road', () => {
    const network = graph([[.1, .5], [.9, .5], [.5, .5004], [.5, .51]], [[0, 1], [0, 2], [2, 1], [0, 3], [3, 1]]);
    const choices = findRoadPaths(network, p(.1, .5), p(.9, .5));
    expect(choices.paths).toHaveLength(2);
    expect(choices.paths[0].edgeIds).toEqual(['e0']);
    expect(choices.paths[1].edgeIds).toEqual(['e3', 'e4']);
  });

  it('signals omitted choices at the list limit and still consults any selected connected passage', () => {
    const points = [[.1, .5], [.9, .5], ...Array.from({ length: 10 }, (_, index) => [.5, .05 + index * .09])];
    const network = graph(points, points.slice(2).flatMap((_, index) => [[0, index + 2], [index + 2, 1]]));
    const choices = findRoadPaths(network, p(.1, .5), p(.9, .5), null, { limit: 8, allowReturns: true });
    expect(choices.paths).toHaveLength(8);
    expect(choices.truncated).toBe(true);
    const omitted = network.edges.find(edge => !choices.paths.some(path => path.edgeIds.includes(edge.id)));
    expect(omitted).toBeDefined();
    expect(findRoadPaths(network, p(.1, .5), p(.9, .5), null, { limit: 1, preferredEdgeIds: [omitted.id], allowReturns: true })).toMatchObject({ status: 'found', edgeIds: expect.arrayContaining([omitted.id]) });
  });

  it('returns distinct simple alternatives in distance order, preserving stable IDs', () => {
    const network = graph([[.1, .5], [.9, .5], [.5, .4], [.5, .1], [.5, .9]], [[0, 1], [0, 2], [2, 1], [0, 3], [3, 1], [0, 4], [4, 1]], 2000, 1000);
    const result = findRoadPaths(network, p(.1, .5), p(.9, .5), .01);
    expect(result.paths).toHaveLength(4);
    expect(result.paths.map((path) => path.edgeIds)).toEqual([['e0'], ['e1', 'e2'], ['e3', 'e4'], ['e5', 'e6']]);
    expect(result.paths.map((path) => path.distancePixels)).toEqual([...result.paths.map((path) => path.distancePixels)].sort((a, b) => a - b));
    for (const path of result.paths) {
      expect(new Set(path.points.map((point) => `${point.x},${point.y}`)).size).toBe(path.points.length);
      expect(path.distanceKm).toBeCloseTo(path.distancePixels * .01);
    }
    expect(findRoadPaths(network, p(.1, .5), p(.9, .5)).paths.map((path) => path.id)).toEqual(result.paths.map((path) => path.id));
    expect(findRoadPaths(network, p(.1, .5), p(.9, .5), null, { limit: 2 }).paths).toHaveLength(2);
    expect(findRoadPath(network, p(.1, .5), p(.9, .5)).edgeIds).toEqual(result.edgeIds);
  });

  it('allows a selected road to choose a longer feasible route and never fabricates a dead-end loop', () => {
    const network = graph([[.1, .5], [.9, .5], [.5, .1], [.5, .9], [.5, .5], [.5, .6]], [[0, 1], [0, 2], [2, 1], [0, 3], [3, 1], [4, 5]]);
    // Connect the dead end to the direct road as a real junction.
    const normalized = normalizeRoadNetwork(network);
    const preferred = findRoadPaths(normalized, p(.1, .5), p(.9, .5), null, { preferredEdgeIds: ['e3'] });
    expect(preferred.status).toBe('found');
    expect(preferred.paths).toHaveLength(1);
    expect(preferred.edgeIds).toEqual(['e3', 'e4']);
    expect(findRoadPaths(normalized, p(.1, .5), p(.9, .5), null, { preferredEdgeIds: ['e5'] })).toMatchObject({ status: 'no_path', reason: 'preference_unavailable', paths: [] });
    expect(findRoadPaths(normalized, p(.1, .5), p(.9, .5), null, { preferredEdgeIds: ['missing'] })).toMatchObject({ status: 'no_path', reason: 'invalid_preference' });
  });

  it('keeps both mid-edge accesses in every alternative and uses the same natural metric', () => {
    const network = graph([[0, .5], [1, .5], [.5, .1]], [[0, 1], [0, 2], [2, 1]], 2000, 1000), before = structuredClone(network);
    const result = findRoadPaths(network, p(.2, .6), p(.8, .7), .002);
    expect(result.paths).toHaveLength(2);
    expect(result.paths[0].distancePixels).toBeCloseTo(1500);
    expect(result.paths[0].points).toEqual([p(.2, .5), p(.8, .5)]);
    expect(result.paths[1].edgeIds).toEqual(['e0', 'e1', 'e2', 'e0']);
    expect(result.paths[1].distancePixels).toBeCloseTo(300 + 800 + 2 * Math.hypot(1000, 400));
    for (const path of result.paths) {
      expect(path.accessFrom).toEqual([p(.2, .6), p(.2, .5)]);
      expect(path.accessTo).toEqual([p(.8, .5), p(.8, .7)]);
      expect(path.distanceKm).toBeCloseTo(path.distancePixels * .002);
    }
    expect(network).toEqual(before);
  });

  it('uses a road crossing a territory even when both its endpoints are outside', () => {
    const network = graph([[0, .2], [.3, .2], [0, .7], [1, .7]], [[0, 1], [2, 3]], 2000, 1000), territory = [p(.1, .1), p(.4, .1), p(.4, .8), p(.1, .8)], before = structuredClone(network);
    expect(findRoadPath(network, p(.2, .2), p(.9, .7))).toMatchObject({ status: 'no_path', reason: 'disconnected' });
    const result = findRoadPaths(network, p(.2, .2), p(.9, .7), .01, { fromTerritory: territory });
    expect(result.status).toBe('found');
    expect(result.edgeIds).toEqual(['e1']);
    expect(result.accessFrom[1]).toEqual(p(.4, .7));
    expect(result.distancePixels).toBeCloseTo(Math.hypot(400, 500) + 1000);
    expect(result.distanceKm).toBeCloseTo(result.distancePixels * .01);
    expect(network).toEqual(before);
  });

  it('finds viable roads inside either territory and preserves disconnection between all accesses', () => {
    const network = graph([[0, .2], [.3, .2], [0, .7], [1, .7], [.7, .2], [1, .2]], [[0, 1], [2, 3], [4, 5]]);
    const left = [p(.1, .1), p(.4, .1), p(.4, .8), p(.1, .8)], right = [p(.6, .1), p(.9, .1), p(.9, .8), p(.6, .8)];
    expect(findRoadPaths(network, p(.2, .2), p(.8, .2), null, { fromTerritory: left, toTerritory: right })).toMatchObject({ status: 'found', edgeIds: ['e1'] });
    const isolated = { ...network, edges: network.edges.filter((edge) => edge.id !== 'e1') };
    expect(findRoadPaths(isolated, p(.2, .2), p(.8, .2), null, { fromTerritory: left, toTerritory: right })).toMatchObject({ status: 'no_path', reason: 'disconnected', paths: [] });
    expect(findRoadPaths(network, p(.1, .2), p(.3, .2), null, { fromTerritory: [p(.9, .9), p(1, .9), p(1, 1)] })).toMatchObject({ status: 'found', edgeIds: ['e0'] });
  });

  it('clips a concave territory into separate intervals and handles a road along its boundary', () => {
    const network = graph([[0, .5], [1, .5]], [[0, 1]]), territory = [p(.1, .1), p(.9, .1), p(.9, .9), p(.7, .9), p(.7, .3), p(.3, .3), p(.3, .9), p(.1, .9)];
    const result = findRoadPaths(network, p(.5, .6), p(.95, .5), null, { fromTerritory: territory });
    expect(result.accessFrom[1].x).toBeCloseTo(.9);
    expect(result.accessFrom[1].y).toBe(.5);
    const border = [p(.2, .5), p(.8, .5), p(.8, .8), p(.2, .8)];
    expect(findRoadPaths(network, p(.2, .6), p(.9, .5), null, { fromTerritory: border }).status).toBe('found');
  });
});
