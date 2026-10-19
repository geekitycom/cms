import type { Context, Hono } from 'hono';

import { STRIP_METADATA_JOB } from '../content/metadata/strip-job.ts';
import { finishedResult } from '../jobs/types.ts';
import { overridden, sourceText } from '../settings/registry.ts';
import { MAINTENANCE } from '../settings/maintenance.ts';
import type { GeekityEnv } from '../web/env.ts';
import { stringOrEmpty } from '../util/forms.ts';
import type { AdminRender } from './documents.ts';
import { flash } from './flash.ts';
import { jobStatusView, queueJobFromForm } from './job-status.ts';
import { ADMIN_TEMPLATES } from './templates.ts';
import { TOOLS_PATH, TOOLS_SECTION } from './tools.ts';

export const MAINTENANCE_PATH = `${TOOLS_PATH}/maintenance`;

export const MAINTENANCE_CHILD = 'maintenance';

export const STRIP_METADATA_PATH = `${MAINTENANCE_PATH}/strip-metadata`;

export const STRIP_METADATA_PANEL = `${MAINTENANCE_PATH}#strip-metadata`;

export function mountMaintenanceScreen(
  app: Hono<GeekityEnv>,
  options: { render: AdminRender },
): void {
  async function show(
    c: Context<GeekityEnv>,
    problems: Readonly<Record<string, string>> = {},
  ): Promise<Response> {
    const { settings } = c.var;
    const on = await settings.resolve(MAINTENANCE.on);
    const until = await settings.get(MAINTENANCE.until);
    const latestSweep = await c.var.jobs.latest(STRIP_METADATA_JOB.name);
    return options.render(c, ADMIN_TEMPLATES.toolsMaintenance, {
      section: TOOLS_SECTION,
      child: MAINTENANCE_CHILD,
      heading: 'Maintenance',
      saveUrl: MAINTENANCE_PATH,
      on: on.value,
      overriddenBy: overridden(on.source)
        ? `maintenance.on is set by ${sourceText(on.source)} and cannot be changed here.`
        : undefined,
      until: MAINTENANCE.until.declaration.type.toText(until),
      problems,
      stripMetadataUrl: STRIP_METADATA_PATH,
      sweep: jobStatusView(latestSweep),
      sweepReport: finishedResult(STRIP_METADATA_JOB, latestSweep),
    });
  }

  app.get(MAINTENANCE_PATH, (c) => show(c));

  app.post(STRIP_METADATA_PATH, (c) =>
    queueJobFromForm(c, STRIP_METADATA_JOB, null, {
      panel: STRIP_METADATA_PANEL,
      queued: 'Queued the sweep. It runs in the background; its progress is below.',
      busy: 'A sweep is already queued or running. Nothing new was queued.',
    }),
  );

  app.post(MAINTENANCE_PATH, async (c) => {
    const body = await c.req.parseBody();
    const result = await c.var.settings.set(
      'maintenance',
      new Map<string, unknown>([
        ['on', body['on'] !== undefined],
        ['until', stringOrEmpty(body['until']).trim()],
      ]),
      'admin',
    );
    if (!result.ok) {
      c.status(400);
      return await show(c, result.problems);
    }
    flash(c, 'notice', 'Maintenance saved.');
    return c.redirect(MAINTENANCE_PATH, 303);
  });
}
