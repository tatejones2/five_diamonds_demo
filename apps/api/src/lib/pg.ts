// Postgres error helpers. Drizzle may wrap driver errors, so check `cause` too.
function pgCode(e: unknown): string | undefined {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code ?? err?.cause?.code;
}
function pgConstraint(e: unknown): string | undefined {
  const err = e as { constraint?: string; cause?: { constraint?: string } };
  return err?.constraint ?? err?.cause?.constraint;
}

export const uniqueViolation = (e: unknown, constraint?: string) =>
  pgCode(e) === '23505' && (!constraint || pgConstraint(e) === constraint);
export const checkViolation = (e: unknown) => pgCode(e) === '23514';
export const fkViolation = (e: unknown) => pgCode(e) === '23503';
export const serializationFailure = (e: unknown) => pgCode(e) === '40001' || pgCode(e) === '40P01';
