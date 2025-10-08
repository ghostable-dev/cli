export class Organization {
  constructor(
    public readonly id: string,
    public readonly name?: string,
  ) {}

  label(): string {
    return this.name ?? this.id;
  }

  static fromJSON(json: any): Organization {
    return new Organization(String(json.id), json.name ?? undefined);
  }
}