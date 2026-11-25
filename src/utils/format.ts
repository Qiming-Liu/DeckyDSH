/** Bytes as whole megabytes, the unit download sizes are shown in. */
export function megabytes(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)} MB`;
}
