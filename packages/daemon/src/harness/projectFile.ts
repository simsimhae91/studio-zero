import { z } from 'zod';
import type { Project, ProjectTemplate } from '@studio-zero/protocol';
import type { Config } from '../config.ts';
import type { OrbStackManager } from '../sandbox/OrbStackManager.ts';

export const PROJECT_FILE = '.studio-zero/project.json';

const ProjectFile = z.object({
  dev: z.object({
    /** Started by the harness inside the sandbox. Must bind 0.0.0.0 so the QA browser can reach it. */
    command: z.string().min(1).max(300),
    port: z.number().int(),
  }),
  /** Routes the visual audit visits. */
  routes: z.array(z.string().regex(/^\/[\w\-./~%?=&]*$/).max(200)).min(1).max(8),
  /**
   * Where each state the screen spec lists can be seen on demand: a route of the running app (usually a query
   * the fixtures read) that shows the named state of the named screen. How an empty list, a failure or a limit
   * looks is otherwise never looked at by anyone before a user meets it.
   */
  states: z
    .array(z.object({ screen: z.string().regex(/^[A-Z]{1,3}-\d{2}$/), name: z.string().min(1).max(80), route: z.string().regex(/^\/[\w\-./~%?=&]*$/).max(200) }))
    .max(12)
    .default([]),
});
export type ProjectFile = z.infer<typeof ProjectFile>;

const defaults: Record<ProjectTemplate, ProjectFile> = {
  'web-vite-react': { dev: { command: 'pnpm dev --host 0.0.0.0 --port 5173', port: 5173 }, routes: ['/'], states: [] },
  'web-next': { dev: { command: 'pnpm dev --hostname 0.0.0.0 --port 3000', port: 3000 }, routes: ['/'], states: [] },
  // Expo is audited through its web target (react-native-web); device-only behaviour needs a device.
  'mobile-expo': { dev: { command: 'pnpm expo start --web --port 8081', port: 8081 }, routes: ['/'], states: [] },
  // The studio's own repository: its client runs on example data, so a change to it can be previewed and audited.
  'studio-core': { dev: { command: 'pnpm --filter @studio-zero/desktop dev --host 0.0.0.0 --port 5173 --strictPort', port: 5173 }, routes: ['/?demo'], states: [] },
};

export function defaultProjectFile(template: ProjectTemplate): ProjectFile {
  return defaults[template];
}

/**
 * Reads the project's runtime description from the workspace. The file is editable by the agent, so it is
 * treated as untrusted input: schema-checked, the port confined to the published preview ports, and anything
 * unusable replaced by the template default rather than trusted.
 */
export async function readProjectFile(sandboxes: OrbStackManager, project: Project, config: Config): Promise<ProjectFile> {
  const fallback = defaultProjectFile(project.template);
  try {
    const { content } = await sandboxes.readFile(project, PROJECT_FILE, 16 * 1024);
    const parsed = ProjectFile.safeParse(JSON.parse(content));
    if (parsed.success && config.runtime.previewPorts.includes(parsed.data.dev.port)) return parsed.data;
  } catch {
    // Missing or malformed file: fall through to the default.
  }
  return fallback;
}
