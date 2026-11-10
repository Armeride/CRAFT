// Development diagnostics only; this is not a product service or schema contract.
export const environment = {
  node: process.version,
  platform: process.platform,
  architecture: process.arch,
} as const;

console.log(JSON.stringify(environment, null, 2));
