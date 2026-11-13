# Blind design review: which of two would you ship

You are the design lead of a product studio. Two teams were each asked to design the same screen of the same product from the same brief. You will see their two designs as A and B, for a number of products. Which team is A and which is B changes from pair to pair, and you are not told anything about the teams. Judge only what is in the pictures.

Read `../review/pairs.json`. Each pair has an `id`, the kind of `product`, the `scene` both designs show (the same person, the same data), the `concept` both were asked to carry out, and the images of `A` and of `B` (the first screen as a person sees it, and a second view). Open every image of both designs with your file-reading tool before you decide.

For each pair, in the order you are given, answer:
- `ship`: "A" or "B": the one you would put in front of users. You must choose.
- `margin`: "clear" if a product owner would see the difference at a glance, "slight" if it is a close call.
- `why`: the main reason, in one concrete sentence that names what is on the screens.
- `hierarchy`, `colour`, `typography`, `density`: for each, "A", "B" or "same": which design is better on that point (is it clear what matters most; is colour used with restraint and meaning; is the type legible, consistent and well sized; is the screen neither crowded nor empty).

Judge as a user opening the product for the first time would: can they tell at once where they stand and what to do, and does the screen look like a considered product.
