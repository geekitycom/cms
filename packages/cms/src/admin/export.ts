import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';

import type { Context, Hono } from 'hono';

import { currentExport } from '../files/export-archives.ts';
import { SITE_EXPORT_JOB, sizeLabel } from '../export/export-job.ts';
import { pendingWork } from '../export/site-export.ts';
import { finishedResult } from '../jobs/types.ts';
import { stringOrEmpty } from '../util/forms.ts';
import type { GeekityEnv } from '../web/env.ts';
import { answerRefusal } from './confirm-password.ts';
import type { ConfirmPassword } from './confirm-password.ts';
import type { AdminRender } from './documents.ts';
import { jobStatusView, queueJobFromForm } from './job-status.ts';
import { ADMIN_TEMPLATES } from './templates.ts';
import { TOOLS_PATH, TOOLS_SECTION } from './tools.ts';

export const EXPORT_PATH = `${TOOLS_PATH}/export`;

export const EXPORT_DOWNLOAD_PATH = `${EXPORT_PATH}/download`;

export const EXPORT_CHILD = 'export';

const FIELDS = { password: 'password', withCredentials: 'with_credentials' } as const;

const WRONG_PASSWORD = 'Your password was not right, so nothing was exported.';

export function mountExportScreen(
  app: Hono<GeekityEnv>,
  options: { render: AdminRender; confirmPassword: ConfirmPassword },
): void {
  async function show(
    c: Context<GeekityEnv>,
    form: { withCredentials: boolean; problem?: string } = { withCredentials: false },
  ): Promise<Response> {
    const { dataDir } = c.var.config;
    const latest = await c.var.jobs.latest(SITE_EXPORT_JOB.name);
    const result = finishedResult(SITE_EXPORT_JOB, latest);
    const archive = await currentExport(dataDir, c.var.config.now());
    return options.render(c, ADMIN_TEMPLATES.toolsExport, {
      section: TOOLS_SECTION,
      child: EXPORT_CHILD,
      heading: 'Export',
      exportUrl: EXPORT_PATH,
      downloadUrl: EXPORT_DOWNLOAD_PATH,
      fields: FIELDS,
      withCredentials: form.withCredentials,
      problem: form.problem,
      pending: await pendingWork(dataDir),
      job: jobStatusView(latest),
      result: result === undefined ? undefined : { ...result, size: sizeLabel(result.bytes) },
      archive:
        archive === undefined || archive.name !== result?.file
          ? undefined
          : {
              name: archive.name,
              size: sizeLabel(archive.size),
              expiresAt: archive.expiresAt.toISOString(),
            },
    });
  }

  app.get(EXPORT_PATH, (c) => show(c));

  app.post(EXPORT_PATH, async (c) => {
    const body = await c.req.parseBody();
    const withCredentials = body[FIELDS.withCredentials] !== undefined;
    const confirmation = await options.confirmPassword(c, stringOrEmpty(body[FIELDS.password]));
    if (confirmation.kind !== 'confirmed') {
      const problem = answerRefusal(c, confirmation, WRONG_PASSWORD);
      return await show(c, { withCredentials, problem });
    }
    return await queueJobFromForm(
      c,
      SITE_EXPORT_JOB,
      { withCredentials },
      {
        panel: EXPORT_PATH,
        queued: 'Queued the export. It runs in the background; its progress is below.',
        busy: 'An export is already queued or running. Nothing new was queued.',
      },
    );
  });

  app.get(EXPORT_DOWNLOAD_PATH, async (c) => {
    const archive = await currentExport(c.var.config.dataDir, c.var.config.now());
    if (archive === undefined) return c.notFound();
    return new Response(Readable.toWeb(createReadStream(archive.path)) as ReadableStream, {
      headers: {
        'content-type': 'application/gzip',
        'content-length': String(archive.size),
        'content-disposition': `attachment; filename="${archive.name}"`,
        'cache-control': 'no-store',
      },
    });
  });
}
