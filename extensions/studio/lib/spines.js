// App Builder — the product-contract spines (STUDIO v2, Wave F slice F1). The
// two contract files a scaffolded app is BORN with, beside A2's tokens.json
// (§ Wave F — the scaffold contract), both living in the project repo under
// design/ next to tokens.json:
//
//   design/components.json, schema 1 — the typed component library: every
//   component the app renders, its named variants, its effect options, and
//   the token ROLES it consumes (never token values — values live in
//   tokens.json alone, so a palette change is a one-file edit).
//
//   design/manifest.json, schema 1 — the UI manifest: which screens exist
//   and which components (with which variants) each screen uses. Regenerable
//   from source; drift against the library is a WARNING here and a review
//   prompt upstream, never a block and never a mystery.
//
// Pure isolated library: no Electron, no fs, no bus verbs — slice F2 wires
// renderContractAddendum into the Lift-off kickoff; nothing requires this
// module yet. The one require is ./design (one-way, the contract.js
// precedent: design.js requires nothing of ours), used to judge whether a
// tokens value is usable and to read its summary/source honesty ledger.
// Both validators follow the contract.js voice: deterministic and total —
// never a throw on any input — returning { valid, errors, warnings } of
// plain-language findings. The full schemas, the token-role table, and the
// caps are documented for scaffold templates and coder personas in
// design/contract-spines.md; the numbers below are that document's source
// of truth.
'use strict';

const design = require('./design');

// Both spine files declare the same schema number; they were born together.
const SPINES_SCHEMA_VERSION = 1;

// ---- caps ------------------------------------------------------------------
// Fail-closed bounds, the mockup.js philosophy: a contract file is small by
// nature (the hand-built library this repo's own UI amounts to is under a
// dozen components), so anything past these caps is a broken generator or a
// hostile file, and an over-cap list is refused whole — never truncated into
// acceptance.
const MAX_COMPONENTS = 40;
const MAX_NAME = 48;            // component / screen / use names — the project-id length
const MAX_OPTION = 32;          // variant / effect / binding-part names
const MAX_PURPOSE = 200;
const MAX_VARIANTS = 12;
const MAX_EFFECTS = 8;
const MAX_BINDINGS = 16;
const MAX_MANIFEST_SCREENS = 24; // mirrors mockup.js MAX_SCREENS — same ceiling on purpose
const MAX_SCREEN_TITLE = 80;     // mirrors mockup.js MAX_SCREEN_TITLE
const MAX_USES = 32;

// Names are pinned exactly like a project id / mockup screen id — lowercase
// kebab, bounded. Mirrored, not imported (the mockup.js SCREEN_ID_RE
// precedent): contract.js's isSafeProjectId carries its own length cap.
const NAME_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

// ---- the token-role table --------------------------------------------------
// A binding value is "<group>.<role>", resolved against the tokens.json
// shape design.js compiles (§ A2) — color roles come straight from its
// COLOR_ROLES so the two files can never disagree. `type` roles are the size
// scale steps; `family` the two font feel-words; `space` the 1-based spacing
// steps. Anything not in this table is refused by name, so a typo'd role
// fails at validation, not at render time.
const TOKEN_ROLES = {
  color: design.COLOR_ROLES.slice(),
  type: ['xs', 'sm', 'md', 'lg', 'xl', 'xxl'],
  family: ['body', 'detail'],
  space: ['1', '2', '3', '4', '5', '6', '7'],
  radius: ['sm', 'md', 'lg', 'pill'],
  shadow: ['low', 'mid', 'high'],
  motion: ['fast', 'slow', 'easing'],
};

function isTokenRole(value) {
  if (typeof value !== 'string') return false;
  const dot = value.indexOf('.');
  if (dot < 1) return false;
  const roles = TOKEN_ROLES[value.slice(0, dot)];
  return Array.isArray(roles) && roles.includes(value.slice(dot + 1));
}

function finding(code, message) {
  return { code, message };
}

function isSafeName(value) {
  return typeof value === 'string' && value.length <= MAX_NAME && NAME_RE.test(value);
}

// "component 3 (\"button\")" — the ordinal always, the name when one is
// plausibly there to quote (bounded, so a hostile name can't flood a message).
function labelFor(kind, item, index, nameField) {
  const raw = item && typeof item === 'object' ? item[nameField] : undefined;
  const name = typeof raw === 'string' && raw ? ` ("${raw.slice(0, MAX_NAME)}")` : '';
  return `${kind} ${index + 1}${name}`;
}

// The shared top-of-file checks: JSON object + schema declaration. Returns
// true when the caller can keep walking; a non-object is hopeless and stops
// the validation whole (fail closed), a wrong schema merely joins the errors.
function checkFileShape(value, fileName, errors) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(finding('not-an-object', `${fileName} is not a JSON object.`));
    return false;
  }
  if (value.schema === undefined)
    errors.push(finding('schema-version', `${fileName} declares no "schema" field.`));
  else if (value.schema !== SPINES_SCHEMA_VERSION)
    errors.push(finding('schema-version',
      `${fileName} declares schema ${value.schema}, but this builder only understands schema ${SPINES_SCHEMA_VERSION}.`));
  return true;
}

// One list of kebab names (variants, effects), validated in place. Over-cap
// refuses the list whole; duplicates and bad names are named individually.
function checkNameList(list, cap, dupCode, owner, noun, errors) {
  if (list.length > cap) {
    errors.push(finding(`${noun}-count`,
      `${owner} declares ${list.length} ${noun}s — the cap is ${cap}.`));
    return;
  }
  const seen = new Set();
  list.forEach((name, i) => {
    if (typeof name !== 'string' || name.length > MAX_OPTION || !NAME_RE.test(name))
      errors.push(finding(`bad-${noun}`,
        `${owner} has an unusable ${noun} name at position ${i + 1} (lowercase kebab-case, at most ${MAX_OPTION} characters).`));
    else if (seen.has(name))
      errors.push(finding(dupCode, `${owner} declares the ${noun} "${name}" twice.`));
    else seen.add(name);
  });
}

// Validate a parsed components.json. Deterministic and total: never throws,
// returns { valid, errors, warnings }. Errors block, warnings require review
// (§ Validation) — an empty library or a component that binds no tokens is
// reviewable, not broken.
function validateComponents(value) {
  const errors = [];
  const warnings = [];
  if (!checkFileShape(value, 'components.json', errors))
    return { valid: false, errors, warnings };

  if (!Array.isArray(value.components)) {
    errors.push(finding('component-list', 'components.json has no "components" array.'));
    return { valid: false, errors, warnings };
  }
  if (value.components.length > MAX_COMPONENTS) {
    errors.push(finding('component-count',
      `The library declares ${value.components.length} components — the cap is ${MAX_COMPONENTS}.`));
    return { valid: false, errors, warnings };
  }
  if (value.components.length === 0)
    warnings.push(finding('empty-library',
      'The component library names no components yet — the pickers have nothing to offer until it does.'));

  const seen = new Set();
  value.components.forEach((comp, i) => {
    const label = labelFor('Component', comp, i, 'name');
    if (!comp || typeof comp !== 'object' || Array.isArray(comp)) {
      errors.push(finding('component-shape', `${label} is not a JSON object.`));
      return;
    }
    if (!isSafeName(comp.name))
      errors.push(finding('component-shape',
        `${label} has no usable name (lowercase kebab-case, at most ${MAX_NAME} characters).`));
    else if (seen.has(comp.name))
      errors.push(finding('duplicate-component', `The library declares "${comp.name}" twice.`));
    else seen.add(comp.name);

    if (comp.purpose !== undefined &&
        (typeof comp.purpose !== 'string' || comp.purpose.length > MAX_PURPOSE))
      errors.push(finding('component-shape',
        `${label} has a "purpose" that is not a short line of text (at most ${MAX_PURPOSE} characters).`));

    if (!Array.isArray(comp.variants)) {
      errors.push(finding('component-shape', `${label} has no "variants" array.`));
    } else if (comp.variants.length === 0) {
      warnings.push(finding('no-variants',
        `${label} declares no variants — even one ("default") is what makes the pickers real.`));
    } else {
      checkNameList(comp.variants, MAX_VARIANTS, 'duplicate-variant', label, 'variant', errors);
    }

    // Effects are optional — plenty of components have none — but present
    // they obey the same discipline as variants.
    if (comp.effects !== undefined) {
      if (!Array.isArray(comp.effects))
        errors.push(finding('component-shape', `${label} has an "effects" field that is not an array.`));
      else
        checkNameList(comp.effects, MAX_EFFECTS, 'duplicate-effect', label, 'effect', errors);
    }

    // Token bindings: part name → "<group>.<role>". Absence is a warning (a
    // pure layout component is conceivable), an unknown role is an error —
    // it would dangle forever against tokens.json.
    if (comp.tokens === undefined || (comp.tokens && typeof comp.tokens === 'object' &&
        !Array.isArray(comp.tokens) && Object.keys(comp.tokens).length === 0)) {
      warnings.push(finding('no-bindings',
        `${label} binds no token roles — the one law (tokens only) has nothing visible to hold onto here.`));
    } else if (!comp.tokens || typeof comp.tokens !== 'object' || Array.isArray(comp.tokens)) {
      errors.push(finding('component-shape', `${label} has a "tokens" field that is not an object of bindings.`));
    } else {
      const entries = Object.entries(comp.tokens);
      if (entries.length > MAX_BINDINGS) {
        errors.push(finding('binding-count',
          `${label} declares ${entries.length} token bindings — the cap is ${MAX_BINDINGS}.`));
      } else {
        for (const [part, role] of entries) {
          if (part.length > MAX_OPTION || !NAME_RE.test(part))
            errors.push(finding('component-shape',
              `${label} has an unusable binding part name ("${part.slice(0, MAX_OPTION)}") — lowercase kebab-case, at most ${MAX_OPTION} characters.`));
          if (!isTokenRole(role))
            errors.push(finding('unknown-token-role',
              `${label} binds "${part.slice(0, MAX_OPTION)}" to ${typeof role === 'string' ? `"${role.slice(0, MAX_OPTION)}"` : 'a non-text value'}, which is not a token role this contract knows (the role table lives in design/contract-spines.md).`));
        }
      }
    }
  });

  return { valid: errors.length === 0, errors, warnings };
}

// Validate a parsed manifest.json. Same discipline as validateComponents.
// When the parsed components.json is passed as the second argument AND it
// validates cleanly on its own, uses are drift-checked against the library —
// unknown components and undeclared variants are WARNINGS (drift is review,
// the canonical-drift precedent, never a block). A broken library performs
// no drift check at all: it would spray misleading findings over a manifest
// that may be fine.
function validateManifest(value, componentsValue) {
  const errors = [];
  const warnings = [];
  if (!checkFileShape(value, 'manifest.json', errors))
    return { valid: false, errors, warnings };

  if (!Array.isArray(value.screens)) {
    errors.push(finding('screen-list', 'manifest.json has no "screens" array.'));
    return { valid: false, errors, warnings };
  }
  if (value.screens.length > MAX_MANIFEST_SCREENS) {
    errors.push(finding('screen-count',
      `The manifest declares ${value.screens.length} screens — the cap is ${MAX_MANIFEST_SCREENS}.`));
    return { valid: false, errors, warnings };
  }
  if (value.screens.length === 0)
    warnings.push(finding('empty-manifest',
      'The manifest names no screens yet — regenerate it from the app source.'));

  let library = null;
  if (componentsValue !== undefined && componentsValue !== null &&
      validateComponents(componentsValue).valid) {
    library = new Map();
    for (const comp of componentsValue.components)
      library.set(comp.name, new Set(comp.variants));
  }

  const seenScreens = new Set();
  value.screens.forEach((screen, i) => {
    const label = labelFor('Screen', screen, i, 'id');
    if (!screen || typeof screen !== 'object' || Array.isArray(screen)) {
      errors.push(finding('screen-shape', `${label} is not a JSON object.`));
      return;
    }
    if (!isSafeName(screen.id))
      errors.push(finding('screen-shape',
        `${label} has no usable id (lowercase kebab-case, at most ${MAX_NAME} characters).`));
    else if (seenScreens.has(screen.id))
      errors.push(finding('duplicate-screen', `The manifest declares the screen "${screen.id}" twice.`));
    else seenScreens.add(screen.id);

    if (screen.title !== undefined &&
        (typeof screen.title !== 'string' || screen.title.length > MAX_SCREEN_TITLE))
      errors.push(finding('screen-shape',
        `${label} has a "title" that is not a short line of text (at most ${MAX_SCREEN_TITLE} characters).`));

    if (!Array.isArray(screen.uses)) {
      errors.push(finding('screen-shape', `${label} has no "uses" array naming its components.`));
      return;
    }
    if (screen.uses.length > MAX_USES) {
      errors.push(finding('use-count',
        `${label} declares ${screen.uses.length} component uses — the cap is ${MAX_USES}.`));
      return;
    }
    if (screen.uses.length === 0)
      warnings.push(finding('empty-screen', `${label} uses no components yet.`));

    const seenUses = new Set();
    screen.uses.forEach((use, j) => {
      const useLabel = `${label}, use ${j + 1}`;
      if (!use || typeof use !== 'object' || Array.isArray(use)) {
        errors.push(finding('use-shape', `${useLabel} is not a JSON object.`));
        return;
      }
      if (!isSafeName(use.component)) {
        errors.push(finding('use-shape',
          `${useLabel} names no usable component (lowercase kebab-case, at most ${MAX_NAME} characters).`));
        return;
      }
      if (seenUses.has(use.component))
        errors.push(finding('duplicate-use', `${label} lists "${use.component}" twice — one entry per component, variants listed together.`));
      else seenUses.add(use.component);

      if (use.variants !== undefined) {
        if (!Array.isArray(use.variants)) {
          errors.push(finding('use-shape', `${useLabel} has a "variants" field that is not an array.`));
          return;
        }
        checkNameList(use.variants, MAX_VARIANTS, 'duplicate-variant', useLabel, 'variant', errors);
      }

      if (library) {
        const declared = library.get(use.component);
        if (!declared) {
          warnings.push(finding('unknown-component',
            `${label} uses "${use.component}", which the component library never declares — regenerate the manifest or add the component.`));
        } else if (Array.isArray(use.variants)) {
          for (const variant of use.variants)
            if (typeof variant === 'string' && !declared.has(variant))
              warnings.push(finding('unknown-variant',
                `${label} uses "${use.component}" in a variant ("${variant.slice(0, MAX_OPTION)}") the library never declares for it.`));
        }
      }
    });
  });

  return { valid: errors.length === 0, errors, warnings };
}

// ---- the kickoff addendum --------------------------------------------------
// The markdown a Coder persona reads at kickoff (F2 appends it to the
// Lift-off packet after PROJECT.md). Pure and DETERMINISTIC by the design.js
// law — no Date, no randomness, same inputs same bytes — and total: any junk
// in any argument still yields honest text, never a throw. It states the
// three spines, what exists (the tokens honesty ledger included), what the
// scaffold MUST create, and the one law.

const SOURCE_GROUPS = ['palette', 'accent', 'type', 'density', 'tone'];

function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

// The tokens honesty sentence, straight off the A2 source ledger: derived
// groups read as choices, defaulted groups are SAID to be defaults — never
// an invented value presented as chosen.
function tokensLedgerLine(tokens) {
  const source = tokens.source && typeof tokens.source === 'object' ? tokens.source : {};
  const fromLook = SOURCE_GROUPS.filter((group) => source[group] === 'look');
  const defaulted = SOURCE_GROUPS.filter((group) => source[group] !== 'look');
  if (!defaulted.length)
    return 'Every group was derived from the Look answer.';
  if (!fromLook.length)
    return 'Every group is the documented house default — the Look answer named nothing the compiler recognizes; treat the values as placeholders to refine, not choices to defend.';
  return `Derived from the Look answer: ${fromLook.join(', ')}. House defaults: ${defaulted.join(', ')}.`;
}

function renderContractAddendum(tokens, components, manifest) {
  const lines = [];
  lines.push('## The product contract (the three spines)');
  lines.push('');
  lines.push('This app is BORN editable (design/studio-v2.md § Wave F): three');
  lines.push('machine-readable files in the project repo carry the whole design system,');
  lines.push('and the code consumes them instead of restating them.');
  lines.push('');
  lines.push('1. `design/tokens.json` — colors, type scale, spacing, radii, shadows,');
  lines.push('   motion. Compiled from the blueprint\'s Look answer before any code existed.');
  lines.push('2. `design/components.json` — the typed component library: every component');
  lines.push('   the app renders, its named variants, its effect options, and the token');
  lines.push('   roles it consumes.');
  lines.push('3. `design/manifest.json` — the UI manifest: which screens exist and which');
  lines.push('   components (with which variants) each one uses. Regenerable from source;');
  lines.push('   drift against the code is a review prompt, never a mystery.');
  lines.push('');
  lines.push('### What exists at this kickoff');
  lines.push('');

  if (tokens && typeof tokens === 'object' && !Array.isArray(tokens) &&
      design.validateTokens(tokens).length === 0) {
    lines.push(`- \`design/tokens.json\` — EXISTS. ${tokens.summary}`);
    lines.push(`  ${tokensLedgerLine(tokens)}`);
  } else {
    lines.push('- `design/tokens.json` — MISSING or not usable at kickoff time. Compile it');
    lines.push('  from the blueprint\'s Look answer (the builder\'s Create step writes it)');
    lines.push('  before styling anything; until it exists there is nothing to bind to.');
  }

  if (components === undefined || components === null) {
    lines.push('- `design/components.json` — does not exist yet. The scaffold MUST create');
    lines.push('  it (schema and examples: design/contract-spines.md), one entry per');
    lines.push('  component it builds — written while scaffolding, not promised for later.');
  } else if (validateComponents(components).valid) {
    const names = components.components.map((comp) => comp.name).join(', ');
    lines.push(`- \`design/components.json\` — EXISTS with ${plural(components.components.length, 'component')}${names ? `: ${names}` : ''}.`);
    lines.push('  Extend it in place when a new component appears; never build one it does');
    lines.push('  not name.');
  } else {
    lines.push('- `design/components.json` — present but not a usable schema-1 library.');
    lines.push('  Repair it against design/contract-spines.md before building on it.');
  }

  if (manifest === undefined || manifest === null) {
    lines.push('- `design/manifest.json` — does not exist yet. The scaffold MUST create it');
    lines.push('  (schema and examples: design/contract-spines.md), one entry per screen,');
    lines.push('  kept true as screens gain and lose components.');
  } else if (validateManifest(manifest).valid) {
    const ids = manifest.screens.map((screen) => screen.id).join(', ');
    lines.push(`- \`design/manifest.json\` — EXISTS with ${plural(manifest.screens.length, 'screen')}${ids ? `: ${ids}` : ''}.`);
    lines.push('  When a screen gains or loses a component, the manifest changes in the');
    lines.push('  same commit.');
  } else {
    lines.push('- `design/manifest.json` — present but not a usable schema-1 manifest.');
    lines.push('  Repair it against design/contract-spines.md before building on it.');
  }

  lines.push('');
  lines.push('### The one law');
  lines.push('');
  lines.push('No hard-coded colors or fonts — tokens only. Every color, font family,');
  lines.push('size, radius, shadow, and motion value in the app resolves through');
  lines.push('`design/tokens.json` (directly, or through a component\'s token bindings).');
  lines.push('A hex value or a font name typed into a component is a contract violation,');
  lines.push('not a shortcut.');
  lines.push('');
  lines.push('The full schemas, the token-role table, and the caps live in');
  lines.push('design/contract-spines.md — read it before writing either file.');
  return lines.join('\n') + '\n';
}

// The constants export wholesale as the module's public contract (the
// design.js precedent); the drill pins the cap NUMBERS and the addendum's
// load-bearing sentences on its own side so a drift here fails the gate.
module.exports = {
  MAX_BINDINGS,
  MAX_COMPONENTS,
  MAX_EFFECTS,
  MAX_MANIFEST_SCREENS,
  MAX_NAME,
  MAX_OPTION,
  MAX_PURPOSE,
  MAX_SCREEN_TITLE,
  MAX_USES,
  MAX_VARIANTS,
  SPINES_SCHEMA_VERSION,
  TOKEN_ROLES,
  isTokenRole,
  renderContractAddendum,
  validateComponents,
  validateManifest,
};
