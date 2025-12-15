import type { Page } from 'playwright';
import crypto from 'node:crypto';

export interface ScriptArtifact {
  type: 'external-script' | 'inline-script';
  src?: string;
  hash: string;
  preview?: string;
}

export interface FrameArtifact {
  src: string;
  width: number | null;
  height: number | null;
  hidden: boolean;
}

export interface PixelArtifact {
  src: string;
  width: number | null;
  height: number | null;
}

export interface NoscriptArtifact {
  hash: string;
  preview: string;
}

export interface DomArtifacts {
  scripts: ScriptArtifact[];
  frames: FrameArtifact[];
  pixels: PixelArtifact[];
  noscripts: NoscriptArtifact[];
}

function hashText(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export async function extractDomArtifacts(page: Page): Promise<DomArtifacts> {
  const scripts: ScriptArtifact[] = [];
  const frames: FrameArtifact[] = [];
  const pixels: PixelArtifact[] = [];
  const noscripts: NoscriptArtifact[] = [];

  const scriptHandles = await page.$$('script');
  for (const handle of scriptHandles) {
    const src = await handle.getAttribute('src');
    const content = src ? '' : ((await handle.innerHTML()) || '');
    scripts.push({
      type: src ? 'external-script' : 'inline-script',
      src: src || undefined,
      hash: hashText(src ?? content),
      preview: content ? content.slice(0, 200) : undefined,
    });
  }

  const frameHandles = await page.$$('iframe');
  for (const handle of frameHandles) {
    const src = await handle.getAttribute('src');
    const box = await handle.boundingBox();
    const hidden = await page.evaluate((el) => {
      const style = window.getComputedStyle(el as HTMLElement);
      return style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
    }, handle);
    frames.push({
      src: src || '',
      width: box?.width ?? null,
      height: box?.height ?? null,
      hidden,
    });
  }

  const imgHandles = await page.$$('img');
  for (const handle of imgHandles) {
    const src = await handle.getAttribute('src');
    const box = await handle.boundingBox();
    if ((box?.width ?? 0) <= 2 || (box?.height ?? 0) <= 2) {
      pixels.push({
        src: src || '',
        width: box?.width ?? null,
        height: box?.height ?? null,
      });
    }
  }

  const noscriptHandles = await page.$$('noscript');
  for (const handle of noscriptHandles) {
    const html = (await handle.innerHTML()) || '';
    noscripts.push({
      hash: hashText(html),
      preview: html.slice(0, 200),
    });
  }

  return { scripts, frames, pixels, noscripts };
}
