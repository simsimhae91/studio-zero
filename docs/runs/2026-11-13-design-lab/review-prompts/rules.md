# Blind design review: which rules does each screen break

You will check a set of screens against a written design handbook. The screens are mock-up pages of several products, drawn by different teams. Some teams were given this handbook and some were not; you are not told which, and you must not try to guess. Report only what is in the pictures.

Read the two handbooks in this folder in full first: `handbook-mobile.txt` (for phone apps) and `handbook-web.txt` (for web products). Each rule has an id such as T3, C2, M5, P4 or A3.

Then read `../review/items.json`. Each item has an `id`, a `template` (`mobile-expo` is a phone app and is held to the mobile handbook; anything else is a web product and is held to the web handbook; for a web product decide from the pictures whether the screen is a page or an app screen, and apply the P rules or the A rules accordingly), the `scene`, the `concept`, and `images`. Open every image of an item with your file-reading tool before you judge it.

For each item, in the order you are given, list in `broken` the ids of the rules the screen clearly breaks. A rule is clearly broken only when the violation is visible in the pictures and you could point to it. Leave out rules that a still picture cannot show (motion, dark mode, keyboard focus, large-text behaviour, what happens after a press) and rules about choosing a palette (C8). List at most eight, the most serious first. In `note`, say in one sentence what the most serious violation is and where on the screen (or "none seen").

Be strict and even-handed: the same violation counts the same on every screen, whoever drew it.
