import { JWTPayload } from 'jose';

interface AuthioClaims extends JWTPayload {
    sub: string;
    /** The active organization for this token. Empty string if the user has not yet selected an org. */
    act_org?: string;
    /** The active role within `act_org`. */
    act_role?: string;
    /** Session ID. */
    sid?: string;
}
/**
 * Verifier wraps a remote JWKS fetcher with caching. Spawn one per
 * `apiUrl` and reuse — fetching JWKS on every request is wasteful.
 */
declare class JwtVerifier {
    private readonly apiUrl;
    private readonly issuer;
    private readonly audience;
    private readonly jwks;
    constructor(apiUrl: string, issuer: string, audience: string);
    verify(token: string): Promise<AuthioClaims>;
}

interface User {
    id: string;
    projectId: string;
    email: string;
    emailVerified: boolean;
    name?: string;
    avatarUrl?: string;
    defaultOrganizationId: string | null;
    createdAt: string;
    updatedAt: string;
}
interface Organization {
    id: string;
    projectId: string;
    name: string;
    slug: string;
    createdAt: string;
}
type MembershipStatus = "invited" | "active" | "suspended" | "deactivated";
interface Membership {
    id: string;
    projectId: string;
    userId: string;
    organizationId: string;
    role: string;
    status: MembershipStatus;
    joinedAt: string;
    invitedBy: string | null;
    lastActiveAt: string | null;
    preferredLoginMethod: "passkey" | "magic_link" | "oauth" | "sso" | null;
}
/**
 * A verified Authio session.
 *
 * The session always identifies the *user* (`userId`); the active
 * organization (`orgId`) is only set after the user has selected one of
 * their memberships. A user with multiple memberships may move between
 * orgs in-session without re-authenticating.
 */
interface Session {
    sessionId: string;
    userId: string;
    orgId: string | null;
    role: string | null;
    expiresAt: string;
}

interface AuthioOptions {
    apiKey: string;
    apiUrl?: string;
    /** JWT issuer to require. Defaults to the production issuer. */
    jwtIssuer?: string;
    /** JWT audience to require. */
    jwtAudience?: string;
    fetch?: typeof fetch;
}
declare class Authio {
    readonly options: AuthioOptions;
    readonly users: UsersAPI;
    readonly organizations: OrganizationsAPI;
    readonly memberships: MembershipsAPI;
    readonly sessions: SessionsAPI;
    private readonly verifier;
    constructor(options: AuthioOptions);
    request<T>(method: string, path: string, body?: unknown): Promise<T>;
}
declare class UsersAPI {
    private readonly client;
    constructor(client: Authio);
    get(userId: string): Promise<User>;
    listMemberships(userId: string): Promise<Membership[]>;
}
declare class OrganizationsAPI {
    private readonly client;
    constructor(client: Authio);
    list(): Promise<Organization[]>;
    create(input: {
        name: string;
        slug?: string;
        domain?: string;
    }): Promise<Organization>;
    get(orgId: string): Promise<Organization>;
}
declare class MembershipsAPI {
    private readonly client;
    constructor(client: Authio);
    listForOrganization(orgId: string): Promise<Membership[]>;
    add(orgId: string, input: {
        userId: string;
        role: string;
    }): Promise<Membership>;
    remove(orgId: string, membershipId: string): Promise<void>;
}
declare class SessionsAPI {
    private readonly client;
    private readonly verifier;
    constructor(client: Authio, verifier: JwtVerifier);
    /**
     * Verify an Authio access token (JWT). Returns the typed Session, or
     * null when the token is invalid/expired.
     *
     * `session.userId` is always set; `session.orgId` may be null when the
     * user has authenticated but not yet selected an organization (multi-org
     * users coming straight out of /v1/auth/passkey/login/verify).
     */
    verify(accessToken: string): Promise<Session | null>;
    /** Pivot a session into a different organization without re-authentication. */
    switchOrg(_sessionId: string, input: {
        organizationId: string;
    }): Promise<Session>;
    revoke(sessionId: string): Promise<void>;
}

declare class AuthioError extends Error {
    readonly code: string;
    readonly status: number;
    readonly requestId?: string;
    constructor(opts: {
        code: string;
        message: string;
        status: number;
        requestId?: string;
    });
}

export { Authio, type AuthioClaims, AuthioError, type AuthioOptions, JwtVerifier, type Membership, type Organization, type Session, type User };
