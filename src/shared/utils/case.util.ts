export const toSnakeCase = function(str: string): string {
  return str
    // 1. separa acronimi seguiti da parola normale
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    // 2. separa lowercase → uppercase
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

export const toCamelCase = function(str: string): string {
  return str
    .toLowerCase()
    .replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}