export class Organization {
  constructor(
    public readonly id: string,
    public readonly name?: string,
  ) {}

  label(): string {
    return this.name ?? this.id;
  }

  static fromJSON(json: unknown): Organization {
    if (!json || typeof json !== "object") {
      throw new Error("Invalid organization payload");
    }

    const { id, name } = json as {
      id?: unknown;
      name?: unknown;
    };

    if (id == null) {
      throw new Error("Organization payload missing id");
    }

    const organizationName =
      typeof name === "string" && name.trim().length > 0 ? name : undefined;

    return new Organization(String(id), organizationName);
  }
}
