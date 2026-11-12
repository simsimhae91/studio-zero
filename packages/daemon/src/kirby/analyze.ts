import { posix } from 'node:path';
// The classic compiler API (TypeScript 5.x). TypeScript 7's package no longer ships an in-process parser.
import ts from 'typescript-classic';
import type { ExtractedFile } from '../sandbox/extract.ts';

export interface Evidence {
  file: string;
  line: number;
  excerpt: string;
}

export interface Practice {
  id: PracticeId;
  title: string;
  present: boolean;
  /** Where the practice shows up in the code. Empty when absent. */
  evidence: Evidence[];
  /** One line of measured context, e.g. "41 call sites in 12 files". */
  detail: string;
}

export interface ModuleInfo {
  path: string;
  loc: number;
  /** Repository-relative paths of the modules this one imports. */
  imports: string[];
  externals: string[];
  exports: string[];
  /** Branch points + 1, summed over the file. */
  complexity: number;
  anyCount: number;
  jsx: boolean;
}

export interface RepoProfile {
  totalFiles: number;
  sourceFiles: number;
  loc: number;
  partial: boolean;
  packageManager: 'pnpm' | 'npm' | 'yarn' | 'bun' | 'unknown';
  dependencies: string[];
  scripts: Record<string, string>;
  metrics: {
    anyCount: number;
    anyPerKloc: number;
    suppressions: number;
    importCycles: number;
    testFiles: number;
    testRatio: number;
    meanComplexity: number;
    mostComplex: { file: string; complexity: number }[];
  };
  topLevelDirs: { dir: string; files: number }[];
  practices: Practice[];
  modules: ModuleInfo[];
}

export const PRACTICES = {
  'schema-validated-boundaries': 'Runtime schema validation at trust boundaries',
  'typed-env': 'Environment variables parsed and typed in one module',
  'exhaustive-switch': 'Exhaustiveness checks on discriminated unions',
  'error-boundaries': 'UI error boundaries around failure-prone subtrees',
  'result-types': 'Errors modelled as values (Result types) at module seams',
  'strict-typescript': 'Strict TypeScript compiler settings',
  'automated-tests': 'An automated test suite of meaningful size',
  'ci-verification': 'CI that type-checks, lints and tests every change',
  'lint-and-format': 'Enforced linting and formatting',
  'import-boundaries': 'Enforced module boundaries and an acyclic import graph',
  'accessible-primitives': 'Accessible headless UI primitives instead of hand-rolled controls',
  'design-tokens': 'A single source of design tokens',
} as const;
export type PracticeId = keyof typeof PRACTICES;

const SOURCE_EXT = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const TEST_FILE = /(?:^|\/)(?:__tests__|tests?|e2e)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/;
const RESOLVE_SUFFIXES = ['', '.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs', '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];
const MAX_PARSED_FILES = 3000;
const MAX_EVIDENCE = 5;

const SCHEMA_LIBS = ['zod', 'valibot', 'arktype', 'yup', '@sinclair/typebox', 'superstruct', 'io-ts'];
const RESULT_LIBS = ['neverthrow', 'effect', 'fp-ts', 'ts-results', 'true-myth'];
const A11Y_LIBS = [/^@radix-ui\//, /^react-aria/, /^@react-aria\//, /^@headlessui\//, /^@ariakit\//, /^ariakit$/, /^@base-ui-components\//];
const TEST_LIBS = ['vitest', 'jest', '@playwright/test', 'mocha', 'ava', 'uvu', '@testing-library/react'];
const BOUNDARY_LIBS = ['dependency-cruiser', 'eslint-plugin-boundaries', 'eslint-plugin-import', '@nx/enforce-module-boundaries', 'knip'];

interface FileScan extends ModuleInfo {
  rawImports: string[];
  hits: Partial<Record<'schemaParse' | 'envRead' | 'exhaustive' | 'errorBoundary' | 'resultType', Evidence[]>>;
}

/**
 * Static profile of a JavaScript/TypeScript repository: module graph, size and complexity metrics, and which
 * engineering practices are demonstrably in use, each backed by file-and-line evidence from the syntax tree.
 *
 * Input is file text only. Nothing is resolved from disk, installed or evaluated, so analysing a hostile
 * repository costs CPU and nothing else.
 */
export function analyzeRepo(files: readonly ExtractedFile[], partial = false): RepoProfile {
  const paths = new Set(files.map((f) => f.path));
  const byPath = new Map(files.map((f) => [f.path, f]));
  const text = (path: string): string | null => byPath.get(path)?.content ?? null;

  const pkg = parseJson(text('package.json')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts?: Record<string, string>; eslintConfig?: unknown; prettier?: unknown } | null;
  const dependencies = [...new Set([...Object.keys(pkg?.dependencies ?? {}), ...Object.keys(pkg?.devDependencies ?? {})])].sort();
  const scripts = Object.fromEntries(Object.entries(pkg?.scripts ?? {}).filter(([, v]) => typeof v === 'string').slice(0, 40));
  const hasDep = (name: string | RegExp): boolean => dependencies.some((d) => (typeof name === 'string' ? d === name : name.test(d)));

  const tsconfigText = text('tsconfig.json') ?? text('tsconfig.base.json');
  const tsconfig = tsconfigText ? (ts.parseConfigFileTextToJson('tsconfig.json', tsconfigText).config as { compilerOptions?: Record<string, unknown> } | undefined) : undefined;
  const compilerOptions = tsconfig?.compilerOptions ?? {};
  const aliases = pathAliases(compilerOptions);

  const sources = files.filter((f) => f.content !== null && SOURCE_EXT.test(f.path) && !/(?:^|\/)(?:node_modules|dist|build|\.next|coverage|vendor)\//.test(f.path)).slice(0, MAX_PARSED_FILES);
  const scans = sources.map((f) => scanFile(f.path, f.content!));

  const resolve = (from: string, spec: string): string | null => {
    let base: string | null = null;
    if (spec.startsWith('.')) base = posix.normalize(posix.join(posix.dirname(from), spec));
    else for (const [prefix, target] of aliases) if (spec.startsWith(prefix)) base = posix.normalize(posix.join(target, spec.slice(prefix.length)));
    if (base === null) return null;
    const stem = base.replace(/\.(?:js|jsx|mjs|cjs)$/, '');
    for (const candidate of [base, stem]) for (const suffix of RESOLVE_SUFFIXES) if (paths.has(candidate + suffix)) return candidate + suffix;
    return null;
  };
  for (const scan of scans) {
    for (const spec of scan.rawImports) {
      const internal = resolve(scan.path, spec);
      if (internal) scan.imports.push(internal);
      else if (!spec.startsWith('.')) scan.externals.push(packageName(spec));
    }
    scan.imports = [...new Set(scan.imports)];
    scan.externals = [...new Set(scan.externals)];
  }

  const loc = scans.reduce((n, s) => n + s.loc, 0);
  const anyCount = scans.reduce((n, s) => n + s.anyCount, 0);
  const suppressions = sources.reduce((n, f) => n + (f.content!.match(/@ts-(?:ignore|expect-error|nocheck)|eslint-disable/g)?.length ?? 0), 0);
  const testFiles = files.filter((f) => TEST_FILE.test(f.path) && SOURCE_EXT.test(f.path)).length;
  const nonTestSources = scans.filter((s) => !TEST_FILE.test(s.path)).length;
  const importCycles = countCycles(scans);

  const collect = (key: keyof FileScan['hits']): Evidence[] => scans.flatMap((s) => s.hits[key] ?? []);
  const filesWith = (key: keyof FileScan['hits']): number => scans.filter((s) => (s.hits[key]?.length ?? 0) > 0).length;
  const fileEvidence = (path: string, pattern: RegExp): Evidence[] => {
    const content = text(path);
    if (content === null) return paths.has(path) ? [{ file: path, line: 1, excerpt: '' }] : [];
    const lines = content.split('\n');
    const index = lines.findIndex((l) => pattern.test(l));
    return [{ file: path, line: Math.max(1, index + 1), excerpt: (lines[Math.max(0, index)] ?? '').trim().slice(0, 160) }];
  };
  const firstExisting = (...candidates: string[]): string | undefined => candidates.find((c) => paths.has(c));
  const practice = (id: PracticeId, present: boolean, evidence: Evidence[], detail: string): Practice => ({ id, title: PRACTICES[id], present, evidence: present ? evidence.slice(0, MAX_EVIDENCE) : [], detail });

  const schemaHits = collect('schemaParse');
  const usesSchemaLib = SCHEMA_LIBS.some(hasDep);
  const envHits = collect('envRead');
  const envFiles = filesWith('envRead');
  const typedEnv = scans.find((s) => (s.hits.envRead?.length ?? 0) > 0 && (s.hits.schemaParse?.length ?? 0) > 0 && /(?:^|\/)(?:env|config)[^/]*\.[cm]?[jt]s$/.test(s.path));
  const exhaustive = collect('exhaustive');
  const boundaries = [...collect('errorBoundary'), ...files.filter((f) => /(?:^|\/)(?:global-)?error\.[jt]sx$/.test(f.path)).map((f) => ({ file: f.path, line: 1, excerpt: 'framework error boundary file' }))];
  const results = collect('resultType');
  const workflows = files.filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f.path));
  const verifyingWorkflow = workflows.find((f) => /\b(?:test|typecheck|tsc|lint|vitest|jest|playwright)\b/i.test(f.content ?? ''));
  const lintConfig = firstExisting('eslint.config.js', 'eslint.config.mjs', 'eslint.config.ts', '.eslintrc.json', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc', 'biome.json', 'biome.jsonc');
  const formatConfig = firstExisting('.prettierrc', '.prettierrc.json', 'prettier.config.js', 'prettier.config.mjs', 'biome.json', 'biome.jsonc', 'dprint.json');
  const boundaryTool = BOUNDARY_LIBS.find(hasDep);
  const a11yDeps = dependencies.filter((d) => A11Y_LIBS.some((re) => re.test(d)));
  const tokenFile = files.find((f) => f.content !== null && /\.css$/.test(f.path) && /@theme\b|:root\s*\{[^}]*--[\w-]+\s*:/.test(f.content));
  const tailwindConfig = firstExisting('tailwind.config.ts', 'tailwind.config.js', 'tailwind.config.mjs');
  const strict = compilerOptions.strict === true;

  const practices: Practice[] = [
    practice('schema-validated-boundaries', usesSchemaLib && schemaHits.length >= 3, schemaHits, `${schemaHits.length} parse call sites in ${filesWith('schemaParse')} files`),
    practice('typed-env', typedEnv !== undefined && envFiles <= 3, typedEnv ? (typedEnv.hits.envRead ?? []) : [], `environment read in ${envFiles} file(s)${envHits.length ? '' : ' (none)'}`),
    practice('exhaustive-switch', exhaustive.length >= 1, exhaustive, `${exhaustive.length} exhaustiveness guards`),
    practice('error-boundaries', boundaries.length >= 1, boundaries, `${boundaries.length} error boundaries`),
    practice('result-types', RESULT_LIBS.some(hasDep) || results.length >= 3, results, `${results.length} Result-style return sites`),
    practice('strict-typescript', strict, tsconfigText ? fileEvidence(paths.has('tsconfig.json') ? 'tsconfig.json' : 'tsconfig.base.json', /"strict"/) : [], strict ? `strict${compilerOptions.noUncheckedIndexedAccess === true ? ' + noUncheckedIndexedAccess' : ''}` : 'strict is off or there is no tsconfig'),
    practice('automated-tests', testFiles >= 3 && TEST_LIBS.some(hasDep) && testFiles / Math.max(1, nonTestSources) >= 0.08, files.filter((f) => TEST_FILE.test(f.path)).slice(0, MAX_EVIDENCE).map((f) => ({ file: f.path, line: 1, excerpt: '' })), `${testFiles} test files for ${nonTestSources} source files`),
    practice('ci-verification', verifyingWorkflow !== undefined, verifyingWorkflow ? fileEvidence(verifyingWorkflow.path, /\b(?:test|typecheck|tsc|lint)\b/i) : [], `${workflows.length} workflow file(s)`),
    practice('lint-and-format', lintConfig !== undefined && (formatConfig !== undefined || pkg?.prettier !== undefined), [lintConfig, formatConfig].filter((p): p is string => p !== undefined).map((p) => ({ file: p, line: 1, excerpt: '' })), `lint: ${lintConfig ?? 'none'}, format: ${formatConfig ?? 'none'}`),
    practice('import-boundaries', boundaryTool !== undefined && importCycles === 0, boundaryTool ? fileEvidence('package.json', new RegExp(boundaryTool.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&'))) : [], `${importCycles} import cycle(s)${boundaryTool ? `, enforced with ${boundaryTool}` : ', not enforced'}`),
    practice('accessible-primitives', a11yDeps.length >= 1, a11yDeps.length ? fileEvidence('package.json', new RegExp(a11yDeps[0]!.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&'))) : [], a11yDeps.length ? a11yDeps.slice(0, 4).join(', ') : 'no headless primitive library'),
    practice('design-tokens', tokenFile !== undefined || tailwindConfig !== undefined, tokenFile ? fileEvidence(tokenFile.path, /@theme\b|--[\w-]+\s*:/) : tailwindConfig ? [{ file: tailwindConfig, line: 1, excerpt: '' }] : [], tokenFile ? `tokens in ${tokenFile.path}` : (tailwindConfig ?? 'no token source found')),
  ];

  const dirCounts = new Map<string, number>();
  for (const f of files) {
    const dir = f.path.includes('/') ? f.path.split('/')[0]! : '.';
    dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
  }

  return {
    totalFiles: files.length,
    sourceFiles: scans.length,
    loc,
    partial: partial || sources.length >= MAX_PARSED_FILES,
    packageManager: paths.has('pnpm-lock.yaml') ? 'pnpm' : paths.has('yarn.lock') ? 'yarn' : paths.has('bun.lockb') || paths.has('bun.lock') ? 'bun' : paths.has('package-lock.json') ? 'npm' : 'unknown',
    dependencies,
    scripts,
    metrics: {
      anyCount,
      anyPerKloc: loc === 0 ? 0 : Number(((anyCount / loc) * 1000).toFixed(2)),
      suppressions,
      importCycles,
      testFiles,
      testRatio: Number((testFiles / Math.max(1, nonTestSources)).toFixed(3)),
      meanComplexity: scans.length === 0 ? 0 : Number((scans.reduce((n, s) => n + s.complexity, 0) / scans.length).toFixed(1)),
      mostComplex: [...scans].sort((a, b) => b.complexity - a.complexity).slice(0, 5).map((s) => ({ file: s.path, complexity: s.complexity })),
    },
    topLevelDirs: [...dirCounts].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([dir, count]) => ({ dir, files: count })),
    practices,
    modules: scans.map(({ rawImports: _raw, hits: _hits, ...module }) => module),
  };
}

function scanFile(path: string, content: string): FileScan {
  const kind = /\.tsx$/.test(path) ? ts.ScriptKind.TSX : /\.jsx$/.test(path) ? ts.ScriptKind.JSX : /\.[cm]?js$/.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, false, kind);
  const lines = content.split('\n');
  const scan: FileScan = { path, loc: lines.filter((l) => l.trim() !== '').length, imports: [], externals: [], exports: [], complexity: 1, anyCount: 0, jsx: false, rawImports: [], hits: {} };
  const hit = (key: keyof FileScan['hits'], node: ts.Node): void => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
    const list = (scan.hits[key] ??= []);
    if (list.length < 40) list.push({ file: path, line: line + 1, excerpt: (lines[line] ?? '').trim().slice(0, 160) });
  };
  const exported = (node: ts.Node): boolean => ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false);

  const visit = (node: ts.Node): void => {
    switch (node.kind) {
      case ts.SyntaxKind.IfStatement:
      case ts.SyntaxKind.ConditionalExpression:
      case ts.SyntaxKind.ForStatement:
      case ts.SyntaxKind.ForInStatement:
      case ts.SyntaxKind.ForOfStatement:
      case ts.SyntaxKind.WhileStatement:
      case ts.SyntaxKind.DoStatement:
      case ts.SyntaxKind.CaseClause:
      case ts.SyntaxKind.CatchClause:
        scan.complexity += 1;
        break;
      case ts.SyntaxKind.AnyKeyword:
        scan.anyCount += 1;
        break;
      case ts.SyntaxKind.JsxElement:
      case ts.SyntaxKind.JsxSelfClosingElement:
      case ts.SyntaxKind.JsxFragment:
        scan.jsx = true;
        break;
    }

    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      if (op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) scan.complexity += 1;
    } else if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      scan.rawImports.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node)) {
      const [arg] = node.arguments;
      const callee = node.expression;
      if (arg && ts.isStringLiteral(arg) && (callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === 'require'))) scan.rawImports.push(arg.text);
      if (ts.isPropertyAccessExpression(callee) && ['parse', 'safeParse', 'parseAsync', 'safeParseAsync'].includes(callee.name.text) && !(ts.isIdentifier(callee.expression) && ['JSON', 'Number', 'Date', 'path', 'url', 'qs'].includes(callee.expression.text))) hit('schemaParse', node);
      if (ts.isIdentifier(callee) && /^(?:assertNever|assertUnreachable|exhaustive(?:Check)?|unreachable)$/.test(callee.text)) hit('exhaustive', node);
      if (ts.isIdentifier(callee) && /^(?:ok|err|Ok|Err)$/.test(callee.text)) hit('resultType', node);
    } else if (ts.isPropertyAccessExpression(node)) {
      const target = node.expression;
      if (node.name.text === 'env' && ((ts.isIdentifier(target) && target.text === 'process') || (ts.isMetaProperty(target) && target.name.text === 'meta'))) hit('envRead', node);
    } else if (ts.isSatisfiesExpression(node) && node.type.kind === ts.SyntaxKind.NeverKeyword) {
      hit('exhaustive', node);
    } else if (ts.isVariableDeclaration(node) && node.type?.kind === ts.SyntaxKind.NeverKeyword) {
      hit('exhaustive', node);
    } else if ((ts.isMethodDeclaration(node) || ts.isPropertyDeclaration(node)) && ts.isIdentifier(node.name) && (node.name.text === 'componentDidCatch' || node.name.text === 'getDerivedStateFromError')) {
      hit('errorBoundary', node);
    } else if (ts.isJsxOpeningLikeElement(node) && ts.isIdentifier(node.tagName) && /ErrorBoundary$/.test(node.tagName.text)) {
      hit('errorBoundary', node);
    }

    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);

  for (const statement of sf.statements) {
    if (ts.isExportAssignment(statement)) scan.exports.push('default');
    else if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) scan.exports.push(...statement.exportClause.elements.map((e) => e.name.text));
    else if (!exported(statement)) continue;
    else if (ts.isVariableStatement(statement)) scan.exports.push(...statement.declarationList.declarations.flatMap((d) => (ts.isIdentifier(d.name) ? [d.name.text] : [])));
    else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) scan.exports.push(statement.name.text);
  }
  scan.exports = scan.exports.slice(0, 60);
  return scan;
}

function pathAliases(compilerOptions: Record<string, unknown>): [string, string][] {
  const baseUrl = typeof compilerOptions.baseUrl === 'string' ? compilerOptions.baseUrl : '.';
  const paths = compilerOptions.paths;
  if (paths === null || typeof paths !== 'object') return [];
  const out: [string, string][] = [];
  for (const [pattern, targets] of Object.entries(paths as Record<string, unknown>)) {
    const target = Array.isArray(targets) && typeof targets[0] === 'string' ? targets[0] : null;
    if (target === null || !pattern.endsWith('/*') || !target.endsWith('/*')) continue;
    out.push([pattern.slice(0, -1), posix.normalize(posix.join(baseUrl, target.slice(0, -1)))]);
  }
  return out;
}

function packageName(spec: string): string {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
}

function parseJson(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Number of strongly connected components with more than one module (Tarjan, iterative). */
function countCycles(modules: readonly { path: string; imports: string[] }[]): number {
  const graph = new Map(modules.map((m) => [m.path, m.imports]));
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  let next = 0;
  let cycles = 0;

  for (const root of graph.keys()) {
    if (index.has(root)) continue;
    const work: { node: string; edge: number }[] = [{ node: root, edge: 0 }];
    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      const { node } = frame;
      if (frame.edge === 0) {
        index.set(node, next);
        low.set(node, next);
        next += 1;
        stack.push(node);
        onStack.add(node);
      }
      const edges = graph.get(node) ?? [];
      if (frame.edge < edges.length) {
        const to = edges[frame.edge++]!;
        if (!graph.has(to)) continue;
        if (!index.has(to)) work.push({ node: to, edge: 0 });
        else if (onStack.has(to)) low.set(node, Math.min(low.get(node)!, index.get(to)!));
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) low.set(parent.node, Math.min(low.get(parent.node)!, low.get(node)!));
      if (low.get(node) === index.get(node)) {
        let size = 0;
        let member: string;
        do {
          member = stack.pop()!;
          onStack.delete(member);
          size += 1;
        } while (member !== node);
        if (size > 1) cycles += 1;
      }
    }
  }
  return cycles;
}
