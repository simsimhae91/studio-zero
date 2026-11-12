import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Modal, PanResponder, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NATIVE_DRIVER, useReducedMotion } from './tactile.tsx';
import { mobileTokens } from './tokens.ts';

export interface BottomSheetProps {
  open: boolean;
  /** Asked for by the scrim, a downward drag, the back button or Escape. The owner of `open` decides. */
  onClose: () => void;
  /** What this sheet is for, in a few words. Shown at its top and announced when it opens. */
  title: string;
  children: ReactNode;
  /** The scrim's name for a screen reader: "닫기". */
  closeLabel: string;
  className?: string;
}

/**
 * A drawer from the bottom edge for what does not belong on the screen itself: secondary actions, settings, the
 * options of a tool. It rises on a spring, follows the thumb when dragged by its top, and lets go when dragged
 * far enough or flicked. The screen behind stays where it was, dimmed, so closing the sheet is going back.
 */
export function BottomSheet({ open, onClose, title, children, closeLabel, className = '' }: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const { height: screen } = useWindowDimensions();
  // Stays mounted through the closing motion, then leaves the tree.
  const [mounted, setMounted] = useState(open);
  const offset = useRef(new Animated.Value(screen)).current;

  useEffect(() => {
    if (open) {
      setMounted(true);
      if (reduced) offset.setValue(0);
      else Animated.spring(offset, { toValue: 0, ...mobileTokens.spring.sheet, useNativeDriver: NATIVE_DRIVER }).start();
      return;
    }
    if (reduced) {
      offset.setValue(screen);
      setMounted(false);
      return;
    }
    Animated.timing(offset, { toValue: screen, duration: mobileTokens.motion.base, easing: Easing.in(Easing.cubic), useNativeDriver: NATIVE_DRIVER }).start(({ finished }) => finished && setMounted(false));
  }, [offset, open, reduced, screen]);

  const drag = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_e, g) => g.dy > 4 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderMove: (_e, g) => offset.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_e, g) => {
          if (g.dy > mobileTokens.sheet.dismissDistance || g.vy > mobileTokens.sheet.dismissVelocity) onClose();
          else Animated.spring(offset, { toValue: 0, ...mobileTokens.spring.sheet, useNativeDriver: NATIVE_DRIVER }).start();
        },
        onPanResponderTerminate: () => Animated.spring(offset, { toValue: 0, ...mobileTokens.spring.sheet, useNativeDriver: NATIVE_DRIVER }).start(),
      }),
    [offset, onClose],
  );

  // The veil thins as the sheet is pulled down, so the drag reads as uncovering the screen.
  const veil = offset.interpolate({ inputRange: [0, Math.max(1, screen * 0.6)], outputRange: [mobileTokens.blur.veilOpacity, 0], extrapolate: 'clamp' });

  return (
    <Modal visible={mounted} transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <View className="flex-1 justify-end">
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: veil }]}>
          <Pressable accessibilityRole="button" accessibilityLabel={closeLabel} aria-label={closeLabel} onPress={onClose} className={`flex-1 ${mobileTokens.surface.veil}`} />
        </Animated.View>

        <Animated.View style={{ transform: [{ translateY: offset }] }}>
          <View
            role="dialog"
            aria-modal
            aria-label={title}
            accessibilityViewIsModal
            className={`w-full max-w-2xl self-center border border-border bg-surface shadow-md ${mobileTokens.radius.sheet} ${className}`}
            style={{ paddingBottom: Math.max(insets.bottom, mobileTokens.space.gutter), borderCurve: mobileTokens.radius.curve }}
          >
            {/* The grip and the title are the handle: the whole strip drags, not only the small bar. */}
            <View {...drag.panHandlers} className="gap-3 px-4 pb-3 pt-2">
              <View className={`h-1 w-10 self-center bg-control-border ${mobileTokens.radius.pill}`} />
              <Text accessibilityRole="header" className="font-sans text-lg font-semibold text-fg">
                {title}
              </Text>
            </View>
            <View className="gap-3 px-4">{children}</View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}
