import 'server-only';
import { experienceRepository, type Experience, type NewExperience } from '../repositories/experience.repository';
import { NotFoundError } from '../errors';

// Normalized Experience Provider Interface
export interface ExperienceProvider {
  name: string;
  reliabilityWeight: number;
  fetchEvents(
    city: string,
    options?: { category?: string; startAfter?: Date }
  ): Promise<Omit<NewExperience, 'id' | 'createdAt' | 'updatedAt' | 'popularityScore'>[]>;
}

// Levenshtein similarity helper
export function calculateLevenshteinDistance(s1: string, s2: string): number {
  const m = s1.length;
  const n = s2.length;
  const d: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s1[i - 1].toLowerCase() === s2[j - 1].toLowerCase() ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1, // deletion
        d[i][j - 1] + 1, // insertion
        d[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return d[m][n];
}

export function getSimilarity(s1: string, s2: string): number {
  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 1.0;
  return 1.0 - calculateLevenshteinDistance(s1, s2) / maxLen;
}

export const experienceService = {
  // Ingest events from a specific provider
  async ingestEvents(city: string, provider: ExperienceProvider): Promise<{ ingestedCount: number }> {
    const rawEvents = await provider.fetchEvents(city, { startAfter: new Date() });
    let ingestedCount = 0;

    const uuid = () => {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
      return require('crypto').randomUUID();
    };

    const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
      const R = 6371; // Earth radius in km
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c * 1000; // returns in meters
    };

    // Load existing events in the city for deduplication comparison
    const existingEvents = await experienceRepository.findExperiencesNearMidpoint(city, 0, 0, 20000); // broad search

    for (const raw of rawEvents) {
      // Deduplicate: Levenshtein Title Similarity > 0.85 & distance < 100m & same date
      const duplicate = existingEvents.find(existing => {
        const titleSim = getSimilarity(existing.title, raw.title);
        const distMeters = calculateDistance(existing.latitude, existing.longitude, raw.latitude, raw.longitude);
        const sameDate = existing.startDate.split('T')[0] === raw.startDate.split('T')[0];
        return titleSim > 0.85 && distMeters < 100 && sameDate;
      });

      const popularityScore = duplicate 
        ? Math.min(1.0, (duplicate.popularityScore || 0.0) + 0.1) 
        : 0.1;

      const experienceData: NewExperience = {
        id: duplicate ? duplicate.id : uuid(),
        title: raw.title,
        description: raw.description,
        category: raw.category,
        city: raw.city,
        latitude: raw.latitude,
        longitude: raw.longitude,
        startDate: raw.startDate,
        endDate: raw.endDate,
        ticketPrice: raw.ticketPrice,
        capacity: raw.capacity || null,
        source: raw.source,
        sourceUrl: raw.sourceUrl,
        imageUrl: raw.imageUrl || null,
        rating: raw.rating || null,
        popularityScore,
        isRecurring: raw.isRecurring ? 1 : 0,
      };

      await experienceRepository.upsertExperience(experienceData);
      ingestedCount++;
    }

    // Update source fetch metadata
    await experienceRepository.updateSourceFetch(provider.name, ingestedCount);

    return { ingestedCount };
  },

  async getExperiencesNearMidpoint(city: string, lat: number, lng: number, maxRadiusKm = 10) {
    return experienceRepository.findExperiencesNearMidpoint(city, lat, lng, maxRadiusKm);
  },

  async getCategories() {
    return experienceRepository.findCategories();
  },

  async getSources() {
    return experienceRepository.findSources();
  },

  async cleanupExpired() {
    await experienceRepository.deleteExpiredExperiences();
    await experienceRepository.deleteExpiredCache();
  },
};

export type ExperienceService = typeof experienceService;
