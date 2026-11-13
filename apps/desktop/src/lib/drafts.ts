import { useCallback, useEffect, useState } from 'react';

/**
 * What was typed and not sent, kept while the window is open: a half-written idea survives a look at another
 * page. Each field has a key (the first screen, one note). Not written to disk: a draft is not a document.
 */
const drafts = new Map<string, string>();

export function useDraft(key: string): { value: string; onChange: (text: string) => void } {
  const [value, setValue] = useState(() => drafts.get(key) ?? '');
  useEffect(() => setValue(drafts.get(key) ?? ''), [key]);
  const onChange = useCallback(
    (text: string): void => {
      if (text === '') drafts.delete(key);
      else drafts.set(key, text);
      setValue(text);
    },
    [key],
  );
  return { value, onChange };
}
