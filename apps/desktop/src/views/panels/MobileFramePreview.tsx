import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** iPhone 15 Pro: a 393 x 852 pt display inside a 20 pt bezel. */
const DEVICE = { width: 433, height: 892 } as const;
export const PHONE_SCREEN = { width: 393, height: 852 } as const;

/** The scale at which a `width` x `height` box fits inside the element `ref` is put on, with a margin, never above 1. */
export function useFit(width: number, height: number, margin = 16): { ref: React.RefObject<HTMLDivElement | null>; scale: number } {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = (): void => {
      const w = el.clientWidth - margin * 2;
      const h = el.clientHeight - margin * 2;
      // A hidden pane measures zero: keep the last good scale until it is shown again.
      if (w > 0 && h > 0) setScale(Math.min(1, w / width, h / height));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [width, height, margin]);
  return { ref, scale };
}

/**
 * The preview inside an iPhone 15 Pro: the screen at its real point size, so the app lays out exactly as it will
 * on the device, and the whole phone scaled as one piece to whatever room the pane has.
 *
 * `children` is the screen (the live frame). The hardware around it is a drawing, in the dark palette whatever
 * the app's theme is, because a phone's bezel does not change with the wallpaper.
 */
export function MobileFramePreview({ label, children }: { label: string; children: ReactNode }) {
  const { ref, scale } = useFit(DEVICE.width, DEVICE.height);
  return (
    <div ref={ref} className="device-stage bg-sunken">
      <div className="relative flex-none" style={{ inlineSize: DEVICE.width * scale, blockSize: DEVICE.height * scale }}>
        <div className="device theme-dark" style={{ transform: `scale(${scale})` }} role="group" aria-label={label}>
          <svg className="device-body" viewBox="0 0 433 892" aria-hidden>
            {/* Action button and volume keys on the left edge, the side button on the right. */}
            <rect x="0" y="168" width="5" height="32" rx="2" className="fill-control-border" />
            <rect x="0" y="232" width="5" height="60" rx="2" className="fill-control-border" />
            <rect x="0" y="308" width="5" height="60" rx="2" className="fill-control-border" />
            <rect x="428" y="264" width="5" height="96" rx="2" className="fill-control-border" />
            {/* The titanium band, then the black border of the glass. */}
            <rect x="3" y="0" width="427" height="892" rx="68" className="fill-control-border" />
            <rect x="6" y="3" width="421" height="886" rx="65" className="fill-border" />
            <rect x="10" y="7" width="413" height="878" rx="61" className="fill-sunken" />
          </svg>
          {children}
          <svg className="device-overlay" viewBox="0 0 433 892" aria-hidden>
            {/* Dynamic Island and the home indicator sit over the content, as they do on the device. */}
            <rect x="153.5" y="31" width="126" height="37" rx="18.5" className="fill-sunken" />
            <rect x="149.5" y="859" width="134" height="5" rx="2.5" className="fill-fg-muted" />
          </svg>
        </div>
      </div>
    </div>
  );
}

/** A frame at a fixed logical size (a tablet), scaled down as one piece to fit the pane. */
export function ScaledFrame({ width, height, children }: { width: number; height: number; children: ReactNode }) {
  const { ref, scale } = useFit(width, height);
  return (
    <div ref={ref} className="device-stage bg-sunken">
      <div className="relative flex-none" style={{ inlineSize: width * scale, blockSize: height * scale }}>
        <div className="scaled-frame" style={{ inlineSize: width, blockSize: height, transform: `scale(${scale})` }}>
          {children}
        </div>
      </div>
    </div>
  );
}
