"""Copy only provider authentication and model settings into private acceptance-test directories."""
import json
import os
from pathlib import Path
import shutil
import sys
import tomllib

target = Path(sys.argv[1])
codex = target / 'codex'
claude = target / 'claude'
for directory in (codex, claude):
    directory.mkdir(mode=0o700, parents=True)

def copy_private(source, destination):
    if source.exists():
        shutil.copyfile(source, destination)
        destination.chmod(0o600)

codex_source = Path(os.environ.get('CODEX_HOME', Path.home() / '.codex'))
claude_source = Path(os.environ.get('CLAUDE_CONFIG_DIR', Path.home() / '.claude'))
copy_private(codex_source / 'auth.json', codex / 'auth.json')
copy_private(claude_source / '.credentials.json', claude / '.credentials.json')

config = codex_source / 'config.toml'
data = tomllib.loads(config.read_text()) if config.exists() else {}
allowed = {'model', 'model_provider', 'model_providers', 'model_reasoning_effort', 'service_tier'}
lines = []
def write_table(table, prefix=()):
    if prefix:
        lines.append('[' + '.'.join(json.dumps(part) for part in prefix) + ']')
    for key, value in table.items():
        if not isinstance(value, dict):
            lines.append(json.dumps(key) + ' = ' + json.dumps(value))
    for key, value in table.items():
        if isinstance(value, dict):
            write_table(value, prefix + (key,))
write_table({key: value for key, value in data.items() if key in allowed})
(codex / 'config.toml').write_text('\n'.join(lines) + '\n')
(codex / 'config.toml').chmod(0o600)

settings = claude_source / 'settings.json'
data = json.loads(settings.read_text()) if settings.exists() else {}
(claude / 'settings.json').write_text(json.dumps({key: value for key, value in data.items() if key in {'env', 'model'}}))
(claude / 'settings.json').chmod(0o600)
