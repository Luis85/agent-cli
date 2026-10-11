export interface TripPlanned { readonly id: string }
export const TripPlannedEvent = {
  id: 'app.trip-planned',
  validate(value: unknown): value is TripPlanned {
    return value !== null && typeof value === 'object' && 'id' in value && typeof value.id === 'string';
  },
};
