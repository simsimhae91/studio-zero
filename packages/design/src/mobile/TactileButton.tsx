import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, Text, View, type PressableProps } from 'react-native';
import { NATIVE_DRIVER, Tactile, useReducedMotion, type Haptic } from './tactile.tsx';
import { mobileTokens } from './tokens.ts';

type Variant = 'primary' | 'secondary' | 'quiet' | 'danger';

const SURFACE: Record<Variant, string> = {
  primary: 'border border-accent bg-accent',
  secondary: 'border border-control-border bg-surface active:bg-sunken',
  quiet: 'border border-transparent bg-transparent active:bg-sunken',
  danger: 'border border-danger bg-surface active:bg-sunken',
};
const INK: Record<Variant, string> = { primary: 'text-on-accent', secondary: 'text-fg', quiet: 'text-accent', danger: 'text-danger' };
const RING: Record<Variant, string> = { primary: 'border-on-accent', secondary: 'border-fg', quiet: 'border-accent', danger: 'border-danger' };

const SIZE = {
  md: { box: 'min-h-12 px-5', text: 'text-base' },
  lg: { box: 'min-h-14 px-6', text: 'text-lg' },
} as const;

export interface TactileButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  /** What pressing it does, as the user would say it: "가릴 사진 가져오기". A string is set in the kit's type; pass an element to set it yourself. */
  label: ReactNode;
  variant?: Variant;
  /** `pill` for the actions of a dock; `squircle` where a button sits among cards and should share their corners. */
  shape?: 'pill' | 'squircle';
  size?: keyof typeof SIZE;
  /** A leading icon, about 20px, already in the colour of the label. */
  icon?: ReactNode;
  /** The action is under way: the icon becomes a spinner and the button stops taking presses. */
  busy?: boolean;
  grow?: boolean;
  haptic?: Haptic;
  className?: string;
}

/**
 * The button. One primary per screen, in the dock; everything else is secondary or quiet. Never shorter than a
 * thumb needs, and it answers a press with movement and a tick instead of only doing the thing.
 */
export function TactileButton({ label, variant = 'secondary', shape = 'pill', size = 'md', icon, busy = false, disabled, grow, haptic, className = '', ...rest }: TactileButtonProps) {
  const inert = Boolean(disabled) || busy;
  const radius = shape === 'pill' ? mobileTokens.radius.pill : mobileTokens.radius.container;
  return (
    <Tactile
      {...rest}
      grow={grow}
      haptic={haptic ?? (variant === 'primary' ? 'light' : 'selection')}
      disabled={inert}
      accessibilityState={{ disabled: inert, busy }}
      aria-busy={busy}
      className={`flex-row items-center justify-center gap-2 ${radius} ${SIZE[size].box} ${SURFACE[variant]} ${inert && !busy ? 'opacity-50' : ''} ${className}`}
      style={shape === 'squircle' ? { borderCurve: mobileTokens.radius.curve } : undefined}
    >
      {busy ? <Spinner ring={RING[variant]} /> : icon}
      {typeof label === 'string' ? <Text className={`font-sans font-semibold ${SIZE[size].text} ${INK[variant]}`}>{label}</Text> : label}
    </Tactile>
  );
}

/** A turning ring in the label's colour, drawn with borders so it follows the theme like everything else. */
function Spinner({ ring }: { ring: string }) {
  const turn = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(Animated.timing(turn, { toValue: 1, duration: 800, easing: Easing.linear, useNativeDriver: NATIVE_DRIVER }));
    loop.start();
    return () => loop.stop();
  }, [reduced, turn]);
  return (
    <Animated.View style={{ transform: [{ rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }}>
      <View className={`h-5 w-5 rounded-full border-2 border-t-transparent ${ring}`} />
    </Animated.View>
  );
}
