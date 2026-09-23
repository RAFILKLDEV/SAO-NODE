function normalizeDate(value) {
  if (value == null || value === '') return 0;
  const parsed = new Date(value);
  const numeric = Number(parsed);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function resolveEntitySeenAt(lastSeenAt) {
  if (lastSeenAt == null || lastSeenAt === '') return 0;
  if (typeof lastSeenAt === 'number' && Number.isFinite(lastSeenAt)) return lastSeenAt;
  const numeric = Number(lastSeenAt);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = new Date(lastSeenAt);
  const timestamp = Number(parsed);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function getEntityChangeState(entity, lastSeenAt, grantedAt = 0) {
  if (!entity) return null;
  const createdAt = normalizeDate(entity.createdAt ?? 0);
  const updatedAt = normalizeDate(entity.updatedAt ?? entity.createdAt ?? 0);
  const seenAt = resolveEntitySeenAt(lastSeenAt);
  const permissionActivityAt = resolveEntitySeenAt(grantedAt);

  const activityAt = Math.max(updatedAt, createdAt, permissionActivityAt);

  if (!createdAt && !updatedAt && !permissionActivityAt) return null;
  if (seenAt <= 0) {
    if (activityAt > createdAt) {
      return { kind: 'edited', timestamp: activityAt, label: 'Editado' };
    }
    if (createdAt > 0) {
      return { kind: 'new', timestamp: createdAt, label: 'Novo' };
    }
    return null;
  }
  if (createdAt > seenAt) {
    return { kind: 'new', timestamp: createdAt, label: 'Novo' };
  }
  if (activityAt > seenAt && activityAt > createdAt) {
    return { kind: 'edited', timestamp: activityAt, label: 'Editado' };
  }
  return null;
}

export function collectPermissionChangeEntities(payload) {
  if (!payload) return [];
  const normalizeEntry = (entry) => {
    if (!entry || typeof entry.entityType !== 'string') return null;
    const entityId = entry.entityId ?? entry.entityDomainId;
    if (typeof entityId !== 'string' || !entityId) return null;
    return { entityType: entry.entityType, entityId };
  };

  if (Array.isArray(payload.entities) && payload.entities.length) {
    return payload.entities
      .map(normalizeEntry)
      .filter(Boolean);
  }
  const entityId = payload.entityId ?? payload.entityDomainId;
  if (payload.entityType && entityId) {
    return [{ entityType: payload.entityType, entityId }];
  }
  return [];
}

export function getEntityActivityStorageKey({ campaignId, type, entityId }) {
  return `sao-entity-activity:${campaignId}:${type}:${entityId}`;
}

export function readEntityActivityAt({ campaignId, type, entityId }) {
  if (typeof window === 'undefined') return 0;
  const key = getEntityActivityStorageKey({ campaignId, type, entityId });
  const rawValue = window.localStorage.getItem(key);
  if (!rawValue) {
    const legacyKey = `sao-entity-granted:${campaignId}:${type}:${entityId}`;
    return resolveEntitySeenAt(window.localStorage.getItem(legacyKey));
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (parsed && typeof parsed === 'object') {
      return resolveEntitySeenAt(parsed.activityAt ?? parsed.grantedAt ?? parsed.timestamp ?? 0);
    }
  } catch {
    // fall through to legacy plain timestamp parsing below
  }

  return resolveEntitySeenAt(rawValue);
}

export function setEntityActivityAt({ campaignId, type, entityId, at = Date.now(), reason = 'permission' }) {
  if (typeof window === 'undefined' || !campaignId || !type || !entityId) return;
  const key = getEntityActivityStorageKey({ campaignId, type, entityId });
  const previous = readEntityActivityAt({ campaignId, type, entityId });
  const nextAt = Number(at) || Date.now();
  if (nextAt <= previous) return;
  const payload = { activityAt: nextAt, reason, updatedAt: nextAt };
  window.localStorage.setItem(key, JSON.stringify(payload));
  const legacyKey = `sao-entity-granted:${campaignId}:${type}:${entityId}`;
  if (window.localStorage.getItem(legacyKey) !== String(nextAt)) {
    window.localStorage.setItem(legacyKey, String(nextAt));
  }
}

export function getEntitySeenStorageKey({ campaignId, type, entityId }) {
  return `sao-entity-seen:${campaignId}:${type}:${entityId}`;
}

export function readEntitySeenAt({ campaignId, type, entityId }) {
  if (typeof window === 'undefined') return 0;
  const key = getEntitySeenStorageKey({ campaignId, type, entityId });
  const rawValue = window.localStorage.getItem(key);
  return resolveEntitySeenAt(rawValue);
}

export function markEntitySeen({ campaignId, type, entityId }) {
  if (typeof window === 'undefined' || !campaignId || !type || !entityId) return;
  const key = getEntitySeenStorageKey({ campaignId, type, entityId });
  const timestamp = Date.now();
  const previous = readEntitySeenAt({ campaignId, type, entityId });
  if (timestamp > previous) {
    window.localStorage.setItem(key, String(timestamp));
  }
}
