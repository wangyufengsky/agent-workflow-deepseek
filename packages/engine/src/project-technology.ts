import { constants } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { nowIso, type ProjectTechnology } from '@agent-workflow/shared';
const MANIFESTS = ['package.json', 'tsconfig.json', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'pyproject.toml', 'requirements.txt', 'go.mod', 'Cargo.toml', 'composer.json', 'Gemfile', 'Package.swift', 'CMakeLists.txt'] as const;
const MAX_FILE = 64 * 1024; const MAX_TOTAL = 512 * 1024; const MAX_FILES = 32;
function object(raw: string): Record<string, unknown> { const value: unknown = JSON.parse(raw); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('不是对象'); return value as Record<string, unknown>; }
function identify(name: string, text: string): string[] {
  const found = new Set<string>();
  if (name === 'package.json') {
    const value = object(text); const dependencies = { ...(typeof value.dependencies === 'object' && value.dependencies ? value.dependencies : {}), ...(typeof value.devDependencies === 'object' && value.devDependencies ? value.devDependencies : {}) };
    if (Object.keys(dependencies).length || typeof value.name === 'string') found.add('JavaScript');
    const known: Record<string, string> = { typescript: 'TypeScript', react: 'React', vue: 'Vue', next: 'Next.js', nuxt: 'Nuxt', '@angular/core': 'Angular', svelte: 'Svelte', electron: 'Electron', express: 'Express', fastify: 'Fastify', '@nestjs/core': 'NestJS', vite: 'Vite' };
    for (const [key, label] of Object.entries(known)) if (Object.hasOwn(dependencies, key)) found.add(label);
  } else if (name === 'tsconfig.json') { const config = object(text); if (Object.hasOwn(config, 'compilerOptions') || Object.hasOwn(config, 'extends') || Object.hasOwn(config, 'references')) found.add('TypeScript'); }
  else if (name === 'pom.xml') {
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('XML实体声明不读取');
    text = text.replace(/<!--[\s\S]*?-->/g, '');
    if (/<project\b/.test(text)) found.add('Maven');
    if (/<(?:groupId|artifactId)>\s*(?:org\.springframework\.boot|spring-boot[^<]*)\s*<\//.test(text)) found.add('Spring Boot');
    if (/<artifactId>\s*kotlin-maven-plugin\s*<\//.test(text)) found.add('Kotlin');
    if (/<artifactId>\s*maven-compiler-plugin\s*<\//.test(text)) found.add('Java');
  } else if (name.startsWith('build.gradle')) {
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); found.add('Gradle');
    if (/['"]org\.springframework\.boot['"]/.test(code)) found.add('Spring Boot');
    if (/\bkotlin\s*\(|['"]org\.jetbrains\.kotlin/.test(code)) found.add('Kotlin');
    if (/['"](?:java|java-library)['"]/.test(code)) found.add('Java');
  } else if (name === 'pyproject.toml' || name === 'requirements.txt') { const code = text.replace(/^\s*#.*$/gm, ''); const declaration = name === 'pyproject.toml' ? /^\s*\[(?:project|build-system|tool\.poetry)\]/m.test(code) : /^\s*[A-Za-z0-9][A-Za-z0-9_.-]*(?:\[[^\]\n]+\])?(?:\s*(?:[<>=!~]|;|#)|\s*$)/m.test(code); if (declaration) { found.add('Python'); if (/\bfastapi\b/i.test(code)) found.add('FastAPI'); if (/\bdjango\b/i.test(code)) found.add('Django'); if (/\bflask\b/i.test(code)) found.add('Flask'); } }
  else if (name === 'go.mod' && /^\s*module\s+\S+/m.test(text)) { found.add('Go'); if (/github\.com\/gin-gonic\/gin\s/.test(text)) found.add('Gin'); }
  else if (name === 'Cargo.toml' && /^\s*\[(?:package|workspace)\]/m.test(text)) found.add('Rust');
  else if (name === 'composer.json') { const value = object(text); found.add('PHP'); if (value.require && typeof value.require === 'object' && Object.hasOwn(value.require, 'laravel/framework')) found.add('Laravel'); }
  else if (name === 'Gemfile' && /\bgem\s+['"]/.test(text)) { found.add('Ruby'); if (/\bgem\s+['"]rails['"]/.test(text)) found.add('Rails'); }
  else if (name === 'Package.swift' && /Package\s*\(/.test(text)) found.add('Swift');
  else if (name === 'CMakeLists.txt' && /\b(?:project|cmake_minimum_required)\s*\(/i.test(text)) found.add('CMake');
  return [...found];
}
/** No project code, scripts, imports or dependency installation are executed. */
export async function detectProjectTechnology(rootPath: string): Promise<ProjectTechnology> {
  const checkedAt = nowIso(); const sources: ProjectTechnology['sources'][number][] = []; const warnings: string[] = []; const names = new Set<string>(); let bytesRead = 0; let filesRead = 0; let truncated = false;
  let root: string; try { root = await realpath(rootPath); if (!(await lstat(root)).isDirectory()) throw new Error(); } catch { return { state: 'unavailable', technologies: [], sources, checkedAt, warnings, truncated, reason: '项目目录不可访问，无法识别技术栈' }; }
  const scan = async (directory: string, prefix: string) => {
    for (const name of MANIFESTS) {
      const path = join(directory, name); const relativePath = prefix + name;
      if (filesRead >= MAX_FILES || bytesRead >= MAX_TOTAL) { truncated = true; return; }
      let handle: Awaited<ReturnType<typeof open>> | undefined;
      try {
        if (await realpath(path) !== path) { warnings.push(`${relativePath}：符号链接路径未读取`); continue; }
        const stat = await lstat(path); if (stat.isSymbolicLink()) { warnings.push(`${relativePath}：符号链接未读取`); continue; } if (!stat.isFile()) continue;
        if (stat.size > MAX_FILE || bytesRead + stat.size > MAX_TOTAL) { warnings.push(`${relativePath}：超过读取上限`); truncated = true; continue; }
        handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); const before = await handle.stat(); const openedPath = await lstat(path); if (await realpath(path) !== path || !before.isFile() || before.size > MAX_FILE || bytesRead + before.size > MAX_TOTAL || before.dev !== stat.dev || before.ino !== stat.ino || before.dev !== openedPath.dev || before.ino !== openedPath.ino) throw new Error('文件身份变化');
        const buffer = Buffer.alloc(Math.min(MAX_FILE + 1, before.size + 1)); const read = await handle.read(buffer, 0, buffer.length, 0); const after = await handle.stat(); const finalPath = await lstat(path);
        if (await realpath(path) !== path || finalPath.dev !== before.dev || finalPath.ino !== before.ino) throw new Error('文件路径变化');
        if (read.bytesRead > MAX_FILE || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || read.bytesRead !== before.size) throw new Error('读取期间文件变化');
        filesRead++; bytesRead += read.bytesRead; const data = buffer.subarray(0, read.bytesRead); if (data.includes(0)) throw new Error('非文本manifest');
        const technologies = identify(name, data.toString('utf8')); for (const value of technologies) names.add(value);
        sources.push({ path: relativePath, sha256: createHash('sha256').update(data).digest('hex'), bytes: data.length, technologies });
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') warnings.push(`${relativePath}：无法读取或解析`); }
      finally { await handle?.close(); }
    }
  };
  await scan(root, '');
  // Common monorepo containers only: depth <= 2, <= 8 child directories each,
  // <= 64 directory entries inspected; no traversal of arbitrary subtrees.
  for (const container of ['apps', 'packages', 'services']) {
    if (filesRead >= MAX_FILES || bytesRead >= MAX_TOTAL) { truncated = true; break; }
    const path = join(root, container); let directory: Awaited<ReturnType<typeof opendir>> | undefined;
    try {
      const stat = await lstat(path); if (stat.isSymbolicLink() || await realpath(path) !== path) { warnings.push(`${container}/：符号链接目录未读取`); continue; } if (!stat.isDirectory()) continue;
      directory = await opendir(path); let inspected = 0; let children = 0;
      for await (const entry of directory) {
        if (++inspected > 64 || children >= 8) { truncated = true; break; }
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const child = join(path, entry.name); if ((await lstat(child)).isSymbolicLink()) continue;
        // Recheck ancestors after opening no-follow files to reject directory replacement.
        if (await realpath(child) !== child) { warnings.push(`${container}/${entry.name}/：路径变化未读取`); continue; }
        children++; await scan(child, `${container}/${entry.name}/`);
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') warnings.push(`${container}/：目录不可读取`); }
  }
  const state = names.size ? 'detected' : warnings.length ? 'unavailable' : 'unknown';
  return { state, technologies: [...names].sort(), sources, checkedAt, warnings, truncated, ...(state !== 'detected' ? { reason: state === 'unknown' ? '未发现可识别的常见项目manifest' : '可识别manifest未能安全读取；请重新检测' } : {}) };
}
