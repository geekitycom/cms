const MAX_FAMILY_LENGTH = 64;

/**
 * Whether `name` can be a Google Fonts family name: letters and digits in
 * words split by single spaces, as every family Google lists is.
 */
export function isFontFamilyName(name: string): boolean {
  return name.length <= MAX_FAMILY_LENGTH && /^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$/.test(name);
}

export type CssFontStack = string & { readonly __brand: 'CssFontStack' };

const STACK_FAMILY = /^(?:'[^'"\\<>;{}]*'|"[^'"\\<>;{}]*"|[\w-]+(?: +[\w-]+)*)$/;

/** `list` trimmed, when it is a comma-separated list of family names, plain or quoted. */
export function cssFontStack(list: string): CssFontStack | undefined {
  const stack = list.trim();
  return stack.split(',').every((family) => STACK_FAMILY.test(family.trim()))
    ? (stack as CssFontStack)
    : undefined;
}

/** `stack` with `family` quoted in front of it, when `family` is a font family name. */
export function cssFontStackWith(family: string, stack: CssFontStack): CssFontStack | undefined {
  return isFontFamilyName(family) ? (`"${family}", ${stack}` as CssFontStack) : undefined;
}
