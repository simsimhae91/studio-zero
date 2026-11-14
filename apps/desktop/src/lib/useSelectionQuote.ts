import { useEffect, useRef, type RefObject } from 'react';

/**
 * A passage chosen inside `container`, by mouse, keyboard or a long press: `onSelect` gets the selection and its
 * trimmed text each time it changes to something non-empty that starts inside the container. A selection that
 * collapses or moves elsewhere is not reported, so the last passage chosen stays chosen until it is cleared.
 */
export function useSelectionQuote(container: RefObject<HTMLElement | null>, enabled: boolean, onSelect: (selection: Selection, text: string) => void): void {
  const latest = useRef(onSelect);
  latest.current = onSelect;
  useEffect(() => {
    if (!enabled) return;
    const onChange = (): void => {
      const selection = document.getSelection();
      const text = selection?.toString().trim() ?? '';
      if (text === '' || !container.current || !selection?.anchorNode || !container.current.contains(selection.anchorNode)) return;
      latest.current(selection, text);
    };
    document.addEventListener('selectionchange', onChange);
    return () => document.removeEventListener('selectionchange', onChange);
  }, [container, enabled]);
}
