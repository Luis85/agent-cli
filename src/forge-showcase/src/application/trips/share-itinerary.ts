export interface ShareItineraryInput { readonly id: string }
export interface ShareItineraryRepository { exists(id: string): globalThis.Promise<boolean> }

export class ShareItinerary {
  constructor(private readonly repository: ShareItineraryRepository) {}

  async execute(input: ShareItineraryInput): globalThis.Promise<{ exists: boolean }> {
    if (!input.id.trim()) throw new globalThis.Error('Identity is required');
    return { exists: await this.repository.exists(input.id) };
  }
}
