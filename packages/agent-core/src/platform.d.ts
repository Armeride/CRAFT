// MCP SDK declarations refer to the Fetch API alias that Node exposes through undici-types.
declare global {
  type HeadersInit = import("undici-types").HeadersInit;
}
export {};
