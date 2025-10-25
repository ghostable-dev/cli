import fetch from 'cross-fetch';

type HeadersInit = Record<string, string>;
import { HttpError } from './errors.js';

export class HttpClient {
        constructor(
                private baseUrl: string,
                private bearer?: string,
        ) {}

        withBearer(token?: string) {
                return new HttpClient(this.baseUrl, token ?? this.bearer);
        }

        private buildHeaders(extra: HeadersInit = {}, withJson = false): HeadersInit {
                return {
                        ...(withJson ? { 'content-type': 'application/json' } : {}),
                        ...(this.bearer ? { authorization: `Bearer ${this.bearer}` } : {}),
                        ...extra,
                };
        }

        async get<T>(path: string, headers: HeadersInit = {}): Promise<T> {
                const res = await fetch(`${this.baseUrl}${path}`, {
                        headers: this.buildHeaders(headers),
                });
                if (!res.ok) throw new HttpError(res.status, await res.text(), `GET ${path} failed`);
                return (await res.json()) as T;
        }

        async post<T>(path: string, body?: unknown, headers: HeadersInit = {}): Promise<T> {
                const init: {
                        method: 'POST';
                        headers: HeadersInit;
                        body?: string;
                } = {
                        method: 'POST',
                        headers: this.buildHeaders(headers, body !== undefined),
                };

                if (body !== undefined) {
                        init.body = JSON.stringify(body);
                }

                const res = await fetch(`${this.baseUrl}${path}`, init);
                if (!res.ok) throw new HttpError(res.status, await res.text(), `POST ${path} failed`);
                return (await res.json().catch(() => ({}))) as T;
        }

        async delete<T>(path: string, headers: HeadersInit = {}): Promise<T> {
                const res = await fetch(`${this.baseUrl}${path}`, {
                        method: 'DELETE',
                        headers: this.buildHeaders(headers),
                });
                if (!res.ok) throw new HttpError(res.status, await res.text(), `DELETE ${path} failed`);
                const text = await res.text();
                if (!text) return {} as T;
                try {
                        return JSON.parse(text) as T;
                } catch {
                        return {} as T;
                }
        }
}
