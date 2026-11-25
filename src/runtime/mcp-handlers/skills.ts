import * as fs from 'fs';
import * as path from 'path';
import type { McpToolHandler } from './types';
import { GENERIC_TOOL_NAMES } from '../mcp-tool-schemas';

export const skillHandlers: McpToolHandler[] = [
  {
    toolNames: [GENERIC_TOOL_NAMES.listSkills],
    async handle({ services }) {
      const skillsDir = path.join(services.workspaceFolder || '', '.http-forge', 'skills');
      if (!fs.existsSync(skillsDir)) {
        return { skills: [], message: 'No skills directory found. Create .http-forge/skills/ and add .md files.' };
      }
      const skills: Array<{ name: string; path: string; description: string }> = [];
      const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (entry.name.endsWith('.md')) {
            try {
              const content = fs.readFileSync(full, 'utf-8');
              const nameMatch = content.match(/^name:\s*(.+)$/m);
              const descMatch = content.match(/^description:\s*(.+)$/m);
              skills.push({
                name: nameMatch ? nameMatch[1].trim() : entry.name.replace('.md', ''),
                path: path.relative(skillsDir, full),
                description: descMatch ? descMatch[1].trim() : '',
              });
            } catch {
              // ignore
            }
          }
        }
      };
      walk(skillsDir);
      return { skills, count: skills.length };
    },
  },
  {
    toolNames: [GENERIC_TOOL_NAMES.getSkill],
    async handle({ args, services }) {
      const skillName = typeof args.name === 'string' ? args.name.trim() : '';
      if (!skillName) throw new Error('"name" is required');

      const skillsDir = path.join(services.workspaceFolder || '', '.http-forge', 'skills');
      if (!fs.existsSync(skillsDir)) throw new Error('No skills directory found');

      // Search for the skill file
      const findSkill = (dir: string): string | null => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            const found = findSkill(full);
            if (found) return found;
          } else if (entry.name.endsWith('.md')) {
            try {
              const content = fs.readFileSync(full, 'utf-8');
              const nameMatch = content.match(/^name:\s*(.+)$/m);
              const name = nameMatch ? nameMatch[1].trim() : entry.name.replace('.md', '');
              if (name === skillName) return full;
            } catch {
              // ignore
            }
          }
        }
        return null;
      };

      const filePath = findSkill(skillsDir);
      if (!filePath) throw new Error(`Skill "${skillName}" not found`);

      const content = fs.readFileSync(filePath, 'utf-8');
      return { name: skillName, path: path.relative(skillsDir, filePath), content };
    },
  },
];
