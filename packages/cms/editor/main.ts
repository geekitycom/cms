/**
 * The editor's progressive enhancement, bundled to `admin/static/editor.js`.
 *
 * Everything here is an upgrade to a form that already works. The server
 * renders a plain `<textarea>` and a Preview button that submits the form to
 * `/admin/preview` in a new tab; this file replaces the textarea's *view* with
 * CodeMirror, turns the button into a tab, and adds an upload control. The
 * textarea itself never goes away — it stays in the form as the value that is
 * submitted, and CodeMirror writes into it on every change and again on submit.
 * If this script fails to load, or fails outright, the editor is exactly what
 * it was.
 *
 * It is not compiled by `tsc -p tsconfig.build.json`: it is browser code, it
 * has a `lib` and a `tsconfig` of its own, and esbuild bundles it. See
 * `scripts/build-editor.js`.
 */
import { markdown } from '@codemirror/lang-markdown';
import { basicSetup, EditorView } from 'codemirror';

/** The element the server hangs the editor's URLs off. */
const TOOLS_ID = 'editor-enhance';
/** The textarea that carries the body, before and after this runs. */
const BODY_ID = 'editor-body';
/** The no-JS Preview button, which becomes a tab. */
const FALLBACK_ID = 'editor-preview-fallback';

enhance();

/**
 * Find the three elements the enhancement needs and hand them on, or leave the
 * page exactly as the server rendered it.
 */
function enhance(): void {
  const tools = document.getElementById(TOOLS_ID);
  const textarea = document.getElementById(BODY_ID);
  if (tools === null || !(textarea instanceof HTMLTextAreaElement)) return;
  if (textarea.form === null) return;

  attach(tools, textarea, textarea.form);
}

/** Replace the textarea's view with CodeMirror, and add the tabs and uploads. */
function attach(tools: HTMLElement, textarea: HTMLTextAreaElement, form: HTMLFormElement): void {
  const previewUrl = tools.dataset['previewUrl'] ?? '';
  const uploadUrl = tools.dataset['uploadUrl'] ?? '';

  const surface = document.createElement('div');
  surface.className = 'admin-editor-surface';
  textarea.insertAdjacentElement('afterend', surface);

  const status = document.createElement('p');
  status.className = 'admin-editor-status';
  status.setAttribute('role', 'status');

  const view = new EditorView({
    doc: textarea.value,
    extensions: [
      basicSetup,
      markdown(),
      EditorView.lineWrapping,
      // The textarea is the form's value; the view is only a view of it.
      EditorView.updateListener.of((update) => {
        if (update.docChanged) textarea.value = update.state.doc.toString();
      }),
      EditorView.domEventHandlers({
        dragover: (event) => {
          if (hasFiles(event)) event.preventDefault();
        },
        drop: (event) => {
          const files = event.dataTransfer?.files;
          if (files === undefined || files.length === 0) return false;
          event.preventDefault();
          void uploadAll(files);
          return true;
        },
      }),
    ],
    parent: surface,
  });

  // The textarea stops being seen and goes on being submitted. `hidden` rather
  // than `disabled`: a disabled control is left out of the form.
  textarea.hidden = true;

  // A save could in principle be triggered without a change event having
  // landed; taking the document at submit time makes that impossible to get
  // wrong.
  form.addEventListener('submit', () => {
    textarea.value = view.state.doc.toString();
  });

  const preview = document.createElement('iframe');
  preview.className = 'admin-editor-preview';
  preview.title = 'Preview';
  preview.hidden = true;
  // The preview is the site's own HTML, rendered from what is in the editor.
  // It is framed rather than inlined so the theme's stylesheet cannot reach the
  // admin's, and sandboxed so a script in a post cannot reach the session.
  preview.setAttribute('sandbox', '');
  surface.insertAdjacentElement('afterend', preview);

  const tabs = tabStrip();
  tools.insertAdjacentElement('afterbegin', tabs.element);
  tools.append(uploadControl(), status);

  // The fallback did the job of the Preview tab; two of them would be one too
  // many.
  document.getElementById(FALLBACK_ID)?.setAttribute('hidden', 'hidden');

  /** The Write and Preview tabs, and what switching between them does. */
  function tabStrip(): { element: HTMLElement } {
    const element = document.createElement('div');
    element.className = 'admin-editor-tabs';

    const write = tab('Write', true);
    const read = tab('Preview', false);
    element.append(write, read);

    write.addEventListener('click', () => {
      show(true);
    });
    read.addEventListener('click', () => {
      show(false);
      void refresh();
    });

    function show(writing: boolean): void {
      surface.hidden = !writing;
      preview.hidden = writing;
      write.setAttribute('aria-selected', String(writing));
      read.setAttribute('aria-selected', String(!writing));
      if (writing) view.focus();
    }

    /** Ask the server what this body looks like, and show what it says. */
    async function refresh(): Promise<void> {
      preview.srcdoc = '';
      say('Rendering…');
      textarea.value = view.state.doc.toString();

      try {
        const response = await fetch(previewUrl, {
          method: 'POST',
          body: new FormData(form),
          credentials: 'same-origin',
        });
        if (!response.ok) {
          say(`The preview came back ${String(response.status)}.`);
          return;
        }
        preview.srcdoc = await response.text();
        say('');
      } catch {
        say('The preview could not be reached.');
      }
    }

    return { element };
  }

  /** The button and the file input behind it. */
  function uploadControl(): HTMLElement {
    const wrapper = document.createElement('span');
    wrapper.className = 'admin-editor-upload';

    // No `name`, so it is never part of the form the editor submits or the
    // form the preview posts.
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.hidden = true;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'admin-button-quiet';
    button.textContent = 'Add file…';
    button.addEventListener('click', () => {
      input.click();
    });

    input.addEventListener('change', () => {
      const files = input.files;
      if (files !== null && files.length > 0) void uploadAll(files);
      input.value = '';
    });

    wrapper.append(button, input);
    return wrapper;
  }

  /** Send every dropped or chosen file, in order, inserting as they land. */
  async function uploadAll(files: FileList): Promise<void> {
    for (const file of Array.from(files)) {
      say(`Uploading ${file.name}…`);
      const inserted = await uploadOne(file);
      if (!inserted) return;
    }
    say('');
  }

  /** One file. Returns false when the server refused it, and says why. */
  async function uploadOne(file: File): Promise<boolean> {
    const payload = new FormData();
    payload.set('csrf_token', csrfToken());
    payload.set('file', file);

    let response: Response;
    try {
      response = await fetch(uploadUrl, {
        method: 'POST',
        body: payload,
        credentials: 'same-origin',
      });
    } catch {
      say(`${file.name} could not be uploaded.`);
      return false;
    }

    const result = (await response.json().catch(() => ({}))) as {
      markdown?: string;
      error?: string;
    };

    if (!response.ok || typeof result.markdown !== 'string') {
      say(result.error ?? `${file.name} was refused (${String(response.status)}).`);
      return false;
    }

    insert(result.markdown);
    return true;
  }

  /** Put text where the cursor is, and leave the cursor after it. */
  function insert(text: string): void {
    const range = view.state.selection.main;
    const body = `${text}\n`;
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: body },
      selection: { anchor: range.from + body.length },
    });
    textarea.value = view.state.doc.toString();
    view.focus();
  }

  /** The session's CSRF token, from the hidden field every admin form carries. */
  function csrfToken(): string {
    const field = form.elements.namedItem('csrf_token');
    return field instanceof HTMLInputElement ? field.value : '';
  }

  /** Say something, or nothing, in the editor's status line. */
  function say(message: string): void {
    status.textContent = message;
  }
}

/** One tab in the strip. */
function tab(label: string, selected: boolean): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'admin-editor-tab';
  button.textContent = label;
  button.setAttribute('aria-selected', String(selected));
  return button;
}

/** Whether a drag is carrying files rather than, say, selected text. */
function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}
