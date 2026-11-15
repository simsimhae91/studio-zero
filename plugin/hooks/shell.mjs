// What the two guards of shell commands share: reading the call, and telling what a shell would run from the text
// it only carries.

/** The command of the Bash call on stdin, or null when there is none to judge. */
export async function readCommand() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  try {
    const command = JSON.parse(input)?.tool_input?.command;
    return typeof command === 'string' && command.trim() !== '' ? command : null;
  } catch {
    return null;
  }
}

const SHELL = /(^|[\s;&|(])(ba|z|da|k)?sh\b/;

/** Where a command word may begin. */
export const START = '(^|[\\s;&|(`])';

/**
 * What a shell would run, without the text it only carries: a here-document that is not fed to a shell (a commit
 * message, a file being written) and quoted words with no command inside them. A commit that says "not with
 * pkill" is not a pkill.
 */
export function runs(text) {
  const bare = text.replace(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[^\n]*\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\n|$)/g, (whole, _quote, _tag, at) => {
    const before = text.slice(text.lastIndexOf('\n', at - 1) + 1, at);
    return new RegExp(`${SHELL.source}[^|;&]*$`).test(before) ? whole : whole.slice(0, whole.indexOf('\n'));
  });
  let kept = '';
  for (let i = 0; i < bare.length; i++) {
    const char = bare[i];
    if (char === '\\' && i + 1 < bare.length) {
      kept += bare[++i];
      continue;
    }
    if (char !== "'" && char !== '"') {
      kept += char;
      continue;
    }
    let end = i + 1;
    while (end < bare.length && bare[end] !== char) end += char === '"' && bare[end] === '\\' ? 2 : 1;
    const inside = bare.slice(i + 1, end);
    // Kept when a shell will run it: the script handed to `sh -c` or `eval`, or a string with a command in it.
    const handed = /(^|[\s;&|(])((ba|z|da|k)?sh\s+(-\w+\s+)*-\w*c|eval)\s*$/.test(kept);
    if (handed || (char === '"' && /\$\(|`/.test(inside))) kept += ` ${inside} `;
    i = end;
  }
  return kept;
}
