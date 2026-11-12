import { createContext, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform, ScrollView, Text, View, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Tactile } from './tactile.tsx';
import { mobileTokens } from './tokens.ts';

/** Bars sit over the content. Where the platform can blur what is behind them they are glass; elsewhere, an opaque surface. */
const BAR = Platform.OS === 'web' ? mobileTokens.surface.barFrosted : mobileTokens.surface.bar;
/** One column, phone-wide. On a tablet the screen stays a phone-shaped column in the middle instead of stretching. */
const COLUMN = 'w-full max-w-2xl self-center';

interface Shell {
  header: number;
  dock: number;
  setHeader: (height: number) => void;
  setDock: (height: number) => void;
}
const ShellContext = createContext<Shell | null>(null);

function useShell(part: string): Shell {
  const shell = useContext(ShellContext);
  if (!shell) throw new Error(`MobileShell.${part} must be inside <MobileShell>`);
  return shell;
}

/**
 * The frame of a mobile screen, in three zones:
 *
 *   MobileShell.Header      the app bar, under the status bar: where am I, how do I leave
 *   MobileShell.Content     the work: a canvas, a viewfinder, a list
 *   MobileShell.BottomDock  what I do next, within reach of a thumb
 *
 * The bars float over the content and the content knows their height, so what scrolls passes under them and
 * nothing is ever hidden behind one.
 */
function Frame({ children, className = '' }: { children: ReactNode; className?: string }) {
  const [header, setHeader] = useState(0);
  const [dock, setDock] = useState(0);
  const shell = useMemo(() => ({ header, dock, setHeader, setDock }), [header, dock]);
  return (
    <ShellContext.Provider value={shell}>
      <View className={`flex-1 ${mobileTokens.surface.page} ${className}`}>{children}</View>
    </ShellContext.Provider>
  );
}

export interface HeaderProps {
  /** Short: the name of the screen or the product, not a sentence. A string is set in the kit's type; pass an element to set it yourself. */
  title: ReactNode;
  /** Leading slot: back, close or a menu. One `MobileShell.Action`. */
  left?: ReactNode;
  /** Trailing slot: the one secondary action of this screen. */
  right?: ReactNode;
  className?: string;
}

function Header({ title, left, right, className = '' }: HeaderProps) {
  const shell = useShell('Header');
  const insets = useSafeAreaInsets();
  const { setHeader } = shell;
  // Known before the first layout, so content does not start under the bar and jump.
  useLayoutEffect(() => {
    setHeader(insets.top + mobileTokens.bar.height);
    return () => setHeader(0);
  }, [insets.top, setHeader]);
  return (
    <View
      onLayout={(e: LayoutChangeEvent) => setHeader(e.nativeEvent.layout.height)}
      className={`absolute inset-x-0 top-0 z-10 border-b border-border ${BAR} ${className}`}
      style={{ paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }}
    >
      <View className={`${COLUMN} flex-row items-center gap-2 px-2`} style={{ height: mobileTokens.bar.height }}>
        <View className="min-w-11 flex-row items-center justify-start">{left}</View>
        <View className="flex-1 items-center">
          {typeof title === 'string' ? (
            <Text accessibilityRole="header" aria-level={1} numberOfLines={1} className="font-sans text-lg font-semibold text-fg">
              {title}
            </Text>
          ) : (
            title
          )}
        </View>
        <View className="min-w-11 flex-row items-center justify-end">{right}</View>
      </View>
    </View>
  );
}

export interface ActionProps {
  /** An icon, about 22px. */
  icon: ReactNode;
  /** What it does, for a screen reader: "뒤로", "설정 열기". */
  label: string;
  onPress: () => void;
  disabled?: boolean;
}

/** An icon action in the app bar: a full thumb target around a small glyph. */
function Action({ icon, label, onPress, disabled }: ActionProps) {
  return (
    <Tactile accessibilityLabel={label} aria-label={label} onPress={onPress} disabled={disabled} className={`h-11 w-11 items-center justify-center ${mobileTokens.radius.pill} active:bg-sunken ${disabled ? 'opacity-50' : ''}`}>
      {icon}
    </Tactile>
  );
}

export interface ContentProps {
  children: ReactNode;
  /** False for a screen that is one fixed canvas (a camera, an editor): the content fills the space between the bars and does not scroll. */
  scroll?: boolean;
  className?: string;
}

function Content({ children, scroll = true, className = '' }: ContentProps) {
  const shell = useShell('Content');
  const insets = useSafeAreaInsets();
  const top = shell.header > 0 ? shell.header : insets.top;
  const bottom = shell.dock > 0 ? shell.dock : Math.max(insets.bottom, mobileTokens.safeArea.minBottom);
  if (!scroll) {
    return (
      <View className={`flex-1 ${COLUMN} ${className}`} style={{ paddingTop: top, paddingBottom: bottom }}>
        {children}
      </View>
    );
  }
  return (
    <ScrollView
      className="flex-1"
      // The page itself must not rubber-band or chain its scroll to the browser on the web target.
      style={Platform.OS === 'web' ? ({ overscrollBehavior: 'contain' } as ViewStyle) : undefined}
      contentContainerClassName={`${COLUMN} gap-6 px-4 ${className}`}
      contentContainerStyle={{ flexGrow: 1, paddingTop: top + mobileTokens.space.gutter, paddingBottom: bottom + mobileTokens.space.section }}
      scrollIndicatorInsets={{ top: shell.header, bottom: shell.dock }}
      contentInsetAdjustmentBehavior="never"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      alwaysBounceVertical
      overScrollMode="always"
    >
      {children}
    </ScrollView>
  );
}

export interface BottomDockProps {
  children: ReactNode;
  /** A card that floats above the content with a margin around it, instead of a bar across the bottom edge. */
  floating?: boolean;
  className?: string;
}

/** The actions of this screen: the primary one, and at most one beside it. Clear of the home indicator. */
function BottomDock({ children, floating = false, className = '' }: BottomDockProps) {
  const shell = useShell('BottomDock');
  const insets = useSafeAreaInsets();
  const { setDock } = shell;
  useLayoutEffect(() => () => setDock(0), [setDock]);
  const bottom = Math.max(insets.bottom, mobileTokens.safeArea.minBottom);
  return (
    <View
      onLayout={(e: LayoutChangeEvent) => setDock(e.nativeEvent.layout.height)}
      className={`absolute inset-x-0 bottom-0 z-10 ${floating ? 'px-4' : `border-t border-border ${BAR}`}`}
      style={{ paddingBottom: bottom, paddingLeft: insets.left, paddingRight: insets.right }}
    >
      <View
        className={`${COLUMN} gap-3 ${floating ? `${mobileTokens.radius.container} border border-border p-3 shadow-md ${BAR}` : 'px-4 pt-3'} ${className}`}
        style={floating ? { borderCurve: mobileTokens.radius.curve } : undefined}
      >
        {children}
      </View>
    </View>
  );
}

export const MobileShell = Object.assign(Frame, { Header, Action, Content, BottomDock });
