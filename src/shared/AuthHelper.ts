import { auth, server, devmode, authBypass } from '../../storage/config.json';
import { DatabaseHelper, User, UserRoles } from "./Database";

// eslint-disable-next-line quotes
declare module 'express-session' {
    export interface Session {
        userId: number;
        username: string;
        avatarUrl: string;
        csrf: {
            token: string;
            expiration: number;
        };
    }
}

class OAuth2Helper {
    public static async getToken(url:string, code: string, oAuth2Data:{clientId:string, clientSecret:string}, callbackUrl:string): Promise<OAuth2Response | null> {
        if (!code || !oAuth2Data.clientId || !oAuth2Data.clientSecret || !callbackUrl || !url) {
            return null;
        }
        let tokenRequest = await fetch(url,
            {
                method: `POST`,
                body: new URLSearchParams({
                    'client_id': oAuth2Data.clientId,
                    'client_secret': oAuth2Data.clientSecret,
                    'grant_type': `authorization_code`,
                    'code': code,
                    'redirect_uri': callbackUrl,
                }),
                headers:
                {
                    'Content-Type': `application/x-www-form-urlencoded`,
                    'Accept': `application/json`
                }
            });

        const json: any = await tokenRequest.json();
        if (!json.access_token) {
            return null;
        } else {
            return json as OAuth2Response;
        }
    }

    protected static getRequestData(token: string) {
        return {
            method: `GET`,
            body: null as null,
            headers:
            {
                'Authorization': `Bearer ${token}`
            }
        };
    }
}

export interface OAuth2Response {
    token_type: string,
    access_token: string,
    expires_in?: number,
    refresh_token?: string,
    scope: string,
}
/*
//#region BeatLeader
export class BeatLeaderAuthHelper extends OAuth2Helper {
    private static readonly callbackUrl = `${server.url}/api/auth/beatleader/callback`;
    
    public static getUrl(state:string): string {
        return `https://api.beatleader.xyz/oauth2/authorize?client_id=${auth.beatleader.clientId}&response_type=code&scope=profile&redirect_uri=${BeatLeaderAuthHelper.callbackUrl}&state=${state}`;
    }

    public static getToken(code:string): Promise<OAuth2Response> {
        return super.getToken(`https://api.beatleader.xyz/oauth2/token`, code, auth.beatleader, this.callbackUrl);
    }

    public static async getUser(token: string): Promise<BeatLeaderIdentify | null> {
        const userIdRequest = await fetch(`https://api.beatleader.xyz/oauth2/identity`, super.getRequestData(token));
        const Idjson: BeatLeaderIdentify = await userIdRequest.json() as BeatLeaderIdentify;

        if (!Idjson.id) {
            return null;
        } else {
            return Idjson;
            //const userRequest = await fetch(`https://api.beatleader.xyz/player/${Idjson.id}?stats=false`, super.getRequestData(token));
            //const userJjson: BeatLeaderMinimalUser = await userRequest.json() as BeatLeaderMinimalUser;
            //if (!userJjson.id) {
            //    return null;
            //} else {
            //    return userJjson;
            //}
        }
    }
}

export interface BeatLeaderIdentify {
    id: string,
    name: string,
}

export interface BeatLeaderMinimalUser {
    mapperId: number
    banned: boolean
    inactive: boolean
    banDescription: string
    externalProfileUrl: string
    id: string
    name: string
    platform: string
    avatar: string
    country: string
    bot: boolean
    role: string
    socials: {
        service: string
        userId: string
        user: string
        link: string
        playerId: string
    }[]
}
//#endregion

//#region BeatSaver
export class BeatSaverAuthHelper extends OAuth2Helper {
    private static readonly callbackUrl = `${server.url}/api/auth/beatsaver/callback`;
    
    public static getUrl(state:string): string {
        return `https://beatsaver.com/oauth2/authorize?client_id=${auth.beatsaver.clientId}&response_type=code&scope=identity&redirect_uri=${BeatSaverAuthHelper.callbackUrl}&state=${state}`;
    }

    public static getToken(code:string): Promise<OAuth2Response> {
        return super.getToken(`https://api.beatsaver.com/oauth2/token`, code, auth.beatsaver, this.callbackUrl);
    }

    public static async getUser(token: string): Promise<BeatSaverIdentify | null> {
        const userIdRequest = await fetch(`https://api.beatsaver.com/oauth2/identity`, super.getRequestData(token));
        const Idjson: BeatSaverIdentify = await userIdRequest.json() as BeatSaverIdentify;

        if (!Idjson.id) {
            return null;
        } else {
            return Idjson;
        }
    }
}

export interface BeatSaverIdentify {
    scopes: string[];
    id: string;
    name: string;
    avatar: string;
}
//#endregion
*/
//#region Discord
export class DiscordAuthHelper extends OAuth2Helper {
    private static readonly callbackUrl = `${server.url}/api/auth/discord/callback`;
    
    public static getUrl(state:string): string {
        return `https://discord.com/oauth2/authorize?client_id=${auth.discord.clientId}&response_type=code&scope=identify&redirect_uri=${DiscordAuthHelper.callbackUrl}&state=${state}`;
    }

    public static getToken(code:string): Promise<OAuth2Response> {
        return super.getToken(`https://discord.com/api/v10/oauth2/token`, code, auth.discord, this.callbackUrl);
    }

    public static async getUser(token: string): Promise<DiscordIdentify | null> {
        const userIdRequest = await fetch(`https://discord.com/api/v10/users/@me`, super.getRequestData(token));
        const Idjson: DiscordIdentify = await userIdRequest.json() as DiscordIdentify;

        if (`id` in Idjson) {
            return Idjson;
        } else {
            return null;
        }
    }

    public static async getGuildMemberData(token: string, guildId: string, userId:string): Promise<DiscordUserGuild | null> {
        const userIdRequest = await fetch(`https://discord.com/api/v10/users/@me/guilds/${guildId}/member`, super.getRequestData(token));
        const Idjson: DiscordUserGuild = await userIdRequest.json() as DiscordUserGuild;
        if (!Idjson.roles) {
            return null;
        } else {
            return Idjson;
        }
    }
}

export interface DiscordIdentify {
    id: string;
    username: string;
    discriminator: string;
    avatar: string;
    global_name?: string;
}

export interface DiscordUserGuild {
    user?: any;
    nick?: string|null;
    avatar?: string|null;
    roles: string[];
    joined_at: Date;
    premium_since?: Date|null;
    deaf: boolean;
    mute: boolean;
    flags: number;
    pending?: boolean;
    permissions?: string;
}
//#endregion

//#region GitHub
export class GitHubAuthHelper extends OAuth2Helper {
    private static readonly callbackUrl = `${server.url}/api/auth/github/callback`;
    
    public static getUrl(state:string): string {
        return `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(auth.github.clientId)}&response_type=code&scope=user&redirect_uri=${encodeURIComponent(GitHubAuthHelper.callbackUrl)}&state=${encodeURIComponent(state)}`;
    }

    public static getToken(code:string): Promise<OAuth2Response> {
        return super.getToken(`https://github.com/login/oauth/access_token`, code, auth.github, this.callbackUrl);
    }

    public static async getUser(token: string): Promise<GitHubPublicUser | null> {
        let request = await fetch(`https://api.github.com/user`, super.getRequestData(token));
        let json = await request.json() as GitHubPublicUser;

        if (`id` in json) {
            return json;
        } else {
            return null;
        }
    }
}

/*
Pretty sure I dont need this but keeping it around just in case
export interface GitHubPrivateUser {
  login: string;
  id: number;
  user_view_type?: string;
  node_id: string;
  avatar_url: string;
  gravatar_id: string | null;
  url: string;
  html_url: string;
  followers_url: string;
  following_url: string;
  gists_url: string;
  starred_url: string;
  subscriptions_url: string;
  organizations_url: string;
  repos_url: string;
  events_url: string;
  received_events_url: string;
  type: string;
  site_admin: boolean;
  name: string | null;
  company: string | null;
  blog: string | null;
  location: string | null;
  email: string | null;
  notification_email?: string | null;
  hireable: boolean | null;
  bio: string | null;
  twitter_username?: string | null;
  public_repos: number;
  public_gists: number;
  followers: number;
  following: number;
  created_at: string;
  updated_at: string;
  private_gists: number;
  total_private_repos: number;
  owned_private_repos: number;
  disk_usage: number;
  collaborators: number;
  two_factor_authentication: boolean;
  plan?: {
    collaborators: number;
    name: string;
    space: number;
    private_repos: number;
    [k: string]: unknown;
  };
  business_plus?: boolean;
  ldap_dn?: string;
  [k: string]: unknown;
}*/

export interface GitHubPublicUser {
  login: string;
  id: number;
  user_view_type?: string;
  node_id: string;
  avatar_url: string;
  gravatar_id: string | null;
  url: string;
  html_url: string;
  followers_url: string;
  following_url: string;
  gists_url: string;
  starred_url: string;
  subscriptions_url: string;
  organizations_url: string;
  repos_url: string;
  events_url: string;
  received_events_url: string;
  type: string;
  site_admin: boolean;
  name: string | null;
  company: string | null;
  blog: string | null;
  location: string | null;
  email: string | null;
  notification_email?: string | null;
  hireable: boolean | null;
  bio: string | null;
  twitter_username?: string | null;
  public_repos: number;
  public_gists: number;
  followers: number;
  following: number;
  created_at: string;
  updated_at: string;
  plan?: {
    collaborators: number;
    name: string;
    space: number;
    private_repos: number;
    [k: string]: unknown;
  };
  private_gists?: number;
  total_private_repos?: number;
  owned_private_repos?: number;
  disk_usage?: number;
  collaborators?: number;
}

//#endregion

/*
    Role: if False, no role is required, you just have to be signed in.
    If True, the user must not be banned.
    If a UserRoles, the user must have that role.
*/
export async function validateSession(req: any, res: any, role: UserRoles|boolean = UserRoles.Admin, handleRequest:boolean = true): Promise<{approved: boolean, user: User}> {
    let sessionId = req.session.userId;
    if (devmode && authBypass) {
        let user = await DatabaseHelper.database.Users.findOne({ where: { id: 1 } });
        return { approved: true, user: user };
    }
    if (!sessionId) {
        if (handleRequest) {
            return res.status(401).send({ message: `Unauthorized.` });
        } else {
            return { approved: false, user: null };
        }
    }
    
    let user = await DatabaseHelper.database.Users.findOne({ where: { id: sessionId } });
    if (!user) {
        if (handleRequest) {
            return res.status(401).send({ message: `Unauthorized.` });
        } else {
            return { approved: false, user: null };
        }
    }

    if (typeof role === `boolean` && role == true) {
        if (user.roles.includes(UserRoles.Banned)) {
            if (handleRequest) {
                return res.status(401).send({ message: `Unauthorized.` });
            } else {
                return { approved: false, user: null };
            }
        } else {
            return { approved: true, user: user };
        }
    } else if (typeof role === `boolean` && role == false) {
        return { approved: true, user: user };
    }

    if (user.roles.includes(role)) {
        return { approved: true, user: user };
    } else {
        if (handleRequest) {
            return res.status(401).send({ message: `Unauthorized.` });
        } else {
            return { approved: false, user: null };
        }
    }
}
