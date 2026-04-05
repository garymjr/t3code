import fsPromises from "node:fs/promises";
import OS from "node:os";
import path from "node:path";

import { Effect } from "effect";
import type { ServerSkill } from "@t3tools/contracts";

interface SkillFrontmatter {
  readonly name: string;
  readonly description: string;
}

function resolveCodexHome(homePath?: string): string {
  return homePath || process.env.CODEX_HOME || path.join(OS.homedir(), ".codex");
}

async function readDirectories(parentDir: string): Promise<string[]> {
  const entries = await fsPromises.readdir(parentDir, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

function parseSkillFrontmatter(markdown: string): SkillFrontmatter | null {
  const match = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/.exec(markdown);
  if (!match) {
    return null;
  }
  const frontmatterBlock = match[1];
  if (!frontmatterBlock) {
    return null;
  }

  let name: string | null = null;
  let description: string | null = null;

  for (const rawLine of frontmatterBlock.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf(":");
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    const value = line
      .slice(separatorIndex + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
    if (!value) continue;
    if (key === "name") {
      name = value;
      continue;
    }
    if (key === "description") {
      description = value;
    }
  }

  if (!name || !description) {
    return null;
  }

  return { name, description };
}

async function readSkill(skillFilePath: string, id: string): Promise<ServerSkill | null> {
  const markdown = await fsPromises.readFile(skillFilePath, "utf8");
  const frontmatter = parseSkillFrontmatter(markdown);
  if (!frontmatter) {
    return null;
  }
  return {
    id,
    name: frontmatter.name,
    description: frontmatter.description,
  };
}

async function collectUserSkills(codexHome: string): Promise<ServerSkill[]> {
  const skillsDir = path.join(codexHome, "skills");
  const skillDirs = await readDirectories(skillsDir);
  const skills = await Promise.all(
    skillDirs.map((dirName) =>
      readSkill(path.join(skillsDir, dirName, "SKILL.md"), dirName).catch(() => null),
    ),
  );
  return skills.filter((skill): skill is ServerSkill => skill !== null);
}

async function collectPluginSkills(codexHome: string): Promise<ServerSkill[]> {
  const pluginCacheDir = path.join(codexHome, "plugins", "cache");
  const marketplaceDirs = await readDirectories(pluginCacheDir);
  const skills: ServerSkill[] = [];

  for (const marketplaceDir of marketplaceDirs) {
    const marketplacePath = path.join(pluginCacheDir, marketplaceDir);
    const pluginDirs = await readDirectories(marketplacePath);
    for (const pluginDir of pluginDirs) {
      const pluginPath = path.join(marketplacePath, pluginDir);
      const versionDirs = await readDirectories(pluginPath);
      for (const versionDir of versionDirs) {
        const versionPath = path.join(pluginPath, versionDir, "skills");
        const skillDirs = await readDirectories(versionPath).catch(() => []);
        const pluginSkills = await Promise.all(
          skillDirs.map((skillDir) =>
            readSkill(
              path.join(versionPath, skillDir, "SKILL.md"),
              `${pluginDir}:${skillDir}`,
            ).catch(() => null),
          ),
        );
        for (const skill of pluginSkills) {
          if (skill) {
            skills.push(skill);
          }
        }
      }
    }
  }

  return skills;
}

function compareSkills(left: ServerSkill, right: ServerSkill): number {
  return left.id.localeCompare(right.id);
}

export const listInstalledSkills = (homePath?: string) =>
  Effect.promise(async () => {
    const codexHome = resolveCodexHome(homePath);
    const [userSkills, pluginSkills] = await Promise.all([
      collectUserSkills(codexHome).catch(() => []),
      collectPluginSkills(codexHome).catch(() => []),
    ]);

    const deduped = new Map<string, ServerSkill>();
    for (const skill of [...userSkills, ...pluginSkills]) {
      deduped.set(skill.id, skill);
    }
    return [...deduped.values()].toSorted(compareSkills);
  }).pipe(Effect.orElseSucceed((): ServerSkill[] => []));
