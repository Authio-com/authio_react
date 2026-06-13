"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  Authio: () => Authio,
  AuthioError: () => AuthioError,
  JwtVerifier: () => JwtVerifier
});
module.exports = __toCommonJS(index_exports);

// src/errors.ts
var AuthioError = class extends Error {
  code;
  status;
  requestId;
  constructor(opts) {
    super(opts.message);
    this.name = "AuthioError";
    this.code = opts.code;
    this.status = opts.status;
    this.requestId = opts.requestId;
  }
};

// src/jwks.ts
var import_jose = require("jose");
var JwtVerifier = class {
  constructor(apiUrl, issuer, audience) {
    this.apiUrl = apiUrl;
    this.issuer = issuer;
    this.audience = audience;
    this.jwks = (0, import_jose.createRemoteJWKSet)(
      new URL(this.apiUrl.replace(/\/$/, "") + "/v1/auth/.well-known/jwks.json"),
      {
        cooldownDuration: 3e4,
        cacheMaxAge: 6e5
      }
    );
  }
  apiUrl;
  issuer;
  audience;
  jwks;
  async verify(token) {
    const { payload } = await (0, import_jose.jwtVerify)(token, this.jwks, {
      issuer: this.issuer,
      audience: this.audience,
      algorithms: ["EdDSA"]
    });
    if (!payload.sub) {
      throw new Error("authio: token missing sub claim");
    }
    return payload;
  }
};

// src/client.ts
var DEFAULT_API_URL = "https://api.authio.com";
var DEFAULT_ISSUER = "https://api.authio.com";
var DEFAULT_AUDIENCE = "authio";
var Authio = class {
  constructor(options) {
    this.options = options;
    if (!options.apiKey) {
      throw new Error(
        "Authio: apiKey is required. Pass it directly or set AUTHIO_SECRET_KEY."
      );
    }
    const apiUrl = options.apiUrl ?? DEFAULT_API_URL;
    this.verifier = new JwtVerifier(
      apiUrl,
      options.jwtIssuer ?? DEFAULT_ISSUER,
      options.jwtAudience ?? DEFAULT_AUDIENCE
    );
    this.sessions = new SessionsAPI(this, this.verifier);
  }
  options;
  users = new UsersAPI(this);
  organizations = new OrganizationsAPI(this);
  memberships = new MembershipsAPI(this);
  sessions;
  verifier;
  async request(method, path, body) {
    const url = (this.options.apiUrl ?? DEFAULT_API_URL) + path;
    const fetchFn = this.options.fetch ?? globalThis.fetch;
    const res = await fetchFn(url, {
      method,
      headers: {
        "content-type": "application/json",
        "user-agent": "authio-node/0.1.0",
        authorization: `Bearer ${this.options.apiKey}`
      },
      body: body ? JSON.stringify(body) : void 0
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new AuthioError({
        code: data.code ?? "request_failed",
        message: data.message ?? `Request failed with status ${res.status}`,
        status: res.status,
        requestId: data.request_id
      });
    }
    if (res.status === 204) return void 0;
    return await res.json();
  }
};
var UsersAPI = class {
  constructor(client) {
    this.client = client;
  }
  client;
  get(userId) {
    return this.client.request("GET", `/v1/users/${userId}`);
  }
  listMemberships(userId) {
    return this.client.request(
      "GET",
      `/v1/users/${userId}/memberships`
    );
  }
};
var OrganizationsAPI = class {
  constructor(client) {
    this.client = client;
  }
  client;
  list() {
    return this.client.request("GET", "/v1/organizations");
  }
  create(input) {
    return this.client.request("POST", "/v1/organizations", input);
  }
  get(orgId) {
    return this.client.request("GET", `/v1/organizations/${orgId}`);
  }
};
var MembershipsAPI = class {
  constructor(client) {
    this.client = client;
  }
  client;
  listForOrganization(orgId) {
    return this.client.request(
      "GET",
      `/v1/organizations/${orgId}/memberships`
    );
  }
  add(orgId, input) {
    return this.client.request(
      "POST",
      `/v1/organizations/${orgId}/memberships`,
      { user_id: input.userId, role: input.role }
    );
  }
  remove(orgId, membershipId) {
    return this.client.request(
      "DELETE",
      `/v1/organizations/${orgId}/memberships/${membershipId}`
    );
  }
};
var SessionsAPI = class {
  constructor(client, verifier) {
    this.client = client;
    this.verifier = verifier;
  }
  client;
  verifier;
  /**
   * Verify an Authio access token (JWT). Returns the typed Session, or
   * null when the token is invalid/expired.
   *
   * `session.userId` is always set; `session.orgId` may be null when the
   * user has authenticated but not yet selected an organization (multi-org
   * users coming straight out of /v1/auth/passkey/login/verify).
   */
  async verify(accessToken) {
    if (!accessToken) return null;
    try {
      const claims = await this.verifier.verify(accessToken);
      return {
        sessionId: claims.sid ?? "",
        userId: claims.sub,
        orgId: claims.act_org ? claims.act_org : null,
        role: claims.act_role ? claims.act_role : null,
        expiresAt: claims.exp ? new Date(claims.exp * 1e3).toISOString() : (/* @__PURE__ */ new Date()).toISOString()
      };
    } catch {
      return null;
    }
  }
  /** Pivot a session into a different organization without re-authentication. */
  switchOrg(_sessionId, input) {
    return this.client.request(
      "POST",
      "/v1/sessions/switch-org",
      { organization_id: input.organizationId }
    );
  }
  revoke(sessionId) {
    return this.client.request("POST", "/v1/sessions/revoke", {
      session_id: sessionId
    });
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Authio,
  AuthioError,
  JwtVerifier
});
