import { readFile, writeFile } from 'node:fs/promises';
const fixture = JSON.parse(await readFile('.tmp/route-duplicate-fixture.json', 'utf8'));
let source = await readFile('packages/domain/src/mapNetwork.js', 'utf8');
source += '\nexport { queryGraph, queryAlternatives, branchAlternatives, pathEdges, roadPathKey };\n';
await writeFile('.tmp/mapNetwork-probe.mjs', source, 'utf8');
const current = await import('./mapNetwork-probe.mjs');
const prepared = current.prepareRoadNetwork(fixture.network);
const graph = current.queryGraph(prepared.network, fixture.from, fixture.to, fixture.options, prepared.sourceEdges);
const first = current.queryAlternatives(graph, 8).paths;
console.log(JSON.stringify({ initial: first.map(path => ({ count: new Set(current.pathEdges(path)).size, cost: path.cost })) }));
source = source.replace('Number(b.terminal) - Number(a.terminal) || a.cost - b.cost', 'Number(b.terminal) - Number(a.terminal) || b.cost - a.cost');
await writeFile('.tmp/mapNetwork-probe-longest.mjs', source, 'utf8');
const longest = await import('./mapNetwork-probe-longest.mjs');
for (const [label, implementation] of [['current', current], ['longest', longest]]) {
  const result = implementation.findRoadPaths(fixture.network, fixture.from, fixture.to, null, fixture.options);
  console.log(JSON.stringify({ label, count: result.paths.length, used: new Set(result.paths.flatMap(path => path.edgeIds)).size, truncated: result.truncated, costs: result.paths.map(path => Math.round(path.distancePixels)), returning: result.paths.filter(path => path.requiresReturn).length }));
}
const result = current.findRoadPaths(fixture.network, fixture.from, fixture.to, null, fixture.options);
const toPixel = point => ({ x: point.x * fixture.network.imageWidth, y: point.y * fixture.network.imageHeight });
const distanceTo = (point, a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y, squared = dx * dx + dy * dy;
  const t = squared ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / squared)) : 0;
  return Math.hypot(point.x - a.x - dx * t, point.y - a.y - dy * t);
};
const directed = (a, b) => Math.max(...a.slice(1).flatMap((point, index) => [a[index], ...[.25, .5, .75].map(t => ({ x: a[index].x + (point.x - a[index].x) * t, y: a[index].y + (point.y - a[index].y) * t })), point]).map(point => Math.min(...b.slice(1).map((end, index) => distanceTo(point, b[index], end)))));
const shapes = result.paths.map(path => path.points.map(toPixel));
const near = [];
for (let i = 0; i < shapes.length; i += 1) for (let j = i + 1; j < shapes.length; j += 1) {
  const delta = Math.max(directed(shapes[i], shapes[j]), directed(shapes[j], shapes[i]));
  if (delta < 4) near.push({ pair: [i + 1, j + 1], pixels: delta });
}
console.log(JSON.stringify({ near }));
