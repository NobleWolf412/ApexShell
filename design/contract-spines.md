# The product-contract spines — components.json and manifest.json, schema 1

Status: implemented (STUDIO v2, Wave F slice F1 — `extensions/studio/lib/
spines.js`, drilled by `test/studio-spines-drill.js`). This file is the
schema authority the file-scaffold templates and coder personas read; the
validator in spines.js is its executable twin — if the two ever disagree,
stop and fix one, do not improvise a third reading.

Every app the builder scaffolds is BORN editable (design/studio-v2.md
§ Wave F): three machine-readable spines in the project repo carry the whole
design system. The first, `design/tokens.json`, is compiled from the Look
answer at Create and documented in `extensions/studio/lib/design.js` (schema
comment at the top). This file documents the other two, which the SCAFFOLD
creates as it builds — they do not exist at kickoff time:

- `design/components.json` — the typed component library.
- `design/manifest.json` — the UI manifest.

Both live beside tokens.json under `design/` in the project repo. They are
portable by the same law as the blueprint: no machine paths, no provider
anything, no token VALUES — components bind token *roles*; values live in
tokens.json alone, so a palette change is a one-file edit.

**The one law**: no hard-coded colors or fonts — tokens only. Every color,
font family, size, radius, shadow, and motion value in the app resolves
through tokens.json, directly or through a component's bindings. A hex value
or a font name typed into a component is a contract violation, not a
shortcut.

## design/components.json — the component library, schema 1

One entry per component the app renders. Written while scaffolding, not
promised for later; extended in place when a component is added — never
build a component the library does not name.

```json
{
  "schema": 1,
  "components": [
    {
      "name": "button",
      "purpose": "The one action control.",
      "variants": ["primary", "ghost", "danger"],
      "effects": ["hover-lift", "press-dim"],
      "tokens": {
        "background": "color.accent",
        "label": "color.text",
        "corner": "radius.md",
        "press": "motion.fast"
      }
    },
    {
      "name": "card",
      "variants": ["default", "raised"],
      "tokens": {
        "surface": "color.surface",
        "edge": "radius.lg",
        "depth": "shadow.low"
      }
    }
  ]
}
```

Field by field:

- `schema` — required, exactly `1`. Missing or anything else is an error.
- `components` — required array, at most **40** entries. An EMPTY library is
  a warning, not an error (the pickers simply have nothing to offer yet).
- `name` — required; lowercase kebab-case, at most **48** characters (the
  project-id shape). Duplicates are errors.
- `purpose` — optional one-liner, at most **200** characters.
- `variants` — required array of kebab names, each at most **32**
  characters, at most **12** per component, no duplicates. ZERO variants is
  a warning — even one (`"default"`) is what makes the pickers real.
- `effects` — optional array, same name discipline, at most **8**. Absent
  means "this component has no effect options", which is fine and silent.
- `tokens` — the token-role bindings: an object mapping a component part
  name (kebab, at most 32 characters) to a role from the table below, at
  most **16** bindings. An unknown role is an ERROR (it would dangle forever
  against tokens.json); NO bindings at all is a warning (a pure layout
  component is conceivable, but the one law then has nothing visible to
  hold onto).

### The token-role table

A binding value is `"<group>.<role>"`, resolved against the tokens.json
shape design.js compiles. This table is the whole vocabulary — anything else
is refused by name at validation time:

| group    | roles                                    | resolves to                       |
| -------- | ---------------------------------------- | --------------------------------- |
| `color`  | `bg surface text dim accent good warning`| `color.<role>` — a `#rrggbb`      |
| `type`   | `xs sm md lg xl xxl`                     | `type.scale.sizes.<role>` — px    |
| `family` | `body detail`                            | `type.family.<role>` — feel words |
| `space`  | `1 2 3 4 5 6 7`                          | `space.steps[<role>-1]` — px      |
| `radius` | `sm md lg pill`                          | `radius.<role>` — px              |
| `shadow` | `low mid high`                           | `shadow.<role>` — CSS box-shadow  |
| `motion` | `fast slow easing`                       | `motion.<role>` — CSS text        |

## design/manifest.json — the UI manifest, schema 1

Which screens exist and which components (with which variants) each one
uses. Regenerable from source — when a screen gains or loses a component,
the manifest changes in the same commit. Drift against the component
library is a WARNING (review, never a block), the canonical-drift
precedent.

```json
{
  "schema": 1,
  "screens": [
    {
      "id": "home",
      "title": "Home",
      "uses": [
        { "component": "button", "variants": ["primary", "ghost"] },
        { "component": "card", "variants": ["default"] }
      ]
    },
    {
      "id": "settings",
      "uses": [
        { "component": "button", "variants": ["ghost"] }
      ]
    }
  ]
}
```

Field by field:

- `schema` — required, exactly `1`.
- `screens` — required array, at most **24** entries (the mockup pass's own
  screen ceiling, on purpose). Empty is a warning.
- `id` — required; kebab, at most **48** characters — the same shape as a
  mockup screen id, so a manifest screen and its mockup can share a name.
  Duplicates are errors.
- `title` — optional, at most **80** characters.
- `uses` — required array of `{ component, variants? }`, at most **32** per
  screen. One entry per component — listing a component twice is an error;
  its variants belong together in one entry. `component` is a required
  kebab name; `variants` an optional kebab-name array (at most 12, no
  duplicates). An empty `uses` is a warning.

## Validation

`validateComponents(value)` and `validateManifest(value, components?)` in
`extensions/studio/lib/spines.js` return `{ valid, errors, warnings }` of
plain-language findings — deterministic, total, never a throw on any input.
Errors block, warnings require review (the contract.js severity model).
Everything over a cap is refused whole — never truncated into acceptance.

Passing the parsed components.json as `validateManifest`'s second argument
turns on the drift check: a use naming a component the library never
declares, or a variant the component doesn't have, is a warning. The check
only runs when the library itself validates cleanly — a broken library
would spray misleading drift findings over a manifest that may be fine.

## The kickoff addendum

`renderContractAddendum(tokens, components?, manifest?)` produces the
markdown a Coder persona reads at kickoff (slice F2 appends it to the
Lift-off packet). Pure and deterministic — same inputs, same bytes. It
states:

1. the three spines and where they live;
2. what exists at kickoff — the tokens summary plus its source ledger
   (derived groups vs house defaults, said honestly), and for each spine
   file either EXISTS (with counts and names), does-not-exist-yet (the
   scaffold MUST create it, per this document), or present-but-unusable
   (repair before building);
3. the one law, verbatim: no hard-coded colors or fonts — tokens only.
