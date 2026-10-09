import { PrismaClient } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import { findRoadPaths } from '../packages/domain/src/mapNetwork.js';
import { findRoadPaths as previousPaths } from './route-returns-before-XTw2iS/packages/domain/src/mapNetwork.js';
const prisma = new PrismaClient();
try {
  const fixture = JSON.parse(await readFile('.tmp/route-duplicate-fixture.json', 'utf8'));
  const board = await prisma.mapBoard.findFirst({ where: { pins: { some: { entityId: fixture.from.entityId } } }, select: { id: true, roadNetwork: true, version: true, updatedAt: true, pins: { select: { entityId: true, x: true, y: true } }, boundaries: { select: { regionId: true, points: true } } } });
  const from = board.pins.find(pin => pin.entityId === fixture.from.entityId), to = board.pins.find(pin => pin.entityId === fixture.to.entityId);
  const territories = { fromTerritory: board.boundaries.find(boundary => boundary.regionId === from.entityId)?.points, toTerritory: board.boundaries.find(boundary => boundary.regionId === to.entityId)?.points };
  const old = previousPaths(board.roadNetwork, from, to, null, { ...territories, limit: 8, coverageLimit: 32, allowReturns: true });
  const forward = findRoadPaths(board.roadNetwork, from, to, null, { ...territories, limit: 8, coverageLimit: 32 });
  const reverse = findRoadPaths(board.roadNetwork, to, from, null, { fromTerritory: territories.toTerritory, toTerritory: territories.fromTerritory, limit: 8, coverageLimit: 32 });
  const repeated = path => new Set(path.points.map(point => `${point.x.toFixed(8)}:${point.y.toFixed(8)}`)).size !== path.points.length;
  const unavailable = [];
  for (const edge of board.roadNetwork.edges) {
    const chosen = findRoadPaths(board.roadNetwork, from, to, null, { ...territories, limit: 1, allowReturns: true, preferredEdgeIds: [edge.id] });
    if (chosen.status !== 'found' || !chosen.edgeIds.includes(edge.id)) unavailable.push(edge.id);
  }
  const saved = await prisma.mapBoard.findUnique({ where: { id: board.id }, select: { roadNetwork: true, version: true, updatedAt: true } });
  console.log(JSON.stringify({ before: old.paths.length, beforeReturns: old.paths.filter(path => path.requiresReturn).length, forward: forward.paths.length, reverse: reverse.paths.length, forwardReturns: forward.paths.filter(repeated).length, reverseReturns: reverse.paths.filter(repeated).length, sameShortestDistance: old.distancePixels === forward.distancePixels, totalRoads: board.roadNetwork.edges.length, unavailable, unchanged: saved.version === board.version && saved.updatedAt.getTime() === board.updatedAt.getTime() && JSON.stringify(saved.roadNetwork) === JSON.stringify(board.roadNetwork) }));
} finally { await prisma.$disconnect(); }
