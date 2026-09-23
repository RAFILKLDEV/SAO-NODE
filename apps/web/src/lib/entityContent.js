export function hasRenderableContent(value) {
  if (value == null) return false;
  if (Array.isArray(value)) {
    return value.some((entry) => {
      if (entry == null || entry.available === false || entry.broken === true) return false;
      if (typeof entry === 'object' && !Array.isArray(entry)) {
        const technicalKeys = new Set([
          'id', 'type', 'role', 'key', 'kind', 'available', 'broken',
          'targetType', 'targetDomainId', 'connectionId', 'objectiveId', 'componentId'
        ]);
        const meaningfulEntries = Object.entries(entry).filter(([key]) => !technicalKeys.has(key));
        if (!meaningfulEntries.length) return false;
        return meaningfulEntries.some(([, nested]) => hasRenderableContent(nested));
      }
      return String(entry ?? '').trim() !== '';
    });
  }
  if (typeof value === 'object') {
    const empty = (candidate) =>
      candidate == null ||
      candidate === '' ||
      (Array.isArray(candidate) && !candidate.length) ||
      (typeof candidate === 'object' && !Array.isArray(candidate) && !Object.keys(candidate).length);

    if (value.available === false || value.broken === true) return false;
    if (empty(value)) return false;
    const technicalKeys = new Set([
      'id', 'type', 'role', 'key', 'kind', 'available', 'broken',
      'targetType', 'targetDomainId', 'connectionId', 'objectiveId', 'componentId'
    ]);
    const meaningfulEntries = Object.entries(value).filter(([key]) => !technicalKeys.has(key));
    if (!meaningfulEntries.length) return false;
    return meaningfulEntries.some(([, entry]) => {
      if (typeof entry === 'object') return hasRenderableContent(entry);
      return String(entry ?? '').trim() !== '';
    });
  }
  return String(value).trim() !== '';
}
