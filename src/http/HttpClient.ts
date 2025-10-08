import fetch from "cross-fetch";

type HeadersInit = Record<string, string>;
import { HttpError } from "./errors.js";

export class HttpClient {
  constructor(private baseUrl: string, private bearer?: string) {}

  withBearer(token?: string) {
    return new HttpClient(this.baseUrl, token ?? this.bearer);
  }

  async get<T>(path: string, headers: HeadersInit = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { ...(this.bearer ? { authorization: `Bearer ${this.bearer}` } : {}), ...headers },
    });
    if (!res.ok) throw new HttpError(res.status, await res.text(), `GET ${path} failed`);
    return (await res.json()) as T;
  }

  async post<T>(path: string, body: any, headers: HeadersInit = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.bearer ? { authorization: `Bearer ${this.bearer}` } : {}),
        ...headers,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new HttpError(res.status, await res.text(), `POST ${path} failed`);
    return (await res.json().catch(() => ({}))) as T;
  }
}