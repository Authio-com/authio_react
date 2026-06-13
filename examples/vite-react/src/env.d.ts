/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUTHIO_API_URL: string;
  readonly VITE_AUTHIO_PROJECT_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
