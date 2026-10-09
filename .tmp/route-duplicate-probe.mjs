import { PrismaClient } from '@prisma/client';
import { findRoadPaths } from '../packages/domain/src/mapNetwork.js';
import { writeFile } from 'node:fs/promises';
const prisma = new PrismaClient();
try {
  const entities = await prisma.entity.findMany({ where: { type: 'location', OR: [{ name: { contains: 'Brisa' } }, { name: { contains: 'Cercas' } }] }, select: { domainId: true, campaignId: true, name: true } });
  const boards = await prisma.mapBoard.findMany({ where: { pins: { some: { entityId: { in: entities.map(entity => entity.domainId) } } } }, select: { id: true, name: true, campaignId: true, version: true, roadNetwork: true, pins: { select: { entityId: true, x: true, y: true } }, boundaries: { select: { regionId: true, points: true } } } });
  for (const board of boards) {
    const fromEntity = entities.find(entity => entity.campaignId === board.campaignId && /Brisa/i.test(entity.name));
    const toEntity = entities.find(entity => entity.campaignId === board.campaignId && /Cercas/i.test(entity.name));
    const from = board.pins.find(pin => pin.entityId === fromEntity?.domainId), to = board.pins.find(pin => pin.entityId === toEntity?.domainId);
    if (!from || !to || !board.roadNetwork) continue;
    const options = { limit: 8, coverageLimit: 32, allowReturns: true, fromTerritory: board.boundaries.find(boundary => boundary.regionId === from.entityId)?.points, toTerritory: board.boundaries.find(boundary => boundary.regionId === to.entityId)?.points };
    const result = findRoadPaths(board.roadNetwork, from, to, null, options);
    const paths = result.paths;
    console.log(JSON.stringify({ board: board.name, pair: [fromEntity.name, toEntity.name], count: paths.length, truncated: result.truncated, paths: paths.map(path => ({ id: path.id, distance: +path.distancePixels.toFixed(3), edges: path.edgeIds.length, points: path.points.length, return: path.requiresReturn ?? false, access: [path.points[0], path.points.at(-1)] })) }));
    const key = (point) => [point.x.toFixed(8), point.y.toFixed(8)].join(',');
    const segments = paths.map(path => new Set(path.points.slice(1).map((point, index) => [key(path.points[index]), key(point)].sort().join('|'))));
    const similar = [];
    for (let i = 0; i < paths.length; i += 1) for (let j = i + 1; j < paths.length; j += 1) {
      const shared = [...segments[i]].filter(segment => segments[j].has(segment)).length, ratio = shared / Math.max(segments[i].size, segments[j].size);
      if (ratio > .85) similar.push({ pair: [i + 1, j + 1], shared: +ratio.toFixed(3), difference: Math.abs(paths[i].distancePixels - paths[j].distancePixels) });
    }
    console.log(JSON.stringify({ similar }));
    await writeFile('.tmp/route-duplicate-fixture.json', JSON.stringify({ network: board.roadNetwork, from, to, options }), 'utf8');
  }
} finally { await prisma.$disconnect(); }
