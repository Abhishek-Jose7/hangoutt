import { Venue } from '../types/planner.types';

export const recommendationService = {
  async getRecommendationShortlist(_groupId: string): Promise<Venue[]> {
    // Phase 1 Foundation: stub implementation returning representative mock venues near Koramangala
    return [
      {
        id: 'place_1',
        name: 'Third Wave Coffee',
        category: 'CAFE',
        rating: 4.6,
        distanceKm: 0.4,
        estimatedCostPerHead: 200,
        openNow: true,
        address: '100 Feet Rd, Koramangala',
      },
      {
        id: 'place_2',
        name: 'The Social Outpost',
        category: 'RESTAURANT',
        rating: 4.4,
        distanceKm: 0.9,
        estimatedCostPerHead: 500,
        openNow: true,
        address: 'Koramangala 5th Block',
      },
      {
        id: 'place_3',
        name: 'Pinball & Bowling Arena',
        category: 'BOWLING',
        rating: 4.2,
        distanceKm: 1.8,
        estimatedCostPerHead: 350,
        openNow: true,
        address: '80 Feet Rd, Koramangala',
      },
      {
        id: 'place_4',
        name: 'Corner House Ice Creams',
        category: 'DESSERT',
        rating: 4.7,
        distanceKm: 0.3,
        estimatedCostPerHead: 150,
        openNow: true,
        address: 'Koramangala 5th Block',
      },
    ];
  },
};
export type RecommendationService = typeof recommendationService;
