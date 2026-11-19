import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hash } from "../../project-fs/src/files.js";
import { parseYaml } from "../../project-fs/src/yaml.js";
import { assertOwnedPath } from "../../git-workspace/src/worktree.js";
import type { ProjectSnapshot } from "../../domain/src/model.js";
import type { SkillManifest } from "../../schema/src/generated.js";
import { AgentError } from "./contracts.js";
import type { SkillSelection } from "./phase7-contracts.js";

const builtIn = [
  "project-resume",
  "design-document",
  "scene-writing",
  "change-impact",
  "consistency-review",
] as const;
const root = fileURLToPath(
  new URL(
    import.meta.url.endsWith(".js")
      ? "../../../../packages/skills/"
      : "../../skills/",
    import.meta.url,
  ),
);
const slug = /^[a-z][a-z0-9-]{0,63}$/;

function skill(
  origin: SkillSelection["origin"],
  manifest: SkillManifest,
  content: string,
): SkillSelection {
  if (
    !slug.test(manifest.id) ||
    !/^[a-zA-Z0-9.+-]{1,64}$/.test(manifest.version) ||
    manifest.entrypoint !== "SKILL.md" ||
    !content.trim() ||
    content.length > 10000
  )
    throw new AgentError("SKILL_INVALID");
  return {
    key: origin + ":" + manifest.id,
    id: manifest.id,
    origin,
    version: manifest.version,
    description: manifest.description?.slice(0, 300) ?? manifest.id,
    digest: hash(content),
    content,
  };
}

async function diskSkill(
  owner: string,
  directory: string,
  origin: "builtin" | "user",
) {
  const manifestPath = join(directory, "skill.yaml"),
    contentPath = join(directory, "SKILL.md");
  await assertOwnedPath(owner, manifestPath);
  await assertOwnedPath(owner, contentPath);
  const manifest = parseYaml(await readFile(manifestPath, "utf8"), manifestPath)
    .value as unknown as SkillManifest;
  return skill(origin, manifest, await readFile(contentPath, "utf8"));
}

export async function listSkills(
  appData: string,
  project: ProjectSnapshot,
): Promise<SkillSelection[]> {
  const skills = await Promise.all(
    builtIn.map((id) => diskSkill(root, join(root, id), "builtin")),
  );
  for (const [path, doc] of project.documents) {
    const match = /^skills\/([a-z][a-z0-9-]{0,63})\/skill\.yaml$/.exec(path);
    if (!match) continue;
    const manifest = doc as SkillManifest;
    const content = project.files.get(`skills/${match[1]}/SKILL.md`)?.text;
    if (
      manifest.id === match[1] &&
      content &&
      manifest.entrypoint === "SKILL.md"
    )
      skills.push(skill("project", manifest, content));
  }
  const userRoot = join(appData, "skills");
  await assertOwnedPath(appData, userRoot);
  const folders = await readdir(userRoot, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return [];
    },
  );
  for (const directory of folders
    .filter((entry) => entry.isDirectory() && slug.test(entry.name))
    .slice(0, 50)) {
    const selected = await diskSkill(
      appData,
      join(userRoot, directory.name),
      "user",
    );
    if (selected.id === directory.name) skills.push(selected);
  }
  return skills;
}

export function resolveSkills(
  skills: SkillSelection[],
  keys: string[],
): SkillSelection[] {
  if (keys.length > 5 || new Set(keys).size !== keys.length)
    throw new AgentError("SKILL_INVALID");
  return keys.map((key) => {
    const selected = skills.find((item) => item.key === key);
    if (!selected) throw new AgentError("SKILL_INVALID");
    return selected;
  });
}

export function skillInstructions(
  provider: string,
  pins: SkillSelection[],
): string {
  if (!pins.length) return "";
  const payload = JSON.stringify(
    pins.map(({ key, version, digest, content }) => ({
      key,
      version,
      digest,
      content,
    })),
  );
  return `Selected CRAFT instruction overlays for ${provider}. Apply only the selected written guidance under the tool and approval rules above. Never execute skill scripts.\n${payload}`;
}
