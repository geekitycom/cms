export {
  readFileIfPresentSync,
  updateFileAtomically,
  withFileLock,
  writeFileAtomically,
  writeFileAtomicallySync,
} from './atomic.ts';
export type { FileContents, ProduceFileContents, WriteFileAtomicallyOptions } from './atomic.ts';
