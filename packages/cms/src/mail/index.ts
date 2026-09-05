export { BREVO_ENDPOINT, BREVO_TIMEOUT_MS, createBrevoProvider } from './brevo.ts';
export type { BrevoProviderOptions } from './brevo.ts';
export {
  MAIL_CREDENTIALS_FILE,
  mailCredentialsPath,
  readMailCredentials,
  removeMailCredentials,
  writeMailCredentials,
} from './credentials.ts';
export type { BrevoCredential, MailCredentials, SmtpCredential } from './credentials.ts';
export { createMemoryMailProvider } from './memory.ts';
export type { MemoryMailProvider } from './memory.ts';
export { MAIL_PROVIDERS } from './provider.ts';
export type {
  MailAddress,
  MailDelivery,
  MailProvider,
  MailProviderName,
  OutgoingMail,
} from './provider.ts';
export { createMailService, DEFAULT_MAIL_ATTEMPTS, defaultMailBackoffMs } from './service.ts';
export type {
  CreateMailServiceOptions,
  MailLogger,
  MailRecipient,
  MailResult,
  MailService,
  RawMail,
  TemplateMail,
} from './service.ts';
export { createSmtpProvider, SMTP_TIMEOUT_MS } from './smtp.ts';
export type { SmtpProviderOptions } from './smtp.ts';
export { createMailTemplates, mailTemplateFiles } from './templates.ts';
export type {
  CreateMailTemplatesOptions,
  MailTemplateFiles,
  MailTemplates,
  RenderedMail,
} from './templates.ts';
