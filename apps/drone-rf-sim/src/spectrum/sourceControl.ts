export type SpectrumInteractionListener = () => void;

const listeners = new Set<SpectrumInteractionListener>();

export function markSpectrumInteraction(): void {
  listeners.forEach((listener) => listener());
}

export function onSpectrumInteraction(listener: SpectrumInteractionListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
