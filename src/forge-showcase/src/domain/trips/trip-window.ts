export class TripWindow {
  private constructor(readonly value: string) { globalThis.Object.freeze(this); }

  static from(value: string): TripWindow {
    if (!value.trim()) throw new globalThis.Error('TripWindow cannot be empty');
    return new TripWindow(value);
  }

  equals(other: TripWindow): boolean { return this.value === other.value; }
}
