export function formatDropResult(entry) {
  return `${entry.name ?? entry.id}${entry.chance ? ` (${entry.chance}%)` : ''}${entry.quantity != null ? ` x${entry.quantity}` : ''}${entry.cashValue != null ? ` · ${entry.cashValue} cash` : ''}`;
}
