export type EditorField = `editor-${string}`;

export interface Refusal {
  readonly message: string;
  readonly field?: EditorField | undefined;
}

export interface FieldError {
  readonly error: string;
  readonly field: EditorField;
}
