import { STRIP_METADATA_JOB } from '../content/metadata/strip-job.ts';
import { SITE_EXPORT_JOB_NAME } from '../export/site-export.ts';
import { RESEND_JOB } from '../federation/resend-job.ts';
import { RETRY_DELIVERIES_JOB } from '../federation/retry-job.ts';
import type { JobStatus } from '../jobs/types.ts';
import type { PluginScreenCell } from '../plugin.ts';
import { countRetryingDeliveries } from '../store/queue-database.ts';
import { EXPORT_PATH } from './export.ts';
import { DELIVERY_PANEL, FAILURES_PANEL, FAILURES_SINCE_MS, RESEND_PANEL } from './federation.ts';
import { MAINTENANCE_PATH, STRIP_METADATA_PANEL } from './maintenance.ts';
import type { CoreWidget } from './widgets.ts';

const LONG_RUNNING_MS = 60 * 60 * 1000;

const JOB_PANELS: Readonly<Record<string, { readonly label: string; readonly href: string }>> = {
  [STRIP_METADATA_JOB.name]: { label: 'Metadata sweep', href: STRIP_METADATA_PANEL },
  [RESEND_JOB.name]: { label: 'Resend', href: RESEND_PANEL },
  [RETRY_DELIVERIES_JOB.name]: { label: 'Retry deliveries', href: FAILURES_PANEL },
  [SITE_EXPORT_JOB_NAME]: { label: 'Site export', href: EXPORT_PATH },
};

function jobPanel(name: string): { readonly label: string; readonly href: string } {
  return JOB_PANELS[name] ?? { label: name, href: MAINTENANCE_PATH };
}

interface Problem {
  readonly text: string;
  readonly href: string;
  readonly count: number;
}

function endedBadlyAt(job: JobStatus): string | undefined {
  if (job.state === 'failed') return job.finishedAt;
  if (job.state === 'interrupted') return job.interruptedAt;
  return undefined;
}

function failedJobs(jobs: readonly JobStatus[], since: string): Problem[] {
  const lastFinished = new Map<string, string>();
  for (const job of jobs) {
    if (job.state !== 'finished') continue;
    if (job.finishedAt > (lastFinished.get(job.name) ?? '')) {
      lastFinished.set(job.name, job.finishedAt);
    }
  }
  const failures = new Map<string, number>();
  for (const job of jobs) {
    const at = endedBadlyAt(job);
    if (at === undefined || at < since || at < (lastFinished.get(job.name) ?? '')) continue;
    failures.set(job.name, (failures.get(job.name) ?? 0) + 1);
  }
  return [...failures].map(([name, count]) => {
    const panel = jobPanel(name);
    return { text: `${panel.label} failed`, href: panel.href, count };
  });
}

function longRunningJobs(jobs: readonly JobStatus[], before: string): Problem[] {
  const running = new Map<string, number>();
  for (const job of jobs) {
    if (job.state === 'running' && job.startedAt < before) {
      running.set(job.name, (running.get(job.name) ?? 0) + 1);
    }
  }
  return [...running].map(([name, count]) => {
    const panel = jobPanel(name);
    return { text: `${panel.label} running for over an hour`, href: panel.href, count };
  });
}

export const HEALTH_WIDGET: CoreWidget = {
  id: 'health',
  title: 'Needs attention',
  width: 'full',
  refreshSeconds: 60,
  placement: 'alerts',
  async load(vars) {
    const now = vars.config.now().getTime();
    const since = new Date(now - FAILURES_SINCE_MS).toISOString();
    const jobs = await vars.jobs.list(['failed', 'interrupted', 'finished', 'running']);

    const problems: Problem[] = [
      ...failedJobs(jobs, since),
      ...longRunningJobs(jobs, new Date(now - LONG_RUNNING_MS).toISOString()),
      {
        text: 'Failed federation deliveries',
        href: FAILURES_PANEL,
        count: vars.admin.listFailedDeliveriesSince(since).length,
      },
      {
        text: 'Federation deliveries being retried',
        href: DELIVERY_PANEL,
        count: countRetryingDeliveries(vars.config.dataDir, since),
      },
      {
        text: 'Failed webmentions',
        href: DELIVERY_PANEL,
        count: vars.admin.countFailedWebmentionsSince(since),
      },
    ].filter((problem) => problem.count > 0);
    if (problems.length === 0) return [];

    return [
      {
        table: {
          caption: 'Failures in the last 7 days, and jobs running for over an hour',
          columns: ['Problem', 'Count'],
          rows: problems.map((problem): PluginScreenCell[] => [
            { text: problem.text, href: problem.href },
            String(problem.count),
          ]),
        },
      },
    ];
  },
};
