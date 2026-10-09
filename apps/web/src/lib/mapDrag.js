export const POINTER_DRAG_THRESHOLD = 5;

export function beginPointerDrag({ pointerId, clientX, clientY, ...meta }) {
  return { ...meta, pointerId, startClientX: clientX, startClientY: clientY, moved: false, preview: null };
}

export function updatePointerDrag(state, event, preview) {
  if (!state || state.pointerId !== event.pointerId) return { state, moved: false, changed: false };
  const distance = Math.hypot(event.clientX - state.startClientX, event.clientY - state.startClientY);
  if (!state.moved && distance < POINTER_DRAG_THRESHOLD) return { state, moved: false, changed: false };
  return { state: { ...state, moved: true, preview }, moved: true, changed: true };
}

export function finishPointerDrag(state, pointerId) {
  if (!state || state.pointerId !== pointerId) return { state, commit: null, accepted: false };
  return { state: null, commit: state.moved ? state.preview : null, accepted: true };
}

export function cancelPointerDrag() {
  return null;
}
