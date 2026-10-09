export const PIN_COLORS = {
  region: '#8b5cf6',
  location: '#2563eb',
  npc: '#16a34a',
  quest: '#eab308',
  monster: '#dc2626',
  item: '#f97316'
};

export function pinColor(pinOrType) {
  const type = typeof pinOrType === 'string' ? pinOrType : (pinOrType?.pinType ?? pinOrType?.type);
  return PIN_COLORS[type] ?? PIN_COLORS.location;
}

export function calibrateScale(start, end, distanceKm, imageWidth, imageHeight) {
  const pixels = Math.hypot((end.x - start.x) * imageWidth, (end.y - start.y) * imageHeight);
  if (!Number.isFinite(pixels) || pixels <= 0 || !Number.isFinite(distanceKm) || distanceKm <= 0) return null;
  return { startX: start.x, startY: start.y, endX: end.x, endY: end.y, distanceKm, imageWidth, imageHeight, pixelLength: pixels, kmPerPixel: distanceKm / pixels };
}

export function measureDistance(points, scale) {
  if (!scale || !Array.isArray(points) || points.length < 2) return null;
  let pixels = 0;
  for (let index = 1; index < points.length; index += 1) pixels += Math.hypot((points[index].x - points[index - 1].x) * scale.imageWidth, (points[index].y - points[index - 1].y) * scale.imageHeight);
  return pixels * scale.kmPerPixel;
}

// A barra ocupa uma fração da imagem inteira; o valor e a largura usam a mesma escala.
export function scaleBar(scale, targetFraction = 0.18) {
  const widthKm = scale?.imageWidth * scale?.kmPerPixel;
  if (!Number.isFinite(widthKm) || widthKm <= 0) return null;
  const targetKm = widthKm * targetFraction;
  const magnitude = 10 ** Math.floor(Math.log10(targetKm));
  const distanceKm = [1, 2, 5].map((step) => step * magnitude).filter((value) => value <= targetKm).at(-1) ?? magnitude;
  return { distanceKm, widthPercent: distanceKm / widthKm * 100 };
}

export function simplifyBoundary(points, tolerance = 0.004) {
  if (points.length < 3) return points.slice();
  const first = points[0]; const last = points.at(-1);
  const dx = last.x - first.x; const dy = last.y - first.y;
  const length = dx * dx + dy * dy;
  let farthest = 0; let distance = tolerance * tolerance;
  for (let i = 1; i < points.length - 1; i += 1) {
    const point = points[i];
    const t = length ? Math.max(0, Math.min(1, ((point.x - first.x) * dx + (point.y - first.y) * dy) / length)) : 0;
    const squared = (point.x - first.x - t * dx) ** 2 + (point.y - first.y - t * dy) ** 2;
    if (squared > distance) { distance = squared; farthest = i; }
  }
  if (!farthest) return [first, last];
  return [...simplifyBoundary(points.slice(0, farthest + 1), tolerance).slice(0, -1), ...simplifyBoundary(points.slice(farthest), tolerance)];
}

export function midpoint(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

export function insertSegmentPoint(points, segmentIndex) {
  if (!Array.isArray(points) || segmentIndex < 0 || segmentIndex >= points.length - 1) return points ?? [];
  const next = points.slice(); next.splice(segmentIndex + 1, 0, midpoint(points[segmentIndex], points[segmentIndex + 1])); return next;
}
