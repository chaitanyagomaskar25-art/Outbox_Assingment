import { OAuth2Client } from 'google-auth-library';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { AppError } from '../../middleware/errorHandler';

export interface GoogleUserProfile {
  googleId: string;
  email: string;
  name: string;
  avatarUrl?: string;
}

class GoogleAuthService {
  private client: OAuth2Client;

  constructor() {
    this.client = new OAuth2Client({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectUri: env.GOOGLE_CALLBACK_URL,
    });
  }

  public isConfigured(): boolean {
    const clientId = env.GOOGLE_CLIENT_ID.trim();
    const clientSecret = env.GOOGLE_CLIENT_SECRET.trim();
    return Boolean(
      clientId &&
        clientSecret &&
        !clientId.startsWith('your_google_client_id') &&
        !clientSecret.startsWith('your_google_client_secret')
    );
  }

  public getAuthorizationUrl(state: string): string {
    if (!this.isConfigured()) {
      throw new AppError(
        'Google OAuth is not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env',
        500
      );
    }

    return this.client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/userinfo.email',
      ],
      state,
    });
  }

  public async getProfileFromCode(code: string): Promise<GoogleUserProfile> {
    if (!this.isConfigured()) {
      throw new AppError('Google OAuth is not configured on this server.', 500);
    }

    try {
      const { tokens } = await this.client.getToken(code);
      this.client.setCredentials(tokens);

      if (!tokens.id_token) {
        throw new AppError('No ID token received from Google OAuth response.', 400);
      }

      const ticket = await this.client.verifyIdToken({
        idToken: tokens.id_token,
        audience: env.GOOGLE_CLIENT_ID,
      });

      const payload = ticket.getPayload();
      if (!payload || !payload.email || !payload.sub) {
        throw new AppError('Failed to retrieve essential profile details from Google.', 400);
      }

      return {
        googleId: payload.sub,
        email: payload.email,
        name: payload.name || payload.email.split('@')[0],
        avatarUrl: payload.picture,
      };
    } catch (error: any) {
      logger.error({ error: error.message }, 'Google OAuth token verification failed');
      throw new AppError(`Google OAuth verification failed: ${error.message}`, 400);
    }
  }
}

export const googleAuthService = new GoogleAuthService();
