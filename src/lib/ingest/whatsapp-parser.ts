import JSZip from "jszip";

export interface ParsedWhatsApp {
  /** normalized `[timestamp] Name: message` lines, one per line */
  text: string;
  /** media attachments found inside the zip (not _chat.txt) */
  mediaFiles: { filename: string; data: Uint8Array }[];
  /** distinct sender names we saw — useful for debugging */
  senders: string[];
}

// Line formats we recognize:
//   iOS:     [25/02/2026, 14:30:12] Name: message
//   iOS alt: [2026-02-25, 14:30:12] Name: message   (locale variant)
//   Android: 25/02/2026, 14:30 - Name: message
//   Android: 2/25/26, 2:30 PM - Name: message       (US locale)
const IOS_LINE =
  /^\[(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}),\s*(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp][Mm])?)\]\s*(.+?):\s*(.*)$/;
const ANDROID_LINE =
  /^(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}),\s*(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp][Mm])?)\s*-\s*(.+?):\s*(.*)$/;

// Content patterns we want to either skip or replace
const MEDIA_PLACEHOLDER =
  /^[\u200e\s]*(?:<\s*Media\s+omitted\s*>|image\s+omitted|video\s+omitted|audio\s+omitted|GIF\s+omitted|sticker\s+omitted|document\s+omitted|Contact\s+card\s+omitted)[\u200e\s]*$/i;
const DELETED_MSG =
  /^(?:This message was deleted|You deleted this message|.*edited\.?)$/i;
const ATTACHED_FILE_TAG = /‎?<attached:\s*[^>]+>/g;

function cleanContent(msg: string): string | null {
  const stripped = msg.replace(/\u200e/g, "").trim();
  if (!stripped) return null;
  if (MEDIA_PLACEHOLDER.test(stripped)) return "[media]";
  if (DELETED_MSG.test(stripped)) return null;
  // If the message is only an attached-file tag, treat as media
  const noAttach = stripped.replace(ATTACHED_FILE_TAG, "").trim();
  if (!noAttach) return "[media]";
  return noAttach;
}

// Lines that aren't from a participant — WhatsApp system chatter.
// We skip these rather than attempting to attribute them.
const SYSTEM_PATTERNS = [
  /Messages and calls are end-to-end encrypted/i,
  /^You created group/i,
  /^.+?\s+created group/i,
  /^.+?\s+added\s+.+/i,
  /^.+?\s+removed\s+.+/i,
  /^.+?\s+left$/i,
  /^.+?\s+changed (this group's|the group|their) /i,
  /^.+?\s+joined using this group's invite link/i,
];

function looksSystem(sender: string, msg: string): boolean {
  return SYSTEM_PATTERNS.some((r) => r.test(`${sender} ${msg}`));
}

interface ParsedLine {
  normalized: string;
  sender: string;
}

function normalizeLine(line: string): ParsedLine | null {
  const stripped = line.replace(/\u200e/g, "");
  const iosMatch = stripped.match(IOS_LINE);
  if (iosMatch) {
    const [, date, time, sender, msg] = iosMatch;
    if (looksSystem(sender, msg)) return null;
    const cleaned = cleanContent(msg);
    if (cleaned === null) return null;
    return {
      sender: sender.trim(),
      normalized: `[${date} ${time.trim()}] ${sender.trim()}: ${cleaned}`,
    };
  }
  const androidMatch = stripped.match(ANDROID_LINE);
  if (androidMatch) {
    const [, date, time, sender, msg] = androidMatch;
    if (looksSystem(sender, msg)) return null;
    const cleaned = cleanContent(msg);
    if (cleaned === null) return null;
    return {
      sender: sender.trim(),
      normalized: `[${date} ${time.trim()}] ${sender.trim()}: ${cleaned}`,
    };
  }
  return null;
}

export async function parseWhatsAppZip(
  buffer: Uint8Array
): Promise<ParsedWhatsApp> {
  const zip = await JSZip.loadAsync(buffer);
  return parseZipArchive(zip);
}

/**
 * Parse from raw text. Useful for tests or anywhere we already have the
 * extracted chat string.
 */
export async function parseWhatsAppText(
  raw: string
): Promise<ParsedWhatsApp> {
  const outLines: string[] = [];
  const senders = new Set<string>();
  let buffered: ParsedLine | null = null;

  for (const rawLine of raw.split(/\r?\n/)) {
    const normalized = normalizeLine(rawLine);
    if (normalized) {
      if (buffered) outLines.push(buffered.normalized);
      buffered = normalized;
      senders.add(normalized.sender);
    } else if (buffered && rawLine.trim()) {
      const cont = rawLine.replace(/\u200e/g, "").trim();
      if (cont) buffered.normalized += `\n${cont}`;
    }
  }
  if (buffered) outLines.push(buffered.normalized);

  return {
    text: outLines.join("\n"),
    mediaFiles: [],
    senders: Array.from(senders),
  };
}

async function parseZipArchive(zip: JSZip): Promise<ParsedWhatsApp> {
  const outLines: string[] = [];
  const mediaFiles: { filename: string; data: Uint8Array }[] = [];
  const senders = new Set<string>();

  for (const [path, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    const lowerName = path.toLowerCase();
    if (
      lowerName.endsWith("_chat.txt") ||
      lowerName.endsWith("chat.txt") ||
      lowerName.endsWith(".txt")
    ) {
      const content = await file.async("string");
      let buffered: ParsedLine | null = null;
      for (const rawLine of content.split(/\r?\n/)) {
        const normalized = normalizeLine(rawLine);
        if (normalized) {
          if (buffered) outLines.push(buffered.normalized);
          buffered = normalized;
          senders.add(normalized.sender);
        } else if (buffered && rawLine.trim()) {
          const cont = rawLine.replace(/\u200e/g, "").trim();
          if (cont) buffered.normalized += `\n${cont}`;
        }
      }
      if (buffered) outLines.push(buffered.normalized);
    } else {
      const data = await file.async("uint8array");
      if (data.byteLength > 0) {
        const filename = path.split("/").pop() ?? path;
        mediaFiles.push({ filename, data });
      }
    }
  }

  return {
    text: outLines.join("\n"),
    mediaFiles,
    senders: Array.from(senders),
  };
}
