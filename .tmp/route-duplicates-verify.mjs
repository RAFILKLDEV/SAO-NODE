import { PrismaClient } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import { findRoadPaths } from '../packages/domain/src/mapNetwork.js';
import { findRoadPaths as previousPaths } from './route-duplicates-before-dNHQKw/packages/domain/src/mapNetwork.js';
const prisma = new PrismaClient();
try {
  const fixture = JSON.parse(await readFile('.tmp/route-duplicate-fixture.json', 'utf8'));
  const board = await prisma.mapBoard.findFirst({ where: { pins: { some: { entityId: fixture.from.entityId } } }, select: { id: true, roadNetwork: true, version: true, updatedAt: true, pins: { select: { entityId: true, x: true, y: true } }, boundaries: { select: { regionId: true, points: true } } } });
  const from = board.pins.find(pin => pin.entityId === fixture.from.entityId), to = board.pins.find(pin => pin.entityId === fixture.to.entityId);
  const options = { limit: 8, coverageLimit: 32, allowReturns: true, fromTerritory: board.boundaries.find(boundary => boundary.regionId === from.entityId)?.points, toTerritory: board.boundaries.find(boundary => boundary.regionId === to.entityId)?.points };
  const before = previousPaths(board.roadNetwork, from, to, null, options);
  const forward = findRoadPaths(board.roadNetwork, from, to, null, options);
  const reverse = findRoadPaths(board.roadNetwork, to, from, null, { ...options, fromTerritory: options.toTerritory, toTerritory: options.fromTerritory });
  const unavailable = [];
  for (const edge of board.roadNetwork.edges) {
    const path = findRoadPaths(board.roadNetwork, from, to, null, { ...options, limit: 1, preferredEdgeIds: [edge.id] });
    if (path.status !== 'found' || !path.edgeIds.includes(edge.id)) unavailable.push({ id: edge.id, status: path.status, reason: path.reason });
  }
  const saved = await prisma.mapBoard.findUnique({ where: { id: board.id }, select: { roadNetwork: true, version: true, updatedAt: true } });
  console.log(JSON.stringify({ before: before.paths.length, forward: forward.paths.length, reverse: reverse.paths.length, coveredRoads: new Set(forward.paths.flatMap(path => path.edgeIds)).size, totalRoads: board.roadNetwork.edges.length, uniqueChoices: new Set(forward.paths.map(path => path.id)).size, sameShortestDistance: forward.distancePixels === before.distancePixels, reverseShortestDistance: reverse.distancePixels, unavailable, unchanged: saved.version === board.version && saved.updatedAt.getTime() === board.updatedAt.getTime() && JSON.stringify(saved.roadNetwork) === JSON.stringify(board.roadNetwork) }));
} finally { await prisma.$disconnect(); }
