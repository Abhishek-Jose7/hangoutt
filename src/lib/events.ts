import { cacheGet, cacheSet } from './redis';

export interface LocalEvent {
  title: string;
  venue: string;
  dateText: string;
  category: string;
  sourceUrl?: string;
}

function cleanEventTitle(title: string): string {
  return title
    .replace(/\s*\|\s*.*/g, '')
    .replace(/\s*-\s*BookMyShow.*/i, '')
    .replace(/\s*-\s*Tickets.*/i, '')
    .trim();
}

function extractVenue(content: string, fallbackArea: string): string {
  const line = content.split('.').find((part) => /\b(at|venue|location|near)\b/i.test(part));
  if (!line) return fallbackArea;
  const trimmed = line.replace(/\s+/g, ' ').trim();
  return trimmed.length > 64 ? `${fallbackArea}` : trimmed;
}

function extractDateText(content: string, dateLabel: string): string {
  const match = content.match(/\b(today|tonight|tomorrow|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/i);
  return match ? match[0] : dateLabel;
}

function inferCategory(text: string): string {
  const t = text.toLowerCase();
  if (t.includes('comedy')) return 'Comedy';
  if (t.includes('music') || t.includes('concert') || t.includes('gig')) return 'Music';
  if (t.includes('workshop')) return 'Workshop';
  if (t.includes('exhibition') || t.includes('art')) return 'Art';
  if (t.includes('food') || t.includes('festival')) return 'Festival';
  return 'Event';
}

export async function fetchTopEventsForArea(area: string, dateLabel: string): Promise<LocalEvent[]> {
  const key = `events:v1:${area.toLowerCase().replace(/\s+/g, '_')}:${dateLabel.toLowerCase().replace(/\s+/g, '_')}`;
  const cached = await cacheGet<LocalEvent[]>(key);
  if (cached) return cached;

  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return [];

  try {
    const { tavily } = await import('@tavily/core');
    const client = tavily({ apiKey });

    const query = `top events happening today ${dateLabel} near ${area} Mumbai with specific venue names and timings`;

    const response = await client.search(query, {
      maxResults: 8,
      searchDepth: 'basic',
    });

    const events = (response.results || [])
      .map((r: { title: string; content: string; url: string }) => {
        const title = cleanEventTitle(r.title || 'Local Event');
        const venue = extractVenue(r.content || '', area);
        const dateText = extractDateText(`${r.title} ${r.content}`, dateLabel);
        const category = inferCategory(`${r.title} ${r.content}`);

        return {
          title,
          venue,
          dateText,
          category,
          sourceUrl: r.url,
        } satisfies LocalEvent;
      })
      .filter((e) => e.title.length > 3)
      .slice(0, 5);

    await cacheSet(key, events, 60 * 30);
    return events;
  } catch (err) {
    console.error('[Events] fetchTopEventsForArea failed:', err);
    return [];
  }
}
