import { useEffect, useState } from 'react';
import { useStudio } from '../lib/studio.tsx';

/** A picture the daemon made (a capture of a screen, the film of a walk), loaded by its artifact id. Never anything a page could run. */
export function ArtifactImage({ artifactId, alt, className }: { artifactId: string; alt: string; className: string }) {
  const { backend } = useStudio();
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    setSrc(null);
    let stale = false;
    void backend.artifactUrl(artifactId).then(
      (url) => !stale && setSrc(url),
      () => undefined,
    );
    return () => {
      stale = true;
    };
  }, [backend, artifactId]);
  return src ? <img src={src} alt={alt} className={`block h-auto ${className}`} /> : <p className="py-6 text-sm text-fg-muted">그림을 불러오는 중입니다.</p>;
}
