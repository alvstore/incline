export interface PostalAddress {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
}

/** Join saved fields only; never invent a missing customer or branch address. */
export function formatPostalAddress(value?: PostalAddress | null): string | null {
  const parts = [value?.address, value?.city, value?.state, value?.postal_code]
    .map(part => part?.trim())
    .filter((part): part is string => Boolean(part));
  const unique = parts.filter((part, index) => !parts.slice(0, index).some(previous =>
    previous.toLowerCase().includes(part.toLowerCase())));
  return unique.length ? unique.join(', ') : null;
}