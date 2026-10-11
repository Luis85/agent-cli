export class Trip {
  private constructor(readonly id: string) {}

  static create(id: string): Trip {
    if (!id.trim()) throw new globalThis.Error('Identity is required');
    return new Trip(id);
  }
}
