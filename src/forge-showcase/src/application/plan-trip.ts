export interface PlanTripRepository {
  exists(id: string): globalThis.Promise<boolean>;
}

export class PlanTrip {
  constructor(private readonly repository: PlanTripRepository) {}

  async execute(id: string): globalThis.Promise<{ exists: boolean }> {
    if (!id.trim()) throw new globalThis.Error('Identity is required');
    return { exists: await this.repository.exists(id) };
  }
}
