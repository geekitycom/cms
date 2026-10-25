/**
 * The part of JSON Schema a tool's input and output are described in. Small
 * enough to check arguments against without a validator library, and typed
 * so a tool's `run` is handed exactly the shape its schema promises.
 */

interface Described {
  readonly description?: string;
}

export interface StringSchema extends Described {
  readonly type: 'string';
  readonly enum?: readonly [string, ...string[]];
}

export interface NumberSchema extends Described {
  readonly type: 'number' | 'integer';
  readonly minimum?: number;
  readonly maximum?: number;
}

export interface BooleanSchema extends Described {
  readonly type: 'boolean';
}

export interface ArraySchema extends Described {
  readonly type: 'array';
  readonly items: JsonSchema;
}

export interface ObjectSchema extends Described {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: false;
}

/** A value of the first schema, or `null`. Built with {@link nullable}. */
export interface NullableSchema extends Described {
  readonly anyOf: readonly [ValueSchema, { readonly type: 'null' }];
}

type ValueSchema = StringSchema | NumberSchema | BooleanSchema | ArraySchema | ObjectSchema;

export type JsonSchema = ValueSchema | NullableSchema;

/** `schema`, or `null`. */
export function nullable<const S extends ValueSchema>(
  schema: S,
): { readonly anyOf: readonly [S, { readonly type: 'null' }] } {
  return { anyOf: [schema, { type: 'null' }] };
}

/** The value a schema describes. */
export type FromSchema<S> = S extends { readonly anyOf: readonly [infer A, unknown] }
  ? FromSchema<A> | null
  : S extends {
        readonly type: 'string';
        readonly enum: readonly (infer E)[];
      }
    ? E
    : S extends { readonly type: 'string' }
      ? string
      : S extends { readonly type: 'number' | 'integer' }
        ? number
        : S extends { readonly type: 'boolean' }
          ? boolean
          : S extends { readonly type: 'array'; readonly items: infer I }
            ? FromSchema<I>[]
            : S extends { readonly type: 'object'; readonly properties: infer P }
              ? ObjectFrom<P, S extends { readonly required: readonly (infer R)[] } ? R : never>
              : never;

type ObjectFrom<P, R> = {
  readonly [K in keyof P & R]: FromSchema<P[K]>;
} & {
  readonly [K in Exclude<keyof P, R>]?: FromSchema<P[K]>;
};

/** What is wrong with `value` as `schema` describes it, one sentence per fault; empty when it fits. */
export function problemsWith(schema: JsonSchema, value: unknown, name?: string): string[] {
  const label = name ?? 'the arguments';
  if ('anyOf' in schema) return value === null ? [] : problemsWith(schema.anyOf[0], value, name);
  switch (schema.type) {
    case 'string':
      if (typeof value !== 'string') return [`${label} must be a string.`];
      if (schema.enum !== undefined && !schema.enum.includes(value)) {
        return [`${label} must be one of ${schema.enum.join(', ')}.`];
      }
      return [];
    case 'number':
    case 'integer':
      return numberProblems(schema, value, label);
    case 'boolean':
      return typeof value === 'boolean' ? [] : [`${label} must be true or false.`];
    case 'array':
      if (!Array.isArray(value)) return [`${label} must be a list.`];
      return value.flatMap((item, index) => problemsWith(schema.items, item, `${label}[${index}]`));
    case 'object':
      return objectProblems(schema, value, name);
  }
}

function numberProblems(schema: NumberSchema, value: unknown, name: string): string[] {
  if (typeof value !== 'number' || !Number.isFinite(value)) return [`${name} must be a number.`];
  if (schema.type === 'integer' && !Number.isInteger(value)) {
    return [`${name} must be a whole number.`];
  }
  if (schema.minimum !== undefined && value < schema.minimum) {
    return [`${name} must be at least ${schema.minimum}.`];
  }
  if (schema.maximum !== undefined && value > schema.maximum) {
    return [`${name} must be at most ${schema.maximum}.`];
  }
  return [];
}

function objectProblems(schema: ObjectSchema, value: unknown, name: string | undefined): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [`${name ?? 'the arguments'} must be an object.`];
  }
  const fields = value as Readonly<Record<string, unknown>>;
  const labelOf = (key: string): string => (name === undefined ? key : `${name}.${key}`);
  const missing = (schema.required ?? [])
    .filter((key) => fields[key] === undefined)
    .map((key) => `${labelOf(key)} is required.`);
  const present = Object.entries(fields).flatMap(([key, field]) => {
    if (Object.hasOwn(schema.properties, key)) {
      return problemsWith(schema.properties[key] as JsonSchema, field, labelOf(key));
    }
    return schema.additionalProperties === false ? [`${labelOf(key)} is not an argument.`] : [];
  });
  return [...missing, ...present];
}
