export class Itinerary {
  private constructor(readonly id: string) {}

  static create(id: string): Itinerary {
    if (!id.trim()) throw new globalThis.Error('Itinerary requires an identity');
    return new Itinerary(id);
  }
}
