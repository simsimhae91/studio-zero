import { z } from 'zod';
import type { Project } from '@studio-zero/protocol';
import type { EventLog } from '../events/EventLog.ts';
import type { McpRegistry } from '../mcp/McpRegistry.ts';
import type { Action, Actor } from '../policy/actions.ts';
import { ApprovalDeniedError, PolicyDeniedError, type PolicyEngine } from '../policy/PolicyEngine.ts';
import { SandboxError, type OrbStackManager, slotOf } from '../sandbox/OrbStackManager.ts';
import { untrusted, type UntrustedSource } from '../trust/dataBlock.ts';
import { errorMessage, excerpt, newId } from '../util/core.ts';
import type { ProjectArms } from '../arms/ProjectArms.ts';
import { MIGRATIONS_DIR, SEED_FILE } from '../arms/schema.ts';
import { ARMS_KIT_DIR, ENV_FILE } from '../arms/kit.ts';
import type { ImageDesk } from '../qa/ImageDesk.ts';
import { MOCKUP_DIR, MOCKUP_FILES, renderMockupCheck, type MockupRenderer } from '../qa/MockupRenderer.ts';
import { renderScenarioFeedback, type ScenarioRunnerLike } from '../qa/ScenarioRunner.ts';
import { SCREEN_SPEC_FILE, readScreenSpec } from '../scratch/ScreenSpec.ts';
import { WEB_GUIDANCE_VERSION } from './houseBar.ts';
import { THEME_SEED_FILE, ThemeChoice, chosenTheme, writeProjectTheme } from './themeSeed.ts';

export interface ToolContext {
  project: Project;
  taskId: string;
  signal?: AbortSignal;
  onWaiting?: (waiting: boolean) => void;
  /** Which of the task's engines this is, when several work at once. Shown beside its calls. */
  lane?: string;
}

export interface ToolOutcome {
  content: string;
  isError: boolean;
}

interface ToolDef<Schema extends z.ZodObject = z.ZodObject> {
  name: string;
  description: string;
  schema: Schema;
  /** The policy action this call represents. Evaluated before `run`. `null` only where `run` authorizes a more exact action itself. */
  action: (input: z.infer<Schema>, project: Project, taskId: string) => Action | null;
  /** Where the result comes from, as the model is told. Default: the sandbox. */
  source?: UntrustedSource;
  /** What the event stream shows for this call. Kept short; never the full file body. */
  summarize: (input: z.infer<Schema>) => string;
  run: (input: z.infer<Schema>, ctx: ToolContext) => Promise<{ text: string; ok: boolean; exitCode: number | null }>;
}

const MAX_TOOL_OUTPUT = 30_000;

function define<Schema extends z.ZodObject>(def: ToolDef<Schema>): ToolDef {
  return def as unknown as ToolDef;
}

/**
 * The hands of every coding engine. The native Claude loop and the bridged vendor CLIs get the same tools, and
 * every call takes the same path: schema validation → PolicyEngine (actor `agent`) → the sandbox, or for the
 * two external-tool calls the daemon's MCP client → result wrapped as untrusted data. An engine has no other
 * way to touch a project or the outside world.
 */
export class Toolbox {
  readonly #sandboxes: OrbStackManager;
  #images: Pick<ImageDesk, 'make'> | null = null;
  #mockups: Pick<MockupRenderer, 'check'> | null = null;
  #arms: Pick<ProjectArms, 'applySchema'> | null = null;
  #scenarios: ScenarioRunnerLike | null = null;
  readonly #policy: PolicyEngine;
  readonly #events: EventLog;
  readonly #mcp: McpRegistry;
  readonly #tools: ToolDef[];

  constructor(deps: { sandboxes: OrbStackManager; policy: PolicyEngine; events: EventLog; mcp: McpRegistry }) {
    this.#mcp = deps.mcp;
    this.#sandboxes = deps.sandboxes;
    this.#policy = deps.policy;
    this.#events = deps.events;
    this.#tools = this.#buildTools();
  }

  /** Tool definitions in a stable order (a changing tool list would invalidate the prompt cache every turn). */
  definitions(): { name: string; description: string; inputSchema: Record<string, unknown> }[] {
    return this.#tools.map((t) => ({ name: t.name, description: t.description, inputSchema: z.toJSONSchema(t.schema) as Record<string, unknown> }));
  }

  async call(ctx: ToolContext, name: string, rawInput: unknown): Promise<ToolOutcome> {
    const tool = this.#tools.find((t) => t.name === name);
    if (!tool) return { content: `unknown tool: ${name}`, isError: true };
    const parsed = tool.schema.safeParse(rawInput);
    if (!parsed.success) return { content: `invalid input for ${name}: ${z.prettifyError(parsed.error)}`, isError: true };

    const scope = { projectId: ctx.project.id, taskId: ctx.taskId };
    const callId = newId('call');
    const actor: Actor = { type: 'agent', taskId: ctx.taskId };
    this.#events.emit(scope, { type: 'tool.call', callId, tool: name, input: tool.summarize(parsed.data).slice(0, 2000), ...(ctx.lane === undefined ? {} : { lane: ctx.lane }) });

    const started = Date.now();
    let result: { text: string; ok: boolean; exitCode: number | null };
    try {
      const action = tool.action(parsed.data, ctx.project, ctx.taskId);
      if (action) await this.#policy.authorize(actor, action, { taskId: ctx.taskId, signal: ctx.signal, onWaiting: ctx.onWaiting });
      result = await tool.run(parsed.data, ctx);
    } catch (err) {
      // Policy outcomes and sandbox failures go back to the model as tool errors. It can adapt; it cannot override.
      if (!(err instanceof PolicyDeniedError || err instanceof ApprovalDeniedError || err instanceof SandboxError)) throw err;
      result = { text: errorMessage(err), ok: false, exitCode: null };
    }
    this.#events.emit(scope, {
      type: 'tool.result',
      callId,
      ok: result.ok,
      exitCode: result.exitCode,
      durationMs: Date.now() - started,
      preview: excerpt(result.text, 1500),
    });
    return {
      content: untrusted(tool.source ?? 'sandbox-output', excerpt(result.text, MAX_TOOL_OUTPUT), { tool: name, ...(result.exitCode === null ? {} : { exit: result.exitCode }) }),
      isError: !result.ok,
    };
  }

  /** Whether a tool can change the workspace. Read-only turns do not need a checkpoint. */
  mutates(name: string): boolean {
    // The first schema a project applies brings the backend's kit into the workspace.
    return name === 'bash' || name === 'write_file' || name === 'edit_file' || name === 'set_theme' || name === 'generate_image' || name === 'apply_schema';
  }

  /**
   * Time travel: snapshots the workspace after a turn that may have changed it, so any point in a task can be
   * returned to or forked from. Best effort: a failed snapshot is not a reason to fail the work.
   */
  async checkpointTurn(ctx: ToolContext, label: string): Promise<void> {
    // A slot is not a place to go back to: what is made there is its branch (see `Harness.run`).
    if (slotOf(ctx.project) > 0) return;
    try {
      const checkpoint = await this.#sandboxes.checkpoint(ctx.project, label.replace(/\s+/g, ' ').slice(0, 100), ctx.taskId);
      this.#events.emit({ projectId: ctx.project.id, taskId: ctx.taskId }, { type: 'checkpoint.created', checkpointId: checkpoint.id, label: checkpoint.label });
    } catch {
      // The task-level checkpoint taken before the task started still exists.
    }
  }

  /** The picture desk is built after the engines, which are built after this: it is handed over once it exists. */
  useImages(images: Pick<ImageDesk, 'make'>): void {
    this.#images = images;
  }

  /** The mock-up renderer is built after the engines too. */
  /** A project's backend. Its schema is applied on the host, where the database's address and keys stay. */
  useArms(arms: Pick<ProjectArms, 'applySchema'>): void {
    this.#arms = arms;
  }

  useMockups(mockups: Pick<MockupRenderer, 'check'>): void {
    this.#mockups = mockups;
  }

  /** What walks a product's scenarios when its work is checked: a builder may have one walked while it works. */
  useScenarios(scenarios: ScenarioRunnerLike): void {
    this.#scenarios = scenarios;
  }

  #buildTools(): ToolDef[] {
    const sandboxes = this.#sandboxes;
    const events = this.#events;
    const images = (): Pick<ImageDesk, 'make'> | null => this.#images;
    const mockups = (): Pick<MockupRenderer, 'check'> | null => this.#mockups;
    const arms = (): Pick<ProjectArms, 'applySchema'> | null => this.#arms;
    const scenarios = (): ScenarioRunnerLike | null => this.#scenarios;
    const mcp = this.#mcp;
    return [
      define({
        name: 'bash',
        description:
          'Run a bash command in the project sandbox (Debian, Node 24, git; working directory /workspace). Use it to install dependencies, run builds, tests and linters, and inspect the project. Each call is a fresh shell: environment variables and `cd` do not persist between calls, so chain steps with && when they depend on each other. Long-running servers must not be started here; the harness runs the dev server itself.',
        schema: z.object({
          command: z.string().min(1).max(20_000).describe('The command line to execute.'),
          timeout_sec: z.number().int().min(1).max(1800).optional().describe('Kill the command after this many seconds. Default 600.'),
        }),
        action: (input, project) => ({ kind: 'sandbox.exec', projectId: project.id, command: input.command }),
        summarize: (input) => input.command,
        run: async (input, ctx) => {
          const res = await sandboxes.exec(ctx.project, input.command, { timeoutSec: input.timeout_sec, signal: ctx.signal });
          const parts = [res.stdout, res.stderr ? `--- stderr ---\n${res.stderr}` : '', res.timedOut ? '--- command timed out ---' : '', res.truncated ? '--- output truncated ---' : ''];
          return { text: parts.filter(Boolean).join('\n') || '(no output)', ok: res.exitCode === 0, exitCode: res.exitCode };
        },
      }),
      define({
        name: 'read_file',
        description: 'Read a text file from the workspace. Returns the content with 1-based line numbers. For large files pass offset and limit to read a window.',
        schema: z.object({
          path: z.string().min(1).max(1000).describe('Path relative to /workspace.'),
          offset: z.number().int().min(1).optional().describe('First line to return (1-based).'),
          limit: z.number().int().min(1).max(4000).optional().describe('Maximum number of lines to return. Default 1500.'),
        }),
        action: (input, project) => ({ kind: 'sandbox.exec', projectId: project.id, command: `read ${input.path}` }),
        summarize: (input) => input.path,
        run: async (input, ctx) => {
          const { content, truncated } = await sandboxes.readFile(ctx.project, input.path);
          const lines = content.split('\n');
          const start = (input.offset ?? 1) - 1;
          const window = lines.slice(start, start + (input.limit ?? 1500));
          const numbered = window.map((line, i) => `${String(start + i + 1).padStart(5)}\t${line}`).join('\n');
          const more = start + window.length < lines.length || truncated ? `\n… ${lines.length - start - window.length} more lines` : '';
          return { text: numbered + more, ok: true, exitCode: null };
        },
      }),
      define({
        name: 'write_file',
        description: 'Create or overwrite a file in the workspace with the given content. Parent directories are created. Prefer edit_file for changing part of an existing file.',
        schema: z.object({
          path: z.string().min(1).max(1000).describe('Path relative to /workspace.'),
          content: z.string().max(2_000_000).describe('The complete new file content.'),
        }),
        action: (input, project) => ({ kind: 'sandbox.write', projectId: project.id, path: input.path }),
        summarize: (input) => `${input.path} (${input.content.length} chars)`,
        run: async (input, ctx) => {
          await sandboxes.writeFile(ctx.project, input.path, input.content);
          return { text: `wrote ${input.path}`, ok: true, exitCode: null };
        },
      }),
      define({
        name: 'set_theme',
        description:
          `Set the project's palette and shape from its subject. Give the brand colour (hue, chroma, lightness), how the neutrals lean, the corners, the face, and one sentence on where they come from. The studio writes ${THEME_SEED_FILE}, regenerates .studio-zero/theme.css from it and puts the face's font file beside it, with every text and background pair solved for contrast: bg-brand with text-on-brand is the colour at full strength, bg-brand-soft its wash, text-accent its hue as text. Use this instead of editing the stylesheet. Do it once, before drawing or building, and again only when the owner asks for a different look.`,
        schema: ThemeChoice,
        action: (_input, project) => ({ kind: 'sandbox.write', projectId: project.id, path: THEME_SEED_FILE }),
        summarize: (input) => `hue ${input.hue}, chroma ${input.chroma}, lightness ${input.lightness}, ${input.corners} corners, set in ${input.face}`,
        run: async (input, ctx) => {
          const theme = chosenTheme(input);
          await writeProjectTheme(sandboxes, ctx.project, theme);
          return { text: theme.report, ok: true, exitCode: null };
        },
      }),
      define({
        name: 'apply_schema',
        description:
          `Give the product its backend and bring its database up to date. The studio runs this project's own Supabase beside the sandbox: sign-up and sign-in, Postgres, file storage, realtime. Write the schema as SQL files in ${MIGRATIONS_DIR}/ (0001_<what>.sql, 0002_...: applied in name order, each once, so change what is already in with a new file and never by editing an old one) and demo rows in ${SEED_FILE} (applied again whenever it changes: write every insert "on conflict do nothing"). Then call this. The first call starts the backend, writes its address and publishable key into ${ENV_FILE} under the names your framework reads, and puts a client in ${ARMS_KIT_DIR} with a README.md of the rules. Everything is applied in one transaction and refused as a whole, leaving the database as it was, when a statement fails, when a table in public has no row level security or no policy, or when a view there is not made with (security_invoker = true): the publishable key ships to every browser, so the policies are all that keeps one user's rows from another. Grant each table to the roles that may use it (authenticated, and anon only for what a visitor may see). There is no admin key and no database address in this sandbox, and none is needed.`,
        schema: z.object({}),
        action: (_input, project) => ({ kind: 'sandbox.exec', projectId: project.id, command: 'apply_schema' }),
        summarize: () => `${MIGRATIONS_DIR}, ${SEED_FILE}`,
        run: async (_input, ctx) => {
          const backend = arms();
          if (!backend) return { text: 'The studio cannot run a backend here.', ok: false, exitCode: null };
          // The database is one for the whole project, and this is a copy of the project at work on a small edit
          // beside whatever else is running: a schema changed from here would change it under all of them.
          if (slotOf(ctx.project) > 0) return { text: 'Not here. This is a small edit, in a copy of the project, and the database is one for the whole project and for every task at work on it. A change that needs the schema is not a small edit: make no change to supabase/, and say in your final message that this needs a build.', ok: false, exitCode: null };
          const result = await backend.applySchema(ctx.project);
          return { text: result.text, ok: result.ok, exitCode: null };
        },
      }),
      define({
        name: 'walk_scenario',
        description:
          `Have the studio carry out one scenario of ${SCREEN_SPEC_FILE} on the running product, the way it does when it checks your work: as people it makes up, who sign up for real against the backend, press the marked controls step by step, and reload at the end. It tells you whether the scenario reached its end and, where it did not, the step it stopped at, what the screen said, what the backend refused, and the rows those people had made in each table by then. The backend does not answer from inside the sandbox, so this is how you see what the product really does against it: walk a feature's scenario when you have built the feature, and again after each fix, rather than reasoning about what it would do. A scenario that follows another ("after") is walked with the ones it follows. About a minute. The whole check (every scenario, a restart of the backend, a stranger's read) is still made when you stop.`,
        schema: z.object({ scenario: z.string().min(1).max(40).describe(`The scenario's "id" in ${SCREEN_SPEC_FILE}.`) }),
        action: (input, project) => ({ kind: 'sandbox.exec', projectId: project.id, command: `walk_scenario ${input.scenario.replace(/[^a-z0-9-]/gi, '')}` }),
        // What the product's screens and its backend said comes back in the answer.
        source: 'browser-page',
        summarize: (input) => input.scenario,
        run: async (input, ctx) => {
          const walker = scenarios();
          if (!walker) return { text: 'The studio cannot walk a product here. The scenarios are walked when you stop.', ok: false, exitCode: null };
          const file = await sandboxes.exec(ctx.project, `[ -f ${SCREEN_SPEC_FILE} ] && head -c 262144 ${SCREEN_SPEC_FILE}`, { timeoutSec: 20, maxOutputBytes: 300_000 });
          const read = file.exitCode !== 0 || file.stdout.trim() === '' ? null : readScreenSpec(file.stdout, { works: true, draft: true, wide: true });
          if (!read) return { text: `${SCREEN_SPEC_FILE} is missing: there is no scenario to walk until the plan is written.`, ok: false, exitCode: null };
          if (!read.ok) return { text: `${SCREEN_SPEC_FILE} does not hold yet, so its scenarios cannot be walked. Put these right first:\n${read.problems.map((problem) => `- ${problem}`).join('\n')}`, ok: false, exitCode: null };
          const byId = new Map(read.spec.scenarios.map((scenario) => [scenario.id, scenario]));
          if (!byId.has(input.scenario)) return { text: `The plan has no scenario "${input.scenario}". Its scenarios are: ${[...byId.keys()].join(', ') || '(none)'}.`, ok: false, exitCode: null };
          // The ones it follows first, in the plan's order: what the second person sees is what the first one made.
          const wanted = new Set<string>();
          for (let id: string | null | undefined = input.scenario; id && byId.has(id) && !wanted.has(id); id = byId.get(id)!.after?.trim()) wanted.add(id);
          const chain = read.spec.scenarios.filter((scenario) => wanted.has(scenario.id));
          try {
            // Measured as it goes: a change to how a screen is laid out cannot be seen from here any other way.
            // (The first quick fixes on a real product widened a button's box, said its label "should now fit",
            // and were measured afterwards with the label still on two lines.)
            const outcome = await walker.run(ctx.project, { ...read.spec, scenarios: chain }, { ...(ctx.signal ? { signal: ctx.signal } : {}), brief: true, look: true });
            const heavy = [...new Set((outcome.looks ?? []).flatMap((look) => look.findings.filter((finding) => finding.severity !== 'minor').map((finding) => `- Screen ${look.screen}, ${finding.severity}, ${finding.rule}: ${finding.message}${finding.fix ? ` ${finding.fix}` : ''}`)))];
            const screens = [...new Set((outcome.looks ?? []).map((look) => look.screen))];
            const measured = screens.length === 0 ? '' : heavy.length === 0 ? `\nThe screens it stood on (${screens.join(', ')}) were measured at the size walked, in each state a press put them in: nothing above minor.` : `\nThe screens it stood on (${screens.join(', ')}) were measured at the size walked, in each state a press put them in. Above minor:\n${heavy.slice(0, 20).join('\n')}`;
            if (outcome.passed) return { text: `Scenario "${input.scenario}" reached its end${chain.length > 1 ? ` (walked after ${chain.slice(0, -1).map((scenario) => `"${scenario.id}"`).join(', ')})` : ''}, and its last outcome was still on screen after a reload.${measured}`, ok: true, exitCode: null };
            return { text: `${renderScenarioFeedback(outcome)}${measured}`, ok: false, exitCode: null };
          } catch (err) {
            if (ctx.signal?.aborted) throw err;
            return { text: `The studio could not walk it this time (${errorMessage(err)}). That says nothing about the product; carry on, it is walked when you stop.`, ok: false, exitCode: null };
          }
        },
      }),
      define({
        name: 'generate_image',
        description:
          'Have one picture made for the product and saved into the workspace: a photograph or an illustration of what the product is about (the food, the place, the object, a character or a scene of a game). It is made by an image model on the owner\'s subscription and each one costs them, so ask for the few pictures the design depends on and describe each fully: subject, setting, light, angle, style, what must not be in it. Not for icons, logos, charts, screenshots of interfaces, or text. The picture is saved at the path you give (.jpg for photographs, .png when it needs transparency), no larger than 1600px on its long side.',
        schema: z.object({
          description: z.string().min(20).max(1500).describe('What to draw, in full: subject, setting, light, angle, style, and what to leave out.'),
          path: z.string().regex(/^[A-Za-z0-9_][A-Za-z0-9_./-]{0,180}\.(png|jpe?g)$/).refine((p) => !p.includes('..'), 'no ".." in the path').describe('Where to save it, relative to /workspace, ending in .jpg, .jpeg or .png.'),
          shape: z.enum(['landscape', 'portrait', 'square']).describe('The proportions of the picture.'),
          purpose: z.string().min(10).max(200).describe('One sentence: where in the product this picture goes and what it is there to do.'),
        }),
        action: (input, project, taskId) => ({ kind: 'image.generate', projectId: project.id, taskId, path: input.path }),
        summarize: (input) => `${input.path}: ${input.description.slice(0, 120)}`,
        run: async (input, ctx) => {
          const desk = images();
          if (!desk) return { text: 'No image generator is connected. Design without generated pictures.', ok: false, exitCode: null };
          try {
            const made = await desk.make({ project: ctx.project, taskId: ctx.taskId, ...(ctx.signal ? { signal: ctx.signal } : {}) }, input);
            return { text: `saved ${made.path} (${made.width}x${made.height}, ${Math.round(made.bytes / 1024)} KB). Give it real alt text, its width and height, and lazy loading below the first screen.`, ok: true, exitCode: null };
          } catch (err) {
            if (ctx.signal?.aborted) throw err;
            return { text: `The picture was not made: ${errorMessage(err)}. Design without it, or ask once more with a different description.`, ok: false, exitCode: null };
          }
        },
      }),
      define({
        name: 'check_mockup',
        description:
          `Have the studio open one mock-up page of a design task (${MOCKUP_FILES.map((name) => `${MOCKUP_DIR}/${name}`).join(', ')}) exactly as it will be shown and judged, and tell you what it finds: whether each task of the core flow in docs/screens.json can be carried out by pressing the marked controls, and every measured defect at every size in light and in dark (contrast, control size, overflow, clipped text, type and spacing off the scale, copy habits, controls that give nothing back while held, focus that cannot be seen), each with its selector and a fix. Call it after writing or changing a page and repeat until nothing holds the page back. The owner is shown the page as it stands each time you check it. This is the only browser you need: do not install one, and do not write scripts to look at the pages.`,
        schema: z.object({ file: z.enum(MOCKUP_FILES.map((name) => `${MOCKUP_DIR}/${name}`) as [string, ...string[]]).describe('The page to check, relative to /workspace.') }),
        action: (input, project) => ({ kind: 'sandbox.exec', projectId: project.id, command: `check ${input.file}` }),
        // The page's own words come back in the findings.
        source: 'browser-page',
        summarize: (input) => input.file,
        run: async (input, ctx) => {
          const renderer = mockups();
          if (!renderer) return { text: 'The studio has no browser to check pages with here. Read the page against the rules yourself.', ok: false, exitCode: null };
          const check = await renderer.check(ctx.project, input.file, ctx.signal);
          if (check.status === 'missing') return { text: `${input.file} does not exist, or is empty.`, ok: false, exitCode: null };
          if (check.status === 'not-drawn') return { text: 'The studio could not open the page this time (its browser did not answer). That says nothing about the page; carry on, it is measured when you stop.', ok: false, exitCode: null };
          // What was drawn to measure it is what the owner sees while the task is still running.
          events.emit({ projectId: ctx.project.id, taskId: ctx.taskId }, { type: 'mockups.drafted', option: check.option });
          return { text: renderMockupCheck(input.file, check), ok: true, exitCode: null };
        },
      }),
      define({
        name: 'edit_file',
        description:
          'Replace an exact string in a workspace file. old_string must match the file byte-for-byte (including indentation) and must occur exactly once unless replace_all is true; include enough surrounding lines to make it unique.',
        schema: z.object({
          path: z.string().min(1).max(1000).describe('Path relative to /workspace.'),
          old_string: z.string().min(1).describe('Exact text to replace.'),
          new_string: z.string().describe('Replacement text.'),
          replace_all: z.boolean().optional().describe('Replace every occurrence instead of requiring a unique match.'),
        }),
        action: (input, project) => ({ kind: 'sandbox.write', projectId: project.id, path: input.path }),
        summarize: (input) => input.path,
        run: async (input, ctx) => {
          const { content, truncated } = await sandboxes.readFile(ctx.project, input.path, 2_000_000);
          if (truncated) return { text: `${input.path} is too large to edit in place; rewrite the relevant part with bash`, ok: false, exitCode: null };
          const occurrences = content.split(input.old_string).length - 1;
          if (occurrences === 0) return { text: `old_string was not found in ${input.path}`, ok: false, exitCode: null };
          if (occurrences > 1 && !input.replace_all) {
            return { text: `old_string occurs ${occurrences} times in ${input.path}; add context to make it unique or set replace_all`, ok: false, exitCode: null };
          }
          const next = input.replace_all ? content.replaceAll(input.old_string, input.new_string) : content.replace(input.old_string, () => input.new_string);
          await sandboxes.writeFile(ctx.project, input.path, next);
          return { text: `edited ${input.path} (${occurrences} replacement${occurrences === 1 ? '' : 's'})`, ok: true, exitCode: null };
        },
      }),
      define({
        name: 'web_guidance',
        description:
          'Look up how the web platform does something today before writing it by hand. Modern Web Guidance (from the Chrome, Edge, Firefox and MDN teams; about 200 guides) covers native UI primitives (dialog, popover, menu, tooltip, accordion, tabs, carousel, drawer, toast), forms (when to validate, autofill, styling a select, one-time codes), motion (entry and exit, view transitions, scroll effects), layout and CSS (container queries, :has(), anchor positioning, fluid sizing), type and colour (text wrapping, font fallbacks, light-dark, contrast-color), accessibility, performance and security. action "search" finds guides for a need said in plain words (give query); "retrieve" returns up to two guides in full, with the pattern, the gotchas and the fallback for browsers that lack it (give ids from a search); "scan" reads the project for legacy patterns and lists candidates, each with the conditions under which it holds or should be dropped (path defaults to the whole project). It runs in the sandbox and sends nothing out. For web projects.',
        schema: z.object({
          action: z.enum(['search', 'retrieve', 'scan']),
          query: z.string().min(3).max(200).optional().describe('For search: what you are building, in a few plain words ("animate a dialog and its backdrop").'),
          ids: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]{1,60}$/)).min(1).max(2).optional().describe('For retrieve: one or two guide ids from a search.'),
          path: z.string().regex(/^[A-Za-z0-9_.][A-Za-z0-9_./-]{0,200}$/).refine((p) => !p.includes('..'), 'no ".." in the path').optional().describe('For scan: a directory or file relative to /workspace. Default: the project.'),
        }),
        action: (input, project) => ({ kind: 'sandbox.exec', projectId: project.id, command: `web_guidance ${input.action}` }),
        // The guides are a third party's text.
        source: 'external-tool',
        summarize: (input) => `${input.action} ${input.action === 'search' ? (input.query ?? '') : input.action === 'retrieve' ? (input.ids ?? []).join(', ') : (input.path ?? '.')}`.trim(),
        run: async (input, ctx) => {
          if (input.action === 'search' && input.query === undefined) return { text: 'search needs a query.', ok: false, exitCode: null };
          if (input.action === 'retrieve' && input.ids === undefined) return { text: 'retrieve needs ids: one or two guide ids from a search.', ok: false, exitCode: null };
          // The query is a model's words on a command line: quoted whole, so nothing in it is read as shell.
          const quoted = (text: string): string => `'${text.replaceAll("'", `'\\''`)}'`;
          const args = input.action === 'search' ? `search ${quoted(input.query!)}` : input.action === 'retrieve' ? `retrieve ${quoted(input.ids!.join(','))}` : `legacy-scan ${quoted(input.path ?? '.')} --json`;
          // The package reports each search to its maker unless told not to. A query is the product described in
          // a few words, so it never leaves: the opt-out is set here, for every call, and not left to an engine.
          // Written to a file and read back: with its output on a pipe the package saves a long guide somewhere of
          // its own choosing and prints where, for an agent with a file tool that can reach it. An engine here has none.
          const res = await sandboxes.exec(ctx.project, `cd /workspace && out=$(mktemp) && DISABLE_TELEMETRY=1 NO_COLOR=1 npx -y modern-web-guidance@${WEB_GUIDANCE_VERSION} ${args} > "$out"; code=$?; cat "$out"; rm -f "$out"; exit $code`, { timeoutSec: 180, signal: ctx.signal });
          const text = res.stdout.trim();
          if (res.exitCode !== 0 || text === '') return { text: `The guidance could not be read (${excerpt(res.stderr.trim() || 'no output', 400)}). Build it from what you know, with the platform's own element where there is one.`, ok: false, exitCode: res.exitCode };
          return { text: text === '[]' ? 'No guide matches. Say the need differently, or build it from what you know.' : text, ok: true, exitCode: res.exitCode };
        },
      }),
      // Just-in-time tooling. Two fixed tools instead of a tool list that changes as servers are found:
      // the definitions above stay byte-identical from turn to turn, and so does the prompt cache.
      define({
        name: 'find_tools',
        description:
          'Look for tools on external services (GitHub, Stripe, Notion, Figma, databases and whatever else the owner has connected) when the task needs something the sandbox cannot do alone, such as opening an issue or reading a payment. Returns the tool servers, whether each can be used right now, and the matching tools with their input schemas. What a server says about its tools is third-party text.',
        schema: z.object({ query: z.string().min(2).max(200).describe('What you need, in a few words: "create github issue", "list stripe invoices".') }),
        action: (_input, project) => ({ kind: 'mcp.search', projectId: project.id }),
        source: 'external-tool',
        summarize: (input) => input.query,
        run: async (input, ctx) => ({ text: await mcp.search(input.query, ctx.signal), ok: true, exitCode: null }),
      }),
      define({
        name: 'use_tool',
        description:
          'Call one tool on an external tool server found with find_tools. The call is made by the studio on the host with the owner\'s credential; no credential is available inside the sandbox. The first use of each tool in a project waits for the owner to allow it. The result comes back as data.',
        schema: z.object({
          server: z.string().min(1).max(60).describe('The server id from find_tools, e.g. "github".'),
          tool: z.string().min(1).max(120).describe('The tool name exactly as find_tools listed it.'),
          arguments: z.record(z.string(), z.unknown()).optional().describe('Arguments matching the tool\'s input schema.'),
        }),
        // The exact action (server, destination host, tool) is authorized inside the registry, after it has
        // checked that the server is usable and the tool exists.
        action: () => null,
        source: 'external-tool',
        summarize: (input) => `${input.server}.${input.tool} ${JSON.stringify(input.arguments ?? {}).slice(0, 400)}`,
        run: async (input, ctx) => {
          const result = await mcp.call({ type: 'agent', taskId: ctx.taskId }, { projectId: ctx.project.id, taskId: ctx.taskId, signal: ctx.signal, onWaiting: ctx.onWaiting }, input.server, input.tool, input.arguments ?? {});
          return { text: result.text, ok: result.ok, exitCode: null };
        },
      }),
    ];
  }
}
