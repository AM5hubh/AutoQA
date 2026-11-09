import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const docker = (...args) =>
  execFileSync('docker', ['compose', 'exec', '-T', 'postgres', ...args], {
    encoding: 'utf8',
  }).trim();
const suffix = Date.now();
const database = `autoqa_restore_check_${suffix}`;
const dump = `/tmp/autoqa-backup-${suffix}.dump`;
const count = (name) =>
  docker('psql', '-U', 'autoqa', '-d', name, '-Atc', 'SELECT count(*) FROM "Run"');
const before = count('autoqa');
docker('pg_dump', '-U', 'autoqa', '-d', 'autoqa', '-Fc', '-f', dump);
docker('createdb', '-U', 'autoqa', database);
docker('pg_restore', '-U', 'autoqa', '-d', database, dump);
assert.equal(count(database), before, 'Run counts differ; repeat while submissions are stopped');
console.log(
  `Restored backup to separate database ${database}; verified ${before} runs. Live database unchanged.`,
);
