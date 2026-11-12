# Mobile kit

Put here by Studio Zero. These are the parts a phone screen is made of, built on this project's own theme, so a
screen starts as an app and not as a web page in a phone-sized frame.

It needs what an Expo app already has: `react-native`, `react-native-safe-area-context`, `expo-haptics`, and
NativeWind for the `className` prop. Nothing else.

## Setup

1. Install what is missing: `npx expo install react-native-safe-area-context expo-haptics`.
2. Wrap the app once in `<SafeAreaProvider>` (the root layout).
3. Add an import alias for this folder: `"@kit/*": ["./.studio-zero/mobile-kit/*"]` under `paths` in
   `tsconfig.json`. Expo's bundler reads it from there.
4. Let Tailwind see the class names used here. In the global stylesheet, after the theme import:
   `@source "../.studio-zero/mobile-kit";` (the path is relative to the stylesheet).

Everything is styled with the theme's tokens (`bg-surface`, `text-fg-muted`, `border-border`, `rounded-lg`),
so it follows the project's palette and corners, in light and dark. The files are the project's from here on:
change them when the product needs something they do not do.

## A screen has three zones

```tsx
import { useState } from 'react';
import { BottomSheet, InteractiveDropzone, MobileShell, TactileButton } from '@kit/index';

export default function Home() {
  const [photo, setPhoto] = useState<string | null>(null);
  const [options, setOptions] = useState(false);
  return (
    <MobileShell>
      <MobileShell.Header title="가림" right={<MobileShell.Action icon={<SlidersIcon />} label="가리기 설정" onPress={() => setOptions(true)} />} />

      <MobileShell.Content>
        <InteractiveDropzone
          label="가릴 사진 가져오기"
          hint="주소와 위치정보를 찾아 가려요"
          icon={<ImageIcon />}
          previewUri={photo}
          replaceLabel="다른 사진 고르기"
          onPress={pickPhoto}
        />
      </MobileShell.Content>

      <MobileShell.BottomDock>
        <TactileButton variant="primary" size="lg" label="가리고 공유하기" disabled={!photo} onPress={share} />
      </MobileShell.BottomDock>

      <BottomSheet open={options} onClose={() => setOptions(false)} title="가리기 설정" closeLabel="닫기">
        {/* rows of options */}
      </BottomSheet>
    </MobileShell>
  );
}
```

**`MobileShell.Header`** is the app bar: a compact title under the status bar, one leading action (back, close)
and one trailing action. It is not a hero. A sentence that explains the product does not go here or anywhere
else on a working screen.

**`MobileShell.Content`** is where the work is: a canvas, a viewfinder, a list. It scrolls under the two bars
and pads itself by their height. Pass `scroll={false}` for a screen that is one fixed canvas.

**`MobileShell.BottomDock`** holds what the user does next: one primary `TactileButton`, at most one more
beside it. It clears the home indicator by itself. `floating` turns it into a card above the content.

## The other parts

**`InteractiveDropzone`** goes where a placeholder picture would. The whole frame is the tap target; it calls
`onPress` (open the photo library, the camera, a file picker) and shows `previewUri` as soon as there is one.
Never put a static illustration where the user's own content is about to be.

**`BottomSheet`** takes secondary actions, settings and tool options off the screen. It opens on a spring,
drags by its top, and closes on the scrim, a downward flick, the back button or Escape.

**`TactileButton`** is the button: `variant` `primary | secondary | quiet | danger`, `shape` `pill | squircle`,
`size` `md | lg`, optional `icon`, and `busy` while its action runs. Labels say what happens, in the user's
words.

**`Tactile`** is the pressable everything above is built on. Use it for any custom control (a list row, a
chip, a tile) so that it shrinks under the thumb, ticks and springs back. A bare `Pressable` with no pressed
state is a control that feels broken.

**`mobileTokens`** holds the numbers: the 44px target, gutters, the bar height, spring constants, the surface
recipes. Read from it instead of typing new values.

## What stays yours to decide

Icons (pass any element; size and colour are noted on each prop), the image picker or camera behind the
dropzone, and what a screen is for. On iOS and Android the bars are an opaque surface; on the web target they
blur what is behind them. To blur natively, wrap the bar's content in the blur view your Expo SDK provides.
