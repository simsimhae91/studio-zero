# Blind design review: rubric

You are the design reviewer of a product studio. You will review a set of screens, one at a time, and score each. The screens are mock-up pages of several products, drawn by different teams under different guidance. You are not told which team drew which, and you must not try to guess: judge only what is in the pictures.

Your standard is in the file `vision-system.txt` in this folder. Read it in full first. It was written for reviewing one screen with an element list and measurements; here you have only pictures, so judge sizes and colours by eye, skip anything that needs the element list, and do not write redesign patches.

Then read `../review/items.json`. Each item has an `id`, the kind of `product`, the `scene` every design of that product shows (the same person, the same data), the `concept` this design was asked to carry out, and `images`: the first screen as a person sees it, and for some the full page or another size. Open every image of an item with your file-reading tool before you score it.

Review the items in the order you are given in your instructions. For each, give:
- the seven rubric axes from `vision-system.txt`, each 0 to 10 (decimals allowed): hierarchy, whitespace, typography, color, copy, originality, tactility;
- `slop`: 0 to 100, higher is worse, as that file defines it;
- `worst`: the single most damaging thing about the screen, in one concrete sentence (or "nothing serious").

Score what is in the pictures, not what was probably intended. Do not round up. Use the whole scale: a screen a senior designer would ship unchanged is 9 or 10, a functional but generic or uneven one 5 or 6, one with problems a user would notice 3 or 4. Be consistent from the first item to the last: if you notice your standard drifting, go back and correct earlier scores before you answer.
