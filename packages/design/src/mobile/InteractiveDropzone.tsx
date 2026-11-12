import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { NATIVE_DRIVER, haptic, usePressScale, useReducedMotion } from './tactile.tsx';
import { mobileTokens } from './tokens.ts';

const CORNERS = ['left-3 top-3 rounded-tl-md border-l-2 border-t-2', 'right-3 top-3 rounded-tr-md border-r-2 border-t-2', 'bottom-3 left-3 rounded-bl-md border-b-2 border-l-2', 'bottom-3 right-3 rounded-br-md border-b-2 border-r-2'];

export interface InteractiveDropzoneProps {
  /** What a tap does, as the user would say it: "가릴 사진 가져오기". */
  label: string;
  /** One line under the label: what can go in, or what happens to it. */
  hint?: string;
  /** The glyph in the badge (a camera, a picture), about 28px, in the on-accent colour. */
  icon: ReactNode;
  /** Opens the picker or the camera. The zone does not pick anything itself, so it works with any source. */
  onPress: () => void;
  /** The chosen image. Once set, the zone is its preview and the tap replaces it. */
  previewUri?: string | null;
  /** What the chosen image is, for a screen reader. */
  previewLabel?: string;
  /** The tap once there is a preview: "다른 사진 고르기". */
  replaceLabel?: string;
  /** Width over height of the frame. */
  aspectRatio?: number;
  disabled?: boolean;
  className?: string;
}

/**
 * Where the user's own content comes in. It takes the place a stock illustration would otherwise fill, and
 * unlike one it does something: the whole frame is the tap target, it reads as a viewfinder (corner marks, a
 * dashed edge, a badge that says what to bring), it gives way under the thumb, and the moment something is
 * chosen it becomes a preview of that thing.
 */
export function InteractiveDropzone({ label, hint, icon, onPress, previewUri, previewLabel, replaceLabel, aspectRatio = mobileTokens.dropzone.aspectRatio, disabled, className = '' }: InteractiveDropzoneProps) {
  const press = usePressScale(mobileTokens.press.scaleLarge);
  const reduced = useReducedMotion();
  const filled = typeof previewUri === 'string' && previewUri !== '';
  // The corner marks breathe while the frame is empty: the one idle motion on the screen, and it stops once there is something to look at.
  const breath = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (filled || reduced || disabled) {
      breath.setValue(1);
      return;
    }
    const half = mobileTokens.motion.pulse / 2;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 0.4, duration: half, easing: Easing.inOut(Easing.quad), useNativeDriver: NATIVE_DRIVER }),
        Animated.timing(breath, { toValue: 1, duration: half, easing: Easing.inOut(Easing.quad), useNativeDriver: NATIVE_DRIVER }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breath, disabled, filled, reduced]);

  return (
    <Animated.View style={press.style}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={filled ? (replaceLabel ?? label) : label}
        accessibilityHint={hint}
        disabled={disabled}
        {...press.handlers}
        onPress={() => {
          haptic('light');
          onPress();
        }}
        className={`overflow-hidden border ${mobileTokens.radius.container} ${mobileTokens.surface.well} ${filled ? 'border-border' : 'border-dashed border-control-border'} active:border-accent ${disabled ? 'opacity-50' : ''} ${className}`}
        style={{ aspectRatio, borderCurve: mobileTokens.radius.curve }}
      >
        {filled ? <Image source={{ uri: previewUri }} resizeMode="cover" accessibilityLabel={previewLabel} style={StyleSheet.absoluteFill} /> : null}

        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: breath }]}>
          {CORNERS.map((corner) => (
            <View key={corner} className={`absolute h-7 w-7 border-accent ${corner}`} />
          ))}
        </Animated.View>

        {filled ? (
          replaceLabel ? (
            <View className={`absolute bottom-4 right-4 min-h-11 flex-row items-center justify-center border border-border bg-surface px-4 ${mobileTokens.radius.pill}`}>
              <Text className="font-sans text-sm font-semibold text-fg">{replaceLabel}</Text>
            </View>
          ) : null
        ) : (
          <View className="flex-1 items-center justify-center gap-3 p-8">
            <View className={`h-16 w-16 items-center justify-center bg-accent ${mobileTokens.radius.pill}`}>{icon}</View>
            <Text className="text-center font-sans text-lg font-semibold text-fg">{label}</Text>
            {hint ? <Text className="text-center font-sans text-sm text-fg-muted">{hint}</Text> : null}
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}
