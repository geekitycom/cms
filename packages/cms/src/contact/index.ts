/**
 * The contact form (TASK-56): a page that offers one, the defences in front of
 * it, the file every message lands in, and the mail that carries it.
 *
 * The barrel every other module and the package index import from, so nothing
 * outside here has to know which file a name lives in.
 */

export {
  blankContactValues,
  CONTACT_ANCHOR,
  CONTACT_FIELDS,
  CONTACT_FRONT_MATTER_KEY,
  CONTACT_NOTICE_PARAM,
  CONTACT_NOTICES,
  CONTACT_POST_PATH,
  contactForm,
  contactFormFor,
  contactNoticeFor,
  contactOpen,
  contactProblems,
  contactValuesOf,
  MAXIMUM_CONTACT_EMAIL_LENGTH,
  MAXIMUM_CONTACT_MESSAGE_LENGTH,
  MAXIMUM_CONTACT_NAME_LENGTH,
  MAXIMUM_CONTACT_SUBJECT_LENGTH,
  refilledContactForm,
} from './form.ts';
export type { ContactForm, ContactFormContext, ContactProblems } from './form.ts';

export {
  addContactMessage,
  CONTACT_DATA_DIRECTORY,
  contactDirectory,
  contactMessageFile,
  contactMessageId,
  countContactMessagesByStatus,
  countUnreadContactMessages,
  deleteContactMessage,
  listContactMessages,
  readContactMessage,
  setContactMessageRead,
} from './records.ts';
export type { ContactMessage, ContactStatus, NewContactMessage } from './records.ts';

export {
  CONTACT_RATE_LIMIT,
  CONTACT_RATE_WINDOW_SECONDS,
  contactKeys,
  submitContactMessage,
} from './submission.ts';
export type {
  ContactOutcome,
  ContactRefusal,
  ContactThrottle,
  SubmitContactMessageOptions,
} from './submission.ts';

export { CONTACT_MESSAGE_TEMPLATE, contactRecipient, sendContactMessage } from './delivery.ts';
export type { ContactRecipientOptions, SendContactMessageOptions } from './delivery.ts';

export { mountContact } from './routes.ts';
