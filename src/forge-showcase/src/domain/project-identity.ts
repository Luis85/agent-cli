export class ProjectIdentity {
  private constructor(readonly id: string) {}

  static create(id: string): ProjectIdentity {
    if (!id.trim()) throw new globalThis.Error('Identity is required');
    return new ProjectIdentity(id);
  }
}
