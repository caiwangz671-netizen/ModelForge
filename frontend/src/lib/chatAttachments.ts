import type { ChatAttachment } from '@/types';

const TEXT_FILE_EXTENSIONS = [
  '.txt',
  '.md',
  '.markdown',
  '.json',
  '.csv',
  '.yaml',
  '.yml',
  '.log',
  '.ini',
  '.cfg',
  '.xml',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.py',
  '.sql',
  '.sh',
];

const IMAGE_FILE_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.bmp',
  '.avif',
];

function getLowerName(file: File): string {
  return (file.name || '').trim().toLowerCase();
}

export function isImageAttachmentFile(file: File): boolean {
  const lowerName = getLowerName(file);
  return (
    file.type.startsWith('image/')
    || IMAGE_FILE_EXTENSIONS.some((ext) => lowerName.endsWith(ext))
  );
}

export function isTextAttachmentFile(file: File): boolean {
  const lowerName = getLowerName(file);
  return (
    file.type.startsWith('text/')
    || lowerName === 'readme'
    || TEXT_FILE_EXTENSIONS.some((ext) => lowerName.endsWith(ext))
  );
}

export function getAttachmentAcceptString(modelSupportsVisualInput: boolean): string {
  const textAccept = TEXT_FILE_EXTENSIONS.join(',');
  if (!modelSupportsVisualInput) {
    return textAccept;
  }
  const imageAccept = ['image/*', ...IMAGE_FILE_EXTENSIONS].join(',');
  return `${imageAccept},${textAccept}`;
}

export function summarizeAttachments(attachments: ChatAttachment[]): string {
  return attachments
    .map((attachment) => attachment.name.trim())
    .filter(Boolean)
    .join(', ');
}

export function buildAttachmentDisplayContent(content: string, attachments: ChatAttachment[]): string {
  const normalizedContent = (content || '').trim();
  const summary = summarizeAttachments(attachments);
  if (!summary) {
    return normalizedContent;
  }
  const note = `[attachments: ${summary}]`;
  return [normalizedContent, note].filter(Boolean).join('\n\n');
}

export function stripAttachmentDisplayContent(content: string): string {
  return String(content || '')
    .replace(/\n\n\[attachments:\s*.+?\]\s*$/is, '')
    .trim();
}

export async function readTextAttachment(file: File): Promise<string> {
  return await file.text();
}

export async function readImageAttachment(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
