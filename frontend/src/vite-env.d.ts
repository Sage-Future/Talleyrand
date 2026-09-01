/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Analytics measurement ID. Absent on a deployment that collects nothing. */
  readonly VITE_GA_MEASUREMENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
