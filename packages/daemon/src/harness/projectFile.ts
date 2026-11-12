import { z } from 'zod';
import type { Project, Template } from '@studio-zero/protocol';
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
});
export type ProjectFile = z.infer<typeof ProjectFile>;

const defaults: Record<Template, ProjectFile> = {
  'web-vite-react': { dev: { command: 'pnpm dev --host 0.0.0.0 --port 5173', port: 5173 }, routes: ['/'] },
  'web-next': { dev: { command: 'pnpm dev --hostname 0.0.0.0 --port 3000', port: 3000 }, routes: ['/'] },
  // Expo is audited through its web target (react-native-web); device-only behaviour needs a device.
  'mobile-expo': { dev: { command: 'pnpm expo start --web --port 8081', port: 8081 }, routes: ['/'] },
};

export function defaultProjectFile(template: Template): ProjectFile {
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
