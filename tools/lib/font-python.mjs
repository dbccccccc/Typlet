// Font generation uses only the repository's virtual environment, with the
// dependency versions recorded in tools/fonts/requirements.txt.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function fontPython(root) {
  const python = join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const setup = 'Create .venv and install tools/fonts/requirements.txt; see CONTRIBUTING.md.';
  if (!existsSync(python)) throw new Error(`The repository's Python environment is missing. ${setup}`);
  const requirements = readFileSync(join(root, 'tools/fonts/requirements.txt'), 'utf8')
    .split(/\r?\n/).filter((line) => line.trim() && !line.startsWith('#'))
    .map((line) => {
      const match = /^([\w-]+)(?:\[[^\]]+\])?==([^\s]+)$/.exec(line);
      if (!match) throw new Error(`Font dependency must have an exact version: ${line}`);
      return [match[1], match[2]];
    });
  const probe = spawnSync(python, ['-c', 'import importlib.metadata as m, json, sys; print(json.dumps({name: m.version(name) for name in sys.argv[1:]}))', ...requirements.map(([name]) => name)], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) throw new Error(`Cannot check font dependencies. ${setup}\n${probe.error?.message ?? probe.stderr}`);
  const versions = JSON.parse(probe.stdout);
  for (const [name, version] of requirements) {
    if (versions[name] !== version) throw new Error(`Font generation requires ${name}==${version}, found ${versions[name]}. ${setup}`);
  }
  return python;
}
