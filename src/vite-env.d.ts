/// <reference types="vite/client" />

import type { TransLiteApi } from './shared/types';

declare global {
  interface Window {
    translite: TransLiteApi;
  }
}

export {};
