import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { audit } from '../lib/audit.js';
import { authenticate, isGm, requireCampaign, requireCsrf, requireGm } from '../lib/auth.js';
import { apiError } from '@sao/shared';
import { getEntityForRequest as getContentEntityForRequest } from '../services/content.js';
import { assertSafeRemoteUrl } from '../lib/security.js';
import { buildMapPinContent } from '../services/map-pin-content.js';
import { emptyRoadNetwork, findRoadPaths, nearestRoadPoint, normalizeRoadNetwork, roadNetworkSchema } from '@sao/domain';

const sessionInput = z.object({ label: z.string().trim().min(1).max(120).optional() }).strict();
const markerInput = z.object({
  ownerType: z.enum(['group', 'player']),
  ownerId: z.string().trim().min(1).max(120)
}).strict();
const moveInput = z.object({
  sessionId: z.string().trim().min(1).optional(),
  regionId: z.string().trim().min(1).max(256).optional(),
  ownerType: z.enum(['group', 'player']).optional(),
  ownerId: z.string().trim().min(1).max(120).optional(),
  markerType: z.enum(['group', 'player']).optional(),
  markerId: z.string().trim().min(1).max(120).optional(),
  locationId: z.string().trim().min(1).max(256),
  x: z.coerce.number().finite().min(0).max(1).optional(),
  y: z.coerce.number().finite().min(0).max(1).optional()
}).strict();
const sessionQuery = z.object({ sessionId: z.string().trim().min(1).optional() }).strict();
const boardSessionInput = z.object({ resetManualPins: z.boolean().optional().default(false) }).strict();
const boardImageInput = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  imageUrl: z.string().trim().min(1).max(2048),
  imageWidth: z.number().int().positive().max(100000000).optional(),
  imageHeight: z.number().int().positive().max(100000000).optional()
}).strict().refine((value) => (value.imageWidth == null) === (value.imageHeight == null), 'Informe as duas dimensões da imagem');
const boardCreateInput = z.object({
  regionId: z.string().trim().min(1).max(256).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  imageUrl: z.string().trim().min(1).max(2048).optional(),
  imageWidth: z.number().int().positive().max(100000000).optional(),
  imageHeight: z.number().int().positive().max(100000000).optional()
}).strict().refine((value) => (value.imageWidth == null) === (value.imageHeight == null), 'Informe as duas dimensões da imagem');
const normalizedPointInput = z.object({ x: z.number().finite().min(0).max(1), y: z.number().finite().min(0).max(1) }).strict();
const travelMarkerInput = normalizedPointInput.extend({
  ownerType: z.enum(['player', 'group', 'custom']),
  ownerId: z.string().trim().min(1).max(256).optional(),
  name: z.string().trim().min(1).max(120).optional()
});
const travelMarkerPatchInput = normalizedPointInput.extend({ name: z.string().trim().min(1).max(120).optional() });
const mapReadQuery = { boardId: z.string().min(1).max(256).optional(), viewAsUserId: z.string().min(1).max(256).optional() };
const boundaryPointsInput = z.array(normalizedPointInput).min(3).max(512).refine((points) => {
  const area = points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0);
  return Math.abs(area) > 0.00000001;
}, 'A delimitação precisa formar uma área');
const boundaryInput = z.object({ regionId: z.string().trim().min(1).max(256), name: z.string().trim().min(1).max(120).nullable().optional(), points: boundaryPointsInput }).strict();
const boundaryPatchInput = boundaryInput.partial().refine(input => Object.keys(input).length > 0, 'Informe uma alteração no limite');
const scaleInput = z.object({
  startX: z.coerce.number().finite().min(0).max(1),
  startY: z.coerce.number().finite().min(0).max(1),
  endX: z.coerce.number().finite().min(0).max(1),
  endY: z.coerce.number().finite().min(0).max(1),
  distanceKm: z.coerce.number().finite().positive().max(100000000),
  imageWidth: z.coerce.number().int().positive().max(100000000),
  imageHeight: z.coerce.number().int().positive().max(100000000)
}).refine((value) => value.startX !== value.endX || value.startY !== value.endY, 'Os pontos da régua precisam ser diferentes').strict();
const boardRegionInput = z.object({
  regionId: z.string().trim().min(1).max(256),
  x: z.coerce.number().finite().min(0).max(1).optional(),
  y: z.coerce.number().finite().min(0).max(1).optional(),
  width: z.coerce.number().finite().gt(0).max(1).optional(),
  height: z.coerce.number().finite().gt(0).max(1).optional(),
  zIndex: z.coerce.number().int().optional()
}).strict();
const boardRegionPatchInput = boardRegionInput.omit({ regionId: true }).refine((value) => Object.keys(value).length > 0, 'Informe uma alteração');
const pinInput = z.object({
  entityType: z.enum(['location', 'npc', 'item', 'monster', 'quest']).default('location'),
  entityId: z.string().trim().min(1).max(256).optional(),
  locationId: z.string().trim().min(1).max(256).optional(),
  regionId: z.string().trim().min(1).max(256).optional(),
  x: z.coerce.number().finite().min(0).max(1),
  y: z.coerce.number().finite().min(0).max(1)
}).strict();
const routeInput = z.object({ fromPinId: z.string().trim().min(1).optional(), toPinId: z.string().trim().min(1).optional(), fromLocationId: z.string().trim().min(1).optional(), toLocationId: z.string().trim().min(1).optional(), label: z.string().optional(), distanceKm: z.coerce.number().finite().optional() }).strict().refine((value) => (value.fromPinId && value.toPinId) || (value.fromLocationId && value.toLocationId), 'Selecione dois pins').refine((value) => !(value.fromPinId && (value.distanceKm != null || value.label != null)), 'A distância e o nome são calculados pelo mapa');
const routePatchInput = z.object({ fromPinId: z.string().trim().min(1).optional(), toPinId: z.string().trim().min(1).optional() }).strict();
const routePointInput = z.object({
  segmentIndex: z.coerce.number().int().min(0)
}).strict();

const userSelect = { id: true, name: true, login: true };
const sessionInclude = { createdBy: { select: userSelect } };
const locationInclude = {
  locationConnections: {
    select: { connectionId: true, targetDomainId: true, direction: true, distanceKm: true, travelMinutes: true, access: true, visibility: true, data: true }
  }
};
const boardInclude = {
  regions: true,
  pins: true,
  boundaries: { orderBy: { createdAt: 'asc' }, include: { updatedBy: { select: { id: true, name: true } } } },
  travelMarkers: { orderBy: { createdAt: 'asc' } },
  routes: { include: { points: { orderBy: { order: 'asc' } } }, orderBy: { createdAt: 'asc' } }
};

// "Informações gerais" is the basic section of a location.
function getEntityForRequest({ request, type, domainId, options = {} }) {
  return getContentEntityForRequest({ request, type, domainId, options: { ...options, ...(type === 'location' ? { requireSection: 'basic' } : {}) } });
}

function mapMaster(request) { return isGm(request) && !request.query?.viewAsUserId; }

async function requireMapEditor(request, reply) {
  if (request.query?.viewAsUserId) return reply.code(403).send(apiError('VIEWER_READ_ONLY', 'Saia de Visualizar como para editar o mapa'));
}

async function validateMapViewer(request) {
  if (!isGm(request) || !request.query?.viewAsUserId || request.mapViewerValidated) return;
  const userId = request.query.viewAsUserId;
  const membership = typeof userId === 'string' && userId.length <= 256 ? await prisma.membership.findUnique({ where: { campaignId_userId: { campaignId: request.campaign.id, userId } } }) : null;
  if (!membership || membership.role !== 'player') throw Object.assign(new Error('Selecione um jogador válido desta campanha'), { statusCode: 400, code: 'INVALID_VIEWER' });
  request.mapViewerValidated = true;
}

function networkKmPerPixel(board) {
  const scale = scaleDetails(board), network = board.roadNetwork;
  const pixels = scale && network ? Math.hypot((scale.endX - scale.startX) * network.imageWidth, (scale.endY - scale.startY) * network.imageHeight) : 0;
  return pixels ? scale.distanceKm / pixels : null;
}

function territoryForPin(board, pin) {
  const locationId = (pin.entityType ?? 'location') === 'location' ? pin.entityId ?? pin.locationId : null;
  return locationId ? (board.boundaries ?? []).find((boundary) => boundary.regionId === locationId)?.points : undefined;
}

function queryRoadPaths(board, from, to, options = {}) {
  return findRoadPaths(board.roadNetwork, from, to, networkKmPerPixel(board), { fromTerritory: territoryForPin(board, from), toTerritory: territoryForPin(board, to), ...options });
}

function noRoadPathMessage(reason) {
  if (reason === 'search_limit') return 'Há muitos percursos possíveis nesta rede. Escolha um trecho para orientar a consulta.';
  if (reason === 'preference_unavailable' || reason === 'invalid_preference') return 'Não existe percurso entre esses locais que passe por este trecho. Escolha outro caminho.';
  return 'Não existe caminho conectado entre esses locais';
}

async function visibleBoardPins(request, board) {
  return (await Promise.all((board.pins ?? []).map(async (pin) => {
    const entity = await getEntityForRequest({ request, type: pin.entityType ?? 'location', domainId: pin.entityId ?? pin.locationId, options: { backlinks: false, format: '1' } });
    return entity ? { ...pin, name: entity.name ?? entity.id } : null;
  }))).filter(Boolean);
}

async function travelMarkerCandidates(request) {
  if (!mapMaster(request)) return !isGm(request) && !request.query?.viewAsUserId && request.membership.role === 'player' ? [{ ownerType: 'player', ownerId: request.auth.user.id, name: request.auth.user.name ?? 'Meu pin' }] : [];
  const [memberships, groups] = await Promise.all([
    prisma.membership.findMany({ where: { campaignId: request.campaign.id, role: 'player' }, select: { userId: true, user: { select: { name: true } } } }),
    prisma.group.findMany({ where: { campaignId: request.campaign.id }, select: { domainId: true, name: true } })
  ]);
  return [...memberships.map((membership) => ({ ownerType: 'player', ownerId: membership.userId, name: membership.user.name })), ...groups.map((group) => ({ ownerType: 'group', ownerId: group.domainId, name: group.name }))];
}

function serializeTravelMarker(request, marker) {
  return { id: marker.id, ownerType: marker.ownerType, ownerId: marker.ownerId, name: marker.name, x: marker.x, y: marker.y, version: marker.version, updatedAt: marker.updatedAt, color: marker.ownerType === 'player' ? '#22c55e' : marker.ownerType === 'group' ? '#a855f7' : '#fb923c', canMove: !request.query?.viewAsUserId && (isGm(request) || (marker.ownerType === 'player' && marker.ownerId === request.auth.user.id)) };
}

function snappedMarkerPoint(board, point) { return (board.roadNetwork ? nearestRoadPoint(board.roadNetwork, point)?.point : null) ?? { x: point.x, y: point.y }; }

function serializeSession(session) {
  return {
    id: session.id,
    campaignId: session.campaignId,
    label: session.label,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    createdBy: session.createdBy
  };
}

function markerKey(ownerType, ownerId) {
  return `${ownerType}:${ownerId}`;
}

function isRegion(row) {
  return row?.data?.type === 'region';
}

async function loadLocationRows(campaignId) {
  return prisma.entity.findMany({
    where: { campaignId, type: 'location', deletedAt: null },
    select: { domainId: true, name: true, data: true, type: true, deletedAt: true, ...locationInclude }
  });
}

function regionForLocation(rows, locationId) {
  const byId = new Map(rows.map((row) => [row.domainId, row]));
  const seen = new Set();
  let current = byId.get(locationId);
  while (current && !seen.has(current.domainId)) {
    seen.add(current.domainId);
    if (isRegion(current)) return current.domainId;
    current = byId.get(current.data?.parentId);
  }
  return null;
}

function descendantsOfRegion(rows, regionId) {
  return rows.filter((row) => row.domainId !== regionId && regionForLocation(rows, row.domainId) === regionId);
}

function depthFromRegion(rows, locationId, regionId) {
  const byId = new Map(rows.map((row) => [row.domainId, row]));
  let depth = 0;
  let current = byId.get(locationId);
  const seen = new Set();
  while (current && current.domainId !== regionId && !seen.has(current.domainId)) {
    seen.add(current.domainId);
    depth += 1;
    current = byId.get(current.data?.parentId);
  }
  return depth;
}

function gridRect(index, total) {
  const columns = Math.max(1, Math.ceil(Math.sqrt(total)));
  const rows = Math.max(1, Math.ceil(total / columns));
  const gap = 0.025;
  const width = (1 - gap * (columns + 1)) / columns;
  const height = (1 - gap * (rows + 1)) / rows;
  return {
    x: gap + (index % columns) * (width + gap),
    y: gap + Math.floor(index / columns) * (height + gap),
    width,
    height
  };
}

function autoPinCoordinates(rows, regionId, locationId) {
  const children = descendantsOfRegion(rows, regionId)
    .sort((a, b) => `${a.name}:${a.domainId}`.localeCompare(`${b.name}:${b.domainId}`, 'pt-BR'));
  const depth = depthFromRegion(rows, locationId, regionId);
  const atDepth = children.filter((row) => depthFromRegion(rows, row.domainId, regionId) === depth);
  const index = Math.max(0, atDepth.findIndex((row) => row.domainId === locationId));
  const maxDepth = Math.max(1, ...children.map((row) => depthFromRegion(rows, row.domainId, regionId)));
  return {
    x: (depth + 1) / (maxDepth + 2),
    y: (index + 1) / (atDepth.length + 1)
  };
}

async function ensureBoard(request, rows = null, { includeMissing = false } = {}) {
  await validateMapViewer(request);
  const locationRows = rows ?? (includeMissing ? await loadLocationRows(request.campaign.id) : []);
  const selectedId = request.query?.boardId;
  if (selectedId !== undefined && (typeof selectedId !== 'string' || !selectedId.trim() || selectedId.length > 256)) {
    throw Object.assign(new Error('Mapa não encontrado'), { statusCode: 404, code: 'NOT_FOUND' });
  }
  let board = await prisma.mapBoard.findUnique({
    where: selectedId ? { id: selectedId } : { campaignId_boardKey: { campaignId: request.campaign.id, boardKey: 'general' } },
    include: boardInclude
  });
  if (selectedId && (!board || board.campaignId !== request.campaign.id)) {
    throw Object.assign(new Error('Mapa não encontrado'), { statusCode: 404, code: 'NOT_FOUND' });
  }
  if (board?.regionId) {
    const region = await getEntityForRequest({ request, type: 'location', domainId: board.regionId, options: { backlinks: false, format: '1' } });
    if (!region || boardEntitySummary(region).type !== 'region') {
      throw Object.assign(new Error('Mapa não encontrado'), { statusCode: 404, code: 'NOT_FOUND' });
    }
  }
  const regionRows = locationRows.filter((row) => isRegion(row) && (!board?.regionId || row.domainId === board.regionId)).sort((a, b) => `${a.name}:${a.domainId}`.localeCompare(`${b.name}:${b.domainId}`, 'pt-BR'));
  if (!board) {
    board = await prisma.mapBoard.upsert({
      where: { campaignId_boardKey: { campaignId: request.campaign.id, boardKey: 'general' } },
      create: { campaignId: request.campaign.id, boardKey: 'general', name: 'Mapa da campanha', createdByUserId: request.auth.user.id },
      update: {},
      include: boardInclude
    });
  }
  if (includeMissing) {
    const knownRegions = new Set(board.regions.map((entry) => entry.regionId));
    const missingRegions = regionRows.filter((region) => !knownRegions.has(region.domainId));
    if (missingRegions.length) {
      await prisma.$transaction(async (tx) => {
        const start = board.regions.length;
        for (const [offset, region] of missingRegions.entries()) {
          await tx.mapBoardRegion.create({ data: { boardId: board.id, regionId: region.domainId, ...gridRect(start + offset, regionRows.length), updatedByUserId: request.auth.user.id } });
          for (const location of descendantsOfRegion(locationRows, region.domainId)) {
            await tx.mapLocationPin.create({ data: { boardId: board.id, regionId: region.domainId, entityType: 'location', entityId: location.domainId, locationId: location.domainId, ...autoPinCoordinates(locationRows, region.domainId, location.domainId), updatedByUserId: request.auth.user.id } });
          }
        }
      });
    }
  }
  return prisma.mapBoard.findUnique({ where: { id: board.id }, include: boardInclude });
}

function boardEntitySummary(entity) {
  if (!entity) return null;
  const data = entity.data ?? entity;
  return {
    id: entity.id,
    name: entity.name ?? entity.id,
    type: data.type ?? 'location',
    state: data.state ?? entity.state ?? null,
    parentId: data.parentId ?? null,
    floor: data.placement?.floor ?? null,
    mapUrl: data.media?.map ?? data.mapUrl ?? data.map ?? ''
  };
}

async function authorizedLocationFloor(request, entity, entities) {
  const visited = new Set();
  let current = entity;
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    const summary = boardEntitySummary(current);
    if (summary.floor != null && summary.floor !== '') return String(summary.floor);
    if (!summary.parentId) break;
    current = entities ? entities.get(summary.parentId) : await getEntityForRequest({ request, type: 'location', domainId: summary.parentId, options: { backlinks: false, format: '1' } });
  }
  return null;
}

const PIN_COLORS = { region: '#8b5cf6', location: '#2563eb', npc: '#16a34a', quest: '#eab308', monster: '#dc2626', item: '#f97316' };
function pinTypeForEntity(entityType, entity) {
  if (entityType === 'location' && (entity?.data?.type ?? entity?.type) === 'region') return 'region';
  return entityType;
}
function pinColorForEntity(entityType, entity) { return PIN_COLORS[pinTypeForEntity(entityType, entity)] ?? '#2563eb'; }
function scaleDetails(board) {
  if (board?.scaleKm && !board.scaleDistanceKm) return { startX: 0, startY: 0.5, endX: 1, endY: 0.5, distanceKm: board.scaleKm, imageWidth: 1, imageHeight: 1, kmPerPixel: board.scaleKm, pixelLength: 1 };
  if (!board?.scaleDistanceKm || !board.scaleImageWidth || !board.scaleImageHeight) return null;
  const pixels = Math.hypot((board.scaleEndX - board.scaleStartX) * board.scaleImageWidth, (board.scaleEndY - board.scaleStartY) * board.scaleImageHeight);
  if (!Number.isFinite(pixels) || pixels <= 0) return null;
  return { startX: board.scaleStartX, startY: board.scaleStartY, endX: board.scaleEndX, endY: board.scaleEndY, distanceKm: board.scaleDistanceKm, imageWidth: board.scaleImageWidth, imageHeight: board.scaleImageHeight, kmPerPixel: board.scaleDistanceKm / pixels, pixelLength: pixels };
}
function routeDistanceKm(route, pinMap, scale) {
  if (!scale) return null;
  const from = pinMap.get(route.fromPinId); const to = pinMap.get(route.toPinId);
  if (!from || !to) return null;
  const vertices = [from, ...(route.points ?? []).sort((a, b) => a.order - b.order), to];
  let pixels = 0;
  for (let i = 1; i < vertices.length; i += 1) pixels += Math.hypot((vertices[i].x - vertices[i - 1].x) * scale.imageWidth, (vertices[i].y - vertices[i - 1].y) * scale.imageHeight);
  return pixels * scale.kmPerPixel;
}

async function serializeBoard(request, board) {
  if (!board) return null;
  const distances = [];
  const rows = await loadLocationRows(request.campaign.id);
  const locationIds = new Set(rows.map((row) => row.domainId));
  const entities = new Map();
  await Promise.all([...locationIds].map(async (locationId) => {
    const entity = await getEntityForRequest({ request, type: 'location', domainId: locationId, options: { backlinks: false, format: '1' } });
    if (entity) entities.set(locationId, entity);
  }));
  for (const [locationId, entity] of entities) {
    const summary = boardEntitySummary(entity);
    for (const connection of entity.connections ?? []) {
      const target = connection.target;
      const targetId = target?.id ?? connection.targetId ?? connection.to;
      const targetEntity = targetId ? entities.get(targetId) : null;
      if (!targetId || target?.available === false || !targetEntity) continue;
      const targetSummary = targetEntity ? boardEntitySummary(targetEntity) : null;
      distances.push({
        id: `${locationId}:${connection.connectionId}`,
        fromLocationId: locationId,
        fromName: summary.name,
        toLocationId: targetId,
        toName: target?.name ?? targetSummary?.name ?? targetId,
        connectionId: connection.connectionId,
        type: connection.type ?? null,
        direction: connection.direction ?? null,
        distanceKm: connection.distanceKm ?? null,
        travelMinutes: connection.travelMinutes ?? null
      });
    }
  }
  const pins = (await Promise.all(board.pins.map(async (entry) => {
    const entityType = entry.entityType ?? 'location'; const entityId = entry.entityId ?? entry.locationId;
    const entity = await getEntityForRequest({ request, type: entityType, domainId: entityId, options: { backlinks: false, format: '1' } });
    if (!entity) return null;
    const summary = boardEntitySummary(entity);
    return {
      id: entry.id,
      entityType,
      entityId,
      locationId: entry.locationId ?? (entityType === 'location' ? entityId : null),
      name: summary.name,
      type: summary.type,
      pinType: pinTypeForEntity(entityType, entity),
      color: pinColorForEntity(entityType, entity),
      state: summary.state,
      subtitle: entity.subtitle ?? entity.title ?? null,
      imageUrl: entity.imageURL ?? entity.imageUrl ?? entity.portraitUrl ?? entity.data?.media?.portrait ?? null,
      x: entry.x,
      y: entry.y,
      version: entry.version,
      updatedAt: entry.updatedAt
    };
  }))).filter(Boolean);
  const pinMap = new Map(pins.map((pin) => [pin.id, pin]));
  const routes = (board.routes ?? []).map((route) => {
    const from = pinMap.get(route.fromPinId);
    const to = pinMap.get(route.toPinId);
    if (!from || !to) return null;
    return {
      id: route.id,
      fromPinId: route.fromPinId,
      fromLocationId: from.locationId,
      fromName: from.name,
      toPinId: route.toPinId,
      toLocationId: to.locationId,
      toName: to.name,
      distanceKm: routeDistanceKm(route, pinMap, scaleDetails(board)) ?? route.distanceKm,
      catalogConnectionId: route.sourceConnectionId ?? null,
      version: route.version,
      updatedAt: route.updatedAt,
      points: (route.points ?? []).sort((a, b) => a.order - b.order).map((point) => ({
        id: point.id,
        x: point.x,
        y: point.y,
        order: point.order,
        updatedAt: point.updatedAt
      }))
    };
  }).filter(Boolean);
  distances.sort((a, b) => a.fromName.localeCompare(b.fromName, 'pt-BR') || a.toName.localeCompare(b.toName, 'pt-BR') || a.id.localeCompare(b.id));
  const boundaries = (board.boundaries ?? []).flatMap((boundary) => {
    const region = entities.get(boundary.regionId);
    if (!region) return [];
    return [{ id: boundary.id, regionId: boundary.regionId, name: boundary.name ?? region.name, label: boundary.name ?? null, locationName: region.name, points: boundary.points, version: boundary.version, updatedAt: boundary.updatedAt, updatedBy: boundary.updatedBy ? { id: boundary.updatedBy.id, name: boundary.updatedBy.name } : null }];
  });
  const visibleLocationPins = new Set(pins.filter((pin) => pin.entityType === 'location').map((pin) => pin.entityId));
  const pinsByLocation = new Map(pins.filter((pin) => pin.entityType === 'location').map((pin) => [pin.entityId, pin]));
  const catalogDistances = distances.filter((distance) => visibleLocationPins.has(distance.fromLocationId)).map((connection) => {
    const from = pinsByLocation.get(connection.fromLocationId), to = pinsByLocation.get(connection.toLocationId);
    const path = board.roadNetwork && from && to ? queryRoadPaths(board, from, to, { limit: 1 }) : null;
    return { ...connection, catalogDistanceKm: connection.distanceKm, networkStatus: path?.status ?? null, networkReason: path?.reason ?? null, distanceKm: path ? path.distanceKm : connection.distanceKm, distanceSource: path ? 'network' : 'catalog' };
  });
  return { id: board.id, campaignId: request.campaign.id, regionId: board.regionId ?? null, regionName: board.regionId ? entities.get(board.regionId)?.name ?? null : null, floor: board.regionId ? await authorizedLocationFloor(request, entities.get(board.regionId), entities) : null, name: board.name, imageUrl: board.imageUrl, roadNetwork: board.roadNetwork ?? null, scaleKm: board.scaleKm, scale: scaleDetails(board), version: board.version, updatedAt: board.updatedAt, pins, distances: catalogDistances, routes, boundaries, boundaryCandidates: mapMaster(request) ? [...entities.values()].map((entity) => ({ id: entity.id, name: entity.name ?? entity.id })) : [], travelMarkers: (board.travelMarkers ?? []).map((marker) => serializeTravelMarker(request, marker)), markerCandidates: await travelMarkerCandidates(request) };
}

function expectedMapVersion(request, reply) {
  const header = request.headers['if-match'];
  const version = header == null ? NaN : Number(header);
  if (!Number.isInteger(version) || version < 0) {
    reply.code(428).send(apiError('VERSION_REQUIRED', 'Atualize o mapa e envie a versão atual em If-Match'));
    return null;
  }
  return version;
}

function mapVersionConflict(reply) {
  return reply.code(409).send(apiError('VERSION_CONFLICT', 'O mapa foi alterado por outra pessoa. Atualize antes de salvar novamente.'));
}

function safeMapImageUrl(request, value) {
  const imageUrl = assertSafeRemoteUrl(value);
  if (imageUrl.startsWith('/') && !imageUrl.startsWith(`/api/v1/campaigns/${request.campaign.id}/media/`)) throw new Error('A imagem precisa pertencer a esta campanha.');
  return imageUrl;
}

async function authorizedRegions(request) {
  const rows = await loadLocationRows(request.campaign.id);
  return (await Promise.all(rows.filter(isRegion).map(async (row) => {
    const entity = await getEntityForRequest({ request, type: 'location', domainId: row.domainId, options: { backlinks: false, format: '1' } });
    const summary = boardEntitySummary(entity);
    return summary?.type === 'region' ? { id: row.domainId, name: summary.name, imageUrl: summary.mapUrl || null, floor: await authorizedLocationFloor(request, entity) } : null;
  }))).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR') || a.id.localeCompare(b.id));
}

async function rebuildBoardLayout(request, { resetManualPins = false } = {}) {
  const rows = await loadLocationRows(request.campaign.id);
  const board = await ensureBoard(request, rows, { includeMissing: true });
  const regions = rows.filter((row) => isRegion(row) && (!board.regionId || row.domainId === board.regionId)).sort((a, b) => `${a.name}:${a.domainId}`.localeCompare(`${b.name}:${b.domainId}`, 'pt-BR'));
  await prisma.$transaction(async (tx) => {
    for (const [index, region] of regions.entries()) {
      const currentRegion = board.regions.find((entry) => entry.regionId === region.domainId);
      if (!currentRegion) continue;
      await tx.mapBoardRegion.update({ where: { id: currentRegion.id }, data: { ...gridRect(index, regions.length), updatedByUserId: request.auth.user.id } });
      for (const location of descendantsOfRegion(rows, region.domainId)) {
        const currentPin = board.pins.find((entry) => entry.locationId === location.domainId);
        if (currentPin?.placementSource === 'manual' && !resetManualPins) continue;
        const coords = autoPinCoordinates(rows, region.domainId, location.domainId);
        if (currentPin) await tx.mapLocationPin.update({ where: { id: currentPin.id }, data: { regionId: region.domainId, ...coords, placementSource: 'auto', updatedByUserId: request.auth.user.id } });
        else await tx.mapLocationPin.create({ data: { boardId: board.id, regionId: region.domainId, entityType: 'location', entityId: location.domainId, locationId: location.domainId, ...coords, updatedByUserId: request.auth.user.id } });
      }
    }
  });
  return ensureBoard(request, rows);
}

async function resolvePositionRegion(request, locationId, suppliedRegionId) {
  const rows = await loadLocationRows(request.campaign.id);
  const actualRegionId = regionForLocation(rows, locationId);
  if (suppliedRegionId && rows.length && !rows.some((row) => row.domainId === suppliedRegionId && isRegion(row))) {
    return { error: 'A região informada não existe' };
  }
  if (actualRegionId && suppliedRegionId && actualRegionId !== suppliedRegionId) {
    return { error: 'O local não pertence à região informada' };
  }
  if (rows.length && !actualRegionId && suppliedRegionId) return { error: 'O local não pertence a uma região válida' };
  return { regionId: actualRegionId ?? suppliedRegionId ?? null };
}

function normalizedMarker(input, params = {}) {
  const ownerType = input.ownerType ?? input.markerType ?? params.ownerType ?? params.markerType;
  const ownerId = input.ownerId ?? input.markerId ?? params.ownerId ?? params.markerId;
  return markerInput.parse({ ownerType, ownerId });
}

async function findSession(request, { create = false, sessionId } = {}) {
  const id = sessionId ?? request.params?.sessionId ?? request.query?.sessionId ?? request.body?.sessionId;
  if (id) {
    const session = await prisma.mapSession.findFirst({ where: { id, campaignId: request.campaign.id }, include: sessionInclude });
    if (!session) return null;
    return session;
  }
  let session = await prisma.mapSession.findFirst({
    where: { campaignId: request.campaign.id, endedAt: null },
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    include: sessionInclude
  });
  if (!session && create) {
    session = await prisma.mapSession.create({
      data: { campaignId: request.campaign.id, createdByUserId: request.auth.user.id },
      include: sessionInclude
    });
  }
  return session;
}

async function requireActiveSession(request, reply, { create = true } = {}) {
  const session = await findSession(request, { create });
  if (!session) {
    reply.code(404).send(apiError('NOT_FOUND', 'Sessão do mapa não encontrada'));
    return null;
  }
  if (session.endedAt) {
    reply.code(409).send(apiError('SESSION_CLOSED', 'A sessão do mapa já foi encerrada'));
    return null;
  }
  return session;
}

async function assertMarkerPermission(request, marker, reply) {
  if (marker.ownerType === 'group') {
    if (!isGm(request)) { reply.code(403).send(apiError('FORBIDDEN', 'Somente o mestre pode mover o marcador do grupo')); return false; }
    if (marker.ownerId !== 'group') { reply.code(400).send(apiError('INVALID_MARKER', 'O marcador do grupo usa o identificador group')); return false; }
    return true;
  }
  const membership = await prisma.membership.findUnique({
    where: { campaignId_userId: { campaignId: request.campaign.id, userId: marker.ownerId } },
    select: { userId: true, role: true }
  });
  if (!membership || membership.role !== 'player') { reply.code(404).send(apiError('NOT_FOUND', 'Jogador não encontrado na campanha')); return false; }
  if (!isGm(request) && marker.ownerId !== request.auth.user.id) {
    reply.code(403).send(apiError('FORBIDDEN', 'Você só pode mover o próprio marcador'));
    return false;
  }
  return true;
}

async function visibleLocation(request, locationId) {
  const entity = await prisma.entity.findUnique({
    where: { campaignId_type_domainId: { campaignId: request.campaign.id, type: 'location', domainId: locationId } },
    select: { domainId: true, deletedAt: true }
  });
  if (!entity || entity.deletedAt) return false;
  if (isGm(request)) return true;
  return Boolean(await getEntityForRequest({ request, type: 'location', domainId: locationId }));
}

async function serializePositions(rows, request) {
  const locationRows = await loadLocationRows(request.campaign.id);
  const memberships = rows.length
    ? await prisma.membership.findMany({
        where: { campaignId: request.campaign.id, userId: { in: rows.filter((row) => row.ownerType === 'player').map((row) => row.ownerId) } },
        select: { userId: true, user: { select: userSelect } }
      })
    : [];
  const names = new Map(memberships.map((row) => [row.userId, row.user]));
  const output = [];
  for (const row of rows) {
    if (row.ownerType === 'player' && !names.has(row.ownerId)) continue;
    if (!(await visibleLocation(request, row.locationId))) continue;
    const rawRegionId = row.regionId ?? regionForLocation(locationRows, row.locationId);
    const regionId = rawRegionId && await visibleLocation(request, rawRegionId) ? rawRegionId : null;
    output.push({
      id: row.id,
      sessionId: row.sessionId,
      ownerType: row.ownerType,
      ownerId: row.ownerId,
      markerType: row.ownerType,
      markerId: row.ownerId,
      markerKey: markerKey(row.ownerType, row.ownerId),
      label: row.ownerType === 'group' ? 'Grupo' : names.get(row.ownerId)?.name ?? 'Jogador',
      player: row.ownerType === 'player' ? names.get(row.ownerId) ?? { id: row.ownerId, name: 'Jogador' } : null,
      regionId,
      locationId: row.locationId,
      x: row.x,
      y: row.y,
      updatedByUserId: row.updatedByUserId,
      updatedAt: row.updatedAt
    });
  }
  return output;
}

async function serializeHistory(rows, request) {
  const locationRows = await loadLocationRows(request.campaign.id);
  const playerIds = [...new Set(rows.filter((row) => row.ownerType === 'player').map((row) => row.ownerId))];
  const memberships = playerIds.length
    ? await prisma.membership.findMany({ where: { campaignId: request.campaign.id, userId: { in: playerIds } }, select: { userId: true } })
    : [];
  const activePlayers = new Set(memberships.map((membership) => membership.userId));
  const actors = rows.length
    ? await prisma.user.findMany({ where: { id: { in: rows.map((row) => row.changedByUserId) } }, select: userSelect })
    : [];
  const actorById = new Map(actors.map((actor) => [actor.id, actor]));
  const output = [];
  for (const row of rows) {
    if (row.ownerType === 'player' && !activePlayers.has(row.ownerId)) continue;
    if (!(await visibleLocation(request, row.locationId))) continue;
    const previousVisible = row.previousLocationId && await visibleLocation(request, row.previousLocationId);
    const rawRegionId = row.regionId ?? regionForLocation(locationRows, row.locationId);
    const nextRegionId = rawRegionId && await visibleLocation(request, rawRegionId) ? rawRegionId : null;
    const rawPreviousRegionId = row.previousRegionId ?? (row.previousLocationId && regionForLocation(locationRows, row.previousLocationId));
    const previousRegionId = rawPreviousRegionId && previousVisible && await visibleLocation(request, rawPreviousRegionId) ? rawPreviousRegionId : null;
    output.push({
      id: row.id,
      sessionId: row.sessionId,
      positionId: row.positionId,
      ownerType: row.ownerType,
      ownerId: row.ownerId,
      markerType: row.ownerType,
      markerId: row.ownerId,
      markerKey: markerKey(row.ownerType, row.ownerId),
      previous: row.previousLocationId && previousVisible
        ? { regionId: previousRegionId, locationId: row.previousLocationId, x: row.previousX, y: row.previousY }
        : row.previousLocationId ? null : null,
      next: { regionId: nextRegionId, locationId: row.locationId, x: row.x, y: row.y },
      changedByUserId: row.changedByUserId,
      changedBy: actorById.get(row.changedByUserId) ?? { id: row.changedByUserId, name: 'Usuário removido' },
      changedAt: row.changedAt,
      revertedAt: row.revertedAt,
      revertedByUserId: row.revertedByUserId,
      revertsHistoryId: row.revertsHistoryId
    });
  }
  return output;
}

function samePosition(row, input) {
  return row && row.locationId === input.locationId && (!row.regionId || !input.regionId || row.regionId === input.regionId) && row.x === input.x && row.y === input.y;
}

async function emitPositionChanged(request, session, marker, reason = 'position-updated') {
  request.server.realtime?.to(`campaign:${request.campaign.id}`).emit('map.position.changed', {
    sessionId: session.id,
    ownerType: marker.ownerType,
    ownerId: marker.ownerId,
    reason,
    changedAt: new Date().toISOString()
  });
}

async function movePosition(request, reply, body, params = {}) {
  const { coordinates, marker: nestedMarker, ...flatBody } = body ?? {};
  const parsed = moveInput.safeParse({
    ...flatBody,
    ...(coordinates ?? {}),
    ...(nestedMarker?.type ? { markerType: nestedMarker.type } : {}),
    ...(nestedMarker?.id ? { markerId: nestedMarker.id } : {})
  });
  if (!parsed.success) return reply.code(400).send(apiError('INVALID_INPUT', 'Posição inválida', parsed.error.flatten()));
  let marker;
  try { marker = normalizedMarker(parsed.data, params); }
  catch { return reply.code(400).send(apiError('INVALID_MARKER', 'Marcador inválido')); }
  if (!(await assertMarkerPermission(request, marker, reply))) return;
  const session = await requireActiveSession(request, reply);
  if (!session) return;
  if (!(await visibleLocation(request, parsed.data.locationId)))
    return reply.code(404).send(apiError('NOT_FOUND', 'Local não encontrado ou não visível'));
  const resolvedRegion = await resolvePositionRegion(request, parsed.data.locationId, parsed.data.regionId);
  if (resolvedRegion.error) return reply.code(400).send(apiError('INVALID_REGION', resolvedRegion.error));

  const saved = await prisma.$transaction(async (tx) => {
    const current = await tx.mapPosition.findUnique({ where: { sessionId_ownerType_ownerId: { sessionId: session.id, ...marker } } });
    const nextX = parsed.data.x ?? current?.x ?? 0.5;
    const nextY = parsed.data.y ?? current?.y ?? 0.5;
    const next = { regionId: resolvedRegion.regionId, locationId: parsed.data.locationId, x: nextX, y: nextY };
    if (samePosition(current, next)) return { position: current, history: null, changed: false };
    const position = current
      ? await tx.mapPosition.update({
          where: { id: current.id },
        data: { ...next, updatedByUserId: request.auth.user.id }
        })
      : await tx.mapPosition.create({
          data: { sessionId: session.id, ...marker, ...next, updatedByUserId: request.auth.user.id }
        });
    const history = await tx.mapPositionHistory.create({
      data: {
        sessionId: session.id,
        positionId: position.id,
        ...marker,
        previousRegionId: current?.regionId ?? null,
        previousLocationId: current?.locationId ?? null,
        previousX: current?.x ?? null,
        previousY: current?.y ?? null,
        regionId: position.regionId,
        locationId: position.locationId,
        x: position.x,
        y: position.y,
        changedByUserId: request.auth.user.id
      }
    });
    await audit(tx, {
      campaignId: request.campaign.id,
      actorUserId: request.auth.user.id,
      action: 'map.position.move',
      subjectType: marker.ownerType,
      subjectId: marker.ownerId,
      before: current ? { regionId: current.regionId, locationId: current.locationId, x: current.x, y: current.y } : null,
      after: { regionId: position.regionId, locationId: position.locationId, x: position.x, y: position.y, sessionId: session.id }
    });
    return { position, history, changed: true };
  });
  if (saved.changed) await emitPositionChanged(request, session, marker);
  const [position] = await serializePositions([saved.position], request);
  return { session: serializeSession(session), position, historyId: saved.history?.id ?? null, changed: saved.changed };
}

async function undoHistory(request, reply, historyId) {
  const row = await prisma.mapPositionHistory.findFirst({
    where: { id: historyId, session: { campaignId: request.campaign.id } },
    include: { session: { include: sessionInclude } }
  });
  if (!row) return reply.code(404).send(apiError('NOT_FOUND', 'Movimento não encontrado'));
  if (row.revertedAt) return reply.code(409).send(apiError('ALREADY_REVERTED', 'Este movimento já foi desfeito'));
  if (row.session.endedAt) return reply.code(409).send(apiError('SESSION_CLOSED', 'A sessão do mapa já foi encerrada'));
  const marker = { ownerType: row.ownerType, ownerId: row.ownerId };
  if (!(await assertMarkerPermission(request, marker, reply))) return;
  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.mapPosition.findUnique({ where: { sessionId_ownerType_ownerId: { sessionId: row.sessionId, ...marker } } });
    if (!current || !samePosition(current, row)) {
      return { conflict: true };
    }
    let position = null;
    if (row.previousLocationId) {
      position = await tx.mapPosition.update({
        where: { id: current.id },
        data: { regionId: row.previousRegionId, locationId: row.previousLocationId, x: row.previousX, y: row.previousY, updatedByUserId: request.auth.user.id }
      });
    } else {
      await tx.mapPosition.delete({ where: { id: current.id } });
    }
    const now = new Date();
    await tx.mapPositionHistory.update({ where: { id: row.id }, data: { revertedAt: now, revertedByUserId: request.auth.user.id } });
    await tx.mapPositionHistory.create({
      data: {
        sessionId: row.sessionId,
        positionId: position?.id,
        ...marker,
        previousRegionId: row.regionId,
        previousLocationId: row.locationId,
        previousX: row.x,
        previousY: row.y,
        regionId: row.previousRegionId ?? row.regionId,
        locationId: row.previousLocationId ?? row.locationId,
        x: row.previousX ?? row.x,
        y: row.previousY ?? row.y,
        changedByUserId: request.auth.user.id,
        revertsHistoryId: row.id
      }
    });
    await audit(tx, {
      campaignId: request.campaign.id,
      actorUserId: request.auth.user.id,
      action: 'map.position.undo',
      subjectType: marker.ownerType,
      subjectId: marker.ownerId,
      before: { regionId: row.regionId, locationId: row.locationId, x: row.x, y: row.y, historyId: row.id },
      after: { regionId: row.previousRegionId, locationId: row.previousLocationId, x: row.previousX, y: row.previousY, sessionId: row.sessionId }
    });
    return { position };
  });
  if (result.conflict) return reply.code(409).send(apiError('VERSION_CONFLICT', 'O marcador foi alterado depois deste movimento'));
  await emitPositionChanged(request, row.session, marker, 'undo');
  return { session: serializeSession(row.session), position: result.position ? (await serializePositions([result.position], request))[0] : null, undoneHistoryId: row.id };
}

async function campaignEntitySummary(request, type, domainId) {
  const entity = await getEntityForRequest({ request, type, domainId, options: { backlinks: true, format: '1' } });
  if (!entity) return null;
  const summary = boardEntitySummary(entity);
  return { type, id: domainId, name: summary.name, subtitle: entity.subtitle ?? entity.title ?? null, imageUrl: entity.imageURL ?? entity.imageUrl ?? entity.portraitUrl ?? entity.data?.media?.portrait ?? null, pinType: pinTypeForEntity(type, entity), color: pinColorForEntity(type, entity), entity };
}

function pinCandidateMetadata(summary, locations) {
  const data = summary.entity.data ?? summary.entity;
  if (summary.type === 'npc') return { characterType: data.characterType ?? null };
  if (summary.type === 'item') return { category: data.category ?? null };
  if (summary.type === 'monster') return { rank: data.rank ?? null };
  if (summary.type === 'quest') return { questType: data.type ?? null };
  if (summary.type !== 'location') return {};

  let current = summary;
  const visited = new Set();
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    const currentData = current.entity.data ?? current.entity;
    if (currentData.type === 'region') {
      return { locationType: data.type ?? null, regionId: current.id, regionName: current.name };
    }
    if (!currentData.parentId) {
      return { locationType: data.type ?? null, regionId: null, regionName: null, areaName: current.id !== summary.id ? current.name : null };
    }
    current = locations.get(currentData.parentId);
  }
  return { locationType: data.type ?? null, regionId: null, regionName: null };
}

async function syncCatalogConnection(tx, request, fromPin, toPin, distanceKm) {
  if (!fromPin || !toPin || (fromPin.entityType ?? 'location') !== 'location' || (toPin.entityType ?? 'location') !== 'location') return null;
  if (!tx.locationConnection) return null;
  const fromId = fromPin.entityId ?? fromPin.locationId; const toId = toPin.entityId ?? toPin.locationId;
  const entities = await tx.entity.findMany({ where: { campaignId: request.campaign.id, type: 'location', domainId: { in: [fromId, toId] }, deletedAt: null }, select: { id: true, domainId: true } });
  const byDomain = new Map(entities.map((entry) => [entry.domainId, entry]));
  const fromEntity = byDomain.get(fromId), toEntity = byDomain.get(toId);
  if (!fromEntity || !toEntity) return null;
  const forwardWhere = { entityId: fromEntity.id, targetDomainId: toId };
  const reverseWhere = { entityId: toEntity.id, targetDomainId: fromId };
  const forward = await tx.locationConnection.findFirst({ where: forwardWhere, select: { id: true } });
  const reverse = await tx.locationConnection.findFirst({ where: reverseWhere, select: { id: true } });
  if (forward) await tx.locationConnection.updateMany({ where: forwardWhere, data: { distanceKm } });
  if (reverse) await tx.locationConnection.updateMany({ where: reverseWhere, data: { distanceKm } });
  return forward?.id ?? reverse?.id ?? null;
}

function routeDistanceFromParts(route, fromPin, toPin, board) {
  const scale = scaleDetails(board);
  if (!scale || !fromPin || !toPin) return null;
  const vertices = [fromPin, ...(route.points ?? []).sort((a, b) => a.order - b.order), toPin];
  let pixels = 0;
  for (let i = 1; i < vertices.length; i += 1) pixels += Math.hypot((vertices[i].x - vertices[i - 1].x) * scale.imageWidth, (vertices[i].y - vertices[i - 1].y) * scale.imageHeight);
  return pixels * scale.kmPerPixel;
}

async function recalculateRouteTx(tx, request, board, routeId, actorUserId) {
  const route = await tx.mapRoute.findUnique({ where: { id: routeId }, include: { points: { orderBy: { order: 'asc' } } } });
  if (!route) return null;
  const pins = await tx.mapLocationPin.findMany({ where: { id: { in: [route.fromPinId, route.toPinId] } } });
  const from = pins.find((pin) => pin.id === route.fromPinId); const to = pins.find((pin) => pin.id === route.toPinId);
  const distanceKm = routeDistanceFromParts(route, from, to, board);
  const sourceConnectionId = distanceKm == null ? route.sourceConnectionId : await syncCatalogConnection(tx, request, from, to, distanceKm);
  return tx.mapRoute.update({ where: { id: route.id }, data: { distanceKm, sourceConnectionId, updatedByUserId: actorUserId, version: { increment: 1 } }, include: { points: { orderBy: { order: 'asc' } } } });
}

export async function mapRoutes(app) {
  app.get('/api/v1/campaigns/:campaignId/map/boards', { preHandler: [authenticate, requireCampaign] }, async (request) => {
    await validateMapViewer(request);
    await ensureBoard({ ...request, query: {} });
    const [boards, regions] = await Promise.all([
      prisma.mapBoard.findMany({ where: { campaignId: request.campaign.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
      authorizedRegions(request)
    ]);
    const regionMap = new Map(regions.map((region) => [region.id, region]));
    const items = boards.filter((board) => !board.regionId || regionMap.has(board.regionId)).map((board) => ({
      id: board.id, name: board.name, regionId: board.regionId ?? null, regionName: regionMap.get(board.regionId)?.name ?? null, floor: regionMap.get(board.regionId)?.floor ?? null,
      imageUrl: board.imageUrl, version: board.version, scale: scaleDetails(board), updatedAt: board.updatedAt
    })).sort((a, b) => Number(Boolean(a.regionId)) - Number(Boolean(b.regionId)) || a.name.localeCompare(b.name, 'pt-BR') || a.id.localeCompare(b.id));
    return { items, regions: regions.map((region) => ({ ...region, boardId: items.find((board) => board.regionId === region.id)?.id ?? null })) };
  });

  app.post('/api/v1/campaigns/:campaignId/map/boards', { preHandler: [authenticate, requireCampaign, requireGm, requireMapEditor, requireCsrf] }, async (request, reply) => {
    const parsed = boardCreateInput.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_INPUT', 'Mapa inválido', parsed.error.flatten()));
    const region = parsed.data.regionId ? (await authorizedRegions(request)).find((entry) => entry.id === parsed.data.regionId) : null;
    if (parsed.data.regionId && !region) return reply.code(404).send(apiError('NOT_FOUND', 'Região não encontrada'));
    let imageUrl = parsed.data.imageUrl ?? region?.imageUrl ?? null;
    if (imageUrl) {
      try { imageUrl = safeMapImageUrl(request, imageUrl); }
      catch (error) { return reply.code(400).send(apiError('INVALID_IMAGE', error.message)); }
    }
    let board;
    try {
      board = await prisma.mapBoard.create({ data: {
        campaignId: request.campaign.id, boardKey: region ? `region:${region.id}` : 'general', regionId: region?.id ?? null,
        name: parsed.data.name ?? region?.name ?? 'Mapa da campanha', imageUrl, createdByUserId: request.auth.user.id,
        ...(parsed.data.imageWidth ? { roadNetwork: emptyRoadNetwork(parsed.data.imageWidth, parsed.data.imageHeight) } : {})
      }, include: boardInclude });
    } catch (error) {
      if (error.code === 'P2002') return reply.code(409).send(apiError('ALREADY_EXISTS', 'Já existe um mapa para esta região ou um mapa geral'));
      throw error;
    }
    request.server.realtime?.to(`campaign:${request.campaign.id}`).emit('map.layout.changed', { boardId: board.id, reason: 'board-created' });
    return reply.code(201).send(await serializeBoard(request, board));
  });

  app.delete('/api/v1/campaigns/:campaignId/map/boards/:boardId', { preHandler: [authenticate, requireCampaign, requireGm, requireMapEditor, requireCsrf] }, async (request, reply) => {
    const version = expectedMapVersion(request, reply);
    if (version === null) return;
    const board = await ensureBoard({ ...request, query: { boardId: request.params.boardId } });
    const deleted = await prisma.mapBoard.deleteMany({ where: { id: board.id, campaignId: request.campaign.id, version } });
    if (!deleted.count) return mapVersionConflict(reply);
    request.server.realtime?.to(`campaign:${request.campaign.id}`).emit('map.layout.changed', { boardId: board.id, reason: 'board-deleted' });
    return reply.code(204).send();
  });

  app.get('/api/v1/campaigns/:campaignId/map/board', { preHandler: [authenticate, requireCampaign] }, async (request) => {
    const board = await ensureBoard(request);
    return serializeBoard(request, board);
  });

  app.patch('/api/v1/campaigns/:campaignId/map/board', { preHandler: [authenticate, requireCampaign, requireGm, requireMapEditor, requireCsrf] }, async (request, reply) => {
    const parsed = boardImageInput.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_INPUT', 'Imagem do mapa inválida', parsed.error.flatten()));
    const version = expectedMapVersion(request, reply);
    if (version === null) return;
    let imageUrl;
    try {
      imageUrl = safeMapImageUrl(request, parsed.data.imageUrl);
    } catch (error) {
      return reply.code(400).send(apiError('INVALID_IMAGE', error.message));
    }
    const board = await ensureBoard(request);
    if (board.roadNetwork && imageUrl !== board.imageUrl && !parsed.data.imageWidth) return reply.code(400).send(apiError('IMAGE_DIMENSIONS_REQUIRED', 'Informe as dimensões naturais da nova imagem para preservar a rede'));
    const roadNetwork = parsed.data.imageWidth ? { ...(board.roadNetwork ?? emptyRoadNetwork()), imageWidth: parsed.data.imageWidth, imageHeight: parsed.data.imageHeight } : board.roadNetwork;
    const saved = await prisma.mapBoard.updateMany({ where: { id: board.id, campaignId: request.campaign.id, version }, data: { ...(parsed.data.name ? { name: parsed.data.name } : {}), ...(roadNetwork ? { roadNetwork } : {}), imageUrl, scaleKm: null, scaleStartX: null, scaleStartY: null, scaleEndX: null, scaleEndY: null, scaleDistanceKm: null, scaleImageWidth: null, scaleImageHeight: null, version: { increment: 1 } } });
    if (!saved.count) return mapVersionConflict(reply);
    request.server.realtime?.to(`campaign:${request.campaign.id}`).emit('map.layout.changed', { boardId: board.id, reason: 'image-updated' });
    return serializeBoard(request, await ensureBoard(request));
  });

  app.put('/api/v1/campaigns/:campaignId/map/network', { preHandler: [authenticate, requireCampaign, requireGm, requireMapEditor, requireCsrf] }, async (request, reply) => {
    const parsed = roadNetworkSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_INPUT', 'Rede de caminhos inválida', parsed.error.flatten()));
    const version = expectedMapVersion(request, reply);
    if (version === null) return;
    const board = await ensureBoard(request);
    if (board.version !== version) return mapVersionConflict(reply);
    const normalized = normalizeRoadNetwork({ ...parsed.data, imageWidth: board.roadNetwork?.imageWidth ?? board.scaleImageWidth ?? parsed.data.imageWidth, imageHeight: board.roadNetwork?.imageHeight ?? board.scaleImageHeight ?? parsed.data.imageHeight });
    // Splitting crossings can increase the graph size beyond the input limit.
    if (!roadNetworkSchema.safeParse(normalized).success) return reply.code(400).send(apiError('NETWORK_TOO_LARGE', 'A rede tem pontos ou trechos demais. Divida o desenho em mapas regionais.'));
    const saved = await prisma.mapBoard.updateMany({ where: { id: board.id, campaignId: request.campaign.id, version }, data: { roadNetwork: normalized, version: { increment: 1 } } });
    if (!saved.count) return mapVersionConflict(reply);
    request.server.realtime?.to(`campaign:${request.campaign.id}`).emit('map.layout.changed', { boardId: board.id, reason: 'network-updated' });
    return serializeBoard(request, await ensureBoard(request));
  });

  app.get('/api/v1/campaigns/:campaignId/map/network/path', { preHandler: [authenticate, requireCampaign] }, async (request, reply) => {
    const parsed = z.object({ ...mapReadQuery, fromPinId: z.string().min(1).max(256), toPinId: z.string().min(1).max(256), viaEdgeId: z.string().min(1).max(256).optional() }).strict().safeParse(request.query);
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_INPUT', 'Selecione origem e destino', parsed.error.flatten()));
    const board = await ensureBoard(request);
    const available = [...await visibleBoardPins(request, board), ...(board.travelMarkers ?? [])];
    const pins = [parsed.data.fromPinId, parsed.data.toPinId].map((id) => available.find((pin) => pin.id === id));
    if (pins.some((pin) => !pin)) return reply.code(404).send(apiError('NOT_FOUND', 'Pin não encontrado neste mapa'));
    if (parsed.data.viaEdgeId && !board.roadNetwork?.edges.some((edge) => edge.id === parsed.data.viaEdgeId)) return reply.code(400).send(apiError('INVALID_EDGE', 'Trecho não encontrado na rede deste mapa'));
    const path = queryRoadPaths(board, pins[0], pins[1], { limit: 8, coverageLimit: 32, allowReturns: true, preferredEdgeIds: parsed.data.viaEdgeId ? [parsed.data.viaEdgeId] : [] });
    return { ...path, alternatives: path.paths ?? [], boardId: board.id, version: board.version, fromPinId: pins[0].id, toPinId: pins[1].id, ...(path.status === 'no_path' ? { message: noRoadPathMessage(path.reason) } : {}) };
  });

  app.get('/api/v1/campaigns/:campaignId/map/network/destinations', { preHandler: [authenticate, requireCampaign] }, async (request, reply) => {
    const parsed = z.object({ ...mapReadQuery, fromPinId: z.string().min(1).max(256) }).strict().safeParse(request.query);
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_INPUT', 'Selecione a origem', parsed.error.flatten()));
    const board = await ensureBoard(request);
    const pins = [...await visibleBoardPins(request, board), ...(board.travelMarkers ?? [])];
    const from = pins.find((pin) => pin.id === parsed.data.fromPinId);
    if (!from) return reply.code(404).send(apiError('NOT_FOUND', 'Pin não encontrado neste mapa'));
    const items = pins.filter((pin) => pin.id !== from.id).flatMap((to) => {
      const path = queryRoadPaths(board, from, to, { limit: 1 });
      return path.status === 'found' ? [{ toPinId: to.id, toName: to.name, toLocationId: to.locationId ?? ((to.entityType ?? 'location') === 'location' ? to.entityId : null), distanceKm: path.distanceKm, distancePixels: path.distancePixels }] : [];
    }).sort((a, b) => a.distancePixels - b.distancePixels || a.toName.localeCompare(b.toName, 'pt-BR'));
    return { boardId: board.id, version: board.version, fromPinId: from.id, items };
  });

  app.post('/api/v1/campaigns/:campaignId/map/markers', { preHandler: [authenticate, requireCampaign, requireMapEditor, requireCsrf] }, async (request, reply) => {
    const parsed = travelMarkerInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_INPUT', 'Marcador inválido', parsed.error.flatten()));
    const board = await ensureBoard(request), input = parsed.data;
    let ownerId = input.ownerId ?? null, name = input.name;
    if (!isGm(request) && (input.ownerType !== 'player' || (ownerId && ownerId !== request.auth.user.id))) return reply.code(403).send(apiError('FORBIDDEN', 'Você pode posicionar apenas seu próprio marcador'));
    if (input.ownerType === 'player') {
      ownerId ??= request.auth.user.id;
      const membership = await prisma.membership.findUnique({ where: { campaignId_userId: { campaignId: request.campaign.id, userId: ownerId } }, select: { role: true, user: { select: { name: true } } } });
      if (!membership || membership.role !== 'player') return reply.code(404).send(apiError('NOT_FOUND', 'Jogador não encontrado na campanha'));
      name ??= membership.user?.name ?? 'Jogador';
    } else if (input.ownerType === 'group') {
      ownerId ??= request.campaign.id;
      const group = ownerId === request.campaign.id ? null : await prisma.group.findUnique({ where: { campaignId_domainId: { campaignId: request.campaign.id, domainId: ownerId } } });
      if (ownerId !== request.campaign.id && !group) return reply.code(404).send(apiError('NOT_FOUND', 'Grupo não encontrado na campanha'));
      name ??= group?.name ?? 'Grupo';
    } else {
      ownerId = null;
      name ??= 'Carroça';
    }
    try {
      await prisma.$transaction(async (tx) => {
        const claimed = await tx.mapBoard.updateMany({ where: { id: board.id, campaignId: request.campaign.id, version: board.version }, data: { version: { increment: 1 } } });
        if (!claimed.count) throw Object.assign(new Error('O mapa foi alterado. Atualize antes de posicionar o marcador.'), { statusCode: 409, code: 'VERSION_CONFLICT' });
        await tx.mapTravelMarker.create({ data: { boardId: board.id, ownerType: input.ownerType, ownerId, name, ...snappedMarkerPoint(board, input), updatedByUserId: request.auth.user.id } });
      });
    } catch (error) { if (error.code === 'P2002') return reply.code(409).send(apiError('ALREADY_EXISTS', 'Esse jogador ou grupo já tem um marcador neste mapa')); throw error; }
    request.server.realtime?.to(`campaign:${request.campaign.id}`).emit('map.pin.changed', { boardId: board.id, reason: 'marker-created' });
    return reply.code(201).send(await serializeBoard(request, await ensureBoard(request)));
  });

  app.patch('/api/v1/campaigns/:campaignId/map/markers/:markerId', { preHandler: [authenticate, requireCampaign, requireMapEditor, requireCsrf] }, async (request, reply) => {
    const parsed = travelMarkerPatchInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_INPUT', 'Marcador inválido', parsed.error.flatten()));
    const version = expectedMapVersion(request, reply); if (version === null) return;
    const board = await ensureBoard(request), marker = (board.travelMarkers ?? []).find((entry) => entry.id === request.params.markerId);
    if (!marker) return reply.code(404).send(apiError('NOT_FOUND', 'Marcador não encontrado neste mapa'));
    if (!isGm(request) && !(marker.ownerType === 'player' && marker.ownerId === request.auth.user.id)) return reply.code(403).send(apiError('FORBIDDEN', 'Você pode mover apenas seu próprio marcador'));
    if (marker.version !== version) return mapVersionConflict(reply);
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.mapBoard.updateMany({ where: { id: board.id, campaignId: request.campaign.id, version: board.version }, data: { version: { increment: 1 } } });
      if (!claimed.count) throw Object.assign(new Error('O mapa foi alterado. Atualize antes de mover o marcador.'), { statusCode: 409, code: 'VERSION_CONFLICT' });
      const saved = await tx.mapTravelMarker.updateMany({ where: { id: marker.id, boardId: board.id, version }, data: { ...snappedMarkerPoint(board, parsed.data), ...(parsed.data.name ? { name: parsed.data.name } : {}), version: { increment: 1 }, updatedByUserId: request.auth.user.id } });
      if (!saved.count) throw Object.assign(new Error('O marcador foi alterado. Atualize antes de salvar.'), { statusCode: 409, code: 'VERSION_CONFLICT' });
    });
    request.server.realtime?.to(`campaign:${request.campaign.id}`).emit('map.pin.changed', { boardId: board.id, reason: 'marker-updated' });
    return serializeBoard(request, await ensureBoard(request));
  });

  app.delete('/api/v1/campaigns/:campaignId/map/markers/:markerId', { preHandler: [authenticate, requireCampaign, requireMapEditor, requireCsrf] }, async (request, reply) => {
    const version = expectedMapVersion(request, reply); if (version === null) return;
    const board = await ensureBoard(request), marker = (board.travelMarkers ?? []).find((entry) => entry.id === request.params.markerId);
    if (!marker) return reply.code(404).send(apiError('NOT_FOUND', 'Marcador não encontrado neste mapa'));
    if (!isGm(request) && !(marker.ownerType === 'player' && marker.ownerId === request.auth.user.id)) return reply.code(403).send(apiError('FORBIDDEN', 'Você pode remover apenas seu próprio marcador'));
    if (marker.version !== version) return mapVersionConflict(reply);
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.mapBoard.updateMany({ where: { id: board.id, campaignId: request.campaign.id, version: board.version }, data: { version: { increment: 1 } } });
      if (!claimed.count) throw Object.assign(new Error('O mapa foi alterado. Atualize antes de remover o marcador.'), { statusCode: 409, code: 'VERSION_CONFLICT' });
      const deleted = await tx.mapTravelMarker.deleteMany({ where: { id: marker.id, boardId: board.id, version } });
      if (!deleted.count) throw Object.assign(new Error('O marcador foi alterado. Atualize antes de remover.'), { statusCode: 409, code: 'VERSION_CONFLICT' });
    });
    request.server.realtime?.to(`campaign:${request.campaign.id}`).emit('map.pin.changed', { boardId: board.id, reason: 'marker-removed' });
    return reply.code(204).send();
  });

  app.get('/api/v1/campaigns/:campaignId/map/locations', { preHandler: [authenticate, requireCampaign] }, async (request) => {
    const rows = await loadLocationRows(request.campaign.id);
    const board = isGm(request) ? await ensureBoard(request) : null;
    const items = (await Promise.all(rows.map(async (row) => {
      const entity = await getEntityForRequest({ request, type: 'location', domainId: row.domainId, options: { backlinks: false, format: '1' } });
      if (!entity) return null;
      const summary = boardEntitySummary(entity);
      return { id: summary.id, name: summary.name, type: summary.type, ...(board ? { pinVersion: board.pins.find((pin) => pin.locationId === summary.id)?.version ?? 0 } : {}) };
    }))).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR') || a.id.localeCompare(b.id));
    return { items };
  });

  app.post('/api/v1/campaigns/:campaignId/map/board/auto-layout', { preHandler: [authenticate, requireCampaign, requireGm, requireMapEditor, requireCsrf] }, async (request, reply) => {
    const parsed = boardSessionInput.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_INPUT', 'Configuração de mapa inválida', parsed.error.flatten()));
    const board = await rebuildBoardLayout(request, parsed.data);
    request.server.realtime?.to(`campaign:${request.campaign.id}`).emit('map.layout.changed', { boardId: board.id, reason: 'auto-layout' });
    return serializeBoard(request, board);
  });

  app.post('/api/v1/campaigns/:campaignId/map/regions', { preHandler: [authenticate, requireCampaign, requireGm, requireMapEditor, requireCsrf] }, async (request, reply) => {
    const parsed = boardRegionInput.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_INPUT', 'Região inválida', parsed.error.flatten()));
    const rows = await loadLocationRows(request.campaign.id);
    const region = rows.find((row) => row.domainId === parsed.data.regionId);
    if (!region || !isRegion(region)) return reply.code(404).send(apiError('NOT_FOUND', 'Região não encontrada'));
    const board = await ensureBoard(request, rows);
    if (board.regions.some((entry) => entry.regionId === region.domainId)) return reply.code(409).send(apiError('ALREADY_EXISTS', 'A região já está no mosaico'));
    const rect = { ...gridRect(board.regions.length, Math.max(rows.filter(isRegion).length, board.regions.length + 1)), ...Object.fromEntries(['x', 'y', 'width', 'height', 'zIndex'].filter((key) => parsed.data[key] !== undefined).map((key) => [key, parsed.data[key]])) };
    await prisma.$transaction(async (tx) => {
      await tx.mapBoardRegion.create({ data: { boardId: board.id, regionId: region.domainId, ...rect, updatedByUserId: request.auth.user.id } });
      for (const location of descendantsOfRegion(rows, region.domainId)) {
        await tx.mapLocationPin.create({ data: { boardId: board.id, regionId: region.domainId, entityType: 'location', entityId: location.domainId, locationId: location.domainId, ...autoPinCoordinates(rows, region.domainId, location.domainId), updatedByUserId: request.auth.user.id } });
      }
    });
    const saved = await ensureBoard(request, rows);
    request.server.realtime?.to(`campaign:${request.campaign.id}`).emit('map.layout.changed', { boardId: saved.id, regionId: region.domainId, reason: 'region-added' });
    return reply.code(201).send(await serializeBoard(request, saved));
  });

  app.patch('/api/v1/campaigns/:campaignId/map/regions/:regionId', { preHandler: [authenticate, requireCampaign, requireGm, requireMapEditor, requireCsrf] }, async (request, reply) => {
    const parsed = boardRegionPatchInput.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_INPUT', 'Painel inválido', parsed.error.flatten()));
    const rows = await loadLocationRows(request.campaign.id);
    const board = await ensureBoard(request, rows);
    const current = board.regions.find((entry) => entry.regionId === request.params.regionId);
    if (!current) return reply.code(404).send(apiError('NOT_FOUND', 'Região não encontrada no mosaico'));
    await prisma.mapBoardRegion.update({ where: { id: current.id }, data: { ...parsed.data, updatedByUserId: request.auth.user.id } });
    const saved = await ensureBoard(request, rows);
    request.server.realtime?.to(`campaign:${request.campaign.id}`).emit('map.layout.changed', { boardId: saved.id, regionId: current.regionId, reason: 'region-updated' });
    return serializeBoard(request, saved);
  });

  app.delete('/api/v1/campaigns/:campaignId/map/regions/:regionId', { preHandler: [authenticate, requireCampaign, requireGm, requireMapEditor, requireCsrf] }, async (request, reply) => {
    const rows = await loadLocationRows(request.campaign.id);
    const board = await ensureBoard(request, rows);
    const current = board.regions.find((entry) => entry.regionId === request.params.regionId);
    if (!current) return reply.code(404).send(apiError('NOT_FOUND', 'Região não encontrada no mosaico'));
    await prisma.$transaction(async (tx) => {
      await tx.mapLocationPin.deleteMany({ where: { boardId: board.id, regionId: current.regionId } });
      await tx.mapBoardRegion.delete({ where: { id: current.id } });
    });
    request.server.realtime?.to(`campaign:${request.campaign.id}`).emit('map.layout.changed', { boardId: board.id, regionId: current.regionId, reason: 'region-removed' });
    return reply.code(204).send();
  });

  app.patch('/api/v1/campaigns/:campaignId/map/board/scale', { preHandler: [authenticate, requireCampaign, requireGm, requireMapEditor, requireCsrf] }, async (request, reply) => {
    const parsed = z.union([scaleInput, z.object({ distanceKm: z.coerce.number().finite().positive().max(100000000) }).strict()]).safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_INPUT', 'Escala inválida', parsed.error.flatten()));
    const version = expectedMapVersion(request, reply); if (version === null) return;
    const board = await ensureBoard(request);
    const currentScale = scaleDetails(board);
    if (parsed.data.startX === undefined && !currentScale) return reply.code(400).send(apiError('MAP_SCALE_REQUIRED', 'Calibre a escala antes de editar a distância'));
    const calibration = parsed.data.startX !== undefined ? parsed.data : { startX: currentScale.startX, startY: currentScale.startY, endX: currentScale.endX, endY: currentScale.endY, imageWidth: currentScale.imageWidth, imageHeight: currentScale.imageHeight, distanceKm: parsed.data.distanceKm };
    const changed = await prisma.$transaction(async (tx) => {
      const saved = await tx.mapBoard.updateMany({ where: { id: board.id, campaignId: request.campaign.id, version }, data: { ...(board.roadNetwork ? { roadNetwork: { ...board.roadNetwork, imageWidth: calibration.imageWidth, imageHeight: calibration.imageHeight } } : {}), scaleStartX: calibration.startX, scaleStartY: calibration.startY, scaleEndX: calibration.endX, scaleEndY: calibration.endY, scaleDistanceKm: calibration.distanceKm, scaleImageWidth: calibration.imageWidth, scaleImageHeight: calibration.imageHeight, scaleKm: null, version: { increment: 1 } } });
      if (!saved.count) return false;
      const refreshed = await tx.mapBoard.findUnique({ where: { id: board.id }, include: boardInclude });
      for (const route of refreshed.routes ?? []) await recalculateRouteTx(tx, request, refreshed, route.id, request.auth.user.id);
      return true;
    });
    if (!changed) return mapVersionConflict(reply);
    request.server.realtime?.to(`campaign:${request.campaign.id}`).emit('map.scale.changed', { boardId: board.id, reason: 'scale-updated' });
    return serializeBoard(request, await ensureBoard(request));
  });

  app.post('/api/v1/campaigns/:campaignId/map/boundaries', { preHandler: [authenticate, requireCampaign, requireGm, requireMapEditor, requireCsrf] }, async (request, reply) => {
    const parsed = boundaryInput.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_INPUT', 'Delimitação inválida', parsed.error.flatten()));
    const board = await ensureBoard(request);
    if (!await getEntityForRequest({ request, type: 'location', domainId: parsed.data.regionId, options: { backlinks: false, format: '1' } })) return reply.code(404).send(apiError('NOT_FOUND', 'Local não encontrado'));
    let boundary;
    try {
      boundary = await prisma.$transaction(async (tx) => {
        const claimed = await tx.mapBoard.updateMany({ where: { id: board.id, campaignId: request.campaign.id, version: board.version }, data: { version: { increment: 1 } } });
        if (!claimed.count) throw Object.assign(new Error('O mapa foi alterado. Atualize antes de delimitar o território.'), { statusCode: 409, code: 'VERSION_CONFLICT' });
        return tx.mapRegionBoundary.create({ data: { boardId: board.id, ...parsed.data, updatedByUserId: request.auth.user.id } });
      });
    }
    catch (error) { if (error.code === 'P2002') return reply.code(409).send(apiError('ALREADY_EXISTS', 'Esta região já foi delimitada no mapa')); throw error; }
    request.server.realtime?.to(`campaign:${request.campaign.id}`).emit('map.layout.changed', { boardId: board.id, boundaryId: boundary.id, reason: 'boundary-created' });
    return reply.code(201).send(await serializeBoard(request, await ensureBoard(request)));
  });

  app.patch('/api/v1/campaigns/:campaignId/map/boundaries/:boundaryId', { preHandler: [authenticate, requireCampaign, requireGm, requireMapEditor, requireCsrf] }, async (request, reply) => {
    const parsed = boundaryPatchInput.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_INPUT', 'Delimitação inválida', parsed.error.flatten()));
    const version = expectedMapVersion(request, reply); if (version === null) return;
    const board = await ensureBoard(request);
    const boundary = (board.boundaries ?? []).find((entry) => entry.id === request.params.boundaryId);
    if (!boundary) return reply.code(404).send(apiError('NOT_FOUND', 'Delimitação não encontrada'));
    if (parsed.data.regionId && !await getEntityForRequest({ request, type: 'location', domainId: parsed.data.regionId, options: { backlinks: false, format: '1' } })) return reply.code(404).send(apiError('NOT_FOUND', 'Local não encontrado'));
    try { await prisma.$transaction(async (tx) => {
      const claimed = await tx.mapBoard.updateMany({ where: { id: board.id, campaignId: request.campaign.id, version: board.version }, data: { version: { increment: 1 } } });
      if (!claimed.count) throw Object.assign(new Error('O mapa foi alterado. Atualize antes de editar o território.'), { statusCode: 409, code: 'VERSION_CONFLICT' });
      const saved = await tx.mapRegionBoundary.updateMany({ where: { id: boundary.id, boardId: board.id, version }, data: { ...parsed.data, updatedByUserId: request.auth.user.id, version: { increment: 1 } } });
      if (!saved.count) throw Object.assign(new Error('O território foi alterado. Atualize antes de salvar.'), { statusCode: 409, code: 'VERSION_CONFLICT' });
    }); } catch (error) { if (error.code === 'P2002') return reply.code(409).send(apiError('ALREADY_EXISTS', 'Este local já possui um limite neste mapa')); throw error; }
    request.server.realtime?.to(`campaign:${request.campaign.id}`).emit('map.layout.changed', { boardId: board.id, boundaryId: boundary.id, reason: 'boundary-updated' });
    return serializeBoard(request, await ensureBoard(request));
  });

  app.delete('/api/v1/campaigns/:campaignId/map/boundaries/:boundaryId', { preHandler: [authenticate, requireCampaign, requireGm, requireMapEditor, requireCsrf] }, async (request, reply) => {
    const version = expectedMapVersion(request, reply); if (version === null) return;
    const board = await ensureBoard(request);
    const boundary = (board.boundaries ?? []).find((entry) => entry.id === request.params.boundaryId);
    if (!boundary) return reply.code(404).send(apiError('NOT_FOUND', 'Delimitação não encontrada'));
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.mapBoard.updateMany({ where: { id: board.id, campaignId: request.campaign.id, version: board.version }, data: { version: { increment: 1 } } });
      if (!claimed.count) throw Object.assign(new Error('O mapa foi alterado. Atualize antes de remover o território.'), { statusCode: 409, code: 'VERSION_CONFLICT' });
      const deleted = await tx.mapRegionBoundary.deleteMany({ where: { id: boundary.id, boardId: board.id, version } });
      if (!deleted.count) throw Object.assign(new Error('O território foi alterado. Atualize antes de remover.'), { statusCode: 409, code: 'VERSION_CONFLICT' });
    });
    request.server.realtime?.to(`campaign:${request.campaign.id}`).emit('map.layout.changed', { boardId: board.id, boundaryId: boundary.id, reason: 'boundary-removed' });
    return reply.code(204).send();
  });

  app.get('/api/v1/campaigns/:campaignId/map/pin-candidates', { preHandler: [authenticate, requireCampaign] }, async (request) => {
    const board = await ensureBoard(request);
    const rows = await prisma.entity.findMany({ where: { campaignId: request.campaign.id, deletedAt: null, type: { in: ['location', 'npc', 'item', 'monster', 'quest'] } }, select: { type: true, domainId: true }, orderBy: [{ type: 'asc' }, { domainId: 'asc' }] });
    const pinned = new Set(board.pins.map((pin) => `${pin.entityType}:${pin.entityId}`));
    const summaries = (await Promise.all(rows.map((row) => campaignEntitySummary(request, row.type, row.domainId)))).filter(Boolean);
    const locations = new Map(summaries.filter((summary) => summary.type === 'location').map((summary) => [summary.id, summary]));
    const items = summaries.map((summary) => ({ ...summary, ...pinCandidateMetadata(summary, locations), entity: undefined, pinned: pinned.has(`${summary.type}:${summary.id}`) }));
    return { items };
  });

  app.post('/api/v1/campaigns/:campaignId/map/pins', { preHandler: [authenticate, requireCampaign, requireGm, requireMapEditor, requireCsrf] }, async (request, reply) => {
    const parsed = pinInput.extend({ entityType: z.enum(['location', 'npc', 'item', 'monster', 'quest']), entityId: z.string().trim().min(1) }).safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_INPUT', 'Pin inválido', parsed.error.flatten()));
    const board = await ensureBoard(request);
    const entity = await campaignEntitySummary(request, parsed.data.entityType, parsed.data.entityId);
    if (!entity) return reply.code(404).send(apiError('NOT_FOUND', 'Entidade não encontrada ou não autorizada'));
    if (parsed.data.entityType === 'location' && parsed.data.regionId) { const rows = await loadLocationRows(request.campaign.id); const region = rows.find((row) => row.domainId === parsed.data.regionId); if (!region || !isRegion(region) || regionForLocation(rows, parsed.data.entityId) !== parsed.data.regionId) return reply.code(400).send(apiError('INVALID_REGION', 'O local não pertence à região informada')); }
    const current = board.pins.find((pin) => pin.entityType === parsed.data.entityType && pin.entityId === parsed.data.entityId);
    if (current) return reply.code(409).send(apiError('ALREADY_EXISTS', 'Esse pin já existe'));
    try { await prisma.mapLocationPin.create({ data: { boardId: board.id, entityType: parsed.data.entityType, entityId: parsed.data.entityId, locationId: parsed.data.entityType === 'location' ? parsed.data.entityId : null, regionId: parsed.data.regionId ?? null, x: parsed.data.x, y: parsed.data.y, placementSource: 'manual', updatedByUserId: request.auth.user.id } }); } catch (error) { if (error.code === 'P2002') return reply.code(409).send(apiError('ALREADY_EXISTS', 'Esse pin já existe')); throw error; }
    request.server.realtime?.to(`campaign:${request.campaign.id}`).emit('map.pin.changed', { boardId: board.id, reason: 'pin-created' });
    return reply.code(201).send(await serializeBoard(request, await ensureBoard(request)));
  });

  app.patch('/api/v1/campaigns/:campaignId/map/pins/:pinId', { preHandler: [authenticate, requireCampaign, requireGm, requireMapEditor, requireCsrf] }, async (request, reply) => {
    const parsed = z.object({ x: z.coerce.number().finite().min(0).max(1), y: z.coerce.number().finite().min(0).max(1), regionId: z.string().nullable().optional() }).strict().safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_INPUT', 'Pin inválido', parsed.error.flatten()));
    const version = expectedMapVersion(request, reply); if (version === null) return;
    const board = await ensureBoard(request); const pin = board.pins.find((entry) => entry.id === request.params.pinId); if (!pin) return reply.code(404).send(apiError('NOT_FOUND', 'Pin não encontrado'));
    if ((pin.entityType ?? 'location') === 'location' && parsed.data.regionId) { const rows = await loadLocationRows(request.campaign.id); if (regionForLocation(rows, pin.entityId ?? pin.locationId) !== parsed.data.regionId) return reply.code(400).send(apiError('INVALID_REGION', 'O local não pertence à região informada')); }
    const saved = await prisma.mapLocationPin.updateMany({ where: { id: pin.id, boardId: board.id, version }, data: { x: parsed.data.x, y: parsed.data.y, ...(parsed.data.regionId !== undefined ? { regionId: parsed.data.regionId } : {}), placementSource: 'manual', updatedByUserId: request.auth.user.id, version: { increment: 1 } } });
    if (!saved.count) return mapVersionConflict(reply);
    const refreshed = await ensureBoard(request);
    await prisma.$transaction(async (tx) => { for (const route of refreshed.routes ?? []) if (route.fromPinId === pin.id || route.toPinId === pin.id) await recalculateRouteTx(tx, request, refreshed, route.id, request.auth.user.id); });
    request.server.realtime?.to(`campaign:${request.campaign.id}`).emit('map.pin.changed', { boardId: board.id, pinId: pin.id, reason: 'pin-updated' });
    return serializeBoard(request, await ensureBoard(request));
  });

  app.delete('/api/v1/campaigns/:campaignId/map/pins/:pinId', { preHandler: [authenticate, requireCampaign, requireGm, requireMapEditor, requireCsrf] }, async (request, reply) => {
    const version = expectedMapVersion(request, reply); if (version === null) return; const board = await ensureBoard(request); const pin = board.pins.find((entry) => entry.id === request.params.pinId); if (!pin) return reply.code(404).send(apiError('NOT_FOUND', 'Pin não encontrado'));
    const deleted = await prisma.$transaction(async (tx) => {
      const result = await tx.mapLocationPin.deleteMany({ where: { id: pin.id, boardId: board.id, version } });
      if (result.count) await tx.mapRoute.deleteMany({ where: { boardId: board.id, OR: [{ fromPinId: pin.id }, { toPinId: pin.id }] } });
      return result;
    });
    if (!deleted.count) return mapVersionConflict(reply); request.server.realtime?.to(`campaign:${request.campaign.id}`).emit('map.pin.changed', { boardId: board.id, pinId: pin.id, reason: 'pin-removed' }); return reply.code(204).send();
  });

  app.get('/api/v1/campaigns/:campaignId/map/pins/:pinId/content', { preHandler: [authenticate, requireCampaign] }, async (request, reply) => {
    const board = await ensureBoard(request); const pin = board.pins.find((entry) => entry.id === request.params.pinId); if (!pin) return reply.code(404).send(apiError('NOT_FOUND', 'Pin não encontrado'));
    if (!await getEntityForRequest({ request, type: pin.entityType ?? 'location', domainId: pin.entityId ?? pin.locationId, options: { backlinks: false, format: '1' } })) return reply.code(404).send(apiError('NOT_FOUND', 'Pin não encontrado'));
    const content = await buildMapPinContent({ request, pin, category: request.query?.category });
    if (!content) return reply.code(404).send(apiError('NOT_FOUND', 'Pin não encontrado'));
    return content;
  });

  app.patch('/api/v1/campaigns/:campaignId/map/locations/:locationId/pin', { preHandler: [authenticate, requireCampaign, requireGm, requireMapEditor, requireCsrf] }, async (request, reply) => {
    const parsed = pinInput.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_INPUT', 'Pin inválido', parsed.error.flatten()));
    const version = expectedMapVersion(request, reply);
    if (version === null) return;
    const rows = await loadLocationRows(request.campaign.id);
    const location = rows.find((row) => row.domainId === request.params.locationId);
    if (!location) return reply.code(404).send(apiError('NOT_FOUND', 'Local não encontrado'));
    if (parsed.data.regionId && (location.domainId === parsed.data.regionId || regionForLocation(rows, location.domainId) !== parsed.data.regionId)) return reply.code(400).send(apiError('INVALID_REGION', 'O local não pertence à região informada'));
    const board = await ensureBoard(request, rows);
    if (parsed.data.regionId && !board.regions.some((entry) => entry.regionId === parsed.data.regionId)) return reply.code(404).send(apiError('NOT_FOUND', 'Região não encontrada no mosaico'));
    if (!parsed.data.regionId && !board.imageUrl) return reply.code(409).send(apiError('MAP_IMAGE_REQUIRED', 'Adicione a imagem do mapa antes de posicionar pins.'));
    const current = board.pins.find((entry) => (entry.locationId ?? entry.entityId) === location.domainId && (entry.entityType ?? 'location') === 'location');
    const pinData = { entityType: 'location', entityId: location.domainId, regionId: parsed.data.regionId ?? null, x: parsed.data.x, y: parsed.data.y, placementSource: 'manual', updatedByUserId: request.auth.user.id };
    if (current) {
      const updated = await prisma.mapLocationPin.updateMany({ where: { id: current.id, boardId: board.id, version }, data: { ...pinData, version: { increment: 1 } } });
      if (!updated.count) return mapVersionConflict(reply);
    } else {
      if (version !== 0) return mapVersionConflict(reply);
      try {
        await prisma.mapLocationPin.create({ data: { boardId: board.id, ...pinData, locationId: location.domainId } });
      } catch (error) {
        if (error.code === 'P2002') return mapVersionConflict(reply);
        throw error;
      }
    }
    const saved = await ensureBoard(request, rows);
    request.server.realtime?.to(`campaign:${request.campaign.id}`).emit('map.pin.changed', { boardId: saved.id, reason: 'pin-updated' });
    return serializeBoard(request, saved);
  });

  app.delete('/api/v1/campaigns/:campaignId/map/locations/:locationId/pin', { preHandler: [authenticate, requireCampaign, requireGm, requireMapEditor, requireCsrf] }, async (request, reply) => {
    const version = expectedMapVersion(request, reply);
    if (version === null) return;
    const board = await ensureBoard(request);
    const deleted = await prisma.mapLocationPin.deleteMany({ where: { boardId: board.id, locationId: request.params.locationId, version } });
    if (!deleted.count) return mapVersionConflict(reply);
    request.server.realtime?.to(`campaign:${request.campaign.id}`).emit('map.pin.changed', { boardId: board.id, reason: 'pin-removed' });
    return reply.code(204).send();
  });

  app.post('/api/v1/campaigns/:campaignId/map/routes', { preHandler: [authenticate, requireCampaign, requireGm, requireMapEditor, requireCsrf] }, async (request, reply) => {
    const parsed = routeInput.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_INPUT', 'Caminho inválido', parsed.error.flatten()));
    const board = await ensureBoard(request);
    if (!scaleDetails(board)) return reply.code(409).send(apiError('MAP_SCALE_REQUIRED', 'Calibre a escala antes de criar caminhos'));
    const from = board.pins.find((pin) => pin.id === parsed.data.fromPinId || (pin.locationId ?? pin.entityId) === parsed.data.fromLocationId);
    const to = board.pins.find((pin) => pin.id === parsed.data.toPinId || (pin.locationId ?? pin.entityId) === parsed.data.toLocationId);
    if (!from || !to) return reply.code(400).send(apiError('PINS_REQUIRED', 'Selecione dois pins existentes para criar o caminho'));
    if ((board.routes ?? []).some((route) => (route.fromPinId === from.id && route.toPinId === to.id) || (route.fromPinId === to.id && route.toPinId === from.id))) {
      return reply.code(409).send(apiError('ALREADY_EXISTS', 'Esse caminho já existe'));
    }
    let route;
    try {
      route = await prisma.$transaction(async (tx) => {
        const created = await tx.mapRoute.create({ data: { boardId: board.id, fromPinId: from.id, toPinId: to.id, ...(parsed.data.fromLocationId ? { fromLocationId: parsed.data.fromLocationId, toLocationId: parsed.data.toLocationId, label: parsed.data.label ?? null, distanceKm: parsed.data.distanceKm ?? null } : {}), updatedByUserId: request.auth.user.id, points: { create: [{ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, order: 0, updatedByUserId: request.auth.user.id }] } }, include: { points: true } });
        const distanceKm = routeDistanceFromParts(created, from, to, board);
        const sourceConnectionId = await syncCatalogConnection(tx, request, from, to, distanceKm);
  if (!tx.mapRoute.update) return { ...created, distanceKm, sourceConnectionId };
        return tx.mapRoute.update({ where: { id: created.id }, data: { distanceKm: parsed.data.fromLocationId && parsed.data.distanceKm != null ? parsed.data.distanceKm : distanceKm, sourceConnectionId }, include: { points: true } });
      });
    } catch (error) {
      if (error.code === 'P2002') return reply.code(409).send(apiError('ALREADY_EXISTS', 'Esse caminho já existe'));
      throw error;
    }
    request.server.realtime?.to(`campaign:${request.campaign.id}`).emit('map.route.changed', { boardId: board.id, routeId: route.id, reason: 'route-created' });
    return reply.code(201).send(await serializeBoard(request, await ensureBoard(request)));
  });

  app.patch('/api/v1/campaigns/:campaignId/map/routes/:routeId', { preHandler: [authenticate, requireCampaign, requireGm, requireMapEditor, requireCsrf] }, async (request, reply) => {
    const parsed = routePatchInput.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_INPUT', 'Alteração de caminho inválida', parsed.error.flatten()));
    const version = expectedMapVersion(request, reply);
    if (version === null) return;
    const board = await ensureBoard(request);
    const route = (board.routes ?? []).find((entry) => entry.id === request.params.routeId);
    if (!route) return reply.code(404).send(apiError('NOT_FOUND', 'Caminho não encontrado'));
    if (!scaleDetails(board)) return reply.code(409).send(apiError('MAP_SCALE_REQUIRED', 'Calibre a escala antes de alterar caminhos'));
    const updated = await prisma.mapRoute.updateMany({ where: { id: route.id, boardId: board.id, version }, data: { version: { increment: 1 }, updatedByUserId: request.auth.user.id } });
    if (!updated.count) return reply.code(409).send(apiError('VERSION_CONFLICT', 'O caminho foi alterado por outra pessoa'));
    await prisma.$transaction(async (tx) => { await recalculateRouteTx(tx, request, board, route.id, request.auth.user.id); });
    request.server.realtime?.to(`campaign:${request.campaign.id}`).emit('map.route.changed', { boardId: board.id, routeId: route.id, reason: 'route-updated' });
    return serializeBoard(request, await ensureBoard(request));
  });

  app.delete('/api/v1/campaigns/:campaignId/map/routes/:routeId', { preHandler: [authenticate, requireCampaign, requireGm, requireMapEditor, requireCsrf] }, async (request, reply) => {
    const version = expectedMapVersion(request, reply);
    if (version === null) return;
    const board = await ensureBoard(request);
    const route = (board.routes ?? []).find((entry) => entry.id === request.params.routeId);
    if (!route) return reply.code(404).send(apiError('NOT_FOUND', 'Caminho não encontrado'));
    const deleted = await prisma.mapRoute.deleteMany({ where: { id: route.id, boardId: board.id, version } });
    if (!deleted.count) return reply.code(409).send(apiError('VERSION_CONFLICT', 'O caminho foi alterado por outra pessoa'));
    request.server.realtime?.to(`campaign:${request.campaign.id}`).emit('map.route.changed', { boardId: board.id, routeId: route.id, reason: 'route-removed' });
    return reply.code(204).send();
  });

  app.post('/api/v1/campaigns/:campaignId/map/routes/:routeId/points', { preHandler: [authenticate, requireCampaign, requireGm, requireMapEditor, requireCsrf] }, async (request, reply) => {
    const parsed = routePointInput.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_INPUT', 'Ponto de caminho inválido', parsed.error.flatten()));
    const version = expectedMapVersion(request, reply);
    if (version === null) return;
    const board = await ensureBoard(request);
    const route = (board.routes ?? []).find((entry) => entry.id === request.params.routeId);
    if (!route) return reply.code(404).send(apiError('NOT_FOUND', 'Caminho não encontrado'));
    if (parsed.data.segmentIndex == null) return reply.code(400).send(apiError('INVALID_SEGMENT', 'Informe o segmento do caminho'));
    const from = board.pins.find((pin) => pin.id === route.fromPinId); const to = board.pins.find((pin) => pin.id === route.toPinId);
    const vertices = [from, ...(route.points ?? []).sort((a, b) => a.order - b.order), to]; const segmentIndex = parsed.data.segmentIndex;
    if (segmentIndex < 0 || segmentIndex >= vertices.length - 1) return reply.code(400).send(apiError('INVALID_SEGMENT', 'Trecho inválido'));
    const point = await prisma.$transaction(async (tx) => {
      const routeUpdated = await tx.mapRoute.updateMany({ where: { id: route.id, boardId: board.id, version }, data: { version: { increment: 1 }, updatedByUserId: request.auth.user.id } });
      if (!routeUpdated.count) return null;
      const shifted = await tx.mapRoutePoint.findMany({ where: { routeId: route.id, order: { gte: segmentIndex } }, orderBy: { order: 'desc' } });
      for (const existing of shifted) await tx.mapRoutePoint.update({ where: { id: existing.id }, data: { order: existing.order + 1 } });
      const created = await tx.mapRoutePoint.create({ data: { routeId: route.id, x: (vertices[segmentIndex].x + vertices[segmentIndex + 1].x) / 2, y: (vertices[segmentIndex].y + vertices[segmentIndex + 1].y) / 2, order: segmentIndex, updatedByUserId: request.auth.user.id } });
      return created;
    });
    if (!point) return reply.code(409).send(apiError('VERSION_CONFLICT', 'O caminho foi alterado por outra pessoa'));
    await prisma.$transaction(async (tx) => { await recalculateRouteTx(tx, request, board, route.id, request.auth.user.id); });
    request.server.realtime?.to(`campaign:${request.campaign.id}`).emit('map.route.changed', { boardId: board.id, routeId: route.id, pointId: point.id, reason: 'route-point-added' });
    return serializeBoard(request, await ensureBoard(request));
  });

  app.patch('/api/v1/campaigns/:campaignId/map/routes/:routeId/points/:pointId', { preHandler: [authenticate, requireCampaign, requireGm, requireMapEditor, requireCsrf] }, async (request, reply) => {
    const parsed = z.object({ x: z.coerce.number().finite().min(0).max(1), y: z.coerce.number().finite().min(0).max(1) }).strict().safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_INPUT', 'Ponto de caminho inválido', parsed.error.flatten()));
    const version = expectedMapVersion(request, reply);
    if (version === null) return;
    const board = await ensureBoard(request);
    const route = (board.routes ?? []).find((entry) => entry.id === request.params.routeId);
    if (!route || !(route.points ?? []).some((point) => point.id === request.params.pointId)) return reply.code(404).send(apiError('NOT_FOUND', 'Ponto de caminho não encontrado'));
    const result = await prisma.$transaction(async (tx) => {
      const routeUpdated = await tx.mapRoute.updateMany({ where: { id: route.id, boardId: board.id, version }, data: { version: { increment: 1 }, updatedByUserId: request.auth.user.id } });
      if (!routeUpdated.count) return { updated: { count: 0 }, routeUpdated };
      const updated = await tx.mapRoutePoint.updateMany({ where: { id: request.params.pointId, routeId: route.id }, data: { ...parsed.data, updatedByUserId: request.auth.user.id } });
      return { updated, routeUpdated };
    });
    if (!result.routeUpdated.count) return reply.code(409).send(apiError('VERSION_CONFLICT', 'O caminho foi alterado por outra pessoa'));
    await prisma.$transaction(async (tx) => { await recalculateRouteTx(tx, request, board, route.id, request.auth.user.id); });
    request.server.realtime?.to(`campaign:${request.campaign.id}`).emit('map.route.changed', { boardId: board.id, routeId: route.id, pointId: request.params.pointId, reason: 'route-point-updated' });
    return serializeBoard(request, await ensureBoard(request));
  });

  app.delete('/api/v1/campaigns/:campaignId/map/routes/:routeId/points/:pointId', { preHandler: [authenticate, requireCampaign, requireGm, requireMapEditor, requireCsrf] }, async (request, reply) => {
    const version = expectedMapVersion(request, reply);
    if (version === null) return;
    const board = await ensureBoard(request);
    const route = (board.routes ?? []).find((entry) => entry.id === request.params.routeId);
    if (!route || !(route.points ?? []).some((point) => point.id === request.params.pointId)) return reply.code(404).send(apiError('NOT_FOUND', 'Ponto de caminho não encontrado'));
    const result = await prisma.$transaction(async (tx) => {
      const routeUpdated = await tx.mapRoute.updateMany({ where: { id: route.id, boardId: board.id, version }, data: { version: { increment: 1 }, updatedByUserId: request.auth.user.id } });
      if (!routeUpdated.count) return { deleted: { count: 0 }, routeUpdated };
      const deleted = await tx.mapRoutePoint.deleteMany({ where: { id: request.params.pointId, routeId: route.id } });
      const points = await tx.mapRoutePoint.findMany({ where: { routeId: route.id }, orderBy: { order: 'asc' } });
      for (const [index, point] of points.entries()) await tx.mapRoutePoint.update({ where: { id: point.id }, data: { order: -(index + 1) } });
      for (const [index, point] of points.entries()) await tx.mapRoutePoint.update({ where: { id: point.id }, data: { order: index } });
      return { deleted, routeUpdated };
    });
    if (!result.routeUpdated.count) return reply.code(409).send(apiError('VERSION_CONFLICT', 'O caminho foi alterado por outra pessoa'));
    await prisma.$transaction(async (tx) => { await recalculateRouteTx(tx, request, board, route.id, request.auth.user.id); });
    request.server.realtime?.to(`campaign:${request.campaign.id}`).emit('map.route.changed', { boardId: board.id, routeId: route.id, pointId: request.params.pointId, reason: 'route-point-removed' });
    return reply.code(204).send();
  });

  app.get('/api/v1/campaigns/:campaignId/map/sessions', { preHandler: [authenticate, requireCampaign] }, async (request) => {
    const rows = await prisma.mapSession.findMany({ where: { campaignId: request.campaign.id }, orderBy: [{ endedAt: 'asc' }, { startedAt: 'desc' }], include: sessionInclude });
    return rows.map(serializeSession);
  });

  app.get('/api/v1/campaigns/:campaignId/map/sessions/current', { preHandler: [authenticate, requireCampaign] }, async (request, reply) => {
    const session = await findSession(request, { create: true });
    if (!session) return reply.code(404).send(apiError('NOT_FOUND', 'Sessão do mapa não encontrada'));
    return serializeSession(session);
  });

  app.post('/api/v1/campaigns/:campaignId/map/sessions', { preHandler: [authenticate, requireCampaign, requireGm, requireMapEditor, requireCsrf] }, async (request, reply) => {
    const parsed = sessionInput.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_INPUT', 'Sessão inválida', parsed.error.flatten()));
    const session = await prisma.mapSession.create({ data: { campaignId: request.campaign.id, createdByUserId: request.auth.user.id, ...(parsed.data.label ? { label: parsed.data.label } : {}) }, include: sessionInclude });
    return reply.code(201).send(serializeSession(session));
  });

  app.post('/api/v1/campaigns/:campaignId/map/sessions/:sessionId/end', { preHandler: [authenticate, requireCampaign, requireGm, requireMapEditor, requireCsrf] }, async (request, reply) => {
    const session = await prisma.mapSession.findFirst({ where: { id: request.params.sessionId, campaignId: request.campaign.id } });
    if (!session) return reply.code(404).send(apiError('NOT_FOUND', 'Sessão do mapa não encontrada'));
    if (session.endedAt) return serializeSession({ ...session, createdBy: undefined });
    const ended = await prisma.mapSession.update({ where: { id: session.id }, data: { endedAt: new Date() }, include: sessionInclude });
    return serializeSession(ended);
  });

  async function listPositions(request, reply) {
    const query = sessionQuery.safeParse(request.query ?? {});
    if (!query.success) return reply.code(400).send(apiError('INVALID_QUERY', 'Sessão inválida', query.error.flatten()));
    const session = await findSession(request, { create: true, sessionId: query.data.sessionId });
    if (!session) return reply.code(404).send(apiError('NOT_FOUND', 'Sessão do mapa não encontrada'));
    const rows = await prisma.mapPosition.findMany({ where: { sessionId: session.id }, orderBy: [{ ownerType: 'asc' }, { ownerId: 'asc' }], include: { updatedBy: { select: userSelect } } });
    const positions = await serializePositions(rows, request);
    return { session: serializeSession(session), positions, items: positions };
  }

  app.get('/api/v1/campaigns/:campaignId/map/positions', { preHandler: [authenticate, requireCampaign] }, listPositions);
  app.get('/api/v1/campaigns/:campaignId/positions', { preHandler: [authenticate, requireCampaign] }, listPositions);
  app.get('/api/v1/campaigns/:campaignId/map/sessions/:sessionId/positions', { preHandler: [authenticate, requireCampaign] }, listPositions);

  async function listHistory(request, reply) {
    const query = sessionQuery.safeParse(request.query ?? {});
    if (!query.success) return reply.code(400).send(apiError('INVALID_QUERY', 'Sessão inválida', query.error.flatten()));
    const session = await findSession(request, { create: true, sessionId: query.data.sessionId });
    if (!session) return reply.code(404).send(apiError('NOT_FOUND', 'Sessão do mapa não encontrada'));
    const rows = await prisma.mapPositionHistory.findMany({ where: { sessionId: session.id }, orderBy: [{ changedAt: 'desc' }, { id: 'desc' }] });
    const history = await serializeHistory(rows, request);
    return { session: serializeSession(session), history, items: history };
  }

  app.get('/api/v1/campaigns/:campaignId/map/history', { preHandler: [authenticate, requireCampaign] }, listHistory);
  app.get('/api/v1/campaigns/:campaignId/positions/history', { preHandler: [authenticate, requireCampaign] }, listHistory);
  app.get('/api/v1/campaigns/:campaignId/map/sessions/:sessionId/history', { preHandler: [authenticate, requireCampaign] }, listHistory);

  const moveHandler = async (request, reply) => movePosition(request, reply, request.body ?? {}, request.params ?? {});
  app.patch('/api/v1/campaigns/:campaignId/map/positions', { preHandler: [authenticate, requireCampaign, requireCsrf] }, moveHandler);
  app.post('/api/v1/campaigns/:campaignId/map/positions', { preHandler: [authenticate, requireCampaign, requireCsrf] }, moveHandler);
  app.patch('/api/v1/campaigns/:campaignId/map/positions/:markerId', { preHandler: [authenticate, requireCampaign, requireCsrf] }, moveHandler);
  app.post('/api/v1/campaigns/:campaignId/map/positions/:markerId', { preHandler: [authenticate, requireCampaign, requireCsrf] }, moveHandler);
  app.patch('/api/v1/campaigns/:campaignId/map/sessions/:sessionId/positions', { preHandler: [authenticate, requireCampaign, requireCsrf] }, moveHandler);
  app.post('/api/v1/campaigns/:campaignId/map/sessions/:sessionId/positions', { preHandler: [authenticate, requireCampaign, requireCsrf] }, moveHandler);
  app.patch('/api/v1/campaigns/:campaignId/positions', { preHandler: [authenticate, requireCampaign, requireCsrf] }, moveHandler);
  app.post('/api/v1/campaigns/:campaignId/positions', { preHandler: [authenticate, requireCampaign, requireCsrf] }, moveHandler);
  app.patch('/api/v1/campaigns/:campaignId/map/positions/:ownerType/:ownerId', { preHandler: [authenticate, requireCampaign, requireCsrf] }, moveHandler);
  app.post('/api/v1/campaigns/:campaignId/map/positions/:ownerType/:ownerId', { preHandler: [authenticate, requireCampaign, requireCsrf] }, moveHandler);
  app.patch('/api/v1/campaigns/:campaignId/positions/:ownerType/:ownerId', { preHandler: [authenticate, requireCampaign, requireCsrf] }, moveHandler);
  app.post('/api/v1/campaigns/:campaignId/positions/:ownerType/:ownerId', { preHandler: [authenticate, requireCampaign, requireCsrf] }, moveHandler);

  const undoByMarker = async (request, reply) => {
    const marker = markerInput.safeParse(request.params);
    if (!marker.success) return reply.code(400).send(apiError('INVALID_MARKER', 'Marcador inválido'));
    const allowed = await assertMarkerPermission(request, marker.data, reply);
    if (!allowed) return;
    const session = await findSession(request, { create: false, sessionId: request.query?.sessionId });
    if (!session) return reply.code(404).send(apiError('NOT_FOUND', 'Sessão do mapa não encontrada'));
    const history = await prisma.mapPositionHistory.findFirst({ where: { sessionId: session.id, ...marker.data, revertedAt: null }, orderBy: [{ changedAt: 'desc' }, { id: 'desc' }] });
    if (!history) return reply.code(404).send(apiError('NOT_FOUND', 'Nenhum movimento para desfazer'));
    return undoHistory(request, reply, history.id);
  };
  app.post('/api/v1/campaigns/:campaignId/map/history/:historyId/undo', { preHandler: [authenticate, requireCampaign, requireCsrf] }, async (request, reply) => undoHistory(request, reply, request.params.historyId));
  app.post('/api/v1/campaigns/:campaignId/map/positions/:ownerType/:ownerId/undo', { preHandler: [authenticate, requireCampaign, requireCsrf] }, undoByMarker);
  app.post('/api/v1/campaigns/:campaignId/positions/:ownerType/:ownerId/undo', { preHandler: [authenticate, requireCampaign, requireCsrf] }, undoByMarker);
}
