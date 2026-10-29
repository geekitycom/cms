/**
 * Run one shard of the cms suite: `TEST_SHARD=2/6 node scripts/test-shard.ts`.
 *
 * `node --test --test-shard` deals files out by their index in name order, so
 * the slowest files can land in one shard by accident of their names, and that
 * shard sets how long CI takes. Here each file is weighed by the seconds it
 * took when last measured, and the files are dealt heaviest first to the shard
 * with the least work so far. test-weights.json lists the files of three
 * seconds or more, and the median file, which any file not listed counts as.
 *
 * `node scripts/test-shard.ts --measure` times every file, four at a time as on
 * a CI runner, and rewrites test-weights.json. Wall time, not CPU, because
 * several files spend theirs in the processes they start. The weights only
 * steer the deal, so a stale or missing entry costs balance, never a test.
 */
import { spawn } from 'node:child_process';
import { globSync, readFileSync, writeFileSync } from 'node:fs';

const WEIGHTS = new URL('test-weights.json', import.meta.url);
const LISTED_FROM = 3;
const MEASURED_AT = 4;
const RUN = ['--import', './src/__testing__/offline.ts', '--test'];

const files = globSync('src/**/*.test.ts').sort();

if (process.argv.includes('--measure')) {
  writeFileSync(WEIGHTS, `${JSON.stringify(await measure(files), null, 2)}\n`);
} else {
  const shard = /^(\d+)\/(\d+)$/.exec(process.env['TEST_SHARD'] ?? '');
  if (shard === null) throw new Error('Set TEST_SHARD to the shard to run, for example 2/6.');
  const [index, total] = [Number(shard[1]), Number(shard[2])];
  const mine = deal(files, readWeights(), total)[index - 1] ?? [];
  const child = spawn(process.execPath, [...RUN, ...mine], { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 1));
}

interface Weights {
  typical: number;
  files: Record<string, number>;
}

function readWeights(): Weights {
  return JSON.parse(readFileSync(WEIGHTS, 'utf8')) as Weights;
}

function deal(all: string[], weights: Weights, total: number): string[][] {
  const shards = Array.from({ length: total }, () => ({ load: 0, files: [] as string[] }));
  const weighed = all.map((file) => ({ file, weight: weights.files[file] ?? weights.typical }));
  weighed.sort((a, b) => b.weight - a.weight || a.file.localeCompare(b.file));
  for (const { file, weight } of weighed) {
    const lightest = shards.reduce((min, shard) => (shard.load < min.load ? shard : min));
    lightest.load += weight;
    lightest.files.push(file);
  }
  return shards.map((shard) => shard.files.sort());
}

async function measure(all: string[]): Promise<Weights> {
  const seconds: Record<string, number> = {};
  const queue = [...all];
  const worker = async (): Promise<void> => {
    for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
      const started = performance.now();
      const code = await new Promise((resolve) => {
        spawn(process.execPath, [...RUN, '--test-reporter=dot', file], { stdio: 'ignore' }).on(
          'exit',
          resolve,
        );
      });
      if (code !== 0) throw new Error(`${file} failed while it was being measured`);
      seconds[file] = (performance.now() - started) / 1000;
    }
  };
  await Promise.all(Array.from({ length: MEASURED_AT }, worker));
  const tenths = (wall: number): number => Math.round(wall * 10) / 10;
  const walls = Object.values(seconds).sort((a, b) => a - b);
  return {
    typical: tenths(walls[Math.floor(walls.length / 2)] ?? 0),
    files: Object.fromEntries(
      Object.entries(seconds)
        .filter(([, wall]) => wall >= LISTED_FROM)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([file, wall]) => [file, tenths(wall)]),
    ),
  };
}
