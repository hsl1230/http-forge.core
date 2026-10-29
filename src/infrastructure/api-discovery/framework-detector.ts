import * as fs from 'fs';
import * as path from 'path';
import { ApiFramework, FrameworkFingerprint } from './types';

const FINGERPRINT_FILES = [
  'package.json',
  'src/main.ts',
  'src/main.js',
  'src/app.ts',
  'src/app.js',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'requirements.txt',
  'pyproject.toml',
  'poetry.lock',
  'Pipfile',
  'app/main.py',
  'main.py',
];

const DETECTION_HINTS: Record<ApiFramework, string[]> = {
  express: ['express', 'router.', 'app.use(', 'app.get(', 'express.Router'],
  nestjs: ['@nestjs/common', '@Controller(', '@Get(', '@Post('],
  fastify: ['fastify', 'fastify.route(', 'fastify.get(', 'register('],
  lambda: ['exports.handler', 'event.pathParameters', 'APIGatewayProxyEvent', 'aws-lambda'],
  spring: ['@RestController', '@Controller', '@GetMapping', '@PostMapping', '@RequestMapping'],
  fastapi: ['from fastapi', 'import fastapi', '@app.get(', '@router.get('],
  unknown: []
};

/**
 * Which source-file extensions each framework's source-hint scan may inspect.
 * Keeps hints from leaking across languages (e.g. `app.get(` in a Python
 * FastAPI decorator must not trigger the Express hint).
 */
const FRAMEWORK_SOURCE_EXTENSIONS: Record<Exclude<ApiFramework, 'unknown'>, string[]> = {
  express: ['.ts', '.js'],
  nestjs: ['.ts', '.js'],
  fastify: ['.ts', '.js'],
  lambda: ['.ts', '.js'],
  spring: ['.java'],
  fastapi: ['.py'],
};

export class FrameworkDetector {
  public buildFingerprint(projectRoot: string): FrameworkFingerprint {
    const evidenceFiles: string[] = [];
    const packageJsonPath = path.join(projectRoot, 'package.json');
    let packageJson: FrameworkFingerprint['packageJson'];

    for (const relative of FINGERPRINT_FILES) {
      const candidate = path.join(projectRoot, relative);
      if (fs.existsSync(candidate)) {
        evidenceFiles.push(candidate);
      }
    }

    if (fs.existsSync(packageJsonPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        packageJson = {
          dependencies: parsed.dependencies,
          devDependencies: parsed.devDependencies,
          scripts: parsed.scripts
        };
      } catch {
        // Keep fingerprint usable even if package.json cannot be parsed.
      }
    }

    return {
      projectRoot,
      packageJsonPath: fs.existsSync(packageJsonPath) ? packageJsonPath : undefined,
      packageJson,
      evidenceFiles
    };
  }

  public detectFrameworks(fingerprint: FrameworkFingerprint): ApiFramework[] {
    const found: ApiFramework[] = [];

    if (this.hasDependency(fingerprint, 'express') || this.hasSourceHint(fingerprint, 'express')) {
      found.push('express');
    }
    if (this.hasDependency(fingerprint, '@nestjs/common') || this.hasSourceHint(fingerprint, 'nestjs')) {
      found.push('nestjs');
    }
    if (this.hasDependency(fingerprint, 'fastify') || this.hasSourceHint(fingerprint, 'fastify')) {
      found.push('fastify');
    }
    if (this.hasBuildFile(fingerprint, 'pom.xml') || this.hasBuildFile(fingerprint, 'build.gradle')
      || this.hasBuildFile(fingerprint, 'build.gradle.kts') || this.hasBuildFile(fingerprint, 'settings.gradle')
      || this.hasSourceHint(fingerprint, 'spring')) {
      found.push('spring');
    }
    if (this.hasBuildFile(fingerprint, 'requirements.txt') || this.hasBuildFile(fingerprint, 'pyproject.toml')
      || this.hasBuildFile(fingerprint, 'poetry.lock') || this.hasBuildFile(fingerprint, 'Pipfile')
      || this.hasSourceHint(fingerprint, 'fastapi')) {
      found.push('fastapi');
    }

    const hasExpressOrFastify = found.includes('express') || found.includes('fastify');
    if (!hasExpressOrFastify) {
      const isLambdaDep =
        this.hasDependency(fingerprint, '@types/aws-lambda') ||
        this.hasDependency(fingerprint, 'aws-lambda') ||
        this.hasDependency(fingerprint, 'serverless');
      if (isLambdaDep || this.hasSourceHint(fingerprint, 'lambda')) {
        found.push('lambda');
      }
    }

    return found.length > 0 ? found : ['unknown'];
  }

  private hasDependency(fingerprint: FrameworkFingerprint, packageName: string): boolean {
    const deps = fingerprint.packageJson?.dependencies ?? {};
    const devDeps = fingerprint.packageJson?.devDependencies ?? {};
    return Boolean(deps[packageName] || devDeps[packageName]);
  }

  private hasBuildFile(fingerprint: FrameworkFingerprint, fileName: string): boolean {
    return fs.existsSync(path.join(fingerprint.projectRoot, fileName));
  }

  private hasSourceHint(fingerprint: FrameworkFingerprint, framework: Exclude<ApiFramework, 'unknown'>): boolean {
    const hintDirs = ['src', 'app'];
    const hints = DETECTION_HINTS[framework];
    const extensions = FRAMEWORK_SOURCE_EXTENSIONS[framework];
    let inspectedFiles = 0;
    const maxFiles = 120;

    for (const dirName of hintDirs) {
      const srcPath = path.join(fingerprint.projectRoot, dirName);
      if (!fs.existsSync(srcPath)) {
        continue;
      }

      const queue = [srcPath];
      while (queue.length > 0 && inspectedFiles < maxFiles) {
        const current = queue.shift()!;
        let entries: fs.Dirent[];
        try {
          entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
          continue;
        }

        for (const entry of entries) {
          const fullPath = path.join(current, entry.name);
          if (entry.isDirectory()) {
            queue.push(fullPath);
            continue;
          }
          if (!entry.isFile() || !extensions.some((ext) => fullPath.endsWith(ext))) {
            continue;
          }

          inspectedFiles += 1;
          let content = '';
          try {
            content = fs.readFileSync(fullPath, 'utf-8');
          } catch {
            continue;
          }

          if (hints.some((hint) => content.includes(hint))) {
            return true;
          }
        }
      }
    }

    return false;
  }
}
