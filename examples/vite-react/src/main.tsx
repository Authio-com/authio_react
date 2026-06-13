import React from "react";
import ReactDOM from "react-dom/client";
import { AuthioProvider } from "@useauthio/react";
import { App } from "./App";

const apiUrl =
  import.meta.env.VITE_AUTHIO_API_URL ?? "https://auth-api.authio.com";
const projectId = import.meta.env.VITE_AUTHIO_PROJECT_ID ?? "proj_example";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthioProvider apiUrl={apiUrl} projectId={projectId}>
      <App />
    </AuthioProvider>
  </React.StrictMode>,
);
