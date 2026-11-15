/**
 * Putting the previous version back does not put back the data. A change to the shape of what is stored that
 * drops, renames or narrows something loses what people stored there, or stops the version before from finding
 * it, and no rollback of the code undoes that. In the field the commonest way to lose production data was one
 * line: a column renamed where a new one should have been added. This reads migration files and says which
 * statements are of that kind, so that they go out only with the owner's yes, and never unnoticed.
 */

export type Kind = 'loses' | 'breaks' | 'can-fail' | 'opens' | 'adds' | 'data' | 'other';

export interface Change {
  file: string;
  line: number;
  kind: Kind;
  /** What it does, as the owner reads it. */
  what: string;
  /** The beginning of the statement. */
  statement: string;
}

/** Kinds that do not go out without the owner having said yes to exactly that. */
export const DANGEROUS: readonly Kind[] = ['loses', 'breaks', 'can-fail', 'opens'];

/**
 * A script cut into statements, each with the line it starts on. Comments are dropped; text in quotes and in
 * dollar quotes (a function's body) is kept whole, so a semicolon or a keyword inside it starts nothing.
 */
export function statements(sql: string): { text: string; line: number }[] {
  const found: { text: string; line: number }[] = [];
  let text = '';
  let line = 1;
  let startLine = 1;
  const push = (): void => {
    if (text.trim() !== '') found.push({ text: text.trim(), line: startLine });
    text = '';
  };
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i]!;
    if (text.trim() === '') startLine = line;
    if (char === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      line++;
      text += '\n';
      continue;
    }
    if (char === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      const comment = sql.slice(i, end < 0 ? sql.length : end + 2);
      line += comment.split('\n').length - 1;
      i += comment.length - 1;
      continue;
    }
    if (char === "'" || char === '"') {
      let end = i + 1;
      while (end < sql.length && !(sql[end] === char && sql[end + 1] !== char)) end += sql[end] === char ? 2 : 1;
      const quoted = sql.slice(i, end + 1);
      line += quoted.split('\n').length - 1;
      // What is inside quotes is data: it is kept as a mark, so that no keyword in it is read as a statement.
      text += char === "'" ? "'…'" : quoted;
      i = end;
      continue;
    }
    const dollar = char === '$' ? /^\$[A-Za-z_]*\$/.exec(sql.slice(i)) : null;
    if (dollar) {
      const end = sql.indexOf(dollar[0], i + dollar[0].length);
      const body = sql.slice(i, end < 0 ? sql.length : end + dollar[0].length);
      line += body.split('\n').length - 1;
      text += '$…$';
      i += body.length - 1;
      continue;
    }
    if (char === ';') {
      push();
      continue;
    }
    if (char === '\n') line++;
    text += char;
  }
  push();
  return found;
}

const RULES: { kind: Kind; pattern: RegExp; what: string; unless?: RegExp }[] = [
  { kind: 'loses', pattern: /^drop\s+(table|database|schema)\b/, what: 'drops a table, a schema or a database with everything in it' },
  { kind: 'loses', pattern: /^alter\s+table\b.*\bdrop\s+(column\s+)?(?!constraint\b|default\b|not\s+null\b|expression\b|identity\b)(if\s+exists\s+)?\w+/, what: 'drops a column with what people stored in it' },
  { kind: 'loses', pattern: /^truncate\b/, what: 'empties a table' },
  { kind: 'loses', pattern: /^delete\s+from\s+\S+\s*$/, what: 'deletes every row of a table' },
  { kind: 'breaks', pattern: /^alter\s+table\b.*\brename\b/, what: 'renames a table or a column: the version before stops finding it, and putting that version back does not bring the old name back. Add the new one, copy, and drop the old in a later release' },
  { kind: 'breaks', pattern: /^alter\s+table\b.*\balter\s+(column\s+)?\S+\s+(set\s+data\s+)?type\b/, what: 'changes a column\'s type: what is stored may not fit, and the version before may not read it' },
  { kind: 'can-fail', pattern: /^alter\s+table\b.*\badd\s+(column\s+)?(if\s+not\s+exists\s+)?(?!constraint\b)\S+\s+[^,]*\bnot\s+null\b/, unless: /\badd\s+(column\s+)?[^,]*\bdefault\b/, what: 'adds a required column with no default: it fails on a table that has rows, or leaves the version before unable to add a row' },
  { kind: 'can-fail', pattern: /^alter\s+table\b.*\bset\s+not\s+null\b/, what: 'makes a column required: it fails if any stored row has none' },
  { kind: 'can-fail', pattern: /^alter\s+table\b.*\badd\s+(constraint\s+\S+\s+)?(unique|check|foreign\s+key|primary\s+key)\b/, what: 'adds a rule to a table that has rows: it fails if any stored row breaks it' },
  { kind: 'can-fail', pattern: /^create\s+unique\s+index\b/, what: 'adds a uniqueness rule: it fails if stored rows repeat' },
  { kind: 'opens', pattern: /^alter\s+table\b.*\bdisable\s+row\s+level\s+security\b/, what: 'turns off row security on a table: everyone with the public key reads and writes all of it' },
  { kind: 'opens', pattern: /^drop\s+policy\b/, what: 'removes a row-security policy: who can read or change the rows changes' },
  { kind: 'opens', pattern: /^grant\b.*\bto\s+(anon|public)\b/, what: 'grants something to everyone, signed in or not' },
  { kind: 'data', pattern: /^(insert|update|delete|merge)\b/, what: 'changes rows' },
  { kind: 'adds', pattern: /^(create\s+(table|index|view|materialized\s+view|type|function|or\s+replace\s+function|policy|trigger|extension|schema|sequence)|alter\s+table\b.*\badd\b|alter\s+table\b.*\benable\s+row\s+level\s+security)\b/, what: 'adds' },
];

const bare = (name: string): string => name.replace(/["`\[\]]/g, '').split('.').at(-1)!.toLowerCase();
/** The table a statement is about, when it names one. */
const tableOf = (flat: string): string | null => {
  const named = /^alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(\S+)/.exec(flat) ?? /^create\s+unique\s+index\b.*?\bon\s+(?:only\s+)?([^\s(]+)/.exec(flat);
  return named ? bare(named[1]!) : null;
};

/**
 * Every statement of these migration files with what kind of change it is. A rule added to a table that the
 * same files create cannot fail on stored rows (there are none), so it is an addition like the table itself.
 */
export function classify(files: readonly { file: string; sql: string }[]): Change[] {
  const all = files.flatMap(({ file, sql }) => statements(sql).map(({ text, line }) => ({ file, line, text, flat: text.replace(/\s+/g, ' ').toLowerCase() })));
  const created = new Set(all.flatMap(({ flat }) => /^create\s+table\s+(?:if\s+not\s+exists\s+)?([^\s(]+)/.exec(flat)?.[1] ?? []).map(bare));
  return all.map(({ file, line, text, flat }) => {
    const rule = RULES.find((r) => r.pattern.test(flat) && !(r.unless?.test(flat) ?? false));
    const onNew = rule?.kind === 'can-fail' && created.has(tableOf(flat) ?? '');
    return { file, line, kind: onNew ? 'adds' : (rule?.kind ?? 'other'), what: onNew ? 'adds' : (rule?.what ?? ''), statement: text.replace(/\s+/g, ' ').slice(0, 140) };
  });
}

const kindOf = (flat: string): { kind: Kind; what: string } => {
  const rule = RULES.find((r) => r.pattern.test(flat) && !(r.unless?.test(flat) ?? false));
  return { kind: rule?.kind ?? 'other', what: rule?.what ?? '' };
};

/** Where checks and their fixtures live: a statement there sets a scene, it does not change the product's data. */
const NOT_PRODUCT = /(^|\/)(tests?|__tests__|e2e|flows|fixtures|spec|docs?)\/|\.(test|spec)\.[cm]?[jt]sx?$|\.md$|\.sql$/;
const IN_TEXT = /\b(alter\s+table|create\s+(?:unique\s+)?(?:table|index)|drop\s+(?:table|column|index|policy|schema|database)|truncate\s+(?:table\s+)?\w|delete\s+from\s+\w)[^`'"\n;]*/gi;

/**
 * Statements that change the shape of what is stored, written inside the program's own text (a string handed
 * to the database when it starts), read from the lines a diff adds. A product that keeps its migrations in code
 * has no .sql file to read, and a line that renames a column there loses just as much.
 */
export function changesInCode(diff: string): Change[] {
  const found: Change[] = [];
  let file = '';
  let line = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) {
      file = raw.slice(4).replace(/^b\//, '');
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(raw);
    if (hunk) {
      line = Number(hunk[1]) - 1;
      continue;
    }
    if (raw.startsWith('-') || raw.startsWith('\\')) continue;
    line++;
    if (!raw.startsWith('+') || file === '' || file === '/dev/null' || NOT_PRODUCT.test(file)) continue;
    for (const match of raw.slice(1).matchAll(IN_TEXT)) {
      const flat = match[0].replace(/\s+/g, ' ').trim().toLowerCase();
      let { kind, what } = kindOf(flat);
      // A statement whose text goes on over the next line (a `where` there) is not judged by its first line.
      const closed = /[`'";]/.test(raw.slice(1).charAt(match.index + match[0].length));
      if (kind === 'loses' && flat.startsWith('delete from') && !closed) [kind, what] = ['data', 'changes rows'];
      found.push({ file, line, kind, what, statement: match[0].replace(/\s+/g, ' ').trim().slice(0, 140) });
    }
  }
  return found;
}

export function renderMigrations(steps: readonly Change[], files: readonly string[]): string {
  if (files.length === 0 && steps.length === 0) return 'no migration file changed, and no statement that changes the shape of what is stored was added to the code';
  const dangerous = steps.filter((step) => DANGEROUS.includes(step.kind));
  const count = (kind: Kind): number => steps.filter((step) => step.kind === kind).length;
  const inCode = steps.filter((step) => !files.includes(step.file)).length;
  const lines = [`${files.length} migration file(s)${inCode > 0 ? ` and ${inCode} statement(s) written in the code` : ''}, ${steps.length} statement(s): ${count('adds')} add, ${count('data')} change rows, ${count('other')} other, ${dangerous.length} that can lose or break what is stored`];
  if (dangerous.length === 0) lines.push('nothing in them drops, renames, narrows or opens what people stored');
  else
    lines.push(
      `${dangerous.length} STATEMENT(S) THAT DO NOT GO OUT WITHOUT THE OWNER'S YES:`,
      ...dangerous.map((step) => `  - ${step.file}:${step.line} [${step.kind}] ${step.what}\n      ${step.statement}`),
      'Make the change in steps that each work with the version before and after (add, copy, switch the code, drop in a later release), or show the owner these lines and release with their words: --without "rc-shape|<what they said yes to, in their words>".',
    );
  return lines.join('\n');
}
