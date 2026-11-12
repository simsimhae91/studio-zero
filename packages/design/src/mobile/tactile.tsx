import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Platform, Pressable, type GestureResponderEvent, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { mobileTokens } from './tokens.ts';

/** react-native-web has only the JS driver; asking it for the native one logs a warning on every animation. */
export const NATIVE_DRIVER = Platform.OS !== 'web';

/** Whether the person has asked the system for less motion. Springs and loops in this kit stand still when they have. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled().then(
      (on) => live && setReduced(on),
      () => undefined,
    );
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      live = false;
      subscription.remove();
    };
  }, []);
  return reduced;
}

export type Haptic = 'selection' | 'light' | 'medium' | 'success' | 'warning' | 'none';

/** A tick under the thumb. Nothing on the web, and never a reason for a press to fail. */
export function haptic(kind: Haptic = 'selection'): void {
  if (Platform.OS === 'web' || kind === 'none') return;
  const fired =
    kind === 'selection'
      ? Haptics.selectionAsync()
      : kind === 'success'
        ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        : kind === 'warning'
          ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
          : Haptics.impactAsync(kind === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
  fired.catch(() => undefined);
}

/**
 * Press feedback as physics: the surface gives way under the thumb and springs back when it lifts. Spread
 * `handlers` on a Pressable and put `style` on an Animated.View around it.
 */
export function usePressScale(to: number = mobileTokens.press.scale): { style: { transform: { scale: Animated.Value }[] }; handlers: { onPressIn: () => void; onPressOut: () => void } } {
  const scale = useRef(new Animated.Value(1)).current;
  const reduced = useReducedMotion();
  const spring = (toValue: number): void => Animated.spring(scale, { toValue, ...mobileTokens.spring.press, useNativeDriver: NATIVE_DRIVER }).start();
  return {
    style: { transform: [{ scale }] },
    handlers: { onPressIn: () => (reduced ? undefined : spring(to)), onPressOut: () => spring(1) },
  };
}

export interface TactileProps extends Omit<PressableProps, 'children' | 'style'> {
  children: ReactNode;
  /** Utility classes for the pressable surface: its shape, colour and padding. */
  className?: string;
  /** Takes the free space of a row or column it sits in (`flex: 1`). */
  grow?: boolean;
  haptic?: Haptic;
  /** How far it gives way when pressed. Use `mobileTokens.press.scaleLarge` for a surface wider than a button. */
  scaleTo?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Anything that can be pressed. A Pressable that answers the way a physical control does: it shrinks under the
 * thumb on a spring, ticks, and returns. Build every custom control on this instead of a bare Pressable, so no
 * tappable thing on a screen is inert.
 */
export function Tactile({ children, className = '', grow = false, haptic: kind = 'selection', scaleTo, style, onPress, onPressIn, onPressOut, ...rest }: TactileProps) {
  const press = usePressScale(scaleTo);
  return (
    <Animated.View style={[press.style, grow ? { flex: 1 } : null]}>
      <Pressable
        accessibilityRole="button"
        {...rest}
        className={className}
        style={style}
        onPressIn={(e: GestureResponderEvent) => {
          press.handlers.onPressIn();
          onPressIn?.(e);
        }}
        onPressOut={(e: GestureResponderEvent) => {
          press.handlers.onPressOut();
          onPressOut?.(e);
        }}
        onPress={(e: GestureResponderEvent) => {
          haptic(kind);
          onPress?.(e);
        }}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}
