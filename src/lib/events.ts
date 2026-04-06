import { cacheGet, cacheSet } from './redis';

type LocalFeedKind = 'event' | 'movie' | 'activity';

export interface LocalEvent {
  id: string;
  title: string;
  subtitle: string;
  dateText: string;
  category: string;
  kind: LocalFeedKind;
  imageUrl?: string;
  sourceUrl?: string;
}

function fallbackEvents(area: string, dateLabel: string): LocalEvent[] {
  return [
    {
      id: `fallback-event-${area}`,
      title: `${area} Live Events Tonight`,
      subtitle: `Concerts, stand-up and city events around ${area}`,
      dateText: dateLabel,
      category: 'Music',
      kind: 'event',
      imageUrl: `https://picsum.photos/seed/${encodeURIComponent(`${area}-event`)}/640/360`,
    },
    {
      id: `fallback-movie-${area}`,
      title: 'Now Showing: Latest Movies',
      subtitle: 'Trending theatrical releases and top picks this week',
      dateText: dateLabel,
      category: 'Movie',
      kind: 'movie',
      imageUrl: `https://picsum.photos/seed/${encodeURIComponent(`${area}-movie`)}/640/360`,
    },
    {
      id: `fallback-activity-${area}`,
      title: `Trending Things To Do In ${area}`,
      subtitle: 'Popular activities and social plans nearby',
      dateText: dateLabel,
      category: 'Activity',
      kind: 'activity',
      imageUrl: `https://picsum.photos/seed/${encodeURIComponent(`${area}-activity`)}/640/360`,
    },
  ];
}

function cleanEventTitle(title: string): string {
  return title
    .replace(/\s*\|\s*.*/g, '')
    .replace(/\s*:\s*Book (Now|Tickets).*$/i, '')
    .replace(/\s*-\s*BookMyShow.*/i, '')
    .replace(/\s*-\s*Tickets.*/i, '')
    .replace(/\s*-\s*IMDb.*/i, '')
    .replace(/\s*-\s*Rotten Tomatoes.*/i, '')
    .trim();
}

function normalizeTitle(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function looksGenericTitle(title: string): boolean {
  const lowered = normalizeTitle(title);
  const blocked = [
    'best places',
    'top places',
    'things to do',
    'places to visit',
    'top 10',
    'justdial',
    'tripadvisor',
    'zomato',
    'wanderlog',
    'thrillophilia',
    'near me',
  ];
  return blocked.some((term) => lowered.includes(term));
}

function looksAggregatorUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return [
    'justdial',
    'tripadvisor',
    'wanderlog',
    'thrillophilia',
    'zomato',
    'wikipedia',
  ].some((blocked) => lower.includes(blocked));
}

function isRelevantByKind(title: string, content: string, kind: LocalFeedKind): boolean {
  const text = `${title} ${content}`.toLowerCase();

  if (/\b(wedding|banquet|hall|venue hire|venue booking|hotel booking|resort booking)\b/.test(text)) {
    return false;
  }

  if (kind === 'movie') {
    return /\b(movie|cinema|theatre|release|showtime|now showing|box office|trailer)\b/.test(text);
  }

  if (kind === 'event') {
    return /\b(event|concert|festival|show|stand[-\s]?up|comedy|gig|play|exhibition|workshop|night)\b/.test(text);
  }

  return /\b(activity|things to do|workshop|adventure|game|experience|walk|tour|escape room|trampoline|bowling|arcade)\b/.test(text);
}

function extractSubtitle(content: string, fallback: string): string {
  const firstSentence = content
    .replace(/\s+/g, ' ')
    .split(/[.!?]/)
    .map((part) => part.trim())
    .find((part) => part.length > 18);

  if (!firstSentence) return fallback;
  if (firstSentence.length <= 120) return firstSentence;
  return `${firstSentence.slice(0, 117)}...`;
}

function extractDateText(content: string, dateLabel: string): string {
  const match = content.match(/\b(today|tonight|tomorrow|this week|this weekend|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/i);
  return match ? match[0] : dateLabel;
}

function inferCategory(text: string, kind: LocalFeedKind): string {
  if (kind === 'movie') return 'Movie';

  const t = text.toLowerCase();
  if (t.includes('comedy')) return 'Comedy';
  if (t.includes('music') || t.includes('concert') || t.includes('gig')) return 'Music';
  if (t.includes('movie') || t.includes('cinema') || t.includes('theatre')) return 'Movie';
  if (t.includes('workshop')) return 'Workshop';
  if (t.includes('activity') || t.includes('adventure')) return 'Activity';
  if (t.includes('exhibition') || t.includes('art')) return 'Art';
  if (t.includes('food') || t.includes('festival')) return 'Festival';
  return 'Event';
}

function dedupeEvents(items: LocalEvent[]): LocalEvent[] {
  const seen = new Set<string>();
  const out: LocalEvent[] = [];

  for (const item of items) {
    const key = normalizeTitle(item.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }

  return out;
}

function pickImageFromResult(result: Record<string, unknown>): string | undefined {
  const direct = result.image_url;
  if (typeof direct === 'string' && direct.trim()) return direct;

  const images = result.images;
  if (Array.isArray(images)) {
    const firstString = images.find((value) => typeof value === 'string');
    if (typeof firstString === 'string' && firstString.trim()) return firstString;
  }

  return undefined;
}

function absolutizeUrl(url: string, baseUrl: string): string {
  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return url;
  }
}

async function fetchOgImage(pageUrl: string): Promise<string | undefined> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(pageUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; HangoutEventsBot/1.0)',
      },
    });
    clearTimeout(timeout);

    if (!res.ok) return undefined;
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('text/html')) return undefined;

    const html = await res.text();
    const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
    const twitterMatch = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
    const imageUrl = ogMatch?.[1] || twitterMatch?.[1];

    if (!imageUrl) return undefined;
    return absolutizeUrl(imageUrl, pageUrl);
  } catch {
    return undefined;
  }
}

type TavilySearchResult = {
  title: string;
  content: string;
  url: string;
  image_url?: string;
  images?: string[];
};

async function mapTavilyResultsToFeed(
  results: TavilySearchResult[],
  kind: LocalFeedKind,
  area: string,
  dateLabel: string,
  limit: number
): Promise<LocalEvent[]> {
  const cleaned = results
    .filter((result) => !!result?.title)
    .map((result) => ({
      title: cleanEventTitle(result.title || ''),
      content: result.content || '',
      sourceUrl: result.url || '',
      imageUrl: pickImageFromResult(result as unknown as Record<string, unknown>),
    }))
    .filter((item) => item.title.length > 3)
    .filter((item) => !looksGenericTitle(item.title))
    .filter((item) => !looksAggregatorUrl(item.sourceUrl))
    .filter((item) => isRelevantByKind(item.title, item.content, kind))
    .slice(0, limit + 2);

  const enriched = await Promise.all(
    cleaned.map(async (item, index) => {
      const ogImage = item.imageUrl || (item.sourceUrl ? await fetchOgImage(item.sourceUrl) : undefined);

      return {
        id: `${kind}-${normalizeTitle(item.title).replace(/\s+/g, '-')}-${index}`,
        title: item.title,
        subtitle: extractSubtitle(item.content, `Trending in ${area}`),
        dateText: extractDateText(`${item.title} ${item.content}`, dateLabel),
        category: inferCategory(`${item.title} ${item.content}`, kind),
        kind,
        imageUrl: ogImage,
        sourceUrl: item.sourceUrl || undefined,
      } satisfies LocalEvent;
    })
  );

  return enriched.slice(0, limit);
}

async function fetchMovieFeedFromTmdb(dateLabel: string): Promise<LocalEvent[]> {
  const tmdbKey = process.env.TMDB_API_KEY;
  if (!tmdbKey) return [];

  try {
    const res = await fetch(
      `https://api.themoviedb.org/3/trending/movie/week?api_key=${tmdbKey}&language=en-US`,
      { next: { revalidate: 3600 } }
    );
    if (!res.ok) return [];

    const json = (await res.json()) as {
      results?: Array<{
        id: number;
        title?: string;
        overview?: string;
        poster_path?: string;
        release_date?: string;
        vote_average?: number;
      }>;
    };

    return (json.results || [])
      .slice(0, 4)
      .map((movie, index) => {
        const release = movie.release_date ? new Date(movie.release_date).toLocaleDateString('en-IN') : dateLabel;
        return {
          id: `tmdb-movie-${movie.id}-${index}`,
          title: movie.title || 'Trending Movie',
          subtitle: extractSubtitle(movie.overview || '', 'Now showing and trending this week'),
          dateText: release,
          category: 'Movie',
          kind: 'movie' as const,
          imageUrl: movie.poster_path ? `https://image.tmdb.org/t/p/w780${movie.poster_path}` : undefined,
          sourceUrl: `https://www.themoviedb.org/movie/${movie.id}`,
        } satisfies LocalEvent;
      })
      .filter((movie) => movie.title.length > 2);
  } catch (err) {
    console.error('[Events] TMDB fetch failed:', err);
    return [];
  }
}

function interleaveFeeds(feeds: LocalEvent[][], totalLimit: number): LocalEvent[] {
  const out: LocalEvent[] = [];
  let pointer = 0;

  while (out.length < totalLimit) {
    let pushed = false;

    for (const feed of feeds) {
      if (pointer < feed.length) {
        out.push(feed[pointer]);
        pushed = true;
        if (out.length >= totalLimit) break;
      }
    }

    if (!pushed) break;
    pointer += 1;
  }

  return out;
}

export async function fetchTopEventsForArea(area: string, dateLabel: string): Promise<LocalEvent[]> {
  const key = `events:v2:${area.toLowerCase().replace(/\s+/g, '_')}:${dateLabel.toLowerCase().replace(/\s+/g, '_')}`;
  const cached = await cacheGet<LocalEvent[]>(key);
  if (cached) return cached;

  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return fallbackEvents(area, dateLabel);

  try {
    const { tavily } = await import('@tavily/core');
    const client = tavily({ apiKey });

    const [eventsResponse, activitiesResponse, moviesResponse, tmdbMovies] = await Promise.all([
      client.search(`real events happening this week near ${area} Mumbai with event names and poster pages`, {
        maxResults: 8,
        searchDepth: 'basic',
      }),
      client.search(`trending things to do and activities this week near ${area} Mumbai with image pages`, {
        maxResults: 8,
        searchDepth: 'basic',
      }),
      client.search('latest movies now showing in India this week with posters and release details', {
        maxResults: 8,
        searchDepth: 'basic',
      }),
      fetchMovieFeedFromTmdb(dateLabel),
    ]);

    const [eventFeed, activityFeed, tavilyMovieFeed] = await Promise.all([
      mapTavilyResultsToFeed((eventsResponse.results || []) as TavilySearchResult[], 'event', area, dateLabel, 4),
      mapTavilyResultsToFeed((activitiesResponse.results || []) as TavilySearchResult[], 'activity', area, dateLabel, 4),
      mapTavilyResultsToFeed((moviesResponse.results || []) as TavilySearchResult[], 'movie', area, dateLabel, 4),
    ]);

    const movieFeed = tmdbMovies.length > 0 ? tmdbMovies : tavilyMovieFeed;
    const combined = interleaveFeeds([eventFeed, movieFeed, activityFeed], 9);
    const filtered = dedupeEvents(combined).filter((item) => item.title.length > 3);
    const finalEvents = filtered.length > 0 ? filtered : fallbackEvents(area, dateLabel);

    await cacheSet(key, finalEvents, 60 * 20);
    return finalEvents;
  } catch (err) {
    console.error('[Events] fetchTopEventsForArea failed:', err);
    return fallbackEvents(area, dateLabel);
  }
}
