export interface SkillSelection {
  key: string;
  id: string;
  origin: "builtin" | "project" | "user";
  version: string;
  digest: string;
  description: string;
  content: string;
}

export interface ExternalProfile {
  id: string;
  label: string;
  endpoint: string;
  credentialRef?: string;
  jobStatusTool?: string;
  tools: { name: string; effect: "read" | "write" }[];
}
