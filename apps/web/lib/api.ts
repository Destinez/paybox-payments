'use client';
import { useCallback, useEffect, useState } from 'react';
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(typeof window !== 'undefined'
        ? { 'X-CSRF-Token': sessionStorage.getItem('paybox_csrf') ?? '' }
        : {}),
      ...options.headers,
    },
    credentials: 'same-origin',
    cache: 'no-store',
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== '/session/login') window.location.assign('/login');
    throw new Error(data.detail ?? 'The request could not be completed');
  }
  return data;
}
export function useResource<T>(path: string | null, interval = 5000) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision explicitly triggers a refresh.
  useEffect(() => {
    if (!path) return;
    let active = true;
    const read = () =>
      api<T>(path)
        .then((value) => {
          if (active) {
            setData(value);
            setError('');
          }
        })
        .catch((error) => {
          if (active) setError(error.message);
        });
    void read();
    const timer = interval ? setInterval(read, interval) : undefined;
    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [path, interval, revision]);
  return { data, error, refresh };
}
export const money = (amount: number | string) => {
  const raw = BigInt(amount),
    negative = raw < 0n,
    value = negative ? -raw : raw;
  return `${negative ? '−' : ''}₦${new Intl.NumberFormat('en-NG').format(value / 100n)}.${String(value % 100n).padStart(2, '0')}`;
};
export const date = (value: string) =>
  new Intl.DateTimeFormat('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Africa/Lagos',
  }).format(new Date(value));
export const time = (value: string) =>
  new Intl.DateTimeFormat('en-NG', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'Africa/Lagos',
  }).format(new Date(value));
export const human = (value: string) => value.replaceAll('_', ' ').replaceAll('.', ' · ');
export function kobo(value: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error('Enter an amount with up to two decimal places');
  const [whole = '0', part = ''] = value.split('.');
  const amount = BigInt(whole) * 100n + BigInt(part.padEnd(2, '0'));
  if (amount <= 0n || amount > 10000000000n)
    throw new Error('Enter an amount between ₦0.01 and ₦100,000,000');
  return Number(amount);
}
