// Narrows an untyped string (GraphQL enum, env var, config value) to a known
// union member without an `as` cast.
export function oneOf<T extends string>(
  values: readonly T[],
  value: unknown,
): T | undefined {
  return values.find((v) => v === value);
}
