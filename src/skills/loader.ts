import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from '../logger.js';
import type { Skill } from '../types.js';

export class SkillLoader {
  constructor(
    private readonly skillsDir: string,
    private readonly logger: Logger,
  ) {}

  loadAll(): Skill[] {
    if (!existsSync(this.skillsDir)) return [];

    const skills: Skill[] = [];
    const entries = readdirSync(this.skillsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const metaPath = join(this.skillsDir, entry.name, 'skill.json');
      if (!existsSync(metaPath)) continue;

      try {
        const meta = JSON.parse(require('node:fs').readFileSync(metaPath, 'utf-8'));
        skills.push({
          name: meta.name ?? entry.name,
          type: meta.type ?? 'utility',
        });
        this.logger.info({ skill: entry.name, type: meta.type }, 'Skill loaded');
      } catch (err) {
        this.logger.warn({ skill: entry.name }, `Failed to load skill: ${(err as Error).message}`);
      }
    }

    return skills;
  }

  getChannelSkills(): Skill[] {
    return this.loadAll().filter((s) => s.type === 'channel');
  }

  getContainerSkills(): Skill[] {
    return this.loadAll().filter((s) => s.type === 'container');
  }
}
