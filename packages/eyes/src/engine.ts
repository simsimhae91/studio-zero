import { accessSync, constants, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * The container engine and the Supabase command line, reached the way that works on the owner's machine without
 * touching anything of theirs. Learned by running them here: the docker client is not on a session's PATH when
 * the engine is OrbStack; the owner's docker configuration may name a credential helper that is not installed,
 * and an image pull then fails before it starts; the Supabase command line reports what is run to its maker
 * unless told not to on every call; and only its stack mode lets two projects run side by side (no fixed ports,
 * services that sleep until asked).
 */

const isExecutable = (path: string): boolean => {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

const WHERE: Record<'docker' | 'supabase', string[]> = {
  docker: ['/Applications/OrbStack.app/Contents/MacOS/xbin/docker', '/usr/local/bin/docker', '/opt/homebrew/bin/docker', '/Applications/Docker.app/Contents/Resources/bin/docker'],
  supabase: ['/opt/homebrew/bin/supabase', '/usr/local/bin/supabase', join(homedir(), '.local/bin/supabase')],
};

/** The tool on PATH, or where its installer puts it; null when it is not on this machine. */
export function findTool(name: 'docker' | 'supabase', env: NodeJS.ProcessEnv = process.env): string | null {
  const onPath = (env.PATH ?? '').split(':').filter(Boolean).map((dir) => join(dir, name));
  return [...onPath, ...WHERE[name]].find(isExecutable) ?? null;
}

/** True when the owner's docker configuration names a credential helper that is not installed. */
function helperMissing(env: NodeJS.ProcessEnv, path: string): boolean {
  try {
    const config: unknown = JSON.parse(readFileSync(join(env.DOCKER_CONFIG ?? join(homedir(), '.docker'), 'config.json'), 'utf8'));
    const store = config && typeof config === 'object' && 'credsStore' in config && typeof config.credsStore === 'string' ? config.credsStore : '';
    return store !== '' && !path.split(':').some((dir) => isExecutable(join(dir, `docker-credential-${store}`)));
  } catch {
    return false;
  }
}

/**
 * The environment a call to either tool is made in. The owner's own files are read, never changed: where their
 * docker configuration cannot pull an image, an empty one of the harness's own is used for this call.
 */
export function engineEnv(env: NodeJS.ProcessEnv = process.env, home = homedir()): NodeJS.ProcessEnv {
  const docker = findTool('docker', env);
  const path = [...(docker ? [docker.slice(0, docker.lastIndexOf('/'))] : []), '/opt/homebrew/bin', env.PATH ?? '/usr/bin:/bin'].join(':');
  const made: NodeJS.ProcessEnv = { ...env, PATH: path, SUPABASE_EXPERIMENTAL_STACK: '1', SUPABASE_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1' };
  const orb = join(home, '.orbstack/run/docker.sock');
  if (!env.DOCKER_HOST && !existsSync('/var/run/docker.sock') && existsSync(orb)) made.DOCKER_HOST = `unix://${orb}`;
  if (helperMissing(env, path)) {
    const own = join(home, '.studio-zero', 'docker');
    if (!existsSync(join(own, 'config.json'))) {
      mkdirSync(own, { recursive: true, mode: 0o700 });
      writeFileSync(join(own, 'config.json'), '{}\n');
    }
    made.DOCKER_CONFIG = own;
  }
  return made;
}

/**
 * Why a call to the Supabase command line is not passed on, or null when it is. This door opens on the stack
 * that runs on this machine. A hosted project is the owner's: it is reached with their own login, on purpose,
 * by the steps of a release.
 */
export function hostedSupabaseCall(args: readonly string[]): string | null {
  const words = args.filter((arg) => !arg.startsWith('-'));
  const says = (...verbs: string[]): boolean => verbs.every((verb, i) => words[i] === verb);
  const dbUrl = args.find((arg, i) => args[i - 1] === '--db-url' || arg.startsWith('--db-url='));
  const hostedUrl = dbUrl !== undefined && !/@(127\.0\.0\.1|localhost|host\.docker\.internal|\[::1\])[:/]/.test(dbUrl);
  if (args.includes('--linked') || hostedUrl || args.includes('--project-ref') || args.some((arg) => arg.startsWith('--project-ref='))) return 'it names a hosted project (--linked, --project-ref, or a database address that is not on this machine)';
  for (const verb of ['login', 'logout', 'link', 'unlink', 'projects', 'orgs', 'branches', 'secrets', 'domains', 'vanity-subdomains', 'sso', 'network-bans', 'network-restrictions', 'ssl-enforcement', 'postgres-config', 'snippets', 'encryption', 'backups']) if (says(verb)) return `\`supabase ${verb}\` acts on the owner's hosted account`;
  if (says('db', 'push') || says('db', 'pull') || says('db', 'remote') || says('migration', 'repair') || says('functions', 'deploy') || says('functions', 'delete') || says('functions', 'download') || says('storage') || says('config', 'push')) return `\`supabase ${words.slice(0, 2).join(' ')}\` acts on a hosted project`;
  return null;
}
