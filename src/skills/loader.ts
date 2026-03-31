import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from '../logger.js';
import type { Skill } from '../types.js';

export class SkillLoader {
  private cachedSkills: Skill[] | null = null;

  constructor(
    private readonly skillsDir: string,
    private readonly logger: Logger,
  ) {}

  loadAll(): Skill[] {
    if (this.cachedSkills) return this.cachedSkills;
    if (!existsSync(this.skillsDir)) return [];

    const skills: Skill[] = [];
    const entries = readdirSync(this.skillsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const metaPath = join(this.skillsDir, entry.name, 'skill.json');
      try {
        const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
        skills.push({ name: meta.name ?? entry.name, type: meta.type ?? 'utility' });
        this.logger.info({ skill: entry.name, type: meta.type }, 'Skill loaded');
      } catch {
        // skill.json missing or invalid — skip
      }
    }

    this.cachedSkills = skills;
    return skills;
  }

  getChannelSkills(): Skill[] {
    return this.loadAll().filter((s) => s.type === 'channel');
  }

  getContainerSkills(): Skill[] {
    return this.loadAll().filter((s) => s.type === 'container');
  }
}
