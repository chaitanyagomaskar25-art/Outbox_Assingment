import { Request, Response, NextFunction } from 'express';
import { randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';
import { Prisma } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../repositories/prisma';
import { googleAuthService } from '../integrations/google/google.service';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { hashPassword, verifyPassword } from '../services/passwordAuth.service';

export class AuthController {
  /**
   * Generates a signed JWT session token
   */
  private generateToken(userId: string, email: string): string {
    return jwt.sign({ userId, email }, env.JWT_SECRET, { expiresIn: '7d' });
  }

  /**
   * Sets secure HttpOnly cookie on the response
   */
  private setAuthCookie(res: Response, token: string): void {
    res.cookie('reachinbox_token', token, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/',
    });
  }

  /**
   * GET /api/auth/google
   * Initiates Google OAuth 2.0 flow
   */
  public googleAuth = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!googleAuthService.isConfigured()) {
        throw new AppError(
          'Google OAuth credentials are not configured in environment variables (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).',
          500
        );
      }

      // Generate random state for CSRF protection
      const state = randomBytes(32).toString('hex');
      res.cookie('oauth_state_google', state, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 10 * 60 * 1000, // 10 minutes
      });

      const authUrl = googleAuthService.getAuthorizationUrl(state);
      return res.redirect(authUrl);
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/auth/google/callback
   * Handles Google OAuth callback
   */
  public googleCallback = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { code, state } = req.query as { code: string; state: string };
      const savedState = req.cookies.oauth_state_google;

      if (!state || state !== savedState) {
        logger.warn('OAuth state mismatch during Google login');
        throw new AppError('Invalid or expired OAuth state parameter', 400);
      }
      res.clearCookie('oauth_state_google');

      const profile = await googleAuthService.getProfileFromCode(code);

      // Upsert user in PostgreSQL
      let user = await prisma.user.findFirst({
        where: {
          OR: [{ googleId: profile.googleId }, { email: profile.email }],
        },
      });

      if (!user) {
        user = await prisma.user.create({
          data: {
            email: profile.email,
            name: profile.name,
            avatarUrl: profile.avatarUrl,
            googleId: profile.googleId,
          },
        });
      } else {
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            googleId: profile.googleId,
            name: user.name || profile.name,
            avatarUrl: user.avatarUrl || profile.avatarUrl,
          },
        });
      }

      const token = this.generateToken(user.id, user.email);
      this.setAuthCookie(res, token);

      // Redirect to frontend dashboard
      return res.redirect(`${env.FRONTEND_URL}/dashboard`);
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/auth/me
   * Returns current authenticated user
   */
  public getMe = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError('Not authenticated', 401);
      }

      return res.json({
        status: 'success',
        data: {
          user: req.user,
          googleConfigured: googleAuthService.isConfigured(),
        },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /api/auth/logout
   * Clears session cookie
   */
  public logout = async (_req: Request, res: Response) => {
    res.clearCookie('reachinbox_token', {
      path: '/',
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax',
    });

    return res.json({
      status: 'success',
      message: 'Logged out successfully',
    });
  };

  public getAuthConfig = async (_req: Request, res: Response) => {
    return res.json({
      status: 'success',
      data: { googleConfigured: googleAuthService.isConfigured(), passwordAuth: true },
    });
  };

  public signupWithPassword = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, email, password } = req.body as {
        name: string;
        email: string;
        password: string;
      };
      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        throw new AppError(
          existingUser.passwordHash
            ? 'An account with this email already exists. Sign in instead.'
            : 'This email uses Google sign-in. Continue with Google instead.',
          409
        );
      }

      let user;
      try {
        user = await prisma.user.create({
          data: {
            name,
            email,
            passwordHash: await hashPassword(password),
          },
          select: {
            id: true,
            email: true,
            name: true,
            avatarUrl: true,
            googleId: true,
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new AppError('An account with this email already exists.', 409);
        }
        throw error;
      }

      this.setAuthCookie(res, this.generateToken(user.id, user.email));
      return res.status(201).json({
        status: 'success',
        message: 'Account created successfully.',
        data: { user },
      });
    } catch (error) {
      next(error);
    }
  };

  public loginWithPassword = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, password } = req.body as { email: string; password: string };
      const user = await prisma.user.findUnique({ where: { email } });

      if (!(await verifyPassword(password, user?.passwordHash))) {
        throw new AppError('Invalid email or password.', 401);
      }

      const sessionUser = {
        id: user!.id,
        email: user!.email,
        name: user!.name,
        avatarUrl: user!.avatarUrl,
        googleId: user!.googleId,
      };
      this.setAuthCookie(res, this.generateToken(user!.id, user!.email));
      return res.json({
        status: 'success',
        message: 'Signed in successfully.',
        data: { user: sessionUser },
      });
    } catch (error) {
      next(error);
    }
  };
}

export const authController = new AuthController();
