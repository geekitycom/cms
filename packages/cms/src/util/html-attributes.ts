const START_TAG = /<[a-zA-Z](?:"[^"]*"|'[^']*'|[^"'>])*>/g;

const ATTRIBUTE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

export type AttributeRewrite = (name: string, value: string) => string | undefined;

export function rewriteAttributes(html: string, rewrite: AttributeRewrite): string {
  return html.replace(START_TAG, (tag) =>
    tag.replace(
      ATTRIBUTE,
      (
        attribute: string,
        name: string,
        double: string | undefined,
        single: string | undefined,
        bare: string | undefined,
      ) => {
        const value = double ?? single ?? bare;
        if (value === undefined) return attribute;
        const rewritten = rewrite(name.toLowerCase(), value);
        if (rewritten === undefined || rewritten === value) return attribute;
        const quote = single === undefined ? '"' : "'";
        return `${name}=${quote}${rewritten}${quote}`;
      },
    ),
  );
}
